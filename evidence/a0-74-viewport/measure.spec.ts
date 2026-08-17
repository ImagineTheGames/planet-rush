/**
 * evidence/a0-74-viewport/measure.spec.ts — OWNER: UI Engineer (a0-74).
 *
 * **How much world is on screen, measured from the shipped bundle.**
 *
 * The first developer report is a measurement, not an opinion:
 *
 * > *"on pc i have the entire screen but im on mobile im confined to a very
 * > small portion of the world."*
 *
 * So this boots the real production build at each profile in `./profiles.ts` and
 * reads the renderer's **own** visible-world rectangle — `renderer.visibleWorld`,
 * the very box the entity cull culls against, published under `?debug=1` as
 * `window.__viewStage`. Nothing here re-derives the camera: a number produced by
 * this file's arithmetic would be a measurement of this file.
 *
 * At every touch profile it then walks the zoom ladder through the same
 * `setViewZoom` a real tap on the control runs, and measures again — so the
 * "after" column is the shipped path, not a renderer poked from the console.
 *
 * Output: `readback.json` (every raw reading) and the tables in `audit.txt`.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';
import { VIEW_PROFILES, FIT_PROFILES, type Profile } from './profiles';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The frozen, seeded scene — deterministic, and the same one the goldens use.
 *  `gate=0` walks past the title door (a0-50); `debug=1` installs `__viewStage`. */
const SCENE = '/?debug=1&freeze=1&gate=0';

interface Reading {
  readonly profile: string;
  readonly label: string;
  readonly viewport: { width: number; height: number };
  readonly zoom: number;
  /** World units on screen — read off the renderer, not recomputed. */
  readonly world: { width: number; height: number; left: number; right: number };
  readonly content: { x: number; width: number; height: number };
  readonly anchors: ReadonlyArray<{ id: string; x: number; y: number; origin: string }>;
  readonly control: { rect: { x: number; y: number; width: number; height: number }; step: number } | null;
}

/** Everything `__viewStage` knows this frame. */
async function read(page: Page): Promise<Omit<Reading, 'profile' | 'label'>> {
  return page.evaluate(() => {
    const s = (window as unknown as { __viewStage: Record<string, () => unknown> }).__viewStage;
    return {
      viewport: s.viewport() as { width: number; height: number },
      zoom: s.zoom() as number,
      world: s.world() as Reading['world'],
      content: s.content() as Reading['content'],
      anchors: s.anchors() as Reading['anchors'],
      control: s.control() as Reading['control'],
    };
  });
}

async function boot(page: Page, p: Profile): Promise<void> {
  await page.setViewportSize({ width: p.width, height: p.height });
  await page.goto(SCENE);
  await page.waitForFunction(() => '__viewStage' in window, null, { timeout: 60_000 });
  await settleFrames(page, 12);
}

const readings: Reading[] = [];

test.describe('a0-74 — how much world, and where the HUD sits', () => {
  for (const p of [...VIEW_PROFILES, ...FIT_PROFILES]) {
    test(`measures ${p.id}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: p.width, height: p.height },
        deviceScaleFactor: p.dpr,
        isMobile: p.touch,
        hasTouch: p.touch,
      });
      const page = await ctx.newPage();
      await boot(page, p);

      // Rung 1 — the shipped view, on every profile.
      readings.push({ profile: p.id, label: p.label, ...(await read(page)) });

      // The ladder, but only where the control exists: it is touch-only by
      // design (the developer chose "a zoom out button on mobile" over confining
      // the desktop), and a capture that zoomed a desktop would be measuring a
      // build nobody is shipping.
      if (p.touch) {
        // The control has to actually BE on screen for the rest of this to mean
        // anything — a persisted rung with no way to reach it is not the feature.
        const first = readings[readings.length - 1]!;
        expect(first.control, `${p.id}: the zoom control must be drawn on touch`).not.toBeNull();

        for (const step of [1.5, 2]) {
          await page.evaluate((s) => {
            (window as unknown as { __viewStage: { setZoom(n: number): number } }).__viewStage.setZoom(s);
          }, step);
          await settleFrames(page, 8);
          const r = { profile: p.id, label: p.label, ...(await read(page)) };
          expect(r.zoom, `${p.id}: the rung seated`).toBe(step);
          readings.push(r);
        }
        // …and back to 1, so the persisted value this context leaves behind is
        // the default rather than whatever the last loop set.
        await page.evaluate(() => {
          (window as unknown as { __viewStage: { setZoom(n: number): number } }).__viewStage.setZoom(1);
        });
      }

      await ctx.close();
    });
  }

  test.afterAll(() => {
    mkdirSync(HERE, { recursive: true });
    writeFileSync(join(HERE, 'readback.json'), `${JSON.stringify(readings, null, 2)}\n`);
  });
});
