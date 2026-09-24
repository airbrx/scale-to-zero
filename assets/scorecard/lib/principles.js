// The nine Southern Cross principles the scorecard grades against, in manifesto
// order. The names must match content/manifesto.json word for word;
// test/scorecard.test.mjs fails the build if they drift. (The manifesto's
// tenth, "Thank you; have a nice day", is a sign-off, not something to score.)

export const PRINCIPLES = [
  { id: "beast", name: "Do not wake the Beast.",
    short: "Answer from what is already computed, not a fresh query." },
  { id: "gravity", name: "Keep your center of gravity low.",
    short: "Data in open formats, in storage you control." },
  { id: "balance", name: "The balance sheet is the product owner.",
    short: "Nothing that bills while nobody is using it." },
  { id: "foundation", name: "Security, availability, and resilience are not features.",
    short: "No secrets in the repo, no unverified code, few moving parts." },
  { id: "dependency", name: "Every dependency is a decision.",
    short: "Every library is someone else's code inside your walls." },
  { id: "stateless", name: "Build it stateless. Build it to scale to zero.",
    short: "Runs when called, holds nothing between calls." },
  { id: "shiny", name: "No shiny objects.",
    short: "Proven and replaceable beats new." },
  { id: "modernization", name: "Modernization is baked in, not bolted on.",
    short: "Tested, automated, and still being tended." },
  { id: "schemas", name: "Document your schemas.",
    short: "A documented shape can move. An undocumented blob is an anchor." },
];

export const PRINCIPLE_BY_ID = Object.fromEntries(PRINCIPLES.map((p) => [p.id, p]));
