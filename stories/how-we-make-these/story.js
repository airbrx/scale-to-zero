/* story.js - "How We Make These".

   A film about how the Report's films are made, in their own material. It
   doesn't explain the method; it does it, move by move (STYLE.md):

   - the cold open, a hook: the manifesto's ten rules land one by one on a
     running application, and with each a piece of it folds down or changes,
     until almost nothing is running
   - the place, and the material's range: the same page folds into a street
     at night in fog, then a mill on someone else's river, then a city, then
     back into the page
   - what we follow: one bot, out of the fog, to one door
   - the edges: receipts at the frame's edge keep score; the phone slides in
     with the numbers
   - the turn: the bot reaches through the printed door and grabs nothing
   - the rhyme: rewound, the shop folds into the page as dashed outlines
   - the honest caveat: a shed behind a stone wall
   - stillness: everything folds back down; the last frame is emptier

   Built from brand/fold.js and the shared cast (brand/street.js, hud.js).
   Nothing hardcodes a moment: every build hangs off a {cue} or a beat edge. */

import { clamp, lerp, smooth, easeIO, seeded, ground } from '../lib/sketch.js';
import { titleCard, signoff, reportBug, serif, serifWidth, tornStrip } from '../brand/report.js';
import { mix } from '../brand/color.js';
import { scene, cameraPath, building, block, newsprint, water, wheel, dam, rotate, LOOK, HOUSE_LOOK } from '../brand/fold.js';
import { bot3, track, onto, doorPanel, dashedRect, houseFront, mist } from '../brand/street.js';
import { makePhone, drawReceipts } from '../brand/hud.js';
import { scoreFor, checkSounds } from '../score/sound.js';

export const W = 1280, H = 720;

export const BEATS = {
  0: { min: 17, cues: { rules: 1, app: 1.5, rebuild: 2, zero: 4 } },
  1: { min: 5, cues: { title: 4.8 } },
  2: { min: 14, cues: { place: 1.5, street: 2.5, mill: 2.5, city: 2.5, paper: 2.6 } },
  3: { min: 7, cues: { one: 1.5, bot: 3.5 } },
  4: { min: 7, cues: { spine: 2.5, phone: 3.5 } },
  5: { min: 7, cues: { turn: 2, shot: 3.2 } },
  6: { min: 6, cues: { rewind: 1.6, less: 3 } },
  7: { min: 5, cues: { honest: 3.4 } },
  8: { min: 7, cues: { still: 3, end: 4.5 } },
};

export const SCORE = {
  key: 'D',
  sections: {
    // the application running, thinning out rule by rule (intensity and hum fall with it)
    rules: { mode: 'dorian', bpm: 84, prog: [0, 5, 3, 4], bars: 2, padTone: 'strings', pad: .55, pluck: .6, bass: .45, keys: .3, drone: .4, fade: 1 },
    place: { mode: 'dorian', bpm: 80, prog: [0, 5, 3, 4], bars: 2, pad: .6, keys: .5, bells: .3, drone: .4, fade: 1.5 },
    follow: { mode: 'minor', bpm: 88, prog: [0, 5, 2, 6], bars: 2, padTone: 'strings', pad: .5, pluck: .6, bass: .4, drone: .4 },
    edges: { mode: 'minor', bpm: 88, prog: [0, 5, 2, 6], bars: 1, padTone: 'strings', pad: .5, pluck: .75, bass: .55, hat: .3, drone: .4 },
    turn: { mode: 'minor', bpm: 60, prog: [0], bars: 4, padTone: 'strings', pad: .45, drone: .6, fade: 2.5 },
    twice: { mode: 'major', bpm: 92, prog: [0, 4, 5, 3], bars: 1, pad: .5, arp: .6, bass: .45, bells: .3, fade: 2 },
    honest: { mode: 'major', bpm: 72, prog: [0, 3], bars: 2, pad: .6, keys: .55, bells: .3, drone: .3 },
    still: { mode: 'major', bpm: 66, prog: [0, 3, 4, 0], bars: 2, pad: .7, bells: .55, keys: .3, drone: .35, fade: 2.5 },
  },
};

/* ================= the page and what folds out of it ================= */
const HOUSE = { x: 300, z: 1200, w: 230, h: 270, eaves: 190, door: { w: 62, h: 112 } };
const SHOP = { x: -300, z: 1300, w: 260, d: 200, h: 160 };
const SFRONT = SHOP.z - SHOP.d / 2, SDOOR = { x: SHOP.x, w: 54, h: 96 };
const MILL = { x: -60, z: 1360, w: 300, d: 200, h: 180 };
const RIVER = [[-2600, 1180], [-1200, 1150], [0, 1170], [1400, 1140], [2600, 1170]];
const SHED = { x: SHOP.x, z: SHOP.z, w: 120, d: 100, h: 90 };
const STREET_Z = [880, 1020];
// the manifesto's ten rules (content/manifesto.json, "The Southern Cross")
const RULES = ['Do not wake the Beast.', 'Keep your center of gravity low.', 'The balance sheet is the product owner.', 'Security, availability, and resilience are not features.', 'Every dependency is a decision.', 'Build it stateless. Build it to scale to zero.', 'No shiny objects.', 'Modernization is baked in, not bolted on.', 'Document your schemas.', 'Thank you; have a nice day.'];
// the application they're applied to
const APP = {
  beast: { x: 240, z: 1560, w: 380, d: 170, h: 110 },
  towers: [[-140, 1330], [-30, 1330], [80, 1330]],
  shiny: [560, 1360], vendors: [[820, 1760], [960, 1600]],
  crate: [420, 1210], gate: [170, 1080], old: [-80, 1190], page: { x: 170, z: 1220 },
};

export function makeStory(T) {
  // the house look (STYLE.md, "Light and heat"): running things run hot, lit windows glow, the page is printed
  Object.assign(LOOK, HOUSE_LOOK);
  const at = (n) => T.at(n), B = (n) => T.start(n);
  const tRules = at('rules'), tApp = at('app'), tRebuild = at('rebuild'), tZero = at('zero'), tTitle = at('title');
  const tPlace = at('place'), tStreet = at('street'), tMill = at('mill'), tCity = at('city'), tPaper = at('paper');
  const tOne = at('one'), tBot = at('bot'), tSpine = at('spine'), tPhone = at('phone');
  const tTurn = at('turn'), tShot = at('shot'), tRewind = at('rewind'), tLess = at('less');
  const tHonest = at('honest'), tStill = at('still'), tEnd = at('end');

  /* ================= folding: one page, many places ================= */
  // the cold open: rule i lands at rt(i); ruled(i) is how far it's been applied
  const rt = (i) => lerp(tRebuild + .2, B(1) - 2.6, i / (RULES.length - 1));
  const ruled = (i) => (t) => smooth(rt(i) + .1, rt(i) + .9, t);
  const appUp = (t) => smooth(tApp - .4, tApp + .8, t) * (1 - smooth(B(1) - .5, B(1), t));
  const billK = (t) => clamp(.92 - RULES.reduce((s2, _, i) => s2 + .085 * ruled(i)(t), 0) - .1 * ruled(2)(t), .03, .92);
  // the street comes up twice: as the first place, and again for the rest of the film
  const street1 = (t) => smooth(tStreet - .1, tStreet + .9, t) * (1 - smooth(tMill - .3, tMill + .5, t));
  const street2 = (t) => smooth(B(3) - .3, B(3) + .8, t) * (1 - smooth(tStill + .1, tStill + 1.3, t));
  const houseF = (t) => Math.max(street1(t), street2(t));
  const shopF = (t) => Math.max(street1(t), street2(t) * (1 - smooth(tLess - .2, tLess + 1.2, t)));
  const millF = (t) => smooth(tMill + .1, tMill + 1.1, t) * (1 - smooth(tPaper - .1, tPaper + 1.1, t));
  const shedF = (t) => smooth(tHonest - .2, tHonest + .9, t) * (1 - smooth(tStill + .2, tStill + 1.2, t));

  /* ================= the city, round the page's middle ================= */
  const CITY = (() => {
    const r = seeded(808), out = [];
    for (let gx = -8; gx <= 8; gx++) for (let gz = -1; gz <= 9; gz++) {
      const x = gx * 420 + (r() - .5) * 60, z = 600 + gz * 380 + (r() - .5) * 60;
      if (Math.abs(x) < 700 && z > 800 && z < 1700) continue;   // the middle stays the mill's
      out.push({ x, z, w: 120 + r() * 120, d: 110 + r() * 90, h: 50 + r() * 140, d0: Math.hypot(x, z - 1300) / 4200, lit: r() < .45 });
    }
    return out;
  })();
  const cityF = (b, t) => smooth(tCity + b.d0 * 1.4, tCity + b.d0 * 1.4 + .6, t) * (1 - smooth(tPaper + b.d0 * .8, tPaper + b.d0 * .8 + .6, t));

  /* ================= the bots ================= */
  const r0 = seeded(4242);
  // a few figures in the first street, loitering
  const LOITER = [[-120, 940], [80, 990], [520, 930], [-520, 980]];
  // the one we follow: out of the fog, down the street, to the shop's door
  const F = track([[B(3), 1900, 950], [tBot - .4, 700, 960], [tBot + 2.2, SDOOR.x + 8, SFRONT - 42, SDOOR.x, SFRONT], [tRewind + .4, SDOOR.x + 8, SFRONT - 42, SDOOR.x, SFRONT], [tLess + 2, HOUSE.x - 40, HOUSE.z - 140, HOUSE.x, HOUSE.z]]);
  // a little crowd of its own, at the house
  const CROWD = [0, 1, 2, 3].map((i) => ({ ph: r0(), at: track([[B(3) + .3 + i * .3, -1900 + i * 60, 960], [tBot + 1.6 + i * .2, HOUSE.x - 160 + i * 70, HOUSE.z - 170 - (i % 2) * 30, HOUSE.x, HOUSE.z]]) }));
  // the one that reaches through the printed door
  const G = track([[B(5) - 1.2, HOUSE.x - 220, HOUSE.z - 160], [tTurn + .3, HOUSE.x, HOUSE.z - 40, HOUSE.x, HOUSE.z], [1e9, HOUSE.x, HOUSE.z - 40, HOUSE.x, HOUSE.z]]);

  /* ================= the shop, the house, the mill, the shed ================= */
  function shop(S, P, t) {
    const f = shopF(t);
    if (f < .3) {
      const k = smooth(tLess + .6, tLess + 1.4, t) * (t > B(6) ? 1 : 0) * (1 - smooth(tStill, tStill + 1, t));
      if (k > .01) {
        const c = mix(P.grid, P.ink, .2);
        dashedRect(S, SDOOR.x - SDOOR.w / 2, SFRONT - 6, SDOOR.x + SDOOR.w / 2, SFRONT + 4, c, { alpha: k });
        dashedRect(S, SHOP.x - 36, SFRONT - 52, SHOP.x + 36, SFRONT - 18, c, { alpha: k });
        dashedRect(S, SHOP.x + 150, SHOP.z - 40, SHOP.x + 240, SHOP.z + 40, c, { alpha: k });
      }
    }
    const warm = smooth(B(3) + 1, tBot + 2.4, t) * .45;
    building(S, { x: SHOP.x, z: SHOP.z, w: SHOP.w, d: SHOP.d, h: SHOP.h, roof: .5, fold: f, color: mix(mix(P.card, P.stop, warm * .4), mix(P.bg, P.grid, .18), 1 - f), roofColor: mix(mix(P.stop, P.grid, .45), mix(P.bg, P.grid, .3), 1 - f), windows: [[.2, .62], [.8, .62]], lit: smooth(tBot + 2, tBot + 2.6, t) * f });
    if (f <= .3) return;
    const a = (1 - smooth(0, .6, f)) * Math.PI / 2, onFront = (p) => rotate(p, [0, 0, SFRONT], [1, 0, 0], -a);
    const wall = [[SHOP.x - SHOP.w / 2, 0, SFRONT], [SHOP.x + SHOP.w / 2, 0, SFRONT], [SHOP.x + SHOP.w / 2, SHOP.h, SFRONT], [SHOP.x - SHOP.w / 2, SHOP.h, SFRONT]].map(onFront);
    const way = [[SDOOR.x - SDOOR.w / 2, 0, SFRONT - .5], [SDOOR.x + SDOOR.w / 2, 0, SFRONT - .5], [SDOOR.x + SDOOR.w / 2, SDOOR.h, SFRONT - .5], [SDOOR.x - SDOOR.w / 2, SDOOR.h, SFRONT - .5]].map(onFront);
    S.poly(way, mix(P.ink, P.coin, .3), { flat: true, bias: onto(S, wall, way, 1) });
    const open = .3 * Math.max(0, Math.sin((t - tBot) * 4)) * smooth(tBot + 2.2, tBot + 2.5, t) * (1 - smooth(B(4), B(4) + .5, t));
    if (a < .05) doorPanel(S, SDOOR.x - SDOOR.w / 2, 0, SFRONT - 1, SDOOR.w, SDOOR.h, -open * 1.6, mix(P.stop, P.grid, .5), wall);
    // the mat
    S.poly([[SHOP.x - 36, 1, SFRONT - 52], [SHOP.x + 36, 1, SFRONT - 52], [SHOP.x + 36, 1, SFRONT - 18], [SHOP.x - 36, 1, SFRONT - 18]], mix(P.coin, P.grid, .55), { layer: 1 });
    // the shed beside it
    building(S, { x: SHOP.x + 195, z: SHOP.z, w: 90, d: 80, h: 70, roof: .45, fold: f, color: mix(P.card, P.grid, .25), roofColor: mix(P.grid, P.ink, .2) });
  }
  function streetBits(S, P, t) {
    const f = houseF(t);
    if (f <= .01) return;
    S.poly([[-3000, .1, STREET_Z[0]], [3000, .1, STREET_Z[0]], [3000, .1, STREET_Z[1]], [-3000, .1, STREET_Z[1]]], mix(P.bg, P.grid, .12 * f), { layer: 0, flat: true });
    for (let x = -1650; x <= 1650; x += 550) {
      block(S, x, 0, STREET_Z[0] - 30, 6, 150 * f, 6, mix(P.ink, P.grid, .4));
      block(S, x, 150 * f, STREET_Z[0] - 30, 18, 12 * f, 18, mix(P.card, P.coin, .55), { flat: true });
    }
  }
  function mill(S, P, t) {
    const f = millF(t);
    if (f <= .01) return;
    water(S, RIVER, 150 * f, { phase: t * 3, alpha: f });
    building(S, { x: MILL.x, z: MILL.z, w: MILL.w, d: MILL.d, h: MILL.h, roof: .55, fold: f, color: mix(P.card, P.grid, .2), roofColor: mix(P.stop, P.grid, .45), windows: [[.2, .6], [.5, .6], [.8, .6]], lit: f });
    wheel(S, [MILL.x + MILL.w / 2 + 30, 100 * f, 1210], 90, t * .8, { fold: f });
    // upstream, someone else's dam
    dam(S, -1250, 1150, Math.PI / 2, { w: 200, h: 80 * f, gate: 1 });
  }
  function city(S, P, t) {
    for (const b of CITY) {
      const f = cityF(b, t);
      if (f <= .01) continue;
      block(S, b.x, 0, b.z, b.w, b.h * f, b.d, mix(P.card, P.grid, .25));
      if (b.lit) block(S, b.x, b.h * f, b.z, b.w * .45, 1, b.d * .4, mix(P.card, P.coin, .7), { flat: true });
    }
  }
  function shed(S, P, t) {
    const f = shedF(t);
    if (f <= .01) return;
    building(S, { x: SHED.x, z: SHED.z, w: SHED.w, d: SHED.d, h: SHED.h, roof: .5, fold: f, color: mix(P.card, P.ok, .12), roofColor: mix(P.ok, P.grid, .4), windows: [[.5, .55]], lit: .4 });
    // the stone wall, one gate, shut
    const sr = seeded(5150), X0 = SHED.x - 160, X1 = SHED.x + 160, Z0 = SHED.z - 150, Z1 = SHED.z + 150;
    const stone = (k) => mix(mix(P.grid, P.card, .35), P.coin, .08 + (k % 3) * .04);
    const course = (xa, za, xb, zb, k0) => {
      const L = Math.hypot(xb - xa, zb - za), n = Math.max(1, Math.round(L / 56));
      for (let k = 0; k < n; k++) {
        const u = (k + .5) / n, x = lerp(xa, xb, u), z = lerp(za, zb, u), along = Math.abs(xb - xa) > Math.abs(zb - za);
        if (along && Math.abs(za - Z0) < 1 && Math.abs(x - SHED.x) < 45) continue;
        block(S, x, 0, z, along ? L / n - 3 : 34, (118 + (sr() - .5) * 26) * f, along ? 34 : L / n - 3, stone(k0 + k));
      }
    };
    course(X0, Z0, X1, Z0, 0); course(X0, Z1, X1, Z1, 7); course(X0, Z0, X0, Z1, 3); course(X1, Z0, X1, Z1, 5);
    block(S, SHED.x, 0, Z0, 86, 112 * f, 22, mix(P.ink, P.grid, .35));
  }
  // the application, rebuilt rule by rule
  function app(S, P, t) {
    const up = appUp(t);
    if (up <= .01) return;
    const R = RULES.map((_, i) => ruled(i)(t));
    // 1 Do not wake the Beast: the warehouse goes dark and folds down
    const bf = up * (1 - R[0]), bl = 1 - R[0];
    building(S, { ...APP.beast, roof: .4, fold: Math.max(.001, bf), color: mix(P.card, P.stop, .18 * bl), roofColor: mix(mix(P.stop, P.grid, .35), mix(P.bg, P.grid, .3), R[0]), windows: [[.12, .55], [.3, .55], [.5, .55], [.7, .55], [.88, .55]], lit: bl * up });
    for (let k = 0; k < 5 && bl > .05 && up > .5; k++) {
      const u = ((t * .4 + k / 5) % 1), sz = 12 + u * 26;
      block(S, APP.beast.x + 120 + Math.sin(u * 4 + k) * 10, APP.beast.h + 60 + u * 170, APP.beast.z, sz, sz, sz, mix(P.panel, P.stop, .3), { alpha: (1 - u) * .7 * bl, flat: true });
    }
    // 2 Keep your center of gravity low: the data walks out into a crate of your own
    const cf = up * smooth(rt(1), rt(1) + .5, t), [cx, cz] = APP.crate;
    if (cf > .01) {
      block(S, cx, 0, cz, 130, 30 * cf, 90, mix(P.coin, P.card, .5));
      for (let k = 0; k < 6; k++) {
        const u = easeIO(smooth(rt(1) + .2 + k * .08, rt(1) + .9 + k * .08, t));
        const from = [APP.beast.x - 120 + k * 45, 20, APP.beast.z - 60], to = [cx - 45 + (k % 3) * 30, 30, cz - 20 + Math.floor(k / 3) * 34];
        const p = [lerp(from[0], to[0], u), lerp(from[1], to[1], u) + Math.sin(u * Math.PI) * 60, lerp(from[2], to[2], u)];
        block(S, p[0], p[1], p[2], 24, 14, 26, mix(P.card, P.water, .25), { alpha: up });
        // 9 Document your schemas: each block gets its printed label
        if (R[8] > .01) S.line([p[0] - 9, p[1] + 14.5, p[2] - 6], [p[0] - 9 + 18 * R[8], p[1] + 14.5, p[2] - 6], P.ink, { layer: 2, lw: 1.6, alpha: up });
      }
    }
    // 4 Security ... not features: a gate unfolds at the front
    const gf = up * R[3], [gx, gz] = APP.gate;
    if (gf > .01) { block(S, gx - 80, 0, gz, 16, 90 * gf, 16, mix(P.ok, P.grid, .3)); block(S, gx + 80, 0, gz, 16, 90 * gf, 16, mix(P.ok, P.grid, .3)); block(S, gx, 76 * gf, gz, 176, 14 * gf, 16, P.ok); }
    // 5 Every dependency is a decision: the ropes to the vendors go, and the vendors fold away
    APP.vendors.forEach(([vx, vz], i) => {
      const vf = up * (1 - R[4]);
      if (vf > .04) building(S, { x: vx, z: vz, w: 150, d: 120, h: 100, roof: .35, fold: vf, color: mix(P.card, P.grid, .3), roofColor: mix(P.ink, P.grid, .3), windows: [[.5, .55]], lit: vf });
      APP.towers.forEach(([tx, tz], j) => { if ((i + j) % 2 === 0) S.line([tx, 200 * up, tz], [vx, 90 * vf, vz], mix(P.ink, P.grid, .3), { layer: 2, lw: 1.4, alpha: up * (1 - R[4]) }); });
    });
    // 6 Build it stateless, scale to zero: the towers fold down, asleep
    APP.towers.forEach(([tx, tz], i) => {
      const tf = up * (1 - smooth(rt(5) + i * .15, rt(5) + .8 + i * .15, t));
      building(S, { x: tx, z: tz, w: 90, d: 90, h: 220, roof: .4, fold: Math.max(.001, tf), color: mix(P.card, P.stop, .12 * tf), roofColor: mix(P.grid, P.ink, .25), windows: [[.5, .3], [.5, .55], [.5, .8]], lit: tf });
    });
    // 7 No shiny objects: the shiny new tower folds away
    const sf = up * (1 - R[6]);
    if (sf > .04) building(S, { x: APP.shiny[0], z: APP.shiny[1], w: 100, d: 100, h: 250, roof: .9, fold: sf, color: mix(P.card, P.water, .35), roofColor: P.water, windows: [[.5, .4], [.5, .7]], lit: sf });
    // 8 Modernization, baked in: an old box swaps for a paper one in place
    const of = up * (1 - R[7]), [ox, oz] = APP.old;
    if (of > .01) block(S, ox, 0, oz, 70, 60 * of, 60, mix(P.grid, P.ink, .25));
    if (R[7] > .01) block(S, ox, 0, oz, 70, 4 * R[7], 60, P.card);
    // 10 Thank you; have a nice day: one printed page stands where the app was
    houseFront(S, P, { x: APP.page.x, z: APP.page.z, w: 200, h: 236, eaves: 166, fold: up * R[9], open: R[9], door: { w: 54, h: 98 } });
  }
  // the ten rules, inking in one by one on a torn strip of the manifesto
  function rules(g, t, P) {
    const a = smooth(tRules - .2, tRules + .5, t) * (1 - smooth(B(1) - .5, B(1), t));
    if (a <= .01) return;
    const x = 36, y = 70, w = 404, h = 486;
    g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(-.012); g.translate(-x - w / 2, -y - h / 2);
    tornStrip(g, x, y, w, h, 7700, P, a);
    // set the way the site sets it: "The" italic, the key word in invoice red,
    // the site's own name for the list under it, then its principle rows
    // (scale-to-zero.com/flat-stack.html: red mono 01-10, bold serif names, hairlines)
    g.globalAlpha = a;
    const tw = serifWidth(g, 'The ', 26, { weight: 400, italic: true }), fw = serifWidth(g, 'Flat ', 26, { weight: 700 });
    serif(g, 'The ', x + 24, y + 40, 26, P.text, { weight: 400, italic: true });
    serif(g, 'Flat ', x + 24 + tw, y + 40, 26, P.stop, { weight: 700 });
    serif(g, 'Stack', x + 24 + tw + fw, y + 40, 26, P.ink, { weight: 700 });
    serif(g, 'The Southern Cross', x + 24, y + 62, 14, P.muted, { weight: 400, italic: true });
    g.fillStyle = P.line; g.fillRect(x + 22, y + 74, w - 44, 1); g.fillRect(x + 22, y + 77, w - 44, 1);
    RULES.forEach((r, i) => {
      const on = smooth(rt(i), rt(i) + .35, t);
      if (on <= .01) return;
      const ly = y + 102 + i * 38, cur = t < (i < RULES.length - 1 ? rt(i + 1) : 1e9);
      g.globalAlpha = a * on;
      g.save(); g.font = '600 12px ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace'; g.textBaseline = 'middle'; g.fillStyle = P.stop;
      g.fillText(String(i + 1).padStart(2, '0'), x + 24, ly); g.restore();
      serif(g, r, x + 56, ly, 14.5, cur ? P.ink : P.text, { weight: 700, alpha: cur ? 1 : .62, base: 'middle' });
      if (i < RULES.length - 1) { g.fillStyle = P.line; g.globalAlpha = a * on; g.fillRect(x + 22, ly + 19, w - 44, 1); }
    });
    g.restore();
  }

  /* ================= the camera ================= */
  const CAM = cameraPath(mono([
    [0, [60, 560, 520], [40, 40, 1400]],
    [B(1) - .2, [60, 480, 640], [40, 40, 1380]],
    [B(2), [0, 760, 150], [0, 60, 1250]],
    [tStreet + .4, [700, 320, 620], [0, 90, 1220]],
    [tMill + .5, [-760, 400, 620], [0, 100, 1300]],
    [tCity + .2, [-500, 1100, -200], [0, 0, 1500]],
    [tPaper, [0, 2700, -1800], [0, 0, 2000]],
    [tPaper + 2.4, [0, 1500, 300], [0, 0, 1300]],
    // one bot, out of the fog, to the door
    [B(3), [1100, 300, 620], [800, 50, 960]],
    [tBot + .4, [500, 260, 520], [200, 50, 1000]],
    [tBot + 2.6, [-80, 240, 760], [-300, 50, 1200]],
    // the edges: wide, so the receipts and the phone have room
    [B(4), [-60, 520, 300], [0, 60, 1250]],
    [B(5) - .1, [-60, 520, 300], [0, 60, 1250]],
    // the turn
    [B(5), [HOUSE.x - 220, 230, HOUSE.z - 620], [HOUSE.x, 100, HOUSE.z]],
    [tShot - .3, [HOUSE.x - 160, 200, HOUSE.z - 540], [HOUSE.x, 80, HOUSE.z]],
    [tShot + 1.4, [HOUSE.x + 520, 110, HOUSE.z + 20], [HOUSE.x, 50, HOUSE.z + 20]],
    [B(6) - .1, [HOUSE.x + 530, 110, HOUSE.z + 20], [HOUSE.x, 50, HOUSE.z + 20]],
    // twice: wide, the shop folding down
    [B(6), [0, 720, 150], [0, 0, 1250]],
    [tLess + 2, [-100, 760, 200], [-50, 0, 1250]],
    // honest: the shed behind its wall
    [B(7), [SHED.x + 380, 620, SHED.z - 640], [SHED.x, 20, SHED.z]],
    [B(8) - .1, [SHED.x + 340, 600, SHED.z - 600], [SHED.x, 20, SHED.z]],
    // still: up and back over the empty page
    [B(8), [0, 900, 0], [0, 0, 1250]],
    [T.total, [0, 1400, -300], [0, 0, 1250]],
  ]));
  function mono(keys) { const out = []; for (const k of keys) { const p = out[out.length - 1]; out.push([p ? Math.max(k[0], p[0] + .02) : k[0], ...k.slice(1)]); } return out; }

  /* ================= the phone and the receipts ================= */
  const PHONE = makePhone({
    feed: [
      { t: tPhone + .1, kind: 'stat', v: () => '50', label: 'bots at the door, within minutes', src: "the site's own log", c: 'stop' },
      { t: tPhone + .9, kind: 'log', path: '/wp-login.php' },
      { t: tPhone + 1.3, kind: 'log', path: '/.env' },
      { t: tPhone + 1.9, kind: 'note', text: 'listed in the Certificate Transparency log' },
    ],
    quiet: [[0, tPhone - .5], [B(5) - .4, 1e9]],
    hold: 3.4,
  });
  const theirs = (t) => .04 + .5 * smooth(tSpine, tSpine + 2.6, t) + .15 * smooth(tPhone, tPhone + 2, t);
  const ours = () => .03;

  /* ================= the frame ================= */
  function world(g, t, P) {
    ground(g, P);
    const cityBeat = t > tCity - .2 && t < tPaper + 1.6;
    const far = cityBeat ? lerp(2600, 14000, smooth(tCity - .2, tCity + 1, t)) : 2600;
    const cam = CAM(t), S = scene(cam, P, { fog: [far * .15, far] });
    newsprint(S, -1500, 300, 16, 26, { alpha: .05 });
    app(S, P, t);
    streetBits(S, P, t);
    shop(S, P, t);
    houseFront(S, P, { x: HOUSE.x, z: HOUSE.z, w: HOUSE.w, h: HOUSE.h, eaves: HOUSE.eaves, fold: houseF(t), open: smooth(tStreet + .8, tStreet + 1.6, t), door: HOUSE.door });
    mill(S, P, t);
    city(S, P, t);
    shed(S, P, t);
    // the loiterers, in the first street
    const s1 = street1(t);
    if (s1 > .3) LOITER.forEach(([x, z], i) => bot3(S, P, x, z, Math.PI / 2 + (i - 1.5) * .4, { t, ph: i, alpha: s1, reach: Math.max(0, Math.sin(t * 3 + i)) * .5 }));
    // the one we follow, and its crowd
    if (t > B(3) && t < tStill + 1) {
      const a = 1 - smooth(tStill, tStill + .8, t), p = F(t);
      bot3(S, P, p.x, p.z, p.yaw, { walk: p.walk, t, reach: p.walk ? 0 : Math.max(0, Math.sin(t * 3.4)), alpha: a });
      for (const c of CROWD) { const q = c.at(t); bot3(S, P, q.x, q.z, q.yaw, { walk: q.walk, t, ph: c.ph, alpha: a * (1 - smooth(B(5) - .3, B(5), t) * (1 - smooth(B(6), B(6) + .4, t))), reach: q.walk ? 0 : Math.max(0, Math.sin((t + c.ph * 7) * 3)) * .6 }); }
    }
    // the reach through the printed door, onto nothing
    if (t > B(5) - 1.2 && t < B(6)) {
      const p = G(t), reach = smooth(tTurn + .4, tShot, t), empty = smooth(tShot + .9, tShot + 1.6, t);
      bot3(S, P, p.x, p.z, p.yaw, { reach, walk: p.walk, t, armLen: 110, empty });
    }
    S.flush(g);
    mist(g, t, P, Math.max(street1(t), street2(t)) * (t > B(8) ? .5 : 1));
    return cam;
  }

  function draw(g, t, P) {
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 1) {
      ground(g, P);
      titleCard(g, t, tTitle, P, { headline: 'How We Make These', dek: 'Every film is a place, folded out of paper.', dateline: 'The Report, in motion' }, smooth(B(2) - .7, B(2) - .1, t));
    } else {
      const cam = world(g, t, P);
      if (n === 0) {
        rules(g, t, P);
        drawReceipts(g, P, appUp(t), [{ x: 1218, k: billK(t), color: P.stop, name: 'the bill' }]);
      }
      drawReceipts(g, P, smooth(tSpine, tSpine + .6, t) * (1 - smooth(tStill - .3, tStill + .3, t)), [{ x: 1150, k: theirs(t), color: P.stop, name: 'theirs' }, { x: 1218, k: ours(t), color: P.ink, name: 'ours' }]);
      PHONE.draw(g, t, P);
      if (n === 7) {
        const za = smooth(tHonest + .8, tHonest + 1.3, t);
        if (za > .01) {
          const w1 = serifWidth(g, 'Flat isn’t ', 52, { weight: 700 }), w2 = serifWidth(g, 'zero.', 52, { weight: 700 }), x0 = W / 2 - (w1 + w2) / 2;
          serif(g, 'Flat isn’t ', x0, 120, 52, P.ink, { weight: 700, alpha: za });
          serif(g, 'zero.', x0 + w1, 120, 52, P.stop, { weight: 700, alpha: za });
        }
      }
      if (n === 8) {
        const sa = smooth(tEnd + .2, tEnd + 1.2, t);
        if (sa > .01) signoff(g, W / 2, 290, P, sa);
      }
    }
    reportBug(g, P, smooth(B(2) + .4, B(2) + 1.4, t) * (1 - smooth(tEnd - .4, tEnd, t)));
    // every beat change fades through the paper
    let d = 0;
    for (let k = 1; k < T.beats.length; k++) { const s = T.beats[k].start; d = Math.max(d, t < s ? smooth(s - .45, s, t) : 1 - smooth(s, s + .45, t)); }
    if (d > .001) { g.save(); g.globalAlpha = clamp(d, 0, 1); ground(g, P); g.restore(); }
  }
  const bug = () => 0;

  /* ================= sound ================= */
  const sounds = [];
  const fx = (t, kind, v = 1) => sounds.push({ t, kind, v });
  [0, 1, 2].forEach((k) => fx(tApp - .4 + k * .3, 'page', .4));
  RULES.forEach((_, i) => { fx(rt(i), 'stamp', .45); fx(rt(i) + .3, 'page', .3); });
  fx(rt(0) + .4, 'powerDown', .4); fx(rt(4) + .3, 'latch', .4); fx(rt(9) + .5, 'resolve', .5);
  fx(tTitle + .2, 'intro', 1);
  // the page folding into places, and back
  [tStreet, tMill, tCity].forEach((x) => { fx(x - .1, 'page', .45); fx(x + .3, 'page', .3); });
  fx(tMill + .3, 'canopy', .3);
  for (let k = 0; k < 6; k++) fx(tCity + k * .2, 'page', .2);
  [0, 1, 2].forEach((k) => fx(tPaper + k * .35, 'page', .35));
  // one bot
  fx(B(3) - .2, 'page', .4);
  for (let k = 0; k < 5; k++) fx(tBot + k * .35, 'probe', .25);
  fx(tBot + 2.3, 'latch', .5);
  // the edges
  fx(tSpine + .1, 'paper', .5);
  fx(tPhone + .1, 'notify', .3); fx(tPhone + .9, 'click', .2); fx(tPhone + 1.3, 'click', .2); fx(tPhone + 1.9, 'notify', .25);
  // the turn
  fx(tTurn + .5, 'paper', .4); fx(tShot + 1.1, 'click', .5);
  // twice
  fx(tRewind, 'rewind', .5); fx(tLess, 'page', .45); fx(tLess + .5, 'page', .35); fx(tLess + 1, 'scribe', .35);
  // honest
  fx(tHonest, 'page', .4); fx(tHonest + .4, 'thud', .3); fx(tHonest + .9, 'latch', .4);
  // still
  [0, 1, 2, 3].forEach((k) => fx(tStill + .2 + k * .3, 'page', .3));
  fx(tEnd, 'resolve', .7); fx(tEnd + .4, 'logo', .7);
  sounds.sort((p, q) => p.t - q.t);

  const lin = (list) => (t) => {
    if (t <= list[0][0]) return list[0][1];
    for (let i = 0; i < list.length - 1; i++) if (t < list[i + 1][0]) return lerp(list[i][1], list[i + 1][1], (t - list[i][0]) / Math.max(.001, list[i + 1][0] - list[i][0]));
    return list[list.length - 1][1];
  };
  const intensity = lin(mono([[0, .7], [rt(9), .3], [B(1), .35], [B(2), .5], [tCity, .6], [B(3), .55], [B(4), .65], [B(5), .45], [B(6), .55], [B(8), .45], [T.total, .4]]));
  const audio = (t) => ({
    wind: 0, speed: 0, swarm: t > B(3) && t < B(5) ? .15 : 0, hum: t < B(1) ? .25 * (1 - ruled(0)(t)) * appUp(t) : 0,
    intensity: intensity(t),
    fade: 1 - smooth(T.total - 2.5, T.total - .2, t),
  });

  checkSounds(sounds);
  return { draw, bug, sounds, audio, score: scoreFor(T, SCORE) };
}
