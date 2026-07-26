/**
 * src/ui/ore-hold.ts — the UNDER-SHIP ore-hold indicator model. OWNER: UI Engineer.
 *
 * Field rule (developer): *"We're supposed to show ore held on ship under the
 * ship, not top left — top left is to show total ore."* So the held-ore squares
 * that used to live top-left move here: a **compact hold indicator that follows
 * the local ship in screen space** (the same pooled, sim-driven discipline as the
 * over-ship health bar — [[healthbar]] — so the pair reads as one status cluster
 * bracketing the ship). The top-left keeps only the banked TOTAL ([[ore-hud]]),
 * so the two numbers can never be confused: one is what you're *carrying* (held,
 * unsafe), the other is what you've *banked* (safe, what the Build wheel spends).
 *
 * This is the pure, PixiJS-free half — it decides *whether* the indicator shows
 * and *how many pips* it draws, from sim hold + capacity, and projects the row's
 * footprint relative to the ship's screen position. The thin Pixi view in
 * {@link ./ore-hold-view} draws exactly what this returns and registers it in the
 * layout registry ([[layout-registry]]).
 *
 * One pip per cargo slot, filled per whole ore held — the same "upgrades visibly
 * widen it" reading GDD §2.2 gives the row, just relocated under the ship. Ore is
 * signal yellow (style-guide §2, RESERVED — one of the few things allowed to be),
 * so a glance under the ship reads "this is my cargo" the same way the top-left
 * reads "this is my bank."
 */

import type { Rect } from '@platform/layout-registry';
import { oreHudModel } from './ore-hud';

// ---------------------------------------------------------------------------
// Geometry (CSS px; the Application handles devicePixelRatio) — compact, so the
// row sits under the ship without crowding the health bar above it.
// ---------------------------------------------------------------------------

/** One pip's square side, CSS px — smaller than the top-left squares were: this
 *  is a glance-read cargo meter under the ship, not the primary HUD element. */
export const ORE_HOLD_PIP = 9;
/** Gap between pips, CSS px. */
export const ORE_HOLD_PIP_GAP = 3;
/** Clearance below the ship's sprite (its screen radius) and the pip row, CSS px,
 *  so the row floats clear of the hull rather than on it — the mirror of
 *  {@link HEALTHBAR_GAP}, which floats the health bar the same distance *above*
 *  the ship. Together they bracket the ship as one status cluster. */
export const ORE_HOLD_SHIP_GAP = 7;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * The under-ship hold indicator for a frame: where its pip row sits in screen
 * space and how many of its `slots` pips are `filled`. Everything the pooled view
 * needs, nothing it must re-derive. `null` from {@link oreHoldModel} when the
 * indicator is hidden (an empty, idle hold).
 */
export interface OreHold {
  /** The row's centre-x in screen space, CSS px — the ship's screen x (the follow
   *  camera holds the local ship at the viewport centre). The view centres the
   *  row here. */
  readonly x: number;
  /** The row's top edge in screen space, CSS px — below the ship by its radius
   *  plus {@link ORE_HOLD_SHIP_GAP}. */
  readonly y: number;
  /** Total pips — one per cargo slot (GDD §2.2), so a cargo upgrade widens it. */
  readonly slots: number;
  /** Filled pips — whole ore currently held, clamped to `slots`. */
  readonly filled: number;
  /** True when the hold is full — the row flashes (GDD §2.2 "flashing when full"),
   *  the flash phase decided by {@link oreFlashOn} at draw time. */
  readonly full: boolean;
}

/**
 * Whether the under-ship indicator shows this frame: visible **whenever the hold
 * has ore OR the ship is actively mining** (field rule item 1). Mining with an
 * empty hold still shows the (all-ghost) row so a first-time player sees their
 * capacity fill as the shots chip ore. Hidden entirely once the hold is empty and
 * the ship is idle, so the field stays clean (GDD §2.2 — the HUD "shows only what
 * the player acts on"), the same rule the health bar follows.
 */
export function holdShown(cargo: number, cargoCap: number, mining: boolean): boolean {
  return cargoCap > 0 && (cargo > 0 || mining);
}

/** The pip row's total width for a slot count, CSS px (pips plus inter-pip gaps). */
export function oreHoldRowWidth(slots: number): number {
  if (slots <= 0) return 0;
  return slots * ORE_HOLD_PIP + (slots - 1) * ORE_HOLD_PIP_GAP;
}

/**
 * Build the under-ship hold indicator from the local ship's hold and its screen
 * position, or `null` when it should be hidden ({@link holdShown}). `shipX`/`shipY`
 * are the ship's screen centre (the viewport centre under the follow camera) and
 * `radius` its screen radius; the row is centred on `shipX` and floated
 * {@link ORE_HOLD_SHIP_GAP} below the ship's bottom edge.
 */
export function oreHoldModel(
  cargo: number,
  cargoCap: number,
  mining: boolean,
  shipX: number,
  shipY: number,
  radius: number,
): OreHold | null {
  if (!holdShown(cargo, cargoCap, mining)) return null;
  // Reuse the top-left model's slot/fill maths so the two ore readouts can never
  // disagree about how many slots the ship has or how full it is (one rule).
  const m = oreHudModel(cargo, cargoCap, 0);
  if (m.slots <= 0) return null;
  return {
    x: shipX,
    y: shipY + radius + ORE_HOLD_SHIP_GAP,
    slots: m.slots,
    filled: m.filled,
    full: m.full,
  };
}

/** The pip row's drawn footprint in screen space — centred on {@link OreHold.x},
 *  hanging from {@link OreHold.y}. What the registry records and the placement
 *  test asserts against `full`. */
export function oreHoldBounds(hold: OreHold): Rect {
  const width = oreHoldRowWidth(hold.slots);
  return { x: hold.x - width / 2, y: hold.y, width, height: ORE_HOLD_PIP };
}
