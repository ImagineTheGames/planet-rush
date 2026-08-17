/**
 * evidence/a0-68-structural-slots/impact-surfaces.ts — does the tell carry the
 * right surface? OWNER: Sound Agent.
 *
 * Run: `npx vite-node evidence/a0-68-structural-slots/impact-surfaces.ts`
 *
 * *"none of these sound like impact sounds, they should also be different
 * depending on the thing that was hit…"* — the developer, 2026-08-17.
 *
 * The sound half of that is easy. The half that is actually work is making the
 * `shotImpact` tell **carry** what was hit, without `src/sim/` growing an event
 * bus (GDD §4.1 forbids it, and it is not this lane's file) and without the audio
 * engine guessing from whatever the renderer happened to know. So the surface is
 * derived in `WorldObserver.impactSurface` — the one derivation both the VFX and
 * the audio read, and the one that runs identically on a locally predicted world
 * and on an authoritative server snapshot.
 *
 * This drives one real shot per surface through the real sim and the real
 * observer, and prints the surface the tell came out carrying beside the sim
 * branch that actually ran. Five scenarios for the four voices, because the
 * station fold ({@link IMPACT_OF}) is a decision and it should be visible.
 *
 * Not part of the game bundle and not in the tsconfig `include`.
 */

import { ShipClass } from '../../src/shared/types';
import {
  ASTEROID,
  TICK_DT,
  createWorld,
  fireShipProjectile,
  placeOrder,
  step,
  type PlayerSpec,
  type World,
} from '../../src/sim';
import { IMPACT_NAMES, TELL, TellQueue } from '../../src/art/tells';
import { IMPACT_SOUND } from '../../src/art/audio/bank';
import { WorldObserver } from '../../src/art/vfx/observer';

const PLAYERS: readonly PlayerSpec[] = [
  { id: 0, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Vanguard },
];

const out: string[] = [];
const say = (line = ''): void => {
  out.push(line);
  console.log(line);
};

function fresh(): World {
  const world = createWorld({ seed: 0xa068, players: PLAYERS });
  // Nobody's opening grace is in play here — every scenario is about what a shot
  // lands ON, and `resolveHit` skips a protected body entirely (that is scenario
  // 2 of `spawn-protection.ts`, not this one).
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const station of world.stations) station.spawnProtect = 0;
  return world;
}

/** Move a ship to a corner of the arena and stop it — out of every scenario's
 *  firing line. `resolveHit` tests hulls before anything else, so a bystander on
 *  the line silently turns a turret test into a ship test. */
function park(ship: World['ships'][number], world: World): World['ships'][number] {
  ship.pos.x = world.bounds.width - 40;
  ship.pos.y = world.bounds.height - 40;
  ship.vel.x = 0;
  ship.vel.y = 0;
  return ship;
}

/** Is the STANDOFF-long approach to `(x, y)` clear of rock and station? */
function clearApproach(world: World, x: number, y: number): boolean {
  for (const station of world.stations) {
    if (Math.hypot(station.pos.x - x, station.pos.y - y) < station.radius + STANDOFF + 80) return false;
  }
  let touched = 0;
  for (const a of world.asteroids) {
    if (a.pos.y > y - a.radius - 8 && a.pos.y < y + a.radius + 8 && a.pos.x < x && a.pos.x > x - STANDOFF) touched++;
  }
  return touched === 0 && x - STANDOFF > 40;
}

/** How far the shooter stands off its target. Inside a stock hull's 300-unit
 *  reach (`shipProjectileLife × shipProjectileSpeed`), so every shot arrives. */
const STANDOFF = 150;

/**
 * Fire one shot from p0 at `(tx, ty)` and return the surface the observer put on
 * the resulting `shotImpact` tell, or `none` if no impact was tell-worthy.
 *
 * The shooter is placed `STANDOFF` to the LEFT of the target and fires right, so
 * the line is short, clean, and the same in every scenario — a scenario that
 * accidentally puts another body on the line tests the wrong branch.
 */
function shootAt(world: World, tx: number, ty: number): string {
  const shooter = world.ships[0]!;
  shooter.pos.x = tx - STANDOFF;
  shooter.pos.y = ty;
  shooter.vel.x = 0;
  shooter.vel.y = 0;

  const observer = new WorldObserver({ local: 0 });
  const queue = new TellQueue();
  // Prime: the first observe absorbs the world and emits nothing, by design.
  observer.observe(world, TICK_DT, queue);

  const dx = tx - shooter.pos.x;
  const dy = ty - shooter.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  fireShipProjectile(world, shooter, { x: dx / len, y: dy / len });

  for (let i = 0; i < 240; i++) {
    // Hold every gun's reload up so nothing shoots back. Without this the turret
    // scenario measures the TURRET'S return fire landing on the shooter's hull —
    // which the classifier calls `hull`, correctly, for the wrong shot. (It did,
    // the second run: the first `shotImpact` in the queue was at x=107.7, at the
    // shooter, while the shot under test was still in the air at x=201.)
    for (const station of world.stations) {
      for (const turret of station.turrets) turret.cooldown = 99;
    }
    step(world, [], TICK_DT);
    queue.clear();
    observer.observe(world, TICK_DT, queue);
    const at = queue.indexOf(TELL.shotImpact);
    if (at >= 0) return IMPACT_NAMES[queue.variantAt(at)] ?? `?${queue.variantAt(at)}`;
  }
  return 'none';
}

const rows: { scenario: string; branch: string; got: string }[] = [];
const record = (scenario: string, branch: string, got: string): void => {
  rows.push({ scenario, branch, got });
};

// --- hull ------------------------------------------------------------------
{
  const world = fresh();
  const target = park(world.ships[1]!, world);
  record('an enemy ship', 'damageShip', shootAt(world, target.pos.x, target.pos.y));
}

// --- hull, on the killing blow ---------------------------------------------
//
// The case that made `ShipMemo.hullFrame` necessary: `resolveHit` only strikes a
// LIVE ship, so this is a hull hit — but the observer is looking at a world in
// which the hull is already dead, and a geometric scan alone would skip it and
// fall through to the default surface. A shot that kills somebody must not sound
// like a shot into stone.
{
  const world = fresh();
  const target = park(world.ships[1]!, world);
  target.hull = 0.5; // one round finishes it
  record('an enemy ship, killed by the shot', 'damageShip → dead', shootAt(world, target.pos.x, target.pos.y));
}

// --- rock ------------------------------------------------------------------
{
  const world = fresh();
  // Any rock with nothing else on the approach — the shooter is placed STANDOFF
  // to its left, so what matters is that stretch being empty.
  const rock = world.asteroids.find((a) => clearApproach(world, a.pos.x, a.pos.y)) ?? world.asteroids[0]!;
  // Everyone else out of the way: `resolveHit` tests hulls before rock.
  for (const s of world.ships) if (s.id !== 0) park(s, world);
  record('an asteroid', 'chipAsteroid', shootAt(world, rock.pos.x, rock.pos.y));
}

// --- turret (folds to `station`) -------------------------------------------
{
  const world = fresh();
  const enemy = world.stations[1]!;
  const owner = world.ships[1]!;
  owner.pos.x = enemy.pos.x;
  owner.pos.y = enemy.pos.y;
  owner.banked = 999;
  placeOrder(world, owner, 'turret');
  for (const job of enemy.builds) job.remaining = 0;
  step(world, [], TICK_DT);
  const turret = enemy.turrets[0]!;
  // The builder has to LEAVE. It was parked at the station centre to be docked,
  // which for half the mount angles puts a hull on the line to the turret — and
  // `resolveHit` tests hulls first, so the scenario would quietly measure the
  // ship branch and report `hull` for a turret shot. (It did, the first run.)
  park(owner, world);
  record('an enemy turret', 'damageTurret', shootAt(world, turret.pos.x, turret.pos.y));
}

// --- shield ----------------------------------------------------------------
{
  const world = fresh();
  const enemy = world.stations[1]!;
  const owner = world.ships[1]!;
  owner.pos.x = enemy.pos.x;
  owner.pos.y = enemy.pos.y;
  owner.banked = 999;
  placeOrder(world, owner, 'shield');
  for (const job of enemy.builds) job.remaining = 0;
  step(world, [], TICK_DT);
  park(owner, world);
  record(`an enemy core behind a live shield (${enemy.shields.length} up)`, 'damageStation → shields', shootAt(world, enemy.pos.x, enemy.pos.y));
}

// --- bare core (folds to `station`) ----------------------------------------
{
  const world = fresh();
  const enemy = world.stations[1]!;
  for (const shield of enemy.shields) shield.hp = 0;
  for (const s of world.ships) if (s.id !== 0) park(s, world);
  record('an enemy core, no shield', 'damageStation → core', shootAt(world, enemy.pos.x, enemy.pos.y));
}

// ---------------------------------------------------------------------------

say('=== the surface a shotImpact tell comes out carrying ===');
say('');
say(`${'scenario'.padEnd(42)} ${'sim branch that ran'.padEnd(24)} surface   → voice`);
say('-'.repeat(100));
for (const r of rows) {
  const surface = IMPACT_NAMES.indexOf(r.got);
  const voice = surface >= 0 ? IMPACT_SOUND[surface] : '(none)';
  say(`${r.scenario.padEnd(42)} ${r.branch.padEnd(24)} ${r.got.padEnd(9)} → ${voice}`);
}
say('');
say(`ASTEROID.maxRadius ${ASTEROID.maxRadius} · the scan is ships, then per station: turrets,`);
say('satellites, live shields, core — the same order and the same first-body-wins');
say('rule as `src/sim/projectiles.ts` resolveHit, so the two cannot disagree.');
say('');
say('(Regenerate: npx vite-node evidence/a0-68-structural-slots/impact-surfaces.ts)');
