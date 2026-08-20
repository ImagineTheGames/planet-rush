/**
 * tests/harness/a0-117-tuning.test.ts — the guard on the before/candidate
 * renderer (`harness/tuning.ts`). OWNER: QA Agent.
 *
 * A tuning report's whole claim is "these two columns were measured on the same
 * seeds". A renderer that would quietly print a different draw beside a
 * published one is worse than no renderer at all, so the property this file
 * cares most about is that {@link assertSameSeeds} **throws** — and it is tested
 * against the committed artifacts, not a fixture, so a re-run that changed the
 * seed set fails here rather than in a reader's head.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SectionRun } from '../../harness/mirrors';
import {
  assertSameSeeds,
  classWins,
  draws,
  hangs,
  leverTable,
  movePts,
  poolWins,
  sameSeeds,
  simTimeouts,
} from '../../harness/tuning';

const DATA = fileURLToPath(new URL('../reports/a0-117-data/', import.meta.url));
const SECTIONS = ['mirror', 'roster', 'tier', 'class', 'cast', 'a0107'] as const;

const load = (dir: string, section: string): SectionRun =>
  JSON.parse(readFileSync(`${DATA}${dir}/${section}.json`, 'utf8')) as SectionRun;

describe('the a0-117 artifacts are two runs of the same draw', () => {
  for (const section of SECTIONS) {
    it(`\`${section}\` was re-measured on the same seeds`, () => {
      const pair = { before: load('before', section), after: load('candidate-w3400', section) };
      expect(sameSeeds(pair)).toBe(true);
      expect(() => assertSameSeeds(pair)).not.toThrow();
      // Same lineups too, in the same order — same seeds alone would still allow
      // a different contest to be printed beside the one it is compared with.
      expect(pair.after.matches.map((m) => m.lineup)).toEqual(pair.before.matches.map((m) => m.lineup));
      expect(pair.after.label).toBe(pair.before.label);
    });
  }

  it('refuses a pair that is not the same draw', () => {
    const before = load('before', 'class');
    const after = { ...load('candidate-w3400', 'class'), seeds: [1, 2, 3] };
    expect(sameSeeds({ before, after })).toBe(false);
    expect(() => assertSameSeeds({ before, after })).toThrow(/same seeds/);
  });

  it('no section hung, in either column — the one gate that is an instrument failure', () => {
    for (const dir of ['before', 'candidate-w3400']) {
      for (const section of SECTIONS) {
        expect(hangs(load(dir, section)), `${dir}/${section}`).toBe(0);
        expect(simTimeouts(load(dir, section)), `${dir}/${section}`).toBe(0);
      }
    }
  });
});

describe('what the report says about the excavator is what the artifacts say', () => {
  it('reads 77.3% of the ship-class contest on the shipped tree', () => {
    const w = classWins(load('before', 'class')).find((x) => x.key === 'excavator');
    expect(w?.wins).toBe(198);
    expect(w?.decided).toBe(256);
    expect(w!.rate).toBeGreaterThan(0.55);
  });

  it('reads 51.8% on the candidate — inside the band, and still the best hull', () => {
    const wins = classWins(load('candidate-w3400', 'class'));
    const top = wins[0]!;
    expect(top.key).toBe('excavator');
    expect(top.rate).toBeLessThan(0.55);
    // Not over-corrected into a hull nobody picks: the excavator is still first.
    expect(top.rate).toBeGreaterThan(wins[1]!.rate);
  });

  it('the easy pool has no win rate on the candidate — it is all draws (a0-113)', () => {
    const tier = load('candidate-w3400', 'tier');
    const easy = tier.matches.filter((m) => m.lineup.startsWith('easy:'));
    expect(easy.length).toBeGreaterThan(0);
    expect(easy.every((m) => m.ok && m.winner === null)).toBe(true);
    for (const w of poolWins(tier, 'easy')) expect(w.decided).toBe(0);
    // And that is a change of degree, not of kind: it was already mostly draws.
    expect(draws(load('before', 'tier'))).toBeGreaterThan(0);
  });
});

describe('the report’s own formatting is not a place a sign can flip', () => {
  it('prints the direction of a move, not just its size', () => {
    expect(movePts(0.773, 0.518)).toBe('−25.5 pts');
    expect(movePts(0.027, 0.103)).toBe('+7.6 pts');
    expect(movePts(0.5, 0.5)).toBe('+0.0 pts');
  });

  it('says so plainly when nothing blocks a lever', () => {
    const md = leverTable([
      { constant: 'COLLAPSE_GRACE_S', from: '150', to: '45', excavator: '75.0%', matches: 64, blockedBy: null },
    ]);
    expect(md).toContain('— nothing');
    expect(md).toContain('`COLLAPSE_GRACE_S`');
  });
});
