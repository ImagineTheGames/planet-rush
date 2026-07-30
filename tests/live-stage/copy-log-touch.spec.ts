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
 * **Not in the lane it was written in.** This box has Chromium's binary but not
 * its shared libraries — `ldd headless_shell` reports `libnss3.so`, `libnspr4.so`,
 * `libdbus-1.so.3`, `libatk-1.0.so.0` and more as `not found`, and
 * `playwright install-deps` needs root the lane does not have — so every browser
 * launch dies before a single assertion runs. It is the same condition
 * `./connect-trace.spec.ts` documents against the same binary. The bundle builds
 * and `vite preview` serves; only the browser does not start.
 *
 * It needs one run on a box with those libraries:
 *
 *   npx playwright test --config tests/live-stage/playwright.copy-log.config.ts
 *
 * Until then, what IS proven and green in the DoD suite: every export route and its
 * fallback ordering (`src/net/playtest-log-export.test.ts`), the button's words,
 * its 44-px touch minimum and its markup (`src/net/playtest-log-button.test.ts`),
 * and the log's contents and bounds (`src/net/playtest-log.test.ts`). What is
 * unproven without this file is only the wiring, and the wiring is exactly the class
 * of bug this whole milestone keeps finding.
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

  await page.screenshot({ path: 'tests/live-stage/copy-log-touch-pause-evidence.png' });

  // --- The tap: a named JSON file reaches the share sheet -------------------
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForFunction(() => (window.__sharedLog?.length ?? 0) > 0, undefined, { timeout: 10_000 });

  const shared = await page.evaluate(() => window.__sharedLog![0]!);
  expect(shared.files.length, 'the log went as a FILE, not as a wall of text').toBe(1);
  expect(shared.files[0]!.name, 'named for the build it came from').toMatch(/^planet-rush-log-.+\.json$/);
  expect(shared.files[0]!.type).toBe('application/json');

  // It is a real, parseable log — the developer pastes/attaches this and it is
  // readable at the other end (`src/net/playtest-log.ts`).
  const parsed = JSON.parse(shared.files[0]!.body) as {
    env: { sha: string; touch: boolean; viewportWidth: number };
    entries: unknown[];
  };
  expect(parsed.entries.length, 'the log is not empty').toBeGreaterThan(0);
  expect(parsed.env.touch, 'the log knows it came off a touch device').toBe(true);
  expect(parsed.env.viewportWidth).toBe(viewport.width);

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
