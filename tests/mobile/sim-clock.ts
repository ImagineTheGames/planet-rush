/**
 * tests/mobile/sim-clock.ts — wait on the SIM's clock, never the wall's. OWNER: QA Agent.
 *
 * Every mobile journey has to say "let some time pass" somewhere: hold thrust,
 * let a turret finish building, let the camera settle. Phrasing that in
 * milliseconds is the single biggest reason this suite is hardware-sensitive.
 *
 * WHY MILLISECONDS LIE HERE. The game loop clamps how much simulation a slow
 * frame may catch up on (`loop.ts` MAX_FRAME_SECONDS = 0.25 s ⇒ at most 15 fixed
 * steps per rendered frame). On a hardware-GL host rendering at 60 fps, one wall
 * second buys 60 ticks; on a GitHub runner's software-GL rasterizer at ~1 fps it
 * buys ~15 (measured 14.7 — see emulation.spec.ts). So a `waitForTimeout(2000)`
 * is *four times less simulation* in CI than on a laptop: the test silently
 * proves less on the machine that gates merges, and any assertion downstream of
 * it is partly an assertion about the host's frame rate.
 *
 * Counting the sim's OWN fixed steps (`window.__planetRush.ticks`, the ratified
 * `?debug=1` instrument — src/platform/debug-hook.ts) removes that term by
 * construction: 120 ticks is 2 seconds of simulation everywhere. The cost is that
 * the WALL-clock price of the wait now scales with how slowly the host renders —
 * which is exactly what {@link ../../playwright.config.ts} and
 * {@link ./budgets} exist to pay for, and it is the right trade: a test that
 * runs longer on a slow host still proves the same thing, where a test that
 * simulates less does not.
 *
 * THE STALL WATCHDOG (why the bigger budgets in ./budgets are safe). Waiting on
 * sim progress instead of a stopwatch would, on its own, mean a sim that stopped
 * ticking hangs until the journey budget expires — a hung match dressed as a slow
 * one, and precisely the thing the QA charter forbids. So the wait carries its own
 * liveness bound: if the tick counter fails to advance *at all* for
 * {@link DEFAULT_STALL_MS}, the wait fails immediately, naming how far it got.
 * A hang is then caught by the absence of simulation — the honest signal — and not
 * by a global stopwatch that also has to be wide enough for the slowest legitimate
 * host. That separation is the whole point: budgets bound the SLOW, this bounds
 * the STUCK.
 *
 * The watchdog runs in-page on a `setTimeout`, not over the CDP wire, so it still
 * fires when `requestAnimationFrame` itself has stopped (a wedged compositor is a
 * hang the poll loop alone would never see).
 */
import type { Page } from '@playwright/test';

/** The sim's fixed step rate (GDD §4.1 — deterministic fixed-timestep, 60 Hz). */
export const TICKS_PER_SECOND = 60;

/** Sim seconds → fixed steps. Use this so a test still reads in human units
 *  ("2 seconds of thrust") while waiting on the clock that actually governs it. */
export const simSeconds = (s: number): number => Math.round(s * TICKS_PER_SECOND);

/**
 * How long the sim may go with NO tick at all before the wait calls it stuck.
 *
 * Sized off the slowest host we budget for: the software-GL runner renders ~1 fps
 * and every rendered frame advances the sim, so ticks arrive about once a second
 * there. Ten seconds of total silence is ~10× that — far outside any legitimate
 * render stutter, and far inside the journey budgets, so a genuine hang fails in
 * seconds instead of consuming the whole budget.
 */
export const DEFAULT_STALL_MS = 10_000;

/**
 * Wait until the `?debug=1` tick instrument is installed and the sim has produced
 * at least one step, so a subsequent {@link waitForSimTicks} is measuring a live
 * clock rather than racing the hook's installation. A boot that never gets here
 * fails on this wait, naming it — which is the hang signal, distinct from the
 * journey budget (./budgets.ts).
 */
export async function waitForSimClock(
  page: Page,
  timeoutMs = 20_000,
  instrument: TickInstrument = 'debug',
): Promise<void> {
  await page.waitForFunction(
    (source) => {
      const w = window as unknown as {
        __planetRush?: { ticks?: number };
        __pauseStage?: { read(): { simTicks: number } };
      };
      const ticks = source === 'pause' ? w.__pauseStage?.read().simTicks : w.__planetRush?.ticks;
      return typeof ticks === 'number' && ticks > 0;
    },
    instrument,
    { timeout: timeoutMs },
  );
}

/**
 * Which of the two shipped tick read-outs a wait reads.
 *
 * `debug` — `window.__planetRush.ticks`, the ratified `?debug=1` instrument
 * (src/platform/debug-hook.ts). The default, and what every journey in this
 * suite has always used.
 *
 * `pause` — `window.__pauseStage.read().simTicks`, which reports the SAME
 * counter but is installed on **both** boots (src/main.ts `installPauseStage`:
 * *"installed on BOTH boots, unlike the debug stages above"*). It exists here
 * for the one journey that cannot carry `?debug=1` at all: `?debug=1` is a
 * single flag that also skips the main menu and the lobby (src/main.ts:969,
 * :1028), so a test that must walk the REAL lobby has no `__planetRush` to wait
 * on. Same clock, same fixed steps, same stall discipline — only a different
 * window onto it.
 */
export type TickInstrument = 'debug' | 'pause';

/** What {@link waitForSimTicks} answers with. */
export interface SimWaitOptions {
  /** Liveness bound: max ms with no tick advance before failing. */
  readonly stallMs?: number;
  /** Names the wait in a failure ("650 ticks of turret construction"). */
  readonly what?: string;
  /** Which shipped tick read-out to poll. Defaults to the `?debug=1` one. */
  readonly instrument?: TickInstrument;
}

/**
 * Block until the sim has advanced `ticks` fixed steps from now, and answer how
 * many it actually advanced (≥ `ticks`).
 *
 * The poll runs in-page on `requestAnimationFrame`, so the window closes within a
 * frame of hitting the target rather than one CDP round-trip later — polling over
 * the wire overshot to 700+ ticks at ~1 fps (emulation.spec.ts). Throws if the sim
 * stalls (see {@link DEFAULT_STALL_MS}) or if the chosen tick instrument
 * ({@link TickInstrument}) is not installed at all, which is a boot problem worth
 * naming as one.
 */
export async function waitForSimTicks(page: Page, ticks: number, opts: SimWaitOptions = {}): Promise<number> {
  const stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
  const instrument = opts.instrument ?? 'debug';
  const outcome = await page.evaluate(
    ({ want, stall, source }: { want: number; stall: number; source: TickInstrument }) =>
      new Promise<number | string>((resolve) => {
        const w = window as unknown as {
          __planetRush?: { ticks?: number };
          __pauseStage?: { read(): { simTicks: number } };
        };
        // One reader per instrument, resolved once — both answer the SAME fixed-step
        // counter, so everything below this line is identical for either boot.
        const readTicks =
          source === 'pause'
            ? (): number | undefined => w.__pauseStage?.read().simTicks
            : (): number | undefined => w.__planetRush?.ticks;
        if (typeof readTicks() !== 'number') {
          resolve(
            source === 'pause'
              ? 'NO INSTRUMENT: window.__pauseStage is absent — is a match actually running?'
              : 'NO INSTRUMENT: window.__planetRush.ticks is absent — was the page loaded with ?debug=1?',
          );
          return;
        }
        const t0 = readTicks() as number;
        let seen = t0;
        let watchdog = 0;
        const arm = (): void => {
          clearTimeout(watchdog);
          watchdog = window.setTimeout(
            () => resolve(`STALL: the sim advanced ${seen - t0}/${want} ticks, then produced none for ${stall}ms`),
            stall,
          );
        };
        const poll = (): void => {
          const now = readTicks() as number;
          if (now !== seen) {
            seen = now;
            arm(); // progress — the sim is alive, restart the liveness clock
          }
          if (now - t0 >= want) {
            clearTimeout(watchdog);
            resolve(now - t0);
            return;
          }
          requestAnimationFrame(poll);
        };
        arm();
        requestAnimationFrame(poll);
      }),
    { want: ticks, stall: stallMs, source: instrument },
  );

  if (typeof outcome === 'string') {
    throw new Error(`waitForSimTicks(${ticks}${opts.what ? ` — ${opts.what}` : ''}): ${outcome}`);
  }
  return outcome;
}
