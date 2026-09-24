// A repository as the checks see it: a file index plus lazy, memoized reads.
//
// Providers differ in how they list and fetch; everything above this line of
// the stack sees one shape. Reads are memoized as promises, so two language
// packs asking for the same file concurrently cost one request, not two.
//
// Nothing is written anywhere. The whole repo lives in memory for the length
// of one scan and is gone when the tab closes.

/** Directories that hold someone else's code or generated output. Their
 *  existence can be a finding (committed node_modules), but their contents are
 *  never scanned as if the repo's authors wrote them. */
export const VENDORED = /(^|\/)(node_modules|bower_components|jspm_packages|vendor|third_party|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.output|coverage|\.git)\//;
export const MINIFIED = /[.-]min\.(js|css)$|\.bundle\.js$|\.chunk\.js$/;
export const TESTY = /(^|\/)(test|tests|__tests__|spec|specs|e2e|fixtures?|__mocks__|examples?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** Largest file the scorecard will read. Anything bigger is a bundle, a
 *  dataset, or a fixture -- not something a person wrote and maintains. */
export const MAX_READ_BYTES = 400_000;

export class Repo {
  /**
   * @param {object} init
   * @param {object} init.meta     provider metadata (see providers/*.js)
   * @param {{path:string,size:number|null}[]} init.files  every blob, repo-relative
   * @param {(path:string) => Promise<string>} init.readRaw  provider fetch
   * @param {(path:string, line?:number) => string} init.blobUrl  link for evidence
   * @param {string} [init.scope]   subdirectory the user asked for, "" for the root
   * @param {boolean} [init.truncated]  provider could not list every file
   * @param {object} init.http     shared client, for checks that consult a registry
   */
  constructor({ meta, files, readRaw, blobUrl, scope = "", truncated = false, http }) {
    const prefix = scope ? scope.replace(/^\/+|\/+$/g, "") + "/" : "";
    this.meta = meta;
    this.scope = prefix.slice(0, -1);
    this.truncated = truncated;
    this.http = http;
    this.notices = [];
    this.reads = 0;
    this.onRead = null;

    this.files = files
      .filter((f) => !prefix || f.path.startsWith(prefix))
      .map((f) => ({ path: f.path.slice(prefix.length), size: f.size ?? null }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    this.byPath = new Map(this.files.map((f) => [f.path, f]));

    this._prefix = prefix;
    this._readRaw = readRaw;
    this._blobUrl = blobUrl;
    this._memo = new Map();
  }

  get sizesKnown() { return this.files.some((f) => f.size !== null); }

  has(path) { return this.byPath.has(path); }

  /** Files whose repo-relative path matches. Vendored trees are excluded
   *  unless explicitly asked for. */
  find(re, { includeVendored = false } = {}) {
    return this.files.filter((f) => re.test(f.path) && (includeVendored || !VENDORED.test(f.path)));
  }

  /** Case-insensitive lookup of a file at the root of the scope. */
  rootFile(re) {
    return this.files.find((f) => !f.path.includes("/") && re.test(f.path)) ?? null;
  }

  /** @param {{maxBytes?: number}} [opts]  lockfiles need more than source does */
  read(path, { maxBytes = MAX_READ_BYTES } = {}) {
    if (!this._memo.has(path)) {
      const f = this.byPath.get(path);
      if (!f) return Promise.reject(new Error(`not in repo: ${path}`));
      if (f.size !== null && f.size > maxBytes) {
        return Promise.reject(new Error(`${path} is ${f.size} bytes, over the ${maxBytes} read limit`));
      }
      this._memo.set(path, this._readRaw(this._prefix + path).then((text) => {
        this.reads++;
        this.onRead?.(path, this.reads);
        return text;
      }));
    }
    return this._memo.get(path);
  }

  async readJson(path, opts) {
    const text = await this.read(path, opts);
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`${path} is not valid JSON: ${err.message}`);
    }
  }

  /** Read many files. A file that fails to read is reported, not dropped: the
   *  caller gets it back in `failed` and decides whether that matters. */
  async readMany(paths) {
    const out = await Promise.allSettled(paths.map((p) => this.read(p).then((text) => ({ path: p, text }))));
    const ok = [];
    const failed = [];
    out.forEach((r, i) => (r.status === "fulfilled"
      ? ok.push(r.value)
      : failed.push({ path: paths[i], error: r.reason.message })));
    return { ok, failed };
  }

  link(path, line) { return this._blobUrl(this._prefix + path, line); }
}

/** Pick the files most worth reading, capped. Earlier patterns win. */
export function prioritize(files, patterns, cap) {
  const scored = files.map((f) => {
    const i = patterns.findIndex((re) => re.test(f.path));
    return { f, rank: i === -1 ? patterns.length : i, depth: f.path.split("/").length };
  });
  scored.sort((a, b) => a.rank - b.rank || a.depth - b.depth || (a.f.path < b.f.path ? -1 : 1));
  return scored.slice(0, cap).map((s) => s.f);
}

/** 1-based line number of a character offset. */
export function lineAt(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
