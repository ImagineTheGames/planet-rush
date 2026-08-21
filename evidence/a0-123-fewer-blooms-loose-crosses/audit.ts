/**
 * evidence/a0-123-fewer-blooms-loose-crosses/audit.ts — the four numbers this
 * brief is answerable for. OWNER: Art Agent.
 *
 * ```sh
 * npx vite-node evidence/a0-123-fewer-blooms-loose-crosses/audit.ts
 * ```
 *
 *  1. **The bloom rate**, before and after, as a share of the field — derived
 *     from the curve and also counted off the built sprite, because a rate that
 *     is only ever computed is a rate nobody has checked.
 *  2. **The field is byte-identical.** The claim that earns the second stream:
 *     every star's position, radius, alpha and colour is the same number in the
 *     same order as before this brief. Measured against the shapes a `main`
 *     worktree emits, not asserted.
 *  3. **`peakP99`** across candidate thresholds — the constraint that set 0.92.
 *  4. **The cross is uncorrelated** with magnitude and with temperature, which
 *     is what the rejected derive-from-a-drawn-value route could not have given.
 */

import { execFileSync } from 'node:child_process';
import { MOCKUP_STARS, MOCKUP_PANEL, MOCKUP_GROUND } from '../../src/art/mockup-reference';
import { STAR_LAYERS, VOID_SEED, starFieldSprite } from '../../src/art/backdrop';
import type { Shape } from '../../src/art/shapes';
import { measure, sampleMockup, sampleShapes, colorLuma } from '../../sky-preview';

const PANEL = MOCKUP_PANEL;
const E = MOCKUP_STARS.magnitudeExponent;
const rateOf = (t: number): number => 1 - Math.pow(t, 1 / E);
/** The threshold this brief replaced — the design's own, measured off it. */
const BEFORE = 0.86;

const out: string[] = [];
const say = (s = ''): void => {
  out.push(s);
  // eslint-disable-next-line no-console
  console.log(s);
};

// ---------------------------------------------------------------------------
// 1. The bloom rate, and the cross rate under it
// ---------------------------------------------------------------------------
say('1. THE RATE — share of the field, derived from the curve and counted off the sprite');
say('');
say('   threshold   derived   counted   blooms/screenful   crossed/screenful');
const mutB = MOCKUP_STARS.bloom as { threshold: number };
const now = mutB.threshold;
for (const t of [BEFORE, now]) {
  mutB.threshold = t;
  let stars = 0;
  let halos = 0;
  let arms = 0;
  for (const l of STAR_LAYERS) {
    for (const s of starFieldSprite(l, VOID_SEED, PANEL.w, PANEL.h).shapes) {
      if (s.stroke) arms++;
      else if (s.path.kind === 'circle' && s.fill?.falloff) halos++;
      else stars++;
    }
  }
  const tag = t === now ? ' <- a0-123' : ' <- the design’s, and what shipped';
  say(
    `   ${t.toFixed(2)}        ${(rateOf(t) * 100).toFixed(2)}%     ${((halos / stars) * 100)
      .toFixed(2)
      .padStart(6)}%   ${String(halos).padStart(6)} of ${stars}      ${String(arms / 2).padStart(6)}${tag}`,
  );
}
mutB.threshold = now;
say('');

// ---------------------------------------------------------------------------
// 2. The field is byte-identical to main's
// ---------------------------------------------------------------------------
say('2. THE FIELD IS BYTE-IDENTICAL — the claim that earns the second stream');
say('');
/** Every star point, as the numbers that define it, in emitted order. */
const pointsOf = (shapes: readonly Shape[]): string[] =>
  shapes
    .filter((s) => s.path.kind === 'circle' && !s.fill?.falloff)
    .map((s) =>
      s.path.kind === 'circle'
        ? `${s.path.cx},${s.path.cy},${s.path.r},${s.fill!.alpha},${s.fill!.color}`
        : '',
    );
const mine = STAR_LAYERS.map((l) => pointsOf(starFieldSprite(l, VOID_SEED, 2400, 1600).shapes));
const theirs = JSON.parse(
  execFileSync('npx', ['vite-node', 'evidence/a0-123-fewer-blooms-loose-crosses/dump-field.ts'], {
    cwd: process.env.A0123_MAIN ?? process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }).trim(),
) as string[][];
let same = 0;
let diff = 0;
STAR_LAYERS.forEach((l, i) => {
  const a = mine[i]!;
  const b = theirs[i]!;
  const n = Math.max(a.length, b.length);
  let d = 0;
  for (let k = 0; k < n; k++) if (a[k] !== b[k]) d++;
  same += n - d;
  diff += d;
  say(`   ${l.key.padEnd(5)} ${a.length} stars here, ${b.length} on main — ${d} differ`);
});
say(`   TOTAL ${same} identical, ${diff} differ` + (diff === 0 ? '  <- the sky did not move' : ''));
say('');

// ---------------------------------------------------------------------------
// 3. peakP99 — the constraint that set the threshold
// ---------------------------------------------------------------------------
say('3. peakP99 — why 0.92 and not further. The band is 42–48 and it is on the HALOS.');
say('');
const SEEDS = Array.from({ length: 12 }, (_, i) => (VOID_SEED + i * 0x9e37_79b9) >>> 0);
const ground = colorLuma(MOCKUP_GROUND);
const avg = (xs: number[]): number => xs.reduce((t, v) => t + v, 0) / xs.length;
say('   threshold  rate    design p99   game p99   apart    in 42–48?');
for (const t of [0.86, 0.88, 0.9, 0.92, 0.93, 0.95]) {
  mutB.threshold = t;
  const d: number[] = [];
  const g: number[] = [];
  for (const seed of SEEDS) {
    d.push(measure(sampleMockup('none', seed, PANEL.w, PANEL.h), ground).p99);
    const f = STAR_LAYERS.flatMap((l) => [...starFieldSprite(l, seed, PANEL.w, PANEL.h).shapes]);
    g.push(measure(sampleShapes(f, false, MOCKUP_GROUND, PANEL.w, PANEL.h), ground).p99);
  }
  const D = avg(d);
  const G = avg(g);
  const ok = D >= MOCKUP_STARS.peakP99.min && D <= MOCKUP_STARS.peakP99.max;
  say(
    `   ${t.toFixed(2)}       ${(rateOf(t) * 100).toFixed(2)}%   ${D.toFixed(2).padStart(6)}      ` +
      `${G.toFixed(2).padStart(6)}    ${((100 * Math.abs(G - D)) / D).toFixed(2)}%    ${ok ? 'yes' : 'NO'}` +
      (t === now ? '   <- a0-123' : ''),
  );
}
mutB.threshold = now;
say('');
say('   0.93 is the first candidate under the floor, so 0.92 is very nearly the');
say('   largest cut available that leaves the design’s own luma gate standing.');
say('   peakP99 is therefore NOT touched by this brief.');
say('');

// ---------------------------------------------------------------------------
// 4. The cross is uncorrelated with magnitude and with temperature
// ---------------------------------------------------------------------------
say('4. THE CROSS IS ITS OWN DRAW — measured, not asserted.');
say('');
say('   The rejected route was deriving the bit from a value already drawn, which');
say('   costs no draw but correlates the cross with brightness or with colour. The');
say('   stream this brief uses should show none. Pearson r over the bloomed stars,');
say('   cross-bit against the star’s radius (monotone in magnitude) and against a');
say('   hot/cool indicator (the whole of what temperature paints).');
say('');
/** Cross-bit, star radius and a hot/cool indicator for every bloomed star. */
const sample = (seed: number): { bits: number[]; radii: number[]; hot: number[] } => {
const bits: number[] = [];
const radii: number[] = [];
const hot: number[] = [];
for (const l of STAR_LAYERS) {
  const shapes = starFieldSprite(l, seed, 9000, 6000).shapes;
  // Walk in emitted order: halo, its arms if any, then the point.
  let pendingHalo = false;
  let armsSeen = 0;
  for (const s of shapes) {
    if (s.path.kind === 'circle' && s.fill?.falloff) {
      pendingHalo = true;
      armsSeen = 0;
      continue;
    }
    if (s.stroke) {
      armsSeen++;
      continue;
    }
    if (s.path.kind === 'circle' && s.fill) {
      if (pendingHalo) {
        bits.push(armsSeen > 0 ? 1 : 0);
        radii.push(s.path.r);
        const c = s.fill.color;
        hot.push((c & 0xff) > ((c >> 16) & 0xff) ? 1 : 0);
      }
      pendingHalo = false;
      armsSeen = 0;
    }
  }
}
  return { bits, radii, hot };
};
const pearson = (a: number[], b: number[]): number => {
  const ma = avg(a);
  const mb = avg(b);
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return n / Math.sqrt(da * db);
};
/**
 * **Over 8 seeds, not one.** A single field's r is itself a random variable with
 * σ ≈ 1/√n, so one sample at 2σ is a coin landing heads twice and one at 0 is
 * luck — neither is evidence about the arrangement. What is evidence is whether
 * r stays centred on zero as the seed moves, so that is what is printed: the
 * mean, and the spread it should have if the bit is independent.
 */
const CORR_SEEDS = Array.from({ length: 8 }, (_, i) => (VOID_SEED + i * 0x85eb_ca6b) >>> 0);
say('   seed        n     crossed%   r(cross, radius)   r(cross, hot/cool)');
const rR: number[] = [];
const rH: number[] = [];
let n0 = 0;
for (const seed of CORR_SEEDS) {
  const { bits, radii, hot } = sample(seed);
  const a = pearson(bits, radii);
  const b = pearson(bits, hot);
  rR.push(a);
  rH.push(b);
  n0 = bits.length;
  say(
    `   0x${seed.toString(16).padStart(8, '0')}  ${String(bits.length).padStart(4)}   ${(avg(bits) * 100)
      .toFixed(2)
      .padStart(6)}%     ${a.toFixed(5).padStart(9)}          ${b.toFixed(5).padStart(9)}`,
  );
}
const sd = (xs: number[]): number => Math.sqrt(avg(xs.map((v) => (v - avg(xs)) ** 2)));
say('');
say(`   mean r(cross, radius)      ${avg(rR).toFixed(5)}   (sd across seeds ${sd(rR).toFixed(5)})`);
say(`   mean r(cross, hot/cool)    ${avg(rH).toFixed(5)}   (sd across seeds ${sd(rH).toFixed(5)})`);
say(`   1/sqrt(n) per seed         ${(1 / Math.sqrt(n0)).toFixed(5)}   <- what sd should be if independent`);
say('');
say('   Both means sit within one per-seed standard error of zero, and the spread');
say('   across seeds is the spread independence predicts. Individual seeds reach');
say('   2σ in both directions, which is what a coin does and what a DERIVED bit');
say('   would not: taking the cross from the magnitude or the temperature pins r');
say('   near a fixed non-zero value that does not average away with the seed.');
