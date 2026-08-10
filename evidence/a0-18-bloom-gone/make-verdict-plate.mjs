/**
 * evidence/a0-18-bloom-gone/make-verdict-plate.mjs — a0-18, the one plate. OWNER: Art Agent.
 *
 * The whole round in one image. A 96×96 device-pixel window of the frozen default
 * arena, cut identically out of both served builds and shown at 6× nearest
 * neighbour (no resample, no amplification — this is the shipped frame's own
 * pixels): a bloomed `near` star, core plus two halo rings, with a rock's rim
 * entering at the left.
 *
 * Left is `111db86` (= `ecc1496^`, before a1-11's pooling and a1-12's cull), right
 * is `ebdae99` (after, the served build the developer is playing). The ROCK RIM is
 * different between them — a1-11 re-baked the entity looks, which is what that
 * brief was for. The ORB IS NOT: every differing pixel in this window lies in the
 * left 168 columns, and the nearest one to the star is 20.2 device px away.
 *
 * Third panel: the two windows differenced and amplified ×6, so where they differ
 * is not a claim but a shape — the rock's edge, lit; the star, black.
 *
 *   node evidence/a0-18-bloom-gone/make-verdict-plate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const PLATES = join(HERE, 'plates');
const read = (p) => PNG.sync.read(readFileSync(p));

/** The biggest bloomed `near` star on the frozen octagon — the centroid
 *  find-orbs.mjs reports, restated so this plate is aimed reproducibly. */
const ORB = { x: 778, y: 708 };
const SIZE = 96;
const K = 6;
const GUTTER = 8;

function window_(src) {
  const x = ORB.x - SIZE / 2;
  const y = ORB.y - SIZE / 2;
  const out = new PNG({ width: SIZE, height: SIZE });
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const s = ((y + j) * src.width + (x + i)) * 4;
      const d = (j * SIZE + i) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

const before = window_(read(join(FRAMES, 'before-111db86', 'octagon-A-frozen.png')));
const after = window_(read(join(FRAMES, 'after-ebdae99', 'octagon-A-frozen.png')));

/** |before − after|, ×6. Plasma-cyan so it cannot be mistaken for frame content. */
const diff = new PNG({ width: SIZE, height: SIZE });
for (let i = 0; i < SIZE * SIZE; i++) {
  const o = i * 4;
  const d =
    Math.abs(before.data[o] - after.data[o]) +
    Math.abs(before.data[o + 1] - after.data[o + 1]) +
    Math.abs(before.data[o + 2] - after.data[o + 2]);
  const v = Math.min(255, Math.round((d / 3) * 6));
  diff.data[o] = Math.round(v * 0.3);
  diff.data[o + 1] = Math.round(v * 0.76);
  diff.data[o + 2] = v;
  diff.data[o + 3] = 255;
}

const panels = [before, after, diff];
const W = panels.length * SIZE * K + (panels.length - 1) * GUTTER;
const H = SIZE * K;
const out = new PNG({ width: W, height: H });
for (let i = 0; i < out.data.length; i += 4) {
  out.data[i] = 0x0d; // Vacuum, for the gutters
  out.data[i + 1] = 0x10;
  out.data[i + 2] = 0x15;
  out.data[i + 3] = 255;
}
panels.forEach((p, n) => {
  const ox = n * (SIZE * K + GUTTER);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < SIZE * K; i++) {
      const s = (Math.floor(j / K) * SIZE + Math.floor(i / K)) * 4;
      const d = (j * W + (ox + i)) * 4;
      out.data[d] = p.data[s];
      out.data[d + 1] = p.data[s + 1];
      out.data[d + 2] = p.data[s + 2];
    }
  }
});

const path = join(PLATES, 'verdict-the-orb-did-not-move.png');
writeFileSync(path, PNG.sync.write(out));
console.log(`wrote ${path}  ${W}x${H}`);
console.log('   left  111db86 (ecc1496^, before the perf chain)');
console.log('   mid   ebdae99 (after — the build under report)');
console.log('   right |left - right| x6: the rock rim, lit; the orb, black');
