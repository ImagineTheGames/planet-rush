/**
 * tests/net/offline-teams-boot.test.ts — the developer's report, reproduced and
 * closed offline. OWNER: Netcode Engineer (GDD §2.1, §4.2; variable-slots Task C4).
 *
 * *"I played in teams mode but everyone attacked me and I could attack everyone."*
 * Tested offline — so the first job was not to wire anything, it was to find out
 * whether the offline path had ever carried a side at all.
 *
 * It had not. The chain a TEAMS match runs on is
 *
 *   lobby (mode + per-seat team) → MatchConfig → dense roster → LocalLoopback
 *     → matchStart → createWorld → `ship.team` → areEnemies
 *
 * and the third link was missing: `bootOfflineMatch` built its roster from the bot
 * seating alone, so mode and team never left the lobby and every ship defaulted to
 * its own side — which is precisely free-for-all. Every symptom in the report
 * follows from that one dropped table, which is why nothing in `src/sim` was wrong.
 *
 * So this file walks the whole chain through the CURRENT unified lobby: it drives
 * the real lobby model (the same functions a tap drives), hands its authored sides
 * to the real offline boot, and asks the world what it thinks. The first test is
 * the regression itself; the rest are the guarantees that only exist once it holds.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  createLobby,
  cycleSeatState,
  cycleSeatTeam,
  lobbyRosterTeams,
  lobbyWireTeams,
  toggleMode,
} from '../../src/ui';
import type { LobbyState } from '../../src/ui';
import { bootOfflineMatch } from '../../src/platform/match-boot';
import { areEnemies, canDamage, sameSide } from '../../src/sim';

const LOCAL = 0;

/** A fresh solo lobby of `size` seats — PLAY SOLO's flavour, where the local
 *  player is seat 0 and the rest are the bot cast (`online: false`). */
function soloLobby(size: number): LobbyState {
  return createLobby({
    room: 'LOCAL',
    you: LOCAL,
    host: LOCAL,
    shipClass: ShipClass.Vanguard,
    size,
    online: false,
  });
}

/** Put the lobby in TEAMS and give it the split `sides` names, seat by seat —
 *  through `cycleSeatTeam`, the model function the host's tap on a team chip
 *  runs, so the authored state is one a player could actually have produced. */
function authorSplit(state: LobbyState, sides: readonly number[]): LobbyState {
  let next = toggleMode(state);
  expect(next.mode).toBe('teams');
  for (let player = 0; player < sides.length; player++) {
    // The chip cycles A → B → C → D → A, so "set to side S" is however many taps
    // it takes to arrive there from wherever the default put this seat.
    for (let guard = 0; guard < 8 && next.seats[player]!.team !== sides[player]; guard++) {
      next = cycleSeatTeam(next, player);
    }
    expect(next.seats[player]!.team).toBe(sides[player]);
  }
  return next;
}

/** Boot the offline match the way `main.ts` does at RUSH!: the hull, the size,
 *  and the sides the lobby authored, in the dense order the world builds in. */
function boot(state: LobbyState, size: number) {
  return bootOfflineMatch({
    seed: 11,
    localPlayer: LOCAL,
    shipClass: ShipClass.Vanguard,
    slots: size,
    teams: lobbyRosterTeams(state),
  });
}

// ---------------------------------------------------------------------------
// The regression itself
// ---------------------------------------------------------------------------

describe('the offline report: a TEAMS lobby must not build a free-for-all', () => {
  it('carries a 2v2 from the lobby into the booted world', () => {
    const lobby = authorSplit(soloLobby(4), [0, 1, 0, 1]);
    const match = boot(lobby, 4);

    // Before the fix this read [0,1,2,3] — teams-of-one, the world's default for a
    // roster with no side on it, and every symptom in the report follows from it.
    expect(match.world.ships.map((s) => s.team)).toEqual([0, 1, 0, 1]);
  });

  it('makes a teammate un-attackable and an opponent attackable, in that world', () => {
    const match = boot(authorSplit(soloLobby(4), [0, 1, 0, 1]), 4);
    const world = match.world;

    // "Everyone attacked me and I could attack everyone" — both halves, answered
    // through the one predicate the whole sim asks (`src/sim/allegiance`).
    expect(sameSide(world, 0, 2)).toBe(true);
    expect(areEnemies(world, 0, 2)).toBe(false);
    expect(canDamage(world, 0, 2)).toBe(false);
    expect(canDamage(world, 2, 0)).toBe(false); // and symmetrically, back at me

    expect(areEnemies(world, 0, 1)).toBe(true);
    expect(canDamage(world, 0, 1)).toBe(true);
  });

  it('seats the same side on neighbouring homes', () => {
    const match = boot(authorSplit(soloLobby(4), [0, 1, 0, 1]), 4);
    const home = (owner: number): { x: number; y: number } =>
      match.world.stations.find((s) => s.owner === owner)!.pos;
    const gap = (a: number, b: number): number =>
      Math.hypot(home(a).x - home(b).x, home(a).y - home(b).y);

    // "We should also spawn close together if we are teams." No enemy home is
    // nearer than your teammate's, and the widest gap on the board is between
    // sides — a side holds one arc of the ring.
    const allies = [gap(0, 2), gap(1, 3)];
    const enemies = [gap(0, 1), gap(0, 3), gap(2, 1), gap(2, 3)];
    expect(Math.max(...allies)).toBeLessThanOrEqual(Math.min(...enemies));
    expect(Math.max(...enemies)).toBeGreaterThan(Math.max(...allies));
  });
});

// ---------------------------------------------------------------------------
// The shapes that must keep working around it
// ---------------------------------------------------------------------------

describe('the sides survive the shapes a lobby can actually be in', () => {
  it('leaves FFA byte-identical — teams-of-one is the world\'s own default', () => {
    const lobby = soloLobby(6);
    expect(lobby.mode).toBe('ffa');
    expect(lobbyRosterTeams(lobby)).toEqual([0, 1, 2, 3, 4, 5]);

    const withTable = boot(lobby, 6);
    const withoutTable = bootOfflineMatch({
      seed: 11,
      localPlayer: LOCAL,
      shipClass: ShipClass.Vanguard,
      slots: 6,
    });
    // The FFA table IS the default, so passing it changes nothing — which is the
    // property that lets this ride every match rather than a teams-only branch.
    expect(withTable.world.ships.map((s) => s.team)).toEqual(
      withoutTable.world.ships.map((s) => s.team),
    );
    expect(areEnemies(withTable.world, 0, 1)).toBe(true);
  });

  it('re-indexes around a CLOSED seat instead of handing the sim a sparse id', () => {
    // Close seat 1 of five, then put 0+2 on one side and 3+4 on the other. The
    // world never sees the lobby's ids: closed slots are dropped and the four
    // survivors become players 0..3 (spike Trap 6). A table built in lobby order
    // would put the wrong side on every seat after the hole.
    let lobby = soloLobby(5);
    lobby = authorSplit(lobby, [0, 0, 0, 1, 1]);
    // The solo lobby opens on the bot cast (a0-11 — offline there is no wire for
    // a joiner, so an OPEN seat would be a chair nobody could ever take), so one
    // step round the ring shuts it.
    lobby = cycleSeatState(lobby, 1); // bot → closed
    expect(lobby.seats[1]!.occupant).toBe('closed');

    // Lobby slots 0,2 on side A and 3,4 on side B ⇒ dense players 0,1 and 2,3.
    expect(lobbyRosterTeams(lobby)).toEqual([0, 0, 1, 1]);

    const world = boot(lobby, 4).world;
    expect(world.ships).toHaveLength(4);
    expect(sameSide(world, 0, 1)).toBe(true);
    expect(sameSide(world, 2, 3)).toBe(true);
    expect(areEnemies(world, 1, 2)).toBe(true);
  });

  it('spells the same split two ways, on purpose', () => {
    // ONE tap shuts seat 1 — the solo lobby opens on the bot cast, and BOT → CLOSED
    // is one step round its ring. This used to tap twice and still pass, because
    // the second tap landed on the old solo OPEN rung and an open seat was dropped
    // from the world exactly as a closed one is. Solo has no OPEN rung since a0-31
    // ("no one can join in solo"), so the second tap now seats the bot again and
    // the fixture would no longer be the closed one this test is named for.
    const closed = cycleSeatState(authorSplit(soloLobby(5), [0, 0, 0, 1, 1]), 1);
    expect(closed.seats[1]!.occupant).toBe('closed');

    // The wire is indexed by PHYSICAL slot (the server's seats are slots, closed
    // ones included); the world is indexed DENSELY. Two functions because the two
    // ends genuinely count differently — and one of them pretending otherwise is
    // how a sparse lobby id ends up inside the sim.
    expect(lobbyWireTeams(closed)).toHaveLength(8);
    expect(lobbyRosterTeams(closed)).toEqual([0, 0, 1, 1]);
  });

  it('holds an uneven split — a 3v1 handicap is allowed, never blocked', () => {
    // GDD §2.1: "team sizes may be uneven … the lobby shows the split, never
    // blocks it."
    const world = boot(authorSplit(soloLobby(4), [0, 0, 0, 1]), 4).world;
    expect(world.ships.map((s) => s.team)).toEqual([0, 0, 0, 1]);
    expect(sameSide(world, 0, 1)).toBe(true);
    expect(sameSide(world, 1, 2)).toBe(true);
    expect(areEnemies(world, 2, 3)).toBe(true);
  });

  it('keeps every bot flying its own character\'s hull across the split', () => {
    // The sides table stamps `team` and nothing else. A roster rebuilt wholesale
    // from the lobby config would hand every bot the lobby's hull and quietly
    // erase the cast's silhouettes (style-guide §4 — a silhouette is information).
    const size = 6;
    const plain = bootOfflineMatch({ seed: 11, localPlayer: LOCAL, shipClass: ShipClass.Vanguard, slots: size });
    const teamed = boot(authorSplit(soloLobby(size), [0, 1, 0, 1, 0, 1]), size);

    expect(teamed.world.ships.map((s) => s.shipClass)).toEqual(
      plain.world.ships.map((s) => s.shipClass),
    );
    expect(teamed.bots.map((b) => b.seat.personality)).toEqual(
      plain.bots.map((b) => b.seat.personality),
    );
  });
});
