/* story.js - "Probe All You Want": a street at night, in fog.

   The place (STYLE.md, "find the world"): one street, folded out of the
   page, on the night a new site goes up.

   - Their lot: a full-stack shop with everything out. A wp-admin front
     door, a key under the mat (.env), a shed (.git), a cellar (the data), a
     mail slot (mailer.cgi), a chimney (the runtime). Knock on any of them
     and something inside wakes up.
   - Our address: a new house that is only a house front, printed on one
     sheet standing on the pavement, its door cut into the paper like an
     advent-calendar flap. It opens on the cold open; the bots arrive at it.
     Beside it, a counter where the CDN hands every caller the same printed
     slip: not here. The protection isn't a wall: reach through the door and
     your hand comes out the back, into fog, holding nothing.
   - The notice board in the middle of the street is the Certificate
     Transparency log: our page gets pinned to it, and the bots come out
     of the fog to read it.
   - We follow one bot from the board to every door of the shop.
   - The spine: two receipts at the right edge of the frame. Theirs runs
     long and red; ours barely moves.
   - The rhyme: the same night, rewound at our address. The shop folds
     down into the page and leaves its doors as dashed outlines.

   Built with brand/fold.js. Nothing hardcodes a moment: every build hangs
   off a {cue} (T.at) or a beat edge. */

import { clamp, lerp, smooth, easeIO, seeded, ground } from '../lib/sketch.js';
import { titleCard, signoff, reportBug, serif, serifWidth, underline, tornStrip } from '../brand/report.js';
import { mix, shade, rgb } from '../brand/color.js';
import { scene, cameraPath, rotate, place3, building, block, newsprint, shadow } from '../brand/fold.js';
import { bot3, track, onto, doorPanel, dashed, dashedRect as rect, lerp3, houseFront, mist } from '../brand/street.js';
import { makePhone, drawReceipts } from '../brand/hud.js';
import { scoreFor, checkSounds } from '../score/sound.js';

export const W = 1280, H = 720;

export const BEATS = {
  0: { min: 8, cues: { log: 2, fifty: 4 } },
  1: { min: 5, cues: { title: 4.8 } },
  2: { min: 13, cues: { street: 2.5, cert: 2, board: 2.5, readers: 2.5, seconds: 3 } },
  3: { min: 22, cues: { follow: 2.4, wpadmin: 2.2, mat: 2, shed: 2, slot: 2.4, old: 3, dictionary: 3.5 } },
  4: { min: 13, cues: { city: 2.5, sessions: 2.5, ips: 2, la: 2.5, unseen: 3 } },
  5: { min: 22, cues: { key: 2.5, keys: 2, lambdas: 2.5, next: 3, mining: 2, ransom: 2.5, prize: 3.5 } },
  6: { min: 18, cues: { scale: 2, eight: 3.5, burst: 4, host: 2, tent: 2.5, rope: 3 } },
  7: { min: 8, cues: { turn: 2, nothing: 3.5 } },
  8: { min: 8, cues: { slips: 2.5, cost: 3 } },
  9: { min: 16, cues: { rewind: 3, files: 2.5, storage: 3, missing: 2.5, shape: 3 } },
  10: { min: 10, cues: { lane: 2, editor: 2.5, asleep: 2.5, notzero: 3 } },
  11: { min: 10, cues: { weather: 2, open: 3.5, end: 6 } },
};

/* The score: sections started by "> ♪ name" lines in script.md. */
export const SCORE = {
  key: 'D',
  sections: {
    // the counter at night, the log ticking
    hush: { mode: 'dorian', bpm: 70, prog: [0, 3], bars: 2, pad: .4, keys: .5, bells: .3, drone: .4, fade: 1 },
    // the street unfolding in fog
    fog: { mode: 'dorian', bpm: 76, prog: [0, 5, 3], bars: 2, pad: .6, keys: .5, bells: .25, drone: .5, fade: 2 },
    // every door: the ticking engine starts
    knock: { mode: 'minor', bpm: 88, prog: [0, 5, 2, 6], bars: 2, padTone: 'strings', pad: .5, pluck: .6, bass: .4, drone: .5 },
    // the whole city's weather
    city: { mode: 'minor', bpm: 88, prog: [0, 5, 2, 6], bars: 1, padTone: 'strings', pad: .6, pluck: .9, bass: .7, kick: .5, hat: .4, drone: .5, level: -1 },
    // what they're after: heavier, darker
    take: { mode: 'phrygian', bpm: 84, prog: [0, 1], bars: 2, padTone: 'strings', pad: .6, pluck: .8, bass: .8, kick: .45, drone: .6, level: -1 },
    // the fair hearing: daylight reasoning, no rhythm to speak of
    hearing: { mode: 'dorian', bpm: 80, prog: [0, 3], bars: 2, pad: .6, keys: .5, bass: .3, drone: .3, fade: 2.5 },
    // the turn: a held chord in fog
    turn: { mode: 'minor', bpm: 60, prog: [0], bars: 4, padTone: 'strings', pad: .45, drone: .6, fade: 2.5 },
    // the other side of the ledger: the key turns major
    ledger: { mode: 'major', bpm: 92, prog: [0, 4, 5, 3], bars: 1, pad: .5, arp: .55, bass: .45, bells: .3, fade: 2 },
    // the same night, emptied
    flat: { mode: 'major', bpm: 96, prog: [0, 4, 5, 3], bars: 1, pad: .5, arp: .7, bass: .55, kick: .4, hat: .4, bells: .3, fade: 1.5 },
    // the shed, an aside
    shed: { mode: 'major', bpm: 72, prog: [0, 3], bars: 2, pad: .6, keys: .6, bells: .3, drone: .3 },
    // an open house
    end: { mode: 'major', bpm: 66, prog: [0, 3, 4, 0], bars: 2, pad: .7, bells: .55, keys: .3, drone: .35, fade: 2.5 },
  },
};

/* ================= the street ================= */
// x runs along the street, z away from the camera; the street is z 880..1020.
const STREET = { z0: 880, z1: 1020 };
const SHOP = { x: -800, z: 1300, w: 300, d: 220, h: 170 };
const FRONT = SHOP.z - SHOP.d / 2;                       // the shop's front wall
const DOOR = { x: SHOP.x, w: 54, h: 96 };
const MAT = { x: SHOP.x, z: FRONT - 34, w: 72, d: 34 };
const SHED = { x: -470, z: 1270, w: 90, d: 80, h: 72 };
const CELLAR = { x: -1040, z: FRONT - 40, w: 76, d: 44 };
const CHIMNEY = { x: -730, z: SHOP.z + 30 };
const LOT = { x0: -1260, x1: -320, z0: FRONT - 90, z1: 1720 };
const LAMBDAS = [[-1150, 1560], [-1000, 1650], [-560, 1600], [-420, 1680]];
// and the ones they keep building after: a town of little workshops filling the lot
const MORE = [[-1200, 1440], [-1080, 1470], [-860, 1520], [-720, 1480], [-1210, 1680], [-860, 1660], [-700, 1640], [-560, 1470], [-410, 1450], [-1110, 1200], [-1220, 1300], [-400, 1350]];
const COPIES = [[-1170, 1480], [-1030, 1480], [-890, 1600], [-1170, 1640], [-560, 1470], [-430, 1560], [-700, 1660]];

const STAND = { x: 700, z: 1150, w: 230, h: 270, eaves: 190 };   // our house front, one sheet
const PDOOR = { w: 62, h: 112 };                          // the door cut into it
const COUNTER = { x: 450, z: 1060, w: 210, h: 58, d: 46 };   // beside the page, so its printed door is clear
const LIVE = { x: 900, z: 1075 };                         // the box of finished pages
const BOARD = { x: 0, z: 820, w: 300, h: 180, y: 70 };   // the CT log
const EDSHED = { x: 1650, z: 2050, w: 120, d: 100, h: 90 };
const NEIGHBOURS = [[-2050, 1250], [-1600, 1300], [1500, 1260], [1950, 1300]];

export function makeStory(T) {
  const at = (n) => T.at(n), B = (n) => T.start(n);

  /* ================= the moments ================= */
  const tLog = at('log'), tFifty = at('fifty'), tTitle = at('title');
  const tStreet = at('street'), tCert = at('cert'), tBoard = at('board'), tReaders = at('readers'), tSeconds = at('seconds');
  const tFollow = at('follow'), tWpadmin = at('wpadmin'), tMat = at('mat'), tShed = at('shed'), tSlot = at('slot'), tOld = at('old'), tDict = at('dictionary');
  const tCity = at('city'), tSessions = at('sessions'), tIps = at('ips'), tLa = at('la'), tUnseen = at('unseen');
  const tKey = at('key'), tKeys = at('keys'), tLambdas = at('lambdas'), tNext = at('next'), tMining = at('mining'), tRansom = at('ransom'), tPrize = at('prize');
  const tScale = at('scale'), tEight = at('eight'), tBurst = at('burst'), tHost = at('host'), tTent = at('tent'), tRope = at('rope');
  const tTurn = at('turn'), tNothing = at('nothing');
  const tSlips = at('slips'), tCost = at('cost');
  const tRewind = at('rewind'), tFiles = at('files'), tStorage = at('storage'), tMissing = at('missing'), tShape = at('shape');
  const tLane = at('lane'), tEditor = at('editor'), tAsleep = at('asleep'), tNotzero = at('notzero');
  const tWeather = at('weather'), tOpen = at('open'), tEnd = at('end');

  /* ================= folding ================= */
  // the street unfolds out of the page at beat 02, piece by piece
  const up = (k) => (t) => (t < B(1) ? (k === 0 ? 1 : 0) : smooth(B(2) - .1 + k * .22, B(2) + .9 + k * .22, t));
  const standF = (t) => smooth(tLog + .2, tLog + 2.2, t), boardF = up(1), shopF0 = up(2), nbrF = up(3);
  const doorOpen = (t) => smooth(tLog + 2.5, tLog + 3.5, t);
  // the shop folds flat into the page on the rewind, and stays flat
  const shopFold = (t) => shopF0(t) * (1 - smooth(tRewind + .4, tRewind + 2.2, t));
  const tentF = (t) => smooth(tTent - .1, tTent + 1.1, t) * (1 - smooth(B(7) - .8, B(7) - .1, t));
  // each Lambda house is built by a bot that walks in from the mat with the keys
  const builtAt = (i) => tLambdas + 1.4 + i * .25;
  const lambdaF = (i) => (t) => smooth(builtAt(i), builtAt(i) + 1.4, t) * (1 - smooth(B(6) - .6, B(6), t));
  // the rest go up one after another, from the first scan out to the pull quote
  const moreAt = (i) => lerp(tNext + 2.4, tPrize - 1.6, i / (MORE.length - 1));
  const moreF = (i) => (t) => smooth(moreAt(i), moreAt(i) + 1, t) * (1 - smooth(B(6) - .6, B(6), t));
  // the burst that scales the shop, and then the same burst at our address
  const waveHit = tEight + 1.6;
  const copiesF = (i) => (t) => smooth(waveHit + i * .25, waveHit + .5 + i * .25, t) * (1 - smooth(tBurst + .9 + i * .08, tBurst + 1.5 + i * .08, t));

  /* ================= the bots ================= */
  // where the shop's doors are tried from, and what each spot faces
  const SPOT = {
    door: [DOOR.x + 6, FRONT - 40, DOOR.x, FRONT], mat: [MAT.x - 30, MAT.z - 26, MAT.x, MAT.z], slot: [DOOR.x - 14, FRONT - 34, DOOR.x, FRONT],
    shed: [SHED.x, SHED.z - SHED.d / 2 - 34, SHED.x, SHED.z], cellar: [CELLAR.x, CELLAR.z - 42, CELLAR.x, CELLAR.z],
    pdoor: [STAND.x, STAND.z - 40, STAND.x, STAND.z],
  };
  const r0 = seeded(1234);
  const N = 26;
  const BOTS = [];
  for (let i = 0; i < N; i++) {
    const side = i % 2 ? 1 : -1, ph = r0();
    const start = [B(2) + .6 + i * .12, side * (2700 + r0() * 400), lerp(STREET.z0, STREET.z1, r0())];
    // in front of the board, in a loose arc, reading
    const ang = Math.PI * (.12 + .76 * (i / (N - 1))), board = [BOARD.x - Math.cos(ang) * (230 + (i % 3) * 50), BOARD.z - 60 - Math.sin(ang) * (120 + (i % 3) * 40)];
    const tArrive = tReaders + .2 + (i / N) * 2.2;
    // then every door on the street: the shop's, ours, the neighbours'
    let target;
    if (i === 0) target = SPOT.door;
    else if (i < 8) target = [[SPOT.door, SPOT.mat, SPOT.slot, SPOT.shed, SPOT.cellar, SPOT.mat, SPOT.cellar][i - 1]].map((s) => [s[0] + (r0() - .5) * 50, s[1] - 20 - r0() * 30, s[2], s[3]])[0];
    else if (i < 15) { const k = i - 8; target = [COUNTER.x - 90 + k * 30, COUNTER.z - 60 - (k % 2) * 34, COUNTER.x, COUNTER.z]; }
    else { const n = NEIGHBOURS[(i - 15) % 4]; target = [n[0] + (r0() - .5) * 120, n[1] - 150 - r0() * 40, n[0], n[1]]; }
    const tGo = tFollow + .4 + (i ? (i % 9) * .25 : 0);
    const keys = [start, [tArrive, ...board, BOARD.x, BOARD.z], [tGo + .1, ...board, BOARD.x, BOARD.z], [tGo + 2.4, ...target]];
    // the followed bot works down the shop's doors on the narrator's words
    if (i === 0) keys.push([tMat + .6, ...SPOT.mat], [tShed + .7, ...SPOT.shed], [tSlot + .8, ...SPOT.slot], [B(4), ...SPOT.slot]);
    // on the rewind, the shop's callers cross to our address and find the same slips
    if (i < 8) { const k = i; keys.push([tRewind + 2.2, ...target], [tRewind + 5 + k * .2, COUNTER.x - 120 + k * 34, COUNTER.z - 150 - (k % 2) * 30, COUNTER.x, COUNTER.z]); }
    BOTS.push({ i, ph, at: track(keys), target, shop: i < 8, ours: i >= 8 && i < 15 });
  }
  const F = BOTS[0];
  // the cold open's crowd: out of the fog to the new house's door, on {fifty}
  const OPEN = (() => {
    const r = seeded(4321), out = [];
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1, ang = Math.PI * (.15 + .7 * ((i * 5) % 14) / 13), rad = 90 + (i % 3) * 55;
      const from = [STAND.x + side * (900 + r() * 700), STAND.z - 200 - r() * 600], spot = [STAND.x + Math.cos(ang) * rad * 1.5, STAND.z - 50 - Math.sin(ang) * rad];
      const t0 = tFifty - .6 + i * .16;
      out.push({ i, ph: r(), at: track([[t0, ...from], [t0 + 2.6, ...spot, STAND.x, STAND.z]]), t0 });
    }
    return out;
  })();
  const arrived = (t) => OPEN.reduce((n, b) => n + (t > b.t0 + 2.4 ? 1 : 0), 0);
  // the builders: from the mat, with the keys, to each house site inside the fence
  const BUILD = LAMBDAS.map(([lx, lz], i) => ({ at: track([[tLambdas + i * .15, MAT.x - 30 + i * 18, MAT.z - 30], [builtAt(i), lx + (i % 2 ? 46 : -46), lz - 30, lx, lz]]) }));
  // the spew: out of the houses, through the fence, round the neighbours on the left
  const SPEW = (() => {
    const r = seeded(777), out = [];
    for (let k = 0; k < 30; k++) {
      const [lx, lz] = LAMBDAS[k % 4], n = NEIGHBOURS[k % 2], a = (k * 1.37) % (Math.PI * 2), t0 = tNext + .15 + k * .12;
      const spot = [n[0] + Math.cos(a) * 170, n[1] + Math.sin(a) * 130];
      out.push({ t0, ph: r(), at: track([[t0, lx, lz], [t0 + 2.4, ...spot, n[0], n[1]]]) });
    }
    return out;
  })();
  // the wave: 36 callers in a burst, the first half to the shop, the rest, at {burst}, to us
  const WAVE = (() => {
    const r = seeded(888), out = [];
    for (let k = 0; k < 44; k++) {
      const ours = k >= 22, j = ours ? k - 22 : k, t0 = (ours ? tBurst - .4 : tEight + .2) + j * .05;
      const from = [2700 + r() * 600, lerp(STREET.z0, STREET.z1, r())];
      const spot = ours ? [STAND.x - 340 + (j % 11) * 46, STAND.z - 170 - Math.floor(j / 11) * 50] : [SHOP.x - 280 + (j % 11) * 52, LOT.z0 - 50 - Math.floor(j / 11) * 50];
      const face = ours ? [COUNTER.x, COUNTER.z] : [SHOP.x, SHOP.z];
      out.push({ ours, t0, t1: ours ? B(7) - .4 : tBurst + 1.4, hit: t0 + 1.8, ph: r(), at: track([[t0, ...from], [t0 + 1.8, ...spot, ...face]]) });
    }
    return out;
  })();
  // the open house, at the end: callers in at the door, out the back, slips at the counter
  const GUESTS = (() => {
    const r = seeded(999), out = [];
    for (let k = 0; k < 10; k++) {
      const t0 = B(11) + .3 + k * .55, side = k % 2 ? 1 : -1;
      out.push({ t0, ph: r(), at: track([[t0, STAND.x + side * (500 + r() * 300), STAND.z - 300 - r() * 120], [t0 + 1.6, STAND.x + (r() - .5) * 20, STAND.z - 30], [t0 + 2.4, STAND.x + (r() - .5) * 20, STAND.z + 90], [t0 + 3.6, STAND.x + side * 300, STAND.z + 500]]) });
    }
    return out;
  })();
  // the one that reaches through the printed door
  const G = track([[B(7) - 2, SPOT.pdoor[0] - 220, SPOT.pdoor[1] - 120], [tTurn + .3, ...SPOT.pdoor], [1e9, ...SPOT.pdoor]]);

  // a knock: the arm goes out and back. In {dictionary} every bot knocks on the same beat.
  const knock = (b, t) => {
    if (t < tFollow + 2.6 + (b.i % 9) * .25) return 0;
    const sync = smooth(tDict, tDict + .4, t) * (1 - smooth(B(4) - .5, B(4), t));
    const own = Math.max(0, Math.sin((t + b.ph * 7) * 3.1)), all = Math.max(0, Math.sin((t - tDict) * Math.PI * 1.6));
    return lerp(own, all, sync);
  };

  /* ================= the bills: the spine ================= */
  // what each address has spent tonight, 0..1 of the tape's length
  const theirs = (t) => clamp(.04 + .22 * smooth(tFollow + 2, tDict + 3, t) + .3 * smooth(tNext, tRansom + 2, t) + .3 * smooth(waveHit, waveHit + 2.2, t), 0, .9);
  const ours = (t) => .02 + .015 * smooth(B(2), T.total, t);

  /* ================= the shop ================= */
  function shop(S, P, t) {
    const f = shopFold(t);
    const heat = smooth(tFollow + 2.6, Math.max(tWpadmin + 1, tFollow + 3), t) * .35 + smooth(tMining, tMining + 1, t) * .5;
    const warm = mix(P.card, P.stop, clamp(heat, 0, .7) * .45);
    // the fence round the lot (their account)
    if (f > .01) {
      const ph = 34 * f, posts = [];
      for (let x = LOT.x0; x <= LOT.x1; x += 70) posts.push([x, LOT.z0], [x, LOT.z1]);
      for (let z = LOT.z0 + 70; z < LOT.z1; z += 70) posts.push([LOT.x0, z], [LOT.x1, z]);
      for (const [x, z] of posts) if (Math.abs(x - DOOR.x) > 70 || z !== LOT.z0) block(S, x, 0, z, 5, ph, 5, mix(P.grid, P.card, .3));
      for (const [a, b] of [[[LOT.x0, LOT.z0], [DOOR.x - 70, LOT.z0]], [[DOOR.x + 70, LOT.z0], [LOT.x1, LOT.z0]], [[LOT.x0, LOT.z1], [LOT.x1, LOT.z1]], [[LOT.x0, LOT.z0], [LOT.x0, LOT.z1]], [[LOT.x1, LOT.z0], [LOT.x1, LOT.z1]]]) S.line([a[0], ph * .8, a[1]], [b[0], ph * .8, b[1]], mix(P.grid, P.card, .2), { layer: 2, lw: 1.6 });
    }
    // the shop: lit windows when anything inside is awake
    const lit = clamp(smooth(tFollow + 2.6, Math.max(tWpadmin + .6, tFollow + 3), t) + smooth(tScale, tScale + .5, t), 0, 1) * (1 - smooth(tRewind, tRewind + .6, t));
    const cold = 1 - f;   // as it folds down it cools to plain paper
    building(S, { x: SHOP.x, z: SHOP.z, w: SHOP.w, d: SHOP.d, h: SHOP.h, roof: .5, fold: f, color: mix(warm, mix(P.bg, P.grid, .18), cold), roofColor: mix(mix(P.stop, P.grid, .5 - heat * .3), mix(P.bg, P.grid, .3), cold), windows: [[.18, .62], [.82, .62], [.18, .28], [.82, .28]], lit });
    if (f < .3) {
      // folded flat, its doors are only outlines on the page
      const k = smooth(tRewind + 1.6, tRewind + 2.4, t) * (1 - .7 * smooth(tShape + .5, tShape + 2, t));
      if (k > .01) {
        const c = mix(P.grid, P.ink, .2);
        rect(S, DOOR.x - DOOR.w / 2, FRONT - 6, DOOR.x + DOOR.w / 2, FRONT + 4, c, { alpha: k });
        rect(S, MAT.x - MAT.w / 2, MAT.z - MAT.d / 2, MAT.x + MAT.w / 2, MAT.z + MAT.d / 2, c, { alpha: k });
        rect(S, SHED.x - SHED.w / 2, SHED.z - SHED.d / 2, SHED.x + SHED.w / 2, SHED.z + SHED.d / 2, c, { alpha: k });
        rect(S, CELLAR.x - CELLAR.w / 2, CELLAR.z - CELLAR.d / 2, CELLAR.x + CELLAR.w / 2, CELLAR.z + CELLAR.d / 2, c, { alpha: k });
      }
    }
    if (f <= .3) return;
    const a = (1 - smooth(0, .6, f)) * Math.PI / 2, onFront = (p) => rotate(p, [0, 0, FRONT], [1, 0, 0], -a);
    // the front door: wp-admin. It swings open a crack when it's tried, and stays open once it's been got into
    const open = Math.max(.25 * Math.max(0, Math.sin((t - tWpadmin) * 4)) * smooth(tWpadmin, tWpadmin + .3, t) * (1 - smooth(tWpadmin + 2, tWpadmin + 2.4, t)), .9 * smooth(tRansom, tRansom + .6, t));
    const inside = mix(P.ink, P.coin, .35 * lit);
    const wallF = [[SHOP.x - SHOP.w / 2, 0, FRONT], [SHOP.x + SHOP.w / 2, 0, FRONT], [SHOP.x + SHOP.w / 2, SHOP.h, FRONT], [SHOP.x - SHOP.w / 2, SHOP.h, FRONT]].map(onFront);
    const way = [[DOOR.x - DOOR.w / 2, 0, FRONT - .5], [DOOR.x + DOOR.w / 2, 0, FRONT - .5], [DOOR.x + DOOR.w / 2, DOOR.h, FRONT - .5], [DOOR.x - DOOR.w / 2, DOOR.h, FRONT - .5]].map(onFront);
    S.poly(way, inside, { flat: true, bias: onto(S, wallF, way, 1) });
    if (a < .05) doorPanel(S, DOOR.x - DOOR.w / 2, 0, FRONT - 1, DOOR.w, DOOR.h, -open * 1.6, mix(P.stop, P.grid, .5), wallF);
    // the mail slot in the door: mailer.cgi
    const slotLit = smooth(tSlot + .4, tSlot + .8, t) * (1 - smooth(B(4) - .5, B(4), t));
    if (a < .05) { const sl = [[DOOR.x - 12, 58, FRONT - 2.4], [DOOR.x + 12, 58, FRONT - 2.4], [DOOR.x + 12, 64, FRONT - 2.4], [DOOR.x - 12, 64, FRONT - 2.4]]; S.poly(sl, mix(P.ink, P.stop, slotLit), { flat: true, bias: onto(S, wallF, sl, 3) }); }
    // the mat, with the key under it: lifted on its back edge when a bot looks
    const lift = Math.max(.35 * Math.max(0, Math.sin((t - tMat) * 3.4)) * smooth(tMat + .6, tMat + .9, t) * (1 - smooth(tMat + 2.4, tMat + 2.8, t)), .9 * smooth(tKey, tKey + .7, t) * (1 - smooth(B(6) - .4, B(6), t)));
    const mz1 = MAT.z + MAT.d / 2, matM = (pts) => pts.map((p) => rotate(p, [0, 0, mz1], [1, 0, 0], -lift * 1.4));
    const keyRed = smooth(tKey + .5, tKey + 1, t);
    S.poly([[MAT.x - 9, .5, MAT.z - 4], [MAT.x + 12, .5, MAT.z - 4], [MAT.x + 12, .5, MAT.z + 3], [MAT.x - 9, .5, MAT.z + 3]], mix(P.coin, P.stop, keyRed), { layer: 1, flat: true });
    S.poly(matM([[MAT.x - MAT.w / 2, 1.2, MAT.z - MAT.d / 2], [MAT.x + MAT.w / 2, 1.2, MAT.z - MAT.d / 2], [MAT.x + MAT.w / 2, 1.2, mz1], [MAT.x - MAT.w / 2, 1.2, mz1]]), mix(P.coin, P.grid, .55), { layer: lift > .01 ? 2 : 1 });
    // the keys, spilling out: little red keys on the path
    const ks = smooth(tKeys, tKeys + 1.2, t) * (1 - smooth(B(6) - .4, B(6), t));
    for (let k = 0; k < 7 && ks > .01; k++) { const u = clamp(ks * 1.4 - k * .06, 0, 1), kx = MAT.x + 30 + k * 16 * u, kz = MAT.z - 30 * u - (k % 3) * 8; S.poly([[kx - 5, .6, kz - 2], [kx + 5, .6, kz - 2], [kx + 5, .6, kz + 2], [kx - 5, .6, kz + 2]], P.stop, { layer: 1, flat: true, alpha: u }); }
    // the shed: .git
    building(S, { x: SHED.x, z: SHED.z, w: SHED.w, d: SHED.d, h: SHED.h, roof: .45, fold: f, color: mix(P.card, P.grid, .25), roofColor: mix(P.grid, P.ink, .2) });
    const shedOpen = .3 * Math.max(0, Math.sin((t - tShed) * 4)) * smooth(tShed + .7, tShed + 1, t) * (1 - smooth(tShed + 2.4, tShed + 2.8, t));
    const sz0 = SHED.z - SHED.d / 2, wallS = [[SHED.x - SHED.w / 2, 0, sz0], [SHED.x + SHED.w / 2, 0, sz0], [SHED.x + SHED.w / 2, SHED.h, sz0], [SHED.x - SHED.w / 2, SHED.h, sz0]];
    const sway = [[SHED.x - 16, 0, sz0 - .5], [SHED.x + 16, 0, sz0 - .5], [SHED.x + 16, 52, sz0 - .5], [SHED.x - 16, 52, sz0 - .5]];
    S.poly(sway, mix(P.ink, P.grid, .3), { flat: true, bias: onto(S, wallS, sway, 1) });
    doorPanel(S, SHED.x - 16, 0, sz0 - 1, 32, 52, -shedOpen * 1.6, mix(P.card, P.grid, .4), wallS);
    // the cellar hatch: two flaps on the ground; open, and its crates go, on {ransom}
    const hatch = Math.max(.25 * Math.max(0, Math.sin(t * 2.7 + 1)) * smooth(tFollow + 3, tFollow + 4, t) * (1 - smooth(B(4) - .5, B(4), t)), smooth(tRansom, tRansom + .5, t) * (1 - smooth(B(6) - .4, B(6), t)));
    const cx0 = CELLAR.x - CELLAR.w / 2, cx1 = CELLAR.x + CELLAR.w / 2, cz0 = CELLAR.z - CELLAR.d / 2, cz1 = CELLAR.z + CELLAR.d / 2;
    S.poly([[cx0, .3, cz0], [cx1, .3, cz0], [cx1, .3, cz1], [cx0, .3, cz1]], P.ink, { layer: 1, flat: true, alpha: .8 });
    const flapL = (p) => rotate(p, [cx0, 0, 0], [0, 0, 1], hatch * 1.9), flapR = (p) => rotate(p, [cx1, 0, 0], [0, 0, 1], -hatch * 1.9);
    S.poly([[cx0, 1, cz0], [CELLAR.x, 1, cz0], [CELLAR.x, 1, cz1], [cx0, 1, cz1]].map(flapL), mix(P.coin, P.grid, .5));
    S.poly([[CELLAR.x, 1, cz0], [cx1, 1, cz0], [cx1, 1, cz1], [CELLAR.x, 1, cz1]].map(flapR), mix(P.coin, P.grid, .5));
    // the ransom note, pinned to the open door
    const note = smooth(tRansom + .8, tRansom + 1.3, t) * (1 - smooth(B(6) - .4, B(6), t));
    if (note > .01) { block(S, DOOR.x + 60, 70, FRONT - 3, 34, 44, 1, P.card, { alpha: note }); const nl = [[DOOR.x + 48, 104, FRONT - 4], [DOOR.x + 72, 104, FRONT - 4], [DOOR.x + 72, 98, FRONT - 4], [DOOR.x + 48, 98, FRONT - 4]]; S.poly(nl, P.stop, { flat: true, alpha: note, bias: onto(S, wallF, nl, 4) }); }
    // the chimney: the runtime. It smokes while anything's awake, red while it's mining
    const roofTop = SHOP.h + SHOP.d * .5 * .5;
    block(S, CHIMNEY.x, SHOP.h + 20, CHIMNEY.z, 28, roofTop - 10, 28, mix(P.card, P.grid, .4));
    const smoke = lit, mine = smooth(tMining, tMining + .6, t) * (1 - smooth(tRewind, tRewind + .5, t));
    for (let k = 0; k < 6 && smoke > .05; k++) {
      const u = ((t * .35 + k / 6) % 1), s = 10 + u * 26;
      block(S, CHIMNEY.x + Math.sin(u * 5 + k) * 16, SHOP.h + roofTop + 14 + u * 150, CHIMNEY.z, s, s, s, mix(P.panel, P.stop, mine * .5), { alpha: smoke * (1 - u) * .8, flat: true });
    }
  }

  // the houses the stolen keys build inside the shop's own fence, and the
  // copies the shop unfolds when it scales
  function lot(S, P, t) {
    // the workshops: chimney smoke while they work, money piling up at the door
    const workshop = (x, z, f, t0, k) => {
      if (f < .9) return;
      const age = t - t0, dz = z - 32 - 18;
      block(S, x + 18, 74, z + 8, 10, 22, 10, mix(P.card, P.grid, .4));
      for (let p = 0; p < 4; p++) {
        const u = ((t * .5 + p / 4 + k * .13) % 1), sz = 6 + u * 16;
        block(S, x + 18 + Math.sin(u * 4 + k) * 8, 98 + u * 110, z + 8, sz, sz, sz, mix(P.panel, P.stop, .35), { alpha: (1 - u) * .75 * f, flat: true });
      }
      // the pile: stacked notes and coins, growing the longer it runs
      const n = Math.min(9, Math.floor(age * 2.2));
      for (let c = 0; c < n; c++) {
        const row = c < 4 ? 0 : c < 7 ? 1 : 2, col = c < 4 ? c : c < 7 ? c - 4 : c - 7, w4 = [4, 3, 2][row];
        block(S, x - 26 + col * 13 + (4 - w4) * 6.5, row * 6, dz, 12, 6, 18, c % 3 === 1 ? mix(P.coin, P.card, .2) : mix(P.ok, P.coin, .45));
      }
      // a coin tossed out of the door onto it, now and then
      const q = (age * 1.3 + k * .37) % 1;
      if (age > .5) block(S, x - 8 + q * -6, 20 + Math.sin(q * Math.PI) * 30, z - 32 - q * 18, 6, 2, 6, P.coin, { flat: true, alpha: 1 - q * .3 });
    };
    MORE.forEach(([x, z], i) => {
      const f = moreF(i)(t);
      if (f <= .01) return;
      building(S, { x, z, w: 56, d: 56, h: 48, roof: .5, fold: f, color: mix(P.card, P.stop, .16), roofColor: mix(P.stop, P.grid, .42), windows: [[.5, .55]], lit: 1 });
      workshop(x, z, f, moreAt(i) + 1, i + 4);
      // its builder, hammering it up
      if (t > moreAt(i) - .4 && t < moreAt(i) + 1.2) bot3(S, P, x - 50, z - 26, 0, { reach: Math.abs(Math.sin(t * 10 + i)), t, ph: i * .3, red: 1, s: .85 });
    });
    LAMBDAS.forEach(([x, z], i) => {
      const f = lambdaF(i)(t);
      if (f <= .01) return;
      building(S, { x, z, w: 64, d: 64, h: 56, roof: .5, fold: f, color: mix(P.card, P.stop, .18), roofColor: mix(P.stop, P.grid, .4), windows: [[.5, .55]], lit: 1 });
      if (t > tMining - .5) workshop(x, z, f, tMining - .5, i);
      // a red antenna on the roof once it starts scanning for them
      const ant = smooth(tNext + i * .2, tNext + .5 + i * .2, t) * f;
      if (ant > .01) { S.line([x, 90, z], [x, 90 + 40 * ant, z], P.ink, { layer: 2, lw: 1.4 }); block(S, x, 90 + 40 * ant, z, 7, 7, 7, P.stop, { flat: true }); }
    });
    COPIES.forEach(([x, z], i) => {
      const f = copiesF(i)(t);
      if (f > .01) building(S, { x, z, w: 110, d: 90, h: 90, roof: .5, fold: f, color: mix(P.card, P.stop, .2), roofColor: mix(P.stop, P.grid, .45), windows: [[.25, .55], [.75, .55]], lit: 1 });
    });
    // the builders: bots that carried the keys in, hammering each house up
    if (t > tLambdas && t < B(6)) BUILD.forEach((b, i) => {
      const p = b.at(t), building = t > builtAt(i) && t < builtAt(i) + 1.5;
      bot3(S, P, p.x, p.z, p.yaw, { reach: p.walk ? 0 : building ? Math.abs(Math.sin(t * 10 + i)) : 0, walk: p.walk, t, ph: i * .4, red: smooth(tNext, tNext + .4, t) });
    });
    // what the houses do: spew bots, on the victims' bill, that swarm the neighbours
    if (t > tNext && t < B(6)) for (const b of SPEW) {
      if (t < b.t0) continue;
      const p = b.at(t);
      bot3(S, P, p.x, p.z, p.yaw, { s: .8, red: 1, walk: p.walk, reach: p.walk ? 0 : Math.max(0, Math.sin((t + b.ph * 7) * 3.4)), t, ph: b.ph, alpha: smooth(b.t0, b.t0 + .3, t) });
    }
    // the burst: a wave down the street to the shop, then the same wave to our counter
    for (const b of WAVE) {
      if (t < b.t0 || t > b.t1) continue;
      const p = b.at(t);
      bot3(S, P, p.x, p.z, p.yaw, { s: .85, walk: p.walk, reach: p.walk ? 0 : Math.max(0, Math.sin((t + b.ph * 7) * 3.4)), t, ph: b.ph, alpha: smooth(b.t0, b.t0 + .3, t) * (1 - smooth(b.t1 - .5, b.t1, t)) });
      // at our address each caller gets its slip and that's the end of it
      if (b.ours && t > b.hit && t < b.hit + .9) { const u = (t - b.hit) / .9, from = [COUNTER.x, COUNTER.h + 18, COUNTER.z], q = lerp3(from, [p.x, 40, p.z], easeIO(u)); q[1] += Math.sin(u * Math.PI) * 40; block(S, q[0], q[1], q[2], 14, 2, 10, P.card); }
    }
  }

  // the tent a host puts over it all: every door still there underneath, one rope shut
  function tent(S, P, t) {
    const f = tentF(t);
    if (f <= .01) return;
    const x0 = LOT.x0 + 20, x1 = LOT.x1 - 20, z0 = LOT.z0 + 10, z1 = LOT.z1 - 10, zm = (z0 + z1) / 2, h = 330 * easeIO(f), col = mix(P.card, P.water, .12);
    S.poly([[x0, 0, z0], [x1, 0, z0], [x1, h, zm], [x0, h, zm]], col, { alpha: .9 });
    S.poly([[x0, 0, z1], [x1, 0, z1], [x1, h, zm], [x0, h, zm]], col, { alpha: .9 });
    S.poly([[x0, 0, z0], [x0, 0, z1], [x0, h, zm]], shade(col, -.06), { alpha: .9 });
    S.poly([[x1, 0, z0], [x1, 0, z1], [x1, h, zm]], shade(col, -.06), { alpha: .9 });
    // the one rope that holds it shut, staked to the street with a padlock
    const rp = smooth(tRope, tRope + .8, t) * f;
    if (rp > .01) {
      const a = [DOOR.x, h * .25, z0 + (zm - z0) * .25], b = [DOOR.x + 60, 0, LOT.z0 - 120];
      S.line(a, lerp3(a, b, rp), P.ink, { layer: 2, lw: 2.2 });
      if (rp > .95) block(S, b[0], 0, b[2], 18, 22, 10, P.stop, { flat: true });
    }
  }

  /* ================= our address ================= */
  function stand(S, P, t) {
    const f = standF(t);
    if (f <= .01) return;
    houseFront(S, P, { x: STAND.x, z: STAND.z, w: STAND.w, h: STAND.h, eaves: STAND.eaves, fold: f, open: doorOpen(t), door: PDOOR });
    // the counter, with its stacks of printed slips: it arrives with the street
    const cf = smooth(B(2) + .2, B(2) + 1, t), wood = mix(P.coin, P.card, .5);
    if (cf > .01) {
    block(S, COUNTER.x, 0, COUNTER.z, COUNTER.w, COUNTER.h * cf, COUNTER.d, wood);
    for (let k = 0; k < 3; k++) block(S, COUNTER.x - 60 + k * 60, COUNTER.h * cf, COUNTER.z, 40, 18 * cf, 28, P.card);
    }
    // the box of finished pages beside it: flat storage, nothing running
    const bf = smooth(B(2) + .4, B(2) + 1.2, t);
    if (bf > .01) {
      block(S, LIVE.x, 0, LIVE.z, 70, 40 * bf, 50, mix(P.card, P.grid, .3));
      for (let k = 0; k < 4; k++) block(S, LIVE.x - 20 + k * 13, 40 * bf, LIVE.z, 4, 14 * bf, 40, P.card);
    }
  }

  // the slips: every caller at the counter gets the same printed one
  function slips(S, P, t) {
    if (t < B(2) + 2) return;
    for (const b of BOTS) {
      if (!(b.ours || (b.shop && t > tRewind + 4))) continue;
      const p = b.at(t);
      for (let k = 0; k < 3; k++) {
        const t0 = Math.floor((t + b.ph * 3) / 2.1) * 2.1 - b.ph * 3 + k * .01, u = (t - t0) / .9;
        if (u < 0 || u > 1 || k) continue;
        const from = [COUNTER.x - 60 + (b.i % 3) * 60, COUNTER.h + 18, COUNTER.z], to = [p.x, 40, p.z];
        const q = lerp3(from, to, easeIO(u)); q[1] += Math.sin(u * Math.PI) * 40;
        block(S, q[0], q[1], q[2], 14, 2, 10, P.card, { alpha: 1 - smooth(.85, 1, u) });
      }
    }
  }

  /* ================= the notice board ================= */
  const PINNED = 15, OURS_PIN = 7;
  function board(S, P, t) {
    const f = boardF(t);
    if (f <= .01) return;
    const { x, z, w, h, y } = BOARD, a = (1 - smooth(0, .8, f)) * Math.PI / 2, m = (pts) => pts.map((p) => rotate(p, [0, 0, z], [1, 0, 0], -a));
    const wood = mix(P.coin, P.grid, .45);
    block(S, x - w / 2 + 12, 0, z + 6, 10, (y + h) * f, 10, wood); block(S, x + w / 2 - 12, 0, z + 6, 10, (y + h) * f, 10, wood);
    S.poly(m([[x - w / 2, y, z], [x + w / 2, y, z], [x + w / 2, y + h, z], [x - w / 2, y + h, z]]), mix(P.coin, P.card, .55));
    // the log: a grid of pinned sheets, and ours pinned up on {board}; then every one lit
    for (let k = 0; k < PINNED; k++) {
      const c = k % 5, r = Math.floor(k / 5), sx = x - w / 2 + 22 + c * 52, sy = y + h - 22 - r * 56;
      const mine = k === OURS_PIN, show = mine ? smooth(tBoard + .2, tBoard + .7, t) : 1;
      const lit = mine ? smooth(tBoard + .7, tBoard + 1.2, t) : 0;
      if (show <= .01) continue;
      const q = (px, py) => [px, py, z - 1 - (mine ? (1 - show) * 30 : 0)];
      S.poly(m([q(sx, sy), q(sx + 40, sy), q(sx + 40, sy - 46), q(sx, sy - 46)]), mix(P.card, P.stop, lit * .25), { flat: true, bias: -3, alpha: show });
      for (let l = 0; l < 4; l++) S.poly(m([q(sx + 5, sy - 8 - l * 9), q(sx + 33 - (l % 2) * 9, sy - 8 - l * 9), q(sx + 33 - (l % 2) * 9, sy - 10 - l * 9), q(sx + 5, sy - 10 - l * 9)]), mine && l === 0 ? P.stop : mix(P.ink, P.grid, .4), { flat: true, bias: -5, alpha: show * .7 });
    }
  }

  /* ================= the neighbours, the lamps, the fog ================= */
  function street(S, P, t) {
    const f = nbrF(t);
    // the street itself, a band of slightly darker paper
    S.poly([[-3600, .1, STREET.z0], [3600, .1, STREET.z0], [3600, .1, STREET.z1], [-3600, .1, STREET.z1]], mix(P.bg, P.grid, .12), { layer: 0, flat: true });
    NEIGHBOURS.forEach(([x, z], i) => {
      const hit = i < 2 ? smooth(tNext + 2.2, tNext + 3, t) * (1 - smooth(B(6) - .5, B(6), t)) : 0;
      building(S, { x, z, w: 220, d: 170, h: 120 + (i % 2) * 40, roof: .5, fold: f, color: mix(mix(P.card, P.grid, .25), P.stop, .2 * hit), roofColor: mix(mix(P.grid, P.ink, .25), P.stop, .5 * hit), windows: [[.25, .6], [.75, .6]], lit: Math.max(hit, .3 * smooth(tFollow + 3, tFollow + 4, t) * (1 - smooth(tRewind, tRewind + 1, t))), litColor: hit > .3 ? P.stop : null });
    });
    // street lamps along the near kerb
    for (let x = -2200; x <= 2200; x += 550) {
      block(S, x, 0, STREET.z0 - 30, 6, 150 * f, 6, mix(P.ink, P.grid, .4));
      block(S, x, 150 * f, STREET.z0 - 30, 18, 12 * f, 18, mix(P.card, P.coin, .55), { flat: true });
    }
  }

  /* ================= the editor's shed ================= */
  function editorShed(S, P, t) {
    const lf = smooth(tLane - .2, tLane + 1, t);
    if (lf <= .01 && t < B(10)) return;
    // the lane off the street, past three posts of rules
    dashed(S, [1150, .4, STREET.z1], [EDSHED.x - 40, .4, EDSHED.z - EDSHED.d / 2 - 20], mix(P.grid, P.ink, .15), { alpha: lf });
    for (let k = 0; k < 3; k++) { const u = .2 + k * .12, px = lerp(1150, EDSHED.x - 40, u), pz = lerp(STREET.z1, EDSHED.z - EDSHED.d / 2 - 20, u); block(S, px - 40, 0, pz, 6, 60 * lf, 6, P.ink); block(S, px + 40, 0, pz, 6, 60 * lf, 6, P.ink); S.line([px - 40, 50 * lf, pz], [px + 40, 50 * lf, pz], P.ink, { layer: 2, lw: 2 }); }
    // a big stone wall round it, one gate, shut unless the editor's key is in it
    const WX0 = EDSHED.x - 170, WX1 = EDSHED.x + 170, WZ0 = EDSHED.z - 160, WZ1 = EDSHED.z + 160, GX0 = EDSHED.x - 80, GX1 = EDSHED.x + 10;
    const sr = seeded(5150), stone = (k) => mix(mix(P.grid, P.card, .35), P.coin, .08 + (k % 3) * .04);
    const course = (xa, za, xb, zb, k0) => {
      const L = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.round(L / 56));
      for (let k = 0; k < n; k++) {
        const u = (k + .5) / n, x = lerp(xa, xb, u), z = lerp(za, zb, u), along = Math.abs(xb - xa) > Math.abs(zb - za);
        if (along && Math.abs(za - WZ0) < 1 && x > GX0 && x < GX1) continue;   // the gate
        const hh = (118 + (sr() - .5) * 26) * lf;
        block(S, x, 0, z, along ? L / n - 3 : 34, hh, along ? 34 : L / n - 3, stone(k0 + k));
      }
    };
    if (lf > .01) { course(WX0, WZ0, WX1, WZ0, 0); course(WX0, WZ1, WX1, WZ1, 7); course(WX0, WZ0, WX0, WZ1, 3); course(WX1, WZ0, WX1, WZ1, 5); }
    // the gate: a heavy dark slab that slides aside for the editor and back after
    const gOpen = smooth(tEditor + .8, tEditor + 1.4, t) * (1 - smooth(tAsleep + 1.6, tAsleep + 2.2, t));
    if (lf > .01) block(S, (GX0 + GX1) / 2 - gOpen * 92, 0, WZ0, GX1 - GX0 - 4, 112 * lf, 22, mix(P.ink, P.grid, .35));
    // the shed: flat on the page, unfolding while the editor's there, then flat again
    const editorAt = smooth(tEditor, tEditor + 2.2, t), up2 = smooth(tEditor + 1.8, tEditor + 2.5, t) * (1 - smooth(tAsleep + .2, tAsleep + 1.4, t));
    building(S, { x: EDSHED.x, z: EDSHED.z, w: EDSHED.w, d: EDSHED.d, h: EDSHED.h, roof: .5, fold: Math.max(.001, up2), color: mix(P.card, P.ok, .12), roofColor: mix(P.ok, P.grid, .4), windows: [[.5, .55]], lit: up2 });
    // the editor, walking up the lane with a key, and back
    if (t > tEditor && t < tAsleep + 2.4) {
      const back = smooth(tAsleep + .2, tAsleep + 2.2, t), u = editorAt * (1 - back);
      const px = lerp(1150, EDSHED.x - 10, u), pz = lerp(STREET.z1, EDSHED.z - EDSHED.d / 2 - 30, u);
      block(S, px, 0, pz, 22, 44, 16, mix(P.ink, P.grid, .3)); block(S, px, 46, pz, 18, 18, 18, mix(P.coin, P.card, .5));
      block(S, px + 14, 30, pz - 6, 8, 3, 3, P.ok, { flat: true });
    }
  }

  /* ================= the city (beat 04) ================= */
  const CITY = (() => {
    const r = seeded(4040), out = [];
    for (let gx = -9; gx <= 9; gx++) for (let gz = -2; gz <= 12; gz++) {
      if (gz === 1 || gz === 2) continue;   // our street runs through here
      for (let k = 0; k < 2; k++) out.push({ x: gx * 600 + (k ? 160 : -160) + (r() - .5) * 40, z: gz * 520 + 300 + (r() - .5) * 40, w: 140 + r() * 90, d: 120 + r() * 80, h: 60 + r() * 110, lit: r(), fresh: r() < .52 });
    }
    return out;
  })();
  function city(S, P, t) {
    const a = smooth(B(4) - .3, tCity + .5, t) * (1 - smooth(B(5) - .4, B(5), t));
    if (a <= .01) return;
    const lit = smooth(tLa, tLa + 1.6, t);
    for (const b of CITY) {
      const ly = b.lit < lit ? 1 : 0;
      block(S, b.x, 0, b.z, b.w, b.h * a, b.d, mix(P.card, P.grid, .25));
      if (ly) block(S, b.x, b.h * a, b.z, b.w * .5, 1, b.d * .4, mix(P.card, P.coin, .7), { flat: true });
      // a crowd at its door: small bots; over half new, in red, from {unseen}
      const crowd = smooth(tCity + b.lit * 1.5, tCity + b.lit * 1.5 + .4, t);
      if (crowd > .01) for (let k = 0; k < 3; k++) {
        const fresh = b.fresh && t > tUnseen + b.lit * 1.2;
        block(S, b.x - b.w / 2 + 20 + k * 22 + Math.sin(t * 3 + k + b.x) * 4, 0, b.z - b.d / 2 - 40, 14, 22 * crowd, 12, fresh ? P.stop : mix(P.ink, P.grid, .35));
      }
    }
  }

  /* ================= the camera ================= */
  const CAM = cameraPath(mono([
    // 00: the new house, alone in the fog; a slow push in as the callers arrive
    [0, [STAND.x - 160, 230, STAND.z - 900], [STAND.x, 130, STAND.z]],
    [tFifty, [STAND.x - 110, 200, STAND.z - 760], [STAND.x, 110, STAND.z]],
    [B(1) - .2, [STAND.x - 70, 180, STAND.z - 640], [STAND.x, 100, STAND.z]],
    // 02: the street unfolding in fog, our page pinned to the board, the readers
    [B(2), [-200, 760, -700], [0, 60, 1150]],
    [tCert - .2, [400, 380, 200], [650, 110, 1100]],
    [tBoard - .1, [120, 280, 330], [0, 150, BOARD.z]],
    [tReaders + .4, [0, 520, -200], [0, 40, 900]],
    [tSeconds + 2, [-150, 560, -150], [-200, 40, 950]],
    // 03: follow the bot to the shop and down its doors
    [tFollow + .3, [-200, 480, 150], [-400, 40, 950]],
    [tWpadmin, [-560, 320, 650], [DOOR.x, 70, FRONT]],
    [tMat + .4, [-640, 230, 780], [MAT.x, 10, MAT.z]],
    [tShed + .4, [-300, 300, 820], [SHED.x, 50, SHED.z]],
    [tSlot + .3, [-700, 170, 900], [DOOR.x, 60, FRONT]],
    [tOld, [-760, 260, 760], [-900, 60, 1150]],
    [tDict - .2, [-760, 260, 760], [-900, 60, 1150]],
    [tDict + 2.2, [0, 1100, -800], [0, 0, 1150]],
    // 04: up out of the fog, over the city
    [B(4) + .2, [0, 1400, -900], [0, 0, 1300]],
    [tSessions, [0, 3200, -2200], [0, 0, 2400]],
    [tUnseen + 2.5, [800, 3400, -2400], [600, 0, 2600]],
    // 05: back down at the shop
    [B(5), [-480, 460, 520], [-850, 60, 1350]],
    [tKey + .3, [-700, 200, 900], [MAT.x, 10, MAT.z]],
    [tLambdas, [-640, 420, 720], [-800, 30, 1350]],
    [tLambdas + 1.8, [-1650, 700, 1250], [-800, 0, 1580]],
    [tNext, [-250, 720, 2350], [-850, 0, 1520]],
    [tNext + 2.6, [-1050, 1150, 250], [-1450, 0, 1380]],
    [tMining - .3, [-420, 880, 760], [-820, 20, 1520]],
    [tRansom - .3, [-460, 820, 820], [-820, 20, 1520]],
    [tRansom, [-900, 260, 820], [CELLAR.x, 20, CELLAR.z]],
    [tPrize + 3, [-900, 300, 760], [CELLAR.x, 30, CELLAR.z]],
    // 06: the shop scaling, then the host's tent
    [B(6), [-150, 780, 150], [-700, 0, 1300]],
    [tEight + 3.6, [-250, 860, 120], [-760, 0, 1320]],
    [tBurst, [520, 720, 260], [560, 0, 1080]],
    [tHost - .3, [520, 720, 260], [560, 0, 1080]],
    [tHost + .5, [-800, 1100, 0], [-800, 0, 1400]],
    [tTent + .5, [-250, 560, 300], [-800, 140, 1350]],
    [tRope + 2, [-500, 360, 520], [-760, 60, 1100]],
    // 07: the turn: the printed door, then round the back of the page
    [B(7), [STAND.x - 220, 230, STAND.z - 620], [STAND.x, 100, STAND.z]],
    [tNothing - .3, [STAND.x - 160, 200, STAND.z - 540], [STAND.x, 80, STAND.z]],
    [tNothing + 1.4, [STAND.x + 520, 110, STAND.z + 20], [STAND.x, 50, STAND.z + 20]],
    [B(8), [STAND.x + 530, 110, STAND.z + 20], [STAND.x, 50, STAND.z + 20]],
    // 08: the counter, then both addresses at once
    [B(8) + .01, [COUNTER.x - 60, 260, COUNTER.z - 420], [COUNTER.x, 60, COUNTER.z]],
    [tCost, [COUNTER.x - 60, 260, COUNTER.z - 420], [COUNTER.x, 60, COUNTER.z]],
    [tCost + 2.5, [0, 700, -350], [0, 40, 1150]],
    // 09: the same night, rewound: the shop folds, then our side
    [B(9), [-300, 700, -100], [-500, 0, 1200]],
    [tFiles, [STAND.x + 120, 300, STAND.z - 450], [STAND.x + 100, 60, STAND.z - 40]],
    [tStorage + .2, [STAND.x + 520, 260, STAND.z - 380], [STAND.x + 60, 70, STAND.z - 20]],
    [tMissing, [-400, 700, 300], [-650, 0, 1200]],
    [tShape + 2, [-300, 760, 200], [-600, 0, 1200]],
    // 10: the lane to the shed
    [B(10), [900, 760, 650], [EDSHED.x - 100, 20, EDSHED.z - 200]],
    [tEditor + 1, [1050, 880, 1000], [EDSHED.x - 40, 0, EDSHED.z - 60]],
    [tNotzero + 2, [1100, 900, 1050], [EDSHED.x - 40, 0, EDSHED.z - 40]],
    // 11: our house, door open, callers in and out
    [B(11), [STAND.x - 260, 300, STAND.z - 820], [STAND.x, 90, STAND.z]],
    [tEnd, [STAND.x - 160, 240, STAND.z - 700], [STAND.x, 90, STAND.z]],
    [T.total, [STAND.x - 120, 260, STAND.z - 760], [STAND.x, 90, STAND.z]],
  ]));
  function mono(keys) { const out = []; for (const k of keys) { const p = out[out.length - 1]; out.push([p ? Math.max(k[0], p[0] + .02) : k[0], ...k.slice(1)]); } return out; }

  /* ================= the frame ================= */
  function tag(g, cam, p, s, size, color, alpha, o = {}) {
    if (alpha <= .01) return;
    const q = cam.project(p);
    if (q) serif(g, s, q[0], q[1], size, color, { weight: 400, base: 'middle', align: 'center', alpha, ...o });
  }
  const fogFar = (t) => (t > B(4) - .3 && t < B(5) ? lerp(2600, 14000, smooth(B(4) - .3, tCity, t)) : 2600);

  function world(g, t, P) {
    ground(g, P);
    const cam = CAM(t), far = fogFar(t), S = scene(cam, P, { fog: [far * .15, far] });
    newsprint(S, -1500, 300, 16, 26, { alpha: .045 });
    street(S, P, t);
    board(S, P, t);
    shop(S, P, t);
    lot(S, P, t);
    tent(S, P, t);
    stand(S, P, t);
    slips(S, P, t);
    city(S, P, t);
    editorShed(S, P, t);
    // the first callers, in the cold open
    if (t < B(1) + .2) for (const b of OPEN) {
      if (t < b.t0) continue;
      const p = b.at(t);
      bot3(S, P, p.x, p.z, p.yaw, { reach: p.walk ? 0 : Math.max(0, Math.sin((t + b.ph * 7) * 3)) * .6, walk: p.walk, t, ph: b.ph, alpha: smooth(b.t0, b.t0 + .6, t) });
    }
    // the bots
    if (t > B(2)) for (const b of BOTS) {
      const p = b.at(t), aside = b.ours ? 1 - smooth(B(7) - .3, B(7), t) * (1 - smooth(B(8) - .1, B(8) + .3, t)) : 1;
      const gone = (b.shop && t > B(6) && t < tRewind + 2 ? 0 : 1) * aside;
      if (t > B(4) - .3 && t < B(5)) continue;
      bot3(S, P, p.x, p.z, p.yaw, { reach: p.walk ? 0 : knock(b, t), walk: p.walk, t, ph: b.ph, alpha: gone * smooth(B(2) + .6, B(2) + 1.4, t) });
    }
    if (t > B(11)) for (const b of GUESTS) {
      if (t < b.t0 || t > b.t0 + 3.6) continue;
      const p = b.at(t);
      bot3(S, P, p.x, p.z, p.yaw, { walk: p.walk, t, ph: b.ph, s: .9, alpha: smooth(b.t0, b.t0 + .3, t) * (1 - smooth(b.t0 + 3, b.t0 + 3.6, t)) });
    }
    // the one that reaches through the printed door, and closes its hand on nothing
    if (t > B(7) - 2 && t < B(9)) {
      const p = G(t), reach = smooth(tTurn + .4, tNothing, t), empty = smooth(tNothing + .9, tNothing + 1.6, t);
      bot3(S, P, p.x, p.z, p.yaw, { reach, walk: p.walk, t, armLen: 110, empty });
    }
    S.flush(g);
    mist(g, t, P, (t > B(4) && t < B(5) ? .4 : 1) * (1 - .5 * smooth(B(11) - .5, B(11) + 1, t)));
    return cam;
  }

  // the spine: two receipts hanging at the right edge of the frame
  function spine(g, t, P) {
    const a = smooth(B(2) + 1, B(2) + 2, t) * (1 - smooth(tEnd - .3, tEnd + .3, t)) * (t > B(4) - .3 && t < B(5) - .1 ? .35 : 1);
    if (a <= .01) return;
    drawReceipts(g, P, a, [{ x: 1150, k: theirs(t), color: P.stop, name: 'theirs' }, { x: 1218, k: ours(t), color: P.ink, name: 'ours' }]);
  }

  /* The phone: the viewer keeps checking our stats while the story goes on.
     It slides in from the left edge, held at a slight tilt, when something
     lands (a figure, a line of our own access log, a keyword), stays a few
     seconds, and slides away. It stays out of the title, the turn, the pull
     quote and the end. A paper-cut phone: flat body, hard offset shadow,
     hairline rules, the Report's type. Newest on top.
       stat  a figure the narrator says, with its source
       log   a request in this site's own log, and what we answered
       note  a keyword, in a line
       dl    a download, the way an app shows one: the scanners' wordlist */
  const WORDLIST = ['/wp-login.php', '/.env', '/.git/config', '/phpmyadmin/', '/xmlrpc.php', '/.env.bak', '/cgi-bin/mailer.cgi', '/wp-admin/', '/.aws/credentials', '/config.php.bak', '/admin/', '/.env.prod', '/server-status', '/.DS_Store', '/backup.sql', '/webapp/.env'];
  const count = (v, t0, d = 1.6) => (t) => Math.round(v * easeIO(smooth(t0, t0 + d, t))).toLocaleString('en-US');
  const FEED = [
    { t: tLog + 2.7, kind: 'note', text: 'scale-to-zero.com is live' },
    { t: tFifty, kind: 'stat', v: (t) => String(Math.round(50 * arrived(t) / OPEN.length)), label: 'bots at the door, within minutes', src: "this site's log", c: 'stop' },
    { t: tCert + .3, kind: 'note', text: 'TLS certificate issued' },
    { t: tBoard + .5, kind: 'note', text: 'listed in the Certificate Transparency log' },
    { t: tSeconds, kind: 'stat', v: () => 'seconds', label: 'from a log entry to the first probe', src: 'EuroS&P 2023', c: 'ink' },
    { t: tWpadmin, kind: 'log', path: '/wp-login.php' },
    { t: tWpadmin + .7, kind: 'log', path: '/wp-admin/' },
    { t: tMat + .2, kind: 'log', path: '/.env' },
    { t: tMat + .9, kind: 'log', path: '/.env.bak' },
    { t: tShed + .3, kind: 'log', path: '/.git/config' },
    { t: tSlot + .3, kind: 'log', path: '/cgi-bin/mailer.cgi' },
    { t: tOld, kind: 'stat', v: () => '4×', label: 'the traffic for bugs from before 2015', src: 'GreyNoise', c: 'stop' },
    { t: tDict + .2, kind: 'dl', title: 'common files to look for', file: 'common-files.txt', dur: 2.6, list: WORDLIST },
    { t: tSessions, kind: 'stat', v: count(2969010478, tSessions), label: 'malicious sessions in 162 days', src: 'GreyNoise', c: 'stop', small: true },
    { t: tIps, kind: 'stat', v: count(3804232, tIps, 1.3), label: (t) => (t > tLa + .3 ? 'addresses: about everyone in Los Angeles' : 'source addresses'), src: 'GreyNoise', c: 'ink' },
    { t: tUnseen, kind: 'stat', v: () => '52%', label: 'of code-execution attempts from addresses never seen before', src: 'GreyNoise', c: 'stop' },
    { t: tKey + .3, kind: 'log', path: '/.env', said: '200', hit: true },
    { t: tKey + .9, kind: 'stat', v: count(110000, tKey + 1.1, 1), label: 'domains with an exposed .env file', src: 'Unit 42', c: 'stop' },
    { t: tKeys, kind: 'stat', v: count(7000, tKeys + .2, .9), label: 'cloud access keys inside them', src: 'Unit 42', c: 'stop' },
    { t: tLambdas + .4, kind: 'note', text: "Lambda functions, in the victims' own accounts" },
    { t: tMining + .2, kind: 'note', text: 'crypto mining, on their bill' },
    { t: tEight + 1.8, kind: 'stat', v: (t) => `1 → ${1 + Math.round(7 * smooth(tEight + 1.6, tEight + 3.6, t))}`, label: 'instances, as each burst of probes hit', src: 'a WordPress stack we ran', c: 'stop' },
    { t: tBurst + .7, kind: 'note', text: 'the same burst here: nothing added' },
    { t: tRope + .6, kind: 'note', text: 'one account credential' },
    { t: tSlips + .3, kind: 'log', path: '/wp-login.php', said: 'move along' },
    { t: tSlips + .9, kind: 'log', path: '/.env', said: 'move along' },
    { t: tCost, kind: 'stat', v: () => '$0.00', label: 'what the probes cost this site', src: 'a rounding error on the CDN', c: 'ok' },
    { t: tStorage + .4, kind: 'note', text: 'flat storage: no compute in sight' },
    { t: tMissing + .3, kind: 'note', text: 'no .env · no .git · no wp-config' },
    { t: tAsleep + .4, kind: 'note', text: 'the editor: asleep' },
  ];
  // when the phone is up: a few seconds round each item, merged, minus the
  // moments the picture needs to itself
  const QUIET = [[B(1) - .5, B(2) + .3], [B(7) - .4, B(8) - .2], [tPrize - .5, B(6) + .2], [tNotzero - .3, B(11) - 1e-3], [tEnd - .6, 1e9]];
  const PHONE = makePhone({ feed: FEED, quiet: QUIET }), held = PHONE.held, GLANCES = PHONE.glances;
  const phone = (g, t, P) => PHONE.draw(g, t, P);

  // what was under the mat: the file, with a username and password in it (illustrative)
  const ENV = [['DB_USER=', 'wp_admin'], ['DB_PASSWORD=', 'Sunflower2026!'], ['AWS_ACCESS_KEY_ID=', 'AKIAIOSFODNN7EXAMPLE'], ['AWS_SECRET_ACCESS_KEY=', 'wJalrXUtnFEMI/K7MDENG…']];
  function envCard(g, t, P) {
    const a = smooth(tKey + .7, tKey + 1.2, t) * (1 - smooth(tLambdas - .4, tLambdas, t));
    if (a <= .01) return;
    const x = 760, y = 116 + (1 - easeIO(a)) * 16, w = 440, h = 196;
    g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(.018); g.translate(-x - w / 2, -y - h / 2);
    tornStrip(g, x, y, w, h, 9300, P, a);
    g.globalAlpha = a;
    serif(g, '.env', x + 24, y + 34, 20, P.ink, { weight: 700 });
    serif(g, 'found under the mat', x + w - 24, y + 34, 14, P.muted, { weight: 400, italic: true, align: 'right' });
    g.fillStyle = P.line; g.fillRect(x + 22, y + 46, w - 44, 1);
    g.font = '400 14px ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace'; g.textBaseline = 'middle';
    ENV.forEach(([k, v], i) => {
      const la = smooth(tKey + 1 + i * .3, tKey + 1.2 + i * .3, t);
      if (la <= .01) return;
      const ly = y + 70 + i * 26, kw = g.measureText(k).width;
      g.globalAlpha = a * la; g.fillStyle = P.text; g.fillText(k, x + 24, ly);
      const secret = i === 1 || i >= 2, red = secret ? smooth(tKeys, tKeys + .4, t) : 0;
      g.fillStyle = red > .5 ? P.stop : P.ink; g.fillText(v, x + 24 + kw, ly);
      if (red > .01) { g.fillStyle = P.stop; g.globalAlpha = a * red; g.fillRect(x + 24 + kw, ly + 9, g.measureText(v).width * red, 1.6); }
    });
    g.globalAlpha = a;
    serif(g, "illustrative; the keys are AWS's documented example", x + 24, y + h - 16, 12, P.muted, { weight: 400, italic: true });
    g.restore();
  }

  function labels(g, t, P, cam) {
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 2) {
      tag(g, cam, [BOARD.x, BOARD.y + BOARD.h + 34, BOARD.z], 'Certificate Transparency log', 18, P.ink, smooth(tBoard, tBoard + .5, t), { italic: true });
    }
    if (n === 3) {
      tag(g, cam, [DOOR.x, DOOR.h + 22, FRONT - 6], 'wp-admin', 17, P.ink, smooth(tWpadmin, tWpadmin + .4, t) * (1 - smooth(tMat, tMat + .4, t)), { italic: true });
      tag(g, cam, [MAT.x, 16, MAT.z - 30], '.env', 18, P.stop, smooth(tMat + .4, tMat + .8, t) * (1 - smooth(tShed, tShed + .4, t)), { italic: true });
      tag(g, cam, [SHED.x, SHED.h + 50, SHED.z - SHED.d / 2], '.git', 18, P.ink, smooth(tShed + .4, tShed + .8, t) * (1 - smooth(tSlot, tSlot + .4, t)), { italic: true });
      tag(g, cam, [DOOR.x, 80, FRONT - 6], 'mailer.cgi', 17, P.stop, smooth(tSlot + .5, tSlot + .9, t) * (1 - smooth(tOld, tOld + .4, t)), { italic: true });
    }
    if (n === 5) {
      tag(g, cam, [-800, 150, 1650], "Lambda, in the victims' accounts", 18, P.stop, smooth(tLambdas + .8, tLambdas + 1.3, t) * (1 - smooth(tNext + 2, tNext + 2.5, t)), { italic: true });
      // the prize: everything dims to the line
      const dim = smooth(tPrize - .2, tPrize + .6, t);
      if (dim > .01) {
        g.save(); g.globalAlpha = dim * .9; ground(g, P); g.restore();
        const cw = wordAt(5, /^compute/i, tPrize + 2.4, tPrize);
        serif(g, "It wasn't your data.", W / 2, 300, 48, P.muted, { weight: 700, align: 'center', alpha: smooth(tPrize + .2, tPrize + .8, t) });
        const w1 = serifWidth(g, 'It was your ', 64, { weight: 700 }), w2 = serifWidth(g, 'compute.', 64, { weight: 700 }), x0 = W / 2 - (w1 + w2) / 2, qb = smooth(cw - .3, cw + .2, t);
        serif(g, 'It was your ', x0, 392, 64, P.ink, { weight: 700, alpha: qb });
        serif(g, 'compute.', x0 + w1, 392, 64, P.stop, { weight: 700, alpha: qb });
        underline(g, x0 + w1, 410, w2, P, smooth(cw + .3, cw + .9, t), 8600, null, true);
      }
    }
    if (n === 5) envCard(g, t, P);
    if (n === 6) {
      tag(g, cam, [-800, 360, LOT.z0], 'a host', 20, P.ink, smooth(tTent + .6, tTent + 1.1, t), { italic: true });
      tag(g, cam, [DOOR.x + 60, 50, LOT.z0 - 120], 'one credential', 18, P.stop, smooth(tRope + .9, tRope + 1.4, t), { italic: true });
    }
    if (n === 8) {
      const qa = smooth(tSlips + .4, tSlips + .9, t) * (1 - smooth(tCost, tCost + .4, t));
      tag(g, cam, [COUNTER.x, COUNTER.h + 60, COUNTER.z - 10], 'move along', 26, P.ink, qa, { weight: 700 });
    }
    if (n === 9) {
      tag(g, cam, [LIVE.x, 90, LIVE.z], 'flat storage', 18, P.ink, smooth(tStorage + .2, tStorage + .6, t) * (1 - smooth(tMissing, tMissing + .4, t)), { italic: true });
      tag(g, cam, [-800, 30, FRONT - 70], 'not here', 22, P.stop, smooth(tMissing + .4, tMissing + .9, t) * (1 - smooth(tShape + 1, tShape + 1.6, t)), { italic: true });
    }
    if (n === 10) {
      tag(g, cam, [EDSHED.x, EDSHED.h + 70, EDSHED.z], 'the editor', 18, P.ink, smooth(tEditor + 1.6, tEditor + 2.1, t), { italic: true });
      const za = smooth(tNotzero, tNotzero + .5, t);
      if (za > .01) {
        const w1 = serifWidth(g, 'Flat isn’t ', 56, { weight: 700 }), w2 = serifWidth(g, 'zero.', 56, { weight: 700 }), x0 = W / 2 - (w1 + w2) / 2;
        serif(g, 'Flat isn’t ', x0, 120, 56, P.ink, { weight: 700, alpha: za }); serif(g, 'zero.', x0 + w1, 120, 56, P.stop, { weight: 700, alpha: za });
      }
    }
  }
  /* The moment a word is spoken, for pictures that land mid-sentence. */
  function wordAt(n, re, fb, after = -Infinity) {
    for (const l of T.lines) {
      if (l.beat !== n || l.end < after) continue;
      const ws = l.text.split(/\s+/);
      for (let k = 0; k < ws.length; k++) { const tk = l.start + (l.end - l.start) * k / ws.length; if (tk >= after - .01 && re.test(ws[k])) return tk; }
    }
    return fb;
  }

  function draw(g, t, P) {
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 1) { ground(g, P); titleCard(g, t, tTitle, P, { headline: 'Probe All You Want', dek: "There's no compute here.", dateline: 'From the Report of 4 September 2026' }, smooth(B(2) - .7, B(2) - .1, t)); }
    else {
      const cam = world(g, t, P);
      spine(g, t, P);
      phone(g, t, P);
      labels(g, t, P, cam);
      if (n === 11) {
        const la = smooth(tEnd, tEnd + .6, t), sa = smooth(tEnd + 3.2, tEnd + 4, t);
        if (la > .01) { g.save(); g.globalAlpha = la * .85; ground(g, P); g.restore(); }
        const lb = smooth(tEnd + 1, tEnd + 1.5, t);
        serif(g, 'Have an open house.', W / 2, 300, 58, P.ink, { weight: 700, align: 'center', alpha: la * (1 - sa) });
        const w1 = serifWidth(g, 'Just don’t hand out the ', 46, { weight: 400, italic: true }), w2 = serifWidth(g, 'keys.', 46, { weight: 700, italic: true }), x0 = W / 2 - (w1 + w2) / 2;
        serif(g, 'Just don’t hand out the ', x0, 372, 46, P.text, { weight: 400, italic: true, alpha: lb * (1 - sa) });
        serif(g, 'keys.', x0 + w1, 372, 46, P.stop, { weight: 700, italic: true, alpha: lb * (1 - sa) });
        underline(g, x0 + w1, 388, w2, P, smooth(tEnd + 1.5, tEnd + 2.1, t) * (1 - sa), 8300);
        signoff(g, W / 2, 300, P, sa);
      }
    }
    reportBug(g, P, smooth(B(2) + .4, B(2) + 1.4, t) * (1 - smooth(tEnd - .4, tEnd, t)));
    // every beat change fades through the paper, and nothing on screen is ever just cut off
    let d = 0;
    for (let k = 1; k < T.beats.length; k++) { const s = T.beats[k].start; d = Math.max(d, t < s ? smooth(s - .45, s, t) : 1 - smooth(s, s + .45, t)); }
    if (d > .001) { g.save(); g.globalAlpha = clamp(d, 0, 1); ground(g, P); g.restore(); }
  }
  const bug = () => 0;

  /* ================= sound ================= */
  const sounds = [];
  const fx = (t, kind, v = 1) => sounds.push({ t, kind, v });
  // 00: the house unfolds out of the page, its door opens, the callers arrive
  [0, 1, 2].forEach((k) => fx(tLog + .2 + k * .6, 'page', .45));
  fx(tLog + 2.5, 'latch', .6); fx(tLog + 2.6, 'paper', .5);
  OPEN.forEach((b) => fx(b.t0 + 2.4, 'probe', .35));
  fx(tFifty + 2.6, 'stamp', .7);
  fx(tTitle + .2, 'intro', 1);
  // 02: the street unfolds out of the page; our sheet pinned up; the readers arrive
  [0, 1, 2, 3].forEach((k) => fx(B(2) + .1 + k * .22, 'page', .35));
  fx(tCert + .2, 'latch', .5); fx(tBoard + .3, 'paper', .6); fx(tBoard + .7, 'stamp', .5);
  for (let k = 0; k < 8; k++) fx(tReaders + .3 + k * .28, 'chirp', .22);
  fx(tSeconds + .3, 'tick', .5); fx(tSeconds + .9, 'tick', .5);
  // 03: the knocks, door by door
  fx(tWpadmin + .1, 'latch', .6); fx(tWpadmin + .5, 'reject', .4);
  fx(tMat + .7, 'paper', .5); fx(tShed + .8, 'latch', .5); fx(tSlot + .5, 'clink', .45);
  for (let k = 0; k < 10; k++) fx(tOld + .2 + k * .18, 'probe', .3);
  for (let k = 0; k < 6; k++) fx(tDict + k * (1 / 1.6), 'thud', .35);
  // 04: the city
  for (let k = 0; k < 10; k++) fx(tCity + k * .15, 'blip', .2);
  fx(tSessions, 'probe', .5); fx(tSessions + 1.8, 'clink', .5); fx(tIps + 1.4, 'clink', .45);
  fx(tLa + .2, 'sparkle', .35); fx(tUnseen + .6, 'reject', .4);
  // 05: the key, the houses, the bill, the cellar
  fx(tKey + .1, 'paper', .5); fx(tKey + .6, 'reject', .5); fx(tKey + .9, 'paper', .5);
  ENV.forEach((_, i) => fx(tKey + 1.05 + i * .3, 'click', .3));
  for (let k = 0; k < 5; k++) fx(tKeys + .1 + k * .12, 'clink', .4);
  LAMBDAS.forEach((_, i) => { for (let k = 0; k < 4; k++) fx(builtAt(i) + k * .32, 'thud', .22); fx(builtAt(i) + 1.2, 'page', .4); });
  for (let k = 0; k < 12; k++) fx(tNext + .3 + k * .22, 'probe', .38);
  fx(tNext + 2.5, 'reject', .45);
  fx(tNext + .8, 'kaching', .6); fx(tMining + .2, 'thud', .4);
  MORE.forEach((_, i) => { fx(moreAt(i), 'page', .28); fx(moreAt(i) + .3, 'thud', .18); if (i % 3 === 2) fx(moreAt(i) + 1.4, 'kaching', .3); });
  for (let k = 0; k < 8; k++) fx(tMining + .4 + k * .4, 'clink', .22); fx(tRansom + .1, 'latch', .6); fx(tRansom + .9, 'paper', .5);
  fx(tPrize + .2, 'braam', .8);
  // 06: copies unfold, then fold away under the tent
  for (let k = 0; k < 12; k++) fx(tEight + .3 + k * .12, 'probe', .3);
  COPIES.forEach((_, i) => fx(waveHit + i * .25, 'page', .32));
  fx(waveHit + .2, 'thud', .5);
  for (let k = 0; k < 10; k++) fx(tBurst + 1.4 + k * .09, 'paper', .2);
  fx(tBurst + 2.4, 'clear', .45);
  fx(tTent + .2, 'canopy', .8); fx(tRope + .9, 'latch', .7);
  // 07: the reach through the printed door, and nothing
  fx(tTurn + .5, 'paper', .4); fx(tNothing + 1.1, 'click', .5);
  // 08: slips, slips, slips
  for (let k = 0; k < 8; k++) fx(tSlips + .2 + k * .3, 'paper', .25);
  fx(tCost + .4, 'clear', .5);
  // 09: the rewind, the shop folding flat, the boxes
  fx(tRewind, 'rewind', .6); [0, 1, 2].forEach((k) => fx(tRewind + .5 + k * .5, 'page', .45));
  fx(tFiles + .2, 'paper', .5); fx(tStorage + .2, 'paper', .4); fx(tMissing + .2, 'scribe', .4);
  // 10: the editor, the shed unfolding and folding
  fx(tLane, 'page', .35); fx(tEditor + 1.8, 'page', .5); fx(tEditor + 2.2, 'latch', .5); fx(tAsleep + .3, 'page', .45);
  fx(tNotzero + .2, 'scribe', .4);
  // 11: callers in and out of the open house; the line; the sign-off
  for (let k = 0; k < 10; k++) fx(B(11) + 1.9 + k * .55, 'paper', .18);
  fx(tEnd, 'resolve', .8); fx(tEnd + 1.6, 'scribe', .4); fx(tEnd + 3.3, 'logo', .8);
  // the phone: a soft notice for each item that lands while it's up; paper as it comes and goes
  FEED.forEach((it) => { if (held(it.t + .2) > .5) fx(it.t + .05, it.kind === 'log' ? 'click' : 'notify', it.kind === 'log' ? .18 : .22); });
  FEED.filter((it) => it.kind === 'dl').forEach((it) => { for (let k = 0; k < 10; k++) fx(it.t + .35 + k * it.dur / 10, 'tick', .12); fx(it.t + .3 + it.dur, 'save', .4); });
  GLANCES.forEach(([a, b]) => { fx(a + .05, 'paper', .22); fx(b - .5, 'paper', .16); });
  sounds.sort((p, q) => p.t - q.t);

  const lin = (list) => (t) => {
    if (t <= list[0][0]) return list[0][1];
    for (let i = 0; i < list.length - 1; i++) if (t < list[i + 1][0]) return lerp(list[i][1], list[i + 1][1], (t - list[i][0]) / Math.max(.001, list[i + 1][0] - list[i][0]));
    return list[list.length - 1][1];
  };
  const intensity = lin(mono([[0, .4], [B(2), .45], [B(3), .55], [tDict, .7], [B(4), .7], [B(5), .65], [tPrize, .85], [B(6), .5], [B(7), .4], [B(8), .5], [B(10), .45], [T.total, .4]]).map(([a, b]) => [a, b]));
  const swarm = lin(mono([[0, 0], [tReaders, 0], [tReaders + 1, .25], [tFollow, .3], [tDict, .55], [B(4), .7], [B(5), .45], [tPrize, 0], [B(8), .2], [B(10), .05], [T.total, 0]]).map(([a, b]) => [a, b]));
  const audio = (t) => ({
    wind: t > B(2) && t < B(11) ? .12 : 0, speed: .1, swarm: .5 * swarm(t),
    hum: (t > tFollow + 2.6 && t < tRewind) ? .18 + .12 * smooth(tScale, tEight, t) : 0,
    intensity: intensity(t),
    riser: smooth(tRansom, tPrize - .1, t) * (t < tPrize ? .7 : 0),
    fade: 1 - smooth(T.total - 2.5, T.total - .2, t),
  });

  checkSounds(sounds);
  return { draw, bug, sounds, audio, score: scoreFor(T, SCORE) };
}
