/* loudness.js - how loud something is, the way broadcast measures it, and
   where a voice is speaking. Pure functions over Float32Arrays, so the
   engine (in the browser), the export and the check tool (in Node) all
   measure the same way.

   lufs() is ITU-R BS.1770-4 integrated loudness: K-weighting (a high
   shelf and a high-pass, so bass counts for less and presence for more,
   like an ear), 400 ms blocks overlapping by 75%, an absolute gate at
   -70 LUFS and a relative gate 10 LU under the ungated mean. Mono or a
   list of channels. */

function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
// the BS.1770 K-weighting filters, for any sample rate
function kWeights(sr) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = .7071752369554196;
  let K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, .4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = .5003270373238773; K = Math.tan(Math.PI * f0 / sr);
  a0 = 1 + K / Q + K * K;
  const hp = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, hp];
}
const toLufs = (ms) => -.691 + 10 * Math.log10(ms + 1e-12);

/* Mean-square per 400 ms block (100 ms hop), K-weighted, channels summed. */
function blocks(chans, sr, from = 0, to = Infinity) {
  const [shelf, hp] = kWeights(sr), a = Math.max(0, Math.floor(from * sr)), b = Math.min(chans[0].length, Math.floor(to * sr));
  const weighted = chans.map((c) => biquad(biquad(c.subarray(a, b), shelf), hp));
  const n = Math.floor(.4 * sr), hop = Math.floor(.1 * sr), out = [];
  for (let s = 0; s + n <= b - a; s += hop) {
    let sum = 0;
    for (const w of weighted) { let z = 0; for (let i = s; i < s + n; i++) z += w[i] * w[i]; sum += z / n; }
    out.push(sum);
  }
  return out;
}

/* Integrated loudness in LUFS, of [from, to) seconds (all of it by default). */
export function lufs(chans, sr, from = 0, to = Infinity) {
  if (!Array.isArray(chans)) chans = [chans];
  const bl = blocks(chans, sr, from, to).filter((z) => toLufs(z) > -70);
  if (!bl.length) return -Infinity;
  const rel = toLufs(bl.reduce((a, b) => a + b, 0) / bl.length) - 10;
  const gated = bl.filter((z) => toLufs(z) > rel);
  return toLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/* Loudness of just the moments where `pick(t)` is true, ungated: what the
   music measures under the voice, or between its lines. */
export function lufsWhere(chans, sr, pick, from = 0, to = Infinity) {
  if (!Array.isArray(chans)) chans = [chans];
  const bl = blocks(chans, sr, from, to), kept = [];
  bl.forEach((z, i) => { if (pick(from + i * .1 + .2)) kept.push(z); });
  return kept.length ? toLufs(kept.reduce((a, b) => a + b, 0) / kept.length) : -Infinity;
}

export function peakDb(chans) {
  if (!Array.isArray(chans)) chans = [chans];
  let p = 0; for (const c of chans) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return 20 * Math.log10(p + 1e-12);
}

/* Where a voice is speaking: RMS over 50 ms windows against a threshold
   set from the voice itself (18 dB under its loud windows), so a quiet
   take and a hot one read the same. `lead` starts the duck before a
   sentence; `hold` keeps it through pauses shorter than that, so the
   music lifts only in a real gap. Returns speaking(t), t in the voice's
   own seconds. */
export function speechMap(chans, sr, { win = .05, lead = .25, hold = .8 } = {}) {
  if (!Array.isArray(chans)) chans = [chans];
  const n = Math.floor(win * sr), count = Math.ceil(chans[0].length / n), rms = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    let s = 0, k = 0;
    for (let i = w * n; i < Math.min(chans[0].length, (w + 1) * n); i++, k++) { let v = 0; for (const c of chans) v += c[i]; v /= chans.length; s += v * v; }
    rms[w] = k ? Math.sqrt(s / k) : 0;
  }
  const sorted = Array.from(rms).filter((x) => x > 1e-5).sort((a, b) => a - b);
  const loud = sorted.length ? sorted[Math.floor(sorted.length * .9)] : 0, thr = loud * Math.pow(10, -18 / 20);
  const on = rms.map((x) => (x > thr ? 1 : 0));
  return (t) => {
    const a = Math.max(0, Math.floor((t - hold) / win)), b = Math.min(count - 1, Math.floor((t + lead) / win));
    for (let w = a; w <= b; w++) if (on[w]) return true;
    return false;
  };
}
