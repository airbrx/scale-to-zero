// Tests for the peer-to-peer Yahtzee. Offline: no relays, no WebRTC. Scoring,
// the host's state machine, the signature chain that decides who may host, and
// that the markup has every element the app looks up.
// Run: node games/yahtzee/test.mjs (Node 20+, nothing to install)
import assert from "node:assert/strict";

import { rawScore, scoreFor, legalCategories, applyScore, totals, isCardFull, CATEGORIES } from "./lib/rules.js";
import { newGame, seatPlayer, apply, standings } from "./lib/game.js";
import { newIdentity, exportIdentity, importIdentity, seal, openSealed, issueCert, verifyChain, successor, stable } from "./lib/auth.js";

let n = 0;
const t = (label, got, want) => {
  n++;
  assert.deepEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const throws = async (label, fn, re) => {
  n++;
  await assert.rejects(async () => fn(), re, label);
};

// ----------------------------------------------------------------- scoring
t("ones", rawScore("ones", [1, 1, 2, 3, 1]), 3);
t("sixes", rawScore("sixes", [6, 6, 2, 3, 1]), 12);
t("three of a kind sums all dice", rawScore("threeKind", [4, 4, 4, 2, 1]), 15);
t("no three of a kind", rawScore("threeKind", [4, 4, 3, 2, 1]), 0);
t("four of a kind", rawScore("fourKind", [5, 5, 5, 5, 1]), 21);
t("full house", rawScore("fullHouse", [2, 2, 3, 3, 3]), 25);
t("five of a kind is not a plain full house", rawScore("fullHouse", [3, 3, 3, 3, 3]), 0);
t("small straight with a pair", rawScore("smallStraight", [1, 2, 3, 4, 4]), 30);
t("small straight 3-6", rawScore("smallStraight", [6, 3, 5, 4, 1]), 30);
t("broken run", rawScore("smallStraight", [1, 2, 3, 5, 6]), 0);
t("large straight", rawScore("largeStraight", [2, 3, 4, 5, 6]), 40);
t("yahtzee", rawScore("yahtzee", [2, 2, 2, 2, 2]), 50);
t("chance", rawScore("chance", [1, 2, 3, 4, 6]), 16);

const y = [4, 4, 4, 4, 4];
t("first yahtzee may go anywhere", legalCategories(y, {}).length, 13);
t("bonus yahtzee goes in its upper box first", legalCategories(y, { yahtzee: 50 }), ["fours"]);
t("then any open lower box", legalCategories(y, { yahtzee: 50, fours: 12 }), ["threeKind", "fourKind", "fullHouse", "smallStraight", "largeStraight", "chance"]);
t("joker full house scores 25", scoreFor("fullHouse", y, { yahtzee: 0, fours: 12 }), 25);
t("joker large straight scores 40", scoreFor("largeStraight", y, { yahtzee: 50, fours: 12 }), 40);
const bonus = applyScore({ yahtzee: 50 }, "fours", y);
t("bonus yahtzee earns 100", totals(bonus).yBonus, 100);
t("no bonus after a scratched yahtzee", applyScore({ yahtzee: 0 }, "fours", y).yahtzeeBonus, undefined);
await throws("joker forced upper box", () => applyScore({ yahtzee: 50 }, "chance", y), /Fours first/);
await throws("used box", () => applyScore({ ones: 3 }, "ones", [1, 1, 1, 2, 3]), /already used/);

const fullUpper = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
t("upper bonus at 63", totals(fullUpper).bonus, 35);
t("no bonus at 62", totals({ ...fullUpper, ones: 2 }).bonus, 0);
t("card full", isCardFull(Object.fromEntries(CATEGORIES.map((k) => [k, 0]))), true);

// -------------------------------------------------------------- the host
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
let g = seatPlayer(seatPlayer(newGame(), "a", "Ann"), "b", "Ben");
const hostCtx = (roll = seq(1)) => ({ by: "a", isHost: true, roll });
await throws("non-host cannot start", () => apply(g, { kind: "start" }, { by: "b", isHost: false, roll: seq(1) }), /only the host/);
g = apply(g, { kind: "start" }, hostCtx());
t("Ann rolls first", [g.phase, g.turn], ["playing", "a"]);
await throws("Ben cannot roll on Ann's turn", () => apply(g, { kind: "roll" }, { by: "b", isHost: false, roll: seq(1) }), /Ann's turn/);
g = apply(g, { kind: "roll" }, hostCtx(seq(6, 6, 6, 2, 3)));
t("dice", g.dice, [6, 6, 6, 2, 3]);
g = apply(g, { kind: "roll", held: [true, true, true, false, false] }, hostCtx(seq(6, 1)));
t("held dice stay", g.dice, [6, 6, 6, 6, 1]);
g = apply(g, { kind: "roll", held: [true, true, true, true, false] }, hostCtx(seq(6)));
t("third roll", [g.dice, g.rolls], [[6, 6, 6, 6, 6], 3]);
await throws("no fourth roll", () => apply(g, { kind: "roll" }, hostCtx()), /no rolls left/);
g = apply(g, { kind: "score", cat: "yahtzee" }, hostCtx());
t("scored and passed to Ben", [g.players.a.card.yahtzee, g.turn, g.rolls], [50, "b", 0]);
await throws("scoring before rolling", () => apply(g, { kind: "score", cat: "chance" }, { by: "b", isHost: false }), /roll first/);

// the host plays for Ben, who stepped away
g = apply(g, { kind: "roll" }, hostCtx(seq(1, 2, 3, 4, 5)));
g = apply(g, { kind: "score", cat: "largeStraight" }, hostCtx());
t("host scored for Ben", [g.players.b.card.largeStraight, g.turn, g.round], [40, "a", 2]);
t("log says so", g.log.at(-1).includes("scored by the host"), true);

g = apply(g, { kind: "setTurn", id: "b" }, hostCtx());
t("host passes the turn", g.turn, "b");
g = apply(g, { kind: "sitOut", id: "b", out: true }, hostCtx());
t("sitting out skips the turn", g.turn, "a");
g = seatPlayer(g, "c", "Cy");
t("late joiner seated with a blank card", [g.seats, g.players.c.card], [["a", "b", "c"], {}]);
g = apply(g, { kind: "end" }, hostCtx());
t("ended", [g.phase, standings(g)[0].name], ["over", "Ann"]);
g = apply(g, { kind: "rematch" }, hostCtx());
t("rematch clears the cards", [g.phase, g.players.a.card, g.turn], ["playing", {}, "a"]);

// a full solo game ends on its own
let solo = apply(seatPlayer(newGame(), "s", "Solo"), { kind: "start" }, { by: "s", isHost: true, roll: seq(1) });
for (const cat of CATEGORIES) {
  solo = apply(solo, { kind: "roll" }, { by: "s", isHost: true, roll: seq(2, 3, 4, 5, 6) });
  solo = apply(solo, { kind: "score", cat }, { by: "s", isHost: true });
}
t("thirteen boxes end the game", [solo.phase, solo.turn], ["over", null]);

// ----------------------------------------------------------- authority
t("stable JSON ignores key order", stable({ b: 1, a: [2, { d: 1, c: 2 }] }), stable({ a: [2, { c: 2, d: 1 }], b: 1 }));

const ann = await newIdentity();
const ben = await newIdentity();
const cy = await newIdentity();
const eve = await newIdentity();
const back = await importIdentity(await exportIdentity(ann));
t("identity survives a reload", [back.id, back.pub], [ann.id, ann.pub]);

const env = await seal(ben, { kind: "chat", text: "hi" });
t("sealed message verifies", await openSealed(ben.pub, env), true);
t("tampered message fails", await openSealed(ben.pub, { ...env, body: { kind: "chat", text: "bye" } }), false);
t("wrong key fails", await openSealed(eve.pub, env), false);

const r = (...ps) => ps.map((p) => ({ id: p.id, pub: p.pub }));
const c0 = await issueCert(ann, 0, r(ann, ben, cy));
t("creator's chain verifies", (await verifyChain(ann.pub, [c0])).host, ann.id);
const c1 = await issueCert(ben, 1, r(ann, ben, cy));
t("handoff to a seated player verifies", (await verifyChain(ann.pub, [c0, c1])).host, ben.id);
await throws("stranger cannot take over", async () => verifyChain(ann.pub, [c0, await issueCert(eve, 1, r(ann, ben, cy, eve))]), /not seated/);
await throws("creator must sign epoch 0", async () => verifyChain(ann.pub, [await issueCert(eve, 0, r(eve))]), /creator/);
await throws("a new host cannot drop players", async () => verifyChain(ann.pub, [c0, await issueCert(ben, 1, r(ben, cy))]), /drops/);
await throws("forged roster key", async () => verifyChain(ann.pub, [{ ...c0, roster: [{ id: ann.id, pub: eve.pub }] }]), /does not match/);
await throws("edited certificate", async () => verifyChain(ann.pub, [c0, { ...c1, roster: [...c1.roster, { id: eve.id, pub: eve.pub }] }]), /bad signature/);

const roster = r(ann, ben, cy);
t("next seat inherits", successor(roster, ann.id, () => true), ben.id);
t("skips the disconnected", successor(roster, ann.id, (id) => id !== ben.id), cy.id);
t("wraps around", successor(roster, cy.id, (id) => id === ann.id), ann.id);
t("alone, nobody", successor(roster, ann.id, () => false), null);

// ----------------------------------------------------------------- markup
const { readFile } = await import("node:fs/promises");
const { MARKUP } = await import("./markup.js");
const appSrc = await readFile(new URL("./app.js", import.meta.url), "utf8");
t("every id the app looks up exists",
  [...new Set(appSrc.match(/\$\("[^"]+"\)/g))].map((m) => m.slice(3, -2))
    .filter((id) => id !== "yahtzee" && !MARKUP.includes(`id="${id}"`)), []);
t("no inline style attributes", /\sstyle="/.test(MARKUP), false);
const standalone = await readFile(new URL("./index.html", import.meta.url), "utf8");
t("standalone page has the mount", standalone.includes('<div id="yahtzee"></div>'), true);
t("standalone page loads the app", standalone.includes('<script type="module" src="app.js">'), true);

console.log(`ok - ${n} yahtzee assertions`);
