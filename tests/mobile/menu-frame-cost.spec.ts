/**
 * tests/mobile/menu-frame-cost.spec.ts — the front door must not peg the main
 * thread. OWNER: UI Engineer (u7-01).
 *
 * ── THE LESSON THIS FILE ENCODES ───────────────────────────────────────────
 * The Gantry/Bone material is *stepped*: a plate's face is 24 flat bands, its
 * sheen 12 nested translucent polygons, its bezel 8, its cast shadow 12 more
 * (`src/art/materials.ts`). That is what makes the screens read as material
 * instead of as a wireframe, and it is ratified — but it is also ~56 large,
 * overlapping, mostly-translucent polygons per plate, ~170 on the title screen.
 *
 * Pixi keeps that geometry retained, so it is only rebuilt on a state change. It
 * is however *painted* every frame, and when u7-01 first re-skinned these
 * screens nothing cached that paint. Measured on the iPhone profile against the
 * real preview build:
 *
 *     menu screen, per frame : ~957 ms   (about one frame per second)
 *     the whole LIVE MATCH   :  ~66 ms
 *
 * The static front door cost fourteen times what the running game cost. On a
 * developer machine that merely wastes a core. On the software-GL CI runner it
 * pegged the page's main thread, and a pegged main thread cannot answer
 * Playwright: `waitForSelector` timed out at 30 s having *already resolved the
 * canvas*. Eleven tests failed, four of them in specs that branch never touched
 * — the menu-booting tests in `landscape-lock.spec.ts` and `slot-state.spec.ts`
 * — while every `?debug=1` test (which skips the menu) sailed through.
 *
 * `src/ui/screen-cache.ts` fixed it by rasterising each static screen once and
 * blitting it thereafter: 957 ms → 53 ms, on par with the match, with the
 * goldens still passing unchanged.
 *
 * This test exists so that cannot come back silently. A regression here does not
 * announce itself as "the menu is slow" — it announces itself as half the mobile
 * suite going red in files nobody touched, which is an expensive thing to have
 * to re-diagnose.
 *
 * ── WHY THE ASSERTION IS A RATIO ───────────────────────────────────────────
 * A fixed millisecond ceiling would be a flake generator: this suite runs on
 * hardware GL locally and software GL on the runner, ~6× apart (./budgets.ts),
 * and any absolute number is either too loose there or too tight here. So the
 * menu is measured against **the live match, in the same run, on the same
 * machine** — the heaviest screen the game legitimately draws. The front door
 * being no more expensive than the whole game is the actual invariant, it is
 * self-calibrating, and it is the one the regression broke by 14×.
 */
import { test, expect, type Page } from '@playwright/test';
import { budgetTest } from './budgets';

/**
 * How many times the static menu may cost what the live match costs.
 *
 * Measured after the fix: ~1.0× (53 ms vs 55 ms). Measured before it: 14.5×.
 * Four leaves room for an unlucky sample on a noisy runner while still catching
 * anything close to the regression this guards.
 */
const MAX_RATIO = 4;

/** Median rAF delta over `frames` — the browser's own main-thread frame time. */
async function medianFrameMs(page: Page, frames = 60): Promise<number> {
  return page.evaluate(async (n) => {
    const deltas: number[] = [];
    let last = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (deltas.length >= n) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)] ?? 0;
  }, frames);
}

test('the static title screen costs no more per frame than the live match', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'the phone profile is where fill rate bites');
  budgetTest({
    work: 'boot to the menu → sample 60 frames → boot the frozen match → sample 60 frames → compare medians',
    measuredSeconds: 14,
  });

  // The menu, at rest. Nothing on it animates, so every frame it spends is a
  // frame spent redrawing something that did not change.
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: { visible: boolean } }).__mainMenu?.visible === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  const menuMs = await medianFrameMs(page);

  // The live match in the same page, as the yardstick: a full world, its HUD and
  // its VFX. This is the most the game legitimately asks of a frame.
  await page.goto('/?debug=1&freeze=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __planetRush?: { frozen?: boolean } }).__planetRush?.frozen === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  const matchMs = await medianFrameMs(page);

  expect(matchMs, 'the match sampled a sane frame time to compare against').toBeGreaterThan(0);
  expect(
    menuMs / matchMs,
    `the static menu costs ${menuMs.toFixed(1)}ms/frame against the live match's ${matchMs.toFixed(1)}ms/frame. ` +
      'The Gantry/Bone plates are ~170 translucent polygons and something has stopped caching them — ' +
      'see src/ui/screen-cache.ts.',
  ).toBeLessThan(MAX_RATIO);
});
