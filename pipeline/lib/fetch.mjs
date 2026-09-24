// HTTP via curl (per CLAUDE.md: curl, not fetch, on Windows).
// Flags are not decorative:
//   -L              theregister/dcd/verge all 302 to their real feed
//   --ssl-no-revoke Windows schannel throws CRYPT_E_REVOCATION_OFFLINE on several publishers
// Failures throw. We never return an empty array to paper over a dead source.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class FetchError extends Error {
  constructor(url, detail) {
    super(`fetch failed: ${url}\n  ${detail}`);
    this.name = "FetchError";
    this.url = url;
  }
}

export async function curlText(url, { userAgent, timeoutSec = 30 } = {}) {
  const args = [
    "-sS", "-L",
    "--ssl-no-revoke",
    "--compressed",
    "--max-time", String(timeoutSec),
    "-A", userAgent ?? "scale-to-zero-report/0.1",
    "-w", "\n__HTTP_STATUS__%{http_code}",
    url,
  ];

  let stdout;
  try {
    const res = await execFileAsync("curl", args, { maxBuffer: 32 * 1024 * 1024 });
    stdout = res.stdout;
  } catch (err) {
    throw new FetchError(url, `curl exited ${err.code ?? "?"}: ${String(err.stderr || err.message).trim()}`);
  }

  const marker = stdout.lastIndexOf("\n__HTTP_STATUS__");
  if (marker === -1) throw new FetchError(url, "no status marker in curl output");

  const status = Number(stdout.slice(marker + "\n__HTTP_STATUS__".length).trim());
  const body = stdout.slice(0, marker);

  if (status < 200 || status >= 300) {
    throw new FetchError(url, `HTTP ${status} (${body.length} bytes)`);
  }
  if (!body.trim()) {
    throw new FetchError(url, `HTTP ${status} but empty body`);
  }
  return body;
}

export async function curlJson(url, opts) {
  const text = await curlText(url, opts);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new FetchError(url, `invalid JSON: ${err.message}; head=${text.slice(0, 160)}`);
  }
}

// Bounded concurrency. Results keep input order; each entry is {ok, value} or {ok:false, error}.
// Callers decide what a failure means -- this helper does not swallow it.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error, item: items[i] };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
