/**
 * evidence/a0-45-star-temperature-colour/p99-sensitivity.ts
 *
 * Run: `npx vite-node evidence/a0-45-star-temperature-colour/p99-sensitivity.ts`
 *
 * `MOCKUP_STARS.peakP99` (46–53) is labelled **Measured** and every input that
 * moves it is labelled Measured too, so when the coloured field failed to reach
 * it the first question is *which knob could have*. This prices every one of
 * them on the design's own instrument — the same `sampleMockup`/`measure` the
 * gate in `backdrop.test.ts` uses, not a re-implementation — so the answer to
 * "can a derived value be re-fitted to restore the band" is a number.
 */

import { measure, sampleMockup, colorLuma } from '../../sky-preview';
import { MOCKUP_GROUND, MOCKUP_PANEL, MOCKUP_STARS, starColorFor } from '../../src/art/mockup-reference';
import { VOID_SEED } from '../../src/art/backdrop';

const PANEL = MOCKUP_PANEL;
const ground = colorLuma(MOCKUP_GROUND);

const say = (s = ''): void => {
  // eslint-disable-next-line no-console
  console.log(s);
};

/** The design's own panel, on the design's own instrument. */
function designP99(): number {
  return measure(sampleMockup('none', VOID_SEED, PANEL.w, PANEL.h), ground).p99;
}

say('p99 sensitivity — which knob can reach the declared band, and by how much');
say('=========================================================================');
say();
say(`  the declared band                 ${MOCKUP_STARS.peakP99.min}–${MOCKUP_STARS.peakP99.max}`);
say(`  the design's panel, as it stands  ${designP99().toFixed(2)}`);
say();

// The knobs, one at a time. Each is a mutation of the frozen design data, so it
// is done here and nowhere else — the point is to price them, not to keep them.
const S = MOCKUP_STARS as unknown as {
  count: number;
  alpha: { min: number; max: number };
  radius: { min: number; max: number };
  magnitudeExponent: number;
  bloom: { intensity: number; peakAlpha: number; radius: number; threshold: number };
};

const restore = {
  count: S.count,
  alphaMax: S.alpha.max,
  radiusMax: S.radius.max,
  exponent: S.magnitudeExponent,
  peakAlpha: S.bloom.peakAlpha,
  bloomRadius: S.bloom.radius,
  threshold: S.bloom.threshold,
};

function probe(label: string, set: () => void, undo: () => void): void {
  set();
  say(`  ${label.padEnd(42)} p99 ${designP99().toFixed(2)}`);
  undo();
}

say('  DERIVED knobs (the ones a re-fit is allowed to move):');
for (const f of [1.2, 1.5, 2]) {
  probe(
    `star alpha.max ${restore.alphaMax} → ${(restore.alphaMax * f).toFixed(2)}`,
    () => {
      S.alpha.max = Math.min(1, restore.alphaMax * f);
    },
    () => {
      S.alpha.max = restore.alphaMax;
    },
  );
}
for (const f of [1.5, 2]) {
  probe(
    `star radius.max ${restore.radiusMax} → ${(restore.radiusMax * f).toFixed(2)}`,
    () => {
      S.radius.max = restore.radiusMax * f;
    },
    () => {
      S.radius.max = restore.radiusMax;
    },
  );
}
for (const e of [1.8, 1.5]) {
  probe(
    `magnitudeExponent ${restore.exponent} → ${e}`,
    () => {
      S.magnitudeExponent = e;
    },
    () => {
      S.magnitudeExponent = restore.exponent;
    },
  );
}
say();
say('  MEASURED knobs (a re-fit may NOT move these — priced only to say what would):');
for (const f of [1.2, 1.3]) {
  probe(
    `bloom.peakAlpha ${restore.peakAlpha} → ${(restore.peakAlpha * f).toFixed(4)}`,
    () => {
      S.bloom.peakAlpha = restore.peakAlpha * f;
    },
    () => {
      S.bloom.peakAlpha = restore.peakAlpha;
    },
  );
}
probe(
  `count ${restore.count} → ${restore.count * 2}`,
  () => {
    S.count = restore.count * 2;
  },
  () => {
    S.count = restore.count;
  },
);
probe(
  `bloom.threshold ${restore.threshold} → 0.75`,
  () => {
    S.bloom.threshold = 0.75;
  },
  () => {
    S.bloom.threshold = restore.threshold;
  },
);
say();

// The one that is not a knob at all: the colour itself.
say('  and the thing that actually changed — the halo/point colour:');
say(`    the design's own top-of-range colours   hot ${starColorFor(1).toString(16)}  cool ${starColorFor(-1).toString(16)}`);
say('    a halo pixel at its own peak, over the ground (α 0.2016, absolute):');
const px = (c: number): number => {
  const a = MOCKUP_STARS.bloom.peakAlpha;
  const [r, g, b] = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  const [gr, gg, gb] = [(MOCKUP_GROUND >> 16) & 0xff, (MOCKUP_GROUND >> 8) & 0xff, MOCKUP_GROUND & 0xff];
  return (
    0.2126 * (gr * (1 - a) + r * a) + 0.7152 * (gg * (1 - a) + g * a) + 0.0722 * (gb * (1 - a) + b * a)
  );
};
say(`      white  #ffffff   Y′ ${px(0xffffff).toFixed(2)}   ← what the deleted ramp painted every bloomed star`);
say(`      hot    #a0cdff   Y′ ${px(starColorFor(1)).toFixed(2)}`);
say(`      hot    #b2d1e9   Y′ ${px(starColorFor(0.55)).toFixed(2)}`);
say(`      cool   #ebc995   Y′ ${px(starColorFor(-0.4)).toFixed(2)}`);
say(`      cool   #ebb45f   Y′ ${px(starColorFor(-1)).toFixed(2)}`);
