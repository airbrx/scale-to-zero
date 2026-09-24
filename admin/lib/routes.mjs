// Routing, straight from the contract.
//
// The route table is admin/openapi.json's `paths`, not a copy of it: a path
// and method are routable exactly when the spec declares them, and each
// operationId names the one handler in server.mjs that serves it. Nothing to
// keep in sync by hand, so nothing to drift.
//
// Pure on purpose -- no AWS SDK, no sharp -- so the tests can load it without
// the Lambda's dependencies.

const METHODS = ["get", "put", "post", "patch", "delete"];

/** Compile the spec's paths into matchers: "/articles/{slug}" -> segments with a param. */
export function compileRoutes(spec) {
  return Object.entries(spec.paths).map(([template, item]) => ({
    template,
    parts: template.split("/").filter(Boolean),
    ops: Object.fromEntries(METHODS.filter((m) => item[m]).map((m) => [m.toUpperCase(), {
      operationId: item[m].operationId,
      // An operation with `security: []` is public; everything else needs a session.
      public: Array.isArray(item[m].security) && item[m].security.length === 0,
      // POST /session takes a Google ID token rather than a session.
      googleToken: (item[m].security ?? []).some((s) => "googleIdToken" in s),
    }])),
  }));
}

/**
 * @returns {{operationId:string, params:object, public:boolean, googleToken:boolean}
 *          | {status:405, allow:string[]} | {status:404} | {status:400}}
 */
export function matchRoute(routes, method, segments) {
  // A malformed escape ("%E0%A4%A") is the caller's mistake: a 400, not a crash.
  let decoded;
  try {
    decoded = segments.map(decodeURIComponent);
  } catch {
    return { status: 400 };
  }
  for (const r of routes) {
    if (r.parts.length !== decoded.length) continue;
    const params = {};
    const hit = r.parts.every((p, i) => {
      const m = /^\{(\w+)\}$/.exec(p);
      if (m) { params[m[1]] = decoded[i]; return true; }
      return p === decoded[i];
    });
    if (!hit) continue;
    const op = r.ops[method];
    if (!op) return { status: 405, allow: Object.keys(r.ops) };
    return { ...op, params };
  }
  return { status: 404 };
}

/** Every operationId the spec declares. */
export const operationIds = (spec) =>
  Object.values(spec.paths).flatMap((item) => METHODS.filter((m) => item[m]).map((m) => item[m].operationId));
