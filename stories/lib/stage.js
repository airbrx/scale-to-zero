/* stage.js - "Send to staging" in the story window's bar, beside Record.

   A draft film (stories/manifest.local.json: the film of an unpublished
   article) is kept out of the public repository, so CI never puts it on
   staging. The local admin (npm run dev in admin/) builds it and sends it:
   POST /api/films/{slug}/draft (admin/server.mjs). That needs the admin and
   its sign-in (/admin/auth.js), so the button appears only when the local
   admin serves this window, and only for a draft. A film in manifest.json
   reaches staging by a push to main. The viewer never imports this in a
   published film. */

export async function stagingButton({ beside, fail }) {
  // the film's folder, which is its slug on staging (the viewer's own slug is a storage key)
  const slug = decodeURIComponent(location.pathname.split('/').slice(-2, -1)[0] || '');
  if (!slug) return;
  const cfgRes = await fetch('/admin/config.json');
  if (cfgRes.status === 404) return;   // a plain static server: no admin, nothing to send to
  if (!cfgRes.ok) throw new Error(`/admin/config.json: HTTP ${cfgRes.status}`);
  const cfg = await cfgRes.json();
  if (!cfg.googleClientId) throw new Error('/admin/config.json has no googleClientId (docs/ADMIN.md)');

  const locRes = await fetch(new URL('../manifest.local.json', location.href), { cache: 'no-cache' });
  if (locRes.status === 404) return;
  if (!locRes.ok) throw new Error(`manifest.local.json: HTTP ${locRes.status}`);
  if (!(await locRes.json()).stories.some((s) => s.slug === slug)) return;

  const auth = await import('/admin/auth.js');
  const btn = document.createElement('button');
  btn.className = 'btn'; btn.type = 'button'; btn.id = 'stage';
  btn.textContent = 'Send to staging';
  btn.title = 'Build this draft film and put it on staging; publishing its article in the admin takes it live';
  beside.before(btn);
  // Google's own button, the only sign-in it allows, in a card above the bar
  const card = document.createElement('div');
  card.hidden = true;
  card.style.cssText = 'position:fixed;right:16px;bottom:84px;z-index:20;padding:14px;background:var(--ctl);border:1px solid var(--line-strong);font:13px var(--sans);color:var(--text)';
  card.innerHTML = '<p style="margin:0 0 10px">Sign in to the admin to send this film to staging.</p><div></div>';
  document.body.append(card);

  let pending = false;
  async function send() {
    pending = false; card.hidden = true;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await auth.api(`/films/${encodeURIComponent(slug)}/draft`, { method: 'POST' });
      btn.textContent = '✓ On staging';
      btn.title = `Sent to staging at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Send again after a new take.`;
    } catch (e) {
      btn.textContent = 'Send to staging';
      fail(`Not sent to staging: ${e.message}`, e);
    } finally {
      btn.disabled = false;
    }
  }
  await auth.init(cfg.googleClientId, (session, message) => {
    if (message) fail(`Sign-in: ${message}`);
    if (session && pending) send();
  });
  btn.addEventListener('click', () => {
    if (auth.isSignedIn()) { send(); return; }
    pending = true; card.hidden = false;
    auth.renderButton(card.querySelector('div'));
  });
}
