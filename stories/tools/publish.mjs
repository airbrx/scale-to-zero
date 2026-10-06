// publish.mjs - the readers' copy of the films, ready to upload.
//
//   node stories/tools/publish.mjs              every film that has a voice
//   node stories/tools/publish.mjs <slug>...    just these
//   node stories/tools/publish.mjs --out <dir>  somewhere other than stories/dist/films/
//
// Builds stories/dist/films/, laid out as the site's /films/ expects: each
// film's page, story, script and voice, the shared kit, brand, score and
// vendored Tone.js beside them, and films/manifest.json, the list the admin
// offers when attaching a film to an article. Studio-only parts stay behind:
// the presenter, the storyboard, the lookbook, the tools, the local gallery.
// Nothing is uploaded here: CI (.github/workflows/films.yml) syncs the folder
// to the staging bucket, and the admin's publish takes it live.
//
// A published film has a voice. A named film without an aligned
// voiceover.json naming its audio (tools/voice.mjs) is refused; with no names,
// films without one are skipped and listed. Every film built runs the smoke
// test (check.mjs) first; any failure stops the build. Its title, description
// and article come from stories/manifest.json, which must list it, or from
// stories/manifest.local.json for a draft: the film of an unpublished article,
// gitignored with its folder, so only built on this machine. A draft is marked
// "draft": true in the built manifest; the admin sends it to staging
// (POST /films/{slug}/draft), since CI never sees it.
//
// In each film's page: <html class="published"> hides the Record and
// Presenter controls (brand/viewer.css), the noindex line is dropped, and the
// wordmark in the bar links to the site rather than the local gallery.

import { readFile, writeFile, stat, mkdir, rm, cp, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const named = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const die = (msg) => { console.error(`publish: ${msg}`); process.exit(1); };
const exists = async (p) => !!(await stat(p).catch(() => null));
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

if (!(await exists(path.join(root, "lib", "viewer.js")))) die("stories/lib is missing");
const listed = new Map((await readJson(path.join(root, "manifest.json"))).stories.map((s) => [s.slug, s]));
const localPath = path.join(root, "manifest.local.json");
for (const s of (await exists(localPath)) ? (await readJson(localPath)).stories : []) {
  if (listed.has(s.slug)) die(`${s.slug} is in both manifest.json and manifest.local.json; a published film is only in manifest.json`);
  listed.set(s.slug, { ...s, draft: true });
}

/* ---- which films ---- */
async function voiceOf(slug) {
  const voPath = path.join(root, slug, "voiceover.json");
  if (!(await exists(voPath))) return { why: "no voiceover.json (record, then tools/align.py and tools/voice.mjs)" };
  const vo = await readJson(voPath);
  if (!vo.audio) return { why: "voiceover.json names no audio (tools/voice.mjs)" };
  if (!(await exists(path.join(root, slug, vo.audio)))) return { why: `voiceover.json names ${vo.audio}, which isn't there` };
  if (!vo.level?.speech) return { why: `voiceover.json has no level: the player doesn't decode the voice, so it needs one (node stories/tools/voice.mjs ${slug} --measure)` };
  return { vo };
}
const candidates = named.length ? named
  : (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
const films = [];
for (const slug of candidates) {
  if (!(await exists(path.join(root, slug, "story.js")))) { if (named.length) die(`no film at ${path.join(root, slug)}`); continue; }
  const { vo, why } = await voiceOf(slug);
  if (!vo) { if (named.length) die(`${slug}: ${why}`); console.log(`publish: skipping ${slug}: ${why}`); continue; }
  if (!listed.has(slug)) die(`${slug} has a voice but no entry in stories/manifest.json, or manifest.local.json for a draft (its title and description)`);
  films.push({ slug, vo });
}
if (!films.length) die("no film has a voice yet, so there is nothing to publish");

// the smoke test, voiceover timing included; it prints its own failure
for (const { slug } of films) {
  try { execFileSync(process.execPath, [path.join(here, "check.mjs"), slug], { stdio: ["ignore", "ignore", "inherit"] }); }
  catch { die(`${slug} failed the smoke test (node stories/tools/check.mjs ${slug}); nothing was built`); }
}

/* ---- the build: replaced whole, so a film that's gone is gone ---- */
const out = path.resolve(outArg || path.join(root, "dist", "films"));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const SHARED = {
  lib: (f) => !/^presenter\./.test(f) && f !== "stage.js",   // stage.js: the studio's Send to staging
  brand: (f) => f !== "looks" && !/^presenter\./.test(f),
  score: () => true,
  vendor: () => true,
};
for (const [d, keep] of Object.entries(SHARED)) {
  await mkdir(path.join(out, d), { recursive: true });
  for (const f of await readdir(path.join(root, d))) if (keep(f)) await cp(path.join(root, d, f), path.join(out, d, f), { recursive: true });
}

// edits to the copies, each of which must match exactly once
async function edit(file, find, replace) {
  const p = path.join(out, file), text = await readFile(p, "utf8");
  const n = typeof find === "string" ? text.split(find).length - 1 : (text.match(new RegExp(find.source, "g")) || []).length;
  if (n !== 1) die(`expected ${JSON.stringify(String(find))} once in ${file}, found it ${n} times`);
  await writeFile(p, text.replace(find, replace));
}
await edit("lib/viewer.js", '<a class="brand" href="../index.html" title="All stories">', '<a class="brand" href="/" title="The Scale-to-Zero Report">');

const manifest = [];
for (const { slug, vo } of films) {
  const src = path.join(root, slug), dst = path.join(out, slug);
  await mkdir(dst, { recursive: true });
  for (const f of ["index.html", "story.js", "script.md", "voiceover.json", vo.audio]) await cp(path.join(src, f), path.join(dst, f));
  await edit(`${slug}/index.html`, '<html lang="en">', '<html lang="en" class="published">');
  await edit(`${slug}/index.html`, /<meta name="robots" content="noindex, nofollow">\r?\n/, "");
  const m = listed.get(slug);
  manifest.push({
    slug, title: m.title, description: m.description ?? "", date: m.date ?? "",
    durationSeconds: Math.round(vo.duration / 100) / 10,
    ...(m.article ? { article: m.article } : {}),
    ...(m.draft ? { draft: true } : {}),
  });
}
manifest.sort((a, b) => (a.date < b.date ? 1 : -1));
await writeFile(path.join(out, "manifest.json"), JSON.stringify({ films: manifest.map(({ date, ...f }) => f) }, null, 2) + "\n");

/* ---- what a reader downloads ---- */
let raw = 0, wire = 0, count = 0;
async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { await walk(p); continue; }
    const b = await readFile(p), z = /\.(js|css|html|md|json|svg)$/.test(e.name) ? gzipSync(b).length : b.length;
    raw += b.length; wire += z; count++;
  }
}
await walk(out);
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
console.log(`publish: ${films.map((f) => f.slug).join(", ")} -> ${out}`);
console.log(`publish: ${count} files, ${kb(raw)} on disk, about ${kb(wire)} over the wire (text gzipped; the voices as they are)`);
