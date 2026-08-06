/**
 * src/ui/settings.test.ts — the settings model, headless.
 *
 * Every decision the screen makes is a pure function of an immutable value, so
 * the whole of fire mode, reduce-VFX and the three volumes is asserted here with
 * no Pixi and no canvas — the same discipline as the rest of `src/ui/`.
 */

import { describe, it, expect } from 'vitest';
import { FireMode } from '@platform/actions';
import {
  DEFAULT_VOLUMES,
  SETTINGS_EYEBROW,
  SETTINGS_ROWS,
  VOLUME_CHANNELS,
  VOLUME_STEPS,
  adjustVolume,
  createSettings,
  sameTarget,
  setReduceVfx,
  setVolume,
  settingsHitTest,
  settingsLayout,
  settingsModel,
  toggleReduceVfx,
  volumeButtons,
  volumeLevel,
} from './settings';
import type { VolumeChannel } from './settings';
import { hitRect } from './menu-geometry';
import { singlePrimary } from './gantry';
import { BEAM, COLUMN, ROW, TOUCH_MIN, rowHeight, frameMetrics } from '../art/materials';

const VIEWPORT = { width: 1280, height: 720 };
const center = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe('the value and how it changes', () => {
  it('opens on VFX-on and the default mix', () => {
    const s = createSettings();
    expect(s.reduceVfx).toBe(false);
    expect(s.volumes).toEqual(DEFAULT_VOLUMES);
  });

  it('toggles reduce VFX', () => {
    expect(toggleReduceVfx(createSettings()).reduceVfx).toBe(true);
    expect(toggleReduceVfx(toggleReduceVfx(createSettings())).reduceVfx).toBe(false);
  });

  it('lets the perf gate set reduce-VFX outright, and is still when it does not move', () => {
    const on = setReduceVfx(createSettings(), true);
    expect(on.reduceVfx).toBe(true);
    // The gate re-asserting the same value every frame must not churn state.
    expect(setReduceVfx(on, true)).toBe(on);
  });

  it('clamps a volume to [0, 1] and is still on a no-op', () => {
    const s = createSettings();
    expect(setVolume(s, 'master', 2).volumes.master).toBe(1);
    expect(setVolume(s, 'master', -1).volumes.master).toBe(0);
    expect(setVolume(s, 'master', s.volumes.master)).toBe(s);
  });

  it('steps a volume up and down, and stops at the rails', () => {
    let s = setVolume(createSettings(), 'sfx', 1);
    expect(volumeLevel(s, 'sfx')).toBe(VOLUME_STEPS);
    s = adjustVolume(s, 'sfx', 1); // already full
    expect(volumeLevel(s, 'sfx')).toBe(VOLUME_STEPS);
    for (let i = 0; i < VOLUME_STEPS + 3; i++) s = adjustVolume(s, 'sfx', -1);
    expect(volumeLevel(s, 'sfx')).toBe(0);
    expect(s.volumes.sfx).toBe(0);
  });

  it('snaps an off-grid volume onto a clean step when nudged', () => {
    const s = setVolume(createSettings(), 'music', 0.37);
    const up = adjustVolume(s, 'music', 1);
    // 0.37 → nearest step (4) → +1 → 5 steps → 0.5, not 0.47.
    expect(volumeLevel(up, 'music')).toBe(5);
    expect(up.volumes.music).toBeCloseTo(0.5, 10);
  });

  it('reports every channel as a whole number of steps', () => {
    const s = createSettings();
    for (const channel of VOLUME_CHANNELS) {
      const level = volumeLevel(s, channel);
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(VOLUME_STEPS);
    }
  });
});

describe('the frame model reads its values from their true sources', () => {
  it('shows the fire mode passed in, both ways', () => {
    const manual = settingsModel(createSettings(), FireMode.Manual, 'sticks');
    const auto = settingsModel(createSettings(), FireMode.AutoAim, 'sticks');
    expect(manual.rows[0]).toMatchObject({ kind: 'fireMode', value: 'MANUAL', on: false });
    expect(auto.rows[0]).toMatchObject({ kind: 'fireMode', value: 'AUTO-AIM', on: true });
  });

  it('shows the control scheme passed in, the ratified wording, both ways', () => {
    const sticks = settingsModel(createSettings(), FireMode.Manual, 'sticks');
    const tap = settingsModel(createSettings(), FireMode.Manual, 'tap');
    // "CONTROLS: STICKS / TAP COMMANDER" — the label names the setting, the pill
    // shows the seated scheme; Tap Commander is the engaged (on) state.
    expect(sticks.rows.find((r) => r.kind === 'controls')).toMatchObject({
      label: 'CONTROLS',
      value: 'STICKS',
      on: false,
    });
    expect(tap.rows.find((r) => r.kind === 'controls')).toMatchObject({
      label: 'CONTROLS',
      value: 'TAP COMMANDER',
      on: true,
    });
  });

  it('shows reduce VFX and carries every volume as filled steps', () => {
    const s = setVolume(toggleReduceVfx(createSettings()), 'master', 0.5);
    const model = settingsModel(s, FireMode.Manual, 'sticks');
    const vfx = model.rows.find((r) => r.kind === 'reduceVfx');
    expect(vfx).toMatchObject({ value: 'ON', on: true });
    const master = model.rows.find((r) => r.channel === 'master');
    expect(master).toMatchObject({ level: 5, max: VOLUME_STEPS });
  });

  it('lists one row per SETTINGS_ROWS, in order', () => {
    const model = settingsModel(createSettings(), FireMode.Manual, 'sticks');
    expect(model.rows.map((r) => r.kind)).toEqual(SETTINGS_ROWS.map((r) => r.kind));
    expect(model.rows).toHaveLength(SETTINGS_ROWS.length);
  });

  it('carries the header beam\'s standing instruction, verbatim from the handoff', () => {
    expect(settingsModel(createSettings(), FireMode.Manual, 'sticks').eyebrow).toBe(SETTINGS_EYEBROW);
  });
});

// The constraint Bone carries with it: the primary action relies on brightness
// and size rather than hue, so it must never share a screen with a second bright
// plate. On this screen DONE is that plate — every row, however "engaged" the
// setting behind it, is a surface.
describe('one bright plate, and only one', () => {
  it('makes DONE the screen\'s only primary', () => {
    const model = settingsModel(createSettings(), FireMode.AutoAim, 'tap');
    expect(model.backRole).toBe('primary');
    expect(singlePrimary([model.backRole])).toBe(true);
  });

  it('never brightens a row, even with every toggle engaged', () => {
    // Six rows all "on" is the worst case for a screen that marks state by
    // brightness — if a row could go primary, this is where it would.
    const loud = setVolume(toggleReduceVfx(createSettings()), 'master', 1);
    const model = settingsModel(loud, FireMode.AutoAim, 'tap');
    expect(model.rows.some((r) => r.on)).toBe(true);
    // The model exposes no role for a row precisely because a row has no choice
    // of one; the view draws every row `inert`. Asserted as the whole screen's
    // primary count, which is the thing that must stay at one.
    expect(singlePrimary([model.backRole, ...model.rows.map(() => 'inert' as const)])).toBe(true);
  });
});

describe('rest / hover / press', () => {
  it('resolves a row\'s state, with a press outranking a hover', () => {
    const rest = settingsModel(createSettings(), FireMode.Manual, 'sticks');
    expect(rest.rows.every((r) => r.state === 'rest')).toBe(true);
    expect(rest.backState).toBe('rest');

    const hovered = settingsModel(createSettings(), FireMode.Manual, 'sticks', {
      hover: { kind: 'reduceVfx' },
    });
    expect(hovered.rows.find((r) => r.kind === 'reduceVfx')?.state).toBe('hover');
    expect(hovered.rows.find((r) => r.kind === 'fireMode')?.state).toBe('rest');

    const pressed = settingsModel(createSettings(), FireMode.Manual, 'sticks', {
      hover: { kind: 'back' },
      press: { kind: 'back' },
    });
    expect(pressed.backState).toBe('press');
  });

  it('addresses a volume row\'s two ends separately — the bar between them is inert', () => {
    const model = settingsModel(createSettings(), FireMode.Manual, 'sticks', {
      press: { kind: 'volume', channel: 'sfx', dir: 1 },
    });
    const sfx = model.rows.find((r) => r.channel === 'sfx');
    const master = model.rows.find((r) => r.channel === 'master');
    expect(sfx?.plusState).toBe('press');
    expect(sfx?.minusState).toBe('rest');
    // The row plate itself never lights up: the bar is a readout, not a control.
    expect(sfx?.state).toBe('rest');
    // And the same stepper on a different channel is a different control.
    expect(master?.plusState).toBe('rest');
  });

  it('compares targets structurally, because the hit test returns fresh objects', () => {
    expect(sameTarget({ kind: 'back' }, { kind: 'back' })).toBe(true);
    expect(sameTarget({ kind: 'back' }, { kind: 'fireMode' })).toBe(false);
    expect(
      sameTarget({ kind: 'volume', channel: 'sfx', dir: 1 }, { kind: 'volume', channel: 'sfx', dir: 1 }),
    ).toBe(true);
    expect(
      sameTarget({ kind: 'volume', channel: 'sfx', dir: 1 }, { kind: 'volume', channel: 'sfx', dir: -1 }),
    ).toBe(false);
    // Two nulls (the pointer is off every control) are the same target; one is not.
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget(null, { kind: 'back' })).toBe(false);
  });
});

describe('layout and hit test agree', () => {
  it('places a row per setting between the beams, heading in one and DONE in the other', () => {
    const layout = settingsLayout(VIEWPORT);
    expect(layout.rows).toHaveLength(SETTINGS_ROWS.length);
    for (const row of layout.rows) {
      expect(row.x).toBeGreaterThanOrEqual(layout.content.x - 0.5);
      expect(row.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height);
      expect(row.y + row.height).toBeLessThanOrEqual(layout.footer.y + 0.5);
    }
    // The heading rides the header beam; DONE is a plate inside the footer beam,
    // right-aligned in it (handoff).
    expect(layout.title.y).toBe(layout.header.y);
    expect(layout.back.y).toBeGreaterThanOrEqual(layout.footer.y - 0.5);
    expect(layout.back.y + layout.back.height).toBeLessThanOrEqual(layout.footer.y + layout.footer.height + 0.5);
    expect(layout.back.x + layout.back.width).toBeLessThanOrEqual(
      layout.content.x + layout.content.width + 0.5,
    );
  });

  it('draws the RATIFIED desktop numbers at the handoff\'s own reference', () => {
    // The derivation must reproduce its own sample: 44px margins, 92px beams, a
    // 680px row column, 64px rows.
    const layout = settingsLayout(VIEWPORT);
    expect(layout.metrics.margin).toBe(BEAM.margin);
    expect(layout.header.height).toBe(BEAM.height);
    expect(layout.footer.height).toBe(BEAM.height);
    expect(layout.rows[0]?.height).toBe(ROW.height);
    expect(layout.rows[0]?.width).toBe(COLUMN.settings);
    // One column on a desktop: every row fits the band at full height.
    expect(new Set(layout.rows.map((r) => Math.round(r.x))).size).toBe(1);
  });

  it('routes a tap on DONE to back', () => {
    const layout = settingsLayout(VIEWPORT);
    expect(settingsHitTest(layout, center(layout.back).x, center(layout.back).y)).toEqual({ kind: 'back' });
  });

  it('flips a toggle from anywhere on its row', () => {
    const layout = settingsLayout(VIEWPORT);
    const fireRow = layout.rows[0]!;
    // The far-left of the row (the label) still toggles a toggle.
    expect(settingsHitTest(layout, fireRow.x + 4, center(fireRow).y)).toEqual({ kind: 'fireMode' });
    const controlsIdx = SETTINGS_ROWS.findIndex((r) => r.kind === 'controls');
    const controlsRow = layout.rows[controlsIdx]!;
    expect(settingsHitTest(layout, controlsRow.x + 4, center(controlsRow).y)).toEqual({ kind: 'controls' });
    const vfxIdx = SETTINGS_ROWS.findIndex((r) => r.kind === 'reduceVfx');
    const vfxRow = layout.rows[vfxIdx]!;
    expect(settingsHitTest(layout, center(vfxRow).x, center(vfxRow).y)).toEqual({ kind: 'reduceVfx' });
  });

  it('only responds on the −/+ buttons of a volume row, never the bar', () => {
    const layout = settingsLayout(VIEWPORT);
    const idx = SETTINGS_ROWS.findIndex((r) => r.kind === 'volume');
    const row = layout.rows[idx]!;
    const channel = (SETTINGS_ROWS[idx] as { channel: VolumeChannel }).channel;
    const { minus, plus, bar } = volumeButtons(row, layout.stepper);

    expect(settingsHitTest(layout, center(plus).x, center(plus).y)).toEqual({ kind: 'volume', channel, dir: 1 });
    expect(settingsHitTest(layout, center(minus).x, center(minus).y)).toEqual({ kind: 'volume', channel, dir: -1 });
    // A tap on the bar (left end, clear of the buttons) is inert.
    expect(hitRect(bar, bar.x + 2, center(bar).y)).toBe(true);
    expect(settingsHitTest(layout, bar.x + 2, center(bar).y)).toBeNull();
  });

  it('returns null for a tap off every control', () => {
    const layout = settingsLayout(VIEWPORT);
    expect(settingsHitTest(layout, 5000, 5000)).toBeNull();
  });

  it('never overflows a tiny viewport — zero-extent, not backwards', () => {
    const layout = settingsLayout({ width: 40, height: 30 });
    for (const row of layout.rows) {
      expect(row.width).toBeGreaterThanOrEqual(0);
      expect(row.height).toBeGreaterThanOrEqual(0);
    }
    expect(layout.content.width).toBeGreaterThanOrEqual(0);
  });
});

// The phone case the field report was actually on: under the landscape lock a
// portrait phone hands the screen a WIDE, SHORT logical viewport. A single stack
// of every row would have to crush each one to a sub-thumb sliver to fit that
// height — which is why the CONTROLS row "wasn't there" on the developer's phone
// (it was, just too thin to read as a control). The screen must spend the width
// to keep every row at its full thumb height instead.
describe('short, wide touch viewport (portrait phone under the landscape lock)', () => {
  // iPhone 390×844 held portrait → the root rotates to a 844×390 landscape logical
  // viewport. Pixel 412×915 → 915×412. Both are far too short for six thumb rows
  // stacked in one column.
  const PHONE = { width: 844, height: 390 };

  it('keeps every row at its FULL thumb height rather than compressing it', () => {
    const layout = settingsLayout(PHONE, { isTouch: true });
    const m = frameMetrics(PHONE.width, PHONE.height);
    expect(layout.rows).toHaveLength(SETTINGS_ROWS.length);
    for (const row of layout.rows) {
      // No sliver: each row is its intended thumb height, to the pixel.
      expect(row.height).toBeCloseTo(rowHeight(m), 5);
      expect(row.height).toBeGreaterThanOrEqual(TOUCH_MIN);
    }
    // It could only manage that by using more than one column.
    const distinctX = new Set(layout.rows.map((r) => Math.round(r.x)));
    expect(distinctX.size).toBeGreaterThan(1);
  });

  it('keeps the −/+ steppers thumb-sized, where the handoff\'s 40px would not be', () => {
    const layout = settingsLayout(PHONE, { isTouch: true });
    const idx = SETTINGS_ROWS.findIndex((r) => r.kind === 'volume');
    const { minus, plus } = volumeButtons(layout.rows[idx]!, layout.stepper);
    for (const box of [minus, plus]) {
      expect(box.width).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(box.height).toBeGreaterThanOrEqual(TOUCH_MIN);
    }
  });

  it('keeps DONE reachable and thumb-sized inside the footer beam', () => {
    const layout = settingsLayout(PHONE, { isTouch: true });
    expect(layout.back.height).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(settingsHitTest(layout, center(layout.back).x, center(layout.back).y)).toEqual({ kind: 'back' });
  });

  it('the CONTROLS row is present, on-screen, and tappable across its whole width', () => {
    const layout = settingsLayout(PHONE, { isTouch: true });
    const idx = SETTINGS_ROWS.findIndex((r) => r.kind === 'controls');
    const controls = layout.rows[idx]!;
    // Inside the content box, both axes — not stranded off a fold.
    expect(controls.x).toBeGreaterThanOrEqual(layout.content.x - 0.5);
    expect(controls.x + controls.width).toBeLessThanOrEqual(layout.content.x + layout.content.width + 0.5);
    expect(controls.y).toBeGreaterThanOrEqual(layout.content.y - 0.5);
    expect(controls.y + controls.height).toBeLessThanOrEqual(layout.content.y + layout.content.height + 0.5);
    // A tap anywhere on it flips the scheme — the whole row is live, as on desktop.
    expect(settingsHitTest(layout, controls.x + 4, center(controls).y)).toEqual({ kind: 'controls' });
    expect(settingsHitTest(layout, center(controls).x, center(controls).y)).toEqual({ kind: 'controls' });
  });

  it('every row stays inside the content box — nothing wraps off an edge', () => {
    const layout = settingsLayout(PHONE, { isTouch: true });
    for (const row of layout.rows) {
      expect(row.x).toBeGreaterThanOrEqual(layout.content.x - 0.5);
      expect(row.x + row.width).toBeLessThanOrEqual(layout.content.x + layout.content.width + 0.5);
      expect(row.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height - 0.5);
      expect(row.y + row.height).toBeLessThanOrEqual(layout.footer.y + 0.5);
    }
  });

  it('respects a sideways notch — nothing is drawn under the safe-area inset', () => {
    // A phone held in portrait rotates the root, so the notch that was at the top
    // arrives on one SIDE of the logical viewport. Beams stop at it; rows stop at
    // it plus the page margin.
    const insets = { top: 0, bottom: 0, left: 44, right: 44 };
    const layout = settingsLayout(PHONE, { isTouch: true, insets });
    expect(layout.header.x).toBe(insets.left);
    expect(layout.header.x + layout.header.width).toBe(PHONE.width - insets.right);
    for (const row of layout.rows) {
      expect(row.x).toBeGreaterThanOrEqual(insets.left);
      expect(row.x + row.width).toBeLessThanOrEqual(PHONE.width - insets.right + 0.5);
    }
  });
});
