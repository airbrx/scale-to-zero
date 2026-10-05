/* story.js - "GitHub Didn't Break Today": the machine.

   The place (STYLE.md, "find the world"): GitHub as one great folded-paper
   machine on the page, and the model vendors as engines outside its wall.
   The article's distinction is the picture: some things are *in* the
   critical path, some stand *beside* it.

   - The main conveyor carries packets (requests) through GitHub's own
     stations: repositories, Actions, pull requests. Its gears are GitHub's.
   - Copilot's belts each run through a turbine driven by a shaft through
     the factory wall, from an engine GitHub doesn't own: xAI's, OpenAI's,
     Anthropic's. When an engine stops, its shaft stops, its belt jams, and
     packets pile up at the feed. The rest of the machine keeps turning.
   - The spine is the clock on the factory wall: minute facets turn red for
     every minute a belt stands still.
   - The rhyme: the airbrx line. Rules, cache, data, all on its own drive.
     Claude sits beside it as an analyst, fed observations on paper slips.
     Claude stops; the line doesn't. The slips wait, and come back later.
   - At the end the machine folds back into the page.

   Built with brand/fold.js. Nothing hardcodes a moment: every build hangs
   off a {cue} (T.at) or a beat edge. */

import { clamp, lerp, smooth, easeIO, easeOutBack, seeded, ground } from '../lib/sketch.js';
import { titleCard, signoff, reportBug, serif } from '../brand/report.js';
import { mix, shade } from '../brand/color.js';
import { scene, cameraPath, rotate, building, block, pennant, newsprint, shadow, belt, gear, shaft, lamp } from '../brand/fold.js';
import { scoreFor, checkSounds } from '../score/sound.js';

export const W = 1280, H = 720;

export const BEATS = {
  0: { min: 8, cues: { clock: 1.5, lost: 2, laps: 3.6 } },
  1: { min: 5, cues: { title: 4.8 } },
  2: { min: 15, cues: { repos: 1.2, actions: 1, merged: 1.5, rope: 2.5, pull: 4.5 } },
  3: { min: 15, cues: { weeks: 3, twelve: 2.5, labs: 2.8, union: 4.5 } },
  4: { min: 5, cues: { turn: 1.5, path: 2.2 } },
  5: { min: 13, cues: { same: 2.4, flow: 2, beside: 1.5, later: 3.6 } },
  6: { min: 11, cues: { chat: 2, lookup: 2.5, unwind: 3.4 } },
  7: { min: 9, cues: { decision: 2, default: 2.5, mostly: 2.5, end: 3.4 } },
};

export const SCORE = {
  key: 'A',
  sections: {
    clock: { mode: 'minor', bpm: 60, prog: [0, 5], bars: 2, keys: .6, bells: .35, drone: .5, fade: 1 },
    precise: { mode: 'dorian', bpm: 84, prog: [0, 3], bars: 2, pad: .6, keys: .5, pluck: .45, drone: .3 },
    tally: { mode: 'minor', bpm: 88, prog: [0, 5, 2, 6], bars: 1, padTone: 'strings', pad: .55, pluck: .8, bass: .65, kick: .4, hat: .4, drone: .5, fade: 1 },
    // back out of the turn's silence: a slow swell, not a switch
    // the turn: not silence, a held chord. The tally's minor thins to strings and a drone, no rhythm
    turn: { mode: 'minor', bpm: 60, prog: [0], bars: 4, padTone: 'strings', pad: .5, drone: .65, fade: 2.5 },
    // the same morning, at airbrx: steady, not chipper. Same root, out of the held chord
    beside: { mode: 'mixolydian', bpm: 76, prog: [0, 3, 6, 0], bars: 2, pad: .55, keys: .45, pluck: .3, bass: .35, bells: .2, drone: .3, fade: 3 },
    honest: { mode: 'dorian', bpm: 80, prog: [0, 3, 4, 0], bars: 2, pad: .6, keys: .55, bells: .2, drone: .3 },
    end: { mode: 'major', bpm: 66, prog: [0, 3, 4, 0], bars: 2, pad: .65, bells: .5, keys: .3, drone: .35, fade: 2.5 },
  },
};

/* ================= the machine ================= */

const MAIN = { x0: -1600, x1: 1300, z: 950 };
const STATIONS = [
  { id: 'repos', name: 'Repositories', x: -900 },
  { id: 'actions', name: 'Actions', x: -400 },
  { id: 'merged', name: 'Pull requests', x: 100 },
];
const WALL = { z: 1640, x0: -1900, x1: 1900, h: 64 };
const TOWER = { x: -150, z: WALL.z, w: 76, d: 76, h: 236 };
const DIAL_C = [TOWER.x, 186, TOWER.z - TOWER.d / 2 - 1.2];
const ENGINE_Z = 2400, SHAFT_Y = 150;

// Copilot: one belt per model, each through a turbine on a shaft from outside
const LABS = [
  { id: 'grok', name: 'xAI', lane: 1200, tx: 1250 },
  { id: 'openai', name: 'OpenAI', lane: 1320, tx: 1000 },
  { id: 'anthropic', name: 'Anthropic', lane: 1440, tx: 750 },
];
const COP = { x0: 480, x1: 1520 };

// the airbrx line, in front, and Claude beside it
const AB = { x0: -1750, x1: -250, z: 520, rules: -1400, cache: -1050, data: -700 };
const CLAUDE = { x: -1050, z: 230 };

// the little turbines on a side belt, wired out to the engines, and their table
const LITTLE = { x0: 330, x1: 1450, z: 720, xs: [500, 750, 1000, 1250] };

// the status page, seven weeks of it, as a ticker tape of tabs
const TAPE = { x0: -1300, x1: 1300, z: 700, days: 51 };
const UP = [2, 15, 16, 18, 30, 41, 44, 48, 51, 7, 23, 36];   // nine on their dates, three illustrative
const MARKS = (() => {
  const r = seeded(303), days = [...UP];
  while (days.length < 50) days.push(Math.floor(r() * (TAPE.days + 1)));
  const stack = {};
  return days.map((d, i) => ({ d, up: i < UP.length, n: (stack[d] = (stack[d] || 0) + 1) - 1 })).sort((a, b) => a.d - b.d).map((m, i) => ({ ...m, i }));
})();
const markX = (d) => lerp(TAPE.x0, TAPE.x1, d / TAPE.days);

/* ================= the clock ================= */
function dialFaces(S, c, rOut, { lost = 0, worked = 0, start = 0 }, P, xf) {
  const base = mix(P.card, P.grid, .25), cold = mix(P.muted, P.water, .3);
  for (let ring = 0; ring < 3; ring++) {
    const ro = rOut * (1 - ring * .27), ri = ro - rOut * .2;
    for (let i = 0; i < 60; i++) {
      const idx = ring * 60 + ((i - start + 60) % 60), col = idx < lost ? P.stop : idx < worked ? cold : base;
      const a = -Math.PI / 2 + Math.PI * 2 * i / 60 + .01, b = -Math.PI / 2 + Math.PI * 2 * (i + 1) / 60 - .01;
      const pt = (r, an) => xf([c[0] + Math.cos(an) * r, c[1] - Math.sin(an) * r, c[2]]);
      S.poly([pt(ro, a), pt(ro, b), pt(ri, b), pt(ri, a)], shade(col, .12 * Math.cos((a + b) / 2 - Math.PI * 1.25)), { flat: true, bias: -6 });
    }
  }
}
function dialHand(S, c, len, min, P, xf) {
  const an = -Math.PI / 2 + Math.PI * 2 * min / 60, ca = Math.cos(an), sa = Math.sin(an), w = len * .05;
  const p = (dx, dy) => xf([c[0] + dx, c[1] - dy, c[2] - .8]);
  S.poly([p(-sa * w, ca * w), p(ca * len, sa * len), p(sa * w, -ca * w)], P.ink, { flat: true, bias: -8 });
}

export function makeStory(T) {
  const at = (n) => T.at(n), B = (n) => T.start(n);

  /* ================= the moments ================= */
  const tClock = at('clock'), tLost = at('lost'), tLaps = at('laps'), tTitle = at('title');
  const tMerged = at('merged'), tRope = at('rope'), tPull = at('pull');
  const tWeeks = at('weeks'), tTwelve = at('twelve'), tLabs = at('labs'), tUnion = at('union');
  const tTurn = at('turn'), tPath = at('path');
  const tSame = at('same'), tFlow = at('flow'), tLater = at('later');
  const tChat = at('chat'), tLookup = at('lookup'), tUnwind = at('unwind');
  const tDecision = at('decision'), tDefault = at('default'), tMostly = at('mostly'), tEnd = at('end');

  const tFreeze = B(4), tThaw = B(5);

  /* ================= what's running ================= */
  // An engine stops at c and starts at o; its shaft and belt spin down over
  // a second and up over one. Grok's first stop is the 174 minutes; the rest
  // in the case are illustrative, and Grok is down again into the turn.
  const tGrokStop = tPull + .5, tRecover = tLater + 1.4;
  const WINS = {
    grok: [[tGrokStop, B(3) + 1], [tUnion + .3, tUnion + 1.5], [tUnion + 2.6, tChat - .4]],
    openai: [[tUnion + 1, tUnion + 2]],
    anthropic: [[tUnion + 1.7, tUnion + 3]],
    claude: [[tSame + .4, tRecover]],
    little: [[tUnwind + .1, 1e9]],
  };
  const downOf = (wins) => (t) => wins.reduce((m, [c, o]) => Math.max(m, smooth(c, c + 1, t) * (1 - smooth(o, o + 1, t))), 0);
  const DOWN = Object.fromEntries(Object.entries(WINS).map(([k, w]) => [k, downOf(w)]));
  // the extra models are plugged in on {labs}; before that only Grok's belt exists
  const plugged = (k) => (k === 0 ? (t) => smooth(tRope - .2, tRope + .9, t) : (t) => smooth(tLabs + .4 + k * .5, tLabs + 1.3 + k * .5, t));

  // how far each drive has turned: the integral of its speed, held still through the turn
  const STEP = 1 / 20, N = Math.ceil((T.total + 2) / STEP);
  function integral(speed) {
    const out = new Float32Array(N + 1);
    for (let i = 1; i <= N; i++) { const t = (i - .5) * STEP; out[i] = out[i - 1] + speed(t) * STEP * (t >= tFreeze && t < tThaw ? 0 : 1); }
    return (t) => { const u = clamp(t / STEP, 0, N), i = Math.floor(u); return i >= N ? out[N] : lerp(out[i], out[i + 1], u - i); };
  }
  const RUN = Object.fromEntries(['grok', 'openai', 'anthropic', 'claude', 'little'].map((k) => [k, integral((t) => 1 - DOWN[k](t))]));
  RUN.main = integral(() => 1);

  /* ================= folding ================= */
  const unfold = (k) => (t) => smooth(B(2) - .2 + k * .16, B(2) + .9 + k * .16, t) * (1 - smooth(tMostly + .4 + k * .1, tMostly + 1.6 + k * .1, t));
  const littleFold = (i) => (t) => unfold(4)(t) * (1 - smooth(tUnwind + .5 + i * .2, tUnwind + 1.2 + i * .2, t));
  const tableFold = (t) => smooth(tUnwind + 1.4, tUnwind + 2.4, t) * (1 - smooth(tMostly + .4, tMostly + 1.4, t));

  /* ================= packets ================= */
  const V = 150;
  // packets ride a belt: their place is the belt's own travel since they
  // boarded. While a belt is stopped, new packets pile up at its feed.
  function riding(S, P, run, down, x0, x1, z, every, t, y = 30, f = 1, seed = 0) {
    const r = run(t), k0 = Math.max(0, Math.floor((t - (x1 - x0) / V * 2.5) / every));
    let pile = 0;
    for (let k = k0; k * every <= t; k++) {
      const s = k * every;
      if (down(s) > .5) { if (down(t) > .5 && s > t - 12) pile++; continue; }
      const x = x0 + V * (r - run(s));
      if (x > x1 + 10) continue;
      const fall = smooth(x1 - 20, x1 + 10, x);
      block(S, x, y * f - fall * 10, z + ((k + seed) % 3 - 1) * 8, 24, 16, 22, P.card, { alpha: f * (1 - fall) });
    }
    // the pile at the feed, stacked like folded boxes
    for (let i = 0; i < Math.min(pile, 9); i++) {
      const row = i < 4 ? 0 : i < 7 ? 1 : 2, col = i < 4 ? i : i < 7 ? i - 4 : i - 7, n = [4, 3, 2][row];
      block(S, x0 - 30 - col * 26 + (4 - n) * 13, row * 17, z + (i % 2) * 6 - 3, 24, 16, 22, mix(P.card, P.coin, .3), { alpha: f });
    }
  }

  /* ================= the clock's state ================= */
  const lostAt = (t) => 174 * easeIO(smooth(tLost + .3, tLaps + 2.2, t));
  function clockState(t) {
    if (t < B(1)) return { lost: lostAt(t), min: 17 + lostAt(t), start: 17 };
    if (t < B(5)) { const l = 174 * easeIO(smooth(tGrokStop + .5, tGrokStop + 3.5, t)); return { lost: l, min: 17 + l, start: 17 }; }
    if (t < B(7)) { const w = 177 * easeIO(smooth(tSame + .5, tFlow + 2, t)); return { worked: w, min: 26 + w, start: 26 }; }
    return { min: 11 + (t - B(7)) * 2.2, start: 0 };
  }

  /* ================= stations ================= */
  // a gantry over a belt: two folded pillars, a beam, and a gear on its face
  function station(S, P, x, z, ang, { fold = 1, h = 110, w = 90, gearR = 30, color = null, down = 0 } = {}) {
    if (fold <= .01) return;
    const col = color || mix(P.card, P.muted, .35), hh = h * fold;
    block(S, x, 0, z - 52, 26, hh, 20, col);
    block(S, x, 0, z + 52, 26, hh, 20, col);
    block(S, x, hh, z, w, 26 * fold, 124, mix(col, P.stop, .25 * down));
    gear(S, [x, hh - 8, z - 68], gearR, ang, { fold, color: down > .5 ? mix(P.grid, P.coin, .2) : null });
    if (fold > .5) shadow(S, [[x - w / 2, hh + 26, z - 62], [x + w / 2, hh + 26, z - 62], [x - w / 2, hh + 26, z + 62], [x + w / 2, hh + 26, z + 62]], .05 * fold);
  }
  // an engine outside the wall: a big folded house, a flywheel, a status lamp
  function engine(S, P, x, z, ang, down, { fold = 1, w = 190, roof = null } = {}) {
    building(S, { x, z, w, d: 150, h: 130, roof: .35, fold, windows: [[.2, .55], [.8, .55]], lit: .85 * (1 - down), roofColor: roof || mix(P.ink, P.grid, .35) });
    if (fold > .3) gear(S, [x, 108, z - 75 - 12], 54, ang, { fold, teeth: 14, thick: 14 });
    lamp(S, x + w / 2 + 26, z - 40, down, { fold, h: 150 });
  }

  /* ================= the world ================= */
  function world(S, t, P) {
    const f = unfold(0)(t);
    // the page: newsprint under the machine
    newsprint(S, -1250, 120, 14, 24, { alpha: .05 });
    newsprint(S, 300, 1700, 8, 18, { alpha: .045, seed: 7 });
    // the factory wall, with the clock tower in it
    const wf = t < B(1) ? 1 : unfold(1)(t);
    block(S, (WALL.x0 + TOWER.x - 40) / 2, 0, WALL.z, TOWER.x - 40 - WALL.x0, WALL.h * wf, 18, mix(P.card, P.ink, .3));
    block(S, (TOWER.x + 40 + WALL.x1) / 2, 0, WALL.z, WALL.x1 - TOWER.x - 40, WALL.h * wf, 18, mix(P.card, P.ink, .3));
    building(S, { x: TOWER.x, z: TOWER.z, w: TOWER.w, d: TOWER.d, h: TOWER.h, roof: 1.1, fold: wf, roofColor: mix(P.ink, P.grid, .3), color: mix(P.card, P.grid, .2) });
    const a = (1 - smooth(0, .6, wf)) * Math.PI / 2, onFront = (p) => rotate(p, [0, 0, TOWER.z - TOWER.d / 2], [1, 0, 0], -a);
    if (wf > .05) { const cs = clockState(t); dialFaces(S, DIAL_C, 31, cs, P, onFront); dialHand(S, DIAL_C, 34, cs.min, P, onFront); }

    // GitHub's own machine: the main belt and its stations, always running
    const beltC = mix(P.ink, P.grid, .55), ghC = mix(P.water, P.card, .5);
    belt(S, MAIN.x0, MAIN.x1, MAIN.z, { phase: RUN.main(t) * V, fold: f, color: beltC });
    STATIONS.forEach((s, k) => station(S, P, s.x, MAIN.z, RUN.main(t) * 1.6 + k, { fold: unfold(k)(t), color: ghC }));
    riding(S, P, RUN.main, () => 0, MAIN.x0, MAIN.x1, MAIN.z, .8, t, 30, f, 0);

    // Copilot: a belt per model, a turbine per belt, a shaft out to each engine
    LABS.forEach((l, k) => {
      const pk = plugged(k)(t) * unfold(2)(t), dn = DOWN[l.id](t), ang = RUN[l.id](t) * 1.8;
      if (pk <= .01) return;
      belt(S, COP.x0, COP.x1, l.lane, { phase: RUN[l.id](t) * V, fold: pk, color: beltC });
      station(S, P, l.tx, l.lane, ang, { fold: pk, h: 120, down: dn, gearR: 34 });
      riding(S, P, RUN[l.id], DOWN[l.id], COP.x0, COP.x1, l.lane, 1.1, t, 30, pk, k);
      shaft(S, [l.tx, SHAFT_Y, l.lane], [l.tx, SHAFT_Y, ENGINE_Z - 75], ang * 2, { draw: easeIO(pk) });
      engine(S, P, l.tx, ENGINE_Z, ang, dn, { fold: smooth(.2, 1, pk), roof: [mix(P.ink, P.grid, .2), mix(P.water, P.ink, .35), mix(P.coin, P.stop, .35)][k] });
    });

    // the airbrx line: rules, cache, data, on its own drive; Claude beside it
    const af = unfold(3)(t);
    belt(S, AB.x0, AB.x1, AB.z, { phase: RUN.main(t) * V, fold: af, color: beltC });
    station(S, P, AB.rules, AB.z, RUN.main(t) * 1.6, { fold: af, color: mix(P.ok, P.card, .6) });
    shelf(S, P, AB.cache, AB.z, af);
    block(S, AB.data, 0, AB.z + 80, 110, 70 * af, 70, mix(P.muted, P.water, .3));
    riding(S, P, RUN.main, () => 0, AB.x0, AB.x1, AB.z, .7, t, 30, af, 1);
    engine(S, P, CLAUDE.x, CLAUDE.z, RUN.claude(t) * 1.6, DOWN.claude(t), { fold: unfold(3)(t), w: 170, roof: mix(P.coin, P.stop, .35) });
    slips(S, P, t, af);

    // the little turbines, each on a long shaft to the engines; then a table
    belt(S, LITTLE.x0, LITTLE.x1, LITTLE.z, { phase: RUN.little(t) * V, fold: unfold(4)(t), color: beltC });
    LITTLE.xs.forEach((x, i) => {
      const lf = littleFold(i)(t), ang = RUN.little(t) * 2.4 + i;
      station(S, P, x, LITTLE.z, ang, { fold: lf, h: 74, w: 60, gearR: 20 });
      shaft(S, [x + 14, SHAFT_Y + 30, LITTLE.z], [x + 14, SHAFT_Y + 30, ENGINE_Z - 75], ang * 2, { draw: lf * smooth(tLookup + i * .2, tLookup + 1 + i * .2, t), r: 4 });
    });
    table(S, t, P);
    tape(S, t, P);
  }

  // the cache: a shelf of sealed answers beside the belt
  function shelf(S, P, x, z, f) {
    if (f <= .01) return;
    const wood = mix(P.coin, P.card, .5);
    block(S, x, 0, z + 70, 120, 8, 40, wood); block(S, x, 50 * f, z + 70, 120, 6, 40, wood);
    block(S, x - 56, 0, z + 70, 8, 90 * f, 40, wood); block(S, x + 56, 0, z + 70, 8, 90 * f, 40, wood);
    for (let i = 0; i < 4; i++) { block(S, x - 36 + i * 24, 8, z + 70, 18, 14 * f, 18, P.card); block(S, x - 36 + i * 24, 56 * f, z + 70, 18, 14 * f, 18, P.card); }
  }
  // observations on paper slips from the rules station to Claude, and
  // suggestions back. While Claude is down the slips wait in its tray.
  function slips(S, P, t, f) {
    if (f <= .01) return;
    const from = [AB.rules, 6, AB.z - 60], to = [CLAUDE.x - 40, 6, CLAUDE.z + 80];
    S.line(from, to, P.ink, { alpha: .3 * f, lw: 1.5 });
    for (let i = 0; i < 26; i++) {
      const s = B(2) + i * .9 + (i > 12 ? (tLater - B(2) - 11) : 0), dn = DOWN.claude;
      if (t < s) continue;
      const u = smooth(s, s + 1.6, t);
      // a slip that arrives while Claude is down waits in the tray until it's back
      const arrive = s + 1.6, held = dn(arrive) > .5 && arrive < tRecover, done = held ? tRecover + .3 + (i % 6) * .15 : arrive;
      if (t > done + .2 && !held) continue;
      const back = held ? smooth(done, done + 1.4, t) : 0;
      if (back >= 1) continue;
      let p;
      if (back > 0) p = [lerp(to[0], from[0], back), 6 + Math.sin(Math.PI * back) * 30, lerp(to[2], from[2], back)];
      else if (u < 1) p = [lerp(from[0], to[0], u), 6 + Math.sin(Math.PI * u) * 30, lerp(from[2], to[2], u)];
      else p = [to[0] + 30 + (i % 4) * 16, 4 + Math.floor((i % 12) / 4) * 4, to[2] + 10];
      block(S, p[0], p[1], p[2], 16, 3, 12, back > 0 ? P.ok : P.card, { alpha: f });
    }
  }
  function table(S, t, P) {
    const k = tableFold(t);
    if (k <= .01) return;
    const x = 890, z = LITTLE.z, w = 300, d = 110, hh = 50 * k, wood = mix(P.coin, P.card, .45);
    block(S, x, hh - 6, z, w, 6, d, wood);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(S, x + dx * (w / 2 - 10), 0, z + dz * (d / 2 - 10), 7, Math.max(1, hh - 6), 7, shade(wood, -.1));
    for (let i = 0; i < 8; i++) block(S, x - w / 2 + 28 + i * 35, hh, z - 14 + (i % 2) * 24, 22, 12 * k, 18, P.card);
    shadow(S, [[x - w / 2, hh, z - d / 2], [x + w / 2, hh, z - d / 2], [x - w / 2, hh, z + d / 2], [x + w / 2, hh, z + d / 2]], .06);
  }
  function tape(S, t, P) {
    const k = smooth(tWeeks - .4, tWeeks + .6, t) * (1 - smooth(B(4) - .6, B(4), t));
    if (k <= .01) return;
    const z = TAPE.z, x1 = lerp(TAPE.x0 - 40, TAPE.x1 + 40, easeIO(k));
    S.poly([[TAPE.x0 - 40, .6, z - 34], [x1, .6, z - 34], [x1, .6, z + 34], [TAPE.x0 - 40, .6, z + 34]], P.card, { layer: 1, flat: true });
    const red = smooth(tTwelve, tTwelve + .6, t);
    for (const m of MARKS) {
      const pf = smooth(tWeeks + .3 + m.i * .05, tWeeks + .6 + m.i * .05, t) * k;
      pennant(S, markX(m.d), z - 18 + m.n * 18, { color: m.up ? mix(P.card, P.stop, red) : mix(P.card, P.grid, .3), fold: pf, h: m.up ? 46 + 16 * red : 46, flap: Math.sin(t * 3 + m.i) * 2 });
    }
  }

  /* ================= the camera ================= */
  const D = DIAL_C, G = LABS[0];
  const CAM = cameraPath([
    [0, [D[0] + 10, D[1] + 4, D[2] - 170], D],
    [tLaps + 2.5, [D[0] - 10, D[1] + 4, D[2] - 150], D],
    // the machine, unfolding
    [B(2), [-1300, 540, 380], [-480, 30, 1000]],
    [tMerged + .8, [-250, 500, 420], [420, 30, 1060]],
    // Copilot's belt, its shaft, out through the wall to the engine
    [tRope + .3, [650, 520, 650], [1200, 60, 1450]],
    [tRope + 1.8, [1000, 640, 1450], [G.tx, 90, 2300]],
    [tPull - .1, [G.tx - 60, 330, 1950], [G.tx, 110, ENGINE_Z]],
    [tPull + 1.6, [G.tx - 60, 330, 1950], [G.tx, 110, ENGINE_Z]],
    [tPull + 3.4, [880, 380, 800], [1150, 30, G.lane]],
    [T.end(2), [880, 380, 800], [1150, 30, G.lane]],
    // the status page as a ticker tape, then the engines
    [B(3), [-1300, 100, 540], [-800, 30, 700]],
    [tTwelve - .2, [650, 100, 540], [1150, 30, 700]],
    [tTwelve + 1.2, [0, 800, -150], [0, 0, 800]],
    [tLabs + 1.4, [1000, 760, 1500], [1000, 70, ENGINE_Z]],
    [tUnion + .2, [400, 1250, 250], [950, 0, 1750]],
    // the turn: Grok's belt, jammed
    [B(4), [880, 250, 960], [1120, 30, G.lane]],
    [tThaw, [900, 245, 985], [1120, 30, G.lane]],
    // the airbrx line and Claude beside it
    [tThaw + .01, [-1850, 520, -250], [-1050, 30, 430]],
    [tLater, [-1700, 470, -180], [-1050, 30, 400]],
    [B(6), [-1700, 470, -180], [-1050, 30, 400]],
    // Copilot again, then the little turbines and their table
    [B(6) + .01, [560, 520, 700], [1000, 60, 1350]],
    [tLookup - .2, [560, 520, 700], [1000, 60, 1350]],
    [tLookup + 1.4, [880, 520, 150], [890, 40, 900]],
    [B(7), [880, 520, 150], [890, 40, 900]],
    // the clock, then up and away while the machine folds into the page
    [B(7) + .01, [D[0], D[1] + 20, D[2] - 270], [D[0], D[1] - 20, D[2]]],
    [tDefault, [D[0], D[1] + 20, D[2] - 270], [D[0], D[1] - 20, D[2]]],
    [tDefault + 1, [-100, 700, 600], [0, 0, 1300]],
    [tMostly, [0, 1000, -700], [0, 0, 1000]],
    [tEnd + 3, [0, 1600, -500], [0, 0, 1100]],
  ]);

  /* ================= labels ================= */
  function tag(g, cam, p, s, size, color, alpha, o = {}) {
    if (alpha <= .01) return;
    const q = cam.project(p);
    if (q) serif(g, s, q[0], q[1], size, color, { weight: 400, base: 'middle', align: 'center', alpha, ...o });
  }

  /* ================= the scenes ================= */
  function sceneWorld(g, t, P) {
    ground(g, P);
    const cam = CAM(t), S = scene(cam, P);
    world(S, t, P);
    S.flush(g);
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 2) {
      STATIONS.forEach((s) => tag(g, cam, [s.x, 175, MAIN.z - 60], s.name, 19, P.ink, smooth(at(s.id), at(s.id) + .4, t)));
      tag(g, cam, [COP.x0 + 120, 60, G.lane - 50], 'Copilot', 21, P.ink, smooth(tRope, tRope + .5, t), { weight: 700 });
      tag(g, cam, [G.tx, 250, ENGINE_Z - 60], 'xAI', 22, DOWN.grok(t) > .3 ? P.stop : P.ink, smooth(tRope + 1.4, tRope + 1.9, t) * (1 - smooth(tPull + 2.6, tPull + 3, t)), { weight: 700 });
    }
    if (n === 3) {
      const ends = smooth(tWeeks, tWeeks + .5, t) * (1 - smooth(tTwelve + .3, tTwelve + .8, t));
      tag(g, cam, [TAPE.x0 - 40, 4, TAPE.z + 70], '14 July', 17, P.text, ends, { italic: true });
      tag(g, cam, [TAPE.x1 + 40, 4, TAPE.z + 70], '3 September', 17, P.text, ends, { italic: true });
      const ta = smooth(tTwelve + 1, tTwelve + 1.5, t) * (1 - smooth(tLabs, tLabs + .4, t));
      if (ta > .01) serif(g, '12 of 50', W / 2, 140, 44, P.stop, { weight: 700, align: 'center', alpha: ta });
      LABS.forEach((l, k) => {
        const dn = DOWN[l.id](t) > .3, a = smooth(tLabs + .5 + k * .5, tLabs + 1 + k * .5, t) * (t < tUnion + .2 ? 1 : dn ? 1 : .35);
        tag(g, cam, [l.tx, 260, ENGINE_Z - 60], l.name, 21, dn ? P.stop : P.ink, a, { weight: 700 });
      });
    }
    if (n === 5) {
      tag(g, cam, [AB.rules, 200, AB.z - 60], 'airbrx gateway', 20, P.ink, smooth(tFlow, tFlow + .5, t), { weight: 700 });
      tag(g, cam, [CLAUDE.x, 230, CLAUDE.z - 60], 'Claude', 20, DOWN.claude(t) > .3 ? P.stop : P.ink, smooth(tSame + .2, tSame + .7, t), { weight: 700 });
    }
    if (n === 6) {
      tag(g, cam, [COP.x0 + 150, 70, G.lane - 50], 'Copilot Chat', 20, P.ink, smooth(tChat, tChat + .5, t) * (1 - smooth(tLookup, tLookup + .4, t)), { weight: 700 });
      tag(g, cam, [890, 120, LITTLE.z], 'plain code', 20, P.ok, smooth(tUnwind + 2.2, tUnwind + 2.7, t), { italic: true });
    }
    return cam;
  }
  function scene0(g, t, P) {
    const cam = sceneWorld(g, t, P);
    const q = cam.project(DIAL_C), m = lostAt(t), ca = smooth(tLost + .4, tLost + .8, t);
    if (q && ca > .01 && m > .5) {
      const px = cam.F * 31 * .42 / q[2];
      serif(g, String(Math.round(m)), q[0], q[1] + px * .08, px * .9, P.stop, { weight: 700, align: 'center', alpha: ca, base: 'middle' });
    }
  }
  function scene1(g, t, P) {
    ground(g, P);
    titleCard(g, t, tTitle, P, { headline: "GitHub Didn't Break Today", dek: 'Its model vendor did.', dateline: 'From the Report of 3 September 2026' }, smooth(B(2) - .7, B(2) - .1, t));
  }
  function scene7(g, t, P) {
    sceneWorld(g, t, P);
    const sa = smooth(tEnd + .4, tEnd + 1.4, t);
    if (sa > .01) { g.save(); g.globalAlpha = sa * .75; ground(g, P); g.restore(); signoff(g, W / 2, 290, P, sa); }
  }
  function draw(g, t, P) {
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 1) scene1(g, t, P);
    else if (n === 0) scene0(g, t, P);
    else if (n === 7) scene7(g, t, P);
    else sceneWorld(g, t, P);
    reportBug(g, P, smooth(B(2) + .4, B(2) + 1.4, t) * (1 - smooth(tEnd, tEnd + .5, t)));
    let d = 0;
    for (const k of [1, 2, 3, 5, 6, 7]) { const s = B(k); d = Math.max(d, t < s ? smooth(s - .3, s, t) : 1 - smooth(s, s + .3, t)); }
    if (d > .001) { g.save(); g.globalAlpha = clamp(d, 0, 1); ground(g, P); g.restore(); }
  }
  const bug = () => 0;

  /* ================= sound ================= */
  const sounds = [];
  const fx = (t, kind, v = 1) => sounds.push({ t, kind, v });
  fx(tClock, 'tick', .6);
  for (let k = 0, x = tLost + .3; x < tLaps + 2.2; k++) { fx(x, 'tick', .35 + .2 * Math.min(1, k / 20)); x += Math.max(.07, .38 - k * .025); }
  fx(tLaps + 2.25, 'stamp', .9);
  fx(tTitle + .2, 'intro', 1);
  // the machine unfolds out of the page
  [0, 1, 2, 3, 4].forEach((k) => fx(B(2) + .1 + k * .16, 'page', .32));
  STATIONS.forEach((s) => fx(at(s.id) + .05, 'latch', .3));
  // Grok's shaft couples in; then its engine stops and the belt jams
  fx(tRope + .8, 'latch', .7); fx(tRope + .85, 'thud', .4);
  fx(tGrokStop, 'powerDown', .55); fx(tGrokStop + .9, 'reject', .45);
  for (let k = 0; k < 5; k++) fx(tGrokStop + 1.3 + k * 1.1, 'click', .3);
  // the tape, tab by tab; the twelve; two more shafts coupled in
  MARKS.forEach((m) => { if (m.i % 3 === 0) fx(tWeeks + .45 + m.i * .05, 'paper', .25); });
  for (let k = 0; k < 12; k++) fx(tTwelve + .05 + k * .05, 'hit', .3);
  [1, 2].forEach((k) => fx(tLabs + 1.2 + k * .5, 'latch', .6));
  for (const k of ['grok', 'openai', 'anthropic']) WINS[k].forEach(([c]) => { if (c > tUnion && c < B(4)) fx(c, 'powerDown', .4); });
  fx(tPath + .1, 'rule', .55);
  // Claude stops; the line doesn't; the slips come back
  fx(tSame + .4, 'powerDown', .45);
  fx(tRecover, 'blip', .5); fx(tRecover + .5, 'sparkle', .45); fx(tRecover + 1.6, 'save', .5);
  LITTLE.xs.forEach((_, i) => { fx(tLookup + i * .2 + .6, 'latch', .3); fx(tUnwind + .5 + i * .2, 'page', .4); });
  fx(tUnwind + 1.8, 'stamp', .5);
  for (let k = 0; k < 12; k++) fx(tDefault + .2 + k * .08, 'tick', .25);
  [0, 1, 2, 3, 4].forEach((k) => fx(tMostly + .5 + k * .12, 'page', .35));
  fx(tEnd + .5, 'resolve', .7); fx(tEnd + 1.2, 'logo', .7);
  sounds.sort((p, q) => p.t - q.t);

  const lin = (list) => (t) => {
    if (t <= list[0][0]) return list[0][1];
    for (let i = 0; i < list.length - 1; i++) if (t < list[i + 1][0]) return lerp(list[i][1], list[i + 1][1], (t - list[i][0]) / Math.max(.001, list[i + 1][0] - list[i][0]));
    return list[list.length - 1][1];
  };
  const intensity = lin([[0, .45], [B(2), .45], [tPull, .6], [B(3), .55], [tUnion, .8], [B(4), .8], [B(5), .55], [B(6), .45], [T.total, .4]]);
  const audio = (t) => ({
    wind: 0, speed: 0, swarm: 0,
    tick: (t > tClock && t < tLost + .3) || (t > tDecision && t < tDefault) ? 1 : 0,
    // the machine's own hum, under everything on the floor; it drops away as it folds
    hum: (t > B(2) && t < B(4)) || (t >= B(5) && t < tMostly + 1) ? .22 : t >= B(4) && t < B(5) ? .32 : 0,
    intensity: intensity(t),
    riser: smooth(tUnion + 1, B(4) - .05, t) * (t < B(4) ? .6 : 0),
    fade: 1 - smooth(T.total - 2.5, T.total - .2, t),
  });

  checkSounds(sounds);
  return { draw, bug, sounds, audio, score: scoreFor(T, SCORE) };
}
