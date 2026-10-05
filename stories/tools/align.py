"""align.py - time a film to a recording of its script.

    python stories/tools/align.py <slug> <take.wav|mp3|...>

faster-whisper (small.en,
CPU) hears the take with word timestamps; the script's words are matched to
the heard ones with difflib over normalised tokens; every beat starts a
quarter second before its first word and every {cue} lands on its word.
Writes stories/<slug>/voiceover.json and, beside the take, <take>.transcript.txt
(what Whisper heard, beat by beat, with the words it couldn't match marked)
for reading for slips.

Script words are read exactly as lib/timeline.js reads them (same word
pattern, same cue rules), so cue N is word N in both. A cue at the end of a
paragraph, or on its own line, lands where the last word before it ends,
plus any [pause] written before it. A beat with no words (the title) starts
just after the previous beat's last word and lasts as long as the take
leaves it: the tool says when that's shorter than the story asks for.

The film runs as long as the voiceover says (its "duration"): at least the
take, and long enough for the last cue's build to play out and 4.5 s after
the last word. tools/voice.mjs pads the encoded voice with silence to match.

Needs: ffmpeg on the PATH; pip install faster-whisper numpy.
"""

import json, re, subprocess, sys, difflib, datetime
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
if len(sys.argv) != 3:
    sys.exit("usage: python stories/tools/align.py <slug> <take>")
slug, take = sys.argv[1], Path(sys.argv[2])
film = ROOT / slug
if not (film / "script.md").exists():
    sys.exit(f"align: no film at {film}")
if not take.exists():
    sys.exit(f"align: no take at {take}")

# ---------------- the script, as timeline.js reads it ----------------
CUE = re.compile(r"\{([\w-]+)\}")
WORD = re.compile(r"[A-Za-z0-9$][A-Za-z0-9'’.,%$-]*")

def parse(md):
    beats, cur, para = [], None, []
    def flush():
        nonlocal para
        if cur is not None and para:
            text = re.sub(r"\s+", " ", " ".join(para)).strip()
            if text:
                cur["blocks"].append({"kind": "say", "text": text})
        para = []
    for line in md.splitlines():
        h = re.match(r"^##\s+(\d{2})\b\s*(.*)$", line)
        if h:
            flush()
            cur = {"n": int(h.group(1)), "title": h.group(2), "skip": bool(re.search(r"\[skip\]", h.group(2), re.I)), "blocks": []}
            beats.append(cur)
            continue
        if cur is None:
            continue
        t = line.strip()
        if not t:
            flush(); continue
        p = re.match(r"^\[pause\s+([\d.]+)\s*s?\]$", t, re.I)
        if p:
            flush(); cur["blocks"].append({"kind": "pause", "secs": float(p.group(1))}); continue
        c = re.match(r"^\{([\w-]+)\}$", t)
        if c:
            flush(); cur["blocks"].append({"kind": "cue", "name": c.group(1)}); continue
        if t.startswith(">"):
            flush(); continue
        para.append(t)
    flush()
    return [b for b in beats if not b["skip"]]

beats = parse((film / "script.md").read_text(encoding="utf8"))
words = []   # every spoken script word: (beat index, text)
cues = []    # (name, beat index, word index g, mode): 'on' = at word g's start; 'after' = after word g-1 ends, + pause
for bi, b in enumerate(beats):
    pause = 0.0
    for blk in b["blocks"]:
        if blk["kind"] == "pause":
            pause += blk["secs"]
        elif blk["kind"] == "cue":
            cues.append((blk["name"], bi, len(words), "after", pause))
        else:
            text = blk["text"]
            toks = WORD.findall(CUE.sub(" ", text))
            for m in CUE.finditer(text):
                before = len(WORD.findall(CUE.sub(" ", text[: m.start()])))
                g = len(words) + before
                cues.append((m.group(1), bi, g, "on" if before < len(toks) else "after", 0.0))
            words += [(bi, w) for w in toks]
            pause = 0.0

# ---------------- what was said ----------------
def norm(w):
    w = w.lower().replace("’", "'")
    w = re.sub(r"(?<=\d)[,:](?=\d)", "", w)          # 5,200 -> 5200, 9:04 -> 904
    out = []
    for part in re.split(r"[-–—/]", w):
        part = re.sub(r"[^a-z0-9$%']", "", part).strip("'")
        if part:
            out.append(part)
    return out

pcm = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(take), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                     capture_output=True, check=True).stdout
audio = np.frombuffer(pcm, dtype=np.float32)
take_s = len(audio) / 16000
names = sorted({w for _, w in words if re.search(r"[A-Z0-9]", w[1:]) or (w[:1].isupper() and len(w) > 2)})
prompt = ", ".join(names)[:600]
model = WhisperModel("small.en", device="cpu", compute_type="int8")
segs, _ = model.transcribe(audio, language="en", word_timestamps=True, initial_prompt=prompt, vad_filter=False)
heard = [(w.word.strip(), w.start, w.end) for s in segs for w in s.words]
if not heard:
    sys.exit("align: Whisper heard no words in the take")

# Whisper starts a word that follows a pause somewhere back in the silence.
# Snap every start forward to where there is sound: 10 ms frames, "sound"
# being within 35 dB of the take's loud speech.
FR = 160
rms = np.sqrt(np.mean(audio[: len(audio) // FR * FR].reshape(-1, FR) ** 2, axis=1)) + 1e-9
db = 20 * np.log10(rms)
loud = np.percentile(db, 95)
voiced = db > loud - 35
def onset(s, e):
    a, b = int(s * 100), max(int(s * 100) + 1, int(e * 100))
    hit = np.flatnonzero(voiced[a:b])
    return s if not len(hit) else (a + hit[0]) / 100
heard = [(w, onset(s, e), e) for w, s, e in heard]

# ---------------- match ----------------
sflat, sown = [], []          # script sub-tokens, and the script word each came from
for i, (_, w) in enumerate(words):
    for p in norm(w):
        sflat.append(p); sown.append(i)
hflat, hown = [], []
for j, (w, _, _) in enumerate(heard):
    for p in norm(w):
        hflat.append(p); hown.append(j)
sm = difflib.SequenceMatcher(None, sflat, hflat, autojunk=False)
start = [None] * len(words); end = [None] * len(words)
for a, b, size in sm.get_matching_blocks():
    for k in range(size):
        i, j = sown[a + k], hown[b + k]
        if start[i] is None:
            start[i] = heard[j][1]
        end[i] = heard[j][2]
matched = sum(s is not None for s in start)
# an unmatched word takes the next matched word's time (the last ones, the previous end)
nxt = None
for i in range(len(words) - 1, -1, -1):
    if start[i] is None:
        if nxt is not None:
            start[i] = end[i] = nxt
    else:
        nxt = start[i]
prev = 0.0
for i in range(len(words)):
    if start[i] is None:
        start[i] = end[i] = prev
    prev = end[i]

# ---------------- beats and cues ----------------
first = {}; last = {}
for i, (bi, _) in enumerate(words):
    first.setdefault(bi, i); last[bi] = i
bstart = []
for bi in range(len(beats)):
    if bi == 0:
        bstart.append(0.0)
    elif bi in first:
        bstart.append(max(bstart[-1], start[first[bi]] - 0.25))
    else:
        prev_words = [last[k] for k in range(bi) if k in last]
        bstart.append(max(bstart[-1], (end[prev_words[-1]] + 0.4) if prev_words else 0.0))
# a wordless beat can't start after the next beat does
for bi in range(len(beats) - 2, 0, -1):
    bstart[bi] = min(bstart[bi], bstart[bi + 1])

decl = json.loads(subprocess.run(["node", "-e", f"import('{(film / 'story.js').as_uri()}').then(m=>console.log(JSON.stringify(m.BEATS)))"],
                                 capture_output=True, text=True, check=True).stdout)

# Room: a beat the take gives less time than the story asks for (a title
# card read straight through, a turn with no breath after it) gets silence
# inserted just before the next beat, and everything after moves along. The
# take with the room in it is written beside the original and becomes the
# voice; the original is never touched.
inserts = []
for bi in range(len(beats) - 1):
    have = bstart[bi + 1] - bstart[bi]
    want = decl[str(beats[bi]["n"])].get("min", 0)
    if have < want - 0.05:
        inserts.append((bstart[bi + 1], round(want - have + 0.2, 2)))
if inserts:
    shift = lambda t: t + sum(s for at, s in inserts if t >= at - 1e-6)
    start = [shift(t) for t in start]; end = [shift(t) for t in end]
    bstart = [shift(t) for t in bstart]
    heard = [(w, shift(s), shift(e)) for w, s, e in heard]
    rate = int(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", str(take)],
                              capture_output=True, text=True, check=True).stdout.strip())
    parts, chain, last_at = [], [], 0.0
    for k, (at, secs) in enumerate(inserts):
        parts.append(f"[0:a]atrim={last_at}:{at},asetpts=PTS-STARTPTS[p{k}]")
        parts.append(f"anullsrc=r={rate}:cl=mono,atrim=0:{secs}[s{k}]")
        chain += [f"[p{k}]", f"[s{k}]"]
        last_at = at
    parts.append(f"[0:a]atrim=start={last_at},asetpts=PTS-STARTPTS[p{len(inserts)}]")
    chain.append(f"[p{len(inserts)}]")
    graph = ";".join(parts) + ";" + "".join(chain) + f"concat=n={len(chain)}:v=0:a=1[o]"
    roomy = take.with_name(take.stem + " (aligned).wav")
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", str(take), "-filter_complex", graph, "-map", "[o]", "-ac", "1", "-c:a", "pcm_s24le", str(roomy)], check=True)
    take_s += sum(s for _, s in inserts)
    for at, secs in inserts:
        print(f"align: {secs:.2f} s of silence before {at:.1f} s of the take, to give a beat its room")
    take = roomy
out_beats, ends = [], []
for bi, b in enumerate(beats):
    out_beats.append({"n": b["n"], "start": round(bstart[bi] * 1000), "cues": {}})
for name, bi, g, mode, pause in cues:
    if mode == "on":
        t = start[g]
    else:
        prior = [i for i in range(g) if words[i][0] == bi]
        t = (end[prior[-1]] if prior else bstart[bi]) + pause
    t = max(t, bstart[bi])
    out_beats[bi]["cues"][name] = round((t - bstart[bi]) * 1000)
    ends.append(t + decl[str(beats[bi]["n"])]["cues"][name])

need = max([take_s, end[-1] + 4.5] + ends)
vo = {
    "source": take.name,
    "duration": round(need * 1000),
    "aligned": datetime.date.today().isoformat(),
    "note": f"Aligned by stories/tools/align.py: faster-whisper small.en word timestamps against script.md; {matched} of {len(words)} script words matched. Beat starts and cue times are ms from audio 0:00 / from the beat start. The take is {take_s:.1f} s; the film runs {need:.1f} s, so the voice is padded with silence.",
    "beats": out_beats,
}
(film / "voiceover.json").write_text(json.dumps(vo, indent=1) + "\n", encoding="utf8")

# ---------------- report ----------------
lines = [f"{take.name}: {matched}/{len(words)} script words matched ({100 * matched / len(words):.0f}%)", ""]
ok = set(sown[a + k] for a, b, size in sm.get_matching_blocks() for k in range(size))
for bi, b in enumerate(beats):
    nb = beats[bi + 1] if bi + 1 < len(beats) else None
    dur = (bstart[bi + 1] if nb else need) - bstart[bi]
    lines.append(f"## {b['n']:02d} {b['title']}  @ {bstart[bi]:.1f} s, {dur:.1f} s (story asks at least {decl[str(b['n'])].get('min', 0)} s)")
    ws = [("" if i in ok else "~") + w for i, (k, w) in enumerate(words) if k == bi]
    lines.append(" ".join(ws) if ws else "(no words)")
    hs = [w for w, s, e in heard if bstart[bi] <= s < (bstart[bi + 1] if nb else 1e9)]
    lines.append("heard: " + " ".join(hs))
    lines.append("")
gaps = [(heard[k][2], heard[k + 1][1]) for k in range(len(heard) - 1) if heard[k + 1][1] - heard[k][2] > 1.5]
lines.append("pauses over 1.5 s: " + (", ".join(f"{a:.1f}-{b:.1f} s" for a, b in gaps) or "none"))
report = take.with_name(take.stem + ".transcript.txt")
report.write_text("\n".join(lines) + "\n", encoding="utf8")
print(f"align: {matched}/{len(words)} script words matched ({100 * matched / len(words):.0f}%); wrote {film / 'voiceover.json'} and {report}")
for bi, b in enumerate(beats):
    nb = bi + 1 < len(beats)
    dur = (bstart[bi + 1] if nb else need) - bstart[bi]
    m = decl[str(b["n"])].get("min", 0)
    if dur < m:
        print(f"align: beat {b['n']:02d} ({b['title']}) gets {dur:.1f} s of the take; the story asks for at least {m} s")
