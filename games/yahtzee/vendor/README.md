# Vendored: Trystero

`trystero-nostr.js` is [Trystero](https://github.com/dmotz/trystero) 0.26.0,
its Nostr strategy, bundled into one ES module. It is the only third-party
code the game runs.

**Why a dependency at all.** Two browsers cannot open a WebRTC connection to
each other until they have swapped connection details, and that swap needs some
shared place to post them. The usual answer is a signalling server we would run
and pay for around the clock. Trystero posts the swap to public Nostr relays
instead, encrypted, and from then on the browsers talk directly. No server of
ours exists at any point, which is the whole point of the page.

**Why vendored, not loaded from a CDN.** The Scale-to-Zero Report's CSP allows scripts from
`'self'` only, and a game that breaks when a CDN does is a cascade failure we
write articles about.

Rebuild (nothing here runs at build or deploy time):

```bash
mkdir /tmp/tr && cd /tmp/tr && npm init -y && npm i trystero@0.26.0 esbuild
echo 'export {joinRoom, selfId} from "@trystero-p2p/nostr";' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --minify --target=es2020 \
  --legal-comments=none --outfile=trystero-nostr.js
```

then put the header comment back on top. Licences: `LICENSE.trystero.txt`.
