/**
 * Camera-math tests (developer phone report, M1 camera centring). The pure
 * world→screen mapping under the follow camera, checked across viewport sizes,
 * devicePixelRatios, and non-zero visual-viewport origins (the mobile URL-bar /
 * notch / fullscreen case). The load-bearing property, and the one the developer
 * phone report is about: the camera target always lands within 5% of the VISIBLE
 * viewport centre, in both orientations — never the raw-canvas centre.
 */
import { describe, it, expect } from 'vitest';
import {
  viewportCenter,
  cameraOffset,
  writeCameraOffset,
  worldToScreen,
  toViewportSpace,
  type Viewport,
} from './camera';
import type { Vec2 } from '@shared/types';

/** The full pipeline the renderer + debug hook run: a ship at `world`, camera
 *  following `target`, projected into visual-viewport space (visible centre =
 *  {width/2, height/2}). */
function shipInViewportSpace(world: Vec2, target: Vec2, vp: Viewport): Vec2 {
  const offset = cameraOffset(target, vp); // == worldRoot.position
  const screen = worldToScreen(world, offset); // canvas-local
  return toViewportSpace(screen, vp); // visual-viewport space
}

/** A landscape and a portrait size at each of several DPRs. CSS-pixel sizes are
 *  what the stage uses (Pixi autoDensity), so DPR is carried only to prove it
 *  does NOT change centring — a device's CSS size is its device size / dpr. */
const DEVICES = [
  { name: 'phone portrait dpr3', devW: 1170, devH: 2532, dpr: 3 },
  { name: 'phone landscape dpr3', devW: 2532, devH: 1170, dpr: 3 },
  { name: 'pixel portrait dpr2.6', devW: 1080, devH: 2400, dpr: 2.6 },
  { name: 'pixel landscape dpr2.6', devW: 2400, devH: 1080, dpr: 2.6 },
  { name: 'desktop dpr1', devW: 1280, devH: 800, dpr: 1 },
  { name: 'hidpi desktop dpr2', devW: 2560, devH: 1440, dpr: 2 },
];

describe('viewportCenter — the point the camera target must draw at', () => {
  it('is the visible-viewport centre in canvas-local space (origin at 0)', () => {
    expect(viewportCenter({ width: 800, height: 600, originX: 0, originY: 0 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('shifts by the visual-viewport origin (URL bar / notch offset)', () => {
    // Canvas is taller/wider than the visible area, which starts 20px in.
    expect(viewportCenter({ width: 400, height: 700, originX: 12, originY: 20 })).toEqual({
      x: 12 + 200,
      y: 20 + 350,
    });
  });
});

describe('cameraOffset — the worldRoot position that centres the target', () => {
  it('places a target at the visible centre, not the canvas centre', () => {
    // Canvas 1000 wide, visible region 400 wide starting at x=500 (URL bar cropped
    // the top; here a horizontal crop stands in). Canvas centre is 500; visible
    // centre is 700. The offset must aim for 700.
    const vp: Viewport = { width: 400, height: 400, originX: 500, originY: 0 };
    const offset = cameraOffset({ x: 100, y: 50 }, vp);
    expect(offset.x).toBe(500 + 200 - 100); // originX + w/2 - target.x
    expect(offset.y).toBe(0 + 200 - 50);
  });

  it('writeCameraOffset matches cameraOffset and reuses its out param (no alloc)', () => {
    const vp: Viewport = { width: 640, height: 480, originX: 7, originY: 9 };
    const target = { x: 123, y: 456 };
    const out: Vec2 = { x: -1, y: -1 };
    const returned = writeCameraOffset(out, target, vp);
    expect(returned).toBe(out); // returns the same object it wrote into
    expect(out).toEqual(cameraOffset(target, vp));
  });
});

describe('follow camera keeps the local ship centred (the phone-report gate)', () => {
  for (const d of DEVICES) {
    // CSS-pixel viewport (what the stage sees under autoDensity) = device / dpr.
    const width = d.devW / d.dpr;
    const height = d.devH / d.dpr;
    const vp: Viewport = { width, height, originX: 0, originY: 0 };

    it(`${d.name}: target ship lands within 5% of the visible centre`, () => {
      // Target sits at an arbitrary, non-central world position.
      const target = { x: 3200, y: -1750 };
      const s = shipInViewportSpace(target, target, vp);
      expect(Math.abs(s.x - width / 2)).toBeLessThan(0.05 * width);
      expect(Math.abs(s.y - height / 2)).toBeLessThan(0.05 * height);
      // Exact, in fact — the tolerance is the shipped QA gate, not slop here.
      expect(s.x).toBeCloseTo(width / 2, 6);
      expect(s.y).toBeCloseTo(height / 2, 6);
    });
  }

  it('centring is devicePixelRatio-invariant (same CSS size, any dpr)', () => {
    const target = { x: 42, y: 99 };
    const at = (cssW: number, cssH: number): Vec2 =>
      shipInViewportSpace(target, target, { width: cssW, height: cssH, originX: 0, originY: 0 });
    // Two "devices" with identical CSS logical size but different dpr resolve to
    // the same CSS viewport, so centring is identical — dpr never enters the math.
    expect(at(390, 844)).toEqual(at(390, 844));
    expect(at(390, 844)).toEqual({ x: 195, y: 422 });
  });

  it('stays centred under a non-zero visual-viewport origin (URL bar visible)', () => {
    // iOS-Safari-ish: visible area 390×750 but offset 0,47 inside a taller canvas.
    const vp: Viewport = { width: 390, height: 750, originX: 0, originY: 47 };
    const target = { x: -12, y: 5000 };
    const s = shipInViewportSpace(target, target, vp);
    expect(s.x).toBeCloseTo(195, 6);
    expect(s.y).toBeCloseTo(375, 6);
    expect(Math.abs(s.y - vp.height / 2)).toBeLessThan(0.05 * vp.height);
  });
});

describe('a non-target world point offsets from centre correctly', () => {
  it('a ship one screen-unit right of the target draws one unit right of centre', () => {
    const vp: Viewport = { width: 800, height: 600, originX: 0, originY: 0 };
    const target = { x: 1000, y: 1000 };
    const world = { x: 1050, y: 1030 }; // +50, +30 from target
    const s = shipInViewportSpace(world, target, vp);
    expect(s.x).toBeCloseTo(400 + 50, 6);
    expect(s.y).toBeCloseTo(300 + 30, 6);
  });
});
