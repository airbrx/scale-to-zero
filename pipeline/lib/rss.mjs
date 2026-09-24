// Minimal RSS 2.0 + Atom parser. No dependencies -- a feed reader that needs
// a node_modules tree is exactly the thing this publication complains about.

function unwrapCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// Order matters: CDATA must be unwrapped BEFORE tag stripping. `<![CDATA[Some
// headline]]>` otherwise matches /<[^>]*>/ in its entirety and the whole title
// vanishes -- which is exactly how The Verge silently parsed to zero items.
function stripTags(s) {
  return decodeEntities(unwrapCdata(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(m[1]) : "";
}

// Atom links are attributes, not text: <link rel="alternate" href="..."/>
function atomLink(block) {
  const alts = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  for (const [, attrs] of alts) {
    if (/rel=["']?alternate/i.test(attrs) || !/rel=/i.test(attrs)) {
      const href = attrs.match(/href=["']([^"']+)["']/i);
      if (href) return decodeEntities(href[1]);
    }
  }
  return "";
}

export function parseFeed(xml, sourceName) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";
  const blocks = [...xml.matchAll(new RegExp(`<${itemTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${itemTag}>`, "gi"))];

  return blocks.map(([, block]) => {
    const title = tag(block, "title");
    let url = isAtom ? atomLink(block) : tag(block, "link");
    if (!url) url = tag(block, "guid");

    // Google News wraps the real publisher in the description and the title suffix.
    const description = tag(block, "description") || tag(block, "summary") || tag(block, "content");
    const dateRaw =
      tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date");

    const parsed = dateRaw ? new Date(dateRaw) : null;

    return {
      title,
      url,
      description,
      source: sourceName,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    };
  }).filter((it) => it.title && it.url);
}

// Google News titles arrive as "Real headline - Publisher"; the href is a
// news.google.com redirector. Recover the publisher for domain-penalty scoring.
export function splitGoogleNewsTitle(title) {
  const idx = title.lastIndexOf(" - ");
  if (idx === -1) return { headline: title, publisher: null };
  return { headline: title.slice(0, idx).trim(), publisher: title.slice(idx + 3).trim() };
}

// Exported for the HN collector: Algolia's story_text is raw HTML with escaped
// entities, which otherwise drags hrefs and markup into the scoring haystack.
export function stripHtml(s) {
  return stripTags(s);
}
