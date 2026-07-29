/**
 * src/sim/alarm-ownership.test.ts — the under-attack alarm belongs to OWNERSHIP,
 * not proximity (developer report s5). OWNER: Gameplay Engineer.
 *
 * "Get rid of alarms — I still hear them for ENEMY bases." The alarm is a
 * mechanic, not a notification (GDD §2.2): it must fire ONLY when a station on
 * YOUR side takes damage. An enemy siege three homes away, or a neutral derelict
 * being chewed on, is spatialized combat audio at its real position — never your
 * klaxon. In TEAMS a *teammate's* home under siege IS your business and DOES ring.
 *
 * The sim owns the one fact all three alarm surfaces (audio klaxon, HUD arrow,
 * haptic pulse) must gate on: is the damaged station's owner on my side? That is
 * {@link sameSide} — the positive form of the ratified {@link areEnemies}
 * predicate. This suite pins exactly the ownership facts the alarm depends on, so
 * a team-table regression fails HERE rather than in a field report about a klaxon
 * ringing for someone else's fight.
 *
 * The wiring of each surface onto this predicate lives in those surfaces' own
 * lanes (`src/art/audio`, `src/ui`, `src/main`); this is the contract they read.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  createWorld,
  configToPlayers,
  ffaConfig,
  sameSide,
  areEnemies,
  teamOf,
  type PlayerSpec,
  type World,
} from './index';

/** A 2v2 whose SLOTS interleave the sides — team 0 is {0,2}, team 1 is {1,3}. The
 *  case a naive "owner === local" alarm would get wrong for the teammate. */
function twoVsTwo(): PlayerSpec[] {
  return [
    { id: 0, shipClass: ShipClass.Vanguard, team: 0 },
    { id: 1, shipClass: ShipClass.Vanguard, team: 1 },
    { id: 2, shipClass: ShipClass.Vanguard, team: 0 },
    { id: 3, shipClass: ShipClass.Vanguard, team: 1 },
  ];
}

/** Would a station owned by `owner` ring the under-attack alarm of `local`? This
 *  is the exact question every alarm surface asks, spelled out so the tests read
 *  like the field report. */
const rings = (world: World, local: number, owner: number) => sameSide(world, local, owner);

// ---------------------------------------------------------------------------
// FFA — your own home rings, every other home is an enemy and stays silent
// ---------------------------------------------------------------------------

describe('alarm ownership — FFA is teams-of-one: only YOUR home rings', () => {
  const world = createWorld({ seed: 5, players: configToPlayers(ffaConfig(8, ShipClass.Vanguard)), mapId: 'octagon' });

  it('your own station rings your alarm', () => {
    expect(rings(world, 3, 3)).toBe(true);
  });

  it('every OTHER station is an enemy base and never rings your alarm', () => {
    for (const owner of [0, 1, 2, 4, 5, 6, 7]) {
      expect(rings(world, 3, owner), `enemy owner ${owner}`).toBe(false);
      expect(areEnemies(world, 3, owner)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TEAMS — your home AND your teammate's home ring; both enemy homes stay silent
// ---------------------------------------------------------------------------

describe('alarm ownership — TEAMS opens the alarm to a teammate, never to a foe', () => {
  const world = createWorld({ seed: 7, players: twoVsTwo(), mapId: 'octagon' });

  it('your own home rings', () => {
    expect(rings(world, 0, 0)).toBe(true);
  });

  it("your TEAMMATE's home rings — same side, a siege you must hear (GDD §2.2)", () => {
    expect(teamOf(world, 0)).toBe(teamOf(world, 2));
    expect(rings(world, 0, 2)).toBe(true);
  });

  it('BOTH enemy homes stay silent — their battles are spatial audio, not your klaxon', () => {
    expect(rings(world, 0, 1)).toBe(false);
    expect(rings(world, 0, 3)).toBe(false);
  });

  it('the predicate is symmetric within a side and antisymmetric across it', () => {
    // The teammate hears my siege exactly as I hear theirs.
    expect(rings(world, 2, 0)).toBe(true);
    // …and neither of us hears either enemy.
    expect(rings(world, 2, 1)).toBe(false);
    expect(rings(world, 2, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Neutral / derelict — an unowned wreck is nobody's teammate, so it never rings
// ---------------------------------------------------------------------------

describe('alarm ownership — a neutral derelict never rings anyone', () => {
  it('a derelict-fill home is a team of its own — silent for every live player', () => {
    // compass at N=2 lays out derelict wrecks to keep its shape (Milestone B).
    const world = createWorld({
      seed: 11,
      players: configToPlayers(ffaConfig(2, ShipClass.Vanguard)),
      mapId: 'compass',
    });
    const derelicts = world.stations.filter((s) => s.derelict);
    expect(derelicts.length).toBeGreaterThan(0); // the map really did fill some

    for (const wreck of derelicts) {
      for (const local of [0, 1]) {
        expect(rings(world, local, wreck.owner), `local ${local} vs derelict ${wreck.owner}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Self-immunity & determinism — the same fact, every time
// ---------------------------------------------------------------------------

describe('alarm ownership — self is always your side, and the answer is deterministic', () => {
  it('a player is always on their own side (self-ring is unconditional)', () => {
    const world = createWorld({ seed: 1, players: twoVsTwo(), mapId: 'diamond' });
    for (const p of twoVsTwo()) expect(rings(world, p.id, p.id)).toBe(true);
  });

  it('sameSide is the exact complement of areEnemies for every ordered pair', () => {
    const world = createWorld({ seed: 2, players: twoVsTwo(), mapId: 'oval' });
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        expect(sameSide(world, a, b)).toBe(!areEnemies(world, a, b));
      }
    }
  });

  it('repeated calls on an unchanging world return an identical verdict (pure read)', () => {
    const world = createWorld({ seed: 3, players: twoVsTwo(), mapId: 'octagon' });
    const first = [rings(world, 0, 0), rings(world, 0, 2), rings(world, 0, 1)];
    for (let i = 0; i < 100; i++) {
      expect([rings(world, 0, 0), rings(world, 0, 2), rings(world, 0, 1)]).toEqual(first);
    }
    expect(first).toEqual([true, true, false]);
  });
});
