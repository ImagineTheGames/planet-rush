/**
 * evidence/a0-70-title-entrance/analyse.mjs — OWNER: UI Engineer (a0-70).
 *
 * Turn a frame burst into numbers, so "it flies in from the bottom right" is a
 * measurement rather than an impression.
 *
 * Per frame it reports the **ink box**: the bounding box of every pixel that is
 * not the Cold Vacuum background (0x0d1015), plus that box's centre. A screen
 * that is laid out correctly has an ink box centred on the viewport's own
 * centre; a screen that has been pushed toward a corner does not, and the sign
 * of the offset names the corner.
 *
 *     node evidence/a0-70-title-entrance/analyse.mjs <frames-dir>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node analyse.mjs <frames-dir>');
  process.exit(2);
}

/** Cold Vacuum, the app background (style-guide §1) — and the browser's own
 *  white before the first paint, which is worth telling apart from it. */
const BG = { r: 0x0d, g: 0x10, b: 0x15 };
/** How far off the background a channel has to be before it counts as ink.
 *  The starfield's dimmest stars are ~6 above it, so this is deliberately low. */
const TOL = 10;

const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const rows = [];

for (const file of files) {
  const png = PNG.sync.read(readFileSync(join(dir, file)));
  const { width, height, data } = png;
  let minX = width, minY = height, maxX = -1, maxY = -1, ink = 0;
  let white = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 240 && g > 240 && b > 240) white++;
      if (Math.abs(r - BG.r) <= TOL && Math.abs(g - BG.g) <= TOL && Math.abs(b - BG.b) <= TOL) continue;
      ink++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const blank = maxX < 0;
  rows.push({
    file,
    ink,
    blankPage: white > width * height * 0.5,
    box: blank ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    centre: blank ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    viewCentre: { x: (width - 1) / 2, y: (height - 1) / 2 },
  });
}

const pad = (s, n) => String(s).padStart(n);
console.log(`# ${dir}`);
console.log('frame                          ink px     ink box (x,y,w,h)        centre        offset from viewport centre');
for (const r of rows) {
  if (r.blankPage) {
    console.log(`${r.file.padEnd(26)} ${pad(r.ink, 9)}  (blank page — nothing painted yet)`);
    continue;
  }
  if (!r.box) {
    console.log(`${r.file.padEnd(26)} ${pad(r.ink, 9)}  (background only)`);
    continue;
  }
  const dx = r.centre.x - r.viewCentre.x;
  const dy = r.centre.y - r.viewCentre.y;
  console.log(
    `${r.file.padEnd(26)} ${pad(r.ink, 9)}  ` +
      `(${pad(r.box.x, 5)},${pad(r.box.y, 4)},${pad(r.box.w, 5)},${pad(r.box.h, 4)})  ` +
      `(${pad(r.centre.x.toFixed(1), 7)},${pad(r.centre.y.toFixed(1), 6)})  ` +
      `dx=${pad(dx.toFixed(1), 8)}  dy=${pad(dy.toFixed(1), 7)}`,
  );
}
