// The admin on this machine: `npm run dev` in admin/.
//
// One server on http://localhost:8080 (PORT to change it): the editor at
// /admin/, the API at /api/, the pages the admin renders (read back from the
// staging bucket), and /films/ from the local build. Same router and auth as
// the Lambda, against the real buckets named in the repo's .env, with your
// AWS CLI credentials. There is no offline mode: saving writes staging.
//
// SESSION_SECRET comes from the environment if set; otherwise one is made for
// this run, so a sign-in lasts until the server stops.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (!existsSync(envFile)) {
  console.error("FATAL: no .env at the repository root. Copy .env.example to .env and fill it in (docs/ADMIN.md).");
  process.exit(1);
}
process.loadEnvFile(envFile);
process.env.STZ_LOCAL = "1";
process.env.SESSION_SECRET ||= randomBytes(32).toString("hex");

await import("./server.mjs");
