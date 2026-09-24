# The flat-stack scorecard

`/scorecard.html` grades any public GitHub or GitLab repository against the nine
Southern Cross principles in `content/manifesto.json`. It runs entirely in the
reader's browser: no server, no account, no clone, no upload.

```bash
node tools/scorecard.mjs github.com/owner/repo          # same checks, from a terminal
node tools/scorecard.mjs gitlab.com/group/proj --json   # the full card as JSON
node test/scorecard.test.mjs                            # offline fixture tests
```

## How it reads a repo without a server

A browser can only read another host if that host sends
`Access-Control-Allow-Origin`. Checked 2026-09-24:

| Endpoint | CORS | Used for |
|---|---|---|
| `api.github.com` (repo, commit, recursive tree) | `*` | file list and sizes: **3 requests per scan**, 60/hour/IP anonymous |
| `raw.githubusercontent.com` | `*` | file contents, read at the scanned commit; not counted against the API limit |
| `data.jsdelivr.com` / `cdn.jsdelivr.net` | `*` | fallback mirror when the GitHub limit is used up |
| `gitlab.com/api/v4` | `*` | project, commit, paginated tree, raw files |
| `registry.npmjs.org/<pkg>/latest` | `*` | deprecation lookup for direct dependencies |
| `github.com/<repo>.git` (smart HTTP) | **none** | not usable: speaking git protocol would need a proxy |
| `codeload.github.com` (tarballs) | GitHub's own origin only | not usable |

So "directly against git" means the hosts' HTTPS file APIs, not the git wire
protocol. That covers everything the checks need.

The browser's HTTP cache revalidates GitHub API calls with `If-None-Match`, and a
304 does not count against the limit, so rescanning an unchanged repo is free.
The finished card is cached in `localStorage`, keyed by the tree's content hash.

If you ever enforce the site CSP (`infra/wire-edge.mjs` ships it report-only),
those hosts are already in `connect-src`. Run `node infra/wire-edge.mjs` to push
the updated policy.

## Layout

```
assets/scorecard/
  app.js                 the page: DOM only, textContent only (repo content is untrusted)
  lib/
    http.js              fetch wrapper: concurrency, timeouts, rate-limit detection
    source.js            URL parsing, provider registry, GitHub -> jsDelivr fallback
    providers/           github, gitlab, jsdelivr (+ memory, tests only)
    repo.js              file index + memoized reads; the one shape every check sees
    engine.js            runs packs, scores principles, builds the card
    principles.js        the nine principles (test fails if they drift from the manifesto)
    result.js            pass / warn / fail / na verdicts
    secrets.js           credential patterns + redact()
    ecosystems.js        the floor for non-JS languages: manifest parsers, server idioms, vendor SDKs
    cache.js             localStorage, every failure reported
    packs/
      common.js          any language: IaC always-on resources, secrets, tests, CI, docs
      web.js             HTML/browser JS: pre-rendered pages, third-party scripts, SRI, trackers
      node.js            Node: dependency tree, lockfile, servers vs handlers, state, DB clients
      index.js           the pack list
```

The same modules run in the browser, in `tools/scorecard.mjs` (curl transport),
and in the tests (in-memory repo). Nothing in `lib/` touches the DOM or the
filesystem.

## Every rule is measured, in every language

Absence is a result. A repo with no database has nothing to wake; one with no
dependencies has nothing shiny to lean on; one with no server has nothing
kept running. Those are passes, not blanks, so every rule has a check that
runs on any repository:

- Rule 1: `common.no-beast` finds databases, caches, and warehouses in
  infrastructure, compose files, and manifests of every ecosystem.
- Rules 2, 5, 6, 7: the `common.other-*` checks read Python, Go, Ruby, JVM,
  PHP, Rust, and .NET manifests and sources (`lib/ecosystems.js`). When the
  only code is JavaScript they step aside (n/a) and `packs/node.js` answers.
- The JavaScript pack runs on any JS/TS file, with or without a
  `package.json`, and flags packages that are loaded but never declared.

A test requires every rule to have a score for every fixture, including a repo
that is nothing but a README.

## Scoring

Each check returns `pass` (1), `warn` (0.5), `fail` (0), `na` (excluded), or
`error` (excluded, and shown). A principle's score is the weighted mean of its
checks; the overall score is the plain mean of the principles that had at least
one applicable check. A 90+, B 80+, C 70+, D 60+, F below.

Every verdict carries a sentence and evidence (path, line, note) that links to
the file on the host. A pack that cannot read a file names it in the notices at
the top of the card; a check whose evidence never arrived is not allowed to
pass quietly.

Bump `ENGINE_VERSION` in `engine.js` whenever a check changes, so cached cards
are not served stale.

## The plain-English explanation

`lib/narrate/` turns a card into prose: a headline, a verdict, strengths,
problems by principle, three fixes, and the manifesto's tenth rule as the
sign-off. It is a template-based natural-language generator in the classic
data-to-text pipeline (Reiter & Dale), the approach behind automated weather
and sports reports:

| Stage | File | What it does |
|---|---|---|
| Content selection | `index.js`, `patterns.js` | Which checks matter most (severity × weight × urgency), and which **combination patterns** match |
| Document plan | `index.js` | Headline → verdict → strengths → problems (worst rule first) → "Start here" → sign-off |
| Microplanning | `index.js`, `grammar.js` | Aggregates clauses about one subject into one sentence; semicolons when clauses carry commas; referring expressions ("ky", "it", "the repo") |
| Realization | `grammar.js`, `lexicon.js`, `phrasebook.js` | Templates → English with plurals, articles, number words, agreement |

**Combination patterns** are the point of the design. A single check says
"a server listens all day"; the *tower* pattern notices that the server, the
database behind it, and the NAT gateway in front are one decision seen from
rules 1, 3, 4, and 6. Each pattern names the rules it combines, has a tone,
and a test over the card. The lead pattern becomes the headline; after good
news, the one extra pattern shown is always a counterpoint.

Patterns today: keys in the open, the tower, two computers for one page, the
orchestra, the rented door, the borrowed page, light building / heavy
scaffolding, assembly required (client-rendered), untended, static and done,
only its own code, flat.

**The template language** (`grammar.js`), borrowed from Tracery for choice and
SimpleNLG for morphology:

```
[a|b|c]          one alternative, chosen by the seeded generator
((rule))         a synonym set from lexicon.js
{key}            data value; arrays become "a, b, and c"   {key/or}  {key:3}
{#key|noun}      "three packages"   {key|child/children}  "3 children"
{key~has/have}   just the agreeing word
{a:key}          "an EC2 instance", "a NAT gateway", "an F"
{key>map}        values looked up in a lexicon map first
```

Grammar never depends on chance: anything that must agree with a count uses
`~`, `|`, or a function of the data, never a random `[it|them]`.

**No language model runs.** The output is seeded by the repo's content hash,
so the same repository always reads the same way and a cached card agrees with
a fresh one. Every sentence traces back to a check and its `data`. It costs
nothing and runs offline. The result is structured
(`{ headline, pattern, paragraphs, problems, fixes, byPrinciple, text }`), so a
model could polish it later if that is ever worth a running computer.

Checks report their measurements in `data` (see `lib/result.js`); the
phrasebook reads those, never the summary string. A check with no phrasebook
entry still narrates from its summary, but the test suite requires `pass`,
`warn`, `fail`, and `fix` phrasing for every shipped check, and fuzzes 300
seeds per fixture for unresolved slots, doubled punctuation, and leaked secrets.

## Adding a language

One file in `lib/packs/`, one line in `lib/packs/index.js`. For example, Python:

```js
// lib/packs/python.js
import { prioritize } from "../repo.js";
import { pass, warn, fail, na, tiered, plural } from "../result.js";

async function gather(repo) {
  const req = repo.rootFile(/^requirements\.txt$/);
  const lines = req ? (await repo.read(req.path)).split(/\r?\n/).filter((l) => /^[A-Za-z]/.test(l)) : [];
  return { reqPath: req?.path ?? null, deps: lines, unread: [] };
}

export const python = {
  id: "python",
  label: "Python",
  detect: (repo) => repo.find(/\.py$/).length > 0,
  gather,
  checks: [{
    id: "direct-deps", principle: "dependency",
    title: "Few runtime dependencies",
    why: "A library you import is someone else's code running inside your walls.",
    run: ({ python: py }) => py.reqPath
      ? tiered(py.deps.length, 5, 15, `${plural(py.deps.length, "requirement")}.`, [{ path: py.reqPath }], { prod: py.deps.length })
      : na("No requirements.txt."),
  }],
};
```

Rules the existing packs follow:

- **All reading happens in `gather`.** Checks are small functions over the
  facts, so adding a check never adds a request. `repo.read` is memoized, so
  packs that want the same file share one fetch.
- **Cap what you read** with `prioritize(files, patterns, cap)`. Very large repos
  are sampled, and the page says so.
- **Return failed reads as `unread`** so the engine can name them.
- **Quote source lines only through `redact()`** from `secrets.js`.
- **Pick the principle honestly.** If a check does not answer to one of the
  nine, it does not belong on this scorecard.
- **Report measurements in `data`**, the third argument to `pass`/`warn`/`fail`.
- **Add phrasebook entries** (`pass`, `warn`, `fail`, `fix`) to
  `lib/narrate/phrasebook.js` under `"python.direct-deps"` etc.; the coverage
  test fails until you do. If the language brings a new shape worth naming
  (a Django monolith, say), add a pattern to `lib/narrate/patterns.js`.
- Add a fixture to `test/scorecard.test.mjs` that makes each new check pass and
  fail.
