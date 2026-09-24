// jsDelivr's GitHub mirror. No API key, no rate limit anyone has published,
// CORS on both the listing and the files. Used when GitHub's anonymous API
// limit runs out.
//
// The trade: jsDelivr caches a branch for up to 12 hours, and it cannot report
// activity dates or the default branch. Both are stated on the scorecard
// rather than papered over.

import { Repo } from "../repo.js";

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

export const jsdelivr = {
  id: "jsdelivr",
  label: "jsDelivr mirror",

  // Never matched from a URL directly; source.js routes GitHub targets here.
  match: () => null,

  async open(target, http) {
    const pkg = `${enc(target.owner)}/${enc(target.name)}`;
    // Without the API there is no default branch to ask for, so try the two
    // names that cover nearly every repository, and report which one worked.
    const refs = target.ref ? [target.ref] : ["main", "master"];
    let listing = null;
    let ref = null;
    const misses = [];
    for (const r of refs) {
      try {
        listing = await http.json(`https://data.jsdelivr.com/v1/packages/gh/${pkg}@${encodeURIComponent(r)}?structure=flat`);
        ref = r;
        break;
      } catch (err) {
        if (err.status !== 404) throw err;
        misses.push(r);
      }
    }
    if (!listing) {
      throw new Error(`jsDelivr has no ${target.owner}/${target.name} at ${misses.join(" or ")}. Name the branch in the URL (…/tree/<branch>) and try again.`);
    }

    const repo = new Repo({
      http,
      scope: target.scope,
      files: listing.files.map((f) => ({ path: f.name.replace(/^\//, ""), size: f.size })),
      readRaw: (path) => http.text(`https://cdn.jsdelivr.net/gh/${pkg}@${encodeURIComponent(ref)}/${enc(path)}`),
      blobUrl: (path, line) => `https://github.com/${pkg}/blob/${enc(ref)}/${enc(path)}${line ? `#L${line}` : ""}`,
      meta: {
        provider: "github",
        source: "jsDelivr mirror",
        fullName: `${target.owner}/${target.name}`,
        webUrl: `https://github.com/${pkg}`,
        description: "",
        ref,
        defaultBranch: target.ref ? null : ref,
        // jsDelivr gives a per-file hash but no tree hash. Hash the listing
        // itself so the cache still keys on content.
        sha: `jsd-${await digest(listing.files.map((f) => f.name + f.hash).join("\n"))}`,
        pushedAt: null,
        archived: false,
        stars: null,
        license: null,
      },
    });
    repo.notices.push(`Read through the jsDelivr mirror of the "${ref}" branch, which can lag GitHub by up to 12 hours. Activity dates are not available this way.`);
    return repo;
  },
};

async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
}
