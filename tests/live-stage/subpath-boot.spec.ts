/**
 * tests/live-stage/subpath-boot.spec.ts — the deploy gate, run BEFORE the deploy.
 * OWNER: Platform Engineer (GDD §4.8; incident a0-66, 2026-08-16).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `tests/live/boot.spec.ts` is the last thing between a broken deploy and the
 * developer's phone, and on 2026-08-16 it did its job: the live URL was asking
 * for `https://imaginethegames.github.io/fonts/…woff2` — no `/planet-rush/` — and
 * getting a 404 on both ratified faces. But it did its job AFTER the deploy, so
 * the price was 14 merges during which the last good build kept serving and the
 * developer twice noticed a game missing a fix that had merged hours earlier.
 *
 * The bug was invisible to every pre-merge check for one reason, and it is a
 * reason that will recur: **the whole test estate serves the game at `/`.** `vite
 * dev`, `vite preview`, the mobile suite, the rest of live-stage — origin and
 * base are the same string everywhere, so a root-absolute URL written as a
 * TypeScript string literal (which Vite does NOT rewrite; see
 * `src/platform/asset-url.ts`) resolves correctly in all of them and only breaks
 * on the Pages project subpath.
 *
 * So this spec serves **the production artifact, unchanged, under a subpath** —
 * `vite preview --base /planet-rush/` on a `base: './'` build, which is byte for
 * byte the bundle Pages gets, at the path Pages serves it from — and runs the
 * post-deploy gate's assertions against it. `deploy` in `.github/workflows/ci.yml`
 * depends on this job, so the next asset that forgets the base fails a PR.
 *
 * It is deliberately NOT a copy of the whole live check: the live URL is still
 * the only thing that can prove the live URL boots, and this does not replace it.
 * It proves the two things a subpath is uniquely able to break — every
 * same-origin request resolves, and the app-shell worker registers and takes
 * control — before the merge rather than after it.
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * Every canvas the booted client is allowed to have, named, in DOM order:
 * `parentId > id`, an empty `id` being a canvas with none.
 *
 *  - `app > ` — the Pixi game canvas, a direct child of `#app` (`src/main.ts`).
 *  - `pr-title-gate > pr-title-gate-sky` — the title gate's star field, inside the
 *    DOM overlay a0-50 mounts above the game canvas (`src/ui/title-gate.ts`).
 *
 * Stated here as well as in `tests/live/boot.spec.ts` on purpose: that file is
 * QA's and this one is Platform's, and each has to be readable on its own. If a
 * third canvas ever legitimately joins them, both lists move — which is the
 * conversation the count-of-one this replaced was too quiet to start.
 */
const EXPECTED_CANVASES = ['app > ', 'pr-title-gate > pr-title-gate-sky'] as const;

/** Every `<canvas>` on the page as `parentId > id`, in DOM order. */
function canvasRoll(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map((c) => `${c.parentElement?.id ?? '(detached)'} > ${c.id}`),
  );
}

/** One visit: load, let it boot, and account for everything it asked for.
 *
 *  `base` is Playwright's own `baseURL` fixture, which the config builds from the
 *  port and the deploy base it hands `vite preview` — one string, so the test and
 *  the server cannot end up describing different servers. */
async function bootOnce(page: Page, base: string, label: string): Promise<void> {
  const origin = new URL(base).origin;
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(origin)) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2500); // boot + first frames + SW install

  expect(pageErrors, `${label}: page errors`).toEqual([]);
  // THE ASSERTION THIS FILE IS FOR. On 2026-08-16 this list read:
  //   404 …/fonts/Audiowide-Regular-latin.woff2
  //   404 …/fonts/Oxanium-Variable-latin.woff2
  // at the ORIGIN root rather than under the base — and every pre-merge check in
  // the repository was green, because every one of them serves at `/`.
  expect(failedRequests, `${label}: failed same-origin requests under a subpath`).toEqual([]);

  await expect
    .poll(() => canvasRoll(page), { message: `${label}: canvas mounts`, timeout: 15_000 })
    .toEqual([...EXPECTED_CANVASES]);

  const box = await page.locator('#app > canvas').boundingBox();
  expect(box && box.width > 100 && box.height > 100, `${label}: canvas has size`).toBe(true);
}

test('the production bundle boots from a deploy SUBPATH, twice, with nothing 404ing', async ({
  page,
  baseURL,
}) => {
  // Asserted, not assumed: with no `baseURL` this spec would silently test the
  // blank page, which is exactly the failure mode a gate must not have.
  expect(baseURL, 'the config serves the bundle from a subpath').toMatch(/\/planet-rush\/$/);
  const base = baseURL as string;

  await bootOnce(page, base, 'visit 1 (fresh)');

  // The app-shell worker is a `public/` file too, so it is subject to the exact
  // same base mistake — and a worker fetched from the origin root fails its scope
  // check as well as its fetch. Waited on explicitly rather than slept for.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          return regs.map((r) => r.active?.state ?? r.installing?.state ?? 'none');
        }),
      { message: 'the service worker installs from under the subpath', timeout: 20_000 },
    )
    .toContain('activated');

  await bootOnce(page, base, 'visit 2 (via service worker)');

  const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  expect(controller, 'visit 2 was served THROUGH the service worker').toContain('/planet-rush/sw.js');
});
