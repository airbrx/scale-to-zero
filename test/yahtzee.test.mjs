// The site's page for Flat Yahtzee. The game itself is games/yahtzee/, with
// its own tests (node games/yahtzee/test.mjs); this checks only the page the
// Report wraps around it.
// Run: node test/yahtzee.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { renderSite } from "../shared/render.mjs";

const manifesto = JSON.parse(await readFile(new URL("../content/manifesto.json", import.meta.url), "utf8"));
const { files } = renderSite({
  site: { name: "N", shortName: "S", tagline: "T", description: "D", baseUrl: "https://x", locale: "en-US" },
  tax: { categories: {}, flatStackAngles: {} }, manifesto, articles: [],
});
const page = files["games/yahtzee.html"];
assert.equal(typeof page, "string", "game page rendered under /games/");
assert.ok(page.includes('<script type="module" src="/games/yahtzee/app.js">'), "loads the game module");
assert.ok(page.includes('<link rel="stylesheet" href="/games/yahtzee/yahtzee.css">'), "loads the game stylesheet");
assert.ok(page.includes('<div id="yahtzee"></div>'), "has the game's mount");
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>(?!\s*\{)/.test(page), "no inline script");
assert.ok(!/\sstyle="/.test(page), "no inline style attributes");

console.log("ok - yahtzee page");
