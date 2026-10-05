// crop.mjs <sheet.png> <firstRow> <rows> <out.png>: a slice of a contact sheet
import { createCanvas, loadImage } from '@napi-rs/canvas'; import fs from 'node:fs';
const [f, r0, n, out] = process.argv.slice(2), RH = 386, im = await loadImage(fs.readFileSync(f));
const c = createCanvas(im.width, RH * +n); c.getContext('2d').drawImage(im, 0, -RH * +r0);
fs.writeFileSync(out, await c.encode('png'));
