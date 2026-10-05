/* color.js - colour arithmetic for the stage.

   The canvas can't read CSS variables, so colours arrive as strings from
   P (brand/tokens.css) and are mixed here: that's what keeps dark mode
   working everywhere. rgb() reads #rgb, #rrggbb and rgb()/rgba() strings. */

import { clamp, lerp } from '../lib/sketch.js';

const cache = new Map();
export function rgb(c) {
  if (cache.has(c)) return cache.get(c);
  let v = null;
  const s = String(c).trim();
  if (s[0] === '#') {
    const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) v = m[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  }
  if (!v || v.some((x) => !Number.isFinite(x))) throw new Error(`color: can't read the colour "${c}"`);
  cache.set(c, v);
  return v;
}
const css = ([r, g, b]) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/* a and b mixed, t of the way to b */
export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b), u = clamp(t, 0, 1);
  return css([lerp(A[0], B[0], u), lerp(A[1], B[1], u), lerp(A[2], B[2], u)]);
}
/* lighter toward white (k > 0) or darker toward black (k < 0) */
export function shade(c, k) {
  return k >= 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k);
}
