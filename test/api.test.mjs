// The admin API against its contract, admin/openapi.json.
// Run: node test/api.test.mjs
//
// This loads the real admin/server.mjs -- router, auth, validation, renderer --
// with only the S3 store and sharp swapped for in-memory stand-ins
// (test/stubs/). Every response is checked against the schema the spec
// declares for that operation and status, so the contract is enforced in both
// directions: the server must accept what the spec says, and return what it
// promises.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { register } from "node:module";

register("./stubs/loader.mjs", import.meta.url);
process.env.SESSION_SECRET = "api-test-secret-that-is-long-enough-0123456789";

const { handleRequest } = await import("../admin/server.mjs");
const mem = await import("./stubs/store.mjs");
const { issueSession } = await import("../admin/lib/auth.mjs");
const { validator } = await import("../shared/schema.mjs");
const { compileRoutes, operationIds } = await import("../admin/lib/routes.mjs");

const readJson = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const spec = await readJson("admin/openapi.json");
const validate = validator(spec);

let n = 0;
const t = (label, got, want) => {
  n++;
  assert.deepEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ------------------------------------------------------------------ fixture
const OWNER = "owner@example.test";
const EDITOR = "editor@example.test";
function seed() {
  mem.__reset({
    "admins.json": { admins: [{ email: OWNER, role: "owner", name: "Owner" }, { email: EDITOR, role: "editor", name: "Ed" }] },
    "_internal/config.json": { site: { name: "Test Report", shortName: "Test", tagline: "t", description: "d", baseUrl: "https://example.test", author: "A", authorUrl: "https://a.test", manifestoUrl: "https://m.test", orgUrl: "https://o.test", org: "o", locale: "en-US", orgLogo: "https://o.test/logo.png", repoUrl: "https://g.test/repo", airbrx: { about: "https://o.test/about", flatStack: "https://o.test/fs", cache: "https://o.test/cache", scan: "https://o.test/scan", howItWorks: "https://o.test/how", gatewayBuilt: "https://o.test/built" } } },
    "_internal/articles/index.json": [],
    "assets/style.css": "body{}",
  });
}
const taxonomy = await readJson("pipeline/taxonomy.json");
const manifesto = await readJson("content/manifesto.json");
const seedContent = async () => {
  await mem.putJson("_internal/taxonomy.json", taxonomy);
  await mem.putJson("_internal/manifesto.json", manifesto);
};

const tokenFor = (email, role) => issueSession({ email, role, name: null }, process.env.SESSION_SECRET).token;
const ownerToken = tokenFor(OWNER, "owner");
const editorToken = tokenFor(EDITOR, "editor");

// ------------------------------------------------------------------ client
const templateFor = (path) => {
  const segs = path.split("?")[0].split("/").filter(Boolean);
  return Object.keys(spec.paths).find((tpl) => {
    const parts = tpl.split("/").filter(Boolean);
    return parts.length === segs.length && parts.every((p, i) => p.startsWith("{") || p === segs[i]);
  });
};

/** Check a response body against the schema the spec declares for it. */
function conforms(method, path, status, body) {
  const tpl = templateFor(path);
  let r = spec.paths[tpl]?.[method.toLowerCase()]?.responses?.[String(status)];
  if (!r) return [`spec declares no ${status} for ${method} ${tpl}`];
  if (r.$ref) r = spec.components.responses[r.$ref.split("/").pop()];
  const schema = r.content?.["application/json"]?.schema;
  if (!schema) return [];
  const name = (ref) => ref.split("/").pop();
  if (schema.$ref) return validate(name(schema.$ref), body);
  if (schema.type === "array" && schema.items?.$ref) return body.flatMap((x) => validate(name(schema.items.$ref), x));
  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => validate(name(s.$ref), body));
    return results.some((e) => e.length === 0) ? [] : results.flat();
  }
  return [];
}

async function call(method, path, { token = ownerToken, body, headers = {}, raw } = {}) {
  const [pathname, qs = ""] = path.split("?");
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const res = await handleRequest({
    method, pathname: `/api${pathname}`, query: new URLSearchParams(qs), headers: h,
    body: raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body))),
  });
  const json = res.body ? JSON.parse(res.body) : null;
  const problems = conforms(method, pathname, res.status, json);
  // Router-level answers (no route, wrong method, malformed path) apply to every
  // path and are documented once, in the spec's description.
  const routerLevel = res.status === 405 || (res.status === 404 && json?.error?.startsWith("No route"))
    || (res.status === 400 && json?.error?.startsWith("Malformed path"));
  if (problems.length && !routerLevel) {
    assert.fail(`${method} ${path} -> ${res.status} does not match the contract:\n  ${problems.join("\n  ")}\n  body: ${res.body.slice(0, 300)}`);
  }
  return { status: res.status, headers: res.headers, json };
}

// ------------------------------------------------------------ the contract
seed();
await seedContent();

// Code and contract agree: server.mjs loaded at all, which it refuses to do
// when an operation lacks a handler. Every operation is also reachable.
t("every operation id is unique", new Set(operationIds(spec)).size, operationIds(spec).length);
for (const r of compileRoutes(spec)) {
  for (const method of Object.keys(r.ops)) {
    const path = r.template.replace("{slug}", "2026-01-01-nothing-here");
    const res = await call(method, path, { body: method === "GET" || method === "DELETE" ? undefined : {} });
    n++;
    assert.ok(res.status !== 405 && !(res.status === 404 && res.json?.error?.startsWith("No route")),
      `${method} ${r.template} is in the spec but the server does not route it (got ${res.status})`);
  }
}

// ------------------------------------------------------------------ routing
seed();
await seedContent();
t("health is public", (await call("GET", "/health", { token: null })).status, 200);
t("everything else needs a session", (await call("GET", "/me", { token: null })).status, 401);
const wrongMethod = await call("PATCH", "/health", { token: null });
t("wrong method is 405, not 404", wrongMethod.status, 405);
t("405 says what is allowed", wrongMethod.headers.allow, "GET");
t("unknown path is 404", (await call("GET", "/nope")).status, 404);
t("malformed escape is 400", (await call("GET", "/articles/%E0%A4%A")).status, 400);

// --------------------------------------------------------------- validation
const noHeadline = await call("POST", "/articles", { body: {} });
t("create needs a headline", [noHeadline.status, noHeadline.json.error], [400, "headline is required"]);
const typo = await call("POST", "/articles", { body: { headline: "Hi", headlnie: "typo", status: "live" } });
t("every problem is listed", [typo.status, typo.json.details?.sort()],
  [400, ["headlnie is not a known field", 'status must be one of "draft", "published"'].sort()]);
t("bad JSON is 400", (await call("POST", "/articles", { raw: Buffer.from("{nope") })).status, 400);

// ------------------------------------------------------------------ create
const created = await call("POST", "/articles", {
  body: { headline: "Hello, flat world", date: "2026-09-24", tags: ["keep-me"], _brief: { note: "research" } },
});
const slug = "2026-09-24-hello-flat-world";
t("create is 201", created.status, 201);
t("create sets Location", created.headers.location, `/api/articles/${slug}`);
t("create returns an ETag", /^"[0-9a-f]{20}"$/.test(created.headers.etag), true);
t("defaults applied", [created.json.status, created.json.templateType, created.json.createdBy], ["draft", "article", OWNER]);
t("duplicate slug is 409", (await call("POST", "/articles", { body: { headline: "Hello, flat world", date: "2026-09-24" } })).status, 409);
t("listed", (await call("GET", "/articles")).json.map((a) => a.slug), [slug]);

const got = await call("GET", `/articles/${slug}`);
t("GET returns the same ETag", got.headers.etag, created.headers.etag);

// ------------------------------------------------------------------- PATCH
const patched = await call("PATCH", `/articles/${slug}`, { body: { dek: "Now with a dek." }, headers: { "if-match": got.headers.etag } });
t("PATCH merges", [patched.status, patched.json.dek, patched.json.tags, patched.json._brief], [200, "Now with a dek.", ["keep-me"], { note: "research" }]);
t("PATCH stamps who and when", patched.json.updatedBy, OWNER);
t("PATCH changes the ETag", patched.headers.etag !== got.headers.etag, true);

const stale = await call("PATCH", `/articles/${slug}`, { body: { dek: "Overwrite!" }, headers: { "if-match": got.headers.etag } });
t("stale If-Match is 412", stale.status, 412);
t("the lost update did not happen", (await call("GET", `/articles/${slug}`)).json.dek, "Now with a dek.");
t("If-Match * matches", (await call("PATCH", `/articles/${slug}`, { body: { pullQuote: "q" }, headers: { "if-match": "*" } })).status, 200);
t("slug cannot be changed", (await call("PATCH", `/articles/${slug}`, { body: { slug: "other" } })).json.error, "slug is not a known field");
t("empty PATCH is 400", (await call("PATCH", `/articles/${slug}`, { body: {} })).status, 400);

// --------------------------------------------------------------------- PUT
// What the old admin UI sent with PUT: every field it edits, but not tags.
// A merge used to keep tags; a true replace must refuse rather than drop them.
const oldUiPayload = {
  headline: "Hello, flat world", dek: "d", status: "draft", templateType: "article", date: "2026-09-24",
  category: "BILL_SHOCK", categoryLabel: "Bill Shock", flatStackAngle: "precompute-and-cache",
  source: { title: "", url: "", publisher: "", figure: null, discussionUrl: null },
  body: "<p>b</p>", sections: null, pullQuote: "", audio: null,
};
const partialPut = await call("PUT", `/articles/${slug}`, { body: oldUiPayload });
t("PUT without every field is refused, not merged", [partialPut.status, partialPut.json.error], [400, "tags is required"]);
t("…and nothing was lost", (await call("GET", `/articles/${slug}`)).json.tags, ["keep-me"]);
const replaced = await call("PUT", `/articles/${slug}`, { body: { ...oldUiPayload, tags: [] } });
t("PUT replaces", [replaced.status, replaced.json.tags, "_brief" in replaced.json], [200, [], false]);
t("PUT keeps identity and creation", [replaced.json.slug, replaced.json.createdBy], [slug, OWNER]);

// ------------------------------------------------------------------ publish
const pub = await call("PATCH", `/articles/${slug}`, { body: { status: "published" } });
t("published", pub.status, 200);
t("rendered into staging", mem.__keys().includes(`${slug}.html`), true);
t("pages carry the versioned stylesheet", /style\.css\?v=[0-9a-f]{10}/.test(mem.__text("index.html")), true);
const preview = await call("GET", "/publish");
t("preview lists the page", preview.json.upload.includes(`${slug}.html`), true);
const done = await call("POST", "/publish");
t("publish copies to live", [done.status, mem.__keys("live").includes(`${slug}.html`), done.json.by], [200, true, OWNER]);

// ------------------------------------------------------------------ delete
const current = await call("GET", `/articles/${slug}`);
t("DELETE with stale If-Match is 412", (await call("DELETE", `/articles/${slug}`, { headers: { "if-match": '"00000000000000000000"' } })).status, 412);
t("DELETE", (await call("DELETE", `/articles/${slug}`, { headers: { "if-match": current.headers.etag } })).json, { deleted: slug });
t("DELETE again is 404", (await call("DELETE", `/articles/${slug}`)).status, 404);
t("page removed from staging", mem.__keys().includes(`${slug}.html`), false);

// ------------------------------------------------------------ media, admins
t("image upload", (await call("POST", "/media?kind=image&filename=Cat%20Photo.jpg", { raw: Buffer.from("jpegbytes") })).status, 201);
t("audio upload", (await call("POST", "/media?kind=audio&filename=ep1.mp3", { raw: Buffer.from("mp3") })).json.mimeType, "audio/mpeg");
t("unknown media kind", (await call("POST", "/media?kind=video", { raw: Buffer.from("x") })).status, 400);
t("admins readable by editors", (await call("GET", "/admins", { token: editorToken })).json.you, EDITOR);
t("admins writable by owners only", (await call("PUT", "/admins", { token: editorToken, body: { admins: [] } })).status, 403);
t("malformed admin list is 400", (await call("PUT", "/admins", { body: { admins: "everyone" } })).status, 400);
t("stats without logging is 503", (await call("GET", "/stats")).status, 503);
t("session exchange", (await call("POST", "/session")).json.email, OWNER);

// --------------------------------------------------------- scheduled stats
// The Lambda's only non-HTTP path: EventBridge's {"job":"process-stats"}.
const { handler } = await import("../admin/server.mjs");
await assert.rejects(handler({ job: "process-stats" }), /LOG_BUCKET is not configured/, "a scheduled run with logging off fails loudly");
await assert.rejects(handler({ job: "delete-everything" }), /unrecognised direct invocation/, "unknown direct invocations are refused");
await assert.rejects(handler({}), /unrecognised direct invocation/, "an empty event is refused");
n += 3;
const viaUrl = await handler({ requestContext: { http: { method: "GET", path: "/api/health" } }, rawPath: "/api/health", headers: {} });
t("HTTP events still route normally", viaUrl.statusCode, 200);

// ------------------------------------------------------- articles on disk
// pipeline/build.mjs enforces this too; here it fails before a build does.
for (const f of (await readdir(new URL("../articles/", import.meta.url))).filter((f) => f.endsWith(".json"))) {
  t(`articles/${f} matches the Article schema`, validate("Article", await readJson(`articles/${f}`)), []);
}

console.log(`ok - ${n} API contract assertions`);
