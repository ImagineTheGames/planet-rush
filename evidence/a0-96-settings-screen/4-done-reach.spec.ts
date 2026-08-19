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

/**
 * …and how much of DONE is left. The first test presses the plate's own CENTRE,
 * which is where a label sits and where a thumb goes. This one presses the part
 * of the plate that is still uncovered — its left end — to find out whether the
 * way out is GONE or merely mostly gone. The offset is measured off the committed
 * frame (`phone-798x384-pause-rest.png`: the plate's left edge and its accent bar
 * stand at 1030-1090 device px of 1596, i.e. 515-545 css; on the desktop frame the
 * plate runs 934-1235 css and DOWNLOAD LOG starts at 1081), and it is stated here
 * rather than derived from the layout, because a rectangle read out of the module
 * under test would prove nothing about what is on the glass.
 */
for (const profile of PROFILES) {
  test(`a0-96 DONE at its uncovered left end — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
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
    const point = await page.evaluate(() => {
      const c = window.__pauseStage!.read().controls.find((x) => x.kind === 'back');
      return c ? { ...c.physicalCenter } : null;
    });
    const box = await page.locator('canvas').boundingBox();
    // Left of centre, still inside the plate and clear of the DOM button. Both
    // numbers are measured off the committed `-pause-rest` frames, and the first
    // desktop attempt at 165 missed the plate's left edge by 13 css px — recorded
    // here rather than quietly retuned, because it is why the desktop leg of this
    // probe was re-run.
    const dx = profile.touch ? 105 : 100;
    if (point && box) {
      if (profile.touch) await page.touchscreen.tap(box.x + point.x - dx, box.y + point.y);
      else await page.mouse.click(box.x + point.x - dx, box.y + point.y);
    }
    await page.waitForTimeout(1_500);
    const after = await page.evaluate(() => window.__pauseStage!.read().screen);
    await page.screenshot({ path: join(SHOTS, `${profile.id}-pause-after-done-left-press.png`) });
    writeFileSync(
      join(SHOTS, `${profile.id}-done-left-edge.json`),
      `${JSON.stringify({ profile: profile.id, pressedAt: point ? { x: point.x - dx, y: point.y } : null, screenAfter: after, downloads }, null, 2)}\n`,
    );
    await context.close();
  });
}
