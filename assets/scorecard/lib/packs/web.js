// HTML and browser JavaScript: is the page already there when it arrives, and
// whose code does it pull in to get there?
//
// HTML is read with a handful of regular expressions rather than DOMParser so
// the pack runs identically in Node (tests, CLI) and the browser. It only needs
// tag attributes and visible text, not a tree.

import { prioritize, lineAt, TESTY } from "../repo.js";
import { pass, warn, fail, na, tiered, plural } from "../result.js";

const TRACKERS = [
  [/google-analytics\.com|googletagmanager\.com|gtag\/js/i, "Google Analytics / Tag Manager"],
  [/doubleclick\.net|googlesyndication\.com|adservice\.google/i, "Google ads"],
  [/connect\.facebook\.net|fbevents\.js/i, "Meta pixel"],
  [/static\.hotjar\.com|hotjar\.com/i, "Hotjar"],
  [/cdn\.segment\.(com|io)/i, "Segment"],
  [/mixpanel\.com|cdn\.mxpnl\.com/i, "Mixpanel"],
  [/clarity\.ms/i, "Microsoft Clarity"],
  [/js\.hs-scripts\.com|js\.hs-analytics\.net|hubspot/i, "HubSpot"],
  [/snap\.licdn\.com/i, "LinkedIn Insight"],
  [/analytics\.tiktok\.com/i, "TikTok pixel"],
  [/static\.cloudflareinsights\.com/i, "Cloudflare Web Analytics"],
  [/cdn\.heapanalytics\.com|heap-\d+\.js/i, "Heap"],
  [/fullstory\.com/i, "FullStory"],
];

const EXTERNAL = /^(https?:)?\/\//i;
const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(attrRe)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

/** Visible text length of a page body: scripts, styles, and markup removed. */
export function visibleText(html) {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePage(path, html) {
  const scripts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const a = parseAttrs(m[1]);
    scripts.push({ src: a.src ?? null, integrity: a.integrity ?? null, type: a.type ?? null, inline: a.src ? "" : m[2], line: lineAt(html, m.index) });
  }
  const styles = [];
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]);
    if (/\bstylesheet\b/i.test(a.rel ?? "") && a.href) styles.push({ href: a.href, integrity: a.integrity ?? null, line: lineAt(html, m.index) });
  }
  // ES modules imported straight from a CDN are third-party code too, and they
  // cannot carry an integrity attribute the way a <script src> can.
  const esmImports = [];
  for (const s of scripts) {
    for (const m of s.inline.matchAll(/(?:from|import)\s*\(?\s*["']((?:https?:)?\/\/[^"']+)["']/g)) {
      esmImports.push({ url: m[1], line: s.line });
    }
  }
  const text = visibleText(html);
  const templated = /\{\{[\s\S]*?\}\}|<%|\{%/.test(html);
  // A client-rendered app ships an empty mount point and fills it later. A
  // short page is not a shell; an empty #root is, even with no <script> in the
  // source, because bundlers (Create React App, Vite) inject it at build time.
  const emptyMount = /<(div|main|section)\b[^>]*\bid=["']?(root|app|__next|__nuxt|svelte|application|main)["']?[^>]*>\s*<\/\1>|<app-root\b[^>]*>\s*<\/app-root>/i.test(html);
  const hasScript = scripts.some((s) => s.src || s.inline.trim());
  const shell = emptyMount || (hasScript && text.length < 20);
  return { path, scripts, styles, esmImports, textLength: text.length, templated, shell };
}

const originOf = (u) => (/^(?:https?:)?\/\/([^/?#]+)/i.exec(u)?.[1] ?? u).toLowerCase();

async function gather(repo) {
  const htmlFiles = prioritize(
    repo.find(/\.html?$/i).filter((f) => !TESTY.test(f.path) && (f.size === null || f.size <= 400_000)),
    [/^index\.html?$/i, /^(public|src|docs|site|www|static|app)\/index\.html?$/i, /(^|\/)index\.html?$/i], 40);
  const { ok, failed } = await repo.readMany(htmlFiles.map((f) => f.path));
  const pages = ok.map(({ path, text }) => parsePage(path, text));

  // Local scripts the pages load, resolved against the page and the repo root.
  const localScripts = [];
  for (const p of pages) {
    const dir = p.path.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/") + 1) : "";
    for (const s of p.scripts) {
      if (!s.src || EXTERNAL.test(s.src) || /^data:/i.test(s.src)) continue;
      const clean = s.src.split(/[?#]/)[0];
      const candidates = clean.startsWith("/") ? [dir + clean.slice(1), clean.slice(1)] : [normalize(dir + clean)];
      const hit = candidates.map((c) => repo.byPath.get(c)).find(Boolean);
      localScripts.push({ page: p.path, src: s.src, line: s.line, file: hit ?? null });
    }
  }

  const external = [];
  for (const p of pages) {
    for (const s of p.scripts) if (s.src && EXTERNAL.test(s.src)) external.push({ kind: "script", page: p.path, url: s.src, line: s.line, integrity: s.integrity });
    for (const s of p.styles) if (EXTERNAL.test(s.href)) external.push({ kind: "style", page: p.path, url: s.href, line: s.line, integrity: s.integrity });
    for (const i of p.esmImports) external.push({ kind: "module", page: p.path, url: i.url, line: i.line, integrity: null });
  }
  const externalOrigins = [...new Set(external.filter((e) => e.kind !== "style").map((e) => originOf(e.url)))];

  const trackers = [];
  for (const p of pages) {
    for (const s of p.scripts) {
      const t = s.src ?? s.inline;
      for (const [re, name] of TRACKERS) if (t && re.test(t)) trackers.push({ path: p.path, line: s.line, note: name });
    }
  }

  return { pages, localScripts, external, externalOrigins, trackers, unread: failed };
}

function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

const checks = [
  {
    id: "prerendered", principle: "beast", weight: 2,
    title: "Pages arrive already rendered",
    why: "The fastest answer is the one already sitting there. A page that must run code and fetch data before it shows anything has woken something to answer.",
    run({ web: w }) {
      const judged = w.pages.filter((p) => !p.templated && (p.shell || p.textLength > 0 || p.scripts.length));
      if (!judged.length) return na("No standalone HTML pages to judge (only templates or fragments).");
      const shells = judged.filter((p) => p.shell);
      const ratio = (judged.length - shells.length) / judged.length;
      const data = { pages: judged.length, shells: shells.length, shellPaths: shells.map((p) => p.path) };
      const text = shells.length
        ? `${plural(shells.length, "page")} of ${judged.length} ${shells.length === 1 ? "is an empty shell" : "are empty shells"}: nothing to read until JavaScript downloads, runs, and fetches.`
        : `All ${plural(judged.length, "page")} carry their content in the HTML, readable before any script runs.`;
      const evidence = (shells.length ? shells : judged).slice(0, 10).map((p) => ({ path: p.path, note: `${p.textLength} characters of visible text` }));
      const make = ratio >= 0.8 ? pass : ratio >= 0.4 ? warn : fail;
      return make(text, evidence, data);
    },
  },
  {
    id: "script-weight", principle: "balance",
    title: "Light pages",
    why: "Every kilobyte shipped is paid for twice: once in bandwidth, once on the reader's battery.",
    run({ web: w }, repo) {
      if (!repo.sizesKnown) return na("File sizes are not available from this source.");
      const resolved = w.localScripts.filter((s) => s.file && /\.(m?js|cjs)$/.test(s.file.path));
      const needsBuild = w.localScripts.filter((s) => /\.(tsx?|jsx|vue|svelte)$/.test(s.src));
      if (!resolved.length) {
        return na(needsBuild.length
          ? "Pages load source that needs a build step first, so shipped size cannot be measured from the repo."
          : "No local scripts referenced by the pages.", { needsBuild: needsBuild.length > 0 });
      }
      const unique = [...new Map(resolved.map((s) => [s.file.path, s.file])).values()];
      const bytes = unique.reduce((s, f) => s + (f.size ?? 0), 0);
      const size = (b) => (b < 1024 ? `${b} bytes` : `${Math.round(b / 1024)} KB`);
      const evidence = unique.sort((a, b) => b.size - a.size).slice(0, 8).map((f) => ({ path: f.path, note: size(f.size) }));
      return tiered(bytes / 1024, 100, 500, `${size(bytes)} of local JavaScript referenced by the pages (uncompressed).`, evidence,
        { bytes, size: size(bytes), files: unique.length });
    },
  },
  {
    id: "third-party-scripts", principle: "dependency", weight: 2,
    title: "Little code from other people's servers",
    why: "A script from someone else's CDN is someone else's code, exploits, and outages running on your page.",
    run({ web: w }) {
      const data = { origins: w.externalOrigins };
      const ev = w.external.filter((e) => e.kind !== "style").map((e) => ({ path: e.page, line: e.line, note: e.url }));
      if (!w.externalOrigins.length) return pass("Every script is served from the site itself.", [], data);
      return tiered(w.externalOrigins.length, 0, 2, `Scripts load from ${plural(w.externalOrigins.length, "outside origin")}: ${w.externalOrigins.join(", ")}.`, ev, data);
    },
  },
  {
    id: "integrity", principle: "foundation",
    title: "Outside code is pinned and encrypted",
    why: "Without an integrity hash, whoever controls the CDN controls your page. Over plain http, so does anyone on the network.",
    run({ web: w }) {
      if (!w.external.length) return na("Nothing loaded from other origins.");
      const plain = w.external.filter((e) => /^http:/i.test(e.url));
      const unpinned = w.external.filter((e) => e.kind !== "module" && !e.integrity);
      const modules = w.external.filter((e) => e.kind === "module");
      const data = { external: w.external.length, plain: plain.length, unpinned: unpinned.length, modules: modules.length };
      const ev = (list) => list.map((e) => ({ path: e.page, line: e.line, note: e.url }));
      if (plain.length) return fail(`${plural(plain.length, "resource")} loaded over plain http.`, ev(plain), data);
      if (unpinned.length) return fail(`${plural(unpinned.length, "external script or stylesheet", "external scripts and stylesheets")} without an integrity hash.`, ev(unpinned), data);
      if (modules.length) return warn(`${plural(modules.length, "ES module")} imported from a CDN, which cannot carry an integrity hash.`, ev(modules), data);
      return pass(`All ${plural(w.external.length, "external resource")} carry an integrity hash.`, [], data);
    },
  },
  {
    id: "trackers", principle: "foundation",
    title: "No third-party trackers",
    why: "Every tracker is a vendor with a script on your page and a copy of your readers.",
    run({ web: w }) {
      const names = [...new Set(w.trackers.map((t) => t.note))];
      const data = { names };
      if (!names.length) return pass("No known analytics or ad trackers on the pages scanned.", [], data);
      return tiered(names.length, 0, 1, `${plural(names.length, "tracker")}: ${names.join(", ")}.`, w.trackers, data);
    },
  },
];

export const web = {
  id: "web",
  label: "HTML / browser JS",
  detect: (repo) => repo.find(/\.html?$/i).some((f) => !TESTY.test(f.path)),
  gather,
  checks,
};
