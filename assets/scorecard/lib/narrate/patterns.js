// Combinations. A single check says "a server listens all day"; a pattern
// notices that the server, the database behind it, and the NAT gateway in
// front of it are one decision seen from three principles. These are the
// shapes the manifesto names -- the tower, the rented door, the page that
// needs two computers -- and they are what a person would say first.
//
// Each pattern lists the manifesto rules it combines (principle ids, which
// the narrator turns into rule numbers), a tone, and a test over the card.
// Order is priority: when several match, the earliest leads.

import { list } from "./grammar.js";

const BAD = new Set(["warn", "fail"]);

// A server may be found by the JavaScript pack or by the other-languages
// floor in the common pack; the patterns ask about the shape, not the language.
const shapes = (q) => [q.d("node.entry-points")?.shape, q.d("common.other-servers")?.shape];
const hasServer = (q) => shapes(q).some((s) => s === "server" || s === "mixed");
const alwaysUp = (q) => q.s("node.entry-points") === "fail" || q.s("common.other-servers") === "fail";
const queriesDatabase = (q) => BAD.has(q.s("node.live-queries")) || BAD.has(q.s("common.no-beast"));
/** No runtime dependencies in any language the scan can read. */
const noDependencies = (q) => (q.d("node.direct-deps")?.prod ?? 0) === 0 && (q.d("common.other-deps")?.count ?? 0) === 0;

export const PATTERNS = [
  {
    id: "keys-in-the-open", name: "Keys in the open", tone: "bad", rules: ["foundation"],
    when: (q) => q.s("common.secrets") === "fail" || q.s("common.secret-files") === "fail",
    headline: ["{name} has [keys|credentials] in the open."],
    gloss: ["Whatever else is true of it, that comes first: a committed credential belongs to everyone who has ever cloned the repository."],
  },
  {
    id: "tower", name: "The tower", tone: "bad", rules: ["stateless", "beast", "balance", "foundation"],
    when: (q) => alwaysUp(q)
      && (queriesDatabase(q) || BAD.has(q.s("common.always-on")) || BAD.has(q.s("common.moving-parts"))),
    headline: ["{name} is the classic tower.", "{name} is built as a tower."],
    gloss: (q) => {
      const layers = [
        queriesDatabase(q) && "a database answering every request",
        BAD.has(q.s("common.always-on")) && "infrastructure billing by the hour",
        BAD.has(q.s("common.moving-parts")) && "a set of services that all have to stay up",
      ].filter(Boolean);
      return [`A server that never sleeps, with ${list(layers)} beneath it. Each layer is reasonable on its own. Together they are a bill that arrives whether anyone visits or not.`];
    },
  },
  {
    id: "two-computers", name: "Two computers for one page", tone: "bad", rules: ["beast", "stateless"],
    when: (q) => q.s("web.prerendered") === "fail" && hasServer(q),
    headline: ["{name} takes two computers to show one page."],
    gloss: ["A server stays up to send an empty shell, and the reader's machine does the rest. Rendering once, ahead of time, would retire the first computer entirely."],
  },
  {
    id: "orchestra", name: "The orchestra", tone: "bad", rules: ["foundation", "balance"],
    when: (q) => q.s("common.moving-parts") === "fail",
    headline: ["{name} needs an orchestra to play one tune."],
    gloss: ["{#services|service} have to be up at once for it to work at all. Every one is a part that can break, and a line on the bill."],
    data: (q) => q.d("common.moving-parts"),
  },
  {
    id: "rented-door", name: "The rented door", tone: "bad", rules: ["gravity", "beast"],
    when: (q) => (BAD.has(q.s("node.lock-in")) || BAD.has(q.s("common.other-lock-in"))) && queriesDatabase(q),
    headline: ["{name} rents the only door to its own data."],
    gloss: ["The data lives in {vendors}, and requests go to it live rather than to anything precomputed. Every look at the data is on the vendor's terms and meter."],
    data: (q) => ({ vendors: [...(q.d("node.lock-in")?.vendors ?? []), ...(q.d("common.other-lock-in")?.vendors ?? [])] }),
  },
  {
    id: "borrowed-page", name: "The borrowed page", tone: "bad", rules: ["beast", "dependency", "foundation"],
    when: (q) => q.s("web.prerendered") === "pass" && BAD.has(q.s("web.third-party-scripts")),
    headline: ["{name} has flat pages carrying borrowed code."],
    gloss: ["The pages themselves are already rendered, which is the hard part. The scripts they pull from {origins:3} are someone else's code, outages, and exploits running on them."],
    data: (q) => q.d("web.third-party-scripts"),
  },
  {
    id: "heavy-scaffolding", name: "Light building, heavy scaffolding", tone: "bad", rules: ["dependency"],
    when: (q) => q.s("node.direct-deps") === "pass" && q.s("node.installed-tree") === "fail"
      && q.d("node.installed-tree")?.runtime !== null && q.d("node.installed-tree")?.runtime <= 50,
    headline: ["{name} is a small building inside a lot of scaffolding."],
    gloss: (q) => [q.d("node.installed-tree").runtime === 0
      ? "Nothing ships with it at runtime. What builds and tests it is another matter: {count|package}, every one of them code that runs on the machine holding the deploy keys."
      : "What ships is small: {runtime|package} at runtime. What builds and tests it is not: {count|package} in all, every one of them code that runs on the machine holding the deploy keys."],
    data: (q) => q.d("node.installed-tree"),
  },
  {
    id: "client-rendered", name: "Assembly required", tone: "bad", rules: ["beast", "balance"],
    when: (q) => q.s("web.prerendered") === "fail" && !hasServer(q),
    headline: ["{name} sends an empty page and asks the reader's machine to build it."],
    gloss: ["There is no server to blame here; the cost moves to every reader instead, who downloads the code, runs it, and waits for the fetches before seeing a word. Rendering once, at build time, would do that work a single time for everyone."],
  },
  {
    id: "untended", name: "Untended", tone: "bad", rules: ["modernization", "schemas"],
    when: (q) => (q.s("common.activity") === "fail" || q.d("common.activity")?.archived)
      && (q.s("common.tests") === "fail" || q.s("common.readme") === "fail"),
    headline: ["Nobody appears to be tending {name}."],
    gloss: (q) => {
      const missing = [q.s("common.tests") === "fail" && "tests", q.s("common.readme") === "fail" && "a README"].filter(Boolean);
      const state = q.d("common.activity")?.archived ? "It is archived" : "It has not changed in {#months|month}";
      return [`${state}, and it has no ${missing.join(" and no ")} to help a newcomer pick it up. That is how working code becomes an anchor.`];
    },
    data: (q) => q.d("common.activity"),
  },
  {
    id: "static", name: "Static and done", tone: "good", rules: ["beast", "balance", "stateless", "dependency"],
    when: (q) => q.s("web.prerendered") === "pass" && q.s("common.always-on") === "pass"
      && !BAD.has(q.s("web.third-party-scripts")) && !hasServer(q),
    headline: ["{name} is static files and nothing else.", "{name} is pages that are already there."],
    gloss: ["Pre-rendered pages, served as they are, with no server to keep awake and nothing borrowed from other origins. This is the shape the manifesto argues for."],
  },
  {
    id: "own-code", name: "Only its own code", tone: "good", rules: ["dependency", "stateless"],
    when: (q) => noDependencies(q) && !hasServer(q),
    headline: ["{name} ships only its own code."],
    gloss: ["No runtime dependencies and nothing to keep running: it does its job when called and costs nothing otherwise."],
  },
  {
    id: "flat", name: "Flat", tone: "good", rules: ["beast", "gravity", "balance", "foundation", "dependency", "stateless", "shiny", "modernization", "schemas"],
    when: (q) => q.card.score >= 90 && q.card.counts.fail === 0,
    headline: ["{name} is flat."],
    gloss: ["Every principle measured comes out ahead, and nothing failed outright."],
  },
];
