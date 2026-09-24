// What to say about each check. One entry per check id (pack.check), keyed by
// verdict, plus the fix to recommend when it did not pass.
//
// Every clause is a verb phrase with no subject -- "ships no runtime
// dependencies", not "It ships..." -- so the narrator can aggregate several
// into one sentence: "It ships no runtime dependencies, renders its pages
// ahead of time, and declares nothing that bills while idle."
//
// Fixes are imperatives. An entry may be a list of alternatives or a function
// of the check's `data` returning one (for when the right phrase depends on
// the measurement, not just the verdict). Slots and syntax: see grammar.js.
//
// A check with no entry here still narrates, from its own summary line; the
// coverage test in test/scorecard.test.mjs is what keeps shipped packs from
// relying on that.

/** Pick the phrasing that agrees with a count: grammar decided by data, never by chance. */
const byCount = (key, one, many) => (d) => ((Array.isArray(d[key]) ? d[key].length : d[key]) === 1 ? [one] : [many]);

export const PHRASES = {
  // ------------------------------------------------------------ common
  "common.always-on": {
    pass: (d) => (d.zero
      ? ["declares {#zero|scale-to-zero resource} and nothing that ((bills)) while idle"]
      : ["declares no infrastructure that ((bills)) while idle", "declares nothing that ((bills)) ((idle))"]),
    warn: ["declares {#count|always-on resource} ({kinds}) that [{count~bills/bill}|{count~keeps/keep} billing] ((idle))"],
    fail: ["declares {#count|always-on resource} ({kinds:4}) that [{count~bills/bill}|{count~keeps/keep} billing] ((idle))",
      "stands up {#count|always-on resource} ({kinds:4}), every one of them billing by the hour"],
    fix: ["Price the always-on resources ({kinds:3}) at zero traffic, then replace [what you can|each one you can] with something that stops when idle."],
  },
  "common.no-beast": {
    pass: ["has no database, cache, or warehouse to wake", "has no Beast to wake at all"],
    warn: ["keeps {backends} standing by to answer queries"],
    fail: ["stands on {#backends|backend} ({backends:4}), each woken by a query"],
    fix: ["Find which answers from {backends:3} barely change, and publish them as files instead of querying for them."],
  },
  "common.other-deps": {
    pass: (d) => (d.count ? ["keeps its dependencies to {#count}"] : ["declares no third-party libraries at all", "ships nothing it did not write"]),
    warn: ["leans on {#count|runtime dependency/runtime dependencies} ({ecosystems})"],
    fail: ["pulls in {#count|runtime dependency/runtime dependencies} ({ecosystems})"],
    fix: ["Go through the {#count|dependency/dependencies} and replace the ones twenty lines would cover."],
  },
  "common.other-servers": {
    pass: (d) => ({
      functions: ["runs as functions a platform starts per request"],
      "server-on-zero": ["runs a server, but on a runtime that stops it when idle"],
    }[d.shape] ?? ["has nothing that stays running", "keeps no server running"]),
    warn: ["has both a long-running server and per-request handlers"],
    fail: ["keeps a server listening all day, with nothing configured to stop it"],
    fix: (d) => (d.shape === "mixed"
      ? ["Check which entry point production actually uses, and delete the other."]
      : ["Run the server on something that scales to zero (Lambda Web Adapter, Cloud Run with minimum instances at 0), or split it into functions."]),
  },
  "common.other-pre-1": {
    pass: (d) => (d.total ? ["builds on libraries that have reached 1.0"] : ["has no dependencies, so nothing unsettled to build on"]),
    warn: ["depends on {names:3}, still below 1.0"],
    fail: ["depends on {#names|library/libraries} still below 1.0 ({names:3})"],
    fix: ["Pin {names:3} to exact versions, or swap them for something that has settled."],
  },
  "common.other-lock-in": {
    pass: ["keeps its data out of any single vendor's engine"],
    warn: ["keeps its data behind {vendors}"],
    fail: ["keeps its data behind {vendors}"],
    fix: ["Keep an export of what lives in {vendors} in open files you control."],
  },
  "common.secrets": {
    pass: ["keeps credential-shaped strings out of the files scanned", "has no keys sitting in the source"],
    warn: ["has {#soft|string} that look like credentials ({kinds}), probably public by design but ((worth))"],
    fail: ["has {#hard|credential} ({kinds}) committed in plain text"],
    fix: (d) => (d.hard
      ? ["Rotate the committed {kinds} today. Deleting the line does not remove a secret from git history."]
      : ["Confirm each flagged {kinds} is meant to be public, and restrict it to your own domains."]),
  },
  "common.secret-files": {
    pass: ["commits no .env or key files"],
    warn: ["keeps {#testKeys|key file} among its test fixtures"],
    fail: ["commits {files:3} to the repository"],
    fix: ["Remove {files:3}, add {files~it/them} to .gitignore, and rotate whatever {files~it/they} held."],
  },
  "common.moving-parts": {
    pass: (d) => (d.services
      ? ["runs only {#services|service}"]
      : ["orchestrates no services at all", "needs no fleet of services to run"]),
    warn: (d) => (d.stateful
      ? ["needs {#services|service} running together, {#stateful} of them stateful"]
      : ["needs {#services|service} running together"]),
    fail: (d) => (d.stateful
      ? ["needs {#services|service} running to work, {#stateful} of them [stateful|holding data]"]
      : ["needs {#services|service} running to work"]),
    fix: ["Ask which of the {#services|service} could be a file on object storage or a function that runs on demand."],
  },
  "common.open-data": {
    pass: ["keeps its {#files|data file} in open formats"],
    warn: ["keeps {#closed|data file} in formats only one application can read"],
    fail: ["keeps {#closed|data file} in formats only one application can read"],
    fix: ["Export the {#closed|proprietary file} to CSV or Parquet and keep those alongside."],
  },
  "common.ci": {
    pass: ["runs its checks in CI"],
    warn: ["has no CI, so nothing runs the tests on a push"],
    fail: ["has no CI"],
    fix: ["Add a CI workflow that runs the tests on every push."],
  },
  "common.tests": {
    pass: ["has {#files|test file}"],
    warn: ["has few tests"],
    fail: ["has no tests", "ships without a single test"],
    fix: ["Write the first test around whatever breaks most often."],
  },
  "common.activity": {
    pass: (d) => (d.months < 1 ? ["was changed within the last month"] : ["was changed {#months|month} ago"]),
    warn: (d) => (d.archived ? ["is archived and will not change again"] : ["has not been touched in {#months|month}"]),
    fail: ["has not been touched in {#months|month}"],
    fix: ["Decide whether it is maintained. If it is, update it; if not, archive it and say so at the top of the README."],
  },
  "common.readme": {
    pass: ["has a README of {words} words"],
    warn: (d) => (d.words === null ? ["has a README that could not be read"] : ["has a README of only {#words|word}"]),
    fail: ["has no README"],
    fix: ["Write a README that says what it is, how to run it, and what it costs to run."],
  },
  "common.schemas": {
    pass: ["writes its data shapes down ({#files|schema or type file})"],
    warn: ["leaves its data shapes undocumented"],
    fail: ["leaves its data shapes undocumented"],
    fix: ["Document the main data objects as JSON Schema or types, so they get reused instead of rebuilt."],
  },

  // --------------------------------------------------------------- web
  "web.prerendered": {
    pass: ["serves {#pages|page} with the content already in the HTML", "renders its pages before any script runs"],
    warn: byCount("shells", "ships one page of {#pages} as an empty shell", "ships {#shells} of {#pages} pages as empty shells"),
    fail: byCount("shells", "ships its page as an empty shell that shows nothing until JavaScript runs",
      "ships {#shells|page} as empty shells that show nothing until JavaScript runs"),
    fix: ["Pre-render {shellPaths:3} at build time, so the content is in the HTML before any script runs."],
  },
  "web.script-weight": {
    pass: ["ships only {size} of JavaScript"],
    warn: ["ships {size} of JavaScript"],
    fail: ["ships {size} of JavaScript before anyone reads a word"],
    fix: ["Cut the {size} of script down to what the page cannot work without."],
  },
  "web.third-party-scripts": {
    pass: ["serves every script from its own origin"],
    warn: ["loads code from {origins}"],
    fail: ["loads code from {#origins|outside origin} ({origins:4})"],
    fix: ["Self-host what you keep from {origins:3}, and drop the rest."],
  },
  "web.integrity": {
    pass: ["pins every outside resource with an integrity hash"],
    warn: byCount("modules", "imports an ES module straight from a CDN, where no hash can pin it",
      "imports {#modules} ES modules straight from a CDN, where no hash can pin them"),
    fail: (d) => (d.plain
      ? ["loads {#plain|resource} over plain http"]
      : ["loads {#unpinned|outside script or stylesheet/outside scripts and stylesheets} without an integrity hash"]),
    fix: (d) => (d.plain
      ? ["Move the {#plain|http resource} to https or, better, self-host what they load."]
      : ["Add integrity hashes to the outside tags, or self-host what they load."]),
  },
  "web.trackers": {
    pass: ["carries no third-party trackers"],
    warn: ["carries {names}"],
    fail: ["carries {#names|tracker} ({names})"],
    fix: ["Drop {names}. The CDN's own logs answer most of the same questions without a script on the page."],
  },

  // -------------------------------------------------------------- node
  "node.direct-deps": {
    pass: (d) => (d.prod
      ? ["keeps its runtime dependencies to {#prod}"]
      : ["ships no runtime dependencies at all", "ships nothing it did not write"]),
    warn: ["leans on {#prod|runtime dependency/runtime dependencies}"],
    fail: ["leans on {#prod|runtime dependency/runtime dependencies}", "pulls in {#prod|runtime dependency/runtime dependencies}"],
    fix: ["Go through the {#prod|runtime dependency/runtime dependencies} and replace the ones twenty lines would cover."],
  },
  "node.installed-tree": {
    pass: (d) => (d.count ? ["installs a tree of only {count|package}"] : ["installs nothing"]),
    warn: (d) => (d.runtime === 0 ? ["installs {count|package}, all of them build and test tooling"]
      : d.runtime !== null && d.runtime < d.count ? ["installs {count|package}, {runtime} of them at runtime"]
      : ["installs {count|package}"]),
    fail: (d) => (d.vendored ? ["commits node_modules to the repository"]
      : d.runtime === 0 ? ["installs {count|package}, all of them build and test tooling"]
      : d.runtime !== null && d.runtime < d.count
        ? ["installs {count|package}, {runtime} of them at runtime and the rest build tooling"]
        : ["installs {count|package}"]),
    fix: (d) => (d.vendored
      ? ["Delete the committed node_modules and add it to .gitignore."]
      : ["Run npm ls --all, find what pulls in most of the {count} packages, and ask whether it earns them."]),
  },
  "node.lockfile": {
    pass: (d) => (d.lock ? ["locks its installs with {lock}"] : ["has nothing to lock"]),
    warn: ["leaves its dev toolchain unlocked"],
    fail: (d) => (d.undeclared?.length
      ? ["loads {undeclared:3} without declaring {undeclared~it/them} anywhere"]
      : ["installs without a lockfile, so every install can differ"]),
    fix: (d) => (d.undeclared?.length
      ? ["Add a package.json that declares {undeclared:3}, and commit the lockfile it produces."]
      : ["Commit the lockfile, so what you tested is what ships."]),
  },
  "node.trivial-deps": {
    pass: ["pulls in no one-line packages"],
    warn: ["installs {names} for what the language now does natively"],
    fail: ["installs {#names|one-line package} ({names:4})"],
    fix: ["Replace {names:3} with {natives:3}."],
  },
  "node.entry-points": {
    pass: (d) => ({
      functions: ["runs as functions that start per request"],
      cli: ["is a command-line tool that runs only when someone runs it"],
      "server-on-zero": ["runs a server, but on a runtime that stops it when idle"],
    }[d.shape] ?? ["keeps no server running", "runs no server at all"]),
    warn: ["has both a long-running server and per-request handlers"],
    fail: ["runs a server that listens all day, with nothing in the repo to put it to sleep",
      "keeps a server up around the clock, with nothing configured to stop it"],
    fix: (d) => (d.shape === "mixed"
      ? ["Check which entry point production actually uses, and delete the other."]
      : ["Put the server behind something that scales to zero (Lambda Web Adapter, Cloud Run with minimum instances at 0), or split its routes into functions."]),
  },
  "node.in-process-state": {
    pass: ["holds nothing between requests"],
    warn: ["keeps state inside the process ({kinds>stateKind})"],
    fail: ["keeps state inside the process ({kinds>stateKind})"],
    fix: ["Move the {kinds>stateKind} out of the process, so any instance can be replaced without anyone noticing."],
  },
  "node.live-queries": {
    pass: ["answers without a database client"],
    warn: ["talks to a database through {drivers} on the request path"],
    fail: ["talks to databases through {drivers} on the request path"],
    fix: ["Find the queries whose answers barely change and serve them from precomputed files instead of {drivers/or}."],
  },
  "node.lock-in": {
    pass: ["keeps its data out of any single vendor's engine"],
    warn: ["keeps its data behind {vendors}"],
    fail: ["keeps its data behind {vendors}"],
    fix: ["Keep an export of what lives in {vendors} in open files you control."],
  },
  "node.pre-1": {
    // An undeclared package has no version to judge: say so rather than vouch for it.
    pass: (d) => (d.unknown?.length
      ? ["pins nothing below 1.0, though {unknown:3} {unknown~floats/float} at whatever version installs"]
      : ["builds on libraries that have reached 1.0"]),
    warn: ["depends on {names:3}, still below 1.0"],
    fail: ["depends on {#names|library/libraries} still below 1.0 ({names:3})"],
    fix: ["Pin {names:3} to exact versions, or swap them for something that has settled."],
  },
  "node.deprecated": {
    pass: ["uses no deprecated packages"],
    warn: (d) => (d.names.length === 1
      ? ["still installs {names}, deprecated by its own author"]
      : ["still installs {names}, deprecated by their own authors"]),
    fail: ["still installs {#names|deprecated package} ({names:3})"],
    fix: ["Replace {names:3}; the authors have already said to."],
  },
  "node.node-version": {
    pass: ["declares the Node version it runs on"],
    warn: ["does not say which Node version it needs"],
    fail: ["does not say which Node version it needs"],
    fix: ["Add engines.node to package.json."],
  },
};
