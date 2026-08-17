/**
 * evidence/a0-70-title-entrance/analyse-door.mjs — OWNER: UI Engineer (a0-71).
 *
 * Where the DOOR is, in a COMPOSITE frame — the screencast, which is canvas plus
 * the overlay in front of it. `analyse.mjs` measures the ink box against Cold
 * Vacuum, which on a composite frame is the starfield too; the door is the one
 * thing on this screen made of lit hull steel, so it separates on brightness.
 *
 * Per frame: the **centroid** of every pixel at or above {@link HULL} on all
 * three channels, and its offset from the frame's own centre — which is the
 * number "it flies in from the bottom right" is a claim about.
 *
 * Centroid rather than bounding box, and that is not a detail. The prompt's
 * `PRESS ANYWHERE TO ENTER` and the status line are bone-white type at the
 * screen's edges, so they pin a bounding box to the full frame whatever the door
 * does — the box says "everything" on a correct frame and on a broken one alike.
 * The door is ~25 000 lit pixels against the type's few hundred, so where the lit
 * mass *is* moves with the door and the type barely perturbs it.
 *
 *     node evidence/a0-70-title-entrance/analyse-door.mjs <frames-dir>
 *
 * On a portrait phone the screen is ROTATED, so the physical offsets are printed
 * with their logical twins beside them: what the player sees as the bottom-right
 * is the physical bottom-LEFT, and only the logical column is comparable with the
 * desktop films.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node analyse-door.mjs <frames-dir>');
  process.exit(2);
}

/** Lit hull steel. The door's darkest body panel reads ~0x20252c and its frame
 *  ~0x6a7078; the starfield's brightest star is well under this on at least one
 *  channel, and the menu behind the door is darker still. */
const HULL = 0x55;

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.png'))
  .sort();

console.log(`# ${dir}`);
console.log(
  'frame'.padEnd(24) + 'hull px'.padStart(10) + '  hull box (x,y,w,h)'.padEnd(26) +
    'centroid'.padStart(16) + '   physical dx,dy' + '     logical dx,dy',
);

for (const file of files) {
  const png = PNG.sync.read(readFileSync(join(dir, file)));
  const { width, height, data } = png;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let hull = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < HULL || data[i + 1] < HULL || data[i + 2] < HULL) continue;
      hull++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    console.log(file.padEnd(24) + '0'.padStart(10) + '  (no hull — nothing drawn yet)');
    continue;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cx = sumX / hull;
  const cy = sumY / hull;
  const dx = cx - width / 2;
  const dy = cy - height / 2;
  // The +90° root rotation maps physical (px,py) → logical (py, physW − px), so a
  // physical centre offset (dx,dy) is a logical centre offset (dy, −dx).
  const box = `(${String(Math.round(minX)).padStart(5)},${String(Math.round(minY)).padStart(5)},${String(w).padStart(5)},${String(h).padStart(5)})`;
  console.log(
    file.padEnd(24) +
      String(hull).padStart(10) +
      '  ' + box.padEnd(24) +
      `(${cx.toFixed(1)},${cy.toFixed(1)})`.padStart(16) +
      `   dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`.padEnd(24) +
      `   dx=${dy.toFixed(1)} dy=${(-dx).toFixed(1)}`,
  );
}
