/**
 * tests/net/capacity/core-speed.ts — how fast is the core this ran on? OWNER:
 * Netcode Engineer (m11 server stress; GDD §4.1, §4.2).
 *
 * A capacity curve is a number about a *core*, not about a program. "32 rooms"
 * on the dev box's i9 and "32 rooms" on a Fly shared guest are different claims,
 * and a document that prints the first and deploys the second is exactly the
 * kind of assumption this brief exists to delete.
 *
 * So every run stamps the core it ran on, measured the same way: a fixed
 * eight-station world, stepped a fixed number of times, timed. This is the
 * server's own hot loop — `src/sim/step` is what the room calls sixty times a
 * second (GDD §4.1) — so the figure scales the thing that actually costs, not a
 * synthetic integer benchmark that would rank branch predictors instead.
 *
 * Two honest limits, stated rather than buried:
 *
 *  • it measures **one core's single-thread speed**, which is the right axis
 *    (the match server is one event loop) and says nothing about how many cores
 *    a guest has. `./guest-model.ts` handles the quota half;
 *  • a ratio between two cores' `msPerStep` predicts the *sim's* share of the
 *    cost and only approximates the rest (socket syscalls, GC, the JSON control
 *    path). A projection is therefore a **hypothesis for the hosted run to
 *    falsify**, in the spirit of the balance constants (GDD §2.8) — never a
 *    substitute for measuring the real guest.
 */

import { cpus } from 'node:os';
import { ShipClass } from '@shared/types';
import { createWorld, step } from '../../../src/sim';
import type { Inputs, World } from '../../../src/sim';

/** Steps timed per measurement. Enough that the JIT has warmed and a scheduler
 *  hiccup is diluted; short enough that the stamp costs a second, not a minute. */
const STEPS = 20_000;
/** Steps run and thrown away first, so the measurement is of optimised code. */
const WARMUP_STEPS = 4_000;

/** What one core is worth, on the sim's own hot loop. */
export interface CoreSpeed {
  /** Mean cost of one 60 Hz sim tick for one eight-station world, ms. */
  readonly msPerStep: number;
  /** How many such worlds one core could step in real time, ignoring everything
   *  else a room does (sockets, encoding, bots' own allocation). A ceiling, and
   *  named as one. */
  readonly worldsPerCore: number;
  /** `os.cpus()[0].model`, for the report header. */
  readonly cpu: string;
  readonly steps: number;
}

/** The eight-station world every capacity measurement is normalised against.
 *  Fixed seed, fixed roster, all Vanguards: the point is that two runs on two
 *  machines step the *same* world. */
function referenceWorld(): World {
  return createWorld({
    seed: 0x5eed_1234,
    players: Array.from({ length: 8 }, (_unused, id) => ({
      id,
      shipClass: ShipClass.Vanguard,
    })),
  });
}

/** No input at all: this measures the world's own cost, which is the part that
 *  is identical on every host. Input handling is per-client and is measured
 *  where it belongs — on the wire, by the ramp. */
const NO_INPUT: Inputs = [];

/** Time the sim's hot loop on this core. Synchronous and ~1 s. */
export function measureCoreSpeed(steps = STEPS): CoreSpeed {
  let world = referenceWorld();
  for (let i = 0; i < WARMUP_STEPS; i++) world = step(world, NO_INPUT);

  world = referenceWorld();
  const started = performance.now();
  for (let i = 0; i < steps; i++) world = step(world, NO_INPUT);
  const elapsed = performance.now() - started;

  const msPerStep = elapsed / steps;
  return {
    msPerStep,
    // 60 steps a second per world: one core's real-time budget is 1000 ms of
    // work per second, and each world wants `60 × msPerStep` of it.
    worldsPerCore: 1000 / (60 * msPerStep),
    cpu: cpuModel(),
    steps,
  };
}

/** The CPU's own name, for the report header. */
function cpuModel(): string {
  const first = cpus()[0];
  return typeof first?.model === 'string' ? first.model.trim() : 'unknown';
}

/**
 * Scale a room count measured on one core onto another, by the ratio of their
 * per-step costs. `rooms × (measured.msPerStep / target.msPerStep)`.
 *
 * Read the header before quoting the output of this function: it is a
 * hypothesis, and the whole reason `docs/server-capacity.md` carries a runbook
 * for a real hosted run is that a projection is not a measurement.
 */
export function projectRooms(rooms: number, measured: CoreSpeed, target: CoreSpeed): number {
  if (target.msPerStep <= 0) return 0;
  return rooms * (measured.msPerStep / target.msPerStep);
}
