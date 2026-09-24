// What a check returns. Four verdicts plus "error", and every one carries a
// sentence and its evidence -- the same rule as the story scorer's `why` array:
// no score without the reason, so a wrong score shows you which rule to fix.
//
// `data` is the measurement behind the verdict: counts, names, sizes. The
// summary is written for the checklist; data is what the narrator
// (lib/narrate/) phrases from, so it never has to parse English back out of a
// sentence. Keep it to plain numbers, strings, and arrays of strings.

/** @typedef {{path:string, line?:number, note?:string}} Evidence */
/** @typedef {{status:"pass"|"warn"|"fail"|"na"|"error", summary:string, evidence:Evidence[], data:object}} CheckResult */

export const VALUE = { pass: 1, warn: 0.5, fail: 0 };

export const pass = (summary, evidence = [], data = {}) => ({ status: "pass", summary, evidence, data });
export const warn = (summary, evidence = [], data = {}) => ({ status: "warn", summary, evidence, data });
export const fail = (summary, evidence = [], data = {}) => ({ status: "fail", summary, evidence, data });
/** Not applicable: excluded from the score, still shown with its reason. */
export const na = (summary, data = {}) => ({ status: "na", summary, evidence: [], data });

/** pass at or under `ok`, warn at or under `bad`, fail beyond it. */
export function tiered(count, ok, bad, text, evidence = [], data = {}) {
  const make = count <= ok ? pass : count <= bad ? warn : fail;
  return make(text, evidence, data);
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
