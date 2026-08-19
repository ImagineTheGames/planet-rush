/**
 * src/ui/healthbar-view.ts — the pooled Pixi layer that draws the health bars.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./healthbar}. It takes the bars the pure model
 * decided and paints each as a short two-part rectangle — a dim steel track with
 * the owner-colour fill over it — floating just above its entity, in **screen
 * space** (the model already projected world → screen), so the bars are a fixed
 * size regardless of camera zoom (GDD field report).
 *
 * **The number (field request v0.2.4).** Every bar carries a compact "68/70"
 * current/max readout — the same treatment the station core got — floated just to
 * the RIGHT of the bar and vertically centred on it. So the over-ship cluster now
 * reads as two rows: **name + difficulty-tag** on top (the nameplate layer) and
 * **bar + number** below it, with the ship under that. Placing the number beside
 * the bar rather than under it keeps it out of that vertical stack so it never
 * fights the name/tag above ([[layout-registry]]). The Text is pooled off a
 * parallel array, one per bar slot, so a frame allocates nothing after warm-up —
 * a Text re-rasterises only when its digits change, which a steady-hp scene never
 * does. Whenever a bar draws its number draws, by the one visibility rule the
 * model already decided — one health-bar component, ships and turrets alike.
 *
 * **Pooling, the sprite-atlas discipline (GDD §4.3, risk 5).** Graphics are
 * allocated once and reused: a frame with N bars touches the first N pooled
 * objects (clear + redraw — no new geometry object per bar) and hides the rest.
 * A brawl with a dozen enemies allocates nothing per frame after warm-up, the
 * same rule the renderer's pools hold to.
 *
 * **Registered under `full`.** Bars appear wherever their entities are, so like
 * the alarm's screen-edge arrow they claim the whole viewport as their zone
 * ([[layout-registry]]). To keep that honest — and to avoid drawing a bar half
 * off the canvas — a bar whose rect would leave the viewport is culled this
 * frame; the registered bounds are the union of what actually drew, so it always
 * sits inside `full`.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { PlayerId } from '@shared/types';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { healthBarFill, healthBarTrack } from './healthbar';
import type { HealthBar } from './healthbar';
import { FONT_BODY, TEXT_PRIMARY } from './typography';
import { hudTracking, INSTRUMENT_RADIUS, INSTRUMENT_TRACK } from './instrument';

/** Layout-registry id for the health-bar layer (one entry, the union of bars). */
export const HEALTHBAR_ID = 'healthbars';
/** Bars float over the world anywhere on screen — `full`, like the alarm arrow. */
export const HEALTHBAR_ANCHOR: AnchorSpec = { region: 'full' };

/** Alpha of the empty track behind the fill — present so a missing chunk reads
 *  as absence, not as nothing drawn. Steel, never a material colour of its own —
 *  and since u7-07 the Bone ramp's own `rulePlate` step (./instrument
 *  `INSTRUMENT_TRACK`) rather than raw `hullSteel`, so a track is spent by role. */
const TRACK_ALPHA = 0.34;

/** The numeric "68/70" readout beside the bar (field request v0.2.4): Oxanium
 *  numerals (style-guide §7), small enough not to fight the name/difficulty-tag
 *  stack above — so the over-ship cluster reads as two rows, name+tag over
 *  bar+number. Chalk-white, off the same neutral as the core readout, never a
 *  reserved colour. */
const NUMBER_SIZE = 9;
/** Gap between the bar's right edge and the number's left edge, CSS px — the
 *  number trails the bar the way the difficulty tag trails the name. */
const NUMBER_GAP = 3;
/** The number's alpha — a touch under the fill so it recedes behind the bar it
 *  annotates rather than competing with it. */
const NUMBER_ALPHA = 0.9;

/**
 * One bar the layer actually drew this frame (post-cull), captured only when
 * {@link HealthBarView.enableDebugCapture} has been called — the ?debug=1
 * live-stage seam behind {@link HealthBarView.debugBars}. It exists because the
 * enemy bars shipped dead twice: the model was green but nothing on a real boot
 * proved a *drawn* bar tracked a damaged enemy. This lets a Playwright test read
 * that out of the running client. Never allocated or written in a normal build.
 */
export interface DrawnHealthBar {
  owner: PlayerId;
  fraction: number;
  /** Bar centre-x in screen space, CSS px (the entity the bar tracks). */
  x: number;
  /** Bar-top y in screen space, CSS px. */
  y: number;
  /** True for the local player's own-ship bar (drawn in the distinct style) —
   *  so a live-stage test can assert the own ship's bar is the one styled mine. */
  local: boolean;
  /** The numeric "68/70" readout drawn beside this bar (field request v0.2.4),
   *  or `''` when the number was culled off-canvas but the bar still drew — so a
   *  live-stage test can assert the number is present and matches the hp state. */
  hpText: string;
}

export class HealthBarView extends Container {
  private readonly bars: Graphics[] = [];
  /** Parallel pool of the "68/70" numbers, one per bar slot (field request
   *  v0.2.4). A Text re-rasterises only when its string changes, so a bar whose
   *  hp holds steady across frames re-uses its glyphs for free — the same pooling
   *  discipline as the nameplate layer. A slot whose number is culled off-canvas
   *  (or whose bar is hidden) hides its Text. */
  private readonly numbers: Text[] = [];
  /** Union of the rects drawn this frame, or null when nothing drew — what the
   *  registry records (only what is actually on screen). */
  private drawnBounds: Rect | null = null;

  // --- ?debug=1 live-stage capture (off in every normal build) -------------
  /** When true, each drawn bar is recorded into {@link debugDrawn} for the
   *  live-stage harness. Left false unless {@link enableDebugCapture} is called. */
  private debugCapture = false;
  /** Pooled drawn-bar snapshots (grows to fit, never shrinks) and the count that
   *  drew last frame — read back by {@link debugBars}. */
  private readonly debugDrawn: DrawnHealthBar[] = [];
  private debugCount = 0;

  /**
   * Draw one frame of bars into the given viewport. `bars` come from
   * {@link healthBarModel}; each is centred on its entity and floated above it.
   */
  update(bars: readonly HealthBar[], viewportWidth: number, viewportHeight: number): void {
    let drawn = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const bar of bars) {
      // The track: centred on the entity and floated above it. The local
      // (own-ship) bar is the larger one so it reads as "mine" at a glance (field
      // request v0.1.1); everyone else keeps the narrow bar. Geometry lives in
      // `./healthbar` `healthBarTrack` so the layout tests can hold it (a0-101).
      const track = healthBarTrack(bar);
      const { width, height } = track;
      const left = track.x;
      const top = track.y;

      // Cull anything that would spill off the canvas: an edge enemy is barely
      // visible anyway, and a partial bar would break the `full` contract.
      if (left < 0 || top < 0 || left + width > viewportWidth || top + height > viewportHeight) {
        continue;
      }

      const i = drawn++;
      const g = this.slot(i);
      g.clear();
      // Track first, then the owner-colour fill over its left portion.
      // Square corners (./instrument `INSTRUMENT_RADIUS`): a bar is a surface,
      // and the handoff cuts corners only on plates that stand off the screen.
      g.roundRect(left, top, width, height, INSTRUMENT_RADIUS).fill({
        color: INSTRUMENT_TRACK,
        alpha: TRACK_ALPHA,
      });
      // Anchored at the track's LEFT edge, so the bar empties rightward — the one
      // direction every hull bar on the screen takes (./instrument `hullBarFill`).
      const fill = healthBarFill(bar);
      if (fill.width > 0) {
        g.roundRect(fill.x, fill.y, fill.width, fill.height, INSTRUMENT_RADIUS).fill({
          color: bar.color,
          alpha: 0.95,
        });
      }
      // The own ship's bar carries an identity-colour outline — the second half
      // of "reads as mine" (larger + framed), so it stands out from the field of
      // enemy bars without borrowing a reserved colour (style-guide §2 / §3).
      if (bar.local) {
        g.roundRect(left, top, width, height, INSTRUMENT_RADIUS).stroke({ width: 1, color: bar.color, alpha: 0.9 });
      }

      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (left + width > maxX) maxX = left + width;
      if (top + height > maxY) maxY = top + height;

      // The "68/70" number (field request v0.2.4), floated to the RIGHT of the bar
      // and vertically centred on it, so the over-ship cluster reads as two rows —
      // name+tag over bar+number — instead of a third tier that would fight the
      // nameplate stack. Whenever a bar shows, its number shows. Culled on its own:
      // if the number would spill off-canvas the bar still stands, the number just
      // hides this frame (so the bar is never left half-annotated at a screen edge).
      const t = this.numberSlot(i);
      if (t.text !== bar.hpText) t.text = bar.hpText;
      const numLeft = left + width + NUMBER_GAP;
      const numTop = top + height / 2 - t.height / 2;
      const numRight = numLeft + t.width;
      const numBottom = numTop + t.height;
      const numFits = numTop >= 0 && numRight <= viewportWidth && numBottom <= viewportHeight;
      let drawnNumber = '';
      if (numFits) {
        t.visible = true;
        t.position.set(numLeft, numTop);
        drawnNumber = bar.hpText;
        if (numRight > maxX) maxX = numRight;
        if (numTop < minY) minY = numTop;
        if (numBottom > maxY) maxY = numBottom;
      } else {
        t.visible = false;
      }

      if (this.debugCapture) this.recordDebug(i, bar, top, drawnNumber);
    }

    this.hideFrom(drawn);
    this.drawnBounds =
      drawn > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
    this.debugCount = this.debugCapture ? drawn : 0;
  }

  // --- ?debug=1 live-stage seam --------------------------------------------

  /** Turn on capture of the drawn bars so {@link debugBars} reports them. The
   *  live-stage harness (main.ts, only under ?debug=1) calls this once; a normal
   *  build never does, so the record path stays cold. Idempotent. */
  enableDebugCapture(): void {
    this.debugCapture = true;
  }

  /** The bars that actually drew last frame (post-cull) — owner, fill fraction,
   *  and screen position of each — for a live-stage test to assert a real bar
   *  tracks a damaged enemy. Empty unless {@link enableDebugCapture} was called. */
  debugBars(): DrawnHealthBar[] {
    return this.debugDrawn.slice(0, this.debugCount);
  }

  /** Record one drawn bar into the reusable pool at `i` (grows to fit). `hpText`
   *  is the number actually drawn beside the bar, or `''` when it was culled — so
   *  the live-stage seam reports what is really on screen. Only reached under
   *  {@link debugCapture}, so it costs nothing in a normal build. */
  private recordDebug(i: number, bar: HealthBar, top: number, hpText: string): void {
    let d = this.debugDrawn[i];
    if (!d) {
      d = { owner: bar.owner, fraction: bar.fraction, x: bar.x, y: top, local: bar.local, hpText };
      this.debugDrawn[i] = d;
      return;
    }
    d.owner = bar.owner;
    d.fraction = bar.fraction;
    d.x = bar.x;
    d.y = top;
    d.local = bar.local;
    d.hpText = hpText;
  }

  /**
   * The layer's registry entry — the union of the bars that drew, or nothing
   * when the field is clean (every enemy full and idle).
   *
   * The bounds are reported in GLOBAL (physical) space via {@link getBounds}, the
   * same discipline the HUD's other elements use through `Hud.describeLayout`'s
   * `push` helper: the layout host reads a `describeLayout` seam as physical Pixi
   * bounds and un-rotates them into the logical viewport itself
   * (`physicalBoundsToLogical` in main.ts). The bars draw as children of the
   * rotating game root, so their on-screen union IS `getBounds()`. Returning the
   * layer's own-space `drawnBounds` (already logical) would double-count the
   * landscape lock's 90° rotation and register a portrait-held bar off-screen —
   * the same space mismatch PR #93 fixed for the nameplate layer, which this
   * mirrors exactly. `drawnBounds` stays the "did any bar draw" sentinel. (In the
   * frozen-scene layout contract no enemy is on screen and no own-ship bar draws,
   * so this path never registered under rotation before — the bug was latent.)
   */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || !this.drawnBounds) return [];
    const b = this.getBounds();
    return [{ id: HEALTHBAR_ID, anchor: HEALTHBAR_ANCHOR, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } }];
  }

  private slot(i: number): Graphics {
    let g = this.bars[i];
    if (!g) {
      g = new Graphics();
      this.bars[i] = g;
      this.addChild(g);
    }
    g.visible = true;
    return g;
  }

  /** The pooled number Text for bar slot `i` — Oxanium numerals, chalk-white,
   *  left-anchored so it hangs off the bar's right edge (field request v0.2.4).
   *  Created once and re-used; the caller sets its string and position. */
  private numberSlot(i: number): Text {
    let t = this.numbers[i];
    if (!t) {
      t = new Text({
        text: '',
        // `name` tracking: "68/70" is a VALUE, which is what that tier is for
        // — not the flat 0.3px this layer used to spell (./instrument).
        style: {
          fontFamily: FONT_BODY,
          fontSize: NUMBER_SIZE,
          fill: TEXT_PRIMARY,
          letterSpacing: hudTracking('name', NUMBER_SIZE),
        },
      });
      t.anchor.set(0, 0); // top-left: positioned from its computed top-left corner
      t.alpha = NUMBER_ALPHA;
      this.numbers[i] = t;
      this.addChild(t);
    }
    return t;
  }

  private hideFrom(count: number): void {
    for (let i = count; i < this.bars.length; i++) {
      const g = this.bars[i];
      if (g) g.visible = false;
    }
    for (let i = count; i < this.numbers.length; i++) {
      const t = this.numbers[i];
      if (t) t.visible = false;
    }
  }
}
