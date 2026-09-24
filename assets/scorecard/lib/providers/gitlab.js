// GitLab.com, read anonymously through the v4 API.
//
// The tree endpoint pages 100 entries at a time and does not report file
// sizes, so size-based checks mark themselves not-applicable on GitLab instead
// of guessing.

import { Repo } from "../repo.js";

const API = "https://gitlab.com/api/v4";
const MAX_PAGES = 60; // 6,000 entries; beyond that the list is marked truncated
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

export const gitlab = {
  id: "gitlab",
  label: "GitLab",

  /** @param {URL} url */
  match(url) {
    if (url.hostname !== "gitlab.com") return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    const [project, after = ""] = path.split("/-/");
    const parts = project.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [kind, ref, ...rest] = after.split("/").filter(Boolean);
    const hasRef = (kind === "tree" || kind === "blob") && ref;
    const scopeParts = hasRef ? (kind === "blob" ? rest.slice(0, -1) : rest) : [];
    const projectPath = parts.map(decodeURIComponent).join("/").replace(/\.git$/, "");
    return {
      provider: "gitlab",
      owner: parts.slice(0, -1).join("/"),
      name: projectPath.split("/").pop(),
      project: projectPath,
      ref: hasRef ? decodeURIComponent(ref) : null,
      scope: scopeParts.map(decodeURIComponent).join("/"),
    };
  },

  async open(target, http) {
    const base = `${API}/projects/${encodeURIComponent(target.project)}`;

    let info;
    try {
      info = await http.json(base);
    } catch (err) {
      if (err.status === 404) {
        throw new Error(`gitlab.com/${target.project} was not found. It may be private; this tool reads public repositories only.`);
      }
      throw err;
    }
    if (!info.default_branch && !target.ref) throw new Error(`${info.path_with_namespace} has no default branch; it is probably empty.`);
    const ref = target.ref ?? info.default_branch;

    let commit;
    try {
      commit = await http.json(`${base}/repository/commits/${encodeURIComponent(ref)}`);
    } catch (err) {
      if (err.status === 404) throw new Error(`No branch, tag, or commit named "${ref}" in ${info.path_with_namespace}.`);
      throw err;
    }

    const files = [];
    let url = `${base}/repository/tree?recursive=true&per_page=100&pagination=keyset&order_by=path&ref=${encodeURIComponent(commit.id)}`;
    let pages = 0;
    while (url && pages < MAX_PAGES) {
      const { json, headers } = await http.jsonWithHeaders(url);
      for (const e of json) if (e.type === "blob") files.push({ path: e.path, size: null });
      url = /<([^>]+)>;\s*rel="next"/.exec(headers.get("link") ?? "")?.[1] ?? null;
      pages++;
    }
    const truncated = Boolean(url);

    const repo = new Repo({
      http,
      scope: target.scope,
      truncated,
      files,
      readRaw: (path) => http.text(`${base}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(commit.id)}`),
      blobUrl: (path, line) => `${info.web_url}/-/blob/${enc(ref)}/${enc(path)}${line ? `#L${line}` : ""}`,
      meta: {
        provider: "gitlab",
        source: "GitLab API",
        fullName: info.path_with_namespace,
        webUrl: target.scope ? `${info.web_url}/-/tree/${enc(ref)}/${enc(target.scope)}` : info.web_url,
        description: info.description ?? "",
        ref,
        defaultBranch: info.default_branch,
        sha: commit.id,
        pushedAt: info.last_activity_at ?? commit.committed_date ?? null,
        archived: Boolean(info.archived),
        stars: info.star_count ?? null,
        license: null,
      },
    });
    if (truncated) repo.notices.push(`Listed the first ${files.length} files only; the repository is larger than the scorecard pages through.`);
    return repo;
  },
};
