/**
 * src/sim/allegiance.ts — the ONE friend/foe predicate. OWNER: Gameplay Engineer.
 *
 * Variable match sizes / Teams (docs/variable-slots-plan.md, Task A3). Before
 * this module, "is that mine?" was inlined as `id === owner` equality in seven
 * places across `projectiles`, `buildings`, and `step` (spike §3). Every one of
 * those is really "is that a FOE?", and Teams needs them to agree — so they all
 * route through {@link areEnemies} now, and FFA vs TEAMS becomes a difference in
 * the `team` table, not a difference in any code path.
 *
 * **FFA is teams-of-one.** `createWorld` defaults each player's `team` to its own
 * id (`./state`), so `teamOf(a) !== teamOf(b)` reduces to `a !== b` — byte-for-byte
 * the old behaviour. TEAMS simply hands two slots the same `team`.
 *
 * Pure reads over plain-data state; no RNG, no allocation. `team` is stored on
 * `Ship`/`Planet` as a plain int, so this never touches the per-tick snapshot
 * (allegiance is static match config, fixed at match start — spike Trap 7).
 */

import type { PlayerId } from '@shared/types';
import type { World } from './state';

/**
 * The team a player belongs to. Reads the `team` stamped on that player's ship
 * (its planet as a fallback), and — for the pre-Teams fixtures other agents
 * build without a `team` — falls back to the player id itself, i.e. teams-of-one
 * (the same backward-compatible discipline `Ship.weaponCooldown` uses). An id
 * with no ship and no planet (should never happen in a live world) also reads as
 * its own team, so a stray lookup can never crash a match.
 */
export function teamOf(world: World, id: PlayerId): number {
  for (const s of world.ships) if (s.id === id) return s.team ?? s.id;
  for (const p of world.planets) if (p.owner === id) return p.team ?? p.owner;
  return id;
}

/**
 * True when players `a` and `b` are on opposing sides — the single question the
 * whole sim asks about allegiance (targeting, collision, siege).
 *
 * A player is never their own enemy (a shot always flies over its owner), so the
 * `a === b` short-circuit guarantees self-immunity independent of any team
 * bookkeeping. Otherwise it is simply "different team?": in FFA every player is a
 * team of one, so this is `a !== b`; in TEAMS, allies share a `team` and read as
 * friends. Friendly fire is therefore OFF by construction (ratified 2026-07-26) —
 * allies are not enemies, so shots, turrets, and auto-aim all pass them by.
 */
export function areEnemies(world: World, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return false;
  return teamOf(world, a) !== teamOf(world, b);
}
