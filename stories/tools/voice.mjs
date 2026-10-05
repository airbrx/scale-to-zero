// voice.mjs - make a take into the film's voice.
//
//   node stories/tools/voice.mjs <slug> <take.wav|mp3|...>
//
// Encodes the take as AAC-LC, mono, 48 kHz, 48 kbps, with the index at the
// front so it starts playing before it has all arrived, into
// stories/<slug>/voiceover.m4a. AAC-LC plays in every browser with nothing
// to load and no fallback to keep; for one voice it is about two thirds the
// size of the MP3s we used to make (an eight-minute take: ~2.9 MB).
//
// Then, if the film has a voiceover.json aligned to this take (tools/align.py),
// it names the file in it ("audio"), which makes it
// the film's default voice: the story window plays it with no file to load,
// and the MP4 export uses it. A voiceover.json aligned to a different take
// (it names another source) is refused: align this one first. The voice is
// padded with silence to the alignment's duration, so the end card plays out
// under it. Needs ffmpeg and ffprobe on the PATH.

import { readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const [slug, take] = process.argv.slice(2);
if (!slug || !take) { console.error("usage: node stories/tools/voice.mjs <slug> <take>"); process.exit(1); }
const dir = path.join(root, slug);
if (!(await stat(path.join(dir, "script.md")).catch(() => null))) { console.error(`voice: no film at ${dir}`); process.exit(1); }
if (!(await stat(take).catch(() => null))) { console.error(`voice: no take at ${take}`); process.exit(1); }

const FILE = "voiceover.m4a", KBPS = 48, RATE = 48000;
const out = path.join(dir, FILE);
const run = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { console.error(`voice: ${cmd} failed: ${(e.stderr || e.message).trim()}`); process.exit(1); }
};
const seconds = (f) => {
  const s = parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]));
  if (!Number.isFinite(s)) { console.error(`voice: ffprobe could not read a duration from ${f}`); process.exit(1); }
  return s;
};

const voPath = path.join(dir, "voiceover.json");
const vo = (await stat(voPath).catch(() => null)) ? JSON.parse(await readFile(voPath, "utf8")) : null;
const takeDur = seconds(take);
// an alignment belongs to one take (align.py names it), and says how long the film's voice runs:
// the take, plus silence for the end card. The encoded voice is padded to that.
if (vo) {
  if (!Number.isFinite(vo.duration)) { console.error(`voice: ${path.relative(root, voPath)} has no duration; it isn't an alignment`); process.exit(1); }
  if (vo.source !== path.basename(take)) { console.error(`voice: voiceover.json was aligned to ${vo.source}, not ${path.basename(take)}. Align this take (tools/align.py), then run again.`); process.exit(1); }
  if (vo.duration / 1000 < takeDur - .3) { console.error(`voice: voiceover.json runs ${(vo.duration / 1000).toFixed(1)} s but the take is ${takeDur.toFixed(1)} s; re-align it`); process.exit(1); }
}
const pad = vo ? ["-af", `apad=whole_dur=${(vo.duration / 1000).toFixed(3)}`] : [];
run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", take, "-vn", "-map_metadata", "-1", ...pad,
  "-ac", "1", "-ar", String(RATE), "-c:a", "aac", "-profile:a", "aac_low", "-b:a", `${KBPS}k`, "-movflags", "+faststart", out]);
const dur = seconds(out), size = (await stat(out)).size, takeSize = (await stat(take)).size;
const mb = (b) => (b / 1048576).toFixed(2);
console.log(`voice: ${path.relative(root, out)}  ${mb(size)} MB  ${dur.toFixed(1)} s  AAC-LC mono ${KBPS} kbps (the take: ${mb(takeSize)} MB, ${takeDur.toFixed(1)} s)`);
if (!vo) {
  console.log(`voice: ${slug} has no voiceover.json yet. Align this take into it (tools/align.py), then run this again to make it the film's voice.`);
  process.exit(0);
}
if (Math.abs(vo.duration / 1000 - dur) > .1) { console.error(`voice: the encoded voice runs ${dur.toFixed(2)} s, not the ${(vo.duration / 1000).toFixed(2)} s voiceover.json asks for`); process.exit(1); }
vo.audio = FILE;
vo.encoded = { codec: "AAC-LC", channels: 1, sampleRate: RATE, kbps: KBPS, from: path.basename(take) };
await writeFile(voPath, JSON.stringify(vo, null, 1) + "\n");
console.log(`voice: voiceover.json now names ${FILE} as ${slug}'s voice`);
