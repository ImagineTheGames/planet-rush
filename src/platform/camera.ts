/**
 * src/platform/camera.ts — the follow-camera math. OWNER: Platform Engineer.
 *
 * Pure, DOM-free, and unit-tested (camera.test.ts): the single source of truth
 * for turning a world-space point into an on-screen point under the follow
 * camera, so both the renderer (which offsets its world container) and the debug
 * instrument (debug-hook.ts, which reports the ship's screen position for QA)
 * agree exactly.
 *
 * The subtlety this file exists to solve (developer phone report, M1): the ship
 * was drawn at the *canvas* centre, which is NOT the *visible viewport* centre on
 * mobile. The canvas is sized to the layout viewport (`resizeTo: window`) but the
 * area the player actually sees is the **visual viewport** — cropped by the URL
 * bar, pushed under a notch by `env(safe-area-inset-*)`, and shifted again during
 * fullscreen transitions. On desktop the two coincide; on a phone they do not, so
 * centring on the canvas leaves the ship visibly off to one side.
 *
 * Coordinate spaces (all CSS pixels — under Pixi `autoDensity` the stage is in
 * CSS px, so devicePixelRatio never enters this math; centring is DPR-invariant):
 *   - **world**        : sim coordinates.
 *   - **canvas-local** : relative to the render canvas's top-left. worldRoot is
 *                        offset in this space; screen = worldRoot + world.
 *   - **viewport**     : relative to the *visual* viewport's top-left, where the
 *                        visible centre is exactly {width/2, height/2}. This is
 *                        the space the debug hook reports `shipScreen` in.
 * A {@link Viewport} carries the visual viewport's size plus its origin within
 * the canvas, which is all the bridge between those spaces needs.
 */

import type { Vec2 } from '@shared/types';

/**
 * The visible drawing area, in CSS pixels, described in the render canvas's own
 * coordinate space (0,0 = canvas top-left).
 *
 * `width`/`height` are the **visual** viewport size — what the player actually
 * sees. `originX`/`originY` place the visual viewport's top-left within the
 * canvas: where the canvas overflows past the URL bar or is pushed under a notch,
 * the visible region starts partway into the canvas and these are non-zero. On
 * desktop the canvas *is* the visible area, so this is `{ width, height, 0, 0 }`.
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
}

/**
 * The centre of the *visible* viewport, in canvas-local CSS px — the point the
 * camera target must be drawn at for the ship to read as centred on screen.
 */
export function viewportCenter(vp: Viewport): Vec2 {
  return { x: vp.originX + vp.width / 2, y: vp.originY + vp.height / 2 };
}

/**
 * Allocation-free camera offset: write into `out` the worldRoot position that
 * puts `target` (world coords) at the visible viewport centre, and return it.
 * The renderer calls this once per frame, so it must not allocate (GDD §4.3,
 * zero per-frame allocation) — hence the reused `out`.
 */
export function writeCameraOffset(out: Vec2, target: Vec2, vp: Viewport): Vec2 {
  out.x = vp.originX + vp.width / 2 - target.x;
  out.y = vp.originY + vp.height / 2 - target.y;
  return out;
}

/**
 * The worldRoot position that centres `target` on the visible viewport. Convenience
 * (allocating) wrapper over {@link writeCameraOffset} for tests and one-off callers;
 * the per-frame render path uses the `write` form instead.
 */
export function cameraOffset(target: Vec2, vp: Viewport): Vec2 {
  return writeCameraOffset({ x: 0, y: 0 }, target, vp);
}

/** Project a world point to canvas-local screen (CSS px) given the world offset. */
export function worldToScreen(world: Vec2, offset: Vec2): Vec2 {
  return { x: offset.x + world.x, y: offset.y + world.y };
}

/**
 * Re-express a canvas-local screen point in **visual-viewport** space, where the
 * visible centre is `{width/2, height/2}`. This is the space the debug instrument
 * reports `shipScreen` in (debug-hook.ts), so QA can assert the local ship is
 * within 5% of `{width/2, height/2}` in both orientations.
 */
export function toViewportSpace(screen: Vec2, vp: Viewport): Vec2 {
  return { x: screen.x - vp.originX, y: screen.y - vp.originY };
}
