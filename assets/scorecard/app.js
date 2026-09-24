// The scorecard page. Everything above this file is plain modules that also
// run in Node; this is the only part that touches the DOM.
//
// Every string shown here that came from a repository -- descriptions, paths,
// file contents -- goes in through textContent, never innerHTML. The repo being
// scored is untrusted input, and a scorecard that could be made to run someone
// else's script would fail its own foundation check.

import { createHttp } from "./lib/http.js";
import { parseRepoUrl, targetLabel, openRepo } from "./lib/source.js";
import { scoreRepo, ENGINE_VERSION, ruleGradeFor } from "./lib/engine.js";
import * as cache from "./lib/cache.js";
import { narrate } from "./lib/narrate/index.js";

const $ = (id) => document.getElementById(id);
const form = $("sc-form");
const input = $("sc-repo");
const button = form.querySelector("button");
const statusEl = $("sc-status");
const resultEl = $("sc-result");
const recentEl = $("sc-recent");

const STATUS_LABEL = { pass: "Pass", warn: "Warn", fail: "Fail", na: "N/A", error: "Error" };
const EVIDENCE_SHOWN = 25;

/** Tiny element builder. Strings become text nodes, never markup. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const extLink = (href, ...kids) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, ...kids);
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// ------------------------------------------------------------------ status
const log = {
  start() {
    statusEl.hidden = false;
    statusEl.className = "sc-status";
    statusEl.replaceChildren(h("ol", { class: "sc-log" }));
  },
  line(text) {
    const li = h("li", {}, text);
    statusEl.querySelector("ol").append(li);
    return li;
  },
  error(err) {
    statusEl.hidden = false;
    statusEl.className = "sc-status sc-status-error";
    statusEl.append(h("p", { class: "sc-error" }, h("strong", {}, "Could not score this repository. "), err.message));
  },
  done() {
    statusEl.hidden = true;
  },
};

// ------------------------------------------------------------------- run
let running = false;

async function run(target, { force = false } = {}) {
  if (running) return;
  running = true;
  button.disabled = true;
  const label = targetLabel(target);
  resultEl.hidden = true;
  log.start();

  try {
    const http = createHttp();
    log.line(`Opening ${label}`);
    const repo = await openRepo(target, http);
    const where = repo.scope ? ` in ${repo.scope}/` : "";
    log.line(`${repo.files.length.toLocaleString()} files on ${repo.meta.ref}${where}, via ${repo.meta.source}`);

    const key = cache.cacheKey({ engineVersion: ENGINE_VERSION, repo: repo.meta, scope: repo.scope });
    if (!force) {
      const hit = cache.load(key);
      if (hit.ok && hit.card) {
        log.done();
        render(hit.card, { label, cached: true });
        return;
      }
      if (!hit.ok) log.line(`Local cache unavailable (${hit.error}); scanning fresh.`);
    }

    const reading = log.line("Reading files…");
    repo.onRead = (_, n) => { reading.textContent = `Read ${n} file${n === 1 ? "" : "s"}…`; };
    const card = await scoreRepo(repo, { onProgress: (msg) => log.line(msg) });

    const saved = cache.save(card, label);
    log.done();
    render(card, { label, cached: false, cacheError: saved.ok ? null : saved.error });
    showRecent();
  } catch (err) {
    log.error(err);
    console.error(err);
  } finally {
    running = false;
    button.disabled = false;
  }
}

// ---------------------------------------------------------------- render
function render(card, { label, cached, cacheError = null }) {
  const r = card.repo;
  const gradeClass = card.grade ? `sc-grade sc-grade-${card.grade.toLowerCase()}` : "sc-grade";

  const header = h("header", { class: "sc-head" },
    h("div", { class: gradeClass, "aria-label": `Grade ${card.grade ?? "none"}` }, card.grade ?? "–"),
    h("div", { class: "sc-head-text" },
      h("p", { class: "sc-kicker" }, "Flat-stack scorecard"),
      h("h2", { class: "sc-repo" }, extLink(r.webUrl, r.fullName + (card.scope ? `/${card.scope}` : ""))),
      r.description ? h("p", { class: "sc-desc" }, r.description) : null,
      h("p", { class: "sc-meta" },
        `${card.score ?? "–"}/100 · ${r.ref} @ ${String(r.sha).slice(0, 10)} · ${card.packs.map((p) => p.label).join(", ")}`,
        h("br"),
        `${cached ? "Cached from" : "Scanned"} ${fmtWhen(card.scannedAt)} via ${r.source} · ${card.filesRead} files read`),
      h("p", { class: "sc-actions" },
        h("button", { type: "button", class: "sc-btn", onclick: (e) => copyLink(e.currentTarget) }, "Copy link"),
        h("button", { type: "button", class: "sc-btn", onclick: () => download(card) }, "Download JSON"),
        cached ? h("button", { type: "button", class: "sc-btn", onclick: () => run(parseRepoUrl(label), { force: true }) }, "Rescan") : null)));

  const notices = [...card.notices];
  if (cacheError) notices.push(`This result was not saved locally: ${cacheError}`);
  const noticeEl = notices.length ? h("ul", { class: "sc-notices" }, notices.map((n) => h("li", {}, n))) : null;

  const counts = card.counts;
  const tally = h("p", { class: "sc-tally" },
    ["pass", "warn", "fail", "na", "error"].filter((s) => counts[s]).map((s) =>
      h("span", { class: `sc-chip sc-chip-${s}` }, `${counts[s]} ${STATUS_LABEL[s]}`)));

  // The narrative is written at render time, from the card, so cached cards
  // get it too and a phrasebook change needs no rescan. If it fails, say so:
  // the checklist below is still the whole truth.
  let story = null;
  let storyEl;
  try {
    story = narrate(card);
    storyEl = storyBlock(story);
  } catch (err) {
    console.error(err);
    storyEl = h("p", { class: "sc-error" }, `Could not write the plain-English summary: ${err.message}`);
  }

  // replaceChildren would render a null as the text "null"; drop absent parts.
  resultEl.replaceChildren(...[header, reportCard(card, story), noticeEl, storyEl, tally, footprint(card.footprint),
    h("ol", { class: "sc-principles" }, card.principles.map((p, i) => principle(p, i, story)))].filter(Boolean));
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function footprint(f) {
  const rows = [
    ["Files", f.files.toLocaleString()],
    f.bytes !== null && ["Size", fmtBytes(f.bytes)],
    f.languages.length && ["Languages", f.languages.map(([l, n]) => `${l} ${n}`).join(", ")],
    f.directDeps !== null && ["Runtime deps", `${f.directDeps} (+${f.devDeps} dev)`],
    f.installedPackages !== null && ["Installed packages", f.installedPackages.toLocaleString()],
    f.alwaysOn !== null && ["Always-on resources", f.alwaysOn],
    f.externalScripts !== null && ["Script origins", f.externalScripts],
  ].filter(Boolean);
  return h("dl", { class: "sc-footprint" }, rows.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, String(v)))));
}

/**
 * The report card: ten rows, one per manifesto rule, each a link down to that
 * rule's detail. Rule 10 is the manifesto's sign-off rather than something to
 * measure, so its row carries the overall grade and the headline, and links
 * to the plain-English summary.
 */
function reportCard(card, story) {
  const rows = card.principles.map((p, i) => ({
    n: i + 1,
    rule: p.name,
    grade: p.score === null ? null : ruleGradeFor(p.score),
    score: p.score,
    why: story?.reasons[p.id] ?? p.short,
    href: `#rule-${i + 1}`,
  }));
  rows.push({
    n: 10, rule: "Thank you; have a nice day.", grade: card.grade, score: card.score,
    why: story?.headline ?? "Overall grade across the nine rules above.", href: "#rule-10", overall: true,
  });

  const stamp = (r) => h("span", {
    class: `sc-stamp sc-stamp-${(r.grade ?? "na").toLowerCase()}`,
    "aria-label": r.grade ? `Grade ${r.grade}, ${r.score} out of 100` : "Not graded",
    title: r.grade ? `${r.score}/100` : "Nothing measured applies",
  }, r.grade ?? "–");

  return h("section", { class: "sc-report", "aria-label": "Report card" },
    h("header", { class: "sc-report-head" },
      h("p", { class: "sc-report-title" }, "Report card"),
      h("p", { class: "sc-report-sub" },
        card.repo.fullName + (card.scope ? `/${card.scope}` : ""), h("span", {}, ` · ${fmtWhen(card.scannedAt)}`))),
    h("ol", { class: "sc-report-rows" }, rows.map((r) =>
      h("li", { class: r.overall ? "sc-report-row sc-report-overall" : "sc-report-row" },
        h("a", { class: "sc-report-link", href: r.href },
          h("span", { class: "sc-report-num" }, String(r.n).padStart(2, "0")),
          h("span", { class: "sc-report-text" },
            h("span", { class: "sc-report-rule" }, r.rule),
            h("span", { class: "sc-report-why" }, r.why)),
          stamp(r))))));
}

function storyBlock(story) {
  const chip = (pat) => h("span", { class: "sc-pattern" },
    pat.name, h("span", { class: "sc-pattern-rules" }, ` rules ${pat.rules.join(", ")}`));
  const patterns = [story.pattern, ...story.alsoNoticed].filter(Boolean);
  return h("section", { class: "sc-story", id: "rule-10", "aria-label": "In plain English" },
    h("p", { class: "sc-kicker" }, "In plain English"),
    h("h3", { class: "sc-story-headline" }, story.headline),
    patterns.length ? h("p", { class: "sc-patterns" }, patterns.map(chip)) : null,
    story.paragraphs.map((t) => h("p", {}, t)),
    story.fixes.length ? [
      h("p", { class: "sc-story-label" }, "Start here"),
      h("ol", { class: "sc-fixes" }, story.fixes.map((f) =>
        h("li", {}, f.text, h("span", { class: "sc-fix-rule" }, ` rule ${f.rule}`)))),
    ] : null,
    h("p", { class: "sc-signoff" }, story.signoff));
}

function principle(p, i, story) {
  const bar = h("span", { class: "sc-bar-fill" });
  if (p.score !== null) bar.style.setProperty("--pct", p.score);
  return h("li", { class: "sc-principle", id: `rule-${i + 1}` },
    h("div", { class: "sc-principle-head" },
      h("span", { class: "principle-num" }, String(i + 1).padStart(2, "0")),
      h("div", { class: "sc-principle-title" },
        h("h3", {}, p.name),
        h("p", { class: "sc-principle-short" }, p.short),
        story?.byPrinciple[p.id] ? h("p", { class: "sc-principle-story" }, story.byPrinciple[p.id]) : null),
      h("div", { class: "sc-principle-score" },
        p.score === null ? h("span", { class: "sc-na" }, "Not measured") : `${p.score}`,
        p.score === null ? null : h("span", { class: "sc-bar" }, bar))),
    p.checks.length
      ? h("ul", { class: "sc-checks" }, p.checks.map(check))
      : h("p", { class: "sc-none" }, "No check for this principle applies to the languages found."));
}

function check(c) {
  const shown = c.evidence.slice(0, EVIDENCE_SHOWN);
  const more = c.evidence.length - shown.length;
  return h("li", { class: `sc-check sc-check-${c.status}` },
    h("span", { class: `sc-chip sc-chip-${c.status}` }, STATUS_LABEL[c.status]),
    h("div", { class: "sc-check-body" },
      h("p", { class: "sc-check-title" }, c.title),
      h("p", { class: "sc-check-summary" }, c.summary),
      (c.why || shown.length) ? h("details", {},
        h("summary", {}, shown.length ? `Why, and ${c.evidence.length} piece${c.evidence.length === 1 ? "" : "s"} of evidence` : "Why this matters"),
        c.why ? h("p", { class: "sc-why" }, c.why) : null,
        shown.length ? h("ul", { class: "sc-evidence" }, shown.map((e) =>
          h("li", {}, extLink(e.url, e.path + (e.line ? `:${e.line}` : "")), e.note ? ` — ${e.note}` : ""))) : null,
        more > 0 ? h("p", { class: "sc-none" }, `…and ${more} more.`) : null) : null));
}

// --------------------------------------------------------------- actions
async function copyLink(btn) {
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = "Copied";
  } catch (err) {
    btn.textContent = `Copy failed: ${err.message}`;
  }
}

function download(card) {
  const blob = new Blob([JSON.stringify({ ...card, narrative: narrate(card) }, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `scorecard-${card.repo.fullName.replace(/\W+/g, "-")}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function showRecent() {
  const res = cache.listRecent();
  if (!res.ok) {
    recentEl.hidden = false;
    recentEl.replaceChildren(h("p", { class: "sc-none" }, `Recent scans are unavailable: ${res.error}`));
    return;
  }
  if (!res.recent.length) { recentEl.hidden = true; return; }
  recentEl.hidden = false;
  recentEl.replaceChildren(
    h("h2", {}, "Scanned in this browser"),
    h("ul", { class: "sc-recent-list" }, res.recent.map((r) => h("li", {},
      h("span", { class: `sc-mini-grade sc-grade-${String(r.grade).toLowerCase()}` }, r.grade ?? "–"),
      h("a", { href: `?repo=${encodeURIComponent(r.label)}`, onclick: (e) => openCached(e, r) }, r.label),
      h("span", { class: "sc-recent-when" }, fmtWhen(r.at))))));
}

function openCached(e, r) {
  const hit = cache.load(r.key);
  if (!hit.ok || !hit.card) return; // let the link navigate and rescan
  e.preventDefault();
  history.replaceState(null, "", `?repo=${encodeURIComponent(r.label)}`);
  input.value = r.label;
  statusEl.hidden = true;
  render(hit.card, { label: r.label, cached: true });
}

// ------------------------------------------------------------------ boot
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const target = parseRepoUrl(input.value);
  if (!target) {
    log.start();
    log.error(new Error(`"${input.value.trim()}" is not a GitHub or GitLab repository address. Try github.com/owner/repo.`));
    return;
  }
  history.replaceState(null, "", `?repo=${encodeURIComponent(targetLabel(target))}`);
  run(target);
});

showRecent();
const initial = new URLSearchParams(location.search).get("repo");
if (initial) {
  input.value = initial;
  form.requestSubmit();
}
