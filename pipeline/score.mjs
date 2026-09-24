#!/usr/bin/env node
// Scores + dedupes the newest raw harvest into data/queue.json
//
//   node pipeline/score.mjs             score today's harvest
//   node pipeline/score.mjs --all       show everything, not just above minScore
//   node pipeline/score.mjs --file X    score a specific raw file

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { scoreItem, dedupe } from "./lib/score.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));

const config = await readJson("config.json");
const tax = await readJson("pipeline/taxonomy.json");

const argFile = process.argv.includes("--file")
  ? process.argv[process.argv.indexOf("--file") + 1]
  : null;
const showAll = process.argv.includes("--all");

let rawPath = argFile;
if (!rawPath) {
  const files = (await readdir(path.join(ROOT, "data", "raw"))).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    console.error("FATAL: no harvest files in data/raw. Run: node pipeline/harvest.mjs");
    process.exit(1);
  }
  rawPath = path.join(ROOT, "data", "raw", files.at(-1));
}

const raw = await readJson(rawPath);
console.log(`scoring ${raw.count} items from ${path.basename(rawPath)}\n`);

const scored = raw.items.map((it) => scoreItem(it, tax));
const deduped = dedupe(scored);

// Anything already written about is out of the running.
let published = [];
try {
  published = await readJson("data/published.json");
} catch {
  published = []; // first run, no archive yet -- expected, not an error
}
const usedUrls = new Set(published.map((p) => p.sourceUrl));
const fresh = deduped.filter((d) => !usedUrls.has(d.url));

const eligible = showAll ? fresh : fresh.filter((d) => d.score >= config.pipeline.minScore);

// Diversity cap. Without it a single news cycle (15 near-identical "data center
// backlash" stories on 2026-09-03) eats the whole queue and there is nothing
// to choose between. Take the best N per category, in score order.
function diversify(items, perCategory, total) {
  const taken = {};
  const picked = [];
  const overflow = [];
  for (const it of items) {
    const k = it.category ?? "_";
    taken[k] = taken[k] ?? 0;
    if (taken[k] < perCategory) {
      taken[k]++;
      picked.push(it);
    } else {
      overflow.push(it);
    }
    if (picked.length >= total) break;
  }
  // Backfill is bounded at 2x the cap. Unbounded backfill defeated the point --
  // a single day's water-usage coverage refilled 9 of 15 slots. A short, varied
  // queue beats a long, repetitive one; you only need one story to write about.
  const hardCap = perCategory * 2;
  for (const it of overflow) {
    if (picked.length >= total) break;
    const k = it.category ?? "_";
    if (taken[k] >= hardCap) continue;
    taken[k]++;
    picked.push(it);
  }
  return picked.sort((a, b) => b.score - a.score);
}

const queue = showAll
  ? eligible.slice(0, 200)
  : diversify(eligible, config.pipeline.maxPerCategory, config.pipeline.queueSize);

const byCat = {};
for (const q of queue) {
  const k = q.categoryLabel ?? "(uncategorized)";
  byCat[k] = (byCat[k] ?? 0) + 1;
}

console.log(`${deduped.length} unique after dedupe (${scored.length - deduped.length} duplicates collapsed)`);
console.log(`${fresh.length} not previously published`);
console.log(`${eligible.length} above minScore ${config.pipeline.minScore}`);
console.log(`\nqueue of ${queue.length}, by category:`);
for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(3)}  ${k}`);
}

await writeFile(
  path.join(ROOT, "data", "queue.json"),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), from: path.basename(rawPath), count: queue.length, items: queue },
    null,
    2
  )
);

console.log(`\nwrote data/queue.json`);
console.log("next: node pipeline/queue.mjs        (review the candidates)");
