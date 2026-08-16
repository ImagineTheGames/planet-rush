/**
 * src/sim/damage.ts — what it costs to be hit. OWNER: Gameplay Engineer.
 *
 * Ship damage and death live here rather than inside the shot resolver, because
 * there are two things that can kill a ship — the ship weapon projectile
 * (`step.ts` → `projectiles.ts`) and a turret's pooled projectile
 * (`buildings.ts`) — and they must agree exactly on spawn protection, the
 * half-hold ore drop, and the respawn clock (GDD §2.1, §2.3, §2.7). One
 * implementation, two callers, no drift.
 *
 * Station damage (shields, then core) is *not* here: it carries the repair
 * interruption and shield-regen window with it, so it lives with the buildings
 * it belongs to (`buildings.ts`).
 */

import type { PlayerId } from '@shared/types';
import { creditDamage, creditKill } from './combat-credit';
import { CHUNK, DEATH_ORE_DROP_FRACTION, RESPAWN_S, clampToMargin } from './constants';
import { ledgerAdd } from './ore-ledger';
import type { Ship, World } from './state';

/**
 * Apply `amount` HP of damage to a ship, respecting spawn protection
 * (GDD §2.1), and kill it if that takes it to zero. Returns true if the hit
 * landed — callers use that to decide whether a projectile is spent.
 *
 * `by` is the attacker's **slot**, when the hit has one: `projectiles.ts` passes
 * `p.owner`, which is the shooter for a ship weapon shot and the *station owner*
 * for a turret shot (§1.5 trap 3 — a player who bought the deterrent gets what it
 * kills). It is optional because some hits genuinely have no attacker, and it is
 * never inferred: an omitted `by` credits nobody, which is the honest answer, not
 * a gap (`./combat-credit`). Nothing about the damage rule reads it — spawn
 * protection, the half-hold drop and the respawn clock are identical with and
 * without it.
 */
export function damageShip(world: World, target: Ship, amount: number, by?: PlayerId): boolean {
  if (!target.alive || target.spawnProtect > 0 || amount <= 0) return false;
  // Credit the HP that actually landed, never the overkill: a 9999-damage
  // finisher into a 30 HP hull dealt 30 (`./combat-credit`).
  creditDamage(world, by, target.id, 'dealtToShips', Math.min(amount, target.hull));
  target.hull -= amount;
  if (target.hull <= 0) killShip(world, target, by);
  return true;
}

/**
 * Destroy a ship: drop half its held ore as debris and start the respawn clock
 * (GDD §2.3, §2.7). Banked ore is untouched — the cost of dying is time and
 * position, never the bank.
 *
 * The drop is minted in **whole `CHUNK.ore` units and nothing else** (a0-58): a
 * half-hold that does not divide evenly sheds what it can and burns the sub-chunk
 * remainder with the ship. See the comment on the split below for why a fraction
 * in a hold is a bug and not an accounting nicety.
 *
 * `by` credits the killing blow to one slot, never split (§1.5 trap 5). The slot
 * is the accounting key rather than the hull, so a shot that outlives its owner's
 * ship still pays that owner — including a player already eliminated from the
 * match (trap 4). A death with no attacker (elimination collateral, a test call,
 * the `?debug=1` write seam) credits nobody.
 */
export function killShip(world: World, ship: Ship, by?: PlayerId): void {
  creditKill(world, by, ship.id, 'shipKills');
  ship.alive = false;
  ship.hull = 0;
  ship.respawnTimer = RESPAWN_S;
  ship.vel.x = 0;
  ship.vel.y = 0;
  ship.firing = false;

  const held = ship.cargo;
  const drop = held * DEATH_ORE_DROP_FRACTION;
  ship.cargo = 0;

  // WHOLE CHUNKS ONLY, AND THE REMAINDER BURNS WITH THE SHIP (a0-58).
  //
  // Half of an odd hold is a half: 3 ore drops 1.5. That used to be laid down as
  // one `CHUNK.ore` piece plus one of 0.5 — an exact split, and the ledger balanced
  // on it — but a 0.5 that reaches a hold is ore the player owns and NO readout can
  // show: the hold is pips, a cost is a whole number, the wheel prints integers, so
  // all three floor it away. Collect one and the hold reads unchanged; collect the
  // matching second and it jumps by a whole, which is precisely the developer's
  // *"their ore's don't always count when picked up"* (2026-08-16).
  //
  // Ore is a countable thing, so a drop mints countable things. The sub-chunk
  // remainder is destroyed with the ship instead, in `deathLoss` — the sink half
  // this hold is ALREADY going to by design (GDD §2.3) — so the ledger still
  // conserves EXACTLY and the economy loses nothing it was not already losing. The
  // fix is at the mint and not in the HUD on purpose: `Math.floor` in three
  // readouts is the messenger; a hold that can contain 1.5 is the message.
  //
  // Driven off `CHUNK.ore` throughout, never the literal 1: it is TUNABLE, and the
  // day it moves this must still emit chunk-sized pieces.
  const pieces = Math.floor(drop / CHUNK.ore);
  const scattered = pieces * CHUNK.ore;
  // The unshed half AND the sub-chunk remainder are destroyed with the ship — one
  // real sink (GDD §2.3). Recorded before the drop so the ledger sees the whole
  // hold leave the economy: `scattered` to chunks, everything else gone.
  ledgerAdd(world, 'deathLoss', held - scattered);
  if (pieces <= 0) return; // nothing whole to drop: the hold went down with the hull.
  ledgerAdd(world, 'dropped', scattered);

  // Scatter debris in a deterministic ring (no RNG needed — angle by index).
  for (let i = 0; i < pieces; i++) {
    const theta = (2 * Math.PI * i) / pieces;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    world.chunks.push({
      id: world.nextEntityId++,
      pos: {
        x: clampToMargin(ship.pos.x + dx * (ship.radius + CHUNK.radius), CHUNK.radius, world.bounds.width),
        y: clampToMargin(ship.pos.y + dy * (ship.radius + CHUNK.radius), CHUNK.radius, world.bounds.height),
      },
      vel: { x: dx * CHUNK.ejectSpeed, y: dy * CHUNK.ejectSpeed },
      amount: CHUNK.ore,
      radius: CHUNK.radius,
    });
  }
}
