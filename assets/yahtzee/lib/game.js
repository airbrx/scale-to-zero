// The game as a state machine. Only the host runs apply(); everyone else just
// renders the state the host signs and broadcasts. Pure: dice come from the
// roll function the caller passes in, so tests can seed it.

import { applyScore, isCardFull, LABELS, CATEGORIES, scoreFor, totals } from "./rules.js";

export const MAX_ROLLS = 3;
const LOG_KEEP = 40;

export function newGame() {
  return {
    v: 1,
    phase: "lobby",       // lobby | playing | over
    seats: [],            // player ids in turn order
    players: {},          // id -> { name, card, out }
    turn: null,
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rolls: 0,
    round: 1,
    log: [],
  };
}

const say = (s, text) => {
  s.log.push(text);
  if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
};
const nameOf = (s, id) => s.players[id]?.name ?? "someone";
const eligible = (s, id) => s.players[id] && !s.players[id].out && !isCardFull(s.players[id].card);
const resetDice = (s) => {
  s.dice = [0, 0, 0, 0, 0];
  s.held = [false, false, false, false, false];
  s.rolls = 0;
};

/** First eligible seat strictly after `from` (or from the top), wrapping once. */
function nextTurn(s, from) {
  const n = s.seats.length;
  const start = from == null ? -1 : s.seats.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    const id = s.seats[i];
    if (eligible(s, id)) return { id, wrapped: from != null && i <= start };
  }
  return null;
}

function advance(s) {
  const next = nextTurn(s, s.turn);
  resetDice(s);
  if (!next) {
    s.turn = null;
    s.phase = "over";
    say(s, `Game over. ${winnerLine(s)}`);
    return;
  }
  if (next.wrapped) s.round++;
  s.turn = next.id;
}

export function standings(s) {
  return s.seats
    .map((id) => ({ id, name: nameOf(s, id), total: totals(s.players[id].card).total }))
    .sort((a, b) => b.total - a.total);
}

function winnerLine(s) {
  const st = standings(s);
  if (!st.length) return "";
  const top = st.filter((p) => p.total === st[0].total);
  return top.length > 1
    ? `${top.map((p) => p.name).join(" and ")} tie on ${st[0].total}.`
    : `${top[0].name} wins with ${top[0].total}.`;
}

/** Seat a player, or update a returning player's name. Host-side bookkeeping. */
export function seatPlayer(state, id, name) {
  const s = structuredClone(state);
  const clean = String(name ?? "").trim().slice(0, 24) || "Player";
  if (s.players[id]) {
    s.players[id].name = clean;
    return s;
  }
  s.players[id] = { name: clean, card: {}, out: false };
  s.seats.push(id);
  say(s, `${clean} joined${s.phase === "playing" ? " and plays from their next turn" : ""}.`);
  if (s.phase === "playing" && s.turn === null) s.turn = id;
  return s;
}

const HOST_ONLY = new Set(["start", "setTurn", "sitOut", "end", "rematch"]);

/**
 * Apply one request. ctx: { by, isHost, roll } where roll() returns 1-6.
 * Throws an Error whose message is fit to show the person who asked.
 * The host may roll, hold and score on anyone's turn: that is how it plays
 * for a player who stepped away.
 */
export function apply(state, req, { by, isHost, roll }) {
  const s = structuredClone(state);
  const kind = req?.kind;
  if (HOST_ONLY.has(kind) && !isHost) throw new Error("only the host can do that");
  const actingFor = by !== s.turn;
  const mustBeTurn = () => {
    if (s.phase !== "playing") throw new Error("the game is not running");
    if (actingFor && !isHost) throw new Error(`it is ${nameOf(s, s.turn)}'s turn`);
  };
  const forWhom = () => (actingFor ? ` for ${nameOf(s, s.turn)}` : "");

  switch (kind) {
    case "start": {
      if (s.phase !== "lobby") throw new Error("the game has already started");
      if (!s.seats.length) throw new Error("nobody is seated");
      s.phase = "playing";
      s.round = 1;
      s.turn = null;
      advance(s);
      say(s, `Game on. ${nameOf(s, s.turn)} rolls first.`);
      return s;
    }
    case "rematch": {
      if (s.phase === "lobby") throw new Error("the game has not started");
      for (const id of s.seats) s.players[id].card = {};
      s.phase = "playing";
      s.round = 1;
      s.turn = null;
      advance(s);
      say(s, `Rematch. ${nameOf(s, s.turn)} rolls first.`);
      return s;
    }
    case "end": {
      if (s.phase !== "playing") throw new Error("the game is not running");
      s.phase = "over";
      s.turn = null;
      resetDice(s);
      say(s, `The host ended the game. ${winnerLine(s)}`);
      return s;
    }
    case "setTurn": {
      if (s.phase !== "playing") throw new Error("the game is not running");
      if (!eligible(s, req.id)) throw new Error("that player cannot take a turn");
      s.turn = req.id;
      resetDice(s);
      say(s, `The host passed the turn to ${nameOf(s, req.id)}.`);
      return s;
    }
    case "sitOut": {
      const p = s.players[req.id];
      if (!p) throw new Error("no such player");
      p.out = Boolean(req.out);
      say(s, `${p.name} ${p.out ? "is sitting out" : "is back in"}.`);
      if (s.phase === "playing" && p.out && s.turn === req.id) advance(s);
      else if (s.phase === "playing" && !p.out && s.turn === null) advance(s);
      return s;
    }
    case "roll": {
      mustBeTurn();
      if (s.rolls >= MAX_ROLLS) throw new Error("no rolls left: pick a box");
      if (Array.isArray(req.held) && s.rolls > 0) s.held = s.held.map((_, i) => Boolean(req.held[i]));
      if (s.rolls === 0) s.held = [false, false, false, false, false];
      if (s.held.every(Boolean)) throw new Error("every die is held");
      s.dice = s.dice.map((d, i) => (s.held[i] ? d : roll()));
      s.rolls++;
      say(s, `${nameOf(s, by)} rolled${forWhom()}: ${s.dice.join(" ")}`);
      return s;
    }
    case "hold": {
      mustBeTurn();
      const i = Number(req.i);
      if (!(i >= 0 && i < 5)) throw new Error("no such die");
      if (s.rolls === 0) throw new Error("roll first");
      if (s.rolls >= MAX_ROLLS) throw new Error("no rolls left: pick a box");
      s.held[i] = !s.held[i];
      return s;
    }
    case "score": {
      mustBeTurn();
      if (s.rolls === 0) throw new Error("roll first");
      if (!CATEGORIES.includes(req.cat)) throw new Error("no such box");
      const who = s.turn;
      const card = s.players[who].card;
      const pts = scoreFor(req.cat, s.dice, card);
      s.players[who].card = applyScore(card, req.cat, s.dice);
      const bonus = (s.players[who].card.yahtzeeBonus ?? 0) > (card.yahtzeeBonus ?? 0) ? " and a 100-point Yahtzee bonus" : "";
      say(s, `${nameOf(s, who)} took ${pts} in ${LABELS[req.cat]}${bonus}${actingFor ? " (scored by the host)" : ""}.`);
      advance(s);
      return s;
    }
    default:
      throw new Error(`unknown request ${kind}`);
  }
}
