# Editorial guide

## The promise

One article a day that takes something real from the news cycle and answers a single
question: **what would this have cost with almost no running computers?**

Not "cloud bad." Not a vendor pitch. A specific piece of wreckage, a specific
architecture, a specific alternative, and an honest account of what the alternative
gives up.

---

## The five questions

Every piece has to answer these five. **None of them is a heading.** They are what
the writing has to establish, in whatever order and under whatever headings the
story actually wants.

1. **What happened.** The facts, tightly. Dates, numbers, quotes from the source.
   If you cannot write this from the linked source alone, you do not have a story,
   you have a hunch.
2. **What was running, and why that shape was chosen.** Generalize from the one
   company to the pattern. Be fair about why it was a reasonable choice at the
   time. It usually was.
3. **What it cost.** Dollars where you have them. Where you do not, name the real
   currency: engineering weeks, migration quarters, a launch that slipped, a
   feature that never got built. Never invent a number. "Not disclosed" is a fine
   sentence.
4. **What the flat version looks like.** Concrete: what goes in object storage,
   what gets precomputed, what gets served static, what compute survives and when
   it runs. `pipeline/taxonomy.json` gives the angle for the category; this turns
   that one sentence into an actual architecture.
5. **What it does not solve.** Non-negotiable. It is what makes the other four
   credible.

Plus a **pull quote** — the one sentence you would want screenshotted.

### Structure is a per-story decision

The five-question order above is the *default reasoning*, not the shape on the
page. A publication where every article marches through the same five headings in
the same order stops reading like reporting and starts reading like a generated
form, which is a tell readers pick up on long before they can name it.

So, per piece:

- **Write your own headings**, out of the story's own material. "How anything
  found us at all" is a heading. "What happened" is a slot.
- **Vary the order and the count.** Four sections, or eight. Lead with the cost if
  the cost is the shock. Lead with the architecture if the architecture is the
  joke. Open with no heading at all when the lede carries itself.
- **Some questions get a section, some get a paragraph.** If there is no dollar
  figure and no engineering-weeks figure, do not build a monument to that; say it
  in a sentence and move on.
- **Never reuse a heading across articles.** In particular, retire these: *What
  happened*, *The architecture underneath*, *What it cost*, *The flat-stack
  version*, and above all *The uncomfortable part / truth*. They were scaffolding.
  They now read as machine-written.

The admin editor is one free-form CKEditor body and the renderer takes whatever
headings you give it, so nothing is enforced. `--claim` scaffolds the five as a
thinking prompt; rewrite the headings before you publish.

---

## Voice

Direct, concrete, dry. Short sentences carry the weight. The manifesto's register:
*"a tower goes up fast and comes down in a strong wind."*

- Plain words over jargon. "Bill" not "TCO." "Server" not "compute layer" unless the
  distinction matters.
- Specifics over adjectives. Not "eye-watering costs" — the number, or nothing.
- **Use contractions.** "It isn't," "you're paying," "they'd already left." Prose
  that never contracts reads stiff and slightly automated. Reach for the
  uncontracted form only when the sentence needs the emphasis: *it is not free.*
- Rhetorical questions in moderation.
- No em dashes as a tic. No "delve," "robust," "comprehensive," "leverage,"
  "unlock," "supercharge." If it would fit in a vendor blog post, cut it.
- Never open with "In today's fast-paced world."

### Tells

Things that make a piece read as generated rather than written. Each is cheap to
fix and expensive to leave in, because a reader who spots one stops trusting the
numbers too.

- **The same skeleton every time.** The single biggest one. See above.
- **Recycled section names**, especially any heading built on "The uncomfortable
  truth / part."
- **Rule-of-three everywhere.** Three examples, three adjectives, three clauses,
  paragraph after paragraph. Vary it. Sometimes the answer is one example.
- **Symmetrical negation as a reflex.** "Not X, but Y." Fine once in a piece. Four
  times is a signature.
- **Restating the thesis at the end of every section** so each one closes on a
  neat aphorism. Let some sections just stop.
- **Hedging on everything, or nothing.** Say plainly what is reported, and mark
  what is inference. Do not sprinkle "arguably" and "in many cases" over facts you
  actually have.
- **Uniform paragraph length.** Real prose has a two-sentence paragraph in it.
- **Em dashes everywhere.** Already listed; it belongs here too.

Assume the reader is an engineer or a CTO who has seen a surprise invoice. You do not
need to explain what S3 is. You do need to explain why the shape of the bill was
predictable.

---

## Naming companies

The house position is **named and pointed**, with rules.

**Do:**
- Name the company and the vendor. A story about a bill is not a story without the
  name on the invoice.
- Link the source, always and prominently. The reader checks your reading.
- Aim the criticism at the architecture decision and the model that encouraged it.
- Give credit where it is due. The InstantDB piece is pointed *and* says plainly that
  they handled the wind-down better than most. That combination is what makes it
  credible rather than cheap.

**Do not:**
- Assert a cause the source does not support. "InstantDB shut down because of compute
  costs" is not something we know. "InstantDB shut down, and its users now owe twelve
  months of migration work to somebody else's schedule" is.
- Attack individuals. Architectures and business models, not people.
- Report a private or unverified number. If it is not in a public source you linked,
  it does not go in.
- Kick a company that is already down without making a substantive point. If the only
  content is "look at these idiots," kill the piece.

**On Databricks and Snowflake specifically:** they are fair game and they are also
adjacent to airbrx's buyers. Criticize the consumption model and the architecture it
pushes people toward, with numbers. Do not write anything you would not say to their
customer's face in a meeting — because you will be.

---

## Standard of proof

| Claim | What is required |
|---|---|
| A dollar figure | A public source, linked, quoted as they stated it |
| "The company said X" | A direct quote or a linked statement |
| "This was caused by Y" | The source says so, or you write it as your reading and mark it as such |
| "A flat stack would cost Z" | Show the arithmetic — storage, requests, egress |
| Anything about a private company's internals | Do not |

When you are inferring rather than reporting, say so in the text: *"The announcement
doesn't say why. The shape of it suggests..."* That sentence costs nothing and buys
all your credibility.

---

## Picking from the queue

Rank by, in order:

1. **Specificity.** A named company with a named number beats a trend piece, always.
2. **A real architecture to rebuild.** If you cannot write section 4 concretely, skip
   it, however juicy the headline.
3. **Freshness.** Today's cycle beats last month's, but a strong engineering
   postmortem is worth writing about weeks later.
4. **Category variety.** Three datacenter-water stories in a week is a beat, not a
   publication. The queue caps per category for this reason — respect it.

Skip anything where the honest answer to *"would a flat stack have helped?"* is no.
Those exist. Writing them anyway is how the publication stops being trustworthy.

---

## Headlines

The claim, not the topic.

- Good: "You Did Not Buy a Database. You Rented Somebody's Uptime."
- Bad: "InstantDB Shutdown: Lessons for Backend Architecture"

The dek does the explaining. The headline earns the click and states a position.
