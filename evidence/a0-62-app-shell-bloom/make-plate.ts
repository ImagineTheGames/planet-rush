/**
 * evidence/a0-62-app-shell-bloom/make-plate.ts — the halo, at a size a person
 * can see. OWNER: Art Agent.
 *
 * A bloom is Δ30 of luma at its core over a Δ9 ground, spread over 27 px; at
 * 1:1 in a 1280x800 plate two builds either side of a total bloom loss read as
 * identical (a0-18 said exactly this). So the review plate is a crop around one
 * named star, nearest-neighbour 4x, from each frame side by side.
 *
 *   npx vite-node evidence/a0-62-app-shell-bloom/make-plate.ts
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMES = join(dirname(fileURLToPath(import.meta.url)), 'frames');
const CROP = 88; // css px around the star — a bloom is 55 across
const ZOOM = 4;
const GAP = 8;

/** The star the audit reports on, and one of its neighbours. */
const STARS = [
  { x: 712, y: 673 },
  { x: 596, y: 593 },
];

const panels: { file: string; dpr: number }[] = [
  { file: 'app-dpr1', dpr: 1 },
  { file: 'fixed-dpr1', dpr: 1 },
  { file: 'app-dpr2', dpr: 2 },
  { file: 'fixed-dpr2', dpr: 2 },
];

for (const star of STARS) {
  const w = panels.length * (CROP * ZOOM + GAP) - GAP;
  const h = CROP * ZOOM;
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  panels.forEach((p, i) => {
    const img = PNG.sync.read(readFileSync(join(FRAMES, `${p.file}.png`)));
    const ox = i * (CROP * ZOOM + GAP);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < CROP * ZOOM; x++) {
        const sx = Math.round((star.x - CROP / 2 + x / ZOOM) * p.dpr);
        const sy = Math.round((star.y - CROP / 2 + y / ZOOM) * p.dpr);
        const si = (sy * img.width + sx) * 4;
        const di = (y * w + ox + x) * 4;
        for (let c = 0; c < 4; c++) out.data[di + c] = img.data[si + c] ?? 0;
      }
    }
  });
  const name = `plate-star-${star.x}-${star.y}.png`;
  writeFileSync(join(FRAMES, name), PNG.sync.write(out));
  console.log(`${name}: ${panels.map((p) => p.file).join(' | ')} (${CROP}px crop at ${ZOOM}x)`);
}
