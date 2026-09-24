#!/usr/bin/env node
// Build a deployable zip for the scale-to-zero admin Lambda.
//
//   node infra/build-lambda.mjs
//   node infra/build-lambda.mjs --fresh    force a clean npm install
//
// Replaces infra/build-lambda.sh. Same output, but bash and its heredocs are
// unreliable on the Windows box this is built from, and the .sh version failed
// there in ways that looked like a code bug rather than a shell bug.
//
// Produces ./infra/stz-admin.zip with:
//   - server.mjs, package.json (handler = server.handler, native Function URL)
//   - shared/render.mjs, so the Lambda renders byte-identical HTML to the local build
//   - admin/lib/
//   - production node_modules including the LINUX x64 sharp binary
//
// NOT admin/ui/. The admin UI is static objects in S3 now and the Lambda does
// not serve it; bundling it would ship a 1.3 MB vendored CKEditor into a
// function that never reads it.
//
// No credentials go in the bundle. The Lambda reads S3 through its execution
// role and takes bucket names and secrets from environment variables.

import { rm, mkdir, cp, readFile, writeFile, readdir, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "infra", "lambda-build");
const ZIP = path.join(ROOT, "infra", "stz-admin.zip");
const FRESH = process.argv.includes("--fresh");

const step = (n, s) => console.log(`\n[${n}] ${s}`);
const log = (s) => console.log(`    ${s}`);
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// npm install of sharp is slow and the result is platform-pinned, not
// source-dependent, so it is reused unless --fresh. Everything else in the
// build dir is replaced every time.
const haveModules = !FRESH && await exists(path.join(BUILD, "node_modules", "@img", "sharp-linux-x64"));

step(1, "Clean build dir");
if (haveModules) {
  for (const entry of await readdir(BUILD)) {
    if (entry !== "node_modules") await rm(path.join(BUILD, entry), { recursive: true, force: true });
  }
  log("kept node_modules (pass --fresh to reinstall)");
} else {
  await rm(BUILD, { recursive: true, force: true });
  log("full clean");
}
await rm(ZIP, { force: true });
await mkdir(path.join(BUILD, "lib"), { recursive: true });
await mkdir(path.join(BUILD, "shared"), { recursive: true });

step(2, "Copy runtime files");
await cp(path.join(ROOT, "admin", "server.mjs"), path.join(BUILD, "server.mjs"));
await cp(path.join(ROOT, "admin", "package.json"), path.join(BUILD, "package.json"));
for (const f of (await readdir(path.join(ROOT, "admin", "lib"))).filter((f) => f.endsWith(".mjs"))) {
  await cp(path.join(ROOT, "admin", "lib", f), path.join(BUILD, "lib", f));
}
// The API contract: server.mjs routes from it and validates against it.
await cp(path.join(ROOT, "admin", "openapi.json"), path.join(BUILD, "openapi.json"));
const SHARED = ["render.mjs", "schema.mjs"];
for (const f of SHARED) await cp(path.join(ROOT, "shared", f), path.join(BUILD, "shared", f));
log(`server.mjs, openapi.json, package.json, lib/*.mjs, shared/{${SHARED.join(",")}} (no ui/)`);

// server.mjs imports ../shared/*.mjs, which does not survive zipping: the
// zip root is BUILD and Lambda extracts to /var/task, so shared/ has to sit
// inside and the imports have to be rewritten to match.
step(3, "Rewrite the shared imports");
const serverPath = path.join(BUILD, "server.mjs");
let rewritten = await readFile(serverPath, "utf8");
for (const f of SHARED) {
  rewritten = rewritten.replace(`from "../shared/${f}"`, `from "./shared/${f}"`);
  if (!rewritten.includes(`from "./shared/${f}"`)) {
    throw new Error(`shared import rewrite failed for ${f} -- the Lambda would crash on cold start.`);
  }
  log(`../shared/${f} -> ./shared/${f}`);
}
await writeFile(serverPath, rewritten);

step(4, "Production install with the LINUX x64 sharp binary");
if (haveModules) {
  log("skipped, reusing the existing linux binary");
} else {
  // --os/--cpu/--libc force npm to fetch @img/sharp-linux-x64 even though this
  // build usually runs on Windows.
  await execFileAsync("npm", ["install", "--omit=dev", "--os=linux", "--cpu=x64",
    "--libc=glibc", "--no-audit", "--no-fund"],
    { cwd: BUILD, shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  log("installed");
}

if (!await exists(path.join(BUILD, "node_modules", "@img", "sharp-linux-x64"))) {
  throw new Error("@img/sharp-linux-x64 missing -- Lambda would crash on require('sharp').");
}
log("verified @img/sharp-linux-x64");

step(5, "Zip");
const { stdout } = await execFileAsync("python",
  [path.join(ROOT, "infra", "zip-lambda.py"), BUILD, ZIP],
  { shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
log(stdout.trim());

console.log(`\nDeploy with: node infra/deploy-lambda.mjs`);
