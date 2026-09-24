// Explains a scorecard in plain English.
//
// This is a template-based natural-language generator in the classic
// data-to-text pipeline (Reiter & Dale, "Building Natural Language Generation
// Systems"), the same shape behind automated weather and sports reports:
//
//   1. content selection   which checks and combination patterns are worth saying
//   2. document planning   headline, verdict, strengths, problems, fixes, sign-off
//   3. microplanning       aggregate clauses that share a subject into one
//                          sentence; choose referring expressions ("ky", "it")
//   4. realization         grammar.js turns each template into agreed English
//
// No language model runs here, on purpose. It is deterministic (seeded by the
// repo's content hash), auditable (every sentence traces to a check and its
// data), costs nothing to run, and works offline in the browser -- the
// flat-stack answer to "explain this score". Its output is also structured,
// so a model could be pointed at it later if richer prose is ever worth the
// running computer.

import { PRINCIPLES } from "../principles.js";
import { expand, seeded, hash, pick, clauseList, sentence as sentenceOf, capitalize } from "./grammar.js";
import { RULES, MAPS, TOPICS, PROBLEM_LEADS, SIGNOFFS, GRADE_HEADLINES, GRADE_LINES } from "./lexicon.js";
import { PHRASES } from "./phrasebook.js";
import { PATTERNS } from "./patterns.js";

const RULE_NUMBER = Object.fromEntries(PRINCIPLES.map((p, i) => [p.id, i + 1]));
const SEVERITY = { fail: 3, warn: 1 };
// A leaked key outranks every other fix; a server that never sleeps is the
// most expensive thing the scorecard can find.
const URGENCY = { "common.secrets": 10, "common.secret-files": 10, "node.entry-points": 1.5, "common.always-on": 1.5 };

/**
 * @param {object} card  a scorecard from engine.js
 * @param {{seed?: number}} [opts]  override the seed (tests use this to fuzz)
 */
export function narrate(card, { seed } = {}) {
  const rand = seeded(seed ?? hash(`${card.repo.fullName}/${card.scope ?? ""}@${card.repo.sha}`));
  const env = { rand, rules: RULES, maps: MAPS };
  const name = displayName(card);
  const say = (template, data = {}) => expand(template, { name, ...data }, env);
  const sentence = (s) => sentenceOf(s, name);
  const choose = (entry, data) => {
    const options = typeof entry === "function" ? entry(data) : entry;
    return pick(Array.isArray(options) ? options : [options], rand);
  };

  const checks = card.principles.flatMap((p) => p.checks);
  const byId = new Map(checks.map((c) => [c.id, c]));
  const q = { card, s: (id) => byId.get(id)?.status, d: (id) => byId.get(id)?.data };
  const salience = (c) => SEVERITY[c.status] * (c.weight ?? 1) * (URGENCY[c.id] ?? 1);

  /** A check as a verb phrase. A check with no phrasebook entry falls back
   *  to its own summary, so a new pack narrates before anyone writes prose. */
  const clause = (c) => {
    const entry = PHRASES[c.id]?.[c.status];
    return entry ? say(choose(entry, c.data), c.data) : lowerFirst(c.summary.replace(/\.$/, ""));
  };
  const fixFor = (c) => {
    const entry = PHRASES[c.id]?.fix;
    return entry ? sentence(say(choose(entry, c.data), c.data)) : null;
  };
  const glossOf = (p) => sentence(say(choose(p.gloss, q), p.data?.(q) ?? {}));
  const joined = (list) => clauseList(list);

  // ------------------------------------------------ 1. content selection
  const matched = PATTERNS.filter((p) => p.when(q));
  const band = card.grade ?? "C";
  const wantTone = "AB".includes(band) ? "good" : "bad";
  const lead = matched.find((p) => p.id === "keys-in-the-open")
    ?? matched.find((p) => p.tone === wantTone)
    ?? matched[0]
    ?? null;
  // One more pattern at most, and after good news it must be a counterpoint:
  // three compliments in a row say less than one compliment and a "but".
  const second = lead?.tone === "good"
    ? matched.find((p) => p.tone === "bad")
    : matched.find((p) => p !== lead && p.tone === "bad");
  const alsoNoticed = second ? [second] : [];

  // ------------------------------------------------ 2. document plan
  const headline = sentence(lead
    ? say(choose(lead.headline, q), lead.data?.(q) ?? {})
    : say(pick(GRADE_HEADLINES[band], rand)));

  // Verdict: the grade, the patterns, the best and worst rule.
  const verdict = [];
  if (card.score !== null) verdict.push(sentence(say(pick(GRADE_LINES, rand), { score: card.score, grade: card.grade })));
  if (lead) verdict.push(glossOf(lead));
  verdict.push(...alsoNoticed.map(glossOf));
  const scored = card.principles.filter((p) => p.score !== null);
  if (scored.length >= 2) {
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
    if (best.score - worst.score >= 25) {
      verdict.push(sentence(`It is strongest on ${TOPICS[best.id].topic}, where it ${TOPICS[best.id].good}, and weakest on ${TOPICS[worst.id].topic}, where it ${TOPICS[worst.id].bad}`));
    } else if (worst.score === 100) {
      verdict.push(sentence(say("[Every principle it can be measured on scores 100|Nothing measured falls short]")));
    } else if (worst.score >= 85) {
      verdict.push(sentence(say("[It is even across the board: no principle scores below {worst}|No principle scores below {worst}]", { worst: worst.score })));
    }
  }

  // Strengths: the heaviest pass from each principle, up to four.
  const strongest = [];
  const seen = new Set();
  for (const c of checks.filter((x) => x.status === "pass").sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))) {
    if (seen.has(c.principle)) continue;
    seen.add(c.principle);
    strongest.push(clause(c));
  }
  const strengths = strongest.length ? aggregate(strongest.slice(0, 4)) : null;

  // Problems, worst principle first, one sentence each.
  const troubled = card.principles
    .filter((p) => p.checks.some((c) => c.status in SEVERITY))
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100) || RULE_NUMBER[a.id] - RULE_NUMBER[b.id]);
  const problems = troubled.slice(0, 5).map((p) => {
    const own = p.checks.filter((c) => c.status in SEVERITY).sort((a, b) => salience(b) - salience(a));
    const topic = TOPICS[p.id].topic;
    const leadIn = say(pick(PROBLEM_LEADS, rand), { topic, Topic: capitalize(topic), is: TOPICS[p.id].is, it: pick(["it", "it", "the repo"], rand) });
    return { principle: p.id, rule: RULE_NUMBER[p.id], text: sentence(`${leadIn} ${joined(own.map(clause))}`) };
  });
  const more = troubled.length - problems.length;
  if (more > 0) {
    problems.push({ principle: null, rule: null, text: sentence(say("{#more|other principle} {more~has/have} smaller problems, listed below", { more })) });
  }

  // What to do first: the three most salient problems that have a fix.
  const fixes = checks.filter((c) => c.status in SEVERITY)
    .sort((a, b) => salience(b) - salience(a))
    .map((c) => ({ check: c.id, rule: RULE_NUMBER[c.principle], text: fixFor(c) }))
    .filter((f) => f.text)
    .slice(0, 3);

  // What the reader should know about the scan itself.
  const caveats = [];
  if (card.counts.error) caveats.push(sentence(say("{#n|check} could not run, so the grade leaves {n~it/them} out", { n: card.counts.error })));
  if (card.notices?.length) caveats.push(sentence(say("[The notes above the checklist|The notices at the top] say what the scan could not see")));

  // The manifesto's tenth rule is its sign-off, so it is ours.
  const signoff = pick(SIGNOFFS[band], rand);

  // Every principle in one sentence, for its own section of the card.
  const byPrinciple = Object.fromEntries(card.principles.map((p) => {
    const goods = p.checks.filter((c) => c.status === "pass").map(clause);
    const bads = p.checks.filter((c) => c.status in SEVERITY).sort((a, b) => salience(b) - salience(a)).map(clause);
    let text;
    if (!goods.length && !bads.length) text = sentence(say("Nothing [here applies|measured here applies] to {topic} for this repository", { topic: TOPICS[p.id].topic }));
    else if (goods.length && bads.length) text = sentence(`It ${joined(goods)}, ${pick(["but", "but", "yet"], rand)} ${joined(bads)}`);
    else text = sentence(`It ${joined(goods.length ? goods : bads)}`);
    return [p.id, text];
  }));

  // One short reason per rule, for the report card: the single most telling
  // check -- its worst problem if it has one, its heaviest pass if not.
  const reasons = Object.fromEntries(card.principles.map((p) => {
    const worstCheck = p.checks.filter((c) => c.status in SEVERITY).sort((a, b) => salience(b) - salience(a))[0];
    const bestCheck = p.checks.filter((c) => c.status === "pass").sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))[0];
    const c = worstCheck ?? bestCheck;
    return [p.id, c
      ? sentence(`It ${clause(c)}`)
      : sentence(say("Nothing measured applies to {topic}", { topic: TOPICS[p.id].topic }))];
  }));

  const paragraphs = [
    verdict.join(" "),
    strengths,
    problems.length ? problems.map((p) => p.text).join(" ") : null,
    caveats.length ? caveats.join(" ") : null,
  ].filter(Boolean);

  const text = [
    headline,
    ...paragraphs,
    fixes.length ? `Start here:\n${fixes.map((f, i) => `${i + 1}. ${f.text}`).join("\n")}` : null,
    signoff,
  ].filter(Boolean).join("\n\n");

  return {
    headline,
    pattern: lead ? describe(lead) : null,
    alsoNoticed: alsoNoticed.map(describe),
    paragraphs,
    problems,
    fixes,
    byPrinciple,
    reasons,
    signoff,
    text,
  };

  // ---------------------------------------------------------- microplanning
  /** Aggregate verb phrases under one subject; split in two past three. */
  function aggregate(clauses) {
    if (clauses.length <= 3) return sentence(`it ${joined(clauses)}`);
    return `${sentence(`it ${joined(clauses.slice(0, 2))}`)} ${sentence(`${say("((also))")} ${joined(clauses.slice(2))}`)}`;
  }
}

/** Which manifesto rules a pattern combines, by number. */
const describe = (p) => ({ id: p.id, name: p.name, rules: p.rules.map((r) => RULE_NUMBER[r]).sort((a, b) => a - b) });

const lowerFirst = (s) => s.replace(/^(\p{Lu})(\p{Ll})/u, (_, a, b) => a.toLowerCase() + b);

/** The short name a person would use: "ky", or "ky/packages/core" for a folder. */
function displayName(card) {
  const repoName = card.repo.fullName.split("/").pop();
  return card.scope ? `${repoName}/${card.scope}` : repoName;
}
