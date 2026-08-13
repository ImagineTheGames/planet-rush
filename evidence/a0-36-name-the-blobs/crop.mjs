/**
 * evidence/a0-36-name-the-blobs/crop.mjs — a0-36, the magnifying glass.
 * OWNER: QA Manager.
 *
 * Crop a region of a PNG and scale it up nearest-neighbour, optionally lifting
 * luma by a stated gain so a 6%-alpha wash is legible on a review monitor.
 * Nearest-neighbour on purpose: interpolation would invent the very soft edge
 * this round is trying to characterise.
 *
 *   node crop.mjs <in.png> <out.png> <x> <y> <w> <h> [zoom] [gain]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , inPath, outPath, xs, ys, ws, hs, zs = '3', gs = '1'] = process.argv;
const x0 = +xs,
  y0 = +ys,
  w = +ws,
  h = +hs,
  zoom = +zs,
  gain = +gs;

const src = PNG.sync.read(readFileSync(inPath));
const out = new PNG({ width: w * zoom, height: h * zoom });
for (let y = 0; y < h * zoom; y++) {
  for (let x = 0; x < w * zoom; x++) {
    const sx = Math.min(src.width - 1, x0 + Math.floor(x / zoom));
    const sy = Math.min(src.height - 1, y0 + Math.floor(y / zoom));
    const si = (sy * src.width + sx) * 4;
    const di = (y * out.width + x) * 4;
    for (let c = 0; c < 3; c++) out.data[di + c] = Math.min(255, Math.round(src.data[si + c] * gain));
    out.data[di + 3] = 255;
  }
}
writeFileSync(outPath, PNG.sync.write(out));
console.log(`${outPath}  ${w}x${h} @${x0},${y0} ×${zoom} gain ${gain}`);
