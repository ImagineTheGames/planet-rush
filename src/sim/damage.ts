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
  if (drop <= 1e-9) {
    // Nothing worth dropping: the whole (tiny) hold is destroyed with the ship.
    ledgerAdd(world, 'deathLoss', held);
    return;
  }
  // The unshed half is destroyed with the ship — a real sink (GDD §2.3). Recorded
  // before the drop so the ledger sees the full hold leave the economy: half to
  // chunks (`dropped`, below), half gone (`deathLoss`).
  ledgerAdd(world, 'deathLoss', held - drop);
  ledgerAdd(world, 'dropped', drop);

  // Scatter debris in a deterministic ring (no RNG needed — angle by index). Ore
  // is split into whole CHUNK.ore pieces plus one remainder, so the pieces sum to
  // `drop` EXACTLY for any chunk size — never the `/1` shortcut that would mint or
  // burn ore the day CHUNK.ore is tuned off 1 (it is TUNABLE).
  const whole = Math.floor(drop / CHUNK.ore);
  const remainder = drop - whole * CHUNK.ore;
  const pieces = whole + (remainder > 1e-9 ? 1 : 0);
  for (let i = 0; i < pieces; i++) {
    const amount = i < whole ? CHUNK.ore : remainder;
    const theta = (2 * Math.PI * i) / Math.max(1, pieces);
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    world.chunks.push({
      id: world.nextEntityId++,
      pos: {
        x: clampToMargin(ship.pos.x + dx * (ship.radius + CHUNK.radius), CHUNK.radius, world.bounds.width),
        y: clampToMargin(ship.pos.y + dy * (ship.radius + CHUNK.radius), CHUNK.radius, world.bounds.height),
      },
      vel: { x: dx * CHUNK.ejectSpeed, y: dy * CHUNK.ejectSpeed },
      amount,
      radius: CHUNK.radius,
    });
  }
}
