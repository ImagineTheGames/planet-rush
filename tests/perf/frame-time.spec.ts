/**
 * tests/perf/frame-time.spec.ts — browser frame-time capture. OWNER: QA Agent
 * (GDD §4.3 "Browser performance budget", §4.3b risk 5, §4.6 M5 gate).
 *
 * The half of the performance gate that needs a real browser. `harness/perf.ts`
 * profiles the *simulation* headless — it costs a fraction of a millisecond per
 * tick at full entity counts, which is exactly why this file exists: the frame
 * budget is spent in the renderer, and only a browser can measure it.
 *
 * Method: boot the shipped preview bundle, let it settle, then sample
 * `requestAnimationFrame` deltas in-page for a fixed window and report the
 * distribution. Percentiles, not an average — 60 fps is a promise about the
 * *worst* frames, and a mean hides a stutter that a player feels. The page's own
 * smoothed `fps` (`window.__planetRush.fps`, the Platform Engineer's debug hook)
 * is recorded alongside as a cross-check, so a disagreement between the two is
 * itself a signal.
 *
 * **Measure always, gate only on real hardware.** GitHub's runners draw WebGL
 * through SwiftShader on a shared vCPU: a 60 fps assertion there would fail on
 * machines that have no GPU and tell us nothing about a phone. So every run
 * prints its numbers, and the assertions engage only when `PERF_GATE=1` declares
 * the host to be the hardware the gate is written about (GDD §4.3: 60 fps on
 * integrated graphics and on the developer's own phone; 30 fps floor on a
 * 3-year-old mid-range Android).
 *
 *   # measure locally (no gate)
 *   npx playwright test --config tests/perf/playwright.perf.config.ts
 *   # the M5 gate, on the developer's machine
 *   PERF_GATE=1 npx playwright test --config tests/perf/playwright.perf.config.ts
 *   # the phone gate, against a deployed build
 *   PERF_GATE=1 PERF_URL=https://…/dev npx playwright test --config tests/perf/playwright.perf.config.ts
 */
import { test, expect, type Page } from '@playwright/test';

/** 60 fps ⇒ 16.67 ms; the desktop and developer-phone gate (GDD §4.3). */
const FRAME_60_MS = 1000 / 60;
/** 30 fps ⇒ 33.3 ms; the mid-range Android floor (GDD §4.3). */
const FRAME_30_MS = 1000 / 30;

/**
 * The gate is stated on the **95th percentile**, not the worst frame. A single
 * 200 ms hitch on the frame a texture uploads is not the thing GDD §4.3 is
 * about; sustained frames over budget are. p95 is the tightest percentile that
 * survives one-off hitches honestly.
 */
const GATE_PERCENTILE = 0.95;

/** Frames sampled per capture. At 60 fps this is ~5 s — long enough for the
 *  distribution to be real, short enough to keep the suite quick. */
const SAMPLE_FRAMES = 300;

/** Frames discarded before sampling: boot, first texture uploads, and the
 *  service worker's first pass are not steady state. */
const SETTLE_FRAMES = 120;

/** True when the host has declared itself real hardware (see the module note). */
const gating = process.env.PERF_GATE === '1';

interface Capture {
  readonly frames: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** Frames per second implied by the median frame time. */
  readonly fps: number;
  /** The page's own smoothed readout, when `?debug=1` installed the hook. */
  readonly reportedFps: number | null;
  /** Fixed sim ticks executed during the capture window — the sim's own clock,
   *  independent of render throughput (debug-hook.ts). */
  readonly ticks: number | null;
}

/**
 * Sample `requestAnimationFrame` deltas in the page. Runs entirely in-page so
 * the numbers are the browser's own frame cadence, not Playwright's view of it
 * across the CDP boundary.
 */
async function capture(page: Page, frames: number, settle: number): Promise<Capture> {
  return page.evaluate(
    ({ frames, settle, pct }) =>
      new Promise<Capture>((done) => {
        const deltas: number[] = [];
        let last = performance.now();
        let seen = 0;
        // The debug hook is a shared read-only handle (debug-hook.ts); absent in
        // a build booted without ?debug=1, which is not an error here.
        const hook = (window as unknown as { __planetRush?: { fps?: number; ticks?: number } }).__planetRush;
        const ticksAtStart = typeof hook?.ticks === 'number' ? hook.ticks : null;

        const tick = (now: number): void => {
          const dt = now - last;
          last = now;
          seen++;
          if (seen > settle) deltas.push(dt);
          if (deltas.length < frames) {
            requestAnimationFrame(tick);
            return;
          }
          const sorted = [...deltas].sort((a, b) => a - b);
          const at = (p: number): number =>
            sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
          const median = at(0.5);
          const ticksNow = typeof hook?.ticks === 'number' ? hook.ticks : null;
          done({
            frames: sorted.length,
            mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
            median,
            p95: at(pct),
            p99: at(0.99),
            max: sorted[sorted.length - 1] ?? 0,
            fps: median > 0 ? 1000 / median : 0,
            reportedFps: typeof hook?.fps === 'number' ? hook.fps : null,
            ticks: ticksAtStart !== null && ticksNow !== null ? ticksNow - ticksAtStart : null,
          });
        };
        requestAnimationFrame(tick);
      }),
    { frames, settle, pct: GATE_PERCENTILE },
  );
}

/** One line per capture, always printed — this suite's primary output is the
 *  number, whether or not it is also a gate. */
function report(label: string, c: Capture): void {
  const line =
    `[perf] ${label}: ${c.frames} frames · median ${c.median.toFixed(2)} ms (${c.fps.toFixed(1)} fps) · ` +
    `mean ${c.mean.toFixed(2)} · p95 ${c.p95.toFixed(2)} · p99 ${c.p99.toFixed(2)} · max ${c.max.toFixed(2)} ms` +
    (c.reportedFps !== null ? ` · page fps ${c.reportedFps.toFixed(1)}` : '') +
    (c.ticks !== null ? ` · ${c.ticks} sim ticks` : '') +
    (gating ? ' · GATED' : ' · measure-only (PERF_GATE unset)');
  // eslint-disable-next-line no-console -- the measurement IS the output.
  console.log(line);
}

/** Boot the shipped bundle with the debug hook on, and wait for a live canvas. */
async function boot(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached' });
  // The hook only exists once the first frame has rendered; a capture started
  // before that would measure the boot, not the game.
  await page.waitForFunction(
    () => {
      const h = (window as unknown as { __planetRush?: { ticks?: number } }).__planetRush;
      return typeof h?.ticks === 'number' && h.ticks > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('frame-time capture (GDD §4.3 performance budget)', () => {
  test('steady-state frame time', async ({ page }, testInfo) => {
    await boot(page);
    const c = await capture(page, SAMPLE_FRAMES, SETTLE_FRAMES);
    report(`${testInfo.project.name} steady state`, c);

    // Always true, on any host: the page is actually animating. A renderer that
    // stopped would otherwise report a beautiful frame time forever.
    expect(c.frames).toBe(SAMPLE_FRAMES);
    expect(c.ticks === null || c.ticks > 0).toBe(true);

    testInfo.annotations.push({
      type: 'frame-time',
      description: `median ${c.median.toFixed(2)}ms p95 ${c.p95.toFixed(2)}ms (${c.fps.toFixed(1)} fps)`,
    });

    if (!gating) return;
    // The gate proper (GDD §4.3): 60 fps on the desktop/developer phone, with
    // the 30 fps floor as the hard failure line.
    expect(c.p95, `p95 frame time must clear the 30 fps floor`).toBeLessThanOrEqual(FRAME_30_MS);
    expect(c.median, `median frame time must hold 60 fps`).toBeLessThanOrEqual(FRAME_60_MS * 1.1);
  });

  test('frame time under a held input', async ({ page }, testInfo) => {
    await boot(page);
    // Thrust + fire held: the beam raycasts, the thruster trail emits, and the
    // camera moves — the frame the player actually spends most of a match in.
    await page.keyboard.down('w');
    await page.mouse.move(400, 200);
    await page.mouse.down();
    const c = await capture(page, SAMPLE_FRAMES, SETTLE_FRAMES);
    await page.mouse.up();
    await page.keyboard.up('w');
    report(`${testInfo.project.name} thrust+fire`, c);

    expect(c.frames).toBe(SAMPLE_FRAMES);
    if (!gating) return;
    expect(c.p95, `p95 frame time under input must clear the 30 fps floor`).toBeLessThanOrEqual(FRAME_30_MS);
    expect(c.median, `median frame time under input must hold 60 fps`).toBeLessThanOrEqual(FRAME_60_MS * 1.1);
  });
});
