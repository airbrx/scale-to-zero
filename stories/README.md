# Report films

Animated explainers made from the Report's articles: one continuous
hand-drawn shot, narrated, with a score, that plays in the browser and
exports to MP4. The kit that plays them is in `lib/`; they wear the
Report's own colours and wordmark.

Nothing here is deployed by `pipeline/deploy.mjs`. A film goes out as the
folder `tools/publish.mjs` builds (below), copied up by hand.

## Setup, once

Watching and editing a film needs nothing installed: any static server will
do.

```bash
python -m http.server 8090                # from the repo root
```

The tools need more, each only for what it does:

- `cd stories/tools && npm install`: a canvas, Tone.js and Web Audio for
  `check.mjs --stills` and `--audio`, `crop.mjs`, `lookbook.mjs` and
  `sectiontest.mjs` (the smoke test alone needs nothing). The first
  `--stills` run downloads the Inter font into `tools/fonts/`.
- `ffmpeg` and `ffprobe` on the PATH: `align.py`, `voice.mjs`,
  `check.mjs --voice`.
- Python 3 with `pip install faster-whisper numpy`: `align.py`. Its first
  run downloads the Whisper `small.en` model.

Then open http://localhost:8090/stories/. The gallery reads `manifest.json`.
In a story window, `p` opens the play tile (record, export MP4) and
**Presenter** opens the teleprompter on the same clock.

## What's here, and what isn't

```
stories/
  index.html      the local gallery (manifest.json, then manifest.local.json:
                  films of unpublished articles, gitignored with their folders)
  doc.html        README.md and STYLE.md, rendered (?doc=built, ?doc=style)
  lib/            the kit: timeline, viewer, presenter, export, the film loop
  brand/
    tokens.css    the stage palette in the Report's values, loaded after the kit's
    viewer.css    the story window and presenter in the Report's clothes
    presenter.css
    report.js     wordmark, masthead title card, sign-off, channel ID
    captions.js   the caption strip, live and burned into recordings
    color.js      colour arithmetic on the palette (mix, shade)
    fold.js       the folded-paper 3D world, and LOOK (light and heat)
    street.js     the shared cast: the paper bot, its tracks, the house front, mist
    hud.js        the phone feed and the receipts spine
    looks/        the lookbook: the same frames under each LOOK treatment
  score/sound.js  the Report's score and effects (lib/sound.js re-exports it)
  score/loudness.js  LUFS (BS.1770) and the speech map the mix ducks under
  vendor/         Tone.js 14.8.49 (MIT), served with the films rather than from a CDN
  tools/check.mjs smoke test; --stills contact sheets; --audio renders the
                  soundtrack, measures each section, writes a WAV
  tools/sectiontest.mjs  quick A/B of score sections, for tuning (see its header)
  tools/lookbook.mjs     re-renders brand/looks/ after a LOOK change
  tools/crop.mjs         slices a contact sheet into rows, for reading it
  tools/align.py         a take -> <slug>/voiceover.json, with room where it's rushed
  tools/voice.mjs        a take -> <slug>/voiceover.m4a, named in voiceover.json
  tools/publish.mjs      every film with a voice -> dist/films/ (gitignored), as CI publishes it
  <slug>/
    script.md     every spoken word; the only copy
    storyboard.md the visual plan, beat by beat
    story.js      BEATS + makeStory(T)
    index.html    story window (+ the sources panel)
    presenter.html teleprompter
    voiceover.json  the recorded take's timing (tools/align.py), once there is one
    voiceover.m4a   the voice itself (tools/voice.mjs); takes are never committed
```

## The script and the clock

`script.md` is the only copy of the words, and the film's clock.

- `## 03 Title` starts beat 03 (`[skip]` in the heading leaves it out).
- `{name}` before a word fires the story's build `name` on that word; alone
  on its line, it fires where it stands. Every build the story declares is
  cued exactly once.
- `> ` lines are directions, never spoken; `> ♪ name` starts a score
  section (below). `[pause 1.5]` is held silence.
- In `story.js`, `BEATS` gives each beat its `min` length and each cue the
  seconds its build needs to play out. Nothing hardcodes a time: every
  moment is `T.at('name')` or a beat edge, so editing the script re-times
  the whole film, at a reading speed or to a recorded voiceover.

## The house

- **Brand.** Paper ground, ink, invoice red for cost and the eyebrows,
  flat-stack green for the resolution. Every story loads
  `../brand/tokens.css` after `../lib/tokens.css`, returns `bug() = 0` to
  the kit and draws `reportBug()` itself, opens on `titleCard()` and closes
  on `signoff()` (the wordmark plus "a community project of airbrx").
- **Score.** Not one style per film: a story exports `SCORE`, named
  sections (key, mode, tempo, progression, a level per layer), and
  script.md starts each one with a `> ♪ name` line (`> ♪ name 1.5` starts
  the change 1.5 s early, so it lands on the line). The lines ride the
  script's clock, so the music moves with reading speed and with a
  recorded voiceover. `> ♪ silence` is a hard cut. Levels are balanced
  above 150 Hz, what a laptop plays.
- **Mix.** The voice leads. A loaded voiceover is measured (LUFS, BS.1770),
  levelled to -16 LUFS, compressed and limited; the score comes up 6 dB to
  sit under it, ducks 11 dB while it speaks (with a 4 dB dip at 2.5 kHz so
  the words have room) and lifts after 0.8 s of silence. Live and in the
  export alike. Override any of it per film in `SCORE.mix` (defaults:
  MIX in score/sound.js); trim a section with `level`. Check it with
  `node stories/tools/check.mjs <slug> --voice take.mp3 --seconds 60`.
- **Loading.** `lib/sound.js` and `lib/captions.js` re-export the Report's
  score and captions. The script and timing are fetched with
  `cache: 'no-cache'` (a 304 from the CDN when unchanged), the voice
  `voiceover.json` names plays by default, and Tone.js comes from
  `vendor/`: nothing loads from anyone else's server.
- **Look.** Every film is a place folded out of paper (STYLE.md). New films
  turn the house look on: running things heat toward red, lit windows glow, the page is
  printed in a halftone screen (`Object.assign(LOOK, HOUSE_LOOK)`, STYLE.md
  "Light and heat"). Type and parts come from the site itself: titles with
  a red key word, the site's principle rows, serif in ink and red. No
  handwriting face, no soft rounded cards, no mono eyebrows, no generic
  title-plus-meta headers. Pictures carry the story; labels are few.
- **Slugs.** Stories pass `stz-<slug>` to the viewer, the key their saved
  speeds and settings live under.
- **Editorial.** `docs/EDITORIAL.md` applies: every figure on screen is
  sourced in the info panel, and invented visuals say *illustrative*.

## How a film gets made

1. **Script.** Draft `script.md` from the article in the article's shape
   (STYLE.md): cold open, case, fair hearing, turn, the other side of the
   ledger, the rebuild, the honest caveat, the line. Argue about the words
   here; it's cheapest.
2. **Storyboard.** `storyboard.md`: the place, the one thing we follow, the
   spine, the rhyme, and a picture for every cue.
3. **Draw.** `story.js` builds the place with `brand/fold.js` and the shared
   cast, in the house look, a beat or two at a time. After each round:
   `node stories/tools/check.mjs <slug> --stills` (one-time `npm install` in
   stories/tools), then read `stories/tools/out/<slug>-light.png` and
   `-dark.png`.
4. **Voice and align.** Record with the presenter driving the story window,
   then `python stories/tools/align.py <slug> take.wav` (faster-whisper,
   ffmpeg). It writes `voiceover.json` and a transcript beside the take to
   read for slips. A beat the take rushes (a title read straight through,
   a turn with no breath) gets silence inserted before the next beat, in a
   copy of the take named `<take> (aligned).wav`; that copy is the voice.
5. **Make it the film's voice:** `node stories/tools/voice.mjs <slug> <take>`,
   with the `(aligned).wav` copy if `align.py` made one: the take
   `voiceover.json` names.
   It encodes AAC-LC, mono, 48 kHz, 48 kbps, index first (`voiceover.m4a`,
   ~2.9 MB for eight minutes), checks the alignment is for this take, and
   names the file in `voiceover.json` as `"audio"`. From then on the story
   window plays that voice by default and the MP4 export uses it.
6. **Publish:** commit the film with its `voiceover.json` and `voiceover.m4a`
   (and its entry in `manifest.json`) and push to main. CI
   (`.github/workflows/films.yml`) runs `tools/publish.mjs`, which smoke-tests
   and builds every film that has a voice into `stories/dist/films/`, with a
   `manifest.json` index, and syncs it to the staging bucket's `films/`. The
   admin then lists the film under **Film** in the article editor; attach it,
   save, and the admin's publish takes it live with the article. Run
   `node stories/tools/publish.mjs` locally to see what CI will build.

   In the article the film is an HTML card (`shared/render.mjs`, styled by
   `brand/embed.css`). Pressing play loads `lib/embed.js`, which plays the
   film in the card's place, in the page: no iframe, and nothing of the film
   downloads before the press. The film's own page, `/films/<slug>/`, works
   too, with the Record and Presenter buttons hidden.
7. **Export MP4** from the play tile, for the platforms that want a file.
