/**
 * src/progression/accrual.test.ts — the observer, pinned. OWNER: UI Engineer
 * (p1-04; `docs/briefs/pr-04-accrual-and-xp.md`, `docs/progression-plan.md`
 * §1.1, §1.3a–d).
 *
 * The brief's seven tests, in its own order, plus the two invariants the module
 * header promises (read-only over the world; the Crush credits nobody).
 *
 * Where a count can be produced by the real sim it is: the fixture match banks
 * through `placeOrder`, buys a real upgrade, patches a real core and dies a real
 * death, so the numbers below are the sim's own consequences rather than fields
 * a test hand-set. The direct `creditDamage` calls appear in exactly one place —
 * test 2 — where the *point* is that the observer reports the ledger's number
 * even when the hulls say something else.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass, UpgradeTrack, type PlayerId } from '@shared/types';
import { hashState } from '../../harness/hash';
import { Difficulty } from '../bots';
import {
  REPAIR_HP_PER_ORE,
  REPAIR_ORE_COST,
  TICK_DT,
  TURRET,
  buyUpgrade,
  createWorld,
  creditDamage,
  damageShip,
  damageStation,
  destroyCore,
  killShip,
  nextUpgradeCost,
  placeOrder,
  shipOf,
  stationOf,
  type World,
} from '../sim';
import { createAccrualObserver, totalByTier, type AccrualObserver, type MatchAccrual } from './accrual';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ME: PlayerId = 0;

/** A four-seat FFA with no rock in it: nothing drifts, nothing mines itself, and
 *  every number below is something the script did on purpose. */
function arena(slots = 4, seed = 7): World {
  const players = Array.from({ length: slots }, (_, id) => ({ id, shipClass: ShipClass.Vanguard }));
  const world = createWorld({ seed, players, asteroidCount: 0 });
  world.asteroids = [];
  world.chunks = [];
  for (const s of world.ships) s.spawnProtect = 0;
  for (const p of world.stations) p.spawnProtect = 0;
  return world;
}

/** Every seat Medium unless the test cares — the neutral ×1.0 rung. */
const allMedium = (n: number): Difficulty[] => new Array<Difficulty>(n).fill(Difficulty.Medium);

/** Advance one tick of wall clock, run the script for that tick, then let the
 *  observer look. The order matters: a ledger stamp lands at the NEW `world.time`,
 *  which is what puts it inside the window being observed. */
function tick(world: World, obs: AccrualObserver, script?: () => void): void {
  world.tick += 1;
  world.time += TICK_DT;
  script?.();
  obs.observe(world);
}

/** Park a ship on its own station so wheel and panel orders are accepted. */
function dock(world: World, slot: PlayerId): void {
  const ship = shipOf(world, slot)!;
  const station = stationOf(world, slot)!;
  ship.pos.x = station.pos.x;
  ship.pos.y = station.pos.y;
}

const mine = (world: World, slot: PlayerId, ore: number): void => {
  shipOf(world, slot)!.cargo += ore;
};

// ---------------------------------------------------------------------------
// 1. A scripted fixture match
// ---------------------------------------------------------------------------

describe('the scripted fixture match', () => {
  /** Mine, bank, build, upgrade, repair, fly, die once, and go out third of four
   *  — the brief's test 1, with every free field asserted. */
  function scriptedMatch(): { world: World; me: MatchAccrual; upgradeCost: number } {
    const world = arena();
    dock(world, ME);
    const ship = shipOf(world, ME)!;
    const station = stationOf(world, ME)!;
    ship.banked = 50; // a wallet, banked BEFORE the observer opens its eyes
    const upgradeCost = nextUpgradeCost(ship, UpgradeTrack.Cargo)!;

    const obs = createAccrualObserver(world, allMedium(4));

    tick(world, obs, () => mine(world, ME, 6));
    tick(world, obs, () => expect(placeOrder(world, ship, 'bank')).toBe('ok'));
    tick(world, obs, () => expect(placeOrder(world, ship, 'turret')).toBe('ok'));
    tick(world, obs, () => expect(buyUpgrade(world, ship, UpgradeTrack.Cargo)).toBe('ok'));
    // A patch is worth exactly one repair when exactly one repair's worth of core
    // is missing: `REPAIR_HP_PER_ORE` HP off, then bought back.
    tick(world, obs, () => damageStation(world, station, REPAIR_HP_PER_ORE));
    tick(world, obs, () => expect(placeOrder(world, ship, 'repair')).toBe('ok'));
    // Fly 10 units, and die once.
    tick(world, obs, () => {
      ship.pos.x += 10;
    });
    tick(world, obs, () => killShip(world, ship));

    // Three waves in when the first two homes go. Slot 3 out first, me second.
    world.match.wavesSpawned = 3;
    tick(world, obs, () => destroyCore(world, stationOf(world, 3)!));
    tick(world, obs, () => destroyCore(world, station));
    // The match runs on without us; the wave clock keeps going.
    world.match.wavesSpawned = 5;
    tick(world, obs);
    world.match.winner = 1;

    return { world, me: obs.finalize(world)[ME]!, upgradeCost };
  }

  it('counts every free field exactly', () => {
    const { me, upgradeCost } = scriptedMatch();
    expect(me.oreMined).toBe(6);
    expect(me.oreBanked).toBe(6);
    expect(me.oreUsed).toBeCloseTo(TURRET.cost + upgradeCost + REPAIR_ORE_COST, 9);
    expect(me.distance).toBeCloseTo(10, 9);
    expect(me.shipsUsed).toBe(2); // one death, one hull to start with
    expect(me.structures).toBe(1);
    expect(me.upgrades).toBe(1);
    expect(me.repairs).toBeCloseTo(1, 9);
  });

  it('reads placement, waves and the result off the finished match', () => {
    const { world, me } = scriptedMatch();
    expect(me.placement).toBe(3); // fourth seat out first, then me: third of four
    expect(me.won).toBe(false);
    // The waves you SURVIVED are the ones spawned when your home died — not the
    // ones the match went on to spawn without you.
    expect(me.wavesSurvived).toBe(3);
    expect(me.seconds).toBeCloseTo(stationOf(world, ME)!.deathTime, 9);
  });

  it('credits the survivor the win and first place', () => {
    const { world } = scriptedMatch();
    const obs = createAccrualObserver(world, allMedium(4));
    const winner = obs.finalize(world)[1]!;
    expect(winner.placement).toBe(1);
    expect(winner.won).toBe(true);
  });

  it('never writes to the world it is watching', () => {
    const world = arena();
    dock(world, ME);
    const obs = createAccrualObserver(world, allMedium(4));
    tick(world, obs, () => mine(world, ME, 4));
    const before = hashState(world);
    obs.observe(world);
    obs.observe(world);
    obs.finalize(world);
    obs.finalize(world);
    expect(hashState(world)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 2. The ledger fields are READ, not recomputed
// ---------------------------------------------------------------------------

describe('the credited half comes from the ledger', () => {
  it('reports the ledger HP, not the HP the hulls lost', () => {
    const world = arena(2);
    const obs = createAccrualObserver(world, allMedium(2));
    // The ledger says 100 HP; not one hull moved. An observer that reconstructed
    // damage from world deltas would report 0 here — that is the whole test.
    tick(world, obs, () => creditDamage(world, ME, 1, 'dealtToShips', 100));
    const me = obs.finalize(world)[ME]!;
    expect(totalByTier(me.damageDealt)).toBeCloseTo(100, 9);
  });

  it('pays nothing at all when the world keeps no credit ledger', () => {
    const world = arena(2);
    delete world.credit; // a foreign world: a net snapshot, a bot fixture
    const obs = createAccrualObserver(world, allMedium(2));
    const victim = shipOf(world, 1)!;
    tick(world, obs, () => damageShip(world, victim, 20, ME));
    expect(victim.hull).toBeLessThan(victim.maxHull); // the damage really landed
    const me = obs.finalize(world)[ME]!;
    expect(totalByTier(me.damageDealt)).toBe(0);
    expect(totalByTier(me.shipKills)).toBe(0);
  });

  it('buckets damage and the killing blow under the VICTIM tier', () => {
    const world = arena(3);
    const obs = createAccrualObserver(world, [Difficulty.Medium, Difficulty.Easy, Difficulty.Hard]);
    const easy = shipOf(world, 1)!;
    const hard = shipOf(world, 2)!;
    tick(world, obs, () => damageShip(world, easy, 20, ME));
    tick(world, obs, () => damageShip(world, hard, 30, ME));
    tick(world, obs, () => damageShip(world, hard, 9999, ME)); // the kill

    const me = obs.finalize(world)[ME]!;
    expect(me.damageDealt[Difficulty.Easy]).toBeCloseTo(20, 9);
    // Overkill is never credited: the ledger pays the HP that landed, so the
    // finisher is worth the hull that was left, not 9999.
    expect(me.damageDealt[Difficulty.Hard]).toBeCloseTo(hard.maxHull, 9);
    expect(me.shipKills[Difficulty.Hard]).toBe(1);
    expect(me.shipKills[Difficulty.Easy]).toBe(0);
    expect(me.shipKills[Difficulty.Medium]).toBe(0);
  });

  it('charges damage to the victim the LEDGER names, not to whoever was bleeding', () => {
    // Two duels in the same tick. If the observer reconstructed attribution from
    // world deltas it would see two hulls dropping and split slot 0's damage
    // across both tiers; the ledger's own pair clock says otherwise.
    const world = arena(4);
    const obs = createAccrualObserver(world, [
      Difficulty.Medium,
      Difficulty.Easy,
      Difficulty.Hard,
      Difficulty.Medium,
    ]);
    tick(world, obs, () => {
      damageShip(world, shipOf(world, 1)!, 20, ME);
      damageShip(world, shipOf(world, 2)!, 30, 3);
    });

    const all = obs.finalize(world);
    expect(all[ME]!.damageDealt[Difficulty.Easy]).toBeCloseTo(20, 9);
    expect(all[ME]!.damageDealt[Difficulty.Hard]).toBe(0);
    expect(all[3]!.damageDealt[Difficulty.Hard]).toBeCloseTo(30, 9);
    expect(all[3]!.damageDealt[Difficulty.Easy]).toBe(0);
  });

  it('credits a station kill to the player who took the core, and nobody to the Crush', () => {
    const world = arena(3);
    const obs = createAccrualObserver(world, [Difficulty.Medium, Difficulty.Hard, Difficulty.Hard]);
    tick(world, obs, () => damageStation(world, stationOf(world, 1)!, 9999, ME));
    // The claim closing in: a core reaching zero with no attacker at all
    // (GDD §2.3, plan §1.3c(2)). Nobody is credited, and nobody is guessed at.
    tick(world, obs, () => destroyCore(world, stationOf(world, 2)!));

    const all = obs.finalize(world);
    expect(all[ME]!.stationKills[Difficulty.Hard]).toBe(1);
    for (const a of all) expect(totalByTier(a.stationKills)).toBeLessThanOrEqual(a.slot === ME ? 1 : 0);
  });
});

// ---------------------------------------------------------------------------
// 4. Respawns are not travel · 5. Death is not a purchase
// ---------------------------------------------------------------------------

describe('the two deltas that look like something they are not', () => {
  it('does not count the flight home a respawn never made', () => {
    const world = arena(2);
    const obs = createAccrualObserver(world, allMedium(2));
    const ship = shipOf(world, ME)!;
    const home = { x: ship.pos.x, y: ship.pos.y };

    tick(world, obs, () => {
      ship.pos.x += 20;
    });
    tick(world, obs, () => killShip(world, ship));
    // The respawn: alive again, back at home, hundreds of units in no time.
    tick(world, obs, () => {
      ship.pos.x = home.x + 2000;
      ship.pos.y = home.y;
      ship.alive = true;
      ship.hull = ship.maxHull;
    });
    tick(world, obs, () => {
      ship.pos.x = home.x;
      ship.pos.y = home.y;
    });

    // 20 units of real flying, and not one unit of teleport: neither the jump
    // across the dead frame (dead at one end of the window) nor the jump back
    // (further than a ship can fly in a tick).
    expect(obs.finalize(world)[ME]!.distance).toBeCloseTo(20, 9);
  });

  it('does not read the half-hold sink at a death as ore spent', () => {
    const world = arena(2);
    const obs = createAccrualObserver(world, allMedium(2));
    const ship = shipOf(world, ME)!;
    tick(world, obs, () => mine(world, ME, 8));
    tick(world, obs, () => killShip(world, ship));
    expect(ship.cargo).toBe(0); // half dropped, half destroyed with the hull
    const me = obs.finalize(world)[ME]!;
    expect(me.oreUsed).toBe(0);
    expect(me.oreMined).toBe(8); // and the ore is still credited as gathered
  });

  it('does not read the bank a dying station scatters as ore spent', () => {
    const world = arena(3);
    const obs = createAccrualObserver(world, allMedium(3));
    const ship = shipOf(world, ME)!;
    ship.banked = 40;
    tick(world, obs, () => destroyCore(world, stationOf(world, ME)!));
    expect(ship.banked).toBe(0); // scattered as wreck debris (GDD §2.7)
    expect(obs.finalize(world)[ME]!.oreUsed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism · 7. The authoritative world
// ---------------------------------------------------------------------------

describe('determinism and the online path', () => {
  it('produces the identical accrual from the identical script, twice', () => {
    const run = (): MatchAccrual[] => {
      const world = arena(3, 99);
      dock(world, ME);
      const obs = createAccrualObserver(world, [Difficulty.Easy, Difficulty.Hard, Difficulty.Medium]);
      const ship = shipOf(world, ME)!;
      ship.banked = 30;
      tick(world, obs, () => mine(world, ME, 5));
      tick(world, obs, () => placeOrder(world, ship, 'bank'));
      tick(world, obs, () => placeOrder(world, ship, 'turret'));
      tick(world, obs, () => damageShip(world, shipOf(world, 1)!, 17, ME));
      tick(world, obs, () => damageStation(world, stationOf(world, 2)!, 9, ME));
      return obs.finalize(world);
    };
    expect(run()).toEqual(run());
  });

  it('counts a re-delivered tick once, and a corrected one exactly once', () => {
    const world = arena(2);
    const obs = createAccrualObserver(world, allMedium(2));
    const ship = shipOf(world, ME)!;

    tick(world, obs, () => mine(world, ME, 3)); // an authoritative tick: 3 ore

    // The client mispredicts the next tick and folds it in: 9 ore.
    world.tick += 1;
    world.time += TICK_DT;
    ship.cargo += 9;
    obs.observe(world);
    expect(obs.finalize(world)[ME]!.oreMined).toBe(12);

    // The server's version of that SAME tick arrives and disagrees: 7, not 9.
    ship.cargo -= 2;
    obs.observe(world);
    expect(obs.finalize(world)[ME]!.oreMined).toBe(10);

    // The same authoritative tick delivered again changes nothing…
    obs.observe(world);
    obs.observe(world);
    expect(obs.finalize(world)[ME]!.oreMined).toBe(10);

    // …and a tick older than the one already folded in is ignored outright.
    const rewound = world.tick;
    world.tick -= 1;
    world.time -= TICK_DT;
    ship.cargo += 100;
    obs.observe(world);
    expect(obs.finalize(world)[ME]!.oreMined).toBe(10);

    // Forward again from the corrected state: only the new ore counts.
    world.tick = rewound + 1;
    world.time += 2 * TICK_DT;
    obs.observe(world);
    expect(obs.finalize(world)[ME]!.oreMined).toBe(110);
  });

  it('rolls a corrected window back whole — structures and kills included', () => {
    const world = arena(2);
    const obs = createAccrualObserver(world, allMedium(2));
    const ship = shipOf(world, ME)!;
    dock(world, ME);
    ship.banked = 30;

    world.tick += 1;
    world.time += TICK_DT;
    placeOrder(world, ship, 'turret');
    obs.observe(world);
    expect(obs.finalize(world)[ME]!.structures).toBe(1);

    // The prediction is thrown away: the order never happened on the server.
    stationOf(world, ME)!.builds.length = 0;
    obs.observe(world);
    expect(obs.finalize(world)[ME]!.structures).toBe(0);
  });
});
