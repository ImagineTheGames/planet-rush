/**
 * src/ui/minimap-view.ts — the Pixi layer that draws the minimap. OWNER: UI
 * Engineer (field request v0.2.2). The drawing half of {@link ./minimap}: it
 * paints the scene the pure model projected (dots, collapse ring, ore hints) into
 * the active corner square or centred overlay, and holds nothing but draw state —
 * every *decision* (which dots, what colour, the fit, the toggle) lives in the
 * pure sibling and unit-tests headless.
 *
 * **Low-frequency redraw (GDD §4.3 — field request "every N ticks to an offscreen
 * texture, never per-frame").** The heavy content — planets, enemy ships, ore
 * hints, the collapse ring — is rebuilt into a `cacheAsTexture` container only
 * every {@link MINIMAP_REDRAW_TICKS} ticks (or when the rect/state changes), so a
 * static scene rasterises ~10×/s, not 60. The **local ship's own dot** is the one
 * exception: a single dot redrawn every frame, so it tracks the player's motion
 * smoothly (the per-frame cost the throttle exists to dodge does not apply to one
 * dot). Content and own dot are clipped to the rect by a mask, so nothing spills
 * past the frame — which keeps the registered bounds honest.
 *
 * **Registered on both states.** The layer reports its `bottom-right` corner rect
 * when collapsed and its `full` overlay rect when expanded, through
 * {@link describeLayout}, so "if it's supposed to appear there, it appears there"
 * is a test on both phone profiles ([[layout-registry]]). Bounds come from the
 * real drawn frame border via {@link Container.getBounds} (global/physical space),
 * exactly as the health-bar and nameplate layers do — the layout host un-rotates
 * them into logical space itself (`physicalBoundsToLogical` in main.ts).
 *
 * Palette (style-guide §1/§2): a near-vacuum backdrop with a steel border; owner
 * colours on the dots (the roster resolver [[planet-hp]] shares); signal yellow —
 * the RESERVED ore colour — only on the faint ore hints, which *are* ore; threat
 * red only on the collapse ring, the match's danger state.
 */

import { Container, Graphics } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { playerColor } from './planet-hp';
import {
  fitBounds,
  mapPoint,
  minimapRect,
  minimapScene,
  MINIMAP_DOT_ALPHA,
  MINIMAP_MARGIN,
  MINIMAP_REDRAW_TICKS,
  MINIMAP_SPAWN_PROTECT_ALPHA,
} from './minimap';
import type { MinimapFrame, MinimapInsets, MinimapState } from './minimap';

/** Layout-registry id for the collapsed corner square (GDD §2.2 bottom-right). */
export const MINIMAP_ID = 'minimap';
/** Layout-registry id for the expanded centred overlay. */
export const MINIMAP_EXPANDED_ID = 'minimap-expanded';
/** Collapsed anchor: `bottom-right` (GDD §2.2), margin = the same edge inset the
 *  square is drawn with, so drawing and registration cannot drift. */
export const MINIMAP_ANCHOR: AnchorSpec = { region: 'bottom-right', margin: MINIMAP_MARGIN };
/** Expanded anchor: `full` (a centred overlay is wider than any third-width band —
 *  the same reasoning the onboarding prompt / respawn overlay use), margin-inset
 *  so it stays inside the HUD edge. */
export const MINIMAP_EXPANDED_ANCHOR: AnchorSpec = { region: 'full', margin: MINIMAP_MARGIN };

/** Backdrop opacity — dim enough that the match reads through an expanded overlay
 *  ("the game continues behind it"), solid enough to read the dots on the corner. */
const BACKDROP_ALPHA = 0.72;
const BORDER_ALPHA = 0.55;
const BORDER_WIDTH = 1.5;
const CORNER_RADIUS = 6;
/** Collapse-ring stroke, CSS px. */
const RING_WIDTH = 1.5;

/**
 * What the layer actually drew last frame — read back by the ?debug=1 live-stage
 * seam ({@link MinimapView.debugMinimap}) so a Playwright test can prove, on a
 * REAL boot, that a tap toggles the two states and the own-ship dot tracks the
 * player's motion (the p1a real-input rule). Never written in a normal build.
 */
export interface DrawnMinimap {
  /** True while the overlay is open. */
  expanded: boolean;
  /** The active rect drawn this frame (logical/screen space) — the test taps its
   *  centre to toggle, and asserts the state flipped. */
  rect: Rect;
  /** The local ship's dot centre (screen space), or null when it is dead/absent —
   *  the test moves the ship and asserts this moved across two frames. */
  ownDot: { x: number; y: number } | null;
  /** Counts of the content dots that drew — a cheap "the map is populated" check. */
  planetCount: number;
  shipCount: number;
  oreCount: number;
  /** Whether the collapse ring drew this frame (GDD §2.3). */
  collapseRing: boolean;
}

export class MinimapView extends Container {
  /** The frame border + backdrop — its bounds ARE the registered rect. */
  private readonly frameG = new Graphics();
  /** Everything clipped to the rect (throttled content + the per-frame own dot). */
  private readonly clip = new Container();
  /** The throttled, cached map content (planets, enemy ships, ore, ring). */
  private readonly content = new Graphics();
  /** The local ship's dot — redrawn every frame so it tracks motion. */
  private readonly ownDotG = new Graphics();
  /** Rect mask for {@link clip}. */
  private readonly maskG = new Graphics();
  /** The expanded-overlay close hint (a small ×). Hidden while collapsed. */
  private readonly closeG = new Graphics();

  // --- Throttle state -------------------------------------------------------
  private lastRebuildTick = -Infinity;
  private lastState: MinimapState | null = null;
  private lastRectKey = '';
  private cacheEnabled = false;

  // --- ?debug=1 live-stage capture (cold in a normal build) -----------------
  private debugCapture = false;
  private readonly drawn: DrawnMinimap = {
    expanded: false,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    ownDot: null,
    planetCount: 0,
    shipCount: 0,
    oreCount: 0,
    collapseRing: false,
  };

  constructor() {
    super();
    this.clip.addChild(this.content, this.ownDotG);
    this.clip.mask = this.maskG;
    this.addChild(this.frameG, this.maskG, this.clip, this.closeG);
  }

  /**
   * Draw one frame. `frame` is null before the world exists (the M1 feed) — the
   * whole layer hides then. `tick` drives the content redraw throttle.
   */
  update(
    frame: MinimapFrame | null,
    state: MinimapState,
    viewport: Viewport,
    isTouch: boolean,
    insets: MinimapInsets,
    tick: number,
  ): void {
    if (!frame) {
      this.visible = false;
      return;
    }
    this.visible = true;

    const rect = minimapRect(state, viewport, isTouch, insets);
    const rectKey = `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
    const layoutChanged = rectKey !== this.lastRectKey || state !== this.lastState;

    // The frame chrome + mask follow the rect every frame (cheap: two rects).
    this.drawFrame(rect, state);
    this.drawMask(rect);

    // Throttled content: rebuild the cached texture only every N ticks, or when
    // the rect/state changed (a resize or a toggle — the picture must move now).
    if (layoutChanged || tick - this.lastRebuildTick >= MINIMAP_REDRAW_TICKS) {
      this.rebuildContent(frame, rect, isTouch);
      this.lastRebuildTick = tick;
      this.lastState = state;
      this.lastRectKey = rectKey;
    }

    // The own-ship dot, every frame, off the SAME fit the content used (rect is
    // stable between rebuilds, so this transform matches the cached picture).
    const transform = fitBounds(frame.bounds, rect);
    const local = (frame.ships ?? []).find((s) => s.local && s.alive) ?? null;
    this.ownDotG.clear();
    let ownPos: { x: number; y: number } | null = null;
    if (local) {
      const p = mapPoint(transform, local.x, local.y);
      const size = Math.min(rect.width, rect.height);
      // Match minimapScene's own-ship sizing so the every-frame dot and the
      // throttled scene agree (larger than an enemy dot, outlined = "mine").
      const r = Math.max(1.5, size * 0.026) * 1.55;
      const cx = clamp(p.x, rect.x + r, rect.x + rect.width - r);
      const cy = clamp(p.y, rect.y + r, rect.y + rect.height - r);
      const alpha = local.spawnProtected ? MINIMAP_SPAWN_PROTECT_ALPHA : MINIMAP_DOT_ALPHA;
      this.ownDotG.circle(cx, cy, r).fill({ color: playerColor(local.owner), alpha });
      // Bright outline so the eye finds "me" instantly among the dots.
      this.ownDotG.circle(cx, cy, r + 0.5).stroke({ width: 1, color: PALETTE.plasma, alpha: 0.95 });
      ownPos = { x: cx, y: cy };
    }

    if (this.debugCapture) this.recordDebug(state, rect, ownPos, frame);
  }

  // --- Drawing --------------------------------------------------------------

  private drawFrame(rect: Rect, state: MinimapState): void {
    this.frameG.clear();
    this.frameG
      .roundRect(rect.x, rect.y, rect.width, rect.height, CORNER_RADIUS)
      .fill({ color: PALETTE.vacuum, alpha: BACKDROP_ALPHA });
    // Border inset by the stroke width so the drawn geometry never spills past the
    // fill's bounds — which keeps getBounds() exactly the rect the registry checks.
    const i = BORDER_WIDTH;
    this.frameG
      .roundRect(rect.x + i, rect.y + i, rect.width - 2 * i, rect.height - 2 * i, CORNER_RADIUS - 1)
      .stroke({ width: BORDER_WIDTH, color: PALETTE.hullSteel, alpha: BORDER_ALPHA });

    // A small close hint in the expanded overlay's top-right — the whole overlay
    // collapses on a tap, so this is a legibility cue, not the only target.
    this.closeG.clear();
    if (state === 'expanded') {
      const s = 6;
      const cx = rect.x + rect.width - 12;
      const cy = rect.y + 12;
      this.closeG
        .moveTo(cx - s, cy - s)
        .lineTo(cx + s, cy + s)
        .moveTo(cx + s, cy - s)
        .lineTo(cx - s, cy + s)
        .stroke({ width: 1.5, color: PALETTE.hullSteel, alpha: 0.8 });
    }
  }

  private drawMask(rect: Rect): void {
    this.maskG.clear();
    this.maskG.roundRect(rect.x, rect.y, rect.width, rect.height, CORNER_RADIUS).fill(0xffffff);
  }

  /** Rebuild the throttled content Graphics (everything but the own-ship dot) and
   *  refresh its cache texture. Only reached every {@link MINIMAP_REDRAW_TICKS}. */
  private rebuildContent(frame: MinimapFrame, rect: Rect, isTouch: boolean): void {
    const scene = minimapScene(frame, rect, isTouch);
    const g = this.content;
    g.clear();

    // Faint ore-field hints first (under everything else).
    for (const o of scene.oreDots) g.circle(o.x, o.y, o.radius).fill({ color: o.color, alpha: o.alpha });

    // The collapse ring (GDD §2.3) — threat red, the match's danger state.
    if (scene.collapseRing) {
      g.circle(scene.collapseRing.x, scene.collapseRing.y, scene.collapseRing.radius).stroke({
        width: RING_WIDTH,
        color: scene.collapseRing.color,
        alpha: 0.8,
      });
    }

    // Planets, then enemy ships over them.
    for (const p of scene.planetDots) g.circle(p.x, p.y, p.radius).fill({ color: p.color, alpha: p.alpha });
    for (const s of scene.shipDots) g.circle(s.x, s.y, s.radius).fill({ color: s.color, alpha: s.alpha });

    // Cache the freshly-drawn content to a texture (the "offscreen texture" the
    // field request asks for). Best-effort: guarded so a pre-first-render call or
    // an unsupported path never breaks drawing — the throttle already bought the
    // per-frame saving regardless.
    try {
      if (!this.cacheEnabled) {
        this.content.cacheAsTexture(true);
        this.cacheEnabled = true;
      } else {
        this.content.updateCacheTexture();
      }
    } catch {
      /* caching unavailable this frame — the un-cached Graphics still draws fine */
    }
  }

  // --- ?debug=1 live-stage seam --------------------------------------------

  /** Arm the drawn-state capture so {@link debugMinimap} reports it (main.ts, only
   *  under ?debug=1). Idempotent; a normal build never calls it. */
  enableDebugCapture(): void {
    this.debugCapture = true;
  }

  /** The minimap state the layer actually drew last frame — for the live-stage
   *  test to read the active rect (where to tap), confirm the toggle, and watch
   *  the own-ship dot move. A fresh copy so the caller can't mutate draw state. */
  debugMinimap(): DrawnMinimap {
    return {
      expanded: this.drawn.expanded,
      rect: { ...this.drawn.rect },
      ownDot: this.drawn.ownDot ? { ...this.drawn.ownDot } : null,
      planetCount: this.drawn.planetCount,
      shipCount: this.drawn.shipCount,
      oreCount: this.drawn.oreCount,
      collapseRing: this.drawn.collapseRing,
    };
  }

  private recordDebug(
    state: MinimapState,
    rect: Rect,
    ownDot: { x: number; y: number } | null,
    frame: MinimapFrame,
  ): void {
    const d = this.drawn;
    d.expanded = state === 'expanded';
    d.rect.x = rect.x;
    d.rect.y = rect.y;
    d.rect.width = rect.width;
    d.rect.height = rect.height;
    d.ownDot = ownDot;
    d.planetCount = (frame.planets ?? []).length;
    d.shipCount = (frame.ships ?? []).filter((s) => s.alive && !s.local).length;
    d.oreCount = (frame.oreHints ?? []).length;
    d.collapseRing = !!frame.collapse;
  }

  /**
   * The layer's registry entry — the corner rect when collapsed, the overlay rect
   * when expanded. Bounds via {@link getBounds} (global/physical), un-rotated by
   * the layout host, matching the health-bar / nameplate discipline. Hidden ⇒
   * nothing registers (the registry records only what is drawn).
   */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    const b = this.frameG.getBounds();
    const expanded = this.lastState === 'expanded';
    return [
      {
        id: expanded ? MINIMAP_EXPANDED_ID : MINIMAP_ID,
        anchor: expanded ? MINIMAP_EXPANDED_ANCHOR : MINIMAP_ANCHOR,
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      },
    ];
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
