// The vocabulary the narrator draws on: synonym sets (Tracery-style rules,
// expanded with ((name))), value maps ({key>map}), and how each principle is
// talked about in running prose.
//
// House voice, from docs/EDITORIAL.md: named and pointed, aimed at the
// architecture, never at the people. A repo "runs a server all day"; nobody
// is "lazy". Keep new phrases to that.

export const RULES = {
  // Connectives. Deliberately plain: the variety should come from the
  // content, not from ornamental transitions.
  also: ["It also", "It also", "Beyond that, it", "On top of that, it"],
  but: ["But", "But", "That said,", "Still,"],
  bills: ["bills", "keeps billing", "costs money"],
  idle: ["whether or not anyone calls", "whether or not a request arrives", "while nobody is using it"],
  worth: ["worth a look", "worth checking", "worth confirming"],
};

export const MAPS = {
  stateKind: {
    sessions: "in-memory sessions",
    schedulers: "in-process job schedulers",
    sockets: "long-lived socket connections",
    timers: "timers inside the server",
  },
};

/**
 * How each principle is named in a sentence. `topic` fits "On ___, it ...";
 * `good` and `bad` are short verdicts for the one-line strongest/weakest
 * comparison. Keys match lib/principles.js.
 */
export const TOPICS = {
  beast: { topic: "waking the Beast", is: "is", good: "answers without waking anything", bad: "wakes something to answer" },
  gravity: { topic: "data ownership", is: "is", good: "keeps its data low and open", bad: "keeps its data behind someone else's door" },
  balance: { topic: "cost", is: "is", good: "has nothing billing while idle", bad: "bills while idle" },
  foundation: { topic: "security and resilience", is: "are", good: "keeps its foundation solid", bad: "has cracks in its foundation" },
  dependency: { topic: "dependencies", is: "are", good: "chooses its dependencies on purpose", bad: "carries more code than it chose" },
  stateless: { topic: "statelessness", is: "is", good: "runs when called and holds nothing", bad: "stays up and holds state" },
  shiny: { topic: "shiny objects", is: "are", good: "builds on settled tools", bad: "builds on tools that have not settled" },
  modernization: { topic: "upkeep", is: "is", good: "is tended as a habit", bad: "is not being tended" },
  schemas: { topic: "documentation", is: "is", good: "writes its shapes down", bad: "leaves its shapes undocumented" },
};

/** Lead-ins for a principle's problems paragraph. {topic} and {is} come from
 *  TOPICS, so "dependencies are" and "cost is" both come out right. */
export const PROBLEM_LEADS = [
  "On {topic}, {it}",
  "On {topic}, {it}",
  "When it comes to {topic}, {it}",
  "{Topic} {is} where it slips: {it}",
];

/** The manifesto's tenth rule is a sign-off, so the narration ends on it. */
export const SIGNOFFS = {
  A: ["Thank you; have a nice day.", "Nothing to add. Thank you; have a nice day."],
  B: ["Thank you; have a nice day — and go scale something down to zero.", "Close. Thank you; have a nice day."],
  C: ["Thank you; have a nice day — and go scale something down to zero."],
  D: ["Thank you; have a nice day — and go scale something down to zero. Start with the first item above."],
  F: ["Thank you; have a nice day — and go scale something down to zero. There is plenty here to start with."],
};

/** The headline when no combination pattern claims it. */
export const GRADE_HEADLINES = {
  A: ["{name} is [already flat|about as flat as a stack gets|flat, and it shows]."],
  B: ["{name} is [mostly flat|nearly flat], with [a few things|one or two things] still standing up."],
  C: ["{name} is [half flat, half tower|leaning: flat in places, stacked in others]."],
  D: ["{name} is [more tower than flat|carrying weight it does not need]."],
  F: ["{name} is [a tower|stacked high], and [it shows|the checks agree]."],
};

/** One sentence that states the grade itself. */
export const GRADE_LINES = [
  "It scores {score} out of 100, a grade of {grade}.",
  "The score is {score} out of 100: {a:grade}.",
];
