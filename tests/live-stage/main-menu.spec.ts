/**
 * tests/live-stage/main-menu.spec.ts — the MAIN MENU is wired into boot, verified
 * in the REAL booted client. OWNER: UI Engineer (GDD §4.6 M7).
 *
 * The field report: "there was no main menu, I started right in the match." The
 * Day-7 menus (PR #45) merged and unit-passed, but `main.ts` boot dropped the
 * player straight into a match — the menu was never wired into the boot path.
 * This is the M2 dark-matter class again: merged, component-tested, invisible in
 * the shipped game. A headless unit test cannot catch a missing *wire*; only
 * booting the actual bundle can.
 *
 * So this spec boots the production build two ways and asserts the boot CONTRACT:
 *
 *  - A CLEAN boot (no `?debug=1`) lands on the main menu and builds NO match
 *    world yet; pressing PLAY builds it. Proven through the read-only
 *    `window.__mainMenu` seam `main.ts` installs on the menu path, whose
 *    `matchStarted` flips true only once the real world is constructed.
 *  - A `?debug=1` boot skips the menu entirely and boots straight into a match —
 *    the harness every existing live / live-stage / mobile test depends on
 *    (field report §3). Proven by the menu seam being absent and the `?debug=1`
 *    instrument (`window.__planetRush`) present.
 */
import { test, expect } from '@playwright/test';

/** The read-only `?clean-boot`-only seam this spec drives. Mirrors the object
 *  `main.ts` installs in `openMainMenu` / `installMainMenuSeam`. */
interface MainMenuSeam {
  /** The menu layer is up (true until PLAY). */
  visible: boolean;
  /** Which screen owns the menu — 'menu' or 'settings'. */
  screen: 'menu' | 'settings';
  /** Flipped true only once `boot()` has actually built the match world. */
  matchStarted: boolean;
  /** Activate PLAY as a real tap would — resolves boot's `untilPlay()`. */
  play(): void;
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __planetRush?: unknown;
}
declare const window: Window & StageWindow;

test('a clean boot lands on the main menu and builds no match world until PLAY', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // A CLEAN boot — no ?debug=1. This is the exact path the field report walked.
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The menu seam installs during boot; wait for it before reading it.
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 20_000,
  });

  // The menu is up, and NO match world exists yet — the whole point of the fix.
  const onMenu = await page.evaluate(() => {
    const m = window.__mainMenu!;
    return { visible: m.visible, screen: m.screen, matchStarted: m.matchStarted };
  });
  expect(onMenu.visible, 'the main menu is visible on a clean boot').toBe(true);
  expect(onMenu.screen, 'the menu opens on its main screen, not settings').toBe('menu');
  expect(onMenu.matchStarted, 'no match world has been built yet — the menu gates it').toBe(false);

  // And the ?debug=1 instrument is absent, confirming this really is a clean boot
  // (a match booted immediately would have installed it).
  const debugPresent = await page.evaluate(() => '__planetRush' in window);
  expect(debugPresent, 'the ?debug=1 instrument must be absent on a clean boot').toBe(false);

  // Press PLAY (the debug hook the field report §4 permits) — the match world is
  // built only now.
  await page.evaluate(() => window.__mainMenu!.play());

  // The world is built: the seam's matchStarted flips true (main.ts calls
  // handle.matchStarted() right after bootOfflineMatch). This is the assertion
  // that proves PLAY — not boot — starts the match.
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
    timeout: 20_000,
  });
  const afterPlay = await page.evaluate(() => ({
    visible: window.__mainMenu!.visible,
    matchStarted: window.__mainMenu!.matchStarted,
  }));
  expect(afterPlay.matchStarted, 'PLAY builds the match world').toBe(true);
  expect(afterPlay.visible, 'the menu is dismissed once PLAY builds the match').toBe(false);

  expect(pageErrors, 'no page errors across the menu → match transition').toEqual([]);
});

test('?debug=1 skips the menu and boots straight into a match', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // The test harness path (field report §3): straight into a match, no menu.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The match instrument installs on a real (debug) boot — wait for the world.
  await page.waitForFunction(() => '__planetRush' in window, undefined, { timeout: 20_000 });

  // No menu was ever shown: its seam is installed only on the clean-boot path.
  const menuPresent = await page.evaluate(() => '__mainMenu' in window);
  expect(menuPresent, 'the main-menu seam must be absent under ?debug=1 (no menu)').toBe(false);

  expect(pageErrors, 'no page errors booting straight into a match').toEqual([]);
});
