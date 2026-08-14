/**
 * evidence/a0-44-star-bloom-radius/panels.ts — the design panel and the game's
 * own panel, measured side by side on the design's instrument, with the a0-22
 * bloom tint on and off.
 *
 * Run: `npx vite-node evidence/a0-44-star-bloom-radius/panels.ts`
 */

import { STAR_LAYERS, VOID_SEED, starFieldSprite } from '../../src/art/backdrop';
import { MOCKUP_GROUND, MOCKUP_PANEL, MOCKUP_STARS } from '../../src/art/mockup-reference';
import type { Shape } from '../../src/art/shapes';
import { colorLuma, measure, sampleMockup, sampleShapes } from '../../sky-preview';

const { w, h } = MOCKUP_PANEL;
const ground = colorLuma(MOCKUP_GROUND);

const mockup = measure(sampleMockup('none', VOID_SEED, w, h), ground);
const game = STAR_LAYERS.flatMap((l) => [...starFieldSprite(l, VOID_SEED, w, h).shapes]);
const ported = measure(sampleShapes(game, false, MOCKUP_GROUND, w, h), ground);

/** The same shapes with every halo forced back onto the ramp's own colour — the
 *  a0-22 tint, subtracted, so its share of the gap can be read off. */
const RAMP = new Set(MOCKUP_STARS.ramp.map((b) => b.color));
const untinted: Shape[] = game.map((s) =>
  s.fill?.falloff && !RAMP.has(s.fill.color) ? { ...s, fill: { ...s.fill, color: 0xffffff } } : s,
);
const noTint = measure(sampleShapes(untinted, false, MOCKUP_GROUND, w, h), ground);

const row = (label: string, m: { p99: number; peak: number; lift: number }): string =>
  `  ${label.padEnd(34)} p99 ${m.p99.toFixed(2).padStart(6)}   peak ${m.peak
    .toFixed(1)
    .padStart(6)}   lift ${m.lift.toFixed(2).padStart(5)}`;

// eslint-disable-next-line no-console
console.log(
  [
    '',
    `  the design's band: p99 ${MOCKUP_STARS.peakP99.min}–${MOCKUP_STARS.peakP99.max}`,
    '',
    row('mockup panel (the design)', mockup),
    row('ported (the game, a0-22 tints)', ported),
    row('ported, halos untinted', noTint),
    '',
    `  the tint's share of the gap: ${(noTint.p99 - ported.p99).toFixed(2)} of p99`,
    '',
  ].join('\n'),
);
