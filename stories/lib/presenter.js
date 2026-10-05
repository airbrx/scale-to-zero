/* presenter.js - the prompter, on the film's own clock.

   A teleprompter for a story: the script rolls under a
   reading line, the sentence being spoken is lit, and the speed set here is
   the speed the film is laid out at (shared through localStorage). The
   difference is the clock is one clock: with the story window open (o),
   start, pause, scrub or change speed in either window and the other
   follows (lib/sync.js), so the picture moves on the word as you read it.

   The previews are not iframes. The story is a function of time, so "Now"
   is the film drawn live at the prompter's moment and "Next" is the next
   beat drawn as a still, both straight from story.js. */

import { clamp } from './sketch.js';
import { readWpm, saveWpm, fmt, id2 } from './timeline.js';
import { loadFilm, timelineFor, drawFilm } from './film.js';
import { link } from './sync.js';

const READ = .34;            // the reading line, as a share of the pane's height
const FS_KEY = 'airbrx-stories:fs';
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const chips = (h) => h.replace(/\{([\w-]+)\}/g, '<span class="cue">&#9670; $1</span>');

export async function mountPresenter({ slug, title, BEATS, makeStory }) {
  document.body.insertAdjacentHTML('beforeend', shell(title));
  const $ = (id) => document.getElementById(id);
  const roll = $('roll'), pane = $('prompter');

  let film, T, story, wpm = readWpm(slug), clock = 'script';
  let elapsed = 0, running = false, t0 = 0, counting = false, lastK = -1, lastSend = 0;
  let fs = 44;
  try { fs = +localStorage.getItem(FS_KEY) || 44; } catch (e) { console.warn('presenter: localStorage unavailable', e); }
  document.documentElement.style.setProperty('--fs', `${fs}px`);

  const sync = link(slug, applyRemote);
  const stateNow = () => ({ t: elapsed, playing: running, clock, wpm });
  sync.watch(stateNow);
  const announce = () => sync.lead(stateNow);

  function fail(msg, e) {
    console.error(`presenter: ${msg}`, e || '');
    $('err').textContent = msg; $('err').hidden = false;
  }

  function build() {
    T = timelineFor(film, BEATS, clock, wpm);
    story = makeStory(T);
  }
  async function load(keep) {
    const place = keep && T ? T.where(elapsed) : null;
    try { film = await loadFilm(); build(); }
    catch (e) { roll.innerHTML = `<div class="err-roll">Couldn't load the script.<br>${esc(e.message)}</div>`; fail(e.message, e); throw e; }
    $('err').hidden = true;
    if (place) elapsed = T.timeAt(place);
    elapsed = Math.min(elapsed, T.total);
    render();
  }

  function render() {
    let li = 0;
    roll.innerHTML = T.beats.map((b, k) => `
      <section class="sec" data-k="${k}">
        <h2>Beat ${id2(b.n)} · ${esc(b.title)} <small>${fmt(b.dur)}</small></h2>
        ${b.blocks.map((x, j) =>
          x.kind === 'say' ? `<p class="say" data-j="${j}">${x.sentences.map((s) => `<span class="s" data-i="${li++}">${chips(esc(s.raw))}</span>`).join(' ')}</p>` :
          x.kind === 'cue' ? `<p class="cueline" data-j="${j}"><span class="cue">&#9670; ${esc(x.name)}</span></p>` :
          x.kind === 'pause' ? `<p class="pause" data-j="${j}">&middot; pause ${x.secs}s &middot;</p>` :
                              `<p class="note" data-j="${j}">${esc(x.text)}</p>`).join('')}
      </section>`).join('');
    $('reel').innerHTML = T.beats.map((b, k) => `<div class="seg" data-k="${k}" style="flex:${b.dur}">${id2(b.n)} ${esc(b.title)}</div>`).join('') + '<div class="head" id="head"></div>';
    $('reel').querySelectorAll('.seg').forEach((el) => { el.onclick = () => { seek(T.beats[+el.dataset.k].start); announce(); }; });
    $('wpm').textContent = clock === 'script' ? `${wpm} wpm` : 'voiceover';
    const first = T.lines.length ? T.lines[0].start : 0;
    $('leadNote').innerHTML = `<b>Lead-in:</b> after the 3-2-1 the title runs ${first.toFixed(1)} s, then you speak. Your first word belongs at ${fmt(first)} of the film. However much dead air your recording has before it, note the time of your first word in the file and enter it as <b>Voice starts at</b> on the story window's play tile; playback and the MP4 export line it up. Leave 1–2 s of room tone before you speak.`;
    $('timing').textContent = clock === 'script' ? 'Script timing' : 'Voiceover timing';
    $('timing').disabled = !film.vo;
    $('timing').title = film.vo ? 'Switch between the script at your speed and the aligned voiceover' : (film.voErr || 'No voiceover.json yet: script timing only');
    lastK = -1;
    frame(true);
  }

  // The point in the text that should sit on the reading line.
  function lineY(t) {
    const k = T.beatIndexAt(t), b = T.beats[k], sec = roll.children[k];
    const timed = [...sec.querySelectorAll('[data-j]')].filter((el) => b.blocks[+el.dataset.j].len > 0);
    if (!timed.length) return sec.offsetTop;
    if (t < b.start + b.speak) {
      const el = timed.find((el) => { const x = b.blocks[+el.dataset.j]; return t < x.start + x.len; }) || timed[timed.length - 1];
      const x = b.blocks[+el.dataset.j];
      return el.offsetTop + clamp((t - x.start) / x.len, 0, 1) * el.offsetHeight;
    }
    // Holding after the last word: drift to the next beat's first line.
    const lastEl = timed[timed.length - 1], from = lastEl.offsetTop + lastEl.offsetHeight;
    const nb = T.beats[k + 1], nsec = roll.children[k + 1];
    const nfirst = nsec && [...nsec.querySelectorAll('[data-j]')].find((el) => nb.blocks[+el.dataset.j].len > 0);
    const to = nfirst ? nfirst.offsetTop : from + 80;
    return from + (to - from) * clamp((t - b.start - b.speak) / Math.max(.001, b.dur - b.speak), 0, 1);
  }

  function drawNext(k) {
    const nb = T.beats[k + 1];
    $('nextTitle').textContent = nb ? `${id2(nb.n)} ${nb.title}` : 'end';
    if (nb) drawFilm($('cvNext'), story, nb.start + Math.min(2.5, nb.dur * .4), performance.now(), { live: false });
    else { const c = $('cvNext'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
  }

  function frame(force) {
    const now = performance.now();
    if (running) elapsed = Math.min((now - t0) / 1000, T.total);
    const k = T.beatIndexAt(elapsed), b = T.beats[k];
    roll.style.transform = `translateY(${pane.clientHeight * READ - lineY(elapsed)}px)`;
    roll.querySelectorAll('.s').forEach((el) => {
      const l = T.lines[+el.dataset.i];
      el.className = `s ${elapsed >= l.end ? 'past' : elapsed >= l.start ? 'now' : ''}`;
    });
    if (k !== lastK || force) {
      lastK = k;
      $('reel').querySelectorAll('.seg').forEach((el) => el.classList.toggle('on', +el.dataset.k === k));
      $('now').innerHTML = `<b>${id2(b.n)}</b> ${esc(b.title)}`;
      $('nowTitle').textContent = `${id2(b.n)} ${b.title}`;
      drawNext(k);
    }
    try { drawFilm($('cvNow'), story, elapsed, now); }
    catch (e) { running = false; fail(`The film failed to draw at ${elapsed.toFixed(2)}s: ${e.message}`, e); throw e; }
    $('clock').innerHTML = `${fmt(elapsed)} <span>/ ${fmt(T.total)}</span>`;
    // the wordless title: count the speaker in to the first word
    const first = T.lines.length ? T.lines[0].start : 0, toGo = first - elapsed;
    $('lead').hidden = !(running && toGo > 0);
    if (running && toGo > 0) $('lead').innerHTML = `<small>Speak in</small>${Math.ceil(toGo)}`;
    $('left').innerHTML = `beat <b>${fmt(b.start + b.dur - elapsed)}</b> left`;
    $('shotBar').style.width = `${100 * (elapsed - b.start) / b.dur}%`;
    $('head').style.left = `${100 * elapsed / T.total}%`;
    if (running && elapsed >= T.total) { pause(); setState('Done'); announce(); }
    if (running && sync.leading() && now - lastSend > 500) { lastSend = now; sync.send(); }
  }
  const loop = () => { if (running) { frame(); requestAnimationFrame(loop); } };
  // the live preview keeps boiling while paused, a few times a second
  setInterval(() => { if (!running && T) drawFilm($('cvNow'), story, elapsed, performance.now()); }, 125);

  function setState(s) { $('state').querySelector('span').textContent = s; $('state').classList.toggle('run', s === 'Live'); }
  function resume() {
    running = true; t0 = performance.now() - elapsed * 1000;
    $('go').innerHTML = '&#10074;&#10074; Pause'; setState('Live');
    requestAnimationFrame(loop);
  }
  function pause() { running = false; $('go').innerHTML = '&#9654; Start'; setState(elapsed ? 'Paused' : 'Ready'); frame(true); }
  function toggle() {
    if (counting) return;
    if (running) { pause(); announce(); return; }
    if (elapsed >= T.total) elapsed = 0;
    if (elapsed > 0) { resume(); announce(); return; }
    // From the top: a three-count; the story window waits on its first frame.
    counting = true;
    const c = $('count'); c.classList.add('on');
    let n = 3; c.textContent = n;
    const iv = setInterval(() => {
      if (--n > 0) { c.textContent = n; return; }
      clearInterval(iv); c.classList.remove('on'); counting = false; resume(); announce();
    }, 1000);
  }
  function seek(v) {
    elapsed = clamp(v, 0, T.total);
    if (running) t0 = performance.now() - elapsed * 1000;
    frame(true);
    if (!running) setState(elapsed ? 'Paused' : 'Ready');
  }
  function step(d) {
    const k = T.beatIndexAt(elapsed), b = T.beats[k];
    if (d < 0 && elapsed - b.start > 1.5) seek(b.start);
    else seek(T.beats[clamp(k + d, 0, T.beats.length - 1)].start);
    announce();
  }
  function retime(fn) {
    const place = T.where(elapsed);
    fn(); build();
    elapsed = T.timeAt(place);
    if (running) t0 = performance.now() - elapsed * 1000;
    render();
  }
  function setWpm(v) {
    retime(() => { wpm = clamp(v, 80, 260); saveWpm(slug, wpm); clock = 'script'; });
    announce();
  }
  function setFs(v) {
    fs = clamp(v, 24, 96);
    document.documentElement.style.setProperty('--fs', `${fs}px`);
    try { localStorage.setItem(FS_KEY, String(fs)); } catch (e) { console.warn('presenter: could not save text size', e); }
    frame(true);
  }
  function applyRemote(m) {
    if (!T) return;   // a message can arrive before the script has loaded
    if (m.clock !== clock || m.wpm !== wpm) { clock = m.clock; wpm = m.wpm; build(); render(); }
    elapsed = clamp(m.t, 0, T.total);
    if (m.playing && !running) resume();
    else if (!m.playing && running) pause();
    else if (running) t0 = performance.now() - elapsed * 1000;
    else frame(true);
  }

  const themeLabel = () => { $('themeBtn').innerHTML = window.storyTheme.get() === 'dark' ? '&#9680; Light story' : '&#9680; Dark story'; };
  addEventListener('storage', () => { themeLabel(); setTimeout(() => drawNext(T.beatIndexAt(elapsed)), 450); });

  $('go').onclick = toggle;
  $('restart').onclick = () => { pause(); seek(0); setState('Ready'); announce(); };
  $('slower').onclick = () => setWpm(wpm - 5);
  $('faster').onclick = () => setWpm(wpm + 5);
  $('timing').onclick = () => { if (!film.vo) return; try { retime(() => { clock = clock === 'script' ? 'voiceover' : 'script'; }); announce(); } catch (e) { clock = 'script'; build(); render(); fail(`Voiceover timing unusable: ${e.message}`, e); } };
  $('reloadS').onclick = () => load(true);
  $('mirror').onclick = () => roll.classList.toggle('mirror');
  $('themeBtn').onclick = () => { window.storyTheme.toggle(); themeLabel(); setTimeout(() => drawNext(T.beatIndexAt(elapsed)), 450); };
  $('storyWin').onclick = () => window.open('index.html?autoplay', `airbrx-story-${slug}`, 'popup,width=1280,height=800');
  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const k = e.key;
    if (k === ' ') toggle();
    else if (k === 'ArrowRight') step(1);
    else if (k === 'ArrowLeft') step(-1);
    else if (k === 'ArrowUp') setWpm(wpm + 5);
    else if (k === 'ArrowDown') setWpm(wpm - 5);
    else if (k === 'Home') { pause(); seek(0); announce(); }
    else if (k === ']') setFs(fs + 4);
    else if (k === '[') setFs(fs - 4);
    else if (k === 'm') roll.classList.toggle('mirror');
    else if (k === 'c') { roll.classList.toggle('cues'); frame(true); }
    else if (k === 't') $('themeBtn').click();
    else if (k === 'r') load(true);
    else if (k === 'o') $('storyWin').click();
    else return;
    e.preventDefault();
  });
  addEventListener('resize', () => frame(true));

  themeLabel();
  await load(false);
  setState('Ready');
  // Paragraph offsets move once the webfont lands; re-aim the line then.
  document.fonts.ready.then(() => frame(true));
}

function shell(title) {
  return `
<div class="app">
  <div class="top">
    <span class="state" id="state"><i></i><span>Ready</span></span>
    <span class="now" id="now"><b>--</b></span>
    <span class="clock" id="clock">0:00 <span>/ 0:00</span></span>
    <span class="left" id="left">beat <b>0:00</b> left</span>
    <div class="sp">
      <button class="btn" id="timing" type="button">Script timing</button>
      <button class="btn" id="slower" type="button" title="Slower (down arrow)">&minus;</button>
      <span class="wpm" id="wpm">150 wpm</span>
      <button class="btn" id="faster" type="button" title="Faster (up arrow)">+</button>
      <button class="btn pri" id="go" type="button" title="Start / pause (space). From the top, a three-count first.">&#9654; Start</button>
      <button class="btn" id="restart" type="button" title="Back to the top (Home)">&#8634; Restart</button>
      <button class="btn" id="reloadS" type="button" title="Re-read script.md, keeping your place (r)">Reload script</button>
      <button class="btn" id="storyWin" type="button" title="Open the story on its play tile, on this clock, for your screen recorder (o)">Open story window</button>
      <button class="btn" id="themeBtn" type="button" title="Light / dark story (t). The prompter itself stays dark.">&#9680; Dark story</button>
      <button class="btn" id="mirror" type="button" title="Mirror the text for a beam-splitter rig (m)">Mirror</button>
      <a class="btn" href="index.html">Story</a>
    </div>
  </div>
  <div class="prompter" id="prompter">
    <div class="roll" id="roll"></div>
    <div class="mask"></div>
    <div class="line"></div>
    <div class="count" id="count"></div>
    <div class="lead" id="lead" hidden></div>
  </div>
  <div class="side">
    <h3>Now <b id="nowTitle"></b></h3>
    <div class="shot live"><canvas id="cvNow" aria-label="${title} at the prompter's moment"></canvas></div>
    <div class="bar2"><i id="shotBar"></i></div>
    <h3>Next <b id="nextTitle"></b></h3>
    <div class="shot"><canvas id="cvNext" aria-label="The next beat"></canvas></div>
    <p class="err" id="err" role="alert" hidden></p>
    <div class="keys">
      <div><kbd>space</kbd> start / pause &nbsp; <kbd>&larr;</kbd><kbd>&rarr;</kbd> beat &nbsp; <kbd>Home</kbd> restart</div>
      <div><kbd>&uarr;</kbd><kbd>&darr;</kbd> speed &nbsp; <kbd>[</kbd><kbd>]</kbd> text size &nbsp; <kbd>m</kbd> mirror &nbsp; <kbd>c</kbd> show cues &nbsp; <kbd>t</kbd> light / dark story &nbsp; <kbd>r</kbd> reload script &nbsp; <kbd>o</kbd> story window</div>
      <div class="hint">The story window follows this clock and this speed: start here and it starts there.</div>
      <div class="hint" id="leadNote"></div>
    </div>
  </div>
  <div class="reel" id="reel"></div>
</div>`;
}
