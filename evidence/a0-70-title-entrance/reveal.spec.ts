/**
 * evidence/a0-70-title-entrance/reveal.spec.ts — OWNER: UI Engineer (a0-70).
 *
 * The composite — canvas AND the DOM overlay in front of it — through the door's
 * whole opening. `firstframes.spec.ts` films the canvas alone, which is what
 * proves the menu does not move; this is what a player actually looks at, and it
 * is the frame the brief asks for in as many words: *"the gate opens, the menu is
 * already where it belongs behind it."*
 *
 * `page.screenshot()` is honest at this cadence: the opening runs 3.4 s over four
 * beats, so ~120 ms apart resolves every beat several times over. The frame-exact
 * instrument is not needed here and would only slow the sequence it is filming.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.A0_70_LABEL ?? 'before';
/** Past `GATE_OPEN_STEPS`' last beat (3460 ms) with room to settle. */
const SHOTS = 40;
const EVERY_MS = 120;

test('the composite, through the door opening', async ({ page }) => {
  const out = join(HERE, 'frames', LABEL, 'reveal');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForSelector('#pr-title-gate', { timeout: 30_000 });
  // Let the sealed door settle, so shot 0 is the screen the player is looking at
  // when they press rather than one still assembling.
  await page.waitForTimeout(400);

  const t0 = Date.now();
  const shot = async (i: number): Promise<void> => {
    const ms = Date.now() - t0;
    await page.screenshot({
      path: join(out, `r${String(i).padStart(2, '0')}-${String(ms).padStart(5, '0')}ms.png`),
    });
  };

  await shot(0);
  await page.mouse.click(200, 200); // the opening press — beat 1
  for (let i = 1; i < SHOTS; i++) {
    await page.waitForTimeout(EVERY_MS);
    await shot(i);
  }
  expect(true).toBe(true);
});
