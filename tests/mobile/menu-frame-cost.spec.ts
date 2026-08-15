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

/**
 * How long one sample may spend at the window, and the fewest frames it will
 * accept from it.
 *
 * ── WHY THE SAMPLE IS BOUNDED BY TIME AND NOT BY FRAME COUNT (a0-00b) ──────
 * This function used to take a flat 60 frames. That is a *fixed amount of work*
 * only on a host where a frame costs about what a frame should cost, and this
 * suite's gating host is not that host: the GitHub runner rasterises WebGL in
 * software at ~1 fps (./sim-clock.ts), so "60 frames" quietly means **a minute
 * of wall clock, per sample.** The title test takes two samples and the
 * three-screen test takes four, and that arithmetic is the whole reason
 * `:164` timed out at 150 s and `:227` came in at 5.5 min against a 5.5 min
 * budget on PR #321's run — a spec measuring frame cost, priced in frames,
 * paying the very cost it is measuring.
 *
 * Sampling a fixed WINDOW instead removes the term: the sample costs ~3 seconds
 * wherever it runs, and what varies is how many frames fit in it — which is the
 * thing being measured, so varying is correct. {@link SAMPLE_MIN_FRAMES} keeps a
 * median honest on a host so slow that barely any frames arrive; it is also the
 * only path that can outrun the window, and at the ~1 fps worst case it bounds
 * one sample at ~9 s rather than ~60.
 *
 * The assertion is untouched: still the median rAF delta, still a ratio against
 * a match sampled the same way in the same page (see the header). A regression
 * of the kind this file guards was **14×**; nine samples resolve that with room
 * to spare, and the ratio's own tolerance ({@link MAX_RATIO}) is unchanged.
 */
const SAMPLE_WINDOW_MS = 3000;
const SAMPLE_MIN_FRAMES = 9;
/** A ceiling for a host fast enough to make the window pointless — 60 frames is
 *  a full second at 60 fps, and more samples than that buy no precision here. */
const SAMPLE_MAX_FRAMES = 60;

/**
 * Median rAF delta — the browser's own main-thread frame time — over a fixed
 * ~{@link SAMPLE_WINDOW_MS} window rather than a fixed frame count.
 */
async function medianFrameMs(page: Page): Promise<number> {
  return page.evaluate(
    async (cfg) => {
      const deltas: number[] = [];
      const started = performance.now();
      let last = started;
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          const now = performance.now();
          deltas.push(now - last);
          last = now;
          const enough = deltas.length >= cfg.minFrames && now - started >= cfg.windowMs;
          if (enough || deltas.length >= cfg.maxFrames) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      deltas.sort((a, b) => a - b);
      return deltas[Math.floor(deltas.length / 2)] ?? 0;
    },
    { windowMs: SAMPLE_WINDOW_MS, minFrames: SAMPLE_MIN_FRAMES, maxFrames: SAMPLE_MAX_FRAMES },
  );
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

/**
 * Boot clean to the title screen, at rest.
 *
 * `?gate=0` — the title gate (a0-50) stands in front of this screen and is a
 * DOOR, so it is animated by design and would be what a sample here measured.
 * The flag turns off that screen and nothing else; the menu, the doors and the
 * lobby below are the real ones. The door's OWN cost is not thereby unmeasured —
 * it has its own test at the foot of this file, which is what the header's rule
 * about screens that are not in this set demands.
 */
async function bootMenu(page: Page): Promise<void> {
  await page.goto('/?gate=0');
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

/**
 * The same, for a door on THE DOORS screen — those controls hang off
 * `__onlineMenu.doorControls` rather than the title's `__mainMenu.controls`, so
 * they need their own reader. Same reason for parking the pointer afterwards: a
 * hovered plate is a brighter plate, and a hover landing mid-sample redraws the
 * screen being measured.
 */
async function pressDoor(page: Page, kind: string): Promise<void> {
  const point = await page.evaluate((want) => {
    const m = (window as unknown as {
      __onlineMenu?: { doorControls: { kind: string; physicalCenter: { x: number; y: number } }[] };
    }).__onlineMenu;
    const c = m?.doorControls.find((k) => k.kind === want);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  expect(point, `the doors report where ${kind.toUpperCase()} is drawn`).not.toBeNull();
  await page.mouse.click(Math.round(point!.x), Math.round(point!.y));
  await page.mouse.move(1, 1);
}

/**
 * The title screen, and **the door standing in front of it** (a0-50).
 *
 * The gate is sampled in the same pass rather than in a test of its own, because
 * it is the same question about the same screen and it is the only place in this
 * suite that loads it at all: `?gate=0` is what keeps thirty other specs from
 * having to open a door, and a screen no harness ever renders is exactly what
 * this file's header says must not exist.
 *
 * It is the one screen here that is **allowed** to spend a frame — it is a door
 * being operated, and it paints a starfield to do it. So the ceiling is the same
 * one and for the same reason: the front of the game must not cost more than the
 * whole running game. The gate goes behind `VfxAutoQuality` in code
 * (`src/ui/title-gate.ts` `GateQuality`); this is the number that says the floor
 * is not doing all the work.
 */
test('the title screen — and the door in front of it — cost no more per frame than the live match', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'the phone profile is where fill rate bites');
  budgetTest({
    work: 'boot to the menu → sample a 3 s frame window → boot the sealed door → sample → boot the frozen match → sample → compare medians',
    measuredSeconds: 20,
  });

  // The menu, at rest. Nothing on it animates, so every frame it spends is a
  // frame spent redrawing something that did not change. (`?gate=0`: the title
  // gate in front of it IS animated, on purpose — it is sampled next.)
  await page.goto('/?gate=0');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: { visible: boolean } }).__mainMenu?.visible === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  const menuMs = await medianFrameMs(page);

  // The same boot with the door on, left SEALED — which is the expensive state
  // and the one a player looks at longest. Nothing is pressed: the four beats are
  // a gesture's business, and audio may not be armed without one.
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: { visible: boolean } }).__mainMenu?.visible === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  const gateMs = await medianFrameMs(page);

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
  // Both screens in ONE assertion, so a failure names whichever regressed rather
  // than stopping at the first — the same reason the three-screen test below
  // reports its set together.
  const over = [
    { screen: 'the static menu', ms: menuMs, why: 'The Gantry/Bone plates are ~170 translucent polygons and something has stopped caching them — see src/ui/screen-cache.ts.' },
    { screen: 'the sealed title gate', ms: gateMs, why: 'The door paints a starfield every frame and goes behind VfxAutoQuality for it — see src/ui/title-gate.ts.' },
  ].filter((s) => s.ms / matchMs >= MAX_RATIO);
  expect(
    over.map((s) => `${s.screen} costs ${s.ms.toFixed(1)}ms/frame. ${s.why}`),
    `against the live match's ${matchMs.toFixed(1)}ms/frame`,
  ).toEqual([]);
});

/**
 * The same guard, on every static Gantry screen a player can reach from the
 * title — THE DOORS, THE LOBBY, THE CODEX — in one pass against one match
 * sample.
 *
 * THE LOBBY is here rather than in a test of its own because this file's header
 * states the rule that keeps it honest: a screen added to the set and not added
 * here is a screen that can peg the runner in silence. It is also the screen that
 * would break the budget hardest — it draws around **thirty** Gantry plates
 * (eight roster rows, their leading state controls and trailing chips, four hull
 * tiles, four arena cards and two toggles) where the title screen draws three,
 * and it is the reason `src/ui/screen-cache.ts` is a shared primitive rather than
 * a title-screen detail (u7-03).
 *
 * The lobby also carries a failure the other two cannot: its `update()` runs per
 * frame against a model whose countdown holds a FLOAT, so a cache signature that
 * serialised it would re-rasterise the whole screen sixty times a second while a
 * player watches RUSH! count down — strictly worse than not caching at all. The
 * signature carries the countdown's LABEL instead (`ui/lobby-view` `signatureOf`);
 * sampling the lobby at rest catches a leak of either kind the same way.
 */
test('THE DOORS, THE LOBBY and THE CODEX cost no more per frame than the live match', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'the phone profile is where fill rate bites');
  budgetTest({
    work: 'boot the frozen match \u2192 sample a 3 s frame window \u2192 boot the menu \u2192 press PLAY (the doors) \u2192 sample \u2192 press PLAY SOLO (the lobby) \u2192 sample \u2192 back \u2192 press CODEX \u2192 sample \u2192 compare all four medians',
    measuredSeconds: 32,
  });

  // The yardstick first, so the three screens are compared against a match sampled
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

  // THE LOBBY — straight on through the door we are already standing at, so the
  // densest screen in the set costs one press rather than a second boot.
  await pressDoor(page, 'solo');
  await page.waitForFunction(
    () => (window as unknown as { __lobby?: { visible: boolean } }).__lobby?.visible === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1000);
  const lobbyMs = await medianFrameMs(page);

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

  // Every screen is reported in ONE assertion rather than one `expect` each, so a
  // failure names every screen that regressed instead of stopping at the first.
  // When this fires it is usually a shared cause (a screen family that stopped
  // caching), and seeing only the alphabetically-unlucky one sends the next reader
  // hunting for a second bug that is the same bug.
  const measured = [
    { name: 'THE DOORS', ms: doorsMs },
    { name: 'THE LOBBY', ms: lobbyMs },
    { name: 'THE CODEX', ms: codexMs },
  ];
  // Record what was measured even when it passes: this ratio is the thing that
  // creeps, and a green run that quietly moved from 1\u00d7 to 3\u00d7 is the last warning
  // before a red one.
  test.info().annotations.push({
    type: 'frame-cost',
    description:
      `match ${matchMs.toFixed(1)}ms/frame \u00b7 ` +
      measured.map((s) => `${s.name} ${s.ms.toFixed(1)}ms (${(s.ms / matchMs).toFixed(1)}\u00d7)`).join(' \u00b7 '),
  });
  const over = measured.filter((s) => s.ms / matchMs >= MAX_RATIO);
  expect(
    over.map((s) => `${s.name} ${s.ms.toFixed(1)}ms/frame (${(s.ms / matchMs).toFixed(1)}\u00d7 the match)`),
    `against the live match's ${matchMs.toFixed(1)}ms/frame, with all screens measured as ` +
      measured.map((s) => `${s.name} ${s.ms.toFixed(1)}ms`).join(', ') +
      '. A Gantry plate is ~56 translucent polygons, and a screen over the ratio is painting all of ' +
      'them every frame — it is missing its ScreenCache (src/ui/screen-cache.ts). Left alone this ' +
      'does not read as "the menu is slow": it reads as the mobile suite going red in specs nobody ' +
      'touched.',
  ).toEqual([]);
});
