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
 * `Ship`/`MiningStation` as a plain int, so this never touches the per-tick snapshot
 * (allegiance is static match config, fixed at match start — spike Trap 7).
 */

import type { PlayerId } from '@shared/types';
import { FRIENDLY_FIRE } from './constants';
import type { World } from './state';

/**
 * The team a player belongs to. Reads the `team` stamped on that player's ship
 * (its station as a fallback), and — for the pre-Teams fixtures other agents
 * build without a `team` — falls back to the player id itself, i.e. teams-of-one
 * (the same backward-compatible discipline `Ship.weaponCooldown` uses). An id
 * with no ship and no station (should never happen in a live world) also reads as
 * its own team, so a stray lookup can never crash a match.
 */
export function teamOf(world: World, id: PlayerId): number {
  for (const s of world.ships) if (s.id === id) return s.team ?? s.id;
  for (const p of world.stations) if (p.owner === id) return p.team ?? p.owner;
  return id;
}

/**
 * True when players `a` and `b` are on opposing sides — the single question the
 * whole sim asks about allegiance (targeting, collision, siege).
 *
 * A player is never their own enemy (a shot always flies over its owner), so the
 * `a === b` short-circuit guarantees self-immunity independent of any team
 * accounting. Otherwise it is simply "different team?": in FFA every player is a
 * team of one, so this is `a !== b`; in TEAMS, allies share a `team` and read as
 * friends. Friendly fire is therefore OFF by construction (ratified 2026-07-26) —
 * allies are not enemies, so shots, turrets, and auto-aim all pass them by.
 */
export function areEnemies(world: World, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return false;
  return teamOf(world, a) !== teamOf(world, b);
}

/**
 * True when `a` and `b` are on the SAME side — allies, or the same player. The
 * exact complement of {@link areEnemies}, named for the callers that ask the
 * question the other way round.
 *
 * This is the **under-attack alarm's ownership predicate** (developer report
 * s5, "the alarm fires for ENEMY bases"). The alarm belongs to *ownership, not
 * proximity*: a station taking damage rings player P's alarm only when the
 * station's owner is on P's side — `sameSide(world, P, owner)`. In FFA that is
 * `P === owner` (your own home, and no one else's — enemies and neutral
 * derelicts read as foes and stay silent). In TEAMS it opens to a teammate's
 * home too, at zero extra code: same-team owners are on your side by the same
 * `team` table every other allegiance check reads. The three alarm surfaces —
 * the audio klaxon (`src/art/audio`), the HUD arrow (`src/ui`), and the haptic
 * pulse (`src/main`) — should each gate on THIS, so they can never disagree
 * about whose siege you hear.
 */
export function sameSide(world: World, a: PlayerId, b: PlayerId): boolean {
  return !areEnemies(world, a, b);
}

/**
 * Whether a shot fired by `attacker` may deal damage to `victim` — the single
 * gate every projectile-damage site reads (`./projectiles`), so friendly fire is
 * one switch, not a rule scattered across the damage branches.
 *
 * A shot always flies over its own owner (`attacker === victim` → false), no
 * matter what — self-immunity never depends on the flag, so flipping friendly
 * fire on can never make a ship shoot itself. An **enemy** is always damageable.
 * An **ally** is damageable only when {@link FRIENDLY_FIRE} is ratified ON
 * (`./constants`); with it OFF (the default), a teammate in the line of fire eats
 * nothing and the projectile passes through (GDD §2.1). This is a strictly looser
 * question than {@link areEnemies}, which the *targeting* ladder keeps using —
 * auto-aim, turrets, and bots never *lock* an ally regardless of the flag; this
 * only decides what a shot already in flight is allowed to hit.
 */
export function canDamage(world: World, attacker: PlayerId, victim: PlayerId): boolean {
  if (attacker === victim) return false;
  if (areEnemies(world, attacker, victim)) return true;
  return FRIENDLY_FIRE;
}
