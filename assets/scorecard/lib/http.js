// HTTP for the scorecard. Runs in the browser (window.fetch) and in Node
// (tools/scorecard.mjs injects a curl-backed fetch), so nothing here may touch
// the DOM or the filesystem.
//
// Every host this talks to answers with Access-Control-Allow-Origin: *, which is
// the whole reason the scorecard needs no server. Git's own smart-HTTP endpoint
// and GitHub's tarball endpoint do NOT send it, so the tool cannot speak git
// protocol from a browser without a proxy -- and a proxy is a server.
//
// Failures throw. A 404 or a rate limit is information the caller has to act on,
// never an empty result.

export class HttpError extends Error {
  constructor(url, status, detail, { rateLimited = false, resetAt = null } = {}) {
    super(`${detail} (HTTP ${status}) ${url}`);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
    this.rateLimited = rateLimited;
    this.resetAt = resetAt;
  }
}

/**
 * @param {object} opts
 * @param {typeof fetch} [opts.fetchImpl]  injected in Node; the browser's by default
 * @param {number} [opts.concurrency]      raw hosts tolerate more, but 8 is polite
 * @param {number} [opts.timeoutMs]
 */
export function createHttp({ fetchImpl, concurrency = 8, timeoutMs = 25000 } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const stats = { requests: 0, bytes: 0, byHost: {}, githubRemaining: null, githubResetAt: null };

  let active = 0;
  const waiting = [];
  const acquire = () => (active < concurrency
    ? (active++, Promise.resolve())
    : new Promise((resolve) => waiting.push(resolve)));
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else active--;
  };

  async function request(url, { headers = {}, as = "text" } = {}) {
    await acquire();
    const host = new URL(url).host;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      stats.requests++;
      stats.byHost[host] = (stats.byHost[host] ?? 0) + 1;

      let res;
      try {
        // cache: "no-cache" makes the browser revalidate with If-None-Match.
        // GitHub does not count a 304 against the 60/hour unauthenticated limit,
        // so a rescan of an unchanged repo costs nothing.
        res = await doFetch(url, { headers, cache: "no-cache", signal: ctrl?.signal });
      } catch (err) {
        const why = err.name === "AbortError" ? `timed out after ${timeoutMs / 1000}s` : err.message;
        throw new HttpError(url, 0, `network error: ${why}`);
      }

      if (host === "api.github.com") {
        const rem = res.headers.get("x-ratelimit-remaining");
        const reset = res.headers.get("x-ratelimit-reset");
        if (rem !== null) stats.githubRemaining = Number(rem);
        if (reset !== null) stats.githubResetAt = new Date(Number(reset) * 1000).toISOString();
      }

      if (!res.ok) {
        const limited = (res.status === 403 || res.status === 429)
          && (res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429);
        const reset = res.headers.get("x-ratelimit-reset");
        // Hosts explain their refusals in the body -- jsDelivr's 403 says
        // "Package size exceeded the configured limit of 50 MB." Keep that
        // sentence; "HTTP 403" alone sent a reader hunting for a private repo.
        const body = await res.text();
        const said = /"message"\s*:\s*"([^"]{1,300})"/.exec(body)?.[1];
        const what = limited ? "rate limited" : "request failed";
        throw new HttpError(url, res.status, said ? `${what}: ${said}` : what, {
          rateLimited: limited,
          resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
        });
      }

      const text = await res.text();
      stats.bytes += text.length;
      if (as === "text") return { text, headers: res.headers };
      try {
        return { json: JSON.parse(text), headers: res.headers };
      } catch (err) {
        throw new HttpError(url, res.status, `invalid JSON: ${err.message}`);
      }
    } finally {
      if (timer) clearTimeout(timer);
      release();
    }
  }

  return {
    stats,
    text: async (url, opts) => (await request(url, { ...opts, as: "text" })).text,
    json: async (url, opts) => (await request(url, { ...opts, as: "json" })).json,
    /** JSON plus response headers, for providers that paginate by Link header. */
    jsonWithHeaders: (url, opts) => request(url, { ...opts, as: "json" }),
  };
}
