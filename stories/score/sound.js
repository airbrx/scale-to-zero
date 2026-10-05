/* score/sound.js - the Report's own score and sound effects.

   lib/sound.js re-exports it, so the viewer, the live recording and the
   MP4 export all play it by that name.

   What's different from the kit's: a film's music isn't one style for its
   whole length. A story defines SCORE, a handful of named sections (each a
   key, mode, tempo, progression and a mix of layers), and script.md says
   where each one starts with a direction line:

       > ♪ storm

   Those lines sit on the same clock as the words (timeline.js keeps every
   `>` line with its start time), so the music moves when the reading speed
   or a recorded voiceover does. A change crossfades the layers over the
   section's `fade` seconds; harmony and tempo turn on the next bar.

   Layers, each a level 0..1 in a section:
     pad    sustained chords (padTone 'soft' or 'strings')
     keys   soft FM notes wandering the scale
     bells  high FM notes on the bar
     drone  the root and fifth, low
     pluck  muted sixteenths over the chord (the ticking engine)
     arp    plucked eighth-note arpeggio
     bass   roots on the beat
     kick   on 1 and 3; on every beat above .6
     hat    off-beat eighths
   `> ♪ silence` is a hard cut to nothing, tail included.

   A number after the name eases the change in ahead of its line, so it has
   arrived by the word instead of starting on it:

       > ♪ silence 1.5     the score fades out over the 1.5 s before the
                           line, its reverb left to ring, and is silent on it
       > ♪ beside 2        the crossfade into beside starts 2 s early

   Coming back out of silence, the score always swells in from nothing over
   the new section's `fade` (or the number), already in its new key.

   The story's audio(t) still rides on top, as in the kit: intensity (swells
   the whole score), riser, swarm, tick, hum, wind, music (a gate) and fade.

   Tone.js 14.8.49 loads on the first click from our own copy in stories/vendor/
   (MIT, licence beside it), served from the same place as the film, so no
   one else's server is part of the page. */

import { lufs, speechMap } from './loudness.js';

const TONE_URL = new URL('../vendor/tone-14.8.49.js', import.meta.url).href;
let toneLoading = null;
function loadTone() {
  if (window.Tone) return Promise.resolve(window.Tone);
  if (!toneLoading) {
    toneLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TONE_URL;
      s.onload = () => (window.Tone ? resolve(window.Tone) : reject(new Error('Tone.js loaded but did not define Tone')));
      s.onerror = () => { toneLoading = null; reject(new Error(`Tone.js could not be loaded from ${TONE_URL}`)); };
      document.head.appendChild(s);
    });
  }
  return toneLoading;
}

/* ---------------- the score, as data ---------------- */

const KEYS = { C: 48, 'C#': 49, Db: 49, D: 50, 'D#': 51, Eb: 51, E: 52, F: 53, 'F#': 54, Gb: 54, G: 55, 'G#': 56, Ab: 56, A: 57, 'A#': 58, Bb: 58, B: 59 };
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
};
export const LAYERS = ['pad', 'keys', 'bells', 'drone', 'pluck', 'arp', 'bass', 'kick', 'hat'];
const SECTION_DEFAULTS = { key: 'D', mode: 'dorian', bpm: 72, prog: [0, 3], bars: 2, fade: 2, padTone: 'soft', level: 0 };

/* The mix, relative to the voice. A story can override any of these in
   SCORE.mix; a section can lift or drop itself with `level` (dB).
     voice     the voice's loudness after it's levelled and compressed (LUFS)
     music     the whole score, up or down (dB)
     under     how far the score drops while the voice speaks (dB)
     presence  a dip at 2.5 kHz in the score while the voice speaks (dB),
               so the words have room without the music vanishing
     gap       seconds of silence before the score comes back up
     fx        the effects, up or down (dB)
     bed       how far the score comes up once a voiceover is loaded (dB):
               a levelled voice is louder than the score is on its own */
export const MIX = { voice: -16, music: 0, under: -11, presence: -4, gap: .8, fx: 0, bed: 6 };
const MARK = /^♪\s*([\w-]+)(?:\s+([\d.]+)\s*s?)?\s*$/;

/* Check a SCORE and lay its changes on the film's clock. Throws, with a
   sentence saying what's wrong, for a marker naming a section SCORE doesn't
   have, a section nobody uses, or a layer name that isn't one. */
export function scoreFor(T, SCORE) {
  if (!SCORE || !SCORE.sections) throw new Error('the story exports no SCORE with sections');
  for (const k of Object.keys(SCORE.mix || {})) if (!(k in MIX)) throw new Error(`SCORE.mix: "${k}" isn't a mix setting (${Object.keys(MIX).join(', ')})`);
  const mix = { ...MIX, ...(SCORE.mix || {}) };
  const sections = {};
  for (const [name, s] of Object.entries(SCORE.sections)) {
    const sec = { ...SECTION_DEFAULTS, key: SCORE.key || SECTION_DEFAULTS.key, ...s };
    if (!(sec.key in KEYS)) throw new Error(`SCORE section "${name}": key "${sec.key}" isn't one of ${Object.keys(KEYS).join(' ')}`);
    if (!(sec.mode in MODES)) throw new Error(`SCORE section "${name}": mode "${sec.mode}" isn't one of ${Object.keys(MODES).join(', ')}`);
    for (const k of Object.keys(s)) if (!(k in SECTION_DEFAULTS) && !LAYERS.includes(k)) throw new Error(`SCORE section "${name}": "${k}" is neither a setting (${Object.keys(SECTION_DEFAULTS).join(', ')}) nor a layer (${LAYERS.join(', ')})`);
    sections[name] = sec;
  }
  const changes = [];
  for (const b of T.beats) for (const x of b.blocks) {
    if (x.kind !== 'note') continue;
    const m = x.text.match(MARK);
    if (!m) { if (/^♪/.test(x.text)) throw new Error(`script.md beat ${b.n}: "> ${x.text}" should be "> ♪ <section>"`); continue; }
    const name = m[1];
    if (name !== 'silence' && !sections[name]) throw new Error(`script.md beat ${b.n} asks for "♪ ${name}", which SCORE doesn't have (it has: ${Object.keys(sections).join(', ')})`);
    const ease = m[2] ? +m[2] : 0;
    // t is the line; start is when the change begins, ease seconds ahead of it
    changes.push({ t: x.start, name, ease, start: Math.max(0, x.start - ease) });
  }
  if (!changes.length) throw new Error('script.md has no "> ♪ <section>" lines, so the score never starts');
  for (const name of Object.keys(sections)) if (!changes.some((c) => c.name === name)) throw new Error(`SCORE section "${name}" is never used in script.md`);
  changes.sort((a, b) => a.start - b.start);
  const at = (t) => { let c = changes[0]; for (const x of changes) if (x.start <= t + 1e-6) c = x; return c; };
  return { sections, changes, at, mix };
}

/* ---------------- the sound effects ---------------- */

export const FX_KINDS = ['click', 'blip', 'probe', 'reject', 'tick', 'thud', 'whooshIn', 'whooshOut', 'whooshLow', 'swish', 'dissolve',
  'scribe', 'rule', 'logo', 'resolve', 'braam', 'sparkle', 'kaching', 'clink', 'hit', 'notify', 'latch', 'heartbeat', 'gate',
  'powerDown', 'chirp', 'exfil', 'rewind', 'send', 'save', 'clear', 'mug', 'eyeOpen', 'drip', 'stamp', 'paper',
  'intro', 'page', 'canopy'];

export function checkSounds(sounds) {
  const bad = [...new Set((sounds || []).map((e) => e.kind))].filter((k) => !FX_KINDS.includes(k));
  if (bad.length) throw new Error(`the story asks for sounds the score doesn't have: ${bad.join(', ')} (it has: ${FX_KINDS.join(', ')})`);
  const bad2 = (sounds || []).filter((e) => !Number.isFinite(e.t));
  if (bad2.length) throw new Error(`${bad2.length} sound(s) have no time, e.g. "${bad2[0].kind}"`);
}

/* ---------------- the graph ---------------- */

/* Levels are balanced by ear-weight, not by meter: measured above 150 Hz
   (what a laptop speaker plays), each layer at 1 alone lands near -28 dBFS
   and a full section near -24. Sub-bass makes a meter happy and a laptop
   silent, so it doesn't count. Re-measure with `node stories/tools/check.mjs <slug> --audio`. */
const MUSIC_DB = 4, FX_DB = -6;
/* The voice chain: levelled to the target on the way in, a gentle
   compressor to hold the peaks (a spoken take's peaks sit ~23 dB over its
   average), COMP_MAKEUP after it to put back what it takes off, then the
   master limiter. Calibrated with check.mjs --voice. */
const COMP_MAKEUP = 4.5;
const dbToGain = (db) => Math.pow(10, db / 20);
const quiet = { wind: 0, speed: 0, hum: 0, intensity: .5, fade: 1, riser: 0, swarm: 0, tick: 0, music: 1 };
const levelsAt = (story, t) => ({ ...quiet, ...(story.audio ? story.audio(t) : {}) });
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function buildGraph(Tone) {
  const ctx = Tone.getContext(), transport = ctx.transport;
  const note = (m) => Tone.Frequency(m, 'midi').toNote();
  // one-voice instruments refuse two notes at one instant: nudge the later one
  const mono = () => { let last = -Infinity; return (time) => { const t = Math.max(time, last + .003); last = t; return t; }; };

  // voice joins at the limiter, so the fade and the duck never touch it
  // the master: a limiter, then a soft ceiling just under full scale. The
  // limiter has no look-ahead, so a hard consonant can slip past it; the
  // ceiling rounds that off (tanh) instead of letting the MP4 clip.
  const ceiling = new Tone.WaveShaper((x) => .966 * Math.tanh(x / .966), 4096).toDestination();
  const limiter = new Tone.Limiter(-1).connect(ceiling);
  const fade = new Tone.Gain(1).connect(limiter);
  const master = new Tone.Volume(0).connect(fade);
  // music: layers -> verb/dry -> level (intensity) -> gate (silence, the
  // `music` level) -> duck (under a voice) -> switch (pause, sound off)
  const musicSwitch = new Tone.Volume(0).connect(master); musicSwitch.mute = true;
  const duck = new Tone.Volume(0).connect(musicSwitch);
  const gate = new Tone.Gain(1).connect(duck);
  // while the voice speaks: a dip in the presence band, then the duck
  const presence = new Tone.Filter({ type: 'peaking', frequency: 2500, Q: .9, gain: 0 }).connect(gate);
  const trim = new Tone.Volume(0).connect(presence);       // SCORE.mix.music + the section's level
  const level = new Tone.Volume(MUSIC_DB).connect(trim);   // the story's intensity
  // the voice: levelled to the mix's target, compressed, into the limiter
  const voiceIn = new Tone.Gain(1);
  const voiceComp = new Tone.Compressor({ threshold: -22, ratio: 3, attack: .005, release: .18, knee: 6 });
  const voiceMakeup = new Tone.Gain(dbToGain(COMP_MAKEUP));
  // and its own fast limiter, so speech peaks are held before they meet the score
  const voiceLimit = new Tone.Compressor({ threshold: -4, ratio: 20, attack: .001, release: .06, knee: 0 });
  voiceIn.connect(voiceComp); voiceComp.connect(voiceMakeup); voiceMakeup.connect(voiceLimit); voiceLimit.connect(limiter);
  const verb = new Tone.Reverb({ decay: 6, preDelay: .03, wet: .4 }).connect(level);
  await verb.ready;
  const fxBus = new Tone.Volume(FX_DB).connect(master);
  const fxVerbR = new Tone.Reverb({ decay: 2.2, wet: 1 }).connect(fxBus);
  await fxVerbR.ready;
  const fxOut = new Tone.Gain(1).fan(fxBus, new Tone.Gain(.22).connect(fxVerbR));

  // the state the loops read
  const st = { mix: MIX, sec: null, root: 50, scale: MODES.dorian, prog: [0], bars: 2, bar: 0, chordAt: 0, deg: 0, reset: true, intensity: .5, swarm: 0, tick: 0, silent: false, fading: false, token: 0, pending: null };
  const midiOf = (d) => st.root + 12 * Math.floor(d / 7) + st.scale[((d % 7) + 7) % 7];
  const chord = (d) => [d, d + 2, d + 4].map((x, i) => note(midiOf(x) - (i === 0 ? 12 : 0)));

  // ---- the layers, each behind its own gain ----
  const lg = {};
  const layerBus = (name, dest) => (lg[name] = new Tone.Gain(0).connect(dest));
  const padF = new Tone.Filter(1400, 'lowpass').connect(layerBus('pad', verb));
  new Tone.LFO('0.07hz', 700, 2200).connect(padF.frequency).start();
  const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsine', count: 2, spread: 10 }, envelope: { attack: 1.4, decay: 1, sustain: .8, release: 3 } }).connect(padF);
  pad.volume.value = -11;
  const keysF = new Tone.Filter(3200, 'lowpass').connect(layerBus('keys', verb));
  const keys = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2, modulationIndex: 1.2, envelope: { attack: .005, decay: 1.6, sustain: 0, release: 1.6 }, modulationEnvelope: { attack: .002, decay: .4, sustain: 0, release: .3 } }).connect(keysF);
  keys.volume.value = 6;
  const bells = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 3, modulationIndex: 5, envelope: { attack: .001, decay: 2.4, sustain: 0, release: 2.4 }, modulationEnvelope: { attack: .001, decay: .25, sustain: 0, release: .3 } }).connect(layerBus('bells', verb));
  bells.volume.value = 1;
  // the drone sits an octave up from the kit's, where small speakers can play it
  const droneF = new Tone.Filter(600, 'lowpass').connect(new Tone.Volume(-25).connect(layerBus('drone', verb)));
  const drone1 = new Tone.Oscillator(73.4, 'sine').connect(droneF).start();
  const drone2 = new Tone.Oscillator(110, 'triangle').connect(new Tone.Gain(.35).connect(droneF)).start();
  const pluck = new Tone.MonoSynth({ oscillator: { type: 'square' }, filter: { Q: 2, type: 'lowpass' }, filterEnvelope: { baseFrequency: 300, octaves: 2.6, attack: .001, decay: .07, sustain: 0 }, envelope: { attack: .001, decay: .09, sustain: 0, release: .05 } }).connect(layerBus('pluck', verb));
  pluck.volume.value = -7;
  const arp = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: .002, decay: .22, sustain: 0, release: .25 } }).connect(layerBus('arp', verb));
  arp.volume.value = -2;
  // bass and drums are dry: they belong in front
  const bass = new Tone.MonoSynth({ oscillator: { type: 'triangle' }, filter: { Q: 1, type: 'lowpass' }, filterEnvelope: { baseFrequency: 140, octaves: 2.2, attack: .005, decay: .25, sustain: .3 }, envelope: { attack: .005, decay: .3, sustain: .35, release: .25 } }).connect(layerBus('bass', level));
  bass.volume.value = -8;
  const kick = new Tone.MembraneSynth({ pitchDecay: .03, octaves: 6, envelope: { attack: .001, decay: .3, sustain: 0, release: .1 } }).connect(layerBus('kick', level));
  kick.volume.value = 0;
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: .001, decay: .05, sustain: 0 } }).connect(new Tone.Filter(7000, 'highpass').connect(layerBus('hat', level)));
  hat.volume.value = 3;
  const on = (name) => st.sec && !st.silent && (st.sec[name] || 0) > .01;
  const atPluck = mono(), atBass = mono(), atKick = mono(), atHat = mono();

  // the bar: harmony, chords, bells, the bass's downbeat
  new Tone.Loop((time) => {
    if (st.pending) { applyHarmony(st.pending, time); st.pending = null; }
    if (!st.sec) return;
    if (st.reset) { st.bar = 0; st.reset = false; }
    const k = Math.floor(st.bar / st.bars) % st.prog.length, first = st.bar % st.bars === 0;
    st.deg = st.prog[k]; st.bar++;
    if (first && on('pad')) pad.triggerAttackRelease(chord(st.deg), `${st.bars}m`, time, .3 + st.intensity * .25);
    if (on('bells') && Math.random() < .3 + st.sec.bells * .6) bells.triggerAttackRelease(note(midiOf(st.deg + pick([14, 16, 18]))), 2, time + pick([0, '4n', '2n']), rnd(.2, .35));
  }, '1m').start(0);
  // the beat
  let beat = 0;
  new Tone.Loop((time) => {
    const q = beat++ % 4;
    if (!st.sec) return;
    const root = midiOf(st.deg) - 12;
    if (on('bass') && (q === 0 || q === 2 || st.sec.bass > .7)) bass.triggerAttackRelease(note(q === 3 ? root + 7 : root), '8n', atBass(time), .5 + st.intensity * .35);
    if (on('kick') && (q % 2 === 0 || st.sec.kick > .6)) kick.triggerAttackRelease('C1', '8n', atKick(time), .8);
  }, '4n').start(0);
  // eighths: the arpeggio, the keys, the hat
  let eighth = 0, cur = 9;
  const ARP = [0, 1, 2, 3, 2, 1, 2, 1];
  new Tone.Loop((time) => {
    const k = eighth++ % 8;
    if (!st.sec) return;
    if (on('arp') && Math.random() < .5 + st.sec.arp * .5) {
      const tones = [st.deg, st.deg + 2, st.deg + 4, st.deg + 7].map((x) => midiOf(x) + 12);
      arp.triggerAttackRelease(note(tones[ARP[k]]), '16n', time, .25 + st.intensity * .3);
    }
    if (on('keys') && Math.random() < .05 + st.sec.keys * .35) {
      cur = Math.max(7, Math.min(17, cur + pick([-2, -1, -1, 1, 1, 2])));
      keys.triggerAttackRelease(note(midiOf(cur)), 1.2, time + rnd(0, .03), rnd(.25, .45));
    }
    if (on('hat') && k % 2 === 1) hat.triggerAttackRelease('32n', atHat(time), .5);
  }, '8n').start(0);
  // sixteenths: the muted pluck, denser as the layer rises
  let six = 0;
  const PAT = [0, 0, 2, 0, 4, 0, 3, 2];
  new Tone.Loop((time) => {
    const k = six++ % 16;
    if (!on('pluck')) return;
    const need = k % 4 === 0 ? .05 : k % 2 === 0 ? .4 : .75;
    if (st.sec.pluck <= need) return;
    pluck.triggerAttackRelease(note(midiOf(st.deg + PAT[k % 8])), '32n', atPluck(time), .35 + st.intensity * .4);
  }, '16n').start(0);

  /* Harmony and tempo: on a bar line. */
  function applyHarmony(sec, time) {
    st.root = KEYS[sec.key]; st.scale = MODES[sec.mode]; st.prog = sec.prog; st.bars = sec.bars; st.reset = true;
    drone1.frequency.rampTo(Tone.Frequency(st.root - 12, 'midi').toFrequency(), .5, time);
    drone2.frequency.rampTo(Tone.Frequency(st.root - 5, 'midi').toFrequency(), .5, time);
    pad.set({ oscillator: sec.padTone === 'strings' ? { type: 'fatsawtooth', count: 3, spread: 22 } : { type: 'fatsine', count: 2, spread: 10 } });
    pad.volume.value = sec.padTone === 'strings' ? -12 : -11;
    pad.releaseAll(time);
  }

  /* A section change: the mix crossfades now, harmony waits for the bar.
     ease (seconds) is how far ahead of its line the change began: the fade
     takes that long, so it lands on the word. */
  function section(name, sec, time, first, ease = 0) {
    const token = ++st.token;
    if (name === 'silence') {
      pad.releaseAll(time + ease);
      if (ease > 0 && !first) {
        // fade the whole score out, tails and all, and go quiet on the line
        st.fading = true;
        gate.gain.cancelScheduledValues(time); gate.gain.setValueAtTime(gate.gain.getValueAtTime(time), time);
        gate.gain.linearRampToValueAtTime(0, time + ease);
        ctx.setTimeout(() => { if (st.token === token) { st.silent = true; st.fading = false; } }, Math.max(0, time + ease - ctx.now()));
      } else {
        st.silent = true; st.fading = false;
        gate.gain.cancelScheduledValues(time); gate.gain.setValueAtTime(0, time);
      }
      return;
    }
    const was = st.silent || st.fading;
    st.silent = false; st.fading = false;
    const harmony = !st.sec || st.sec.key !== sec.key || st.sec.mode !== sec.mode || String(st.sec.prog) !== String(sec.prog) || st.sec.bars !== sec.bars || st.sec.padTone !== sec.padTone;
    st.sec = sec;
    const len = first ? .01 : Math.max(ease, was ? sec.fade : 0) || sec.fade;
    if (was && !first) {
      // back from silence: every layer swells up from nothing, in the new key at once
      for (const l of LAYERS) { lg[l].gain.cancelScheduledValues(time); lg[l].gain.setValueAtTime(0, time); }
      gate.gain.cancelScheduledValues(time); gate.gain.setValueAtTime(1, time);
      if (harmony) { applyHarmony(sec, time); st.pending = null; }
    } else if (first) { gate.gain.cancelScheduledValues(time); gate.gain.setValueAtTime(1, time); }
    for (const l of LAYERS) lg[l].gain.rampTo(sec[l] || 0, len, time);
    transport.bpm.rampTo(sec.bpm, first ? .01 : Math.min(2, sec.fade), time);
    trim.volume.rampTo(st.mix.music + (sec.level || 0), len, time);
    fxBus.volume.rampTo(FX_DB + st.mix.fx, .05, time);
    if (harmony && !(was && !first)) { if (first) applyHarmony(sec, time); else st.pending = sec; }
  }

  // ---- continuous effects ----
  const windF = new Tone.Filter({ type: 'bandpass', frequency: 500, Q: .9 }), windG = new Tone.Gain(0).connect(fxOut);
  new Tone.Noise('pink').connect(windF).start(); windF.connect(windG);
  const humG = new Tone.Gain(0).connect(fxBus);
  new Tone.Oscillator(55, 'square').connect(new Tone.Filter(240, 'lowpass').connect(new Tone.Gain(.25).connect(humG))).start();
  const rG = new Tone.Gain(0).connect(new Tone.Volume(-8).connect(gate)), rF = new Tone.Filter(400, 'lowpass').connect(rG);
  const rOsc = new Tone.FatOscillator(110, 'sawtooth', 25).connect(rF).start();
  const rOsc2 = new Tone.FatOscillator(220, 'sawtooth', 25).connect(new Tone.Gain(.5).connect(rF)).start();
  const swarmG = new Tone.Gain(0).connect(fxOut);
  const swarmSyn = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: .001, decay: .022, sustain: 0, release: .01 } }).connect(new Tone.Filter(900, 'highpass').connect(new Tone.Volume(-14).connect(swarmG)));
  const atSwarm = mono();
  new Tone.Loop((time) => { if (Math.random() < st.swarm) swarmSyn.triggerAttackRelease(rnd(500, 500 + 3600 * st.swarm), .02, atSwarm(time + rnd(0, .02)), rnd(.4, 1)); }, '32n').start(0);

  // ---- one-shots ----
  const sweepF = new Tone.Filter({ type: 'lowpass', frequency: 400, Q: 1.5 }), sweepG = new Tone.Gain(0).connect(fxOut);
  new Tone.Noise('white').connect(sweepF).start(); sweepF.connect(sweepG);
  const whoosh = (tm, from, to, len, v) => {
    sweepF.frequency.cancelScheduledValues(tm); sweepF.frequency.setValueAtTime(from, tm); sweepF.frequency.exponentialRampToValueAtTime(to, tm + len);
    sweepG.gain.cancelScheduledValues(tm); sweepG.gain.setValueAtTime(0, tm);
    sweepG.gain.linearRampToValueAtTime(.5 * v, tm + len * .45); sweepG.gain.linearRampToValueAtTime(0, tm + len);
  };
  const click = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: .001, decay: .025, sustain: 0 } }).connect(new Tone.Filter(3200, 'highpass').connect(fxOut));
  const ping = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: .002, decay: .18, sustain: 0, release: .2 } }).connect(fxOut);
  ping.volume.value = -8;
  const chime = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 3, modulationIndex: 4, envelope: { attack: .001, decay: 1.8, sustain: 0, release: 1.8 } }).connect(fxOut);
  chime.volume.value = -8;
  const coin = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 5.1, modulationIndex: 9, envelope: { attack: .001, decay: .6, sustain: 0, release: .5 } }).connect(fxOut);
  coin.volume.value = -8;
  const thud = new Tone.MembraneSynth({ pitchDecay: .08, octaves: 4, envelope: { attack: .001, decay: .5, sustain: 0, release: .4 } }).connect(fxOut);
  thud.volume.value = -4;
  const square = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: .001, decay: .045, sustain: 0, release: .02 } }).connect(new Tone.Filter(600, 'highpass').connect(new Tone.Volume(-12).connect(fxOut)));
  const buzz = new Tone.MonoSynth({ oscillator: { type: 'sawtooth' }, filter: { Q: 2, type: 'lowpass' }, filterEnvelope: { baseFrequency: 160, octaves: 2, attack: .001, decay: .1, sustain: 0 }, envelope: { attack: .002, decay: .13, sustain: 0, release: .05 } }).connect(fxOut);
  buzz.volume.value = -8;
  const metal = new Tone.MetalSynth({ envelope: { attack: .001, decay: .16, release: .05 }, harmonicity: 5.1, modulationIndex: 16, resonance: 3200, octaves: 1.2 }).connect(fxOut);
  metal.volume.value = -20;
  const scratch = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: .002, decay: .05, sustain: 0 } }).connect(new Tone.Filter({ type: 'bandpass', frequency: 3500, Q: 1.5 }).connect(new Tone.Volume(-8).connect(fxOut)));
  const paper = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: .01, decay: .18, sustain: 0 } }).connect(new Tone.Filter({ type: 'bandpass', frequency: 1800, Q: .8 }).connect(new Tone.Volume(-10).connect(fxOut)));
  const sweepOsc = new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: .02, decay: .9, sustain: 0, release: .2 } }).connect(new Tone.Filter(1400, 'lowpass').connect(new Tone.Volume(-14).connect(fxOut)));
  const bigVerb = new Tone.Reverb({ decay: 6, wet: .45 }).connect(fxBus);
  await bigVerb.ready;
  const brass = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 30 }, envelope: { attack: .02, decay: 2.4, sustain: .25, release: 2.4 } }).connect(new Tone.Filter(220, 'lowpass').connect(bigVerb));
  brass.volume.value = -6;
  const streamF = new Tone.Filter({ type: 'bandpass', frequency: 3000, Q: 4 }), streamG = new Tone.Gain(0).connect(fxOut);
  new Tone.Noise('white').connect(streamF).start(); streamF.connect(streamG);
  const swellG = new Tone.Gain(0).connect(fxOut);
  new Tone.Noise('white').connect(new Tone.Filter(2200, 'highpass').connect(swellG)).start();
  // a page turning: two rustles, a band of pink noise swept up then down
  const pageF = new Tone.Filter({ type: 'bandpass', frequency: 900, Q: 1.1 }), pageG = new Tone.Gain(0).connect(fxOut);
  new Tone.Noise('pink').connect(pageF).start(); pageF.connect(pageG);
  // a sheet of card snapping open: a soft cloth thump, low
  const cloth = new Tone.NoiseSynth({ noise: { type: 'brown' }, envelope: { attack: .004, decay: .16, sustain: 0 } }).connect(new Tone.Filter(700, 'lowpass').connect(new Tone.Volume(2).connect(fxOut)));
  const at = { click: mono(), thud: mono(), square: mono(), buzz: mono(), metal: mono(), scratch: mono(), paper: mono(), sweep: mono(), cloth: mono() };
  const key = (d, oct = 0) => note(midiOf(d) + 12 * oct);   // effects that sound in the film's key
  let tock = false;
  const tickAt = (tm, v) => { tock = !tock; ping.triggerAttackRelease([tock ? 1900 : 2500], .03, tm, .4 * v); click.triggerAttackRelease(.01, at.click(tm), .3 * v); };
  new Tone.Loop((time) => { if (st.tick > .5) tickAt(time, .8); }, 1).start(0);

  const FX = {
    click: (tm, v) => click.triggerAttackRelease(.02, at.click(tm), .6 * v),
    blip: (tm, v) => ping.triggerAttackRelease([key(4, 2)], .1, tm, .5 * v),
    probe: (tm, v) => square.triggerAttackRelease(rnd(900, 2200), .03, at.square(tm), .7 * v),
    reject: (tm, v) => buzz.triggerAttackRelease('A1', .12, at.buzz(tm), .7 * v),
    tick: (tm, v) => tickAt(tm, v),
    thud: (tm, v) => thud.triggerAttackRelease('C2', .3, at.thud(tm), .8 * v),
    whooshIn: (tm, v) => whoosh(tm, 300, 5000, 1.4, v),
    whooshOut: (tm, v) => whoosh(tm, 5000, 260, 1.4, v),
    whooshLow: (tm, v) => whoosh(tm, 120, 900, 1.6, v),
    swish: (tm, v) => whoosh(tm, 900, 4200, .45, .8 * v),
    dissolve: (tm, v) => whoosh(tm, 2400, 300, 1.2, .5 * v),
    scribe: (tm, v) => [0, .06, .13].forEach((d, i) => scratch.triggerAttackRelease(.04, at.scratch(tm + d), [.3, .25, .35][i] * v)),
    paper: (tm, v) => paper.triggerAttackRelease(.2, at.paper(tm), .8 * v),
    stamp: (tm, v) => { thud.triggerAttackRelease('A1', .15, at.thud(tm), .6 * v); click.triggerAttackRelease(.03, at.click(tm + .005), .8 * v); },
    rule: (tm, v) => { ping.triggerAttackRelease([key(0, 1)], .12, tm, .45 * v); ping.triggerAttackRelease([key(4, 1)], .16, tm + .09, .45 * v); },
    logo: (tm, v) => { chime.triggerAttackRelease(key(0, 1), 1.6, tm, .45 * v); chime.triggerAttackRelease(key(4, 1), 1.8, tm + .16, .4 * v); },
    resolve: (tm, v) => [0, 2, 4, 7].forEach((d, i) => chime.triggerAttackRelease(key(d, 1), 2.2, tm + i * .12, .35 * v)),
    braam: (tm, v) => brass.triggerAttackRelease([note(st.root - 24), note(st.root - 12), note(st.root - 5)], 2.2, tm, .9 * v),
    sparkle: (tm, v) => [7, 9, 11, 14].forEach((d, i) => chime.triggerAttackRelease(key(d, 1), .5, tm + i * .06, .25 * v)),
    kaching: (tm, v) => { coin.triggerAttackRelease('B5', .1, tm, .5 * v); coin.triggerAttackRelease('E6', .5, tm + .08, .55 * v); click.triggerAttackRelease(.02, at.click(tm), .4 * v); },
    clink: (tm, v) => coin.triggerAttackRelease(pick(['E6', 'G6', 'B6']), .3, tm, .4 * v),
    hit: (tm, v) => ping.triggerAttackRelease([key(pick([0, 2, 4]), 2)], .12, tm, .35 * v),
    notify: (tm, v) => { ping.triggerAttackRelease([key(0, 2)], .12, tm, .55 * v); ping.triggerAttackRelease([key(4, 2)], .16, tm + .13, .55 * v); },
    latch: (tm, v) => { metal.triggerAttackRelease('C4', .1, at.metal(tm), .8 * v); click.triggerAttackRelease(.03, at.click(tm + .04), .6 * v); },
    heartbeat: (tm, v) => { thud.triggerAttackRelease('A1', .2, at.thud(tm), .7 * v); thud.triggerAttackRelease('G1', .2, at.thud(tm + .26), .55 * v); },
    gate: (tm, v) => { thud.triggerAttackRelease('D2', .4, at.thud(tm), .8 * v); whoosh(tm, 200, 2400, .5, .5 * v); },
    powerDown: (tm, v) => { const a = at.sweep(tm); sweepOsc.triggerAttackRelease(440, .9, a, .6 * v); sweepOsc.frequency.exponentialRampToValueAtTime(60, a + .9); },
    chirp: (tm, v) => ['E6', 'G6', 'C7'].forEach((n, i) => square.triggerAttackRelease(n, .05, at.square(tm + i * .07), .6 * v)),
    exfil: (tm, v) => { streamG.gain.cancelScheduledValues(tm); streamG.gain.setValueAtTime(0, tm); streamG.gain.linearRampToValueAtTime(.25 * v, tm + .2); streamG.gain.linearRampToValueAtTime(0, tm + 1.2); },
    rewind: (tm, v) => { const a = at.sweep(tm); sweepOsc.triggerAttackRelease(220, 1, a, .7 * v); sweepOsc.frequency.exponentialRampToValueAtTime(1800, a + 1); whoosh(tm, 400, 6000, 1.1, .5 * v); },
    send: (tm, v) => whoosh(tm, 1200, 5000, .3, .6 * v),
    save: (tm, v) => ping.triggerAttackRelease([key(4, 1), key(0, 2)], .14, tm, .4 * v),
    clear: (tm, v) => ping.triggerAttackRelease([key(0, 2)], .2, tm, .4 * v),
    mug: (tm, v) => { thud.triggerAttackRelease('G2', .2, at.thud(tm), .35 * v); ping.triggerAttackRelease(['A5'], .05, tm + .01, .3 * v); },
    // a scale falling from high to low, loud to soft, in the film's key
    intro: (tm, v) => {
      const steps = [14, 13, 12, 11, 10, 9, 8, 7];
      let at = tm;
      steps.forEach((d, i) => {
        const u = i / (steps.length - 1);
        chime.triggerAttackRelease(key(d, 1), 1.4 - u * .6, at, (.7 - u * .55) * v);
        at += .1 + u * .06;   // easing as it falls, like something settling
      });
    },
    page: (tm, v) => {
      pageF.frequency.cancelScheduledValues(tm); pageF.frequency.setValueAtTime(700, tm); pageF.frequency.exponentialRampToValueAtTime(2600, tm + .16); pageF.frequency.exponentialRampToValueAtTime(1100, tm + .34);
      pageG.gain.cancelScheduledValues(tm); pageG.gain.setValueAtTime(0, tm);
      pageG.gain.linearRampToValueAtTime(.32 * v, tm + .05); pageG.gain.linearRampToValueAtTime(.08 * v, tm + .17);
      pageG.gain.linearRampToValueAtTime(.24 * v, tm + .22); pageG.gain.linearRampToValueAtTime(0, tm + .38);
    },
    canopy: (tm, v) => { cloth.triggerAttackRelease(.12, at.cloth(tm), .9 * v); thud.triggerAttackRelease('E2', .12, at.thud(tm + .01), .35 * v); metal.triggerAttackRelease('C5', .04, at.metal(tm + .05), .35 * v); },
    drip: (tm, v) => { const f = rnd(1300, 2100); ping.triggerAttackRelease([f], .05, tm, .35 * v); ping.triggerAttackRelease([f * 1.5], .04, tm + .03, .2 * v); },
    // the swell runs 1.1 s and the chime lands at its end: fire it 1.1 s early
    eyeOpen: (tm, v) => {
      swellG.gain.cancelScheduledValues(tm); swellG.gain.setValueAtTime(0, tm); swellG.gain.linearRampToValueAtTime(.3 * v, tm + 1.08); swellG.gain.linearRampToValueAtTime(0, tm + 1.12);
      chime.triggerAttackRelease(key(4, 1), 1.6, tm + 1.1, .5 * v);
    },
  };
  for (const k of FX_KINDS) if (!FX[k]) throw new Error(`score/sound.js lists "${k}" but has no sound for it`);

  return {
    ctx, transport, st, limiter, ceiling, fade, musicSwitch, duck, gate, level, trim, presence, voiceIn, fxBus, FX, section,
    windG, windF, humG, rG, rF, rOsc, rOsc2, swarmG,
    gates: [windG, humG, streamG, swellG, swarmG, rG],
    voices: [pad, keys, bells, arp, coin, ping, chime, sweepOsc, brass, pluck, bass],
  };
}

/* The story's continuous levels, at one moment (at: undefined is "now"). */
function levels(A, lv, at, fxOn) {
  A.windG.gain.rampTo(fxOn ? lv.wind * .3 : 0, .15, at);
  A.windF.frequency.rampTo(380 + lv.speed * 2200, .2, at);
  A.humG.gain.rampTo(fxOn ? lv.hum * .22 : 0, .12, at);
  A.fade.gain.rampTo(lv.fade, .1, at);
  if (!A.st.silent && !A.st.fading) A.gate.gain.rampTo(lv.music, .04, at);
  A.st.intensity = lv.intensity; A.st.swarm = fxOn ? lv.swarm : 0; A.st.tick = fxOn ? lv.tick : 0;
  A.swarmG.gain.rampTo(fxOn ? lv.swarm : 0, .15, at);
  const r = lv.riser;
  A.rG.gain.rampTo(r > .001 ? .5 * Math.pow(r, 1.3) : 0, .15, at);
  A.rOsc.frequency.rampTo(110 * Math.pow(2, r * 2.5), .2, at);
  A.rOsc2.frequency.rampTo(220 * Math.pow(2, r * 2.5), .2, at);
  A.rF.frequency.rampTo(400 + r * 4200, .2, at);
  A.level.volume.rampTo(MUSIC_DB + (lv.intensity - .5) * 10, 1, at);
}

/* The voice speaking (or not) at `at`: the score ducks and dips. It goes
   down quickly and comes back slowly, so it never pumps between words. */
function duckFor(A, speaking, at) {
  const m = A.st.mix;
  A.duck.volume.rampTo(speaking ? m.under : 0, speaking ? .25 : .9, at);
  A.presence.gain.linearRampTo(speaking ? m.presence : 0, speaking ? .25 : .9, at);   // linear: an exponential ramp from 0 dB is NaN
}
/* Level a voice: measured once, set on the way in. */
function levelVoice(A, buffer) {
  const chans = []; for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const measured = lufs(chans, buffer.sampleRate);
  if (!Number.isFinite(measured)) throw new Error('the voiceover is silent: nothing to level');
  const gainDb = A.st.mix.voice - measured;
  A.voiceIn.gain.value = dbToGain(gainDb);
  A.musicSwitch.volume.value = A.st.mix.bed;   // the score comes up to sit under a voice
  return { measured, gainDb, speaking: speechMap(chans, buffer.sampleRate, { hold: A.st.mix.gap }) };
}

/* ---------------- live ---------------- */

export function createSound() {
  let Tone = null, A = null, dest = null, starting = null, lastT = null, playing = false, cur = null, seen = null;
  let voiceEl = null, voiceSrc = '', voice = null, wasSpeaking = null;
  const on = { music: true, fx: true };

  function silence() {
    if (!A) return;
    const now = A.ctx.now();
    A.voices.forEach((v) => (v.releaseAll ? v.releaseAll(now) : v.triggerRelease(now)));
    A.gates.forEach((g) => { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(0, now); });
    A.st.swarm = 0; A.st.tick = 0;
  }

  // measure the voiceover the <audio> is playing; the file is already a blob in the page
  function analyse() {
    voiceSrc = voiceEl.currentSrc || voiceEl.src; voice = null;
    A.musicSwitch.volume.value = 0;
    if (!voiceSrc) return;
    const want = voiceSrc;
    Tone.ToneAudioBuffer.fromUrl(want).then((buf) => {
      if (want !== voiceSrc) return;
      voice = levelVoice(A, buf.get());
      console.info(`sound: voiceover ${voice.measured.toFixed(1)} LUFS, levelled by ${voice.gainDb >= 0 ? '+' : ''}${voice.gainDb.toFixed(1)} dB to ${A.st.mix.voice} LUFS`);
    }).catch((e) => { console.error('sound: the voiceover could not be measured, so it plays unlevelled and the score does not duck', e); });
  }

  return {
    start() {
      if (!starting) {
        starting = (async () => {
          Tone = await loadTone();
          await Tone.start();
          if (Tone.getContext().state !== 'running') throw new Error(`the browser is holding audio ${Tone.getContext().state}; click the film once to allow it`);
          A = await buildGraph(Tone);
          dest = A.ctx.createMediaStreamDestination();
          A.ceiling.connect(dest);   // a recording hears what the speakers do
        })();
      }
      return starting;
    },
    ready: () => !!A,
    set(kind, value) {
      on[kind] = value;
      if (!A) return;
      if (kind === 'music') A.musicSwitch.mute = !(value && playing);
      if (kind === 'fx') A.fxBus.mute = !value;
      if (!value) silence();
    },
    update(t, isPlaying, story) {
      if (!A) return;
      const sc = story.score;
      if (!sc) throw new Error('the story returns no score (makeStory should return { score: scoreFor(T, SCORE) })');
      if (story !== seen) { checkSounds(story.sounds); seen = story; cur = null; A.st.mix = sc.mix; }
      if (isPlaying !== playing) {
        playing = isPlaying;
        if (playing) { A.transport.start(); A.musicSwitch.mute = !on.music; A.fxBus.mute = !on.fx; }
        else { A.transport.pause(); A.musicSwitch.mute = true; A.fxBus.mute = true; silence(); }
        lastT = t;
      }
      // the section at the playhead: a change, or a jump (scrub, seek, rebuild)
      const c = sc.at(t);
      if (c !== cur) { A.section(c.name, sc.sections[c.name], A.ctx.now(), cur === null, c.ease ? Math.max(0, c.t - t) : 0); cur = c; }
      levels(A, levelsAt(story, t), undefined, playing && on.fx);
      // the voiceover: a new file is measured; the score ducks while it speaks
      if (voiceEl && (voiceEl.currentSrc || voiceEl.src) !== voiceSrc) analyse();
      const speaking = !!(voice && voiceEl && !voiceEl.paused && voice.speaking(voiceEl.currentTime));
      if (speaking !== wasSpeaking) { duckFor(A, speaking); wasSpeaking = speaking; }
      if (playing && on.fx && lastT !== null && t > lastT && t - lastT < .3 && story.sounds) {
        const tm = A.ctx.now() + .02;
        for (const e of story.sounds) if (e.t > lastT && e.t <= t) A.FX[e.kind](tm, e.v ?? 1);
      }
      lastT = t;
    },
    stream: () => (dest ? dest.stream : null),
    /* Route an <audio> (the voiceover) through the voice chain, so the live
       mix, a recording and the export all hear the same levelled voice. */
    attach(audio) {
      if (!A) return;
      voiceEl = audio;
      if (audio.__routed) return;
      const src = A.ctx.createMediaElementSource(audio);
      Tone.connect(src, A.voiceIn);
      audio.__routed = true;
    },
  };
}

/* ---------------- offline, for the MP4 ---------------- */

export const STEP = .1;
/* The kit's export asks whether a take still speaks past the film's end.
   One definition of speaking, the mix's: loudness.js speechMap. */
export function speechEnvelope(buffer, { lead = .25, hold = .8 } = {}) {
  const chans = []; for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  return speechMap(chans, buffer.sampleRate, { lead, hold });
}

const aborted = () => new DOMException('The export was cancelled.', 'AbortError');

/* The whole soundtrack at once: sections at their times, effects at theirs,
   levels sampled every STEP, the voice mixed with the score ducked under it.
   voiceAt is the film time the voice's 0:00 plays at (negative trims). */
export async function renderSoundtrack({ story, duration, music = true, fx = true, voice = null, voiceAt = 0, voiceMuted = false, sampleRate = 48000, onProgress = () => {}, signal = null }) {
  const Tone = await loadTone();
  const sc = story.score;
  if (!sc) throw new Error('the story returns no score (makeStory should return { score: scoreFor(T, SCORE) })');
  if (fx) checkSounds(story.sounds);
  const live = Tone.getContext();
  const raw = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const ctx = new Tone.OfflineContext(raw);
  Tone.setContext(ctx);
  try {
    const A = await buildGraph(Tone);
    A.musicSwitch.mute = !music; A.fxBus.mute = !fx;
    A.st.mix = sc.mix;
    const lv = voice ? levelVoice(A, voice) : null, speaking = lv ? lv.speaking : null;
    if (voice && voiceMuted) A.voiceIn.gain.value = 0;
    if (voice) {
      const player = new Tone.Player(new Tone.ToneAudioBuffer(voice)).connect(A.voiceIn);
      if (voiceAt >= 0) player.start(voiceAt); else player.start(0, -voiceAt);
    }
    sc.changes.forEach((c, i) => { if (c.start < duration) ctx.setTimeout(() => A.section(c.name, sc.sections[c.name], c.start, i === 0, c.t - c.start), Math.max(0, c.start - .01)); });
    let ducked = false;
    for (let k = 0; k <= Math.floor(duration / STEP); k++) {
      const s = k * STEP;
      ctx.setTimeout(() => {
        if (signal && signal.aborted) throw aborted();
        levels(A, levelsAt(story, s), s, fx);
        if (speaking && speaking(s - voiceAt) !== ducked) { ducked = !ducked; duckFor(A, ducked, s); }
        if (k % 20 === 0) onProgress(.1 * s / duration);
      }, s);
    }
    if (fx && story.sounds) for (const e of story.sounds) {
      if (e.t < 0 || e.t >= duration) continue;
      ctx.setTimeout(() => A.FX[e.kind](e.t, e.v ?? 1), Math.max(0, e.t - .05));
    }
    A.transport.start(0);
    let stop;
    const cancelled = new Promise((_, reject) => { stop = reject; });
    cancelled.catch(() => {});
    if (signal) signal.addEventListener('abort', () => stop(aborted()), { once: true });
    for (let s = 2; s < duration - .5; s += 2) {
      raw.suspend(s).then(() => { onProgress(.1 + .9 * s / duration); if (!(signal && signal.aborted)) return raw.resume(); })
        .catch((e) => stop(new Error(`The soundtrack mix stalled at ${s}s: ${e.message}`)));
    }
    const rendering = ctx.render();
    Tone.setContext(live);
    const out = await Promise.race([cancelled, rendering]);
    onProgress(1);
    return out.get();
  } catch (e) {
    Tone.setContext(live);
    throw e;
  }
}
