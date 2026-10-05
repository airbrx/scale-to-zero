/* street.js - the folded-paper cast the Report's films share (STYLE.md,
   "a starter vocabulary"): the paper bot and the tracks it walks, marks
   that sit on a wall without painting over what stands in front of it, a
   swinging door, dashed outlines on the page, the printed house front with
   a door cut into it, and mist.

   Everything is drawn through a brand/fold.js scene S and reads colour from
   P, so dark mode works; everything is a pure function of its inputs. */

import { clamp, lerp, smooth, easeIO, seeded } from '../lib/sketch.js';
import { mix, shade, rgb } from './color.js';
import { rotate, place3, shadow } from './fold.js';

export const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/* A box in a model's own frame, through m (place3, or any fold). */
export function boxM(S, m, a, b, color, o = {}) {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  S.poly(m([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]), color, o);
  S.poly(m([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]), color, o);
  S.poly(m([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]), color, o);
  S.poly(m([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]), color, o);
  S.poly(m([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]), color, o);
}

/* A folded paper bot, facing +x in its own frame. reach 0..1 puts an arm
   out; empty 0..1 closes the hand on nothing; red tints its antenna tip. */
export function bot3(S, P, x, z, yaw, { reach = 0, s = 1, alpha = 1, red = 0, walk = 0, t = 0, ph = 0, armLen = 34, empty = 0 } = {}) {
  const bob = walk ? Math.abs(Math.sin(t * 9 + ph * 6)) * 3 : 0;
  const m = (pts) => place3(pts, { x, y: bob, z, yaw, s });
  const col = mix(P.card, P.grid, .2), dark = mix(P.ink, P.grid, .25);
  boxM(S, m, [-9, 0, -8], [9, 26, 8], col, { alpha });
  boxM(S, m, [-11, 28, -10], [11, 48, 10], col, { alpha });
  S.poly(m([[11.4, 36, -7], [11.4, 42, -7], [11.4, 42, -2], [11.4, 36, -2]]), dark, { flat: true, alpha, bias: -2 });
  S.poly(m([[11.4, 36, 2], [11.4, 42, 2], [11.4, 42, 7], [11.4, 36, 7]]), dark, { flat: true, alpha, bias: -2 });
  S.line(m([[0, 48, 0]])[0], m([[0, 60, 0]])[0], dark, { layer: 2, alpha, lw: 1.4 });
  boxM(S, m, [-2.5, 60, -2.5], [2.5, 65, 2.5], mix(dark, P.stop, red), { alpha, flat: red > .5 });
  if (reach > .01) {
    const L = 9 + armLen * reach;
    boxM(S, m, [9, 17, -3], [L, 22, 3], col, { alpha });
    const hw = lerp(9, 4, empty), hl = lerp(12, 8, empty);
    boxM(S, m, [L, 12, -hw], [L + hl, 27, hw], shade(col, -.05), { alpha });
  }
  if (alpha > .3) shadow(S, [[x - 12, 48, z - 12], [x + 12, 48, z - 12], [x - 12, 48, z + 12], [x + 12, 48, z + 12]], .045 * alpha);
}

/* Where a walker is: keys [t, x, z, faceX?, faceZ?]. It stands at each key
   until the last 70% of the leg, then walks it, facing where it's going;
   once there it faces (faceX, faceZ). Returns t => { x, z, yaw, walk }. */
export function track(keys) {
  const k = [];
  for (const key of keys) { const prev = k[k.length - 1]; k.push([prev ? Math.max(key[0], prev[0] + .05) : key[0], ...key.slice(1)]); }
  const faceOf = (key) => (key.length > 3 ? Math.atan2(key[4] - key[2], key[3] - key[1]) : Math.PI / 2);
  const yawTo = (a, b) => (b ? Math.atan2(b[2] - a[2], b[1] - a[1]) : Math.PI / 2);
  return (t) => {
    if (t <= k[0][0]) return { x: k[0][1], z: k[0][2], yaw: yawTo(k[0], k[1]), walk: 0 };
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i], b = k[i + 1];
      if (t < b[0]) {
        const span = b[0] - a[0], go = smooth(a[0] + span * .3, b[0], t), x = lerp(a[1], b[1], easeIO(go)), z = lerp(a[2], b[2], easeIO(go));
        const moving = go > 0 && go < 1 && Math.hypot(b[1] - a[1], b[2] - a[2]) > 4;
        return { x, z, yaw: moving ? Math.atan2(b[2] - a[2], b[1] - a[1]) : faceOf(a), walk: moving ? 1 : 0 };
      }
    }
    const l = k[k.length - 1];
    return { x: l[1], z: l[2], yaw: faceOf(l), walk: 0 };
  };
}

/* Marks on a wall (a door, a slot, print) sort just in front of that wall
   and no further: a fixed "draw on top" bias would paint them over a bot
   standing in front of them. rank orders marks on the same wall. */
export const depth = (S, pts) => pts.reduce((sum, p) => sum + S.cam.toCam(p)[2], 0) / pts.length;
export const onto = (S, wall, pts, rank = 1) => Math.min(0, depth(S, wall) - depth(S, pts) - .4 * rank);

/* A door that swings out on its left hinge (ang 0 shut), on the given wall. */
export function doorPanel(S, x0, y0, z, w, h, ang, color, wall, o = {}) {
  const hinge = [x0, 0, z], m = (pts) => pts.map((p) => rotate(p, hinge, [0, 1, 0], ang));
  const pts = m([[x0, y0, z - .8], [x0 + w, y0, z - .8], [x0 + w, y0 + h, z - .8], [x0, y0 + h, z - .8]]);
  S.poly(pts, color, { bias: onto(S, wall, pts, 2), ...o });
}

/* Dashed lines on the page: what isn't there any more. */
export function dashed(S, a, b, color, o = {}) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(2, Math.floor(L / 18));
  for (let k = 0; k < n; k += 2) S.line(lerp3(a, b, k / n), lerp3(a, b, Math.min(1, (k + 1) / n)), color, { layer: 1, lw: 1.6, ...o });
}
export function dashedRect(S, x0, z0, x1, z1, color, o = {}) {
  dashed(S, [x0, .4, z0], [x1, .4, z0], color, o); dashed(S, [x1, .4, z0], [x1, .4, z1], color, o);
  dashed(S, [x1, .4, z1], [x0, .4, z1], color, o); dashed(S, [x0, .4, z1], [x0, .4, z0], color, o);
}

/* The printed house: one sheet cut as a house front, standing on the page
   facing -z, with a red roofline, two windows and faint type printed on it,
   and a door cut into the paper. Open, there's nothing through the door but
   the page behind. fold 0..1 stands it up from the page on its bottom edge.
   Returns the front's points, for anything else that sits on it. */
export function houseFront(S, P, { x, z, w = 230, h = 270, eaves = 190, fold = 1, open = 0, door = { w: 62, h: 112 } }) {
  if (fold <= .01) return null;
  const a = (1 - smooth(0, .8, fold)) * Math.PI / 2, m = (pts) => pts.map((p) => rotate(p, [0, 0, z], [1, 0, 0], -a));
  const paper = mix(P.card, P.bg, .1), E = eaves;
  const front = m([[x - w / 2, 0, z], [x + w / 2, 0, z], [x + w / 2, E, z], [x, h, z], [x - w / 2, E, z]]);
  S.poly(front, paper, { depth: .5 });
  S.poly(m([[x + w / 2, 0, z], [x + w / 2, 0, z + 3], [x + w / 2, E, z + 3], [x + w / 2, E, z]]), shade(paper, -.15), { flat: true });
  const ink = mix(P.ink, P.grid, .2), pr = (pts, c, al = 1, rank = 1) => { const q = m(pts.map(([px, py]) => [px, py, z - .8])); S.poly(q, c, { flat: true, bias: onto(S, front, q, rank), alpha: al }); };
  pr([[x - w / 2, E - 10], [x, h - 10], [x, h], [x - w / 2, E]], P.stop);
  pr([[x, h - 10], [x + w / 2, E - 10], [x + w / 2, E], [x, h]], P.stop);
  for (const wx of [x - 62, x + 62]) {
    const y0 = 118, y1 = 162, x0 = wx - 22, x1 = wx + 22;
    pr([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], mix(P.ink, P.grid, .45), .55);
    pr([[wx - 1.5, y0], [wx + 1.5, y0], [wx + 1.5, y1], [wx - 1.5, y1]], paper, 1, 2);
    pr([[x0, 139], [x1, 139], [x1, 142], [x0, 142]], paper, 1, 2);
  }
  for (const side of [-1, 1]) for (let r = 0; r < 6; r++) {
    const cx = x + side * 70 - 34, ry = 96 - r * 13;
    pr([[cx, ry], [cx + 68 * (r % 3 === 2 ? .6 : 1), ry], [cx + 68 * (r % 3 === 2 ? .6 : 1), ry - 3], [cx, ry - 3]], ink, .25);
  }
  const dx0 = x - door.w / 2, dx1 = x + door.w / 2;
  pr([[dx0, 0], [dx1, 0], [dx1, door.h], [dx0, door.h]], P.bg, 1, 3);
  const swing = (p) => rotate(p, [dx0, 0, z - 1], [0, 1, 0], open * 1.9);
  const flap = (pts, c, rank, al = 1) => { const q = m(pts.map(([px, py]) => swing([px, py, z - 1.2]))); S.poly(q, c, { bias: onto(S, front, q, rank), alpha: al, flat: rank > 4 }); };
  flap([[dx0, 0], [dx1, 0], [dx1, door.h], [dx0, door.h]], paper, 4);
  flap([[dx0 + 9, 62], [dx1 - 9, 62], [dx1 - 9, door.h - 10], [dx0 + 9, door.h - 10]], mix(P.ink, P.grid, .5), 5, .35);
  flap([[dx1 - 14, 50], [dx1 - 8, 50], [dx1 - 8, 56], [dx1 - 14, 56]], P.ink, 6);
  if (fold > .5) shadow(S, [[x - w / 2, E, z], [x, h, z], [x + w / 2, E, z], [x - w / 2, 0, z + 2], [x + w / 2, 0, z + 2]], .06);
  return front;
}

/* Fog: soft banks of mist drifting across the frame, thickest low down.
   Drawn in screen space after the scene, fading to clear paper (not clear
   black, which reads as grey smudges). */
export function mist(g, t, P, amt, W = 1280) {
  if (amt <= .01) return;
  const r = seeded(91), [br, bg, bb] = rgb(P.bg), clear = `rgba(${br},${bg},${bb},0)`;
  g.save();
  for (let k = 0; k < 9; k++) {
    const w = 500 + r() * 600, h = 90 + r() * 120, y = 360 + r() * 320, v = 10 + r() * 22, x = ((r() * 2600 + t * v) % 2600) - 650;
    const gr = g.createRadialGradient(x, y, 0, x, y, w / 2);
    gr.addColorStop(0, P.bg); gr.addColorStop(1, clear);
    g.globalAlpha = .5 * amt; g.fillStyle = gr;
    g.save(); g.translate(x, y); g.scale(1, h / w); g.translate(-x, -y);
    g.beginPath(); g.arc(x, y, w / 2, 0, 7); g.fill(); g.restore();
  }
  const low = g.createLinearGradient(0, 380, 0, 720);
  low.addColorStop(0, clear); low.addColorStop(1, P.bg);
  g.globalAlpha = .35 * amt; g.fillStyle = low; g.fillRect(0, 380, W, 340);
  g.restore();
}

export { clamp };
