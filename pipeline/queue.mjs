#!/usr/bin/env node
// The human gate. Review candidates, then claim one to write about.
//
//   node pipeline/queue.mjs              list the queue
//   node pipeline/queue.mjs 3            full brief for candidate 3
//   node pipeline/queue.mjs 3 --claim    write articles/<slug>.json and open the brief
//   node pipeline/queue.mjs --rejects    show what the gates threw away (tuning aid)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));

const config = await readJson("config.json");
const tax = await readJson("pipeline/taxonomy.json");

let queue;
try {
  queue = await readJson("data/queue.json");
} catch {
  console.error("FATAL: no data/queue.json. Run: node pipeline/harvest.mjs && node pipeline/score.mjs");
  process.exit(1);
}

const args = process.argv.slice(2);
const pick = args.find((a) => /^\d+$/.test(a));
const claim = args.includes("--claim");

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

// ------------------------------------------------------------------ list view
if (!pick) {
  console.log(`\n  ${config.site.name} -- candidate queue`);
  console.log(`  generated ${queue.generatedAt} from ${queue.from}\n`);
  queue.items.forEach((it, i) => {
    const money = it.money ? `  ${it.money.label}` : "";
    console.log(`  ${String(i + 1).padStart(2)}. [${String(it.score).padStart(3)}] ${it.categoryLabel}${money}`);
    console.log(`      ${it.title.slice(0, 92)}`);
    console.log(`      ${it.source}${it.ageDays !== null ? ` - ${it.ageDays}d old` : ""}${it.vendors?.length ? ` - ${it.vendors.slice(0, 3).join("/")}` : ""}`);
    console.log("");
  });
  console.log(`  node pipeline/queue.mjs <n>           full brief`);
  console.log(`  node pipeline/queue.mjs <n> --claim   start writing it\n`);
  process.exit(0);
}

// ----------------------------------------------------------------- brief view
const idx = Number(pick) - 1;
const it = queue.items[idx];
if (!it) {
  console.error(`no candidate ${pick} (queue has ${queue.items.length})`);
  process.exit(1);
}

const cat = tax.categories[it.category];
const line = "-".repeat(74);

console.log(`\n${line}`);
console.log(`  ${it.title}`);
console.log(line);
console.log(`  score      ${it.score}  (raw ${it.rawScore}, ${it.ageDays}d old)`);
console.log(`  category   ${it.categoryLabel} -- "${cat.thesis}"`);
console.log(`  source     ${it.source}${it.publisher ? ` / ${it.publisher}` : ""}`);
console.log(`  link       ${it.url}`);
if (it.discussionUrl) console.log(`  discussion ${it.discussionUrl}`);
if (it.money) console.log(`  figure     ${it.money.label}`);
if (it.vendors?.length) console.log(`  vendors    ${it.vendors.join(", ")}`);
console.log(`\n  WHY IT RANKED`);
for (const w of it.why) console.log(`    ${w}`);
console.log(`\n  THE FLAT-STACK ANGLE (${it.flatStackAngle})`);
console.log(`    ${it.flatStackRebuttal}`);
if (it.description) {
  console.log(`\n  EXCERPT`);
  console.log(`    ${it.description.slice(0, 400).replace(/\s+/g, " ")}`);
}
console.log(`\n${line}\n`);

if (!claim) {
  console.log(`  node pipeline/queue.mjs ${pick} --claim   to start writing this\n`);
  process.exit(0);
}

// --------------------------------------------------------------------- claim
const slug = slugify(it.title);
const stamp = new Date().toISOString().slice(0, 10);
const outPath = path.join(ROOT, "articles", `${stamp}-${slug}.json`);

const draft = {
  slug: `${stamp}-${slug}`,
  status: "draft",
  date: stamp,
  headline: "",
  dek: "",
  category: it.category,
  categoryLabel: it.categoryLabel,
  flatStackAngle: it.flatStackAngle,
  source: {
    title: it.title,
    url: it.url,
    publisher: it.publisher ?? it.source,
    discussionUrl: it.discussionUrl ?? null,
    publishedAt: it.publishedAt,
    excerpt: it.description?.slice(0, 500) ?? "",
    figure: it.money?.label ?? null,
  },
  sections: {
    whatHappened: "",
    theArchitectureUnderneath: "",
    whatItCost: "",
    theFlatStackVersion: "",
    theUncomfortablePart: "",
  },
  pullQuote: "",
  tags: [it.category.toLowerCase(), ...(it.vendors ?? []).slice(0, 3)],
  _brief: {
    thesis: cat.thesis,
    rebuttal: it.flatStackRebuttal,
    scoreWhy: it.why,
  },
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(draft, null, 2) + "\n");
console.log(`  claimed -> articles/${path.basename(outPath)}`);
console.log(`  fill in headline, dek and sections, set status:"published", then:`);
console.log(`    node pipeline/build.mjs\n`);
