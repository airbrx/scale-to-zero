/* fold.js - the folded-paper world (STYLE.md, "The material").

   A small 3D renderer for Canvas 2D, made for paper rather than for a game:

   - a pinhole camera that flies, dives and holds (camera())
   - faces flat-shaded by the angle they make with one light, upper left,
     relative to the ground sheet, so the page itself is exactly paper
     colour and everything standing on it reads as folded card
   - two-sided faces (paper has no back), painter's order in layers
     (0 the page, 1 things lying flat on it, 2 things standing up),
     near-plane clipping, distance fading into the paper
   - folding: rotate() turns points about a hinge, which is all an unfold
     is. The shared models below (a mill, a wheel, a boat, a dam...) take a
     fold amount and lie flat on the page at 0.

   Colours come from P (brand/tokens.css) through color.js's mix/shade, so
   dark mode works. Every function is a pure function of its inputs: a
   frame is the same every time it's drawn. */

import { clamp, lerp, smooth, seeded } from '../lib/sketch.js';
import { mix, shade, rgb } from './color.js';

export const W = 1280, H = 720;

/* ---------------- vectors ---------------- */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* p turned by ang (radians, right-handed) about the line through o along axis. */
export function rotate(p, o, axis, ang) {
  if (!ang) return p;
  const k = norm(axis), v = sub(p, o), c = Math.cos(ang), s = Math.sin(ang);
  const kv = cross(k, v), kd = dot(k, v);
  return add(o, [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)]);
}
/* Points turned about the vertical by yaw, scaled, then moved to (x, y, z). */
export const place3 = (pts, { x = 0, y = 0, z = 0, yaw = 0, s = 1 } = {}) => {
  const c = Math.cos(yaw), n = Math.sin(yaw);
  return pts.map(([px, py, pz]) => [x + (px * c - pz * n) * s, y + py * s, z + (px * n + pz * c) * s]);
};

/* ---------------- the camera ---------------- */

export function camera(pos, look, F = 900) {
  const f = norm(sub(look, pos)), r = norm(cross([0, 1, 0], f)), u = cross(f, r);
  const toCam = (p) => { const d = sub(p, pos); return [dot(d, r), dot(d, u), dot(d, f)]; };
  const flat = (c) => [W / 2 + F * c[0] / c[2], H / 2 - F * c[1] / c[2]];
  return {
    pos, look, F, toCam, flat,
    // a world point on screen, or null behind the camera
    project(p) { const c = toCam(p); return c[2] > 1 ? [...flat(c), c[2]] : null; },
  };
}

/* A camera path: keys [t, pos, look, F?], eased between. */
export function cameraPath(keys) {
  return (t) => {
    if (t <= keys[0][0]) return camera(keys[0][1], keys[0][2], keys[0][3] || 900);
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, p0, l0, f0 = 900] = keys[i], [t1, p1, l1, f1 = 900] = keys[i + 1];
      if (t < t1) { const u = smooth(t0, t1, t); return camera(mix3(p0, p1, u), mix3(l0, l1, u), lerp(f0, f1, u)); }
    }
    const k = keys[keys.length - 1];
    return camera(k[1], k[2], k[3] || 900);
  };
}

/* ---------------- the scene ---------------- */

const LIGHT = norm([-.55, .78, -.42]);

/* LOOK: optional treatments, all off by default (0). A film turns them on in
   makeStory (HOUSE_LOOK is the house setting, STYLE.md "Light and heat");
   the lookbook tool (tools/lookbook.mjs) compares them.
     halftone  gradients as a print screen: faces fill a shade lighter and the
               rest of their darkness is laid on as a 45-degree dot screen,
               like a newspaper photo (multiply on paper, screen on dark)
     light     a soft ramp across each larger face, lit from the upper left
               and falling into the crease
     glow      lit windows glow, and throw a warm pool on the page in front
     heat      buildings that are running warm toward amber, then red, and
               shimmer above the roof
   halftoneOn: 'page' (the ground, shadows, things lying flat: the default,
               so red stays pure on what's standing) or 'all'
   canvas: (w, h) => a canvas, for building the dot screens (the browser
   makes its own; Node passes @napi-rs/canvas's createCanvas). */
export const LOOK = { halftone: 0, halftoneOn: 'page', light: 0, glow: 0, heat: 0, canvas: null };
export const HOUSE_LOOK = { heat: 1, glow: 1, light: .6, halftone: .8, halftoneOn: 'page' };
const lum = (c) => { const [r, g, b] = rgb(c); return (.299 * r + .587 * g + .114 * b) / 255; };
const SCREENS = new WeakMap();   // per context: the dot screens, darkest last
function screens(g, dark) {
  let per = SCREENS.get(g);
  if (!per) { per = {}; SCREENS.set(g, per); }
  const key = dark ? 'd' : 'l';
  if (per[key]) return per[key];
  const make = LOOK.canvas || ((w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })));
  const out = [];
  for (let k = 0; k < 10; k++) {
    const T = 9, c = make(T, T), x = c.getContext('2d'), r = .35 + 4.1 * Math.sqrt(k / 9);
    x.fillStyle = dark ? '#e8d9c4' : '#2a1f1a';   // warm inks, not pure black and white
    // a 45-degree screen: dots at the corners and the centre of each tile
    for (const [dx, dy] of [[0, 0], [T, 0], [0, T], [T, T], [T / 2, T / 2]]) { x.beginPath(); x.arc(dx, dy, r, 0, Math.PI * 2); x.fill(); }
    out.push(g.createPattern(c, 'repeat'));
  }
  return (per[key] = out);
}
const UP_LAM = LIGHT[1] * .5 + .5;

/* Collect faces and lines for one frame, then draw them back to front.
   Options on a face: layer (0 page, 1 flat on it, 2 standing; default 2),
   alpha, flat (no shading: lit windows, ink), depth (shading strength),
   edge (a crease hairline colour), fog (false to keep full colour). */
export function scene(cam, P, { near = 8, fog = [1600, 7000] } = {}) {
  const items = [];
  const fogK = (z) => smooth(fog[0], fog[1], z) * .92;
  function clip(cs) {
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length], ina = a[2] >= near, inb = b[2] >= near;
      if (ina) out.push(a);
      if (ina !== inb) { const k = (near - a[2]) / (b[2] - a[2]); out.push(mix3(a, b, k)); }
    }
    return out;
  }
  const S = {
    cam, P,
    poly(pts, color, o = {}) {
      if (pts.length < 3) return;
      const { layer = 2, alpha = 1, flat = false, depth = .9, edge = null, fog: fogOn = true, bias = 0 } = o;
      if (alpha <= .005) return;
      let c = color;
      if (!flat) {
        let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
        if (!Number.isFinite(n[0]) || (n[0] === 0 && n[1] === 0 && n[2] === 0)) return;
        const mid = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
        if (dot(n, sub(cam.pos, mid)) < 0) n = mul(n, -1);
        const lam = dot(n, LIGHT) * .5 + .5;
        c = shade(color, clamp((lam - UP_LAM) * depth, -.42, .2));
      }
      const cs = clip(pts.map(cam.toCam));
      if (cs.length < 3) return;
      const z = cs.reduce((s, p) => s + p[2], 0) / cs.length;
      if (fogOn) c = mix(c, P.bg, fogK(z));
      items.push({ k: 'p', layer, z: z + bias, pts: cs.map(cam.flat), c, alpha, edge });
    },
    /* A soft light at p, of world radius r: a lit window's glow, a pool on
       the page, heat over a roof. Only drawn when LOOK.glow or LOOK.heat
       asks for it (the caller checks). */
    glow(p, r, color, alpha = 1, { layer = 2, squash = 1 } = {}) {
      const c = cam.toCam(p);
      if (c[2] < near || alpha <= .005) return;
      const [sx, sy] = cam.flat(c), R = cam.F * r / c[2];
      items.push({ k: 'g', layer, z: c[2] - 1, x: sx, y: sy, r: R, squash, c: color, alpha: alpha * (1 - fogK(c[2])) });
    },
    line(a, b, color, o = {}) {
      const { layer = 1, alpha = 1, lw = 1, fog: fogOn = true } = o;
      if (alpha <= .005) return;
      let ca = cam.toCam(a), cb = cam.toCam(b);
      if (ca[2] < near && cb[2] < near) return;
      if (ca[2] < near) ca = mix3(ca, cb, (near - ca[2]) / (cb[2] - ca[2]));
      if (cb[2] < near) cb = mix3(cb, ca, (near - cb[2]) / (ca[2] - cb[2]));
      const z = (ca[2] + cb[2]) / 2;
      items.push({ k: 'l', layer, z, a: cam.flat(ca), b: cam.flat(cb), c: fogOn ? mix(color, P.bg, fogK(z)) : color, alpha, lw: lw * Math.min(2.5, Math.max(.4, 600 / z)) });
    },
    flush(g) {
      items.sort((p, q) => p.layer - q.layer || q.z - p.z);
      const H = LOOK.halftone, Lt = LOOK.light, scr = H > .01 ? screens(g, P.dark) : null, bgL = lum(P.bg);
      for (const it of items) {
        g.globalAlpha = it.alpha;
        if (it.k === 'p') {
          g.beginPath(); g.moveTo(it.pts[0][0], it.pts[0][1]);
          for (let i = 1; i < it.pts.length; i++) g.lineTo(it.pts[i][0], it.pts[i][1]);
          g.closePath();
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          if (H > .01 || Lt > .01) for (const [px, py] of it.pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
          const big = (x1 - x0) * (y1 - y0) > 600;
          // halftone: the face fills a shade toward the paper; the dots put the darkness back
          const screened = H > .01 && big && (LOOK.halftoneOn === 'all' || it.layer <= 1);
          const fill = screened ? mix(it.c, P.bg, .3 * H) : it.c;
          if (Lt > .01 && big) {
            const gr = g.createLinearGradient(x0, y0, x1, y1);
            gr.addColorStop(0, shade(fill, .07 * Lt)); gr.addColorStop(1, shade(fill, -.14 * Lt));
            g.fillStyle = gr;
          } else g.fillStyle = fill;
          g.fill();
          g.strokeStyle = it.edge || fill; g.lineWidth = it.edge ? 1 : .7; g.lineJoin = 'round'; g.stroke();
          if (scr && screened) {
            const dk = clamp((P.dark ? lum(it.c) - bgL : bgL - lum(it.c)) * 1.8 + .05, 0, 1), lvl = Math.round(dk * 9);
            if (lvl > 0) {
              g.save(); g.globalCompositeOperation = P.dark ? 'screen' : 'multiply';
              g.globalAlpha = it.alpha * (P.dark ? .2 : .34) * H; g.fillStyle = scr[lvl]; g.fill();
              g.restore();
            }
          }
        } else if (it.k === 'g') {
          const gr = g.createRadialGradient(it.x, it.y, 0, it.x, it.y, it.r), [r, gg, b] = rgb(it.c);
          gr.addColorStop(0, `rgba(${r},${gg},${b},1)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
          g.save(); g.globalCompositeOperation = P.dark ? 'lighter' : 'multiply'; g.globalAlpha = it.alpha;
          g.translate(it.x, it.y); g.scale(1, it.squash); g.translate(-it.x, -it.y);
          g.fillStyle = gr; g.beginPath(); g.arc(it.x, it.y, it.r, 0, Math.PI * 2); g.fill(); g.restore();
        } else {
          g.beginPath(); g.moveTo(it.a[0], it.a[1]); g.lineTo(it.b[0], it.b[1]);
          g.strokeStyle = it.c; g.lineWidth = it.lw; g.lineCap = 'round'; g.stroke();
        }
      }
      g.globalAlpha = 1;
      items.length = 0;
    },
  };
  return S;
}

/* ---------------- on the page ---------------- */

/* A flat shadow on the page for a set of points, cast away from the light. */
export function shadow(S, pts, alpha = .07) {
  const flat = pts.map((p) => [p[0] - LIGHT[0] * p[1] / LIGHT[1], p[2] - LIGHT[2] * p[1] / LIGHT[1]]);
  const hull = convexHull(flat);
  if (hull.length < 3) return;
  S.poly(hull.map(([x, z]) => [x, .3, z]), S.P.ink, { layer: 1, flat: true, alpha, bias: 1e5 });
}
function convexHull(ps) {
  const p = ps.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/* The newsprint the world is folded from: ghost columns of type on the
   page, a few percent of ink. Seeded, so it never shimmers. */
export function newsprint(S, x0, z0, cols, rows, { colW = 150, gap = 26, lead = 13, alpha = .07, seed = 1 } = {}) {
  const r = seeded(seed), ink = S.P.ink;
  for (let c = 0; c < cols; c++) {
    const x = x0 + c * (colW + gap);
    if (c) S.line([x - gap / 2, .2, z0], [x - gap / 2, .2, z0 + rows * lead], ink, { alpha: alpha * 1.3 });
    for (let k = 0; k < rows; k++) {
      if (r() < .12) continue;                       // a paragraph break
      const z = z0 + k * lead, end = r() < .15 ? x + colW * (.3 + r() * .5) : x + colW;
      for (let w = x; w < end - 6;) { const wl = 10 + r() * 34; S.line([w, .2, z], [Math.min(end, w + wl), .2, z], ink, { alpha, lw: 2.4 }); w += wl + 5; }
    }
  }
}

/* A ridge of folded hills: big planes, mountain folds, valley folds. */
export function hills(S, x0, x1, zf, zb, { n = 9, hMin = 160, hMax = 420, seed = 5, color = null } = {}) {
  const r = seeded(seed), col = color || mix(S.P.bg, S.P.grid, .6), peaks = [];
  for (let i = 0; i <= n; i++) peaks.push([lerp(x0, x1, i / n) + (r() - .5) * (x1 - x0) / n * .4, i % 2 ? hMin + r() * 60 : hMax * (.7 + r() * .3), lerp(zf, zb, .45 + (r() - .5) * .2)]);
  for (let i = 0; i < n; i++) {
    const a = peaks[i], b = peaks[i + 1], fa = [a[0], 0, zf], fb = [b[0], 0, zf], ba = [a[0], 0, zb], bb = [b[0], 0, zb];
    S.poly([fa, fb, b], col); S.poly([fa, b, a], col);
    S.poly([ba, bb, b], col, { depth: .5 }); S.poly([ba, b, a], col, { depth: .5 });
  }
}

/* Water as pleated paper along a centreline [[x, z], ...]: each section
   tilts a little, and the pleats travel downstream with phase. Sections
   with s < dry (0..1 of the length, from the source) are a dry bed. */
export function water(S, line, width, { phase = 0, dry = 0, amp = 7, color = null, bed = null, alpha = 1, step = 46 } = {}) {
  const P = S.P, wet = color || mix(P.water, P.bg, .35), dryC = bed || mix(P.bg, P.coin, .18);
  const pts = resample(line, step), L = pts.length - 1;
  const sec = pts.map(([x, z], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(L, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * width / 2, nz = dx / l * width / 2, wetHere = i / L >= dry;
    const h = wetHere ? amp * Math.sin(i * 1.9 - phase) : 0;
    return { l: [x + nx, 1 + Math.max(0, h), z + nz], r: [x - nx, 1 + Math.max(0, -h), z - nz], wet: wetHere };
  });
  for (let i = 0; i < L; i++) {
    const p = sec[i], q = sec[i + 1], c = p.wet && q.wet ? wet : dryC;
    S.poly([p.l, p.r, q.r], c, { layer: 1, depth: 2.2, alpha }); S.poly([p.l, q.r, q.l], c, { layer: 1, depth: 2.2, alpha });
  }
}
/* A polyline [[x, z]...] cut into steps of about `step`. */
export function resample(line, step) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  return out;
}
/* The point at fraction u along a polyline, and its heading. */
export function along(line, u) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) { const l = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); segs.push(l); total += l; }
  let d = clamp(u, 0, 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const a = line[i], b = line[i + 1], k = segs[i] ? d / segs[i] : 0;
      return { x: lerp(a[0], b[0], k), z: lerp(a[1], b[1], k), yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    d -= segs[i];
  }
  return { x: line[0][0], z: line[0][1], yaw: 0 };
}

/* ---------------- folded models ---------------- */

/* A building that unfolds out of the page like a pop-up: four walls rise on
   their bottom hinges, then the two roof panels close on their eaves. At
   fold 0 it lies flat on the page as its own net, creases showing. Front
   faces -z. windows: [[u, v], ...] on the front wall (0..1), lit 0..1. */
export function building(S, { x, z, w, d, h, roof = .45, fold = 1, color = null, roofColor = null, windows = [], lit = 0, litColor = null, shadowA = .07 }) {
  const P = S.P;
  // heat: a building that's running warms toward amber, then red (LOOK.heat)
  const hot = LOOK.heat * lit * fold, hotC = mix(P.coin, P.stop, clamp(lit * 1.2 - .2, 0, 1));
  let wall = color || mix(P.card, P.grid, .12), rc = roofColor || mix(P.stop, P.grid, .55);
  if (hot > .01) { wall = mix(wall, hotC, .32 * hot); rc = mix(rc, P.stop, .35 * hot); }
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, rh = d * roof, zm = z;
  const a = (1 - smooth(0, .6, fold)) * Math.PI / 2, rb = 1 - smooth(.45, 1, fold);
  const phi = Math.atan2(zm - z0, rh);
  const front = (p) => rotate(p, [0, 0, z0], [1, 0, 0], -a), back = (p) => rotate(p, [0, 0, z1], [1, 0, 0], a);
  const left = (p) => rotate(p, [x0, 0, 0], [0, 0, 1], a), right = (p) => rotate(p, [x1, 0, 0], [0, 0, 1], -a);
  const fr = (p) => front(rotate(p, [0, h, z0], [1, 0, 0], -phi * rb)), br = (p) => back(rotate(p, [0, h, z1], [1, 0, 0], phi * rb));
  const lay = 2;
  S.poly([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]].map(front), wall, { layer: lay });
  S.poly([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]].map(back), wall, { layer: lay });
  S.poly([[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h + rh, zm], [x0, h, z0]].map(left), wall, { layer: lay });
  S.poly([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h + rh, zm], [x1, h, z0]].map(right), wall, { layer: lay });
  const ov = 8;   // the roof overhangs its gables a little, as card does
  S.poly([[x0 - ov, h, z0], [x1 + ov, h, z0], [x1 + ov, h + rh, zm], [x0 - ov, h + rh, zm]].map(fr), rc, { layer: lay, bias: -2 });
  S.poly([[x0 - ov, h, z1], [x1 + ov, h, z1], [x1 + ov, h + rh, zm], [x0 - ov, h + rh, zm]].map(br), rc, { layer: lay, bias: -2 });
  const lc = litColor || P.coin, dark = mix(P.ink, P.grid, .35);
  for (const [u, v] of windows) {
    const wx = lerp(x0, x1, u), wy = h * v, ww = Math.min(14, w * .1), wh = h * .2;
    S.poly([[wx - ww / 2, wy - wh / 2, z0 - .6], [wx + ww / 2, wy - wh / 2, z0 - .6], [wx + ww / 2, wy + wh / 2, z0 - .6], [wx - ww / 2, wy + wh / 2, z0 - .6]].map(front), mix(dark, lc, lit), { layer: lay, flat: true, bias: -4 });
    // glow: the window lights the air in front of it, and a pool on the page below
    if (LOOK.glow > .01 && lit > .05 && fold > .8) {
      const warm = mix(lc, P.dark ? '#ffd28a' : '#f0b45a', .4);
      S.glow([wx, wy, z0 - 4], Math.max(26, w * .16), warm, .55 * LOOK.glow * lit);
      S.glow([wx, 1, z0 - Math.max(40, w * .25)], Math.max(50, w * .32), warm, .28 * LOOK.glow * lit, { layer: 1, squash: .38 });
    }
  }
  // heat shimmer over the roof
  if (hot > .05 && fold > .8) S.glow([x, h + rh + 30, zm], Math.max(70, w * .5), P.stop, .22 * hot, { squash: .7 });
  if (fold > .5 && shadowA) shadow(S, [[x0, 0, z0], [x1, 0, z0], [x0, 0, z1], [x1, 0, z1], [x0, h + rh, zm], [x1, h + rh, zm]], shadowA * smooth(.5, 1, fold));
}

/* A water wheel on its axle at c, in the x-y plane (it faces the camera),
   radius r, turned to ang. Paddles stand out from the rim as folded card. */
export function wheel(S, c, r, ang, { n = 10, thick = 14, color = null, fold = 1 } = {}) {
  if (fold <= .01) return;
  const P = S.P, col = color || mix(P.coin, P.grid, .45), [cx, cy, cz] = c, rr = r * fold;
  const at = (k, rad, dz = 0) => { const a = ang + Math.PI * 2 * k / n; return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, cz + dz]; };
  for (let k = 0; k < n; k++) {
    // the rim, front and back, as a band of card
    S.poly([at(k, rr * .82, -thick / 2), at(k + 1, rr * .82, -thick / 2), at(k + 1, rr, -thick / 2), at(k, rr, -thick / 2)], col, { bias: -1 });
    S.poly([at(k, rr * .82, thick / 2), at(k + 1, rr * .82, thick / 2), at(k + 1, rr, thick / 2), at(k, rr, thick / 2)], col);
    // a paddle: a flat blade across the rim, sticking out past it
    S.poly([at(k, rr * .7, -thick / 2), at(k, rr * 1.12, -thick / 2), at(k, rr * 1.12, thick / 2), at(k, rr * .7, thick / 2)], shade(col, -.08), { bias: -2 });
    // a spoke
    if (k % 2 === 0) S.poly([[cx, cy, cz - thick / 2 - .5], at(k - .08, rr * .84, -thick / 2 - .5), at(k + .08, rr * .84, -thick / 2 - .5)], shade(col, -.15), { bias: -3 });
  }
  S.poly([0, 1, 2, 3, 4, 5].map((k) => { const a = Math.PI * 2 * k / 6; return [cx + Math.cos(a) * rr * .12, cy + Math.sin(a) * rr * .12, cz - thick / 2 - 1]; }), shade(col, -.25), { flat: true, bias: -4 });
}

/* A paper boat, the classic fold: two sloped hull sides meeting at a keel,
   a triangular sail standing up the middle. Pointing along yaw. */
export function boat(S, x, z, yaw, { s = 1, color = null, cargo = null, alpha = 1, bob = 0 } = {}) {
  const P = S.P, col = color || P.card, L = 44, Wd = 20, h = 11, y = 1 + bob;
  const m = (pts) => place3(pts, { x, y, z, yaw, s });
  const hull = [[-L / 2, h, -Wd / 2], [L / 2, h, -Wd / 2], [L * .3, 0, 0], [-L * .3, 0, 0]];
  S.poly(m(hull), col, { alpha });
  S.poly(m(hull.map(([a, b, c]) => [a, b, -c])), col, { alpha });
  S.poly(m([[L / 2, h, -Wd / 2], [L / 2, h, Wd / 2], [L * .3, 0, 0]]), col, { alpha });
  S.poly(m([[-L / 2, h, -Wd / 2], [-L / 2, h, Wd / 2], [-L * .3, 0, 0]]), col, { alpha });
  S.poly(m([[-L * .28, h, 0], [L * .28, h, 0], [0, h + 26, 0]]), col, { alpha, bias: -1 });
  if (cargo) S.poly(m([[-6, h, -4], [6, h, -4], [6, h + 9, -4], [-6, h + 9, -4]]), cargo, { alpha, bias: -2 });
}

/* A dam across a channel at (x, z), facing yaw: a folded wall, thicker at
   the foot, with a gate panel that drops (gate 1 open, 0 shut). */
export function dam(S, x, z, yaw, { w = 150, h = 70, gate = 1, color = null, gateColor = null } = {}) {
  const P = S.P, col = color || mix(P.card, P.grid, .35), gc = gateColor || P.ink;
  const m = (pts) => place3(pts, { x, z, yaw });
  S.poly(m([[-w / 2, 0, -18], [w / 2, 0, -18], [w / 2, h, -4], [-w / 2, h, -4]]), col);
  S.poly(m([[-w / 2, h, -4], [w / 2, h, -4], [w / 2, h, 6], [-w / 2, h, 6]]), col);
  S.poly(m([[-w / 2, 0, 18], [w / 2, 0, 18], [w / 2, h, 6], [-w / 2, h, 6]]), col, { depth: .5 });
  // the gate: a dark panel on the face. Open, it's winched up above the
  // wall; shut, it's down in the channel.
  const gy = lerp(0, h - 4, gate), gw = 30, gh = 50;
  S.poly(m([[-gw / 2, gy, -12], [gw / 2, gy, -12], [gw / 2, gy + gh, -12], [-gw / 2, gy + gh, -12]]), gc, { bias: -2 });
}

/* A triangular pennant on a stick at (x, z). */
export function pennant(S, x, z, { h = 46, color, fold = 1, flap = 0 } = {}) {
  if (fold <= .01) return;
  const P = S.P, hh = h * fold;
  S.poly([[x - 1.2, 0, z], [x + 1.2, 0, z], [x + 1.2, hh, z], [x - 1.2, hh, z]], P.ink, { flat: true, alpha: .7 });
  S.poly([[x, hh, z], [x, hh - 16 * fold, z], [x + 24 * fold, hh - 8 * fold + flap, z + 3]], color);
}

/* A plain folded box (no roof): a table top, a crate, a block. */
export function block(S, x, y, z, w, h, d, color, o = {}) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h;
  S.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], color, o);
  S.poly([[x0, y, z0], [x1, y, z0], [x1, y1, z0], [x0, y1, z0]], color, o);
  S.poly([[x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0]], color, o);
  S.poly([[x1, y, z0], [x1, y, z1], [x1, y1, z1], [x1, y1, z0]], color, o);
}

/* A label in the Report's serif at a world point, if it's in front of the camera. */
export function at2d(cam, p) { return cam.project(p); }

/* ---------------- the machine ---------------- */

/* A conveyor belt along x at z, its top at height y: a paper strip on legs,
   with slats that travel by phase (in world units along the belt). */
export function belt(S, x0, x1, z, { w = 70, y = 30, phase = 0, color = null, fold = 1, alpha = 1 } = {}) {
  if (fold <= .01) return;
  const P = S.P, col = color || mix(P.card, P.grid, .3), yy = y * fold, z0 = z - w / 2, z1 = z + w / 2;
  S.poly([[x0, yy, z0], [x1, yy, z0], [x1, yy, z1], [x0, yy, z1]], col, { alpha });
  S.poly([[x0, yy - 8, z0], [x1, yy - 8, z0], [x1, yy, z0], [x0, yy, z0]], shade(col, -.15), { alpha, flat: true });
  for (let s = ((phase % 34) + 34) % 34; x0 + s < x1; s += 34) S.line([x0 + s, yy + .4, z0 + 3], [x0 + s, yy + .4, z1 - 3], P.ink, { layer: 2, alpha: .22 * alpha, lw: 1.2 });
  for (let x = x0 + 30; x < x1; x += 260) { block(S, x, 0, z0 + 6, 8, yy - 8, 8, shade(col, -.2), { alpha }); block(S, x, 0, z1 - 6, 8, yy - 8, 8, shade(col, -.2), { alpha }); }
}

/* A folded gear in the x-y plane (facing the camera) at c: a toothed card
   disc with thickness, turned to ang. */
export function gear(S, c, r, ang, { teeth = 12, thick = 10, color = null, fold = 1, alpha = 1 } = {}) {
  if (fold <= .01) return;
  const P = S.P, col = color || mix(P.coin, P.grid, .45), [cx, cy, cz] = c, rr = r * fold, out = [];
  for (let k = 0; k < teeth * 4; k++) {
    const a = ang + Math.PI * 2 * k / (teeth * 4), tooth = k % 4 === 1 || k % 4 === 2;
    out.push([cx + Math.cos(a) * rr * (tooth ? 1.16 : 1), cy + Math.sin(a) * rr * (tooth ? 1.16 : 1)]);
  }
  S.poly(out.map(([x, y]) => [x, y, cz + thick / 2]), shade(col, -.2), { alpha, flat: true });
  for (let k = 0; k < out.length; k += 2) {
    const a = out[k], b = out[(k + 2) % out.length];
    S.poly([[a[0], a[1], cz - thick / 2], [b[0], b[1], cz - thick / 2], [b[0], b[1], cz + thick / 2], [a[0], a[1], cz + thick / 2]], col, { alpha });
  }
  S.poly(out.map(([x, y]) => [x, y, cz - thick / 2]), col, { alpha, bias: -2 });
  // spokes as cut-outs: darker wedges that turn with it
  for (let k = 0; k < 4; k++) {
    const a = ang + Math.PI / 2 * k + .35, b = a + .8;
    S.poly([[cx + Math.cos(a) * rr * .3, cy + Math.sin(a) * rr * .3, cz - thick / 2 - .5], [cx + Math.cos(a) * rr * .72, cy + Math.sin(a) * rr * .72, cz - thick / 2 - .5], [cx + Math.cos(b) * rr * .72, cy + Math.sin(b) * rr * .72, cz - thick / 2 - .5], [cx + Math.cos(b) * rr * .3, cy + Math.sin(b) * rr * .3, cz - thick / 2 - .5]], shade(col, -.3), { alpha, flat: true, bias: -3 });
  }
}

/* A driveshaft from a to b: a square card prism turned to ang, so its faces
   flicker light and dark while it spins and hold still when it stops.
   draw (0..1) extends it from a, for plugging it in. */
export function shaft(S, a, b, ang, { r = 6, color = null, draw = 1, alpha = 1 } = {}) {
  if (draw <= .01) return;
  const P = S.P, col = color || mix(P.muted, P.grid, .3), e = mix3(a, b, draw);
  const d = norm(sub(e, a)), u = norm(Math.abs(d[1]) > .9 ? cross(d, [1, 0, 0]) : cross(d, [0, 1, 0])), v = cross(d, u);
  const off = (k) => { const q = ang + Math.PI / 2 * k; return add(mul(u, Math.cos(q) * r), mul(v, Math.sin(q) * r)); };
  for (let k = 0; k < 4; k++) S.poly([add(a, off(k)), add(e, off(k)), add(e, off(k + 1)), add(a, off(k + 1))], col, { alpha });
  // collars every so often, so turning reads even end-on
  const L = Math.hypot(...sub(e, a));
  for (let s = 60; s < L - 20; s += 140) { const p = add(a, mul(d, s)); block(S, p[0], p[1] - r * 1.6, p[2], r * 3.2, r * 3.2, r * 3.2, shade(col, -.15), { alpha }); }
}

/* A status lamp on a pole: paper-white when fine, invoice red when down. */
export function lamp(S, x, z, down, { h = 120, fold = 1 } = {}) {
  if (fold <= .01) return;
  const P = S.P, hh = h * fold;
  block(S, x, 0, z, 6, hh, 6, mix(P.ink, P.grid, .4));
  block(S, x, hh, z, 22, 22, 22, mix(P.card, P.stop, down), { flat: down > .5 });
}
