#!/usr/bin/env node
// The browser scorecard, from a terminal. Same modules, same checks, same
// numbers -- only the transport differs: curl instead of the browser's fetch
// (per CLAUDE.md: curl, not fetch, on Windows).
//
//   node tools/scorecard.mjs github.com/owner/repo
//   node tools/scorecard.mjs gitlab.com/group/project --json > card.json
//   node tools/scorecard.mjs github.com/owner/repo --checks      # plus every check
//
// Exit code is 0 when the scorecard was produced, whatever the grade, and 1
// when it could not be. Gating a build on the grade is the caller's decision.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createHttp } from "../assets/scorecard/lib/http.js";
import { parseRepoUrl, openRepo } from "../assets/scorecard/lib/source.js";
import { scoreRepo, ruleGradeFor } from "../assets/scorecard/lib/engine.js";
import { narrate } from "../assets/scorecard/lib/narrate/index.js";

const execFileAsync = promisify(execFile);

/** A fetch-shaped function over curl, enough for lib/http.js. */
async function curlFetch(url, { headers = {} } = {}) {
  const headerFile = path.join(tmpdir(), `stz-sc-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  const args = ["-sS", "-L", "--ssl-no-revoke", "--compressed", "--max-time", "30",
    "-A", "scale-to-zero-scorecard/1 (+https://scale-to-zero.com/scorecard.html)",
    "-D", headerFile, "-w", "\n__HTTP_STATUS__%{http_code}"];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push(url);

  let stdout;
  try {
    ({ stdout } = await execFileAsync("curl", args, { maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    await rm(headerFile, { force: true });
    throw new Error(`curl exited ${err.code ?? "?"}: ${String(err.stderr || err.message).trim()}`);
  }
  const raw = await readFile(headerFile, "utf8");
  await rm(headerFile, { force: true });

  const marker = stdout.lastIndexOf("\n__HTTP_STATUS__");
  if (marker === -1) throw new Error(`no status marker in curl output for ${url}`);
  const status = Number(stdout.slice(marker + 16).trim());
  const body = stdout.slice(0, marker);

  // With -L there is one header block per hop; the last one is the answer.
  const blocks = raw.split(/\r?\n\r?\n/).filter((b) => b.trim());
  const h = new Headers();
  for (const line of (blocks.at(-1) ?? "").split(/\r?\n/).slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) h.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return new Response([204, 304].includes(status) ? null : body, { status, headers: h });
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const withChecks = args.includes("--checks");
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("usage: node tools/scorecard.mjs <github.com/owner/repo | gitlab.com/group/project> [--json] [--checks]");
  process.exit(1);
}
const target = parseRepoUrl(input);
if (!target) {
  console.error(`not a GitHub or GitLab repository address: ${input}`);
  process.exit(1);
}

const http = createHttp({ fetchImpl: curlFetch });
const log = (s) => { if (!asJson) console.error(`  ${s}`); };

let card;
try {
  const repo = await openRepo(target, http);
  log(`${repo.files.length} files at ${repo.meta.ref} via ${repo.meta.source}`);
  card = await scoreRepo(repo, { onProgress: log });
} catch (err) {
  console.error(`scorecard failed: ${err.message}`);
  process.exit(1);
}

const story = narrate(card);

if (asJson) {
  console.log(JSON.stringify({ ...card, narrative: story }, null, 2));
  process.exit(0);
}

const MARK = { pass: "PASS", warn: "WARN", fail: "FAIL", na: " n/a", error: " ERR" };
console.log(`\n${card.repo.fullName}${card.scope ? `/${card.scope}` : ""}  @ ${card.repo.ref}`);
console.log(`grade ${card.grade}  ${card.score}/100   (${card.filesRead} files read, ${http.stats.requests} requests)`);
for (const n of card.notices) console.log(`  ! ${n}`);
// The report card: ten rules, a letter each, and the one reason why.
console.log("\nREPORT CARD");
card.principles.forEach((p, i) => {
  const g = p.score === null ? "-" : ruleGradeFor(p.score);
  console.log(`  ${String(i + 1).padStart(2, "0")}  ${g}  ${p.name}\n         ${story.reasons[p.id]}`);
});
console.log(`  10  ${card.grade}  Thank you; have a nice day.\n         ${story.headline}`);
console.log(`\n${story.text}`);
if (!withChecks) process.exit(0);
for (const p of card.principles) {
  console.log(`\n${String(p.score ?? "--").padStart(3)}  ${p.name}`);
  for (const c of p.checks) {
    console.log(`     ${MARK[c.status]}  ${c.title}: ${c.summary}`);
    for (const e of c.evidence.slice(0, 3)) console.log(`             ${e.path}${e.line ? `:${e.line}` : ""}${e.note ? `  ${e.note}` : ""}`);
    if (c.evidence.length > 3) console.log(`             …and ${c.evidence.length - 3} more`);
  }
}
