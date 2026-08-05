/**
 * tests/net/sim-clock.ts — wait on the SIM's clock, never the wall's.
 * OWNER: Netcode Engineer (n4-01; the same lesson q7-01 wrote for tests/mobile/).
 *
 * Every socket-backed test in this suite has to say "let some of the match
 * happen" somewhere: fly for a while, let a build finish, let a few snapshots
 * come back. Phrasing that in milliseconds is the single biggest reason this
 * suite is hardware-sensitive — and unlike the mobile suite, the honest clock is
 * sitting right here in the process.
 *
 * WHY MILLISECONDS LIE HERE. The authoritative server in `./node-websocket.ts`
 * steps on `setInterval(matches.update, 1000 / 60)`, and Node's timers are a
 * *floor*, not a schedule: a busy event loop — two client sessions predicting and
 * reconciling, a 60 Hz input pump, an RFC 6455 endpoint framing every message —
 * delivers fewer than 60 of those a second, and a CI runner with two shared cores
 * delivers considerably fewer. So `await sleep(1_500)` is not "90 ticks of match";
 * it is "90 ticks here and some smaller number on the machine that gates merges".
 * Every assertion downstream of it — how far a ship travelled, whether a build
 * completed, whether authority reached tick 60 — is then partly an assertion about
 * the runner's CPU.
 *
 * Counting the sim's OWN fixed steps removes that term by construction: 120 ticks
 * is 2 seconds of simulation everywhere. The cost is that the WALL-clock price of
 * the wait now scales with how slowly the host runs — which is exactly what
 * {@link ./budgets} exists to pay for, and it is the right trade: a test that runs
 * longer on a slow host still proves the same thing, where a test that simulates
 * less does not.
 *
 * THE STALL WATCHDOG (why the bigger budgets in ./budgets are safe). Waiting on
 * sim progress instead of a stopwatch would, on its own, mean a server that
 * stopped stepping hangs until the journey budget expires — a wedged match dressed
 * as a slow one. So the wait carries its own liveness bound: if the tick counter
 * fails to advance *at all* for {@link DEFAULT_STALL_MS}, it fails immediately,
 * naming how far it got. Budgets bound the SLOW; this bounds the STUCK.
 */

/** The sim's fixed step rate (GDD §4.1 — deterministic fixed-timestep, 60 Hz). */
export const TICKS_PER_SECOND = 60;

/** Sim seconds → fixed steps. Use this so a test still reads in human units
 *  ("1.5 seconds of thrust") while waiting on the clock that actually governs it. */
export const simSeconds = (s: number): number => Math.round(s * TICKS_PER_SECOND);

/**
 * How long the sim may go with NO tick at all before the wait calls it stuck.
 *
 * The server's loop is a 16 ms interval, so a healthy host produces a tick every
 * frame and a badly loaded one still produces several a second. Two seconds of
 * total silence is far outside any legitimate scheduling stutter and far inside
 * every journey budget in ./budgets.ts, so a genuinely wedged server fails in
 * two seconds instead of consuming the whole budget.
 */
export const DEFAULT_STALL_MS = 2_000;

/** How often the waiters below re-read the clock. A tick is 16 ms; sampling at
 *  4 ms closes the window within a tick of the target rather than overshooting. */
const POLL_MS = 4;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface TickWaitOptions {
  /** Liveness bound: max ms with no tick advance before failing. */
  readonly stallMs?: number;
  /** Names the wait in a failure ("90 ticks of two-ship flight"). */
  readonly what?: string;
}

/**
 * Block until `tick()` has advanced `ticks` fixed steps from now, and answer how
 * many it actually advanced (≥ `ticks`).
 *
 * `tick` is a thunk rather than a world, so it reads the same whether the caller
 * holds the authoritative `World` (mutated in place by `MatchServer`) or a
 * client's predicted world (replaced on every reconcile):
 *
 * ```ts
 * await waitForTicks(() => authority.tick, simSeconds(1.5), { what: 'two ships under thrust' });
 * ```
 *
 * Throws if the sim stalls (see {@link DEFAULT_STALL_MS}), naming how far it got —
 * which is the hang signal, and is deliberately NOT the journey budget.
 */
export async function waitForTicks(
  tick: () => number,
  ticks: number,
  opts: TickWaitOptions = {},
): Promise<number> {
  const stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
  const name = opts.what === undefined ? '' : ` — ${opts.what}`;
  const from = tick();
  let seen = from;
  let movedAt = Date.now();

  for (;;) {
    const now = tick();
    if (now !== seen) {
      seen = now;
      movedAt = Date.now(); // progress — the sim is alive, restart the liveness clock
    }
    if (seen - from >= ticks) return seen - from;
    if (Date.now() - movedAt > stallMs) {
      throw new Error(
        `waitForTicks(${ticks}${name}): STALL — the sim advanced ${seen - from}/${ticks} ticks, ` +
          `then produced none for ${stallMs}ms`,
      );
    }
    await sleep(POLL_MS);
  }
}
