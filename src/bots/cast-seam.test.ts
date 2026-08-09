/**
 * src/bots/cast-seam.test.ts — **the seam the lobby's choice fell through.**
 * OWNER: Bot Engineer (a0-06; GDD §2.1 amended 2026-08-07, §2.9).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT MORE OF harness.test.ts
 * ---------------------------------------------------------------------------
 * The old model passed every gate in this directory while the setting did
 * nothing. `fillEmptySlots` was correct, `createBots` was correct, the lobby's
 * cast preview was correct, and each was tested. What nobody tested is that the
 * lobby's answer and the match's cast are **the same answer** — because nothing
 * connected them: `bootOfflineMatch` called `fillEmptySlots` with no cast at all
 * and `MatchBootConfig` had no field to carry one. So a host who set every enemy
 * to Hard met Rusty, Bolt, Foreman, Patch, Sable, Vulture and Warden, in seat
 * order, every time (*"i chose HARD for all enemies but they were at other
 * difficulties than i selected"*).
 *
 * These tests therefore pin the SEAM rather than the logic on either side of it:
 * a named cast goes in and exactly that cast comes out, in exactly those slots,
 * repeats included, twice, from the same seed. The live-stage half — the same
 * assertion made through the real booted client, which is the class that catches
 * "the selection never arrived" (LESSONS §1) — is
 * `tests/live-stage/lobby-cast.spec.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, type World } from '../sim';
import { MATCH_SLOTS, botLobby, createBots, fillEmptySlots, runHeadlessMatch } from './harness';
import { PERSONALITIES, ROSTER, castDisplayNames } from './personalities';
import type { PersonalityId } from './personalities';

/** A cast the way the lobby hands one over: indexed by slot, `null` where a
 *  person sits. */
const cast = (...ids: (PersonalityId | null)[]): (PersonalityId | null)[] => ids;

describe('the cast the lobby picked is the cast the match seats (a0-06)', () => {
  it('seats EXACTLY those personalities, in exactly those slots', () => {
    // The developer's own case: every enemy Hard. Three Hard characters exist, so
    // this is also a repeat case — which is the point (below).
    const chosen = cast(null, 'sable', 'vulture', 'warden', 'sable', 'vulture', 'warden', 'sable');
    const seats = fillEmptySlots([0], MATCH_SLOTS, ROSTER, undefined, chosen);

    expect(seats.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(seats.map((s) => s.personality)).toEqual(chosen.slice(1));
    // …and every one of them really is Hard, which is what the host asked for and
    // what the old model could not deliver.
    for (const seat of seats) {
      expect(PERSONALITIES[seat.personality].difficulty, `slot ${seat.id}`).toBe('hard');
    }
  });

  it('carries the cast all the way into the constructed bots and their hulls', () => {
    // A seat is not a bot. The old bug lived one call further down than the seat
    // list, so the assertion has to reach the thing that actually flies.
    const chosen = cast(null, 'warden', 'rusty', 'warden', 'bolt', 'patch', 'sable', 'warden');
    const seats = fillEmptySlots([0], MATCH_SLOTS, ROSTER, undefined, chosen);
    const bots = createBots(seats, { seed: 7 });

    expect(bots.map((b) => b.seat.personality)).toEqual(chosen.slice(1));
    // Each bot's tier is its CHARACTER's tier — the property that makes a second,
    // disagreeing difficulty setting unrepresentable rather than merely unlikely.
    for (const bot of bots) {
      expect(bot.difficulty, `slot ${bot.seat.id}`).toBe(PERSONALITIES[bot.seat.personality].difficulty);
    }
    // …and the hull it flies is its character's (GDD §2.11, style-guide §4): a
    // silhouette on the minimap is information, so the cast decides the shapes.
    const rows = botLobby(seats);
    for (const row of rows) {
      const seat = seats.find((s) => s.id === row.id)!;
      expect(row.shipClass).toBe(PERSONALITIES[seat.personality].shipClass);
    }
  });

  it('survives a duplicate round trip: two Wardens in, two Wardens out', () => {
    // Eight slots, seven characters, three of them Hard — a full house needs a
    // repeat and the developer's balanced 4v4 of Hard bots needs a fourth Hard
    // character that does not exist. Forbidding duplicates makes their own stated
    // use case impossible, so the table is honoured verbatim.
    const chosen = cast(null, 'warden', 'warden', 'foreman', 'foreman', 'foreman', 'rusty', 'bolt');
    const seats = fillEmptySlots([0], MATCH_SLOTS, ROSTER, undefined, chosen);

    expect(seats.filter((s) => s.personality === 'warden')).toHaveLength(2);
    expect(seats.filter((s) => s.personality === 'foreman')).toHaveLength(3);
    expect(seats.map((s) => s.personality)).toEqual(chosen.slice(1));

    // …and the repeats are told apart by NAME, numbered in slot order, while the
    // characters that do not repeat keep their bare names.
    const bySlot: (PersonalityId | null)[] = [];
    for (const seat of seats) bySlot[seat.id] = seat.personality;
    const names = castDisplayNames(bySlot);
    expect(names[1]).toBe('Warden 1');
    expect(names[2]).toBe('Warden 2');
    expect(names[3]).toBe('Foreman 1');
    expect(names[5]).toBe('Foreman 3');
    expect(names[6]).toBe('Rusty'); // not repeated — no numeral
    expect(names[0]).toBeNull(); // the human seat is the caller's to name
  });

  it('falls back to roster order for a slot the cast does not name', () => {
    // A short table, a `?debug=1` boot with no lobby, and the QA harness all take
    // this path — so every existing match is byte-identical to before a0-06.
    expect(fillEmptySlots().map((s) => s.personality)).toEqual([...ROSTER, ROSTER[0]]);
    expect(fillEmptySlots([], MATCH_SLOTS, ROSTER, undefined, []).map((s) => s.personality)).toEqual([
      ...ROSTER,
      ROSTER[0],
    ]);
    // A partial table names what it names and leaves the rest to roster order.
    const partial = fillEmptySlots([], MATCH_SLOTS, ROSTER, undefined, cast('warden', null));
    expect(partial[0]?.personality).toBe('warden');
    expect(partial[1]?.personality).toBe(ROSTER[1]);
  });

  it('ignores a personality id that is not one of the seven', () => {
    // A stale saved lobby or a hand-edited storage key must not construct a bot
    // with no personality row behind it — it falls back rather than crashing boot.
    const junk = ['nobody', null] as unknown as (PersonalityId | null)[];
    const seats = fillEmptySlots([], MATCH_SLOTS, ROSTER, undefined, junk);
    expect(seats[0]?.personality).toBe(ROSTER[0]);
    expect(PERSONALITIES[seats[0]!.personality]).toBeDefined();
  });

  it('ignores an inherited Object.prototype key, not just an unknown one', () => {
    // PERSONALITIES is an object literal, so `'constructor' in PERSONALITIES` is
    // TRUE — a membership test written with `in` would have seated these and then
    // read `.shipClass` off a function. Every one of them has to fall back.
    const inherited = [
      'constructor',
      'toString',
      'hasOwnProperty',
      '__proto__',
      'valueOf',
    ] as unknown as PersonalityId[];
    const seats = fillEmptySlots([], MATCH_SLOTS, ROSTER, undefined, inherited);
    for (const seat of seats.slice(0, inherited.length)) {
      expect(PERSONALITIES[seat.personality], `slot ${seat.id}`).toBeDefined();
      expect(ROSTER, `slot ${seat.id}`).toContain(seat.personality);
    }
    // And the fallback is plain roster order, exactly as an absent entry gives.
    expect(seats.map((s) => s.personality)).toEqual([...ROSTER, ROSTER[0]]);
  });

  it('is deterministic: same seed + same cast → the same match, twice', () => {
    // The one property a0-06 must not cost. The cast decides WHO flies; the seed
    // decides everything else, and neither may leak into the other.
    const chosen = cast(null, 'warden', 'warden', 'sable', 'vulture', 'bolt', 'patch', 'foreman');
    const run = (): World => {
      const seats = fillEmptySlots([0], MATCH_SLOTS, ROSTER, undefined, chosen);
      const world = createWorld({
        seed: 4242,
        players: [{ id: 0, shipClass: ShipClass.Vanguard }, ...botLobby(seats)].sort(
          (a, b) => a.id - b.id,
        ),
      });
      runHeadlessMatch(world, createBots(seats, { seed: 4242 }), { maxSeconds: 30 });
      return world;
    };

    const a = run();
    const b = run();
    expect(b.time).toBe(a.time);
    expect(b.ships.map((s) => `${s.id}:${s.pos.x}:${s.pos.y}:${s.hull}`)).toEqual(
      a.ships.map((s) => `${s.id}:${s.pos.x}:${s.pos.y}:${s.hull}`),
    );
    expect(b.stations.map((s) => `${s.owner}:${s.coreHp}`)).toEqual(
      a.stations.map((s) => `${s.owner}:${s.coreHp}`),
    );
  });

  it('a DIFFERENT cast on the same seed really does play differently', () => {
    // …so the determinism test above is not vacuous: if the cast were being
    // discarded (which is exactly the bug), these two runs would be identical.
    const timid = cast(null, 'rusty', 'rusty', 'rusty', 'rusty', 'rusty', 'rusty', 'rusty');
    const brutal = cast(null, 'warden', 'warden', 'warden', 'warden', 'warden', 'warden', 'warden');
    const run = (chosen: (PersonalityId | null)[]): World => {
      const seats = fillEmptySlots([0], MATCH_SLOTS, ROSTER, undefined, chosen);
      const world = createWorld({
        seed: 99,
        players: [{ id: 0, shipClass: ShipClass.Vanguard }, ...botLobby(seats)].sort(
          (a, b) => a.id - b.id,
        ),
      });
      runHeadlessMatch(world, createBots(seats, { seed: 99 }), { maxSeconds: 60 });
      return world;
    };
    const a = run(timid);
    const b = run(brutal);
    const shot = (w: World): string => w.ships.map((s) => `${s.pos.x}:${s.pos.y}`).join('|');
    expect(shot(b)).not.toBe(shot(a));
  });
});
