/**
 * src/platform/radio-seam.test.ts — **the evidence for b2-01: the bot radio is
 * not deaf offline.** OWNER: Platform Engineer (GDD §2.9, §4.8;
 * `docs/team-bots-plan.md` Stage 2).
 *
 * The team-bots radio (a0-10) shipped **Layer A only** in the offline match, and
 * the reason was one argument. `bootOfflineMatch` called
 *
 *     fillEmptySlots([local], slots, ROSTER, undefined, cast)
 *                                            ^^^^^^^^^
 *
 * and stamped the lobby's sides onto the *roster* afterwards — so the **world**
 * knew about teams (allies stopped shooting each other, homes spawned adjacent,
 * the ally klaxon rang) while the **seat table** did not. `createBots` builds one
 * channel per side by grouping seats on `BotSeat.team`, and every seat's `team`
 * was `undefined`; every side was therefore a side of one, `teamRadio` returned
 * `null` for each, and `send` became a no-op with nobody to hear it
 * (`src/bots/harness.ts`, `src/bots/radio.ts`).
 *
 * **Why that was invisible.** The whole shipped `defend-ally` branch reads
 * `AllyView.underAttack`, which `perceive` derives from the *world*, not from the
 * seat — so Layer A worked and the klaxon-and-defend behaviour a player could see
 * was correct. What silently did nothing was Layer B: `help` (a teammate jumped
 * in open space, which no klaxon carries) and `siege` never travelled. The
 * assault branch (b2-03) is 100% Layer B and would have shipped doing nothing.
 *
 * **The assertion is on the callout ARRIVING, not on the sender sending.** A test
 * that a bot called `send` would have passed on the broken build, because `send`
 * on a `null` radio returns quietly. So the first test below runs a real Teams
 * match through the same {@link bootOfflineMatch} `main.ts` boots through, waits
 * for a bot to get into enough trouble to shout, and asserts a *teammate* can
 * read it out of its own `brain.radio` on its own freshness clock. Before the fix
 * that assertion fails — the loop runs the full match and finds nothing.
 *
 * The rest of the file pins what must not move: FFA still gets no channel at all
 * (structurally, not by a flag), the sides the world builds are still the sides
 * the lobby asked for, a0-06's chosen cast still travels the same call, and the
 * match is still deterministic (GDD §4.8).
 */
import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { bootOfflineMatch } from './match-boot';
import type { MatchBoot, MatchBootConfig } from './match-boot';
import { FireMode, createControlState, mapActions } from './actions';
import type { Callout } from '../bots';
import { PERSONALITIES, heard, receive, tuningFor } from '../bots';
import { teamOf } from '../sim';
import { hashState } from '../../harness/hash';

const LOCAL = 0;

/** A 4v4 in the dense slot order `createWorld` builds its roster in: the local
 *  player and bots 1–3 on side 0, bots 4–7 on side 1 (GDD §2.1). */
const SIDES = [0, 0, 0, 0, 1, 1, 1, 1];

/**
 * The seed is part of the evidence, not a detail: the match below is
 * deterministic, so "a bot shouts at tick 1426" is a fact about seed 7 and this
 * cast, reproducible on any machine.
 */
const SEED = 7;

/** Long enough for a 4v4 to start hurting — the first `help` lands well inside
 *  it. Generous rather than tight, so an unrelated balance tune moves the tick
 *  this fires on without turning the evidence red. */
const MATCH_TICKS = 3000;

function boot(config: Partial<MatchBootConfig> = {}): MatchBoot {
  return bootOfflineMatch({
    seed: SEED,
    localPlayer: LOCAL,
    shipClass: ShipClass.Vanguard,
    ...config,
  });
}

/** The neutral action stream a player who is touching nothing produces. The
 *  human stands still on purpose: every callout below is the bots' own doing. */
function idle(): Action[] {
  return mapActions(createControlState(), FireMode.Manual);
}

/** One received callout, with the slot that read it out of its own radio. */
interface Received {
  readonly by: PlayerId;
  readonly call: Callout;
}

/**
 * Run the match, stopping at the first callout of `kind` that a bot can actually
 * read — polled every tick on the receiver's **own** `memorySeconds`, exactly as
 * `allyCalls` does inside the tree, so this asks the question the behaviour asks.
 */
function firstReceived(match: MatchBoot, kind: Callout['kind'], ticks = MATCH_TICKS): Received | null {
  for (let t = 0; t < ticks; t++) {
    match.tick(idle());
    for (const bot of match.bots) {
      const fresh = tuningFor(bot.seat.personality).memorySeconds;
      for (const call of receive(bot.brain.radio, bot.seat.id, match.world.time, fresh)) {
        if (call.kind === kind) return { by: bot.seat.id, call };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The evidence
// ---------------------------------------------------------------------------

describe('the bot radio is wired to the offline match (b2-01)', () => {
  it('a bot calls for HELP in a Teams match, and a teammate RECEIVES it', () => {
    const match = boot({ teams: SIDES });

    const got = firstReceived(match, 'help');

    // The whole brief in four lines. On the broken build `got` is `null`: not
    // because no bot ever retreats, but because its radio was `null` and there
    // was nothing to receive from.
    expect(got).not.toBeNull();
    const { by, call } = got!;
    expect(call.kind).toBe('help');
    // A bot never hears itself, and it only hears its own side.
    expect(call.from).not.toBe(by);
    expect(teamOf(match.world, call.from)).toBe(teamOf(match.world, by));
    // Delivery, not just presence in the ring: the miss roll went this bot's way.
    expect(heard(call, by)).toBe(true);
    // And it was readable when it was read — the latency rule holds end to end.
    expect(call.readableAt).toBeLessThanOrEqual(match.world.time);
    expect(call.readableAt).toBeGreaterThan(call.seenAt);
  });

  it('SIEGE travels too — the channel, not one lucky call', () => {
    const got = firstReceived(boot({ teams: SIDES }), 'siege');

    expect(got).not.toBeNull();
    expect(got!.call.kind).toBe('siege');
    expect(got!.call.from).not.toBe(got!.by);
  });

  it('allies share ONE channel, and the two sides never share one', () => {
    const match = boot({ teams: SIDES });
    const radioOf = (id: PlayerId) => match.bots.find((b) => b.seat.id === id)!.brain.radio;

    // Side 0's bots (the human holds slot 0, and humans do not carry a radio).
    expect(radioOf(1)).not.toBeNull();
    expect(radioOf(2)).toBe(radioOf(1));
    expect(radioOf(3)).toBe(radioOf(1));
    // Side 1's.
    expect(radioOf(4)).not.toBeNull();
    expect(radioOf(7)).toBe(radioOf(4));
    // Two sides, two rings. A shared one would be the omniscience the plan bans.
    expect(radioOf(4)).not.toBe(radioOf(1));

    // The recipient sets are the bot seats of each side, ascending — the human's
    // slot is not a member, because a human does not listen to the bot channel.
    expect(radioOf(1)!.members).toEqual([1, 2, 3]);
    expect(radioOf(4)!.members).toEqual([4, 5, 6, 7]);
  });
});

// ---------------------------------------------------------------------------
// What must not change
// ---------------------------------------------------------------------------

describe('the seam carries teams without moving anything else', () => {
  it('FFA still gets no channel at all — no table, no side, no radio', () => {
    const match = boot();

    for (const bot of match.bots) {
      // No `team` key on the seat (not `team: undefined` — `createWorld`
      // distinguishes the two, and only the absence is teams-of-one).
      expect('team' in bot.seat).toBe(false);
      expect(bot.brain.radio).toBeNull();
      // Teams-of-one in the world, exactly as before: everyone is their own side.
      expect(teamOf(match.world, bot.seat.id)).toBe(bot.seat.id);
    }
  });

  it('a seat the table does not name stays in FFA rather than crashing the boot', () => {
    // A short table — three named seats and five unnamed. The unnamed ones fall
    // back to teams-of-one, so a stale lobby can only under-team a match.
    const match = boot({ teams: [0, 0, 1] });
    const radioOf = (id: PlayerId) => match.bots.find((b) => b.seat.id === id)!.brain.radio;

    // Slot 0 is the human, so side 0 has exactly one bot — a side of one, which
    // gets `null` by the same rule that makes FFA quiet.
    expect(radioOf(1)).toBeNull();
    expect(radioOf(2)).toBeNull();
    for (let id = 3; id < 8; id++) {
      expect('team' in match.bots.find((b) => b.seat.id === id)!.seat).toBe(false);
      expect(teamOf(match.world, id)).toBe(id);
    }
  });

  it('the sides the world builds are still the sides the lobby asked for', () => {
    const match = boot({ teams: SIDES });

    // The roster stamping this fix did NOT remove still agrees with the seats it
    // now also feeds — including the local player, whose side only ever came
    // from that loop.
    for (let id = 0; id < 8; id++) expect(teamOf(match.world, id)).toBe(SIDES[id]);
    for (const bot of match.bots) expect(bot.seat.team).toBe(SIDES[bot.seat.id]);
  });

  it("a0-06's chosen cast still travels the same call, sides and all", () => {
    const chosen = ['warden', 'sable', 'vulture', 'warden', 'bolt', 'patch', 'rusty'] as const;
    const match = boot({ teams: SIDES, cast: [undefined, ...chosen] });

    // The cast is honoured verbatim — repeats included (two Wardens in, two
    // Wardens out) — and each seat still flies its character's hull.
    for (const bot of match.bots) {
      const want = chosen[bot.seat.id - 1]!;
      expect(bot.seat.personality).toBe(want);
      expect(bot.seat.team).toBe(SIDES[bot.seat.id]);
    }
    const ship = (id: PlayerId) => match.world.ships.find((s) => s.id === id)!;
    for (const bot of match.bots) {
      expect(ship(bot.seat.id).shipClass).toBe(PERSONALITIES[bot.seat.personality].shipClass);
    }
  });

  it('is still deterministic: same seed, same cast, same sides, same match (GDD §4.8)', () => {
    const cast = ['warden', 'sable', 'vulture', 'warden', 'bolt', 'patch', 'rusty'] as const;
    const config = { teams: SIDES, cast: [undefined, ...cast] };

    const a = boot(config);
    const b = boot(config);
    for (let t = 0; t < 900; t++) {
      a.tick(idle());
      b.tick(idle());
    }

    // The radio is the one piece of bot state that is shared, and shared state is
    // where a desync would live. It lives outside `World` (plan Trap 5), and the
    // seeded miss roll makes *who missed the call* a function of the seed — so a
    // teams match hashes the same twice, radios and all.
    expect(hashState(b.world)).toBe(hashState(a.world));
    for (const bot of a.bots) {
      const other = b.bots.find((x) => x.seat.id === bot.seat.id)!;
      expect(other.brain.radio?.calls.length ?? null).toBe(bot.brain.radio?.calls.length ?? null);
      expect(other.brain.radio?.seq ?? null).toBe(bot.brain.radio?.seq ?? null);
    }
  });
});
