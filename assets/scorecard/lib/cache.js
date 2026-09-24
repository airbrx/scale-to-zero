// Past scorecards, kept in this browser's localStorage and nowhere else.
//
// Keyed by content hash, so a cached card is exactly the card a rescan would
// produce until the repo changes or ENGINE_VERSION does. Storage can be full,
// disabled, or blocked (private windows, strict settings); every operation
// returns what happened, and the page says so rather than pretending it saved.

const PREFIX = "stz-scorecard:";
const INDEX = `${PREFIX}recent`;
const KEEP = 12;

function store() {
  const s = globalThis.localStorage;
  if (!s) throw new Error("localStorage is not available in this browser");
  return s;
}

export const cacheKey = (card) =>
  `${PREFIX}v${card.engineVersion}:${card.repo.provider}:${card.repo.fullName}:${card.scope}@${card.repo.sha}`;

/** @returns {{ok:true, recent:object[]} | {ok:false, error:string}} */
export function listRecent() {
  try {
    return { ok: true, recent: JSON.parse(store().getItem(INDEX) ?? "[]") };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** @returns {{ok:true, card:object|null} | {ok:false, error:string}} */
export function load(key) {
  try {
    const raw = store().getItem(key);
    return { ok: true, card: raw ? JSON.parse(raw) : null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** @returns {{ok:true} | {ok:false, error:string}} */
export function save(card, label) {
  try {
    const s = store();
    const key = cacheKey(card);
    const recent = JSON.parse(s.getItem(INDEX) ?? "[]").filter((r) => r.label !== label);
    recent.unshift({ key, label, fullName: card.repo.fullName, grade: card.grade, score: card.score, at: card.scannedAt });
    for (const old of recent.splice(KEEP)) s.removeItem(old.key);
    s.setItem(key, JSON.stringify(card));
    s.setItem(INDEX, JSON.stringify(recent));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
