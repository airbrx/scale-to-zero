/* export.js - a frame-perfect MP4 of a story, made in the browser.

   The film is a pure function of time, so nothing here plays it: every
   frame is drawn at exactly t = i / FPS into a 1920x1080 canvas and handed
   to WebCodecs, and the soundtrack is rendered offline by lib/sound.js
   (Tone.Offline) with every effect at its exact moment. A slow machine
   makes a slow export, never a dropped frame or a drifting voice.

   Video: H.264 through VideoEncoder. Audio: AAC through AudioEncoder.
   Both go into an MP4 by mp4-muxer, with the index at the front (fast
   start) so it plays as it downloads, on LinkedIn too. Nothing is sent
   anywhere; the file is assembled in memory and saved.

   Chrome and Edge do all of this. Where a piece is missing, check() says
   exactly which, before any work starts. */

import { drawFilm, palette } from './film.js';
import { captionAt, burnCaption } from './captions.js';
import { renderSoundtrack, speechEnvelope } from './sound.js';

export const FPS = 30, WIDTH = 1920, HEIGHT = 1080, SAMPLE_RATE = 48000;
const VIDEO_BITRATE = 9e6, AUDIO_BITRATE = 192e3, KEY_EVERY = 2 * FPS;
// High, Main, then Constrained Baseline, all at level 4.0 (1080p30)
const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];
const AAC = 'mp4a.40.2';
const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs';

/* ---- the arithmetic, kept pure so it can be checked without a browser ---- */

// Every frame from t = 0 up to and including the last moment of the film.
export const frameCount = (total, fps = FPS) => Math.floor(total * fps + 1e-6) + 1;
// Microseconds, rounded per frame so 30 fps never accumulates drift.
export const frameTime = (i, fps = FPS) => Math.round(i * 1e6 / fps);
export const frameDuration = (i, fps = FPS) => frameTime(i + 1, fps) - frameTime(i, fps);
// The film time of a frame: exact, and never past the end.
export const filmTime = (i, total, fps = FPS) => Math.min(i / fps, total);

/* ---- what the browser can do ---- */

/* Which video codec to use, and whether audio can be made. Throws with a
   sentence a person can act on when something is missing. */
export async function check({ audio }) {
  const missing = [];
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') missing.push('WebCodecs video encoding (VideoEncoder)');
  if (audio && typeof AudioEncoder === 'undefined') missing.push('WebCodecs audio encoding (AudioEncoder)');
  if (audio && typeof OfflineAudioContext === 'undefined') missing.push('offline audio rendering (OfflineAudioContext)');
  if (missing.length) throw new Error(`This browser cannot export an MP4: it has no ${missing.join(' and no ')}. Use a current Chrome or Edge, or press w to record in real time.`);

  let codec = null;
  for (const c of AVC) {
    const r = await VideoEncoder.isConfigSupported(videoConfig(c));
    if (r.supported) { codec = c; break; }
  }
  if (!codec) throw new Error(`This browser cannot encode H.264 video at ${WIDTH}x${HEIGHT} (tried ${AVC.join(', ')}). Use a current Chrome or Edge, or press w to record in real time.`);

  if (audio) {
    const r = await AudioEncoder.isConfigSupported(audioConfig());
    if (!r.supported) throw new Error(`This browser cannot encode AAC audio (${AAC}), so the MP4 would have no sound. Chrome and Edge on Windows and macOS can; Chromium on Linux cannot. Untick the sound and unload the MP3 for a silent export, or press w to record in real time.`);
  }
  return { codec };
}

const videoConfig = (codec) => ({ codec, width: WIDTH, height: HEIGHT, bitrate: VIDEO_BITRATE, framerate: FPS, latencyMode: 'quality', avc: { format: 'avc' } });
const audioConfig = () => ({ codec: AAC, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE });

let muxerLoading = null;
function loadMuxer() {
  if (!muxerLoading) {
    muxerLoading = import(MUXER_URL).catch((e) => {
      muxerLoading = null;
      throw new Error(`The MP4 muxer could not be loaded from ${MUXER_URL}: ${e.message}`);
    });
  }
  return muxerLoading;
}

/* The voiceover file as an AudioBuffer at the export's sample rate. */
export async function decodeVoice(file) {
  const bytes = await file.arrayBuffer();
  try { return await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes); }
  catch (e) { throw new Error(`${file.name} could not be decoded as audio: ${e.message}`); }
}

/* Whether the voice says anything after `end`: an MP3 that only runs long
   on trailing silence is fine to cut. */
function voiceAfter(voice, end) {
  const speaking = speechEnvelope(voice, { lead: 0, hold: 0 });
  for (let t = end; t < voice.duration; t += .05) if (speaking(t)) return true;
  return false;
}

// Back to the event loop between frames, without setTimeout's 4ms floor or
// its throttling in a background tab.
const channel = new MessageChannel(), waiting = [];
channel.port1.onmessage = () => waiting.shift()();
const yieldNow = () => new Promise((r) => { waiting.push(r); channel.port2.postMessage(0); });

const cancelled = () => new DOMException('The export was cancelled.', 'AbortError');

/* Render the film to an MP4 Blob.
   story, T     what to draw (a fresh makeStory(T)) and its timeline
   captions     burn the script's lines into the frame
   music, fx    the score and the effects, rendered offline
   voice        the voiceover AudioBuffer from decodeVoice, or null
   voiceAt      the film time at which the voice's 0:00 plays (negative
                trims its head: dead air before the first word)
   canvas       the 1920x1080 canvas to draw into (the caller may show it)
   onProgress   ({ phase, done, total }) as it goes; phase is 'audio',
                'video' or 'mux'
   signal       an AbortSignal; aborting rejects with an AbortError */
export async function exportMp4({ story, T, captions, music, fx, voice, voiceAt = 0, canvas, onProgress = () => {}, signal }) {
  const hasAudio = music || fx || !!voice;
  const { codec } = await check({ audio: hasAudio });
  const { Muxer, ArrayBufferTarget } = await loadMuxer();

  const frames = frameCount(T.total);
  const duration = frames / FPS;
  if (voice && voiceAt + voice.duration > duration && voiceAfter(voice, duration - voiceAt)) {
    throw new Error(`The loaded audio, placed as set, ends at ${(voiceAt + voice.duration).toFixed(1)}s but the film runs ${T.total.toFixed(1)}s, so the MP4 would cut the end of the voice. Check "Voice starts at", pick Voiceover timing aligned to this take, or change the reading speed.`);
  }

  // the soundtrack first: if it is going to fail, fail before the long part
  let sound = null;
  if (hasAudio) {
    onProgress({ phase: 'audio', done: 0, total: 1 });
    sound = await renderSoundtrack({ story, duration, music, fx, voice, voiceAt, sampleRate: SAMPLE_RATE, signal, onProgress: (f) => onProgress({ phase: 'audio', done: f, total: 1 }) });
    if (signal && signal.aborted) throw cancelled();
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FPS },
    audio: hasAudio ? { codec: 'aac', numberOfChannels: 2, sampleRate: SAMPLE_RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let failure = null;
  const fail = (what) => (e) => { failure = failure || new Error(`The ${what} encoder failed: ${e.message}`); };
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail('video') });
  const aenc = hasAudio ? new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail('audio') }) : null;
  const close = () => { [venc, aenc].forEach((e) => { if (e && e.state !== 'closed') e.close(); }); };

  try {
    venc.configure(videoConfig(codec));

    if (aenc) {
      aenc.configure(audioConfig());
      encodeAudio(aenc, sound);
      await aenc.flush();
      if (failure) throw failure;
    }

    const g = canvas.getContext('2d');
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw cancelled();
      if (failure) throw failure;
      const t = filmTime(i, T.total), now = performance.now();
      drawFilm(canvas, story, t, now, { fixed: [WIDTH, HEIGHT], rec: true });
      if (captions) burnCaption(g, captionAt(T, t), palette(now));
      const frame = new VideoFrame(canvas, { timestamp: frameTime(i), duration: frameDuration(i) });
      venc.encode(frame, { keyFrame: i % KEY_EVERY === 0 });
      frame.close();
      // let the encoder catch up rather than queue the whole film in memory
      while (venc.encodeQueueSize > 4 && !failure) await new Promise((r) => setTimeout(r, 2));
      onProgress({ phase: 'video', done: i + 1, total: frames });
      await yieldNow();
    }
    await venc.flush();
    if (failure) throw failure;

    onProgress({ phase: 'mux', done: frames, total: frames });
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    close();
  }
}

/* The whole soundtrack into the AAC encoder, in tenth-of-a-second pieces,
   each stamped with its exact place in microseconds. */
function encodeAudio(aenc, buf) {
  const size = SAMPLE_RATE / 10, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  for (let at = 0; at < buf.length; at += size) {
    const n = Math.min(size, buf.length - at), data = new Float32Array(n * 2);
    data.set(L.subarray(at, at + n), 0); data.set(R.subarray(at, at + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(at * 1e6 / SAMPLE_RATE), data });
    aenc.encode(ad);
    ad.close();
  }
}
