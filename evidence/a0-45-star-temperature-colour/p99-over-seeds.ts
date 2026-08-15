/**
 * evidence/a0-45-star-temperature-colour/p99-over-seeds.ts
 *
 * Run: `npx vite-node evidence/a0-45-star-temperature-colour/p99-over-seeds.ts`
 *
 * **`peakP99` on one seed is a noisy number, and a0-45 is the brief that found
 * out.** The 99th percentile of a 320×180 grid over one panel is set almost
 * entirely by the halos — about 35 of them per screenful, at r ≈ 26 px against a
 * star point's 2.45 — so the statistic is really "how many blooms landed, and how
 * much did they overlap". That is a small count with a real spread: on `main` the
 * design panel drew 27 halos and the game panel 32 and the two p99s agreed to
 * 0.04%, which reads like agreement between implementations and is mostly luck.
 * a0-45 shifts every seeded stream by two draws per star (the temperature), and
 * the same two panels come back with 30 and 41.
 *
 * So this measures both panels over many seeds rather than one, which is what the
 * band has to be re-derived from.
 */

import { measure, sampleMockup, sampleShapes, colorLuma } from '../../sky-preview';
import { MOCKUP_GROUND, MOCKUP_PANEL, MOCKUP_STARS } from '../../src/art/mockup-reference';
import { STAR_LAYERS, VOID_SEED, starFieldSprite } from '../../src/art/backdrop';

const P = MOCKUP_PANEL;
const ground = colorLuma(MOCKUP_GROUND);
const SEEDS = 24;

const out: string[] = [];
const say = (s = ''): void => {
  out.push(s);
  // eslint-disable-next-line no-console
  console.log(s);
};

function stats(xs: readonly number[]): { mean: number; sd: number; min: number; max: number } {
  const mean = xs.reduce((t, v) => t + v, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((t, v) => t + (v - mean) ** 2, 0) / (xs.length - 1));
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

const design: number[] = [];
const game: number[] = [];
const halos: number[] = [];
say('p99 over seeds — the design’s panel and the game’s, both coloured (a0-45)');
say('=========================================================================');
say();
say('  seed          design p99   game p99   game halos');
for (let i = 0; i < SEEDS; i++) {
  const seed = (VOID_SEED + i * 0x9e37_79b9) >>> 0;
  const d = measure(sampleMockup('none', seed, P.w, P.h), ground).p99;
  const field = STAR_LAYERS.flatMap((l) => [...starFieldSprite(l, seed, P.w, P.h).shapes]);
  const m = measure(sampleShapes(field, false, MOCKUP_GROUND, P.w, P.h), ground).p99;
  const h = field.filter((s) => s.fill?.falloff).length;
  design.push(d);
  game.push(m);
  halos.push(h);
  say(`  0x${seed.toString(16).padStart(8, '0')}  ${d.toFixed(2).padStart(10)} ${m.toFixed(2).padStart(10)} ${String(h).padStart(12)}`);
}
say();
const sd = stats(design);
const sg = stats(game);
const sh = stats(halos);
say(`  design panel  mean ${sd.mean.toFixed(2)}  sd ${sd.sd.toFixed(2)}  range ${sd.min.toFixed(2)}–${sd.max.toFixed(2)}`);
say(`  game panel    mean ${sg.mean.toFixed(2)}  sd ${sg.sd.toFixed(2)}  range ${sg.min.toFixed(2)}–${sg.max.toFixed(2)}`);
say(`  game halos    mean ${sh.mean.toFixed(1)}  sd ${sh.sd.toFixed(1)}  range ${sh.min}–${sh.max}`);
say();
say(`  the two panels agree in the mean to ${(Math.abs(sg.mean - sd.mean) / sd.mean * 100).toFixed(2)}%`);
say(`  the declared band is ${MOCKUP_STARS.peakP99.min}–${MOCKUP_STARS.peakP99.max}`);

const fs = await import('node:fs');
fs.writeFileSync(new URL('./p99-over-seeds.txt', import.meta.url), `${out.join('\n')}\n`);
