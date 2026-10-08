# Flat Yahtzee

Multiplayer Yahtzee with no game server. Browsers find each other through public
Nostr relays and then talk directly over WebRTC: dice, chat, photos and GIFs up
to 5 MB, and optional camera and mic. Up to six players.

This folder is the whole game. It uses nothing else from the repository it
lives in, so to port it, copy the folder.

## Run it

Any static file host works. Locally:

```bash
cd games/yahtzee
python -m http.server 8000      # or: npx serve
```

Then open http://localhost:8000/. Opening `index.html` straight from disk will
not work: browsers do not load ES modules from `file://`. Outside localhost it
needs HTTPS, because the signing keys (WebCrypto) and the camera are only
available to secure pages.

## What's here

```
index.html          the game on a page of its own
standalone.css      that page's colours and fonts; a host page brings its own
yahtzee.css         the game's styles
app.js              entry point: draws the game into #yahtzee and runs it
markup.js           the game's controls, as a template
lib/rules.js        scoring
lib/game.js         the host's state machine: rolls, holds, turns, scores
lib/auth.js         identities, signed state, and the chain that says who may host
lib/table.js        the room: peers, messages, photos, video, host takeover
vendor/             Trystero (Nostr strategy), bundled; why and how in its README
test.mjs            node test.mjs, offline, Node 20+, nothing to install
```

## Put it in your own page

```html
<link rel="stylesheet" href="/path/to/yahtzee/yahtzee.css">
<script type="module" src="/path/to/yahtzee/app.js"></script>
...
<div id="yahtzee"></div>
```

`yahtzee.css` reads these CSS custom properties, which your stylesheet must
define (`standalone.css` has a light and a dark set to start from): `--ink`,
`--ink-soft`, `--ink-faint`, `--card`, `--rule`, `--accent`, `--accent-2`,
`--mono`, `--serif`.

## Headers

With no Content-Security-Policy it just works. If your site sends one, the
game's page needs:

- `connect-src 'self' wss:` to reach the Nostr relays
- `img-src 'self' blob:` and `media-src 'self' blob:` for shared photos and
  camera previews
- `script-src 'self'` and `style-src 'self'` are enough: no inline script or
  style anywhere

and, if you send a Permissions-Policy, `camera=(self), microphone=(self)`.
WebRTC itself is not governed by CSP.

## Change before you ship a copy

`APP_ID` in `lib/table.js` namespaces rooms on the relays. Set it to your own
domain so your players never land in a room with someone else's copy.

## How it works

Whoever starts the table hosts: their browser rolls the dice, checks every move
and signs the game state, and the other browsers accept only states carrying
that signature. The invite link carries the room code and the creator's public
key after the `#`, which browsers never send to the server. If the host leaves,
the table waits 12 seconds, then the next connected player in seating order
takes over, proven by the creator's signed seating lists (`lib/auth.js`).

What it gives up: you trust the host with the dice, as you would whoever holds
the cup at a real table. Strict networks that block direct connections need a
TURN relay server, which this does not run. Video is best for four or five
players, because each browser sends its camera to every other one.

## Licence

MIT, copyright (c) 2026 airbrx. From the Scale-to-Zero Report
(https://github.com/airbrx/scale-to-zero). The vendored Trystero and
@noble/secp256k1 are MIT too, with their notices in
`vendor/LICENSE.trystero.txt`.
