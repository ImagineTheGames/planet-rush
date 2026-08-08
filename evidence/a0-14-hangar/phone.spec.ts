/**
 * evidence/a0-14-hangar/phone.spec.ts — the hangar at 390 px, held portrait.
 * OWNER: UI Engineer.
 *
 * a0-14: *"Landscape phone at 390 px is the target: the hangar has to work
 * there, not merely fit."* The device is 390×844 portrait; the landscape lock
 * rotates the game root, so the screen lays out in an **844×390 logical**
 * viewport — wide and short, which is why the hangar splits into two panes
 * rather than stacking.
 *
 * "Works there" is asserted, not eyeballed: the way out is reported at a
 * physical point inside the frame, the screen says its level and its empty line,
 * and the door was opened by a real tap on the plate rather than by a seam call.
 */
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { SEEDED_PROFILE, openFrontDoor, openHangar, readHangar, record } from './capture';

const HERE = import.meta.dirname;

test('the hangar at 390 px landscape, with a real ship and a real level', async ({ page }) => {
  await openFrontDoor(page, SEEDED_PROFILE);
  await openHangar(page);

  const said = await readHangar(page);
  expect(said.level).toBe('LEVEL 7');
  expect(said.empty).toMatch(/no cosmetics yet/i);

  // The way out is drawn, and it is drawn INSIDE the frame — a BACK reported off
  // the bottom of a 390px phone is exactly the field-report bug this project has
  // already paid for once.
  const back = await page.evaluate(
    () => window.__mainMenu?.hangarControls.find((c) => c.kind === 'back')?.physicalCenter ?? null,
  );
  expect(back, 'no BACK reported on the hangar').not.toBeNull();
  const size = page.viewportSize();
  expect(back!.x).toBeGreaterThan(0);
  expect(back!.y).toBeGreaterThan(0);
  expect(back!.x).toBeLessThan(size!.width);
  expect(back!.y).toBeLessThan(size!.height);

  record('phone', { ...said, back });
  await page.screenshot({ path: resolve(HERE, 'a0-14-hangar-phone.png') });

  // …and it actually works: a real tap on that point comes home to the menu.
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box!.x + back!.x, box!.y + back!.y);
  await page.waitForFunction(() => window.__mainMenu?.screen === 'menu');
});
