import { createRequire } from 'node:module'; import fs from 'node:fs'; import vm from 'node:vm';
const require = createRequire(import.meta.url);
Object.assign(globalThis, require('node-web-audio-api')); globalThis.window = globalThis; globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(require.resolve('tone/build/Tone.js'), 'utf8'));
const { renderSoundtrack, MIX } = await import('../score/sound.js');
const { lufs } = await import('../score/loudness.js');
// sectiontest.mjs '[["label", [["section", {overrides}], ...]], ...]': each
// section of each test plays 6 s from SCORE (every-scanner's); prints LUFS.
const { SCORE } = await import('../every-scanner/story.js');
const tests = JSON.parse(process.argv[2]);
for (const [label, secs] of tests) {
  const sections = secs.map(([name, over]) => [name, { ...SCORE.sections[name], ...over }]);
  const changes = sections.map(([n], i) => ({ t: i * 6, name: n + i }));
  const all = Object.fromEntries(sections.map(([n, s], i) => [n + i, { key: 'D', fade: 2, padTone: 'soft', bars: 2, ...s }]));
  const story = { sounds: [], audio: () => ({}), score: { sections: all, changes, mix: MIX, at: (t) => changes.filter((c) => c.t <= t).pop() } };
  const dur = changes.length * 6, buf = await renderSoundtrack({ story, duration: dur, sampleRate: 24000 });
  const ch = [buf.getChannelData(0), buf.getChannelData(1)], out = [];
  for (let k = 0; k < changes.length; k++) out.push(lufs(ch, buf.sampleRate, k * 6 + 2, (k + 1) * 6).toFixed(1));
  console.log(label.padEnd(28), out.join('  '));
}
process.exit(0);
