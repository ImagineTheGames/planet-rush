/**
 * tests/live-stage/lobby-flow.spec.ts — the LOBBY is wired into boot, and the
 * hull you pick is the hull the sim flies. OWNER: UI Engineer (GDD §2.1, §2.11;
 * M4).
 *
 * The M4 dark-matter bug: the 8-slot lobby (room codes, SHIP-CLASS SELECT, player
 * colours, RUSH!) merged in PR #39 and was unreachable — `main.ts` hardcoded the
 * local hull to Vanguard and PLAY dropped the player straight into a match, so
 * the player never chose a ship. This is the same class of failure the M2 HUD and
 * the main menu were retracted for: merged, unit-tested, never wired into the boot
 * path. A headless unit test cannot catch a missing *wire*; only booting the real
 * bundle and pressing the real buttons can.
 *
 * So this spec boots the production build at a **phone-landscape, touch** viewport
 * — the primary mobile layout of this screen (GDD §4.3) — and walks the whole
 * front of a match through the read-only `window.__lobby` seam `main.ts` installs:
 *
 *   MAIN MENU → PLAY → LOBBY (8 slots, thumb-sized, inside the safe viewport) →
 *   pick a NON-default hull → RUSH! → the booted world's local ship IS that hull.
 *
 * The last step is the one that matters: `localShipClass` is read back off the
 * *actual* sim world `bootOfflineMatch` built, so a lobby that looked right but
 * never reached the sim would fail here (GDD §2.11 — "the ship you fly IS the hull
 * you picked"). A second test asserts `?debug=1` skips the lobby exactly as it
 * skips the menu (the harness contract).
 */
import { test, expect } from '@playwright/test';

/** The read-only clean-boot seam this spec drives. Mirrors the object `main.ts`
 *  installs in `openLobby` / `installLobbySeam`. */
interface LobbySeam {
  visible: boolean;
  slotCount: number;
  isTouch: boolean;
  online: boolean;
  selectedClass: string;
  defaultClass: string;
  classOrder: readonly string[];
  logicalViewport: { width: number; height: number };
  content: { x: number; y: number; width: number; height: number };
  seatHeight: number;
  rushHeight: number;
  counting: boolean;
  localShipClass: string | null;
  selectClass(index: number): void;
  rush(): void;
}
interface MainMenuSeam {
  play(): void;
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __lobby?: LobbySeam;
  __planetRush?: unknown;
}
declare const window: Window & StageWindow;

// A phone held on its side — the primary mobile layout of the lobby (GDD §4.3),
// and the device the M4 check names ("phone landscape, layout-registered,
// thumb-sized"). `hasTouch` is what makes the booted client lay the screen out at
// thumb scale and hide the room code (offline has no wire to join over).
test.use({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});

test('PLAY → lobby → pick a non-default hull → RUSH → the sim flies that hull', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // A CLEAN boot — no ?debug=1. The exact path a first-time player walks.
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The menu comes up first; press PLAY, which now lands on the LOBBY (not the
  // match — that is the whole M4 fix).
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => window.__mainMenu!.play());

  // The lobby seam installs when the lobby opens — wait for it.
  await page.waitForFunction(() => typeof window.__lobby?.selectClass === 'function', undefined, {
    timeout: 20_000,
  });

  // The lobby is on screen with all EIGHT slots, laid out at thumb scale and
  // wholly inside the safe (landscape) viewport — "layout-registered, thumb-sized".
  const opened = await page.evaluate(() => {
    const l = window.__lobby!;
    return {
      visible: l.visible,
      slotCount: l.slotCount,
      isTouch: l.isTouch,
      online: l.online,
      seatHeight: l.seatHeight,
      rushHeight: l.rushHeight,
      content: l.content,
      viewport: l.logicalViewport,
      defaultClass: l.defaultClass,
      classOrder: l.classOrder,
      selectedClass: l.selectedClass,
    };
  });

  expect(opened.visible, 'the lobby is visible after PLAY').toBe(true);
  expect(opened.slotCount, 'the lobby shows all eight slots (GDD §2.1)').toBe(8);
  expect(opened.isTouch, 'a phone lays the lobby out at thumb scale').toBe(true);
  expect(opened.online, 'offline hides the room-code UI (GDD §4.2)').toBe(false);
  // Thumb-sized: RUSH! is a fat touch target, and the roster rows have real height.
  expect(opened.rushHeight, 'RUSH! is a thumb target (GDD §2.4)').toBeGreaterThanOrEqual(56);
  expect(opened.seatHeight, 'roster rows have height').toBeGreaterThan(0);
  // Layout-registered: nothing escapes the safe content box, which is itself
  // inside the logical viewport (the lobby's `full` anchor contract).
  expect(opened.content.x, 'content starts inside the viewport').toBeGreaterThanOrEqual(0);
  expect(opened.content.y).toBeGreaterThanOrEqual(0);
  expect(
    opened.content.x + opened.content.width,
    'content never runs past the right edge',
  ).toBeLessThanOrEqual(opened.viewport.width + 0.5);
  expect(
    opened.content.y + opened.content.height,
    'content never runs past the bottom edge',
  ).toBeLessThanOrEqual(opened.viewport.height + 0.5);

  // It opens pre-selected on the onboarding default (Vanguard) the first time out.
  expect(opened.selectedClass, 'opens on the default hull').toBe(opened.defaultClass);

  // Pick a NON-default hull — the choice that must actually reach the sim.
  const pickIndex = opened.classOrder.findIndex((c) => c !== opened.defaultClass);
  expect(pickIndex, 'there is a non-default hull to pick').toBeGreaterThanOrEqual(0);
  const picked = opened.classOrder[pickIndex]!;

  await page.evaluate((i) => window.__lobby!.selectClass(i), pickIndex);
  const afterPick = await page.evaluate(() => window.__lobby!.selectedClass);
  expect(afterPick, 'the tile the finger landed on is now selected').toBe(picked);
  expect(afterPick, 'and it is not the default').not.toBe(opened.defaultClass);

  // RUSH! — starts the countdown that boots the match.
  await page.evaluate(() => window.__lobby!.rush());
  await page.waitForFunction(() => window.__lobby?.counting === true, undefined, { timeout: 5_000 });

  // The countdown runs, the world is built, and — the assertion the milestone
  // turns on — the local ship the sim built IS the hull that was picked. Read back
  // off the actual booted world, not the lobby's own belief.
  await page.waitForFunction(() => window.__lobby?.localShipClass != null, undefined, {
    timeout: 20_000,
  });
  const flown = await page.evaluate(() => window.__lobby!.localShipClass);
  expect(flown, 'the ship the sim flies IS the hull the player picked (GDD §2.11)').toBe(picked);

  // The lobby has handed the screen to the match.
  const dismissed = await page.evaluate(() => window.__lobby!.visible);
  expect(dismissed, 'the lobby is dismissed once RUSH boots the match').toBe(false);

  expect(pageErrors, 'no page errors across menu → lobby → match').toEqual([]);
});

test('?debug=1 skips the lobby and boots straight into a match', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // The harness path (GDD §4.6): straight into a match, no menu and no lobby.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The match instrument installs on a real (debug) boot — wait for the world.
  await page.waitForFunction(() => '__planetRush' in window, undefined, { timeout: 20_000 });

  // Neither front-of-match seam was ever installed — both are clean-boot only.
  const seams = await page.evaluate(() => ({
    lobby: '__lobby' in window,
    menu: '__mainMenu' in window,
  }));
  expect(seams.lobby, 'the lobby seam must be absent under ?debug=1 (no lobby)').toBe(false);
  expect(seams.menu, 'the menu seam must be absent under ?debug=1 (no menu)').toBe(false);

  expect(pageErrors, 'no page errors booting straight into a match').toEqual([]);
});
