// Yahtzee scoring. Pure functions, no DOM and no network, so node's test
// runner and the browser load the same file.
//
// Dice are five integers 1-6. A card is { [category]: points } holding only
// the boxes already used, plus yahtzeeBonus (count of bonus Yahtzees).

export const UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"];
export const LOWER = ["threeKind", "fourKind", "fullHouse", "smallStraight", "largeStraight", "yahtzee", "chance"];
export const CATEGORIES = [...UPPER, ...LOWER];

export const LABELS = {
  ones: "Ones", twos: "Twos", threes: "Threes", fours: "Fours", fives: "Fives", sixes: "Sixes",
  threeKind: "3 of a kind", fourKind: "4 of a kind", fullHouse: "Full house",
  smallStraight: "Sm. straight", largeStraight: "Lg. straight", yahtzee: "Yahtzee", chance: "Chance",
};

export const UPPER_BONUS_AT = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;

const counts = (dice) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
};
const sum = (dice) => dice.reduce((a, b) => a + b, 0);
const hasRun = (c, len) => {
  let run = 0;
  for (let v = 1; v <= 6; v++) {
    run = c[v] ? run + 1 : 0;
    if (run >= len) return true;
  }
  return false;
};

export const isYahtzee = (dice) => dice.length === 5 && dice.every((d) => d === dice[0]) && dice[0] > 0;

/** What the dice are worth in a box, by the plain rules (no joker). */
export function rawScore(cat, dice) {
  const c = counts(dice);
  const i = UPPER.indexOf(cat);
  if (i >= 0) return c[i + 1] * (i + 1);
  switch (cat) {
    case "threeKind": return c.some((n) => n >= 3) ? sum(dice) : 0;
    case "fourKind": return c.some((n) => n >= 4) ? sum(dice) : 0;
    case "fullHouse": return c.includes(3) && c.includes(2) ? 25 : 0;
    case "smallStraight": return hasRun(c, 4) ? 30 : 0;
    case "largeStraight": return hasRun(c, 5) ? 40 : 0;
    case "yahtzee": return isYahtzee(dice) ? 50 : 0;
    case "chance": return sum(dice);
    default: throw new Error(`unknown category ${cat}`);
  }
}

/** A second (or later) Yahtzee, once the Yahtzee box is used: the joker rules apply. */
export const isJoker = (dice, card) => isYahtzee(dice) && card.yahtzee !== undefined;

/**
 * The open boxes this roll may go in. Ordinarily every open box. Under the
 * joker rules (official forced variant): the matching upper box if it is
 * open; otherwise any open lower box; otherwise any open upper box.
 */
export function legalCategories(dice, card) {
  const open = CATEGORIES.filter((k) => card[k] === undefined);
  if (!isJoker(dice, card)) return open;
  const upper = UPPER[dice[0] - 1];
  if (card[upper] === undefined) return [upper];
  const lower = LOWER.filter((k) => card[k] === undefined);
  return lower.length ? lower : open;
}

/** Points for putting this roll in this box, joker rules included. */
export function scoreFor(cat, dice, card) {
  if (isJoker(dice, card)) {
    if (cat === "fullHouse") return 25;
    if (cat === "smallStraight") return 30;
    if (cat === "largeStraight") return 40;
  }
  return rawScore(cat, dice);
}

/**
 * Put a roll in a box. Returns a new card; throws if the box is not allowed.
 * A Yahtzee rolled after scoring 50 in the Yahtzee box earns a bonus.
 */
export function applyScore(card, cat, dice) {
  if (!CATEGORIES.includes(cat)) throw new Error(`unknown category ${cat}`);
  if (card[cat] !== undefined) throw new Error(`${LABELS[cat]} is already used`);
  if (!legalCategories(dice, card).includes(cat)) throw new Error(`a bonus Yahtzee has to go in ${LABELS[legalCategories(dice, card)[0]]} first`);
  const next = { ...card, [cat]: scoreFor(cat, dice, card) };
  if (isYahtzee(dice) && card.yahtzee === 50) next.yahtzeeBonus = (card.yahtzeeBonus ?? 0) + 1;
  return next;
}

export function totals(card) {
  const upper = UPPER.reduce((a, k) => a + (card[k] ?? 0), 0);
  const bonus = upper >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
  const lower = LOWER.reduce((a, k) => a + (card[k] ?? 0), 0);
  const yBonus = (card.yahtzeeBonus ?? 0) * YAHTZEE_BONUS;
  return { upper, bonus, lower, yBonus, total: upper + bonus + lower + yBonus };
}

export const isCardFull = (card) => CATEGORIES.every((k) => card[k] !== undefined);
