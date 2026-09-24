#!/usr/bin/env node
// Pulls raw candidates from every verified source into data/raw/<date>.json
//
//   node pipeline/harvest.mjs            full harvest
//   node pipeline/harvest.mjs --probe    connectivity check only, no write
//
// Source failures are reported loudly and counted. If EVERY source fails we
// exit non-zero rather than writing an empty file that looks like "slow news day".

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { curlText, curlJson, mapLimit, FetchError } from "./lib/fetch.mjs";
import { parseFeed, splitGoogleNewsTitle, stripHtml } from "./lib/rss.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));

const config = await readJson("config.json");
const sources = await readJson("pipeline/sources.json");
const UA = config.pipeline.userAgent;
const PROBE = process.argv.includes("--probe");

const failures = [];
const items = [];
const note = (label, n) => console.log(`  ${String(n).padStart(4)}  ${label}`);

// Each source gets its own horizon. HN wreckage stories are rare but evergreen
// (a 10-day window found 2 items); news feeds go stale in days.
const lookbackFor = (cfg) => cfg.lookbackDays ?? config.pipeline.lookbackDays;

function withinLookback(iso, days) {
  if (!iso) return true; // keep undated; scorer penalises it
  const age = (Date.now() - new Date(iso).getTime()) / 86400000;
  return age <= days && age > -1;
}

// ---------------------------------------------------------------- Hacker News
async function harvestAlgolia(cfg, tagName) {
  console.log(`\n[${tagName}] ${cfg.queries.length} queries -> ${cfg.endpoint}`);
  const since = Math.floor((Date.now() - lookbackFor(cfg) * 86400000) / 1000);

  const results = await mapLimit(cfg.queries, 4, async (q) => {
    // advancedSyntax + quoting is the difference between "cloud bill" matching
    // '$100K/day cloud bill isn't a Bug' and matching 'Collaborative cloud
    // canvas for coding agents'. Algolia ORs bare terms by default.
    const phrase = cfg.exactPhrase === false ? q : `"${q}"`;
    const url =
      `${cfg.endpoint}?query=${encodeURIComponent(phrase)}` +
      `&advancedSyntax=true&tags=story&hitsPerPage=30` +
      `&numericFilters=${encodeURIComponent(`created_at_i>${since},points>${cfg.minPoints}`)}`;
    const data = await curlJson(url, { userAgent: UA });
    return (data.hits ?? []).map((h) => ({
      title: h.title ?? h.story_title ?? "",
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      // Algolia returns story_text as raw HTML with escaped entities; unescaped
      // it pollutes scoring with markup and href noise.
      description: stripHtml(h.story_text ?? h.comment_text ?? "").slice(0, 900),
      source: "Hacker News",
      sourceQuery: q,
      discussionUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points ?? 0,
      numComments: h.num_comments ?? 0,
      publishedAt: h.created_at ?? null,
    }));
  });

  let n = 0;
  results.forEach((r, i) => {
    if (!r.ok) {
      failures.push({ source: `${tagName}:${cfg.queries[i]}`, error: r.error.message });
      return;
    }
    for (const it of r.value) if (it.title) { items.push(it); n++; }
  });
  note(`${tagName} items`, n);
}

// ------------------------------------------------------------------ RSS feeds
async function harvestFeeds(cfg, tagName) {
  const list = cfg.list;
  console.log(`\n[${tagName}] ${list.length} feeds`);
  // Concurrency 2 / 45s: The Register and DCD both time out at 4-wide/30s.
  const results = await mapLimit(list, 2, async (f) => {
    const xml = await curlText(f.url, { userAgent: UA, timeoutSec: 45 });
    const parsed = parseFeed(xml, f.name);
    if (!parsed.length) throw new FetchError(f.url, "parsed 0 items -- feed shape changed?");
    return parsed;
  });

  let n = 0;
  results.forEach((r, i) => {
    if (!r.ok) {
      failures.push({ source: `${tagName}:${list[i].name}`, error: r.error.message });
      return;
    }
    for (const it of r.value) {
      if (!withinLookback(it.publishedAt, lookbackFor(cfg))) continue;
      items.push(it);
      n++;
    }
  });
  note(`${tagName} items`, n);
}

// ------------------------------------------------------------- Google News
async function harvestGoogleNews(cfg) {
  console.log(`\n[googleNews] ${cfg.queries.length} queries`);
  const results = await mapLimit(cfg.queries, 3, async (q) => {
    const url = cfg.template
      .replace("{q}", encodeURIComponent(q))
      .replace("{days}", String(lookbackFor(cfg)));
    const xml = await curlText(url, { userAgent: UA });
    return parseFeed(xml, "Google News").map((it) => {
      const { headline, publisher } = splitGoogleNewsTitle(it.title);
      return { ...it, title: headline, publisher, sourceQuery: q };
    });
  });

  let n = 0;
  results.forEach((r, i) => {
    if (!r.ok) {
      failures.push({ source: `googleNews:${cfg.queries[i]}`, error: r.error.message });
      return;
    }
    for (const it of r.value) {
      if (!withinLookback(it.publishedAt, lookbackFor(cfg))) continue;
      items.push(it);
      n++;
    }
  });
  note("googleNews items", n);
}

// ---------------------------------------------------------------------- main
console.log(`harvest${PROBE ? " :: PROBE MODE" : ""}`);

await harvestAlgolia(sources.hnSearch, "hnSearch");
await harvestAlgolia(sources.hnFrontPage, "hnFrontPage");
await harvestGoogleNews(sources.googleNews);
await harvestFeeds(sources.feeds, "feeds");

console.log(`\n${"-".repeat(58)}`);
console.log(`collected ${items.length} raw items`);

if (failures.length) {
  console.log(`\n${failures.length} SOURCE FAILURE(S):`);
  for (const f of failures) console.log(`  ! ${f.source}\n      ${f.error.split("\n")[0]}`);
}

for (const [name, d] of Object.entries(sources.disabled)) {
  if (name === "_doc") continue;
  console.log(`  - ${name} disabled: ${d.reason.split("(")[0].trim()}`);
}

if (items.length === 0) {
  console.error("\nFATAL: every source returned zero items. Not writing an empty harvest.");
  process.exit(1);
}

if (PROBE) {
  console.log("\nprobe complete, nothing written.");
  process.exit(failures.length ? 2 : 0);
}

const stamp = new Date().toISOString().slice(0, 10);
const outPath = path.join(ROOT, "data", "raw", `${stamp}.json`);
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(
  outPath,
  JSON.stringify({ harvestedAt: new Date().toISOString(), failures, count: items.length, items }, null, 2)
);
console.log(`\nwrote ${path.relative(ROOT, outPath)}`);
console.log("next: node pipeline/score.mjs");
