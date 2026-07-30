/**
 * tests/live-stage/copy-log-touch.spec.ts — the log leaves the phone. In a hand.
 * OWNER: Netcode Engineer (M10 action-echo §5).
 *
 * *"MOBILE LOGS (the developer had NO way to send them): COPY LOG on the touch
 * pause menu; use navigator.share when available (share sheet), clipboard fallback,
 * download last resort. Live-stage on a phone profile proves an export path exists
 * on touch."*
 *
 * The unit suite proves the routes and their ordering with no browser at all
 * (`src/net/playtest-log-export.test.ts`: share → clipboard → download, each falling
 * through silently, the final failure honest). What it structurally cannot prove is
 * the sentence the developer actually cares about: **on a phone, in a real match,
 * with a thumb, is there a way out?** That is three things a unit test does not
 * touch — the affordance being *mounted* by the shipped bundle, being *reachable*
 * on a portrait touch viewport, and its press *reaching* the export at all.
 *
 * So this boots the real preview bundle at a phone profile
 * (`playwright.copy-log.config.ts`: 390×844 portrait, DPR 3, `hasTouch`), opens the
 * pause menu the way a thumb does, and taps COPY LOG for real — with
 * `navigator.share` installed in the page as a recorder, so the assertion is not
 * "the button changed colour" but *"a named JSON file was handed to the share sheet,
 * and it parses"*.
 *
 * Two evidence photographs, both in portrait:
 *
 *   copy-log-touch-pause-evidence.png  — the pause menu with COPY LOG on it,
 *                                        at a phone's size, above the safe area
 *   copy-log-touch-shared-evidence.png — after the tap: LOG SENT, and the line
 *                                        that tells the developer where it went
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * **Yes — green, both tests, on the phone profile, against the shipped bundle.**
 * Evidence: the two PNGs above.
 *
 *   npx playwright test --config tests/live-stage/playwright.copy-log.config.ts
 *
 * It did not run when it was written: the lane has Chromium's binary but not its
 * shared libraries (`ldd headless_shell` → `libnss3.so`, `libnspr4.so`,
 * `libdbus-1.so.3`, `libatk-1.0.so.0` and 13 more `not found`), and
 * `playwright install-deps` needs a root this box does not have. The way through
 * needs no root: `apt-get download` the library packages, `dpkg-deb -x` them into a
 * prefix, and put that prefix on `LD_LIBRARY_PATH` for the run —
 * `docs/netcode-action-echo.md` records the exact recipe. The same unblocks
 * `./connect-trace.spec.ts`, which documents the same condition.
 *
 * And it earned its run on the first one. Two assertions here had been written
 * against a payload shape that does not exist — `entries` for `events`, a
 * `viewportWidth` number for the `"390x844"` string `PlaytestLogEnvironment`
 * actually carries. Both were plausible, neither was real, and nothing else in the
 * suite could have said so: the unit tests import the type and so cannot disagree
 * with it. A test that has never executed is a claim, not evidence — which is the
 * same lesson as the wiring bugs this milestone kept finding, aimed at the tests.
 *
 * Alongside it, with no browser at all: every export route and its fallback ordering
 * (`src/net/playtest-log-export.test.ts`), the button's words, its 44-px touch
 * minimum and its markup (`src/net/playtest-log-button.test.ts`), and the log's
 * contents and bounds (`src/net/playtest-log.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';

/** The DOM ids the affordance mounts under (`src/net/playtest-log-button.ts`) —
 *  restated rather than imported, because a spec that imports the module under test
 *  can pass while the *bundle* mounts nothing. */
const ROOT_ID = 'playtest-copy-log';
const BUTTON_ID = 'playtest-copy-log-button';
const HINT_ID = 'playtest-copy-log-hint';

/** What a tapped share sheet recorded, read back out of the page. */
interface SharedRecord {
  title: string;
  text: string;
  files: { name: string; type: string; body: string }[];
}

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface PauseRead {
  readonly open: boolean;
  readonly simTicks: number;
  readonly buttonPoint: PhysicalPoint;
}
interface StageWindow {
  __pauseStage?: { read(): PauseRead };
  __sharedLog?: SharedRecord[];
}
declare const window: Window & StageWindow;

/** Boot straight into an offline match on the phone profile. */
async function bootMatch(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => window.__pauseStage!.read().simTicks > 5, undefined, {
    timeout: 10_000,
  });
  return pageErrors;
}

/**
 * Install a `navigator.share` the page will actually use, recording what it is
 * handed. Injected *before* the tap so the shipped export picks it up on its own
 * lookup — nothing about the client is stubbed, only the platform capability a
 * headless Chromium does not have.
 */
async function armShareSheet(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__sharedLog = [];
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    nav.canShare = () => true;
    nav.share = async (data: ShareData): Promise<void> => {
      const files = await Promise.all(
        (data.files ?? []).map(async (f) => ({ name: f.name, type: f.type, body: await f.text() })),
      );
      window.__sharedLog!.push({ title: data.title ?? '', text: data.text ?? '', files });
    };
  });
}

/**
 * Hold the button's answer on screen for the photograph.
 *
 * The affordance reverts itself to COPY LOG {@link REVERT_MS} after it reports —
 * correct behaviour, and covered twice in the unit suite (`playtest-log-button.test.ts`
 * proves both the revert and that a stale one cannot wipe a newer press's answer). But
 * it races the evidence screenshot: at DPR 3 a 1170×2532 capture of a rotated,
 * composited page is not always inside four seconds, and the first green run of this
 * file photographed a button that had already reverted — a shot whose filename claimed
 * something it no longer showed.
 *
 * So the revert timer alone is suppressed for the capture. Only timers at or past the
 * revert delay: everything shorter — the game loop, the export itself — runs untouched,
 * and the assertions below still read the real DOM the real export wrote.
 */
async function holdConfirmation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const native = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
      (ms ?? 0) >= 4000 ? 0 : native(fn, ms, ...rest)) as typeof window.setTimeout;
  });
}

/** Open the pause menu the way a thumb does: a real tap on the corner affordance
 *  the client itself drew, at the point the client says it drew it. */
async function tapPause(page: Page): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const point = await page.evaluate(() => window.__pauseStage!.read().buttonPoint);
  await page.touchscreen.tap(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => window.__pauseStage!.read().open === true, undefined, {
    timeout: 5_000,
  });
}

test('COPY LOG is on the touch pause menu, and a tap sends the log to the share sheet', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);
  await armShareSheet(page);
  await holdConfirmation(page);

  // --- It is not there during play ------------------------------------------
  // The match owns the screen; a floating diagnostic over the HUD is exactly the
  // chrome the HUD budget refuses (GDD §2.2).
  expect(await page.locator(`#${BUTTON_ID}`).count(), 'no COPY LOG over a live match').toBe(0);

  // --- Pause: it appears, and a thumb can hit it ----------------------------
  await tapPause(page);
  const button = page.locator(`#${BUTTON_ID}`);
  await expect(button, 'COPY LOG is offered on the pause menu (brief §2)').toBeVisible();
  await expect(button).toHaveText(/COPY LOG/);

  const box = await button.boundingBox();
  expect(box, 'the button has a box on a phone viewport').not.toBeNull();
  // The mobile amendment's touch minimum: 44 CSS px in both directions. A log the
  // developer cannot hit is a log the developer does not have.
  expect(box!.height, 'a real touch target, tall enough').toBeGreaterThanOrEqual(44);
  expect(box!.width, 'a real touch target, wide enough').toBeGreaterThanOrEqual(44);
  // And inside the portrait viewport, not off the edge past the safe-area inset.
  const viewport = page.viewportSize()!;
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

  // --- It turned with the game -----------------------------------------------
  // Planet Rush is landscape on mobile always: on a touch viewport held portrait the
  // game root is rotated +90° (`@platform/orientation`). This affordance is DOM over
  // the canvas and does not get that for free, so it carries the rotation itself
  // (`src/net/playtest-log-button.ts`). Without it, it is the one element on the
  // screen reading sideways — and a log the developer has to tilt their head to find
  // is most of the way back to having no way to send one. `rotate(90deg)` computes to
  // `matrix(0, 1, -1, 0, …)`; asserted on the real bundle because a media query that
  // does not match ships as silently as one that does.
  const matrix = await page.evaluate(
    (id) => getComputedStyle(document.getElementById(id)!).transform,
    ROOT_ID,
  );
  expect(matrix, 'the affordance turns with the landscape lock').toMatch(
    /^matrix\(0,\s*1,\s*-1,\s*0,/,
  );
  // Logical bottom-right — where it sits unrotated — is the PHYSICAL bottom-left
  // under that transform. Left half of the screen, bottom half.
  expect(box!.x, 'anchored to the physical left edge').toBeLessThan(viewport.width / 2);
  expect(box!.y + box!.height, 'and the physical bottom').toBeGreaterThan(viewport.height / 2);

  await page.screenshot({ path: 'tests/live-stage/copy-log-touch-pause-evidence.png' });

  // --- The tap: a named JSON file reaches the share sheet -------------------
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForFunction(() => (window.__sharedLog?.length ?? 0) > 0, undefined, { timeout: 10_000 });

  const shared = await page.evaluate(() => window.__sharedLog![0]!);
  expect(shared.files.length, 'the log went as a FILE, not as a wall of text').toBe(1);
  expect(shared.files[0]!.name, 'named for the build it came from').toMatch(/^planet-rush-log-.+\.json$/);
  expect(shared.files[0]!.type).toBe('application/json');

  // It is a real, parseable log — the developer pastes/attaches this and it is
  // readable at the other end. The field names are `PlaytestLogExport`'s
  // (`src/net/playtest-log.ts`): `events`, and an `env` whose viewport is the
  // `"390x844"` string the header carries, not a pair of numbers.
  const parsed = JSON.parse(shared.files[0]!.body) as {
    schema: string;
    summary: string;
    env: { sha: string; touch: boolean; viewport: string; formFactor: string };
    events: unknown[];
  };
  expect(parsed.events.length, 'the log is not empty').toBeGreaterThan(0);
  expect(parsed.summary, 'the top of the paste reads as a sentence').toMatch(/Planet Rush playtest log/);
  expect(parsed.env.touch, 'the log knows it came off a touch device').toBe(true);
  // The header describes the device the report came from — a phone. This is the
  // one assertion no desk profile can make, and the reason this config exists.
  expect(parsed.env.formFactor, 'and that the device was a phone').toBe('phone');
  expect(parsed.env.viewport).toBe(`${viewport.width}x${viewport.height}`);

  // --- And the button says where it went ------------------------------------
  await expect(button).toHaveText(/LOG SENT/);
  await expect(page.locator(`#${HINT_ID}`)).toHaveText(/share sheet/);
  await page.screenshot({ path: 'tests/live-stage/copy-log-touch-shared-evidence.png' });

  expect(pageErrors, 'no page errors across pause → export').toEqual([]);
});

test('with no share sheet, the same tap still gets the log out — clipboard', async ({ page }) => {
  test.setTimeout(90_000);
  await bootMatch(page);
  // A phone browser with no Web Share (or an older WebView): the export must fall
  // through rather than dead-end, which is the whole reason the fallbacks exist.
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator, 'share');
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await tapPause(page);
  const button = page.locator(`#${BUTTON_ID}`);
  const box = await button.boundingBox();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);

  await expect(button, 'the clipboard route reports itself honestly').toHaveText(/LOG COPIED|LOG SAVED/);
  await expect(page.locator(`#${ROOT_ID}`)).toBeVisible();
});
