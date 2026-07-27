/**
 * src/platform/tap-pilot.ts — the Tap Commander local pilot. OWNER: Platform
 * Engineer.
 *
 * A ratified OPTIONAL control scheme (developer, "tap/click-to-move,
 * tap/click-to-attack"): touching a location moves the ship there, touching a
 * target attacks it. The other schemes stay available and default — this is a
 * *local pilot, not a new protocol*.
 *
 * The load-bearing rule of the whole codebase holds unchanged: **the simulation
 * never sees a device** (GDD §2.4, `@shared/types`). This module does not add an
 * `Action` kind and does not touch the sim or the wire. It is another writer of
 * the device-neutral {@link ControlState} — exactly like `touch.ts` and
 * `input.ts` — turning the player's standing *order* (a waypoint, or a locked
 * target) into the SAME thrust/aim/fire the sticks produce. It files inputs the
 * way a bot does: read the world, decide a heading, write neutral input, let
 * `mapActions` (actions.ts) carry it into the sim.
 *
 * Pure geometry and a tiny order state-machine — it consumes a re-resolved
 * target snapshot each frame rather than reaching into the `World`, so it stays
 * DOM-free and headless-testable (the sim never sees a device; neither does this
 * pilot). Picking *which* entity a tap landed on ({@link pickTapTarget}) is pure
 * too; re-resolving a lock to its live position, and building the candidate list,
 * is the wiring's job (main.ts owns `world`).
 */

import type { Vec2 } from '@shared/types';
import type { ControlState } from './actions';

// ---------------------------------------------------------------------------
// Targets and orders
// ---------------------------------------------------------------------------

/**
 * What a tap can lock onto (developer ratification §2). An enemy ship / turret /
 * core is an attack; an asteroid is a mine ("a rock is just a target"); the
 * player's own planet is a fly-to-atmosphere. Hostility is decided per frame by
 * the wiring (see {@link ResolvedTarget.hostile}), not baked into the kind.
 */
export type TargetKind = 'ship' | 'turret' | 'core' | 'asteroid' | 'planet';

/**
 * A stable handle to a locked entity: its kind and sim id. The wiring re-resolves
 * this to a live {@link ResolvedTarget} every frame, so a lock tracks a moving
 * ship, a shrinking rock, or a besieged core — and reads back `null` the frame
 * the entity dies, which clears the lock (§2, "lock clears on target death").
 */
export interface TargetRef {
  readonly kind: TargetKind;
  readonly id: number;
}

/** The pilot's one standing order: fly to a point, hold+attack a target, or none. */
export type Order =
  | { readonly kind: 'waypoint'; readonly at: Vec2 }
  | { readonly kind: 'target'; readonly ref: TargetRef }
  | null;

/**
 * A candidate a tap could select, in world space. The wiring builds this list
 * from the live `World` (every asteroid, every enemy ship/turret/core, the
 * player's own planet) and hands it to {@link pickTapTarget}. `hostile` marks
 * an attack/mine target apart from the friendly own-planet fly-to.
 */
export interface TapCandidate {
  readonly kind: TargetKind;
  readonly id: number;
  readonly pos: Vec2;
  readonly radius: number;
  readonly hostile: boolean;
}

/**
 * The live snapshot of the locked entity, re-resolved from the world each frame
 * by the wiring. `null` (from the resolver) means the entity is gone — the pilot
 * clears the lock. `standoff` overrides the config's engage distance for this
 * target (the own planet holds at its atmosphere, not weapon range).
 */
export interface ResolvedTarget {
  readonly pos: Vec2;
  readonly radius: number;
  /** true → attack or mine (aim + fire while in range); false → friendly fly-to. */
  readonly hostile: boolean;
  /** Surface-gap standoff to hold at, world units. Defaults to `cfg.engageRange`. */
  readonly standoff?: number;
  /** true → the target is a rock (asteroid): hold the ship's centre INSIDE the
   *  tractor pickup radius so the ore a shot chips off drifts into the hold instead
   *  of resting out of reach (developer p9-02 range fix). A combat standoff would
   *  sit the ship too far back to collect — "it moves back to a range where it can't
   *  pick up the ore". Ignored when an explicit `standoff` is set. */
  readonly mineable?: boolean;
}

/** The local ship's kinematics the pilot steers — the only ship facts it needs. */
export interface PilotShip {
  readonly pos: Vec2;
  readonly radius: number;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Tap Commander feel. All world units (the sim's space), fed by the wiring from
 *  the sim's own `WEAPON_RANGE` so the pilot carries no sim constant of its own. */
export interface TapPilotConfig {
  /** A waypoint within this of the ship counts as reached — the order clears and
   *  the ship coasts (§2, "waypoint marker until arrival or next order"). */
  arriveRadius: number;
  /** Approach thrust ramps down across this distance to the goal, so the ship
   *  eases in rather than slamming the stop — the arrival damping. */
  slowRadius: number;
  /** Desired surface gap to a hostile target: the ship closes to here and holds,
   *  keeping it inside firing range without flying into the target. */
  engageRange: number;
  /** Fire while the surface gap to a hostile target is within this. Fed a touch
   *  under `WEAPON_RANGE` so a held lock is comfortably in range when it looses. */
  fireRange: number;
  /** Dead-band around `engageRange` so the ship holds still instead of chattering
   *  thrust forward/back across the standoff boundary. */
  rangeHysteresis: number;
  /** The tractor pickup radius (world units, ship-centre to chunk), fed from the
   *  sim's `TRACTOR_PICKUP_RADIUS` so the pilot carries no copied literal. When the
   *  engaged target is a rock the pilot holds the ship's centre INSIDE this — see
   *  {@link ResolvedTarget.mineable} — so chipped ore reaches the hold (developer
   *  p9-02 range fix). The combat hold against enemies is unchanged. */
  pickupRadius: number;
}

/**
 * Fraction of the tractor pickup radius the pilot holds a mined rock at, centre to
 * centre. Comfortably inside the grab range so the chipped chunks drift into the
 * hold, with room to spare so the standoff dead-band ({@link TapPilotConfig.rangeHysteresis})
 * stays inside the pickup radius on the far side too (developer p9-02).
 */
const ASTEROID_HOLD_FRACTION = 0.6;

/** World-unit forgiveness added to an entity's radius when hit-testing a tap, so a
 *  thumb near a small rock still selects it (§2). Exported for the wiring/tests. */
export const TAP_SLOP = 24;

const DEFAULT_CONFIG: TapPilotConfig = {
  arriveRadius: 24,
  slowRadius: 160,
  engageRange: 150,
  fireRange: 220,
  rangeHysteresis: 32,
  pickupRadius: 120,
};

// ---------------------------------------------------------------------------
// Tap resolution (pure)
// ---------------------------------------------------------------------------

/**
 * Which entity a tap at world point `at` locks onto, or `null` for empty space
 * (§2). A candidate is hit when the tap lands within its radius plus {@link TAP_SLOP};
 * of overlapping hits the nearest centre wins, so a tap on a rock in front of a
 * planet selects the rock the thumb is actually over. Pure — no world access.
 */
export function pickTapTarget(
  candidates: readonly TapCandidate[],
  at: Vec2,
  slop: number = TAP_SLOP,
): TapCandidate | null {
  let best: TapCandidate | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dx = at.x - c.pos.x;
    const dy = at.y - c.pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= c.radius + slop && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The pilot
// ---------------------------------------------------------------------------

/**
 * Holds the one standing order and, once per frame, writes the thrust/aim/fire it
 * implies into a device-neutral {@link ControlState} — the same state every other
 * device writes. Feed it the local ship and (for a target order) the re-resolved
 * live target; it clears its own order on arrival or on target death.
 *
 * On a lock the pilot aims explicitly at the target, so the caller maps that frame
 * in **Manual** fire mode (aim honoured); an Auto-aim map would let the sim pick the
 * nearest target instead of the one the player locked, which is not what a tap
 * means. With NO lock the pilot AUTO-ENGAGES (developer p9-02 §1): it holds the
 * trigger while flying a waypoint or idling, and the caller maps that frame in
 * **Auto-aim** so the sim's own ladder picks the best target — enemies first,
 * hittability and full-hold rock suppression built into that ladder (p9-01), never
 * re-derived here. Movement and firing are independent: the ship flies its order
 * and shoots what the ladder finds, like a twin-stick player. A lock overrides the
 * ladder until it is cleared. It never opens the build wheel — that affordance stays
 * on its own device and is merged alongside the pilot by the wiring.
 */
export class TapPilot {
  private order: Order = null;
  private readonly cfg: TapPilotConfig;

  constructor(config?: Partial<TapPilotConfig>) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /** The current standing order (read-only view for the render markers). */
  get currentOrder(): Order {
    return this.order;
  }

  /** The active move waypoint, or `null` when the order is a lock or nothing —
   *  what a waypoint marker renders at (§4, the ui seam draws it). */
  get waypoint(): Vec2 | null {
    return this.order?.kind === 'waypoint' ? this.order.at : null;
  }

  /** The locked target's ref, or `null` — the handle the wiring re-resolves to a
   *  live position each frame, and what a lock-on reticle renders over (§4). */
  get lockedRef(): TargetRef | null {
    return this.order?.kind === 'target' ? this.order.ref : null;
  }

  /** Tap empty space: fly there, replacing any prior order or lock (§2). */
  orderMove(at: Vec2): void {
    this.order = { kind: 'waypoint', at: { x: at.x, y: at.y } };
  }

  /** Tap an entity: lock it, replacing any prior order (§2). */
  lockTarget(ref: TargetRef): void {
    this.order = { kind: 'target', ref: { kind: ref.kind, id: ref.id } };
  }

  /** Drop the standing order (e.g. on rematch / scheme switch). */
  clear(): void {
    this.order = null;
  }

  /**
   * Fold this frame's order into `state` (which the caller has reset to neutral).
   *
   * A **lock** (target order) aims at the locked entity, closes to and holds firing
   * range, and fires while in range — a rock holds INSIDE the tractor pickup radius
   * so its ore reaches the hold, an own-planet fly-to holds at its atmosphere and
   * never fires. A lock overrides the auto-engage ladder until it is cleared
   * (developer p9-02 §1). A lock whose `resolved` came back `null` — the entity died
   * — is dropped, and the ship reverts to auto-engage rather than going passive.
   *
   * With **no lock** the pilot auto-engages (p9-02 §1): a waypoint drives thrust
   * toward the point with arrival damping and clears on arrival, idle coasts, and in
   * BOTH cases the trigger is held so the sim's Auto-aim ladder engages the best
   * target while the ship flies. Movement and firing are independent — the caller
   * maps this frame in Auto-aim (aim is left null so the sim acquires the target).
   */
  writeInto(state: ControlState, ship: PilotShip, resolved: ResolvedTarget | null): void {
    const order = this.order;

    if (order?.kind === 'target') {
      if (resolved) {
        // An active lock directs BOTH steering and fire — it overrides the ladder
        // until cleared (developer p9-02 §1, "an explicit tap-lock still overrides").
        this.steerToTarget(state, ship, resolved);
        return;
      }
      // The locked entity is gone (dead ship, mined-out rock): drop the lock (§2)
      // and fall through to auto-engage, so the ship keeps fighting/flying.
      this.order = null;
    } else if (order?.kind === 'waypoint') {
      this.steerToPoint(state, ship.pos, order.at);
    }
    // else: no order — the ship coasts (thrust stays the neutral zero).

    // Auto-engage is the pilot's default (developer p9-02 §1): with no lock directing
    // fire, hold the trigger while flying a waypoint or idling and let the funnel's
    // Auto-aim map hand the sim's ladder the pick — enemies first, hittability and
    // full-hold rock suppression built into that ladder (p9-01), never re-derived
    // here. Aim stays null: the sim acquires across the full 360°. If ore is full and
    // only rocks are near, that ladder holds fire on its own (the p9-01 suppression),
    // which is exactly "if ore is full it shouldn't fire at asteroids automatically".
    state.fire = true;
  }

  /** Thrust toward `to`, magnitude eased down within `slowRadius`; clear the order
   *  once inside `arriveRadius` (the ship has arrived, and coasts to rest). */
  private steerToPoint(state: ControlState, from: Vec2, to: Vec2): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.cfg.arriveRadius) {
      this.order = null;
      state.thrust.x = 0;
      state.thrust.y = 0;
      return;
    }
    const mag = Math.min(1, d / this.cfg.slowRadius);
    state.thrust.x = (dx / d) * mag;
    state.thrust.y = (dy / d) * mag;
  }

  /** Aim at a locked target, hold firing range against it (hysteresis so it does
   *  not chatter), and fire while a hostile target is in range. */
  private steerToTarget(state: ControlState, ship: PilotShip, target: ResolvedTarget): void {
    const dx = target.pos.x - ship.pos.x;
    const dy = target.pos.y - ship.pos.y;
    const centreDist = Math.hypot(dx, dy);

    if (centreDist > 1e-6) {
      // Aim only matters for something we fire on; the sim ignores it otherwise,
      // but a friendly fly-to leaves aim null so nothing reads a phantom facing.
      if (target.hostile) state.aim = { x: dx, y: dy };

      // Steer on the *surface* gap so the standoff reads the same for a rock, a
      // ship, and a planet core regardless of their very different radii.
      const surface = centreDist - target.radius - ship.radius;
      const stop = this.holdStandoff(target, ship);
      const gap = surface - stop;
      const ux = dx / centreDist;
      const uy = dy / centreDist;
      if (gap > this.cfg.rangeHysteresis) {
        // Too far — close in, easing down over the last `slowRadius`.
        const mag = Math.min(1, gap / this.cfg.slowRadius);
        state.thrust.x = ux * mag;
        state.thrust.y = uy * mag;
      } else if (gap < -this.cfg.rangeHysteresis && target.hostile) {
        // Too close to a hostile — back off gently to hold the range. A friendly
        // fly-to never backs off, so the ship can settle at its atmosphere.
        const mag = Math.min(1, -gap / this.cfg.slowRadius);
        state.thrust.x = -ux * mag;
        state.thrust.y = -uy * mag;
      }
      // Inside the dead-band: hold position (thrust stays the neutral zero).

      state.fire = target.hostile && surface <= this.cfg.fireRange;
    }
  }

  /**
   * The surface-gap standoff the pilot holds at for `target`. An explicit `standoff`
   * (the own-planet atmosphere) always wins. A **rock** (`mineable`) holds the ship's
   * centre inside the tractor pickup radius so the ore a shot chips off reaches the
   * hold — the p9-02 range fix: a combat `engageRange` would sit the ship well
   * outside the grab range for a rock ("it moves back to a range where it can't pick
   * up the ore"). Everything else holds at the unchanged combat `engageRange`.
   *
   * Returned as a surface gap (centre-to-centre minus both radii) because that is
   * what {@link steerToTarget} steers on. The centre-to-centre hold for a rock is
   * `pickupRadius * ASTEROID_HOLD_FRACTION`, comfortably inside `pickupRadius`; for a
   * fat rock the gap can go small but never pushes the ship back out of grab range.
   */
  private holdStandoff(target: ResolvedTarget, ship: PilotShip): number {
    if (target.standoff !== undefined) return target.standoff;
    if (target.mineable) {
      const holdCentre = this.cfg.pickupRadius * ASTEROID_HOLD_FRACTION;
      return holdCentre - target.radius - ship.radius;
    }
    return this.cfg.engageRange;
  }
}
