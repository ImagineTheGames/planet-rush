/**
 * src/ui/ore-hud.ts — "ore at a glance" model. OWNER: UI Engineer.
 *
 * Top-left HUD (GDD §2.2): filled squares for what's in your hold, **one square
 * per cargo slot so upgrades visibly widen it**, flashing when full, above the
 * banked ORE total. Held ore is not safe; banked ore is (GDD §2.3) — the two
 * numbers are shown separately for exactly that reason.
 *
 * Signal yellow is ORE (style-guide §2, RESERVED) — the ore squares and the
 * banked total are among the few things allowed to be yellow, and the reason
 * the rule exists is so this element can be trusted at a glance.
 *
 * Pure and DOM-free so it unit-tests headless; the Pixi view in {@link ./hud}
 * draws the squares and the total from this model.
 */

/** The ore HUD's per-frame model: how many squares, how many filled, and the
 *  full-flash state (GDD §2.2 "flashing when full"). */
export interface OreHudModel {
  /** Total squares to draw — one per cargo slot (GDD §2.2). */
  readonly slots: number;
  /** Filled squares — whole ore currently held, clamped to `slots`. */
  readonly filled: number;
  /** True when the hold is full: the squares flash (GDD §2.2). */
  readonly full: boolean;
  /** Banked ore — safe, shown as the ORE total beneath the squares (GDD §2.3). */
  readonly banked: number;
}

/**
 * Build the ore HUD model from a ship's hold. One square per `cargoCap` slot so
 * a cargo upgrade visibly widens the row (GDD §2.2, §2.5). Cargo is floored to
 * whole squares; the hold is "full" when held ore meets capacity.
 */
export function oreHudModel(cargo: number, cargoCap: number, banked: number): OreHudModel {
  const slots = Math.max(0, Math.floor(cargoCap));
  const filled = Math.max(0, Math.min(slots, Math.floor(cargo)));
  return {
    slots,
    filled,
    full: cargoCap > 0 && cargo >= cargoCap,
    banked: Math.max(0, Math.floor(banked)),
  };
}

/**
 * Whether the full-hold flash is "on" this frame. Driven by match time (not
 * wall-clock `Date`) so it stays deterministic and needs no timer: a ~2 Hz
 * blink. Off entirely when the hold isn't full.
 */
export function oreFlashOn(model: OreHudModel, timeSeconds: number): boolean {
  if (!model.full) return false;
  return Math.floor(timeSeconds * 4) % 2 === 0;
}
