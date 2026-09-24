// An in-memory repository. The tests score fixtures through it, so the checks
// are exercised without a network; nothing in the browser uses it.

import { Repo } from "../repo.js";

/**
 * @param {Record<string,string>} tree  path -> contents
 * @param {object} [meta]  overrides for the provider metadata
 * @param {object} http    client for checks that consult a registry
 */
export function memoryRepo(tree, meta = {}, http) {
  return new Repo({
    http,
    files: Object.entries(tree).map(([path, text]) => ({ path, size: new TextEncoder().encode(text).length })),
    readRaw: async (path) => {
      if (!(path in tree)) throw new Error(`memory repo has no ${path}`);
      return tree[path];
    },
    blobUrl: (path, line) => `memory://${path}${line ? `#L${line}` : ""}`,
    meta: {
      provider: "memory", source: "memory", fullName: "fixture/repo", webUrl: "memory://",
      description: "", ref: "main", defaultBranch: "main", sha: "fixture",
      pushedAt: new Date().toISOString(), archived: false, stars: null, license: null,
      ...meta,
    },
  });
}
