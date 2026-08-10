/**
 * evidence/a0-18-bloom-gone/census-orbs.mjs — a0-18, how much bloom a screenful holds. OWNER: Art Agent.
 *
 * "The bloom is present" is not yet an answer to *"the bloom orbs are gone, but
 * they are gone completely"*. What the developer is reporting is a PERCEPTUAL
 * quantity, so this counts it as one: on one screenful of the shipped build, how
 * many bloomed stars are there, how wide is each orb, and how far above the ground
 * does each of its rings actually sit.
 *
 * It works off each layer's own delta field — |A − A-without-that-layer|,
 * recomputed from the raw frozen frames — where every pixel belongs to exactly one
 * star layer and nothing else in the scene can contribute. Components are then
 * split by FOOTPRINT against the layer's authored radii (see the note at the
 * classification): a plain star cannot be wider than its own diameter, a bloomed
 * one carries a halo of 4.3x it.
 *
 * That the split lands on 17-18% of the stars in all three layers, with no
 * knowledge of `BLOOM.scatter` anywhere in this file, is the cross-check that the
 * classification is measuring the thing it claims to: the ratified scatter is
 * 0.18, and it was recovered from pixels alone.
 *
 * Deltas are reported over the ground the void is composited on, in luma /255, and
 * widths in CSS px (the frames are dpr 2, so device px are halved) — the units a
 * person looking at a monitor is in.
 *
 *   node evidence/a0-18-bloom-gone/census-orbs.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const DPR = 2;
const read = (p) => PNG.sync.read(readFileSync(p));

/** `STAR_LAYERS` (src/art/backdrop.ts), transcribed — the authored radii the
 *  footprint classification is calibrated against. Kept here rather than imported
 *  because this file reads PNGs, not TypeScript; `backdrop-bloom.test.ts` is what
 *  holds the source to these numbers. */
const SPEC = {
  deep: { minR: 0.45, maxR: 0.95 },
  mid: { minR: 0.7, maxR: 1.35 },
  near: { minR: 1.15, maxR: 2.2 },
};
const luma = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];

/**
 * The layer's delta field, recomputed from the two RAW frames rather than read off
 * the isolate plate — the plate is amplified ×14 and therefore clips at Δ18.2, and
 * clipping is the one thing that must not happen to a measurement of ring
 * brightness (it would silently cap every core and half the inner halos).
 */
function deltaField(a, b) {
  const n = a.width * a.height;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.abs(luma(a.data, i * 4) - luma(b.data, i * 4));
  return { d, width: a.width, height: a.height };
}

/** Connected components at Δ ≥ 1, with their distinct flat levels. */
function orbs(iso) {
  const n = iso.width * iso.height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const out = [];
  const at = (i) => iso.d[i];
  for (let i = 0; i < n; i++) {
    if (seen[i] || at(i) < 1) continue;
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    const px = [];
    while (top > 0) {
      const p = stack[--top];
      px.push(p);
      const x = p % iso.width;
      const y = (p - x) / iso.width;
      const push = (q) => {
        if (q >= 0 && q < n && !seen[q] && at(q) >= 1) {
          seen[q] = 1;
          stack[top++] = q;
        }
      };
      if (x > 0) push(p - 1);
      if (x < iso.width - 1) push(p + 1);
      if (y > 0) push(p - iso.width);
      if (y < iso.height - 1) push(p + iso.width);
    }
    // The flat levels, as a histogram. Levels holding fewer than 4 px are
    // antialiasing on a rim, not a ring — but NOT all of them are, so the ring
    // count is reported and is deliberately NOT used to decide what blooms: on an
    // unclipped delta field a plain star's own AA gradient can present three
    // levels. Counting bloom is the geometry read-back's job (probe-bloom.mjs
    // groups the submitted fills by centre and cannot be fooled by a rim); this
    // file's job is how WIDE and how BRIGHT what is there turns out to be.
    const hist = new Map();
    for (const p of px) {
      const k = Math.round(at(p));
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    const rings = [...hist.entries()].filter(([, c]) => c >= 4).map(([v]) => v).sort((a, b) => a - b);
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const p of px) {
      const x = p % iso.width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    out.push({
      area: px.length,
      widthCss: (x1 - x0 + 1) / DPR,
      rings,
      ringCount: rings.length,
      /** The brightest ring that is NOT the core — the halo's own contribution. */
      haloPeak: rings.length > 1 ? rings[rings.length - 2] : 0,
    });
  }
  return out;
}

const table = {};
for (const label of ['before-111db86', 'after-ebdae99']) {
  table[label] = {};
  for (const map of ['octagon', 'line']) {
    const rows = [];
    let totalStars = 0;
    let totalBloomed = 0;
    let perceptible = 0;
    for (const layer of ['near', 'mid', 'deep']) {
      const list = orbs(
        deltaField(
          read(join(FRAMES, label, `${map}-A-frozen.png`)),
          read(join(FRAMES, label, `${map}-no-${layer}.png`)),
        ),
      );
      // Classified by FOOTPRINT against the layer's own authored numbers, which is
      // the one threshold in this file that is not arbitrary. A plain star cannot
      // be wider than `2 x maxR` plus a pixel of antialiasing either side; a
      // bloomed one carries an outer halo of `4.3 x r`, so its narrowest possible
      // footprint is `2 x 4.3 x minR`. For near and mid those ranges do not
      // overlap at all (4.4+2 against 9.9; 2.7+2 against 6.0). For DEEP they very
      // nearly touch — 1.9+2 = 3.9 against 3.87 — so the deep row's split is the
      // one number here that is soft, and it is called out rather than smoothed.
      const spec = SPEC[layer];
      const cut = 2 * spec.maxR + 2;
      const bloomed = list.filter((o) => o.widthCss > cut);
      const plain = list.filter((o) => o.widthCss <= cut);
      // "Perceptible" is a stated threshold, not a judgement dressed as a
      // measurement: the halo's own brightest ring clearing Δ10/255 over the
      // ground, which is about the step a flat grey patch needs to be seen against
      // near-black on a normal monitor. Argue with the 10; the counts are reported
      // either way.
      const seen = bloomed.filter((o) => o.haloPeak >= 10);
      perceptible += seen.length;
      totalStars += list.length;
      totalBloomed += bloomed.length;
      const widths = bloomed.map((o) => o.widthCss).sort((a, b) => a - b);
      rows.push({
        layer,
        starsOnScreen: list.length,
        bloomedOnScreen: bloomed.length,
        plainOnScreen: plain.length,
        perceptibleOrbs: seen.length,
        orbWidthCssMedian: widths.length ? widths[Math.floor(widths.length / 2)] : null,
        orbWidthCssMax: widths.length ? widths[widths.length - 1] : null,
        // The rings of the biggest orb in this layer, ground-relative.
        biggestOrbRings: bloomed.length
          ? bloomed.reduce((a, b) => (b.area > a.area ? b : a)).rings
          : null,
      });
    }
    table[label][map] = { rows, totalStars, totalBloomed, perceptible };
    console.log(`\n── ${label} / ${map} — ONE SCREENFUL, 1440x900 CSS at dpr ${DPR}`);
    console.log('   layer  stars  bloomed  plain  perceptible  orb width CSS px (median/max)  rings of the biggest (Δluma/255, ground→core)');
    for (const r of rows) {
      console.log(
        `   ${r.layer.padEnd(6)} ${String(r.starsOnScreen).padStart(5)} ${String(r.bloomedOnScreen).padStart(8)}` +
          ` ${String(r.plainOnScreen).padStart(6)} ${String(r.perceptibleOrbs).padStart(12)}` +
          `  ${String(r.orbWidthCssMedian).padStart(6)} / ${String(r.orbWidthCssMax).padEnd(6)}` +
          `      ${r.biggestOrbRings ? r.biggestOrbRings.join(' → ') : '—'}`,
      );
    }
    console.log(
      `   TOTAL  ${String(totalStars).padStart(5)} ${String(totalBloomed).padStart(8)}` +
        ` ${String(totalStars - totalBloomed).padStart(6)} ${String(perceptible).padStart(12)}` +
        `   ← ${perceptible} orbs a person could actually point at, of ${totalBloomed} blooming`,
    );
  }
}

writeFileSync(join(HERE, 'orb-census.json'), `${JSON.stringify(table, null, 2)}\n`);
console.log(`\nwrote ${join(HERE, 'orb-census.json')}`);
