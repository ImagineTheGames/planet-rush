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
    expect(controlsStripRows('touch', FireMode.AutoAim, true, 'sticks')).toEqual([]);
  });

  it('mirrors the live action map exactly (no drift)', () => {
    const rows = controlsStripRows('keyboard', FireMode.Manual, false, 'sticks');
    expect(rows).toEqual(describeBindings('keyboard', FireMode.Manual, 'sticks'));
  });

  it('names Build & Upgrade in full, never just "BUILD" (GDD §2.5)', () => {
    const rows = controlsStripRows('keyboard', FireMode.Manual, false, 'sticks');
    const build = rows.find((r) => r.action === 'build');
    expect(build?.label).toBe('Build & Upgrade');
  });

  it('morphs with fire mode — Auto-aim folds the aim row away (GDD §2.4)', () => {
    const manual = controlsStripRows('keyboard', FireMode.Manual, false, 'sticks');
    const auto = controlsStripRows('keyboard', FireMode.AutoAim, false, 'sticks');
    expect(manual.some((r) => r.action === 'aim')).toBe(true);
    expect(auto.some((r) => r.action === 'aim')).toBe(false);
  });
});

describe('a0-37 — the strip names the scheme the player is actually IN (GDD §2.2, §2.4)', () => {
  /** The strip as a player reads it, left→right, exactly as `Hud.rebuildStrip`
   *  lays it out: the key glyph then the action, rows separated by air. */
  const read = (rows: readonly { binding: string | null; label: string }[]): string =>
    rows.map((r) => (r.binding === null ? r.label : `${r.binding} ${r.label}`)).join(' · ');

  it("the developer's own frame — PC + Tap Commander + Auto-aim — must not say WASD Thrust · Left mouse Fire / Mine", () => {
    const strip = read(controlsStripView('keyboard', FireMode.AutoAim, false, true, 'tap'));
    expect(strip, 'thrust keys the scheme zeroes (main.ts sampleInput)').not.toContain('WASD');
    expect(strip, 'a fire key the pilot presses for you').not.toContain('Left mouse Fire / Mine');
    expect(strip, "the developer's own words: click anywhere to move or attack").toContain(
      'Click anywhere',
    );
    expect(strip, 'the primary action comes first').toMatch(/^Click anywhere Move or attack/);
  });

  it('is a device VERB, not a fixed word — click on a PC, tap on glass (§2.4, 2026-08-06)', () => {
    const pc = read(controlsStripRows('keyboard', FireMode.AutoAim, false, 'tap'));
    expect(pc).toContain('Click anywhere');
    expect(pc).not.toContain('Tap anywhere');
    // Touch draws no strip, but the same map feeds onboarding/settings copy.
    const glass = describeBindings('touch', FireMode.AutoAim, 'tap');
    expect(glass.find((r) => r.action === 'command')?.binding).toBe('Tap anywhere');
  });

  it('keeps the Build & Upgrade key, which Tap Commander leaves live (main.ts sampleInput)', () => {
    const rows = controlsStripView('keyboard', FireMode.AutoAim, false, true, 'tap');
    const build = rows.find((r) => r.action === 'build');
    expect(build?.binding, 'E really does still open the wheel in this scheme').toBe('E');
    expect(build?.label).toBe('Build & Upgrade');
  });

  it('Sticks + Manual keeps today’s wording, to the letter', () => {
    const strip = read(controlsStripView('keyboard', FireMode.Manual, false, true, 'sticks'));
    expect(strip).toBe('WASD Thrust · Mouse Aim · Left mouse Fire / Mine · E Build & Upgrade');
  });

  it('Sticks + Auto-aim says WHEN to fire, not how to aim (§2.4)', () => {
    const auto = controlsStripRows('keyboard', FireMode.AutoAim, false, 'sticks');
    const fire = auto.find((r) => r.action === 'fire');
    expect(fire?.binding, 'the key itself is unchanged — auto-aim moved the aiming, not the button').toBe(
      'Left mouse',
    );
    expect(fire?.label).toBe('Hold to fire / mine — auto-aim picks the target');
    expect(auto.some((r) => r.action === 'aim'), 'the aim row still folds away').toBe(false);
  });
});

describe('controlsStripView — the Build row is contextual on docking (field report v0.2.2)', () => {
  it('shows the live E key + full name when docked at your station', () => {
    const rows = controlsStripView('keyboard', FireMode.Manual, false, true, 'sticks');
    const build = rows.find((r) => r.action === 'build');
    expect(build?.binding, 'the key is live at the station').toBe('E');
    expect(build?.label, 'named in full, never just BUILD (GDD §2.5)').toBe('Build & Upgrade');
    expect(build?.dimmed, 'a usable affordance is not dimmed').toBe(false);
  });

  it('NEVER promises a dead key away from the station — no key, dimmed hint instead', () => {
    const rows = controlsStripView('keyboard', FireMode.Manual, false, false, 'sticks');
    const build = rows.find((r) => r.action === 'build');
    expect(build?.binding, 'no live "E" is advertised when the wheel cannot open').toBeNull();
    expect(build?.label, 'the dimmed row says WHY it is dark and how to fix it').toBe(BUILD_AWAY_HINT);
    expect(build?.dimmed, 'drawn dimmed — present but not usable here').toBe(true);
  });

  it('leaves every non-build row untouched by docking', () => {
    const home = controlsStripView('keyboard', FireMode.Manual, false, true, 'sticks');
    const away = controlsStripView('keyboard', FireMode.Manual, false, false, 'sticks');
    const strip = (rows: readonly { action: string; binding: string | null }[]) =>
      rows.filter((r) => r.action !== 'build').map((r) => `${r.action}:${r.binding}`);
    expect(strip(away), 'only the Build row reacts to docking').toEqual(strip(home));
  });

  it('returns no rows on touch — the sticks are the legend (GDD §2.2)', () => {
    expect(controlsStripView('touch', FireMode.AutoAim, true, true, 'sticks')).toEqual([]);
    expect(controlsStripView('touch', FireMode.AutoAim, true, false, 'sticks')).toEqual([]);
  });
});
