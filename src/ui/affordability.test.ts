/**
 * src/ui/affordability.test.ts — the exact-cost boundary, pinned at the one
 * helper both wheels share. OWNER: UI Engineer.
 *
 * The v0.2.2 field report: TOTAL 4, POWER costs 4, purchase refused. The bug was
 * a boundary — `<` where it must be `<=`. This is the regression the whole PR
 * exists to prevent, asserted at the single expression the Build wheel and the
 * Upgrade wheel now both go through ({@link ./affordability}), so a future edit
 * to the boundary breaks this test before it ever reaches a player's screenshot.
 */
import { describe, it, expect } from 'vitest';
import { affordable, AFFORD_EPSILON } from './affordability';

describe('affordable() — the shared inclusive boundary (field report v0.2.2)', () => {
  it('buys at exactly cost: bank == cost is affordable', () => {
    // The developer's screenshot, refuted: TOTAL 4, cost 4 → buyable.
    expect(affordable(4, 4)).toBe(true);
    expect(affordable(0, 0)).toBe(true);
    expect(affordable(7, 3)).toBe(true);
  });

  it('refuses at exactly one short: bank == cost - 1 is not affordable', () => {
    expect(affordable(3, 4)).toBe(false);
    expect(affordable(0, 1)).toBe(false);
  });

  it('forgives float slack (fractional repair/mining ore), never a whole ore', () => {
    // A bank a hair under a whole cost still buys — repair spends 1 ore per 5 HP
    // and mined chips land fractional, so a real total lands just shy of whole.
    expect(affordable(4 - AFFORD_EPSILON / 2, 4)).toBe(true);
    // …but the slack never closes a true one-ore gap.
    expect(affordable(3.5, 4)).toBe(false);
  });
});
