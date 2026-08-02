/**
 * src/sim/blockade.ts — the cornered geometry. OWNER: Gameplay Engineer.
 *
 * The developer's screenshot (p15, ratified): Rusty at 38/70 hull, the player's
 * ship parked *squarely on the line* between Rusty and its own station. Rusty
 * dithers. "In this case they need to attack and stop being scared."
 *
 * The p8-era hysteresis (`src/bots/commitment.ts`) bounds how *often* a
 * flee/fight pair can flip, and that was the right fix for the pathology it was
 * built for — a threshold with no memory. It cannot fix this one, because this
 * one is not a threshold problem at all, it is a **geometry** problem: fear
 * pushes the ship away from the threat, home pulls it back through the threat,
 * and the two pulls are exactly anti-parallel. That is a stable trap on the
 * segment between them, and no amount of memory between two thresholds moves a
 * ship off it — the destination itself is on the far side of the thing being
 * feared.
 *
 * So the trap has to be *recognised*, and this module is the recogniser: three
 * pure functions that answer, from four positions and two speeds, whether a safe
 * point is actually reachable without going through the thing you are running
 * from.
 *
 *  1. {@link pathBlock} — is the threat ON the path? (inside a corridor of the
 *     `from → to` segment, ahead of the ship, and short of the destination)
 *  2. {@link detourExtra} — what does going *around* it cost? (the classical
 *     tangent–arc–tangent length past a disc, minus the straight line)
 *  3. {@link detourIsCheap} — is that arc worth flying, **given relative
 *     speeds**? A blockader at least as fast as you re-blocks whatever line you
 *     pick, so no arc is ever cheap against it.
 *
 * All three cornered ⇒ the path is shut. What a *bot* then does about it — the
 * commitment window, the per-tier lag before it notices — is behavior and lives
 * with the behavior trees (`src/bots/cornered.ts`); this file owns only the
 * truth of the geometry, in the same spirit as `./combat-view` and `./sensing`:
 * a pure read model over positions, never a writer, never a policy.
 *
 * Pure and deterministic: no RNG, no clock, no world handle, and `Math.sqrt`
 * over `Math.hypot` for the reason the rest of the sim gives (GDD §4.1, §4.8).
 */

import type { Vec2 } from '@shared/types';
import { BLOCKADE } from './constants';

/**
 * Where a threat sits relative to the segment a ship wants to fly — the raw
 * geometry read, before any judgement about what to do with it.
 *
 * `along` and `offset` are the threat's coordinates in the segment's own frame:
 * how far down the line it projects, and how far off the line it stands. They
 * are reported unclamped-but-honest (`along` may be negative for a threat behind
 * the ship, or past `span` for one beyond the destination) so a caller can tell
 * *which* way a non-blocking read failed.
 */
export interface PathBlock {
  /** Length of the `from → to` segment. Zero when the ship is on its destination. */
  readonly span: number;
  /** Distance from `from` at which the threat projects onto the segment's line.
   *  Negative ⇒ the threat is behind the ship; `> span` ⇒ past the destination. */
  readonly along: number;
  /** Perpendicular distance from the threat to the segment's line. Never negative. */
  readonly offset: number;
  /**
   * The threat is on the path: inside `corridor` of the line, ahead of the ship
   * (`along > 0`), and closer to the ship than the destination is. This is the
   * ratified wording made arithmetic — "the threat sits ON the path (within
   * corridor width of the line segment, closer than the destination)".
   */
  readonly blocking: boolean;
}

/**
 * Read a threat against the line a ship wants to fly.
 *
 * `corridor` is the half-width of the lane that counts as "on the path" — the
 * band a ship cannot pass through without coming under the blockader's guns.
 * Defaults to {@link BLOCKADE.corridor}.
 *
 * A degenerate segment (the ship is already at its destination) blocks nothing:
 * there is no path left to block.
 */
export function pathBlock(from: Vec2, to: Vec2, threat: Vec2, corridor: number = BLOCKADE.corridor): PathBlock {
  const px = to.x - from.x;
  const py = to.y - from.y;
  const span = Math.sqrt(px * px + py * py);
  if (span < 1e-9) return { span: 0, along: 0, offset: 0, blocking: false };

  const ux = px / span;
  const uy = py / span;
  const tx = threat.x - from.x;
  const ty = threat.y - from.y;
  const along = tx * ux + ty * uy;
  // Perpendicular component: the 2D cross product against the unit heading.
  const offset = Math.abs(tx * uy - ty * ux);

  // Ahead, short of the destination, and inside the lane. The `along < span`
  // test is the "closer than the destination" clause: a threat sitting *on* the
  // destination is not blockading the path to it — that is a siege, and a
  // different branch's problem.
  const blocking = along > 0 && along < span && offset <= corridor;
  return { span, along, offset, blocking };
}

/**
 * Extra distance, in world units, that flying *around* a threat costs over
 * flying straight at the destination.
 *
 * The detour modelled is the shortest path that keeps `corridor` clear of the
 * threat: leave the straight line on a tangent to the exclusion disc, ride the
 * disc's rim, and rejoin on a tangent — the classical tangent–arc–tangent
 * solution, `t₁ + t₂ + R·θ_arc`. It is the cheapest honest detour, so using it
 * means the bot only calls itself cornered when *no* route is cheap, not merely
 * when the obvious one is not.
 *
 * Returns `0` when the straight line already clears the disc (nothing to pay),
 * and `Infinity` when either endpoint lies *inside* the exclusion disc — there
 * is no tangent path from a point already in the blockader's lap, and "no path"
 * is the honest answer rather than some arbitrarily large number.
 */
export function detourExtra(from: Vec2, to: Vec2, threat: Vec2, corridor: number = BLOCKADE.corridor): number {
  const px = to.x - from.x;
  const py = to.y - from.y;
  const direct = Math.sqrt(px * px + py * py);
  if (direct < 1e-9) return 0;

  const r = Math.max(0, corridor);
  const ax = from.x - threat.x;
  const ay = from.y - threat.y;
  const bx = to.x - threat.x;
  const by = to.y - threat.y;
  const d1 = Math.sqrt(ax * ax + ay * ay);
  const d2 = Math.sqrt(bx * bx + by * by);
  // Standing inside the disc (or the destination is): no tangent exists. A ship
  // this close is not detouring, it is already in the fight.
  if (d1 <= r || d2 <= r) return Number.POSITIVE_INFINITY;

  // Tangent lengths from each endpoint to the disc, and the angle the two
  // endpoints subtend at the threat.
  const t1 = Math.sqrt(d1 * d1 - r * r);
  const t2 = Math.sqrt(d2 * d2 - r * r);
  const theta = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  // Each tangent eats `acos(r/d)` of that angle; whatever is left is rim to ride.
  const arc = theta - Math.acos(r / d1) - Math.acos(r / d2);
  if (arc <= 0) return 0; // the straight line already misses the disc

  const detour = t1 + t2 + r * arc;
  return Math.max(0, detour - direct);
}

/**
 * Is going around worth it, *given relative speeds*?
 *
 * The ratified rule says a bot is cornered when "no cheap detour exists (arc
 * around the threat costs more than engaging given relative speeds)", and the
 * relative-speed clause is the load-bearing half. Extra distance alone is not a
 * verdict: 200 units of arc is nothing to an Interceptor slipping past a Hauler
 * and everything to a Hauler trying to slip past an Interceptor, because the
 * blockader spends the whole detour repositioning onto the new line.
 *
 * So the cost is measured in the only currency that buys anything here — the
 * speed *margin*. A bot outruns a blockade at `ownSpeed − threatSpeed`; the
 * detour is cheap only if the extra ground closes inside `budgetSeconds` at that
 * margin. A blockader at least as fast re-blocks every line the bot can pick, so
 * the margin is zero-or-worse and **nothing** is cheap — which is exactly the
 * screenshot: a wounded Hauler cannot go around a Vanguard, and pretending it
 * can is what produced the dithering.
 */
export function detourIsCheap(
  extra: number,
  ownSpeed: number,
  threatSpeed: number,
  budgetSeconds: number = BLOCKADE.detourBudgetSeconds,
): boolean {
  if (!(extra > 0)) return true; // nothing to pay — the line is already open
  if (!Number.isFinite(extra)) return false; // no tangent path at all
  if (ownSpeed <= 0) return false;
  const margin = ownSpeed - threatSpeed;
  if (margin <= 0) return false; // it can follow you around the arc
  return extra / margin <= budgetSeconds;
}

/** The four positions-and-speeds a cornered read is taken from. */
export interface CorneredQuery {
  /** Where the ship is now. */
  readonly from: Vec2;
  /** The safe point it wants — its own station, or any other safe destination. */
  readonly to: Vec2;
  /** Where the blockading ship is. */
  readonly threat: Vec2;
  /** The ship's own top speed (world units/s). */
  readonly ownSpeed: number;
  /** The blockader's top speed, as read off its hull class — the silhouette is
   *  public information (GDD §2.11), the engine tiers behind it are not. */
  readonly threatSpeed: number;
  /** Half-width of the lane that counts as blocked. Defaults to {@link BLOCKADE.corridor}. */
  readonly corridor?: number;
  /** Seconds of extra flight a detour may cost. Defaults to
   *  {@link BLOCKADE.detourBudgetSeconds}. */
  readonly budgetSeconds?: number;
}

/** A cornered read, with the working shown — so a test (and a debug overlay) can
 *  say *why* a bot did or did not call itself trapped. */
export interface CorneredReading extends PathBlock {
  /** Extra world units the cheapest detour costs; `0` when the line is clear and
   *  `Infinity` when no tangent path exists. */
  readonly detour: number;
  /** Whether that detour is worth flying at the two ships' relative speeds. */
  readonly detourCheap: boolean;
  /** On the path, and no cheap way around it: the path is shut. */
  readonly cornered: boolean;
}

/**
 * The whole geometry verdict: **is this ship's road home shut by that ship?**
 *
 * Both clauses must hold — the threat is on the path *and* no cheap arc goes
 * around it. Nothing here knows about hulls, fear, difficulty, or commitment
 * windows; a caller supplies the destination it was already flying to and gets
 * back whether that destination is actually reachable.
 */
export function corneredReading(q: CorneredQuery): CorneredReading {
  const path = pathBlock(q.from, q.to, q.threat, q.corridor);
  if (!path.blocking) {
    return { ...path, detour: 0, detourCheap: true, cornered: false };
  }
  const detour = detourExtra(q.from, q.to, q.threat, q.corridor);
  const detourCheap = detourIsCheap(detour, q.ownSpeed, q.threatSpeed, q.budgetSeconds);
  return { ...path, detour, detourCheap, cornered: !detourCheap };
}
