/**
 * src/bots/steering.ts — hands on the controls. OWNER: Bot Engineer (GDD §2.4,
 * §2.9).
 *
 * The behavior trees decide *what* to do; this file is the only place that
 * decides *which buttons that is*. Everything here returns `Action`s from
 * `@shared/types` — the same union a keyboard, a pad, and a thumb produce — so
 * the simulation never learns that a bot was driving (GDD §2.4).
 *
 * Three properties this module is written to hold:
 *
 *  1. **Fog-honest by construction.** Every function takes a {@link SelfView}
 *     and plain positions the tree already read out of its `BotView`. Nothing
 *     here can reach a `World`.
 *  2. **Deterministic.** Aim error is drawn from the bot's own seeded `Rng`
 *     (`@shared/types` mulberry32), never `Math.random`, and distances use
 *     `Math.sqrt(dx*dx + dy*dy)` rather than `Math.hypot` for the reason
 *     `./perception` gives: the former is IEEE-exact everywhere.
 *  3. **Manual aim, on purpose.** Bots fly in Manual fire mode (`auto: false`),
 *     because Auto-aim would hand them the sim's own perfect 360° acquisition
 *     and there would be nothing left for `aimJitter` to make an Easy bot bad at
 *     (GDD §2.9: difficulty is *visible competence*). A bot that misses is a bot
 *     a beginner can beat.
 */

import type { Action, AimAction, FireAction, PlayerId, Rng, ThrustAction, Vec2 } from '@shared/types';
import { BASE_SPEED, WEAPON_RANGE, leadAim, SHIP_RADIUS, SHIP_STATS, shipProjectileSpeed } from '../sim';
import type { SelfView } from './perception';

// ---------------------------------------------------------------------------
// Geometry (local, so a tree never reaches into the sim's vector module)
// ---------------------------------------------------------------------------

/** IEEE-exact distance (see the module note). */
export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Unit vector from `a` to `b`; `fallback` when they coincide. */
export function toward(a: Vec2, b: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) return { x: fallback.x, y: fallback.y };
  return { x: dx / d, y: dy / d };
}

/** Signed smallest angle from `from` to `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Rotate a vector by `radians`. */
export function rotate(v: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Clamp a vector to unit magnitude — the analog range the sim expects. */
export function clampUnit(v: Vec2): Vec2 {
  const m2 = v.x * v.x + v.y * v.y;
  if (m2 <= 1) return v;
  const s = 1 / Math.sqrt(m2);
  return { x: v.x * s, y: v.y * s };
}

/**
 * The bot's approximate top speed, from the one stat it is entitled to know
 * without asking: the hull it picked in the lobby (GDD §2.11). Engine tiers
 * raise the real ceiling above this, which only makes a braking bot brake a
 * touch early — the safe direction to be wrong in.
 */
export function topSpeedOf(self: SelfView): number {
  return BASE_SPEED * SHIP_STATS[self.shipClass].speedMul;
}

// ---------------------------------------------------------------------------
// Action constructors
// ---------------------------------------------------------------------------

/** Thrust in an analog direction (GDD §2.4). */
export function thrust(dir: Vec2): ThrustAction {
  return { type: 'thrust', dir };
}

/** Face this way (Manual fire mode — the sim turn-rate-limits the swing). */
export function aim(dir: Vec2): AimAction {
  return { type: 'aim', dir };
}

/** Hold (or release) the trigger. Bots always fly Manual — see the module note. */
export function fire(active: boolean): FireAction {
  return { type: 'fire', active, auto: false };
}

/** Sticks centred, trigger up: the neutral stream every idle branch emits. */
export const NEUTRAL: readonly Action[] = Object.freeze([
  Object.freeze(thrust(Object.freeze({ x: 0, y: 0 }))),
  Object.freeze(fire(false)),
]);

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

/**
 * Distance at which a bot starts easing off the throttle instead of arriving at
 * full speed. Wide enough that a Hauler stops at its own station rather than
 * bouncing off it (stations are solid — `step.ts` reflects). TUNABLE
 */
export const ARRIVE_RADIUS = 220;

/**
 * Thrust that flies to a point and *stops there*: steer toward the velocity the
 * bot wants (full speed far out, tapering inside `arriveRadius`) rather than
 * toward the point itself. Without the taper every bot overshoots its own station
 * at top speed, which reads as a bot that cannot park.
 */
export function arrive(self: SelfView, target: Vec2, arriveRadius: number = ARRIVE_RADIUS): ThrustAction {
  const dx = target.x - self.pos.x;
  const dy = target.y - self.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const top = topSpeedOf(self);
  if (d < 1e-6) return thrust({ x: 0, y: 0 });

  const speed = top * Math.min(1, d / Math.max(1e-6, arriveRadius));
  const wantX = (dx / d) * speed;
  const wantY = (dy / d) * speed;
  // Steering = (desired − current) velocity, expressed in throttle units.
  return thrust(clampUnit({ x: (wantX - self.vel.x) / top, y: (wantY - self.vel.y) / top }));
}

/** Thrust flat-out toward a point, no arrival taper — a chase, or a run home. */
export function pursue(self: SelfView, target: Vec2): ThrustAction {
  return thrust(toward(self.pos, target));
}

/** Thrust directly away from a point — breaking off (GDD §2.9 "retreats"). */
export function flee(self: SelfView, threat: Vec2): ThrustAction {
  return thrust(toward(threat, self.pos));
}

/**
 * Hold station on a ring around a point, drifting around it rather than sitting
 * on it: the defender's patrol (GDD §2.6 — "turrets deter; the ship defends").
 * `swing` is the tangential bias, so a guard orbits instead of parking.
 */
export function orbit(self: SelfView, center: Vec2, radius: number, swing = 0.45): ThrustAction {
  const out = toward(center, self.pos, { x: 1, y: 0 });
  const station: Vec2 = { x: center.x + out.x * radius, y: center.y + out.y * radius };
  const arriveThrust = arrive(self, station, radius);
  const tangent: Vec2 = { x: -out.y, y: out.x };
  return thrust(clampUnit({
    x: arriveThrust.dir.x + tangent.x * swing,
    y: arriveThrust.dir.y + tangent.y * swing,
  }));
}

/**
 * Stand off at a chosen distance: close if outside it, back off if well inside
 * it, hold otherwise. This is how a bot picks off turrets "from the edge of
 * their range" (GDD §2.6) instead of flying into them.
 */
export function standOff(self: SelfView, target: Vec2, range: number): ThrustAction {
  const d = dist(self.pos, target);
  if (d > range) return arrive(self, target, ARRIVE_RADIUS);
  if (d < range * 0.7) return flee(self, target);
  return orbit(self, target, range, 0.8);
}

// ---------------------------------------------------------------------------
// Obstacle avoidance
// ---------------------------------------------------------------------------

/**
 * Clearance a bot leaves around a body it is not trying to touch. Ship radius
 * plus a margin; below it, avoidance stops steering around the obstacle and
 * starts pushing off it. TUNABLE
 */
export const AVOID_MARGIN = 10;

/**
 * How far ahead of the clearance ring avoidance starts to bite. Deliberately
 * short: a bot that swerved around every distant rock would never fly a straight
 * line, and — more to the point — a miner parked at {@link ARRIVE_RADIUS} from
 * its rock must not treat that rock as something to dodge. TUNABLE
 */
export const AVOID_LOOKAHEAD = 44;

/** Strength of the sideways slide around an obstacle. TUNABLE */
export const AVOID_TURN = 1.6;

/**
 * Steer a desired direction around one circular body.
 *
 * Everything in this game is a circle (GDD §4.1), asteroids and stations are
 * solid, and a ship that drives into one is *stopped* by it — position pushed
 * out, inward velocity killed. Without this, a bot whose target sits behind a
 * rock thrusts into that rock forever: the collision response cancels exactly
 * the motion the bot keeps asking for, and the two of them deadlock until the
 * match times out. (That is not a hypothetical; it is what two survivors of an
 * eight-bot match were doing against the west wall before this existed.)
 *
 * The fix is the cheap classical one — slide tangentially past anything ahead,
 * push straight off anything already touching — and it costs one dot product per
 * body in view.
 */
export function dodge(self: SelfView, dir: Vec2, center: Vec2, radius: number): Vec2 {
  const tx = center.x - self.pos.x;
  const ty = center.y - self.pos.y;
  const d = Math.sqrt(tx * tx + ty * ty);
  if (d < 1e-6) return dir;

  const clearance = radius + SHIP_RADIUS + AVOID_MARGIN;
  if (d > clearance + AVOID_LOOKAHEAD) return dir;

  const nx = tx / d;
  const ny = ty / d;
  const ahead = dir.x * nx + dir.y * ny;
  const touching = d < clearance;
  // Heading away from something it is not touching: nothing to do.
  if (ahead <= 0 && !touching) return dir;

  const urgency = Math.min(1, (clearance + AVOID_LOOKAHEAD - d) / AVOID_LOOKAHEAD);
  // Slide the way the ship is already leaning, so avoidance never reverses a
  // committed approach — it curves it.
  const side = nx * dir.y - ny * dir.x >= 0 ? 1 : -1;
  const push = urgency * Math.max(ahead, 0.25);
  const backoff = touching ? 1.2 : 0.25;
  return {
    x: dir.x + -ny * side * push * AVOID_TURN - nx * push * backoff,
    y: dir.y + nx * side * push * AVOID_TURN - ny * push * backoff,
  };
}

// ---------------------------------------------------------------------------
// Aiming and firing
// ---------------------------------------------------------------------------

/**
 * Aim at a point with the tier's error baked in (`DifficultyTuning.aimJitter`).
 * The error is redrawn every *decision*, not every tick, so an Easy bot's aim
 * visibly wanders at its own slow reaction cadence while a Hard bot's does not —
 * which is exactly the difference GDD §2.9 asks difficulty to express.
 *
 * When `targetVel` is given, the aim is an **intercept lead** on a mover, not a
 * straight bearing at where it stands (design amendment v0.2: combat is a
 * projectile, so a shot fired where a strafing enemy *is* misses — Easy bots go
 * harmless and Hard bots stall without lead). `jitter` still rides on top, so the
 * tier ladder is intact — an Easy bot leads *badly*, a Hard bot leads well.
 */
export function aimAt(self: SelfView, target: Vec2, jitter: number, rng: Rng, targetVel?: Vec2): AimAction {
  const dir = aimDir(self, target, targetVel);
  if (jitter <= 0) return aim(dir);
  return aim(rotate(dir, (rng.next() * 2 - 1) * jitter));
}

/** The unit aim direction at a target: a straight bearing at a still one, an
 *  intercept lead at a mover (using this hull's actual muzzle speed). */
export function aimDir(self: SelfView, target: Vec2, targetVel?: Vec2): Vec2 {
  const fallback = { x: Math.cos(self.angle), y: Math.sin(self.angle) };
  if (!targetVel || (targetVel.x === 0 && targetVel.y === 0)) {
    return toward(self.pos, target, fallback);
  }
  return leadAim(self.pos, target, targetVel, shipProjectileSpeed(self));
}

/**
 * Extra angular slop allowed on top of a target's own angular size before a bot
 * pulls the trigger. Small: a Manual shot fires along the *hull's* facing, and
 * the hull is still swinging at its class turn rate, so a bot that fires the
 * instant it is roughly lined up mostly misses. TUNABLE
 */
export const FIRE_TOLERANCE = 0.06;

/**
 * Would firing this tick actually hit? True when the target is inside weapon range
 * and the ship's *current facing* — not the direction it asked for — is within
 * the target's angular radius plus {@link FIRE_TOLERANCE}.
 *
 * This is the one place bots avoid a whole class of silly behavior: holding the
 * trigger through a 180° turn, lighting up the sky, and telling every player on
 * the map exactly where they are (GDD §2.2 — "gunfire is the loudest tell").
 */
export function canHit(
  self: SelfView,
  target: Vec2,
  targetRadius: number,
  extraTolerance = 0,
  targetVel?: Vec2,
): boolean {
  // Fire when the hull points at the *intercept* bearing, not the raw target
  // bearing — a leading shot only lands if the nose is on the lead (amendment v0.2).
  return canHitDir(self, target, aimDir(self, target, targetVel), targetRadius, extraTolerance);
}

/**
 * The same range-and-facing gate as {@link canHit}, but against an explicit aim
 * direction rather than the clean bearing at the target.
 *
 * Combat uses this so the fire gate is consistent with the *jittered* aim the
 * bot committed to ({@link aimAndFire}): the trigger comes up when the hull is
 * on the direction the bot is actually pointing, so a shot goes out along that
 * jittered line and lands off-target by the spread. If the gate checked the
 * clean bearing instead, `aimJitter` would only throttle the fire rate — the
 * hull would wobble but still fire only when it happened to cross dead-centre —
 * and wider spread would not mean a wider miss. Making spread behave as spread
 * is the difference (`tests/sim/aim-error.test.ts`). Mining keeps the
 * clean-bearing {@link canHit}, where the wobble is the point (slow mining).
 */
export function canHitDir(
  self: SelfView,
  target: Vec2,
  aimDirection: Vec2,
  targetRadius: number,
  extraTolerance = 0,
): boolean {
  const d = dist(self.pos, target);
  if (d > WEAPON_RANGE) return false;
  if (d < 1e-6) return true;
  const want = Math.atan2(aimDirection.y, aimDirection.x);
  const halfWidth = Math.atan2(targetRadius, d);
  return Math.abs(angleDelta(self.angle, want)) <= halfWidth + FIRE_TOLERANCE + extraTolerance;
}

// ---------------------------------------------------------------------------
// Reaction latency — the aim-error model's second half (v0.2.2 field report)
// ---------------------------------------------------------------------------

/**
 * A bot's memory of the lead it is currently shooting with: whose velocity it
 * committed to, that velocity, and the sim time it adopted it. One per bot,
 * lives on the {@link Brain} (`./tree`). Mutable in place — it is the bot's own
 * scratch, never the world's.
 */
export interface AimTrack {
  /** Slot the committed velocity belongs to; `-1` when the bot is not leading
   *  anything. A change here re-acquires immediately (see {@link trackAimVelocity}). */
  targetId: PlayerId;
  /** The (possibly stale) velocity the intercept lead is solved from. */
  vel: Vec2;
  /** Sim time `vel` was adopted. */
  since: number;
}

/** A fresh, un-committed aim track. */
export function newAimTrack(): AimTrack {
  return { targetId: -1, vel: { x: 0, y: 0 }, since: 0 };
}

/**
 * The velocity a bot should solve its intercept lead from *right now* — which is
 * **not** the target's current velocity the instant it changes course. The bot
 * re-samples the target's velocity only once every `latency` seconds; between
 * samples it keeps the one it committed to. So a target that reverses inside the
 * window is led *where it was going*, and the shot goes wide — the reaction lag
 * that makes strafing work (GDD §2.9; `DifficultyTuning.aimLatency`).
 *
 * A brand-new target is acquired immediately (you read a new threat's motion the
 * moment you turn to it); the lag is specifically on *staying* on a target that
 * keeps juking. `latency <= 0` degenerates to perfect tracking — the old aimbot
 * — which is exactly why the tier table never sets it there. Deterministic:
 * pure arithmetic against `now`, no clock, no RNG. Mutates and returns `track`.
 */
export function trackAimVelocity(
  track: AimTrack,
  targetId: PlayerId,
  currentVel: Vec2,
  now: number,
  latency: number,
): Vec2 {
  const acquired = track.targetId !== targetId;
  if (acquired || now - track.since >= latency) {
    track.targetId = targetId;
    track.vel = { x: currentVel.x, y: currentVel.y };
    track.since = now;
  }
  return track.vel;
}

/**
 * How a bot shoots at one target, as the `aim` + `fire` pair — the single source
 * of truth `./behaviors` `engage` wraps with movement and the aim-error harness
 * measures directly (`tests/sim/aim-error.test.ts`).
 *
 * The lead is the latency-delayed velocity ({@link trackAimVelocity}), the tier's
 * angular `spread` rides on top ({@link aimAt}), and the trigger is gated by
 * {@link canHit} against that *same* delayed lead — so a bot fires confidently at
 * where it *thinks* the target will be, and misses when it was wrong. Pass
 * `track: null` for a still target (a turret, a core): no velocity, no lead, no
 * lag, just the spread.
 */
export function aimAndFire(
  self: SelfView,
  targetPos: Vec2,
  targetRadius: number,
  targetVel: Vec2 | undefined,
  spread: number,
  rng: Rng,
  track: AimTrack | null,
  targetId: PlayerId,
  now: number,
  latency: number,
): { aim: AimAction; fire: FireAction } {
  const moving = targetVel !== undefined && (targetVel.x !== 0 || targetVel.y !== 0);
  const leadVel = track && moving ? trackAimVelocity(track, targetId, targetVel, now, latency) : targetVel;
  // One committed direction: the (latency-delayed) intercept lead, rotated by the
  // spread draw. The hull turns toward it and the trigger comes up when the hull
  // reaches it — so the shot flies along this line, spread and all.
  const clean = aimDir(self, targetPos, leadVel);
  const committed = spread > 0 ? rotate(clean, (rng.next() * 2 - 1) * spread) : clean;
  return {
    aim: aim(committed),
    fire: fire(canHitDir(self, targetPos, committed, targetRadius)),
  };
}

/** Weapon reach, re-exported so trees plan trips in the units they shoot in. */
export { WEAPON_RANGE };
