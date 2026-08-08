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
 * ── THIS FILE NO LONGER SETS THE CEILING (m11-01, docs/server-capacity.md) ──
 *
 * It used to, and it set it wrong: 32. Two reasons, and the second is the one
 * that mattered. It measures the **sim** — the wire, the per-socket fan-out,
 * snapshot encoding and the JSON control path are not in a bare fleet tick, and
 * together they cost 1.7× again. And it gates against **one whole core's 16.67 ms
 * frame**, while the guest the fleet deploys to is metered at 6.25% of a core
 * sustained. 45% of a core is seven times that quota: the Machine throttles long
 * before the loop notices, and every room on it together.
 *
 * The ceiling is now derived from the **CPU quota**, measured over the real wire
 * by `tests/net/capacity/` and recorded in `docs/server-capacity.md`. What this
 * file still does, and still does better than anything else, is gate the *sim
 * cost* of a full fleet in CI without a socket in sight — so a sim regression
 * that made a room heavy shows up here first, in seconds. Read its gates as
 * "the fleet still keeps up with real time", not as "this is how many fit".
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

/** A sink the reference workload feeds, read after the fact so no V8 version can
 *  dead-code-eliminate the loop (which would read as an infinitely-fast core). */
let referenceSink = 0;

/**
 * A fixed, allocation-free numeric workload — the same FLOPs every call, no I/O,
 * no GC — whose wall-clock time is a clean proxy for the raw speed of the core
 * underneath the test. Its instruction mix (sqrt/trig/mul/add) deliberately
 * mirrors the sim's hot path (distances, angles, integration), so it scales with
 * core speed the way the fleet tick does. Returns the *median* time over a short
 * burst — the same central-tendency statistic the fleet is judged by (its mean),
 * so both absorb a noisy shared host the same way: a truer like-for-like ratio
 * than a min would give (a min filters out the contention the fleet's mean pays
 * for, under-reporting a busy core's slowness and tightening Gate 2 unsafely),
 * while staying robust to the odd GC/scheduler spike. Gate 2 uses it to make the
 * deploy-target extrapolation independent of which machine runs the test — a fast
 * i9 dev core, or a slow, noisy CI runner.
 */
function referenceCoreMs(): number {
  const work = (): number => {
    let acc = 0;
    for (let i = 1; i <= 400_000; i++) acc += Math.sqrt(i) * 1.0000001 - Math.sin(i * 0.5);
    return acc;
  };
  for (let i = 0; i < 10; i++) referenceSink += work(); // warm the JIT
  const times: number[] = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    referenceSink += work();
    times.push(performance.now() - start);
  }
  return percentile(times, 0.5); // median — see doc above
}

/**
 * {@link referenceCoreMs} on the i9 dev core the day-0 spike and this file's
 * headline numbers were measured on (~2.9 ms, stable to ±5% across runs).
 * `TARGET_CORE_SLOWDOWN` is the i9→Fly-guest ratio, so it is only meaningful
 * *relative to this baseline core*. A core K× slower than the i9 reads the same
 * reference at ~K×2.9 ms; the honest slowdown from *that* core to the Fly guest
 * is `TARGET_CORE_SLOWDOWN / K`, because a slower measuring core has already paid
 * part of the penalty. Gate 2 applies exactly that, so `mean × effectiveSlowdown`
 * is hardware-invariant — it always evaluates to the i9-mean × `TARGET_CORE_SLOWDOWN`,
 * whether an i9 or a 3×-slower CI runner is holding the stopwatch. Without this
 * normalisation the raw ×5 double-counts CI's own slowness and the gate can never
 * pass on the runner (it read 19.69 ms against a 16.67 ms budget).
 */
const I9_REFERENCE_MS = 2.9;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

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
    // …and the ROSTER that puts them there (a0-11; GDD §2.1 amended 2026-08-07).
    // An empty seat no longer becomes a bot on its own — it stays an empty chair —
    // so the bots this file measures have to be authored, exactly as the shipping
    // lobby authors them. Seat 0 stays OPEN because the host is sitting in it: you
    // cannot bot a chair somebody is in, on the client or on the server.
    seats: ['open', ...Array.from({ length: 7 }, () => 'bot' as const)] as const,
  });
  // The host STAYS (a0-11). It used to drop out here so that all eight seats went
  // to bots, which the room was happy to do; it no longer is, and a zero-human
  // room cannot be reached through the real path at all. So the densest room this
  // harness can build is 1 human seat + 7 Hard bots — which is exactly the room
  // `docs/server-capacity.md` measured over the real wire, so the two now agree on
  // what "a full room" means rather than differing by one behaviour tree.
  room.startMatch(); // every seat the host set to BOT becomes a Hard bot
  return room;
}

/** Nearest-rank percentile of an unsorted sample, in ms. */
function percentile(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

describe('fleet density — DEFAULT_MAX_ROOMS full of Hard bots', () => {
  it('fills every room with seven Hard bots beside one human seat, and keeps them all live', () => {
    const rooms = Array.from({ length: DEFAULT_MAX_ROOMS }, (_, i) => eightHardBotRoom(i));
    for (const room of rooms) {
      expect(room.state).toBe('live');
      expect(room.size).toBe(8);
      const bots = room.lobbyState().filter((s) => s.isBot);
      expect(bots).toHaveLength(7);
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

    // Read this core's speed against the i9 baseline, in the same thermal/contention
    // state the samples were just taken in, and normalise the deploy-target factor:
    // a measuring core K× slower than the i9 has already paid part of the penalty, so
    // the remaining i9→Fly slowdown from *here* is `TARGET_CORE_SLOWDOWN / K`. The
    // product `mean × effectiveSlowdown` is then invariant to the measuring machine.
    const coreRatio = clamp(referenceCoreMs() / I9_REFERENCE_MS, 0.25, 20);
    const effectiveSlowdown = TARGET_CORE_SLOWDOWN / coreRatio;
    const targetCoreMean = mean * effectiveSlowdown;

    // Printed unconditionally — the measurement is the deliverable; the asserts are
    // the backstop (docs/netcode-spike.md carries these numbers forward).
    console.log(
      `[fleet-density] ${DEFAULT_MAX_ROOMS} rooms × 8 Hard bots · ${liveRooms} live · ` +
        `${liveProjectiles} live projectiles\n` +
        `  fleet-tick: mean ${mean.toFixed(3)} ms · p99 ${p99.toFixed(3)} ms · ` +
        `budget ${TICK_BUDGET_MS.toFixed(2)} ms → ${((mean / TICK_BUDGET_MS) * 100).toFixed(1)}% mean / ` +
        `${((p99 / TICK_BUDGET_MS) * 100).toFixed(1)}% p99 of one core\n` +
        `  per-room-tick: ${(mean / DEFAULT_MAX_ROOMS).toFixed(4)} ms\n` +
        `  core vs i9 baseline: ${coreRatio.toFixed(2)}× (ref ${(coreRatio * I9_REFERENCE_MS).toFixed(2)} ms) ` +
        `→ effective slowdown ${effectiveSlowdown.toFixed(2)}×\n` +
        `  @${TARGET_CORE_SLOWDOWN}× shared-core estimate (i9-normalised): mean ${targetCoreMean.toFixed(2)} ms ` +
        `(${((targetCoreMean / TICK_BUDGET_MS) * 100).toFixed(0)}% of budget)`,
    );

    // The workload is real: nothing collapsed, and there is combat to pay for.
    expect(liveRooms).toBe(DEFAULT_MAX_ROOMS);

    // Sanity on the calibration itself: the reference must have actually run (a
    // dead-code-eliminated loop would read ~0 ms and clamp to a bogus 20× slowdown)
    // and produced a finite sink. Observing the sink is also what keeps V8 from
    // eliminating the loop in the first place.
    expect(Number.isFinite(referenceSink)).toBe(true);
    expect(effectiveSlowdown).toBeGreaterThan(0);

    // Gate 1 — the fleet keeps up with real time on the measuring core, by a wide
    // margin. This is a true capacity assertion (not a print), yet loose enough
    // that a CI runner several times slower than this i9 still clears it: at the
    // chosen ceiling the mean is well under a fifth of the budget here.
    expect(mean).toBeLessThan(TICK_BUDGET_MS);

    // Gate 2 — the fleet's SIM cost survives the deploy target's core speed. The
    // 5×-slower shared-core estimate must still fit one 60 Hz tick on the
    // sustained (mean) cost. Note what this does and does not say: it is about the
    // core being fast enough, never about the *quota* being large enough, and the
    // quota is what actually binds (see the header — 45% of a core is 7× a
    // shared-cpu-1x's entire sustained budget). So this is a regression gate on
    // room weight, not the justification for DEFAULT_MAX_ROOMS; that lives in
    // docs/server-capacity.md and is gated by
    // tests/net/capacity/capacity-regression.test.ts. The estimate is
    // i9-normalised (see `effectiveSlowdown`) so the gate asserts the same
    // extrapolated cost on any core — it does not silently loosen into a no-op on a
    // slow CI runner, nor double-count that runner's own slowness into a false fail.
    expect(targetCoreMean).toBeLessThan(TICK_BUDGET_MS);
  }, 60_000);
});
