/**
 * src/sim/match.ts — how a match ends. OWNER: Gameplay Engineer.
 *
 * The three rules that turn a firefight into a match with a result (GDD §1,
 * §2.3, §2.7):
 *
 *  - **Elimination.** A core at zero ends its owner's match. The planet becomes
 *    a **wreck** that stays on the map for the rest of the match, its defenses
 *    die with it, its owner's ship is destroyed and never respawns — and its
 *    banked fortune bursts into **debris anyone can scavenge**. Small holds mean
 *    nobody hauls a dead player's fortune away in one trip, so a fresh wreck is
 *    a contested place, which is the point.
 *
 *  - **Collapse.** When the last wave is exhausted (or the grace window after it
 *    runs out), the field closes: no shield regeneration, no repair, no new ore.
 *    The match cannot stalemate because the economy that funds standing still
 *    has stopped (GDD §2.3, §2.6 "the economy is the siege engine of last
 *    resort"). The three rules are enforced where they live — shield regen and
 *    the repair channel in `./buildings`, wave spawning in `./waves` — and this
 *    module owns the transition and the one flag they all read.
 *
 *  - **Win/loss, last to die.** One planet left standing wins. If the final
 *    cores die in the *same tick*, the last core to reach zero in the
 *    simulation's resolution order wins — `match.eliminated` is that order,
 *    recorded as it happens, so the tiebreak is a lookup rather than a guess.
 *
 * Determinism (GDD §4.8): fixed iteration order, no RNG (debris scatters on an
 * index-derived ring, exactly like a ship's death drop), every rate `* dt`.
 */

import type { PlayerId } from '@shared/types';
import {
  CHUNK,
  COLLAPSE_CORE_DECAY,
  COLLAPSE_GRACE_S,
  WAVE_COUNT,
  WRECK,
  clampToMargin,
  waveTime,
} from './constants';
import { killShip } from './damage';
import type { Planet, World } from './state';
import { allWavesSpawned, fieldExhausted } from './waves';

// ---------------------------------------------------------------------------
// Reading the phase
// ---------------------------------------------------------------------------

/**
 * True once the collapse phase has begun — no shield regeneration, no repair,
 * no new ore (GDD §2.3). Reads `collapseTime`, not `phase`, so the collapse
 * rules keep applying after a winner is declared.
 */
export function isCollapsed(world: World): boolean {
  return world.match.collapseTime >= 0;
}

/** True once the match has a result. */
export function isOver(world: World): boolean {
  return world.match.phase === 'ended';
}

/** True for a planet that has become a wreck: dead, but still on the map for
 *  the rest of the match, still solid, still worth flying to (GDD §2.7). */
export function isWreck(planet: Planet): boolean {
  return !planet.alive;
}

/** Sim time at which collapse begins no matter what is left in the field. */
export function collapseDeadline(): number {
  return waveTime(WAVE_COUNT) + COLLAPSE_GRACE_S;
}

// ---------------------------------------------------------------------------
// Elimination and the wreck (GDD §2.7)
// ---------------------------------------------------------------------------

/**
 * The core is gone. The planet stops being a planet and becomes a wreck that
 * stays on the map for the rest of the match (GDD §2.7): its defenses die with
 * it, unfinished construction is lost, shots already in the air from its
 * turrets stop being a threat — and its owner is eliminated.
 *
 * Called the instant a core reaches zero, from whichever source took it there
 * (`damagePlanet`, or collapse decay). Idempotent, because two shots can land on
 * the same core in the same tick.
 *
 * Turrets are zeroed rather than spliced — `sweepDeadTurrets` removes them at
 * end of step, so indices stay stable for every shot already resolved this tick.
 */
export function destroyCore(world: World, planet: Planet): void {
  planet.coreHp = 0;
  planet.alive = false;
  planet.repairing = false;
  for (const t of planet.turrets) t.hp = 0;
  for (const s of planet.shields) s.hp = 0;
  planet.builds.length = 0;
  for (const p of world.projectiles) {
    if (p.active && p.owner === planet.owner) p.active = false;
  }
  eliminate(world, planet);
}

/**
 * Record the death in the elimination order and pay out the wreck. The push onto
 * `match.eliminated` *is* the last-to-die order, so it happens here, in
 * resolution order, rather than being reconstructed later from timestamps.
 */
function eliminate(world: World, planet: Planet): void {
  if (world.match.eliminated.includes(planet.owner)) return;
  world.match.eliminated.push(planet.owner);
  planet.deathTime = world.time;

  // The owner is out (GDD §2.7): their ship dies where it stands — dropping
  // half its hold like any death — and it never respawns. The Rematch button is
  // the UI's answer to this flag.
  const ship = shipOwnedBy(world, planet.owner);
  let banked = 0;
  if (ship) {
    if (ship.alive) killShip(world, ship);
    ship.eliminated = true;
    ship.respawnTimer = 0;
    banked = ship.banked;
    ship.banked = 0;
  }

  scatterWreckDebris(world, planet, banked + WRECK.baseDebrisOre);
}

/** The ship in a given slot, or null (slots and ships are 1:1 in a match).
 *  A local copy of `buildings.shipOf` on purpose: `./buildings` imports this
 *  module for `destroyCore`, and four lines beat an import cycle. */
function shipOwnedBy(world: World, owner: PlayerId) {
  for (const s of world.ships) {
    if (s.id === owner) return s;
  }
  return null;
}

/**
 * Burst `ore` into chunks on a ring around the fresh wreck — the dead player's
 * fortune, loose on the map for anyone (GDD §2.7). Deterministic: the ring
 * angle comes from the chunk index, never the RNG, so two runs scatter debris
 * identically. Capped at `WRECK.maxDebrisChunks`; the excess dies with the
 * planet rather than carpeting the arena with collectables.
 */
function scatterWreckDebris(world: World, planet: Planet, ore: number): void {
  if (ore <= 1e-9) return;
  const whole = Math.min(Math.floor(ore / CHUNK.ore), WRECK.maxDebrisChunks);
  const remainder = whole < WRECK.maxDebrisChunks ? ore - whole * CHUNK.ore : 0;
  const pieces = whole + (remainder > 1e-9 ? 1 : 0);
  if (pieces <= 0) return;

  const ring = planet.radius + WRECK.debrisRingOffset;
  for (let i = 0; i < pieces; i++) {
    const theta = (2 * Math.PI * i) / pieces;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    // A wreck near the edge would otherwise ring debris into the wall margin —
    // keep every chunk clear of the bounds (field report P1).
    world.chunks.push({
      id: world.nextEntityId++,
      pos: {
        x: clampToMargin(planet.pos.x + dx * ring, CHUNK.radius, world.bounds.width),
        y: clampToMargin(planet.pos.y + dy * ring, CHUNK.radius, world.bounds.height),
      },
      vel: { x: dx * CHUNK.ejectSpeed, y: dy * CHUNK.ejectSpeed },
      amount: i < whole ? CHUNK.ore : remainder,
      radius: CHUNK.radius,
    });
  }
}

// ---------------------------------------------------------------------------
// The per-tick pass (GDD §1, §2.3)
// ---------------------------------------------------------------------------

/**
 * Advance the match itself one tick: enter collapse when the field is spent,
 * let entropy chew on what is left, and resolve a winner when only one home is
 * standing. Runs at the *end* of the step, after every source of damage has
 * been applied, so a core that died this tick is counted this tick.
 */
export function updateMatch(world: World, dt: number): void {
  enterCollapseIfDue(world);
  applyCollapseDecay(world, dt);
  resolveWinner(world);
}

/**
 * Collapse begins when the last wave has been delivered *and* the field is
 * exhausted — or, if nobody bothered to mine it out, at `collapseDeadline()`.
 * Both conditions require the final wave, so the phase can never open early on
 * a field that is merely between waves.
 */
function enterCollapseIfDue(world: World): void {
  if (isCollapsed(world) || !allWavesSpawned(world)) return;
  if (!fieldExhausted(world) && world.time < collapseDeadline()) return;

  world.match.collapseTime = world.time;
  if (world.match.phase === 'live') world.match.phase = 'collapse';
  // Clear any lingering repair tell as the phase turns: repair shuts off
  // (GDD §2.3). `placeOrder` refuses every repair purchase from here on.
  for (const planet of world.planets) planet.repairing = false;
}

/** "Entropy finishes whoever the players don't" (GDD §1) — every surviving core
 *  decays at `COLLAPSE_CORE_DECAY` HP/s once collapse opens (ratified 1 at M5;
 *  see the constant). Spawn-protected and dead cores are skipped; a core that
 *  hits zero here is destroyed like any other kill. */
function applyCollapseDecay(world: World, dt: number): void {
  if (COLLAPSE_CORE_DECAY <= 0 || !isCollapsed(world)) return;
  for (const planet of world.planets) {
    if (!planet.alive || planet.spawnProtect > 0) continue;
    planet.coreHp -= COLLAPSE_CORE_DECAY * dt;
    if (planet.coreHp <= 0) destroyCore(world, planet);
  }
}

/**
 * Win condition: own the last surviving planet core (GDD §1).
 *
 * The tie rule is the interesting half. If the final cores die in the same
 * instant — two attackers finishing two homes on one tick, or the collapse
 * taking the last two together — there is no survivor to crown, so the match
 * goes to **whoever died last** in the simulation's resolution order. That
 * order is `match.eliminated`, appended to as each core reaches zero.
 *
 * A world with fewer than two planets is not a match (the render/test harnesses
 * run single-slot worlds); it never ends and never declares a winner.
 */
function resolveWinner(world: World): void {
  const m = world.match;
  if (m.phase === 'ended' || world.planets.length < 2) return;

  let alive = 0;
  let survivor: PlayerId | null = null;
  for (const planet of world.planets) {
    if (!planet.alive) continue;
    alive++;
    survivor = planet.owner;
  }
  if (alive > 1) return;

  m.winner = alive === 1 ? survivor : lastToDie(m.eliminated);
  m.phase = 'ended';
  m.endTime = world.time;
}

/** Whoever died last — the tiebreak, and null if nobody ever did. */
function lastToDie(eliminated: readonly PlayerId[]): PlayerId | null {
  return eliminated.length > 0 ? eliminated[eliminated.length - 1]! : null;
}
