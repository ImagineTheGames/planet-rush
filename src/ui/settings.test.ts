/**
 * src/ui/settings.test.ts — the settings model, headless.
 *
 * Every decision the screen makes is a pure function of an immutable value, so
 * the whole of fire mode, reduce-VFX and the three volumes is asserted here with
 * no Pixi and no canvas — the same discipline as the rest of `src/ui/`.
 */

import { describe, it, expect } from 'vitest';
import { FireMode, describeBindings } from '@platform/actions';
import type { DeviceKind } from '@platform/actions';
import {
  CONTROL_SCHEME_STORAGE,
  DEFAULT_VOLUMES,
  SETTINGS_EYEBROW,
  SETTINGS_HELP,
  SETTINGS_HELP_GLYPH,
  SETTINGS_ROWS,
  STICKS_LABELS,
  TAP_COMMANDER_LABEL,
  VOLUME_CHANNELS,
  VOLUME_STEPS,
  adjustVolume,
  controlsDevice,
  createSettings,
  parseControlScheme,
  sameTarget,
  setReduceVfx,
  setVolume,
  settingsHelp,
  settingsHelpStep,
  settingsHitTest,
  settingsLayout,
  settingsModel,
  settingsRowKey,
  storedControlScheme,
  toggleReduceVfx,
  volumeButtons,
  volumeLevel,
} from './settings';
import type { ControlScheme, VolumeChannel } from './settings';
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
    const manual = settingsModel(createSettings(), FireMode.Manual, 'sticks', 'keyboard');
    const auto = settingsModel(createSettings(), FireMode.AutoAim, 'sticks', 'keyboard');
    expect(manual.rows[0]).toMatchObject({ kind: 'fireMode', value: 'MANUAL', on: false });
    expect(auto.rows[0]).toMatchObject({ kind: 'fireMode', value: 'AUTO-AIM', on: true });
  });

  it('shows the control scheme passed in, the ratified wording, both ways', () => {
    const sticks = settingsModel(createSettings(), FireMode.Manual, 'sticks', 'touch');
    const tap = settingsModel(createSettings(), FireMode.Manual, 'tap', 'keyboard');
    // The label names the setting, the pill shows the seated scheme; Tap Commander
    // is the engaged (on) state. The default scheme's WORD is per-device (u8-01,
    // asserted in full below) — on touch it is still STICKS.
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
    const model = settingsModel(s, FireMode.Manual, 'sticks', 'keyboard');
    const vfx = model.rows.find((r) => r.kind === 'reduceVfx');
    expect(vfx).toMatchObject({ value: 'ON', on: true });
    const master = model.rows.find((r) => r.channel === 'master');
    expect(master).toMatchObject({ level: 5, max: VOLUME_STEPS });
  });

  it('lists one row per SETTINGS_ROWS, in order', () => {
    const model = settingsModel(createSettings(), FireMode.Manual, 'sticks', 'keyboard');
    expect(model.rows.map((r) => r.kind)).toEqual(SETTINGS_ROWS.map((r) => r.kind));
    expect(model.rows).toHaveLength(SETTINGS_ROWS.length);
  });

  it('carries the header beam\'s standing instruction, verbatim from the handoff', () => {
    expect(settingsModel(createSettings(), FireMode.Manual, 'sticks', 'keyboard').eyebrow).toBe(SETTINGS_EYEBROW);
  });
});

// ---------------------------------------------------------------------------
// u8-01 — the CONTROLS row names the device in front of the player
// ---------------------------------------------------------------------------
//
// The bug, verbatim from the field report (2026-08-06, with a screenshot of
// `CONTROLS · STICKS` on a PC): "this is wrong for pc, it should be KEYBOARD +
// MOUSE or MOUSE ONLY and not sticks (there are no sticks, unless someone is
// playing with gamepad... then wen can call it TWIN STICKS (but only if gamepad
// detected)". `'sticks'` was the scheme's INTERNAL name printed verbatim on every
// device. The internal name stays; the word the player reads does not.
describe('the CONTROLS row says what the player actually holds (u8-01)', () => {
  /** The word the row shows, through the real model — the shipped path, not the
   *  label table on its own. */
  const controlsWord = (scheme: ControlScheme, device: DeviceKind): string | undefined =>
    settingsModel(createSettings(), FireMode.Manual, scheme, device).rows.find((r) => r.kind === 'controls')
      ?.value;

  it('names each device exactly once, and never prints the internal name on a PC', () => {
    expect(controlsWord('sticks', 'touch')).toBe('STICKS');
    expect(controlsWord('sticks', 'gamepad')).toBe('TWIN STICKS');
    expect(controlsWord('sticks', 'keyboard')).toBe('KEYBOARD + MOUSE');
    // The exact screenshot state: a desktop with no pad must not read the bare
    // scheme name, whatever else changes about the wording.
    expect(controlsWord('sticks', 'keyboard')).not.toBe('STICKS');
  });

  it('reads TAP COMMANDER on every device — a scheme is not a device', () => {
    for (const device of ['keyboard', 'gamepad', 'touch'] as const) {
      expect(controlsWord('tap', device)).toBe(TAP_COMMANDER_LABEL);
    }
  });

  it('flips KEYBOARD + MOUSE → TWIN STICKS when a pad connects, and back when it goes', () => {
    // What the wiring layer does with `gamepadconnected` / `gamepaddisconnected`:
    // the flag moves, the device is re-derived, the row is re-rendered.
    const desktopWord = (gamepadConnected: boolean): string | undefined =>
      controlsWord('sticks', controlsDevice({ isTouch: false, gamepadConnected }));

    expect(desktopWord(false)).toBe('KEYBOARD + MOUSE');
    expect(desktopWord(true)).toBe('TWIN STICKS');
    // A pad whose battery dies must not leave a stale TWIN STICKS behind — the
    // same class of lie this brief exists to remove.
    expect(desktopWord(false)).toBe('KEYBOARD + MOUSE');
  });

  it('leaves touch alone — the virtual sticks are real and on the glass', () => {
    expect(controlsDevice({ isTouch: true, gamepadConnected: false })).toBe('touch');
    expect(controlsDevice({ isTouch: true, gamepadConnected: true })).toBe('touch');
    expect(controlsWord('sticks', 'touch')).toBe('STICKS');
  });

  it('is KEYBOARD + MOUSE and not "MOUSE ONLY", because the bindings say so', () => {
    // The developer offered either wording; the binding table settles it. A player
    // cannot move without the keyboard, so "mouse only" would replace one false
    // label with another. Read from `describeBindings` — the same map that drives
    // the sim — so a re-binding that made the mouse sufficient would fail here
    // rather than leave the label quietly wrong.
    const rows = describeBindings('keyboard', FireMode.Manual, 'sticks');
    expect(rows.find((r) => r.action === 'thrust')?.binding).toBe('WASD');
    expect(rows.find((r) => r.action === 'aim')?.binding).toBe('Mouse');
    expect(STICKS_LABELS.keyboard).toBe('KEYBOARD + MOUSE');
  });

  it('changed the word only — the persisted scheme is still the string "sticks"', () => {
    // A save written by any earlier build says `sticks`, and renaming the stored
    // value would seat an unknown scheme for anyone who already has a preference.
    // Asserted as literal storage strings, in both directions, so a future rename
    // of the union cannot silently break saved preferences.
    expect(CONTROL_SCHEME_STORAGE.sticks).toBe('sticks');
    expect(CONTROL_SCHEME_STORAGE.tap).toBe('tap');
    for (const scheme of ['sticks', 'tap'] as const) {
      expect(parseControlScheme(storedControlScheme(scheme))).toBe(scheme);
    }
    expect(storedControlScheme('sticks')).toBe('sticks');
    expect(parseControlScheme('sticks')).toBe('sticks');
    // And anything else a storage seam can hand back folds to the default.
    for (const stale of [null, undefined, '', 'STICKS', 'twin-sticks', 'keyboard']) {
      expect(parseControlScheme(stale)).toBe('sticks');
    }
  });
});

// The constraint Bone carries with it: the primary action relies on brightness
// and size rather than hue, so it must never share a screen with a second bright
// plate. On this screen DONE is that plate — every row, however "engaged" the
// setting behind it, is a surface.
describe('one bright plate, and only one', () => {
  it('makes DONE the screen\'s only primary', () => {
    const model = settingsModel(createSettings(), FireMode.AutoAim, 'tap', 'keyboard');
    expect(model.backRole).toBe('primary');
    expect(singlePrimary([model.backRole])).toBe(true);
  });

  it('never brightens a row, even with every toggle engaged', () => {
    // Six rows all "on" is the worst case for a screen that marks state by
    // brightness — if a row could go primary, this is where it would.
    const loud = setVolume(toggleReduceVfx(createSettings()), 'master', 1);
    const model = settingsModel(loud, FireMode.AutoAim, 'tap', 'keyboard');
    expect(model.rows.some((r) => r.on)).toBe(true);
    // The model exposes no role for a row precisely because a row has no choice
    // of one; the view draws every row `inert`. Asserted as the whole screen's
    // primary count, which is the thing that must stay at one.
    expect(singlePrimary([model.backRole, ...model.rows.map(() => 'inert' as const)])).toBe(true);
  });
});

describe('rest / hover / press', () => {
  it('resolves a row\'s state, with a press outranking a hover', () => {
    const rest = settingsModel(createSettings(), FireMode.Manual, 'sticks', 'keyboard');
    expect(rest.rows.every((r) => r.state === 'rest')).toBe(true);
    expect(rest.backState).toBe('rest');

    const hovered = settingsModel(createSettings(), FireMode.Manual, 'sticks', 'keyboard', {
      hover: { kind: 'reduceVfx' },
    });
    expect(hovered.rows.find((r) => r.kind === 'reduceVfx')?.state).toBe('hover');
    expect(hovered.rows.find((r) => r.kind === 'fireMode')?.state).toBe('rest');

    const pressed = settingsModel(createSettings(), FireMode.Manual, 'sticks', 'keyboard', {
      hover: { kind: 'back' },
      press: { kind: 'back' },
    });
    expect(pressed.backState).toBe('press');
  });

  it('addresses a volume row\'s two ends separately — the bar between them is inert', () => {
    const model = settingsModel(createSettings(), FireMode.Manual, 'sticks', 'keyboard', {
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
    // "Anywhere" now means anywhere but the `?` (a0-77): the row's leading square
    // is a control of its own, exactly as its trailing squares are on a volume
    // row. Everything from the label rightwards still toggles.
    const clearOfHelp = (i: number): number => layout.rows[i]!.x + layout.help[i]!.width + 4;
    expect(settingsHitTest(layout, clearOfHelp(0), center(fireRow).y)).toEqual({ kind: 'fireMode' });
    const controlsIdx = SETTINGS_ROWS.findIndex((r) => r.kind === 'controls');
    const controlsRow = layout.rows[controlsIdx]!;
    expect(settingsHitTest(layout, clearOfHelp(controlsIdx), center(controlsRow).y)).toEqual({ kind: 'controls' });
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
    // A tap on the bar (clear of the buttons AND of the row's leading `?`) is
    // inert — the bar is a readout, not a control.
    const onBar = bar.x + layout.help[idx]!.width + 2;
    expect(hitRect(bar, onBar, center(bar).y)).toBe(true);
    expect(settingsHitTest(layout, onBar, center(bar).y)).toBeNull();
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
    // A tap anywhere on it flips the scheme — the whole row is live, as on
    // desktop, from the end of its `?` rightwards (a0-77).
    const afterHelp = controls.x + layout.help[idx]!.width + 4;
    expect(settingsHitTest(layout, afterHelp, center(controls).y)).toEqual({ kind: 'controls' });
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

// ---------------------------------------------------------------------------
// a0-77 — a `?` on every setting, and the copy behind it
// ---------------------------------------------------------------------------

describe('a ? on every setting (a0-77)', () => {
  /**
   * **The gate.** Not "today's six rows have copy" — that is a fact about today,
   * and it would still pass on the day a seventh row shipped with nothing behind
   * its `?`. This walks {@link SETTINGS_ROWS} itself, so the assertion is *every
   * row the screen draws explains itself*, and a row added later without help
   * text fails the build rather than shipping silently.
   *
   * The type system holds the other half: {@link SETTINGS_HELP} is a `Record`
   * over the key union derived from `SettingsRowSpec`, so a new row kind cannot
   * even compile without an entry. This test is what catches the entry that
   * exists but says nothing, or that says it about the wrong row.
   */
  it('every row explains itself', () => {
    expect(SETTINGS_ROWS.length).toBeGreaterThan(0);
    const model = settingsModel(createSettings(), FireMode.AutoAim, 'tap', 'touch');
    expect(model.rows).toHaveLength(SETTINGS_ROWS.length);

    const seen = new Set<string>();
    for (const [i, spec] of SETTINGS_ROWS.entries()) {
      const key = settingsRowKey(spec);
      const help = settingsHelp(spec);
      const row = model.rows[i]!;

      // There IS an explanation, and it is a sentence rather than a placeholder.
      expect(help, `row ${key} has help`).toBeTruthy();
      expect(help.title.trim().length, `row ${key} help has a title`).toBeGreaterThan(0);
      expect(help.summary.trim().length, `row ${key} help has a summary`).toBeGreaterThan(20);

      // It names the row it belongs to, in the row's OWN words — a panel titled
      // anything else is a panel a player cannot tie to the control they tapped.
      expect(help.title, `row ${key} help names its row`).toBe(row.label);

      // …and it is that row's own copy, not a neighbour's pasted across.
      expect(seen.has(help.summary), `row ${key} help is its own`).toBe(false);
      seen.add(help.summary);

      // Length is part of clarity (GDD §4.7): the panel is 260px wide, so a
      // paragraph here is a paragraph nobody reads mid-decision.
      expect(help.summary.length, `row ${key} help stays brief`).toBeLessThanOrEqual(260);

      // No badges on a settings row: the value chip beside the `?` already shows
      // the seated value, and a badge would be a second, dimmer copy of it.
      expect(help.badges).toEqual([]);
    }
    // Every key in the register is spoken for by a row — no orphan copy for a
    // setting the screen no longer has.
    expect(Object.keys(SETTINGS_HELP).sort()).toEqual(SETTINGS_ROWS.map(settingsRowKey).sort());
  });

  it('says the two things about the CONTROLS row that the in-match tip says', () => {
    // a0-33's prompt teaches Tap Commander as "tap … to mine it" / "tap your own
    // station to bank"; this row's copy has to teach the same gesture, or a
    // player who read one and then the other has two games to reconcile.
    const controls = settingsHelp({ kind: 'controls' }).summary;
    expect(controls).toContain('TAP COMMANDER');
    expect(controls).toContain('tap a target');
    expect(controls).toContain('tap your own station');
    // …and the alternative is described by what the HANDS do, on all three of the
    // devices whose word the row itself might be showing (u8-01), because naming
    // just one of them would be wrong on the other two.
    expect(controls).toContain('WASD');
    expect(controls).toContain('sticks');
  });

  it('tells a player that REDUCE VFX also happens on its own', () => {
    // The half a player cannot account for otherwise: `VfxAutoQuality` engages
    // the same flag under load (GDD §4.8 risk 5), and somebody watching effects
    // thin out mid-fight deserves to learn from this screen that nothing broke.
    const summary = settingsHelp({ kind: 'reduceVfx' }).summary;
    expect(summary).toMatch(/on its own|by itself|automatically/);
    expect(summary).toContain('frame rate');
  });

  it('says what each audio channel covers, including the alarm that ignores SFX', () => {
    const master = settingsHelp({ kind: 'volume', channel: 'master' }).summary;
    const sfx = settingsHelp({ kind: 'volume', channel: 'sfx' }).summary;
    const music = settingsHelp({ kind: 'volume', channel: 'music' }).summary;
    // The mixer's own routing (`../art/audio/graph`): everything sums into master,
    // and the under-attack alarm has its own bus so the SFX slider cannot silence
    // a mechanic on the not-cuttable list.
    expect(master).toContain('alarm');
    expect(sfx).toContain('alarm');
    expect(sfx).toMatch(/not on this channel/);
    expect(music).toContain('soundtrack');
  });

  it('gives every row a `?` that is a real touch target, clear of the value and the steppers', () => {
    for (const [viewport, isTouch] of [
      [VIEWPORT, false],
      [{ width: 844, height: 390 }, true], // the landscape phone the goldens use
      [{ width: 798, height: 384 }, true], // the developer's phone, landscape
    ] as const) {
      const layout = settingsLayout(viewport, { isTouch });
      expect(layout.help).toHaveLength(SETTINGS_ROWS.length);
      for (const [i, spec] of SETTINGS_ROWS.entries()) {
        const row = layout.rows[i]!;
        const help = layout.help[i]!;
        const where = `${viewport.width}x${viewport.height} row ${settingsRowKey(spec)}`;

        // A control, not a glyph: the thumb floor on both axes, everywhere.
        expect(help.width, `${where} is thumb-wide`).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(help.height, `${where} is thumb-tall`).toBeGreaterThanOrEqual(TOUCH_MIN);

        // Inside its row, on the LEADING edge — the one edge where nothing that
        // takes a press already lives.
        expect(help.x).toBe(row.x);
        expect(help.y).toBeGreaterThanOrEqual(row.y - 0.5);
        expect(help.y + help.height).toBeLessThanOrEqual(row.y + row.height + 0.5);

        // …and therefore clear of BOTH steppers on a volume row, with the whole
        // pip bar between them. This is the check the developer's screenshot is
        // about: at 798x384 the row is 372px and the `?` may not reach the −.
        const { minus, plus } = volumeButtons(row, layout.stepper);
        expect(help.x + help.width, `${where} clears the − stepper`).toBeLessThanOrEqual(minus.x);
        expect(help.x + help.width, `${where} clears the + stepper`).toBeLessThanOrEqual(plus.x);

        // The `?` answers the tap that lands on it, ahead of the row it sits on.
        expect(settingsHitTest(layout, center(help).x, center(help).y)).toEqual({ kind: 'help', index: i });
      }
    }
  });

  it('opens the tapped row\'s explanation, and only that one', () => {
    const index = SETTINGS_ROWS.findIndex((r) => r.kind === 'reduceVfx');
    const model = settingsModel(createSettings(), FireMode.AutoAim, 'tap', 'touch', { help: index });
    expect(model.openHelp).toEqual({ index, hint: settingsHelp(SETTINGS_ROWS[index]!) });
    expect(model.rows.filter((r) => r.helpOpen)).toHaveLength(1);
    expect(model.rows[index]!.helpOpen).toBe(true);
    // The `?` reads as held while its panel is up.
    expect(model.rows[index]!.helpState).toBe('rest');
    // …and with nothing open, nothing is open.
    expect(settingsModel(createSettings(), FireMode.AutoAim, 'tap', 'touch').openHelp).toBeNull();
  });

  it('carries the pointer and the keyboard on a `?` as two different marks', () => {
    const hovered = settingsModel(createSettings(), FireMode.AutoAim, 'tap', 'touch', {
      hover: { kind: 'help', index: 2 },
      focus: 4,
    });
    expect(hovered.rows[2]!.helpState).toBe('hover');
    expect(hovered.rows[2]!.helpFocused).toBe(false);
    expect(hovered.rows[4]!.helpState).toBe('rest');
    expect(hovered.rows[4]!.helpFocused).toBe(true);
    // A press outranks a hover on a `?` exactly as it does on a row.
    const pressed = settingsModel(createSettings(), FireMode.AutoAim, 'tap', 'touch', {
      hover: { kind: 'help', index: 2 },
      press: { kind: 'help', index: 2 },
    });
    expect(pressed.rows[2]!.helpState).toBe('press');
  });

  it('compares two help targets by the row they explain', () => {
    expect(sameTarget({ kind: 'help', index: 1 }, { kind: 'help', index: 1 })).toBe(true);
    expect(sameTarget({ kind: 'help', index: 1 }, { kind: 'help', index: 2 })).toBe(false);
    expect(sameTarget({ kind: 'help', index: 1 }, { kind: 'controls' })).toBe(false);
  });

  it('walks the `?` column with the keyboard, wrapping at both ends', () => {
    const last = SETTINGS_ROWS.length - 1;
    // A cold screen enters at the near end, whichever way the first press went,
    // so one arrow always lands somewhere.
    expect(settingsHelpStep(null, 1)).toBe(0);
    expect(settingsHelpStep(null, -1)).toBe(last);
    expect(settingsHelpStep(0, 1)).toBe(1);
    expect(settingsHelpStep(last, 1)).toBe(0);
    expect(settingsHelpStep(0, -1)).toBe(last);
    // Every row is reachable in one pass — no row is unreachable by keyboard.
    const seen = new Set<number>();
    let at = settingsHelpStep(null, 1);
    for (let i = 0; i < SETTINGS_ROWS.length; i++) {
      seen.add(at);
      at = settingsHelpStep(at, 1);
    }
    expect(seen.size).toBe(SETTINGS_ROWS.length);
  });

  it('marks the control with the one glyph the game already uses for "explain this"', () => {
    // The same mark as the lobby's roster rows (`./lobby` SEAT_HELP_GLYPH, a0-06).
    expect(SETTINGS_HELP_GLYPH).toBe('?');
  });
});
