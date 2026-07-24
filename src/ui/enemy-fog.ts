/**
 * src/ui/enemy-fog.ts — the scouted-not-broadcast fog rules. OWNER: UI Engineer.
 *
 * The one HUD rule GDD §2.2 argues for at length, and calls *deliberate*:
 *
 * > **Enemy planet health is scouted, not broadcast.** You never see other
 * > players' HP bars from across the map — a rival planet's health appears as a
 * > damage ring over that planet only when your ship flies within sensor range
 * > of it. Knowing who is winning, who is wounded, and who is under siege is
 * > information you *earn* by scouting (or by reading the smoke — a burning
 * > planet is visible from further away than its numbers are). … a global HP
 * > scoreboard would let everyone free-ride on every attack; fog makes
 * > third-party awareness a skill.
 *
 * This module is that rule, and *only* that rule: it is pure, DOM-free, and
 * decides — per enemy planet, from the local ship's position — **what a player
 * has earned the right to see**. Nothing here draws; the HUD's world-overlay
 * ({@link ./hud}) draws the damage ring at the planets this returns as revealed,
 * and never at one it doesn't. Own-planet health is not this module's business
 * at all — that is always-on and lives in {@link ./planet-hp}.
 *
 * The load-bearing decision is that a fogged planet's health is not merely
 * *undrawn* — it is **unknown**: `coreFraction`/`shieldFraction` come back `null`
 * outside sensor range, so a bug in a consumer cannot leak a number the design
 * says the player never earned. There are two reveal tiers, both from GDD §2.2:
 *
 *  - **the ring** — the exact damage ring, readable only inside `SENSOR_RANGE`
 *    ("only when your ship flies within sensor range");
 *  - **the smoke** — a *binary* "this planet is burning" tell, readable from
 *    `SMOKE_RANGE` (farther than the ring), carrying no number ("reading the
 *    smoke … visible from further away than its numbers are").
 *
 * Identity is never fogged: GDD §5.2 makes the ownership beacon ring "always
 * visible", so who a planet belongs to is known at any range. Only its *health*
 * is earned. Bots read the same rule through {@link ../bots} fog-honesty — same
 * sensor range, same hidden HP — so this is the one definition of "what a
 * cockpit can see", shared by the HUD and the AI.
 */

import { SENSOR_RANGE } from '../sim/constants';

/** A 2D point in world space. Structural, so a sim `Vec2` and a plain literal
 *  both satisfy it without this module importing either (as {@link ./alarm}). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Sensor range (world units) — the distance inside which an enemy planet's
 * damage ring becomes readable. Re-exported from the sim's tuning table
 * (`SENSOR_RANGE = 2 × shield radius`, GDD §2.8) so the fog the HUD draws and the
 * fog the sim/bots enforce are provably the same number, not two constants that
 * drift. Consumed read-only — the value is the sim's to tune.
 */
export const RING_RANGE: number = SENSOR_RANGE;

/**
 * How much farther than the ring the *smoke* carries, as a multiple of
 * {@link RING_RANGE}. GDD §2.2: a burning planet "is visible from further away
 * than its numbers are", so the binary burning tell reaches past the ring — but
 * not across the whole map, or the fog would leak "who is under siege" for free.
 * 1.6× puts smoke roughly one ring-width beyond the ring. TUNABLE.
 */
export const SMOKE_RANGE_FACTOR = 1.6;

/** Distance (world units) inside which a *burning* planet's smoke is visible —
 *  the farther, number-free reveal tier (GDD §2.2 "reading the smoke"). */
export const SMOKE_RANGE: number = RING_RANGE * SMOKE_RANGE_FACTOR;

/**
 * Core fraction at or below which a planet is visibly *burning* — the threshold
 * that lights the smoke tell. A planet nicked once does not smoke (that would
 * broadcast "someone poked this planet" across half the map); a planet taking a
 * real beating does. TUNABLE.
 */
export const SMOKE_CORE_FRACTION = 0.6;

/** Core fraction at or below which the revealed damage ring reads as critical —
 *  the same threshold your own HP bar flashes at ({@link ./planet-hp}), so a red
 *  ring means the same thing on a rival's planet as on yours. */
export const RING_CRITICAL_FRACTION = 0.25;

/**
 * One enemy planet as the caller knows it from the sim — the *true* state. The
 * fog is applied on top: this is the input, {@link EnemyPlanetFog} is what the
 * player has earned the right to see of it.
 */
export interface EnemyPlanet {
  /** The rival's slot — selects the beacon/ring identity colour (always known). */
  readonly owner: number;
  /** The planet's world position (planets do not move). */
  readonly pos: Point;
  /** True core HP. Fogged out of the result unless within sensor range. */
  readonly coreHp: number;
  /** Full core HP. */
  readonly maxCoreHp: number;
  /** Pooled shield HP standing over the core. Default 0. */
  readonly shieldHp?: number;
  /** Pooled shield HP at full — 0 when no generator stands. Default 0. */
  readonly maxShieldHp?: number;
  /** False once the core is destroyed (GDD §2.7). Default true. A dead planet is
   *  a wreck, not a ring — a wreck is visible at any range and carries no HP. */
  readonly alive?: boolean;
}

/**
 * What the player has earned the right to see of one enemy planet. Health is
 * `null` — *unknown*, not zero — whenever it has not been scouted, so no consumer
 * can leak a number the design withholds (GDD §2.2).
 */
export interface EnemyPlanetFog {
  readonly owner: number;
  /** The planet's world position — always known (you can see the rock). */
  readonly pos: Point;
  /** World distance from the local ship to the planet. */
  readonly distance: number;
  /** Within {@link RING_RANGE}: the exact damage ring is readable this frame. */
  readonly ringVisible: boolean;
  /** Core HP as a fraction 0..1 — the damage ring's sweep — or `null` when the
   *  planet has not been scouted (outside sensor range). Never a number the
   *  player hasn't earned. */
  readonly coreFraction: number | null;
  /** Pooled shield HP as a fraction 0..1, or `null` when unscouted. */
  readonly shieldFraction: number | null;
  /** A shield generator stands over the core — only ever known within range. */
  readonly hasShield: boolean;
  /** The revealed ring reads as critical (≤ {@link RING_CRITICAL_FRACTION}).
   *  Always `false` while unscouted: you cannot know a rival is on the ropes
   *  without flying over to look. */
  readonly critical: boolean;
  /** The binary "this planet is burning" tell is lit — a real beating, seen from
   *  {@link SMOKE_RANGE} (farther than the ring), carrying no number. */
  readonly smoking: boolean;
  /** The core is destroyed — a wreck (GDD §2.7). Visible at any range; no ring. */
  readonly destroyed: boolean;
}

/**
 * Apply the fog to one enemy planet from the local ship's position.
 *
 * @param shipPos The local ship's world position (what "your sensors" hang off).
 * @param planet  The rival planet's true state.
 */
export function enemyPlanetFog(shipPos: Point, planet: EnemyPlanet): EnemyPlanetFog {
  const alive = planet.alive !== false;
  const distance = Math.hypot(planet.pos.x - shipPos.x, planet.pos.y - shipPos.y);
  const maxCore = planet.maxCoreHp;
  const coreFrac = maxCore > 0 ? clamp01(planet.coreHp / maxCore) : 0;

  // A dead planet is a wreck — no ring, no smoke, no fog: everyone can see a
  // hole where a core used to be (GDD §2.7). It carries no HP to hide.
  if (!alive || coreFrac <= 0) {
    return {
      owner: planet.owner,
      pos: planet.pos,
      distance,
      ringVisible: false,
      coreFraction: null,
      shieldFraction: null,
      hasShield: false,
      critical: false,
      smoking: false,
      destroyed: true,
    };
  }

  const ringVisible = distance <= RING_RANGE;
  const maxShield = planet.maxShieldHp ?? 0;
  const shieldFrac = maxShield > 0 ? clamp01((planet.shieldHp ?? 0) / maxShield) : 0;

  // Burning is a property of the planet; whether you *see* the smoke is the
  // range gate. Both must hold — an unhurt planet never smokes, so smoke can
  // never leak "this planet is fine" either.
  const burning = coreFrac <= SMOKE_CORE_FRACTION;
  const smoking = burning && distance <= SMOKE_RANGE;

  return {
    owner: planet.owner,
    pos: planet.pos,
    distance,
    ringVisible,
    // Health is revealed ONLY inside the ring. Outside it, `null` — unknown, not
    // "full", not "zero": the number was never earned (GDD §2.2).
    coreFraction: ringVisible ? coreFrac : null,
    shieldFraction: ringVisible ? shieldFrac : null,
    hasShield: ringVisible && maxShield > 0,
    critical: ringVisible && coreFrac <= RING_CRITICAL_FRACTION,
    smoking,
    destroyed: false,
  };
}

/**
 * Apply the fog to every enemy planet at once — the per-frame call the HUD makes.
 * The local player's *own* planet is not an enemy and must not be in `planets`:
 * own health is always-on top-right ({@link ./planet-hp}), never fog-gated, and
 * this module has no code path that would reveal or hide it.
 */
export function enemyPlanetsFog(
  shipPos: Point,
  planets: readonly EnemyPlanet[],
): EnemyPlanetFog[] {
  return planets.map((p) => enemyPlanetFog(shipPos, p));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
