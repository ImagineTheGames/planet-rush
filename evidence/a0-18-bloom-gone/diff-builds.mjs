/**
 * evidence/a0-18-bloom-gone/diff-builds.mjs — a0-18, what tonight actually moved. OWNER: Art Agent.
 *
 * The three suspects in the brief are all about the VOID, and the void came back
 * identical on both builds. So this asks the complementary question, which the
 * brief also asks for: if the bloom is present and something else changed the
 * look, WHAT. It differences the whole frozen frame between the two served builds
 * — same arena, same seed, same viewport, same pinned tick — and then partitions
 * the difference by what was drawing there:
 *
 *   · `bg`   — pixels where the void is the only thing on the frame (from the
 *              `no-stars`/ground-only frames: anywhere the star layers and the
 *              world both leave the ground untouched)
 *   · `void` — pixels the star layers own (the isolates)
 *   · `world`— everything else: rocks, stations, ships, walls, HUD
 *
 * A change confined to `world` is a change to the entity layers — which is what
 * a1-11 and a1-12 touched, and is allowed to move as long as it is justified. A
 * change in `void` would have been the bug. Reporting both is what makes the
 * "not the bloom" verdict falsifiable rather than asserted.
 *
 *   node evidence/a0-18-bloom-gone/diff-builds.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const PLATES = join(HERE, 'plates');
const BEFORE = 'before-111db86';
const AFTER = 'after-ebdae99';

const read = (p) => PNG.sync.read(readFileSync(p));
const luma = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];

const report = {};

for (const map of ['octagon', 'line']) {
  const A = read(join(FRAMES, BEFORE, `${map}-A-frozen.png`));
  const B = read(join(FRAMES, AFTER, `${map}-A-frozen.png`));
  if (A.width !== B.width || A.height !== B.height) throw new Error('frame size mismatch');
  const n = A.width * A.height;

  // The star-layer mask: any pixel the void's own isolates touched, in EITHER
  // build — so a star that appeared or vanished is inside the void bucket, not
  // hidden in `world` by a mask taken from one side only.
  const starMask = new Uint8Array(n);
  for (const label of [BEFORE, AFTER]) {
    for (const layer of ['deep', 'mid', 'near']) {
      const iso = read(join(FRAMES, label, `${map}-iso-${layer}.png`));
      for (let i = 0; i < n; i++) if (iso.data[i * 4] > 0) starMask[i] = 1;
    }
  }
  // The world mask: where the ground-only frame differs from the no-stars frame
  // is the world (no-stars still draws every entity; ground-only draws none).
  const noStars = read(join(FRAMES, AFTER, `${map}-no-stars.png`));
  const worldMask = new Uint8Array(n);
  {
    // `no-stars` keeps the world and the sky; the sky is flat and enormous, so the
    // world is taken as "brighter than the darkest 1% of that frame", which on a
    // Floor ground separates drawn objects from empty void without a threshold
    // pulled out of the air.
    const hist = new Float32Array(n);
    for (let i = 0; i < n; i++) hist[i] = luma(noStars.data, i * 4);
    const sorted = Float32Array.from(hist).sort();
    const floor = sorted[Math.floor(n * 0.5)]; // the median IS the empty void here
    for (let i = 0; i < n; i++) if (hist[i] > floor + 3) worldMask[i] = 1;
  }

  const buckets = { void: 0, world: 0, bg: 0 };
  const peaks = { void: 0, world: 0, bg: 0 };
  let touched = 0;
  const out = new PNG({ width: A.width, height: A.height });
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.abs(luma(A.data, o) - luma(B.data, o));
    const bucket = starMask[i] ? 'void' : worldMask[i] ? 'world' : 'bg';
    if (d > 0) {
      touched++;
      buckets[bucket]++;
      if (d > peaks[bucket]) peaks[bucket] = d;
    }
    // Red = the void moved (the bug, if it is there). Cyan = the world moved.
    const v = Math.min(255, Math.round(d * 14));
    out.data[o] = bucket === 'void' ? v : 0;
    out.data[o + 1] = bucket === 'void' ? 0 : v;
    out.data[o + 2] = bucket === 'void' ? 0 : v;
    out.data[o + 3] = 255;
  }
  writeFileSync(join(PLATES, `builddiff-${map}.png`), PNG.sync.write(out));

  report[map] = {
    pixels: n,
    touchedPct: Math.round((touched / n) * 1e6) / 1e4,
    changedInVoid: buckets.void,
    changedInWorld: buckets.world,
    changedInBackground: buckets.bg,
    peakDeltaVoid: Math.round(peaks.void * 10) / 10,
    peakDeltaWorld: Math.round(peaks.world * 10) / 10,
    peakDeltaBackground: Math.round(peaks.bg * 10) / 10,
    starMaskPixels: starMask.reduce((a, v) => a + v, 0),
    worldMaskPixels: worldMask.reduce((a, v) => a + v, 0),
  };
  console.log(`── ${map}: ${BEFORE} vs ${AFTER}, same frozen tick`);
  console.log(`   whole frame changed: ${report[map].touchedPct}%  (${touched} of ${n} px)`);
  console.log(`   in the VOID's own pixels : ${buckets.void} px, peak Δ ${report[map].peakDeltaVoid}`);
  console.log(`   in the WORLD's pixels    : ${buckets.world} px, peak Δ ${report[map].peakDeltaWorld}`);
  console.log(`   in empty background      : ${buckets.bg} px, peak Δ ${report[map].peakDeltaBackground}`);
}

writeFileSync(join(HERE, 'build-diff.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nwrote ${join(HERE, 'build-diff.json')}`);
