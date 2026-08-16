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
 *
 * ── WHAT a0-66 CHANGED, 2026-08-16 (Platform Engineer) ──────────────────────
 * Two things, and NEITHER is a loosened assertion. This check went red on the
 * merge of a0-50 (the title gate) and stayed red for 14 merges, which is 14
 * merges of "the last good build keeps serving".
 *
 *  1. `toHaveCount(1)` had DRIFTED. The client mounts two canvases now and both
 *     belong: the Pixi game canvas, and the title gate's own sky canvas inside
 *     the DOM overlay it mounts above it (`src/ui/title-gate.ts`, a0-50 — the
 *     doorway punch reveals the REAL menu, which is why the gate is an overlay
 *     and not a Pixi port). A count is the wrong shape for that: `2` is only
 *     right if it is those exact two. So the check now names them — see
 *     {@link EXPECTED_CANVASES}. `.first()` would have gone green in one line
 *     and this gate is the last thing between a broken deploy and the
 *     developer's phone; a third canvas, a canvas that moved out of `#app`, or
 *     a title gate that stopped mounting all still fail here.
 *
 *  2. The file's own headline — *"the first visit installs the service worker,
 *     the second is served THROUGH it"* — was not true and had not been true for
 *     a long time. `boot()` registered the worker after `await
 *     mainMenu.untilPlay()`, so it only ever ran for a player already in a
 *     match: on the live deploy, `getRegistrations()` was `[]` after 10 s and
 *     `controller` was `null` on the reload. The registration moved to the top
 *     of `boot()` (`@platform/service-worker`), and visit 2 now ASSERTS a
 *     controller, so this scenario can never quietly stop exercising the
 *     incident it was written for again.
 */
import { test, expect, chromium, type Page } from '@playwright/test';

const LIVE_URL = process.env.LIVE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

/**
 * Every canvas the booted client is allowed to have, named, in DOM order.
 *
 * `parentId > id` — an empty `id` is a canvas with none, which is how Pixi mounts
 * the game canvas. Compared as a whole list, so this is an exhaustive statement
 * about the page and not a "contains" check:
 *
 *  - `app > ` — the Pixi game canvas, a direct child of `#app` (`src/main.ts`).
 *  - `pr-title-gate > pr-title-gate-sky` — the title gate's star field, inside
 *    the DOM overlay it mounts above the game canvas (`src/ui/title-gate.ts`).
 */
const EXPECTED_CANVASES = ['app > ', 'pr-title-gate > pr-title-gate-sky'] as const;

/** Every `<canvas>` on the page as `parentId > id`, in DOM order. */
function canvasRoll(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map((c) => `${c.parentElement?.id ?? '(detached)'} > ${c.id}`),
  );
}

async function bootOnce(page: Page, label: string) {
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

  // Polled rather than read once: the gate's overlay is mounted during boot, so a
  // slow runner must be allowed to arrive at the right page — but only at THIS
  // page. Any other set of canvases is a failure, however long it waits.
  await expect
    .poll(() => canvasRoll(page), { message: `${label}: canvas mounts`, timeout: 15_000 })
    .toEqual([...EXPECTED_CANVASES]);

  // Size is asserted on the GAME canvas specifically — `#app > canvas` is the
  // Pixi one; the gate's sky lives a level deeper and is not what has to draw the
  // world. A zero-sized game canvas is the black screen with the lights on.
  const box = await page.locator('#app > canvas').boundingBox();
  expect(box && box.width > 100 && box.height > 100, `${label}: canvas has size`).toBe(true);
}

/** Wait for the app-shell worker to reach `activated`, and say so when it never
 *  does — the state the whole two-visit shape of this test depends on. */
async function awaitActiveWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          return regs.map((r) => r.active?.state ?? r.installing?.state ?? 'none');
        }),
      {
        message:
          'visit 1: the service worker installs — without it "visit 2, through the worker" tests nothing',
        timeout: 20_000,
      },
    )
    .toContain('activated');
}

test('live deploy boots — fresh visit, then through the service worker', async ({ page }) => {
  await bootOnce(page, 'visit 1 (fresh)');
  await awaitActiveWorker(page);

  // Second navigation: the just-installed service worker now controls fetches —
  // the code path that served a stale index in the incident.
  await bootOnce(page, 'visit 2 (via service worker)');

  // …and it really did. `controller` is non-null only when THIS document was
  // served by the worker, which is the difference between running the incident's
  // code path and merely loading the page a second time (a0-66).
  const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  expect(controller, 'visit 2 was served THROUGH the service worker').toContain('sw.js');
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
      //    (`formatBuildBadge`'s `<sha> · <HH:MM>Z`. Since M10 the in-game corner
      //    badge spends that room on the server instead — `<sha> · <machine>
      //    (<region>)` — so the two strings share a sha, not a format.)
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
