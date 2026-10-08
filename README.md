# The Scale-to-Zero Report

A daily publication that finds real news about compute costing somebody something —
a bill, a project, a breach, a shut-down — and rebuilds the story flat.

**A community project of [airbrx](https://airbrx.ai).** Live at
[scale-to-zero.com](https://scale-to-zero.com). Every piece is measured against
[the flat-stack manifesto](https://airbrx.ai/articles/flat-stack-manifesto.html),
the doctrine behind [the airbrx gateway](https://airbrx.ai/articles/gateway-flat-stack-built.html).
More writing from airbrx lives in [The Cache](https://airbrx.ai/articles/).

## Contributing

- **A story.** Open an issue with the link and the one number that makes it hurt.
  The bar is in `docs/EDITORIAL.md`: real wreckage, a named architecture, an honest
  account of what the flat version gives up.
- **A scorecard fix.** If [the scorecard](https://scale-to-zero.com/scorecard.html)
  misjudged a repo, open an issue with the repo URL and the check that got it
  wrong. New language packs are one file each; see `docs/SCORECARD.md`.
- **Code.** Every test must pass: `for f in test/*.test.mjs; do node $f; done`. No new dependencies without a reason
  written down next to them -- the manifesto applies to this repo too.

Two halves:

1. **A research pipeline** that scans news and social sources for wreckage caused by
   full-stack / always-on compute, scores it against an editorial rubric, and hands
   you a short ranked queue to choose from.
2. **A static publication** that runs on the architecture it argues for: pre-rendered
   HTML on object storage behind a CDN. No server, no database, no runtime behind
   what readers see. Editing happens in an admin that is a Lambda, running only
   while somebody edits (`docs/ADMIN.md`).

Some articles come with **a film**: a narrated, animated explainer drawn live in
the reader's browser from its script, not a video file. See `stories/README.md`.

The pipeline is itself scale-to-zero. It is a set of scripts that run when you run
them and cost nothing the rest of the day.

---

## Quick start

```bash
node pipeline/harvest.mjs      # pull candidates from every source  (~2 min)
node pipeline/score.mjs        # score, dedupe, diversify -> data/queue.json
node pipeline/queue.mjs        # read the queue
node pipeline/queue.mjs 4      # full brief on candidate 4
node pipeline/queue.mjs 4 --claim   # -> articles/<date>-<slug>.json
# ...write the article...
node pipeline/build.mjs        # render site/
```

Or the whole morning in one command:

```bash
node pipeline/daily.mjs
```

The pipeline and the public site have no dependencies: Node 18+ (20.12+ for the
deploy scripts, which read `.env` natively) and `curl`, no
`node_modules`. That is deliberate — a publication that complains about unnecessary
dependencies should not have 400 of them.

Three toolchains do have dependencies, each for a reason, and none of them ship to
readers:

- `admin/` — the AWS SDK and `sharp`, for S3 and image resizing in the Lambda.
- `admin/editor/` — CKEditor 5 and webpack, built once into the editor bundle.
- `stories/tools/` — a canvas, Tone.js and Web Audio for checking films without a
  browser; Python with `faster-whisper`, and `ffmpeg`, for timing a recorded voice.

---

## How a story is found

### Sources

| Source | Status | Notes |
|---|---|---|
| Hacker News (Algolia API) | working | Best source. Exact-phrase search, 60-day window. Practitioners post real invoice numbers in the comments. |
| Google News RSS | working | Widest net, noisiest. Uses the `when:Nd` operator — without it Google happily returns 2024 archive material. |
| The Register, DataCenter Dynamics, Ars Technica, TechCrunch, The Verge, CNBC Tech, WSJ Tech, Lobsters | working | Direct publisher feeds, 10-day window. |
| Reddit | **blocked** | 403 from `www`, 302 loop from `old`. Needs an OAuth app credential. See `pipeline/sources.json` → `disabled.reddit` for the exact fix. |
| Bluesky | **blocked** | `searchPosts` now needs an authed session. Fix documented in the same place. |
| X / LinkedIn | **not viable** | No free search API; scraping violates ToS. |

Blocked sources are recorded with the real reason and the real fix rather than
quietly returning zero results.

### Two gates, then boosters

Everything harvested must pass **both** gates:

1. **Context gate** — is this about computing infrastructure at all?
2. **Category gate** — does it match one of the eight story types?

Only then do boosters apply: dollar figures, named vendors, first-person accounts,
HN engagement. This ordering is the whole design. An earlier version let money and
upvotes qualify a story on their own and the queue filled with an Nvidia acquisition,
a humanoid-robot launch, and a dark-matter detector — all big numbers, none of them
about compute costing anyone anything.

Penalties subtract: press releases, listicles, vendor content marketing, investor
and markets coverage, `Show HN` launches. Each penalty in `pipeline/taxonomy.json`
exists because something specific got through.

### The eight categories

| Category | Thesis |
|---|---|
| Bill Shock | The invoice arrived and nobody could explain it. |
| Repatriation | They did the math and went home. |
| Abandoned Vision | The idea was fine. The infrastructure bill killed it. |
| AI Compute Burn | They bought the GPUs before they found the use case. |
| Datacenter Buildout | The answer to every question is another building. |
| Attack Surface | Every service you added is a door you have to lock. |
| Cascade Failure | One dependency sneezed and the whole tower fell over. |
| Complexity Debt | Six engineers maintaining the thing that runs the thing. |

Each category maps to a pre-written **flat-stack angle** — the rebuttal you already
know how to make. `node pipeline/queue.mjs <n>` prints it with the brief.

### Every score is explained

No black box. Each candidate carries a `why` array:

```
+32 Abandoned Vision [shutting down, sunsetting, sunset]
+10 strong-signal match
 +1 10 HN points
x0.50 age 13.9d
```

When the queue is wrong, that tells you which rule to change.

---

## Tuning

Everything editorial lives in `pipeline/taxonomy.json`. Nothing is hard-coded in the
scorer.

| Symptom | Fix |
|---|---|
| Queue too small | Lower `pipeline.minScore` in `config.json` |
| Off-topic stories | Add a term to `penalties.phrases`, or move a category term from `strong` to `weak` |
| Good stories missing | Add the phrase to the category's `strong` list, and to `hnSearch.queries` |
| One topic dominating | Lower `pipeline.maxPerCategory` |
| Old stories crowding out new | Lower `recency.halfLifeDays` |

Re-scoring is instant — it reads the last harvest, so you can iterate on the rubric
without re-fetching:

```bash
node pipeline/score.mjs --all     # ignore minScore, see the full ranked tail
```

---

## Writing

`--claim` writes a skeleton with the source facts already filled in. See
`docs/EDITORIAL.md` for the house style, the five questions every piece has to
answer, and the rules about naming companies. The five are how a piece thinks,
not headings to reuse — every article writes its own.

Set `"status": "published"` when it is ready. Drafts are skipped by the build.

---

## The admin

Live at `/admin`. Google sign-in, a free-form CKEditor body, image and audio
upload, an admins editor, staging-to-live publish, and web stats read from
CloudFront access logs (no tracking script anywhere on the public site).

Stats are eight tabs off CloudFront access logs: overview, audience, content,
geography (down to city, for readers and scanners separately), acquisition,
bots (each expandable to the paths it crawled), security (probe patterns and the
probe log), and a per-day drill-down.

```bash
node infra/fetch-geodb.mjs      # install the IP-to-city database (once a month)
node infra/rebuild-stats.mjs    # rebuild the whole report from the log bucket
```

See `docs/ADMIN.md` for the auth model, the stats design, and the one manual
step (creating the Google OAuth client).

## The scorecard

Live at `/scorecard.html`. Paste a public GitHub or GitLab repo and it is graded
against the nine flat-stack principles (the manifesto's Southern Cross), entirely in the reader's browser: no
server, no account, no clone. `node tools/scorecard.mjs <repo>` runs the same
checks from a terminal. See `docs/SCORECARD.md` for how it reads repos over
CORS and how to add a language.

## Flat Yahtzee

Live at `/games/yahtzee.html`. Multiplayer Yahtzee with no game server: browsers
find each other through public Nostr relays ([Trystero](https://github.com/dmotz/trystero),
vendored in `assets/yahtzee/vendor/` with the reason written down) and then talk
directly over WebRTC: dice, chat, photos and GIFs, and optional video. The room
creator's browser hosts and signs the game state; if it leaves, the next seated
player takes over after 12 seconds, proven by a chain of signed seating lists
(`assets/yahtzee/lib/auth.js`). Tests: `node test/yahtzee.test.mjs`.

It sits under `/games/` so the edge can give those pages their own headers
policy (relays, `blob:` media, camera and mic) without loosening the rest of
the site. After pulling this in, once: `node infra/wire-edge.mjs` then
`node infra/wire-cloudfront.mjs`.

## Publishing

```bash
node pipeline/build.mjs
node pipeline/deploy.mjs --dry-run
node pipeline/deploy.mjs
```

`site/` is the deployable artifact: static HTML, one stylesheet, no JavaScript
required to read an article. `deploy.mjs` needs `LIVE_BUCKET`, `STAGING_BUCKET`,
`DISTRIBUTION_ID` and `BUCKET_REGION` in `.env`; it syncs the build to staging,
then staging to live.

## Configuration

Two files, split by whose they are:

- **`config.json`** (committed): the publication itself (its name, domain and
  tagline) and the pipeline's thresholds. The build and the admin render from it.
- **`.env`** (gitignored): this deployment. Bucket names, the CloudFront
  distribution, the admin Lambda, the Google client id. `.env.example` lists every
  value; the `infra/` scripts write what they create into `.env` as they go, and CI
  sets the same names as variables. Node reads it natively (20.12 or later), so
  there is still nothing to install.

Articles are normally published through the admin (`docs/ADMIN.md`), which keeps
them in the staging bucket. `deploy.mjs` syncs with `--delete`, so run it only when
the local `articles/` holds every article: otherwise it removes the ones that live
only in the admin.

---

## Layout

```
config.json              site identity and pipeline thresholds
.env.example             the deployment's values, for a gitignored .env
pipeline/
  sources.json           where to look (and what is blocked, and why)
  taxonomy.json          THE EDITORIAL RUBRIC -- categories, gates, penalties
  harvest.mjs            fetch  -> data/raw/<date>.json
  score.mjs              score  -> data/queue.json
  queue.mjs              review -> articles/<date>-<slug>.json
  build.mjs              render -> site/
  deploy.mjs             ship   -> S3 + CloudFront
  daily.mjs              harvest + score + queue in one command
  lib/                   curl wrapper, RSS parser, scorer
articles/                one JSON per article (unpublished drafts are gitignored)
content/                 the manifesto and other non-article page content
shared/                  the renderer and schema checks, shared by the build and the admin
site/                    generated -- deployable as-is
data/                    harvests, queue, published archive
admin/                   the admin Lambda, its editor UI, and the editor bundle's source
infra/                   provisioning and deploy scripts for AWS
stories/                 the films: kit, brand, tools, and one folder per film
test/                    node test/<name>.test.mjs
docs/EDITORIAL.md        house style and the article formula
docs/ADMIN.md            the admin: auth, publishing, stats
assets/scorecard/        the repo scorecard: ES modules, no build step
tools/scorecard.mjs      the scorecard from a terminal
docs/SCORECARD.md        how the scorecard works, and adding a language
```

`data/published.json` keeps used source URLs out of future queues automatically.

## License

[MIT](LICENSE), copyright airbrx. That covers the code and the articles in this
repository: use them, adapt them, republish them, with the notice kept.

Two pieces come from elsewhere under their own terms:

- **Icons** in `assets/scorecard/icons.js` are from [Font Awesome Free](https://fontawesome.com),
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **The admin's editor** (`admin/editor`) builds against [CKEditor 5](https://ckeditor.com/ckeditor-5/),
  licensed GPL-2.0-or-later. It is a dependency, not code in this repository; the
  bundle it produces (`admin/ui/ckeditor.js`, not committed) is under CKEditor's license.
- **Tone.js** (`stories/vendor/`), which plays the films' scores, is
  [MIT](https://github.com/Tonejs/Tone.js), with its licence beside it.
