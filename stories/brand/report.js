/* report.js - the Report's type and marks on the stage.

   - the serif: the site's own system stack (no webfont, which is the argument)
   - the wordmark and the masthead's double rule, as the site sets them
   - the title card and the sign-off at each end of a film, and the channel ID
   - a torn strip of paper, for anything printed on screen (captions, a file,
     the manifesto's rules)
   - an underline, for the one word a line turns on

   Every colour comes from P (brand/tokens.css), so dark mode works. */

import { clamp, easeIO, smooth, seeded, line, stroke } from '../lib/sketch.js';

export const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';

export function serif(g, s, x, y, size, color, { weight = 700, italic = false, align = 'left', alpha = 1, base = 'alphabetic' } = {}) {
  if (alpha <= .005) return;
  g.save();
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${SERIF}`;
  g.textAlign = align; g.textBaseline = base; g.fillStyle = color; g.globalAlpha *= alpha;
  g.fillText(s, x, y);
  g.restore();
}
export function serifWidth(g, s, size, { weight = 700, italic = false } = {}) {
  g.save(); g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${SERIF}`;
  const w = g.measureText(s).width; g.restore(); return w;
}

/* A strip of paper: straight-ish long edges, torn short ends, pasted down
   (a hair of shadow along one edge, not a glow all round). Seeded, so it
   holds still. */
function tornPath(g, x, y, w, h, seed) {
  const r = seeded(seed), pts = [];
  const nTop = Math.max(4, Math.round(w / 60));
  for (let i = 0; i <= nTop; i++) pts.push([x + w * i / nTop, y + (r() - .5) * 1.4]);
  const nEnd = Math.max(5, Math.round(h / 7));
  for (let i = 1; i < nEnd; i++) pts.push([x + w + (r() - .3) * 7, y + h * i / nEnd]);
  for (let i = nTop; i >= 0; i--) pts.push([x + w * i / nTop, y + h + (r() - .5) * 1.4]);
  for (let i = nEnd - 1; i > 0; i--) pts.push([x - (r() - .3) * 7, y + h * i / nEnd]);
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath();
}
export function tornStrip(g, x, y, w, h, seed, P, alpha = 1) {
  if (alpha <= .005) return;
  g.save(); g.globalAlpha *= alpha;
  g.save(); g.translate(2, 2.5); tornPath(g, x, y, w, h, seed); g.fillStyle = P.grid; g.globalAlpha *= .45; g.fill(); g.restore();
  tornPath(g, x, y, w, h, seed); g.fillStyle = P.card; g.fill();
  g.strokeStyle = P.line; g.lineWidth = 1; g.stroke();
  g.restore();
}

/* An underline, drawn left to right by f, slightly uphill; double for emphasis. */
export function underline(g, x, y, w, P, f = 1, seed = 1, color = null, double = false) {
  if (f <= .01) return;
  const e = x + w * clamp(f, 0, 1);
  g.beginPath(); line(g, x, y + 1.5, e, y - 1.5, seed, .6, 1); if (double) line(g, x + 4, y + 7, e - 4, y + 4, seed + 1, .6, 1); stroke(g, color || P.accent, 2.2, .9);
}

/* "The Scale-to-Zero Report", centred on (cx, baseline y). Returns its width. */
export function wordmark(g, cx, y, size, P, alpha = 1) {
  const parts = [['The ', { weight: 400, italic: true }, P.text], ['Scale-to-Zero ', { weight: 700 }, P.ink], ['Report', { weight: 700 }, P.accent]];
  const ws = parts.map(([s, o]) => serifWidth(g, s, size, o)), total = ws.reduce((a, b) => a + b, 0);
  let x = cx - total / 2;
  parts.forEach(([s, o, c], i) => { serif(g, s, x, y, size, c, { ...o, alpha }); x += ws[i]; });
  return total;
}
/* The masthead's double rule, drawn out from the centre by f. */
export function doubleRule(g, cx, y, w, P, f = 1, alpha = 1) {
  const half = (w / 2) * easeIO(clamp(f, 0, 1));
  if (half < 1 || alpha <= .005) return;
  g.save(); g.globalAlpha *= alpha; g.strokeStyle = P.grid; g.lineWidth = 1.2;
  for (const dy of [0, 4]) { g.beginPath(); g.moveTo(cx - half, y + dy); g.lineTo(cx + half, y + dy); g.stroke(); }
  g.restore();
}

/* The title: the masthead, then the film's headline and dek, the way an
   article page opens. t0 is the {title} cue; out (0..1) fades it away. */
export function titleCard(g, t, t0, P, { headline, dek, dateline }, out = 0) {
  const keep = 1 - out, W = 1280;
  const ma = smooth(t0 + .2, t0 + 1.1, t);
  wordmark(g, W / 2, 190, 40, P, ma * keep);
  serif(g, 'A daily autopsy of what compute cost somebody.', W / 2, 226, 17, P.muted, { weight: 400, italic: true, align: 'center', alpha: ma * keep });
  doubleRule(g, W / 2, 252, 760, P, smooth(t0 + .7, t0 + 1.6, t), keep);
  if (dateline) serif(g, dateline, W / 2, 322, 17, P.text, { weight: 400, align: 'center', alpha: smooth(t0 + 1.3, t0 + 1.9, t) * keep });
  const ha = smooth(t0 + 1.6, t0 + 2.4, t);
  serif(g, headline, W / 2, 404 + (1 - easeIO(ha)) * 10, 66, P.ink, { weight: 700, align: 'center', alpha: ha * keep });
  const da = smooth(t0 + 2.4, t0 + 3.2, t);
  serif(g, dek, W / 2, 458, 26, P.text, { weight: 400, italic: true, align: 'center', alpha: da * keep });
}

/* The sign-off: the wordmark and the line every page carries, in words. */
export function signoff(g, cx, cy, P, alpha = 1) {
  if (alpha <= .005) return;
  wordmark(g, cx, cy, 44, P, alpha);
  doubleRule(g, cx, cy + 24, 520, P, 1, alpha);
  serif(g, 'A community project of airbrx', cx, cy + 66, 18, P.muted, { weight: 400, italic: true, align: 'center', alpha });
  serif(g, 'scale-to-zero.com', cx, cy + 100, 18, P.text, { weight: 400, align: 'center', alpha });
}

/* The channel ID, bottom right: the wordmark, small and faint. */
export function reportBug(g, P, a) {
  if (a <= .01) return;
  wordmark(g, 1280 - 128, 720 - 26, 15, P, .42 * a);
}
