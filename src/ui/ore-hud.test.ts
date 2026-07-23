/**
 * Ore-at-a-glance model tests (GDD §2.2, §2.3). One square per cargo slot so
 * upgrades visibly widen the row; the row flashes when the hold is full; the
 * banked total is a separate, safe number.
 */
import { describe, it, expect } from 'vitest';
import { oreHudModel, oreFlashOn } from './ore-hud';

describe('oreHudModel (GDD §2.2)', () => {
  it('draws one square per cargo slot (upgrades widen the row)', () => {
    expect(oreHudModel(0, 2, 0).slots).toBe(2);
    expect(oreHudModel(0, 8, 0).slots).toBe(8); // maxed cargo (GDD §2.8 cap 8)
  });

  it('fills a square per whole ore held, clamped to the slot count', () => {
    expect(oreHudModel(1, 2, 0).filled).toBe(1);
    expect(oreHudModel(2, 2, 0).filled).toBe(2);
    // Never overflow the row even if cargo somehow exceeds cap.
    expect(oreHudModel(5, 2, 0).filled).toBe(2);
    // Fractional held ore floors to whole squares.
    expect(oreHudModel(1.9, 3, 0).filled).toBe(1);
  });

  it('flags a full hold (GDD §2.2 "flashing when full")', () => {
    expect(oreHudModel(2, 2, 0).full).toBe(true);
    expect(oreHudModel(1, 2, 0).full).toBe(false);
    expect(oreHudModel(0, 0, 0).full).toBe(false); // no cap ⇒ never "full"
  });

  it('carries the banked total separately from the held squares (GDD §2.3)', () => {
    const m = oreHudModel(1, 2, 7);
    expect(m.filled).toBe(1);
    expect(m.banked).toBe(7);
  });
});

describe('oreFlashOn — deterministic full-hold blink (no wall clock)', () => {
  it('never flashes when the hold is not full', () => {
    const notFull = oreHudModel(1, 2, 0);
    expect(oreFlashOn(notFull, 0)).toBe(false);
    expect(oreFlashOn(notFull, 0.3)).toBe(false);
  });

  it('blinks on a ~2 Hz cycle driven by match time', () => {
    const full = oreHudModel(2, 2, 0);
    expect(oreFlashOn(full, 0.0)).toBe(true); // floor(0)=0 → on
    expect(oreFlashOn(full, 0.25)).toBe(false); // floor(1)=1 → off
    expect(oreFlashOn(full, 0.5)).toBe(true); // floor(2)=2 → on
  });
});
