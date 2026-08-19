/**
 * evidence/a0-88-minimap/goldencrop.mjs — read a re-baselined golden's minimap
 * corner, stored beside fresh, at 4x. OWNER: UI Engineer (a0-88). Analysis tool,
 * not a golden and not a test.
 *
 * A golden is a whole frame, so re-baselining one adopts everything in it. The
 * only way to know that nothing but the minimap moved is to look at the minimap
 * in both halves, at a size a human eye can judge — a0-03's rule, and the reason
 * that lane's `crop.mjs` exists. This is the same idea pinned to one region: it
 * pulls the map rect out of the STORED golden (HEAD) and out of the re-baselined
 * one (the working tree) and puts them side by side, 4x nearest-neighbour.
 *
 * Nearest neighbour on purpose: the question is what a few pixels of mark look
 * like, and a smoothing resample would invent the edge quality being judged.
 *
 * Usage (from the repo root, with the OLD half already extracted by git):
 *   node evidence/a0-88-minimap/goldencrop.mjs <old.png> <new.png> x0 y0 x1 y1 <out.png>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [oldPath, newPath, ...rest] = process.argv.slice(2);
const [x0, y0, x1, y1] = rest.slice(0, 4).map(Number);
const out = rest[4];
const SCALE = 4;
const GAP = 10;

function crop(path) {
  const src = PNG.sync.read(readFileSync(path));
  const w = x1 - x0;
  const h = y1 - y0;
  const dst = new PNG({ width: w * SCALE, height: h * SCALE });
  for (let y = 0; y < dst.height; y++) {
    for (let x = 0; x < dst.width; x++) {
      const sx = x0 + ((x / SCALE) | 0);
      const sy = y0 + ((y / SCALE) | 0);
      const si = (src.width * sy + sx) << 2;
      const di = (dst.width * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  return dst;
}

const a = crop(oldPath);
const b = crop(newPath);
const sheet = new PNG({ width: a.width + GAP + b.width, height: Math.max(a.height, b.height) });
sheet.data.fill(0x1a);
for (const [img, ox] of [
  [a, 0],
  [b, a.width + GAP],
]) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (img.width * y + x) << 2;
      const di = (sheet.width * y + (x + ox)) << 2;
      sheet.data[di] = img.data[si];
      sheet.data[di + 1] = img.data[si + 1];
      sheet.data[di + 2] = img.data[si + 2];
      sheet.data[di + 3] = 255;
    }
  }
}
writeFileSync(out, PNG.sync.write(sheet));
console.log(`wrote ${out}  (${sheet.width}x${sheet.height}, ${SCALE}x; left = stored golden, right = re-baselined)`);
