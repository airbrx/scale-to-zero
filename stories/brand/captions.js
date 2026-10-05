/* captions.js - which sentence is on screen, and how it's burned into a
   recording. lib/captions.js re-exports it, so the viewer and the export
   use it by that name.

   The Report's caption is a strip of newsprint with torn ends, set in the
   site's serif: no rounded card, no shadow. brand/viewer.css draws the live
   HTML caption the same way, so a recording matches what's on screen. */

import { S } from '../lib/sketch.js';
import { SERIF, tornStrip } from './report.js';

const W = 1280, H = 720;

/* The sentence being said at t. It lingers after its last word unless the
   next one is far off: a long silence clears the screen. */
export function captionAt(T, t) {
  let idx = -1;
  for (let i = 0; i < T.lines.length; i++) { if (T.lines[i].start <= t + .001) idx = i; else break; }
  if (idx < 0) return '';
  const l = T.lines[idx], next = T.lines[idx + 1] ? T.lines[idx + 1].start : T.total;
  return t - l.end > 2.5 && next - l.end > 3 ? '' : l.text;
}

export function burnCaption(g, text, P) {
  if (!text) return;
  S.ts = 1;
  const size = 27, max = 960, lh = 35;
  g.save();
  g.font = `500 ${size}px ${SERIF}`;
  const rows = [];
  let row = '';
  for (const w of text.split(' ')) { const nx = row ? `${row} ${w}` : w; if (g.measureText(nx).width > max && row) { rows.push(row); row = w; } else row = nx; }
  rows.push(row);
  const bw = Math.max(...rows.map((r) => g.measureText(r).width)) + 56, bh = rows.length * lh + 22, by = H - 28 - bh;
  tornStrip(g, W / 2 - bw / 2, by, bw, bh, 9900 + text.length, P, 1);
  g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  rows.forEach((r, i) => g.fillText(r, W / 2, by + 11 + lh / 2 + i * lh + 1));
  g.restore();
}
