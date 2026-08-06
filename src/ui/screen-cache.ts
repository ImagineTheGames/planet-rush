/**
 * src/ui/screen-cache.ts — rasterise a static Gantry/Bone screen once, blit it
 * thereafter. OWNER: UI Engineer (u7-01).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS — measured, not assumed
 * ---------------------------------------------------------------------------
 * The Gantry/Bone material is *stepped*, by design: a plate's face is
 * {@link ../art/materials} `FACE_BANDS` = 24 flat bands, its inner sheen 12
 * nested translucent polygons, its bezel 8, and its cast shadow 12 more that
 * each spread past the plate's own edge. That is what replaces the gradients and
 * the gaussian blur Cold Vacuum forbids, and it is why the screens read as
 * material rather than as a wireframe. It is also ~56 large, overlapping,
 * mostly-translucent polygons **per plate** — around 170 on the title screen and
 * more on settings.
 *
 * Pixi keeps that geometry retained, so it is only *built* on a state change.
 * But it is *painted* every frame regardless, and translucent overdraw at
 * `resolution: devicePixelRatio` with `antialias: true` is precisely what a
 * software rasteriser is worst at. Measured on the iPhone profile (844×390
 * logical, dpr 3 ⇒ a 2532×1170 buffer), against the real preview build:
 *
 *     menu screen, per frame  : ~957 ms   (about one frame per second)
 *     the whole LIVE MATCH    :  ~66 ms
 *
 * The static front door cost fourteen times what the running game costs. On a
 * developer machine that merely wastes a core; on the software-GL CI runner it
 * pegs the page's main thread, and a pegged main thread cannot answer
 * Playwright. That is not a theory about the failure — it is the failure's exact
 * signature in the u7-01 CI run, where `waitForSelector` timed out at 30 s
 * having *already resolved the canvas*:
 *
 *     - waiting for locator('canvas')
 *       - locator resolved to visible <canvas width="2532" height="1170">
 *
 * Every iphone test that booted to the MENU failed that way; every test that
 * booted with `?debug=1` (which skips the menu) passed, including the heavier
 * in-match ones. Eleven failures, four of them in specs this branch never
 * touched.
 *
 * ---------------------------------------------------------------------------
 * THE FIX, AND WHY IT IS THIS ONE
 * ---------------------------------------------------------------------------
 * A menu is a *static* screen: it changes when the player hovers, presses,
 * navigates or resizes — user events, not frames. So it should be rasterised
 * when it changes and blitted the rest of the time, which is exactly what Pixi's
 * `cacheAsTexture` does. The per-frame cost collapses to one textured quad.
 *
 * Nothing is given up for it. The cache is a render of the same display list at
 * the same resolution, with `antialias` carried through so the chamfered plate
 * edges keep the smoothing the direct path gives them — the look is the look,
 * which is the one thing about this direction that is ratified and not mine to
 * trade.
 *
 * The alternative — spending fewer bands — is the wrong lever: the band counts
 * ARE the material, they are a5-01's ratified numbers, and thinning them would
 * make a phone quietly render a different direction than a desktop.
 *
 * Kept deliberately small and screen-agnostic so the three screens still to come
 * (lobby, ship select, build wheel) inherit the same treatment rather than each
 * rediscovering this the hard way.
 */

import type { Container } from 'pixi.js';

/**
 * Caches one container's rasterisation, refreshing it only when the owner says
 * its content changed.
 *
 * Usage is two calls, and getting them the wrong way round is the only way to
 * misuse this: {@link refresh} at the END of a redraw (the children must already
 * carry their new geometry), and {@link invalidate} on a resize (the cached
 * texture is the old size, so it must be dropped rather than updated).
 */
export class ScreenCache {
  private enabled = false;

  constructor(private readonly target: Container) {}

  /**
   * Re-rasterise, having just redrawn the container's children.
   *
   * The first call turns caching on — which itself performs the render — and
   * every later one refreshes the existing texture in place, so a hover does not
   * churn a new render target per pointer event.
   */
  refresh(): void {
    if (!this.enabled) {
      // `antialias` is carried through deliberately: without it the cache would
      // rasterise the chamfered plate edges harder than the direct path does,
      // and the look is what is ratified here.
      this.target.cacheAsTexture({ antialias: true });
      this.enabled = true;
      return;
    }
    this.target.updateCacheTexture();
  }

  /**
   * Drop the cache — the next {@link refresh} builds a new texture.
   *
   * A resize is the case that matters: the cached texture is sized from the
   * bounds it was taken at, so refreshing it in place after the viewport changed
   * would blit a stale-sized screen. Dropping it is also correct (just wasteful)
   * for any other change, which is what makes this the safe call to reach for.
   */
  invalidate(): void {
    if (!this.enabled) return;
    this.target.cacheAsTexture(false);
    this.enabled = false;
  }
}
