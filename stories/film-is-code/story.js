/* story.js - "The Film Is the Code": a street, a depot, and a letter.

   The place (STYLE.md, "find the world"): a street of readers' houses
   folded out of the page, with a depot at the end of the road (the CDN).

   - A video play is a lorry: the whole file, as a crate the size of a room,
     driven from the depot to the door. Every play sends another. The depot
     runs hot; five smaller crates sit in its yard (the rendition ladder).
   - The platforms are towers behind the street, roped to the roofs. One
     changes its terms, one is sold, one folds flat and leaves broken boxes
     in the windows, one sends packets down its rope before anything plays.
   - The turn: the crate at the reader's door unfolds flat into its own net,
     and print rises on the paper. It was instructions all along.
   - The rhyme: the same street, the same click, the same camera. A paper bot
     carries an envelope and a small reel (the voice). The house opens like a
     doll's house, and on the table the sheet folds up into a tiny street:
     this one. The reader's browser folds the film.
   - The spine: two receipts at the right edge, video and drawn.
   - Every file comes from the depot, the same place as the article: no
     ropes out to anyone else's tower.
   - The same rule on the reader's side: the reader steps out and the film
     on the table stops where it is, the window dimming; they come back and
     it carries on, the reel turning, nothing unspooled. The house warms a
     little while it plays (not measured yet).
   - At the end the street folds back into the page.

   Built with brand/fold.js. Nothing hardcodes a moment: every build hangs
   off a {cue} (T.at) or a beat edge. */

import { clamp, lerp, smooth, easeIO, seeded, ground } from '../lib/sketch.js';
import { titleCard, signoff, reportBug, serif } from '../brand/report.js';
import { mix, shade } from '../brand/color.js';
import { scene, camera, cameraPath, rotate, place3, building, block, newsprint, shadow, along, LOOK, HOUSE_LOOK } from '../brand/fold.js';
import { bot3, track, boxM, dashed, dashedRect } from '../brand/street.js';
import { makePhone, drawReceipts } from '../brand/hud.js';
import { scoreFor, checkSounds } from '../score/sound.js';

export const W = 1280, H = 720;

export const BEATS = {
  0: { min: 9, cues: { crate: 2, envelope: 2, voice: 3.5 } },
  1: { min: 5, cues: { title: 4.8 } },
  2: { min: 16, cues: { street: 2.5, play: 1.5, lorry: 3.5, again: 2.5, meter: 1.5, rate: 2.5, half: 2, ten: 3.5 } },
  3: { min: 15, cues: { web: 2, thousand: 2.5, thirteen: 2, viral: 2.5, ladder: 2, five: 2, monthly: 3 } },
  4: { min: 22, cues: { hand: 2.5, sensible: 2, vimeo: 2.5, plan: 2, week: 2, sold: 2.5, gfycat: 2.5, broken: 2.5, youtube: 2, weight: 2.5, before: 2.5 } },
  5: { min: 7, cues: { turn: 2.5, instructions: 3 } },
  6: { min: 20, cues: { rewind: 3, letter: 3, code: 3, reel: 2.5, folds: 4, plays: 3, free: 2, cents: 3 } },
  7: { min: 16, cues: { score: 2, roll: 2.5, clock: 2.5, typo: 2.5, nothing: 2.5, own: 2.5, idle: 3.5 } },
  8: { min: 18, cues: { reader: 2, pause: 3, still: 3, stream: 2, measured: 3, phone: 2.5, battery: 3, unmeasured: 3 } },
  9: { min: 12, cues: { drawings: 2, footage: 2.5, social: 2.5, once: 2.5, there: 3 } },
  10: { min: 9, cues: { decision: 2, purpose: 2.5, end: 3.4 } },
};

/* The score: sections started by "> ♪ name" lines in script.md. */
export const SCORE = {
  key: 'F',
  sections: {
    // two things dropped on the page: low, plain, a clock-like pulse
    weight: { mode: 'minor', bpm: 64, prog: [0, 5], bars: 2, keys: .55, bells: .3, drone: .5, fade: 1 },
    // the street at dusk, the first play
    street: { mode: 'dorian', bpm: 78, prog: [0, 3, 5, 3], bars: 2, pad: .55, keys: .5, pluck: .35, drone: .35 },
    // the bill: lorries on every road
    bill: { mode: 'minor', bpm: 92, prog: [0, 5, 2, 6], bars: 1, padTone: 'strings', pad: .55, pluck: .75, bass: .6, kick: .4, hat: .35, drone: .45, fade: 1 },
    // somebody else's player: the same unease, thinner
    platform: { mode: 'phrygian', bpm: 80, prog: [0, 1, 0, 6], bars: 2, padTone: 'strings', pad: .55, pluck: .45, bass: .4, drone: .5 },
    // the rhyme, out of the turn's silence: a slow swell, lighter
    letter: { mode: 'lydian', bpm: 76, prog: [0, 1, 4, 0], bars: 2, pad: .55, keys: .5, bells: .3, pluck: .3, drone: .25, fade: 3 },
    ledger: { mode: 'major', bpm: 80, prog: [0, 3, 4, 3], bars: 2, pad: .55, keys: .5, arp: .35, bells: .25, drone: .25 },
    honest: { mode: 'dorian', bpm: 76, prog: [0, 3, 6, 4], bars: 2, pad: .6, keys: .5, bells: .2, drone: .35 },
    file: { mode: 'mixolydian', bpm: 78, prog: [0, 6, 3, 0], bars: 2, pad: .55, keys: .45, pluck: .3, drone: .3 },
    end: { mode: 'major', bpm: 66, prog: [0, 3, 4, 0], bars: 2, pad: .65, bells: .5, keys: .3, drone: .35, fade: 2.5 },
  },
};

/* ================= the place ================= */

const ROAD = { z: 380, w: 90, x0: -1100, x1: 1700 };
const HOUSES = [-760, -450, -140, 170, 480];          // the street; the reader's is the middle one
const READER = 2;
const HOME = { x: -140, z: 600, w: 200, d: 170, h: 130 };
const DEPOT = { x: 1300, z: 580, w: 460, d: 220, h: 115 };
const GATE = 1150;                                     // where lorries and couriers leave the depot
const LADDER = [1, .78, .6, .45, .33];                 // the renditions, in the depot's yard
const TOWERS = [{ x: -900, z: 1500, h: 360 }, { x: -250, z: 1500, h: 300 }, { x: 400, z: 1500, h: 420 }];
const PLATFORMS = ['Vimeo', 'Gfycat', 'YouTube'], SOCIAL = ['LinkedIn', 'X', 'YouTube'];
const ROPED = [0, 1, 2, 0, 1];                         // which tower each house's player hangs from
const TOWN = { rows: [1000, 1400, 1800], roads: [800, 1200, 1600], xs: [-900, -600, -300, 0, 300, 600, 900] };
const OPEN = { crate: [-170, -700], env: [170, -700] }; // the cold open, on the page in front of the street
const TABLE = { x: HOME.x + 30, z: HOME.z + 20, w: 84, h: 36, d: 56 };
const ROLL = { x0: -820, x1: 480, z: 230, w: 110 };
const SHEET = { x: 640, z: 230, w: 200, d: 260 };
const FILMCAM = [110, 430];
const ROUTE = [[230, 380], [760, 380], [760, 1290], [420, 1330]];

const ROOF = (P) => mix(P.stop, P.grid, .55);
const crateC = (P) => mix(P.card, P.stop, .2);
// only the depot runs hot: a reader's screen is lit, but the bill is the sender's
const cool = (fn) => { const h = LOOK.heat; LOOK.heat = 0; try { fn(); } finally { LOOK.heat = h; } };

/* ================= the folded models ================= */

/* A lorry, its cab at +x in its own frame, a crate on its bed. */
function lorry(S, P, x, z, yaw, { crate = 1, alpha = 1 } = {}) {
  if (alpha <= .01) return;
  const m = (pts) => place3(pts, { x, z, yaw }), body = mix(P.card, P.grid, .4), dark = mix(P.ink, P.grid, .3);
  for (const [wx, wz] of [[-48, -24], [-48, 24], [44, -24], [44, 24]]) boxM(S, m, [wx - 9, 0, wz - 3], [wx + 9, 17, wz + 3], dark, { alpha });
  boxM(S, m, [-74, 12, -24], [74, 22, 24], body, { alpha });
  boxM(S, m, [42, 22, -24], [74, 60, 24], body, { alpha });
  S.poly(m([[74.6, 40, -18], [74.6, 56, -18], [74.6, 56, 18], [74.6, 40, 18]]), mix(P.water, P.card, .45), { alpha, flat: true, bias: -2 });
  if (crate > .01) {
    boxM(S, m, [-72, 22, -27], [38, 22 + 76 * crate, 27], crateC(P), { alpha });
    // the crate's slats, a hair lighter than the wood
    for (const y of [.33, .66]) S.line(...m([[-72, 22 + 76 * crate * y, -27.6], [38, 22 + 76 * crate * y, -27.6]]), shade(crateC(P), -.18), { layer: 2, alpha: alpha * .8, lw: 1.2 });
  }
  if (alpha > .3) shadow(S, m([[-74, 60, -24], [74, 60, -24], [-74, 60, 24], [74, 60, 24]]), .05 * alpha);
}

/* An envelope lying flat, with its flap creased in. */
function envelope(S, P, x, y, z, { s = 1, alpha = 1, layer = 2 } = {}) {
  const w = 46 * s, d = 30 * s;
  block(S, x, y, z, w, 2 * s, d, P.card, { alpha, layer });
  const top = y + 2 * s + .3, ink = mix(P.ink, P.grid, .5);
  S.line([x - w / 2, top, z + d / 2], [x, top, z - d * .05], ink, { layer: 3, alpha: alpha * .7, lw: 1 });
  S.line([x + w / 2, top, z + d / 2], [x, top, z - d * .05], ink, { layer: 3, alpha: alpha * .7, lw: 1 });
}
/* An envelope held up, like a sign, facing along yaw's left. */
function envelopeHeld(S, P, x, y, z, yaw, { alpha = 1, s = 1 } = {}) {
  const m = (pts) => place3(pts, { x, y, z, yaw, s });
  boxM(S, m, [-14, 0, -1.5], [14, 19, 1.5], P.card, { alpha });
  const ink = mix(P.ink, P.grid, .5);
  for (const side of [-2.2, 2.2]) {
    const [a, b, c] = m([[-14, 19, side], [0, 9, side], [14, 19, side]]);
    S.line(a, b, ink, { layer: 2, alpha: alpha * .7 }); S.line(b, c, ink, { layer: 2, alpha: alpha * .7 });
  }
}
/* A reel of tape lying flat: a disc, a hub, three holes that turn with it. */
function reel(S, P, x, y, z, r, ang, { alpha = 1, layer = 2, bias = -3 } = {}) {
  if (alpha <= .01) return;
  const disc = (cx, cz, rr, n = 16) => Array.from({ length: n }, (_, i) => { const a = Math.PI * 2 * i / n; return [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr]; });
  S.poly(disc(x, z, r), mix(P.ink, P.grid, .35), { layer, flat: true, alpha, bias });
  S.poly(disc(x, z, r * .62), mix(P.coin, P.ink, .45), { layer, flat: true, alpha, bias: bias - .5 });
  for (let k = 0; k < 3; k++) {
    const a = ang + k * Math.PI * 2 / 3;
    S.poly(disc(x + Math.cos(a) * r * .38, z + Math.sin(a) * r * .38, r * .13, 6), P.card, { layer, flat: true, alpha, bias: bias - 1 });
  }
  S.poly(disc(x, z, r * .12, 6), P.card, { layer, flat: true, alpha, bias: bias - 1 });
}
/* A little house, on a table: its walls rise by f. */
function mini(S, x, y, z, s, f, wall, roof, o = {}) {
  if (f <= .01) return;
  const m = (pts) => pts.map(([px, py, pz]) => [x + px * s, y + py * s * f, z + pz * s]);
  boxM(S, m, [-6, 0, -5], [6, 9, 5], wall, o);
  S.poly(m([[-7, 9, -5.6], [7, 9, -5.6], [7, 13.5, 0], [-7, 13.5, 0]]), roof, o);
  S.poly(m([[-7, 9, 5.6], [7, 9, 5.6], [7, 13.5, 0], [-7, 13.5, 0]]), roof, o);
  S.poly(m([[-6, 9, -5], [-6, 9, 5], [-6, 13.5, 0]]), wall, o);
  S.poly(m([[6, 9, -5], [6, 9, 5], [6, 13.5, 0]]), wall, o);
}
/* A rope with a little sag, between two points. */
function rope(S, a, b, color, { sag = 30, alpha = 1, lw = 1.4, n = 9 } = {}) {
  let prev = a;
  for (let i = 1; i <= n; i++) { const p = ropeAt(a, b, i / n, sag); S.line(prev, p, color, { layer: 2, alpha, lw }); prev = p; }
}
const ropeAt = (a, b, u, sag) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u) - sag * Math.sin(Math.PI * u), lerp(a[2], b[2], u)];
/* A flag on top of a tower. */
function flag(S, x, y, z, color, f = 1) {
  if (f <= .01) return;
  S.poly([[x - 1.5, y, z], [x + 1.5, y, z], [x + 1.5, y + 60 * f, z], [x - 1.5, y + 60 * f, z]], S.P.ink, { flat: true, alpha: .75 });
  S.poly([[x, y + 60 * f, z], [x, y + 36 * f, z], [x + 40 * f, y + 48 * f, z + 3]], color);
}
/* A box drawn in dashes, standing on a wall that faces -z: what used to be there. */
function brokenBox(S, cx, cy, z, s, color, alpha) {
  const c = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [c[i], c[(i + 1) % 4]];
    for (let k = 0; k < 6; k += 2) S.line([lerp(a[0], b[0], k / 6), lerp(a[1], b[1], k / 6), z], [lerp(a[0], b[0], (k + 1) / 6), lerp(a[1], b[1], (k + 1) / 6), z], color, { layer: 3, alpha, lw: 2.6 });
  }
}

/* The reader's house: a building whose front wall can fold down onto the
   page like a doll's house, so we can see the table inside. */
function home(S, P, { fold = 1, open = 0, lit = 0, heat = 0 }) {
  if (fold <= .01) return;
  const { x, z, w, d, h } = HOME, x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, rh = d * .45, zm = z;
  const a = (1 - smooth(0, .6, fold)) * Math.PI / 2, rb = 1 - smooth(.45, 1, fold), phi = Math.atan2(zm - z0, rh);
  const hot = LOOK.heat * heat * fold, hotC = mix(P.coin, P.stop, clamp(heat * 1.2 - .2, 0, 1));
  let wall = mix(P.card, P.grid, .12), rc = ROOF(P);
  if (hot > .01) { wall = mix(wall, hotC, .32 * hot); rc = mix(rc, P.stop, .35 * hot); }
  const fa = Math.max(a, easeIO(clamp(open, 0, 1)) * Math.PI / 2 * .97);
  const front = (p) => rotate(p, [0, 0, z0], [1, 0, 0], -fa), back = (p) => rotate(p, [0, 0, z1], [1, 0, 0], a);
  const left = (p) => rotate(p, [x0, 0, 0], [0, 0, 1], a), right = (p) => rotate(p, [x1, 0, 0], [0, 0, 1], -a);
  const roofF = (p) => rotate(rotate(p, [0, h, z0], [1, 0, 0], -phi * rb), [0, 0, z0], [1, 0, 0], -a), roofB = (p) => back(rotate(p, [0, h, z1], [1, 0, 0], phi * rb));
  S.poly([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]].map(front), wall);
  S.poly([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]].map(back), wall);
  S.poly([[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h + rh, zm], [x0, h, z0]].map(left), wall);
  S.poly([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h + rh, zm], [x1, h, z0]].map(right), wall);
  S.poly([[x0 - 8, h, z0], [x1 + 8, h, z0], [x1 + 8, h + rh, zm], [x0 - 8, h + rh, zm]].map(roofF), rc, { bias: -2 });
  S.poly([[x0 - 8, h, z1], [x1 + 8, h, z1], [x1 + 8, h + rh, zm], [x0 - 8, h + rh, zm]].map(roofB), rc, { bias: -2 });
  // two windows and a door on the front wall
  const dark = mix(P.ink, P.grid, .35), lc = P.coin;
  for (const u of [.24, .76]) {
    const wx = lerp(x0, x1, u), wy = h * .58, ww = 26, wh = 30;
    S.poly([[wx - ww / 2, wy - wh / 2, z0 - .6], [wx + ww / 2, wy - wh / 2, z0 - .6], [wx + ww / 2, wy + wh / 2, z0 - .6], [wx - ww / 2, wy + wh / 2, z0 - .6]].map(front), mix(dark, lc, lit), { flat: true, bias: -4 });
    if (LOOK.glow > .01 && lit > .05 && fold > .8 && open < .2) {
      const warm = mix(lc, P.dark ? '#ffd28a' : '#f0b45a', .4);
      S.glow([wx, wy, z0 - 4], 32, warm, .55 * LOOK.glow * lit);
      S.glow([wx, 1, z0 - 50], 60, warm, .28 * LOOK.glow * lit, { layer: 1, squash: .38 });
    }
  }
  S.poly([[x - 17, 0, z0 - .6], [x + 17, 0, z0 - .6], [x + 17, 64, z0 - .6], [x - 17, 64, z0 - .6]].map(front), mix(P.ink, P.grid, .5), { flat: true, bias: -4 });
  if (hot > .05 && fold > .8) S.glow([x, h + rh + 30, zm], 110, P.stop, .22 * hot, { squash: .7 });
  if (fold > .5) shadow(S, [[x0, 0, z0], [x1, 0, z0], [x0, 0, z1], [x1, 0, z1], [x0, h + rh, zm], [x1, h + rh, zm]], .07 * smooth(.5, 1, fold));
}
const HOME_RIDGE = [HOME.x, HOME.h + HOME.d * .45, HOME.z];
const roofOf = (hx, z = 600, h = 120, d = 150) => [hx, h + d * .45, z];

export function makeStory(T) {
  Object.assign(LOOK, HOUSE_LOOK);
  const at = (n) => T.at(n), B = (n) => T.start(n), E = (n) => T.end(n);

  /* ================= the moments ================= */
  const tCrate = at('crate'), tEnvelope = at('envelope'), tVoice = at('voice'), tTitle = at('title');
  const tPlay = at('play'), tLorry = at('lorry'), tAgain = at('again'), tMeter = at('meter'), tRate = at('rate'), tHalf = at('half'), tTen = at('ten');
  const tWeb = at('web'), tThousand = at('thousand'), tThirteen = at('thirteen'), tViral = at('viral'), tLadder = at('ladder'), tFive = at('five'), tMonthly = at('monthly');
  const tHand = at('hand'), tVimeo = at('vimeo'), tPlan = at('plan'), tWeek = at('week'), tSold = at('sold'), tGfycat = at('gfycat'), tBroken = at('broken'), tYoutube = at('youtube'), tWeight = at('weight'), tBefore = at('before');
  const tTurn = at('turn'), tInstr = at('instructions');
  const tRewind = at('rewind'), tLetter = at('letter'), tCode = at('code'), tReel = at('reel'), tFolds = at('folds'), tPlays = at('plays'), tFree = at('free'), tCents = at('cents');
  const tScore = at('score'), tRoll = at('roll'), tTypo = at('typo'), tNothing = at('nothing'), tOwn = at('own'), tIdle = at('idle');
  const tReader = at('reader'), tPause = at('pause'), tStream = at('stream'), tMeasured = at('measured'), tPhone = at('phone'), tBattery = at('battery'), tUnmeasured = at('unmeasured');
  const tDrawings = at('drawings'), tFootage = at('footage'), tSocial = at('social'), tOnce = at('once'), tThere = at('there');
  const tPurpose = at('purpose'), tEnd = at('end');

  // everything folds back into the page at the end
  const endF = (t) => 1 - smooth(tPurpose + .8, tEnd + .6, t);

  /* ================= the lorries ================= */
  const DRIVE = 3.2;
  const stopAt = (i) => HOUSES[i] + 20;
  // every play sends the whole file again; the last reader leaves after ten seconds, before it arrives
  const TRIPS = [
    { t: tLorry, to: READER }, { t: tAgain + .1, to: 0 }, { t: tAgain + 1.2, to: 4 },
    { t: tMeter + .6, to: 1 }, { t: tTen - 2.2, to: 3, left: tTen + .2 },
  ];
  const tripX = (tr, t) => lerp(GATE, stopAt(tr.to), easeIO(smooth(tr.t, tr.t + DRIVE, t)));
  const tripA = (tr, t) => smooth(tr.t - .1, tr.t + .3, t) * (1 - smooth(tr.t + DRIVE + .3, tr.t + DRIVE + .9, t));
  const tripCrate = (tr, t) => 1 - smooth(tr.t + DRIVE, tr.t + DRIVE + .5, t);
  const arrived = (t) => TRIPS.reduce((n, tr) => n + smooth(tr.t + DRIVE - .2, tr.t + DRIVE + .2, t), 0);

  /* ================= the courier ================= */
  const C1 = HOME.x + 20;
  const COURIER = track([[tLetter, GATE, ROAD.z], [tFolds - .7, C1, ROAD.z], [tFolds - .2, C1, 470, C1, 600]]);
  const courierA = (t) => smooth(tLetter - .2, tLetter + .3, t) * (1 - smooth(tFolds - .3, tFolds + .1, t));
  // the reader steps out, and the film stops until they're back (it draws only while it plays)
  const SEAT = [HOME.x - 50, TABLE.z, TABLE.x, TABLE.z];
  const LEAVE = track([[tPause, ...SEAT], [tPause + 1.4, HOME.x - 50, 470], [tPause + 2.8, HOME.x - 340, 440, 0, 440],
    [tStream - 1.6, HOME.x - 340, 440], [tStream - .6, HOME.x - 50, 470], [tStream + .6, ...SEAT]]);
  const STOP = tPause + .6;   // the film on the table stops here, and starts again at {stream}
  const stopped = (t) => (t >= B(8) && t < B(9) ? smooth(STOP, STOP + .5, t) * (1 - smooth(tStream - .2, tStream + .3, t)) : 0);
  // the film's own clock: it doesn't advance while it's stopped
  const filmT = (t) => (t >= B(8) && t < B(9) ? t - (clamp(t, STOP, tStream) - STOP) : t);

  /* ================= state ================= */
  const streetF = (k) => (t) => smooth(B(2) - .2 + k * .14, B(2) + .9 + k * .14, t) * endF(t);
  const depotF = (t) => streetF(5)(t) * (1 - .88 * smooth(tIdle + .2, tIdle + 1.6, t) * (1 - smooth(B(8) - .2, B(8) + .6, t)));
  const depotLit = (t) => (t < B(5) ? .95 * smooth(B(2) + 1, B(2) + 2, t) : t < tIdle ? .2 : t < B(8) ? .2 * (1 - smooth(tIdle, tIdle + .8, t)) : .2);
  const townF = (t) => Math.max(smooth(tThousand - .3, tThousand + 1.2, t) * (1 - smooth(tLadder - .6, tLadder - .1, t)), smooth(tPlays - .3, tPlays + 1.2, t) * (1 - smooth(E(6) - .4, E(6), t)));
  const towerF = (k) => (t) => smooth(tHand + .2 + k * .3, tHand + 1.2 + k * .3, t) * (1 - smooth(E(4) - .5, E(4), t)) * (k === 1 ? 1 - smooth(tGfycat + .3, tGfycat + 1.6, t) : 1);
  const socialF = (k) => (t) => smooth(tSocial + k * .3, tSocial + 1 + k * .3, t) * (1 - smooth(E(9) - .4, E(9), t));
  const openAmt = (t) => {
    if (t >= B(10)) return 1;
    if (t >= B(8) && t < B(9)) return smooth(tReader - .6, tReader + .4, t) * (1 - smooth(E(8) - .6, E(8) - .1, t));
    if (t >= B(6) && t < B(7)) return smooth(tFolds - .4, tFolds + .6, t);
    return 0;
  };
  const miniF = (t) => smooth(tFolds + .2, tFolds + 2, t) * endF(t);
  const homeLit = (t) => {
    if (t < B(6)) return t > tPlay ? 1 : 0;
    if (t < B(8)) return smooth(tRewind + 1.2, tRewind + 1.5, t) * (1 - smooth(tIdle, tIdle + .8, t));
    return 1 - .8 * stopped(t);
  };
  const otherLit = (i, t) => {
    if (t < B(6)) {
      let v = t > B(3) ? .8 : 0;
      for (const tr of TRIPS) if (tr.to === i) v = Math.max(v, smooth(tr.t - .6, tr.t - .2, t) * (tr.left ? 1 - smooth(tr.left, tr.left + .3, t) : 1));
      return v;
    }
    return t < B(7) ? .8 * smooth(tPlays, tPlays + 1, t) : 0;
  };
  const heatAt = (t) => (t >= B(8) && t < B(9) ? smooth(tBattery, tBattery + 1.5, t) : 0);

  /* ================= the spine ================= */
  const video = (t) => .05 + .035 * arrived(t) + .42 * easeIO(smooth(tThousand, tThirteen + 1, t)) + .22 * smooth(tMonthly, tMonthly + 2.5, t);
  const drawn = (t) => .012 * smooth(tFolds - 1, tFolds, t) + .02 * smooth(tPlays + .5, tPlays + 2.5, t);
  const spineA = (t) => Math.max(smooth(B(2) + 1, B(2) + 2, t) * (1 - smooth(B(5) - .4, B(5), t)), smooth(B(6) + 1, B(6) + 2, t) * (1 - smooth(E(7) - .4, E(7), t)));

  /* ================= the world ================= */
  function world(S, t, P) {
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 0) { coldOpen(S, t, P); return; }

    newsprint(S, -1300, 90, 16, 20, { alpha: .045 });
    newsprint(S, -900, 2000, 12, 14, { alpha: .035, seed: 4 });

    // the road
    const rf = streetF(0)(t);
    if (rf > .01) {
      const z0 = ROAD.z - ROAD.w / 2, z1 = ROAD.z + ROAD.w / 2, road = mix(P.bg, P.grid, .35);
      S.poly([[ROAD.x0, .3, z0], [ROAD.x1, .3, z0], [ROAD.x1, .3, z1], [ROAD.x0, .3, z1]], road, { layer: 1, flat: true, alpha: rf });
      dashed(S, [ROAD.x0, .6, ROAD.z], [ROAD.x1, .6, ROAD.z], P.card, { alpha: .8 * rf });
    }

    // the street
    HOUSES.forEach((hx, i) => {
      if (i === READER) home(S, P, { fold: streetF(i)(t), open: openAmt(t), lit: homeLit(t), heat: heatAt(t) });
      else cool(() => building(S, { x: hx, z: 600, w: 180, d: 150, h: 120, fold: streetF(i)(t), windows: [[.25, .58], [.75, .58]], lit: otherLit(i, t), roofColor: ROOF(P) }));
    });
    // the depot: a long folded hall with a wide door
    const df = depotF(t);
    building(S, { x: DEPOT.x, z: DEPOT.z, w: DEPOT.w, d: DEPOT.d, h: DEPOT.h, roof: .22, fold: df, windows: [[.08, .75], [.92, .75]], lit: depotLit(t), roofColor: mix(P.ink, P.grid, .35) });
    if (df > .95) {
      const z0 = DEPOT.z - DEPOT.d / 2 - .7;
      for (const dx of [-150, 0, 150]) S.poly([[DEPOT.x + dx - 45, 0, z0], [DEPOT.x + dx + 45, 0, z0], [DEPOT.x + dx + 45, 80, z0], [DEPOT.x + dx - 45, 80, z0]], mix(P.ink, P.grid, .45), { flat: true, bias: -4 });
    }

    // the ladder of renditions in the yard
    if (t > tFive - .5 && t < B(5)) {
      let x = 1460;
      LADDER.forEach((s, k) => {
        const w = 120 * s, cx = x + w / 2, f = smooth(tFive + k * .25, tFive + .8 + k * .25, t);
        x += w + 26;
        if (f <= .01) return;
        building(S, { x: cx, z: 250, w, d: 90 * s, h: 82 * s, roof: .02, fold: f, color: crateC(P), roofColor: crateC(P) });
        const st = smooth(tMonthly + k * .3, tMonthly + .25 + k * .3, t);
        if (st > .01 && f > .95) {
          const z0 = 250 - 45 * s - .8, y = 41 * s, r = 16 * s;
          S.poly([[cx - r, y - r * .7, z0], [cx + r, y - r * .7, z0], [cx + r, y + r * .7, z0], [cx - r, y + r * .7, z0]], P.stop, { flat: true, bias: -4, alpha: st });
        }
      });
    }

    // the lorries on the street
    if (t > B(2) && t < B(5)) for (const tr of TRIPS) {
      const a = tripA(tr, t);
      if (a > .01) lorry(S, P, tripX(tr, t), ROAD.z, Math.PI, { crate: tripCrate(tr, t), alpha: a });
    }

    // the town, when the camera rises: a lorry, or a courier, on every road
    const tf = townF(t);
    if (tf > .01) {
      TOWN.rows.forEach((z, r) => TOWN.xs.forEach((x, c) => cool(() => building(S, { x, z, w: 170, d: 140, h: 110, fold: smooth(r * .12 + c * .03, r * .12 + c * .03 + .6, tf), windows: [[.25, .58], [.75, .58]], lit: .7, roofColor: ROOF(P) }))));
      const courier = t > B(6);
      [ROAD.z, ...TOWN.roads].forEach((z, r) => {
        if (z !== ROAD.z) {
          const z0 = z - 40, z1 = z + 40;
          S.poly([[-1100, .3, z0], [1100, .3, z0], [1100, .3, z1], [-1100, .3, z1]], mix(P.bg, P.grid, .35), { layer: 1, flat: true, alpha: tf });
        }
        for (let k = 0; k < 4; k++) {
          const span = 2600, v = courier ? 150 : 260, x = 1250 - (((t * v + k * 650 + r * 230) % span) + span) % span;
          if (x < -1100) continue;
          if (courier) { bot3(S, P, x, z, Math.PI, { reach: .45, walk: 1, t, ph: k + r, alpha: tf }); envelopeHeld(S, P, x - 30, 14, z, Math.PI, { alpha: tf }); }
          else lorry(S, P, x, z, Math.PI, { alpha: tf });
        }
      });
    }

    // the platforms: towers behind the street, a rope from each roof
    if (t > tHand && t < B(5)) {
      TOWERS.forEach((tw, k) => {
        const f = towerF(k)(t), th = tw.h - (k === 0 ? 60 * smooth(tSold + .6, tSold + 1.8, t) : 0);
        if (f > .01) cool(() => building(S, { x: tw.x, z: tw.z, w: 150, d: 150, h: th, roof: .5, fold: f, windows: [[.3, .35], [.7, .35], [.3, .7], [.7, .7]], lit: .55, roofColor: mix(P.ink, P.grid, .3) }));
        if (k === 0 && f > .9) {
          // Vimeo's flag: blue, then red (the new plan), then lowered and replaced (sold)
          const sold = smooth(tSold, tSold + .5, t), up = Math.abs(sold - .5) * 2;
          const c = sold > .5 ? P.coin : mix(P.water, P.stop, smooth(tPlan, tPlan + .4, t));
          flag(S, tw.x, th + 75, tw.z, c, up);
        }
      });
      const ra = smooth(tHand + 1, tHand + 2, t);
      HOUSES.forEach((hx, i) => {
        const k = ROPED[i], tw = TOWERS[k], top = [tw.x, tw.h + 40, tw.z], roof = i === READER ? HOME_RIDGE : roofOf(hx);
        if (k === 1) {
          const gone = smooth(tGfycat + .3, tGfycat + 1.2, t);
          if (gone < .99) rope(S, roof, top, mix(P.ink, P.grid, .3), { alpha: ra * (1 - gone) });
          if (gone > .01) dashed(S, [roof[0], .5, roof[2] + 80], [tw.x, .5, tw.z - 80], P.muted, { alpha: gone * ra });
          const bx = smooth(tBroken, tBroken + .6, t);
          if (bx > .01) for (const u of [.25, .75]) brokenBox(S, lerp(hx - 90, hx + 90, u), 70, 524, 22, P.stop, bx);
        } else rope(S, roof, top, mix(P.ink, P.grid, .3), { alpha: ra });
      });
      // YouTube's player arrives before anyone presses play: 32 little packets down the rope
      if (t > tWeight - .2) {
        const top = [TOWERS[2].x, TOWERS[2].h + 40, TOWERS[2].z];
        for (let k = 0; k < 32; k++) {
          const s = tWeight + k * .07, u = smooth(s, s + 1.4, t);
          if (u <= 0 || u >= 1) continue;
          const p = ropeAt(top, HOME_RIDGE, u, 30);
          block(S, p[0], p[1] - 4, p[2], 9, 8, 9, P.card);
        }
      }
    }

    // the turn: the crate at the reader's door unfolds flat, and it's paper
    if (t >= B(5) && t < B(6)) {
      const f = 1 - smooth(tTurn + .5, tTurn + 2.2, t), cz = 440, w = 110, d = 80, h = 75;
      building(S, { x: HOME.x, z: cz, w, d, h, roof: .02, fold: f, color: crateC(P), roofColor: crateC(P) });
      const pr = smooth(tInstr + .2, tInstr + 1.6, t);
      if (pr > .01) {
        const r = seeded(77), ink = mix(P.ink, P.grid, .2);
        const row = (x0, x1, z) => { for (let x = x0 + 6; x < x1 - 8;) { const l = 8 + r() * 22; S.line([x, 1, z], [Math.min(x1 - 6, x + l), 1, z], ink, { layer: 3, alpha: pr * .7, lw: 2 }); x += l + 5; } };
        for (let z = cz - d / 2 - h + 10; z < cz + d / 2 + h - 8; z += 11) row(HOME.x - w / 2, HOME.x + w / 2, z);
        for (let z = cz - d / 2 + 8; z < cz + d / 2 - 6; z += 11) { row(HOME.x - w / 2 - h, HOME.x - w / 2, z); row(HOME.x + w / 2, HOME.x + w / 2 + h, z); }
      }
    }

    // the rhyme: a courier with a letter and a reel
    const ca = courierA(t);
    if (t > B(6) && t < B(7) && ca > .01) {
      const p = COURIER(t);
      bot3(S, P, p.x, p.z, p.yaw, { reach: .45, walk: p.walk, t, alpha: ca });
      const hx = p.x + Math.cos(p.yaw) * 30, hz = p.z + Math.sin(p.yaw) * 30;
      envelopeHeld(S, P, hx, 14, hz, p.yaw, { alpha: ca });
      reel(S, P, p.x - Math.cos(p.yaw) * 4, 50, p.z - 16, 8, 0, { alpha: ca, layer: 2, bias: -5 });
    }

    // inside: the table, the film folding up on it, the reader watching
    const op = openAmt(t);
    if (op > .3 && t > tFolds) inside(S, t, P, op);

    // the ledger: the score as a punched roll, the script with one line fixed
    if (n === 7) { roll(S, t, P); sheet(S, t, P); }

    // when to ship the file: a camera on a tripod, a crate, one lorry, once
    if (n === 9) {
      const cf = smooth(tFootage - .3, tFootage + .6, t), [cx, cz] = FILMCAM;
      if (cf > .01) {
        const legs = mix(P.ink, P.grid, .3), top = [cx, 78 * cf, cz];
        for (const [dx, dz] of [[-22, -14], [22, -14], [0, 22]]) S.line([cx + dx, 0, cz + dz], top, legs, { layer: 2, lw: 2.2 });
        block(S, cx + 6, 78 * cf, cz, 44, 30 * cf, 28, mix(P.ink, P.grid, .45));
        block(S, cx - 28, 84 * cf, cz, 24, 18 * cf, 18, mix(P.ink, P.grid, .3));
        block(S, cx + 18, 108 * cf, cz, 8, 8 * cf, 8, P.stop, { flat: true });
      }
      bot3(S, P, -40, 430, 0, { t, alpha: smooth(B(9), B(9) + .5, t) });
      // the recording is a file: a crate folds up beside the camera, and goes once
      const crF = smooth(tFootage + 1, tFootage + 2, t), loaded = tOnce + .4;
      if (crF > .01 && t < loaded) building(S, { x: 230, z: 470, w: 90, d: 70, h: 62, roof: .02, fold: crF, color: crateC(P), roofColor: crateC(P) });
      if (t > tOnce) {
        const u = easeIO(smooth(tOnce + .5, tThere, t)), p = along(ROUTE, u);
        lorry(S, P, p.x, p.z, p.yaw, { crate: t > loaded ? 1 : 0, alpha: smooth(tOnce, tOnce + .4, t) * (1 - smooth(tThere + .4, tThere + 1, t)) });
        if (t > tThere + .3) block(S, 420, 0, 1340, 80, 56, 60, crateC(P), { alpha: smooth(tThere + .3, tThere + .8, t) });
      }
      TOWERS.forEach((tw, k) => {
        const f = socialF(k)(t);
        if (f > .01) cool(() => building(S, { x: tw.x, z: tw.z, w: 150, d: 150, h: tw.h, roof: .5, fold: f, windows: [[.3, .35], [.7, .35], [.3, .7], [.7, .7]], lit: .55, roofColor: mix(P.ink, P.grid, .3) }));
      });
    }
  }

  function coldOpen(S, t, P) {
    newsprint(S, -620, -880, 8, 22, { alpha: .05 });
    const [cx, cz] = OPEN.crate, [ex, ez] = OPEN.env;
    const fall = smooth(tCrate, tCrate + .5, t), y = 340 * (1 - fall * fall);
    if (t > tCrate) {
      block(S, cx, y, cz, 240, 170, 180, crateC(P));
      for (const k of [.33, .66]) S.line([cx - 120, y + 170 * k, cz - 90.6], [cx + 120, y + 170 * k, cz - 90.6], shade(crateC(P), -.18), { layer: 2, lw: 1.4 });
      if (fall > .9) shadow(S, [[cx - 120, 170, cz - 90], [cx + 120, 170, cz - 90], [cx - 120, 170, cz + 90], [cx + 120, 170, cz + 90]], .08);
    }
    if (t > tEnvelope) {
      const u = smooth(tEnvelope, tEnvelope + 1.2, t), ey = 1 + 220 * (1 - u), sway = Math.sin(u * 7) * 30 * (1 - u);
      envelope(S, P, ex + sway, ey, ez, { s: 1.2, layer: u > .98 ? 1 : 2 });
    }
    const ru = smooth(tVoice + .1, tVoice + 1, t);
    if (ru > .01) reel(S, P, ex + 20 + 70 * easeIO(ru), 1.4, ez + 6, 22, t * 2.2, { layer: 1, bias: -2 });
  }

  function inside(S, t, P, op) {
    const ea = smooth(.3, .7, op) * endF(t), wood = mix(P.coin, P.card, .45);
    if (ea <= .01) return;
    block(S, TABLE.x, 0, TABLE.z, TABLE.w, TABLE.h, TABLE.d, wood, { alpha: ea });
    // the letter, opened out on the table, and the little street it folds into
    const top = TABLE.h + .4;
    S.poly([[TABLE.x - 32, top, TABLE.z - 20], [TABLE.x + 26, top, TABLE.z - 20], [TABLE.x + 26, top, TABLE.z + 6], [TABLE.x - 32, top, TABLE.z + 6]], P.card, { flat: true, alpha: ea, bias: -2 });
    const mf = miniF(t);
    [-22, -2, 18].forEach((dx, k) => mini(S, TABLE.x + dx, top + .2, TABLE.z - 8, 1.25, smooth(k * .2, .5 + k * .2, mf), mix(P.card, P.grid, .12), ROOF(P), { alpha: ea }));
    // something moves through the little street while the film plays
    // (on the film's own clock, so it stands still while it's stopped)
    const ft = filmT(t);
    if (mf > .9) { const u = (ft * .22) % 1; block(S, TABLE.x - 30 + u * 54, top + .5, TABLE.z - 17, 4, 3, 3, P.stop, { alpha: ea, flat: true }); }
    reel(S, P, TABLE.x + 22, top + .5, TABLE.z + 16, 9, ft * 2, { alpha: ea, bias: -4 });
    // the reader, watching, unless they've stepped out
    const out = t >= B(8) && t < B(9) && t > tPause && t < tStream + .6;
    if (out) {
      const p = LEAVE(t), a = Math.max(1 - smooth(tPause + 2.6, tPause + 3.2, t), smooth(tStream - 1.8, tStream - 1.2, t));
      bot3(S, P, p.x, p.z, p.yaw, { walk: p.walk, t, s: .85, alpha: a * ea });
    } else bot3(S, P, HOME.x - 50, TABLE.z, 0, { t, s: .85, alpha: ea });
  }

  function roll(S, t, P) {
    const z0 = ROLL.z - ROLL.w / 2, z1 = ROLL.z + ROLL.w / 2, f = smooth(B(7) - .2, B(7) + .8, t);
    if (f <= .01) return;
    const x1 = lerp(ROLL.x0, ROLL.x1, easeIO(f));
    const paper = mix(P.card, P.coin, .28);
    S.poly([[ROLL.x0, .4, z0], [x1, .4, z0], [x1, .4, z1], [ROLL.x0, .4, z1]], paper, { layer: 1, flat: true });
    for (const z of [z0, z1]) S.line([ROLL.x0, .6, z], [x1, .6, z], shade(paper, -.25), { layer: 1, lw: 1.2 });
    // the punched holes: a few lanes of notes, scrolling past the read bar as the score plays
    const bar = HOME.x, phase = (t - B(7)) * 55, r = seeded(31), lane = (k) => z0 + 12 + k * ((ROLL.w - 24) / 7);
    const notes = [];
    for (let k = 0; k < 90; k++) { const s = k * 30; for (const l of [0, 2, 4, 7]) if (r() < (l === 0 ? .7 : .35)) notes.push([s + r() * 6, l]); }
    for (const [s, l] of notes) {
      const x = ROLL.x1 - ((s + phase) % 2700) + 400;
      if (x < ROLL.x0 + 8 || x > x1 - 8) continue;
      const hot = smooth(18, 0, Math.abs(x - bar));
      S.poly([[x - 9, .8, lane(l) - 4], [x + 9, .8, lane(l) - 4], [x + 9, .8, lane(l) + 4], [x - 9, .8, lane(l) + 4]], mix(mix(P.ink, P.grid, .3), P.stop, hot), { layer: 1, flat: true, bias: -1 });
    }
    S.line([bar, 1.2, z0 - 14], [bar, 1.2, z1 + 14], P.ink, { layer: 3, lw: 2.2, alpha: f });
  }

  function sheet(S, t, P) {
    const f = smooth(tTypo - 1.4, tTypo - .4, t);
    if (f <= .01) return;
    const { x, z, w, d } = SHEET, x0 = x - w / 2, z0 = z - d / 2;
    const paper = mix(P.card, P.coin, .14), corners = [[x0, .6, z0], [x0 + w, .6, z0], [x0 + w, .6, z0 + d], [x0, .6, z0 + d]];
    S.poly(corners.map(([a, , c]) => [a, .5, c]), paper, { layer: 1, flat: true, alpha: f });
    corners.forEach((c, i) => S.line(c, corners[(i + 1) % 4], shade(paper, -.25), { layer: 1, lw: 1.2, alpha: f }));
    const r = seeded(12), ink = mix(P.ink, P.grid, .2), FIX = 7;
    for (let k = 0; k < 17; k++) {
      const lz = z0 + d - 18 - k * 14, end = x0 + w - 16 - (k % 5 === 4 ? 70 : r() * 20);
      if (k === FIX) {
        const strike = smooth(tTypo + .3, tTypo + .8, t), redo = smooth(tTypo + 1, tTypo + 1.8, t);
        S.line([x0 + 16, 1, lz], [lerp(x0 + 16, end, 1 - redo), 1, lz], mix(ink, P.stop, strike), { layer: 3, lw: 2.4, alpha: f });
        if (redo > .01) S.line([x0 + 16, 1, lz], [lerp(x0 + 16, end, redo), 1, lz], ink, { layer: 3, lw: 2.4, alpha: f });
        if (strike > .01 && redo < 1) S.line([x0 + 10, 1.4, lz - 4], [lerp(x0 + 10, end + 6, strike), 1.4, lz + 4], P.stop, { layer: 3, lw: 1.8, alpha: f * (1 - redo) });
      } else S.line([x0 + 16, 1, lz], [end, 1, lz], ink, { layer: 3, lw: 2.4, alpha: f * .75 });
    }
    // what a fix to a video would mean: five renditions, re-rendered. None are.
    const g = smooth(tNothing, tNothing + .8, t);
    if (g > .01) {
      let cx = x + w / 2 + 60;
      LADDER.forEach((s) => { const cw = 120 * s, cd = 90 * s; dashedRect(S, cx, z - cd / 2, cx + cw, z + cd / 2, P.muted, { alpha: g }); cx += cw + 24; });
    }
  }

  /* ================= the camera ================= */
  // the lorry and the courier, each followed down the road from just ahead of them
  const fposL = (x) => [x - 240, 240, 110], flookL = (x) => [x + 60, 40, 420];
  const fposC = (x) => [x - 150, 150, 210], flookC = (x) => [x + 30, 30, 400];
  const STREET_WIDE = [[-700, 650, -600], [300, 40, 700]], WINDOW = [[-140, 230, 60], [-140, 90, 520]];
  const TABLE_CAM = [[-80, 125, 395], [-110, 40, 615]], HIGH = [[0, 1500, -900], [0, 0, 1000]];
  const S0 = stopAt(READER);
  const keys = [
    [0, [0, 340, -1260], [0, 70, -700]],
    [E(0) - .01, [0, 300, -1150], [0, 60, -700]],
    // the street unfolds; one window lights; the lorry, followed down the road
    [B(2), ...STREET_WIDE],
    [tPlay - .3, ...WINDOW],
    [tLorry, fposL(GATE), flookL(GATE)],
    [tLorry + DRIVE, fposL(S0), flookL(S0)],
    [tAgain + 1.4, [300, 620, -560], [300, 40, 480]],
    [tMeter + .3, [930, 360, -80], [1300, 70, 500]],
    [tRate + 1.6, [920, 360, -60], [1300, 70, 500]],
    [tHalf + .2, [260, 340, -140], [240, 60, 500]],
    // a thousand plays: up over the town; then the yard
    [tThousand + .3, ...HIGH],
    [tViral + 1, [100, 1650, -1050], [0, 0, 1000]],
    [tLadder + .2, [1420, 330, -150], [1760, 30, 260]],
    [E(3) - .4, [1440, 320, -140], [1760, 30, 260]],
    // the towers behind the street
    [B(4) + 1, [-150, 760, -600], [-200, 200, 1300]],
    [tVimeo, [-700, 520, 650], [-900, 260, 1500]],
    [tGfycat, [-260, 560, 620], [-280, 150, 1500]],
    [tBroken + .1, [-450, 380, -150], [-450, 110, 600]],
    [tYoutube + .2, [260, 820, 80], [60, 150, 1100]],
    [E(4) - .01, [230, 780, 140], [40, 150, 1100]],
    // the turn: the crate at the door
    [B(5), [-140, 215, 170], [-140, 30, 440]],
    [E(5) - .01, [-140, 245, 150], [-140, 20, 440]],
    // the rhyme: the same street, the same click, the same camera
    [B(6), ...STREET_WIDE],
    [tRewind + 1, ...WINDOW],
    [tLetter, fposC(GATE), flookC(GATE)],
    [tFolds - .7, fposC(C1), flookC(C1)],
    [tFolds + .2, [-120, 175, 250], [-120, 70, 560]],
    [tFolds + 1.8, ...TABLE_CAM],
    [tPlays - .2, ...TABLE_CAM],
    [tPlays + 1.2, ...HIGH],
    [E(6) - .01, [100, 1650, -1050], [0, 0, 1000]],
    // instructions: the roll, the sheet, then the depot folding down
    [B(7), [-140, 420, -140], [-140, 0, 270]],
    [tTypo - .4, [-100, 420, -130], [-100, 0, 270]],
    [tTypo + .5, [880, 440, -170], [900, 0, 250]],
    [tOwn - .2, [900, 440, -150], [900, 0, 250]],
    [tOwn + 1.2, [100, 1100, -1100], [300, 0, 600]],
    [E(7) - .01, [100, 1150, -1150], [300, 0, 600]],
    // the honest part
    [B(8), [-140, 560, -300], [-170, 40, 620]],
    [tBattery - .2, [-120, 560, -290], [-150, 40, 620]],
    [tBattery + .6, [-140, 250, 120], [-140, 90, 560]],
    [E(8) - .01, [-140, 250, 110], [-140, 90, 560]],
    // the file, once
    [B(9), [-20, 230, 120], [40, 60, 440]],
    [tSocial - .2, [0, 240, 100], [40, 60, 440]],
    [tSocial + 1, [250, 760, -650], [0, 60, 900]],
    [E(9) - .01, [300, 820, -700], [0, 60, 900]],
    // the line: the table, then up and away as it all folds down
    [B(10), ...TABLE_CAM],
    [tPurpose + .4, [-80, 132, 380], [-110, 40, 615]],
    [tEnd + 3, [0, 1700, -600], [0, 0, 700]],
  ];
  keys.forEach((k, i) => { if (i && k[0] < keys[i - 1][0]) throw new Error(`film-is-code: camera key ${i} (t=${k[0].toFixed(2)}) comes before key ${i - 1} (t=${keys[i - 1][0].toFixed(2)}); a beat is too short for its moves`); });
  const PATH = cameraPath(keys);
  const CAM = (t) => {
    if (t > tLorry && t < tLorry + DRIVE) { const x = tripX(TRIPS[0], t); return camera(fposL(x), flookL(x)); }
    if (t > tLetter && t < tFolds - .7) { const x = COURIER(t).x; return camera(fposC(x), flookC(x)); }
    return PATH(t);
  };

  /* ================= labels ================= */
  function tag(g, cam, p, s, size, color, alpha, o = {}) {
    if (alpha <= .01) return;
    const q = cam.project(p);
    if (q) serif(g, s, q[0], q[1], size, color, { weight: 400, base: 'middle', align: 'center', alpha, ...o });
  }
  function labels(g, t, P, cam) {
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 0) {
      tag(g, cam, [OPEN.crate[0], -20, OPEN.crate[1] - 90], '83 MB', 40, P.stop, smooth(tCrate + .6, tCrate + 1, t), { weight: 700 });
      tag(g, cam, [OPEN.env[0], -20, OPEN.env[1] - 30], '1.3 MB', 40, P.ink, smooth(tEnvelope + 1.1, tEnvelope + 1.5, t), { weight: 700 });
      tag(g, cam, [OPEN.env[0] + 90, 30, OPEN.env[1] + 6], 'voice', 20, P.text, smooth(tVoice + .8, tVoice + 1.2, t), { italic: true });
    }
    if (n === 2) tag(g, cam, [DEPOT.x, DEPOT.h + 110, DEPOT.z - DEPOT.d / 2], 'CDN', 22, P.ink, smooth(tMeter, tMeter + .5, t), { italic: true });
    if (n === 4) TOWERS.forEach((tw, k) => {
      const a = smooth(tHand + 1 + k * .3, tHand + 1.5 + k * .3, t) * (k === 1 ? 1 - smooth(tGfycat + .8, tGfycat + 1.4, t) : 1);
      tag(g, cam, [tw.x, (tw.h + 160) * towerF(k)(t), tw.z - 75], PLATFORMS[k], 21, P.ink, a, { weight: 700 });
    });
    if (n === 8) {
      tag(g, cam, [HOME.x + 175, HOME.h + 30, HOME.z - HOME.d / 2 - 30], 'not measured yet', 22, P.ink, smooth(tUnmeasured, tUnmeasured + .5, t), { italic: true });
    }
    if (n === 9) TOWERS.forEach((tw, k) => tag(g, cam, [tw.x, tw.h + 160, tw.z - 75], SOCIAL[k], 21, P.ink, smooth(.7, 1, socialF(k)(t)), { weight: 700 }));
  }

  /* ================= the phone ================= */
  const count = (v, t0, d = 1.4, fmt = (x) => Math.round(x).toLocaleString('en-US')) => (t) => fmt(v * easeIO(smooth(t0, t0 + d, t)));
  const FEED = [
    { t: tRate, kind: 'stat', v: () => '$0.085', label: 'per GB delivered in North America, past the free terabyte', src: 'Amazon CloudFront pricing', c: 'stop' },
    { t: tTen + .4, kind: 'note', text: 'the whole file, whether they watch or not' },
    { t: tWeb, kind: 'stat', v: () => '83 MB', label: 'this film, exported as an MP4', src: 'our story kit', c: 'ink' },
    { t: tThousand + .2, kind: 'stat', v: count(83, tThousand + .3, 1.2, (x) => `${Math.round(x)} GB`), label: 'a thousand full plays', src: 'our arithmetic', c: 'stop' },
    { t: tThirteen, kind: 'stat', v: () => '$7', label: 'past the free tier, at list price', src: 'Amazon CloudFront pricing', c: 'stop' },
    { t: tFive + .3, kind: 'note', text: 'five renditions, billed every month' },
    { t: tVimeo + .2, kind: 'stat', v: () => '$200', label: 'a year: what one illustrator paid Vimeo', src: 'YMCinema, March 2022', c: 'ink' },
    { t: tPlan, kind: 'stat', v: () => '$3,500', label: 'a year: the plan Vimeo offered her', src: 'YMCinema, March 2022', c: 'stop' },
    { t: tWeek, kind: 'note', text: 'a week to decide' },
    { t: tSold + .2, kind: 'stat', v: () => '$1.38B', label: 'Bending Spoons buys Vimeo, November 2025', src: 'heise online', c: 'ink', small: true },
    { t: tGfycat + .3, kind: 'note', text: 'Gfycat shut down, 1 September 2023' },
    { t: tWeight, kind: 'stat', v: () => '1.3 MB', label: '32 requests, before anyone presses play', src: 'Chris Coyier, 2024', c: 'stop' },
    { t: tCode + .3, kind: 'stat', v: () => '~150 KB', label: 'drawing code, music engine, scenes and script, compressed', src: 'measured from our kit', c: 'ink' },
    { t: tReel + .3, kind: 'stat', v: () => '1.1 MB', label: 'the voiceover, the only recording', src: 'measured from our kit', c: 'ink' },
    { t: tPlays + .2, kind: 'stat', v: count(1.3, tPlays + .3, 1, (x) => `${x.toFixed(1)} GB`), label: 'a thousand full plays', src: 'our arithmetic', c: 'ok' },
    { t: tFree, kind: 'note', text: "inside CloudFront's free terabyte" },
    { t: tCents, kind: 'stat', v: () => '$0.11', label: 'at list price', src: 'Amazon CloudFront pricing', c: 'ok' },
    { t: tRoll + .2, kind: 'note', text: 'the score: a key, a tempo, chords' },
    { t: tTypo + .3, kind: 'note', text: 'one line of script.md' },
    { t: tOwn + .3, kind: 'note', text: "music engine and script from scale-to-zero.com; type from the reader's own machine" },
    { t: tPause + 1, kind: 'stat', v: () => '0', label: 'frames drawn while it is paused', src: 'our player', c: 'ok' },
    { t: tMeasured + .2, kind: 'note', text: "the voice's loudness and speech, measured once, a few kilobytes in voiceover.json" },
    { t: tPhone + .2, kind: 'stat', v: () => '0 MB', label: "of the voice unpacked on the reader's phone: it streams", src: 'our player', c: 'ok' },
  ];
  const QUIET = [[0, B(2) + .3], [B(5) - .4, B(6) + .3], [tBattery - .4, B(9)], [tEnd - .6, 1e9]];
  const PHONE = makePhone({ feed: FEED, quiet: QUIET });

  /* ================= the scenes ================= */
  function sceneWorld(g, t, P) {
    ground(g, P);
    const cam = CAM(t), S = scene(cam, P);
    world(S, t, P);
    S.flush(g);
    labels(g, t, P, cam);
    const a = spineA(t);
    if (a > .01) drawReceipts(g, P, a, [{ x: 1150, k: video(t), color: P.stop, name: 'video' }, { x: 1218, k: drawn(t), color: P.ink, name: 'drawn' }]);
    PHONE.draw(g, t, P);
  }
  function scene1(g, t, P) {
    ground(g, P);
    titleCard(g, t, tTitle, P, { headline: 'The Film Is the Code', dek: "Why our films don't ship as video.", dateline: 'From the Report, October 2026' }, smooth(B(2) - .7, B(2) - .1, t));
  }
  function scene10(g, t, P) {
    sceneWorld(g, t, P);
    const sa = smooth(tEnd + .4, tEnd + 1.4, t);
    if (sa > .01) { g.save(); g.globalAlpha = sa * .75; ground(g, P); g.restore(); signoff(g, W / 2, 290, P, sa); }
  }
  function draw(g, t, P) {
    const n = T.beats[T.beatIndexAt(t)].n;
    if (n === 1) scene1(g, t, P);
    else if (n === 10) scene10(g, t, P);
    else sceneWorld(g, t, P);
    reportBug(g, P, smooth(B(2) + .4, B(2) + 1.4, t) * (1 - smooth(tEnd, tEnd + .5, t)));
    let d = 0;
    for (const k of [1, 2, 5, 6, 7, 8, 9, 10]) { const s = B(k); d = Math.max(d, t < s ? smooth(s - .3, s, t) : 1 - smooth(s, s + .3, t)); }
    if (d > .001) { g.save(); g.globalAlpha = clamp(d, 0, 1); ground(g, P); g.restore(); }
  }
  const bug = () => 0;

  /* ================= sound ================= */
  const sounds = [];
  const fx = (t, kind, v = 1) => sounds.push({ t, kind, v });
  fx(tCrate + .5, 'thud', .85);
  fx(tEnvelope + 1.15, 'paper', .5);
  fx(tVoice + .2, 'latch', .3);
  fx(tTitle + .2, 'intro', 1);
  [0, 1, 2, 3, 4, 5].forEach((k) => fx(B(2) + .1 + k * .14, 'page', .3));
  fx(tPlay, 'click', .6);
  TRIPS.forEach((tr) => { fx(tr.t + .1, 'latch', .25); fx(tr.t + DRIVE, 'thud', .35); });
  fx(tTen + .2, 'click', .4);
  fx(tRate, 'kaching', .4);
  [0, 1, 2].forEach((k) => fx(tThousand + .1 + k * .2, 'page', .35));
  fx(tThirteen, 'kaching', .55);
  LADDER.forEach((_, k) => { fx(tFive + k * .25, 'page', .3); fx(tMonthly + k * .3, 'stamp', .35); });
  [0, 1, 2].forEach((k) => fx(tHand + .2 + k * .3, 'page', .35));
  fx(tPlan, 'notify', .5);
  fx(tSold + .5, 'stamp', .5);
  fx(tGfycat + .3, 'powerDown', .5); fx(tGfycat + .6, 'page', .4);
  fx(tBroken + .1, 'reject', .4);
  for (let k = 0; k < 32; k += 4) fx(tWeight + k * .07 + 1.4, 'tick', .2);
  fx(tTurn + .6, 'paper', .6); fx(tTurn + 1.6, 'page', .45);
  fx(tInstr + .2, 'scribe', .5);
  fx(tRewind + 1.2, 'click', .6);
  fx(tLetter + .2, 'paper', .4);
  fx(tFolds - .4, 'page', .5);
  [0, 1, 2].forEach((k) => fx(tFolds + .4 + k * .4, 'page', .25));
  [0, 1, 2].forEach((k) => fx(tPlays + .1 + k * .2, 'page', .3));
  fx(tCents, 'clink', .45);
  fx(tTypo + .3, 'scribe', .4); fx(tTypo + 1, 'scribe', .35);
  fx(tIdle + .3, 'powerDown', .4); fx(tIdle + .6, 'page', .4);
  fx(tReader - .6, 'page', .4);
  fx(tStream - .1, 'click', .4);
  fx(tBattery + .3, 'hit', .3);
  fx(tFootage, 'click', .45); fx(tFootage + 1, 'page', .35);
  [0, 1, 2].forEach((k) => fx(tSocial + k * .3, 'page', .3));
  fx(tOnce + .4, 'latch', .4); fx(tThere, 'thud', .4);
  [0, 1, 2, 3, 4].forEach((k) => fx(tPurpose + .9 + k * .14, 'page', .35));
  fx(tEnd + .5, 'resolve', .7); fx(tEnd + 1.2, 'logo', .7);
  sounds.sort((p, q) => p.t - q.t);

  const lin = (list) => (t) => {
    if (t <= list[0][0]) return list[0][1];
    for (let i = 0; i < list.length - 1; i++) if (t < list[i + 1][0]) return lerp(list[i][1], list[i + 1][1], (t - list[i][0]) / Math.max(.001, list[i + 1][0] - list[i][0]));
    return list[list.length - 1][1];
  };
  const intensity = lin([[0, .45], [B(2), .45], [tLorry, .6], [B(3), .65], [tThirteen, .8], [B(4), .6], [tBroken, .7], [B(5), .5], [B(6), .45], [B(8), .5], [T.total, .4]]);
  const audio = (t) => ({
    wind: 0, speed: 0, swarm: 0, tick: 0,
    // the depot hums while it ships crates; it barely does with letters
    hum: t > B(2) && t < B(5) ? .26 * smooth(B(2) + 1, B(2) + 2, t) : t > B(6) && t < tIdle ? .08 : 0,
    intensity: intensity(t),
    riser: smooth(tWeight, B(5) - .05, t) * (t < B(5) ? .5 : 0),
    fade: 1 - smooth(T.total - 2.5, T.total - .2, t),
  });

  checkSounds(sounds);
  return { draw, bug, sounds, audio, score: scoreFor(T, SCORE) };
}
