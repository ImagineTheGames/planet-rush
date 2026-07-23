/**
 * Controls-strip tests (GDD §2.2, §2.4). The strip is desktop-only (on touch the
 * visible sticks are the legend), and its labels come from the same action map
 * that drives the sim so they can never drift.
 */
import { describe, it, expect } from 'vitest';
import { showControlsStrip, controlsStripRows } from './controls-strip';
import { describeBindings, FireMode } from '@platform/actions';

describe('showControlsStrip (GDD §2.2, §2.4)', () => {
  it('shows on desktop/gamepad, hides on touch', () => {
    expect(showControlsStrip(false)).toBe(true);
    expect(showControlsStrip(true)).toBe(false);
  });
});

describe('controlsStripRows (GDD §2.4)', () => {
  it('returns no rows on touch — the sticks are the legend', () => {
    expect(controlsStripRows('touch', FireMode.AutoAim, true)).toEqual([]);
  });

  it('mirrors the live action map exactly (no drift)', () => {
    const rows = controlsStripRows('keyboard', FireMode.Manual, false);
    expect(rows).toEqual(describeBindings('keyboard', FireMode.Manual));
  });

  it('names Build & Upgrade in full, never just "BUILD" (GDD §2.5)', () => {
    const rows = controlsStripRows('keyboard', FireMode.Manual, false);
    const build = rows.find((r) => r.action === 'build');
    expect(build?.label).toBe('Build & Upgrade');
  });

  it('morphs with fire mode — Auto-aim folds the aim row away (GDD §2.4)', () => {
    const manual = controlsStripRows('keyboard', FireMode.Manual, false);
    const auto = controlsStripRows('keyboard', FireMode.AutoAim, false);
    expect(manual.some((r) => r.action === 'aim')).toBe(true);
    expect(auto.some((r) => r.action === 'aim')).toBe(false);
  });
});
