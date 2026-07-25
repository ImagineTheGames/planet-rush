/**
 * src/sim/damage.ts — what it costs to be hit. OWNER: Gameplay Engineer.
 *
 * Ship damage and death live here rather than inside the beam, because from
 * day 2 there are two things that can kill a ship — the shared beam
 * (`step.ts`) and a turret's pooled projectile (`buildings.ts`) — and they must
 * agree exactly on spawn protection, the half-hold ore drop, and the respawn
 * clock (GDD §2.1, §2.3, §2.7). One implementation, two callers, no drift.
 *
 * Planet damage (shields, then core) is *not* here: it carries the repair
 * interruption and shield-regen window with it, so it lives with the buildings
 * it belongs to (`buildings.ts`).
 */

import { CHUNK, DEATH_ORE_DROP_FRACTION, RESPAWN_S, clampToMargin } from './constants';
import type { Ship, World } from './state';

/**
 * Apply `amount` HP of damage to a ship, respecting spawn protection
 * (GDD §2.1), and kill it if that takes it to zero. Returns true if the hit
 * landed — callers use that to decide whether a projectile is spent.
 */
export function damageShip(world: World, target: Ship, amount: number): boolean {
  if (!target.alive || target.spawnProtect > 0 || amount <= 0) return false;
  target.hull -= amount;
  if (target.hull <= 0) killShip(world, target);
  return true;
}

/**
 * Destroy a ship: drop half its held ore as debris and start the respawn clock
 * (GDD §2.3, §2.7). Banked ore is untouched — the cost of dying is time and
 * position, never the bank.
 */
export function killShip(world: World, ship: Ship): void {
  ship.alive = false;
  ship.hull = 0;
  ship.respawnTimer = RESPAWN_S;
  ship.vel.x = 0;
  ship.vel.y = 0;
  ship.beam = null;

  const drop = ship.cargo * DEATH_ORE_DROP_FRACTION;
  ship.cargo = 0;
  if (drop <= 1e-9) return;

  // Scatter debris in a deterministic ring (no RNG needed — angle by index).
  const whole = Math.floor(drop);
  const pieces = whole + (drop - whole > 1e-9 ? 1 : 0);
  for (let i = 0; i < pieces; i++) {
    const amount = i < whole ? CHUNK.ore : drop - whole;
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
