/**
 * Controls-strip tests (GDD §2.2, §2.4). The strip is desktop-only (on touch the
 * visible sticks are the legend), and its labels come from the same action map
 * that drives the sim so they can never drift.
 */
import { describe, it, expect } from 'vitest';
import {
  showControlsStrip,
  controlsStripRows,
  controlsStripView,
  BUILD_AWAY_HINT,
} from './controls-strip';
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

describe('controlsStripView — the Build row is contextual on docking (field report v0.2.2)', () => {
  it('shows the live E key + full name when docked at your planet', () => {
    const rows = controlsStripView('keyboard', FireMode.Manual, false, true);
    const build = rows.find((r) => r.action === 'build');
    expect(build?.binding, 'the key is live at the planet').toBe('E');
    expect(build?.label, 'named in full, never just BUILD (GDD §2.5)').toBe('Build & Upgrade');
    expect(build?.dimmed, 'a usable affordance is not dimmed').toBe(false);
  });

  it('NEVER promises a dead key away from the planet — no key, dimmed hint instead', () => {
    const rows = controlsStripView('keyboard', FireMode.Manual, false, false);
    const build = rows.find((r) => r.action === 'build');
    expect(build?.binding, 'no live "E" is advertised when the wheel cannot open').toBeNull();
    expect(build?.label, 'the dimmed row says WHY it is dark and how to fix it').toBe(BUILD_AWAY_HINT);
    expect(build?.dimmed, 'drawn dimmed — present but not usable here').toBe(true);
  });

  it('leaves every non-build row untouched by docking', () => {
    const home = controlsStripView('keyboard', FireMode.Manual, false, true);
    const away = controlsStripView('keyboard', FireMode.Manual, false, false);
    const strip = (rows: readonly { action: string; binding: string | null }[]) =>
      rows.filter((r) => r.action !== 'build').map((r) => `${r.action}:${r.binding}`);
    expect(strip(away), 'only the Build row reacts to docking').toEqual(strip(home));
  });

  it('returns no rows on touch — the sticks are the legend (GDD §2.2)', () => {
    expect(controlsStripView('touch', FireMode.AutoAim, true, true)).toEqual([]);
    expect(controlsStripView('touch', FireMode.AutoAim, true, false)).toEqual([]);
  });
});
