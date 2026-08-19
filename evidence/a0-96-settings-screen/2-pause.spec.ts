/**
 * evidence/a0-96-settings-screen/2-pause.spec.ts — the IN-MATCH pause settings
 * screen, photographed. OWNER: QA Manager (a0-96).
 *
 * The second surface, and it is a separate capture rather than a second shot of
 * the first because the two hold separate state and are reached differently: the
 * match loads its own copy of the settings at boot, from storage, and the pause
 * screen edits THAT. A frame of the menu screen says nothing about it.
 *
 * Both runs go in through the front door — PLAY → PLAY SOLO → RUSH — never
 * `?debug=1`, because the debug boot skips the menu and the lobby and therefore
 * skips the exact wire under test: the match reading what the menu saved.
 *
 *   `-pause-rest`      fresh storage: the pause screen as a player first meets it.
 *   `-pause-reloaded`  every row changed on the MENU screen, then a full page
 *                      reload, then a match booted from scratch. What this frame
 *                      shows is what the match's own copy read back out of
 *                      storage.
 */
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from './profiles';
import { bootMatchFrontDoor, bootMenu, openMenuSettings, openPauseSettings, pressMenu } from './drive';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

for (const profile of PROFILES) {
  test(`a0-96 pause settings at rest — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootMenu(page);
    await bootMatchFrontDoor(page);
    await openPauseSettings(page, profile.touch);
    await page.screenshot({ path: join(SHOTS, `${profile.id}-pause-rest.png`) });
    await context.close();
  });

  test(`a0-96 pause settings after a menu change + reload — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();

    // Move all six on the MENU screen — same presses as 1-menu.spec.ts.
    await bootMenu(page);
    await openMenuSettings(page);
    await pressMenu(page, 'fireMode', profile.touch);
    await pressMenu(page, 'controls', profile.touch);
    await pressMenu(page, 'reduceVfx', profile.touch);
    for (let i = 0; i < 5; i++) await pressMenu(page, 'minus:volume:master', profile.touch);
    for (let i = 0; i < 2; i++) await pressMenu(page, 'plus:volume:sfx', profile.touch);
    for (let i = 0; i < 6; i++) await pressMenu(page, 'minus:volume:music', profile.touch);
    await pressMenu(page, 'back', profile.touch);

    // A full reload, and only then a match. Nothing in memory survives this line.
    await bootMenu(page);
    await bootMatchFrontDoor(page);
    await openPauseSettings(page, profile.touch);
    await page.screenshot({ path: join(SHOTS, `${profile.id}-pause-reloaded.png`) });
    await context.close();
  });
}
