/**
 * evidence/a0-96-settings-screen/4-done-reach.spec.ts — is the pause screen's way
 * out reachable? OWNER: QA Manager (a0-96).
 *
 * Written after looking at `phone-798x384-pause-rest.png`, where the match's
 * DOWNLOAD LOG button sits on top of the pause settings screen's DONE plate and
 * hides the word DONE. A frame can show that something is COVERED; only a press
 * can show whether it still answers. So this presses DONE at the exact point the
 * client says it drew it, and records what the client did next — nothing is
 * asserted, because the finding is whatever comes back.
 *
 * The download itself is caught and thrown away: a press that reaches the log
 * button is the interesting outcome, not a file.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from './profiles';
import { bootMatchFrontDoor, bootMenu, openPauseSettings } from './drive';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

for (const profile of PROFILES) {
  test(`a0-96 DONE reachability on the pause settings screen — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await bootMenu(page);
    await bootMatchFrontDoor(page);
    await openPauseSettings(page, profile.touch);

    const before = await page.evaluate(() => window.__pauseStage!.read().screen);
    const point = await page.evaluate(() => {
      const c = window.__pauseStage!.read().controls.find((x) => x.kind === 'back');
      return c ? { ...c.physicalCenter } : null;
    });
    const box = await page.locator('canvas').boundingBox();
    if (point && box) {
      if (profile.touch) await page.touchscreen.tap(box.x + point.x, box.y + point.y);
      else await page.mouse.click(box.x + point.x, box.y + point.y);
    }
    await page.waitForTimeout(1_500); // a real player's beat, not a settle: the
    // question is what the client did with the press, and a download is async.
    const after = await page.evaluate(() => window.__pauseStage!.read().screen);
    await page.screenshot({ path: join(SHOTS, `${profile.id}-pause-after-done-press.png`) });

    writeFileSync(
      join(SHOTS, `${profile.id}-done-reach.json`),
      `${JSON.stringify({ profile: profile.id, donePressPoint: point, screenBefore: before, screenAfter: after, downloads }, null, 2)}\n`,
    );
    await context.close();
  });
}
