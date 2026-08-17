/**
 * evidence/a0-70-title-entrance/reload.spec.ts — OWNER: UI Engineer (a0-71).
 *
 * A SECOND navigation in the same page, on a portrait phone.
 *
 * Why this exists: a0-71's screencast films two URLs back to back in one page
 * (`/` then `/?gate=0`, capture.spec.ts), and the second film's settled frame
 * came back with the menu drawn UPRIGHT in portrait — no landscape lock — while
 * a fresh page at the same URL reports `rotated: true` on every frame. A phone
 * reloading is an ordinary thing a player does, so "the lock only engages on a
 * cold page" would be its own field report. This spec asks the seam directly,
 * on a cold load and on a second navigation, and screenshots both.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'analysis');

interface Seam {
  readonly rotated: boolean;
  readonly logicalViewport: { width: number; height: number };
}

async function settle(page: import('@playwright/test').Page): Promise<Seam & { window: number[] }> {
  await page.waitForFunction('!!window.__mainMenu', null, { timeout: 60_000 });
  return (await page.evaluate(`(() => {
    const m = window.__mainMenu;
    return { rotated: m.rotated, logicalViewport: m.logicalViewport,
             window: [window.innerWidth, window.innerHeight] };
  })()`)) as Seam & { window: number[] };
}

test('the landscape lock survives a second navigation', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const log: Record<string, unknown> = {};

  await page.goto('/?gate=0', { waitUntil: 'load' });
  log.cold = await settle(page);
  await page.screenshot({ path: join(OUT, 'reload-1-cold.png') });

  await page.goto('/', { waitUntil: 'load' });
  log.second = await settle(page);

  await page.goto('/?gate=0', { waitUntil: 'load' });
  log.third = await settle(page);
  await page.screenshot({ path: join(OUT, 'reload-2-third.png') });

  await page.reload({ waitUntil: 'load' });
  log.reloaded = await settle(page);
  await page.screenshot({ path: join(OUT, 'reload-3-reloaded.png') });

  writeFileSync(join(OUT, 'reload.json'), JSON.stringify(log, null, 2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(log, null, 2));

  // On a portrait phone every one of these must be the landscape lock. On a
  // desktop every one of them must be the identity. Either way they must AGREE:
  // which navigation it is may never change the answer.
  const all = [log.cold, log.second, log.third, log.reloaded] as Seam[];
  for (const seam of all) expect(seam.rotated).toBe(all[0]!.rotated);
  for (const seam of all) expect(seam.logicalViewport).toEqual(all[0]!.logicalViewport);
});
