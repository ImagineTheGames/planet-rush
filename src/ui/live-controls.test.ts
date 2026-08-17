/**
 * src/ui/live-controls.test.ts — a control that cannot act is not drawn (a0-74).
 *
 * The developer's case is the first test in this file and is named for it: Tap
 * Commander + Auto-aim, which since a0-30 is what *every* player who has never
 * chosen starts in, on every platform.
 */
import { describe, it, expect } from 'vitest';
import { liveOnGlassControls, showStickFurniture } from './live-controls';
import { FireMode } from '@platform/actions';

describe('liveOnGlassControls (a0-74)', () => {
  it('draws no FIRE button under Tap Commander + auto-fire', () => {
    const live = liveOnGlassControls(true, 'tap', FireMode.AutoAim);
    expect(live.fireButton).toBe(false);
    // …and the two sticks the same scheme zeroes go with it — the report says
    // "buttons like Fire", and this is the rest of that sentence.
    expect(live.thrustStick).toBe(false);
    expect(live.aimStick).toBe(false);
    expect(showStickFurniture(true, 'tap', FireMode.AutoAim)).toBe(false);
  });

  it('keeps BUILD & UPGRADE alive under Tap Commander — the scheme leaves it', () => {
    // main.ts `sampleInput` zeroes thrust/aim/fire in the tap scheme and leaves
    // `merged.build` exactly as the devices wrote it, so this button really works.
    for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
      expect(liveOnGlassControls(true, 'tap', mode).build).toBe(true);
    }
  });

  it('is dead under Tap Commander in EITHER fire mode', () => {
    // The mode has nothing left to say once the pilot holds the trigger.
    expect(liveOnGlassControls(true, 'tap', FireMode.Manual)).toEqual(
      liveOnGlassControls(true, 'tap', FireMode.AutoAim),
    );
  });

  it('leaves the sticks scheme exactly as it shipped', () => {
    const manual = liveOnGlassControls(true, 'sticks', FireMode.Manual);
    expect(manual).toEqual({
      thrustStick: true,
      aimStick: true,
      fireButton: false,
      build: true,
    });
    const auto = liveOnGlassControls(true, 'sticks', FireMode.AutoAim);
    expect(auto).toEqual({
      thrustStick: true,
      aimStick: false,
      fireButton: true,
      build: true,
    });
    expect(showStickFurniture(true, 'sticks', FireMode.Manual)).toBe(true);
    expect(showStickFurniture(true, 'sticks', FireMode.AutoAim)).toBe(true);
  });

  it('draws nothing on the glass off touch, in every scheme and mode', () => {
    for (const scheme of ['sticks', 'tap'] as const) {
      for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
        expect(liveOnGlassControls(false, scheme, mode)).toEqual({
          thrustStick: false,
          aimStick: false,
          fireButton: false,
          build: false,
        });
        expect(showStickFurniture(false, scheme, mode)).toBe(false);
      }
    }
  });

  it('never dims — every field is a draw/do-not-draw answer', () => {
    // Guards the distinction the header draws: "not right now" is the controls
    // strip's dimmed BUILD row; this file only ever answers "not in this scheme".
    const live = liveOnGlassControls(true, 'tap', FireMode.AutoAim);
    for (const v of Object.values(live)) expect(typeof v).toBe('boolean');
  });
});
