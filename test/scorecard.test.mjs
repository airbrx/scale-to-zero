// Tests for the repo scorecard (assets/scorecard). Offline: fixtures are
// in-memory repos and the npm registry is a stub.
// Run: node test/scorecard.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createHttp } from "../assets/scorecard/lib/http.js";
import { parseRepoUrl, targetLabel } from "../assets/scorecard/lib/source.js";
import { scoreRepo, gradeFor, ruleGradeFor } from "../assets/scorecard/lib/engine.js";
import { PRINCIPLES } from "../assets/scorecard/lib/principles.js";
import { memoryRepo } from "../assets/scorecard/lib/providers/memory.js";
import { composeServices } from "../assets/scorecard/lib/packs/common.js";
import { countLock, packageOf } from "../assets/scorecard/lib/packs/node.js";
import { parsePage } from "../assets/scorecard/lib/packs/web.js";
import { PACKS } from "../assets/scorecard/lib/packs/index.js";
import { narrate } from "../assets/scorecard/lib/narrate/index.js";
import { PHRASES } from "../assets/scorecard/lib/narrate/phrasebook.js";
import { PATTERNS } from "../assets/scorecard/lib/narrate/patterns.js";
import { expand, seeded, article, pluralize, numberWord, list, clauseList } from "../assets/scorecard/lib/narrate/grammar.js";
import { renderSite } from "../shared/render.mjs";

// A fake AWS key for the secret-scanner tests, assembled at runtime so the
// repository itself never contains a key-shaped string -- otherwise this repo's
// own scorecard (and every other scanner) flags its tests.
const FAKE_KEY = ["AKIA", "QWERTYUIOPASDFGH"].join("");

let n = 0;
const t = (label, got, want) => {
  n++;
  assert.deepEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ------------------------------------------------------- principles drift
const manifesto = JSON.parse(await readFile(new URL("../content/manifesto.json", import.meta.url), "utf8"));
t("principles match manifesto.json, in order",
  PRINCIPLES.map((p) => p.name), manifesto.principles.slice(0, PRINCIPLES.length).map((p) => p.name));

// ------------------------------------------------------------ url parsing
const pick = (x) => x && { provider: x.provider, owner: x.owner, name: x.name, ref: x.ref, scope: x.scope };
t("bare owner/repo is GitHub", pick(parseRepoUrl("sindresorhus/ky")), { provider: "github", owner: "sindresorhus", name: "ky", ref: null, scope: "" });
t("https + .git", pick(parseRepoUrl("https://github.com/a/b.git")), { provider: "github", owner: "a", name: "b", ref: null, scope: "" });
t("scp-style ssh", pick(parseRepoUrl("git@github.com:a/b.git")), { provider: "github", owner: "a", name: "b", ref: null, scope: "" });
t("tree with folder", pick(parseRepoUrl("github.com/a/b/tree/dev/packages/api")), { provider: "github", owner: "a", name: "b", ref: "dev", scope: "packages/api" });
t("blob scores its folder", pick(parseRepoUrl("https://github.com/a/b/blob/main/src/index.js")), { provider: "github", owner: "a", name: "b", ref: "main", scope: "src" });
t("gitlab subgroup", parseRepoUrl("https://gitlab.com/g/sub/proj/-/tree/main/web").project, "g/sub/proj");
t("gitlab scope", parseRepoUrl("https://gitlab.com/g/sub/proj/-/tree/main/web").scope, "web");
t("unknown host rejected", parseRepoUrl("https://example.com/a/b"), null);
t("garbage rejected", parseRepoUrl("not a repo"), null);
t("label round-trips", targetLabel(parseRepoUrl("github.com/a/b/tree/dev/x")), "github.com/a/b/tree/dev/x");

// ---------------------------------------------------------------- helpers
t("compose services", composeServices(`version: "3"
services:
  app:
    build: .
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: x
volumes:
  data:
`).map((s) => [s.name, s.image]), [["app", null], ["db", "postgres:16"]]);

t("npm v3 lock", countLock("npm", JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/a": {}, "node_modules/a/node_modules/b": { dev: true } } })), { count: 2, runtime: 1 });
t("npm v1 lock", countLock("npm", JSON.stringify({ dependencies: { a: { dependencies: { b: {} } }, c: { dev: true } } })), { count: 3, runtime: 2 });
t("yarn lock", countLock("yarn", `# yarn lockfile v1\n\n"a@^1.0.0", "a@^1.1.0":\n  version "1.1.0"\n\nb@^2.0.0:\n  version "2.0.0"\n`), { count: 2, runtime: null });
t("pnpm lock", countLock("pnpm", `lockfileVersion: '9.0'\npackages:\n  a@1.0.0:\n    resolution: {}\n  '@s/b@2.0.0':\n    resolution: {}\nsnapshots:\n  a@1.0.0: {}\n`), { count: 2, runtime: null });

const shell = parsePage("index.html", `<html><body><div id="root"></div><script src="https://unpkg.com/x" integrity="sha384-abc"></script></body></html>`);
t("shell page has no text", shell.textLength, 0);
t("integrity parsed", shell.scripts[0].integrity, "sha384-abc");
t("empty mount is a shell", shell.shell, true);
const short = parsePage("index.html", `<body><p>Hello world! This is HTML5 Boilerplate.</p><script src="js/app.js"></script></body>`);
t("a short page is not a shell", short.shell, false);
const mounted = parsePage("index.html", `<body><h1>My app with a heading</h1><div id="app"></div><script type="module" src="/src/main.ts"></script></body>`);
t("empty #app with script is a shell even with a heading", mounted.shell, true);
const cra = parsePage("public/index.html", `<html><head><title>Conduit</title></head><body><div id="root"></div><!-- The build step will place the bundled scripts into the <body> tag. --></body></html>`);
t("CRA template with no script tag is still a shell", cra.shell, true);

// ---------------------------------------------------------------- stub http
const fakeFetch = async (url) => {
  if (url.includes("registry.npmjs.org/left-pad/")) return new Response(JSON.stringify({ name: "left-pad", deprecated: "use String.prototype.padStart()" }), { status: 200 });
  if (url.includes("registry.npmjs.org/")) return new Response("{}", { status: 404 });
  throw new Error(`unexpected request in test: ${url}`);
};
const http = createHttp({ fetchImpl: fakeFetch });

const words = (k) => Array.from({ length: k }, (_, i) => `word${i}`).join(" ");
const status = (card, id) => card.principles.flatMap((p) => p.checks).find((c) => c.id === id)?.status;

// ------------------------------------------------------------- flat fixture
const flat = await scoreRepo(memoryRepo({
  "README.md": `# Flat\n\n${words(200)}`,
  "index.html": `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><main><h1>Hello</h1><p>${words(80)}</p></main><script type="module" src="/app.js"></script></body></html>`,
  "about.html": `<!doctype html><html><body><article><p>${words(60)}</p></article></body></html>`,
  "app.js": `document.querySelector("h1").textContent = "Hi";\n`,
  "style.css": "body{margin:0}",
  "package.json": JSON.stringify({ name: "flat", engines: { node: ">=18" } }),
  "test/app.test.mjs": "import assert from 'node:assert';",
  ".github/workflows/ci.yml": "on: push",
  "data/items.json": "[]",
  "schemas/item.schema.json": "{}",
}, {}, http));

t("flat: grade", flat.grade, "A");
t("flat: no errors", flat.counts.error, 0);
t("flat: prerendered", status(flat, "web.prerendered"), "pass");
t("flat: no deps", status(flat, "node.direct-deps"), "pass");
t("flat: lockfile not needed", status(flat, "node.lockfile"), "pass");
t("flat: nothing always on", status(flat, "common.always-on"), "pass");
t("flat: page weight measured", status(flat, "web.script-weight"), "pass");
t("flat: deprecated n/a with no deps", status(flat, "node.deprecated"), "na");
t("flat: every principle scored", flat.principles.filter((p) => p.score === null).map((p) => p.id), []);

// ---------------------------------------------------------- bloated fixture
const deps = Object.fromEntries([
  ["express", "^4.19.0"], ["pg", "^8.11.0"], ["redis", "^4.6.0"], ["express-session", "^1.17.0"],
  ["node-cron", "^3.0.0"], ["left-pad", "^1.3.0"], ["firebase-admin", "^12.0.0"], ["tiny-thing", "^0.3.1"],
  ...Array.from({ length: 10 }, (_, i) => [`lib-${i}`, "^2.0.0"]),
]);
const bloated = await scoreRepo(memoryRepo({
  "package.json": JSON.stringify({ name: "bloated", dependencies: deps }),
  "server.js": `const express = require("express");\nconst app = express();\nconst KEY = "${FAKE_KEY}";\nsetInterval(() => {}, 1000);\napp.listen(process.env.PORT || 3000);\n`,
  ".env": "DB_PASSWORD=hunter2\n",
  "docker-compose.yml": "services:\n  app:\n    build: .\n  postgres:\n    image: postgres:16\n  redis:\n    image: redis:7\n  worker:\n    build: .\n",
  "infra/main.tf": `resource "aws_instance" "web" {}\nresource "aws_db_instance" "db" {}\nresource "aws_nat_gateway" "nat" {}\nresource "aws_lb" "lb" {}\n`,
  "public/index.html": `<!doctype html><html><body><div id="root"></div>
<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/other@1/x.js"></script>
<script src="http://cdn.example.com/y.js"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<script>import("https://esm.sh/preact")</script>
</body></html>`,
}, { pushedAt: "2021-01-01T00:00:00Z" }, http));

t("bloated: grade", bloated.grade, "F");
t("bloated: no errors", bloated.counts.error, 0);
t("bloated: secret found", status(bloated, "common.secrets"), "fail");
t("bloated: .env committed", status(bloated, "common.secret-files"), "fail");
t("bloated: always-on", status(bloated, "common.always-on"), "fail");
t("bloated: moving parts", status(bloated, "common.moving-parts"), "fail");
t("bloated: no tests", status(bloated, "common.tests"), "fail");
t("bloated: stale", status(bloated, "common.activity"), "fail");
t("bloated: no readme", status(bloated, "common.readme"), "fail");
t("bloated: shell page", status(bloated, "web.prerendered"), "fail");
t("bloated: third-party scripts", status(bloated, "web.third-party-scripts"), "fail");
t("bloated: plain http script", status(bloated, "web.integrity"), "fail");
t("bloated: tracker", status(bloated, "web.trackers"), "warn");
t("bloated: direct deps", status(bloated, "node.direct-deps"), "fail");
t("bloated: no lockfile", status(bloated, "node.lockfile"), "fail");
t("bloated: tree uncountable", status(bloated, "node.installed-tree"), "na");
t("bloated: left-pad", status(bloated, "node.trivial-deps"), "warn");
t("bloated: always-on server", status(bloated, "node.entry-points"), "fail");
t("bloated: in-process state", status(bloated, "node.in-process-state"), "fail");
t("bloated: live queries", status(bloated, "node.live-queries"), "fail");
t("bloated: lock-in", status(bloated, "node.lock-in"), "warn");
t("bloated: pre-1.0", status(bloated, "node.pre-1"), "warn");
t("bloated: deprecated", status(bloated, "node.deprecated"), "warn");
t("bloated: node version", status(bloated, "node.node-version"), "warn");
// The key must not appear anywhere on the card, including checks that quote a
// line of source for other reasons.
t("bloated: secret appears nowhere on the card", JSON.stringify(bloated).includes(FAKE_KEY), false);
const keyOnListenLine = await scoreRepo(memoryRepo({
  "package.json": JSON.stringify({ name: "k", dependencies: { express: "^4.0.0" } }),
  "server.js": `const k = "${FAKE_KEY}"; app.listen(3000);`,
}, {}, http));
t("secret on a quoted line is redacted", JSON.stringify(keyOnListenLine).includes(FAKE_KEY), false);

// A server on the Lambda Web Adapter scales to zero even though it listens.
const lwa = await scoreRepo(memoryRepo({
  "package.json": JSON.stringify({ name: "lwa", dependencies: { express: "^4.0.0" } }),
  "server.js": "require('express')().listen(process.env.PORT);",
  "Dockerfile": "FROM node:20\nCOPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter\n",
}, {}, http));
t("lwa: listen on a scale-to-zero runtime passes", status(lwa, "node.entry-points"), "pass");

// Rule 1 is measured for every repo, not just HTML and Node ones: a repo
// with nothing to wake passes it.
const goTool = await scoreRepo(memoryRepo({
  "README.md": words(200),
  "go.mod": "module example.com/tool\n\ngo 1.22\n\nrequire github.com/spf13/cobra v1.8.0\n",
  "main.go": "package main\nfunc main() {}\n",
}, {}, http));
t("go, no database: rule 1 is measured", goTool.principles.find((p) => p.id === "beast").score, 100);
t("go, no database: passes no-beast", status(goTool, "common.no-beast"), "pass");
const pyApp = await scoreRepo(memoryRepo({
  "requirements.txt": "flask==3.0.0\npsycopg2-binary==2.9.9\npgadmin-helper==1.0\n",
  "app.py": "print('hi')",
}, {}, http));
t("python + postgres driver: warns", status(pyApp, "common.no-beast"), "warn");
t("python: exact package names only", pyApp.principles.flatMap((p) => p.checks).find((c) => c.id === "common.no-beast").data.backends, ["psycopg2-binary"]);
t("bloated: compose postgres/redis + RDS is a beast", status(bloated, "common.no-beast"), "fail");
t("flat: nothing to wake", status(flat, "common.no-beast"), "pass");
t("go tool narrates rule 1 as a strength", narrate(goTool).reasons.beast.includes("wake"), true);

// JavaScript with no package.json is still JavaScript (the csvapi shape).
const csvapi = await scoreRepo(memoryRepo({
  "README.md": words(200),
  "csvapi.js": "const http = require('http');\nconst fs = require('node:fs');\nconst csv = require('csv-parser');\nconst server = http.createServer((req, res) => {});\nserver.listen(PORT);\n",
  "text.csv": "a,b\n1,2\n",
}, {}, http));
t("csvapi: JavaScript pack runs without package.json", csvapi.packs.map((p) => p.id).includes("node"), true);
t("csvapi: undeclared require is caught", status(csvapi, "node.lockfile"), "fail");
t("csvapi: undeclared names", csvapi.principles.flatMap((p) => p.checks).find((c) => c.id === "node.lockfile").data.undeclared, ["csv-parser"]);
t("csvapi: raw http server stays up", status(csvapi, "node.entry-points"), "fail");
t("csvapi: does not vouch for an undeclared version", narrate(csvapi).reasons.shiny.includes("floats"), true);
t("packageOf", ["fs/promises", "node:fs", "./x", "@scope/pkg/sub", "lodash/fp", "@/alias", "https://esm.sh/x", "#internal"].map(packageOf),
  [null, null, null, "@scope/pkg", "lodash", null, null, null]);

const goServer = await scoreRepo(memoryRepo({
  "go.mod": "module x\n\nrequire (\n\tgithub.com/lib/pq v1.10.9\n\tgolang.org/x/text v0.14.0 // indirect\n\tgithub.com/new/thing v0.3.0\n)\n",
  "main.go": "package main\nimport \"net/http\"\nfunc main() { http.ListenAndServe(\":8080\", nil) }\n",
}, {}, http));
t("go server: stays up", status(goServer, "common.other-servers"), "fail");
t("go server: direct deps only (indirect skipped)", goServer.principles.flatMap((p) => p.checks).find((c) => c.id === "common.other-deps").data.names, ["github.com/lib/pq", "github.com/new/thing"]);
t("go server: pre-1.0 pin", status(goServer, "common.other-pre-1"), "warn");
t("go server: pq is a beast", status(goServer, "common.no-beast"), "warn");
t("go server: narrated as a tower", narrate(goServer).pattern.id, "tower");

t("python: requirements parsed, dev manifests skipped", pyApp.principles.flatMap((p) => p.checks).find((c) => c.id === "common.other-deps").data.names, ["flask", "psycopg2-binary", "pgadmin-helper"]);
t("go tool: no deps is a win on rules 5 and 7", [status(goTool, "common.other-deps"), status(goTool, "common.other-pre-1")], ["pass", "pass"]);
t("go tool: no server is a win on rule 6", status(goTool, "common.other-servers"), "pass");
t("go tool: one declared dependency is not 'only its own code'", narrate(goTool).pattern?.id !== "own-code", true);
const pyScript = await scoreRepo(memoryRepo({ "README.md": words(200), "tool.py": "import csv\nprint('hi')\n", "tests/test_tool.py": "" }, {}, http));
t("dependency-free python script: its own code", narrate(pyScript).pattern?.id, "own-code");
t("dependency-free python script: rules 5-7 are wins", ["common.other-deps", "common.other-servers", "common.other-pre-1"].map((id) => status(pyScript, id)), ["pass", "pass", "pass"]);
t("node-only repo: floor checks step aside", ["common.other-deps", "common.other-servers", "common.other-pre-1", "common.other-lock-in"].map((id) => status(flat, id)), ["na", "na", "na", "na"]);

const readmeOnly = await scoreRepo(memoryRepo({ "README.md": words(200) }, {}, http));
for (const [label, card] of Object.entries({ flat, bloated, lwa, goTool, pyApp, csvapi, goServer, readmeOnly })) {
  t(`${label}: every rule is measured`, card.principles.filter((p) => p.score === null).map((p) => p.id), []);
}

// A failing read is named, not dropped.
const broken = memoryRepo({ "package.json": "{ not json", "README.md": words(200) }, {}, http);
const brokenCard = await scoreRepo(broken);
t("broken package.json surfaces as a notice", brokenCard.notices.some((x) => x.includes("package.json")), true);

// ------------------------------------------------------------ narration
t("article: initialism by letter name", article("EC2 instance"), "an EC2 instance");
t("article: acronym said as a word", article("NAT gateway"), "a NAT gateway");
t("article: grade letters", [article("A"), article("B"), article("F")], ["an A", "a B", "an F"]);
t("article: vowel letter, consonant sound", article("unique key"), "a unique key");
t("pluralize y", pluralize("dependency"), "dependencies");
t("pluralize last word of a phrase", pluralize("test file"), "test files");
t("number words to twenty, numerals after", [numberWord(3), numberWord(20), numberWord(1500)], ["three", "twenty", "1,500"]);
t("oxford list", list(["a", "b", "c"]), "a, b, and c");
t("clause list: one clause with a comma is left alone", clauseList(["installs 9 packages, 2 at runtime"]), "installs 9 packages, 2 at runtime");
t("clause list: semicolons when clauses carry commas", clauseList(["a, x", "b", "c"]), "a, x; b; and c");

const env = { rand: seeded(1), rules: { r: ["only"] }, maps: { m: { x: "ex" } } };
t("slot: number word + noun", expand("{#n|package}", { n: 1 }, env), "one package");
t("slot: numeral + irregular noun", expand("{n|child/children}", { n: 3 }, env), "3 children");
t("slot: agreement only", expand("{n~has/have}", { n: 2 }, env), "have");
t("slot: capped list", expand("{xs:2}", { xs: ["a", "b", "c", "d"] }, env), "a, b, and two more");
t("slot: or-list", expand("{xs/or}", { xs: ["a", "b"] }, env), "a or b");
t("slot: article", expand("{a:k}", { k: "RDS instance" }, env), "an RDS instance");
t("slot: lexicon map", expand("{v>m}", { v: ["x"] }, env), "ex");
t("rule expansion", expand("((r))", {}, env), "only");
assert.throws(() => expand("{missing}", {}, env), /has no value/);
assert.throws(() => expand("((nope))", {}, env), /no lexicon rule/);
n += 2;

// Every shipped check can be narrated in every verdict, with a fix.
for (const p of PACKS) {
  for (const c of p.checks) {
    const id = `${p.id}.${c.id}`;
    t(`phrasebook covers ${id}`, ["pass", "warn", "fail", "fix"].filter((k) => !PHRASES[id]?.[k]), []);
  }
}
const principleIds = new Set(PRINCIPLES.map((p) => p.id));
for (const pat of PATTERNS) t(`pattern ${pat.id} names real rules`, pat.rules.filter((r) => !principleIds.has(r)), []);

const middling = await scoreRepo(memoryRepo({
  "README.md": `# Mid\n\n${words(60)}`,
  "package.json": JSON.stringify({ name: "mid", dependencies: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`dep-${i}`, i === 0 ? "^0.9.0" : "^3.0.0"])).valueOf() }),
  "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`node_modules/p${i}`, i < 40 ? {} : { dev: true }])) }),
  "docker-compose.yml": "services:\n  web:\n    build: .\n  cache:\n    image: redis:7\n",
  "index.html": `<!doctype html><body><p>${words(50)}</p><script type="module">import x from "https://esm.sh/tiny";</script><script src="https://static.cloudflareinsights.com/beacon.min.js" integrity="sha384-x"></script></body>`,
  "keys/test/fixture.pem": "not a real key",
  "api/hello.js": "export default function handler(req, res) { res.end('hi'); }",
}, { archived: true }, http));

const cards = { flat, bloated, lwa, middling, keyOnListenLine };
for (const [label, card] of Object.entries(cards)) {
  const a = narrate(card);
  t(`narrate ${label}: deterministic`, narrate(card).text, a.text);
  const texts = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const { text } = narrate(card, { seed });
    texts.add(text);
    const bad = [/[{}]/, /\[|\]/, /\(\(|\)\)/, /undefined|NaN|\bnull\b/, / {2}/, / [,.;:](?=\s|$)/, /\w\.(env|gitignore)\b/, /[,;]{2}|\.\./, new RegExp(FAKE_KEY)]
      .find((re) => re.test(text.replace(/\n+/g, " ")));
    if (bad) assert.fail(`narrate ${label} seed ${seed} matched ${bad}:\n${text}`);
  }
  n++;
  t(`narrate ${label}: varies with the seed`, texts.size > 1, true);
}

const flatStory = narrate(flat);
t("flat: leads with a good pattern", ["static", "own-code", "flat"].includes(flatStory.pattern?.id), true);
t("flat: proper name keeps its case", flatStory.headline.startsWith("repo "), true);
const bloatedStory = narrate(bloated);
t("bloated: a leaked key leads", bloatedStory.pattern.id, "keys-in-the-open");
t("bloated: first fix is the key", bloatedStory.fixes[0].check, "common.secrets");
t("bloated: also sees the tower", bloatedStory.alsoNoticed.map((p) => p.id), ["tower"]);
t("bloated: tower combines rules 1, 3, 4, 6", bloatedStory.alsoNoticed[0].rules, [1, 3, 4, 6]);
t("bloated: every principle has a sentence", Object.keys(bloatedStory.byPrinciple).length, PRINCIPLES.length);
t("rule letters: a lone warn is a C, not an F", ruleGradeFor(50), "C");
t("rule letters: full scale", [100, 80, 60, 33, 0].map(ruleGradeFor), ["A", "B", "C", "D", "F"]);
t("overall letters keep the ten-point bands", [95, 85, 75, 65, 50].map(gradeFor), ["A", "B", "C", "D", "F"]);
t("report card: one short reason per rule", Object.keys(bloatedStory.reasons), PRINCIPLES.map((p) => p.id));
t("report card: reasons are single sentences", Object.values(bloatedStory.reasons).filter((r) => !/^(It|Nothing) /.test(r) || !r.endsWith(".") || /[.!?] [A-Z]/.test(r)), []);
t("report card: a failing rule gives its worst problem", bloatedStory.reasons.foundation.includes("credential"), true);
t("report card: a clean rule gives its strongest pass", flatStory.reasons.dependency.startsWith("It "), true);
t("lwa: server on a scale-to-zero runtime is not a tower", narrate(lwa).pattern?.id !== "tower", true);
t("middling: warn phrasing used", narrate(middling).byPrinciple.dependency.includes("eight runtime dependencies"), true);

// ------------------------------------------------------------------ render
const { files } = renderSite({
  site: { name: "N", shortName: "S", tagline: "T", description: "D", baseUrl: "https://x", author: "A", authorUrl: "https://a", manifestoUrl: "https://m", orgUrl: "https://o", locale: "en-US" },
  tax: { categories: {}, flatStackAngles: {} }, manifesto, articles: [],
});
t("scorecard page rendered", typeof files["scorecard.html"], "string");
t("scorecard page loads the module", files["scorecard.html"].includes('<script type="module" src="/assets/scorecard/app.js">'), true);
t("scorecard page has no inline script", /<script(?![^>]*\bsrc=)[^>]*>(?!\s*\{)/.test(files["scorecard.html"]), false);
t("nav links the scorecard", files["index.html"].includes('href="/scorecard.html"'), true);

console.log(`ok - ${n} scorecard assertions`);
