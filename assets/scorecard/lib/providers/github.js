// GitHub, read anonymously.
//
// Two API calls per scan: the repo (for the default branch and activity) and
// the recursive tree (every path and size in one response). File contents come
// from raw.githubusercontent.com, which does not count against the 60/hour
// unauthenticated API limit. When that limit is hit, source.js falls back to
// the jsDelivr mirror and says so on the scorecard.

import { Repo } from "../repo.js";

const API = "https://api.github.com";
const HEADERS = { Accept: "application/vnd.github+json" };
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

export const github = {
  id: "github",
  label: "GitHub",

  /** @param {URL} url */
  match(url) {
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    const [owner, rawName, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean);
    if (!owner || !rawName) return null;
    const name = rawName.replace(/\.git$/, "");
    const hasRef = (kind === "tree" || kind === "blob") && ref;
    // A /blob/ link points at a file; score the directory it lives in.
    const scopeParts = hasRef ? (kind === "blob" ? rest.slice(0, -1) : rest) : [];
    return {
      provider: "github", owner, name,
      ref: hasRef ? decodeURIComponent(ref) : null,
      scope: scopeParts.map(decodeURIComponent).join("/"),
    };
  },

  async open(target, http) {
    const base = `${API}/repos/${enc(target.owner)}/${enc(target.name)}`;

    let info;
    try {
      info = await http.json(base, { headers: HEADERS });
    } catch (err) {
      if (err.status === 404) {
        throw new Error(`github.com/${target.owner}/${target.name} was not found. It may be private; this tool reads public repositories only.`);
      }
      throw err;
    }

    const ref = target.ref ?? info.default_branch;
    let tree;
    try {
      tree = await http.json(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers: HEADERS });
    } catch (err) {
      if (err.status === 404 || err.status === 409) {
        throw new Error(`No branch, tag, or commit named "${ref}" in ${info.full_name} (or the repository is empty).`);
      }
      throw err;
    }

    const repo = new Repo({
      http,
      scope: target.scope,
      truncated: Boolean(tree.truncated),
      files: tree.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, size: e.size })),
      readRaw: (path) => http.text(`https://raw.githubusercontent.com/${enc(info.full_name)}/${enc(ref)}/${enc(path)}`),
      blobUrl: (path, line) => `${info.html_url}/blob/${enc(ref)}/${enc(path)}${line ? `#L${line}` : ""}`,
      meta: {
        provider: "github",
        source: "GitHub API",
        fullName: info.full_name,
        webUrl: target.scope ? `${info.html_url}/tree/${enc(ref)}/${enc(target.scope)}` : info.html_url,
        description: info.description ?? "",
        ref,
        defaultBranch: info.default_branch,
        // The tree hash is content-addressed: same hash, same files, same score.
        // That makes it the right cache key, and it costs no extra request.
        sha: tree.sha,
        pushedAt: info.pushed_at ?? null,
        archived: Boolean(info.archived),
        stars: info.stargazers_count ?? null,
        license: info.license?.spdx_id ?? null,
      },
    });
    if (tree.truncated) {
      repo.notices.push("GitHub truncated the file list for this repository (it is very large). Checks below saw only part of it.");
    }
    return repo;
  },
};
