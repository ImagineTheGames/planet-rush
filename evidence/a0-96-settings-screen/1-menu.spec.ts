/**
 * evidence/a0-96-settings-screen/1-menu.spec.ts — the MAIN MENU settings screen,
 * photographed. OWNER: QA Manager (a0-96).
 *
 * Three questions, one boot per profile:
 *
 *   `-rest`       the screen as a player first meets it: six rows, the header
 *                 eyebrow, nothing touched. On a fresh storage, so the values in
 *                 it are the DEFAULTS the game ships.
 *   `-help-*`     each row's `?` panel, one frame per row, so the words a0-89 and
 *                 a0-93 rewrote are on the record AS THEY RENDER. A sentence read
 *                 in `settings.ts` is not a sentence a player has been shown.
 *   `-changed` /  the header's claim, CHANGES SAVE IMMEDIATELY, put to the only
 *   `-reloaded`   test that can settle it: move every one of the six rows off its
 *                 default, reload the page, come back and look. Same context, so
 *                 the reload is a player relaunching the game, not a new device.
 *
 * The volume rows are driven from their own −/+ buttons (`minus:volume:master`),
 * because that is what a player presses; the middle of a volume row is a readout
 * and pressing it is meant to do nothing.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from './profiles';
import { bootMenu, menuRows, openMenuSettings, park, pressMenu, type RowReport } from './drive';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

/** The six `?` controls, in row order. */
const HELP = [
  ['fireMode', 'help:fireMode'],
  ['controls', 'help:controls'],
  ['reduceVfx', 'help:reduceVfx'],
  ['master', 'help:volume:master'],
  ['sfx', 'help:volume:sfx'],
  ['music', 'help:volume:music'],
] as const;

/**
 * Move every row off its default, by pressing the control a player would press.
 * The volume targets are chosen to be unmistakable in a photograph: 8→3, 8→10
 * (hard against the top), 6→0 (empty). A row that came back at 7 instead of 3
 * has to be visible as such from across the room.
 */
async function changeEveryRow(page: import('@playwright/test').Page, touch: boolean): Promise<void> {
  await pressMenu(page, 'fireMode', touch); // AUTO-AIM → MANUAL
  await pressMenu(page, 'controls', touch); // TAP COMMANDER → the device's sticks word
  await pressMenu(page, 'reduceVfx', touch); // OFF → ON
  for (let i = 0; i < 5; i++) await pressMenu(page, 'minus:volume:master', touch); // 8 → 3
  for (let i = 0; i < 2; i++) await pressMenu(page, 'plus:volume:sfx', touch); // 8 → 10
  for (let i = 0; i < 6; i++) await pressMenu(page, 'minus:volume:music', touch); // 6 → 0
}

for (const profile of PROFILES) {
  test(`a0-96 menu settings — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    const shot = (name: string): Promise<Buffer> =>
      page.screenshot({ path: join(SHOTS, `${profile.id}-${name}.png`) });
    const readback: Record<string, RowReport[] | string> = {};

    await bootMenu(page);
    await openMenuSettings(page);
    await shot('menu-rest');
    readback['menu-rest'] = await menuRows(page);

    // Each row's `?`, opened and dismissed by the same grammar a player uses: a
    // press on the glyph opens it, a press anywhere else puts it away.
    for (const [name, kind] of HELP) {
      await pressMenu(page, kind, touchOf(profile.touch));
      readback[`help-${name}-title`] = await page.evaluate(() => window.__mainMenu?.settingsHelpTitle ?? '');
      await shot(`menu-help-${name}`);
      if (profile.touch) await page.touchscreen.tap(1, 1);
      else await page.mouse.click(1, 1);
      await park(page);
    }

    // FIRE MODE's help again, this time with CONTROLS on the sticks scheme —
    // a0-89 wrote two branches of that sentence and only one of them is what a
    // first-run player is shown. Both belong on the record.
    await pressMenu(page, 'controls', profile.touch);
    await pressMenu(page, 'help:fireMode', profile.touch);
    readback['help-fireMode-sticks-title'] = await page.evaluate(() => window.__mainMenu?.settingsHelpTitle ?? '');
    await shot('menu-help-fireMode-sticks');
    if (profile.touch) await page.touchscreen.tap(1, 1);
    else await page.mouse.click(1, 1);
    await park(page);
    await pressMenu(page, 'controls', profile.touch); // …and back to the shipped default
    readback['after-help-detour'] = await menuRows(page);

    // ── The persistence claim ────────────────────────────────────────────────
    await changeEveryRow(page, profile.touch);
    await shot('menu-changed');
    readback['menu-changed'] = await menuRows(page);

    // A reload, then back in through the same front door. Same browser context,
    // so this is the same player relaunching on the same device.
    await bootMenu(page);
    await openMenuSettings(page);
    await shot('menu-reloaded');
    readback['menu-reloaded'] = await menuRows(page);

    writeFileSync(
      join(SHOTS, `${profile.id}-menu-readback.json`),
      `${JSON.stringify({ profile, readback }, null, 2)}\n`,
    );
    await context.close();
  });
}

/** Tiny helper so the `?` loop reads the same as every other press. */
function touchOf(touch: boolean): boolean {
  return touch;
}
