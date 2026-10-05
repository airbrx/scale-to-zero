/* sync.js - the story window and the presenter, on one clock.

   Same-origin windows share a BroadcastChannel per story. Whichever window
   the person last touched leads: it announces play, pause and seek at once,
   and its position every half second while playing, and the other follows.
   A newly opened window asks for the state and the leader answers, so
   "Open story window" lands on the prompter's own moment.

   Messages carry the timing too (script or voiceover, and the speed), since
   two windows on different timelines would agree on t and still disagree
   about which word it is. */

export function link(slug, onState) {
  if (!('BroadcastChannel' in window)) { console.warn('sync: no BroadcastChannel; windows run independently'); return { lead() {}, send() {}, leading: () => true }; }
  const bc = new BroadcastChannel(`airbrx-story-${slug}`);
  const me = Math.random().toString(36).slice(2);
  let leading = false, getState = null;
  bc.onmessage = (e) => {
    const m = e.data;
    if (!m || m.from === me) return;
    if (m.type === 'hello') { if (leading && getState) bc.postMessage({ type: 'state', ...getState(), from: me, sent: Date.now() }); return; }
    if (m.type === 'state') {
      leading = false;
      // a playing clock moved on while the message was in flight
      const lag = m.playing ? Math.max(0, (Date.now() - m.sent) / 1000) : 0;
      onState({ ...m, t: m.t + lag });
    }
  };
  bc.postMessage({ type: 'hello', from: me });
  return {
    /* This window now leads; `state()` reports { t, playing, clock, wpm }. */
    lead(state) { leading = true; getState = state; this.send(); },
    send() { if (getState) bc.postMessage({ type: 'state', ...getState(), from: me, sent: Date.now() }); },
    leading: () => leading,
    watch(state) { getState = state; },
  };
}
