// The Yahtzee page. Everything the reader sees is drawn here from the signed
// state in lib/table.js. No innerHTML with anything a player typed: names,
// chat and log lines go in as text nodes.

import { createRoom, Table, IMAGE_TYPES } from "./lib/table.js";
import { CATEGORIES, UPPER, LABELS, legalCategories, scoreFor, totals } from "./lib/rules.js";
import { MAX_ROLLS } from "./lib/game.js";
import { MARKUP } from "./markup.js";

const $ = (id) => document.getElementById(id);

// The host page supplies one empty <div id="yahtzee">; the controls are ours.
// MARKUP is a constant, so this is the one innerHTML that is safe.
const mount = $("yahtzee");
if (!mount) throw new Error('Flat Yahtzee needs an element with id="yahtzee" on the page');
mount.classList.add("yz");
mount.innerHTML = MARKUP;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } },
};

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

// ------------------------------------------------------------------ entry
const parseHash = () => {
  const p = new URLSearchParams(location.hash.slice(1));
  const r = p.get("r");
  const k = p.get("k");
  return r && k && /^[a-z0-9]{8,32}$/.test(r) && /^[A-Za-z0-9_-]{40,120}$/.test(k) ? { roomId: r, genesisPub: k } : null;
};

const nameInput = $("yz-name");
nameInput.value = store.get("yz:name") ?? "";
const invite = parseHash();
$("yz-go").textContent = invite ? "Join the game" : "Start a game";
$("yz-setup-note").textContent = invite
  ? "You were invited to a table. Pick a name and sit down."
  : "Pick a name. You'll get a link to send to the other players.";

$("yz-setup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim().slice(0, 24);
  if (!name) return nameInput.focus();
  store.set("yz:name", name);
  $("yz-go").disabled = true;
  try {
    let room = parseHash();
    if (!room) {
      room = await createRoom();
      history.replaceState(null, "", `#r=${room.roomId}&k=${room.genesisPub}`);
    }
    await sit(room, name);
  } catch (err) {
    $("yz-go").disabled = false;
    $("yz-setup-note").textContent = `Could not start: ${err.message}`;
  }
});

addEventListener("hashchange", () => location.reload());

// ------------------------------------------------------------------ table
let table;
let localHeld = null; // optimistic hold toggles until the host's state comes back
let errTimer;

async function sit(room, name) {
  table = new Table({ ...room, name });
  table.addEventListener("change", render);
  table.addEventListener("status", (e) => setStatus(e.detail.text));
  table.addEventListener("error", (e) => flash(e.detail.text));
  table.addEventListener("hostaway", (e) => {
    const left = Math.max(0, Math.ceil((e.detail.grace - e.detail.ms) / 1000));
    setStatus(left ? `The host dropped out. Waiting ${left}s for them before someone else takes over…` : "Handing the table to the next player…");
  });
  table.addEventListener("chat", (e) => addChat(e.detail.id, h("span", { class: "yz-chat-text" }, e.detail.text)));
  table.addEventListener("image", (e) => {
    const url = URL.createObjectURL(e.detail.blob);
    addChat(e.detail.id, h("img", { class: "yz-chat-img", src: url, alt: "Shared image" }));
  });
  table.addEventListener("stream", (e) => addVideo(e.detail.peerId, e.detail.stream));
  table.addEventListener("peerleft", (e) => removeVideo(e.detail.peerId));

  $("yz-setup").hidden = true;
  $("yz-table").hidden = false;
  $("yz-link").value = location.href;
  $("yz-me").value = name;
  await table.start();
  render();
}

function setStatus(text) { $("yz-status").textContent = text; }
function flash(text) {
  const el = $("yz-error");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(errTimer);
  errTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

const nameOf = (id) => table.game?.players[id]?.name ?? (id === table.me.id ? table.name : "Guest");

// ----------------------------------------------------------------- render
function render() {
  const g = table.game;
  if (!g) {
    setStatus("Looking for the table…");
    return;
  }
  const meId = table.me.id;
  const myTurn = g.turn === meId;
  const host = table.isHost();
  const canAct = g.phase === "playing" && (myTurn || host);
  if (g.turn !== render.lastTurn || g.rolls === 0) localHeld = null;
  render.lastTurn = g.turn;
  const held = localHeld ?? g.held;

  // whose turn
  const turnText = g.phase === "lobby"
    ? (host ? "Everyone seated? Start the game." : "Waiting for the host to start.")
    : g.phase === "over"
      ? g.log.at(-1) ?? "Game over."
      : myTurn ? `Your turn. Round ${g.round} of 13.` : `${nameOf(g.turn)}'s turn. Round ${g.round} of 13.`;
  $("yz-turn").textContent = turnText;
  $("yz-turn").classList.toggle("is-mine", myTurn);
  document.title = myTurn ? "Your turn - Flat Yahtzee" : "Flat Yahtzee";

  if (!$("yz-status").textContent.startsWith("The host dropped") || table.isConnected(table.hostId)) {
    const others = table.peerCount();
    setStatus(`${host ? "You are hosting." : `${nameOf(table.hostId)} is hosting.`} ${others ? `Connected to ${others} other ${others === 1 ? "browser" : "browsers"}.` : "Nobody else connected yet."}`);
  }

  // dice
  const dice = $("yz-dice");
  dice.replaceChildren(...g.dice.map((v, i) => h("button", {
    type: "button",
    class: `die v${v}${held[i] ? " is-held" : ""}`,
    "aria-label": v ? `Die ${i + 1}: ${v}${held[i] ? ", held" : ""}` : `Die ${i + 1}: not rolled`,
    "aria-pressed": held[i] ? "true" : "false",
    disabled: !(canAct && g.rolls > 0 && g.rolls < MAX_ROLLS),
    onclick: () => {
      localHeld = [...held];
      localHeld[i] = !localHeld[i];
      render();
      table.request({ kind: "hold", i });
    },
  }, ...Array.from({ length: 9 }, (_, p) => h("span", { class: `pip p${p + 1}` })))));

  const rollBtn = $("yz-roll");
  rollBtn.disabled = !(canAct && g.rolls < MAX_ROLLS && !(g.rolls > 0 && held.every(Boolean)));
  rollBtn.textContent = g.rolls === 0 ? "Roll" : g.rolls < MAX_ROLLS ? `Roll again (${MAX_ROLLS - g.rolls} left)` : "Pick a box";
  rollBtn.onclick = () => table.request({ kind: "roll", held });
  $("yz-play-for").hidden = !(host && g.phase === "playing" && !myTurn);
  $("yz-play-for").textContent = `You are the host: you can roll and score for ${nameOf(g.turn)}.`;

  renderHost(g, host);
  renderCard(g, canAct);

  const log = $("yz-log");
  log.replaceChildren(...g.log.slice(-8).reverse().map((line) => h("li", {}, line)));
}

function renderHost(g, host) {
  const box = $("yz-host");
  box.hidden = !host;
  if (!host) return;
  const pick = h("select", { id: "yz-host-player", "aria-label": "Player" },
    g.seats.map((id) => h("option", { value: id, selected: id === g.turn || null },
      `${g.players[id].name}${g.players[id].out ? " (sitting out)" : ""}${table.isConnected(id) ? "" : " (offline)"}`)));
  const chosen = () => pick.value;
  const btn = (label, onclick, show = true) => show && h("button", { type: "button", class: "yz-btn-quiet", onclick }, label);
  box.replaceChildren(...[
    h("span", { class: "yz-host-label" }, "Host"),
    btn("Start the game", () => table.request({ kind: "start" }), g.phase === "lobby"),
    btn("Rematch", () => table.request({ kind: "rematch" }), g.phase === "over"),
    g.phase !== "lobby" && pick,
    btn("Give them the turn", () => table.request({ kind: "setTurn", id: chosen() }), g.phase === "playing"),
    btn("Sit out / back in", () => table.request({ kind: "sitOut", id: chosen(), out: !g.players[chosen()].out }), g.phase !== "lobby"),
    btn("End the game", () => { if (confirm("End the game for everyone?")) table.request({ kind: "end" }); }, g.phase === "playing"),
  ].filter(Boolean));
}

function renderCard(g, canAct) {
  const ids = g.seats;
  const turnCard = g.turn ? g.players[g.turn].card : null;
  const legal = canAct && g.rolls > 0 && turnCard ? new Set(legalCategories(g.dice, turnCard)) : new Set();

  const headCells = ids.map((id) => {
    const p = g.players[id];
    const flags = [
      id === table.hostId && h("span", { class: "yz-flag", title: "Host" }, "host"),
      !table.isConnected(id) && h("span", { class: "yz-flag is-off", title: "Not connected" }, "offline"),
      p.out && h("span", { class: "yz-flag is-off" }, "out"),
    ];
    return h("th", { scope: "col", class: id === g.turn ? "is-turn" : null }, h("span", { class: "yz-pname" }, p.name, id === table.me.id ? " (you)" : ""), ...flags);
  });

  const row = (label, cellFor, cls) => h("tr", { class: cls }, h("th", { scope: "row" }, label), ids.map((id) => cellFor(id)));
  const boxRow = (cat) => row(LABELS[cat], (id) => {
    const v = g.players[id].card[cat];
    if (v !== undefined) return h("td", { class: id === g.turn ? "is-turn" : null }, v);
    if (id === g.turn && legal.has(cat)) {
      const pts = scoreFor(cat, g.dice, turnCard);
      return h("td", { class: "is-turn" }, h("button", {
        type: "button", class: `yz-take${pts ? "" : " is-zero"}`,
        "aria-label": `Take ${pts} in ${LABELS[cat]}`,
        onclick: () => table.request({ kind: "score", cat }),
      }, pts));
    }
    return h("td", { class: id === g.turn ? "is-turn" : null });
  });
  const sumRow = (label, key, cls) => row(label, (id) => h("td", { class: id === g.turn ? "is-turn" : null }, totals(g.players[id].card)[key] || (key === "total" ? 0 : "")), cls);

  $("yz-card").replaceChildren(
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, ""), headCells)),
    h("tbody", {},
      UPPER.map(boxRow),
      sumRow("Upper total", "upper", "is-sum"),
      sumRow("Bonus (63+)", "bonus", "is-sum"),
      CATEGORIES.filter((c) => !UPPER.includes(c)).map(boxRow),
      sumRow("Yahtzee bonus", "yBonus", "is-sum"),
      sumRow("Total", "total", "is-total")),
  );
}

// ------------------------------------------------------------------- chat
function addChat(id, body) {
  const list = $("yz-chat-list");
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.append(h("li", { class: id === table.me.id ? "is-me" : null }, h("span", { class: "yz-chat-who" }, nameOf(id)), body));
  while (list.children.length > 200) list.firstChild.remove();
  if (atBottom || id === table.me.id) list.scrollTop = list.scrollHeight;
}

$("yz-chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("yz-chat-input");
  table?.chat(input.value);
  input.value = "";
});

const fileInput = $("yz-photo");
fileInput.accept = IMAGE_TYPES.join(",");
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file || !table) return;
  try {
    await table.sendImage(file);
  } catch (err) {
    flash(err.message);
  }
});

// ------------------------------------------------------------------ video
const tiles = new Map();
function addVideo(key, stream, { mine = false } = {}) {
  removeVideo(key);
  const video = h("video", { autoplay: true, playsinline: true });
  video.muted = mine;
  video.srcObject = stream;
  const label = h("span", { class: "yz-video-name" }, mine ? "You" : nameOf(table.peers.get(key)));
  const tile = h("figure", { class: `yz-tile${mine ? " is-me" : ""}` }, video, label);
  tiles.set(key, { tile, label });
  $("yz-video").append(tile);
  for (const track of stream.getTracks()) track.addEventListener("ended", () => { if (stream.getTracks().every((t) => t.readyState === "ended")) removeVideo(key); });
  stream.addEventListener?.("removetrack", () => { if (!stream.getTracks().length) removeVideo(key); });
}
function removeVideo(key) {
  tiles.get(key)?.tile.remove();
  tiles.delete(key);
}
setInterval(() => {
  // a stream can arrive before its sender's hello: fix the label once it has
  for (const [key, { label }] of tiles) if (key !== "me" && table) label.textContent = nameOf(table.peers.get(key));
}, 2000);

$("yz-cam").addEventListener("click", async () => {
  const btn = $("yz-cam");
  if (table.camera) {
    table.stopCamera();
    removeVideo("me");
    btn.textContent = "Turn on camera";
    return;
  }
  try {
    addVideo("me", await table.startCamera(), { mine: true });
    btn.textContent = "Turn off camera";
  } catch (err) {
    flash(err.name === "NotAllowedError" ? "Camera blocked: allow it in the browser, or this page's headers don't permit it yet." : `Camera: ${err.message}`);
  }
});

// ------------------------------------------------------------------ chrome
$("yz-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $("yz-copy").textContent = "Copied";
  } catch {
    $("yz-link").select();
    $("yz-copy").textContent = "Press Ctrl+C";
  }
  setTimeout(() => { $("yz-copy").textContent = "Copy link"; }, 2000);
});

$("yz-rename").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("yz-me").value.trim().slice(0, 24);
  if (!name || !table || name === table.name) return;
  store.set("yz:name", name);
  table.rename(name);
});

addEventListener("pagehide", () => table?.leave());
