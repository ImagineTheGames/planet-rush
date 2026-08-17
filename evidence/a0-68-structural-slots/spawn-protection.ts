/**
 * evidence/a0-68-structural-slots/spawn-protection.ts — is the mechanic real? OWNER: Sound Agent.
 *
 * Run: `npx vite-node evidence/a0-68-structural-slots/spawn-protection.ts`
 *
 * The developer denied `spawnPulse` with *"we dont have spawn portection i dont
 * know what these are"*. Before a single candidate is generated, that sentence has
 * to be answered as a fact rather than as an opinion — a board that carries sounds
 * for mechanics which do not exist is the thing the denial is complaining about.
 *
 * So this drives a real headless match through `src/sim/` and the same
 * `WorldObserver` the game's audio engine reads (`src/main.ts` builds one and hands
 * its queue to `audio.consume`), and counts:
 *
 *  1. how long `spawnProtect` actually holds on a ship and on a core;
 *  2. whether it DOES anything — a shot fired at a protected hull, and the same
 *     shot one tick after it lapses;
 *  3. how many `spawnPulse` tells the observer emits, and when;
 *  4. as a control, how many `mineHit` / `weaponHit` tells it emits — the two
 *     firing voices, which the same pass reveals to be unreachable.
 *
 * Not part of the game bundle and not in the tsconfig `include`.
 */

import { ShipClass } from '../../src/shared/types';
import {
  SPAWN_PROTECTION_S,
  TICK_DT,
  createWorld,
  fireShipProjectile,
  placeOrder,
  step,
  updateProjectiles,
  type PlayerSpec,
  type World,
} from '../../src/sim';
import { SpatialHash } from '../../src/sim/spatial-hash';
import { TELL, TELL_NAMES, TellQueue } from '../../src/art/tells';
import { WorldObserver } from '../../src/art/vfx/observer';

const PLAYERS: readonly PlayerSpec[] = [
  { id: 0, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Vanguard },
];

function fresh(): World {
  return createWorld({ seed: 0xa068, players: PLAYERS });
}

const out: string[] = [];
const say = (line = ''): void => {
  out.push(line);
  console.log(line);
};

// ---------------------------------------------------------------------------
// 1. Does the field exist, and for how long?
// ---------------------------------------------------------------------------

say('=== 1. spawnProtect at match start, and its countdown ===');
{
  const world = fresh();
  const ship = world.ships[0]!;
  const station = world.stations[0]!;
  say(`SPAWN_PROTECTION_S (src/sim/constants.ts, TUNABLE)   ${SPAWN_PROTECTION_S} s`);
  say(`ships[0].spawnProtect at t=0                          ${ship.spawnProtect}`);
  say(`stations[0].spawnProtect at t=0                       ${station.spawnProtect}`);

  let shipLapsedAt = -1;
  let coreLapsedAt = -1;
  for (let i = 0; i < Math.ceil(15 / TICK_DT); i++) {
    step(world, [], TICK_DT);
    if (shipLapsedAt < 0 && world.ships[0]!.spawnProtect <= 0) shipLapsedAt = world.time;
    if (coreLapsedAt < 0 && world.stations[0]!.spawnProtect <= 0) coreLapsedAt = world.time;
  }
  say(`ship protection lapses at                             ${shipLapsedAt.toFixed(3)} s`);
  say(`core protection lapses at                             ${coreLapsedAt.toFixed(3)} s`);
}
say();

// ---------------------------------------------------------------------------
// 2. Does it DO anything a player can be on the wrong end of?
// ---------------------------------------------------------------------------

say('=== 2. a shot at a protected hull, and the same shot once it lapses ===');
{
  // Point-blank, straight at an enemy hull: the one test that separates a live
  // rule from a field nobody reads.
  const shoot = (world: World): { hull: number; passed: boolean } => {
    const shooter = world.ships[0]!;
    const target = world.ships[1]!;
    target.pos.x = shooter.pos.x + 40;
    target.pos.y = shooter.pos.y;
    target.vel.x = 0;
    target.vel.y = 0;
    const before = target.hull;
    fireShipProjectile(world, shooter, { x: 1, y: 0 });
    const hash = SpatialHash.from(
      world.asteroids.map((a) => a.pos),
      64,
    );
    for (let i = 0; i < 40; i++) updateProjectiles(world, hash, TICK_DT);
    return { hull: before - target.hull, passed: target.hull === before };
  };

  const guarded = fresh();
  guarded.ships[0]!.spawnProtect = 0; // the shooter's own grace is irrelevant here
  const a = shoot(guarded);
  say(`target.spawnProtect = ${guarded.ships[1]!.spawnProtect.toFixed(1)}  → damage dealt ${a.hull}  (shot flew over: ${a.passed})`);

  const open = fresh();
  open.ships[0]!.spawnProtect = 0;
  open.ships[1]!.spawnProtect = 0;
  const b = shoot(open);
  say(`target.spawnProtect = ${open.ships[1]!.spawnProtect.toFixed(1)}  → damage dealt ${b.hull}  (shot flew over: ${b.passed})`);
  say(a.passed && !b.passed ? 'VERDICT: the rule is LIVE — protection is the only difference between the two.' : 'VERDICT: the rule did NOT change the outcome.');
}
say();

// ---------------------------------------------------------------------------
// 3. Does `spawnPulse` fire, how often, and for whom?
// ---------------------------------------------------------------------------

say('=== 3. spawnPulse tells over the first 15 seconds of a match ===');
{
  const world = fresh();
  const observer = new WorldObserver({ local: 0 });
  const queue = new TellQueue();
  const counts = new Map<number, number>();
  const perShip = new Map<number, number>();
  let firstAt = -1;
  let lastAt = -1;

  for (let i = 0; i < Math.ceil(15 / TICK_DT); i++) {
    step(world, [], TICK_DT);
    queue.clear();
    observer.observe(world, TICK_DT, queue);
    for (let t = 0; t < queue.length; t++) {
      const kind = queue.kindAt(t);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (kind === TELL.spawnPulse) {
        const who = queue.player[t]!;
        perShip.set(who, (perShip.get(who) ?? 0) + 1);
        if (firstAt < 0) firstAt = world.time;
        lastAt = world.time;
      }
    }
  }

  const pulses = counts.get(TELL.spawnPulse) ?? 0;
  say(`spawnPulse tells emitted                              ${pulses}`);
  say(`  first at ${firstAt.toFixed(2)} s, last at ${lastAt.toFixed(2)} s`);
  say(`  per ship: ${[...perShip].map(([id, n]) => `p${id}=${n}`).join(', ')}`);
  say(`  SPAWN_PULSE_S (observer, one clock for every glow)  0.5 s`);
  say('');
  say('Every tell kind the same fifteen seconds produced, for scale:');
  for (const [kind, n] of [...counts].sort((x, y) => y[1] - x[1])) {
    say(`  ${(TELL_NAMES[kind] ?? String(kind)).padEnd(16)} ${String(n).padStart(5)}`);
  }
  say('');
  say('The two firing voices, as a control (rockChip / hullHit are the sounds these route to):');
  say(`  mineHit          ${counts.get(TELL.mineHit) ?? 0}`);
  say(`  weaponHit        ${counts.get(TELL.weaponHit) ?? 0}`);
}
say();

// ---------------------------------------------------------------------------
// 4. …and why those two are zero.
// ---------------------------------------------------------------------------

say('=== 4. why mineHit / weaponHit never fire ===');
{
  const world = fresh();
  // A turret only publishes a muzzle on a tick it fires, so one has to be BUILT
  // and given something to shoot at. Buy it through the action stream the way a
  // player does, fast-forward the build, then park the enemy in range with its
  // grace spent.
  const owner = world.ships[0]!;
  owner.pos.x = world.stations[0]!.pos.x;
  owner.pos.y = world.stations[0]!.pos.y;
  owner.banked = 999;
  const result = placeOrder(world, owner, 'turret');
  for (const job of world.stations[0]!.builds) job.remaining = 0;
  step(world, [], TICK_DT);
  say(`buy a turret through the action stream                ${result} (${world.stations[0]!.turrets.length} mounted)`);

  const prey = world.ships[1]!;
  let muzzles = 0;
  let withHitPoint = 0;
  for (let i = 0; i < Math.ceil(60 / TICK_DT); i++) {
    // Hold the enemy inside turret range with its opening grace spent, so the
    // gun has a legal target every tick (`updateTurrets` skips protected hulls).
    prey.spawnProtect = 0;
    prey.pos.x = world.stations[0]!.pos.x + 60;
    prey.pos.y = world.stations[0]!.pos.y;
    step(world, [], TICK_DT);
    for (const station of world.stations) {
      for (const turret of station.turrets) {
        if (!turret.muzzle) continue;
        muzzles++;
        if (turret.muzzle.hitPoint !== null) withHitPoint++;
      }
    }
  }
  say(`turret muzzles published over 60 s of live fire       ${muzzles}`);
  say(`  …of which carry a hitPoint                          ${withHitPoint}`);
  say('`src/sim/buildings.ts` emits `hitPoint: null` unconditionally since the v0.3');
  say('laser funeral, and `observer.observeMuzzles` skips a muzzle without one — so');
  say('`shotImpact` is the ONLY impact voice a player can hear.');
}

say();
say('(Regenerate: npx vite-node evidence/a0-68-structural-slots/spawn-protection.ts)');
