/**
 * src/sim/ffa-hostility.test.ts — **the human is a foe** (developer report p15:
 * "I don't think enemies attacked me at all… are they ignoring me???").
 * OWNER: Gameplay Engineer.
 *
 * The prime suspect the brief names is a p14 regression shape: every targeting
 * ladder now asks "same team?" (`./allegiance`), and FFA is teams-of-one — so if
 * the HUMAN's seat ever resolved to a team id a bot seat also holds (0, or a
 * shared default, or `undefined === undefined`), that human would read as a
 * TEAMMATE. Bots would never lock them, turrets would never fire on them, and
 * projectiles would pass straight through (`canDamage`) — while every bot-vs-bot
 * pair still differs and fights normally. Bot wars everywhere, player untouchable.
 *
 * The p14 suite pinned "never attack teammates". Nothing pinned the complement,
 * which is the whole game in FFA: **DO attack everyone else, the human included.**
 * That is what this file pins, at the layer the suspicion lives in — match build:
 *
 *  1. Team ids are UNIQUE across every active slot in FFA — human seats, bot
 *     seats, closed-slot compaction, any lobby order (`configToPlayers`).
 *  2. The pre-teams roster shape the offline client actually boots with (a
 *     `PlayerSpec[]` with **no `team` field at all**, `src/platform/match-boot`)
 *     still builds a world where every pair is hostile — the `undefined ===
 *     undefined` trap, closed.
 *  3. The human's ship and the human's station agree about which team they are,
 *     so a bot that asks about the ship and a turret that asks about the home can
 *     never disagree.
 *  4. End to end through `step`: a rival's auto-aim locks the human and its shots
 *     take hull off, and a rival turret opens up on the human in its range. The
 *     predicate is proven where it is consumed, not just where it is defined.
 *
 * Which slot the human holds is not the sim's business — so every case below runs
 * the human through EVERY seat rather than assuming slot 0. The measured,
 * behavioural half of this report (per-tier attack initiations against a scripted
 * human vs against bots) lives in `tests/harness/player-aggression.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Vec2 } from '@shared/types';
import {
  MAX_MATCH_SIZE,
  MIN_MATCH_SIZE,
  areEnemies,
  canDamage,
  configToPlayers,
  createWorld,
  ffaConfig,
  sameSide,
  step,
  teamOf,
  type Inputs,
  type MatchConfig,
  type PlayerSpec,
  type SlotConfig,
  type World,
} from './index';
import { SPAWN_PROTECTION_S, STATION, TURRET, WEAPON_RANGE, WORLD_SIZE } from './constants';

/** Every ordered pair of distinct ids in a match of `n`. */
function pairs(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) out.push([a, b]);
  return out;
}

/**
 * A lobby the way a real one is authored: `size` seats taken, one of them the
 * human (`open`), the rest bots, the remainder closed. `team` is left at the
 * slot index, which is what every FFA lobby writes — the point of the test is
 * that FFA resolves teams-of-one regardless.
 */
function lobby(size: number, humanSeat: number): MatchConfig {
  const slots: SlotConfig[] = [];
  for (let index = 0; index < MAX_MATCH_SIZE; index++) {
    slots.push({
      index,
      state: index >= size ? 'closed' : index === humanSeat ? 'open' : 'bot',
      shipClass: index === humanSeat ? ShipClass.Vanguard : ShipClass.Excavator,
      ...(index === humanSeat ? {} : { botPersonality: 'foreman', botDifficulty: 'hard' as const }),
      team: index,
    });
  }
  return { mode: 'ffa', slots };
}

// ---------------------------------------------------------------------------
// 1. Team-id uniqueness across ALL slots, human included
// ---------------------------------------------------------------------------

describe('FFA gives every slot its own team — the human is nobody teammate', () => {
  it('configToPlayers assigns a unique team to every active slot, at every size', () => {
    for (let size = MIN_MATCH_SIZE; size <= MAX_MATCH_SIZE; size++) {
      for (let human = 0; human < size; human++) {
        const players = configToPlayers(lobby(size, human));
        expect(players).toHaveLength(size);
        const teams = players.map((p) => p.team);
        // The assertion the p14 suite never made: no two seats share a side.
        expect(new Set(teams).size).toBe(size);
        // And no seat is missing one — an absent team is the `undefined ===
        // undefined` trap that would make the whole lobby one happy family.
        for (const team of teams) expect(typeof team).toBe('number');
      }
    }
  });

  it('a sparse lobby (closed slots between the players) still lands unique teams', () => {
    // The human sits in a high slot with holes below it — the compaction path
    // (`configToPlayers` re-indexes to a dense roster) is exactly where a naive
    // "team = index" would collide with a re-indexed neighbour.
    const cfg = ffaConfig(MAX_MATCH_SIZE, ShipClass.Vanguard);
    for (const index of [1, 3, 4, 6]) cfg.slots[index]!.state = 'closed';
    cfg.slots[7]!.state = 'open'; // the human, last seat, after four holes
    const players = configToPlayers(cfg);
    expect(players).toHaveLength(4);
    expect(new Set(players.map((p) => p.team)).size).toBe(4);
  });

  it('every pair in a built FFA world reads as enemies — including the human', () => {
    for (let size = MIN_MATCH_SIZE; size <= MAX_MATCH_SIZE; size++) {
      for (let human = 0; human < size; human++) {
        const world = createWorld({ seed: 7, players: configToPlayers(lobby(size, human)) });
        for (const [a, b] of pairs(size)) {
          expect(areEnemies(world, a, b)).toBe(true);
          expect(sameSide(world, a, b)).toBe(false);
          expect(canDamage(world, a, b)).toBe(true);
        }
        // Self is never self's enemy — the one exemption, and it must not widen.
        for (let id = 0; id < size; id++) expect(areEnemies(world, id, id)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The roster shape the offline client actually boots with
// ---------------------------------------------------------------------------

describe('the pre-teams roster (no team field anywhere) is still a free-for-all', () => {
  it('an untagged human among untagged bots is hostile to all of them', () => {
    // `src/platform/match-boot` builds exactly this: `{id, shipClass}` rows, no
    // `team` key on any of them. If an absent team resolved to a shared constant
    // (0, or `undefined`), every seat would read as one team and NOBODY would
    // ever be attacked — the report's symptom, but for everyone at once.
    const players: PlayerSpec[] = [
      { id: 0, shipClass: ShipClass.Vanguard }, // the human
      { id: 1, shipClass: ShipClass.Hauler },
      { id: 2, shipClass: ShipClass.Interceptor },
      { id: 3, shipClass: ShipClass.Excavator },
    ];
    const world = createWorld({ seed: 3, players });
    for (const [a, b] of pairs(players.length)) expect(areEnemies(world, a, b)).toBe(true);
    // Teams-of-one, spelled out: the resolved team IS the slot.
    for (const p of players) expect(teamOf(world, p.id)).toBe(p.id);
  });

  it('an untagged human beside explicitly-tagged bots is still hostile to all of them', () => {
    // The mixed case a wire/lobby skew could produce: the bots' seats carry a
    // team, the human's row does not. The default must be the human's own id —
    // not a value any bot could also hold.
    for (let human = 0; human < 4; human++) {
      const players: PlayerSpec[] = [0, 1, 2, 3].map((id) => ({
        id,
        shipClass: ShipClass.Vanguard,
        ...(id === human ? {} : { team: id }),
      }));
      const world = createWorld({ seed: 5, players });
      for (const [a, b] of pairs(4)) expect(areEnemies(world, a, b)).toBe(true);
    }
  });

  it('the human ship and the human home agree about whose side they are on', () => {
    // A bot asks `areEnemies(self, ship.id)`; a turret asks about `station.owner`.
    // If those two ever resolved differently the ship would be shot and the home
    // spared (or the reverse), which is a bug nobody would think to look for.
    const world = createWorld({ seed: 11, players: configToPlayers(lobby(8, 5)) });
    for (const ship of world.ships) {
      const station = world.stations.find((p) => p.owner === ship.id)!;
      expect(station.team).toBe(ship.team);
      expect(teamOf(world, ship.id)).toBe(ship.team);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Consumed, not just defined: the sim really does shoot the human
// ---------------------------------------------------------------------------

/** A 4-player FFA world with the human in `humanSeat`, past spawn protection,
 *  with the rocks removed so nothing occludes a shot. */
function skirmish(humanSeat: number): World {
  const world = createWorld({
    seed: 9,
    players: configToPlayers(lobby(4, humanSeat)),
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 1;
  for (const s of world.ships) s.spawnProtect = 0;
  for (const p of world.stations) p.spawnProtect = 0;
  return world;
}

/** Hold the trigger down with auto-aim, for `id` only — the action stream a bot
 *  (or a player on auto-aim) files when it means to shoot whatever is closest. */
function autoFire(id: number): Inputs {
  return [{ id, actions: [{ type: 'fire', active: true, auto: true }] }];
}

/** Somewhere quiet inside the arena — the duelling ground for the cases below.
 *  Well inside the bounds, so nothing here is fighting the edge clamp. */
const RING: Vec2 = { x: WORLD_SIZE * 0.5, y: WORLD_SIZE * 0.5 };
/** Out of everyone's way, and inside the bounds. */
const ELSEWHERE: Vec2 = { x: WORLD_SIZE - 40, y: 40 };

describe('a rival in FFA can and does put fire on the human', () => {
  it("auto-aim locks the human's ship and takes hull off it", () => {
    for (let human = 0; human < 4; human++) {
      const shooter = (human + 1) % 4;
      const world = skirmish(human);
      const target = world.ships.find((s) => s.id === human)!;
      const gun = world.ships.find((s) => s.id === shooter)!;
      // Park the shooter inside weapon range, everyone else out of the way, so
      // the only thing the ladder can acquire is the human.
      for (const s of world.ships) s.pos = { ...ELSEWHERE };
      for (const p of world.stations) p.pos = { ...ELSEWHERE };
      gun.pos = { ...RING };
      target.pos = { x: RING.x + WEAPON_RANGE * 0.4, y: RING.y };

      const before = target.hull;
      for (let t = 0; t < 180; t++) step(world, autoFire(shooter));
      expect(target.hull).toBeLessThan(before);
    }
  });

  it("a rival's turret opens fire on the human's ship in its range", () => {
    const human = 2;
    const owner = 0;
    const world = skirmish(human);
    const station = world.stations.find((p) => p.owner === owner)!;
    const builder = world.ships.find((s) => s.id === owner)!;

    // Build the gun the way the game does — an order at the wheel, then the
    // construction timer (GDD §2.5) — rather than by hand-writing a turret.
    builder.pos = { x: station.pos.x + STATION.dockRange * 0.5, y: station.pos.y };
    builder.banked = TURRET.cost;
    step(world, [{ id: owner, actions: [{ type: 'buildOrder', item: 'turret' }] }]);
    for (let t = 0; t < 1200 && station.turrets.length === 0; t++) step(world, []);
    expect(station.turrets).toHaveLength(1);
    const turret = station.turrets[0]!;

    // Keep every other ship out of the picture; stand the human next to the gun.
    for (const s of world.ships) s.pos = { ...ELSEWHERE };
    const victim = world.ships.find((s) => s.id === human)!;
    victim.pos = { x: turret.pos.x + TURRET.range * 0.5, y: turret.pos.y };

    const before = victim.hull;
    for (let t = 0; t < 240; t++) step(world, []);
    expect(victim.hull).toBeLessThan(before);
  });
});
