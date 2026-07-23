/**
 * RNG determinism — the seed of the determinism replay test (GDD §4.1, §4.8).
 *
 * The whole netcode/QA determinism story rests on one property: the shared
 * seeded PRNG produces the same sequence from the same seed on every engine.
 * This placeholder test asserts exactly that: same seed ⇒ same first 5 outputs.
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@shared/types';

describe('mulberry32', () => {
  it('is deterministic: same seed ⇒ same first 5 outputs', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it('returns floats in [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
