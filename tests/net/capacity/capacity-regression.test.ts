/**
 * tests/net/capacity/capacity-regression.test.ts — the CI-able subset. OWNER:
 * Netcode Engineer (m11 server stress; GDD §4.2).
 *
 * The full capacity ramp is a thirty-minute run against a throwaway Machine and
 * cannot live in CI. What CAN live in CI is the thing the ramp is really
 * protecting: **the per-room cost of a server change**. A room that quietly gets
 * twice as expensive halves the fleet's capacity, and today nothing would notice
 * until players did (`docs/server-capacity.md`, "The CI-able subset").
 *
 * Three assertions, in the order they matter:
 *
 *  1. **The load is real.** Before any number is trusted, the test decodes a
 *     snapshot off the wire and checks that eight ships exist and that
 *     projectiles are flying. A "capacity" measurement taken against rooms whose
 *     bots never woke up would be a measurement of an idle process — and it
 *     would pass, forever, getting cheaper as the bug got worse.
 *  2. **Nothing dropped.** Every room still seated and flying at the end.
 *  3. **The per-room CPU cost, normalised to this core.** Absolute milliseconds
 *     are not portable — a CI runner is not the dev box — so the budget is
 *     expressed as a *multiple of the raw sim step* this same process just timed
 *     (`./core-speed.ts`). That ratio is a property of the server's code, not of
 *     the hardware, which is what makes it a gate rather than a flake.
 *
 * **Why not Docker.** The brief says "dockerized server". What Docker adds over
 * this is a namespace and a cgroup around `node server/dist/match-server.mjs` —
 * and that file, built by the same command the Dockerfile runs, is exactly what
 * `./local-target.ts` spawns. Docker is not installed on every runner, so
 * requiring it would turn the gate into a skip, which is worse than a gate that
 * measures the same process one layer down. The cgroup half — the actual quota —
 * is not emulated locally in either case, and is measured on the real guest by
 * the hosted run.
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import { decodeSnapshot } from '../../../src/net/snapshot';
import { parseServerMessage } from '../../../src/net/wire';
import { DEFAULT_MAX_ROOMS } from '../../../server/match-server';
import { measureCoreSpeed } from './core-speed';
import type { CoreSpeed } from './core-speed';
import { startLocalServer } from './local-target';
import type { LocalServer } from './local-target';
import { SyntheticFleet, openSyntheticMatch } from './synthetic-match';
import type { SyntheticMatch } from './synthetic-match';
import type { HealthReading } from './target';

/** Rooms the gate runs at. Small enough to finish in CI, large enough that the
 *  marginal cost is not swamped by the empty process's floor. */
const ROOMS = 4;

/** Seconds of steady-state CPU sampled per phase. */
const WINDOW_MS = 12_000;

/** Let room construction and the opening `fullEntityState` broadcast finish
 *  before the CPU window opens — a transient billed to steady state would make
 *  the gate flap with runner speed. */
const SETTLE_MS = 6_000;

/**
 * **The gate.** How many times a room may cost more than one bare 8-station sim
 * step, per tick, on whatever core this is.
 *
 * A room is not just `step()`: it runs seven Hard behaviour trees (GDD §2.9),
 * encodes and writes a snapshot every second tick, diffs static entities at
 * 10 Hz, and answers a latency probe twice a second. The measured ratio is what
 * it is; this budget sits well above it so ordinary noise cannot fail the build,
 * and well below a doubling so a real regression cannot pass. Move it only with
 * a re-measured `docs/server-capacity.md` in the same commit.
 */
const MAX_ROOM_COST_IN_SIM_STEPS = 30;

/** The tick budget the whole thing is drawn against: 33 ms at the 30 Hz
 *  broadcast (GDD §4.2). At four rooms a healthy loop is nowhere near it. */
const TICK_BUDGET_MS = 33;

let server: LocalServer;
let core: CoreSpeed;
let fleet: SyntheticFleet;
let probe: SyntheticMatch;
const decoded: { ships: number; projectiles: number }[] = [];

/** CPU drawn between two readings, ms of CPU per second of wall clock. */
function cpuMsPerSec(from: HealthReading, to: HealthReading): number {
  const wall = (to.at - from.at) / 1000;
  if (wall <= 0 || from.cpuMs === null || to.cpuMs === null) return NaN;
  return (to.cpuMs - from.cpuMs) / wall;
}

let floorMsPerSec = NaN;
let loadedMsPerSec = NaN;
let maxLagMs = 0;

beforeAll(async () => {
  core = measureCoreSpeed(6_000);
  server = await startLocalServer({ maxRooms: ROOMS + 8, seed: 0x11_11 });

  // Phase 1 — the empty process. Its floor is not a room's cost (see the ramp's
  // "marginal, not average"), so it is measured and subtracted.
  const floorFrom = await server.health();
  await new Promise((r) => setTimeout(r, WINDOW_MS));
  const floorTo = await server.health();
  floorMsPerSec = cpuMsPerSec(floorFrom, floorTo);

  // Phase 2 — the rooms. One of them reports its snapshots so assertion 1 can
  // look at real bytes; the other three stay on the counting-only path.
  fleet = new SyntheticFleet(server);
  probe = await openSyntheticMatch(server, {
    onSnapshot: (payload) => {
      const message = parseServerMessage(payload);
      if (message?.type !== 'snapshot') return;
      const snap = decodeSnapshot(message.payload);
      decoded.push({ ships: snap.ships.length, projectiles: snap.projectiles.length });
    },
  });
  await fleet.add(ROOMS - 1);

  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const loadFrom = await server.health();
  const deadline = Date.now() + WINDOW_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    maxLagMs = Math.max(maxLagMs, (await server.health()).loopLagMs);
  }
  const loadTo = await server.health();
  loadedMsPerSec = cpuMsPerSec(loadFrom, loadTo);
}, 180_000);

afterAll(async () => {
  probe?.close();
  fleet?.stop();
  await server?.stop();
});

it('the load is real: eight ships on the wire, and shots in flight', () => {
  expect(decoded.length).toBeGreaterThan(30);
  // Every seat is a ship — one human and seven Hard bots (GDD §2.1, §2.9).
  expect(Math.max(...decoded.map((s) => s.ships))).toBe(8);
  // Held trigger plus seven bots: if nothing is ever in flight, the rooms are
  // idle and every number below is a measurement of an empty process.
  expect(Math.max(...decoded.map((s) => s.projectiles))).toBeGreaterThan(0);
});

it('every room stayed seated and flying', () => {
  expect(fleet.failures).toEqual([]);
  expect(fleet.live).toBe(ROOMS - 1);
  expect(probe.failure).toBeNull();
  expect(probe.inputsSent).toBeGreaterThan(60 * 5);
});

it('the loop stays inside the tick budget at four rooms', () => {
  expect(maxLagMs).toBeLessThan(TICK_BUDGET_MS);
});

it('a room costs no more than its budgeted multiple of a bare sim step', () => {
  expect(Number.isFinite(floorMsPerSec)).toBe(true);
  expect(Number.isFinite(loadedMsPerSec)).toBe(true);

  const perRoomMsPerSec = (loadedMsPerSec - floorMsPerSec) / ROOMS;
  // One room's cost per tick, in units of one bare 8-station sim step on this
  // very core — the portable form (see the header).
  const costInSimSteps = perRoomMsPerSec / 60 / core.msPerStep;

  // Printed unconditionally: when this gate fails on someone else's runner, the
  // numbers that produced it must be in the log, not re-derivable only by
  // re-running it.
  console.log(
    `[capacity] ${core.cpu} · ${core.msPerStep.toFixed(4)} ms/step · floor ` +
      `${floorMsPerSec.toFixed(1)} ms/s · ${ROOMS} rooms ${loadedMsPerSec.toFixed(1)} ms/s · ` +
      `per room ${perRoomMsPerSec.toFixed(1)} ms/s = ${costInSimSteps.toFixed(1)}× a sim step · ` +
      `advertised capacity ${DEFAULT_MAX_ROOMS}`,
  );

  expect(perRoomMsPerSec).toBeGreaterThan(0);
  expect(costInSimSteps).toBeLessThan(MAX_ROOM_COST_IN_SIM_STEPS);
});
