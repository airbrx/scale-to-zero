/* theme.js - light or dark for every story, before the first paint.

   Loaded as a plain script at the top of the viewer and the presenter. The
   choice lives under its own key, so setting a story dark for a recording
   doesn't change anything else in the browser, and nothing else changes a
   take halfway through.

   Every open window listens for the storage event, so the presenter's toggle
   flips the story window too. Light (ink on paper) is the default. */
(function () {
  var KEY = 'airbrx-stories:theme';
  function read() {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; }
    catch (e) { console.warn('theme: localStorage unavailable, using light', e); return 'light'; }
  }
  function apply() { document.documentElement.classList.toggle('dark', read() === 'dark'); }
  apply();
  addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  window.storyTheme = {
    get: read,
    toggle: function () {
      var next = read() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (e) { console.error('theme: could not save the theme', e); }
      apply();
      return next;
    },
  };
})();
