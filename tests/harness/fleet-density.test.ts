/**
 * tests/harness/fleet-density.test.ts — how many matches fit in one Machine,
 * MEASURED. OWNER: Netcode Engineer (docs/netcode-spike.md, hosting Task 12;
 * GDD §4.2, risk 1).
 *
 * `DEFAULT_MAX_ROOMS` used to cite the day-0 spike's *stand-in* estimate: a
 * synthetic per-room cost, before the real sim, before server-side bot AI, before
 * a room ever ran eight behaviour trees at once. This file replaces the estimate
 * with a result. It stands up {@link DEFAULT_MAX_ROOMS} real {@link MatchRoom}s
 * in one process — the exact object `server/index.ts` hosts — **each filled with
 * eight Hard bots**, and measures what one 60 Hz tick of the whole fleet costs.
 *
 * **Why eight Hard bots is the worst case, not a convenience.** A bot runs its AI
 * *on the server*, every tick, through the same `Action` channel a human's input
 * would arrive on (`server/room.ts`). A human seat is *cheaper*: it costs one
 * dequeued input and one `socket.send`, not a behaviour tree. So a room with eight
 * humans is lighter than a room with eight bots, and a room with eight **Hard**
 * bots — the deepest trees (`src/bots/personalities.ts`) — is the heaviest room
 * the server can hold. A ceiling proven against it holds for every real mix.
 *
 * **What it does NOT measure, stated so the number is not over-read.** These are
 * bot-only rooms with no live sockets, so the per-client snapshot `send` fan-out
 * is absent — but that is deliberate and conservative: fan-out is a buffer copy
 * per socket against a behaviour tree per bot, and swapping a bot for a human
 * trades the expensive side for the cheap one. The snapshot *encode* (the costly
 * half — `encodeWorldSnapshot`) still runs every room every broadcast tick,
 * because the room encodes once regardless of how many sockets read it. And this
 * is a fast x86 dev core (the same i9 the day-0 spike measured on), not the
 * shared-cpu-1x Fly guest the fleet deploys to — the extrapolation to that core is
 * spelled out below and carried into docs/netcode-spike.md, where the *live*
 * 20-minute sustained-CPU gate against the real guest is recorded as still open.
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { ShipClass } from '@shared/types';
import { MatchRoom } from '../../server/room';
import { DEFAULT_MAX_ROOMS } from '../../server/match-server';
import { TICK_DT } from '../../src/sim';

/**
 * How much slower one shared-cpu-1x Fly core is assumed to be than this i9 dev
 * core. The day-0 spike reasoned the target ARM/shared core at ~5× the dev core
 * (docs/netcode-spike.md §2); the same factor is used here so the two documents
 * agree. It is an **estimate**, not a measurement — the honest number comes from
 * the live 20-minute gate on the real guest (hosting Task 12, item 4), which this
 * file cannot run in CI. Applied to the measured fleet cost, it says whether the
 * ceiling survives the deploy target, not just the box that measured it.
 */
const TARGET_CORE_SLOWDOWN = 5;

/** One 60 Hz tick's real budget: the whole fleet must fit inside it. */
const TICK_BUDGET_MS = TICK_DT * 1000;

/** A socket that reads nothing — a bot-only room needs a seat's creator only long
 *  enough to pick the bots' difficulties, then hands the whole room to AI. */
const NULL_SOCKET = { send(): void {}, close(): void {} };

/**
 * A live room of eight Hard bots, and no humans. The room is sized once at open;
 * the trick to fill *every* seat with a bot (rather than seven bots and one idle
 * human) is that a lobby's chosen bot difficulties outlive the connection that
 * chose them: a creator joins, names Hard for all eight seats, and drops while the
 * room is still a lobby — freeing its seat without touching the difficulty list —
 * and then `startMatch` seats a Hard bot in all eight now-empty seats.
 */
function eightHardBotRoom(index: number): MatchRoom {
  let token = 0;
  const room = new MatchRoom({
    code: `DENSITY${index}`,
    seed: 7000 + index,
    makeToken: () => `t${index}-${token++}`,
  });
  room.join(NULL_SOCKET, {}, 0);
  room.receive(0, {
    type: 'lobbyChoice',
    shipClass: ShipClass.Vanguard,
    fireMode: 'auto',
    botDifficulties: Array.from({ length: 8 }, () => 'hard' as const),
  });
  room.disconnect(0, 0); // frees the seat; the Hard×8 difficulty list survives
  room.startMatch(); // every empty seat becomes a Hard bot
  return room;
}

/** Nearest-rank percentile of an unsorted sample, in ms. */
function percentile(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

describe('fleet density — DEFAULT_MAX_ROOMS full of Hard bots', () => {
  it('fills every room with eight Hard bots and keeps them all live', () => {
    const rooms = Array.from({ length: DEFAULT_MAX_ROOMS }, (_, i) => eightHardBotRoom(i));
    for (const room of rooms) {
      expect(room.state).toBe('live');
      expect(room.size).toBe(8);
      const bots = room.lobbyState().filter((s) => s.isBot);
      expect(bots).toHaveLength(8);
      // Every bot is a Hard-tier character (its difficulty came from the list).
      expect(bots.every((s) => s.botDifficulty === 'hard')).toBe(true);
    }
  });

  it('runs the whole fleet inside one 60 Hz tick, with headroom for the deploy core', () => {
    const rooms = Array.from({ length: DEFAULT_MAX_ROOMS }, (_, i) => eightHardBotRoom(i));

    // Drive every room one real tick per `update`, so each timed sample is exactly
    // one fleet-tick (the sim is fixed-timestep: `update` runs floor(elapsed/dt)
    // ticks, and one dt of elapsed time is one tick — `server/room.ts`).
    let now = TICK_BUDGET_MS;
    for (const room of rooms) room.update(now); // anchor; runs no ticks
    const tick = (): void => {
      now += TICK_BUDGET_MS;
      for (const room of rooms) room.update(now);
    };

    // Warm past spawn protection (10 s) and into real play, so the measured ticks
    // carry live projectiles and fighting bots, not an idle opening.
    for (let i = 0; i < 900; i++) tick();

    const samples: number[] = [];
    for (let i = 0; i < 600; i++) {
      const start = performance.now();
      tick();
      samples.push(performance.now() - start);
    }

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p99 = percentile(samples, 0.99);
    const liveRooms = rooms.filter((r) => r.state === 'live').length;
    let liveProjectiles = 0;
    for (const room of rooms) liveProjectiles += room.world?.projectiles.filter((p) => p.active).length ?? 0;

    // Printed unconditionally — the measurement is the deliverable; the asserts are
    // the backstop (docs/netcode-spike.md carries these numbers forward).
    console.log(
      `[fleet-density] ${DEFAULT_MAX_ROOMS} rooms × 8 Hard bots · ${liveRooms} live · ` +
        `${liveProjectiles} live projectiles\n` +
        `  fleet-tick: mean ${mean.toFixed(3)} ms · p99 ${p99.toFixed(3)} ms · ` +
        `budget ${TICK_BUDGET_MS.toFixed(2)} ms → ${((mean / TICK_BUDGET_MS) * 100).toFixed(1)}% mean / ` +
        `${((p99 / TICK_BUDGET_MS) * 100).toFixed(1)}% p99 of one core\n` +
        `  per-room-tick: ${(mean / DEFAULT_MAX_ROOMS).toFixed(4)} ms\n` +
        `  @${TARGET_CORE_SLOWDOWN}× shared-core estimate: mean ${(mean * TARGET_CORE_SLOWDOWN).toFixed(2)} ms ` +
        `(${((mean * TARGET_CORE_SLOWDOWN) / TICK_BUDGET_MS * 100).toFixed(0)}% of budget)`,
    );

    // The workload is real: nothing collapsed, and there is combat to pay for.
    expect(liveRooms).toBe(DEFAULT_MAX_ROOMS);

    // Gate 1 — the fleet keeps up with real time on the measuring core, by a wide
    // margin. This is a true capacity assertion (not a print), yet loose enough
    // that a CI runner several times slower than this i9 still clears it: at the
    // chosen ceiling the mean is well under a fifth of the budget here.
    expect(mean).toBeLessThan(TICK_BUDGET_MS);

    // Gate 2 — the ceiling survives the deploy target. The 5×-slower shared-core
    // estimate must still fit one 60 Hz tick on the sustained (mean) cost that the
    // /health `loopLagMs` gate watches. This is what justifies the constant: if a
    // regression made a room heavy enough that DEFAULT_MAX_ROOMS of them could not
    // fit the estimated target core, this fails and the constant must drop (or the
    // room get cheaper), exactly as the hosting plan intends.
    expect(mean * TARGET_CORE_SLOWDOWN).toBeLessThan(TICK_BUDGET_MS);
  }, 60_000);
});
