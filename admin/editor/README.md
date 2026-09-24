# The CKEditor bundle

Builds `admin/ui/ckeditor.js`. Nothing else imports anything from here; the
output is a self-contained UMD file that `admin/ui/index.html` loads with a
plain `<script>` tag and `app.js` uses through the `ClassicEditor` global.

    npm install
    npm run build          # writes ../ui/ckeditor.js

Then deploy the UI as usual:

    node infra/deploy-admin-ui.mjs --dry-run
    node infra/deploy-admin-ui.mjs

## Why this exists

`admin/ui/ckeditor.js` used to be the stock CKEditor 5 **classic build**,
downloaded byte for byte from the CDN. That build ships no `CodeBlock`, and no
`Code`, `HorizontalLine` or `SourceEditing` either -- four of the buttons
`app.js` lists in its toolbar. CKEditor drops a toolbar item it cannot supply
with a console warning rather than an error, so those buttons were simply
absent and nothing said why.

There is no CDN build that carries them and nothing else. The super-build does,
but it is 4.26 MB and drags in the premium plugins, which then have to be named
in a `removePlugins` list or they raise licence errors. So: build our own.

## Rules

- **Stay on 41.3.1.** v44+ requires a licence key. Every `@ckeditor/*` package
  is pinned to an exact version, not a range, because they must all match.
- **Plugins live in `src/ckeditor.js`.** Adding one costs every admin page load
  bytes forever. Add it because the toolbar needs it.
- **`library: "ClassicEditor"` and `libraryExport: "default"` in the webpack
  config are load-bearing.** `app.js` calls a bare global, exactly as it did
  against the CDN file.
- **The CSS is inlined into the JS by `style-loader`.** There is no separate
  stylesheet, which is what keeps the admin CSP at `script-src 'self'` with no
  second request to account for. Break the CSS rule in `webpack.config.js` and
  the bundle still builds -- the editor just renders unstyled.
- **The output is committed.** The deploy script copies `admin/ui/` to S3 as
  flat files; it does not build anything. A rebuild that is not committed and
  deployed has changed nothing.

## Upgrading

Bump every `@ckeditor/*` version in `package.json` together, `npm install`,
`npm run build`, and check the diff in `admin/ui/ckeditor.js` is a whole new
bundle rather than a partial one. Read the release notes for licence-key
changes before going past 41.x.
