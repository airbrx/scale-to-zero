// The table: one browser's view of a game room.
//
// Trystero finds the other browsers through public Nostr relays and opens a
// WebRTC connection to each. Nothing of ours runs anywhere. Over those
// connections:
//
//   hello   every player announces their public key and name
//   state   the host broadcasts the signed game state after every change
//   req     a player asks the host to roll, hold or score
//   chat    a signed line of chat
//   img     a photo or GIF, as bytes, its hash signed by the sender
//   video   camera and mic, as plain WebRTC media streams
//
// Authority is in auth.js: the host is whoever the certificate chain from the
// room creator's key says it is. When the host is gone for GRACE_MS, the next
// connected player in the roster signs the next certificate and carries on
// from the last state everyone already holds.

import { joinRoom } from "../vendor/trystero-nostr.js";
import { newIdentity, importIdentity, exportIdentity, idOf, seal, openSealed, issueCert, verifyChain, successor, sha256Hex } from "./auth.js";
import { newGame, seatPlayer, apply } from "./game.js";

export const APP_ID = "scale-to-zero.com/yahtzee";
export const GRACE_MS = 12000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
};

const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const roll = () => {
  // unbiased 1-6: reject the top of the byte range that 6 does not divide
  const b = new Uint8Array(1);
  do crypto.getRandomValues(b); while (b[0] >= 252);
  return (b[0] % 6) + 1;
};

/** A fresh room: a random id and the creator's identity, ready for the link. */
export async function createRoom() {
  const roomId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
  const me = await newIdentity();
  store.set(`yz:${roomId}:key`, await exportIdentity(me));
  return { roomId, genesisPub: me.pub };
}

export class Table extends EventTarget {
  constructor({ roomId, genesisPub, name }) {
    super();
    this.roomId = roomId;
    this.genesisPub = genesisPub;
    this.name = name;
    this.peers = new Map();     // trystero peer id -> player id
    this.links = new Map();     // player id -> Set of trystero peer ids
    this.pubs = new Map();      // player id -> public key
    this.seen = new Set();      // nonces already handled
    this.env = null;            // the latest signed state we accept
    this.hostLastSeen = Date.now();
    this.camera = null;
  }

  // ----------------------------------------------------------- lifecycle
  async start() {
    const saved = store.get(`yz:${this.roomId}:key`);
    this.me = saved ? await importIdentity(saved).catch(() => null) : null;
    if (!this.me) {
      this.me = await newIdentity();
      store.set(`yz:${this.roomId}:key`, await exportIdentity(this.me));
    }
    this.pubs.set(this.me.id, this.me.pub);
    this.genesisId = await idOf(this.genesisPub);

    const old = store.get(`yz:${this.roomId}:state`);
    if (old) await this.acceptState(old, { quiet: true }).catch(() => {});
    if (!this.env && this.me.id === this.genesisId) {
      const game = seatPlayer(newGame(), this.me.id, this.name);
      const chain = [await issueCert(this.me, 0, [{ id: this.me.id, pub: this.me.pub }])];
      await this.commit({ epoch: 0, seq: 0, chain, game });
    } else if (this.isHost()) {
      // a host that reloaded: re-seat under the current name and rebroadcast
      await this.hostApply((g) => seatPlayer(g, this.me.id, this.name));
    }

    this.room = joinRoom({ appId: APP_ID, password: this.roomId }, this.roomId, {
      onJoinError: (e) => this.emit("status", { text: `Could not join: ${e.error}` }),
    });
    const msg = this.room.makeAction("msg");
    this.sendMsg = (data, target) => msg.send(data, target ? { target } : undefined);
    msg.onMessage = (data, { peerId }) => this.onMsg(data, peerId).catch((e) => console.warn("yahtzee:", e.message));

    const img = this.room.makeAction("img", {
      onReceive: ({ byteLength }) => byteLength <= MAX_IMAGE_BYTES,
    });
    this.sendImg = (bytes, metadata) => img.send(bytes, { metadata });
    img.onMessage = (data, { peerId, metadata }) => this.onImg(data, metadata, peerId).catch((e) => console.warn("yahtzee:", e.message));

    this.room.onPeerJoin = (peerId) => this.onPeerJoin(peerId);
    this.room.onPeerLeave = (peerId) => this.onPeerLeave(peerId);
    this.room.onPeerStream = (stream, peerId) => {
      const id = this.peers.get(peerId);
      this.emit("stream", { peerId, id, stream });
    };

    this.timer = setInterval(() => this.watchHost(), 2000);
    this.emit("status", { text: "Looking for players…" });
    this.emit("change");
  }

  async leave() {
    clearInterval(this.timer);
    this.stopCamera();
    await this.room?.leave();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ------------------------------------------------------------- queries
  get game() { return this.env?.body.game ?? null; }
  get cert() { return this.env?.body.chain.at(-1) ?? null; }
  get hostId() { return this.cert?.host ?? null; }
  isHost() { return this.hostId === this.me?.id; }
  isConnected(id) { return id === this.me.id || (this.links.get(id)?.size ?? 0) > 0; }
  peerCount() { return this.peers.size; }

  // --------------------------------------------------------------- peers
  async onPeerJoin(peerId) {
    await this.sendMsg(await seal(this.me, { t: "hello", room: this.roomId, pub: this.me.pub, name: this.name, n: nonce() }), peerId);
    // Anyone may pass the signed state along: it carries its own proof. This is
    // how a late joiner, or a returning old host, learns where the game is.
    if (this.env) await this.sendMsg(this.env, peerId);
    if (this.camera) this.room.addStream(this.camera, { target: peerId });
  }

  onPeerLeave(peerId) {
    const id = this.peers.get(peerId);
    this.peers.delete(peerId);
    if (id) this.links.get(id)?.delete(peerId);
    if (id === this.hostId && !this.isConnected(id)) this.hostLastSeen = Date.now();
    this.emit("peerleft", { peerId, id });
    this.emit("change");
  }

  // ------------------------------------------------------------ messages
  async onMsg(env, peerId) {
    const t = env?.body?.t;
    if (t === "hello") return this.onHello(env, peerId);
    if (t === "state") return this.acceptState(env);
    const pub = this.pubs.get(env?.from);
    if (!pub || !(await openSealed(pub, env))) return;
    if (env.body.n) {
      if (this.seen.has(env.body.n)) return;
      this.seen.add(env.body.n);
      if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    }
    if (t === "chat") this.emit("chat", { id: env.from, text: String(env.body.text).slice(0, 500), at: Date.now() });
    else if (t === "req" && this.isHost()) await this.onReq(env, peerId);
    else if (t === "err" && env.from === this.hostId) this.emit("error", { text: String(env.body.text) });
  }

  async onHello(env, peerId) {
    const { pub, room, name } = env.body;
    if (room !== this.roomId || typeof pub !== "string") return;
    if ((await idOf(pub)) !== env.from || !(await openSealed(pub, env))) return;
    const id = env.from;
    this.pubs.set(id, pub);
    this.peers.set(peerId, id);
    if (!this.links.has(id)) this.links.set(id, new Set());
    this.links.get(id).add(peerId);
    if (id === this.hostId) this.hostLastSeen = Date.now();
    if (this.isHost()) await this.hostApply((g) => seatPlayer(g, id, name));
    this.emit("change");
  }

  async onReq(env, peerId) {
    try {
      await this.hostApply((g) => apply(g, env.body.req, { by: env.from, isHost: env.from === this.me.id, roll }));
    } catch (e) {
      await this.sendMsg(await seal(this.me, { t: "err", text: e.message, n: nonce() }), peerId);
    }
  }

  async onImg(bytes, metadata, peerId) {
    const env = metadata?.env;
    const pub = this.pubs.get(env?.from);
    if (!pub || this.peers.get(peerId) !== env.from || !(await openSealed(pub, env))) return;
    const { mime, hash, n } = env.body;
    if (env.body.t !== "img" || !IMAGE_TYPES.includes(mime) || this.seen.has(n)) return;
    const buf = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer ?? bytes);
    if ((await sha256Hex(buf)) !== hash) return;
    this.seen.add(n);
    this.emit("image", { id: env.from, blob: new Blob([buf], { type: mime }), at: Date.now() });
  }

  // --------------------------------------------------------------- state
  /** Verify a state envelope and adopt it if it is newer than ours. */
  async acceptState(env, { quiet = false } = {}) {
    const b = env?.body;
    if (b?.t !== "state" || !Array.isArray(b.chain)) return;
    const cert = await verifyChain(this.genesisPub, b.chain).catch(() => null);
    if (!cert || env.from !== cert.host || b.epoch !== b.chain.length - 1) return;
    if (!(await openSealed(cert.roster.find((r) => r.id === cert.host).pub, env))) return;

    const mine = this.env?.body;
    if (mine && !quiet) {
      if (b.epoch < mine.epoch) return;
      if (b.epoch === mine.epoch && env.from === this.env.from && b.seq <= mine.seq) return;
      if (b.epoch === mine.epoch && env.from !== this.env.from) {
        // Two players took over at once. The earlier seat in the roster that
        // seated them both wins; the other steps down by adopting this.
        const order = b.chain[b.epoch - 1]?.roster.map((r) => r.id) ?? [];
        if (order.indexOf(env.from) > order.indexOf(this.env.from)) return;
      }
    }
    for (const r of cert.roster) this.pubs.set(r.id, r.pub);
    const wasHost = this.isHost();
    this.env = env;
    store.set(`yz:${this.roomId}:state`, env);
    if (!this.isHost()) this.hostLastSeen = this.isConnected(cert.host) ? Date.now() : this.hostLastSeen;
    if (wasHost && !this.isHost()) this.emit("status", { text: "Another player is hosting now." });
    this.emit("change");
  }

  /** Host only: sign and broadcast a new state. */
  async commit({ epoch, seq, chain, game }) {
    const env = await seal(this.me, { t: "state", epoch, seq, chain, game });
    this.env = env;
    store.set(`yz:${this.roomId}:state`, env);
    this.emit("change");
    if (this.sendMsg) await this.sendMsg(env);
  }

  /** Host only: change the game, reissuing the roster certificate if seats changed. */
  async hostApply(fn) {
    const b = this.env.body;
    const game = fn(b.game);
    let chain = b.chain;
    const seated = new Set(chain.at(-1).roster.map((r) => r.id));
    if (game.seats.some((id) => !seated.has(id))) {
      const roster = game.seats.map((id) => ({ id, pub: this.pubs.get(id) }));
      chain = [...chain.slice(0, -1), await issueCert(this.me, b.epoch, roster)];
    }
    await this.commit({ epoch: b.epoch, seq: b.seq + 1, chain, game });
  }

  /** Every couple of seconds: is the host still here? If not, should I take over? */
  async watchHost() {
    if (!this.env || this.isHost() || this.taking) return;
    if (this.isConnected(this.hostId)) {
      this.hostLastSeen = Date.now();
      return;
    }
    const gone = Date.now() - this.hostLastSeen;
    this.emit("hostaway", { ms: gone, grace: GRACE_MS });
    if (gone < GRACE_MS) return;
    const next = successor(this.cert.roster, this.hostId, (id) => this.isConnected(id));
    if (next !== this.me.id) return;
    this.taking = true;
    try {
      const b = this.env.body;
      const left = this.game.players[this.hostId]?.name ?? "The host";
      const chain = [...b.chain, await issueCert(this.me, b.epoch + 1, this.cert.roster)];
      const game = structuredClone(b.game);
      game.log.push(`${left} left. ${this.name} is hosting now.`);
      await this.commit({ epoch: b.epoch + 1, seq: 0, chain, game });
      this.emit("status", { text: "You are hosting now." });
    } finally {
      this.taking = false;
    }
  }

  // ------------------------------------------------------------ actions
  async request(req) {
    if (this.isHost()) {
      try {
        await this.hostApply((g) => apply(g, req, { by: this.me.id, isHost: true, roll }));
      } catch (e) {
        this.emit("error", { text: e.message });
      }
      return;
    }
    if (!this.isConnected(this.hostId)) {
      this.emit("error", { text: "Waiting for the host to come back…" });
      return;
    }
    await this.sendMsg(await seal(this.me, { t: "req", req, n: nonce() }));
  }

  async rename(name) {
    this.name = name;
    await this.sendMsg(await seal(this.me, { t: "hello", room: this.roomId, pub: this.me.pub, name, n: nonce() }));
    if (this.isHost()) await this.hostApply((g) => seatPlayer(g, this.me.id, name));
  }

  async chat(text) {
    const clean = String(text).trim().slice(0, 500);
    if (!clean) return;
    this.emit("chat", { id: this.me.id, text: clean, at: Date.now() });
    await this.sendMsg(await seal(this.me, { t: "chat", text: clean, n: nonce() }));
  }

  async sendImage(file) {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error("Photos and GIFs only: PNG, JPEG, GIF or WebP.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("That file is over 5 MB.");
    const buf = new Uint8Array(await file.arrayBuffer());
    const env = await seal(this.me, { t: "img", mime: file.type, hash: await sha256Hex(buf), n: nonce() });
    this.emit("image", { id: this.me.id, blob: new Blob([buf], { type: file.type }), at: Date.now() });
    await this.sendImg(buf, { env });
  }

  async startCamera() {
    this.camera = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: true });
    this.room.addStream(this.camera);
    return this.camera;
  }

  stopCamera() {
    if (!this.camera) return;
    try { this.room?.removeStream(this.camera); } catch { /* peer already gone */ }
    for (const track of this.camera.getTracks()) track.stop();
    this.camera = null;
  }
}
