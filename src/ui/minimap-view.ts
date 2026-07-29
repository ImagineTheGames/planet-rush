/**
 * src/ui/minimap-view.ts — the Pixi layer that draws the minimap. OWNER: UI
 * Engineer (field request v0.2.2). The drawing half of {@link ./minimap}: it
 * paints the scene the pure model projected (dots, collapse ring, ore hints) into
 * the active corner square or centred overlay, and holds nothing but draw state —
 * every *decision* (which dots, what colour, the fit, the toggle) lives in the
 * pure sibling and unit-tests headless.
 *
 * **Low-frequency redraw (GDD §4.3 — field request "every N ticks … never
 * per-frame").** The heavy content — stations, enemy ships, ore hints, the collapse
 * ring — is re-tessellated into its `content` Graphics only every
 * {@link MINIMAP_REDRAW_TICKS} ticks (or when the rect/state changes), so a static
 * scene rebuilds ~10×/s, not 60. The **local ship's own dot** is the one
 * exception: a single dot redrawn every frame, so it tracks the player's motion
 * smoothly (the per-frame cost the throttle exists to dodge does not apply to one
 * dot). Content and own dot are clipped to the rect by a mask, so nothing spills
 * past the frame — which keeps the registered bounds honest. (The field request
 * also suggested caching that content to an *offscreen texture*; we deliberately do
 * NOT — on the software-WebGL path a render-to-texture pass is a pessimisation, and
 * on a collapsed frame rate the throttle can't skip it, which is exactly what
 * regressed build-flow.spec on CI. See {@link MinimapView.rebuildContent}.)
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
 * colours on the dots (the roster resolver [[station-hp]] shares); signal yellow —
 * the RESERVED ore colour — only on the faint ore hints, which *are* ore; threat
 * red only on the collapse ring, the match's danger state.
 */

import { Container, Graphics } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { PANEL_FILL, PANEL_RULE, RADIUS } from './chrome';
import { playerColor } from './station-hp';
import {
  fitBounds,
  mapPoint,
  minimapRect,
  minimapScene,
  MINIMAP_DOT_ALPHA,
  MINIMAP_MARGIN,
  MINIMAP_REDRAW_TICKS,
  MINIMAP_SPAWN_PROTECT_ALPHA,
  MINIMAP_FOG_ALPHA,
  MINIMAP_COVERAGE_FILL_ALPHA,
  MINIMAP_COVERAGE_RING_ALPHA,
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
/** The unified card radius (./chrome) — the ui-mockup rounds the minimap frame
 *  like every other full card. */
const CORNER_RADIUS = RADIUS.card;
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
  /** Counts of the content dots that drew — a cheap "the map is populated" check.
   *  These are the FOG-GATED counts: `shipCount` is the enemy ships that survived
   *  the sensed-state gate, so a distant enemy dropping when its coverage dies is
   *  observable here (the satellite-killed moment). */
  stationCount: number;
  shipCount: number;
  oreCount: number;
  /** Sensed radar-satellite dots drawn this frame (feature f1). */
  satelliteCount: number;
  /** Current coverage discs drawn this frame — grows when a satellite is built (a
   *  new LARGE disc appears), collapses to the local baseline when it dies. */
  coverageCount: number;
  /** Whether the collapse ring drew this frame (GDD §2.3). */
  collapseRing: boolean;
}

export class MinimapView extends Container {
  /** The frame border + backdrop — its bounds ARE the registered rect. */
  private readonly frameG = new Graphics();
  /** Everything clipped to the rect (throttled content + the per-frame own dot). */
  private readonly clip = new Container();
  /** The throttled, cached map content (stations, enemy ships, ore, ring). */
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

  // --- ?debug=1 live-stage capture (cold in a normal build) -----------------
  private debugCapture = false;
  private readonly drawn: DrawnMinimap = {
    expanded: false,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    ownDot: null,
    stationCount: 0,
    shipCount: 0,
    oreCount: 0,
    satelliteCount: 0,
    coverageCount: 0,
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
      .fill({ color: PANEL_FILL, alpha: BACKDROP_ALPHA });
    // Border inset by the stroke width so the drawn geometry never spills past the
    // fill's bounds — which keeps getBounds() exactly the rect the registry checks.
    // The unified panel rule (./chrome), the same hairline every menu/HUD panel wears.
    const i = BORDER_WIDTH;
    this.frameG
      .roundRect(rect.x + i, rect.y + i, rect.width - 2 * i, rect.height - 2 * i, CORNER_RADIUS - 1)
      .stroke({ width: BORDER_WIDTH, color: PANEL_RULE, alpha: BORDER_ALPHA });

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

    // --- Fog of war (feature f1) ---------------------------------------------
    // Lay the Cold-Vacuum veil over the whole map, then punch the coverage discs
    // back through it (a faint reveal + edge ring), so the sensed slice reads lit
    // against the dark unsensed vacuum. Under everything else so the dots that
    // survive the fog gate (only the sensed ones — decided in ./minimap) sit on
    // top. Clipped to the rect by the layer's mask, so the veil never spills.
    if (scene.fogged) this.drawFog(g, rect, scene.coverage);

    // Faint ore-field hints (under the dots; already fog-gated by the scene).
    for (const o of scene.oreDots) g.circle(o.x, o.y, o.radius).fill({ color: o.color, alpha: o.alpha });

    // The collapse ring (GDD §2.3) — threat red, the match's danger state. Drawn
    // regardless of coverage: it is match-critical and its closure is broadcast
    // in-fiction, so it is a documented always-visible exception to the fog.
    if (scene.collapseRing) {
      g.circle(scene.collapseRing.x, scene.collapseRing.y, scene.collapseRing.radius).stroke({
        width: RING_WIDTH,
        color: scene.collapseRing.color,
        alpha: 0.8,
      });
    }

    // Stations, then enemy ships, then satellites over them.
    for (const p of scene.stationDots) g.circle(p.x, p.y, p.radius).fill({ color: p.color, alpha: p.alpha });
    for (const s of scene.shipDots) g.circle(s.x, s.y, s.radius).fill({ color: s.color, alpha: s.alpha });
    // Satellites: a small owner-coloured dot with a thin outline so a high-value
    // radar body reads distinct from a ship at a glance (feature f1).
    for (const sat of scene.satelliteDots) {
      g.circle(sat.x, sat.y, sat.radius).fill({ color: sat.color, alpha: sat.alpha });
      g.circle(sat.x, sat.y, sat.radius + 0.75).stroke({ width: 0.75, color: PALETTE.hullSteel, alpha: 0.7 });
    }

    // NO offscreen texture cache. The field request's "cache to an offscreen
    // texture" is a poor trade on the software-WebGL path (the ~1 fps CI runner, and
    // any phone that falls back to SwiftShader): `cacheAsTexture` adds a full
    // render-to-texture pass *every* rebuild, and on a collapsed frame rate the
    // tick-delta throttle below never skips a frame (≥ 6 sim ticks elapse per frame
    // once the rate drops — MAX_FRAME_SECONDS admits up to 15), so that extra pass
    // ran on every single frame for zero benefit. The content is a dozen small
    // circles Pixi already batches; drawing the Graphics directly is no more
    // expensive than compositing a cached texture and is pixel-identical (the
    // frozen-scene goldens confirm). The CPU win the field request actually wanted —
    // not re-tessellating the scene per frame — is still bought by the
    // {@link MINIMAP_REDRAW_TICKS} throttle in {@link update} whenever the frame rate
    // is healthy enough for it to engage. (The minimap is not the reason
    // build-flow.spec was slow on CI — that is the irreducible cost of its long
    // construction-cycle advance; this just stops the map wasting a pass on the
    // slowest renderers regardless.)
  }

  /**
   * Paint the fog-of-war veil + coverage reveals into `g` (feature f1). A near-
   * opaque Cold-Vacuum fill darkens the whole rect, a sparse diagonal hatch gives
   * it the "cold vacuum" texture, and each current coverage disc is revealed with
   * a faint wash + an edge ring — so the sensed slice reads lit against the dark
   * unsensed vacuum, and "you see what your radar buys you" is legible. All of it
   * is clipped to the rect by the layer mask, so nothing spills past the frame.
   */
  private drawFog(g: Graphics, rect: Rect, coverage: readonly { x: number; y: number; radius: number }[]): void {
    // The dark veil over the whole map — fogged vacuum.
    g.rect(rect.x, rect.y, rect.width, rect.height).fill({ color: PALETTE.vacuum, alpha: MINIMAP_FOG_ALPHA });

    // A sparse diagonal hatch for the "cold vacuum" fog texture — faint steel
    // lines at a fixed pitch across the rect (drawn as a right-leaning family so a
    // corner-to-corner sweep reads as hatch, not a grid). Cheap: a handful of
    // strokes on a static rect.
    const pitch = Math.max(8, Math.min(rect.width, rect.height) / 6);
    for (let d = -rect.height; d < rect.width; d += pitch) {
      const x0 = clamp(rect.x + d, rect.x, rect.x + rect.width);
      const y0 = clamp(rect.y + (rect.x + d - x0), rect.y, rect.y + rect.height);
      const x1 = clamp(rect.x + d + rect.height, rect.x, rect.x + rect.width);
      const y1 = clamp(rect.y + (rect.x + d + rect.height - x1), rect.y, rect.y + rect.height);
      g.moveTo(x0, y0).lineTo(x1, y1);
    }
    g.stroke({ width: 0.5, color: PALETTE.hullSteel, alpha: 0.06 });

    // Reveal each coverage disc: a faint wash lightens the sensed vacuum, and a
    // thin ring marks the radar reach (the satellite's LARGE disc is the tell).
    for (const c of coverage) {
      g.circle(c.x, c.y, c.radius).fill({ color: PALETTE.hullSteel, alpha: MINIMAP_COVERAGE_FILL_ALPHA });
    }
    for (const c of coverage) {
      g.circle(c.x, c.y, c.radius).stroke({
        width: 1,
        color: PALETTE.plasma,
        alpha: MINIMAP_COVERAGE_RING_ALPHA,
      });
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
      stationCount: this.drawn.stationCount,
      shipCount: this.drawn.shipCount,
      oreCount: this.drawn.oreCount,
      satelliteCount: this.drawn.satelliteCount,
      coverageCount: this.drawn.coverageCount,
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
    // Count what actually DREW — i.e. the fog-gated scene, not the raw frame — so
    // a distant enemy dropping when its coverage dies is observable in shipCount
    // (the satellite-killed moment). Computed here rather than read from the
    // throttled rebuild so the counts are current on the frame the test samples.
    // Only reached under ?debug=1 capture, never in a normal build.
    const scene = minimapScene(frame, rect);
    d.stationCount = scene.stationDots.length;
    d.shipCount = scene.shipDots.length;
    d.oreCount = scene.oreDots.length;
    d.satelliteCount = scene.satelliteDots.length;
    d.coverageCount = scene.coverage.length;
    d.collapseRing = !!scene.collapseRing;
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
