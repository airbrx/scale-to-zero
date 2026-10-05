/* timeline.js - one clock for a story, from its script.

   A story is one continuous shot, timed by its script:

   - script.md is the only copy of the words. `## 03 Title` starts beat 03.
   - A beat is held for the longer of its words at the reading speed (plus a
     breath), its own floor (`min` in the story's BEATS), and its last {cue}
     plus the time that cue's build needs to play out.
   - A {cue} fires the story's build of that name at that word. The story
     never hardcodes a time: every moment in it is T.at('name') or a beat
     edge, so editing the script re-times the whole film.
   - voiceover.json, when present, replaces the reading speed with a real
     recording: each beat's start and each cue, in ms from audio 0:00.

   The viewer and the presenter both build their timeline here from the same
   script at the same speed (shared through localStorage), so the prompter's
   words and the film's pictures are the same clock.

   Strict on purpose: a cue the story does not have, a build
   the script never cues, or a voiceover aligned to a different script is an
   error with a sentence saying which, not a film that cuts on the wrong word. */

export const DEFAULT_WPM = 150;
const BREATH = .5;    // seconds after a beat's last word, before the next beat

const CUE = /\{([\w-]+)\}/g;
const WORD = /[A-Za-z0-9$][A-Za-z0-9'’.,%$-]*/g;
const countWords = (s) => (s.replace(CUE, ' ').match(WORD) || []).length;
const clean = (s) => s.replace(CUE, '').replace(/\s+/g, ' ').trim();

export const wpmKey = (slug) => `airbrx-story-${slug}:wpm`;
export function readWpm(slug) {
  let v = NaN;
  try { v = parseInt(localStorage.getItem(wpmKey(slug)), 10); } catch (e) { console.warn('timeline: localStorage unavailable', e); }
  return Number.isFinite(v) && v >= 80 && v <= 260 ? v : DEFAULT_WPM;
}
export function saveWpm(slug, v) {
  try { localStorage.setItem(wpmKey(slug), String(v)); } catch (e) { console.warn('timeline: could not save speed', e); }
}

/* A paragraph split into caption-sized sentences: each keeps its text with
   the cues (for the prompter's chips) and without (for the caption). */
function sentences(text) {
  // A sentence ends at . ! or ? followed by a space or the end of the
  // paragraph, so "11.3" and "9:00" stay whole in a caption.
  const parts = text.match(/(?:[^.!?]|[.!?](?!["”’)]*(?:\s|$)))+(?:[.!?]+["”’)]*)?\s*/g) || [text];
  let before = 0;
  return parts.map((p) => {
    const s = { raw: p.trim(), text: clean(p), wordsBefore: before, words: countWords(p) };
    before += s.words;
    return s;
  }).filter((s) => s.raw);
}

/* script.md -> [{ n, title, skip, blocks: [{kind:'say'|'note'|'pause'|'cue', ...}] }] */
export function parseScript(md) {
  const out = [];
  let cur = null, para = [];
  const flush = () => {
    if (!cur || !para.length) { para = []; return; }
    const text = para.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      const cues = [...text.matchAll(CUE)].map((m) => ({ name: m[1], wordsBefore: countWords(text.slice(0, m.index)) }));
      cur.blocks.push({ kind: 'say', text, words: countWords(text), cues, sentences: sentences(text) });
    }
    para = [];
  };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(\d{2})\b\s*(.*)$/);
    if (h) {
      flush();
      const skip = /\[skip\]/i.test(h[2]);
      cur = { n: +h[1], title: h[2].replace(/\[skip\]/i, '').trim(), skip, blocks: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const t = line.trim();
    if (!t) { flush(); continue; }
    const p = t.match(/^\[pause\s+([\d.]+)\s*s?\]$/i);
    if (p) { flush(); cur.blocks.push({ kind: 'pause', secs: +p[1] }); continue; }
    const c = t.match(/^\{([\w-]+)\}$/);
    if (c) { flush(); cur.blocks.push({ kind: 'cue', name: c[1] }); continue; }
    if (t.startsWith('>')) { flush(); cur.blocks.push({ kind: 'note', text: t.replace(/^>\s*/, '') }); continue; }
    para.push(t);
  }
  flush();
  if (!out.length) throw new Error('script.md has no "## NN" beat headings');
  return out;
}

export async function loadText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
  return res.text();
}
/* voiceover.json is optional: a story that has not been recorded yet has
   none, and runs on script timing. Whatever stops it loading (missing, or
   CloudFront's error page in its place, or a bad file) means the same thing,
   so it is said once in the console and the story carries on. */
export async function loadVoiceover(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`timeline: no usable ${url}, using script timing (${e.message})`);
    return null;
  }
}

export const id2 = (n) => String(n).padStart(2, '0');
const cueNames = (s) => s.blocks.flatMap((b) => (b.kind === 'cue' ? [b.name] : b.kind === 'say' ? b.cues.map((c) => c.name) : []));

/* Every build the story declares is cued exactly once, and nothing else is. */
function check(live, BEATS) {
  const seen = new Set();
  for (const s of live) {
    const decl = BEATS[s.n];
    if (!decl) throw new Error(`script.md has a "## ${id2(s.n)}" but the story has no beat ${id2(s.n)}`);
    for (const name of cueNames(s)) {
      if (!(name in decl.cues)) throw new Error(`script.md cues {${name}} in beat ${id2(s.n)}, which has no such build (it has: ${Object.keys(decl.cues).join(', ')})`);
      if (seen.has(name)) throw new Error(`script.md cues {${name}} twice`);
      seen.add(name);
    }
  }
  for (const n of Object.keys(BEATS)) {
    if (!live.some((s) => s.n === +n)) throw new Error(`the story has a beat ${id2(n)} but script.md does not (or skips it)`);
    for (const name of Object.keys(BEATS[n].cues)) {
      if (!seen.has(name)) throw new Error(`beat ${id2(n)}'s build {${name}} is never cued in script.md`);
    }
  }
}

/* Lay one beat's blocks out from `start`, a word lasting `spw` seconds and
   a written pause `ps` of its own length. Returns absolute times. */
function layout(s, start, spw, ps) {
  let t = 0;
  const cues = {};
  const blocks = s.blocks.map((b) => {
    if (b.kind === 'cue') { cues[b.name] = t; return { kind: 'cue', name: b.name, start: start + t, len: 0 }; }
    if (b.kind === 'note') return { kind: 'note', text: b.text, start: start + t, len: 0 };
    if (b.kind === 'pause') { const len = b.secs * ps, o = { kind: 'pause', secs: b.secs, start: start + t, len }; t += len; return o; }
    b.cues.forEach((c) => { cues[c.name] = t + c.wordsBefore * spw; });
    const o = {
      kind: 'say', raw: b.text, start: start + t, len: b.words * spw,
      sentences: b.sentences.map((x) => ({ raw: x.raw, text: x.text, start: start + t + x.wordsBefore * spw, end: start + t + (x.wordsBefore + x.words) * spw })),
    };
    t += b.words * spw;
    return o;
  });
  return { blocks, cues, speak: t };
}

function timeline(beats, cues, total, source, clock) {
  const lines = [];
  beats.forEach((b) => b.blocks.forEach((x, j) => {
    if (x.kind === 'say') x.sentences.forEach((s) => lines.push({ beat: b.n, block: j, ...s }));
  }));
  const byN = Object.fromEntries(beats.map((b) => [b.n, b]));
  const T = {
    beats, cues, lines, total, source, clock,
    at(name) { if (!(name in cues)) throw new Error(`story asked for {${name}}, which the timeline does not have`); return cues[name]; },
    start(n) { return byN[n].start; },
    end(n) { return byN[n].start + byN[n].dur; },
    beatIndexAt(t) { let k = beats.findIndex((b) => t < b.start + b.dur); return k < 0 ? beats.length - 1 : k; },
    /* Where a moment sits in the script (beat, block, fraction), so a speed
       change or a script reload keeps the same words on the reading line. */
    where(t) {
      const b = beats[T.beatIndexAt(t)];
      if (t >= b.start + b.speak) return { n: b.n, hold: (t - b.start - b.speak) / Math.max(.001, b.dur - b.speak) };
      const j = b.blocks.findIndex((x) => x.len && t < x.start + x.len);
      return j < 0 ? { n: b.n, hold: 0 } : { n: b.n, j, f: (t - b.blocks[j].start) / b.blocks[j].len };
    },
    timeAt(p) {
      const b = byN[p.n] || beats[0];
      if (p.hold != null || !b.blocks[p.j]) return b.start + b.speak + (p.hold || 0) * (b.dur - b.speak);
      return b.blocks[p.j].start + p.f * b.blocks[p.j].len;
    },
  };
  return T;
}

/* The film at a reading speed. Times are seconds from the first frame. */
export function schedule(script, BEATS, wpm) {
  const live = script.filter((s) => !s.skip);
  check(live, BEATS);
  const spw = 60 / wpm, beats = [], cues = {};
  let at = 0;
  for (const s of live) {
    const L = layout(s, at, spw, 1), decl = BEATS[s.n];
    const tail = Math.max(0, ...Object.entries(L.cues).map(([k, v]) => v + decl.cues[k]));
    const dur = Math.max(decl.min || 0, L.speak + BREATH, tail);
    for (const k in L.cues) cues[k] = at + L.cues[k];
    beats.push({ n: s.n, title: s.title, start: at, dur, speak: L.speak, blocks: L.blocks });
    at += dur;
  }
  return timeline(beats, cues, at, `${wpm} wpm`, 'script');
}

/* The film timed to a recording. voiceover.json:
   { source, duration (ms), aligned, lead (s, optional), beats: [{ n, start (ms), cues: { name: ms-from-beat-start } }] }
   Times are audio times. `lead` is film time before the audio's 0:00: a take
   that starts speaking at once still gets the wordless title beat first, so
   beat 00 runs from 0 to the lead and everything after it moves by the lead.
   An alignment carries beats and cues but not every sentence, so the words
   inside a beat are spread over it at the default speed, scaled to fit. */
export function scheduleFromVoiceover(vo, script, BEATS) {
  const live = script.filter((s) => !s.skip);
  check(live, BEATS);
  const want = live.map((s) => s.n).join(','), have = vo.beats.map((b) => b.n).join(',');
  if (want !== have) throw new Error(`the voiceover was aligned to beats ${have}; the script now has ${want}. Re-align it to the new recording.`);
  const beats = [], cues = {}, lead = vo.lead || 0;
  vo.beats.forEach((v, k) => {
    const s = live[k];
    const scriptCues = cueNames(s).sort().join(','), voCues = Object.keys(v.cues).sort().join(',');
    if (scriptCues !== voCues) throw new Error(`beat ${id2(v.n)}'s cues changed since the voiceover was aligned (script: ${scriptCues || 'none'}; voiceover: ${voCues || 'none'})`);
    const start = k === 0 ? 0 : lead + v.start / 1000, end = lead + (vo.beats[k + 1] ? vo.beats[k + 1].start : vo.duration) / 1000;
    const nominal = layout(s, 0, 60 / DEFAULT_WPM, 1).speak || 1;
    const scale = Math.max(.05, (end - start - BREATH) / nominal);
    const L = layout(s, start, scale * 60 / DEFAULT_WPM, scale);
    for (const [name, ms] of Object.entries(v.cues)) cues[name] = start + ms / 1000;
    beats.push({ n: s.n, title: s.title, start, dur: end - start, speak: L.speak, blocks: L.blocks });
  });
  const T = timeline(beats, cues, lead + vo.duration / 1000, vo.source, 'voiceover');
  T.lead = lead;
  return T;
}

export const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
