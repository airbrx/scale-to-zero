"""tts.py - make a film's voice take from its script with a cloned voice.

    python stories/tools/tts.py <slug> [--voice VOICE_ID] [--speed 1.0]

Reads stories/<slug>/script.md exactly as align.py and lib/timeline.js do:
"## NN" beats, "> " notes and score lines, {cues} and [pause N]. Each spoken
paragraph is read by MiniMax Speech-02 HD on fal in the cloned voice; the
clips are joined with silence between paragraphs and beats, and a [pause N]
becomes N seconds of silence. Writes stories/<slug>/tts/take.wav.

Then, unless --no-align, it runs the usual pipeline on the take:
align.py (voiceover.json) and voice.mjs (voiceover.m4a).

Words a voice would misread are respelled for the voice only (SAY below);
script.md keeps them as written, and align.py matches loosely enough that
the cues still land. Clips are cached by their text and settings in
tts/clips/, so editing one line re-reads only that paragraph.

Needs: FAL_KEY in the environment (MINIMAX_VOICE_ID, or --voice);
ffmpeg on the PATH; pip install requests (and align.py's needs).
"""

import argparse, concurrent.futures, hashlib, json, os, re, subprocess, sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "fal-ai/minimax/speech-02-hd"
RATE = 32000
PARAGRAPH_GAP, BEAT_GAP = 0.45, 0.9   # seconds of silence between paragraphs / beats

# Respellings for the voice, applied in order (longest first where they nest).
# Letters to be spelled go in as one capitalised word ("ENV", "CGI"): the
# voice says an acronym as one smooth word. Spaced out ("C D N") it reads
# three words with a stop between each. CDN, TLS and the like need no entry.
SAY = [
    (r"\.env\.bak\b", "dot ENV dot back"),
    (r"\.env\b", "dot ENV"),
    (r"\.git/config\b", "dot git slash config"),
    (r"\.git\b", "dot git"),
    (r"\bmailer\.cgi\b", "mailer dot CGI"),
    (r"\bwp-config\b", "WP config"),
    (r"\bwp-admin\b", "WP admin"),
    (r"\bGreyNoise's\b", "Grey Noise's"),
    (r"\bGreyNoise\b", "Grey Noise"),
    (r"\bFlat-Stack\b", "Flat Stack"),
    (r"\bGfycat\b", "Jiffy cat"),
    (r"\b2026\b", "twenty twenty-six"),
    (r"\b2024\b", "twenty twenty-four"),
    (r"\b2022\b", "twenty twenty-two"),
    (r"\b2015\b", "twenty fifteen"),
]

CUE = re.compile(r"\{([\w-]+)\}")


def parse(md):
    """script.md -> [{n, title, blocks: [{kind: 'say', text} | {kind: 'pause', secs}]}], as align.py reads it."""
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
        if re.match(r"^\{([\w-]+)\}$", t) or t.startswith(">"):
            flush(); continue
        para.append(t)
    flush()
    return [b for b in beats if not b["skip"]]


def spoken(text):
    text = re.sub(r"\s+", " ", CUE.sub(" ", text)).strip()
    for pat, rep in SAY:
        text = re.sub(pat, rep, text)
    return text


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"tts: {cmd[0]} failed: {(r.stderr or r.stdout).strip()}")
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--voice", default=os.environ.get("MINIMAX_VOICE_ID"))
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--no-align", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("FAL_KEY")
    if not key:
        sys.exit("tts: FAL_KEY is not set")
    if not a.voice:
        sys.exit("tts: no voice: pass --voice or set MINIMAX_VOICE_ID")
    film = ROOT / a.slug
    if not (film / "script.md").exists():
        sys.exit(f"tts: no film at {film}")
    out = film / "tts"
    clips = out / "clips"
    clips.mkdir(parents=True, exist_ok=True)

    beats = parse((film / "script.md").read_text(encoding="utf8"))
    jobs = {}    # clip path -> text
    plan = []    # ('clip', path) | ('silence', secs), in order
    for bi, b in enumerate(beats):
        if bi:
            plan.append(("silence", BEAT_GAP))
        first = True
        for blk in b["blocks"]:
            if blk["kind"] == "pause":
                plan.append(("silence", blk["secs"]))
                first = True
                continue
            text = spoken(blk["text"])
            if not text:
                continue
            if not first:
                plan.append(("silence", PARAGRAPH_GAP))
            first = False
            h = hashlib.sha1(json.dumps([ENDPOINT, a.voice, a.speed, text]).encode()).hexdigest()[:16]
            path = clips / f"{b['n']:02d}-{h}.mp3"
            jobs[path] = text
            plan.append(("clip", path))

    todo = {p: t for p, t in jobs.items() if not p.exists()}
    chars = sum(len(t) for t in todo.values())
    print(f"tts: {len(beats)} beats, {len(jobs)} paragraphs; reading {len(todo)} new ({chars} chars, ~${chars / 1000 * 0.10:.2f})")
    H = {"Authorization": f"Key {key}", "Content-Type": "application/json"}

    def read(item):
        path, text = item
        r = requests.post(f"https://fal.run/{ENDPOINT}", headers=H, timeout=300, json={
            "text": text,
            "voice_setting": {"voice_id": a.voice, "speed": a.speed},
            "audio_setting": {"sample_rate": RATE, "format": "mp3", "channel": 1},
            "output_format": "url",
        })
        if not r.ok:
            raise RuntimeError(f"{ENDPOINT} {r.status_code} for {path.name}: {r.text}")
        audio = requests.get(r.json()["audio"]["url"], timeout=120)
        audio.raise_for_status()
        path.write_bytes(audio.content)
        return path

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for p in pool.map(read, todo.items()):
            print(f"tts: read {p.name}")

    # Join: every clip decoded to mono RATE, silences generated, one concat.
    args, parts = [], []
    for kind, v in plan:
        k = len(parts)
        if kind == "clip":
            args += ["-i", str(v)]
            parts.append(f"[{len(args) // 2 - 1}:a]aresample={RATE},aformat=channel_layouts=mono[a{k}]")
        else:
            parts.append(f"anullsrc=r={RATE}:cl=mono,atrim=0:{v}[a{k}]")
    graph = ";".join(parts) + ";" + "".join(f"[a{k}]" for k in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[o]"
    take = out / "take.wav"
    script = out / "join.ffgraph"
    script.write_text(graph, encoding="utf8")
    run(["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error", *args,
         "-filter_complex_script", str(script), "-map", "[o]", "-c:a", "pcm_s16le", str(take)])
    secs = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(take)]))
    print(f"tts: wrote {take} ({secs:.1f} s)")

    if a.no_align:
        return
    tools = Path(__file__).resolve().parent
    for cmd in ([sys.executable, str(tools / "align.py"), a.slug, str(take)],
                ["node", str(tools / "voice.mjs"), a.slug]):
        # align.py may write "<take> (aligned).wav" with room inserted; voice.mjs takes whichever it aligned
        if cmd[0] == "node":
            vo = json.loads((film / "voiceover.json").read_text(encoding="utf8"))
            cmd.append(str(out / vo["source"]))
        print("tts: " + " ".join(Path(c).name if i < 2 else c for i, c in enumerate(cmd)))
        r = subprocess.run(cmd)
        if r.returncode != 0:
            sys.exit(f"tts: {Path(cmd[1]).name} failed ({r.returncode})")


if __name__ == "__main__":
    main()
