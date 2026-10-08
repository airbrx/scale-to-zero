// Who is allowed to say what, without a server to ask.
//
// Every browser holds an ECDSA P-256 key for the room. A player's id is a hash
// of their public key, so an id cannot be claimed without the key behind it.
//
// The invite link carries the creator's public key. The creator signs a roster
// certificate (epoch 0) listing every seated player's key. When a host leaves,
// the next player in that roster signs the next certificate (epoch 1), and so
// on. Anyone holding the link can walk the chain from the creator's key to the
// current host, so a state broadcast is accepted only from a host that every
// previous host vouched for.
//
// WebCrypto only: it is in every browser and in Node 20+, so the tests run the
// same code.

const subtle = globalThis.crypto.subtle;
const ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIG = { name: "ECDSA", hash: "SHA-256" };
const enc = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** JSON with sorted keys, so signer and verifier hash the same bytes. */
export function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
}

export async function sha256Hex(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const h = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const idOf = async (pub) => (await sha256Hex(unb64u(pub))).slice(0, 20);

export async function newIdentity() {
  const pair = await subtle.generateKey(ALG, true, ["sign", "verify"]);
  return fromKeys(pair.privateKey, pair.publicKey);
}

async function fromKeys(privateKey, publicKey) {
  const pub = b64u(await subtle.exportKey("raw", publicKey));
  return { privateKey, pub, id: await idOf(pub) };
}

/** For localStorage, so a reload keeps the same player (and host). */
export async function exportIdentity(me) {
  return { jwk: await subtle.exportKey("jwk", me.privateKey), pub: me.pub };
}
export async function importIdentity(saved) {
  const privateKey = await subtle.importKey("jwk", saved.jwk, ALG, true, ["sign"]);
  const { d, ...pubJwk } = saved.jwk;
  const publicKey = await subtle.importKey("jwk", { ...pubJwk, key_ops: ["verify"] }, ALG, true, ["verify"]);
  return fromKeys(privateKey, publicKey);
}

const pubKeys = new Map();
async function verifyKey(pub) {
  if (!pubKeys.has(pub)) pubKeys.set(pub, subtle.importKey("raw", unb64u(pub), ALG, false, ["verify"]));
  return pubKeys.get(pub);
}

export async function sign(me, data) {
  return b64u(await subtle.sign(SIG, me.privateKey, enc.encode(stable(data))));
}
export async function verify(pub, data, sig) {
  try {
    return await subtle.verify(SIG, await verifyKey(pub), unb64u(sig), enc.encode(stable(data)));
  } catch {
    return false;
  }
}

/** A message from a player: { from, body, sig }, the signature covering both. */
export async function seal(me, body) {
  return { from: me.id, body, sig: await sign(me, { from: me.id, body }) };
}
export const openSealed = (pub, env) => verify(pub, { from: env.from, body: env.body }, env.sig);

/** The roster certificate a host signs: epoch, host id, and every seated player's key. */
export async function issueCert(me, epoch, roster) {
  const data = { epoch, host: me.id, roster: roster.map(({ id, pub }) => ({ id, pub })) };
  return { ...data, sig: await sign(me, data) };
}

/**
 * Walk the chain from the creator's key. Returns the last certificate, or
 * throws saying which link is wrong.
 */
export async function verifyChain(genesisPub, chain) {
  if (!Array.isArray(chain) || !chain.length) throw new Error("no certificate chain");
  const genesisId = await idOf(genesisPub);
  let prev = null;
  for (let k = 0; k < chain.length; k++) {
    const c = chain[k];
    if (c.epoch !== k) throw new Error(`certificate ${k} has epoch ${c.epoch}`);
    const roster = Array.isArray(c.roster) ? c.roster : [];
    for (const r of roster) if ((await idOf(r.pub)) !== r.id) throw new Error(`certificate ${k}: a roster id does not match its key`);
    if (!roster.some((r) => r.id === c.host)) throw new Error(`certificate ${k}: the host is not in its own roster`);
    let signerPub;
    if (k === 0) {
      if (c.host !== genesisId) throw new Error("the first certificate is not from the room's creator");
      signerPub = genesisPub;
    } else {
      signerPub = prev.roster.find((r) => r.id === c.host)?.pub;
      if (!signerPub) throw new Error(`certificate ${k}: its host was not seated by the previous host`);
      const ids = new Set(roster.map((r) => r.id));
      if (!prev.roster.every((r) => ids.has(r.id))) throw new Error(`certificate ${k} drops a seated player`);
    }
    const { sig, ...data } = c;
    if (!(await verify(signerPub, { epoch: data.epoch, host: data.host, roster }, sig))) throw new Error(`certificate ${k} has a bad signature`);
    prev = { ...c, roster };
  }
  return prev;
}

/** The order hosts succeed in: roster order, skipping the departed host. */
export function successor(roster, hostId, isConnected) {
  const ids = roster.map((r) => r.id);
  const start = ids.indexOf(hostId);
  for (let k = 1; k <= ids.length; k++) {
    const id = ids[(start + k) % ids.length];
    if (id !== hostId && isConnected(id)) return id;
  }
  return null;
}
