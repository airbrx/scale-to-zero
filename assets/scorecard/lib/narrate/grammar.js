// Surface realization: turning a template plus data into an English sentence.
//
// The template language borrows from two well-known natural-language
// generation designs. Tracery (Kate Compton's grammar expander) gives the
// alternatives and named rules; SimpleNLG gives the morphology -- plurals,
// articles, number words, lists -- so a phrase is written once and still
// agrees with whatever count arrives.
//
//   [a|b|c]            pick one alternative (may nest, may hold slots)
//   ((rule))           expand a named rule from the lexicon (synonym sets)
//   {key}              a value from the data; arrays become "a, b, and c"
//   {key/or}           an array as "a, b, or c"
//   {key:3}            at most three items, then "and 2 more"
//   {#key}             a number as a word ("three"); arrays count their length
//   {key|noun}         "3 packages"; {key|child/children} for irregulars
//   {#key|noun}        "three packages"
//   {a:key}            with its article: "an EC2 instance"
//   {key>map}          each value looked up in lexicon map `map` first
//   {key~has/have}     just the word that agrees with the count: "have"
//
// Choice is never Math.random. Every pick comes from a generator seeded by the
// repo's content hash, so the same repository always reads the same way --
// a rescan does not reword the verdict, and a cached card agrees with a fresh
// one. A slot with no data throws: a sentence with a hole in it is a bug to
// fix, not text to ship.

// ------------------------------------------------------------ randomness
/** FNV-1a: a small, stable string hash for seeding. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded generator. Returns () => [0, 1). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (list, rand) => list[Math.floor(rand() * list.length)];

// ------------------------------------------------------------ morphology
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** Words up to twenty, numerals after -- the usual newsroom rule, bent to 20. */
export const numberWord = (n) => (Number.isInteger(n) && n >= 0 && n <= 20 ? WORDS[n] : n.toLocaleString("en-US"));

export function pluralize(word) {
  const irregular = { person: "people", child: "children", index: "indexes", schema: "schemas", this: "these", is: "are", was: "were", has: "have" };
  // Pluralize the last word of a phrase: "test file" -> "test files".
  const m = /^(.*?)(\S+)$/.exec(word);
  const [, head, last] = m;
  if (irregular[last]) return head + irregular[last];
  if (/[^aeiou]y$/i.test(last)) return head + last.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(last)) return head + last + "es";
  return head + last + "s";
}

/** "package" or "child/children", agreed with n. */
export function inflect(n, spec) {
  const [one, many] = spec.includes("/") ? spec.split("/") : [spec, pluralize(spec)];
  return n === 1 ? one : many;
}

/** a / an by sound, with the exceptions that trip naive rules. */
export function article(phrase) {
  const w = String(phrase).trim();
  if (/^(one\b|uni[^nmd]|use|usu|eu|ur)/i.test(w)) return `a ${w}`;
  if (/^(hour|honest|heir)/i.test(w)) return `an ${w}`;
  // Acronyms said as a word, not spelled out: "a NAT gateway".
  if (/^(NAT|NASA|JSON|YAML|GIF)\b/.test(w)) return `a ${w}`;
  // Letters said by name: "an EC2", "an S3 bucket", "a CDN", "an F".
  if (/^[A-Z]([A-Z\d]|$|\s)/.test(w)) return /^[AEFHILMNORSX]/.test(w) ? `an ${w}` : `a ${w}`;
  return /^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`;
}

/** Clauses that already contain commas are joined with semicolons, so the
 *  list stays readable: "has no CI, so nothing runs; and lacks a README". */
export function clauseList(clauses) {
  if (clauses.length <= 1 || !clauses.some((c) => c.includes(","))) return list(clauses);
  if (clauses.length === 2) return `${clauses[0]}, and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join("; ")}; and ${clauses.at(-1)}`;
}

/** Oxford-comma list. */
export function list(items, conj = "and", max = Infinity) {
  const xs = items.map(String);
  const shown = xs.length > max ? [...xs.slice(0, max), `${numberWord(xs.length - max)} more`] : xs;
  if (shown.length <= 1) return shown.join("");
  if (shown.length === 2) return `${shown[0]} ${conj} ${shown[1]}`;
  return `${shown.slice(0, -1).join(", ")}, ${conj} ${shown.at(-1)}`;
}

export const capitalize = (s) => s.replace(/^(\s*["'(]?)(\p{Ll})/u, (_, pre, c) => pre + c.toUpperCase());

/** Capitalized, single-spaced, ending in exactly one terminal mark. A
 *  sentence that opens with `keep` (a proper name like "ky") keeps its case. */
export function sentence(s, keep = null) {
  // Close up space before punctuation that ends a word -- but not before the
  // dot of ".env" or ".gitignore", which starts one.
  const tidy = s.replace(/\s+/g, " ").replace(/\s+([,.;:!?])(?=\s|$)/g, "$1").trim();
  const t = keep && tidy.startsWith(keep) ? tidy : capitalize(tidy);
  return /[.!?]["')]?$/.test(t) ? t : `${t}.`;
}

// --------------------------------------------------------------- expander
function matching(str, i, open, close) {
  let depth = 0;
  for (let j = i; j < str.length; j++) {
    if (str.startsWith(open, j)) { depth++; j += open.length - 1; continue; }
    if (str.startsWith(close, j)) {
      depth--;
      if (depth === 0) return j;
      j += close.length - 1;
    }
  }
  throw new Error(`unbalanced ${open} in template: ${str}`);
}

function splitTop(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "[" || c === "{" || (c === "(" && str[i + 1] === "(")) depth++;
    else if (c === "]" || c === "}" || (c === ")" && str[i + 1] === ")")) depth--;
    else if (c === "|" && depth === 0) { parts.push(str.slice(start, i)); start = i + 1; }
  }
  parts.push(str.slice(start));
  return parts;
}

/**
 * @param {string} template
 * @param {object} data     slot values
 * @param {{rand: () => number, rules?: object, maps?: object}} env
 */
export function expand(template, data, env) {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c === "[") {
      const end = matching(template, i, "[", "]");
      out += expand(pick(splitTop(template.slice(i + 1, end)), env.rand), data, env);
      i = end;
    } else if (c === "(" && template[i + 1] === "(") {
      const end = matching(template, i, "((", "))");
      const name = template.slice(i + 2, end);
      const rule = env.rules?.[name];
      if (!rule) throw new Error(`no lexicon rule ((${name}))`);
      out += expand(typeof rule === "function" ? rule(data, env) : pick(rule, env.rand), data, env);
      i = end + 1;
    } else if (c === "{") {
      const end = matching(template, i, "{", "}");
      out += slot(template.slice(i + 1, end), data, env);
      i = end;
    } else {
      out += c;
    }
  }
  return out;
}

function slot(spec, data, env) {
  // {key~one/many}: agreement only, no number.
  if (spec.includes("~")) {
    const [key, forms] = spec.split("~");
    if (!(key in data)) throw new Error(`template slot {${spec}} has no value`);
    const n = Array.isArray(data[key]) ? data[key].length : Number(data[key]);
    return inflect(n, forms);
  }
  // {a:key}
  if (spec.startsWith("a:")) return article(slot(spec.slice(2), data, env));
  // {#key...} number words
  const words = spec.startsWith("#");
  const body = words ? spec.slice(1) : spec;
  const [keyPart, noun] = body.split("|");
  const [keyMap, mod] = keyPart.split(/(?=[/:])/);
  const [key, mapName] = keyMap.split(">");

  if (!(key in data) || data[key] === undefined || data[key] === null) {
    throw new Error(`template slot {${spec}} has no value (have: ${Object.keys(data).join(", ")})`);
  }
  let v = data[key];
  if (mapName) {
    const map = env.maps?.[mapName];
    if (!map) throw new Error(`no lexicon map ${mapName}`);
    const look = (x) => {
      if (!(x in map)) throw new Error(`lexicon map ${mapName} has no entry for "${x}"`);
      return map[x];
    };
    v = Array.isArray(v) ? v.map(look) : look(v);
  }

  if (noun !== undefined || words) {
    const n = Array.isArray(v) ? v.length : Number(v);
    if (!Number.isFinite(n)) throw new Error(`slot {${spec}} needs a number, got ${JSON.stringify(v)}`);
    const shown = words ? numberWord(n) : n.toLocaleString("en-US");
    return noun === undefined ? shown : `${shown} ${inflect(n, noun)}`;
  }
  if (Array.isArray(v)) {
    if (mod === "/or") return list(v, "or");
    if (mod?.startsWith(":")) return list(v, "and", Number(mod.slice(1)));
    return list(v);
  }
  return String(v);
}
