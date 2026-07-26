/**
 * evidence/crop-strip.mjs — round-10 analysis helper (NOT a deliverable).
 * Crops N evenly-spaced burst frames of an episode around a planet centre and
 * stitches them into a horizontal contact strip so the turret disc's rim position
 * can be read across time. Usage: node crop-strip.mjs <epiDir> <cx> <cy> <box> <n> <out>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const [dir, cxs, cys, boxs, ns, out] = process.argv.slice(2);
const cx = +cxs, cy = +cys, box = +(boxs ?? 440), n = +(ns ?? 8);
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const total = meta.frames.length;
const idxs = Array.from({ length: n }, (_, k) => Math.round((k * (total - 1)) / (n - 1)));

function crop(png, x0, y0, w, h) {
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y, di = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) { o.data[di + 3] = 255; continue; }
    const si = (sy * png.width + sx) * 4;
    o.data[di] = png.data[si]; o.data[di + 1] = png.data[si + 1]; o.data[di + 2] = png.data[si + 2]; o.data[di + 3] = 255;
  }
  return o;
}

const gap = 8, bg = [8, 10, 14];
const crops = idxs.map((i) => {
  const f = meta.frames[i];
  const png = PNG.sync.read(readFileSync(f.path));
  return { i, tick: f.tick, core: f.core, img: crop(png, Math.round(cx - box / 2), Math.round(cy - box / 2), box, box) };
});
const w = crops.length * box + gap * (crops.length - 1), h = box;
const strip = new PNG({ width: w, height: h });
for (let i = 0; i < strip.data.length; i += 4) { strip.data[i] = bg[0]; strip.data[i + 1] = bg[1]; strip.data[i + 2] = bg[2]; strip.data[i + 3] = 255; }
let ox = 0;
for (const c of crops) {
  for (let y = 0; y < box; y++) for (let x = 0; x < box; x++) {
    const si = (y * box + x) * 4, di = (y * w + (ox + x)) * 4;
    strip.data[di] = c.img.data[si]; strip.data[di + 1] = c.img.data[si + 1]; strip.data[di + 2] = c.img.data[si + 2]; strip.data[di + 3] = 255;
  }
  ox += box + gap;
}
writeFileSync(out, PNG.sync.write(strip));
console.log('strip', out, 'frames:', crops.map((c) => `i${c.i}/t${c.tick}/hp${(c.core ?? 0).toFixed(1)}`).join('  '));
