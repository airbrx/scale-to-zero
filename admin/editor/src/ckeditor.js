// The plugin set for the vendored bundle.
//
// The stock CKEditor 5 classic build -- which is what admin/ui/ckeditor.js used
// to be, byte for byte -- ships no CodeBlock, Code, HorizontalLine or
// SourceEditing. The toolbar in admin/ui/app.js asked for four buttons the
// bundle could not supply, and CKEditor drops unavailable toolbar items with a
// console warning rather than an error, so they just silently were not there.
// This build exists to add them.
//
// It is also deliberately SMALLER than the classic build. The upload-adapter
// plugins (CKFinder, CKBox, EasyImage, CloudServices, ImageUpload) are gone:
// inline images do not go through CKEditor at all, they are POSTed to /media
// and inserted as an `imageBlock` element by app.js. Those plugins were dead
// weight pointing at third-party endpoints we never call.
//
// Anything added here is a byte every admin page load pays for. Add features
// because the toolbar needs them, not because they exist.

import { ClassicEditor } from "@ckeditor/ckeditor5-editor-classic";

import { Essentials } from "@ckeditor/ckeditor5-essentials";
import { Paragraph } from "@ckeditor/ckeditor5-paragraph";
import { Autoformat } from "@ckeditor/ckeditor5-autoformat";
import { Bold, Code, Italic } from "@ckeditor/ckeditor5-basic-styles";
import { BlockQuote } from "@ckeditor/ckeditor5-block-quote";
import { CodeBlock } from "@ckeditor/ckeditor5-code-block";
import { Heading } from "@ckeditor/ckeditor5-heading";
import { HorizontalLine } from "@ckeditor/ckeditor5-horizontal-line";
import { Image, ImageCaption, ImageStyle, ImageTextAlternative, ImageToolbar } from "@ckeditor/ckeditor5-image";
import { Indent } from "@ckeditor/ckeditor5-indent";
import { AutoLink, Link, LinkImage } from "@ckeditor/ckeditor5-link";
import { List } from "@ckeditor/ckeditor5-list";
import { AutoMediaEmbed, MediaEmbed } from "@ckeditor/ckeditor5-media-embed";
import { PasteFromOffice } from "@ckeditor/ckeditor5-paste-from-office";
import { SourceEditing } from "@ckeditor/ckeditor5-source-editing";
import { Table, TableToolbar } from "@ckeditor/ckeditor5-table";
import { TextTransformation } from "@ckeditor/ckeditor5-typing";

class Editor extends ClassicEditor {}

Editor.builtinPlugins = [
  AutoLink,
  AutoMediaEmbed,
  Autoformat,
  BlockQuote,
  Bold,
  Code,
  CodeBlock,
  Essentials,
  Heading,
  HorizontalLine,
  Image,
  ImageCaption,
  ImageStyle,
  ImageTextAlternative,
  ImageToolbar,
  Indent,
  Italic,
  Link,
  LinkImage,
  List,
  MediaEmbed,
  Paragraph,
  PasteFromOffice,
  SourceEditing,
  Table,
  TableToolbar,
  TextTransformation,
];

// app.js passes its own `toolbar`, `heading` and `codeBlock` config. What is
// left here is the config the classic build used to supply and app.js never
// overrode -- the balloon toolbars that appear on a selected image or table.
// Without these the balloons render empty.
Editor.defaultConfig = {
  image: {
    toolbar: [
      "imageTextAlternative",
      "toggleImageCaption",
      "|",
      "imageStyle:inline",
      "imageStyle:block",
      "imageStyle:side",
    ],
  },
  table: {
    contentToolbar: ["tableColumn", "tableRow", "mergeTableCells"],
  },
  language: "en",
};

export default Editor;
