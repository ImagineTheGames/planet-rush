/**
 * src/ui/menu-backdrop.ts — the void, behind the menus. OWNER: UI Engineer (a0-79).
 *
 * Developer, 2026-08-17: *"I'd like to see a space background on every menu
 * screen (the main title screen already has it, id like it to persist
 * throughout)"*.
 *
 * ---------------------------------------------------------------------------
 * ONE STAR FIELD, NOT TWO
 * ---------------------------------------------------------------------------
 * The void belonged to the MATCH renderer (`src/render/index.ts`), so the moment
 * a player left the title gate the game's own sky disappeared and every menu was
 * a flat `PALETTE.vacuum` panel with nothing behind it. The obvious cheap fix —
 * paint a second star field, in CSS or in a local `Graphics` — is the one thing
 * this file exists NOT to do. The bloom took five rounds precisely because the
 * instruments and the game disagreed about what the sky was; a second field with
 * its own radii, its own alphas and its own drift would build that disagreement
 * into the product on purpose, and every future change to the void would have to
 * be made twice by somebody who remembered there were two.
 *
 * So this is {@link ../art/backdrop} `VoidBackdrop`, driven through its real API
 * — `setMap` / `configure` / `update` / `destroy` — and nothing else. One star
 * field, one set of numbers, one thing to fix when the design moves.
 *
 * ---------------------------------------------------------------------------
 * A MENU IS STATIC, SO IT PAYS FOR A STILL FRAME (a0-79 × a0-75)
 * ---------------------------------------------------------------------------
 * a0-75 measured the void's per-pixel cost and its counted fill: **2.33 blended
 * screenfuls per frame**, after its own sky-cache fix, and 61–95% of the whole
 * frame in a live match. That is the bill for a sky that *moves* — a camera
 * offset arrives every frame and every layer re-composites at its parallax.
 *
 * A menu has no camera. Nothing behind a settings panel moves, ever, so paying a
 * moving sky's bill there would be spending a0-75's saving on a screen where
 * nobody can see the difference. This takes the treatment the brief authorises
 * for a static screen — **a still frame**:
 *
 *  - `configure` + `update` run once per RESIZE, never per frame;
 *  - the whole assembled void is then rasterised once ({@link Container.cacheAsTexture},
 *    the same mechanism {@link ./screen-cache} already uses on every menu screen)
 *    and blitted thereafter.
 *
 * Per-frame cost collapses from 2.33 blended screenfuls to **one opaque textured
 * quad** — measurably cheaper than the live void and cheaper than the flat
 * `Graphics` rect it replaces, because that rect was a full-screen fill too.
 * `evidence/a0-79-menus/` carries the counted fill and the measured milliseconds
 * at 798×384 and 3440×1440.
 *
 * {@link MENU_BAKE_MAX_TEXELS} is the one number that is this file's own, and it
 * is a memory budget rather than a look: see its docstring.
 */

import { Container, Rectangle } from 'pixi.js';
import { MAP_NEBULA, VoidBackdrop } from '../art/backdrop';
import type { MapId, NebulaId } from '../art/backdrop';

/**
 * **The menus' sky: Patina Drift.**
 *
 * Not a coin toss and not the default. The title gate — the screen the developer
 * says already has the background, and the one every player sees first — washes
 * its own canvas star field with `PALETTE.patina` at α ≤ 0.09
 * ({@link ./title-gate} `NEBULA`). Patina Drift is the game's teal sky, so the
 * doorway opens onto a menu whose sky is the same hue the door was painted in
 * rather than a jump cut to a different one.
 *
 * The default would have been the wrong answer on its own terms, too: the
 * default map is `octagon` and `octagon`'s sky is **`none`**, so a menu that
 * simply took whatever `VoidBackdrop` starts with would have got stars on a
 * ground and no sky at all.
 */
export const MENU_SKY: NebulaId = 'patinaDrift';

/**
 * The map whose sky the menus fly under.
 *
 * `VoidBackdrop`'s public way to choose a sky is `setMap`, and that is the API
 * this file is required to use rather than reaching past it — so the menu names
 * a map, and `menu-backdrop.test.ts` pins {@link MAP_NEBULA}`[MENU_SKY_MAP]` to
 * {@link MENU_SKY}. A re-assignment in the map/sky registry can therefore not
 * silently change what the front of the game looks like; it fails a test that
 * says which sky was chosen and why.
 */
export const MENU_SKY_MAP: MapId = 'diamond';

/**
 * The texel ceiling on the baked still frame — a MEMORY budget, in the same
 * shape (and for the same reason) as a0-75's `SKY_CACHE_MAX_TEXELS`.
 *
 * The bake is one texture the size of the viewport, and a viewport can be very
 * large: an ultrawide at dpr 2 is 6880×2880, which is 19.8 Mtexels and **79 MB**
 * of RGBA for a background. Above this ceiling the bake drops resolution rather
 * than memory — which is the right way round, because what is in the texture is
 * a near-black ground, a low-frequency sky and a scatter of 1–2px stars, and
 * a0-75 already established that this sky survives being cached at ⅓ and ⅙.
 *
 * 4 Mtexels ⇒ 16 MB. It leaves every phone and every ordinary desktop baking at
 * full device resolution (a dpr-3 798×384 phone is 2.76 Mtexels) and only bites
 * on very large or very dense viewports, where it lands at ~0.9 of CSS
 * resolution — a reduction nothing in this content can show.
 */
export const MENU_BAKE_MAX_TEXELS = 4_000_000;

/**
 * The resolution the still frame is baked at: the renderer's own, unless that
 * would spend more than {@link MENU_BAKE_MAX_TEXELS}.
 *
 * Exported because it is the number the evidence quotes, and a number nobody can
 * recompute is a number nobody can check.
 */
export function menuBakeResolution(width: number, height: number, deviceResolution: number): number {
  const pixels = Math.max(1, width * height);
  const budgeted = Math.sqrt(MENU_BAKE_MAX_TEXELS / pixels);
  // Never below a quarter: past that the ceiling has stopped protecting memory
  // and started deciding what the sky looks like, which is not its job.
  return Math.max(0.25, Math.min(Math.max(0.01, deviceResolution), budgeted));
}

/**
 * Whether the menus get the void at all — `?sky=0` turns it off and nothing else.
 *
 * It exists for the same reason `?gate=0` does: so a measurement can be an **A/B
 * in one page, under one load**, rather than two bundles timed minutes apart on
 * a box whose noise floor moves. a0-75 lost a whole sweep to exactly that (an
 * "after" run read 183 ms where "before" read 133, purely from a concurrent
 * build), and the honest answer to *"what does the menu backdrop cost per
 * frame"* is the difference between two samples taken back to back with only
 * this flag between them — which is what `evidence/a0-79-menus/` does.
 *
 * Default is ON, and the read is a single `URLSearchParams` lookup at shell
 * open: it is one `if` in `src/main.ts` and it drops cleanly.
 */
export function menuSkyEnabled(search: string): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get('sky') !== '0';
}

/**
 * The void, behind a stack of static menu screens.
 *
 * Add it to the menu shell's root **before** the screens, {@link resize} it on
 * every viewport change, and {@link destroy} it with the shell. There is
 * deliberately no per-frame call: that is the whole design (see the header).
 */
export class MenuBackdrop extends Container {
  private readonly backdrop = new VoidBackdrop();
  /** The viewport the still frame was baked for; `-1` = never baked. */
  private bakedW = -1;
  private bakedH = -1;
  /** The renderer resolution to bake at — the device's, handed in by the shell. */
  private resolution: number;

  constructor(deviceResolution = 1) {
    super();
    this.label = 'menu-backdrop';
    this.resolution = deviceResolution;
    this.backdrop.setMap(MENU_SKY_MAP);
    this.addChild(this.backdrop.view);
  }

  /**
   * Build (or rebuild) the still frame for a viewport. A no-op when nothing
   * changed, so the shell may call it from `relayout()` without thinking.
   *
   * The arena bounds handed to `configure` are **the viewport itself**. A match
   * passes the real arena because the camera roams it and the parallax layers
   * have to cover wherever it goes; a menu's camera never moves, so asking for a
   * field wider than the screen would buy nothing and cost geometry and bake
   * time. (`coverSpan` still provisions its own slack on top — that is the
   * backdrop's business, not this file's.)
   */
  resize(width: number, height: number, deviceResolution = this.resolution): void {
    const w = Math.max(0, Math.round(width));
    const h = Math.max(0, Math.round(height));
    if (w === this.bakedW && h === this.bakedH && deviceResolution === this.resolution) return;
    this.bakedW = w;
    this.bakedH = h;
    this.resolution = deviceResolution;

    // Drop the old bake FIRST: it is a texture sized for the old viewport, and
    // refreshing it in place would blit a stale-sized screen — the same rule
    // {@link ./screen-cache} `invalidate` keeps, for the same reason.
    if (this.isCachedAsTexture) this.cacheAsTexture(false);
    if (w <= 0 || h <= 0) return;

    this.backdrop.configure(w, h, w, h);
    // The one and only positioning call. `(0, 0)` is the camera offset a screen
    // with no camera has; every layer therefore lands centred on the viewport.
    this.backdrop.update(0, 0, w, h);

    // **Bake the SCREEN, not the field.** The parallax layers are provisioned to
    // cover a camera that roams, so the container's natural bounds are several
    // screens across — and `cacheAsTexture` sizes its texture from
    // `getLocalBounds()`. Declaring the bounds as the viewport crops the bake to
    // exactly what can be seen; without it the still frame would be ~7× the
    // texture for no extra pixel on the glass.
    this.boundsArea = new Rectangle(0, 0, w, h);
    this.cacheAsTexture({
      resolution: menuBakeResolution(w, h, deviceResolution),
      // Carried through deliberately, exactly as `./screen-cache` does: the
      // stars are discs with real edges, and rasterising them harder than the
      // direct path would make the menu's sky a different sky from the match's.
      antialias: true,
    });
  }

  /** The sky currently built — the read-back the evidence and the tests use. */
  get nebulaId(): NebulaId {
    return this.backdrop.nebulaId;
  }

  /** Whether a still frame is on the stage. */
  get baked(): boolean {
    return this.isCachedAsTexture;
  }

  /**
   * Drop the bake and every layer under it.
   *
   * `cacheAsTexture(false)` before the backdrop's own `destroy()` is not
   * tidiness — a cached render group holds a pooled `RenderTexture`, and tearing
   * the container down with the cache still on leaves that texture in the pool
   * keyed to a render group that no longer exists. a0-75 hit exactly this on the
   * match backdrop; a window being dragged is the input that turns it into a
   * leak, and a menu is the screen most likely to be open while that happens.
   */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.isCachedAsTexture) this.cacheAsTexture(false);
    this.backdrop.destroy();
    this.bakedW = -1;
    this.bakedH = -1;
    super.destroy(options);
  }
}
