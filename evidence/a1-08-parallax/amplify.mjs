/**
 * evidence/a1-08-parallax/amplify.mjs — a1-08, a looking aid. OWNER: QA Manager.
 *
 * The isolated layers paint at single-digit luma over the canvas clear colour
 * (a0-07 chose "subtle" and a1-07 measured deepEmber's peak at 7.3/255 against
 * the ground). Nobody can honestly attest to a frame they cannot see, so this
 * stretches one to a viewable range — per-image: subtract the floor, scale the
 * remainder to full range. It is a MAGNIFYING GLASS, not a measurement: every
 * number in this round is computed from the RAW frames.
 *
 *   node evidence/a1-08-parallax/amplify.mjs <in.png> <out.png> [gain]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , inPath, outPath, gainArg] = process.argv;
const src = PNG.sync.read(readFileSync(inPath));

let lo = 255;
let hi = 0;
for (let i = 0; i < src.data.length; i += 4) {
  for (let c = 0; c < 3; c++) {
    const v = src.data[i + c];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
}
const gain = gainArg ? Number(gainArg) : 255 / Math.max(1, hi - lo);

const out = new PNG({ width: src.width, height: src.height });
for (let i = 0; i < src.data.length; i += 4) {
  for (let c = 0; c < 3; c++) out.data[i + c] = Math.max(0, Math.min(255, Math.round((src.data[i + c] - lo) * gain)));
  out.data[i + 3] = 255;
}
writeFileSync(outPath, PNG.sync.write(out));
console.log(`${inPath} -> ${outPath}   floor=${lo} peak=${hi} gain=${gain.toFixed(2)}×`);
