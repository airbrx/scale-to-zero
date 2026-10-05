/* sketch.js - the hand-drawn kit every story draws with.

   Kept deliberately small: easing, a seeded random, seeded wobble on a
   stroke (re-rolled on a "boil" clock), the ground, and the palette read.

   Nothing here touches the DOM except readPalette(), so a story module can
   be imported and drawn against a stub context (tools/check.mjs). */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeIO = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const easeOutBack = t => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// Monotone cubic (Fritsch-Carlson): camera paths that never overshoot a key.
export function spline(keys) {
  const n = keys.length, xs = keys.map(k => k[0]), ys = keys.map(k => k[1]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function seeded(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* Shared drawing state, set by the player once per frame.
   boil  - wobble generation; same value, same wobble
   rough - wobble amount (0 is clean vector)
   lw/ts - line and text multipliers, so a small player stays legible */
export const S = { boil: 0, rough: 1, lw: 1, ts: 1 };
const R = seed => seeded((seed * 2654435761 + S.boil * 40503) >>> 0);

export function line(g, x1, y1, x2, y2, seed, amt = 1, passes = 2) {
  const r = R(seed), len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const j = Math.min(amt * S.rough * 1.5, len * .05 + amt * S.rough * .4);
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  for (let p = 0; p < passes; p++) {
    const o = () => (r() - .5) * 2 * j, bow = (r() - .5) * j * 1.6;
    const mx = (x1 + x2) / 2 + nx * bow, my = (y1 + y2) / 2 + ny * bow;
    g.moveTo(x1 + o(), y1 + o()); g.quadraticCurveTo(mx + o() * .5, my + o() * .5, x2 + o(), y2 + o());
  }
}
export function poly(g, pts, seed, amt = 1, closed = false, passes = 2) {
  if (pts.length < 2) return;
  const r = R(seed), j = 1.1 * amt * S.rough;
  for (let p = 0; p < passes; p++) {
    const q = pts.map(([x, y]) => [x + (r() - .5) * 2 * j, y + (r() - .5) * 2 * j]);
    if (closed) q.push(q[0]);
    g.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length - 1; i++) { const mx = (q[i][0] + q[i + 1][0]) / 2, my = (q[i][1] + q[i + 1][1]) / 2; g.quadraticCurveTo(q[i][0], q[i][1], mx, my); }
    const l = q[q.length - 1]; g.lineTo(l[0], l[1]);
  }
}
export function circ(g, cx, cy, rad, seed, amt = 1) {
  const r = R(seed), n = Math.max(12, Math.round(rad * .7));
  for (let p = 0; p < 2; p++) {
    const a0 = r() * Math.PI * 2, over = .2 + r() * .35, k = amt * S.rough * Math.min(2.2, rad * .05 + .6), ph = r() * 6;
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI * 2 + over) * i / n, rr = rad + k * Math.sin(a * 2 + ph) + (r() - .5) * k * .5; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
  }
}
export function rect(g, x, y, w, h, seed, amt = 1) {
  line(g, x, y, x + w, y, seed, amt); line(g, x + w, y, x + w, y + h, seed + 1, amt);
  line(g, x + w, y + h, x, y + h, seed + 2, amt); line(g, x, y + h, x, y, seed + 3, amt);
}
export function stroke(g, color, lw, alpha = 1) { g.strokeStyle = color; g.lineWidth = lw * S.lw; g.globalAlpha = alpha; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); g.globalAlpha = 1; }
export function fillPath(g, color, alpha = 1) { g.fillStyle = color; g.globalAlpha = alpha; g.fill(); g.globalAlpha = 1; }

// The ground: the stage colour, with two soft glows in --glow (off in the Report's tokens).
export function ground(g, P, W = 1280, H = 720) {
  g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
  for (const [cx, cy, r] of [[.2 * W, .28 * H, .55 * W], [.8 * W, .72 * H, .55 * W]]) {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, P.glow); gr.addColorStop(1, 'rgba(253, 108, 29, 0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
}


/* Canvas cannot resolve var(), so the palette is read off the tokens and
   re-read often enough that a theme flip lands within a few frames. */
export const TOKENS = { bg: '--stage', card: '--stage-card', panel: '--stage-panel', ink: '--stage-ink', text: '--stage-text',
  grid: '--stage-grid', line: '--stage-line', muted: '--muted', accent: '--accent', accent2: '--accent-2',
  accentText: '--accent-text', glow: '--glow', ok: '--ok', stop: '--stop', water: '--water', coin: '--coin', oai: '--oai' };
export function readPalette() {
  const cs = getComputedStyle(document.documentElement), P = {};
  for (const k in TOKENS) P[k] = cs.getPropertyValue(TOKENS[k]).trim();
  P.dark = document.documentElement.classList.contains('dark');
  return P;
}
