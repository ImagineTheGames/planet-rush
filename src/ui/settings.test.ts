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
  SETTINGS_ROWS,
  VOLUME_CHANNELS,
  VOLUME_STEPS,
  adjustVolume,
  createSettings,
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
});

describe('layout and hit test agree', () => {
  it('places a row per setting inside the content box, title on top, DONE on the bottom', () => {
    const layout = settingsLayout(VIEWPORT);
    expect(layout.rows).toHaveLength(SETTINGS_ROWS.length);
    for (const row of layout.rows) {
      expect(row.x).toBeGreaterThanOrEqual(layout.content.x - 0.5);
      expect(row.y).toBeGreaterThanOrEqual(layout.title.y + layout.title.height);
      expect(row.y + row.height).toBeLessThanOrEqual(layout.back.y + 0.5);
    }
    expect(layout.back.y + layout.back.height).toBeLessThanOrEqual(layout.content.y + layout.content.height + 0.5);
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
    const { minus, plus, bar } = volumeButtons(row);

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
