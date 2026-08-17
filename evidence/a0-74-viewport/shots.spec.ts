/**
 * evidence/a0-74-viewport/shots.spec.ts — OWNER: UI Engineer (a0-74).
 *
 * The frames the second report is about:
 *
 * > *"on pc we also need a way to handle UI locations because i have an ultra
 * > wide and all that UI goes to the edges of the screens."*
 *
 * 16:9, 21:9 and 32:9 — the three the Definition of Done names — on the frozen,
 * seeded scene the goldens use, so the only difference between the frames is the
 * viewport. All three share a height (1080), which makes the content box the same
 * 1920 px in every one: what changes is how much world is either side of it.
 *
 * `A0_74_LABEL=before` captures the same three frames on a build with the content
 * box neutralised (`A0_74_NO_BOX=1` is not a thing in the shipped bundle — the
 * "before" set is captured by checking out the parent commit; see README.md).
 * The default label is `after`.
 *
 * The touch frames are here too, because a control the player cannot see is not a
 * control: one phone frame per rung of the ladder, so the audit can show what 2×
 * actually looks like rather than asserting it in world units alone.
 */
import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';
import { FIT_PROFILES, VIEW_PROFILES, type Profile } from './profiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const LABEL = process.env.A0_74_LABEL ?? 'after';
const SCENE = '/?debug=1&freeze=1&gate=0';

/**
 * Boot the frozen scene and wait until it is drawing.
 *
 * The `__viewStage` wait is **best-effort on purpose**: this same file is run
 * against the parent commit to capture the `before` set, and that build has no
 * such seam. Falling back to "the canvas is up and 16 frames have gone by" keeps
 * one capture script for both halves of the pair, which is the only way the two
 * frames differ by the change and not by the harness.
 */
async function boot(page: Page): Promise<void> {
  await page.goto(SCENE);
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await page
    .waitForFunction(() => '__viewStage' in window, null, { timeout: 15_000 })
    .catch(() => { /* pre-a0-74 build: no seam, and none needed for a screenshot */ });
  await settleFrames(page, 16);
}

/** Seat a zoom rung if this build has one. Returns whether it did — a `before`
 *  run has no ladder, and a frame captured as "2×" that is really 1× would be the
 *  worst kind of evidence. */
async function setZoom(page: Page, step: number): Promise<boolean> {
  return page.evaluate((s) => {
    const stage = (window as unknown as { __viewStage?: { setZoom(n: number): number } }).__viewStage;
    if (!stage) return false;
    stage.setZoom(s);
    return true;
  }, step);
}

/** The one phone profile the report named, for the ladder frames. */
const PHONE = VIEW_PROFILES.find((p) => p.id === 'phone-798x384') as Profile;

test.describe('a0-74 — the frames', () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const p of FIT_PROFILES) {
    test(`shoots ${p.id}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: p.width, height: p.height },
        deviceScaleFactor: p.dpr,
      });
      const page = await ctx.newPage();
      await boot(page);
      await page.screenshot({ path: join(SHOTS, `${LABEL}-${p.id}.png`) });
      await ctx.close();
    });
  }

  for (const step of [1, 1.5, 2]) {
    test(`shoots the phone at ${step}x`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: PHONE.width, height: PHONE.height },
        deviceScaleFactor: PHONE.dpr,
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await boot(page);
      const seated = await setZoom(page, step);
      await settleFrames(page, 12);
      // A `before` build has no ladder: capture the one view it has, once, and
      // name it for what it is rather than pretending it is a rung.
      if (!seated && step !== 1) {
        await ctx.close();
        test.skip(true, 'no zoom ladder on this build (before capture)');
        return;
      }
      await page.screenshot({ path: join(SHOTS, `${LABEL}-phone-zoom-${String(step).replace('.', '_')}x.png`) });
      await ctx.close();
    });
  }
});
