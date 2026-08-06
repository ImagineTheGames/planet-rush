/**
 * tests/mobile/render-settle.ts — wait for FRAMES, never for milliseconds. OWNER: QA Agent.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * ./sim-clock.ts makes the same argument about simulation: a wait phrased in
 * milliseconds proves less on a slow host than on a fast one, so wait on the
 * sim's own clock instead. This is the RENDER-side half of that, and the frozen
 * goldens are precisely where the sim's clock cannot help — `?freeze=1` pins the
 * sim, so `__planetRush.ticks` never advances again and there is no tick to wait
 * on. What is still moving is the renderer, and what a golden actually needs is
 * "the app has DRAWN the state I just staged".
 *
 * goldens.spec.ts used to say that as `waitForTimeout(500)` with the honest
 * comment that the frozen frame is time-invariant, so an early shot is the same
 * deterministic frame. That reasoning is right about the WORLD and silent about
 * the COMPOSITOR: 500 ms is ~30 frames on this hardware and, on a loaded
 * software-GL runner rendering at ~1 fps, possibly none at all. The state change
 * (freeze, a staged rival, an opened build wheel) then goes into a capture that
 * the renderer has not drawn yet.
 *
 * So: count the frames the page actually presents, and let the number of frames
 * be the contract. Three animation frames after a state change guarantees at
 * least two full renders of the changed state whichever order the app's own
 * `requestAnimationFrame` callback and ours are queued in — the app's renderer
 * is rAF-driven (src/platform/loop.ts), and our callback can only be scheduled
 * before or after it, never inside it.
 *
 * ── AND IT STILL CANNOT HANG ───────────────────────────────────────────────
 * Waiting on frames instead of a stopwatch would, on its own, mean a page whose
 * compositor has wedged waits until the test budget expires — a hang dressed as
 * a slow frame, which the QA charter forbids. So the wait carries its own
 * liveness bound, on exactly the model ./sim-clock.ts uses: if NO animation
 * frame arrives for {@link SETTLE_STALL_MS}, it fails immediately, naming how
 * many frames it got. The watchdog is an in-page `setTimeout`, not a poll over
 * the CDP wire, so it still fires in the one case that matters most — when
 * `requestAnimationFrame` itself has stopped being called.
 *
 * This is a settle, not a stabiliser. The pixel-level "two consecutive captures
 * are identical" check is Playwright's own, inside `toHaveScreenshot`, and
 * ./shot-budget.ts is what finally gives it the time to converge. Doing it twice
 * would double the most expensive operation in the suite for no new information.
 */
import type { Page } from '@playwright/test';

/**
 * Animation frames to wait for after a state change. Three ⇒ at least two full
 * renders of the new state regardless of rAF callback ordering (see above), and
 * two renders is also what any double-buffered swap needs to have presented.
 */
export const DEFAULT_SETTLE_FRAMES = 3;

/**
 * How long the page may go with NO animation frame at all before the wait calls
 * it wedged. Ten seconds, the same number and the same reasoning as
 * ./sim-clock.ts `DEFAULT_STALL_MS`: the slowest host we budget for renders at
 * ~1 fps, so ten seconds of total silence is ~10× the legitimate worst case —
 * far outside a render stutter, far inside every test budget.
 */
export const SETTLE_STALL_MS = 10_000;

/**
 * Wait until the page has presented `frames` animation frames, or fail naming
 * how far it got. Call it after anything that changes what should be on screen
 * and before the frame is shot.
 *
 * Returns the number of frames observed, so a caller can assert on it if it ever
 * wants to; the value is `frames` on every success.
 */
export async function settleFrames(
  page: Page,
  frames: number = DEFAULT_SETTLE_FRAMES,
  stallMs: number = SETTLE_STALL_MS,
): Promise<number> {
  return page.evaluate(
    ([wanted, stall]) =>
      new Promise<number>((resolve, reject) => {
        let seen = 0;
        // The watchdog is a setTimeout on purpose: a rAF-based one could not fire
        // in the very case it exists for — rAF having stopped altogether.
        let watchdog = window.setTimeout(() => {
          reject(
            new Error(
              `render settle: no animation frame for ${stall} ms ` +
                `(saw ${seen} of ${wanted}). The page has stopped drawing.`,
            ),
          );
        }, stall);
        const onFrame = (): void => {
          seen += 1;
          window.clearTimeout(watchdog);
          if (seen >= wanted) {
            resolve(seen);
            return;
          }
          watchdog = window.setTimeout(() => {
            reject(
              new Error(
                `render settle: no animation frame for ${stall} ms ` +
                  `(saw ${seen} of ${wanted}). The page has stopped drawing.`,
              ),
            );
          }, stall);
          window.requestAnimationFrame(onFrame);
        };
        window.requestAnimationFrame(onFrame);
      }),
    [frames, stallMs] as const,
  );
}
