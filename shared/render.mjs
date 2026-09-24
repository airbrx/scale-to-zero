// Pure rendering. No filesystem, no S3, no network.
//
// Both renderers use this: pipeline/build.mjs (local, from articles/*.json) and
// the admin Lambda (from the staging bucket). If it lived in only one of them,
// an article published through the admin would drift from one built locally --
// same content, different HTML, and nobody notices until the diff is enormous.

export const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
export function head(site, title, description, canonical, extra = "") {
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
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
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
  <nav class="masthead-nav">
    <a href="/">Archive</a>
    <a href="/flat-stack.html">Flat Stack</a>
    <a href="/scorecard.html">Scorecard</a>
    <a href="/feed.xml">RSS</a>
    <a href="${esc(site.orgUrl)}" rel="noopener">airbrx</a>
  </nav>
</header>`;
}

export function foot(site) {
  return `
<footer class="footer">
  <p class="footer-thesis">Every article here answers one question: <em>what would this have cost with almost no running computers?</em></p>
  <p class="footer-meta">
    ${esc(site.name)} &middot; by <a href="${esc(site.authorUrl)}" rel="noopener">${esc(site.author)}</a> &middot;
    published from <a href="${esc(site.manifestoUrl)}" rel="noopener">the flat-stack manifesto</a>
  </p>
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
    author: { "@type": "Person", name: site.author, url: site.authorUrl },
    publisher: { "@type": "Organization", name: site.name },
    mainEntityOfPage: canonical,
    ...(a.audio?.url ? { associatedMedia: { "@type": "MediaObject", contentUrl: a.audio.url } } : {}),
  };

  return `${head(site, `${a.headline} - ${site.shortName}`, a.dek, canonical,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`)}
<main class="wrap">
<article class="article">
  <div class="article-kicker">
    <span class="tag tag-${esc(String(a.category).toLowerCase())}">${esc(a.categoryLabel)}</span>
    <time datetime="${esc(a.date)}">${esc(fmtDate(a.date, site.locale))}</time>
${a.templateType === "podcast" ? `    <span class="tag tag-audio">Audio</span>\n` : ""}  </div>

  <h1 class="article-title">${esc(a.headline)}</h1>
  <p class="article-dek">${esc(a.dek)}</p>
${audioBlock(a)}

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
  return `${head(site, `Flat-stack scorecard - ${site.shortName}`, description, `${site.baseUrl}/scorecard.html`,
    '<script type="module" src="/assets/scorecard/app.js"></script>')}
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
  <itunes:author>${esc(site.author)}</itunes:author>
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
export function renderSite({ site, tax, manifesto, articles }) {
  const sorted = [...articles].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const files = {};

  for (const a of sorted) files[`${a.slug}.html`] = articleHtml(site, tax, a);
  files["index.html"] = indexHtml(site, sorted);
  files["flat-stack.html"] = manifestoHtml(site, manifesto);
  files["scorecard.html"] = scorecardHtml(site);
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
