// Turns whatever the reader pasted into a provider and a target, then opens it.
//
// Adding a host means writing one provider (match + open) and listing it here.

import { github } from "./providers/github.js";
import { gitlab } from "./providers/gitlab.js";
import { jsdelivr } from "./providers/jsdelivr.js";

export const PROVIDERS = [github, gitlab];

/**
 * Accepts https URLs, bare host/path, `owner/repo` (GitHub), and scp-style
 * `git@host:owner/repo.git`. Returns null for anything no provider claims.
 */
export function parseRepoUrl(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  s = s.replace(/^git@([^:]+):/, "https://$1/");
  s = s.replace(/^git\+/, "").replace(/^(ssh|git):\/\/(git@)?/, "https://");
  if (/^[\w.-]+\/[\w.-]+\/?$/.test(s) && !s.split("/")[0].includes(".")) s = `https://github.com/${s}`;
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;

  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  for (const p of PROVIDERS) {
    const t = p.match(url);
    if (t) return t;
  }
  return null;
}

/** Canonical short form, used in share links and the cache index. */
export function targetLabel(t) {
  const host = t.provider === "gitlab" ? "gitlab.com" : "github.com";
  const path = t.provider === "gitlab" ? t.project : `${t.owner}/${t.name}`;
  const ref = t.ref ? `/tree/${t.ref}${t.scope ? `/${t.scope}` : ""}` : "";
  return `${host}/${path}${ref}`;
}

export async function openRepo(target, http) {
  const provider = PROVIDERS.find((p) => p.id === target.provider);
  if (!provider) throw new Error(`No provider for ${target.provider}`);
  try {
    return await provider.open(target, http);
  } catch (err) {
    // Only GitHub's rate limit has a mirror to fall back to. Anything else --
    // a 404, a 500, a timeout -- goes to the reader as it happened.
    if (!(target.provider === "github" && err.rateLimited)) throw err;
    const resets = err.resetAt ? ` It resets at ${new Date(err.resetAt).toLocaleTimeString()}.` : "";
    let repo;
    try {
      repo = await jsdelivr.open(target, http);
    } catch (mirrorErr) {
      // Both doors closed. Say why for each, and when the first reopens.
      throw new Error(`GitHub's anonymous API limit (60 requests an hour, per IP address) is used up.${resets} `
        + `The jsDelivr mirror could not stand in: ${mirrorErr.message}. Try again after the reset.`);
    }
    repo.notices.unshift(`GitHub's anonymous API limit (60 requests an hour, per IP address) is used up.${resets}`);
    return repo;
  }
}
