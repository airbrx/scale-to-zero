#!/usr/bin/env node
// Ships site/ through the two-bucket model: local -> staging -> live.
//
//   node pipeline/deploy.mjs --dry-run    show what would happen
//   node pipeline/deploy.mjs              do it
//   node pipeline/deploy.mjs --stage-only  push to staging, do not publish
//
// Staging is the same bucket the admin Lambda edits, so a locally-built article
// and an admin-edited one go live by exactly the same path. Publishing is a
// server-side copy: bytes never round-trip through this machine twice.
//
// Uses the AWS CLI rather than the SDK so the repo keeps zero npm dependencies.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(ROOT, "config.json"), "utf8"));
const { bucket: LIVE, stagingBucket: STAGING, distributionId, region } = config.deploy;

const DRY = process.argv.includes("--dry-run");
const STAGE_ONLY = process.argv.includes("--stage-only");

const missing = Object.entries({ LIVE, STAGING, distributionId })
  .filter(([, v]) => !v || String(v).includes("REPLACE-ME"));
if (missing.length) {
  console.error("FATAL: deploy target is not configured. Run: node infra/provision.mjs");
  for (const [k, v] of missing) console.error(`  ${k} = ${JSON.stringify(v)}`);
  process.exit(1);
}

function run(cmd, args) {
  console.log(`  ${cmd} ${args.join(" ")}`);
  if (DRY) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}`))));
  });
}

const site = path.join(ROOT, "site");
console.log(`deploy${DRY ? " (dry run)" : ""}\n  local -> s3://${STAGING} -> s3://${LIVE}\n`);

// 1. Local build into staging.
//
//    Both of these use the same split: `s-maxage` long so CloudFront holds the
//    object roughly forever (step 3 invalidates it on every deploy), `max-age`
//    short because a browser cache is beyond our reach -- no invalidation, no
//    recall, nothing. The two directives are not redundant; they address two
//    caches with very different escape hatches.
//
//    assets/ previously carried `immutable, max-age=31536000`. That was wrong:
//    style.css and favicon.svg are NOT fingerprinted, so the bytes at those
//    URLs do change, and `immutable` told every returning reader to ignore that
//    fact for a year. Add a content hash to the filenames and it can come back.
const CACHE_CONTROL = "public,max-age=300,s-maxage=31536000";

await run("aws", ["s3", "sync", path.join(site, "assets"), `s3://${STAGING}/assets`,
  "--region", region, "--cache-control", CACHE_CONTROL, "--exclude", "*.js"]);

// JavaScript separately, with its type stated. The CLI guesses Content-Type
// from the local OS's MIME table, and on Windows that can say text/plain --
// which browsers refuse to run as an ES module, silently breaking the
// scorecard. The type is not left to the machine that happens to deploy.
await run("aws", ["s3", "sync", path.join(site, "assets"), `s3://${STAGING}/assets`,
  "--region", region, "--cache-control", CACHE_CONTROL,
  "--exclude", "*", "--include", "*.js", "--content-type", "text/javascript; charset=utf-8"]);

// --delete removes anything in staging that is not in the local build, so every
// admin-owned prefix MUST be excluded. Missing "_internal/*" here once deleted
// the entire article store the admin edits from -- the rendered site survived,
// but the source of truth behind it did not.
await run("aws", ["s3", "sync", site, `s3://${STAGING}`,
  "--region", region, "--delete",
  "--exclude", "assets/*",
  "--exclude", "admin/*",
  "--exclude", "admins.json",
  "--exclude", "_internal/*",
  "--exclude", "media/*",
  "--cache-control", CACHE_CONTROL]);

if (STAGE_ONLY) {
  console.log("\nstaged. Publish from the admin, or re-run without --stage-only.");
  process.exit(0);
}

// 2. Staging -> live. Server-side copy inside S3.
await run("aws", ["s3", "sync", `s3://${STAGING}`, `s3://${LIVE}`,
  "--region", region, "--delete",
  "--exclude", "admin/*",
  "--exclude", "admins.json",
  "--exclude", "_internal/*"]);

// 3. Invalidate. Wildcard is one path against the monthly free allowance,
//    where naming every changed file could be dozens.
await run("aws", ["cloudfront", "create-invalidation",
  "--distribution-id", distributionId, "--paths", "/*"]);

console.log(DRY ? "\ndry run complete, nothing changed." : `\nlive at ${config.site.baseUrl}`);
