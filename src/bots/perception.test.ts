/**
 * src/bots/perception.test.ts — the fog-honesty contract (GDD §2.2, §2.9).
 *
 * The rule the whole bot module hangs off: **a bot perceives only what a human
 * in its cockpit could.** These tests are the ones that would fail if some
 * future tree started peeking, so they check the *absence* of information as
 * hard as they check its presence:
 *
 *   1. a bot knows its own ship and its own station completely;
 *   2. an enemy core's HP is `null` until the home is on the bot's screen
 *      (a0-05: the health gate widened from the retired `SENSOR_RANGE` to
 *      `visualRange` when GDD §2.2 made the damage ring always-visible);
 *   3. a wreck is visible from any distance (smoke carries) while its numbers
 *      are not;
 *   4. entities outside visual range are not in the view at all, and enemy
 *      cargo is not in the view *ever*;
 *   5. the envelope cannot be widened past a human's — difficulty may not cheat.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  createWorld,
  step,
  waveIntervalOf,
  WAVE_COUNT,
  WAVE_INTERVAL_S,
  type Abundance,
  type World,
} from '../sim';
import {
  DEFAULT_PERCEPTION,
  HUMAN_VISUAL_RANGE,
  estimateOre,
  nearest,
  perceive,
  resolvePerception,
  type PerceivedShip,
} from './perception';

/** A quiet two-slot world: no rocks, so nothing drifts into a range check. */
function world2(): World {
  return createWorld({
    seed: 7,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Interceptor },
    ],
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
}

/**
 * A quiet four-slot world under an optional side table. `teams` omitted means
 * **no `team` key at all** — the FFA roster shape the offline client boots with,
 * and the one `createWorld` reads as teams-of-one.
 */
function world4(teams?: readonly number[]): World {
  return createWorld({
    seed: 7,
    players: [0, 1, 2, 3].map((id) => {
      const spec = { id, shipClass: ShipClass.Vanguard };
      return teams?.[id] === undefined ? spec : { ...spec, team: teams[id]! };
    }),
    bounds: { width: 6000, height: 6000 },
    asteroidCount: 0,
  });
}

const ship = (w: World, id: number) => w.ships.find((s) => s.id === id)!;
const station = (w: World, owner: number) => w.stations.find((p) => p.owner === owner)!;

describe('perception — the cockpit', () => {
  it('gives a bot its own ship and its own station in full', () => {
    const w = world2();
    const me = ship(w, 0);
    me.cargo = 1.5;
    const view = perceive(w, 0);

    expect(view.self.id).toBe(0);
    expect(view.self.pos).toEqual(me.pos);
    expect(view.self.cargo).toBe(1.5);
    expect(view.self.spendable).toBe(me.cargo + me.banked);
    expect(view.self.station).not.toBeNull();
    expect(view.self.station!.coreHp).toBe(station(w, 0).coreHp);
    // Its own station's HP is on the HUD permanently (GDD §2.2) — no scouting.
    expect(view.self.homeDistance).toBeLessThan(Number.POSITIVE_INFINITY);
  });

  it('publishes the wave clock, which the HUD prints for everyone', () => {
    const w = world2();
    const view = perceive(w, 0);
    expect(view.wavesSpawned).toBe(1);
    expect(view.nextWaveIn).toBeCloseTo(WAVE_INTERVAL_S, 6);
    expect(view.phase).toBe('live');
    expect(view.collapsed).toBe(false);

    w.match.wavesSpawned = WAVE_COUNT;
    expect(perceive(w, 0).nextWaveIn).toBeNull();
  });

  it('reports nothing but its own state while dead — the cockpit is wreckage', () => {
    const w = world2();
    ship(w, 0).alive = false;
    const view = perceive(w, 0);
    expect(view.self.alive).toBe(false);
    expect(view.ships).toHaveLength(0);
    expect(view.stations).toHaveLength(0);
  });
});

/**
 * **The view answers "is that one of mine?"** (Stage 1 Task 1.2,
 * `docs/team-bots-plan.md`).
 *
 * A tree may not import `sim/allegiance.ts` — it has no `World` to hand it — so
 * the side of every entity is stamped into the view (p16-01's `hostile`), and
 * Stage 1 adds the one thing p16-01 had no reason to: the **roster of my own
 * side**, which is what a bot needs to model the *win condition* rather than its
 * own survival (`sim/match.ts` `resolveWinner`: the last TEAM with a core wins).
 *
 * The FFA case is asserted next to every teams case, because FFA is teams-of-one
 * and that is what makes the whole thing degrade structurally: no allies, no
 * ally list, no team-aware branch that can fire.
 */
describe('perception — my own side', () => {
  it('reports the ally, and only the ally, at every range in a 2v2', () => {
    const w = world4([0, 0, 1, 1]);
    const me = ship(w, 0);

    // Nose to nose, and then three arenas away: the roster does not move.
    for (const at of [{ x: ship(w, 1).pos.x, y: ship(w, 1).pos.y }, { x: -9000, y: -9000 }]) {
      me.pos = at;
      const view = perceive(w, 0);
      expect(view.self.team).toBe(0);
      expect(view.allies.map((a) => a.id)).toEqual([1]);
      expect(view.allies[0]!.stationAlive).toBe(true);
      expect(view.allies[0]!.stationPos).toEqual(station(w, 1).pos);
    }

    // The other side sees the mirror image, and nobody is their own ally.
    expect(perceive(w, 2).allies.map((a) => a.id)).toEqual([3]);
    expect(perceive(w, 1).allies.map((a) => a.id)).toEqual([0]);
    for (const id of [0, 1, 2, 3]) {
      expect(perceive(w, id).allies.some((a) => a.id === id)).toBe(false);
    }
  });

  it('has no allies at all in FFA — teams-of-one', () => {
    const w = world4();
    for (const id of [0, 1, 2, 3]) {
      const view = perceive(w, id);
      expect(view.allies).toEqual([]);
      // Teams-of-one: a slot's side is its own id, and every hull is hostile.
      expect(view.self.team).toBe(id);
      expect(view.ships.every((s) => s.hostile)).toBe(true);
      expect(view.stations.every((s) => s.hostile)).toBe(true);
    }
  });

  it('lists a four-strong side ascending by id, self excluded', () => {
    const w = createWorld({
      seed: 3,
      players: [0, 1, 2, 3, 4, 5, 6, 7].map((id) => ({
        id,
        shipClass: ShipClass.Vanguard,
        team: id % 2,
      })),
      bounds: { width: 6000, height: 6000 },
      asteroidCount: 0,
    });
    expect(perceive(w, 4).allies.map((a) => a.id)).toEqual([0, 2, 6]);
    expect(perceive(w, 1).allies.map((a) => a.id)).toEqual([3, 5, 7]);
  });

  it('reports an ally home as a wreck, which is public at any range', () => {
    const w = world4([0, 0, 1, 1]);
    station(w, 1).alive = false;
    ship(w, 0).pos = { x: 9000, y: 9000 };

    const ally = perceive(w, 0).allies[0]!;
    expect(ally.stationAlive).toBe(false);
    // …and nothing else about it came along for the ride. The roster is three
    // public facts; an ally's HP is scouted like anyone else's (Trap 8).
    expect(Object.keys(ally).sort()).toEqual(['id', 'stationAlive', 'stationPos']);
  });

  it('still knows its own side while dead — the roster is not a sighting', () => {
    const w = world4([0, 0, 1, 1]);
    ship(w, 0).alive = false;
    const view = perceive(w, 0);
    expect(view.ships).toHaveLength(0);
    expect(view.stations).toHaveLength(0);
    expect(view.allies.map((a) => a.id)).toEqual([1]);
  });
});

describe('perception — a rival home\'s numbers need it on screen (a0-05)', () => {
  it("hides a rival's core HP only once the home is off screen", () => {
    const w = world2();
    const target = station(w, 1);
    const me = ship(w, 0);

    // Parked far away: position and ownership are public, the numbers are not.
    // A human cannot read a ring that is not being drawn on their screen either.
    me.pos = { x: target.pos.x + 2000, y: target.pos.y };
    const far = perceive(w, 0).stations.find((p) => p.owner === 1)!;
    expect(far.pos).toEqual(target.pos);
    expect(far.scouted).toBe(false);
    expect(far.coreHp).toBeNull();
    expect(far.shieldHp).toBeNull();
    expect(far.turrets).toBeNull();
    expect(far.underAttack).toBeNull();

    // On screen: measured to the surface, so standing on the rock always reads.
    // Since GDD §2.2 was amended this is the SAME gate the turret count uses —
    // the renderer draws the damage ring on every station it draws, so a bot
    // reads it wherever a human would (GDD §2.9 symmetry).
    me.pos = { x: target.pos.x + target.radius + DEFAULT_PERCEPTION.visualRange - 1, y: target.pos.y };
    const near = perceive(w, 0).stations.find((p) => p.owner === 1)!;
    expect(near.scouted).toBe(true);
    expect(near.coreHp).toBe(target.coreHp);
    expect(near.shieldHp).toBe(0);
    expect(near.turrets).toBe(0);
  });

  it('reads a wounded home from clear across the screen — the a0-05 report', () => {
    // The developer, 2026-08-07: *"approaching and getting far it looks like its
    // full health even if its damaged."* The old gate was 180 units; a home four
    // times further out than that, and plainly on screen, used to read `null`
    // (i.e. "assume full") to a bot exactly as it drew no ring for a human.
    const w = world2();
    const target = station(w, 1);
    const me = ship(w, 0);
    target.coreHp = target.maxCoreHp * 0.25;

    me.pos = { x: target.pos.x + target.radius + 700, y: target.pos.y };
    const seen = perceive(w, 0).stations.find((p) => p.owner === 1)!;
    expect(seen.scouted).toBe(true);
    expect(seen.coreHp).toBe(target.maxCoreHp * 0.25);
  });

  it('shows a wreck from any distance but never its numbers', () => {
    const w = world2();
    const target = station(w, 1);
    target.alive = false;
    ship(w, 0).pos = { x: target.pos.x + 3000, y: target.pos.y };

    const seen = perceive(w, 0).stations.find((p) => p.owner === 1)!;
    expect(seen.alive).toBe(false); // smoke carries (GDD §2.2)
    expect(seen.coreHp).toBeNull();
  });
});

describe('perception — enemy ships', () => {
  it('drops ships that are off screen and hides the hull of the rest', () => {
    const w = world2();
    const me = ship(w, 0);
    const them = ship(w, 1);

    them.pos = { x: me.pos.x + DEFAULT_PERCEPTION.visualRange + 10, y: me.pos.y };
    expect(perceive(w, 0).ships).toHaveLength(0);

    them.pos = { x: me.pos.x + DEFAULT_PERCEPTION.visualRange - 10, y: me.pos.y };
    const seen = perceive(w, 0).ships[0] as PerceivedShip;
    expect(seen.id).toBe(1);
    // The hull bar floats over every ship on screen (GDD §2.2), so it is known.
    expect(seen.hull).toBe(them.hull);
    expect(seen.firing).toBe(false);
  });

  it('never reports what an enemy is carrying — the game does not draw it', () => {
    const w = world2();
    const them = ship(w, 1);
    them.pos = { x: ship(w, 0).pos.x + 50, y: ship(w, 0).pos.y };
    them.cargo = 6;

    const seen = perceive(w, 0).ships[0] as PerceivedShip;
    expect(Object.keys(seen)).not.toContain('cargo');
    expect(JSON.stringify(seen)).not.toContain('cargo');
  });

  it('hands the tree a snapshot, not the world: mutating a view is inert', () => {
    const w = world2();
    const view = perceive(w, 0);
    view.self.pos.x = -999;
    expect(ship(w, 0).pos.x).not.toBe(-999);
  });
});

describe('perception — the envelope', () => {
  it("clamps any caller to a human's vision (difficulty may not cheat)", () => {
    const env = resolvePerception({ visualRange: 100_000 });
    expect(env.visualRange).toBe(HUMAN_VISUAL_RANGE);
    expect(resolvePerception().visualRange).toBe(DEFAULT_PERCEPTION.visualRange);
    // There is one range left to clamp. `sensorRange` was retired with the
    // always-visible amendment (a0-05) rather than widened, so no caller can
    // narrow station health back down behind the renderer's back.
    expect(Object.keys(resolvePerception())).not.toContain('sensorRange');
  });

  it('narrowing the envelope narrows what the view contains', () => {
    const w = world2();
    const me = ship(w, 0);
    ship(w, 1).pos = { x: me.pos.x + 300, y: me.pos.y };

    expect(perceive(w, 0, resolvePerception({ visualRange: 400 })).ships).toHaveLength(1);
    expect(perceive(w, 0, resolvePerception({ visualRange: 200 })).ships).toHaveLength(0);
  });
});

describe("perception — the wave a bot is waiting for is the one that comes (a0-16)", () => {
  // `nextWaveIn` used to take `waveTime`'s baseline default while the spawner
  // scheduled on `world.economy.waveInterval`. In a default (SCARCE) match that
  // told every bot the wave was 15 s sooner than it was: it committed to the
  // centre early and found an empty field waiting for it. Not cosmetic — this
  // one moved ships.

  /** A two-slot world at one abundance level, with its real commons field: we
   *  are timing the wave schedule, so the rocks have to actually arrive. */
  function matchAt(abundance: Abundance): World {
    return createWorld({
      seed: 11,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Interceptor },
      ],
      abundance,
    });
  }

  for (const abundance of ['scarce', 'standard', 'rich'] as const) {
    it(`a bot expects the next wave when it really lands, at ${abundance.toUpperCase()}`, () => {
      const w = matchAt(abundance);
      const interval = waveIntervalOf(w);
      // The perceived wait is on the match's own metronome from the first frame.
      expect(perceive(w, 0).nextWaveIn).toBeCloseTo(interval, 6);

      // Step to the wave and check the bot's expectation stayed honest: it must
      // run down to (about) zero exactly as the wave lands, never reaching zero
      // while the field is still empty.
      let guard = 0;
      while (w.match.wavesSpawned < 2 && guard < 10_000) {
        const expected = perceive(w, 0).nextWaveIn!;
        expect(expected, `${abundance}: the wait is still running`).toBeGreaterThan(0);
        // What the bot expects plus where it is now IS the arrival time.
        expect(w.time + expected, `${abundance}: expected arrival`).toBeCloseTo(interval, 6);
        step(w, [], 1);
        guard++;
      }
      expect(w.match.wavesSpawned).toBe(2);
      // The wave landed on the first tick at or after the time the bot expected.
      expect(w.time).toBeGreaterThanOrEqual(interval - 1e-9);
      expect(w.time - 1).toBeLessThan(interval + 1e-9);
    });
  }

  it('a world with no resolved economy keeps the baseline expectation', () => {
    // Bot fixtures and net snapshots hand-build worlds without `economy` (as they
    // do without `ledger`). The bot must fall back to the baseline, not throw.
    const w = world2();
    delete (w as { economy?: unknown }).economy;
    expect(() => perceive(w, 0)).not.toThrow();
    expect(perceive(w, 0).nextWaveIn).toBeCloseTo(WAVE_INTERVAL_S, 6);
  });
});

describe('perception — reading the view', () => {
  it("estimates a rock's payout from size and crack stage alone", () => {
    const big = { id: 0, pos: { x: 0, y: 0 }, radius: 46, crackStage: 0, distance: 0 };
    const cracked = { ...big, crackStage: 2 };
    const small = { ...big, radius: 22 };

    expect(estimateOre(big)).toBeGreaterThan(estimateOre(small));
    expect(estimateOre(cracked)).toBeLessThan(estimateOre(big));
  });

  it('finds the nearest of a perceived field, and null when it is empty', () => {
    expect(nearest([])).toBeNull();
    expect(nearest([{ distance: 5 }, { distance: 2 }, { distance: 9 }])).toEqual({ distance: 2 });
  });
});
