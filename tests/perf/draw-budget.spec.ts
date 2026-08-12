/**
 * tests/perf/draw-budget.spec.ts — **the half of the performance gate that runs
 * in CI.** OWNER: Platform Engineer (a1-16, closing `docs/gdd-conformance.md`
 * G-15).
 *
 * GDD §4.3 ends *"Verified by the M5 performance gate, not assumed."* Until this
 * file existed, the renderer's half of that gate was `tests/perf/frame-time.spec.ts`
 * behind `PERF_GATE=1` — correct engineering, and a standing manual obligation
 * the GDD never described as manual. Four render-path changes landed in one
 * night (a1-11 pooling, a1-12 the viewport cull, a2-07 the VFX layer, u14-01 the
 * typefaces) against a gate documented as automatic that nobody had run.
 *
 * **What this file does and does not claim.**
 *
 * It asserts the two columns that are *architecture* — draw calls per frame and
 * entities submitted per frame on the §4.3 stress scene. Those numbers are the
 * same on a workstation, on integrated graphics and on a phone: N un-batchable
 * contexts cannot batch anywhere, and an entity the cull skipped is submitted
 * nowhere. A CI runner can honestly assert them.
 *
 * It asserts **no frame time at all**, and `draw-budget.rig.ts` does not even
 * measure one. GitHub's runners draw through SwiftShader on a shared vCPU; a
 * green "60 fps" from a box with no GPU is worse than no claim, because it is a
 * claim that reads as verification. The milliseconds stay with
 * `PERF_GATE=1 npx playwright test --config tests/perf/playwright.perf.config.ts`
 * on real hardware, manually, and `docs/perf-gate.md` says when that is required.
 *
 * The thresholds live in `./budget.ts` with their provenance and their arithmetic.
 * Each has a **floor** under it as well as a ceiling: a renderer that crashed
 * submits nothing, and against a ceiling alone that reads as a triumph.
 *
 *   npm run test:perf-budget                    # the gate
 *   PERF_BUDGET_SCALE=0.5 npm run test:perf-budget   # …and prove it can go red
 */
import { test, expect, type Page } from '@playwright/test';
import { PROFILE_BUDGETS, type ProfileBudget } from './budget';

interface ProfileReading {
  readonly name: string;
  readonly entities: number;
  readonly submitted: number;
  readonly drawCallsPerFrame: number;
}

interface RigPayload {
  readonly gpu: string;
  readonly userAgent: string;
  readonly warmupFrames: number;
  readonly countedFrames: number;
  readonly profiles: readonly ProfileReading[];
  readonly error?: string;
}

/**
 * A deliberate tightening, and it can only ever tighten.
 *
 * LESSONS §24: a gate nobody has seen fail is not known to be a gate. Proving
 * this one bites should not require editing the thresholds and remembering to
 * put them back, so the knob is permanent — and it is `Math.min(1, …)` so that
 * it is *incapable* of loosening the budget. A workflow file, a local shell, or
 * a future agent in a hurry cannot use this to make a red gate green.
 */
const SCALE = Math.min(1, Number(process.env.PERF_BUDGET_SCALE ?? 1) || 1);

/** One page load for every profile: the rig walks them itself, and booting a
 *  browser per screen would double a CI job to learn nothing. */
let payload: RigPayload;

test.beforeAll(async ({ browser }) => {
  const page: Page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/tests/perf/draw-budget.html');
  // Generous: the rig renders 100 frames per profile through software WebGL on a
  // shared runner, and a slow honest run must not read as a broken one.
  await page.waitForFunction(() => (window as unknown as { __drawBudget?: unknown }).__drawBudget !== undefined, undefined, {
    timeout: 300_000,
  });
  payload = (await page.evaluate(() => (window as unknown as { __drawBudget?: RigPayload }).__drawBudget)) as RigPayload;
  await page.close();

  if (payload?.error) throw new Error(`the rig failed in-page: ${payload.error}\n${errors.join('\n')}`);

  // eslint-disable-next-line no-console -- the measurement IS the output.
  console.log(
    `[draw-budget] box: ${payload.gpu}\n` +
      `[draw-budget] ${payload.warmupFrames} warm-up + ${payload.countedFrames} counted frames per profile` +
      (SCALE < 1 ? ` · thresholds tightened ×${SCALE} (PERF_BUDGET_SCALE)` : ''),
  );
});

function readingFor(budget: ProfileBudget): ProfileReading {
  const reading = payload.profiles.find((p) => p.name === budget.name);
  if (!reading) {
    throw new Error(
      `the rig reported no reading for '${budget.name}' — it reported ` +
        `[${payload.profiles.map((p) => p.name).join(', ')}]. budget.ts and draw-budget.rig.ts have drifted apart.`,
    );
  }
  return reading;
}

for (const budget of PROFILE_BUDGETS) {
  test.describe(`${budget.name} (${budget.width}×${budget.height})`, () => {
    test('submits a windowful, not an arena', () => {
      const r = readingFor(budget);
      // eslint-disable-next-line no-console -- the measurement IS the output.
      console.log(
        `[draw-budget] ${budget.name}: ${r.drawCallsPerFrame.toFixed(1)} draw calls/frame ` +
          `(≤ ${budget.maxDrawCalls * SCALE}, measured ${budget.measured.drawCalls}) · ` +
          `${r.submitted} of ${r.entities} entities submitted ` +
          `(≤ ${budget.maxSubmitted * SCALE}, measured ${budget.measured.submitted})`,
      );

      // The floors first, and they are not a formality: a renderer that threw on
      // boot, a scene that failed to build, or a cull with an inverted test all
      // report zero, and zero beats every ceiling in this file.
      expect(
        r.entities,
        'the rig must be drawing the GDD §4.3 stress scene, not an empty world',
      ).toBeGreaterThan(200);
      expect(
        r.drawCallsPerFrame,
        'nothing was drawn — a dead renderer is not a fast one',
      ).toBeGreaterThanOrEqual(budget.minDrawCalls);
      expect(
        r.submitted,
        'the window submitted almost nothing — check the cull for an inverted test',
      ).toBeGreaterThanOrEqual(budget.minSubmitted);

      // The budget proper. See ./budget.ts for where each number came from and
      // why the margin is the size it is. If you are here because this went red:
      // the renderer's submission shape changed. Re-measure with
      // `node spikes/atlas-pooling/run.mjs`, decide whether the change is worth
      // its cost, and move the baseline WITH the measurement — do not raise the
      // ceiling to fit the run.
      expect(
        r.drawCallsPerFrame,
        `draw calls per frame on ${budget.name} (baseline ${budget.measured.drawCalls}, ` +
          `263 before a1-11's pooling, 32.1 before a1-12's cull)`,
      ).toBeLessThanOrEqual(budget.maxDrawCalls * SCALE);
      expect(
        r.submitted,
        `entities submitted per frame on ${budget.name} (baseline ${budget.measured.submitted} of ${r.entities})`,
      ).toBeLessThanOrEqual(budget.maxSubmitted * SCALE);
    });
  });
}

test('the phone submits less than the desktop off the same field', () => {
  const desktop = payload.profiles.find((p) => p.name === 'desktop');
  const phone = payload.profiles.find((p) => p.name === 'phone-landscape');
  expect(desktop, 'desktop reading').toBeTruthy();
  expect(phone, 'phone reading').toBeTruthy();

  // Before a1-12 these two numbers were EQUAL, and that equality was the whole
  // finding: the same field cost the same submissions however little of it the
  // device could show. GDD §4.3's binding gate is the phone, so this ordering is
  // the shape of the fix and not a nicety — it goes red the moment the cull
  // stops being a function of the window.
  expect(phone!.submitted).toBeLessThan(desktop!.submitted);
  expect(phone!.entities).toBe(desktop!.entities);
});
