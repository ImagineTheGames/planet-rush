/**
 * evidence/a0-44-star-bloom-radius/audit.ts — **the arithmetic behind a0-44.**
 *
 * Run: `npx vite-node evidence/a0-44-star-bloom-radius/audit.ts`
 *
 * Everything the brief asserts about the star bloom, computed rather than
 * asserted: the halo/spike inequality both ways, the two falloff profiles (the
 * design's three gradient stops against the IR's `falloffProfile`), and the
 * design instrument's p99 for the field under each candidate rule, so the
 * effect of the radius and of the absolute peak alpha can be read apart.
 *
 * It carries its OWN sampler rather than importing `sky-preview.ts`'s, because
 * every variant it prices has to be measured against a `MOCKUP_STARS` that no
 * longer exists (or does not yet). Same grid, same luma, same ground.
 */

import { MOCKUP_GROUND, MOCKUP_PANEL, MOCKUP_STARS, starAlpha, starMagnitude, starRadius, starRampColor } from '../../src/art/mockup-reference';
import { falloffProfile } from '../../src/art/shapes';
import { VOID_SEED } from '../../src/art/backdrop';
import { mulberry32 } from '../../src/shared/types';

const SAMPLE = { cols: 320, rows: 180 };

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function unpack(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

/** The design preview's own halo gradient, normalised to its peak: three stops,
 *  linearly interpolated, which is what `createRadialGradient` paints. */
export function designHaloProfile(t: number): number {
  const mid = 0.13 / 0.42; // the 0.35 stop, as a fraction of the peak stop
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  if (t <= 0.35) return 1 + (t / 0.35) * (mid - 1);
  return mid * (1 - (t - 0.35) / 0.65);
}

/** ∫ profile over the disc, as a fraction of a flat disc — the "optical mass". */
function mass(f: (t: number) => number): number {
  const n = 20000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    sum += f(t) * 2 * t;
  }
  return sum / n;
}

interface Rule {
  readonly label: string;
  readonly haloRadius: number;
  /** `abs` = peak alpha is 0.42×intensity outright; `frac` = × the star's own. */
  readonly haloPeak: 'abs' | 'frac';
  readonly profile: (t: number) => number;
  readonly spikeLength: number;
}

/** The design instrument (320×180 point samples) over one panel of stars. */
function measureField(rule: Rule): { p99: number; peak: number; mean: number; lift: number; haloCover: number } {
  const { w, h } = MOCKUP_PANEL;
  const rng = mulberry32((VOID_SEED ^ 0x57a25) >>> 0);
  const count = Math.round(MOCKUP_STARS.count);
  const stars: { x: number; y: number; r: number; alpha: number; halo: number; haloAlpha: number; color: number }[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rng.next() - 0.5) * w;
    const y = (rng.next() - 0.5) * h;
    const mag = starMagnitude(rng.next());
    const r = starRadius(mag);
    const alpha = starAlpha(mag);
    const blooms = mag > MOCKUP_STARS.bloom.threshold;
    stars.push({
      x,
      y,
      r,
      alpha,
      halo: blooms ? r * rule.haloRadius : 0,
      haloAlpha:
        rule.haloPeak === 'abs' ? 0.42 * MOCKUP_STARS.bloom.intensity : alpha * MOCKUP_STARS.bloom.intensity,
      color: starRampColor(mag),
    });
  }
  const [gr, gg, gb] = unpack(MOCKUP_GROUND);
  const out = new Float64Array(SAMPLE.cols * SAMPLE.rows);
  let covered = 0;
  for (let row = 0; row < SAMPLE.rows; row++) {
    const y = ((row + 0.5) / SAMPLE.rows - 0.5) * h;
    for (let col = 0; col < SAMPLE.cols; col++) {
      const x = ((col + 0.5) / SAMPLE.cols - 0.5) * w;
      let r = gr;
      let g = gg;
      let b = gb;
      let inHalo = false;
      for (const st of stars) {
        const d = Math.hypot(x - st.x, y - st.y);
        let a = 0;
        if (d <= st.r) a = st.alpha;
        else if (st.halo > 0 && d <= st.halo) {
          a = st.haloAlpha * rule.profile(d / st.halo);
          inHalo = true;
        }
        if (a <= 0) continue;
        const [sr, sg, sb] = unpack(st.color);
        r = r * (1 - a) + sr * a;
        g = g * (1 - a) + sg * a;
        b = b * (1 - a) + sb * a;
      }
      if (inHalo) covered++;
      out[row * SAMPLE.cols + col] = luma(r, g, b);
    }
  }
  const sorted = Float64Array.from(out).sort();
  const p99 = sorted[Math.min(out.length - 1, Math.floor(out.length * 0.99))]!;
  let sum = 0;
  let peak = 0;
  for (const v of out) {
    sum += v;
    if (v > peak) peak = v;
  }
  const ground = luma(gr, gg, gb);
  const mean = sum / out.length;
  return {
    p99: Math.round(p99 * 100) / 100,
    peak: Math.round(peak * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    lift: Math.round((mean - ground) * 100) / 100,
    haloCover: Math.round((covered / out.length) * 1000) / 10,
  };
}

const inten = MOCKUP_STARS.bloom.intensity;
const designHalo = 5 + 13 * inten;
const designSpike = designHalo * 0.62;

const lines: string[] = [];
const say = (s = ''): void => {
  lines.push(s);
  // eslint-disable-next-line no-console
  console.log(s);
};

say('a0-44 — the star bloom is smaller than its own spikes');
say('====================================================');
say('');
say('1. the inequality the brief is about');
say(`   design   halo ${designHalo.toFixed(2)} r   spike ${designSpike.toFixed(2)} r   halo/spike ${(designHalo / designSpike).toFixed(3)}`);
say(`   shipped  halo 4.30 r   spike 5.20 r   halo/spike ${(4.3 / 5.2).toFixed(3)}   ← the cross is OUTSIDE the glow`);
say(`   halo area, design ÷ shipped = ${((designHalo / 4.3) ** 2).toFixed(2)}×`);
say('');
say('2. the halo peak alpha');
say(`   design   0.42 × ${inten} = ${(0.42 * inten).toFixed(4)}, absolute, on every bloomed star`);
const aLo = starAlpha(MOCKUP_STARS.bloom.threshold);
const aHi = starAlpha(1);
say(`   shipped  starAlpha × ${inten} over the bloomed population (mag ${MOCKUP_STARS.bloom.threshold}–1,`);
say(`            alpha ${aLo.toFixed(4)}–${aHi.toFixed(4)}) = ${(aLo * inten).toFixed(4)}–${(aHi * inten).toFixed(4)}`);
say('');
say('3. the falloff shape — the design’s 0.35 stop against falloffProfile');
say('   t       design   falloffProfile');
for (const t of [0, 0.1, 0.2, 0.35, 0.5, 0.62, 0.75, 0.9, 1]) {
  say(`   ${t.toFixed(2)}    ${designHaloProfile(t).toFixed(4)}   ${falloffProfile(t).toFixed(4)}`);
}
say(`   optical mass (fraction of a flat disc): design ${mass(designHaloProfile).toFixed(4)}  falloffProfile ${mass(falloffProfile).toFixed(4)}`);
say(`   → falloffProfile carries ${(mass(falloffProfile) / mass(designHaloProfile)).toFixed(2)}× the design’s light in the same disc`);
say(`   equal-mass falloffProfile radius = ${(designHalo * Math.sqrt(mass(designHaloProfile) / mass(falloffProfile))).toFixed(2)} r`);
say('');
say('4. the design instrument, one panel of stars (p99 is the design’s 46–53)');
const RULES: Rule[] = [
  { label: 'shipped (4.3 r, frac alpha, falloffProfile)', haloRadius: 4.3, haloPeak: 'frac', profile: falloffProfile, spikeLength: 5.2 },
  { label: 'radius only (11.24 r, frac alpha)', haloRadius: designHalo, haloPeak: 'frac', profile: falloffProfile, spikeLength: designSpike },
  { label: 'a0-44 (11.24 r, absolute 0.2016, falloffProfile)', haloRadius: designHalo, haloPeak: 'abs', profile: falloffProfile, spikeLength: designSpike },
  { label: 'the design itself (11.24 r, absolute, design stops)', haloRadius: designHalo, haloPeak: 'abs', profile: designHaloProfile, spikeLength: designSpike },
];
say('   rule                                                    p99    peak    lift   halo cover');
for (const rule of RULES) {
  const m = measureField(rule);
  say(
    `   ${rule.label.padEnd(54)} ${m.p99.toFixed(2).padStart(6)} ${m.peak.toFixed(1).padStart(7)} ${m.lift
      .toFixed(2)
      .padStart(7)} ${`${m.haloCover}%`.padStart(8)}`,
  );
}
say('');
