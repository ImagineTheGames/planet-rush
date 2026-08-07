/**
 * src/bots/perception.test.ts — the fog-honesty contract (GDD §2.2, §2.9).
 *
 * The rule the whole bot module hangs off: **a bot perceives only what a human
 * in its cockpit could.** These tests are the ones that would fail if some
 * future tree started peeking, so they check the *absence* of information as
 * hard as they check its presence:
 *
 *   1. a bot knows its own ship and its own station completely;
 *   2. an enemy core's HP is `null` until the bot flies inside sensor range;
 *   3. a wreck is visible from any distance (smoke carries) while its numbers
 *      are not;
 *   4. entities outside visual range are not in the view at all, and enemy
 *      cargo is not in the view *ever*;
 *   5. the envelope cannot be widened past a human's — difficulty may not cheat.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, SENSOR_RANGE, WAVE_COUNT, WAVE_INTERVAL_S, type World } from '../sim';
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

describe('perception — enemy stations are scouted, not broadcast', () => {
  it("hides a rival's core HP until the bot is inside sensor range", () => {
    const w = world2();
    const target = station(w, 1);
    const me = ship(w, 0);

    // Parked far away: position and ownership are public, the numbers are not.
    me.pos = { x: target.pos.x + 2000, y: target.pos.y };
    const far = perceive(w, 0).stations.find((p) => p.owner === 1)!;
    expect(far.pos).toEqual(target.pos);
    expect(far.scouted).toBe(false);
    expect(far.coreHp).toBeNull();
    expect(far.shieldHp).toBeNull();
    expect(far.turrets).toBeNull();
    expect(far.underAttack).toBeNull();

    // Flown in: sensor range is measured to the surface, so standing on the
    // rock always reads as scouted.
    me.pos = { x: target.pos.x + target.radius + SENSOR_RANGE - 1, y: target.pos.y };
    const near = perceive(w, 0).stations.find((p) => p.owner === 1)!;
    expect(near.scouted).toBe(true);
    expect(near.coreHp).toBe(target.coreHp);
    expect(near.shieldHp).toBe(0);
    expect(near.turrets).toBe(0);
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
    const env = resolvePerception({ visualRange: 100_000, sensorRange: 100_000 });
    expect(env.visualRange).toBe(HUMAN_VISUAL_RANGE);
    expect(env.sensorRange).toBe(HUMAN_VISUAL_RANGE);
    expect(resolvePerception().sensorRange).toBe(SENSOR_RANGE);
  });

  it('narrowing the envelope narrows what the view contains', () => {
    const w = world2();
    const me = ship(w, 0);
    ship(w, 1).pos = { x: me.pos.x + 300, y: me.pos.y };

    expect(perceive(w, 0, resolvePerception({ visualRange: 400 })).ships).toHaveLength(1);
    expect(perceive(w, 0, resolvePerception({ visualRange: 200 })).ships).toHaveLength(0);
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
