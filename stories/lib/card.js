/* card.js - the film card in an article (shared/render.mjs writes it).

   The card is plain HTML: the film's title and length and a play button. This
   is the only film code an article loads up front. Pressing play imports the
   player (embed.js) and turns the card into the film in place. */

for (const fig of document.querySelectorAll('.stz-film[data-film]')) {
  const btn = fig.querySelector('.stz-film-play');
  btn.addEventListener('click', async () => {
    if (fig.classList.contains('is-loading') || fig.classList.contains('is-live')) return;
    fig.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    try {
      const { mountFilm } = await import('./embed.js');
      await mountFilm(fig);
      fig.classList.replace('is-loading', 'is-live');
    } catch (e) {
      console.error('film: could not start', e);
      fig.classList.remove('is-loading');
      fig.classList.add('is-error');
      fig.querySelector('.stz-film-meta').textContent = `The film could not start: ${e.message}`;
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });
}
