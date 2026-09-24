# The admin plane

Editing and publishing happen entirely in S3. Nothing needs a git checkout, and
nothing needs this laptop. The admin is a Lambda that only runs while somebody is
actually editing, so the management plane scales to zero along with the site.

```
browser ──► CloudFront ──┬── /*        ──► S3 live bucket        (OAC, read-only)
                         ├── /api/*    ──► Lambda Function URL   (plain custom origin)
                         └── /admin*   ──► same Lambda, serves the editor UI

Lambda ──► S3 staging  (drafts, media, admins.json, _internal/*)
       ──► S3 live     (publish = server-side copy)
       ──► S3 logs     (read-only, for the Stats tab)
       ──► CloudFront  (invalidation, this distribution only)

  us-east-1: the Lambda        us-west-2: all three buckets
```

## The one manual step: a Google OAuth client

Everything else is provisioned by script. This part cannot be — it lives in the
Google Cloud console, not AWS.

1. <https://console.cloud.google.com/apis/credentials> → **Create credentials** →
   **OAuth client ID** → **Web application**.
2. **Authorized JavaScript origins**: `https://scale-to-zero.com`
   (add `https://www.scale-to-zero.com` too if you will ever use it).
3. There is no redirect URI to set — Google Identity Services posts the credential
   back to the page. Leave that list empty.
4. Copy the client ID (it ends in `.apps.googleusercontent.com`) and run:

```bash
node infra/deploy-lambda.mjs --client-id 1234-abc.apps.googleusercontent.com
```

The client ID is **not a secret** — it is public by design, exactly like the one
in `signal/website/crm/config.js`. There is no client secret anywhere in this
system, because there is no server-side OAuth exchange: the browser gets an ID
token and the Lambda verifies its signature.

Until the client ID is set, `/api/health` reports `clientId: null` and the sign-in
page says so rather than failing silently.

## How authorization actually works

Two separate things, and conflating them is how admin panels get walked into:

| | Question | Answered by |
|---|---|---|
| **Authentication** | Is this really `alice@example.com`? | Google. Proven by an RS256 signature over the ID token, verified in `admin/lib/auth.mjs` against Google's JWKS. |
| **Authorization** | May `alice@example.com` edit? | `admins.json` in the **private** staging bucket. |

The email is only ever read from the *verified* token payload. No route anywhere
trusts an email out of a request body.

This is deliberately different from `signal/website/crm/auth.js`, which this was
adapted from. That page requests a Google **access token** for the Sheets API and
lets Google enforce who may touch the sheet — its own comments note the email it
displays is cosmetic. There is no equivalent gatekeeper in front of an S3 bucket,
so verification has to happen server-side, before any write.

Three properties worth keeping:

- **An empty or missing admin list denies everyone.** The basic-auth helper this was
  adapted from returns `true` when no credentials are configured, which is convenient locally
  and catastrophic if config ever fails to load in production. This one throws.
- **`admins.json` never gets published.** It lives only in staging, and `publish`
  skips it explicitly. Putting it on the live site would publish everyone's email.
- **You cannot lock the site out.** Saving a list with no owner, or one that drops
  your own address, is refused.

Roles: `owner` can edit the admin list; `editor` can do everything else.

### Sessions, and why sign-in used to last an hour

A Google ID token is a login **assertion**, not a session. It lives one hour and
GIS will not silently reissue one. The first version of this admin used it
directly as the credential, so it logged you out every hour, potentially
mid-article. That was the wrong shape.

Now it is exchanged once:

```
browser --(Google ID token)--> POST /api/session --> { sessionToken, expiresAt }
browser --(sessionToken)-----> every other route
```

The session token is HMAC-SHA256 signed by the Lambda over `{email, role, exp}`,
valid **12 hours**. No session store, nothing running — the token carries its own
claims and the signature is what makes it trustworthy.

Details that matter:

- **The role is re-checked against `admins.json` on every request**, not read
  from the token. Revoking someone takes effect immediately rather than at their
  next sign-in.
- **sessionStorage, not localStorage.** A reload keeps you signed in; closing the
  tab does not leave a live credential on disk.
- **A bearer header, not a cookie.** Browsers attach cookies to cross-site
  requests automatically, which is the entire CSRF problem. A header is not sent
  that way, so there is no CSRF surface and no token to forge.
- **One silent retry on 401.** If the session ages out mid-use, the client asks
  GIS for a fresh credential and replays the request. You notice a pause, not a
  logout.
- **`SESSION_SECRET` is read back from the live function config on redeploy.**
  Regenerating it would sign everyone out on every deploy; writing it to
  `config.json` would put a secret in the repo. It exists only as a Lambda
  environment variable.

Work in the editor is additionally mirrored to `localStorage` every five seconds
while dirty, and offered back on next load. Belt and braces: an expired session
or a closed laptop should never cost an article.

## Bootstrapping the first owner

Chicken-and-egg: the Lambda refuses everything when the list is missing, and only
an owner can write the list through the API. So the first owner is placed out of
band, with AWS credentials:

```bash
node infra/seed-staging.mjs --owner you@example.com
```

This also uploads the site config, taxonomy, manifesto, and any articles already
in `articles/` so the admin has something to show. It will not overwrite an
existing `admins.json` unless you pass `--force` — otherwise re-running it would
silently demote everyone added through the UI.

## The API contract

`admin/openapi.json` (OpenAPI 3.1) is the API, not a description of it:

- **Routing comes from it.** `admin/lib/routes.mjs` matches requests against its
  `paths`; each `operationId` names one handler in `server.mjs`. An operation
  without a handler, or a handler without an operation, stops the Lambda from
  loading. A path that exists answers a wrong method with 405 and `Allow`.
- **Validation comes from it.** Request bodies are checked against its schemas
  by `shared/schema.mjs` (a small validator, no dependency); a bad request gets
  400 with every problem in `details`. `pipeline/build.mjs` checks
  `articles/*.json` against the same `Article` schema.
- **Tests hold it to its word.** `test/api.test.mjs` runs the real server with
  the S3 store and sharp stubbed, and checks every response against the schema
  the spec declares for it.

Articles are plain REST. `PATCH /api/articles/{slug}` merges (the editor uses
this); `PUT` replaces every editable field and refuses a partial body rather
than dropping what was left out. Reads return an `ETag`; send it back as
`If-Match` and a save over someone else's newer edit gets 412 instead of
silently replacing it. `POST /api/publish` and `POST /api/stats` are commands,
and the spec says so.

When adding a route: add it to `openapi.json` first, then the handler. The
server will not start until both exist.

## Publishing

`GET /api/publish` returns the changeset; `POST /api/publish` performs it.

Publishing re-renders every published article, diffs staging against live by ETag,
copies only what differs (server-side, inside S3 — bytes never round-trip through
a browser or this laptop), deletes what staging no longer has, and invalidates the
CDN. Under ~15 changed paths it invalidates precisely; past that it uses `/*`,
because only the first 1000 paths per month are free.

`admin/*`, `admins.json`, `sitedata.json`, `media/*` and `_internal/*` are never
published. The local `pipeline/deploy.mjs` excludes the same prefixes from its
`--delete` sync: omitting `_internal/*` there once wiped the entire article store
the admin reads from, leaving the rendered site up and its source gone.

## Writing

The body is one free-form CKEditor 5 instance (41.3.1, from the CDN), stored as
HTML. The five-section formula in `docs/EDITORIAL.md` is now guidance for how a
piece should think, not scaffolding you have to type into. Rewrite freely.

The toolbar carries headings, bold/italic, links, block quotes, code, lists,
indent, tables, horizontal rules, undo/redo, and **source editing** for when you
want the markup directly.

Two things the editor does for you:

- **Word count**, live, next to the Body label.
- **Insert image** uploads to staging through `sharp` (1400px webp plus a 480px
  thumbnail) and drops it at the cursor. The original is not kept.

Unsaved work is protected by a dirty flag: switching tabs, going Back, or closing
the browser all warn first.

An article written before the switch still has `sections`. Opening it folds those
into HTML so it edits as prose; saving drops the old field. The renderer still
handles `sections` for anything not yet re-saved, so nothing published breaks.

Stored HTML is sanitized at render time — script, iframe, object, embed, form,
link, meta and base tags, `on*` handlers, and `javascript:` URLs are stripped.
Admins are trusted, but a compromised admin session should not be able to plant
something every reader then executes.

## Stats

A Stats tab, from CloudFront access logs. No tracking script, no cookies, no
third party, nothing added to the public pages. The CDN already writes down every
request it serves.

Standard logging **v2** (JSON lines to S3) is enabled by `infra/enable-logging.mjs`.
v2 over the legacy format because one JSON object per line cannot silently shift
columns when AWS adds a field.

`POST /api/stats` folds newly delivered log objects into a stored daily report,
incrementally — a metadata file records which objects are already counted, so a
run only pays for what arrived since the last one. Capped at 300 files per run so
a backlog cannot blow the 60s timeout; progress is recorded either way, so
running again continues.

### Two files, and why

```
_internal/stats/daily.json        one small summary row per day
_internal/stats/days/<date>.json  everything else, read only when you open it
_internal/stats/metadata.json     which log objects are already folded in
_internal/geo/dbip-city-lite.mmdb.gz   the IP-to-city database
```

The Stats tab opens on `daily.json` alone, which stays a few kilobytes no matter
how much detail accumulates behind it. The drill-down is a second request. An
earlier version kept both in `daily.json`; thirty days of full detail is a few
megabytes, and re-reading and re-writing all of it on every processing run is
fine right up until it is the entire Lambda budget.

### The tabs

Modelled on `airbrx/signal/src/reporter/index.js`, which is a far more complete
treatment than the single summary page this started as.

| Tab | What is in it |
|---|---|
| **Overview** | Visits, page views, pages per visit, bounce rate, average visit, bandwidth, cache hit rate, requests, bots, probes, admin, errors; the per-day sparkline; audio completion; channels, top pages, referrers, countries |
| **Audience** | Browsers, operating systems, devices, device/OS pairs, entry and exit pages, and visits by channel with bounce rate, pages per visit and average time |
| **Content** | Pages, assets, audio files, status codes, hostnames, CDN edge locations |
| **Geography** | Countries, regions and cities for readers and for scanners separately, each with coordinates, plus the top client and scanner addresses |
| **Acquisition** | Channels, campaigns by click and by visit, sources, mediums, source/medium, terms, ad content, click IDs, **every query parameter seen**, referrer hosts and full URLs, landing pages by channel |
| **Bots** | Named bots and unidentified crawlers, each expandable to the paths it crawled, with a sample user agent for the unnamed ones |
| **Security** | Probe patterns, most-requested probe paths, 404 and 403 paths, top scanner addresses, and the probe log: the last 200 attempts with time, address, city, path, status and pattern |
| **Days** | Every processed day with its numbers. Picking one scopes every tab to that date, Overview included, and shows the hour-by-hour breakdown |

### Filtering to one day

Three ways in, all setting the same piece of state:

- the **day** dropdown beside the window selector, listing only dates that have
  been processed;
- a bar in the Overview sparkline;
- a date in the **Days** table.

Scoping re-reads `/api/stats?date=YYYY-MM-DD`, which narrows every total and
every top-N list to that day, and it holds while you move between tabs. What it
deliberately does not narrow is the per-day array behind the sparkline and the
Days table: those stay the whole window, so the scoped day has something to be
read against. The scoped bar stays solid while the rest of the window fades.

Scoping costs no extra storage. `daily.json` already holds a complete summary
row per day, lists included, so a scoped read filters rows it has already
fetched. Only the hour-by-hour chart needs the day's detail file.

This used to be half-built: `?date=` existed on `/api/stats/detail` but not on
`/api/stats`, so the summary ignored it, and picking a day moved you to Overview
-- the one panel that could not honour the choice. It read as a feature that did
nothing.

**Process new logs** keeps the scope, because it only ever adds to a day and
watching today fill up is the reason to press it. **Rebuild** and changing the
window both clear it, because either can remove the day you were looking at.

"Every query parameter seen" earns its place: it is how you find out the site is
being linked with a tag nobody here chose.

### Geography

City, region and coordinates come from an IP lookup against a MaxMind-format
database. `admin/lib/mmdb.mjs` is a ~250-line reader for the `.mmdb` container,
written rather than imported: signal uses `geoip-lite`, and a publication whose
fifth rule is *every dependency is a decision* should not pull in 150MB of
someone else's code to answer "which city".

```bash
node infra/fetch-geodb.mjs          # download DB-IP City Lite, verify, upload
node infra/fetch-geodb.mjs --check  # what is in the bucket now
```

DB-IP publishes City Lite monthly under **CC BY 4.0** with no account, which is
why it is the default rather than MaxMind's GeoLite2 (same format, but needs a
license key, so "run one command" is impossible). The attribution to db-ip.com on
the Geography tab is a licence condition — leave it there. A GeoLite2 file can be
dropped in with `--fetch-geodb --file`; the reader does not care which it is
handed.

The database lives in the staging bucket, not the deployment package: 127MB
unpacked would be twelve times the size of the whole Lambda, it changes monthly
while the code does not, and it is loaded lazily — only a run that actually has
log files to process pays for it. With no database present everything still
works and geography degrades to CloudFront's country code, which the tab says
rather than showing an empty table.

Two accuracy notes worth repeating to anyone reading the numbers: free city
databases are approximate, so treat a city as a neighbourhood-sized guess; and
country still comes from CloudFront's own `c-country` where it is present,
because that is better than an IP database.

### Reprocessing

### It runs itself, twice a day

An EventBridge rule (`stz-stats-twice-daily`, 07:00 and 19:00 UTC: midnight and
noon Pacific) invokes the admin Lambda directly with `{"job":"process-stats"}`,
which runs exactly what the Refresh button does. The stats are never more than
half a day behind, and no run inherits a week of backlog.

```bash
node infra/schedule-stats.mjs            # create or update the schedule
node infra/schedule-stats.mjs --status   # the rule, and the last runs from CloudWatch
node infra/schedule-stats.mjs --remove
```

The function accepts that one job payload and refuses every other direct
invocation. Each run logs one JSON line (`processed`, `batches`, `truncated`,
`ms`); a failure shows up in the function's error metric. An incremental run
keeps taking 300-file batches until it has caught up or nears the timeout, so a
backlog clears in one run, whether scheduled or clicked.

`POST /api/stats` is incremental. `POST /api/stats?force=1` — the **Rebuild**
button — clears the processed set and re-reads every log object still in the
bucket. That is needed whenever `stats.mjs` learns a new dimension: days already
folded in keep their old, thinner shape forever otherwise, because their log
files are marked done.

For a backlog too large for a 60s invocation, or to check a change to the
accumulator against real logs before deploying it:

```bash
node infra/rebuild-stats.mjs --dry-run   # parse, print, write nothing
node infra/rebuild-stats.mjs             # rebuild and upload
```

### What the numbers mean

Four things worth understanding before quoting any of them:

- **The admin plane is checked first, and separately.** Editing an article is not
  23 people visiting. This check used to sit *below* the probe check, which
  produced a genuinely funny result: saving an article whose slug contained the
  word "wordpress" filed the author as a scanner from Oregon.
- **A request the origin actually served is never a probe**, whatever the path
  looks like. Behind CloudFront and an OAC, a 200 means the key exists in our own
  bucket, which means we put it there. The guard has to live in `fold` rather
  than in the pattern matcher, because `isLegitimateRequest` consults
  `detectProbePattern` itself — a publication that writes about `wp-config.php`
  and `.env` files trips every pattern in the list with its own article slugs,
  and the status code is the thing that cannot lie.
- **Probes are counted separately, not discarded.** The first log file this site
  ever produced was 55 out of 56 requests hitting `/.env`, `/.git/HEAD` and
  `/.env.backup`. Folded into the main tables, scanners would drown the real
  traffic and make the Philippines look like the biggest audience.
- **Bots are excluded from page views** but still counted, so the headline number
  means humans. They still cost bandwidth, so they stay in requests.
- **Audio completion is reconstructed from HTTP range requests.** A browser
  streaming an mp3 asks for byte ranges; the furthest byte an IP reached against
  the file size gives a completion percentage. A play is over 10%, finished is
  90% or more. It is the only way to know whether anyone listened to the end
  without putting a tracker in the page.

### Privacy

Raw logs contain IP addresses and expire after 30 days by lifecycle rule.

Stored reports **do** retain a bounded top-N of client and scanner addresses with
their geography. That reverses an earlier rule here, deliberately: this file used
to collapse every address to a count before writing and said so loudly, and the
scanner table turns out to be the raw material for half of what the publication
writes about. Session fingerprints are still never written — those exist only
inside a run, and unique visitors are still counted per run and collapsed to an
integer, which is why that one number is additive across runs and slightly
overstated.

If you would rather have the old rule back, it is the `accumulateIp` calls in
`admin/lib/stats.mjs` and the `ips` block in `sealDay`.

## Templates

`templateType` on an article picks the layout, following a pattern from an earlier project:

- `article` — the five-section format
- `podcast` — adds a plain `<audio>` element and an enclosure in `/podcast.xml`

`podcast.xml` is only written when at least one published article has audio, so
there is never a zero-item feed failing validation.

Audio duration is measured **in the browser** before upload and sent with the
article. Deriving it server-side would mean putting ffmpeg in the bundle, which is
a lot of megabytes for one number.

Images are resized by `sharp` in the Lambda into a 1400px webp and a 480px
thumbnail. The original is deliberately not kept — it is the largest object and
nothing reads it.

Gallery is not built.

## Local development

```bash
STZ_LOCAL=1 \
STAGING_BUCKET=scale-to-zero-com-site-staging \
LIVE_BUCKET=scale-to-zero-com-site \
DISTRIBUTION_ID=E32TNRWB7DWW3Y \
GOOGLE_CLIENT_ID=<id> \
node admin/server.mjs
```

Same router, same auth, real buckets. There is no offline mode and no auth bypass;
a dev backdoor in an admin is a production backdoor that happens to be documented.

## Rebuilding and redeploying

```bash
bash infra/build-lambda.sh        # ~10.6MB zip, forces the linux-x64 sharp binary
node infra/deploy-lambda.mjs      # push code + config
node infra/wire-cloudfront.mjs    # only needed if routing changes
```

The build script cross-compiles `sharp` with `--os=linux --cpu=x64 --libc=glibc`
because it usually runs on Windows, and it hard-fails if `@img/sharp-linux-x64` is
missing rather than shipping a bundle that crashes on cold start.

## Why not the Lambda Web Adapter

The project this was adapted from runs its server behind the Web Adapter layer with `run.sh` as the handler.
This one exports a native Function URL handler instead: the routing is small, it is
one fewer cross-account layer to depend on, and cold starts are quicker. Every
dependency is a decision, including our own.

## Why the Function URL is IAM-authenticated

The first attempt used `AuthType: NONE`, which returned 403 on every request. The
cause was an Organization SCP on this account blocking public Lambda Function URLs.

IAM auth plus a CloudFront OAC is the better answer anyway: CloudFront signs each
origin request with SigV4, and the Function URL rejects anything unsigned. The
admin plane has exactly one reachable front door.

Note the origin request policy is **AllViewerExceptHostHeader**. The Function URL
validates the SigV4 signature against its own hostname, so forwarding the viewer's
`Host` breaks every signed request.

## Costs

The Lambda bills only while a request is in flight. A day of editing is a few
thousand invocations at most, comfortably inside the free tier. Idle cost is zero,
which is the point.

Fixed costs remain the domain ($16/yr) and the Route 53 hosted zone ($6/yr). Alias
queries to CloudFront are not billed.
