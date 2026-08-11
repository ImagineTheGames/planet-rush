/**
 * evidence/a0-21-stray-wheel-rule/crop.mjs — the before/after plate.
 *
 * Crops the same window out of the desktop BUILD WHEEL golden at two commits and
 * stacks them, so the PR body can show the stray rule and its absence at the same
 * scale. The window is the left half of the wheel plus the hub, which is where
 * the line ran (hub edge → outer ring, at the wheel's vertical centre, just under
 * `OPEN ▸`) and where the hub's own `CLOSE · ESC` rule — the one that is CORRECT
 * and untouched — also sits, so one picture answers both questions.
 *
 * Reproduce:
 *   git show <before>:tests/mobile/goldens.spec.ts-snapshots/desktop-build-wheel-desktop-linux.png > before.png
 *   cp tests/mobile/goldens.spec.ts-snapshots/desktop-build-wheel-desktop-linux.png after.png
 *   node evidence/a0-21-stray-wheel-rule/crop.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const here = path.dirname(new URL(import.meta.url).pathname);

/** The wheel is centred at (640, 400) with r ≈ 232 in the desktop golden. */
const WINDOW = { x: 380, y: 355, w: 340, h: 95 };
const SCALE = 3;
/** Rows of gutter between the two crops in the stacked plate. */
const GUTTER = 8;

function crop(file, { x, y, w, h }, scale) {
  const src = PNG.sync.read(fs.readFileSync(file));
  const out = new PNG({ width: w * scale, height: h * scale });
  for (let oy = 0; oy < out.height; oy++) {
    for (let ox = 0; ox < out.width; ox++) {
      const si = ((y + Math.floor(oy / scale)) * src.width + (x + Math.floor(ox / scale))) * 4;
      const di = (oy * out.width + ox) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

function stack(top, bottom) {
  const out = new PNG({ width: top.width, height: top.height + GUTTER + bottom.height });
  out.data.fill(0);
  top.bitblt(out, 0, 0, top.width, top.height, 0, 0);
  bottom.bitblt(out, 0, 0, bottom.width, bottom.height, 0, top.height + GUTTER);
  return out;
}

const before = crop(path.join(here, 'before.png'), WINDOW, SCALE);
const after = crop(path.join(here, 'after.png'), WINDOW, SCALE);
fs.writeFileSync(path.join(here, 'before-crop.png'), PNG.sync.write(before));
fs.writeFileSync(path.join(here, 'after-crop.png'), PNG.sync.write(after));
fs.writeFileSync(path.join(here, 'before-after.png'), PNG.sync.write(stack(before, after)));

// And the one number the PR quotes: how much of the frame actually moved.
const a = PNG.sync.read(fs.readFileSync(path.join(here, 'before.png')));
const b = PNG.sync.read(fs.readFileSync(path.join(here, 'after.png')));
let changed = 0;
const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
for (let y = 0; y < a.height; y++) {
  for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d <= 8) continue;
    changed++;
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  }
}
fs.writeFileSync(
  path.join(here, 'diff.json'),
  `${JSON.stringify({ changedPixels: changed, frame: a.width * a.height, box }, null, 2)}\n`,
);
console.log('changed', changed, 'px', box);
