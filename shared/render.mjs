// Pure rendering. No filesystem, no S3, no network.
//
// Both renderers use this: pipeline/build.mjs (local, from articles/*.json) and
// the admin Lambda (from the staging bucket). If it lived in only one of them,
// an article published through the admin would drift from one built locally --
// same content, different HTML, and nobody notices until the diff is enormous.

export const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Who publishes this, and where readers go next. Kept here, not in
 * config.json: both renderers -- pipeline/build.mjs and the admin Lambda --
 * load this file, so a link change ships with the code and cannot drift
 * between the local config and the admin's copy in staging.
 */
export const AIRBRX = {
  org: "airbrx",
  url: "https://airbrx.ai",
  logo: "https://airbrx.ai/lib/logo.png",
  author: "The airbrx community",
  about: "https://airbrx.ai/about.html",
  manifesto: "https://airbrx.ai/articles/flat-stack-manifesto.html",
  flatStack: "https://airbrx.ai/flat-stack.html",
  cache: "https://airbrx.ai/articles/",
  scan: "https://airbrx.ai/scan.html",
  howItWorks: "https://airbrx.ai/how-it-works.html",
  gatewayBuilt: "https://airbrx.ai/articles/gateway-flat-stack-built.html",
  repo: "https://github.com/airbrx/scale-to-zero",
};

// Body copy is plain text with blank-line paragraph breaks.
// Supports **bold**, *italic*, `code`, [text](url).
export function para(text = "") {
  if (!text.trim()) return "";
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => {
      const html = esc(p.trim())
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
        .replace(/\n/g, "<br>");
      return `<p>${html}</p>`;
    })
    .join("\n");
}

export const fmtDate = (iso, locale = "en-US") =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });

export const fmtDuration = (sec) => {
  if (!sec || !Number.isFinite(sec)) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

// ------------------------------------------------------------------ chrome
/**
 * Open Graph and Twitter/X tags for a page's link preview. Crawlers need an
 * absolute URL, and width/height/alt let them lay the card out without
 * fetching the image first.
 */
function socialImageTags(image) {
  if (!image) return "";
  return `<meta property="og:image" content="${esc(image.url)}">
<meta property="og:image:width" content="${image.width}">
<meta property="og:image:height" content="${image.height}">
<meta property="og:image:alt" content="${esc(image.alt)}">
<meta name="twitter:image" content="${esc(image.url)}">
<meta name="twitter:image:alt" content="${esc(image.alt)}">
`;
}

/**
 * @param {{url:string, width:number, height:number, alt:string}} [image]  link-preview image
 */
export function head(site, title, description, canonical, extra = "", image = null) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
${socialImageTags(image)}<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="/feed.xml">
<link rel="stylesheet" href="/assets/style.css${site.assetVersion ? `?v=${esc(site.assetVersion)}` : ""}">
${extra}
</head>
<body>
<header class="masthead">
  <a class="wordmark" href="/">
    <span class="wordmark-the">The</span> Scale-to-Zero <span class="wordmark-report">Report</span>
  </a>
  <p class="masthead-tag">${esc(site.tagline)}</p>
  <p class="masthead-community">A community project of <a href="${esc(AIRBRX.url)}" rel="noopener">airbrx</a></p>
  <nav class="masthead-nav">
    <a href="/">Archive</a>
    <a href="/flat-stack.html">Flat Stack</a>
    <a href="/scorecard.html">Scorecard</a>
    <a href="${esc(AIRBRX.repo)}" rel="noopener">Contribute</a>
    <a href="/feed.xml">RSS</a>
    <a href="${esc(AIRBRX.url)}" rel="noopener">airbrx</a>
  </nav>
</header>`;
}

/**
 * Who publishes this and where to go next. Chrome, not argument: it sits
 * after the article, so a piece is never a vendor pitch (docs/EDITORIAL.md),
 * but every reader who finishes one is a click from airbrx and from the repo.
 */
export function communityCard(site) {
  const a = AIRBRX;
  return `  <aside class="community">
    <p class="community-label">About this publication</p>
    <p class="community-body">The Scale-to-Zero Report is a community project of <a href="${esc(AIRBRX.url)}" rel="noopener">airbrx</a>.
    Every piece is measured against <a href="${esc(AIRBRX.manifesto)}" rel="noopener">the flat-stack manifesto</a>;
    <a href="${esc(a.gatewayBuilt)}" rel="noopener">the airbrx gateway</a> is that doctrine shipped as a product.</p>
    <ul class="community-links">
      <li><a href="${esc(a.scan)}" rel="noopener">Scan your own query history</a></li>
      <li><a href="/scorecard.html">Score a repository against the flat stack</a></li>
      <li><a href="${esc(AIRBRX.repo)}" rel="noopener">Send a story or a fix on GitHub</a></li>
      <li><a href="${esc(a.cache)}" rel="noopener">More from The Cache at airbrx</a></li>
    </ul>
  </aside>`;
}

export function foot(site) {
  const a = AIRBRX;
  return `
<footer class="footer">
  <p class="footer-thesis">Every article here answers one question: <em>what would this have cost with almost no running computers?</em></p>
  <p class="footer-meta">
    ${esc(site.name)} is a community project of <a href="${esc(AIRBRX.url)}" rel="noopener">airbrx</a>,
    written from <a href="${esc(AIRBRX.manifesto)}" rel="noopener">the flat-stack manifesto</a>.
    Stories, fixes, and scorecard checks are welcome <a href="${esc(AIRBRX.repo)}" rel="noopener">on GitHub</a>.
  </p>
  <nav class="footer-links" aria-label="From airbrx">
    <a href="${esc(a.flatStack)}" rel="noopener">Flat-stack</a>
    <a href="${esc(a.cache)}" rel="noopener"><span class="fl-more">The </span>Cache</a>
    <a href="${esc(a.howItWorks)}" rel="noopener"><span class="fl-more">The </span>gateway</a>
    <a href="${esc(a.scan)}" rel="noopener">Scan<span class="fl-more"> your queries</span></a>
    <a href="${esc(a.about)}" rel="noopener">About<span class="fl-more"> airbrx</span></a>
  </nav>
  <p class="footer-meta footer-dogfood">
    This site runs on the architecture it advocates: static files on object storage behind a CDN.
    No server, no database, no runtime. It costs the same whether one person reads it or a million do.
  </p>
</footer>
</body>
</html>`;
}

// ----------------------------------------------------------------- article
const SECTION_ORDER = [
  ["whatHappened", "What happened"],
  ["theArchitectureUnderneath", "The architecture underneath"],
  ["whatItCost", "What it cost"],
  ["theFlatStackVersion", "The flat-stack version"],
  ["theUncomfortablePart", "The uncomfortable part"],
];

// The audio block for templateType:"podcast". A plain <audio> element: no
// player library, no JS, and it still works with scripting disabled.
function audioBlock(a) {
  if (a.templateType !== "podcast" || !a.audio?.url) return "";
  const dur = fmtDuration(a.audio.durationSeconds);
  return `
  <aside class="audio-card">
    <p class="audio-label">Listen${dur ? ` &middot; ${esc(dur)}` : ""}</p>
    <audio class="audio-player" controls preload="none" src="${esc(a.audio.url)}">
      <a href="${esc(a.audio.url)}">Download the audio</a>
    </audio>
${a.audio.transcriptNote ? `    <p class="audio-note">${esc(a.audio.transcriptNote)}</p>` : ""}
  </aside>`;
}

// The body is authored in CKEditor and stored as HTML. Admins are trusted, but
// stored HTML rendered onto a public page still deserves a conservative pass: a
// compromised admin session should not be able to plant a script tag that every
// reader then executes.
const SANITIZE = [
  [/<\s*(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?<\/\s*\1\s*>/gi, ""],
  [/<\s*(script|iframe|object|embed|form|link|meta|base)\b[^>]*\/?>/gi, ""],
  [/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""],
  [/(href|src|action)\s*=\s*("|')?\s*javascript:[^"'\s>]*("|')?/gi, ""],
];

// A film (stories/), attached in the admin. The article carries only this card
// and a small loader (/films/lib/card.js); pressing play loads the film from
// /films/<slug>/ and plays it in the card's place. Nothing of the film
// downloads until then, and the page itself needs no script to be read.
function filmBlock(a) {
  const f = a.film;
  if (!f?.slug) return "";
  const len = fmtDuration(f.durationSeconds);
  return `  <figure class="stz-film" data-film="/films/${esc(f.slug)}/">
    <div class="stz-film-stage">
      <div class="stz-film-face">
        <p class="stz-film-kicker">The film${len ? ` &middot; ${esc(len)}` : ""}</p>
        <p class="stz-film-title">${esc(f.title)}</p>
        <p class="stz-film-meta">Narrated, and drawn live in your browser from its script. No video file.</p>
        <button class="stz-film-play" type="button" aria-label="Play the film: ${esc(f.title)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z"/></svg></button>
      </div>
    </div>
  </figure>
`;
}
const filmHead = (a) => (a.film?.slug
  ? `<link rel="stylesheet" href="/films/brand/embed.css">\n<script type="module" src="/films/lib/card.js"></script>\n`
  : "");

export function sanitizeHtml(html = "") {
  let out = String(html);
  for (const [re, rep] of SANITIZE) out = out.replace(re, rep);
  return out;
}

export function articleHtml(site, tax, a) {
  const canonical = `${site.baseUrl}/${a.slug}.html`;
  // Free-form body is the current model. `sections` is still rendered when an
  // article predates the switch, so nothing already published breaks.
  const freeBody = a.body ? `  <div class="article-body">\n${sanitizeHtml(a.body)}\n  </div>` : "";
  const secs = a.body
    ? []
    : SECTION_ORDER
        .map(([k, label]) => [label, a.sections?.[k]])
        .filter(([, body]) => body && body.trim());

  const ld = {
    "@context": "https://schema.org",
    "@type": a.templateType === "podcast" ? "PodcastEpisode" : "NewsArticle",
    headline: a.headline,
    description: a.dek,
    datePublished: a.date,
    // Written by the community, published by airbrx: organizations, not a person.
    author: { "@type": "Organization", name: AIRBRX.author, url: AIRBRX.about },
    publisher: {
      "@type": "Organization", name: AIRBRX.org, url: AIRBRX.url,
      logo: { "@type": "ImageObject", url: AIRBRX.logo },
    },
    mainEntityOfPage: canonical,
    ...(a.audio?.url ? { associatedMedia: { "@type": "MediaObject", contentUrl: a.audio.url } } : {}),
  };

  return `${head(site, `${a.headline} - ${site.shortName}`, a.dek, canonical,
    `${filmHead(a)}<script type="application/ld+json">${JSON.stringify(ld)}</script>`)}
<main class="wrap">
<article class="article">
  <div class="article-kicker">
    <span class="tag tag-${esc(String(a.category).toLowerCase())}">${esc(a.categoryLabel)}</span>
    <time datetime="${esc(a.date)}">${esc(fmtDate(a.date, site.locale))}</time>
${a.templateType === "podcast" ? `    <span class="tag tag-audio">Audio</span>\n` : ""}  </div>

  <h1 class="article-title">${esc(a.headline)}</h1>
  <p class="article-dek">${esc(a.dek)}</p>
${audioBlock(a)}
${filmBlock(a)}
  <aside class="source-card">
    <p class="source-label">The story</p>
    <p class="source-title"><a href="${esc(a.source.url)}" rel="noopener nofollow">${esc(a.source.title)}</a></p>
    <p class="source-meta">${esc(a.source.publisher)}${a.source.figure ? ` &middot; <strong>${esc(a.source.figure)}</strong>` : ""}${
      a.source.discussionUrl ? ` &middot; <a href="${esc(a.source.discussionUrl)}" rel="noopener nofollow">discussion</a>` : ""
    }</p>
  </aside>

${freeBody}${secs.map(([h, body]) => `  <section class="section">
    <h2>${esc(h)}</h2>
${para(body)}
  </section>`).join("\n")}

${a.pullQuote ? `  <blockquote class="pull">${esc(a.pullQuote)}</blockquote>` : ""}

  <aside class="rebuttal">
    <p class="rebuttal-label">The principle</p>
    <p class="rebuttal-body">${esc(tax.flatStackAngles?.[a.flatStackAngle] ?? "")}</p>
  </aside>

${communityCard(site)}
</article>
</main>
${foot(site)}`;
}

// ------------------------------------------------------------------- index
export function indexHtml(site, articles) {
  const cards = articles.map((a) => `  <li class="card">
    <a class="card-link" href="/${esc(a.slug)}.html">
      <div class="card-kicker">
        <span class="tag tag-${esc(String(a.category).toLowerCase())}">${esc(a.categoryLabel)}</span>
        <time datetime="${esc(a.date)}">${esc(fmtDate(a.date, site.locale))}</time>
${a.templateType === "podcast" ? `        <span class="tag tag-audio">Audio</span>\n` : ""}      </div>
      <h2 class="card-title">${esc(a.headline)}</h2>
      <p class="card-dek">${esc(a.dek)}</p>
      <p class="card-source">re: ${esc(a.source.publisher)}</p>
    </a>
  </li>`).join("\n");

  return `${head(site, `${site.name} - ${site.tagline}`, site.description, site.baseUrl)}
<main class="wrap">
  <section class="lede">
    <h1>${esc(site.description)}</h1>
    <p>Somebody is always paying for compute they did not need. We find the receipts in the day's news, then rebuild the thing flat: open formats, precomputed answers, static delivery, and no server standing around waiting to be billed for.</p>
    <p class="lede-community">A community project of <a href="${esc(AIRBRX.url)}" rel="noopener">airbrx</a>, measured against <a href="${esc(AIRBRX.manifesto)}" rel="noopener">the flat-stack manifesto</a>. Know a story that belongs here? <a href="${esc(AIRBRX.repo)}" rel="noopener">Send it on GitHub</a>.</p>
  </section>
  ${articles.length ? `<ul class="cards">\n${cards}\n  </ul>` :
    `<p class="empty">No articles published yet. Run the pipeline, claim a story, publish.</p>`}
</main>
${foot(site)}`;
}

// --------------------------------------------------------------- manifesto
export function manifestoHtml(site, m) {
  const sections = m.sections.map((s) => `  <section class="section">
    <h2>${esc(s.heading)}</h2>
${s.kicker ? `    <p class="section-kicker">${esc(s.kicker)}</p>\n` : ""}${para(s.body)}
  </section>`).join("\n");

  const principles = m.principles.map((p, i) => `      <li class="principle">
        <span class="principle-num">${String(i + 1).padStart(2, "0")}</span>
        <div class="principle-text">
          <p class="principle-name">${esc(p.name)}</p>
${para(p.body)}
        </div>
      </li>`).join("\n");

  return `${head(site, `${m.title} - ${site.shortName}`, m.standfirst, `${site.baseUrl}/flat-stack.html`)}
<main class="wrap">
  <article class="article manifesto">
    <h1 class="article-title">${esc(m.title)}</h1>
    <p class="manifesto-standfirst">${esc(m.standfirst)}</p>
    <p class="article-dek">${esc(m.dek)}</p>

${sections}

  <section class="section">
    <h2>${esc(m.principlesHeading)}</h2>
    <p class="section-kicker">${esc(m.principlesKicker)}</p>
    <ol class="principles">
${principles}
    </ol>
  </section>

  <section class="section">
    <h2>${esc(m.closing.heading)}</h2>
${para(m.closing.body)}
  </section>

  <aside class="rebuttal">
    <p class="rebuttal-label">Provenance</p>
${para(m.attribution).replace(/<p>/g, '<p class="rebuttal-body">')}
  </aside>
  </article>
</main>
${foot(site)}`;
}

// --------------------------------------------------------------- scorecard
/**
 * The one page on the site that needs JavaScript, and it says so. The shell and
 * the explanation are static; assets/scorecard/app.js does the reading, in the
 * reader's browser, so there is still no server.
 */
export function scorecardHtml(site) {
  const description = "Score any public GitHub or GitLab repository against the flat-stack manifesto. Runs in your browser; no account, no server.";
  const image = {
    url: `${site.baseUrl}/assets/scorecard-social.png`,
    width: 1600, height: 900,
    alt: "Flat-stack report cards for supabase, n8n, phaser, pixijs and hoppscotch, each graded A to F against the nine rules.",
  };
  return `${head(site, `Flat-stack scorecard - ${site.shortName}`, description, `${site.baseUrl}/scorecard.html`,
    '<script type="module" src="/assets/scorecard/app.js"></script>', image)}
<main class="wrap scorecard">
  <section class="lede">
    <h1>How flat is your stack?</h1>
    <p>Paste a public repository. The scorecard reads it file by file, straight from the git host, and grades it against the nine principles of <a href="/flat-stack.html">the flat stack</a>. Every verdict shows the files it came from.</p>
  </section>

  <form id="sc-form" class="sc-form" autocomplete="off">
    <label for="sc-repo" class="sc-label">Public repository</label>
    <div class="sc-row">
      <input id="sc-repo" name="repo" type="text" inputmode="url" spellcheck="false"
        placeholder="github.com/owner/repo" required>
      <button type="submit">Score it</button>
    </div>
    <p class="sc-hint">GitHub or GitLab. A repository, a branch (&hellip;/tree/main), or one folder of a monorepo (&hellip;/tree/main/packages/api).</p>
  </form>

  <noscript><p class="sc-noscript">This is the one page here that needs JavaScript. It reads the repository from your browser so that no server has to.</p></noscript>

  <section id="sc-status" class="sc-status" aria-live="polite" hidden></section>
  <section id="sc-result" class="sc-result" hidden></section>
  <section id="sc-recent" class="sc-recent" hidden></section>

  <section class="section">
    <h2>How it reads a repository</h2>
${para(`It runs where you are reading this. Your browser asks GitHub or GitLab for the file list, then fetches the handful of files the checks need: manifests, lockfiles, pages, entry points, infrastructure templates. Nothing is cloned, nothing is uploaded, and there is no account to sign in with. The repository sits in memory for one scan, and the finished scorecard is kept in this browser only, so a rescan of an unchanged repo is instant.

GitHub allows 60 anonymous API requests an hour from each address, and a scan spends three. When they run out, the scorecard reads through the jsDelivr mirror instead and says so at the top of the result.

The checks are grouped by language. Every repository gets the common ones: always-on infrastructure, committed secrets, tests, documentation. HTML pages and Node.js projects get their own on top. Each language is one self-contained file of checks, so adding the next one touches nothing else.`)}
  </section>

  <section class="section">
    <h2>What it does not measure</h2>
${para(`It reads what is committed, not what is deployed. A repo with no infrastructure templates might be running on a fleet of servers someone set up by hand, and the scorecard will not know. A server that looks always-on might sit behind a runtime that stops it, configured somewhere outside the repo.

It pattern-matches. It does not execute. The secret scan finds the shapes of well-known keys, not every credential, and a pass on it is no substitute for a real scanner in CI. Very large repositories are sampled: at most a few hundred files are read.

The grade is a conversation starter, not an audit. Each principle is weighted equally, and each verdict links to the lines behind it, so when a grade looks wrong you can see exactly which rule made it.`)}
  </section>

  <section class="section">
    <h2>Whose rules these are</h2>
    <p>The nine principles are airbrx's <a href="${esc(AIRBRX.manifesto)}" rel="noopener">flat-stack manifesto</a>, the doctrine behind <a href="${esc(AIRBRX.gatewayBuilt)}" rel="noopener">the airbrx gateway</a>. The scorecard is a community project: a check that misjudged your repo, or a language it does not read yet, is <a href="${esc(AIRBRX.repo)}" rel="noopener">an issue or a pull request away</a>. If the grade points at a warehouse bill, <a href="${esc(AIRBRX.scan)}" rel="noopener">scan your query history</a> to see what the repetition costs.</p>
  </section>
</main>
${foot(site)}`;
}

// ------------------------------------------------------------------ yahtzee
/**
 * A multiplayer game with no game server. The page is static; the browsers
 * find each other through public Nostr relays and then talk directly over
 * WebRTC (assets/yahtzee/). It lives under /games/ so the edge can give it the
 * camera and microphone that every other page is denied (infra/wire-edge.mjs).
 */
export function yahtzeeHtml(site) {
  const description = "Multiplayer Yahtzee with no game server: the browsers at the table talk to each other directly. Dice, chat, photos and video.";
  return `${head(site, `Flat Yahtzee - ${site.shortName}`, description, `${site.baseUrl}/games/yahtzee.html`,
    '<link rel="stylesheet" href="/assets/yahtzee/yahtzee.css">\n<script type="module" src="/assets/yahtzee/app.js"></script>')}
<main class="wrap yz">
  <section class="lede">
    <h1>Flat Yahtzee</h1>
    <p>Five dice, up to six players, and no server. Start a table, send the link, and the browsers that open it play each other directly. When the game ends and the tab closes, nothing is left running anywhere.</p>
  </section>

  <noscript><p class="sc-noscript">The game runs in your browser, so it needs JavaScript. That is what lets it run without a server.</p></noscript>

  <form id="yz-setup" class="yz-setup" autocomplete="off">
    <label for="yz-name" class="sc-label">Your name</label>
    <div class="sc-row">
      <input id="yz-name" name="name" type="text" maxlength="24" spellcheck="false" required>
      <button id="yz-go" type="submit">Start a game</button>
    </div>
    <p id="yz-setup-note" class="sc-hint"></p>
  </form>

  <section id="yz-table" class="yz-table" hidden>
    <div class="yz-bar">
      <div class="yz-invite">
        <label for="yz-link" class="sc-label">Invite link</label>
        <div class="sc-row">
          <input id="yz-link" type="text" readonly spellcheck="false">
          <button id="yz-copy" type="button">Copy link</button>
        </div>
      </div>
      <form id="yz-rename" class="yz-rename" autocomplete="off">
        <label for="yz-me" class="sc-label">Playing as</label>
        <div class="sc-row">
          <input id="yz-me" type="text" maxlength="24" spellcheck="false">
          <button type="submit" class="yz-btn-quiet">Rename</button>
        </div>
      </form>
    </div>
    <p id="yz-status" class="yz-status" aria-live="polite"></p>
    <p id="yz-error" class="yz-error" role="alert" hidden></p>

    <div class="yz-grid">
      <div class="yz-play">
        <p id="yz-turn" class="yz-turn" aria-live="polite"></p>
        <div id="yz-dice" class="yz-dice" role="group" aria-label="Dice. Tap a die to hold it."></div>
        <div class="yz-actions">
          <button id="yz-roll" type="button">Roll</button>
          <p id="yz-play-for" class="sc-hint" hidden></p>
        </div>
        <div id="yz-host" class="yz-host" hidden></div>
        <div class="yz-card-wrap"><table id="yz-card" class="yz-card"></table></div>
        <ol id="yz-log" class="yz-log" aria-label="What happened"></ol>
      </div>

      <aside class="yz-side">
        <div class="yz-video-head">
          <h2>Table</h2>
          <button id="yz-cam" type="button" class="yz-btn-quiet">Turn on camera</button>
        </div>
        <div id="yz-video" class="yz-video"></div>
        <ol id="yz-chat-list" class="yz-chat-list" aria-label="Chat" aria-live="polite"></ol>
        <form id="yz-chat-form" class="yz-chat-form" autocomplete="off">
          <label class="yz-photo-btn" title="Send a photo or GIF (up to 5 MB)">
            <input id="yz-photo" type="file">
            <span aria-hidden="true">+</span><span class="yz-sr">Send a photo or GIF</span>
          </label>
          <input id="yz-chat-input" type="text" maxlength="500" placeholder="Say something" aria-label="Chat message">
          <button type="submit">Send</button>
        </form>
      </aside>
    </div>
  </section>

  <section class="section">
    <h2>Where the server went</h2>
${para(`A multiplayer game usually means a game server: a machine that holds the room, relays every move and runs whether anyone is playing or not. This one has none. The page is a static file like every other page here.

When you open a table, your browser posts an encrypted note to a handful of public Nostr relays saying, in effect, "anyone with this room code, here is how to reach me." Other browsers with the same link find the note and connect to yours directly over WebRTC, the same technology video calls use. After that, dice, chat, photos and video go browser to browser. The relays never see a move.

The room code lives after the # in the link, and browsers never send that part to a website, so not even this site's own logs can see which tables exist.`)}
  </section>

  <section class="section">
    <h2>Who keeps the score</h2>
${para(`Whoever starts the table is the host. The host's browser rolls the dice, checks every move and signs the game state, and the other browsers accept a state only if it carries that signature. The host can also roll and score for anyone who has stepped away, pass the turn, or sit a player out.

If the host's tab closes, the table waits twelve seconds in case it was a reload, then the next player in seating order takes over. The creator signed the seating list when each player joined, so everyone can check that the new host was entitled to take over, and the game carries on from the last state everyone already had.

What it gives up: the host rolls the dice, so you are trusting the host the way you would trust whoever holds the cup at a real table. Some networks, mostly strict corporate ones, block direct connections, and a player behind one will not be able to join without a relay server, which this page does not run. Video works best for four or five people, because each browser sends its camera separately to every other player.`)}
  </section>
</main>
${foot(site)}`;
}

// -------------------------------------------------------------------- feeds
export function feedXml(site, articles) {
  const items = articles.slice(0, 30).map((a) => `  <item>
    <title>${esc(a.headline)}</title>
    <link>${esc(site.baseUrl)}/${esc(a.slug)}.html</link>
    <guid isPermaLink="true">${esc(site.baseUrl)}/${esc(a.slug)}.html</guid>
    <pubDate>${new Date(`${a.date}T12:00:00Z`).toUTCString()}</pubDate>
    <category>${esc(a.categoryLabel)}</category>
    <description>${esc(a.dek)}</description>
  </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(site.name)}</title>
  <link>${esc(site.baseUrl)}</link>
  <description>${esc(site.description)}</description>
  <language>en-us</language>
  <copyright>A community project of ${esc(AIRBRX.org)} (${esc(AIRBRX.url)})</copyright>
${items}
</channel></rss>`;
}

/**
 * Podcast feed. Only articles with templateType "podcast" and a real audio
 * enclosure. Returns null when there are none, so the caller can skip writing
 * a feed that would fail validation with zero items.
 */
export function podcastXml(site, articles) {
  const eps = articles.filter((a) => a.templateType === "podcast" && a.audio?.url);
  if (!eps.length) return null;

  const items = eps.slice(0, 100).map((a) => `  <item>
    <title>${esc(a.headline)}</title>
    <link>${esc(site.baseUrl)}/${esc(a.slug)}.html</link>
    <guid isPermaLink="false">${esc(a.slug)}</guid>
    <pubDate>${new Date(`${a.date}T12:00:00Z`).toUTCString()}</pubDate>
    <description>${esc(a.dek)}</description>
    <enclosure url="${esc(a.audio.url)}" type="${esc(a.audio.mimeType ?? "audio/mpeg")}" length="${Number(a.audio.byteLength ?? 0)}"/>
    <itunes:duration>${esc(fmtDuration(a.audio.durationSeconds) ?? "0:00")}</itunes:duration>
    <itunes:summary>${esc(a.dek)}</itunes:summary>
    <itunes:explicit>false</itunes:explicit>
  </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>${esc(site.name)}</title>
  <link>${esc(site.baseUrl)}</link>
  <description>${esc(site.description)}</description>
  <language>en-us</language>
  <copyright>A community project of ${esc(AIRBRX.org)} (${esc(AIRBRX.url)})</copyright>
  <itunes:author>${esc(AIRBRX.author)}</itunes:author>
  <itunes:summary>${esc(site.description)}</itunes:summary>
  <itunes:explicit>false</itunes:explicit>
  <itunes:category text="Technology"/>
${items}
</channel></rss>`;
}

/**
 * The page CloudFront serves for anything that is not here.
 *
 * It exists because the distribution had no error page and fell back to
 * returning the entire homepage as a 404 body -- so every scanner probing for
 * /wp-admin/ or /.env was served the full front page. This is a few hundred
 * bytes instead, and CloudFront caches it hard.
 *
 * Note the status is set by CloudFront's CustomErrorResponses, not here. S3
 * answers a missing key with 403 (the bucket policy grants GetObject but not
 * ListBucket), so both 403 and 404 are mapped onto this page with ResponseCode
 * 404 -- which is also why the pre-existing 404-only rule never once fired.
 */
function notFoundHtml(site) {
  return `${head(site, `Not found - ${site.shortName}`,
    "That page is not here.", `${site.baseUrl}/404.html`,
    '<meta name="robots" content="noindex">')}
<main class="wrap">
  <article class="notfound">
    <h1>Not here.</h1>
    <p class="dek">No page lives at that address. It may have been renamed, or it may never have existed.</p>
    <p><a href="/">Back to the archive</a> &middot; <a href="/feed.xml">RSS</a></p>
  </article>
</main>
${foot(site)}`;
}

/** Everything the site needs, from one article list. Used by both renderers. */
// The per-site values the pages cannot render without. (The airbrx links are
// the AIRBRX constant above, so they cannot be missing.)
const REQUIRED_SITE = ["name", "shortName", "tagline", "description", "baseUrl"];

function assertSiteConfig(site) {
  const missing = REQUIRED_SITE.filter((k) => !site?.[k]);
  if (missing.length) throw new Error(`site config is missing ${missing.join(", ")} (config.json, and _internal/config.json in staging for the admin)`);
}

export function renderSite({ site, tax, manifesto, articles }) {
  assertSiteConfig(site);
  const sorted = [...articles].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const files = {};

  for (const a of sorted) files[`${a.slug}.html`] = articleHtml(site, tax, a);
  files["index.html"] = indexHtml(site, sorted);
  files["flat-stack.html"] = manifestoHtml(site, manifesto);
  files["scorecard.html"] = scorecardHtml(site);
  files["games/yahtzee.html"] = yahtzeeHtml(site);
  files["feed.xml"] = feedXml(site, sorted);
  files["404.html"] = notFoundHtml(site);

  const pod = podcastXml(site, sorted);
  if (pod) files["podcast.xml"] = pod;

  files["articles.json"] = JSON.stringify(sorted.map((a) => ({
    slug: a.slug, date: a.date, headline: a.headline, dek: a.dek,
    category: a.category, categoryLabel: a.categoryLabel,
    templateType: a.templateType ?? "article", tags: a.tags,
  })), null, 2);

  return { files, articles: sorted };
}
