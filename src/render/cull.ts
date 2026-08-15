/**
 * src/render/cull.ts — the viewport cull. OWNER: Platform Engineer.
 *
 * a1-10 measured it and a1-11 re-measured it after the pooling landed: the
 * renderer submits **the whole arena, every frame**, however little of it the
 * player can see. `docs/atlas-pooling-measured.md` §4.1 put a number on the gap
 * — on the GDD §4.3 stress scene a 1280×800 desktop window contains 75 of the
 * 200 rocks, and a **844×390 landscape phone contains 6**. Two hundred rocks
 * submitted to show six, on the device that can least afford it.
 *
 * This file is the arithmetic that decides which ones. It is deliberately pure,
 * DOM-free and PixiJS-free, for the same reason `camera.ts` is: the cull and the
 * camera have to agree *exactly* about where the screen is, and the cheapest way
 * to guarantee that is for the cull to be a function of the camera's own output.
 *
 * ## Visibility, never existence
 *
 * The one rule this whole change rests on: **an entity is culled only when it
 * cannot contribute a pixel.** An entity partly on screen is on screen; a shot
 * in flight toward the edge is on screen. So every test below is against the
 * body's *drawn* extent — its collision radius scaled by the half-extent its art
 * is authored at ({@link RENDER_EXTENT}) — and not against its centre. Get that
 * wrong in the safe direction and you draw a rock nobody sees; get it wrong in
 * the other and something pops at the edge of the screen, which is the bug this
 * module is most likely to introduce and the reason the frozen-scene goldens are
 * the alarm on it.
 *
 * ## The camera is the source of truth
 *
 * {@link writeVisibleWorld} takes the camera offset the renderer just wrote
 * (`writeCameraOffset`) and the same {@link Viewport} the camera centred on, and
 * inverts one line of arithmetic: a world point `x` draws at `offset.x + x` in
 * canvas-local CSS px, and the *visible* region of the canvas is
 * `[originX, originX + width]` (the visual viewport — cropped by a URL bar,
 * shifted under a notch; see camera.ts). There is no second notion of "on
 * screen" anywhere in this layer, and there must not be: the debug seam
 * (`?debug=1`) reports that same viewport, so QA and the cull are reading one
 * rectangle.
 *
 * The camera is translate-only (no zoom), so world units are CSS px and the
 * inverse is a subtraction. If a zoom is ever added, this file is where it lands.
 */

import type { Vec2 } from '@shared/types';
import type { Viewport } from '@platform/camera';

/**
 * The slice of the world the player can currently see, in **world units**.
 *
 * Mutable and reused: the renderer keeps exactly one and rewrites it per frame,
 * so the hot path allocates nothing (GDD §4.3).
 */
export interface CullBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A fresh, empty box. For construction and tests — never per frame. */
export function cullBox(): CullBox {
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

/**
 * Write into `out` the world-space rectangle the visible viewport covers, given
 * the camera offset the renderer applied to its world root this frame. Returns
 * `out`; allocates nothing.
 *
 * `offset` is what `writeCameraOffset` produced, i.e. the world root's position
 * in canvas-local CSS px. Inverting it is the whole derivation:
 *
 *     screen = offset + world     ⇒     world = screen - offset
 *
 * and the visible screen span is `[origin, origin + size]`. Taking the offset
 * rather than re-deriving it from the camera target is deliberate: it makes the
 * cull a function of *where the world actually got drawn*, so the two can never
 * drift apart the way a recomputed ideal would.
 */
export function writeVisibleWorld(out: CullBox, offset: Vec2, vp: Viewport): CullBox {
  out.left = vp.originX - offset.x;
  out.top = vp.originY - offset.y;
  out.right = out.left + vp.width;
  out.bottom = out.top + vp.height;
  return out;
}

/**
 * Does a body of drawn radius `reach`, centred at `(x, y)` in world units, touch
 * the visible rectangle?
 *
 * Inclusive on every edge, so a body exactly grazing the boundary counts as
 * visible. `reach` is the **drawn** half-extent, not the collision radius — see
 * {@link RENDER_EXTENT}.
 */
export function touchesBox(box: CullBox, x: number, y: number, reach: number): boolean {
  return (
    x + reach >= box.left && x - reach <= box.right && y + reach >= box.top && y - reach <= box.bottom
  );
}

/**
 * Does the segment `(ax, ay) → (bx, by)`, stroked `reach` wide either side,
 * touch the visible rectangle?
 *
 * This is the segment's own bounding box against the viewport, which is
 * **conservative**: a long diagonal whose box clips a corner it does not itself
 * cross is kept. That is the correct direction to be wrong in, and a muzzle
 * flash is one line — a shipped exact segment/rect intersection would buy back
 * a handful of strokes a frame and add a failure mode where a flash blinks off
 * near a corner.
 */
export function segmentTouchesBox(
  box: CullBox,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  reach: number,
): boolean {
  const left = (ax < bx ? ax : bx) - reach;
  const right = (ax > bx ? ax : bx) + reach;
  const top = (ay < by ? ay : by) - reach;
  const bottom = (ay > by ? ay : by) + reach;
  return right >= box.left && left <= box.right && bottom >= box.top && top <= box.bottom;
}

/**
 * How far each entity layer's art reaches past the collision radius the sim
 * gives it — the padding the brief asks for, stated per layer rather than as one
 * global fudge so each number can be checked against the generator it came from.
 *
 * Every entity in these layers is drawn by scaling a sprite authored in
 * `../art/shapes` unit space, where the art's own `extent` is its half-width.
 * The renderer lands unit radius `1` on the body's collision radius, so the
 * **drawn half-extent is `extent · radius`** and the honest pad for a body is
 * its own radius times the largest `extent` any look in its layer declares.
 *
 * These are upper bounds over every look the game can produce, and `cull.test.ts`
 * enumerates the generators and fails if one ever grows past its entry here — so
 * a wider muzzle telegraph or a fatter shot halo cannot silently start clipping
 * at the screen edge. Bounds, not exact values: over-padding draws something
 * nobody sees, under-padding pops.
 */
export const RENDER_EXTENT = {
  /** `asteroidSprite` — authored at exactly 1; the silhouette is the extent. */
  rock: 1,
  /** `turretSprite` — `max(1.1, muzzle reach + 0.08)`; a firing Mk III is the
   *  widest, because the extent deliberately tracks the muzzle flash. */
  turret: 2.2,
  /**
   * `shotSprite` — **1.48 → 11.68 (a0-46)**, the single largest number in this
   * table and the one most worth understanding.
   *
   * A shot used to be a disc whose glow overhung its collider by half. It is now
   * a laser bolt: the tip sits 1.43 radii ahead of the projectile's centre and
   * the tail runs 6.83 radii *behind* it at the top DAMAGE rung, with the
   * trail's bloom reaching half again past that. So a shot whose CENTRE is a
   * dozen radii off screen can still be painting its tail across the window, and
   * culling on the centre — or on the old 1.48 — would chop a bolt off at the
   * screen edge in the one situation the player is most likely to be watching it:
   * incoming fire.
   *
   * The number is the widest `shotSprite(*, *).extent`, which is the top rung's
   * (the tail's bloom grows with the rung), and `cull.test.ts` walks every family
   * and rung against it. It costs a shot near the edge a larger reach test and
   * nothing else — the layer's expensive dimension is fill, not the cull.
   */
  shot: 11.68,
  /** `shipSprite` — the widest hull in the roster (`HULLS[*].extent`). */
  ship: 1.16,
  /** `shieldSprite` — the bubble plus its gauge band. */
  shield: 1.15,
  /** `oreChunkSprite` — the findability halo overhangs the collider (a0-41; it
   *  was `1` while the chunk was a flat `Graphics` disc drawn at exactly its
   *  radius, and the sprite has declared 1.05 the whole time). */
  chunk: 1.05,
} as const;

/**
 * Slop multiplied onto every reach before the test.
 *
 * The pooled layers bake with a `BAKE_MARGIN` of transparent texels around the
 * declared extent (`index.ts`) so a hairline stroke on the boundary is not
 * clipped, and the sprite scales by the *nominal* size — so the drawn quad is
 * that fraction wider than `extent · radius`. Applying it to the un-pooled
 * layers too costs a rock or two of over-draw and removes a whole class of
 * "which layers bake?" reasoning from the cull.
 */
export const CULL_SLOP = 1.08;

/** The drawn half-extent of a body: its collision radius, scaled by the widest
 *  look its layer can wear, plus the bake slop. */
export function reachOf(radius: number, extent: number): number {
  return radius * extent * CULL_SLOP;
}
