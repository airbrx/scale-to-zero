#!/usr/bin/env node
// The site's static files: everything served as-is from the repository, as
// opposed to the pages, which shared/render.mjs renders from the articles.
//
//   node pipeline/static.mjs [--out <dir>]     default: site/
//
// pipeline/build.mjs calls this after rendering. CI runs it alone
// (.github/workflows/site.yml) and syncs assets/ and games/<name>/ to the
// staging bucket, where the admin's publish takes them live. It needs no
// articles and no config, so CI can run it from a bare checkout.

import { mkdir, copyFile, rm, cp, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function copyStatic(out) {
  await mkdir(path.join(out, "assets"), { recursive: true });
  await copyFile(path.join(ROOT, "assets", "style.css"), path.join(out, "assets", "style.css"));
  await copyFile(path.join(ROOT, "assets", "favicon.svg"), path.join(out, "assets", "favicon.svg"));
  // The scorecard page's link-preview image (og:image / twitter:image).
  await copyFile(path.join(ROOT, "assets", "scorecard-social.png"), path.join(out, "assets", "scorecard-social.png"));
  // Browsers request /favicon.ico regardless of the <link>, and an S3 origin
  // behind OAC answers a miss with 403, not 404 -- which shows up as a scary red
  // console line on every page load. Serving the same SVG at that path silences it.
  await copyFile(path.join(ROOT, "assets", "favicon.svg"), path.join(out, "favicon.ico"));

  // The scorecard's modules, as-is: no bundler, the browser loads them as ES
  // modules. Replaced wholesale so a deleted module does not linger.
  await rm(path.join(out, "assets", "scorecard"), { recursive: true, force: true });
  await cp(path.join(ROOT, "assets", "scorecard"), path.join(out, "assets", "scorecard"), {
    recursive: true,
    // memory.js is the tests' fixture provider; the page never imports it.
    filter: (src) => !path.extname(src) || (src.endsWith(".js") && path.basename(src) !== "memory.js"),
  });

  // Each game is a self-contained folder, games/<name>/, served at the same
  // path. Only what the browser loads goes: the folder's standalone page, its
  // stylesheet, README and tests stay in the repository (the site has its own
  // page for the game, rendered as games/<name>.html). Vendored code travels
  // with its licence.
  const games = (await readdir(path.join(ROOT, "games"), { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const { name } of games) {
    const dest = path.join(out, "games", name);
    await rm(dest, { recursive: true, force: true });
    await cp(path.join(ROOT, "games", name), dest, {
      recursive: true,
      filter: (src) => !path.extname(src)
        || ([".js", ".css", ".txt"].includes(path.extname(src)) && path.basename(src) !== "standalone.css"),
    });
  }
  return games.map((d) => d.name);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(ROOT, "site"));
  const games = await copyStatic(out);
  console.log(`static files to ${out}: assets, favicon.ico, games/${games.join(", games/")}`);
}
