// Runs the language packs over a repo and turns their checks into a scorecard.
//
// A pack is { id, label, detect(repo), gather(repo), checks[] }. The common
// pack always runs; the others run when detect() finds their language. Each
// pack gathers its facts once, then its checks read those facts -- so a check
// is a small pure function, and adding one never adds a request.
//
// A check that throws is not dropped. It shows as "error" with its message and
// is left out of the score, and the headline says how many could not run.

import { PRINCIPLES } from "./principles.js";
import { VALUE } from "./result.js";
import { PACKS } from "./packs/index.js";

/** Bump when a check changes, so cached scorecards are not served stale. */
export const ENGINE_VERSION = 6;

export const GRADES = [[90, "A"], [80, "B"], [70, "C"], [60, "D"], [0, "F"]];
export const gradeFor = (score) => GRADES.find(([min]) => score >= min)[1];

// One rule's letter on the report card. A rule has one to five checks, so its
// score lands on a few coarse values, and the ten-point bands above would stamp
// an F on a rule whose only finding is a single warning (a score of 50). Here
// all-warn is a C, mixed pass and fail lands in B-D, and only rules that are
// mostly failing get an F. The overall grade keeps the bands above.
export const RULE_GRADES = [[90, "A"], [75, "B"], [50, "C"], [25, "D"], [0, "F"]];
export const ruleGradeFor = (score) => RULE_GRADES.find(([min]) => score >= min)[1];

/**
 * @param {import("./repo.js").Repo} repo
 * @param {{packs?: object[], onProgress?: (msg:string) => void}} [opts]
 */
export async function scoreRepo(repo, { packs = PACKS, onProgress = () => {} } = {}) {
  const active = packs.filter((p) => p.always || p.detect(repo));
  onProgress(`Detected: ${active.map((p) => p.label).join(", ")}`);

  const facts = {};
  const gatherErrors = {};
  await Promise.all(active.map(async (p) => {
    try {
      facts[p.id] = await p.gather(repo);
    } catch (err) {
      gatherErrors[p.id] = err.message;
    }
  }));

  // Files a pack wanted but could not read are named on the scorecard: a
  // check that passed because its evidence never arrived is not a pass.
  const unread = new Map();
  for (const f of Object.values(facts)) for (const u of f.unread ?? []) unread.set(u.path, u.error);
  if (unread.size) {
    const list = [...unread].slice(0, 5).map(([path, error]) => `${path} (${error})`).join("; ");
    repo.notices.push(`${unread.size} file${unread.size === 1 ? "" : "s"} could not be read and ${unread.size === 1 ? "was" : "were"} left out: ${list}${unread.size > 5 ? "; …" : ""}`);
  }

  const checks = [];
  for (const p of active) {
    for (const c of p.checks) {
      const base = { id: `${p.id}.${c.id}`, pack: p.id, principle: c.principle, title: c.title, weight: c.weight ?? 1, why: c.why };
      if (gatherErrors[p.id]) {
        checks.push({ ...base, status: "error", summary: `Could not read the files this check needs: ${gatherErrors[p.id]}`, evidence: [], data: {} });
        continue;
      }
      try {
        const r = await c.run(facts, repo);
        checks.push({ ...base, ...r, evidence: (r.evidence ?? []).map((e) => ({ ...e, url: repo.link(e.path, e.line) })) });
      } catch (err) {
        checks.push({ ...base, status: "error", summary: err.message, evidence: [], data: {} });
      }
    }
  }

  const principles = PRINCIPLES.map((pr) => {
    const own = checks.filter((c) => c.principle === pr.id);
    const scored = own.filter((c) => c.status in VALUE);
    const weight = scored.reduce((s, c) => s + c.weight, 0);
    const score = weight ? Math.round((100 * scored.reduce((s, c) => s + c.weight * VALUE[c.status], 0)) / weight) : null;
    return { ...pr, score, checks: own };
  });

  // Every principle counts the same. Weighting by number of checks would let
  // whichever principle is easiest to test dominate the grade.
  const graded = principles.filter((p) => p.score !== null);
  const score = graded.length ? Math.round(graded.reduce((s, p) => s + p.score, 0) / graded.length) : null;

  const counts = { pass: 0, warn: 0, fail: 0, na: 0, error: 0 };
  for (const c of checks) counts[c.status]++;

  return {
    engineVersion: ENGINE_VERSION,
    scannedAt: new Date().toISOString(),
    repo: repo.meta,
    scope: repo.scope,
    notices: repo.notices,
    packs: active.map((p) => ({ id: p.id, label: p.label })),
    footprint: footprint(repo, facts),
    principles,
    score,
    grade: score === null ? null : gradeFor(score),
    counts,
    filesRead: repo.reads,
    requests: repo.http?.stats?.requests ?? null,
  };
}

function footprint(repo, facts) {
  const own = repo.files.filter((f) => !/(^|\/)(node_modules|bower_components|vendor|third_party)\//.test(f.path));
  const byLang = {};
  for (const f of own) {
    const ext = /\.([a-z0-9]+)$/i.exec(f.path)?.[1]?.toLowerCase();
    const lang = LANGS[ext];
    if (lang) byLang[lang] = (byLang[lang] ?? 0) + 1;
  }
  return {
    files: repo.files.length,
    bytes: repo.sizesKnown ? repo.files.reduce((s, f) => s + (f.size ?? 0), 0) : null,
    languages: Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6),
    directDeps: facts.node ? facts.node.prodDeps.length : null,
    devDeps: facts.node ? facts.node.devDeps.length : null,
    installedPackages: facts.node?.lock?.count ?? null,
    alwaysOn: facts.common ? facts.common.alwaysOn.length : null,
    externalScripts: facts.web ? facts.web.externalOrigins.length : null,
  };
}

const LANGS = {
  html: "HTML", htm: "HTML", css: "CSS", scss: "CSS",
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  py: "Python", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", rb: "Ruby",
  php: "PHP", cs: "C#", swift: "Swift", c: "C", h: "C", cpp: "C++", cc: "C++",
  sh: "Shell", ps1: "PowerShell", tf: "Terraform", sql: "SQL", vue: "Vue", svelte: "Svelte",
};
