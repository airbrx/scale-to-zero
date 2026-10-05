/* film.js - what the story window and the presenter share: loading the
   script and the voiceover, building the timeline at a given timing, and
   drawing the film at a moment into any canvas of any size. */

import { S, clamp, readPalette } from './sketch.js';
import { parseScript, loadText, loadVoiceover, schedule, scheduleFromVoiceover } from './timeline.js';

export const W = 1280, H = 720;

/* base: the film's folder, from the page. The story window lives in it ('');
   an article embedding the film passes '/films/<slug>/'. */
export async function loadFilm(base = '') {
  const script = parseScript(await loadText(`${base}script.md`));
  // optional: null means script timing only (timeline.js says why in the console)
  const vo = await loadVoiceover(`${base}voiceover.json`);
  return { script, vo, voErr: '' };
}

/* The timeline for a clock. Voiceover that no longer matches the script
   throws with the reason; the caller says so on screen and picks again. */
export function timelineFor(film, BEATS, clock, wpm) {
  if (clock === 'voiceover') {
    if (!film.vo) throw new Error(film.voErr || 'there is no voiceover.json beside the script yet');
    return scheduleFromVoiceover(film.vo, film.script, BEATS);
  }
  return schedule(film.script, BEATS, wpm);
}

/* The palette is re-read a few times a second, so a theme flip in any
   window reaches every canvas within a few frames. */
let PAL = null, palAt = -1e9;
export function palette(now) {
  if (!PAL || now - palAt > 400) { PAL = readPalette(); palAt = now; }
  return PAL;
}
addEventListener('storage', () => { palAt = -1e9; });

/* Size a canvas to its box (or to a fixed pixel size while recording) and
   draw the film at t. Lines and type scale up on a small canvas so a
   thumbnail stays legible; a recording draws at the house weights. */
export function drawFilm(cv, story, t, now, { fixed = null, live = true, rec = false, P: given = null } = {}) {
  const g = cv.getContext('2d');
  if (fixed) { if (cv.width !== fixed[0]) { cv.width = fixed[0]; cv.height = fixed[1]; } }
  else {
    const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round((cv.clientWidth || W) * dpr), h = Math.round(w * 9 / 16);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  const k = (cv.clientWidth || W) / W;
  S.boil = rec ? Math.floor(t * 8) : live ? Math.floor(now / 125) : 0;
  S.rough = 1;
  S.lw = rec ? 1 : clamp(.62 / k, 1, 2.2);
  S.ts = rec ? 1 : clamp(.62 / k, 1, 2.1);
  g.setTransform(cv.width / W, 0, 0, cv.width / W, 0, 0);
  // an embed hands in its own palette; the story window reads the page's
  const P = given || palette(now);
  story.draw(g, t, P);
  return g;
}
