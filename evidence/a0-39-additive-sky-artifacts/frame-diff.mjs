/**
 * evidence/a0-39-additive-sky-artifacts/frame-diff.mjs — which frames a0-39
 * moved, and by how much. OWNER: Art Agent.
 *
 * The brief's hard constraint is a *split*: the four reported skies have to
 * change and the two the developer found correct have to not. That is a pixel
 * question, so it gets a pixel answer — `before/<map>.png` against
 * `after/<map>.png`, per map, as the fraction of pixels that moved at all and
 * the largest single-channel move.
 *
 *   node evidence/a0-39-additive-sky-artifacts/frame-diff.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPS = [
  ['octagon', 'none'],
  ['compass', 'coalsack'],
  ['oval', 'plasmaReef'],
  ['diamond', 'patinaDrift'],
  ['line', 'deepEmber'],
  ['crescents', 'ironVeil'],
];

for (const [map, sky] of MAPS) {
  const read = (label) =>
    PNG.sync.read(readFileSync(join(HERE, 'frames', label, `${map}-${sky}.png`)));
  const a = read('before');
  const b = read('after');
  let moved = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > 0) {
      moved++;
      sum += d;
      if (d > max) max = d;
    }
  }
  const px = a.data.length / 4;
  console.log(
    `${map.padEnd(10)} ${sky.padEnd(12)} moved ${((100 * moved) / px).toFixed(1).padStart(5)}% of pixels` +
      `  max Δ ${String(max).padStart(3)} codes  mean Δ where moved ${moved ? (sum / moved).toFixed(2) : '0.00'}`,
  );
}
