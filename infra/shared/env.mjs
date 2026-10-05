// The deployment's own values: bucket names, the CloudFront distribution, the
// admin Lambda, the Google client id. They live in .env at the repository root
// (gitignored; .env.example lists every one), named as the admin Lambda names
// its environment, and CI sets the same names. None is a secret, but they
// belong to one deployment, and the repository is public.
//
// Loading never overrides a value already in the environment, so CI's
// variables win over a stray .env. saveEnv() is for the provisioning scripts:
// they record what they discover (a distribution id, a function URL) in .env
// rather than asking anyone to copy it there.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_FILE = path.join(ROOT, ".env");

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

/** A value, or the fallback when it is unset or empty. */
export function env(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/** A value the script cannot run without: exits with what to do when it is missing. */
export function need(name, hint = "") {
  const v = env(name);
  if (v === undefined) {
    console.error(`FATAL: ${name} is not set. Put it in .env (see .env.example)${hint ? `, or run: ${hint}` : ""}.`);
    process.exit(1);
  }
  return v;
}

/** Record values in .env: replaces each name's line, appends new ones, removes a name set to null. */
export function saveEnv(values) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  for (const [name, value] of Object.entries(values)) {
    const at = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (value === null || value === undefined) {
      if (at >= 0) lines.splice(at, 1);
      delete process.env[name];
      continue;
    }
    const line = `${name}=${value}`;
    if (at >= 0) lines[at] = line;
    else lines.splice(lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, line);
    process.env[name] = String(value);
  }
  writeFileSync(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"));
  return ENV_FILE;
}
