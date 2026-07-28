/**
 * tests/sim/loot-real-combat.test.ts — the developer's repro, ZERO seams in the
 * causal chain. OWNER: Gameplay Engineer (p2c loot regression, third recurrence).
 *
 * The prior lock (`loot-ore-parity.test.ts`) proved the mechanics but through
 * seams: it CALLED `killShip` directly and SET the victim's `cargo` by hand. The
 * regression kept coming back on the path those seams skip — a ship killed by a
 * real projectile, holding ore it actually mined. So this test takes that path
 * end to end and touches no seam between mining and the bank:
 *
 *   1. the victim MINES real ore out of a real asteroid with real weapon shots;
 *   2. the killer DESTROYS it with real weapon projectiles (no `killShip` call);
 *   3. the killer TRACTORS the death drop (real proximity collection);
 *   4. the killer BANKS it in its own atmosphere (real drain).
 *
 * Every unit of ore in the world entered through mining, so the ore ledger's
 * conservation residual must be ~0 the whole way — and the looted ore must
 * actually reach the bank. "It counts for something."
 *
 * (Ship POSITIONS are set to stage the encounter — that moves geometry, not ore.
 * No `cargo`/`banked`/`chunk.amount` is ever written by hand.)
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Action } from '@shared/types';
import {
  createWorld,
  step,
  inAtmosphere,
  stationOf,
  oreResidual,
  type Asteroid,
  type PlayerInput,
  type Ship,
  type World,
} from '../../src/sim';

const unit = (dx: number, dy: number) => {
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
};
const aimAt = (from: Ship, tx: number, ty: number): Action => ({ type: 'aim', dir: unit(tx - from.pos.x, ty - from.pos.y) });
const thrustAt = (from: Ship, tx: number, ty: number): Action => ({ type: 'thrust', dir: unit(tx - from.pos.x, ty - from.pos.y) });
const FIRE: Action = { type: 'fire', active: true, auto: false };
const looseOre = (w: World) => w.chunks.filter((c) => !c.deposit).reduce((n, c) => n + c.amount, 0);

/** Park `ship` a hair inside its own station's atmosphere so the drain runs. */
function parkInHomeAtmosphere(world: World, ship: Ship): void {
  const home = stationOf(world, ship.id)!;
  ship.pos = { x: home.pos.x, y: home.pos.y };
  ship.vel = { x: 0, y: 0 };
}

describe('a dead ship’s ore counts — real combat kill, no seams (p2c)', () => {
  it('mine → real-shot kill → loot → bank, conserving ore every step', () => {
    const world = createWorld({
      seed: 7,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Excavator },
      ],
    });
    const killer = world.ships[0]!;
    const victim = world.ships[1]!;
    killer.spawnProtect = 0;
    victim.spawnProtect = 0;

    // --- 1. The victim mines real ore out of a real rock ------------------
    // Pick a rock and sit the victim right beside it, nose on it, holding fire.
    const rock: Asteroid = [...world.asteroids].sort(
      (a, b) => Math.hypot(a.pos.x - victim.pos.x, a.pos.y - victim.pos.y) - Math.hypot(b.pos.x - victim.pos.x, b.pos.y - victim.pos.y),
    )[0]!;
    victim.pos = { x: rock.pos.x - (rock.radius + victim.radius + 8), y: rock.pos.y };
    victim.vel = { x: 0, y: 0 };
    // Keep the killer far away and idle while the victim fills its hold.
    killer.pos = { x: rock.pos.x + 4000, y: rock.pos.y };

    for (let t = 0; t < 1200 && victim.cargo < 4; t++) {
      victim.pos = { x: rock.pos.x - (rock.radius + victim.radius + 8), y: rock.pos.y };
      victim.vel = { x: 0, y: 0 };
      step(world, [{ id: 1, actions: [aimAt(victim, rock.pos.x, rock.pos.y), FIRE] }]);
    }
    const minedHold = victim.cargo;
    expect(minedHold).toBeGreaterThan(0); // real ore, really mined
    expect(Math.abs(oreResidual(world))).toBeLessThan(1e-6);

    // --- 2. The killer destroys the victim with real weapon projectiles ---
    killer.pos = { x: victim.pos.x - 70, y: victim.pos.y };
    killer.vel = { x: 0, y: 0 };
    let killed = false;
    for (let t = 0; t < 3000 && !killed; t++) {
      // Hold station next to the victim and pour fire into it.
      killer.pos = { x: victim.pos.x - 70, y: victim.pos.y };
      killer.vel = { x: 0, y: 0 };
      const inputs: PlayerInput[] = [{ id: 0, actions: [aimAt(killer, victim.pos.x, victim.pos.y), FIRE] }];
      step(world, inputs);
      killed = !victim.alive;
    }
    expect(killed).toBe(true);
    // Half the victim's mined hold is now loose loot on the map (no seam killed it).
    expect(looseOre(world)).toBeGreaterThan(0);
    expect(Math.abs(oreResidual(world))).toBeLessThan(1e-6);

    // --- 3. The killer tractors the death drop ----------------------------
    const bankBefore = killer.banked; // starting bank (STARTING_ORE)
    for (let t = 0; t < 800 && looseOre(world) > 1e-9; t++) {
      const chunk = world.chunks.find((c) => !c.deposit);
      const act: Action[] = chunk ? [thrustAt(killer, chunk.pos.x, chunk.pos.y)] : [];
      step(world, [{ id: 0, actions: act }]);
    }
    const looted = killer.cargo;
    expect(looted).toBeGreaterThan(0); // the dead ship's ore is in the hold
    expect(Math.abs(oreResidual(world))).toBeLessThan(1e-6);

    // --- 4. The killer banks the loot in its own atmosphere ---------------
    parkInHomeAtmosphere(world, killer);
    for (let t = 0; t < 600 && killer.cargo > 1e-9; t++) {
      parkInHomeAtmosphere(world, killer);
      step(world, []);
      expect(inAtmosphere(killer, stationOf(world, 0)!)).toBe(true);
    }
    const bankGain = killer.banked - bankBefore;

    // The looted ore counted: every unit that reached the hold reached the bank.
    expect(killer.cargo).toBeCloseTo(0, 6);
    expect(bankGain).toBeCloseTo(looted, 6);
    // And the whole causal chain conserved ore exactly — no black hole anywhere.
    expect(Math.abs(oreResidual(world))).toBeLessThan(1e-6);
  });
});
