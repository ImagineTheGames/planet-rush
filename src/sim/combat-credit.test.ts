/**
 * src/sim/combat-credit.test.ts — the attribution hook, pinned. OWNER: Gameplay
 * Engineer (p1-02; `docs/briefs/pr-02-attribution-hook.md`,
 * `docs/progression-plan.md` §1.5).
 *
 * Seven properties, in the brief's own order. Six are about *honesty* — the
 * ledger records what actually happened and credits nobody when there is nobody
 * — and the seventh is the one the whole change lives or dies on: the
 * determinism replay hash is **byte-identical** with the credit ledger present
 * and absent (GDD §4.8).
 *
 * Where a property can be proved through real weapon projectiles it is: a kill
 * here is a hull taken to zero by shots that were fired, flew, and struck. The
 * direct `damageShip`/`damageStation` calls appear only where the *point* is that
 * the credit gate is independent of the damage rule (the allegiance cases), or
 * where staging a precise HP split through live fire would prove less than it
 * costs (the shared kill).
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Action } from '@shared/types';
import { hashState } from '../../harness/hash';
import { buildWorld, recordMatch, replay, roundRobinLineup } from '../../harness/match';
import type { MatchRecording, MatchSetup } from '../../harness/match';
import {
  ASSIST_WINDOW_S,
  CORE_HP,
  TICK_DT,
  assistsOn,
  createWorld,
  damageShip,
  damageStation,
  isCollapsed,
  killShip,
  placeOrder,
  shipOf,
  stationOf,
  step,
  type PlayerInput,
  type Ship,
  type World,
} from './index';

// ---------------------------------------------------------------------------
// Fixture helpers — geometry and orders only; no HP or credit is ever hand-set
// ---------------------------------------------------------------------------

const unit = (dx: number, dy: number) => {
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
};
const aimAt = (from: Ship, tx: number, ty: number): Action => ({
  type: 'aim',
  dir: unit(tx - from.pos.x, ty - from.pos.y),
});
const FIRE: Action = { type: 'fire', active: true, auto: false };

const FFA = [
  { id: 0, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Vanguard },
  { id: 2, shipClass: ShipClass.Vanguard },
];

/** A world with an empty field: no rock to eat a shot bound for a hull, so the
 *  HP arithmetic below is about combat and nothing else. */
function emptyArena(players = FFA, seed = 11): World {
  const world = createWorld({ seed, players, asteroidCount: 0 });
  world.asteroids = [];
  world.chunks = [];
  for (const s of world.ships) s.spawnProtect = 0;
  for (const p of world.stations) p.spawnProtect = 0;
  return world;
}

/** Stage a duel in open space at the arena centre, `gap` units apart on the x
 *  axis. Away from the station ring, so a shot that flies past the victim dies of
 *  old age instead of landing on somebody's home and muddying the rows. */
function stageDuel(world: World, killer: Ship, victim: Ship, gap: number): void {
  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  victim.pos = { x: cx, y: cy };
  victim.vel = { x: 0, y: 0 };
  killer.pos = { x: cx - gap, y: cy };
  killer.vel = { x: 0, y: 0 };
}

/** Park `killer` a weapon's length off `victim` and pour real fire into it until
 *  the hull is gone. Returns the tick count, or -1 if it never died. */
function shootToDeath(world: World, killer: Ship, victim: Ship, maxTicks = 6000): number {
  stageDuel(world, killer, victim, 70);
  for (let t = 0; t < maxTicks; t++) {
    // Hold station beside the victim — geometry, not ore and not HP.
    killer.pos = { x: victim.pos.x - 70, y: victim.pos.y };
    killer.vel = { x: 0, y: 0 };
    victim.vel = { x: 0, y: 0 };
    const inputs: PlayerInput[] = [
      { id: killer.id, actions: [aimAt(killer, victim.pos.x, victim.pos.y), FIRE] },
    ];
    step(world, inputs);
    if (!victim.alive) return t;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// 1. A kills B
// ---------------------------------------------------------------------------

describe('a kill through real projectiles credits the shooter', () => {
  it('credits every HP of the hull it melted, and exactly one kill', () => {
    const world = emptyArena();
    const killer = shipOf(world, 0)!;
    const victim = shipOf(world, 1)!;
    const startingHull = victim.hull;
    expect(startingHull).toBeGreaterThan(0);

    expect(shootToDeath(world, killer, victim)).toBeGreaterThan(0);

    const c = world.credit!;
    // The whole hull, and not one point more: overkill on the finisher is not
    // damage dealt.
    expect(c.dealtToShips[0]).toBeCloseTo(startingHull, 6);
    expect(c.shipKills[0]).toBe(1);
    // The victim did nothing and is credited with nothing.
    expect(c.shipKills[1]).toBe(0);
    expect(c.dealtToShips[1]).toBe(0);
    // …and the killing blow is on the record, against the victim's slot.
    expect(c.lastHitBy[1]).toBe(0);
    expect(c.lastHitAt[1]).toBeGreaterThan(0);
  });

  it('never credits the station rows for a ship kill', () => {
    const world = emptyArena();
    shootToDeath(world, shipOf(world, 0)!, shipOf(world, 1)!);
    const c = world.credit!;
    expect(c.dealtToStations.every((n) => n === 0)).toBe(true);
    expect(c.stationKills.every((n) => n === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. A turret's kill belongs to the station owner
// ---------------------------------------------------------------------------

describe('a turret kill belongs to the player who bought the turret', () => {
  it('credits the station owner, not nobody and not the turret', () => {
    const world = emptyArena();
    const defender = shipOf(world, 0)!;
    const home = stationOf(world, 0)!;
    defender.banked = 9999;
    expect(placeOrder(world, defender, 'turret')).toBe('ok');

    // Let construction finish through the sim's own build timer.
    for (let t = 0; t < 6000 && home.turrets.length === 0; t++) step(world, []);
    expect(home.turrets.length).toBe(1);
    const turret = home.turrets[0]!;

    // Walk an enemy into the turret's reach and leave it there, unarmed: the
    // only thing shooting in this match is the deterrent player 0 paid for.
    const victim = shipOf(world, 1)!;
    const hold = { x: turret.pos.x + 120, y: turret.pos.y };
    let killed = false;
    for (let t = 0; t < 12000 && !killed; t++) {
      victim.pos = { x: hold.x, y: hold.y };
      victim.vel = { x: 0, y: 0 };
      victim.spawnProtect = 0;
      step(world, []);
      killed = !victim.alive;
    }

    expect(killed).toBe(true);
    const c = world.credit!;
    expect(c.shipKills[0]).toBe(1);
    expect(c.dealtToShips[0]).toBeGreaterThan(0);
    expect(c.lastHitBy[1]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. A shot outlives its owner
// ---------------------------------------------------------------------------

describe('a shot in flight credits the owner SLOT, not the hull that fired it', () => {
  it('pays a dead — and eliminated — owner for the hit their last shot lands', () => {
    const world = emptyArena();
    const shooter = shipOf(world, 0)!;
    const victim = shipOf(world, 1)!;

    // One real shot, loosed across a gap it needs time to cross — inside the
    // weapon's reach, so the shot dies on the victim and not of old age. The
    // barrel is turn-rate limited, so it is brought to bear first and only then
    // fired; a shot loosed on the first tick would fly off the spawn heading.
    stageDuel(world, shooter, victim, 200);
    const bearing = aimAt(shooter, victim.pos.x, victim.pos.y);
    for (let t = 0; t < 90; t++) {
      stageDuel(world, shooter, victim, 200);
      step(world, [{ id: 0, actions: [bearing] }]);
    }
    step(world, [{ id: 0, actions: [bearing, FIRE] }]);
    expect(world.projectiles.some((p) => p.active && p.owner === 0)).toBe(true);

    // The shooter dies mid-flight — and is out of the match for good. The flags
    // are set directly rather than through `destroyCore`, which deactivates the
    // dead player's shots: the property under test is what happens when a shot
    // DOES outlive its owner, so the shot has to survive to land.
    killShip(world, shooter);
    shooter.eliminated = true;
    world.match.eliminated.push(0);
    expect(world.credit!.dealtToShips[0]).toBe(0);

    for (let t = 0; t < 600 && world.credit!.dealtToShips[0] === 0; t++) {
      victim.vel = { x: 0, y: 0 };
      step(world, []);
    }

    // The seat is the accounting key. The hull is not.
    expect(world.credit!.dealtToShips[0]).toBeGreaterThan(0);
    expect(world.credit!.lastHitBy[1]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Allies and self are never credited — TWO SLOTS ON ONE SIDE
// ---------------------------------------------------------------------------

describe('allies and self earn nothing (two slots sharing a side)', () => {
  /** 0 and 1 are teammates; 2 is the enemy. FFA would prove nothing here — it is
   *  teams-of-one, so an allegiance bug is invisible in it forever. */
  const TEAMED = [
    { id: 0, shipClass: ShipClass.Vanguard, team: 0 },
    { id: 1, shipClass: ShipClass.Vanguard, team: 0 },
    { id: 2, shipClass: ShipClass.Vanguard, team: 1 },
  ];

  it('refuses credit for damage to a teammate, while the damage rule is untouched', () => {
    const world = emptyArena(TEAMED);
    const ally = shipOf(world, 1)!;
    const before = ally.hull;

    // The damage LANDS — `damageShip` is not an allegiance gate and must not
    // become one (`canDamage` is asked upstream, by the projectile). It simply
    // pays nobody.
    expect(damageShip(world, ally, 10, 0)).toBe(true);
    expect(ally.hull).toBeCloseTo(before - 10, 6);
    expect(world.credit!.dealtToShips[0]).toBe(0);
    expect(world.credit!.lastHitBy[1]).toBe(null);
  });

  it('refuses credit for a teammate KILL', () => {
    const world = emptyArena(TEAMED);
    killShip(world, shipOf(world, 1)!, 0);
    expect(world.credit!.shipKills[0]).toBe(0);
  });

  it('refuses credit for self-damage and self-kill', () => {
    const world = emptyArena(TEAMED);
    const own = shipOf(world, 0)!;
    damageShip(world, own, 10, 0);
    killShip(world, own, 0);
    expect(world.credit!.dealtToShips[0]).toBe(0);
    expect(world.credit!.shipKills[0]).toBe(0);
    expect(world.credit!.lastHitBy[0]).toBe(null);
  });

  it('refuses credit for a teammate’s station, and pays for an enemy’s', () => {
    const world = emptyArena(TEAMED);
    damageStation(world, stationOf(world, 1)!, 10, 0); // ally home
    expect(world.credit!.dealtToStations[0]).toBe(0);

    damageStation(world, stationOf(world, 2)!, 10, 0); // enemy home
    expect(world.credit!.dealtToStations[0]).toBeCloseTo(10, 6);
  });

  it('still pays for an enemy on the other side', () => {
    const world = emptyArena(TEAMED);
    const foe = shipOf(world, 2)!;
    expect(damageShip(world, foe, 10, 0)).toBe(true);
    expect(world.credit!.dealtToShips[0]).toBeCloseTo(10, 6);
    expect(world.credit!.lastHitBy[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. A shared kill goes to ONE player
// ---------------------------------------------------------------------------

describe('a shared kill is never split', () => {
  it('gives the whole kill to the last enemy to land damage, and splits only the damage', () => {
    const world = emptyArena();
    const victim = shipOf(world, 1)!;
    const hull = victim.hull;

    // 0 softens it; 2 finishes it a moment later.
    damageShip(world, victim, hull - 5, 0);
    step(world, []);
    damageShip(world, victim, 9999, 2);

    const c = world.credit!;
    expect(victim.alive).toBe(false);
    expect(c.shipKills[2]).toBe(1);
    expect(c.shipKills[0]).toBe(0);
    // No `0.5 SHIPS DESTROYED` anywhere: kills are integers.
    expect(c.shipKills.every((n) => Number.isInteger(n))).toBe(true);
    // The work, though, is split honestly — and the finisher's overkill is not
    // paid: only the 5 HP that were actually there.
    expect(c.dealtToShips[0]).toBeCloseTo(hull - 5, 6);
    expect(c.dealtToShips[2]).toBeCloseTo(5, 6);
    expect(c.lastHitBy[1]).toBe(2);
  });

  it('records the assist window without paying it', () => {
    const world = emptyArena();
    const victim = shipOf(world, 1)!;
    const hull = victim.hull;

    damageShip(world, victim, hull - 5, 0);
    step(world, []);
    damageShip(world, victim, 9999, 2);

    // Phase 1 pays no assist XP — the assister's damage already paid them — but
    // the window is on the record for a later summary to name.
    expect(assistsOn(world, 1)).toEqual([0]);
    expect(world.credit!.shipKills[0]).toBe(0);

    // …and it is a window, not "forever": a hit older than ASSIST_WINDOW_S is
    // not an assist.
    const stale = emptyArena();
    const other = shipOf(stale, 1)!;
    damageShip(stale, other, 1, 0);
    for (let t = 0; t < Math.ceil((ASSIST_WINDOW_S + 1) / TICK_DT); t++) step(stale, []);
    damageShip(stale, other, 9999, 2);
    expect(assistsOn(stale, 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. The Crush credits nobody
// ---------------------------------------------------------------------------

describe('the collapse phase credits nobody (honesty, GDD §2.3)', () => {
  it('ends a full collapse with zero station kills and no last hitter', () => {
    const world = emptyArena([FFA[0]!, FFA[1]!], 5);
    // An empty field with the waves already due: collapse opens on the sim's own
    // condition (last wave delivered, nothing left to mine), not on a flag.
    world.economy = { ...world.economy!, waveInterval: 5 };

    let ticks = 0;
    const cap = Math.ceil((60 + CORE_HP + 60) / TICK_DT);
    while (ticks < cap && world.stations.some((p) => p.alive)) {
      step(world, []); // nobody ever fires a shot
      ticks++;
    }

    expect(isCollapsed(world)).toBe(true);
    expect(world.stations.every((p) => !p.alive)).toBe(true);

    const c = world.credit!;
    expect(c.stationKills).toEqual([0, 0]);
    expect(c.dealtToStations).toEqual([0, 0]);
    // Nobody hit anything, so nobody is on the record as having hit anything.
    // pr-05 renders this as `—`, never as a guess.
    expect(c.lastHitBy).toEqual([null, null]);
  });

  it('credits a player who DOES finish a core, so the zero above is a fact not a floor', () => {
    const world = emptyArena();
    damageStation(world, stationOf(world, 1)!, CORE_HP * 10, 0);
    expect(stationOf(world, 1)!.alive).toBe(false);
    expect(world.credit!.stationKills[0]).toBe(1);
    // Only the HP that was there — shields plus the core, never the overkill.
    expect(world.credit!.dealtToStations[0]).toBeLessThanOrEqual(CORE_HP);
    expect(world.credit!.dealtToStations[0]).toBeGreaterThan(0);
  });

  it('pays the 10× once even if two shots reach the same core in one tick', () => {
    const world = emptyArena();
    const doomed = stationOf(world, 1)!;
    damageStation(world, doomed, CORE_HP * 10, 0);
    // `destroyCore` is deliberately idempotent; the credit must not be.
    damageStation(world, doomed, CORE_HP * 10, 2);
    expect(world.credit!.stationKills[0]).toBe(1);
    expect(world.credit!.stationKills[2]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. The replay hash does not move — the test this brief lives or dies on
// ---------------------------------------------------------------------------

/** The determinism test's own recorded match: eight seats, four strategies,
 *  60 sim-seconds — waves, fire, mining, construction, turrets, eliminations. */
const SETUP: MatchSetup = {
  seed: 20260724,
  lineup: roundRobinLineup([
    { strategy: 'miner', shipClass: ShipClass.Vanguard },
    { strategy: 'turtle', shipClass: ShipClass.Excavator },
    { strategy: 'rusher', shipClass: ShipClass.Interceptor },
    { strategy: 'raider', shipClass: ShipClass.Hauler },
  ]),
};

/** `harness/match.replay`, with the credit ledger torn off the world before the
 *  first tick — the "ledger absent" arm of the evidence line. */
function replayWithoutCredit(recording: MatchRecording): { hash: string; world: World } {
  const world = buildWorld(recording.setup);
  delete world.credit;
  for (const inputs of recording.inputs) step(world, inputs, recording.dt);
  return { hash: hashState(world), world };
}

describe('determinism — the ledger cannot perturb a replay (GDD §4.8)', () => {
  const run = recordMatch(SETUP, { maxSeconds: 60 });

  it('replays to a byte-identical final hash with the ledger present and absent', () => {
    const withLedger = replay(run.recording);
    const without = replayWithoutCredit(run.recording);

    // The evidence line, printed: two runs of the same 3 600 ticks, one keeping
    // the books and one not.
    // eslint-disable-next-line no-console
    console.info(
      `p1-02 determinism evidence — credit ledger PRESENT: ${withLedger.hash} · ABSENT: ${without.hash}`,
    );

    expect(without.hash).toBe(withLedger.hash);
    expect(withLedger.hash).toBe(run.recording.hash);
    expect(without.world.credit).toBeUndefined();
  });

  it('recorded a match with real combat in it, so the parity above means something', () => {
    const c = replay(run.recording).world.credit!;
    const damage = c.dealtToShips.reduce((n, x) => n + x, 0) + c.dealtToStations.reduce((n, x) => n + x, 0);
    expect(damage).toBeGreaterThan(0);
  });

  it('never lands the ledger on the hashed state', () => {
    const a = buildWorld(SETUP);
    const b = buildWorld(SETUP);
    b.credit!.dealtToShips[0] = 1234;
    b.credit!.shipKills[1] = 7;
    b.credit!.lastHitBy[2] = 3;
    expect(hashState(b)).toBe(hashState(a));
  });
});

// ---------------------------------------------------------------------------
// The foreign-world contract — `ledgerAdd`'s no-op discipline, copied
// ---------------------------------------------------------------------------

describe('a world without a credit ledger keeps working', () => {
  it('takes damage, deaths and core kills with no ledger attached', () => {
    const world = emptyArena();
    delete world.credit;
    const victim = shipOf(world, 1)!;
    expect(() => {
      damageShip(world, victim, 5, 0);
      killShip(world, victim, 0);
      damageStation(world, stationOf(world, 2)!, CORE_HP * 10, 0);
    }).not.toThrow();
    expect(assistsOn(world, 1)).toEqual([]);
  });

  it('ignores a slot the ledger has no row for', () => {
    const world = emptyArena();
    // A hand-built world with a two-seat ledger and a three-seat lobby: out-of-
    // range slots are dropped, never appended.
    world.credit!.dealtToShips.length = 2;
    world.credit!.dealtToStations.length = 2;
    world.credit!.shipKills.length = 2;
    world.credit!.lastHitBy.length = 2;
    expect(() => damageShip(world, shipOf(world, 1)!, 5, 2)).not.toThrow();
    expect(world.credit!.dealtToShips.length).toBe(2);
  });
});
