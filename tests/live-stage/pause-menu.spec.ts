/**
 * tests/live-stage/pause-menu.spec.ts — the pause menu is wired into boot,
 * verified in the REAL booted client. OWNER: UI Engineer (developer p10).
 *
 * The unit suite (`src/ui/pause-menu.test.ts`) proves the pure decisions — the
 * state machine, the `pausable` freeze rule, the layout. What it cannot reach is
 * the WIRE: does a real ESC over a running match freeze the SIM, does RESUME pick
 * it back up, does SETTINGS round-trip, and does EXIT + confirm tear the world
 * down to the menu so PLAY boots a fresh one. That is the M2 dark-matter class —
 * merged, unit-passed, invisible in the shipped game — and only booting the
 * actual bundle catches it. So this spec drives the whole path through the front
 * door: real ESC, real clicks at the points the client itself drew each control,
 * reading back only plain state through the ?debug=1 `window.__pauseStage` seam.
 *
 * It boots `?debug=1` (straight into a match, no menu — the harness contract), so
 * the pause overlay is exercised over a live offline match. EXIT navigates to the
 * clean menu (dropping the debug flag), where the existing `__mainMenu` seam
 * proves the world is gone and PLAY boots a fresh match.
 */
import { test, expect, type Page } from '@playwright/test';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface PauseControl {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface PauseRead {
  readonly screen: 'closed' | 'menu' | 'settings' | 'confirm';
  readonly open: boolean;
  readonly pausable: boolean;
  readonly frozen: boolean;
  readonly simTicks: number;
  readonly controls: readonly PauseControl[];
  readonly buttonPoint: PhysicalPoint;
}
interface PauseStage {
  read(): PauseRead;
}
interface MainMenuSeam {
  visible: boolean;
  matchStarted: boolean;
  play(): void;
}
interface LobbySeam {
  visible: boolean;
  rush(): void;
}
/** The doors (`installOnlineSeam`) — PLAY opens these, and PLAY SOLO is the one
 *  that reaches the offline lobby. */
interface OnlineSeam {
  solo(): void;
}
interface StageWindow {
  __pauseStage?: PauseStage;
  __mainMenu?: MainMenuSeam;
  __lobby?: LobbySeam;
  __onlineMenu?: OnlineSeam;
}
declare const window: Window & StageWindow;

/** The canvas origin in page space — the seam reports control points in
 *  canvas-local physical coordinates, so a real press adds this back. */
async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/** Read the live pause state. */
async function readPause(page: Page): Promise<PauseRead> {
  return page.evaluate(() => window.__pauseStage!.read());
}

/** Click the pause control of a given kind at the physical point the client drew
 *  it (front door — never a hit-test seam). */
async function clickPauseControl(page: Page, kind: string): Promise<void> {
  const origin = await canvasOrigin(page);
  const p = await page.evaluate((k) => {
    const c = window.__pauseStage!.read().controls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!p) throw new Error(`no pause control of kind ${kind}`);
  await page.mouse.click(origin.x + p.x, origin.y + p.y);
}

/** Boot straight into an offline match and wait until it is running. */
async function bootMatch(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, {
    timeout: 20_000,
  });
  // Let the offline sim actually run some ticks, so "frozen" is a real change.
  await page.waitForFunction(() => window.__pauseStage!.read().simTicks > 5, undefined, {
    timeout: 10_000,
  });
  return pageErrors;
}

test('ESC pauses the offline match — the sim FREEZES, RESUME picks it back up', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);

  // Closed: the match owns the screen, the sim is running.
  const before = await readPause(page);
  expect(before.open, 'no overlay before ESC').toBe(false);
  expect(before.pausable, 'the offline match is pausable').toBe(true);
  expect(before.frozen, 'a running match is not frozen').toBe(false);

  // Real ESC opens the pause overlay.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__pauseStage!.read().open === true, undefined, {
    timeout: 5_000,
  });
  const paused = await readPause(page);
  expect(paused.screen, 'ESC opens the pause menu').toBe('menu');
  expect(paused.frozen, 'offline + overlay up ⇒ the sim is frozen (developer §2)').toBe(true);

  // The sim is FROZEN: real time passes but no tick advances.
  const frozenAt = (await readPause(page)).simTicks;
  await page.waitForTimeout(500); // ~30 ticks would pass at 60 Hz if it were running
  const stillFrozen = (await readPause(page)).simTicks;
  expect(stillFrozen, 'no sim tick advances while the offline overlay is up').toBe(frozenAt);

  // RESUME (real click) closes the overlay and the sim ticks again.
  await clickPauseControl(page, 'resume');
  await page.waitForFunction(() => window.__pauseStage!.read().open === false, undefined, {
    timeout: 5_000,
  });
  const resumedAt = (await readPause(page)).simTicks;
  await page.waitForFunction(
    (prev) => window.__pauseStage!.read().simTicks > prev,
    resumedAt,
    { timeout: 5_000 },
  );

  expect(pageErrors, 'no page errors across pause → resume').toEqual([]);
});

test('SETTINGS round-trips back to the pause overlay; STAY cancels EXIT', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, {
    timeout: 5_000,
  });

  // SETTINGS opens the real settings screen (its rows + DONE are reported).
  await clickPauseControl(page, 'settings');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'settings', undefined, {
    timeout: 5_000,
  });
  const onSettings = await readPause(page);
  expect(onSettings.frozen, 'the sim stays frozen while settings is up').toBe(true);
  expect(
    onSettings.controls.some((c) => c.kind === 'back'),
    'the settings screen offers DONE',
  ).toBe(true);

  // DONE returns to the pause overlay (not the match).
  await clickPauseControl(page, 'back');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, {
    timeout: 5_000,
  });

  // EXIT asks first; STAY backs out — one accidental tap must not kill a match.
  await clickPauseControl(page, 'exit');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'confirm', undefined, {
    timeout: 5_000,
  });
  await clickPauseControl(page, 'stay');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, {
    timeout: 5_000,
  });
  const afterStay = await readPause(page);
  expect(afterStay.open, 'STAY keeps the match alive, overlay still up').toBe(true);

  expect(pageErrors, 'no page errors across the settings + confirm round-trips').toEqual([]);
});

test('EXIT + confirm tears the world down to the menu; PLAY boots a fresh match', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootMatch(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, {
    timeout: 5_000,
  });

  // EXIT → the "Leave the match?" confirm.
  await clickPauseControl(page, 'exit');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'confirm', undefined, {
    timeout: 5_000,
  });

  // LEAVE tears the world down and returns to the MENU (a clean boot, dropping the
  // debug flag). The main-menu seam appears, the world is gone, and nothing is
  // mid-match.
  await clickPauseControl(page, 'leave');
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 20_000,
  });
  const onMenu = await page.evaluate(() => ({
    menuVisible: window.__mainMenu!.visible,
    matchStarted: window.__mainMenu!.matchStarted,
    worldGone: !('__pauseStage' in window), // the match's debug seam is gone
  }));
  expect(onMenu.menuVisible, 'EXIT lands on the main menu').toBe(true);
  expect(onMenu.matchStarted, 'the match world is gone').toBe(false);
  expect(onMenu.worldGone, 'no stale match seam survived the teardown').toBe(true);

  // PLAY → PLAY SOLO → lobby → RUSH builds a FRESH match — the clean re-boot the
  // developer asked for (§3).
  //
  // PLAY opens THE DOORS, not a lobby: the unified play flow made PLAY SOLO /
  // CREATE / JOIN the three things that reach one, and this spec still walked the
  // shape from before it. So it timed out here — a stale live-stage test, found by
  // the M10 pause audit and fixed rather than skipped, because a red pause spec is
  // the one thing that stops the next pause regression being seen.
  await page.evaluate(() => window.__mainMenu!.play());
  await page.waitForFunction(() => typeof window.__onlineMenu?.solo === 'function', undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => window.__onlineMenu!.solo());
  await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => window.__lobby!.rush());
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
    timeout: 20_000,
  });
  const rebooted = await page.evaluate(() => window.__mainMenu!.matchStarted);
  expect(rebooted, 'PLAY boots a fresh match after EXIT').toBe(true);
});
