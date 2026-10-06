/* embed.js - a film inside an article.

   The article carries an HTML card (shared/render.mjs) and lib/card.js; when
   the reader presses play, card.js imports this and calls mountFilm(figure).
   Nothing of the film downloads before that.

   It plays the film in the card's own 16:9 box, in the article's page: no
   iframe, no second page. The film draws its own palette (the films' token
   files, read here rather than applied to the page, so the article's CSS is
   never touched) and follows the site's light or dark setting. The voice is
   the clock while it plays; the score and the effects ride it. It draws only
   while playing, or once after a seek, a resize or a theme change, and the
   voice only streams: its level and its speech were measured when it was
   made, so the reader's device never decodes it. */

import { loadFilm, timelineFor, drawFilm } from './film.js';
import { DEFAULT_WPM, fmt } from './timeline.js';
import { captionAt } from './captions.js';
import { createSound } from './sound.js';
import { TOKENS } from './sketch.js';

const ICON = {
  play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z"/></svg>',
  pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="4" height="14"/><rect x="12" y="3" width="4" height="14"/></svg>',
  again: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3a7 7 0 1 1-6.6 4.7l1.9.6A5 5 0 1 0 10 5v3L5.5 4 10 0z"/></svg>',
};

/* The stage palette, light and dark, from the films' own token files: every
   :root first, then every html.dark, as the cascade would apply them. */
export async function palettes() {
  const blocks = [];
  for (const f of ['./tokens.css', '../brand/tokens.css']) {
    const res = await fetch(new URL(f, import.meta.url));
    if (!res.ok) throw new Error(`${f} could not be loaded: HTTP ${res.status}`);
    const css = (await res.text()).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) blocks.push([sel.trim(), body]);
  }
  const read = (sels) => {
    const vars = {};
    for (const want of sels) for (const [sel, body] of blocks) if (sel === want) for (const [, k, v] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[k] = v.trim();
    return vars;
  };
  const make = (vars, dark) => {
    const P = { dark };
    for (const k in TOKENS) {
      if (!vars[TOKENS[k]]) throw new Error(`the films' tokens set no ${TOKENS[k]}`);
      P[k] = vars[TOKENS[k]];
    }
    return P;
  };
  return { light: make(read([':root']), false), dark: make(read([':root', 'html.dark']), true) };
}

/* The site's own setting: data-theme when the reader chose one, else the system's. */
const darkMedia = matchMedia('(prefers-color-scheme: dark)');
const siteDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && darkMedia.matches);
};

export async function mountFilm(fig) {
  const base = new URL(fig.dataset.film, location.href).href;
  // the score has to be started from the click: ask for it before anything else waits
  const sound = createSound();
  const soundReady = sound.start();
  const [pals, film, mod] = await Promise.all([palettes(), loadFilm(base), import(new URL('story.js', base).href)]);
  const T = timelineFor(film, mod.BEATS, film.vo ? 'voiceover' : 'script', DEFAULT_WPM);
  const story = mod.makeStory(T);
  const lead = T.lead || 0;
  // the voice's level and speech come measured (tools/voice.mjs); this player never decodes it
  if (film.vo?.audio && !film.vo.level) throw new Error(`voiceover.json names ${film.vo.audio} but has no level (node stories/tools/voice.mjs <slug> --measure)`);

  /* ---- the stage and the bar ---- */
  const stage = fig.querySelector('.stz-film-stage');
  const cv = document.createElement('canvas');
  cv.className = 'stz-film-cv';
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', fig.querySelector('.stz-film-title')?.textContent || 'The film');
  const cc = document.createElement('p');
  cc.className = 'stz-film-cc'; cc.hidden = true; cc.setAttribute('aria-live', 'polite');
  stage.append(cv, cc);
  const bar = document.createElement('div');
  bar.className = 'stz-film-bar';
  bar.innerHTML = `<button type="button" class="stz-pp" aria-label="Pause">${ICON.pause}</button>
    <input type="range" class="stz-scrub" min="0" max="${T.total.toFixed(2)}" step="0.01" value="0" aria-label="Position in the film">
    <span class="stz-time">0:00 / ${fmt(T.total)}</span>
    <button type="button" class="stz-cc" aria-pressed="true" title="Captions (c)">CC</button>
    <button type="button" class="stz-fs" title="Full screen (f)" aria-label="Full screen">&#x2922;</button>`;
  fig.append(bar);
  const $ = (s) => bar.querySelector(s), pp = $('.stz-pp'), scrub = $('.stz-scrub'), time = $('.stz-time'), ccBtn = $('.stz-cc');
  fig.tabIndex = 0;

  /* ---- the clock: the voice while it plays, the frame clock around it ---- */
  // The voice streams; nothing decodes it here. Its loudness and where it
  // speaks were measured when it was made (tools/voice.mjs, "level").
  const voice = film.vo?.audio ? new Audio(new URL(film.vo.audio, base).href) : null;
  if (voice) { voice.preload = 'auto'; voice.onerror = () => fail(`the voice (${film.vo.audio}) could not be played`); }
  let t = 0, playing = false, ended = false, captions = true, raf = 0, last = performance.now();
  const voiceDrives = () => voice && voice.duration > 0 && t - lead >= 0 && t - lead < voice.duration;
  function syncVoice() {
    if (!voice) return;
    if (playing && voiceDrives()) {
      if (Math.abs(voice.currentTime - (t - lead)) > .25) voice.currentTime = t - lead;
      if (voice.paused) voice.play().catch((e) => fail(`the voice would not play: ${e.message}`));
    } else if (!voice.paused) voice.pause();
  }
  function fail(msg) {
    console.error(`film: ${msg}`);
    cc.textContent = `The film stopped: ${msg}.`; cc.hidden = false;
    setPlaying(false);
  }
  function setPlaying(v) {
    if (v && t >= T.total - .01) seek(0);
    playing = v; ended = false;
    syncVoice();
    pp.innerHTML = playing ? ICON.pause : ICON.play;
    pp.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    kick();
  }
  function seek(v) {
    t = Math.min(T.total, Math.max(0, v));
    if (voice && Math.abs(voice.currentTime - Math.max(0, t - lead)) > .25) voice.currentTime = Math.min(Math.max(0, t - lead), voice.duration || 0);
    syncVoice(); kick();
  }

  /* ---- drawing: only while playing, or once when something changed ---- */
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (playing) {
      if (voiceDrives() && !voice.paused) t = voice.currentTime + lead;
      else { t += dt; syncVoice(); }
      if (t >= T.total) { t = T.total; playing = false; ended = true; syncVoice(); pp.innerHTML = ICON.again; pp.setAttribute('aria-label', 'Play again'); }
    }
    drawFilm(cv, story, t, now, { P: siteDark() ? pals.dark : pals.light, live: playing });
    if (sound.ready()) sound.update(t, playing, story);
    const text = captions ? captionAt(T, t) : '';
    if (cc.textContent !== text) { cc.textContent = text; cc.hidden = !text; }
    if (document.activeElement !== scrub) scrub.value = t.toFixed(2);
    time.textContent = `${fmt(t)} / ${fmt(T.total)}`;
    if (playing) raf = requestAnimationFrame(frame);
  }

  /* ---- controls ---- */
  pp.onclick = () => setPlaying(!playing);
  scrub.oninput = () => seek(+scrub.value);
  ccBtn.onclick = () => { captions = !captions; ccBtn.setAttribute('aria-pressed', String(captions)); kick(); };
  $('.stz-fs').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else fig.requestFullscreen().catch((e) => console.warn(`film: full screen refused: ${e.message}`));
  };
  cv.onclick = () => setPlaying(!playing);
  fig.addEventListener('keydown', (e) => {
    if (e.target === scrub && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') setPlaying(!playing);
    else if (k === 'arrowleft') seek(t - 5);
    else if (k === 'arrowright') seek(t + 5);
    else if (k === 'c') ccBtn.click();
    else if (k === 'f') $('.stz-fs').click();
    else return;
    e.preventDefault();
  });
  new ResizeObserver(kick).observe(stage);
  darkMedia.addEventListener('change', kick);
  new MutationObserver(kick).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (voice) voice.addEventListener('ended', () => { if (playing && t < T.total) syncVoice(); });

  /* ---- go: the score if the browser allows it, then play ---- */
  try {
    await soundReady;
    sound.set('music', true); sound.set('fx', true);
    if (voice) sound.attach(voice, film.vo.level);
  } catch (e) {
    // the film still plays, voice and picture, without the score
    console.error(`film: the score could not start: ${e.message}`);
  }
  setPlaying(true);
  fig.focus({ preventScroll: true });
  return { get t() { return t; }, get ended() { return ended; } };
}
