/**
 * src/platform/orientation.ts — the landscape lock. OWNER: Platform Engineer.
 *
 * Planet Rush IS landscape on mobile, always (field report v0.1.1, ratified by
 * the developer): a phone held in portrait must still show a landscape game, and
 * turning the phone must never strand the layout. Browsers won't grant a raw
 * orientation lock outside fullscreen/installed-PWA, so the lock is built in
 * layers, all routed through the platform seam so no game code touches a bare
 * browser global (GDD §4.1, mobile amendment §2):
 *
 *  - **Native first:** {@link requestLandscape} enters fullscreen and locks to
 *    landscape where the browser allows it (Android Chrome; best-effort, never
 *    throws). The installed PWA is locked for free by `"orientation": "landscape"`
 *    in the manifest.
 *  - **CSS/canvas fallback everywhere else:** when a mobile viewport is portrait,
 *    the game's root container is **rotated 90°** and its width/height swapped, so
 *    the player sees a landscape game regardless of how the phone is held. This
 *    REPLACES the old ROTATE-YOUR-DEVICE overlay — the player is never asked to
 *    turn the phone.
 *
 * The rotation is a pure geometric contract ({@link computeRootTransform}): it
 * maps a **logical** (always-landscape) viewport onto the **physical** (possibly
 * portrait) canvas as a proper 90° rotation, edge-to-edge with no letterboxing.
 * Game code — camera, HUD, touch sticks, the layout registry, the debug hook —
 * works entirely in the logical viewport; only the DOM edge (pointer input) and
 * the one `applyRootTransform` call ever touch physical space. Point mapping in
 * both directions ({@link physicalToLogical} / {@link logicalToPhysical}) is the
 * bridge, and it is what keeps a physical tap landing on the logical control the
 * player sees (the part that silently breaks — tested explicitly).
 */

import type { Vec2 } from '@shared/types';
import type { Platform } from './platform';

// ---------------------------------------------------------------------------
// The root transform — the pure landscape-lock geometry
// ---------------------------------------------------------------------------

/**
 * How the logical (always-landscape) viewport is placed onto the physical canvas.
 *
 * `rotated` is false on desktop and on any already-landscape viewport: logical and
 * physical coincide and every field below is an identity. It is true only on a
 * mobile viewport held in portrait, where the game root is rotated 90° clockwise
 * and its dimensions swapped.
 *
 * `rotation`/`x`/`y` are exactly the Pixi container transform that realises it
 * ({@link applyRootTransform}); `logicalWidth`/`logicalHeight` are the viewport
 * every other module lays out against.
 */
export interface RootTransform {
  /** Whether the root is rotated (mobile viewport held portrait). */
  readonly rotated: boolean;
  /** Logical viewport width — always the LONGER edge on mobile (landscape). */
  readonly logicalWidth: number;
  /** Logical viewport height — always the SHORTER edge on mobile (landscape). */
  readonly logicalHeight: number;
  /** Root container rotation, radians (0 or +π/2). */
  readonly rotation: number;
  /** Root container position x (CSS px). */
  readonly x: number;
  /** Root container position y (CSS px). */
  readonly y: number;
}

/**
 * Compute the root transform for a physical canvas of `physW × physH`.
 *
 * On a mobile viewport held portrait (`physH > physW`) the game is rotated +90°
 * so the logical viewport is landscape (`physH × physW`); the +π/2 rotation about
 * the origin lands the logical rect in `[-logicalHeight, 0] × [0, logicalWidth]`,
 * so translating x by `physW` (= logicalHeight) tucks it exactly onto the physical
 * canvas — a bijection, no gaps. Everywhere else (desktop, or any landscape
 * viewport) it is the identity.
 *
 * Pure — no DOM, no Pixi — so the whole lock unit-tests headless.
 */
export function computeRootTransform(physW: number, physH: number, isMobile: boolean): RootTransform {
  if (isMobile && physH > physW) {
    return {
      rotated: true,
      logicalWidth: physH,
      logicalHeight: physW,
      rotation: Math.PI / 2,
      x: physW,
      y: 0,
    };
  }
  return { rotated: false, logicalWidth: physW, logicalHeight: physH, rotation: 0, x: 0, y: 0 };
}

/** The minimal Pixi-container surface {@link applyRootTransform} writes — a
 *  structural type so the pure module never imports PixiJS (a real `Container`
 *  satisfies it; a test double is a plain object). */
export interface Rotatable {
  rotation: number;
  readonly position: { set(x: number, y: number): void };
}

/** Apply a {@link RootTransform} to the game's root container. The one place the
 *  rotation reaches physical space (everything under the root is drawn in logical
 *  coords and rotated into place for free). */
export function applyRootTransform(root: Rotatable, t: RootTransform): void {
  root.rotation = t.rotation;
  root.position.set(t.x, t.y);
}

/**
 * Map a **physical** canvas point (CSS px, canvas-local) to its **logical**
 * (landscape) point — the remap every touch/pointer sample crosses so a physical
 * tap reaches the game as the rotated logical point (sticks, FIRE, wheel, menu
 * taps). Identity when not rotated. Allocation-light (one Vec2); pointer input is
 * not the sim hot loop.
 */
export function physicalToLogical(px: number, py: number, t: RootTransform): Vec2 {
  if (!t.rotated) return { x: px, y: py };
  // Inverse of the +π/2 rotation: lx = py, ly = physW − px (physW = t.x).
  return { x: py, y: t.x - px };
}

/**
 * Map a **logical** (landscape) point back to its **physical** canvas point — the
 * inverse of {@link physicalToLogical}. Used to place a logical control's screen
 * rect back in physical space (e.g. so a test can tap the physical spot a logical
 * button occupies). Identity when not rotated.
 */
export function logicalToPhysical(lx: number, ly: number, t: RootTransform): Vec2 {
  if (!t.rotated) return { x: lx, y: ly };
  // px = physW − ly (physW = t.x); py = lx.
  return { x: t.x - ly, y: lx };
}

// ---------------------------------------------------------------------------
// First-gesture landscape request (native Android path)
// ---------------------------------------------------------------------------

/**
 * On the first touch gesture: enter fullscreen, then lock to landscape. Both go
 * through the platform seam and swallow their own rejections, so this never
 * throws into the gesture handler (mobile amendment §2). Fire-and-forget — where
 * the native lock is unavailable (iOS Safari) it is a no-op and the CSS rotation
 * fallback ({@link computeRootTransform}) carries the landscape lock instead.
 */
export function requestLandscape(platform: Platform): void {
  void platform
    .requestFullscreen()
    .then(() => platform.lockOrientation('landscape'))
    .catch(() => {
      /* both calls already degrade to no-ops; this guards the chain itself */
    });
}
