/**
 * Post-deploy live boot check — OWNER: QA (authored by the Director during the
 * 2026-07-23 stale-service-worker incident; the game shipped dead to a real
 * phone because nothing verified the DEPLOYED url actually boots).
 *
 * Loads the live page twice: the first visit installs the service worker, the
 * second is served THROUGH it — the exact path that bricked. Fails on any page
 * error, any failed same-origin request, or a canvas that never draws.
 */
import { test, expect } from '@playwright/test';

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
