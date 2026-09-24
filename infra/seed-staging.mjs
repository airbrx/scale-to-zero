#!/usr/bin/env node
// Seeds the staging bucket with everything the admin Lambda needs to start:
//
//   admins.json                 the first owner  <- bootstrap, chicken-and-egg
//   _internal/config.json       site identity
//   _internal/taxonomy.json     categories + flat-stack angles
//   _internal/manifesto.json    the flat-stack page content
//   _internal/articles/*.json   articles already in the repo
//   _internal/articles/index.json
//
//   node infra/seed-staging.mjs --owner you@example.com
//   node infra/seed-staging.mjs --owner you@example.com --force   overwrite admins.json
//
// The bootstrap problem is real: the Lambda refuses every request when the admin
// list is missing, and only an owner can write the list through the API. So the
// very first owner has to be placed here, with AWS credentials, out of band.
// After that the list is managed in the admin UI.
//
// admins.json goes ONLY in the staging bucket. Publishing skips it, and staging
// is never fronted by CloudFront, so the address list is not world-readable.

import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { writeFile, mkdtemp } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));

const config = await readJson("config.json");
const STAGING = config.deploy.stagingBucket;
const REGION = config.deploy.region;

const argv = process.argv.slice(2);
const owner = argv.includes("--owner") ? argv[argv.indexOf("--owner") + 1] : null;
const force = argv.includes("--force");

if (!STAGING || STAGING.includes("REPLACE-ME")) {
  console.error("FATAL: no staging bucket in config.json. Run: node infra/provision.mjs");
  process.exit(1);
}
if (!owner || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) {
  console.error("FATAL: --owner <email> is required and must be a real address.\n" +
    "  It must be the Google account you will sign in with.");
  process.exit(1);
}

const tmp = await mkdtemp(path.join(os.tmpdir(), "stz-seed-"));

async function put(key, obj) {
  const local = path.join(tmp, key.replace(/\//g, "_"));
  await writeFile(local, JSON.stringify(obj, null, 2));
  await execFileAsync("aws", ["s3", "cp", local, `s3://${STAGING}/${key}`,
    "--region", REGION, "--content-type", "application/json"], { maxBuffer: 8e6 });
  console.log(`  put ${key}`);
}

async function exists(key) {
  try {
    await execFileAsync("aws", ["s3api", "head-object", "--bucket", STAGING, "--key", key, "--region", REGION]);
    return true;
  } catch {
    return false;
  }
}

console.log(`seeding s3://${STAGING}\n`);

// --- admins.json (never clobbered without --force: overwriting it silently
// --- would demote every admin added through the UI back to this one address)
if (await exists("admins.json") && !force) {
  console.log("  skip admins.json (already exists -- pass --force to replace)");
} else {
  await put("admins.json", {
    admins: [{ email: owner.toLowerCase(), role: "owner", name: config.site.author, added: new Date().toISOString() }],
    seededAt: new Date().toISOString(),
  });
}

// --- config the renderer needs
await put("_internal/config.json", { site: config.site });
await put("_internal/taxonomy.json", await readJson("pipeline/taxonomy.json"));
await put("_internal/manifesto.json", await readJson("content/manifesto.json"));

// --- articles already in the repo
const files = (await readdir(path.join(ROOT, "articles"))).filter((f) => f.endsWith(".json"));
const slugs = [];
for (const f of files) {
  const a = await readJson(path.join("articles", f));
  await put(`_internal/articles/${a.slug}.json`, a);
  slugs.push(a.slug);
}
await put("_internal/articles/index.json", slugs);

console.log(`\nseeded ${slugs.length} article(s). First owner: ${owner}`);
console.log("Sign in at https://" + config.site.domain + "/admin/");
