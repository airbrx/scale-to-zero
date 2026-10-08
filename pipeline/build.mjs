#!/usr/bin/env node
// Renders articles/*.json into site/ as fully static HTML.
//
// The publication argues that a running server is a liability, so the site is
// pre-rendered files: no runtime, no database, no framework, no build-time
// network calls. Every article is real HTML (readable with JS off, indexable,
// shareable); articles.json exists only so the index can filter client-side.
//
// All the actual HTML lives in shared/render.mjs, which the admin Lambda also
// uses. Same input, same bytes, whichever path published it.

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderSite } from "../shared/render.mjs";
import { copyStatic } from "./static.mjs";
import { validator } from "../shared/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));

const config = await readJson("config.json");

// The stylesheet is referenced as style.css?v=<content hash>. Early deploys
// sent it `immutable` for a year, so a returning reader's browser will never
// re-fetch the bare URL; a new query string is a new URL it has not cached.
config.site.assetVersion = createHash("sha256")
  .update(await readFile(path.join(ROOT, "assets", "style.css")))
  .digest("hex").slice(0, 10);
const tax = await readJson("pipeline/taxonomy.json");
const manifesto = await readJson("content/manifesto.json");

// Every article, draft or not, must match the Article schema in the API
// contract -- the same check the admin applies on save. A malformed file fails
// the build here, naming the field, instead of rendering wrong.
const validate = validator(await readJson("admin/openapi.json"));

const files = (await readdir(path.join(ROOT, "articles"))).filter((f) => f.endsWith(".json"));
const articles = [];
for (const f of files) {
  const a = await readJson(path.join("articles", f));
  const problems = validate("Article", a);
  if (problems.length) throw new Error(`articles/${f} does not match the Article schema (admin/openapi.json):\n  ${problems.join("\n  ")}`);
  if (a.status !== "published") {
    console.log(`  skip (${a.status}) ${f}`);
    continue;
  }
  if (!a.headline || !a.dek) throw new Error(`${f}: published article needs headline and dek`);
  articles.push(a);
}

const { files: rendered, articles: sorted } = renderSite({
  site: config.site, tax, manifesto, articles,
});

await mkdir(path.join(SITE, "assets"), { recursive: true });
for (const [name, body] of Object.entries(rendered)) {
  await mkdir(path.dirname(path.join(SITE, name)), { recursive: true });
  await writeFile(path.join(SITE, name), body);
  if (name.endsWith(".html")) console.log(`  ${name}`);
}

// Remove rendered pages that no longer correspond to a published article.
// Without this, un-publishing an article leaves its HTML behind in site/ and
// the next deploy syncs it straight back to the live bucket -- the article
// disappears from the index and the feed but stays reachable at its URL.
const keep = new Set(Object.keys(rendered));
for (const f of await readdir(SITE)) {
  if (!f.endsWith(".html") || keep.has(f)) continue;
  await rm(path.join(SITE, f));
  console.log(`  pruned ${f}`);
}

// The admin's category and angle pickers read this, so the editor can only
// offer values the renderer actually understands.
await writeFile(path.join(SITE, "taxonomy.json"), JSON.stringify({
  categories: Object.fromEntries(
    Object.entries(tax.categories).map(([k, c]) => [k, { label: c.label, thesis: c.thesis }])),
  flatStackAngles: tax.flatStackAngles,
}, null, 2));

// Published archive -- the scorer reads this to avoid re-queueing a used story.
await writeFile(
  path.join(ROOT, "data", "published.json"),
  JSON.stringify(sorted.map((a) => ({ slug: a.slug, date: a.date, sourceUrl: a.source.url })), null, 2)
);

// Everything served as-is: stylesheet, icons, the scorecard's modules, games/.
await copyStatic(SITE);

console.log(`\nbuilt ${sorted.length} article(s) + index, flat-stack, scorecard, games, feeds, taxonomy`);
console.log(`deploy with: node pipeline/deploy.mjs`);
