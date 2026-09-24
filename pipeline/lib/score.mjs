// Scores a harvested item against taxonomy.json.
//
// Architecture: CATEGORY IS A GATE, everything else is a BOOSTER.
// An item that matches no category scores 0 and never reaches the queue, no
// matter how much money or how many HN upvotes it carries. This is deliberate --
// see the DESIGN NOTE in taxonomy.json.
//
// Every item carries a `why` array so a human reviewing the queue can see
// exactly why it ranked where it did, and tune the rubric instead of guessing.

const MULTIPLIER = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, trillion: 1e12 };

// The (?![a-z]) is load-bearing: without it "$1,688 build" parses as $1.688
// billion, because the regex happily claims the 'b' from the next word.
const MONEY_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m|bn|b|thousand|million|billion|trillion)?(?![a-z])/gi;

export function extractMoney(text) {
  let max = 0;
  let label = null;
  for (const m of text.matchAll(MONEY_RE)) {
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const suffix = (m[2] || "").toLowerCase();
    const value = base * (MULTIPLIER[suffix] ?? 1);
    if (value > max) {
      max = value;
      label = m[0].trim();
    }
  }
  return max > 0 ? { usd: max, label } : null;
}

const countHits = (hay, terms) => terms.filter((t) => hay.includes(t));

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function scoreItem(item, tax, now = Date.now()) {
  const hay = `${item.title} ${item.description ?? ""} ${item.publisher ?? ""}`.toLowerCase();
  const host = hostOf(item.url);
  const why = [];
  const S = tax.scoring;

  // -------------------------------------------------------- GATE 1: CONTEXT
  // Category terms are not domain-specific. "shutting down" matched a Konrad
  // Zuse museum and a naval battle; "ran out of money" matched both. Require
  // the story to be about computing before anything else is considered.
  const contextHits = countHits(hay, tax.contextGate.terms);
  if (tax.contextGate.required && contextHits.length === 0) {
    return {
      ...item,
      score: 0,
      rejected: "not about computing infrastructure",
      category: null,
      categoryLabel: null,
      why: ["rejected: no computing context"],
    };
  }

  // ------------------------------------------------------- GATE 2: CATEGORY
  const matched = [];
  for (const [key, cat] of Object.entries(tax.categories)) {
    const strong = countHits(hay, cat.strong ?? []);
    const weak = countHits(hay, cat.weak ?? []);

    const qualifies = strong.length >= tax.gate.minStrong || weak.length >= tax.gate.orMinWeak;
    if (!qualifies) continue;

    const extra = Math.max(0, strong.length + weak.length - 1);
    const base =
      (strong.length ? S.strongPoints : S.weakPoints * 2) +
      Math.min(extra * S.additionalTermPoints, S.additionalTermCap);

    matched.push({
      key,
      label: cat.label,
      points: Math.round(base * cat.weight),
      hits: [...strong, ...weak],
      strongHits: strong,
      angle: cat.flatStackAngle,
    });
  }

  if (tax.gate.requireCategory && matched.length === 0) {
    return {
      ...item,
      score: 0,
      rejected: "no category match",
      category: null,
      categoryLabel: null,
      why: ["rejected: matches no story category"],
    };
  }

  matched.sort((a, b) => b.points - a.points);
  let score = 0;
  for (const m of matched) {
    score += m.points;
    why.push(`+${m.points} ${m.label} [${m.hits.slice(0, 4).join(", ")}]`);
  }

  // A precise match ("InstantDB is shutting down") should outrank an item that
  // merely piled up generic weak hits.
  if (matched.some((m) => m.strongHits.length > 0)) {
    score += S.strongBonus;
    why.push(`+${S.strongBonus} strong-signal match`);
  }

  // ------------------------------------------------------------- BOOSTERS
  const money = extractMoney(`${item.title} ${item.description ?? ""}`);
  if (money) {
    const tier = tax.moneySignal.tiers.find((t) => money.usd >= t.minUsd);
    if (tier) {
      score += tier.points;
      why.push(`+${tier.points} concrete figure (${money.label})`);
    }
  }

  const vendorHits = countHits(hay, tax.vendors.terms);
  if (vendorHits.length) {
    const pts = Math.min(vendorHits.length * tax.vendors.pointsEach, tax.vendors.cap);
    score += pts;
    why.push(`+${pts} named vendor [${vendorHits.slice(0, 4).join(", ")}]`);
  }

  const corrobHits = countHits(hay, tax.corroboration.terms);
  if (corrobHits.length) {
    const pts = Math.min(corrobHits.length * tax.corroboration.pointsEach, tax.corroboration.cap);
    score += pts;
    why.push(`+${pts} primary account [${corrobHits.slice(0, 3).join(", ")}]`);
  }

  if (typeof item.points === "number" && item.points > 0) {
    const pts = Math.min(Math.round(item.points / tax.engagement.pointsDivisor), tax.engagement.pointsCap);
    if (pts > 0) { score += pts; why.push(`+${pts} ${item.points} HN points`); }
  }
  if (typeof item.numComments === "number" && item.numComments > 0) {
    const pts = Math.min(Math.round(item.numComments / tax.engagement.commentsDivisor), tax.engagement.commentsCap);
    if (pts > 0) { score += pts; why.push(`+${pts} ${item.numComments} comments`); }
  }

  // ------------------------------------------------------------ PENALTIES
  for (const rule of tax.penalties.phrases) {
    const hits = countHits(hay, rule.match);
    if (hits.length) {
      score += rule.points;
      why.push(`${rule.points} marketing/finance signal [${hits.slice(0, 3).join(", ")}]`);
    }
  }
  for (const rule of tax.penalties.domains) {
    const hit = rule.match.find((d) => host.endsWith(d));
    if (hit) {
      score += rule.points;
      why.push(`${rule.points} low-value source (${hit})`);
    }
  }

  // -------------------------------------------------------------- RECENCY
  let recencyMult = 1;
  let ageDays = null;
  if (item.publishedAt) {
    ageDays = (now - new Date(item.publishedAt).getTime()) / 86400000;
    if (ageDays > 0) {
      recencyMult = Math.max(tax.recency.minMultiplier, Math.pow(0.5, ageDays / tax.recency.halfLifeDays));
    }
  } else {
    recencyMult = 0.6;
    why.push("x0.60 no publish date");
  }

  const preDecay = score;
  score = Math.max(0, score) * recencyMult;
  if (ageDays !== null && recencyMult < 0.999) {
    why.push(`x${recencyMult.toFixed(2)} age ${ageDays.toFixed(1)}d`);
  }

  const primary = matched[0];

  return {
    ...item,
    score: Math.round(score),
    rawScore: Math.round(preDecay),
    ageDays: ageDays === null ? null : Number(ageDays.toFixed(1)),
    category: primary.key,
    categoryLabel: primary.label,
    categoryThesis: tax.categories[primary.key].thesis,
    allCategories: matched.map((m) => m.key),
    flatStackAngle: primary.angle,
    flatStackRebuttal: tax.flatStackAngles[primary.angle],
    hasStrongSignal: matched.some((m) => m.strongHits.length > 0),
    money,
    vendors: vendorHits,
    why,
  };
}

// The same story lands on HN, Google News, and a publisher feed. Collapse by
// URL then by normalized title; keep the highest scorer, record corroboration.
export function dedupe(items) {
  const normTitle = (t) =>
    t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
  const normUrl = (u) => {
    try {
      const p = new URL(u);
      return `${p.hostname.replace(/^www\./, "")}${p.pathname.replace(/\/$/, "")}`.toLowerCase();
    } catch {
      return u.toLowerCase();
    }
  };

  const byKey = new Map();
  for (const item of items) {
    for (const key of [`u:${normUrl(item.url)}`, `t:${normTitle(item.title)}`]) {
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, item);
      } else if (item.score > prev.score) {
        item.alsoSeenIn = [...new Set([...(prev.alsoSeenIn ?? []), prev.source])];
        byKey.set(key, item);
      } else {
        prev.alsoSeenIn = [...new Set([...(prev.alsoSeenIn ?? []), item.source])];
      }
    }
  }

  const seen = new Set();
  const out = [];
  for (const item of byKey.values()) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }

  // Independent corroboration is itself a quality signal -- but only for
  // stories that already cleared the gate.
  for (const item of out) {
    if (!item.score) continue;
    const extra = (item.alsoSeenIn ?? []).filter((s) => s && s !== item.source);
    if (extra.length) {
      const pts = Math.min(extra.length * 5, 15);
      item.score += pts;
      item.why.push(`+${pts} corroborated by ${extra.join(", ")}`);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
