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
 * **a0-74 added a scale.** The camera was translate-only, which meant one world
 * unit was one CSS pixel and the arena a player could see was exactly the pixel
 * width of their screen — the first of the three reports this file's `scale`
 * argument answers. Every entry point takes it as a **defaulted** argument, so an
 * untouched caller gets the shipped translate-only camera unchanged; the ladder of
 * values, and the decision that the control is touch-only, are `@ui/viewport`'s.
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
 * The camera's **scale**: how many CSS pixels one world unit draws as.
 *
 * It was implicitly 1 until a0-74, and that implicit 1 is the whole of the first
 * developer report — *"on pc i have the entire screen but im on mobile im
 * confined to a very small portion of the world"*. With world units pinned to CSS
 * pixels, the slice of the arena a player sees is exactly the pixel size of the
 * glass they hold: 1707 units on a 1707 px desktop, 798 on a 798 px phone, out of
 * a `WORLD_SIZE` of 2400. Nobody decided that ratio; it fell out of the hardware.
 *
 * Every function here takes it as a defaulted argument, so an untouched caller
 * gets exactly the translate-only camera that shipped, byte for byte.
 * `@ui/viewport` owns the ladder of values (`cameraScale`) and the fact that the
 * control is touch-only; this layer only does the arithmetic.
 */
export const DEFAULT_CAMERA_SCALE = 1;

/**
 * Allocation-free camera offset: write into `out` the worldRoot position that
 * puts `target` (world coords) at the visible viewport centre, and return it.
 * The renderer calls this once per frame, so it must not allocate (GDD §4.3,
 * zero per-frame allocation) — hence the reused `out`.
 *
 * `scale` is the world root's scale (see {@link DEFAULT_CAMERA_SCALE}). The target
 * is scaled and the viewport centre is not, because the scale applies to the world
 * container and the centre is a screen fact: `screen = offset + world × scale`, so
 * `offset = centre − target × scale` is what lands the target on the centre.
 */
export function writeCameraOffset(
  out: Vec2,
  target: Vec2,
  vp: Viewport,
  scale: number = DEFAULT_CAMERA_SCALE,
): Vec2 {
  out.x = vp.originX + vp.width / 2 - target.x * scale;
  out.y = vp.originY + vp.height / 2 - target.y * scale;
  return out;
}

/**
 * The worldRoot position that centres `target` on the visible viewport. Convenience
 * (allocating) wrapper over {@link writeCameraOffset} for tests and one-off callers;
 * the per-frame render path uses the `write` form instead.
 */
export function cameraOffset(
  target: Vec2,
  vp: Viewport,
  scale: number = DEFAULT_CAMERA_SCALE,
): Vec2 {
  return writeCameraOffset({ x: 0, y: 0 }, target, vp, scale);
}

/** Project a world point to canvas-local screen (CSS px) given the world offset
 *  and the camera scale — `screen = offset + world × scale`. */
export function worldToScreen(
  world: Vec2,
  offset: Vec2,
  scale: number = DEFAULT_CAMERA_SCALE,
): Vec2 {
  return { x: offset.x + world.x * scale, y: offset.y + world.y * scale };
}

/** The inverse of {@link worldToScreen}: a canvas-local screen point back to
 *  world coordinates. The one place the division lives, so a caller cannot invert
 *  a zoom by hand and get it backwards. */
export function screenToWorld(
  screen: Vec2,
  offset: Vec2,
  scale: number = DEFAULT_CAMERA_SCALE,
): Vec2 {
  const s = scale > 0 && Number.isFinite(scale) ? scale : DEFAULT_CAMERA_SCALE;
  return { x: (screen.x - offset.x) / s, y: (screen.y - offset.y) / s };
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
