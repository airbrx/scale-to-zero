// S3 access for the admin plane.
//
// Two buckets, following a model proven on an earlier project:
//   staging -- everything the editor touches. Drafts, media, admins.json,
//              sitedata.json. Never public, never fronted by CloudFront.
//   live    -- what the world sees. Only ever written by publish(), as a
//              server-side copy from staging. Readable only by CloudFront OAC.
//
// Credentials come from the Lambda execution role. There are no keys in this
// file and none in the deployed bundle.

import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand,
  ListObjectsV2Command, CopyObjectCommand, HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";

// The buckets are not necessarily in the function's region: the function lives
// in us-east-1 with the rest of the account's Lambdas, the buckets in us-west-2.
const REGION = process.env.AWS_BUCKET_REGION ?? process.env.AWS_REGION ?? "us-west-2";
export const STAGING = process.env.STAGING_BUCKET;
export const LIVE = process.env.LIVE_BUCKET;
export const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID;
export const LOG_BUCKET = process.env.LOG_BUCKET ?? "";

if (!STAGING || !LIVE) {
  throw new Error("STAGING_BUCKET and LIVE_BUCKET must both be set");
}

// Exported so the stats processor can read the log bucket with the same client
// and the same execution-role credentials.
export const s3 = new S3Client({ region: REGION });
// CloudFront is a global service whose control plane lives in us-east-1;
// pointing this at the bucket region would fail to sign correctly.
const cf = new CloudFrontClient({ region: "us-east-1" });

const clean = (key) => (key.startsWith("/") ? key.slice(1) : key);

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------------ staging
export async function getBuffer(key, bucket = STAGING) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: clean(key) }));
    return await streamToBuffer(res.Body);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function getText(key, bucket = STAGING) {
  const buf = await getBuffer(key, bucket);
  return buf === null ? null : buf.toString("utf8");
}

export async function getJson(key, fallback = null, bucket = STAGING) {
  const text = await getText(key, bucket);
  if (text === null) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    // A corrupt manifest must be loud. Silently returning the fallback would
    // let publish() wipe the site's article list.
    throw new Error(`${key} is not valid JSON: ${err.message}`);
  }
}

// -------------------------------------------------------------- cache policy
//
// CloudFront invalidation clears the edge. It cannot clear a browser. So the
// two caches get different instructions: a long `s-maxage` for the CDN, which
// publish() invalidates on every change, and a short `max-age` for browsers,
// which we have no lever over at all. A one-year max-age on an article is
// unrecallable -- a returning reader keeps the stale copy and nothing we do
// from this side reaches them.
//
// media/ is the one honest exception: those keys carry an upload timestamp, so
// the bytes at a given URL really never change and `immutable` is true rather
// than aspirational.
const YEAR = 31536000;

export function cacheControlFor(key) {
  const k = clean(key);
  // Staging-only state. Never published, never public, read back by the admin
  // on the next request -- caching it would only serve us a stale admin list.
  if (k.startsWith("_internal/") || k === "admins.json" || k === "sitedata.json") {
    return "no-store";
  }
  if (k.startsWith("media/")) return `public, max-age=${YEAR}, immutable`;
  return `public, max-age=300, s-maxage=${YEAR}`;
}

export async function putBuffer(key, body, contentType, bucket = STAGING) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: clean(key), Body: body, ContentType: contentType,
    // publish() copies with MetadataDirective: "COPY", so whatever is set here
    // rides through to the live bucket unchanged. This is the only place it
    // needs setting for anything the admin writes.
    CacheControl: cacheControlFor(key),
  }));
  return clean(key);
}

export const putText = (key, text, contentType = "text/plain; charset=utf-8", bucket = STAGING) =>
  putBuffer(key, Buffer.from(text, "utf8"), contentType, bucket);

export const putJson = (key, obj, bucket = STAGING) =>
  putText(key, JSON.stringify(obj, null, 2), "application/json; charset=utf-8", bucket);

export async function remove(key, bucket = STAGING) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: clean(key) }));
}

export async function exists(key, bucket = STAGING) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: clean(key) }));
    return true;
  } catch {
    return false;
  }
}

export async function list(prefix = "", bucket = STAGING) {
  const out = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: clean(prefix), ContinuationToken: token,
    }));
    for (const o of res.Contents ?? []) {
      out.push({ key: o.Key, size: o.Size, modified: o.LastModified, etag: o.ETag?.replace(/"/g, "") });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// ------------------------------------------------------------------ publish
//
// Compare staging against live by ETag and move only what differs. The earlier
// project computes a changeset the same way; the point is to avoid re-uploading the
// whole site and then invalidating every path in CloudFront, which is both slow
// and, past the free tier, billable per path.

const SKIP_PREFIXES = ["admin/", "_internal/", "admins.json", "sitedata.json"];

export async function computeChangeset() {
  const [stagingObjs, liveObjs] = await Promise.all([list("", STAGING), list("", LIVE)]);

  const publishable = stagingObjs.filter((o) => !SKIP_PREFIXES.some((p) => o.key.startsWith(p)));
  const liveMap = new Map(liveObjs.map((o) => [o.key, o]));
  const stagingMap = new Map(publishable.map((o) => [o.key, o]));

  const upload = publishable
    .filter((o) => liveMap.get(o.key)?.etag !== o.etag)
    .map((o) => o.key);

  // Anything live that staging no longer has, except things we never publish.
  const del = liveObjs
    .filter((o) => !stagingMap.has(o.key) && !SKIP_PREFIXES.some((p) => o.key.startsWith(p)))
    .map((o) => o.key);

  return { upload, delete: del };
}

export async function publish({ upload, delete: del }, onLog = () => {}) {
  const copied = [];
  for (const key of upload) {
    await s3.send(new CopyObjectCommand({
      Bucket: LIVE,
      Key: key,
      CopySource: `${STAGING}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
      MetadataDirective: "COPY",
    }));
    copied.push(key);
    onLog(`copied ${key}`);
  }

  const removed = [];
  for (const key of del) {
    await s3.send(new DeleteObjectCommand({ Bucket: LIVE, Key: key }));
    removed.push(key);
    onLog(`deleted ${key}`);
  }

  let invalidation = null;
  if (DISTRIBUTION_ID && (copied.length || removed.length)) {
    // Under ~15 paths, invalidate precisely; past that a wildcard is cheaper
    // than paying per path, since only the first 1000 paths/month are free.
    const touched = [...copied, ...removed].map((k) => `/${k}`);
    const paths = touched.length > 15 ? ["/*"] : touched;
    const res = await cf.send(new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `publish-${Date.now()}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    }));
    invalidation = res.Invalidation?.Id ?? null;
    onLog(`invalidated ${paths.length === 1 && paths[0] === "/*" ? "everything" : `${paths.length} path(s)`}`);
  }

  return { copied: copied.length, removed: removed.length, invalidation };
}
