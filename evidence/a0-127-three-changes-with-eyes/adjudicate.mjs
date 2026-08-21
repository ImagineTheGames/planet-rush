/**
 * evidence/a0-127-three-changes-with-eyes/adjudicate.mjs — settle one candidate by
 * looking at it. OWNER: QA Manager (a0-127).
 *
 * A number that says "no cross" and an eye that sees one is the disagreement this
 * brief is for, and the eye wins. This cuts a stated star out of a stated frame at
 * 6× nearest neighbour — every pixel is a pixel of the specimen, repeated — so the
 * question "halo? cross?" is answered on the pixels the developer would see.
 *
 *   node evidence/.../adjudicate.mjs after-menu-desktop-1280x800 205,327 170,419
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { CROPS, crop, shotPath } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const NAME = process.argv[2];
const SPOTS = process.argv.slice(3).map((s) => s.split(',').map(Number));
const R = 60;
const SCALE = 6;
mkdirSync(CROPS, { recursive: true });
const cells = SPOTS.map(([x, y]) => crop(shotPath(`${NAME}-sky`), { x: x - R, y: y - R, w: 2 * R, h: 2 * R, scale: SCALE }));
const cols = Math.min(4, cells.length);
const rows = Math.ceil(cells.length / cols);
const cw = 2 * R * SCALE;
const sheet = new PNG({ width: cols * cw, height: rows * cw });
sheet.data.fill(0);
cells.forEach((c, k) => {
  const ox = (k % cols) * cw;
  const oy = Math.floor(k / cols) * cw;
  for (let j = 0; j < cw; j++) {
    for (let i = 0; i < cw; i++) {
      const si = (j * cw + i) * 4;
      const di = ((oy + j) * sheet.width + ox + i) * 4;
      sheet.data[di] = c.data[si];
      sheet.data[di + 1] = c.data[si + 1];
      sheet.data[di + 2] = c.data[si + 2];
      sheet.data[di + 3] = 255;
    }
  }
});
const tag = SPOTS.map(([x, y]) => `${x}x${y}`).join('_');
writeFileSync(join(CROPS, `${NAME}-adj-${tag}.png`), PNG.sync.write(sheet));
console.log(`crops/${NAME}-adj-${tag}.png — ${cells.length} cells, ${2 * R}px square each at ${SCALE}×, reading order: ${SPOTS.map((s) => s.join(',')).join(' | ')}`);
