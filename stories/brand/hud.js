/* hud.js - what sits on the frame rather than in the world: the phone the
   viewer keeps checking, and the receipts that keep the score at the edge.

   The phone (STYLE.md: the numbers have one home, so the picture stays a
   picture). makePhone({ feed, quiet }) returns { draw, held, glances }:
   - it slides in from the left edge, tilted as if held, when an item lands,
     stays a few seconds and slides away; glances closer than `gap` merge
   - `quiet` is a list of [from, to] the picture needs to itself
   - items, newest on top:
       stat  { t, v: t => string, label (string or t => string), src, c: 'stop'|'ink'|'ok', small? }
       log   { t, path, said?, hit? }    a request in the site's own log, and the answer
       note  { t, text }                 a keyword, in a line
       dl    { t, title, file, dur, list }  a download, the way an app shows one
   A paper-cut phone: flat body, hard offset shadow, hairline rules, serif.

   The receipts: drawReceipts(g, P, alpha, [{ x, k (0..1 of the tape), color, name }]). */

import { smooth, easeIO } from '../lib/sketch.js';
import { mix } from './color.js';
import { serif } from './report.js';

const MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace';
const SERIF_I = (size) => `italic 400 ${size}px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;

function wrap(g, text, size, maxW) {
  g.save(); g.font = SERIF_I(size);
  const out = []; let row = '';
  for (const w of text.split(' ')) { const nx = row ? row + ' ' + w : w; if (g.measureText(nx).width > maxW && row) { out.push(row); row = w; } else row = nx; }
  out.push(row); g.restore(); return out;
}

export function makePhone({ feed, quiet = [], site = 'scale-to-zero.com', hold = 2.9, gap = 1.4, box = { x: 30, y: 84, w: 236, h: 476, r: 32 } }) {
  const glances = (() => {
    const w = feed.map((it) => [it.t - .45, it.t + hold]).sort((p, q) => p[0] - q[0]), out = [];
    for (const x of w) { const l = out[out.length - 1]; if (l && x[0] - l[1] < gap) l[1] = Math.max(l[1], x[1]); else out.push([...x]); }
    let res = out;
    for (const [qa, qb] of quiet) res = res.flatMap(([a, b]) => (b <= qa || a >= qb ? [[a, b]] : [[a, Math.min(b, qa)], [Math.max(a, qb), b]]).filter(([x, y]) => y - x > 1.2));
    return res;
  })();
  const held = (t) => glances.reduce((m, [a, b]) => Math.max(m, smooth(a, a + .55, t) * (1 - smooth(b - .55, b, t))), 0);

  function draw(g, t, P) {
    const o = held(t);
    if (o <= .005) return;
    const e = easeIO(o), { w, h, r } = box, path = (x0, y0, ww, hh, rr) => { g.beginPath(); g.roundRect ? g.roundRect(x0, y0, ww, hh, rr) : g.rect(x0, y0, ww, hh); };
    g.save();
    g.translate(box.x + w / 2 + (1 - e) * -(w + 80), box.y + h / 2 + (1 - e) * 120 + Math.sin(t * 1.1) * 3);
    g.rotate((1 - e) * -.22 + Math.sin(t * .7) * .012);
    g.translate(-w / 2, -h / 2);
    path(6, 7, w, h, r); g.fillStyle = P.grid; g.globalAlpha = .45; g.fill();
    g.globalAlpha = 1; path(0, 0, w, h, r); g.fillStyle = mix(P.ink, P.grid, .15); g.fill();
    const sx = 9, sy = 9, sw = w - 18, sh = h - 18;
    path(sx, sy, sw, sh, r - 8); g.fillStyle = P.card; g.fill();
    g.save(); path(sx, sy, sw, sh, r - 8); g.clip();
    path(w / 2 - 30, sy + 6, 60, 13, 7); g.fillStyle = mix(P.ink, P.grid, .15); g.fill();
    serif(g, site, sx + 14, sy + 38, 15, P.ink, { weight: 700 });
    const live = .5 + .5 * Math.sin(t * 4);
    g.beginPath(); g.arc(sx + sw - 18, sy + 34, 4, 0, 7); g.fillStyle = P.stop; g.globalAlpha = .4 + .6 * live; g.fill(); g.globalAlpha = 1;
    g.fillStyle = P.line; g.fillRect(sx + 12, sy + 50, sw - 24, 1); g.fillRect(sx + 12, sy + 53, sw - 24, 1);
    const shown = feed.filter((it) => t >= it.t);
    let yy = sy + 60;
    for (let k = shown.length - 1; k >= 0; k--) {
      const it = shown[k], inA = smooth(it.t, it.t + .45, t);
      let ih, drawIt;
      if (it.kind === 'stat') {
        const label = typeof it.label === 'function' ? it.label(t) : it.label, lines = wrap(g, label, 14, sw - 28);
        ih = 40 + lines.length * 17 + 20;
        drawIt = (top) => {
          serif(g, it.v(t), sx + 14, top + 36, it.small ? 26 : 34, P[it.c], { weight: 700 });
          lines.forEach((l, i) => serif(g, l, sx + 14, top + 56 + i * 17, 14, P.text, { weight: 400, italic: true }));
          serif(g, it.src, sx + 14, top + 56 + lines.length * 17 + 2, 12, P.muted, { weight: 400 });
        };
      } else if (it.kind === 'dl') {
        ih = 96;
        drawIt = (top) => {
          const p = smooth(it.t + .3, it.t + .3 + it.dur, t), done = p >= 1, list = it.list;
          serif(g, it.title, sx + 14, top + 22, 15, P.ink, { weight: 700, italic: true });
          g.save(); g.font = `400 11.5px ${MONO}`; g.textBaseline = 'middle';
          g.fillStyle = P.muted; g.fillText(it.file, sx + 14, top + 42);
          g.textAlign = 'right'; g.fillStyle = done ? P.stop : P.text; g.fillText(done ? 'downloaded' : `${Math.floor(p * 100)}%`, sx + sw - 14, top + 42);
          g.fillStyle = P.line; g.fillRect(sx + 14, top + 54, sw - 28, 5);
          g.fillStyle = P.stop; g.fillRect(sx + 14, top + 54, (sw - 28) * p, 5);
          g.textAlign = 'left'; g.fillStyle = P.ink;
          const n = Math.floor((t - it.t) * 14), cur = list[((n % list.length) + list.length) % list.length];
          g.globalAlpha *= done ? .55 : 1;
          g.fillText(done ? `${list[0]} … ${list[list.length - 1]}` : cur, sx + 14, top + 76);
          g.restore();
        };
      } else if (it.kind === 'log') {
        ih = 30;
        drawIt = (top) => {
          g.save(); g.font = `400 12px ${MONO}`; g.textBaseline = 'middle';
          g.fillStyle = P.muted; g.fillText('GET', sx + 14, top + 16);
          g.fillStyle = P.ink; g.fillText(it.path, sx + 46, top + 16);
          g.restore();
          serif(g, it.said || '404', sx + sw - 14, top + 16, 13, it.hit ? P.stop : it.said ? P.ok : P.muted, { weight: it.said ? 700 : 400, italic: !!it.said && !it.hit, align: 'right', base: 'middle' });
        };
      } else {
        const lines = wrap(g, it.text, 15, sw - 28);
        ih = 14 + lines.length * 18 + 8;
        drawIt = (top) => lines.forEach((l, i) => serif(g, l, sx + 14, top + 22 + i * 18, 15, P.ink, { weight: 400, italic: true }));
      }
      const top = yy - (1 - easeIO(inA)) * ih;
      g.globalAlpha = k === shown.length - 1 ? inA : 1;
      drawIt(top);
      g.globalAlpha = 1; g.fillStyle = P.line; g.fillRect(sx + 12, top + ih - 3, sw - 24, 1);
      yy = top + ih;
      if (yy > sy + sh) break;
    }
    g.restore(); g.restore();
  }

  return { draw, held, glances };
}

/* The receipts, hanging from the top edge: one tape per address, its length
   what that address has spent. */
export function drawReceipts(g, P, a, tapes, { maxL = 520 } = {}) {
  if (a <= .01) return;
  tapes.forEach(({ x, k, color, name }, i) => {
    const L = maxL * k;
    g.save(); g.globalAlpha = a;
    g.fillStyle = P.card; g.fillRect(x - 22, 0, 44, L);
    g.beginPath(); g.moveTo(x - 22, L); for (let s = 0; s <= 11; s++) g.lineTo(x - 22 + s * 4, L + (s % 2 ? 5 : 0)); g.lineTo(x + 22, L); g.closePath(); g.fill();
    g.strokeStyle = P.line; g.lineWidth = 1; g.strokeRect(x - 22, 0, 44, L);
    g.fillStyle = color; g.globalAlpha = a * .6;
    for (let y = 12; y < L - 6; y += 10) g.fillRect(x - 15, y, 18 + ((y * 7) % 11), 2.4);
    g.restore();
    serif(g, name, x, L + 26, 18, color === P.stop ? P.stop : P.text, { weight: 700, italic: true, align: 'center', alpha: a });
  });
}
