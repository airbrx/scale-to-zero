// Node.js: what it installs, what it keeps running, and what it wakes up.

import { prioritize, lineAt, TESTY, MINIFIED } from "../repo.js";
import { pass, warn, fail, na, tiered, plural } from "../result.js";
import { redact } from "../secrets.js";

const DB_DRIVERS = new Set([
  "pg", "pg-promise", "postgres", "@neondatabase/serverless", "mysql", "mysql2", "mariadb", "mongodb", "mongoose",
  "sequelize", "typeorm", "@prisma/client", "prisma", "knex", "drizzle-orm", "@mikro-orm/core", "objection",
  "redis", "ioredis", "@redis/client", "snowflake-sdk", "@google-cloud/bigquery", "@databricks/sql",
  "cassandra-driver", "oracledb", "mssql", "tedious", "neo4j-driver", "@elastic/elasticsearch", "elasticsearch",
  "@opensearch-project/opensearch", "@clickhouse/client", "couchbase", "nano", "better-sqlite3", "sqlite3",
]);

// Proprietary data APIs: the data can only be reached through the vendor's
// engine, on the vendor's terms. S3-style object storage is not on this list;
// it is the open door the manifesto asks for.
const LOCK_IN = {
  firebase: "Firebase", "firebase-admin": "Firebase", "@firebase/firestore": "Firestore",
  "@google-cloud/firestore": "Firestore", "@google-cloud/datastore": "Datastore",
  "@aws-sdk/client-dynamodb": "DynamoDB", "@aws-sdk/lib-dynamodb": "DynamoDB", "dynamoose": "DynamoDB",
  "@azure/cosmos": "Cosmos DB", faunadb: "Fauna", fauna: "Fauna", realm: "Realm",
  "snowflake-sdk": "Snowflake", "@google-cloud/bigquery": "BigQuery", "@databricks/sql": "Databricks SQL",
  "@google-cloud/spanner": "Spanner", "@planetscale/database": "PlanetScale",
};

// Packages the manifesto has in mind: "if twenty lines you understand will do,
// write them." Each of these is one line of standard JavaScript today.
const TRIVIAL = {
  "left-pad": "String.prototype.padStart", "pad-left": "String.prototype.padStart",
  "is-odd": "n % 2 !== 0", "is-even": "n % 2 === 0", "is-number": "Number.isFinite",
  isarray: "Array.isArray", "is-array": "Array.isArray", "is-string": "typeof s === \"string\"",
  "array-flatten": "Array.prototype.flat", "object-assign": "Object.assign",
  "repeat-string": "String.prototype.repeat", "is-negative-zero": "Object.is(n, -0)",
  "array-includes": "Array.prototype.includes", "string.prototype.padstart": "String.prototype.padStart",
  "has-own-prop": "Object.hasOwn", "is-plain-object": "a three-line function",
};

const SCHEDULERS = new Set(["node-cron", "cron", "node-schedule", "agenda", "bull", "bullmq", "bee-queue", "kue", "toad-scheduler", "bree"]);
const SOCKETS = new Set(["socket.io", "ws", "uws", "uWebSockets.js", "sockjs", "faye-websocket"]);
const SESSION_STORES = /^(connect-|express-mysql-session$|@quixo3\/prisma-session-store$|session-file-store$)/;
// require("x"), import ... from "x", import("x"), export ... from "x".
const IMPORT = /\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\bexport\s+[\w*{}\s,$]+\s+from\s+["']([^"']+)["']/g;
const BUILTINS = new Set(["assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram",
  "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path",
  "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys", "test", "timers",
  "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib"]);

/** The npm package a specifier loads, or null for builtins, relative paths,
 *  URLs, and bundler aliases ("@/x", "~/x", "#x", "virtual:x"). */
export function packageOf(spec) {
  if (!spec || /^(\.|\/|[a-z][\w+.-]*:|@\/|~\/?|#)/i.test(spec)) return null;
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  if (BUILTINS.has(name) || !/^(@[\w.-]+\/)?[\w.-]+$/.test(name)) return null;
  return name;
}

const SERVERLESS_WRAPPERS =new Set(["serverless-http", "@vendia/serverless-express", "@codegenie/serverless-express", "aws-serverless-express", "@fastify/aws-lambda", "@hono/node-server"]);

const LISTEN = /\.listen\(\s*(process\.env\.PORT|PORT|port|\d{2,5}|config\.port|options\.port|env\.PORT)\b|http\.createServer\(|Bun\.serve\(|Deno\.serve\(/g;
const HANDLERS = [
  [/exports\.handler\s*=|module\.exports\.handler\s*=|export\s+(const|let|async\s+function|function)\s+handler\b/g, "Lambda-style handler"],
  [/export\s+default\s*\{[\s\S]{0,400}?\bfetch\s*[(:]/g, "edge fetch handler"],
  [/functions\.(https|pubsub|firestore|scheduler)\.\w+|onRequest\s*\(/g, "Cloud Function"],
  [/app\.http\(\s*["']/g, "Azure Function"],
];
const ROUTE_FILE = /(^|\/)(pages\/)?api\/.+\.[cm]?[jt]sx?$|(^|\/)app\/(.+\/)?route\.[cm]?[jt]s$|^netlify\/(edge-)?functions\/|(^|\/)functions\/.+\.[cm]?[jt]s$/;

/** The source line around an offset, trimmed for display. */
const lineOf = (text, i) => {
  const start = text.lastIndexOf("\n", i) + 1;
  const end = text.indexOf("\n", i);
  const line = redact(text.slice(start, end === -1 ? undefined : end).trim());
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
};

const isRegistrySpec = (spec) => !/^(file:|link:|workspace:|portal:|git|https?:|github:|[\w-]+\/[\w.-]+(#.*)?$)/.test(String(spec));

// ------------------------------------------------------------ lockfiles
/** Installed package count. npm lockfiles also say which are dev-only, so
 *  `runtime` is filled in for npm and left null for the others. */
export function countLock(kind, text) {
  if (kind === "npm") {
    const j = JSON.parse(text);
    if (j.packages) {
      const entries = Object.entries(j.packages).filter(([k]) => k.includes("node_modules/"));
      return { count: entries.length, runtime: entries.filter(([, v]) => !v.dev).length };
    }
    let count = 0;
    let runtime = 0;
    const walk = (deps) => {
      for (const d of Object.values(deps ?? {})) { count++; if (!d.dev) runtime++; walk(d.dependencies); }
    };
    walk(j.dependencies);
    return { count, runtime };
  }
  return { count: countOther(kind, text), runtime: null };
}

function countOther(kind, text) {
  if (kind === "yarn") {
    return text.split(/\r?\n/).filter((l) => /^\S.*:\s*$/.test(l) && !l.startsWith("#") && !/^__metadata:/.test(l)).length;
  }
  if (kind === "pnpm") {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
    if (start === -1) return 0;
    let n = 0;
    for (let i = start + 1; i < lines.length && !/^\S/.test(lines[i]); i++) if (/^ {2}\S.*:\s*$/.test(lines[i])) n++;
    return n;
  }
  if (kind === "bun") {
    return (text.match(/^\s{4}"[^"]+":\s*\[/gm) ?? []).length;
  }
  throw new Error(`unknown lockfile kind ${kind}`);
}

// --------------------------------------------------------------- gather
async function gather(repo) {
  const pkgFiles = prioritize(
    repo.find(/(^|\/)package\.json$/).filter((f) => !TESTY.test(f.path)),
    [/^package\.json$/], 25);
  const { ok: pkgRead, failed } = await repo.readMany(pkgFiles.map((f) => f.path));
  const pkgs = [];
  for (const { path, text } of pkgRead) {
    try {
      pkgs.push({ path, json: JSON.parse(text) });
    } catch (err) {
      failed.push({ path, error: `invalid JSON: ${err.message}` });
    }
  }
  const root = pkgs.find((p) => p.path === "package.json") ?? pkgs[0] ?? null;
  const ownNames = new Set(pkgs.map((p) => p.json.name).filter(Boolean));

  const collect = (field) => {
    const out = new Map();
    for (const p of pkgs) {
      for (const [name, spec] of Object.entries(p.json[field] ?? {})) {
        if (ownNames.has(name) || out.has(name)) continue;
        out.set(name, { name, spec: String(spec), path: p.path });
      }
    }
    return [...out.values()];
  };
  const prodDeps = [...collect("dependencies"), ...collect("optionalDependencies")];
  const devDeps = collect("devDependencies").filter((d) => !prodDeps.some((p) => p.name === d.name));
  const allNames = new Set([...prodDeps, ...devDeps].map((d) => d.name));

  // The shallowest lockfile is the one the project installs from.
  const LOCKS = [[/(^|\/)(package-lock|npm-shrinkwrap)\.json$/, "npm"], [/(^|\/)yarn\.lock$/, "yarn"], [/(^|\/)pnpm-lock\.yaml$/, "pnpm"], [/(^|\/)bun\.lock$/, "bun"], [/(^|\/)bun\.lockb$/, "bun-binary"]];
  const lockFiles = LOCKS.flatMap(([re, kind]) => repo.find(re).map((f) => ({ ...f, kind })))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  let lock = null;
  if (lockFiles.length) {
    const f = lockFiles[0];
    if (f.kind === "bun-binary") lock = { path: f.path, kind: f.kind, count: null, error: "bun.lockb is binary; its contents cannot be counted" };
    else {
      try {
        lock = { path: f.path, kind: f.kind, ...countLock(f.kind, await repo.read(f.path, { maxBytes: 20_000_000 })) };
      } catch (err) {
        lock = { path: f.path, kind: f.kind, count: null, error: err.message };
      }
    }
  }

  const sources = prioritize(
    repo.find(/\.(m?js|cjs|ts|mts|cts|jsx|tsx)$/).filter((f) => !TESTY.test(f.path) && !MINIFIED.test(f.path)
      && !/\.d\.ts$|(^|\/)[\w.-]+\.config\.[cm]?[jt]s$|(^|\/)\.[\w-]+rc\.[cm]?js$/.test(f.path) && (f.size === null || f.size <= 300_000)),
    [/(^|\/)(server|app|index|main|handler|lambda|worker)\.[cm]?[jt]s$/i, ROUTE_FILE, /^(src|server|api|lib|functions|netlify|bin)\//, /^[^/]+$/], 150);
  const { ok: srcRead, failed: srcFailed } = await repo.readMany(sources.map((f) => f.path));
  failed.push(...srcFailed);

  const listeners = [];
  const handlers = [];
  const timers = [];
  const imported = new Map();
  for (const { path, text } of srcRead) {
    const listens = [...text.matchAll(LISTEN)];
    for (const m of listens) listeners.push({ path, line: lineAt(text, m.index), note: lineOf(text, m.index) });
    for (const [re, what] of HANDLERS) {
      for (const m of text.matchAll(re)) handlers.push({ path, line: lineAt(text, m.index), note: what });
    }
    if (ROUTE_FILE.test(path) && /export\s+(default|(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)|const\s+(GET|POST|handler))/.test(text)) {
      handlers.push({ path, note: "file-routed serverless function" });
    }
    if (listens.length) {
      for (const m of text.matchAll(/\bsetInterval\s*\(/g)) timers.push({ path, line: lineAt(text, m.index), note: "setInterval inside a server" });
    }
    for (const m of text.matchAll(IMPORT)) {
      const pkg = packageOf(m[1] ?? m[2] ?? m[3] ?? m[4]);
      if (pkg && !imported.has(pkg)) imported.set(pkg, { path, line: lineAt(text, m.index) });
    }
  }

  // Packages the code loads but no package.json declares. Without a
  // manifest, these are the whole dependency list -- and nothing pins them.
  const undeclared = [...imported].filter(([name]) => !allNames.has(name) && !ownNames.has(name))
    .map(([name, at]) => ({ name, spec: "undeclared", path: at.path, line: at.line }));
  prodDeps.push(...undeclared);
  for (const d of undeclared) allNames.add(d.name);
  for (const d of prodDeps) if (SERVERLESS_WRAPPERS.has(d.name)) handlers.push({ path: d.path, note: `${d.name} (runs the server inside a function)` });

  const nodeVersion = root?.json.engines?.node
    ?? (repo.rootFile(/^\.nvmrc$|^\.node-version$/) ? "pinned by version file" : null)
    ?? root?.json.volta?.node ?? null;

  return {
    pkgs, root, prodDeps, devDeps, allNames, lock, listeners, handlers, timers, nodeVersion, undeclared,
    vendored: repo.find(/(^|\/)node_modules\//, { includeVendored: true }).length,
    isCli: Boolean(root?.json.bin),
    unread: failed,
  };
}

const depEvidence = (list, note = (d) => `${d.name}@${d.spec}`) => list.map((d) => ({ path: d.path, note: note(d) }));

// --------------------------------------------------------------- checks
const checks = [
  {
    id: "direct-deps", principle: "dependency",
    title: "Few runtime dependencies",
    why: "A library you import is someone else's code, exploits, and outages running inside your walls.",
    run({ node: n }) {
      const data = { prod: n.prodDeps.length, dev: n.devDeps.length, names: n.prodDeps.map((d) => d.name) };
      const dev = n.devDeps.length ? ` (plus ${n.devDeps.length} dev-only)` : "";
      if (!n.prodDeps.length) return pass(`No runtime dependencies${dev}. Everything that ships, the authors wrote.`, [], data);
      return tiered(n.prodDeps.length, 5, 15, `${plural(n.prodDeps.length, "runtime dependency", "runtime dependencies")}${dev}.`, depEvidence(n.prodDeps), data);
    },
  },
  {
    id: "installed-tree", principle: "dependency", weight: 2,
    title: "A small installed tree",
    why: "The direct list is what you chose. The installed tree is what you actually run.",
    run({ node: n }) {
      if (n.vendored) {
        return fail(`node_modules is committed to the repository (${plural(n.vendored, "file")}).`,
          [{ path: "node_modules/", note: "vendored dependencies" }], { vendored: n.vendored, count: null, runtime: null });
      }
      if (!n.prodDeps.length && !n.devDeps.length) return pass("Nothing to install.", [], { vendored: 0, count: 0, runtime: 0 });
      if (!n.lock) return na("No lockfile, so the installed tree cannot be counted.");
      if (n.lock.count === null) return na(`Could not count ${n.lock.path}: ${n.lock.error}`);
      const r = n.lock.runtime;
      const split = r === null || r === n.lock.count ? ""
        : r === 0 ? ", all of them build and test tooling"
        : `, ${r} of them at runtime and the rest build and test tooling`;
      // Scored on the whole tree: a compromised dev dependency runs on the
      // build machine, which holds the deploy keys.
      return tiered(n.lock.count, 50, 300, `${plural(n.lock.count, "package")} installed${split}, per ${n.lock.path}.`, [{ path: n.lock.path }],
        { vendored: 0, count: n.lock.count, runtime: r });
    },
  },
  {
    id: "lockfile", principle: "foundation",
    title: "Installs are reproducible",
    why: "Without a lockfile, every install resolves fresh versions. The code you tested is not the code you ship.",
    run({ node: n }) {
      const data = { lock: n.lock?.path ?? null, prod: n.prodDeps.length, dev: n.devDeps.length };
      if (n.undeclared.length) {
        return fail(`Loads ${plural(n.undeclared.length, "package")} that no package.json declares: ${n.undeclared.map((d) => d.name).join(", ")}. Every install is a guess.`,
          n.undeclared.map((d) => ({ path: d.path, line: d.line, note: `${d.name} (undeclared)` })), { ...data, undeclared: n.undeclared.map((d) => d.name) });
      }
      if (!n.prodDeps.length && !n.devDeps.length) return pass("No dependencies, so nothing to lock.", [], data);
      if (n.lock) return pass(`Locked by ${n.lock.path}.`, [{ path: n.lock.path }], data);
      // Nothing ships with the package, so only the authors' own toolchain
      // floats. Worth pinning, not worth a failing grade.
      if (!n.prodDeps.length) return warn("No lockfile. Nothing ships with the package, but the dev toolchain resolves fresh on every install.", [], data);
      return fail("Dependencies are declared but no lockfile is committed.", [], data);
    },
  },
  {
    id: "trivial-deps", principle: "dependency",
    title: "No one-line packages",
    why: "If twenty lines you understand will do, write them.",
    run({ node: n }) {
      const hits = [...n.prodDeps, ...n.devDeps].filter((d) => TRIVIAL[d.name]);
      const data = { names: hits.map((d) => d.name), natives: hits.map((d) => TRIVIAL[d.name]) };
      if (!hits.length) return pass("No trivial micro-packages among the direct dependencies.", [], data);
      return tiered(hits.length, 0, 2, `${plural(hits.length, "package")} that the language now does natively.`, depEvidence(hits, (d) => `${d.name} → ${TRIVIAL[d.name]}`), data);
    },
  },
  {
    id: "entry-points", principle: "stateless", weight: 2,
    title: "Runs when called, not all day",
    why: "No idle compute burning money while it waits for traffic that never came.",
    run({ node: n, common: c }) {
      const zeroRuntime = c?.zeroRuntime ?? [];
      const wrapped = n.handlers.some((h) => /runs the server inside a function/.test(h.note));
      // `shape` is the one-word answer the narrator builds on.
      const data = { listeners: n.listeners.length, handlers: n.handlers.length, cli: n.isCli, shape: null };
      if (!n.listeners.length) {
        if (n.handlers.length) return pass(`Entry points are functions invoked per request (${plural(n.handlers.length, "handler")}).`, n.handlers.slice(0, 8), { ...data, shape: "functions" });
        return pass(n.isCli ? "A command-line tool: it runs when someone runs it." : "No long-running server found.", [], { ...data, shape: n.isCli ? "cli" : "none" });
      }
      if (zeroRuntime.length || wrapped) {
        return pass("A server, but deployed on a runtime that stops it when idle.", [...zeroRuntime, ...n.handlers, ...n.listeners].slice(0, 8), { ...data, shape: "server-on-zero" });
      }
      if (n.handlers.length) {
        return warn("Has both a long-running server and per-request handlers. Check which one production runs.", [...n.listeners, ...n.handlers].slice(0, 10), { ...data, shape: "mixed" });
      }
      return fail(`A long-running server (${plural(n.listeners.length, "listen call")}) and nothing in the repo that stops it when idle.`, n.listeners.slice(0, 10), { ...data, shape: "server" });
    },
  },
  {
    id: "in-process-state", principle: "stateless",
    title: "Holds nothing between requests",
    why: "Instances are cattle, not pets: swap one out and nothing notices.",
    run({ node: n }) {
      const found = [];
      const kinds = new Set();
      const names = new Set(n.prodDeps.map((d) => d.name));
      if (names.has("express-session") && ![...names].some((x) => SESSION_STORES.test(x))) {
        found.push({ path: n.prodDeps.find((d) => d.name === "express-session").path, note: "express-session with no external store (MemoryStore)" });
        kinds.add("sessions");
      }
      for (const d of n.prodDeps) {
        if (SCHEDULERS.has(d.name)) { found.push({ path: d.path, note: `${d.name}: jobs scheduled inside the process` }); kinds.add("schedulers"); }
        if (SOCKETS.has(d.name)) { found.push({ path: d.path, note: `${d.name}: long-lived connections pin an instance` }); kinds.add("sockets"); }
      }
      if (n.timers.length) kinds.add("timers");
      found.push(...n.timers);
      const data = { places: found.length, kinds: [...kinds] };
      if (!found.length) return pass("No in-memory sessions, in-process schedulers, or persistent connections found.", [], data);
      const make = kinds.size >= 2 ? fail : warn;
      return make(`${plural(found.length, "place")} where state lives inside the process.`, found, data);
    },
  },
  {
    id: "live-queries", principle: "beast",
    title: "Answers without waking a database",
    why: "The warehouse bills you precisely when it runs. Answer from a predictable key, not a fresh query.",
    run({ node: n }) {
      const hits = n.prodDeps.filter((d) => DB_DRIVERS.has(d.name));
      const data = { drivers: hits.map((d) => d.name) };
      if (!hits.length) return pass("No database drivers among the runtime dependencies.", [], data);
      return tiered(hits.length, 0, 1, `${plural(hits.length, "database client")} at runtime: requests can wake ${hits.length === 1 ? "a database" : "databases"}.`, depEvidence(hits), data);
    },
  },
  {
    id: "lock-in", principle: "gravity",
    title: "Data reachable without one vendor's engine",
    why: "Do not hand the keys to your own data to the engine sitting on top of it.",
    run({ node: n }) {
      const hits = [...n.prodDeps, ...n.devDeps].filter((d) => LOCK_IN[d.name]);
      const vendors = [...new Set(hits.map((d) => LOCK_IN[d.name]))];
      const data = { vendors };
      if (!hits.length) return pass("No proprietary data-store SDKs.", [], data);
      return tiered(vendors.length, 0, 1, `Data held behind ${vendors.join(", ")}.`, depEvidence(hits, (d) => `${d.name} (${LOCK_IN[d.name]})`), data);
    },
  },
  {
    id: "pre-1", principle: "shiny",
    title: "Built on settled libraries",
    why: "Proven, portable, and replaceable are features. A 0.x version is a library telling you it has not settled.",
    run({ node: n }) {
      const hits = n.prodDeps.filter((d) => /^[\^~=v]?0\.\d/.test(d.spec.trim()));
      const data = { names: hits.map((d) => d.name), unknown: n.undeclared.map((d) => d.name) };
      if (!hits.length) return pass("No pre-1.0 runtime dependencies.", [], data);
      return tiered(hits.length, 0, 2, `${plural(hits.length, "runtime dependency", "runtime dependencies")} still below 1.0.`, depEvidence(hits), data);
    },
  },
  {
    id: "deprecated", principle: "modernization",
    title: "No deprecated packages",
    why: "Respect what works; replace what doesn't. A deprecated package is its own author saying it doesn't.",
    async run({ node: n }, repo) {
      const candidates = [...n.prodDeps, ...n.devDeps].filter((d) => isRegistrySpec(d.spec)).slice(0, 80);
      if (!candidates.length) return na("No public-registry dependencies to look up.");
      const results = await Promise.all(candidates.map(async (d) => {
        try {
          const meta = await repo.http.json(`https://registry.npmjs.org/${d.name.replace("/", "%2f")}/latest`);
          return { d, deprecated: meta.deprecated ?? null };
        } catch (err) {
          // A 404 means private or unpublished: not ours to judge. Anything
          // else is a real failure and goes up as one.
          if (err.status === 404) return { d, deprecated: null, missing: true };
          throw err;
        }
      }));
      const hits = results.filter((r) => r.deprecated);
      const checked = results.filter((r) => !r.missing).length;
      const data = { checked, names: hits.map((r) => r.d.name) };
      if (!checked) return na("None of the dependencies are published on the public npm registry.", data);
      if (!hits.length) return pass(`None of the ${plural(checked, "package")} looked up on npm is deprecated.`, [], data);
      return tiered(hits.length, 0, 1, `${plural(hits.length, "dependency", "dependencies")} deprecated by ${hits.length === 1 ? "its" : "their"} own author.`,
        hits.map(({ d, deprecated }) => ({ path: d.path, note: `${d.name}: ${String(deprecated).slice(0, 140)}` })), data);
    },
  },
  {
    id: "node-version", principle: "modernization", weight: 0.5,
    title: "Declares the Node version it runs on",
    why: "Portable means anyone can run it without guessing the runtime.",
    run({ node: n }) {
      const data = { version: n.nodeVersion };
      return n.nodeVersion
        ? pass(`Node ${n.nodeVersion}.`, n.root ? [{ path: n.root.path }] : [], data)
        : warn("No engines.node, .nvmrc, or .node-version.", [], data);
    },
  },
];

export const node = {
  id: "node",
  label: "JavaScript / Node.js",
  // Any JavaScript counts, manifest or not. A server.js with no package.json
  // is still a server, and its require() calls are still dependencies -- just
  // undeclared ones.
  detect: (repo) => repo.find(/(^|\/)package\.json$/).length > 0
    || repo.find(/\.(m?js|cjs|ts|mts|cts|jsx|tsx)$/).some((f) => !TESTY.test(f.path) && !MINIFIED.test(f.path) && !/\.d\.ts$/.test(f.path)),
  gather,
  checks,
};
