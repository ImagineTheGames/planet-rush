/**
 * Touch-visuals tests (GDD §2.4, mobile amendment §2; milestone-1 gap #1). Two
 * layers: the pure affordance-visibility *matrix* (what shows, by device + fire
 * mode), and an integration check that the real Pixi layer honours it — the
 * fire-mode switch actually swaps the FIRE button for the aim-zone hint, and the
 * whole layer draws nothing on desktop.
 */
import { describe, it, expect } from 'vitest';
import type { Container } from 'pixi.js';
import {
  TouchVisuals,
  affordanceVisibility,
  writeAffordanceVisibility,
  affordanceRects,
  buildButtonRect,
  type TouchReadout,
} from './touch-visuals';
import { FireMode } from './actions';

// A hand-built readout — TouchController satisfies TouchReadout structurally, but
// tests drive the visuals with plain data (no DOM, no controller).
function readout(over: Partial<TouchReadout> & { mode: FireMode }): TouchReadout {
  return {
    getFireMode: () => over.mode,
    left: over.left ?? { engaged: false, origin: { x: 0, y: 0 }, current: { x: 0, y: 0 } },
    right: over.right ?? { engaged: false, origin: { x: 0, y: 0 }, current: { x: 0, y: 0 } },
    rightButtonEngaged: over.rightButtonEngaged ?? false,
  };
}

function shown(v: TouchVisuals, label: string): boolean {
  const child = v.getChildByLabel(label) as Container | null;
  return !!child && child.visible;
}

describe('affordanceVisibility — the matrix (GDD §2.4)', () => {
  it('desktop shows nothing (no touch affordances at all)', () => {
    for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
      const v = affordanceVisibility(false, mode);
      expect(v).toEqual({ leftStickZone: false, fireButton: false, aimHint: false });
    }
  });

  it('touch + Auto-aim shows the FIRE button (and the left stick zone), not the aim hint', () => {
    const v = affordanceVisibility(true, FireMode.AutoAim);
    expect(v.fireButton).toBe(true);
    expect(v.aimHint).toBe(false);
    expect(v.leftStickZone).toBe(true);
  });

  it('touch + Manual shows the aim-zone hint, not the FIRE button', () => {
    const v = affordanceVisibility(true, FireMode.Manual);
    expect(v.fireButton).toBe(false);
    expect(v.aimHint).toBe(true);
    expect(v.leftStickZone).toBe(true);
  });

  it('the fire-mode switch swaps the right-side affordance (button ⇄ aim hint)', () => {
    const auto = affordanceVisibility(true, FireMode.AutoAim);
    const manual = affordanceVisibility(true, FireMode.Manual);
    expect(auto.fireButton).toBe(true);
    expect(manual.fireButton).toBe(false);
    expect(auto.aimHint).toBe(false);
    expect(manual.aimHint).toBe(true);
  });

  it('writeAffordanceVisibility mutates in place (zero-alloc hot path)', () => {
    const out = { leftStickZone: false, fireButton: false, aimHint: false };
    const ret = writeAffordanceVisibility(true, FireMode.AutoAim, out);
    expect(ret).toBe(out); // same object, not a fresh one
    expect(out.fireButton).toBe(true);
  });
});

describe('TouchVisuals — the Pixi layer honours the matrix', () => {
  it('draws nothing on desktop (whole layer hidden)', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.Manual }), /* isTouch */ false, 1280, 720);
    expect(v.visible).toBe(false);
  });

  it('is visible on a touch device', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(v.visible).toBe(true);
  });

  it('touch + Auto-aim: the FIRE button is shown, the aim hint is not', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(shown(v, 'fire-button')).toBe(true);
    expect(shown(v, 'aim-hint')).toBe(false);
    expect(shown(v, 'left-stick-zone')).toBe(true);
  });

  it('fire-mode switch swaps the visuals on the live layer (button ⇄ aim hint)', () => {
    const v = new TouchVisuals();

    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(shown(v, 'fire-button')).toBe(true);
    expect(shown(v, 'aim-hint')).toBe(false);

    // Switch to Manual — the same frame path must swap the affordances.
    v.update(readout({ mode: FireMode.Manual }), true, 1280, 720);
    expect(shown(v, 'fire-button')).toBe(false);
    expect(shown(v, 'aim-hint')).toBe(true);
  });

  it('the idle left ghost hides once a thumb engages the left stick (live base takes over)', () => {
    const v = new TouchVisuals();
    // Idle: ghost visible.
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(shown(v, 'left-stick-zone')).toBe(true);
    // Engaged: ghost gives way to the live base + knob at the landing point.
    v.update(
      readout({
        mode: FireMode.AutoAim,
        left: { engaged: true, origin: { x: 200, y: 600 }, current: { x: 240, y: 600 } },
      }),
      true,
      1280,
      720,
    );
    expect(shown(v, 'left-stick-zone')).toBe(false);
  });

  it('does not throw driving a full Manual engaged frame (knob clamp + placement)', () => {
    const v = new TouchVisuals();
    expect(() =>
      v.update(
        readout({
          mode: FireMode.Manual,
          left: { engaged: true, origin: { x: 150, y: 600 }, current: { x: 400, y: 600 } },
          right: { engaged: true, origin: { x: 1100, y: 600 }, current: { x: 1100, y: 300 } },
        }),
        true,
        1280,
        720,
      ),
    ).not.toThrow();
  });
});

// The anchored affordance rects the layout registry reads (touch controls are
// Platform-owned, so these register with precise, self-computed bounds).
describe('affordanceRects — anchored home rects for the layout registry', () => {
  it('yields nothing on desktop', () => {
    const r = affordanceRects(false, FireMode.AutoAim, 1280, 720);
    expect(r).toEqual({ leftStickZone: null, aimZone: null, fireButton: null });
  });

  it('touch + Auto-aim: left stick zone + FIRE button, no aim zone', () => {
    const r = affordanceRects(true, FireMode.AutoAim, 1280, 720);
    expect(r.leftStickZone).not.toBeNull();
    expect(r.fireButton).not.toBeNull();
    expect(r.aimZone).toBeNull();
    // FIRE button sits in the bottom-right (right half, lower band).
    expect(r.fireButton!.x).toBeGreaterThan(1280 / 2);
    expect(r.fireButton!.y + r.fireButton!.height).toBeLessThanOrEqual(720);
  });

  it('touch + Manual: left stick zone + aim zone, no FIRE button', () => {
    const r = affordanceRects(true, FireMode.Manual, 1280, 720);
    expect(r.leftStickZone).not.toBeNull();
    expect(r.aimZone).not.toBeNull();
    expect(r.fireButton).toBeNull();
    // Left zone in the left half, aim zone in the right half.
    expect(r.leftStickZone!.x).toBeLessThan(1280 / 2);
    expect(r.aimZone!.x).toBeGreaterThan(1280 / 2 - r.aimZone!.width);
  });
});

describe('the BUILD button — the touch E-equivalent (GDD §2.4, §2.5)', () => {
  it('is absent on desktop, where the key is the binding', () => {
    expect(buildButtonRect(false, true, 1280, 720)).toBeNull();
  });

  it('appears only at your own planet — docked is the whole rule (GDD §2.5)', () => {
    expect(buildButtonRect(true, false, 1280, 720)).toBeNull();
    expect(buildButtonRect(true, true, 1280, 720)).not.toBeNull();
  });

  it('is thumb-scale (≥72px across) and stays on screen', () => {
    const r = buildButtonRect(true, true, 390, 720)!;
    expect(r.width).toBeGreaterThanOrEqual(72);
    expect(r.height).toBeGreaterThanOrEqual(72);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    expect(r.y + r.height).toBeLessThanOrEqual(720);
  });

  it('sits clear of the left stick zone it stands above', () => {
    const build = buildButtonRect(true, true, 1280, 720)!;
    const stick = affordanceRects(true, FireMode.AutoAim, 1280, 720).leftStickZone!;
    expect(build.y + build.height).toBeLessThanOrEqual(stick.y);
  });

  it('the Pixi layer shows it only while docked, and where the rect says', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720, /* docked */ false);
    expect(shown(v, 'build-button')).toBe(false);

    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720, /* docked */ true);
    expect(shown(v, 'build-button')).toBe(true);
    const node = v.getChildByLabel('build-button')!;
    const rect = buildButtonRect(true, true, 1280, 720)!;
    expect(node.x).toBeCloseTo(rect.x + rect.width / 2);
    expect(node.y).toBeCloseTo(rect.y + rect.height / 2);
  });
});
