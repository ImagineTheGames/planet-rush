/**
 * tests/sim/turret-natural-siege.test.ts — turrets slide to engage invaders in a
 * REAL match (field report v0.2.1). OWNER: Gameplay Engineer.
 *
 * The field report the developer filed after ten minutes of real play: turrets do
 * not slide to engage besiegers. Round-8 evidence "verified" the opposite — but
 * with a STAGED scenario (a debug-*placed* attacker) and an attestation scoped to
 * the sim instrument. Staged truth and play truth disagreed, and play wins.
 *
 * This test refuses the staged shortcut. It spins a **full natural bot-vs-bot
 * match** through the headless harness — the real eight-planet ring (GDD §2.1),
 * bots deciding for themselves, *no debug placement anywhere* — and watches what
 * the turrets actually do while the ring fights.
 *
 * WHY the staged evidence passed while play failed — the whole lesson in one word:
 * **spawn protection.** A debug-placed attacker is spawned with `spawnProtect = 0`,
 * so the turret's threat scan (which correctly refuses to waste fire on an
 * invulnerable hull) sees it and engages, exactly as round-8 measured. A *real*
 * attacker the turrets just killed **respawns with ten seconds of protection**
 * (`src/sim/step.ts`), flies back to the neighbour whose home it was besieging —
 * a short hop on the ring — and reaches the core with most of that protection
 * still up. The old sim let it bombard the core with total impunity *and* kept it
 * invisible to the turret, so the turret sat parked at its mount angle for
 * seconds at a time: "turrets do not slide to engage." The instrumented repro of
 * this exact match showed planet 0's turret pinned at its home angle (orbit ≈ π/2)
 * with `targetId = null` for ~8 s while a `spawnProtect ≈ 8 → 0` attacker sat
 * inside threat range shooting the core.
 *
 * The fix (`src/sim/projectiles.ts`): a ship **forfeits its own spawn protection
 * the instant one of its weapon shots damages an enemy** ship, turret, or core —
 * grace is "so no rush can end a match before anyone has flown" (GDD §2.1), not a
 * licence for an immune siege. Chipping a rock is not an attack, so a miner keeps
 * its opening grace; drawing first blood on an enemy spends it. A respawned
 * besieger now voids its protection on its first landed shot, becomes a real
 * target, and the turret slides onto it — which is what this test asserts.
 *
 * The assertions, all read off natural play:
 *   1. **Acquisition.** No defended planet is besieged by an enemy for longer than
 *      `MAX_UNANSWERED_S` without a turret acquiring *that* enemy. On the old sim
 *      this window ran to seconds (a full protected bombardment); the fix caps it
 *      at one shot's flight time.
 *   2. **Convergence.** At least one turret, having acquired a besieging enemy,
 *      *slides* its orbit angle from off-bearing onto the threat's facing normal —
 *      it engages by moving, not merely by flagging a target.
 * Plus preconditions, so the test can never pass vacuously: a turret really was
 * built, and a besieging enemy really did put shots on a defended core.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { TICK_DT, planetTargetRadius, type World } from '../../src/sim';
import { runMatch, roundRobinLineup } from '../../harness/match';
import type { Ship, Planet, Turret } from '../../src/sim';

// --- geometry helpers ------------------------------------------------------

/** Shortest signed angle from `a` to `b`, in (-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Bearing from a planet's centre to a ship — the rim angle whose outward normal
 *  faces that ship, i.e. the orbit angle a turret converging on it aims for. */
function bearing(planet: Planet, ship: Ship): number {
  return Math.atan2(ship.pos.y - planet.pos.y, ship.pos.x - planet.pos.x);
}

/**
 * Is `ship` **firing on** `planet` this tick — does it own a live ship-weapon
 * shot whose forward path still reaches the planet's shield/core surface? This is
 * the play-truth signal of a besieger: shots actually inbound on the core, read
 * from the projectile pool, never from a placed fixture. Mirrors the sim's own
 * `isAttackingPlanet` closest-approach test (`src/sim/buildings.ts`).
 */
function firesOnCore(world: World, planet: Planet, ship: Ship): boolean {
  const targetR = planetTargetRadius(planet);
  for (const p of world.projectiles) {
    if (!p.active || p.kind !== 'ship' || p.owner !== ship.id) continue;
    const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y);
    if (speed < 1e-9) continue;
    const dx = p.vel.x / speed;
    const dy = p.vel.y / speed;
    const reach = speed * p.life;
    let t = (planet.pos.x - p.pos.x) * dx + (planet.pos.y - p.pos.y) * dy;
    if (t < 0) t = 0;
    else if (t > reach) t = reach;
    const ex = p.pos.x + dx * t - planet.pos.x;
    const ey = p.pos.y + dy * t - planet.pos.y;
    if (ex * ex + ey * ey <= targetR * targetR) return true;
  }
  return false;
}

/** Live turrets on a planet (dead-but-not-yet-swept entries excluded). */
function liveTurrets(planet: Planet): Turret[] {
  return planet.turrets.filter((t) => t.hp > 0);
}

// --- thresholds ------------------------------------------------------------

/**
 * How long a defended planet may be besieged by one enemy before a turret must
 * have acquired *that* enemy. A respawned besieger voids its protection on its
 * first landed shot, so the only unanswered window is that first shot's flight
 * time (~0.4 s here). One second gives that comfortable headroom while staying
 * far under the multi-second parked windows the old sim produced. Named in
 * seconds; compared in ticks.
 */
const MAX_UNANSWERED_S = 1.0;

/**
 * How long a besieger's shots may lapse before we stop counting it as an active
 * besieger of a planet. A besieging ship fires several times a second, so 1.5 s
 * of grace bridges the gaps between individual shots (and a shot briefly eaten by
 * a shield or a rock) without ever bridging across it leaving and coming back.
 */
const BESIEGE_GRACE_S = 1.5;

/** A turret counts as having *slid onto* a threat once its orbit angle is within
 *  this tolerance of the bearing to its target — it reached the facing normal. */
const ON_BEARING_TOL = 0.12;

/** …having started meaningfully off it: the engagement must show a real slide,
 *  not a turret that happened to be born pointing the right way. */
const OFF_BEARING_MIN = 0.3;

describe('turrets slide to engage besiegers in a natural match (field report v0.2.1)', () => {
  it('acquires every besieger within a second and slides onto the threat — no debug placement', () => {
    // A natural siege: half the ring turtles (banks ore, builds turrets and
    // shields) and half rushes an enemy home. Bots only, decided fog-honestly by
    // the harness; nothing is placed. The real eight-planet ring is the point —
    // it is what puts a respawned attacker back on a neighbour's core while it is
    // still spawn-protected, the exact condition the staged round-8 test skipped.
    const lineup = roundRobinLineup(
      [
        { strategy: 'turtle', shipClass: ShipClass.Vanguard },
        { strategy: 'rusher', shipClass: ShipClass.Vanguard },
      ],
      0,
      8,
    );

    const maxUnansweredTicks = Math.round(MAX_UNANSWERED_S / TICK_DT);
    const besiegeGraceTicks = Math.round(BESIEGE_GRACE_S / TICK_DT);

    // Per (planet, besieger) episode bookkeeping, keyed planetOwner*100 + shipId.
    const lastFiredTick = new Map<number, number>();
    const unansweredTicks = new Map<number, number>();

    // Worst offence seen, kept for a readable failure message.
    let worstUnanswered = 0;
    let worstAt = { time: 0, planet: -1, ship: -1, orbit: 0, bearing: 0 };

    // Preconditions — the scenario must actually happen.
    let anyTurretBuilt = false;
    let anyBesiegeSeen = false;

    // Convergence: per turret id, the run of ticks it has continuously targeted
    // one besieging enemy, and the orbit-error envelope over that run.
    interface Slide {
      target: number;
      maxErr: number;
      lastErr: number;
    }
    const slides = new Map<number, Slide>();
    let sawConvergence = false;

    runMatch(
      { seed: 7, lineup },
      {
        maxSeconds: 300,
        onTick: (world, tick) => {
          for (const planet of world.planets) {
            if (!planet.alive) continue;
            const turrets = liveTurrets(planet);
            if (turrets.length === 0) continue;
            anyTurretBuilt = true;

            for (const ship of world.ships) {
              if (ship.id === planet.owner || !ship.alive) continue;

              const key = planet.owner * 100 + ship.id;
              if (firesOnCore(world, planet, ship)) lastFiredTick.set(key, tick);

              const besieging = tick - (lastFiredTick.get(key) ?? -1e9) <= besiegeGraceTicks;
              if (!besieging) {
                unansweredTicks.set(key, 0);
                continue;
              }
              anyBesiegeSeen = true;

              const acquired = turrets.some((t) => t.targetId === ship.id);
              if (acquired) {
                unansweredTicks.set(key, 0);
              } else {
                const n = (unansweredTicks.get(key) ?? 0) + 1;
                unansweredTicks.set(key, n);
                if (n > worstUnanswered) {
                  worstUnanswered = n;
                  const t0 = turrets[0]!;
                  worstAt = {
                    time: world.time,
                    planet: planet.owner,
                    ship: ship.id,
                    orbit: t0.orbitAngle ?? NaN,
                    bearing: bearing(planet, ship),
                  };
                }
              }
            }

            // Convergence tracking: watch each turret slide onto whatever
            // besieging enemy it has locked.
            for (const turret of turrets) {
              const tid = turret.targetId;
              const orbit = turret.orbitAngle;
              if (tid === null || tid === undefined || orbit === undefined) {
                slides.delete(turret.id);
                continue;
              }
              const target = world.ships.find((s) => s.id === tid);
              // Only score a slide against an enemy that is actually besieging
              // this planet — that is the "converging on the threat" the report
              // asks for, not a turret drifting toward a passing loiterer.
              const key = planet.owner * 100 + tid;
              const besieging =
                target !== undefined &&
                target.alive &&
                tick - (lastFiredTick.get(key) ?? -1e9) <= besiegeGraceTicks;
              if (!besieging) {
                slides.delete(turret.id);
                continue;
              }
              const err = Math.abs(angleDiff(orbit, bearing(planet, target!)));
              const prev = slides.get(turret.id);
              if (prev === undefined || prev.target !== tid) {
                slides.set(turret.id, { target: tid, maxErr: err, lastErr: err });
              } else {
                prev.maxErr = Math.max(prev.maxErr, err);
                prev.lastErr = err;
                // Started meaningfully off-bearing and has now slid onto it: a
                // real engaging slide, not a turret born already aimed.
                if (prev.maxErr >= OFF_BEARING_MIN && err <= ON_BEARING_TOL) sawConvergence = true;
              }
            }
          }
        },
      },
    );

    // Preconditions: a real siege of a real turret happened.
    expect(anyTurretBuilt).toBe(true);
    expect(anyBesiegeSeen).toBe(true);

    // 1. Acquisition — no besieger goes unanswered past the cap. On the pre-fix
    //    sim a spawn-protected respawner bombarded a parked turret for seconds;
    //    the worst window here must be a single shot's flight, not a siege.
    const worstSeconds = worstUnanswered * TICK_DT;
    expect(
      worstUnanswered,
      `planet ${worstAt.planet}'s turret left besieger ${worstAt.ship} unanswered for ` +
        `${worstSeconds.toFixed(2)}s at t≈${worstAt.time.toFixed(1)}s ` +
        `(orbit ${worstAt.orbit.toFixed(2)} vs bearing ${worstAt.bearing.toFixed(2)}) — ` +
        `a turret that will not slide to engage (field report v0.2.1)`,
    ).toBeLessThanOrEqual(maxUnansweredTicks);

    // 2. Convergence — a turret actually slid from off-bearing onto a besieger.
    expect(
      sawConvergence,
      'no turret was observed sliding from off-bearing onto a besieging enemy — ' +
        'turrets flag targets but never move to engage',
    ).toBe(true);
  });
});
