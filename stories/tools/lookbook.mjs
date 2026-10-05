// lookbook.mjs - the same frames under each brand/fold.js LOOK treatment,
// side by side, light and dark, to choose a look by eye.
//
//   node stories/tools/lookbook.mjs
//
// Writes stories/tools/out/lookbook-light.png and lookbook-dark.png. Needs
// `npm install` in stories/tools (the canvas) and the fonts check.mjs fetched.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

globalThis.addEventListener = () => {};
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "..");
const imp = (p) => import(pathToFileURL(p).href);

for (const f of await readdir(path.join(here, "fonts"))) {
  const family = f.split("-")[0];
  if (!GlobalFonts.registerFromPath(path.join(here, "fonts", f), family)) throw new Error(`lookbook: could not register ${f}`);
}
const sketch = await imp(path.join(root, "lib", "sketch.js"));
const { parseScript, schedule } = await imp(path.join(root, "lib", "timeline.js"));
const { LOOK, HOUSE_LOOK } = await imp(path.join(root, "brand", "fold.js"));
LOOK.canvas = (w, h) => createCanvas(w, h);

const TOKENS = { bg: "--stage", card: "--stage-card", panel: "--stage-panel", ink: "--stage-ink", text: "--stage-text", grid: "--stage-grid", line: "--stage-line", muted: "--muted", accent: "--accent", accent2: "--accent-2", accentText: "--accent-text", glow: "--glow", ok: "--ok", stop: "--stop", water: "--water", coin: "--coin", oai: "--oai" };
async function palette(dark) {
  const vars = {};
  for (const f of [path.join(root, "lib", "tokens.css"), path.join(root, "brand", "tokens.css")]) {
    const css = (await readFile(f, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const s = sel.trim();
      if (s !== ":root" && !(dark && s === "html.dark")) continue;
      for (const [, k, v] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[k] = v.trim();
    }
  }
  const P = {}; for (const k in TOKENS) P[k] = vars[TOKENS[k]] ?? ""; P.dark = dark; return P;
}
async function film(slug) {
  const { BEATS, makeStory } = await imp(path.join(root, slug, "story.js"));
  const T = schedule(parseScript(await readFile(path.join(root, slug, "script.md"), "utf8")), BEATS, 150);
  return { T, story: makeStory(T) };
}
const scanner = await film("every-scanner"), how = await film("how-we-make-these");
const FRAMES = [
  ["the street, at the shop door", scanner, scanner.T.at("wpadmin") + 1],
  ["the burst: the shop scaling", scanner, scanner.T.at("eight") + 3.4],
  ["the cold open: rules on an app", how, 4.2],
];
const VARIANTS = [
  ["plain", {}],
  ["1 halftone", { halftone: 1, halftoneOn: "all" }],
  ["2 light & glow", { light: 1, glow: 1 }],
  ["3 heat", { heat: 1, glow: .5 }],
  ["all three, halftone everywhere", { halftone: .8, halftoneOn: "all", light: 1, glow: 1, heat: 1 }],
  ["the house look", HOUSE_LOOK],
];

const TW = 512, TH = 288, HEAD = 34, ROWL = 26;
await mkdir(path.join(here, "out"), { recursive: true });
for (const dark of [false, true]) {
  const P = await palette(dark);
  const sheet = createCanvas(TW * VARIANTS.length, HEAD + FRAMES.length * (TH + ROWL)), sg = sheet.getContext("2d");
  sg.fillStyle = dark ? "#0d0e11" : "#dad7d0"; sg.fillRect(0, 0, sheet.width, sheet.height);
  sg.fillStyle = dark ? "#eee" : "#111"; sg.font = "700 17px Inter";
  VARIANTS.forEach(([name], i) => sg.fillText(name, i * TW + 10, 23));
  const frame = createCanvas(1280, 720), g = frame.getContext("2d");
  FRAMES.forEach(([label, f, t], r) => {
    VARIANTS.forEach(([, look], c) => {
      Object.assign(LOOK, { halftone: 0, halftoneOn: 'page', light: 0, glow: 0, heat: 0 }, look);
      sketch.S.boil = Math.floor(t * 8); sketch.S.rough = 1; sketch.S.lw = 1; sketch.S.ts = 1;
      g.setTransform(1, 0, 0, 1, 0, 0);
      f.story.draw(g, t, P);
      sg.drawImage(frame, c * TW, HEAD + r * (TH + ROWL) + ROWL, TW, TH);
    });
    sg.fillStyle = dark ? "#bbb" : "#333"; sg.font = "600 14px Inter";
    sg.fillText(label, 10, HEAD + r * (TH + ROWL) + 18);
  });
  const out = path.join(here, "out", `lookbook-${dark ? "dark" : "light"}.png`);
  await writeFile(out, await sheet.encode("png"));
  console.log(`lookbook: ${out}`);
}
Object.assign(LOOK, { halftone: 0, light: 0, glow: 0, heat: 0 });
