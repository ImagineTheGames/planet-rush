/**
 * src/bots/team-radio.test.ts — **the channel, and the rule that keeps it
 * deterministic.** OWNER: Bot Engineer (`docs/team-bots-plan.md` Stage 2,
 * Tasks 2.2, 2.3 and 2.4).
 *
 * `./radio` is the plan's Layer B: allied bots exchange observations they
 * legitimately made, over a channel with a latency, a miss rate, a cooldown and
 * a fixed capacity, because *instant perfect sharing is superhuman* (§2.3). Two
 * separate things need proving about it, and they fail in different ways:
 *
 *  1. **It behaves like a radio.** Nothing arrives early, capacity evicts the
 *     oldest, a shuffled ring reads in the same total order as a tidy one, and a
 *     team of one has no channel at all.
 *  2. **It cannot reach across a tick.** This is the determinism half and it is
 *     the one that would be expensive to find later. `botInputs` iterates the bot
 *     array in order and the match server drives bots one at a time (`./harness`),
 *     so a call readable in the tick it was sent would be seen by a
 *     higher-numbered slot and missed by a lower-numbered one — behaviour coupled
 *     to seat order, and a different match on the server than in the client.
 *
 * The guard for (2) has two halves, deliberately. `every tier's callLatency is at
 * least one tick` is the **cheap** one: it fails the instant somebody lowers a
 * number to make an "instant Hard" feel snappier, which is precisely the change
 * the plan predicts (Trap 4). `the same match, with the bot array reversed,
 * produces the same world hash` is the **expensive** one: it fails if the
 * ordering rule is broken in some way nobody anticipated. Neither replaces the
 * other.
 */

import { describe, it, expect } from 'vitest';
import { mulberry32, type Rng } from '@shared/types';
import { TICK_DT, createWorld } from '../sim';
import { hashState } from '../../harness/hash';
import { createBots, botLobby, fillEmptySlots, runHeadlessMatch } from './harness';
import {
  HEARSAY_STALENESS,
  RADIO_CAPACITY,
  RADIO_MAX_SLOT,
  calloutAge,
  heard,
  receive,
  send,
  teamRadio,
  type CalloutDraft,
  type TeamRadio,
} from './radio';
import { DIFFICULTY_TUNING, Difficulty, ROSTER } from './personalities';

/** Everybody hears everything, so a delivery case turns on the clock alone. */
const ALWAYS: Rng = { next: () => 1 };
/** Nobody hears anything: `missChance` 0.35 against a draw of 0 is a miss. */
const NEVER: Rng = { next: () => 0 };

/** A `siege` call from `from` at `seenAt`, with a position that identifies it. */
function draft(from: number, seenAt: number): CalloutDraft {
  return { kind: 'siege', from, about: from, pos: { x: seenAt, y: from }, seenAt };
}

/** A three-slot side, which is enough for "not the sender" to be plural. */
function side(): TeamRadio {
  return teamRadio([0, 2, 5])!;
}

// ---------------------------------------------------------------------------
// Task 2.2 — the radio, empty
// ---------------------------------------------------------------------------

describe('the team radio delivers late, in order, and only to a team (Task 2.2)', () => {
  it('is not readable before the latency has passed, and is after', () => {
    const radio = side();
    send(radio, draft(0, 0), 0.5, 0, ALWAYS);

    expect(receive(radio, 2, 0, 99)).toHaveLength(0);
    expect(receive(radio, 2, 0.4, 99)).toHaveLength(0);
    expect(receive(radio, 2, 0.5, 99)).toHaveLength(1);
    expect(receive(radio, 2, 0.6, 99)).toHaveLength(1);
  });

  it('never delivers to the sender — a bot does not hear itself', () => {
    const radio = side();
    send(radio, draft(0, 0), 0.5, 0, ALWAYS);
    expect(receive(radio, 0, 10, 99)).toHaveLength(0);
    expect(receive(radio, 2, 10, 99)).toHaveLength(1);
    expect(receive(radio, 5, 10, 99)).toHaveLength(1);
  });

  it('stamps seenAt from the SENDER and never from the receipt', () => {
    // Trap 3: get this backwards and a stale rumour becomes fresh intelligence
    // every time it is repeated — the team's picture of the map improves the
    // more it is passed around, which is omniscience with extra steps.
    const radio = side();
    const call = send(radio, draft(0, 12), 0.5, 0, ALWAYS)!;
    expect(call.seenAt).toBe(12);
    expect(call.readableAt).toBe(12.5);
    expect(receive(radio, 2, 40, 99)[0]!.seenAt).toBe(12);
  });

  it('ages hearsay twice as fast as first-hand news, and expires it', () => {
    const radio = side();
    send(radio, draft(0, 0), 0.5, 0, ALWAYS);
    const call = receive(radio, 2, 1, 99)[0]!;
    expect(calloutAge(call, 6)).toBe(6 * HEARSAY_STALENESS);

    // A twelve-second memory therefore drops a six-second-old call, which is
    // what stops the channel becoming a shared omniscient map (§2.2).
    expect(receive(radio, 2, 5.9, 12)).toHaveLength(1);
    expect(receive(radio, 2, 6.1, 12)).toHaveLength(0);
  });

  it('evicts the oldest when the ring is full, and never grows', () => {
    const radio = side();
    for (let i = 0; i < RADIO_CAPACITY + 4; i++) send(radio, draft(0, i), 0.5, 0, ALWAYS);
    expect(radio.calls).toHaveLength(RADIO_CAPACITY);

    const seen = receive(radio, 2, 1000, 1e9).map((c) => c.seenAt);
    expect(seen).toHaveLength(RADIO_CAPACITY);
    // The four eldest are gone; the survivors are the newest RADIO_CAPACITY.
    expect(seen[0]).toBe(4);
    expect(seen[seen.length - 1]).toBe(RADIO_CAPACITY + 3);
  });

  it('reads in (readableAt, from, seq) order however it was filled', () => {
    const radio = side();
    // Deliberately shuffled: a late-latency call sent FIRST must read LAST, and
    // two calls that land in the same instant fall back to sender, then sequence.
    send(radio, draft(5, 0), 9, 0, ALWAYS); // readable at 9
    send(radio, draft(5, 1), 1, 0, ALWAYS); // readable at 2, from 5
    send(radio, draft(0, 1), 1, 0, ALWAYS); // readable at 2, from 0
    send(radio, draft(0, 0), 1, 0, ALWAYS); // readable at 1

    const got = receive(radio, 2, 100, 1e9).map((c) => [c.readableAt, c.from]);
    expect(got).toEqual([
      [1, 0],
      [2, 0],
      [2, 5],
      [9, 5],
    ]);
  });

  it('gives a side of one no channel at all — which is every FFA bot (§2.5)', () => {
    expect(teamRadio([3])).toBeNull();
    expect(teamRadio([])).toBeNull();
    // …and the null propagates as a no-op rather than a crash, which is what
    // lets a tree be written with no mode flag in it anywhere.
    expect(send(null, draft(0, 0), 0.5, 0, ALWAYS)).toBeNull();
    expect(receive(null, 0, 10, 99)).toEqual([]);
  });

  it('refuses a roster it cannot address rather than dropping half of it', () => {
    expect(teamRadio([0, RADIO_MAX_SLOT])).not.toBeNull();
    expect(teamRadio([0, RADIO_MAX_SLOT + 1])).toBeNull();
    expect(teamRadio([-1, 0])).toBeNull();
  });

  it('sorts its member list, so the per-recipient roll order is its own', () => {
    // The miss roll walks `members` in order and consumes one draw each, so the
    // order has to be a property of this function rather than of the caller —
    // otherwise who missed a call would depend on how a lineup was typed.
    expect(teamRadio([5, 0, 2])!.members).toEqual([0, 2, 5]);
  });

  it('files nothing when nobody heard, but still spends the draws', () => {
    const radio = side();
    let draws = 0;
    const rng: Rng = {
      next: () => {
        draws++;
        return 0;
      },
    };
    expect(send(radio, draft(0, 0), 0.5, 1, rng)).toBeNull();
    expect(radio.calls).toHaveLength(0);
    // Two recipients, two draws — the sender is skipped. Skipping the draws for
    // an unheard call would shift every later number this bot pulls, and its aim
    // and its escape headings come off the same stream.
    expect(draws).toBe(2);
  });

  it('marks exactly who heard it, per recipient, from the sender stream', () => {
    const radio = teamRadio([0, 1, 2])!;
    // Slot 1 draws first and misses (0.1 < 0.5); slot 2 draws second and hears.
    const draws = [0.1, 0.9];
    let at = 0;
    const rng: Rng = { next: () => draws[at++]! };
    const call = send(radio, draft(0, 0), 0.5, 0.5, rng)!;
    expect(heard(call, 1)).toBe(false);
    expect(heard(call, 2)).toBe(true);
    expect(receive(radio, 1, 10, 99)).toHaveLength(0);
    expect(receive(radio, 2, 10, 99)).toHaveLength(1);
  });

  it('copies the position rather than aliasing the caller\'s vector', () => {
    const radio = side();
    const pos = { x: 10, y: 20 };
    const call = send(radio, { kind: 'help', from: 0, about: 0, pos, seenAt: 0 }, 0.5, 0, ALWAYS)!;
    pos.x = 999;
    expect(call.pos).toEqual({ x: 10, y: 20 });
  });

  it('is quiet when nobody heard anything, allocating nothing', () => {
    const radio = side();
    send(radio, draft(0, 0), 0.5, 0.35, NEVER);
    // Same shared empty array both times: a quiet channel costs no allocation.
    expect(receive(radio, 2, 10, 99)).toBe(receive(radio, 5, 10, 99));
  });
});

// ---------------------------------------------------------------------------
// Task 2.4 — tier dials for the channel
// ---------------------------------------------------------------------------

describe('cooperation quality is a difficulty dial (Task 2.4)', () => {
  const EASY = DIFFICULTY_TUNING[Difficulty.Easy];
  const MEDIUM = DIFFICULTY_TUNING[Difficulty.Medium];
  const HARD = DIFFICULTY_TUNING[Difficulty.Hard];

  it('runs Easy ≥ Medium ≥ Hard on latency, miss and cooldown', () => {
    // An Easy team misses calls and arrives late out of the *same* model that
    // makes an Easy bot shoot late. There is no separate "be bad at teamwork"
    // knob anywhere, which is the whole discipline of §4.5.
    expect(EASY.callLatency).toBeGreaterThan(MEDIUM.callLatency);
    expect(MEDIUM.callLatency).toBeGreaterThan(HARD.callLatency);
    expect(EASY.callMissChance).toBeGreaterThan(MEDIUM.callMissChance);
    expect(MEDIUM.callMissChance).toBeGreaterThan(HARD.callMissChance);
    expect(EASY.callCooldown).toBeGreaterThan(MEDIUM.callCooldown);
    expect(MEDIUM.callCooldown).toBeGreaterThan(HARD.callCooldown);
  });

  it('keeps EVERY tier a call above one tick — the determinism floor (Trap 4)', () => {
    // This is the assertion that fails when somebody lowers a number to make an
    // instant Hard feel snappier. Below one tick, a call sent at tick T is
    // readable at tick T, and a decision depends on where a bot sits in the
    // harness's loop (`./harness` `botInputs`) — which the match server orders
    // differently. It is not a tuning choice; it is GDD §4.8.
    for (const tuning of [EASY, MEDIUM, HARD]) {
      expect(tuning.callLatency).toBeGreaterThanOrEqual(TICK_DT);
      expect(tuning.callMissChance).toBeGreaterThanOrEqual(0);
      expect(tuning.callMissChance).toBeLessThan(1);
      expect(tuning.callCooldown).toBeGreaterThan(0);
    }
  });

  it('draws the miss roll from the SENDER, so two seeds miss differently', () => {
    // Same call, same tier, two senders with different streams: who heard it is
    // a pure function of the seed and never of the clock (§2.4 rule 2).
    const heardBy = (seed: number): number[] => {
      const radio = teamRadio([0, 1, 2, 3, 4, 5, 6, 7])!;
      send(radio, draft(0, 0), HARD.callLatency, EASY.callMissChance, mulberry32(seed));
      return [1, 2, 3, 4, 5, 6, 7].filter((id) => receive(radio, id, 10, 99).length > 0);
    };
    const a = heardBy(11);
    const b = heardBy(9001);
    expect(a).not.toEqual(b);
    // …and it is reproducible, which is the half that actually matters.
    expect(heardBy(11)).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// Task 2.3 — the radio is deterministic under reordering
// ---------------------------------------------------------------------------

/**
 * A 2v2 of the shipped cast, run to `seconds` with the bot array in the given
 * order, hashed with the QA harness's whole-world digest (`harness/hash.ts` —
 * the same one `tests/determinism.test.ts` runs on, which covers every ship
 * field, every station, every projectile and the match clock).
 */
function hashTeamMatch(
  seed: number,
  seconds: number,
  roster: readonly (typeof ROSTER)[number][],
  reversed: boolean,
): { hash: string; ticks: number; winner: number | null } {
  const seats = fillEmptySlots([], 4, roster, [0, 0, 1, 1]);
  const world = createWorld({ seed, players: botLobby(seats) });
  const bots = createBots(seats, { seed });
  const result = runHeadlessMatch(world, reversed ? [...bots].reverse() : bots, {
    maxSeconds: seconds,
  });
  return { hash: hashState(world), ticks: result.ticks, winner: result.winner };
}

describe('bot iteration order cannot reach a decision (Task 2.3)', () => {
  it('produces the identical match with the bots array REVERSED', () => {
    // The direct statement of the latency floor: if any call were readable in
    // the tick it was sent, the slot that decided *after* the sender would act
    // on it and the slot that decided *before* would not — so reversing the
    // array would change the match. It does not.
    const cast = [ROSTER[0]!, ROSTER[4]!, ROSTER[3]!, ROSTER[6]!];
    const forward = hashTeamMatch(4242, 300, cast, false);
    const backward = hashTeamMatch(4242, 300, cast, true);
    expect(backward.hash).toBe(forward.hash);
    expect(backward.ticks).toBe(forward.ticks);
    expect(backward.winner).toBe(forward.winner);
  });

  it('holds with mixed reaction cadences on one side', () => {
    // Rusty decides 6× a second and Sable 20×, on the same team, so the two
    // interleave differently under reversal — the cadence interaction the plan
    // asks for by name.
    const mixed = [ROSTER[0]!, ROSTER[4]!, ROSTER[1]!, ROSTER[5]!];
    const forward = hashTeamMatch(7, 300, mixed, false);
    const backward = hashTeamMatch(7, 300, mixed, true);
    expect(backward.hash).toBe(forward.hash);
    expect(backward.ticks).toBe(forward.ticks);
  });

  it('replays a team match identically twice — same seed, same cast', () => {
    // The plain determinism claim, in the presence of a radio: the channel lives
    // outside `World` (Trap 5), draws only from seeded streams, and reads no
    // wall clock, so a rerun is byte-identical.
    const cast = [ROSTER[3]!, ROSTER[6]!, ROSTER[2]!, ROSTER[5]!];
    const once = hashTeamMatch(20260809, 420, cast, false);
    const twice = hashTeamMatch(20260809, 420, cast, false);
    expect(twice).toEqual(once);
  });
});
