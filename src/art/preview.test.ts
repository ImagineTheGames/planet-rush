/**
 * The committed contact sheet is a golden.
 *
 * `assets/preview/sprite-sheet.svg` is the art review surface for a repo with
 * no art tool (GDD §4.5: art is "reproducible, diffable"). A golden keeps it
 * honest in both directions: the sheet can never go stale against the
 * generators, and every art change arrives in a PR as a readable diff of shapes
 * and colours rather than as a silently-updated binary.
 *
 * Regenerate after any art change:
 *
 * ```sh
 * UPDATE_ART_PREVIEW=1 npx vitest run src/art/preview.test.ts
 * ```
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildContactSheet } from './preview';
import { ART_CATALOGUE } from './catalogue';
import { spriteToSvg } from './svg';
import { circle, fill, sprite } from './shapes';
import { PALETTE } from './palette';

const SHEET = resolve(__dirname, '../../assets/preview/sprite-sheet.svg');

describe('sprite contact sheet', () => {
  const generated = buildContactSheet();

  it('is deterministic', () => {
    expect(buildContactSheet()).toBe(generated);
  });

  it('shows every catalogued sprite', () => {
    // One <g> per tile, plus the actual-size strip's eight.
    const groups = generated.match(/<g transform/g)?.length ?? 0;
    expect(groups).toBe(ART_CATALOGUE.length + 8);
  });

  it('matches the committed sheet (UPDATE_ART_PREVIEW=1 to regenerate)', () => {
    if (process.env.UPDATE_ART_PREVIEW) {
      mkdirSync(dirname(SHEET), { recursive: true });
      writeFileSync(SHEET, generated);
    }
    expect(existsSync(SHEET), `${SHEET} is missing — run UPDATE_ART_PREVIEW=1`).toBe(true);
    expect(readFileSync(SHEET, 'utf8')).toBe(generated);
  });
});

describe('svg output', () => {
  it('renders a sprite on Vacuum, in hex the browser understands', () => {
    const svg = spriteToSvg(sprite('t', 1, [circle(0, 0, 1, fill(PALETTE.patina, 'material'))]), 64);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('#0d1015'); // background
    expect(svg).toContain('#4fa08b'); // the shape
    expect(svg).toContain('</svg>');
  });

  it('emits alpha only when a shape is translucent, so diffs stay small', () => {
    const opaque = spriteToSvg(sprite('t', 1, [circle(0, 0, 1, fill(PALETTE.patina, 'material'))]));
    const faded = spriteToSvg(sprite('t', 1, [circle(0, 0, 1, fill(PALETTE.patina, 'material', 0.5))]));
    expect(opaque).not.toContain('fill-opacity');
    expect(faded).toContain('fill-opacity="0.5"');
  });
});
