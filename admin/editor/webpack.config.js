// Webpack config for the vendored CKEditor bundle. Lifted from the official
// ckeditor5-build-classic config for v41.3.1, which is the version this repo
// pins (v44+ requires a licence key).
//
// Two things here are load-bearing and easy to break:
//   - `library: "ClassicEditor"` / `libraryExport: "default"`. admin/ui/app.js
//     calls a bare global `ClassicEditor.create(...)`, exactly as it did with
//     the CDN build. The UMD output has to keep providing that global.
//   - The CSS rule. CKEditor's theme is authored as PostCSS that imports Lark's
//     variables; `style-loader` then injects it at runtime. Drop this and the
//     bundle builds fine but the editor renders as unstyled HTML, because there
//     is no separate stylesheet to fall back on.

"use strict";

const path = require("path");
const webpack = require("webpack");
const { bundler, styles } = require("@ckeditor/ckeditor5-dev-utils");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  devtool: false,
  performance: { hints: false },

  entry: path.resolve(__dirname, "src", "ckeditor.js"),

  output: {
    // Straight into the deployed UI directory. There is no copy step.
    library: "ClassicEditor",
    path: path.resolve(__dirname, "..", "ui"),
    filename: "ckeditor.js",
    libraryTarget: "umd",
    libraryExport: "default",
  },

  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: { output: { comments: /^!/ } },
        extractComments: false,
      }),
    ],
  },

  plugins: [
    new webpack.BannerPlugin({ banner: bundler.getLicenseBanner(), raw: true }),
  ],

  module: {
    rules: [
      { test: /\.svg$/, use: ["raw-loader"] },
      {
        test: /\.css$/,
        use: [
          {
            loader: "style-loader",
            options: { injectType: "singletonStyleTag", attributes: { "data-cke": true } },
          },
          "css-loader",
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: styles.getPostCssConfig({
                themeImporter: { themePath: require.resolve("@ckeditor/ckeditor5-theme-lark") },
                minify: true,
              }),
            },
          },
        ],
      },
    ],
  },
};
