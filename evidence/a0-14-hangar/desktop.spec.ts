/**
 * evidence/a0-14-hangar/desktop.spec.ts — the hangar at desktop. OWNER: UI Engineer.
 *
 * Two frames, and the second is the one a0-14 says matters:
 *
 *   1. `a0-14-hangar-desktop.png` — a real ship and a real level (7, from a real
 *      profile read by the shipped reader), with the unlock list showing its
 *      honest empty line.
 *   2. `a0-14-hangar-empty-fresh.png` — **the frame that ships first**: a clean
 *      install. No stored profile at all, so the reader folds to `{ v: 1, xp: 0,
 *      level: 1, matches: 0 }` and the screen shows LEVEL 1, 0 MATCHES and the
 *      same sentence. This is the one the developer will open on day one, and
 *      the one an empty grid would be indistinguishable from.
 *
 * Both are reached with a REAL press on the HANGAR plate, and both record what
 * the screen is SAYING to `readback.json` — because a picture of a panel cannot
 * prove the panel is honest, and the sentence is what makes it so.
 */
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { SEEDED_PROFILE, openFrontDoor, openHangar, readHangar, record } from './capture';

const HERE = import.meta.dirname;

test('the hangar at desktop, with a real ship and a real level', async ({ page }) => {
  await openFrontDoor(page, SEEDED_PROFILE);
  await openHangar(page);

  const said = await readHangar(page);
  // The level is the one the CURVE says for that lifetime XP — not the cached
  // `level: 7` in the seeded blob, which the model deliberately does not trust.
  expect(said.level).toBe('LEVEL 7');
  expect(said.ship.length).toBeGreaterThan(0);
  // The empty line is present, which is the whole claim: zero cosmetics defined,
  // and the screen says so rather than drawing nothing.
  expect(said.empty).toMatch(/no cosmetics yet/i);
  // And the world was never built — this door starts nothing.
  expect(await page.evaluate(() => window.__mainMenu?.matchStarted)).toBe(false);

  record('desktop', said);
  await page.screenshot({ path: resolve(HERE, 'a0-14-hangar-desktop.png') });
});

test('the EMPTY-STATE frame — a clean install, which is what ships first', async ({ page }) => {
  await openFrontDoor(page, null); // no stored profile at all
  await openHangar(page);

  const said = await readHangar(page);
  expect(said.level).toBe('LEVEL 1');
  expect(said.empty).toMatch(/no cosmetics yet/i);

  record('empty-fresh', said);
  await page.screenshot({ path: resolve(HERE, 'a0-14-hangar-empty-fresh.png') });
});
