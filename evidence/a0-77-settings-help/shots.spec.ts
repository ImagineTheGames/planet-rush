/**
 * evidence/a0-77-settings-help/shots.spec.ts — the frames. OWNER: UI Engineer (a0-77).
 *
 * > *"id like to see ? marks that are clickable on PC and mobile next to each
 * > button somewhere convenient that shows a pop up and explains what that
 * > toggle/button does…"*  — developer, 2026-08-17, with a phone screenshot of
 * > SETTINGS
 *
 * Four frames per profile, and each one answers a different sentence of the
 * Definition of Done:
 *
 *   `-rest`      every row carries a `?`, and nothing it was added beside moved
 *                off the row or under the value.
 *   `-open`      the panel open on a VOLUME row — the tightest row on the screen
 *                (a label, ten pips and two thumb-sized steppers) — showing the
 *                explanation clears both the value column and the −/+.
 *   `-open-alt`  the same on CONTROLS, the row with the longest value word, so
 *                the frame carries the other shape of row too.
 *   `-keyboard`  the focus RING on a `?` with its panel open, reached with the
 *                arrow keys and Enter and no pointer at all.
 *
 * The touch profiles take the `-open` frame with a real TOUCH tap and the desktop
 * one with a real click, because "on pointer and on touch" is two claims and a
 * screenshot of one is not evidence of the other.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';
import { PROFILES } from './profiles';
import { bootMenu, control, openSettings, press, tap } from './boot';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

/** The row the `-open` frames use: a volume row is the tightest on the screen —
 *  it is the only kind carrying a label, a readout AND two controls at once. */
const TIGHT_ROW = 'help:volume:master';

for (const profile of PROFILES) {
  test(`a0-77 frames — ${profile.id}`, async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    const shot = (name: string) => page.screenshot({ path: join(SHOTS, `${profile.id}-${name}.png`) });

    await bootMenu(page);
    await openSettings(page);
    await shot('rest');

    // The panel, opened the way the profile's own player would open it.
    if (profile.touch) await tap(page, TIGHT_ROW);
    else await press(page, TIGHT_ROW);
    await shot('open');

    // Tap away closes it (the ratified dismissal grammar), then the other row.
    const done = await control(page, 'back');
    if (profile.touch) await page.touchscreen.tap(1, 1);
    else await page.mouse.click(1, 1);
    await settleFrames(page, 8);
    expect(done.kind).toBe('back'); // the screen is still up; nothing navigated
    if (profile.touch) await tap(page, 'help:controls');
    else await press(page, 'help:controls');
    await shot('open-alt');

    // …and the keyboard: no pointer, arrows to the third `?`, Enter to open it.
    if (profile.touch) await page.touchscreen.tap(1, 1);
    else await page.mouse.click(1, 1);
    await settleFrames(page, 4);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await settleFrames(page, 8);
    await shot('keyboard');

    await context.close();
  });
}
