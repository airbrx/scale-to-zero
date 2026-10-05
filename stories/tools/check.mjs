// check.mjs - look at a story without opening a browser.
//
//   node stories/tools/check.mjs <slug>            smoke test only
//   node stories/tools/check.mjs <slug> --stills   + contact sheets, light and dark
//   node stories/tools/check.mjs <slug> --stills --at 12.5,40   + those moments too
//   node stories/tools/check.mjs <slug> --audio [--voice take.mp3] [--seconds 60]
//
// Smoke test: builds the timeline at 110 / 150 / 200 wpm (and from
// voiceover.json if there is one) and draws every 1/30 s against a stub
// canvas. Any exception fails the run. It also prints each beat's length
// against its words, so dead air shows up as a number.
//
// Stills (needs `npm install` in stories/tools once): every cue plus a
// second and a half, with the caption burned in, as contact sheets in
// stories/tools/out/<slug>-light.png and -dark.png. That's how overlaps,
// labels piling up and the caption band get caught.

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--") && !/^[\d.,]+$/.test(a));
if (!slug) { console.error("usage: node stories/tools/check.mjs <slug> [--stills] [--at 12.5,40]"); process.exit(1); }
const dir = path.join(root, slug);
if (!(await stat(path.join(dir, "story.js")).catch(() => null))) { console.error(`check: no story at ${dir}`); process.exit(1); }
if (!(await stat(path.join(root, "lib", "sketch.js")).catch(() => null))) { console.error("check: stories/lib is missing"); process.exit(1); }

// film.js listens for theme changes in other windows; there are none here
globalThis.addEventListener = () => {};

const imp = (p) => import(pathToFileURL(p).href);
const { parseScript, schedule, scheduleFromVoiceover, id2 } = await imp(path.join(root, "lib", "timeline.js"));
const sketch = await imp(path.join(root, "lib", "sketch.js"));
const { BEATS, makeStory } = await imp(path.join(dir, "story.js"));
const script = parseScript(await readFile(path.join(dir, "script.md"), "utf8"));

/* ---------------- the palette, read off the same CSS the page loads ---------------- */
const TOKENS = { bg: "--stage", card: "--stage-card", panel: "--stage-panel", ink: "--stage-ink", text: "--stage-text",
  grid: "--stage-grid", line: "--stage-line", muted: "--muted", accent: "--accent", accent2: "--accent-2",
  accentText: "--accent-text", glow: "--glow", ok: "--ok", stop: "--stop", water: "--water", coin: "--coin", oai: "--oai" };
async function palette(dark) {
  const vars = {};
  for (const f of [path.join(root, "lib", "tokens.css"), path.join(root, "brand", "tokens.css")]) {
    const css = (await readFile(f, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const s = sel.trim();
      if (s !== ":root" && !(dark && s === "html.dark")) continue;
      for (const [, k, v] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[k] = v.trim();
    }
  }
  const P = {};
  for (const k in TOKENS) P[k] = vars[TOKENS[k]] ?? "";
  P.dark = dark;
  return P;
}

/* ---------------- smoke test ---------------- */
const stub = () => {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === "measureText") return (s) => ({ width: String(s).length * 7 });
      if (typeof k === "string" && k.startsWith("create")) return () => grad;
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
};
const P0 = await palette(false);
// fold.js builds its halftone screens on a canvas; the smoke test hands it stubs
const { LOOK } = await imp(path.join(root, 'brand', 'fold.js'));
LOOK.canvas = (w, h) => ({ width: w, height: h, getContext: () => stub() });
const timings = [110, 150, 200].map((w) => [`${w} wpm`, () => schedule(script, BEATS, w)]);
const voPath = path.join(dir, "voiceover.json");
if (await stat(voPath).catch(() => null)) timings.push(["voiceover", async () => scheduleFromVoiceover(JSON.parse(await readFile(voPath, "utf8")), script, BEATS)]);
let failed = 0;
for (const [name, build] of timings) {
  const T = await build(), story = makeStory(T), g = stub();
  let frames = 0;
  for (let t = 0; t <= T.total; t += 1 / 30) {
    sketch.S.boil = Math.floor(t * 8);
    try { story.draw(g, t, P0); story.audio(t); frames++; }
    catch (e) { console.error(`check: ${name}: draw threw at ${t.toFixed(2)} s: ${e.stack}`); failed++; break; }
  }
  for (const s of story.sounds) if (!Number.isFinite(s.t)) { console.error(`check: ${name}: a "${s.kind}" sound has no time`); failed++; }
  const m = Math.floor(T.total / 60), s = Math.round(T.total % 60);
  console.log(`${name.padEnd(10)} ${m}:${String(s).padStart(2, "0")}  ${frames} frames  ${story.sounds.length} sounds`);
}
if (failed) process.exit(1);

/* pacing, at the house speed: where a beat runs longer than its words */
{
  const T = schedule(script, BEATS, 150);
  console.log("\nbeat  length  spoken  held  title");
  for (const b of T.beats) {
    const held = b.dur - b.speak - .5;
    console.log(`${id2(b.n)}   ${b.dur.toFixed(1).padStart(6)}  ${b.speak.toFixed(1).padStart(6)}  ${(held > .5 ? held.toFixed(1) : "").padStart(4)}  ${b.title}`);
  }
}

/* ---------------- the soundtrack ---------------- */
// --audio: the export's own render (score/sound.js) run in Node through a
// Web Audio implementation, measured in LUFS (score/loudness.js, the same
// meter the engine levels the voice with). Writes the mix as a WAV.
//   --voice take.mp3   mix a voiceover in, the way the export does, and
//                      report the voice, the score under it and in its gaps
//   --voice-at 5       film second the take's 0:00 plays at (default: beat 01)
//   --seconds 60       render only the first N seconds (a 3-minute film
//                      takes about 3 minutes to render)
if (args.includes("--audio") || args.includes("--voice")) {
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  let wa;
  try { wa = require("node-web-audio-api"); }
  catch (e) { console.error(`check: --audio needs node-web-audio-api and tone. Run: cd stories/tools && npm install\n(${e.message})`); process.exit(1); }
  Object.assign(globalThis, wa); globalThis.window = globalThis; globalThis.self = globalThis;
  const vm = await import("node:vm");
  vm.runInThisContext(await readFile(require.resolve("tone/build/Tone.js"), "utf8"));
  const { renderSoundtrack } = await imp(path.join(root, "score", "sound.js"));
  const { lufs, lufsWhere, peakDb, speechMap } = await imp(path.join(root, "score", "loudness.js"));
  const T = schedule(script, BEATS, 150), story = makeStory(T), SR = 24000;
  await mkdir(path.join(here, "out"), { recursive: true });

  // the voiceover, decoded by ffmpeg to mono float
  let voice = null, voiceAt = 0;
  if (opt("--voice")) {
    const raw = path.join(here, "out", "voice.f32");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", opt("--voice"), "-f", "f32le", "-ac", "1", "-ar", String(SR), raw]);
    const b = await readFile(raw), x = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    voice = new wa.AudioBuffer({ length: x.length, sampleRate: SR, numberOfChannels: 1 });
    voice.copyToChannel(x, 0);
    voiceAt = opt("--voice-at") !== null ? +opt("--voice-at") : T.start(1);
  }
  const duration = Math.min(T.total, opt("--seconds") ? +opt("--seconds") : Infinity);
  const t0 = Date.now();
  const render = (o) => renderSoundtrack({ story, duration, sampleRate: SR, voice, voiceAt, ...o });
  const score = await render({ voiceMuted: true });           // the score, ducking under the (silent) voice
  const said = voice ? await render({ music: false, fx: false }) : null;   // the voice alone, levelled
  const S = [score.getChannelData(0), score.getChannelData(1)];
  const V = said ? [said.getChannelData(0), said.getChannelData(1)] : null;
  // the two renders summed through the same soft ceiling the master has, so the WAV and its peak are the export's
  const M = V ? S.map((c, k) => c.map((v, i) => .966 * Math.tanh((v + V[k][i]) / .966))) : S;
  console.log(`\nsoundtrack: ${duration.toFixed(1)} s rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s${voice ? ` (twice: score, voice)` : ""}`);

  const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "   -").padStart(6);
  if (voice) {
    const vSpeaks = speechMap(V, SR, { hold: story.score.mix.gap }), at = (t) => vSpeaks(t);
    const vL = lufs(V, SR), uL = lufsWhere(S, SR, at), gL = lufsWhere(S, SR, (t) => !at(t) && t > voiceAt && t < voiceAt + voice.duration);
    console.log(`voice        ${f1(vL)} LUFS  peak ${f1(peakDb(V))} dBFS   (target ${story.score.mix.voice})`);
    console.log(`score, under ${f1(uL)} LUFS  ${f1(uL - vL)} LU against the voice`);
    console.log(Number.isFinite(gL) ? `score, gaps  ${f1(gL)} LUFS  ${f1(gL - vL)} LU against the voice` : `score, gaps    none: no pause in the take runs past ${story.score.mix.gap} s, so the score stays down`);
    console.log(`mix          ${f1(lufs(M, SR))} LUFS  peak ${f1(peakDb(M))} dBFS`);
    if (Math.abs(vL - story.score.mix.voice) > 1.5) { console.error(`check: the voice lands at ${vL.toFixed(1)} LUFS, not ${story.score.mix.voice}; adjust COMP_MAKEUP in score/sound.js`); failed++; }
  }
  console.log("\nsection     from     to    score LUFS");
  story.score.changes.forEach((c, i) => {
    const end = Math.min(duration, story.score.changes[i + 1] ? story.score.changes[i + 1].t : T.total);
    if (c.t >= duration) return;
    const l = lufs(S, SR, c.t + .3, end);
    console.log(`${c.name.padEnd(10)} ${c.t.toFixed(1).padStart(6)} ${end.toFixed(1).padStart(6)}   ${f1(l)}`);
    if (!voice && c.name !== "silence" && l < -36) { console.error(`check: section "${c.name}" is nearly silent (${l.toFixed(1)} LUFS)`); failed++; }
  });

  // the mix as a 16-bit WAV, to listen to without a browser
  const n = M[0].length, wav = Buffer.alloc(44 + n * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, M[0][i])) * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, M[1][i])) * 32767), 46 + i * 4); }
  const wf = path.join(here, "out", `${slug}${voice ? "-with-voice" : ""}.wav`);
  await writeFile(wf, wav);
  console.log(`\nsoundtrack: ${wf}`);
  if (failed) process.exit(1);
  if (!args.includes("--stills")) process.exit(0);
}

if (!args.includes("--stills")) process.exit(0);

/* ---------------- stills ---------------- */
let canvasMod;
try { canvasMod = await import("@napi-rs/canvas"); }
catch (e) { console.error(`check: --stills needs @napi-rs/canvas. Run: cd stories/tools && npm install\n(${e.message})`); process.exit(1); }
const { createCanvas, GlobalFonts, loadImage } = canvasMod;
LOOK.canvas = (w, h) => createCanvas(w, h);

// the fonts the page gets from Google Fonts, fetched once as TTFs
const fontDir = path.join(here, "fonts");
await mkdir(fontDir, { recursive: true });
const FAMILIES = [["Inter", [400, 500, 600, 700, 800]]];
for (const [family, weights] of FAMILIES) {
  const want = weights.map((w) => path.join(fontDir, `${family}-${w}.ttf`));
  if ((await Promise.all(want.map((f) => stat(f).catch(() => null)))).every(Boolean)) continue;
  const css = execFileSync("curl", ["-sSf", `https://fonts.googleapis.com/css2?family=${family}:wght@${weights.join(";")}`], { encoding: "utf8" });
  for (const [, w, url] of css.matchAll(/font-weight:\s*(\d+);[^}]*?src:\s*url\(([^)]+\.ttf)\)/g)) {
    execFileSync("curl", ["-sSf", "-o", path.join(fontDir, `${family}-${w}.ttf`), url]);
  }
}
for (const [family, weights] of FAMILIES) for (const w of weights) {
  const f = path.join(fontDir, `${family}-${w}.ttf`);
  if (!GlobalFonts.registerFromPath(f, family)) throw new Error(`check: could not register ${f}`);
}

const { captionAt, burnCaption } = await imp(path.join(root, "lib", "captions.js"));

const T = schedule(script, BEATS, 150), story = makeStory(T);
const extra = (args[args.indexOf("--at") + 1] || "").split(",").map(Number).filter((x) => args.includes("--at") && Number.isFinite(x));
const moments = [
  ...Object.entries(T.cues).map(([k, v]) => [v + 1.5, `{${k}} +1.5`]),
  ...extra.map((x) => [x, `@ ${x}s`]),
  [T.total - .5, "end"],
].sort((a, b) => a[0] - b[0]);

const TW = 640, TH = 360, COLS = 4, LAB = 26;
const outDir = path.join(here, "out");
await mkdir(outDir, { recursive: true });
for (const dark of [false, true]) {
  const P = await palette(dark), rows = Math.ceil(moments.length / COLS);
  const sheet = createCanvas(TW * COLS, (TH + LAB) * rows), sg = sheet.getContext("2d");
  sg.fillStyle = dark ? "#000" : "#888"; sg.fillRect(0, 0, sheet.width, sheet.height);
  const frame = createCanvas(1280, 720), g = frame.getContext("2d");
  moments.forEach(([t, label], i) => {
    sketch.S.boil = Math.floor(t * 8); sketch.S.rough = 1; sketch.S.lw = 1; sketch.S.ts = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    story.draw(g, t, P);
    burnCaption(g, captionAt(T, t), P);
    const x = (i % COLS) * TW, y = Math.floor(i / COLS) * (TH + LAB);
    sg.drawImage(frame, x, y + LAB, TW, TH);
    sg.fillStyle = dark ? "#ddd" : "#111"; sg.font = "600 14px Inter";
    sg.fillText(`${t.toFixed(1)} s  ${label}`, x + 8, y + 18);
  });
  const f = path.join(outDir, `${slug}-${dark ? "dark" : "light"}.png`);
  await writeFile(f, await sheet.encode("png"));
  console.log(`stills: ${f} (${moments.length} frames)`);
}
