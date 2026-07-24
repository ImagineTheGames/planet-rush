/**
 * Post-deploy live boot check — OWNER: QA (authored by the Director during the
 * 2026-07-23 stale-service-worker incident; the game shipped dead to a real
 * phone because nothing verified the DEPLOYED url actually boots).
 *
 * Loads the live page twice: the first visit installs the service worker, the
 * second is served THROUGH it — the exact path that bricked. Fails on any page
 * error, any failed same-origin request, or a canvas that never draws.
 *
 * A third scenario was added by the Platform Engineer after the 2026-07-24
 * no-WebGL incident (Chrome's GPU process wedged on an RTX 4090 machine and the
 * game died to a black screen with only `autoDetectRenderer: CanvasRenderer is
 * not yet implemented` in the console). It launches Chromium with WebGL switched
 * off and asserts the player gets the FRIENDLY screen — that day's failure is now
 * a permanently tested path, not a story.
 */
import { test, expect, chromium } from '@playwright/test';

const LIVE_URL = process.env.LIVE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

async function bootOnce(page: import('@playwright/test').Page, label: string) {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(new URL(LIVE_URL).origin)) {
      failedRequests.push(`${r.status()} ${r.url()}`);
    }
  });

  await page.goto(LIVE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(2500); // boot + first frames + SW install

  expect(pageErrors, `${label}: page errors`).toEqual([]);
  expect(failedRequests, `${label}: failed same-origin requests`).toEqual([]);

  const canvas = page.locator('canvas');
  await expect(canvas, `${label}: canvas mounts`).toHaveCount(1);
  const box = await canvas.boundingBox();
  expect(box && box.width > 100 && box.height > 100, `${label}: canvas has size`).toBe(true);
}

test('live deploy boots — fresh visit, then through the service worker', async ({ page }) => {
  await bootOnce(page, 'visit 1 (fresh)');
  // Second navigation: the just-installed service worker now controls fetches —
  // the code path that served a stale index in the incident.
  await bootOnce(page, 'visit 2 (via service worker)');
});

// ---------------------------------------------------------------------------
// No WebGL: the 2026-07-24 black-screen incident, permanently tested.
// ---------------------------------------------------------------------------

/**
 * Flags that reproduce the wedged-GPU machine the honest way: take WebGL away
 * from the browser. `--disable-webgl` matches the symptom (a context that cannot
 * be created); `--disable-webgl2` covers the WebGL2 path Pixi asks for first.
 * Deliberately NOT `--disable-gpu`, which falls back to SwiftShader and still
 * draws — the game is expected to run there, just slower.
 */
const NO_WEBGL_ARGS = ['--disable-webgl', '--disable-webgl2'];

/** Emulation settings from the active project (viewport, DPR, touch, UA), so the
 *  no-WebGL run is still a phone on the phone project. Copied key by key because
 *  Playwright forbids `test.use({ launchOptions })` inside a describe — the
 *  browser has to be launched by hand, which means rebuilding the context. */
function projectEmulation(): Parameters<import('@playwright/test').Browser['newContext']>[0] {
  const use = test.info().project.use as Record<string, unknown>;
  const opts: Record<string, unknown> = {};
  for (const key of ['viewport', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch']) {
    if (use[key] !== undefined) opts[key] = use[key];
  }
  return opts;
}

test.describe('no WebGL — the friendly screen, never a black page', () => {
  test('explains itself in plain words, names the build, and offers Retry', async () => {
    const browser = await chromium.launch({ args: NO_WEBGL_ARGS });
    const context = await browser.newContext(projectEmulation());
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    try {
      await page.goto(LIVE_URL, { waitUntil: 'load' });

      // 0. Precondition, asserted rather than assumed: the flags really did take
      //    WebGL away. If a future Chromium ignores them this scenario would
      //    silently start testing nothing, so it fails here — loudly, and naming
      //    the reason — instead of somewhere confusing further down.
      const webglGone = await page.evaluate(() => {
        try {
          const c = document.createElement('canvas');
          return !c.getContext('webgl2') && !c.getContext('webgl');
        } catch {
          return true;
        }
      });
      expect(webglGone, '--disable-webgl must actually remove WebGL, or this test proves nothing').toBe(true);

      // 1. The screen is up — this is the assertion the incident was missing.
      const screen = page.locator('#boot-error');
      await expect(screen, 'friendly boot-error screen appears').toBeVisible({ timeout: 15_000 });
      await expect(screen).toHaveAttribute('data-kind', 'no-webgl');

      // 2. It says what happened in words a player can act on — no stack trace as
      //    the headline, no "CanvasRenderer is not yet implemented" as the whole
      //    story.
      await expect(screen.locator('h1')).toContainText(/could not start WebGL/i);
      await expect(screen).toContainText(/quit the browser/i);
      await expect(screen).toContainText('chrome://gpu');

      // 3. It names the build, so a screenshot of this screen is a filable report
      //    (the same `<sha> · <HH:MM>Z` stamp as the in-game corner badge).
      await expect(screen.locator('.pr-boot-build')).toContainText(/[0-9a-f]{7}\*?|dev\*?/);

      // 4. Retry is there and usable — a 44px touch target on a phone, too.
      const retry = page.locator('#boot-error-retry');
      await expect(retry).toBeEnabled();
      const box = await retry.boundingBox();
      expect(box && box.width >= 44 && box.height >= 44, 'Retry is a real touch target').toBe(true);

      // 5. Retry re-probes rather than pretending: WebGL is still gone, so the
      //    page must NOT reload into the same failure — it must say so.
      await retry.click();
      await expect(page.locator('#boot-error-status')).toContainText(/still no webgl/i);
      await expect(screen, 'the screen survives a failed retry').toBeVisible();

      // 6. And the black screen is genuinely gone: no canvas was ever mounted, and
      //    the failure was handled rather than thrown at the console.
      await expect(page.locator('canvas'), 'no dead canvas under the message').toHaveCount(0);
      expect(pageErrors, 'the failure is handled, not an unhandled error').toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
