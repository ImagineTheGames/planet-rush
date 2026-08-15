/**
 * evidence/a0-45-star-temperature-colour/audit.ts — **the arithmetic behind a0-45.**
 *
 * Run: `npx vite-node evidence/a0-45-star-temperature-colour/audit.ts`
 *
 * Everything the brief asks to be a number rather than an opinion:
 *
 *  1. the two colour sets — the design's temperature branches, and the magnitude
 *     ramp they replace — with the luma of each;
 *  2. the field's own split, drawn from the shipping generator;
 *  3. **`peakP99`, re-derived**: the design's panel measured with the coloured
 *     field and with the grey ramp it used to be measured with, plus the game's
 *     own panel, on the design's instrument (320×180, mean/percentile of luma
 *     over the panel's own ground);
 *  4. the two tensions the brief says to bring back as questions with numbers —
 *     a blue-white star against the eight roster hues and the beacon ring, and an
 *     amber star against ore, `coreHot` and `oreDeep` — measured on the pixel a
 *     star actually composites to over the ground, not on the ink.
 *
 * It carries its own sampler (the same one `sky-preview.ts` uses, re-stated) so
 * that the grey-ramp column can be measured against a `MOCKUP_STARS.ramp` that
 * no longer exists.
 */

import {
  MOCKUP_GROUND,
  MOCKUP_PANEL,
  MOCKUP_STARS,
  STAR_TEMPERATURE_COLORS,
  starAlpha,
  starBlooms,
  starColorFor,
  starHaloAlpha,
  starMagnitude,
  starRadius,
  starTemperature,
} from '../../src/art/mockup-reference';
import { STAR_LAYERS, VOID_SEED, starFieldSprite } from '../../src/art/backdrop';
import { DERIVED, PALETTE, PLAYER_COLORS, WHITE, hex } from '../../src/art/palette';
import { haloProfile } from '../../src/art/shapes';
import { mulberry32 } from '../../src/shared/types';

const SAMPLE = { cols: 320, rows: 180 };
const PANEL = MOCKUP_PANEL;

function unpack(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function colorLuma(c: number): number {
  const [r, g, b] = unpack(c);
  return luma(r, g, b);
}
function lin(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function lab(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = [lin(rgb[0]!), lin(rgb[1]!), lin(rgb[2]!)];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
function chroma(rgb: readonly [number, number, number]): number {
  const [, aS, bS] = lab(rgb);
  return Math.hypot(aS, bS);
}
/** One ink over the ground, source-over. */
function over(color: number, alpha: number, ground = MOCKUP_GROUND): [number, number, number] {
  const [r, g, b] = unpack(color);
  const [gr, gg, gb] = unpack(ground);
  return [gr * (1 - alpha) + r * alpha, gg * (1 - alpha) + g * alpha, gb * (1 - alpha) + b * alpha];
}

const out: string[] = [];
const say = (s = ''): void => {
  out.push(s);
  // eslint-disable-next-line no-console
  console.log(s);
};

say('a0-45 — stars take their colour from magnitude, and the design takes it from temperature');
say('==========================================================================================');
say();

// ---------------------------------------------------------------------------
// 1. The two colour sets
// ---------------------------------------------------------------------------

say('1. the design’s colours, against the magnitude ramp they replace');
const T = MOCKUP_STARS.temperature;
const hot = [T.hot.min, T.hot.max];
const cool = [T.cool.min, T.cool.max];
for (const t of hot) {
  const c = starColorFor(t);
  say(`   hot  temp ${t.toFixed(2).padStart(5)}  ${hex(c)}  rgb(${unpack(c).join(',')})  Y′ ${colorLuma(c).toFixed(1)}  C* ${chroma(unpack(c)).toFixed(1)}`);
}
for (const k of cool) {
  const c = starColorFor(-k);
  say(`   cool temp ${(-k).toFixed(2).padStart(5)}  ${hex(c)}  rgb(${unpack(c).join(',')})  Y′ ${colorLuma(c).toFixed(1)}  C* ${chroma(unpack(c)).toFixed(1)}`);
}
/** The ramp a0-45 deletes, transcribed — `MOCKUP_STARS.ramp` before this brief. */
const RAMP = [
  { color: PALETTE.hullSteel, minMagnitude: 0 },
  { color: DERIVED.hullLight, minMagnitude: 0.45 },
  { color: WHITE, minMagnitude: 0.8 },
] as const;
const rampColor = (mag: number): number => {
  let chosen = RAMP[0].color;
  for (const band of RAMP) if (mag >= band.minMagnitude) chosen = band.color;
  return chosen;
};
for (const band of RAMP) {
  say(`   ramp mag ≥${band.minMagnitude.toFixed(2)}   ${hex(band.color)}  rgb(${unpack(band.color).join(',')})  Y′ ${colorLuma(band.color).toFixed(1)}  C* ${chroma(unpack(band.color)).toFixed(1)}`);
}
const temps = [...STAR_TEMPERATURE_COLORS];
say(`   the whole temperature set: ${temps.length} distinct colours, Y′ ${Math.min(...temps.map(colorLuma)).toFixed(1)}–${Math.max(...temps.map(colorLuma)).toFixed(1)}`);
say(`   the ramp: 3 distinct colours, Y′ ${Math.min(...RAMP.map((b) => colorLuma(b.color))).toFixed(1)}–${Math.max(...RAMP.map((b) => colorLuma(b.color))).toFixed(1)}`);
say();

// ---------------------------------------------------------------------------
// 2. The field's own split
// ---------------------------------------------------------------------------

say('2. the field the shipping generator draws (one screenful, all three layers)');
{
  let n = 0;
  let hotN = 0;
  let bottomBand = 0;
  const seen = new Set<number>();
  for (const layer of STAR_LAYERS) {
    for (const s of starFieldSprite(layer, VOID_SEED, PANEL.w, PANEL.h).shapes) {
      if (s.path.kind !== 'circle' || !s.fill || s.fill.falloff) continue;
      n++;
      seen.add(s.fill.color);
      if (unpack(s.fill.color)[2]! > unpack(s.fill.color)[0]!) hotN++;
    }
  }
  // What the same field's magnitudes would have painted on the deleted ramp.
  for (const layer of STAR_LAYERS) {
    const rng = mulberry32((layer.key.length * 0 + VOID_SEED) >>> 0);
    void rng;
  }
  const rng = mulberry32(VOID_SEED >>> 0);
  let sample = 0;
  for (let i = 0; i < 100000; i++) {
    if (rampColor(starMagnitude(rng.next())) === PALETTE.hullSteel) bottomBand++;
    sample++;
  }
  say(`   ${n} stars: ${hotN} hot (${((hotN / n) * 100).toFixed(1)}%), ${n - hotN} cool (${(((n - hotN) / n) * 100).toFixed(1)}%) — the design says 78 / 22`);
  say(`   ${seen.size} distinct star colours in one screenful`);
  say(`   the ramp put ${((bottomBand / sample) * 100).toFixed(1)}% of the field in its bottom band (hullSteel, Y′ 135.4)`);
}
say();

// ---------------------------------------------------------------------------
// 3. peakP99, re-derived
// ---------------------------------------------------------------------------

/**
 * The design's own star field over one panel, painted by the design's own rules,
 * with a switch for where the colour comes from — so the coloured field and the
 * grey one differ in exactly that and in nothing else.
 */
function designPanel(colour: 'temperature' | 'ramp'): Float64Array {
  const rng = mulberry32((VOID_SEED ^ 0x57a25) >>> 0);
  const count = MOCKUP_STARS.count;
  interface St {
    x: number;
    y: number;
    r: number;
    alpha: number;
    halo: number;
    color: number;
  }
  const stars: St[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rng.next() - 0.5) * PANEL.w;
    const y = (rng.next() - 0.5) * PANEL.h;
    const mag = starMagnitude(rng.next());
    const temp = starTemperature(rng);
    const r = starRadius(mag);
    stars.push({
      x,
      y,
      r,
      alpha: starAlpha(mag),
      halo: starBlooms(mag) ? r * MOCKUP_STARS.bloom.radius : 0,
      color: colour === 'temperature' ? starColorFor(temp) : rampColor(mag),
    });
  }
  const [gr, gg, gb] = unpack(MOCKUP_GROUND);
  const grid = new Float64Array(SAMPLE.cols * SAMPLE.rows);
  for (let row = 0; row < SAMPLE.rows; row++) {
    const y = ((row + 0.5) / SAMPLE.rows - 0.5) * PANEL.h;
    for (let col = 0; col < SAMPLE.cols; col++) {
      const x = ((col + 0.5) / SAMPLE.cols - 0.5) * PANEL.w;
      let r = gr;
      let g = gg;
      let b = gb;
      for (const st of stars) {
        const d = Math.hypot(x - st.x, y - st.y);
        const [sr, sg, sb] = unpack(st.color);
        if (st.halo > 0 && d <= st.halo) {
          const a = starHaloAlpha() * haloProfile(d / st.halo);
          if (a > 0) {
            r = r * (1 - a) + sr * a;
            g = g * (1 - a) + sg * a;
            b = b * (1 - a) + sb * a;
          }
        }
        if (d <= st.r) {
          const a = st.alpha;
          r = r * (1 - a) + sr * a;
          g = g * (1 - a) + sg * a;
          b = b * (1 - a) + sb * a;
        }
      }
      grid[row * SAMPLE.cols + col] = luma(r, g, b);
    }
  }
  return grid;
}

function p99(grid: Float64Array): number {
  const s = [...grid].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]!;
}
function mean(grid: Float64Array): number {
  let t = 0;
  for (const v of grid) t += v;
  return t / grid.length;
}

say('3. peakP99, re-derived on the coloured field (the brief’s step 4)');
{
  const ground = colorLuma(MOCKUP_GROUND);
  const coloured = designPanel('temperature');
  const grey = designPanel('ramp');
  say(`   the design’s panel, COLOURED   p99 ${p99(coloured).toFixed(2)}   mean ${mean(coloured).toFixed(2)}   lift ${(mean(coloured) - ground).toFixed(2)}`);
  say(`   the design’s panel, grey ramp  p99 ${p99(grey).toFixed(2)}   mean ${mean(grey).toFixed(2)}   lift ${(mean(grey) - ground).toFixed(2)}`);
  say(`   the design’s declared band     ${MOCKUP_STARS.peakP99.min}–${MOCKUP_STARS.peakP99.max}`);
}
say();

// ---------------------------------------------------------------------------
// 4. The two tensions, as numbers
// ---------------------------------------------------------------------------

say('4. the two tensions the brief says to bring back as questions');
{
  const bluest = starColorFor(T.hot.max);
  const amberest = starColorFor(-T.cool.max);
  const brightest = starAlpha(1);
  const faintest = starAlpha(0);
  const px = (c: number, a: number): [number, number, number] => over(c, a);
  say(`   a star’s point paints at α ${faintest}–${brightest} on a disc r ${MOCKUP_STARS.radius.min}–${MOCKUP_STARS.radius.max} px`);
  say(`   the bluest star  ${hex(bluest)}  composites to Y′ ${luma(...px(bluest, brightest)).toFixed(1)}  C* ${chroma(px(bluest, brightest)).toFixed(1)}  (at α ${brightest}, over the ground)`);
  say(`   the amberest     ${hex(amberest)}  composites to Y′ ${luma(...px(amberest, brightest)).toFixed(1)}  C* ${chroma(px(amberest, brightest)).toFixed(1)}`);
  say(`   its halo         ${hex(bluest)}  peaks at Y′ ${luma(...px(bluest, starHaloAlpha())).toFixed(1)} (α ${starHaloAlpha()}, absolute)`);
  say();
  const signals: [string, number][] = [
    ['beacon ring / plasma', PALETTE.plasma],
    ['ore, signal yellow', PALETTE.signalYellow],
    ['oreDeep', DERIVED.oreDeep],
    ['coreHot', DERIVED.coreHot],
    ['threat red', PALETTE.threatRed],
    ...PLAYER_COLORS.map((c, i): [string, number] => [`roster ${i + 1}`, c]),
  ];
  say('   ΔE from the composited star pixel (brightest star, α 0.5) to each thing that MEANS something:');
  for (const [name, c] of signals) {
    const dBlue = deltaE(px(bluest, brightest), unpack(c));
    const dAmber = deltaE(px(amberest, brightest), unpack(c));
    say(`     ${name.padEnd(22)} ${hex(c)}   blue ΔE ${dBlue.toFixed(1).padStart(5)}   amber ΔE ${dAmber.toFixed(1).padStart(5)}`);
  }
  say();
  say('   …and the INK itself, unfaded, which is what a widened allow-list admits:');
  for (const [name, c] of signals) {
    const dBlue = deltaE(unpack(bluest), unpack(c));
    const dAmber = deltaE(unpack(amberest), unpack(c));
    say(`     ${name.padEnd(22)} ${hex(c)}   blue ΔE ${dBlue.toFixed(1).padStart(5)}   amber ΔE ${dAmber.toFixed(1).padStart(5)}`);
  }
}
say();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = await import('node:fs');
fs.writeFileSync(new URL('./audit.txt', import.meta.url), `${out.join('\n')}\n`);
