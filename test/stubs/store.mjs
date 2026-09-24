// In-memory stand-in for admin/lib/store.mjs, same exports. Objects live in
// two Maps, staging and live, keyed like the S3 buckets.

import { createHash } from "node:crypto";

export const STAGING = "staging";
export const LIVE = "live";
export const DISTRIBUTION_ID = "";
export const LOG_BUCKET = "";
export const s3 = {};

const buckets = { staging: new Map(), live: new Map() };
const etag = (buf) => createHash("md5").update(buf).digest("hex");

/** Test helper: empty both buckets and load `objects` into staging. */
export function __reset(objects = {}) {
  buckets.staging.clear();
  buckets.live.clear();
  for (const [k, v] of Object.entries(objects)) {
    buckets.staging.set(k, Buffer.from(typeof v === "string" ? v : JSON.stringify(v)));
  }
}
export const __keys = (bucket = STAGING) => [...buckets[bucket].keys()];
export const __text = (key, bucket = STAGING) => buckets[bucket].get(key)?.toString("utf8") ?? null;

export async function getBuffer(key, bucket = STAGING) { return buckets[bucket].get(key) ?? null; }
export async function getText(key, bucket = STAGING) { return __text(key, bucket); }
export async function getJson(key, fallback = null, bucket = STAGING) {
  const t = __text(key, bucket);
  return t === null ? fallback : JSON.parse(t);
}
export const cacheControlFor = () => "no-store";
export async function putBuffer(key, body, _type, bucket = STAGING) { buckets[bucket].set(key, Buffer.from(body)); }
export const putText = (key, text, type, bucket = STAGING) => putBuffer(key, Buffer.from(text), type, bucket);
export const putJson = (key, obj, bucket = STAGING) => putText(key, JSON.stringify(obj, null, 2), "application/json", bucket);
export async function remove(key, bucket = STAGING) { buckets[bucket].delete(key); }
export async function exists(key, bucket = STAGING) { return buckets[bucket].has(key); }
export async function list(prefix = "", bucket = STAGING) {
  return [...buckets[bucket]].filter(([k]) => k.startsWith(prefix))
    .map(([key, v]) => ({ key, size: v.length, modified: new Date(0), etag: etag(v) }));
}
export async function computeChangeset() {
  const skip = (k) => ["admin/", "_internal/", "admins.json"].some((p) => k.startsWith(p));
  const upload = [...buckets.staging].filter(([k, v]) => !skip(k) && etag(buckets.live.get(k) ?? "") !== etag(v)).map(([k]) => k);
  const del = [...buckets.live.keys()].filter((k) => !skip(k) && !buckets.staging.has(k));
  return { upload, delete: del };
}
export async function publish({ upload, delete: del }, onLog = () => {}) {
  for (const k of upload) { buckets.live.set(k, buckets.staging.get(k)); onLog(`copied ${k}`); }
  for (const k of del) { buckets.live.delete(k); onLog(`deleted ${k}`); }
  return { copied: upload.length, removed: del.length, invalidation: null };
}
