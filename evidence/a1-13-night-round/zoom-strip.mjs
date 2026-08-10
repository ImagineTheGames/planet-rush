/**
 * evidence/a1-13-night-round/zoom-strip.mjs — analysis helper, NOT a capture.
 * OWNER: QA Manager.
 *
 * Takes frames already committed by `./capture-vfx.mjs` and lays a tight
 * nearest-neighbour magnification of the same box across several of them, in
 * order, so a burst that is a few dozen small particles on a 600 px plate can
 * actually be READ off the evidence rather than asserted about it.
 *
 * NEAREST-NEIGHBOUR ONLY. Every pixel in the output is a pixel the client drew,
 * repeated — no interpolation, no sharpening, nothing that could invent a
 * particle that was not there.
 *
 *   node zoom-strip.mjs <out-name> <box-w> <box-h> <scale> <cy-offset> <file...>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');

const [name, bwS, bhS, scaleS, dyS, ...files] = process.argv.slice(2);
const BW = +bwS;
const BH = +bhS;
const S = +scaleS;
const DY = +(dyS ?? 0);
const G = 6;

const tiles = files.map((f) => {
  const src = PNG.sync.read(readFileSync(join(IMAGES, f)));
  const x0 = Math.round(src.width / 2 - BW / 2);
  const y0 = Math.round(src.height / 2 - BH / 2) + DY;
  const W = BW * S;
  const H = BH * S;
  const dst = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x0 + Math.floor(x / S);
      const sy = y0 + Math.floor(y / S);
      const s = (sy * src.width + sx) * 4;
      const d = (y * W + x) * 4;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    }
  }
  return dst;
});

const W = tiles.length * BW * S + (tiles.length + 1) * G;
const H = BH * S + 2 * G;
const out = new PNG({ width: W, height: H });
out.data.fill(0);
for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
tiles.forEach((t, i) => {
  const ox = G + i * (BW * S + G);
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) {
      const s = (y * t.width + x) * 4;
      const d = ((G + y) * W + (ox + x)) * 4;
      out.data[d] = t.data[s];
      out.data[d + 1] = t.data[s + 1];
      out.data[d + 2] = t.data[s + 2];
    }
  }
});
const file = `a1-13-${name}.png`;
writeFileSync(join(IMAGES, file), PNG.sync.write(out));
console.log(`images/${file}  ${W}x${H}  from ${files.join(' ')}`);
