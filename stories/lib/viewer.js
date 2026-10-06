/* viewer.js - the story window: watch it like a video, record it like a reel.

   Normal mode is a video player: a stage, and a bar with play, beat
   stepping, a scrubber marked by beat, captions, theme, Presenter and
   Record. The film is one function of time, so every control just picks t.

   Record opens the play tile: pick the clock
   (voiceover.json, or the script at a reading speed shared with the
   prompter), optionally load a take to hear it in sync, check the
   recording frame, then space runs it hands-free over a 16:9 frame pinned
   to the top-left of the screen in physical pixels, for OBS. The first
   frame holds HEAD seconds before 0:00 and the last TAIL seconds after, for
   trimming. w instead records it in the browser in real time (MP4 where
   the browser can, else WebM) with the captions burned in, and e exports a
   frame-perfect MP4 offline (lib/export.js): every frame drawn at its exact
   moment and the soundtrack rendered rather than recorded.

   With the audio loaded, the audio element is the clock (t is its
   currentTime), so voice and picture cannot drift. With the presenter open,
   the two windows share one clock (lib/sync.js): start, pause or scrub in
   either and the other follows. ?autoplay opens on the tile (the
   presenter's "Open story window"); ?embed&t=N is just the stage, paused at
   N (the gallery's card). */

import { clamp } from './sketch.js';
import { readWpm, saveWpm, fmt, id2 } from './timeline.js';
import { loadFilm, timelineFor, drawFilm, palette } from './film.js';
import { captionAt, burnCaption } from './captions.js';
import { exportMp4, decodeVoice, frameCount, FPS, WIDTH, HEIGHT } from './export.js';
import { link } from './sync.js';
import { createSound } from './sound.js';

const HEAD = 3, TAIL = 3;
const CC_KEY = 'airbrx-stories:captions', SOUND_KEY = 'airbrx-stories:sound';

const ICON = {
  play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z"/></svg>',
  pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="3" width="4" height="14" rx="1"/><rect x="12" y="3" width="4" height="14" rx="1"/></svg>',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function mountViewer({ slug, title, BEATS, makeStory }) {
  const q = new URLSearchParams(location.search);
  const EMBED = q.has('embed');
  document.body.insertAdjacentHTML('beforeend', EMBED ? '<canvas id="cv" class="embed-cv"></canvas>' : shell(title));
  const $ = (id) => document.getElementById(id);
  const cv = $('cv');

  const film = await loadFilm();
  let wpm = readWpm(slug), clock = film.vo ? 'voiceover' : 'script', T, story, timingErr = film.voErr;
  function build() {
    try { T = timelineFor(film, BEATS, clock, wpm); }
    catch (e) {
      if (clock !== 'voiceover') throw e;
      timingErr = `Voiceover timing unusable: ${e.message}`; console.error('viewer:', e);
      clock = 'script'; T = timelineFor(film, BEATS, clock, wpm);
    }
    story = makeStory(T);
  }
  build();

  let t = clamp(+(q.get('t') || 0), 0, T.total);

  if (EMBED) {
    document.documentElement.classList.add('embed');
    // a still: drawn once, and again only when its size, the theme or the type changes
    const paint = () => drawFilm(cv, story, t, performance.now(), { live: false });
    paint();
    addEventListener('resize', paint);
    new MutationObserver(paint).observe(document.documentElement, { attributes: true });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
    document.fonts.ready.then(paint);
    return;
  }

  const errEl = $('err');
  const fail = (msg, e) => { console.error(`viewer: ${msg}`, e || ''); errEl.textContent = msg; errEl.hidden = false; clearTimeout(fail.h); fail.h = setTimeout(() => { errEl.hidden = true; }, 9000); };
  if (timingErr) fail(timingErr);
  // the studio, served by the local admin: a draft film can be sent to staging from here (stage.js)
  if (!document.documentElement.classList.contains('published')) {
    import('./stage.js').then((m) => m.stagingButton({ beside: $('rec'), fail }))
      .catch((e) => fail(`The staging button could not load: ${e.message}`, e));
  }

  let playing = false, mode = null, holdUntil = 0, lastSend = 0, webm = null, cc = true, xp = null;
  try { cc = localStorage.getItem(CC_KEY) !== 'off'; } catch (e) { console.warn('viewer: localStorage unavailable', e); }
  const audio = new Audio();

  /* The score and the sound effects (lib/sound.js). Audio can only start
     from a click, so every way of starting playback asks for it. */
  const sound = createSound();
  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { console.warn('viewer: localStorage unavailable', e); }
  function wantSound() {
    if (!soundOn) return Promise.resolve();
    return sound.start(story.music).then(() => {
      sound.set('music', true); sound.set('fx', true);
      if (audio.src) sound.attach(audio, audioName === film.vo?.audio ? film.vo.level ?? null : null);
    }).catch((e) => fail(`Sound could not start: ${e.message}`, e));
  }
  function setSound(v) {
    soundOn = v;
    try { localStorage.setItem(SOUND_KEY, v ? 'on' : 'off'); } catch (e) { console.warn('viewer: could not save sound setting', e); }
    if (v) wantSound(); else { sound.set('music', false); sound.set('fx', false); }
    paintBar(true);
  }
  let audioName = '', audioFile = null;
  if (clock === 'voiceover' && film.vo.audio) {
    audio.src = new URL(film.vo.audio, location.href).href; audio.preload = 'auto'; audioName = film.vo.audio;
    audio.onloadedmetadata = () => checkLength();
    audio.onerror = () => fail(film.vo.audio + ' could not be played as audio.');
  }
  async function fetchVoice(url, name) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(name + ' could not be fetched for the export: HTTP ' + res.status);
    return new File([await res.blob()], name);
  }
  /* Where the narrator's first word lands in the loaded file. A take has
     dead air and false starts before it, so under script timing the audio is
     placed by that word: audio time = t - firstWord + voiceStart. Under
     voiceover timing the alignment's times already are audio times. */
  const VS_KEY = `airbrx-story-${slug}:voice-start`;
  const firstWord = (TT = T) => (TT.lines.length ? TT.lines[0].start : 0);
  let voiceStart = null;
  try { const v = localStorage.getItem(VS_KEY); if (v !== null && v !== '' && isFinite(+v)) voiceStart = +v; } catch (e) { console.warn('viewer: localStorage unavailable', e); }
  // the film time at which the file's 0:00 plays
  const voiceAt = (TT = T, c = clock) => (c === 'voiceover' ? (TT.lead || 0) : firstWord(TT) - (voiceStart ?? firstWord(TT)));

  const sync = link(slug, applyRemote);
  const stateNow = () => ({ t, playing: playing && !holdUntil, clock, wpm });
  sync.watch(stateNow);
  const announce = () => sync.lead(stateNow);

  /* ---- clock ---- */
  // the audio clock runs while the playhead is inside the file; before its
  // 0:00 (a voice placed later than the film's start) the film clock runs
  // and the audio waits
  const audioDrives = () => !!audio.src && audio.duration > 0 && t - voiceAt() >= 0 && t - voiceAt() < audio.duration;
  function syncAudio() {
    if (!audio.src) return;
    if (playing && !holdUntil && audioDrives()) {
      if (Math.abs(audio.currentTime - (t - voiceAt())) > .25) audio.currentTime = t - voiceAt();
      if (audio.paused) audio.play().catch((e) => fail(`The audio would not play: ${e.message}`, e));
    } else if (!audio.paused) audio.pause();
  }
  function seek(v) {
    t = clamp(v, 0, T.total);
    // only move the audio when it is really elsewhere: a follower is re-seeked twice a second
    const at = Math.max(0, t - voiceAt());
    if (audio.src && Math.abs(audio.currentTime - at) > .25) audio.currentTime = Math.min(at, audio.duration || at);
    syncAudio();
  }
  function setPlaying(v) {
    playing = v;
    if (playing && t >= T.total - .01) seek(0);
    syncAudio(); paintBar();
  }
  function rebuild(keep = true) {
    const place = keep ? T.where(t) : null;
    build(); renderTimeline();
    if (place) seek(T.timeAt(place));
  }
  function applyRemote(m) {
    if (xp) return; // an export owns the window until it ends
    if (m.clock !== clock || m.wpm !== wpm) { clock = m.clock; wpm = m.wpm; rebuild(false); }
    if (m.playing && mode === 'tile') run(false);
    seek(m.t);
    if (m.playing !== playing) setPlaying(m.playing);
  }

  /* ---- the bar ---- */
  const segs = $('segs'), fill = $('fill'), tip = $('tip'), scrub = $('scrub');
  function renderTimeline() {
    segs.innerHTML = T.beats.map((b) => `<i style="flex:${b.dur}" title="${esc(b.title)}"></i>`).join('');
    $('bcount').textContent = String(T.beats.length).padStart(2, '0');
    paintBar(true);
  }
  let lastK = -1;
  let lastPlaying = null;
  function paintBar(force) {
    if (playing !== lastPlaying || force) {
      lastPlaying = playing;
      $('pp').innerHTML = playing ? ICON.pause : ICON.play;
      $('pp').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
    $('bigplay').hidden = playing || mode !== null;
    const k = T.beatIndexAt(t), b = T.beats[k];
    if (k !== lastK || force) {
      lastK = k;
      $('bn').textContent = id2(b.n); $('btitle').textContent = b.title; $('beatlabel').textContent = b.title;
      [...segs.children].forEach((el, i) => el.classList.toggle('on', i === k));
    }
    fill.style.width = `${100 * t / T.total}%`;
    $('time').textContent = `${fmt(t)} / ${fmt(T.total)}`;
    $('cc').classList.toggle('on', cc);
    $('snd').classList.toggle('on', soundOn);
    $('theme').textContent = window.storyTheme.get() === 'dark' ? '◐ Light' : '◐ Dark';
  }
  const tAtX = (x) => { const r = scrub.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * T.total; };
  let dragging = false;
  scrub.addEventListener('pointerdown', (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); seek(tAtX(e.clientX)); announce(); });
  scrub.addEventListener('pointermove', (e) => {
    const tt = tAtX(e.clientX), b = T.beats[T.beatIndexAt(tt)], r = scrub.getBoundingClientRect();
    tip.textContent = `${fmt(tt)} · ${b.title}`; tip.style.left = `${clamp(e.clientX - r.left, 40, r.width - 40)}px`; tip.hidden = false;
    if (dragging) { seek(tt); announce(); }
  });
  scrub.addEventListener('pointerup', () => { dragging = false; });
  scrub.addEventListener('pointerleave', () => { if (!dragging) tip.hidden = true; });

  const toggle = () => { if (!playing) wantSound(); setPlaying(!playing); announce(); };
  function step(d) {
    const k = T.beatIndexAt(t), b = T.beats[k];
    if (d < 0 && t - b.start > 1.5) seek(b.start);
    else seek(T.beats[clamp(k + d, 0, T.beats.length - 1)].start);
    announce();
  }
  $('pp').onclick = toggle;
  $('bigplay').onclick = toggle;
  $('prev').onclick = () => step(-1);
  $('next').onclick = () => step(1);
  $('cc').onclick = () => { cc = !cc; try { localStorage.setItem(CC_KEY, cc ? 'on' : 'off'); } catch (e) { console.warn('viewer: could not save captions', e); } paintBar(); };
  $('theme').onclick = () => { window.storyTheme.toggle(); paintBar(); };
  addEventListener('storage', () => paintBar());
  $('rec').onclick = () => openTile();
  $('snd').onclick = () => setSound(!soundOn);
  $('info').onclick = () => $('infobox').classList.toggle('on');
  $('infobox').addEventListener('click', (e) => { if (e.target.id === 'infobox' || e.target.closest('[data-close]')) $('infobox').classList.remove('on'); });
  cv.addEventListener('click', () => { if (!mode) toggle(); });

  /* ---- the play tile and the recording frame ---- */
  const tile = $('tile'), curtain = $('curtain');
  let frame = { w: 0, h: 0, sw: 0, sh: 0 };
  function sizeFrame() {
    const dpr = devicePixelRatio || 1, sw = Math.round(screen.width * dpr), sh = Math.round(screen.height * dpr);
    let w = sw, h = Math.floor(w * 9 / 16);
    if (h > sh) { h = sh; w = Math.floor(h * 16 / 9); }
    w -= w % 2; h -= h % 2;
    frame = { w, h, sw, sh };
    document.documentElement.style.setProperty('--fw', `${w / dpr}px`);
    document.documentElement.style.setProperty('--fh', `${h / dpr}px`);
  }
  const isFull = () => !!document.fullscreenElement || (innerWidth >= screen.width && innerHeight >= screen.height);
  addEventListener('resize', () => { sizeFrame(); if (mode === 'tile') drawTile(); });
  sizeFrame();

  function openTile(done = false) {
    setPlaying(false);
    mode = 'tile';
    document.body.classList.add('rec', 'tiled');
    tile.classList.add('on');
    drawTile(done);
  }
  function drawTile(done) {
    const vo = film.vo, voOk = vo && !/Voiceover timing unusable/.test(timingErr || '');
    const scriptTotal = timelineFor(film, BEATS, 'script', wpm).total;
    tile.innerHTML = `<div class="pt-card">
      <div class="pt-k">${done ? 'Done' : 'Ready to record'}</div>
      <div class="pt-t">${esc(title)}</div>
      <div class="pt-row">
        <button class="pt-opt ${clock === 'voiceover' ? 'on' : ''}" data-c="voiceover" ${voOk ? '' : 'disabled'}>
          <b>Voiceover timing</b><span>${voOk ? `${esc(vo.source)} · ${fmt(vo.duration / 1000)}` : esc(timingErr || 'no voiceover.json yet')}</span></button>
        <button class="pt-opt ${clock === 'script' ? 'on' : ''}" data-c="script">
          <b>Script timing</b><span>${wpm} wpm · ${fmt(scriptTotal)} &nbsp;<kbd>↑</kbd><kbd>↓</kbd></span></button>
      </div>
      <div class="pt-audio">
        <label class="pt-load">${audioName ? '&#9835; ' + esc(audioName) : 'Load a take to hear it in sync'}<input type="file" accept="audio/*" hidden></label>${audioName ? '<button class="btn" id="pt-clear" type="button" title="Unload the voiceover and forget where it starts">Clear</button>' : ''}
        <span>${audioName ? (clock === 'voiceover' ? 'The audio is the clock, placed by voiceover.json.' : 'The audio is the clock, placed by its first word.') : 'Optional. Not needed for a screen recording.'}</span>
      </div>
      <div class="pt-audio"><label class="pt-check">Voice starts at <input type="number" id="pt-vs" class="pt-num" min="0" step="0.05" value="${(voiceStart ?? firstWord()).toFixed(2)}" ${clock === 'voiceover' ? 'disabled' : ''}> s</label>
        <span>${clock === 'voiceover' ? 'Not used: voiceover.json already places the audio.' : `Where the first word lands in the file: voice ${(voiceStart ?? firstWord()).toFixed(1)} s → film ${fmt(firstWord())}.${voiceAt() < 0 ? ` The first ${(-voiceAt()).toFixed(1)} s of the file are skipped.` : voiceAt() > 0 ? ` The file waits ${voiceAt().toFixed(1)} s.` : ''}`}</span></div>
      <div class="pt-audio"><label class="pt-check"><input type="checkbox" id="pt-cc" ${cc ? 'checked' : ''}> Captions in the recording</label>
        <label class="pt-check"><input type="checkbox" id="pt-snd" ${soundOn ? 'checked' : ''}> Music and sound effects</label></div>
      <div class="pt-frame">Recording frame <b>${frame.w}×${frame.h}</b> at the top-left of a ${frame.sw}×${frame.sh} screen.
        ${isFull() ? '<span class="ok">Full screen ✓</span>' : '<span class="warn">Not full screen: press f (or F11) first, or the frame sits below the browser bar.</span>'}<br>
        OBS: canvas and output ${frame.w}×${frame.h}, Display Capture at position 0,0.${frame.sh > frame.h ? ` The bottom ${frame.sh - frame.h}px of the screen falls outside it.` : ''}</div>
      <div class="pt-go"><kbd>space</kbd> ${done ? 'play again' : 'start'} &nbsp;·&nbsp; <kbd>w</kbd> record a video in real time &nbsp;·&nbsp; <kbd>esc</kbd> leave</div>
      <div class="pt-export"><button class="btn pri" type="button" id="pt-export">Export MP4</button>
        <span><kbd>e</kbd> ${WIDTH}×${HEIGHT} at ${FPS} fps, every frame drawn at its exact moment: ${cc ? 'captions burned in' : 'no captions'}, ${soundOn ? 'music and effects' : 'no music or effects'}${audioName ? ', ' + esc(audioName) : ''}. Takes longer than the film; nothing to screen-record.</span></div>
      <div class="pt-sub">${T.beats.length} beats · ${fmt(T.total)}. The tile and the pointer vanish on start. The first frame holds ${HEAD}s before 0:00 and the last ${TAIL}s after, for trimming. Starting the presenter starts this too.</div>
    </div>`;
    tile.querySelectorAll('.pt-opt').forEach((b) => { b.onclick = () => { clock = b.dataset.c; rebuild(false); seek(0); drawTile(done); announce(); }; });
    tile.querySelector('#pt-snd').onchange = (e) => { setSound(e.target.checked); drawTile(done); };
    tile.querySelector('#pt-cc').onchange = (e) => { cc = e.target.checked; try { localStorage.setItem(CC_KEY, cc ? 'on' : 'off'); } catch (err) { console.warn('viewer: could not save captions', err); } drawTile(done); };
    tile.querySelector('#pt-export').onclick = () => exportFile();
    tile.querySelector('#pt-vs').onchange = (e) => {
      const v = +e.target.value;
      if (e.target.value === '' || !isFinite(v) || v < 0) { fail('Voice starts at needs a time in seconds, 0 or more.'); e.target.value = (voiceStart ?? firstWord()).toFixed(2); return; }
      voiceStart = v;
      try { localStorage.setItem(VS_KEY, String(v)); } catch (err) { console.warn('viewer: could not save the voice start', err); }
      seek(t); checkLength(); drawTile(done);
    };
    const clr = tile.querySelector('#pt-clear');
    if (clr) clr.onclick = () => {
      audio.pause();
      if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      audio.removeAttribute('src'); audio.load();
      audioName = ''; audioFile = null; voiceStart = null;
      try { localStorage.removeItem(VS_KEY); } catch (err) { console.warn('viewer: could not forget the voice start', err); }
      tile.querySelector('input[type=file]').value = '';
      drawTile(done);
    };
    tile.querySelector('input[type=file]').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      audio.src = URL.createObjectURL(f); audioName = f.name; audioFile = f;
      if (sound.ready()) sound.attach(audio);
      audio.onloadedmetadata = checkLength;
      audio.onerror = () => fail(`${f.name} could not be played as audio.`);
      drawTile(done);
    };
  }
  // The film runs a few seconds past the voice on purpose (the end card and
  // the logo play out after the last word), so ending early is normal. Warn
  // only when the voice would run past the film and be cut, or ends so early
  // that it is surely placed wrong.
  function checkLength() {
    if (!audio.src || !(audio.duration > 0)) return;
    const end = voiceAt() + audio.duration;
    if (end > T.total + .5) fail(`${audioName}, placed as set, ends at ${fmt(end)} but the film runs ${fmt(T.total)}, so the end of the voice would be cut. Check Voice starts at, or align a voiceover.json to this take and pick Voiceover timing.`);
    else if (end < T.total - 10) fail(`${audioName}, placed as set, ends at ${fmt(end)}, well before the film's end at ${fmt(T.total)}. Check Voice starts at, or align a voiceover.json to this take and pick Voiceover timing.`);
  }
  /* From the tile: hide it, hold the first frame, then run. A start from the
     presenter skips the hold, since its own three-count already gave one. */
  function run(hold = true) {
    if (hold) wantSound();
    mode = 'run';
    tile.classList.remove('on');
    document.body.classList.remove('tiled');
    seek(0);
    holdUntil = hold ? performance.now() + HEAD * 1000 : 0;
    setPlaying(true);
    if (hold) announce();
  }
  function leave() {
    if (webm) { webm.cancel = true; webm.rec.stop(); }
    mode = null; holdUntil = 0; setPlaying(false); announce();
    document.body.classList.remove('rec', 'tiled');
    tile.classList.remove('on'); curtain.classList.remove('on');
  }
  function finished() {
    setPlaying(false);
    if (webm) { setTimeout(() => webm && webm.rec.stop(), TAIL * 1000); return; }
    if (mode === 'run') setTimeout(() => { if (mode === 'run' && !playing) openTile(true); }, TAIL * 1000);
  }

  /* A video in the browser, in real time: a fixed 1920x1080 render with
     the audio if loaded and the captions burned in, since on screen they are
     HTML. MP4 where MediaRecorder can write it (Chrome, Edge), else WebM;
     the file is named by the container it really is. */
  async function recordLive() {
    if (!cv.captureStream || !window.MediaRecorder) { fail('This browser cannot record a canvas. Use Chrome or Edge, or a screen recorder.'); return; }
    const stream = cv.captureStream(30);
    if (soundOn) {
      // the score, the effects and the voiceover all leave through one output
      await wantSound();
      if (!sound.ready()) return;
      sound.stream().getAudioTracks().forEach((tr) => stream.addTrack(tr));
    } else if (audio.src) {
      const as = audio.captureStream ? audio.captureStream() : audio.mozCaptureStream ? audio.mozCaptureStream() : null;
      if (!as) { fail('This browser cannot put the loaded audio into a recording. Use Chrome or Edge.'); return; }
      as.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    }
    const withAudio = stream.getAudioTracks().length > 0;
    const types = withAudio
      ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1.42e01e,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d0028', 'video/mp4;codecs=avc1.42e01e', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const type = types.find((m) => MediaRecorder.isTypeSupported(m));
    if (!type) { fail('This browser can record neither MP4 nor WebM from a canvas. Use Chrome or Edge, or a screen recorder.'); return; }
    const container = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    const chunks = [], rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    webm = { rec, cancel: false };
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => fail(`Recording failed: ${e.error ? e.error.message : 'unknown error'}`, e);
    rec.onstop = () => {
      const cancelled = webm.cancel;
      webm = null;
      if (mode) openTile(true);
      if (cancelled) return;
      save(new Blob(chunks, { type: type.split(';')[0] }), `${slug}${audioName ? '' : '-silent'}.${container}`);
    };
    rec.start(1000);
    run(true);
  }
  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  /* The MP4 export, offline (lib/export.js). It draws a fresh copy of the
     story, re-imported with the script so an edit since the page loaded is
     in the file, at the timing chosen on the tile, into a canvas of its own:
     the stage, the clock and the presenter are left exactly where they were. */
  const xpEl = $('xport');
  async function exportFile() {
    if (xp || webm) return;
    const ac = new AbortController(), canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = HEIGHT;
    xp = { ac, started: performance.now() };
    xpEl.innerHTML = `<div class="pt-card">
      <div class="pt-k">Exporting MP4</div>
      <div class="pt-t">${esc(title)}</div>
      <div class="xp-view"></div>
      <div class="xp-bar"><i id="xp-fill"></i></div>
      <div class="xp-row"><span id="xp-text">Loading the story…</span><button class="btn" type="button" id="xp-cancel">Cancel <kbd>esc</kbd></button></div>
    </div>`;
    xpEl.querySelector('.xp-view').appendChild(canvas);
    xpEl.classList.add('on');
    $('xp-cancel').onclick = () => ac.abort();
    const say = (text, frac) => { $('xp-text').textContent = text; if (frac !== undefined) $('xp-fill').style.width = `${(100 * frac).toFixed(1)}%`; };
    try {
      if (soundOn) await wantSound(); // a live start must not land inside the offline render
      const fresh = await freshStory();
      const voice = audioFile ? await decodeVoice(audioFile) : audioName && !audio.src.startsWith('blob:') ? await decodeVoice(await fetchVoice(audio.src, audioName)) : null;
      say(`${fmt(fresh.T.total)} · ${frameCount(fresh.T.total)} frames`, 0);
      const blob = await exportMp4({
        story: fresh.story, T: fresh.T, captions: cc, music: soundOn, fx: soundOn, voice, voiceAt: voiceAt(fresh.T), canvas, signal: ac.signal,
        onProgress: ({ phase, done, total }) => {
          const el = (performance.now() - xp.started) / 1000;
          if (phase === 'audio') say(`Mixing the soundtrack · ${Math.round(100 * done)}% · ${fmt(el)} elapsed`, done);
          else if (phase === 'video') {
            const left = (total - done) * el / Math.max(done, 1);
            say(`Frame ${done} / ${total} · ${fmt(el)} elapsed · about ${fmt(left)} left`, done / total);
            if (done === 1) xp.started = performance.now();   // the video ETA is the video's own
          } else say('Writing the file…', 1);
        },
      });
      closeExport();
      save(blob, `${slug}.mp4`);
      openTile(true);
      tile.querySelector('.pt-k').textContent = `Saved ${slug}.mp4 · ${(blob.size / 1048576).toFixed(1)} MB`;
    } catch (e) {
      closeExport();
      if (e.name === 'AbortError') return;
      fail(`The MP4 export failed: ${e.message}`, e);
    }
  }
  function closeExport() { xp = null; xpEl.classList.remove('on'); xpEl.innerHTML = ''; }
  /* The story as it is on disk now, at the clock and speed the tile shows. */
  async function freshStory() {
    const url = new URL(`story.js?export=${Date.now()}`, location.href).href;
    let mod;
    try { mod = await import(url); }
    catch (e) { throw new Error(`story.js could not be re-imported for the export: ${e.message}`); }
    const f = await loadFilm(), T2 = timelineFor(f, mod.BEATS, clock, wpm);
    return { T: T2, story: mod.makeStory(T2) };
  }

  /* ---- keys ---- */
  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key;
    // an export or a running take claims only the keys it uses; F12, Ctrl+Shift+I and the rest still reach the browser
    if (xp) { if (k === 'Escape') { xp.ac.abort(); e.preventDefault(); } return; }
    if (k === 'Escape') { if ($('infobox').classList.contains('on')) $('infobox').classList.remove('on'); else if (mode) leave(); return; }
    if (mode === 'tile') {
      if (k === ' ') run(true);
      else if (k === 'w' || k === 'W') recordLive();
      else if (k === 'e' || k === 'E') exportFile();
      else if (k === 'ArrowUp' || k === 'ArrowDown') { wpm = clamp(wpm + (k === 'ArrowUp' ? 5 : -5), 80, 260); saveWpm(slug, wpm); clock = 'script'; rebuild(false); drawTile(); announce(); }
      else if (k === 'f') document.documentElement.requestFullscreen().catch((err) => fail(`Full screen refused: ${err.message}`, err));
      else return;
      e.preventDefault(); return;
    }
    if (mode === 'run') { if (k === ' ') { toggle(); e.preventDefault(); } return; }
    if (k === ' ' || k === 'k') toggle();
    else if (k === 'ArrowRight') step(1);
    else if (k === 'ArrowLeft') step(-1);
    else if (k === 'l') { seek(t + 5); announce(); }
    else if (k === 'j') { seek(t - 5); announce(); }
    else if (k === 'Home') { seek(0); announce(); }
    else if (k === 'End') { seek(T.total); announce(); }
    else if (k === 'c') $('cc').click();
    else if (k === 's') $('snd').click();
    else if (k === 't') $('theme').click();
    else if (k === 'p') openTile();
    else if (k === 'i') $('info').click();
    else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch((err) => fail(`Full screen refused: ${err.message}`, err)); }
    else return;
    e.preventDefault();
  });
  // In full screen the first Esc only leaves full screen, so leaving it ends a run too.
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && mode === 'run' && !webm) leave(); });

  /* ---- captions ---- */
  const capEl = $('caption');

  /* ---- frame ---- */
  let last = performance.now(), lastCap = null, lastSig = null, lastStory = null;
  const darkMedia = matchMedia('(prefers-color-scheme: dark)');
  function tick(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    // an export has the main thread; the stage holds still until it ends
    if (xp) { requestAnimationFrame(tick); return; }
    if (playing) {
      if (holdUntil) { if (now >= holdUntil) { holdUntil = 0; syncAudio(); } }
      else {
        if (audioDrives() && !audio.paused) t = audio.currentTime + voiceAt();
        else { t += dt; if (audio.src && audio.paused && audioDrives()) syncAudio(); }
        if (t >= T.total) { t = T.total; finished(); }
      }
      if (sync.leading() && now - lastSend > 500) { lastSend = now; sync.send(); }
    }
    // Paused, it draws only when something it shows has changed (the time,
    // the size, the theme, the captions): nothing runs while nobody's watching.
    const html = document.documentElement;
    const sig = playing || webm || holdUntil ? null : `${t}|${cv.clientWidth}|${html.className}|${html.dataset.theme}|${darkMedia.matches}|${cc}|${story === lastStory}`;
    lastStory = story;
    if (sig !== null && sig === lastSig) { paintBar(); requestAnimationFrame(tick); return; }
    lastSig = sig;
    try {
      const g = drawFilm(cv, story, t, now, { fixed: webm ? [1920, 1080] : null, rec: !!webm, live: playing });
      sound.update(t, playing && !holdUntil, story);
      const text = cc ? captionAt(T, t) : '';
      if (webm) burnCaption(g, text, palette(now));
      if (text !== lastCap) { capEl.textContent = text; capEl.hidden = !text || !!webm; lastCap = text; }
    } catch (e) { playing = false; fail(`The film failed to draw at ${t.toFixed(2)}s: ${e.message}`, e); throw e; }
    paintBar();
    requestAnimationFrame(tick);
  }

  renderTimeline();
  requestAnimationFrame(tick);
  // the first click or key anywhere unlocks audio, so a start from the
  // presenter (which is not a click in this window) still has sound
  const unlock = () => { removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); wantSound(); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  if (q.has('autoplay')) openTile();
}

function shell(title) {
  return `
  <div class="viewer">
    <div class="stagewrap">
      <div class="frame16" id="frame">
        <canvas id="cv" role="img" aria-label="${esc(title)}"></canvas>
        <div class="beatlabel" id="beatlabel"></div>
        <p class="caption" id="caption" aria-live="polite" hidden></p>
        <button class="bigplay" id="bigplay" type="button" aria-label="Play">${ICON.play}</button>
      </div>
    </div>
 <div class="bar">
      <a class="brand" href="../index.html" title="All stories"><span class="wm-the">The</span> Scale-to-Zero <span class="wm-report">Report</span></a>
      <button class="ctl pp" id="pp" type="button" aria-label="Play" title="Play / pause (space)"></button>
      <button class="ctl" id="prev" type="button" aria-label="Previous beat" title="Previous beat (←)">‹</button>
      <div class="beat"><span class="num"><b id="bn">01</b> / <span id="bcount">--</span></span><span id="btitle"></span></div>
      <button class="ctl" id="next" type="button" aria-label="Next beat" title="Next beat (→)">›</button>
      <div class="scrub" id="scrub" title="Scrub"><div class="segs" id="segs"></div><div class="fill" id="fill"></div><div class="tip" id="tip" hidden></div></div>
      <span class="time" id="time">0:00 / 0:00</span>
      <button class="btn" id="cc" type="button" title="Captions (c)">CC</button>
      <button class="btn" id="snd" type="button" title="Music and sound effects (s)">♪ Sound</button>
      <button class="btn" id="theme" type="button" title="Light / dark (t). Flips the presenter's previews too.">◐ Dark</button>
      <a class="btn" href="presenter.html" target="airbrx-story-presenter" title="The script as a teleprompter, on this same clock">Presenter</a>
      <button class="btn pri" id="rec" type="button" title="Play tile: timing, audio and the recording frame (p)">● Record</button>
      <button class="btn" id="info" type="button" title="Sources (i)" aria-label="Sources">i</button>
    </div>
  </div>
  <div class="curtain" id="curtain"></div>
  <div class="ptile" id="tile"></div>
  <div class="ptile xport" id="xport"></div>
  <div class="infobox" id="infobox"><div class="info-card">${document.getElementById('info-content') ? document.getElementById('info-content').innerHTML : ''}<button class="btn" type="button" data-close>Close</button></div></div>
  <p class="err" id="err" role="alert" hidden></p>`;
}
