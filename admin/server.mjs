// The admin plane.
//
// The project this was adapted from runs this shape behind the Lambda Web Adapter layer. We do not: the
// routing here is small enough that a native Function URL handler is less
// machinery, one fewer cross-account layer to depend on, and a faster cold
// start. "Every dependency is a decision" applies to our own stack too.
//
// One router, two entry points: `handler` for Lambda, and a plain node:http
// server for local development. They share every line of logic below.
//
// Every /api route except /api/health requires a verified Google ID token whose
// email is on the admin list. There is no dev bypass, no "auth disabled when
// unconfigured" path, and no route that reads an identity out of a request body.

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
import sharp from "sharp";

import {
  verifyGoogleIdToken, authorize, normalizeAdmins, validateAdminListChange,
  isOwner, AuthError, ROLES, issueSession, verifySession, looksLikeSession,
} from "./lib/auth.mjs";
import * as store from "./lib/store.mjs";
import { processLogs, readReport, readDay, readDetailWindow } from "./lib/stats.mjs";
import { renderSite } from "../shared/render.mjs";
import { validator } from "../shared/schema.mjs";
import { compileRoutes, matchRoute, operationIds } from "./lib/routes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

// ------------------------------------------------------------ origin lockdown
//
// The function URL is AuthType NONE and reachable by anyone who knows the
// hostname. That was always the trade-off (see infra/wire-cloudfront.mjs), and
// it was defensible because every /api route authenticates. But it meant any
// rate limit, WAF rule or edge check placed in front of CloudFront could be
// walked around by calling the .on.aws URL directly, and it left invocation
// itself -- cost and concurrency -- open to anyone.
//
// CloudFront now attaches a shared secret as an origin custom header. It
// overwrites any same-named header from the viewer before forwarding, so a
// caller coming through the CDN cannot spoof it, and a caller going direct does
// not have it.
//
// Two variables, not one, and the separation is the whole safety property:
// ORIGIN_SECRET makes the value known so /api/health can *report* whether the
// header arrived, and ORIGIN_ENFORCE makes it *required*. Deploy with the first
// only, confirm CloudFront is really sending it, then set the second. Flipping
// enforcement is a configuration change, so turning it back off is seconds
// rather than a redeploy.
const ORIGIN_SECRET = process.env.ORIGIN_SECRET ?? "";
const ORIGIN_ENFORCE = process.env.ORIGIN_ENFORCE === "1";
const ORIGIN_HEADER = "x-stz-origin";

/** "match" | "mismatch" | "missing" | "unconfigured" -- never throws. */
function originStatus(headers = {}) {
  if (!ORIGIN_SECRET) return "unconfigured";
  const got = headers[ORIGIN_HEADER] ?? headers[ORIGIN_HEADER.toUpperCase()] ?? "";
  if (!got) return "missing";
  const a = Buffer.from(String(got));
  const b = Buffer.from(ORIGIN_SECRET);
  // Length first: timingSafeEqual throws on a mismatch rather than returning
  // false, which would surface as a 500 instead of a clean 403.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "mismatch";
  return "match";
}
const ADMINS_KEY = "admins.json";
const MAX_BODY = 25 * 1024 * 1024;

const json = (status, obj, extraHeaders = {}) => ({
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  },
  body: JSON.stringify(obj),
});

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

// --------------------------------------------------------------------- authz
async function loadAdmins() {
  const doc = await store.getJson(ADMINS_KEY, null);
  if (doc === null) {
    // No list means nobody is authorized. Deliberately not "allow all".
    throw new AuthError("Admin list is missing. Run infra/seed-staging.mjs.", 503);
  }
  return normalizeAdmins(doc);
}

function bearer(headers) {
  const raw = headers["authorization"] ?? headers["Authorization"] ?? "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new AuthError("Missing Authorization: Bearer <token>");
  return m[1].trim();
}

/**
 * Two accepted credentials:
 *   stz.*  -- a session this server issued. HMAC verified, 12h life, and the
 *             role is re-checked against admins.json on every request so that
 *             revoking someone takes effect immediately rather than at their
 *             next sign-in.
 *   else   -- a Google ID token, which is only used to obtain a session.
 */
async function requireAdmin(headers) {
  const token = bearer(headers);
  const admins = await loadAdmins();

  if (looksLikeSession(token)) {
    const claims = verifySession(token, SESSION_SECRET);
    // Re-authorize rather than trusting the role baked into the token.
    return authorize({ email: claims.email, name: claims.name }, admins);
  }

  const identity = await verifyGoogleIdToken(token, GOOGLE_CLIENT_ID);
  return authorize(identity, admins);
}

// ------------------------------------------------------------------ content
async function loadConfigBundle() {
  const [site, tax, manifesto] = await Promise.all([
    store.getJson("_internal/config.json", null),
    store.getJson("_internal/taxonomy.json", null),
    store.getJson("_internal/manifesto.json", null),
  ]);
  if (!site || !tax || !manifesto) {
    throw new AuthError("Site config missing from staging. Run infra/seed-staging.mjs.", 503);
  }
  return { site: site.site, tax, manifesto };
}

const articleKey = (slug) => `_internal/articles/${slug}.json`;
const INDEX_KEY = "_internal/articles/index.json";

async function allArticles() {
  const index = await store.getJson(INDEX_KEY, []);
  const out = [];
  for (const slug of index) {
    const a = await store.getJson(articleKey(slug), null);
    if (a) out.push(a);
  }
  return out;
}

/**
 * Re-render every published article into staging. Cheap enough to do on every
 * save: the whole site is a handful of small files, and the alternative is
 * partial rebuilds that drift out of sync with the index and the feeds.
 */
async function rebuild() {
  const { site, tax, manifesto } = await loadConfigBundle();
  // Pages link style.css?v=<version>. Early deploys served the stylesheet as
  // immutable for a year, so a changed stylesheet needs a new URL or returning
  // readers never see it. The staging object's ETag is a content hash already;
  // pipeline/build.mjs does the same with a sha256 of the local file.
  const css = (await store.list("assets/style.css")).find((o) => o.key === "assets/style.css");
  if (!css) throw new Error("assets/style.css is missing from staging; deploy the site assets before rebuilding pages.");
  site.assetVersion = css.etag.slice(0, 10);
  const articles = (await allArticles()).filter((a) => a.status === "published");
  const { files } = renderSite({ site, tax, manifesto, articles });

  for (const [name, body] of Object.entries(files)) {
    const type = name.endsWith(".xml") ? "application/xml; charset=utf-8"
      : name.endsWith(".json") ? "application/json; charset=utf-8"
      : "text/html; charset=utf-8";
    await store.putText(name, body, type);
  }
  return Object.keys(files);
}

// -------------------------------------------------------------------- router
//
// The contract is admin/openapi.json. Routes come from its paths (lib/routes.mjs)
// and each operationId below is the one handler for that operation. The two
// are checked against each other at cold start: an operation with no handler,
// or a handler with no operation, stops the function from loading at all --
// which the deploy's health check catches -- rather than surfacing later as a
// 404 on the one route nobody tried.

const SPEC = JSON.parse(readFileSync(path.join(HERE, "openapi.json"), "utf8"));
const ROUTES = compileRoutes(SPEC);
const validate = validator(SPEC);

/** A 4xx with a message the caller may see, and optionally every problem found. */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Throw a 400 listing every way `value` fails schema `name`. */
function mustMatch(name, value) {
  const problems = validate(name, value);
  if (problems.length) {
    throw new HttpError(400, problems.length === 1 ? problems[0] : `${problems.length} problems with the request`, problems);
  }
}

const SLUG_RE = new RegExp(SPEC.components.schemas.Slug.pattern);

/** A strong validator for an article: changes whenever any byte of it does. */
const etagOf = (article) => `"${createHash("sha256").update(JSON.stringify(article)).digest("hex").slice(0, 20)}"`;

/**
 * Optimistic concurrency. A write that carries If-Match is refused when the
 * article has changed since the caller read it, instead of silently replacing
 * someone else's edit. Without the header the write goes through, as it always
 * has; the admin UI always sends it.
 */
function checkIfMatch(headers, current) {
  const raw = headers["if-match"] ?? headers["If-Match"];
  if (!raw) return;
  if (raw.trim() === "*") return;
  const tags = raw.split(",").map((t) => t.trim().replace(/^W\//, ""));
  if (!tags.includes(etagOf(current))) {
    throw new HttpError(412, "This article changed since you opened it. Reload it, reapply your edits, and save again.");
  }
}

/** Drop keys whose value is undefined, so they neither validate nor store. */
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function loadArticle(slug) {
  if (!SLUG_RE.test(slug)) return null;
  return store.getJson(articleKey(slug), null);
}

async function saveArticle(article, status, extraHeaders = {}) {
  mustMatch("Article", article);
  await store.putJson(articleKey(article.slug), article);
  await rebuild();
  return json(status, article, { etag: etagOf(article), ...extraHeaders });
}

const notFound = () => json(404, { error: "No such article" });

async function statsGuard() {
  if (!store.LOG_BUCKET) throw new HttpError(503, "Access logging is not enabled. Run infra/enable-logging.mjs.");
}

function statsWindow(query) {
  const days = Math.min(Number(query.get("days") ?? 30) || 30, 365);
  // ?date= scopes a read to one day, on both the summary and the detail.
  // Same parameter, same meaning, so the UI can hold one piece of state and
  // apply it to every tab.
  const date = query.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD");
  return { days, date };
}

/** One handler per operationId in admin/openapi.json. */
const HANDLERS = {
  // Unauthenticated liveness probe. `origin` reports whether CloudFront's
  // shared header arrived, which is what makes the lockdown verifiable before
  // it is enforced. It reveals that an origin check exists, not the secret.
  getHealth: async ({ headers }) => json(200, {
    ok: true,
    clientId: GOOGLE_CLIENT_ID || null,
    origin: originStatus(headers),
    enforcing: ORIGIN_ENFORCE,
  }),

  // Exchange a verified Google ID token for a session, so a one-hour ID token
  // does not become a one-hour login.
  createSession: async ({ actor }) => {
    const { token, expiresAt } = issueSession(actor, SESSION_SECRET);
    return json(200, { sessionToken: token, expiresAt, email: actor.email, role: actor.role, name: actor.displayName });
  },

  getMe: async ({ actor }) => json(200, { email: actor.email, role: actor.role, name: actor.displayName }),

  // ---- articles
  listArticles: async () => {
    const list = (await allArticles()).map((a) => ({
      slug: a.slug, date: a.date, headline: a.headline, dek: a.dek,
      status: a.status, templateType: a.templateType ?? "article",
      category: a.category, categoryLabel: a.categoryLabel,
    })).sort((x, y) => (x.date < y.date ? 1 : -1));
    return json(200, list);
  },

  getArticle: async ({ params }) => {
    const a = await loadArticle(params.slug);
    return a ? json(200, a, { etag: etagOf(a) }) : notFound();
  },

  createArticle: async ({ actor, asJson }) => {
    const b = asJson();
    mustMatch("ArticleCreate", b);
    const date = b.date ?? new Date().toISOString().slice(0, 10);
    const slug = b.slug ?? `${date}-${slugify(b.headline)}`;
    if (await store.exists(articleKey(slug))) {
      return json(409, { error: `An article with slug ${slug} already exists` });
    }
    const article = defined({
      slug, date,
      status: b.status ?? "draft",
      templateType: b.templateType ?? "article",
      headline: b.headline,
      dek: b.dek ?? "",
      category: b.category ?? "BILL_SHOCK",
      categoryLabel: b.categoryLabel ?? "Bill Shock",
      flatStackAngle: b.flatStackAngle ?? "precompute-and-cache",
      source: b.source ?? { title: "", url: "", publisher: "" },
      body: b.body ?? "",
      sections: b.sections,
      pullQuote: b.pullQuote ?? "",
      audio: b.audio ?? null,
      tags: b.tags ?? [],
      _brief: b._brief,
      _sources: b._sources,
      createdBy: actor.email,
      createdAt: new Date().toISOString(),
    });
    mustMatch("Article", article);
    // Article before index: a failed index write leaves a readable article,
    // never an index entry pointing at nothing. One render, once it is listed.
    await store.putJson(articleKey(slug), article);
    const index = await store.getJson(INDEX_KEY, []);
    if (!index.includes(slug)) await store.putJson(INDEX_KEY, [...index, slug]);
    await rebuild();
    return json(201, article, { etag: etagOf(article), location: `/api/articles/${slug}` });
  },

  // PUT replaces every editable field; the identity and creation record stay.
  replaceArticle: async ({ actor, params, headers, asJson }) => {
    const existing = await loadArticle(params.slug);
    if (!existing) return notFound();
    checkIfMatch(headers, existing);
    const b = asJson();
    mustMatch("ArticleReplace", b);
    return saveArticle(defined({
      ...b,
      slug: existing.slug, createdBy: existing.createdBy, createdAt: existing.createdAt,
      updatedBy: actor.email, updatedAt: new Date().toISOString(),
    }), 200);
  },

  // PATCH merges; what you leave out is kept. The slug is the page's name, so
  // the schema refuses it rather than orphaning the rendered file.
  updateArticle: async ({ actor, params, headers, asJson }) => {
    const existing = await loadArticle(params.slug);
    if (!existing) return notFound();
    checkIfMatch(headers, existing);
    const b = asJson();
    mustMatch("ArticlePatch", b);
    return saveArticle(defined({
      ...existing, ...b,
      slug: existing.slug, updatedBy: actor.email, updatedAt: new Date().toISOString(),
    }), 200);
  },

  deleteArticle: async ({ params, headers }) => {
    const existing = await loadArticle(params.slug);
    if (!existing) return notFound();
    checkIfMatch(headers, existing);
    const slug = existing.slug;
    const index = await store.getJson(INDEX_KEY, []);
    await store.putJson(INDEX_KEY, index.filter((s) => s !== slug));
    await store.remove(articleKey(slug));
    await store.remove(`${slug}.html`);
    await rebuild();
    return json(200, { deleted: slug });
  },

  // ---- media: images are resized here, audio is stored as uploaded
  uploadMedia: async ({ query, body }) => {
    const kind = query.get("kind") ?? "image";
    const filename = query.get("filename") ?? `upload-${Date.now()}`;
    if (!body?.length) return json(400, { error: "Empty upload" });
    const stem = slugify(filename.replace(/\.[a-z0-9]+$/i, "")) || "file";

    if (kind === "image") {
      const base = `media/${Date.now()}-${stem}`;
      const meta = await sharp(body).metadata();
      // Two renditions: a display-width webp and a thumbnail. The original is
      // deliberately not kept -- it is the largest object and nothing reads it.
      const full = await sharp(body).rotate().resize({ width: 1400, withoutEnlargement: true })
        .webp({ quality: 82 }).toBuffer();
      const thumb = await sharp(body).rotate().resize({ width: 480, withoutEnlargement: true })
        .webp({ quality: 74 }).toBuffer();
      await store.putBuffer(`${base}.webp`, full, "image/webp");
      await store.putBuffer(`${base}-thumb.webp`, thumb, "image/webp");
      return json(201, { url: `/${base}.webp`, thumbnail: `/${base}-thumb.webp`,
        width: meta.width, height: meta.height, bytes: full.length });
    }

    if (kind === "audio") {
      const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "mp3").toLowerCase();
      const mime = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4",
        wav: "audio/wav", ogg: "audio/ogg", opus: "audio/opus" }[ext] ?? "audio/mpeg";
      const key = `media/audio/${Date.now()}-${stem}.${ext}`;
      await store.putBuffer(key, body, mime);
      // Duration is not derivable without decoding; the browser measures it and
      // sends it with the article, which keeps ffmpeg out of this bundle.
      return json(201, { url: `/${key}`, mimeType: mime, byteLength: body.length });
    }

    return json(400, { error: `Unknown media kind: ${kind}` });
  },

  // ---- admins: readable by any admin, writable by owners only
  getAdmins: async ({ actor }) => json(200, { admins: await loadAdmins(), roles: ROLES, you: actor.email }),

  replaceAdmins: async ({ actor, asJson }) => {
    if (!isOwner(actor)) return json(403, { error: "Only an owner can change the admin list" });
    const b = asJson();
    mustMatch("AdminListUpdate", b);
    const next = normalizeAdmins(b);
    validateAdminListChange(next, actor);
    await store.putJson(ADMINS_KEY, { admins: next, updatedBy: actor.email, updatedAt: new Date().toISOString() });
    return json(200, { admins: next });
  },

  // ---- stats: CloudFront access logs, processed on demand
  getStats: async ({ query }) => {
    await statsGuard();
    const { days, date } = statsWindow(query);
    const report = await readReport(store, days, date);
    // A day outside the window would otherwise come back as a page of zeroes,
    // which reads as "no traffic that day" rather than "you asked for a day
    // this window does not cover".
    if (date && !report.scope) return json(404, { error: `No processed logs for ${date} in the last ${days} days` });
    return json(200, report);
  },

  // The drill-down tabs: geo, bots, acquisition, security. Kept off the
  // summary because it is a read per day in the window, and the overview must
  // stay one object.
  getStatsDetail: async ({ query }) => {
    await statsGuard();
    const { days, date } = statsWindow(query);
    if (date) {
      const one = await readDay(store, date);
      return one ? json(200, one) : json(404, { error: `No processed logs for ${date}` });
    }
    const report = await readReport(store, days);
    const detail = await readDetailWindow(store, report.dates);
    return json(200, detail ?? { date: null, empty: true });
  },

  // A command: fold newly delivered log objects into the stored daily report.
  processStats: async ({ query }) => {
    await statsGuard();
    const ownHost = new URL((await loadConfigBundle()).site.baseUrl).hostname;
    const result = await processLogs({
      s3: store.s3, logBucket: store.LOG_BUCKET, store, ownHost,
      force: query.get("force") === "1",
    });
    return json(200, result);
  },

  // ---- publish
  previewPublish: async () => json(200, await store.computeChangeset()),

  // A command: re-render, copy staging to live, invalidate.
  publish: async ({ actor }) => {
    await rebuild();
    const changeset = await store.computeChangeset();
    const logs = [];
    const result = await store.publish(changeset, (m) => logs.push(m));
    return json(200, { ...result, logs, by: actor.email });
  },
};

// Contract and code must agree before the first request is served.
{
  const declared = new Set(operationIds(SPEC));
  const missing = [...declared].filter((id) => !HANDLERS[id]);
  const extra = Object.keys(HANDLERS).filter((id) => !declared.has(id));
  if (missing.length || extra.length) {
    throw new Error(`admin/openapi.json and server.mjs disagree. No handler for: ${missing.join(", ") || "-"}. No operation for: ${extra.join(", ") || "-"}.`);
  }
}

async function routeApi({ method, segments, query, headers, body }) {
  const route = matchRoute(ROUTES, method, segments);
  const where = `/api/${segments.join("/")}`;
  if (route.status === 400) return json(400, { error: `Malformed path ${where}` });
  if (route.status === 404) return json(404, { error: `No route for ${where}` });
  if (route.status === 405) {
    return json(405, { error: `${method} is not allowed on ${where}. Allowed: ${route.allow.join(", ")}.` }, { allow: route.allow.join(", ") });
  }

  const actor = route.public ? null : await requireAdmin(headers);
  const asJson = () => {
    if (!body || !body.length) return {};
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw new HttpError(400, "Request body is not valid JSON");
    }
  };
  return HANDLERS[route.operationId]({ actor, params: route.params, query, headers, body, asJson });
}

// LOCAL DEVELOPMENT ONLY. In production the admin UI is static objects in S3
// and CloudFront never routes /admin* here; this exists so `STZ_LOCAL=1` still
// serves the UI off disk without needing a second static server. It is not
// reachable through the deployed Lambda -- handleRequest does not call it.
async function routeUi(pathname) {
  const rel = pathname.replace(/^\/admin\/?/, "") || "index.html";
  if (rel.includes("..")) return { status: 400, headers: { "content-type": "text/plain" }, body: "bad path" };
  const type = rel.endsWith(".js") ? "text/javascript; charset=utf-8"
    : rel.endsWith(".css") ? "text/css; charset=utf-8"
    : rel.endsWith(".json") ? "application/json; charset=utf-8"
    : "text/html; charset=utf-8";
  try {
    const body = await readFile(path.join(HERE, "ui", rel), "utf8");
    return {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "no-store",
        // Google Identity Services opens a popup and talks to it via
        // postMessage. The default COOP severs that channel, which surfaces as
        // "Cross-Origin-Opener-Policy policy would block the window.postMessage
        // call" in the console and can leave FedCM sign-in hanging.
        "cross-origin-opener-policy": "same-origin-allow-popups",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-content-type-options": "nosniff",
      },
      body,
    };
  } catch {
    return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
  }
}

/** The one router. Both entry points funnel through here. */
export async function handleRequest({ method, pathname, query, headers, body }) {
  try {
    // Before routing, before auth, before anything: a request that did not
    // arrive through CloudFront gets nothing. Deliberately a flat 403 with no
    // detail -- someone probing the function URL directly learns only that it
    // refused, not why or what header it wanted.
    if (ORIGIN_ENFORCE && originStatus(headers) !== "match") {
      return json(403, { error: "Forbidden" });
    }

    // /admin/* is no longer served here. The UI is static objects in the live
    // bucket under the admin/ prefix, which SKIP_PREFIXES excludes from both
    // sides of computeChangeset -- so a bad publish still cannot reach the tool
    // that fixes a bad publish, which was the original reason it lived in this
    // bundle. See infra/deploy-admin-ui.mjs.
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const segments = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
      return await routeApi({ method, segments, query, headers, body });
    }
    return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
  } catch (err) {
    // An HttpError was raised on purpose, with a message written for the
    // caller -- including the 503 that says logging is off. Return it as is.
    if (err instanceof HttpError) {
      return json(err.status, { error: err.message, ...(err.details?.length > 1 ? { details: err.details } : {}) });
    }
    const status = err instanceof AuthError ? err.status : 500;
    if (status >= 500) console.error(err);
    // 4xx messages are safe to return: they describe the caller's own request.
    // 5xx are not, so they get a generic string and the detail stays in logs.
    return json(status, { error: status >= 500 ? "Internal error" : err.message });
  }
}

// -------------------------------------------------------- Lambda Function URL
export async function handler(event) {
  const rc = event.requestContext ?? {};
  const method = rc.http?.method ?? "GET";
  const rawPath = rc.http?.path ?? event.rawPath ?? "/";
  const query = new URLSearchParams(event.rawQueryString ?? "");

  let body = null;
  if (event.body) {
    body = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
    if (body.length > MAX_BODY) {
      return { statusCode: 413, headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Request body too large" }) };
    }
  }

  const res = await handleRequest({
    method, pathname: rawPath, query,
    headers: event.headers ?? {}, body,
  });

  return { statusCode: res.status, headers: res.headers, body: res.body };
}

// ------------------------------------------------------------- local dev only
if (process.env.STZ_LOCAL === "1") {
  const http = await import("node:http");
  const PORT = Number(process.env.PORT ?? 8080);
  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    // Local dev serves the admin UI from disk. CloudFront serves it from S3;
    // the deployed Lambda serves it not at all.
    const out = (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))
      ? await routeUi(url.pathname)
      : await handleRequest({
        method: req.method, pathname: url.pathname, query: url.searchParams,
        headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : null,
      });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  }).listen(PORT, () => console.log(`admin (local) listening on ${PORT}`));
}
