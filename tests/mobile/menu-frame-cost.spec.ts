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
 *
 * ── WHY IT COVERS EVERY GANTRY SCREEN, NOT JUST THE TITLE (a1-01) ──────────
 * It came back. u7-04 re-skinned the two screens the handoff's list forgot — THE
 * DOORS and THE CODEX — in the same material, and neither took the cache, because
 * this gate only ever measured the TITLE screen. The failure reproduced the u7-01
 * signature exactly: on the software-GL runner `page.screenshot`, `page.evaluate`
 * and `waitForFunction` all timed out on any test that walked through the doors,
 * and `campaign-door.spec.ts`'s first test went from 39 s green to >120 s timed
 * out. Sixteen tests red across four specs, two of them (`slot-state`,
 * `landscape-lock`) in files that branch never touched — they only *pass through*
 * the doors on their way to the lobby.
 *
 * So the ratio is now asserted for **every static Gantry screen the player can
 * reach from the title**, in one pass, against one match sample. A screen added to
 * the set and not added here is a screen that can peg the runner in silence, which
 * is the expensive thing this file exists to prevent — twice now.
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

/** The frozen match's median frame time — the yardstick every screen is measured
 *  against, sampled in the same page on the same machine (see the header). */
async function matchFrameMs(page: Page): Promise<number> {
  await page.goto('/?debug=1&freeze=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __planetRush?: { frozen?: boolean } }).__planetRush?.frozen === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  return medianFrameMs(page);
}

/** Boot clean to the title screen, at rest. */
async function bootMenu(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __mainMenu?: { visible: boolean; controls: unknown[] } }).__mainMenu;
      return !!m && m.visible && m.controls.length > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Press one of the title screen's own plates, at the point the app reports it
 * drew it. A mouse click rather than a CDP touch on purpose: this test measures
 * fill rate, not input, and the menu answers a click on every profile.
 *
 * The pointer is parked off every plate afterwards, because a hovered plate is a
 * brighter plate and a hover that lands mid-sample would redraw the screen —
 * which is the very thing being measured.
 */
async function pressMenuControl(page: Page, kind: string): Promise<void> {
  const point = await page.evaluate((want) => {
    const m = (window as unknown as {
      __mainMenu?: { controls: { kind: string; physicalCenter: { x: number; y: number } }[] };
    }).__mainMenu;
    const c = m?.controls.find((k) => k.kind === want);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  expect(point, `the menu reports where ${kind.toUpperCase()} is drawn`).not.toBeNull();
  await page.mouse.click(Math.round(point!.x), Math.round(point!.y));
  await page.mouse.move(1, 1);
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

test('THE DOORS and THE CODEX cost no more per frame than the live match', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'the phone profile is where fill rate bites');
  budgetTest({
    work: 'boot the frozen match → sample 60 frames → boot the menu → press PLAY (the doors) → sample → back → press CODEX → sample → compare both medians against the match',
    measuredSeconds: 30,
  });

  // The yardstick first, so the two screens are compared against a match sampled
  // on this machine in this run — the same self-calibration the title test uses.
  const matchMs = await matchFrameMs(page);
  expect(matchMs, 'the match sampled a sane frame time to compare against').toBeGreaterThan(0);

  await bootMenu(page);

  // THE DOORS — the first screen a player touches after PLAY, and the one every
  // menu-booting spec in this suite walks through on its way to the lobby. When
  // this went uncached it did not fail here; it failed in `slot-state.spec.ts`.
  await pressMenuControl(page, 'play');
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: { visible: boolean } }).__onlineMenu?.visible === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  const doorsMs = await medianFrameMs(page);

  // THE CODEX — the densest screen in the game: a tab row, a rail of row plates
  // and an article, all in the same stepped material.
  await bootMenu(page);
  await pressMenuControl(page, 'codex');
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: { screen: string } }).__mainMenu?.screen === 'codex',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  const codexMs = await medianFrameMs(page);

  // Both screens are reported in ONE assertion rather than one `expect` each, so a
  // failure names every screen that regressed instead of stopping at the first.
  // When this fires it is usually a shared cause (a screen family that stopped
  // caching), and seeing only the alphabetically-unlucky one sends the next reader
  // hunting for a second bug that is the same bug.
  const measured = [
    { name: 'THE DOORS', ms: doorsMs },
    { name: 'THE CODEX', ms: codexMs },
  ];
  // Record what was measured even when it passes: this ratio is the thing that
  // creeps, and a green run that quietly moved from 1× to 3× is the last warning
  // before a red one.
  test.info().annotations.push({
    type: 'frame-cost',
    description:
      `match ${matchMs.toFixed(1)}ms/frame · ` +
      measured.map((s) => `${s.name} ${s.ms.toFixed(1)}ms (${(s.ms / matchMs).toFixed(1)}×)`).join(' · '),
  });
  const over = measured.filter((s) => s.ms / matchMs >= MAX_RATIO);
  expect(
    over.map((s) => `${s.name} ${s.ms.toFixed(1)}ms/frame (${(s.ms / matchMs).toFixed(1)}× the match)`),
    `against the live match's ${matchMs.toFixed(1)}ms/frame, with all screens measured as ` +
      measured.map((s) => `${s.name} ${s.ms.toFixed(1)}ms`).join(', ') +
      '. A Gantry plate is ~56 translucent polygons, and a screen over the ratio is painting all of ' +
      'them every frame — it is missing its ScreenCache (src/ui/screen-cache.ts). Left alone this ' +
      'does not read as "the menu is slow": it reads as the mobile suite going red in specs nobody ' +
      'touched.',
  ).toEqual([]);
});
