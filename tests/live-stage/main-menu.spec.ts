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
 *    world yet. **PLAY opens THE DOORS** (ratified: one play flow — PLAY SOLO /
 *    CREATE ROOM / JOIN ROOM), PLAY SOLO opens the lobby, and RUSH! builds the
 *    world. Proven through the read-only `window.__mainMenu` / `__onlineMenu` /
 *    `__lobby` seams `main.ts` installs on the menu path, whose `matchStarted`
 *    flips true only once the real world is constructed.
 *  - A `?debug=1` boot skips the menu entirely and boots straight into a match —
 *    the harness every existing live / live-stage / mobile test depends on
 *    (field report §3). Proven by the menu seam being absent and the `?debug=1`
 *    instrument (`window.__planetRush`) present.
 */
import { test, expect, type Page } from '@playwright/test';

/** The read-only `?clean-boot`-only seam this spec drives. Mirrors the object
 *  `main.ts` installs in `openMainMenu` / `installMainMenuSeam`. */
interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface MainMenuSeam {
  /** The menu layer is up (true until a door resolves). */
  visible: boolean;
  /** Which screen owns the menu — 'menu', 'settings', 'codex', or 'online' (THE
   *  DOORS: PLAY SOLO / CREATE ROOM / JOIN ROOM, the screen PLAY opens). */
  screen: 'menu' | 'settings' | 'codex' | 'online';
  /** Flipped true only once `boot()` has actually built the match world — which,
   *  since M4, is after the LOBBY's RUSH!, not directly on PLAY (see below). */
  matchStarted: boolean;
  /** The main-menu buttons (PLAY / SETTINGS), each with the physical point a real
   *  press must land on (through the landscape-lock remap). */
  controls: readonly ControlReport[];
  /** The settings-screen rows + DONE, each with the physical press point — the
   *  front-door handles for the CONTROLS row and DONE. */
  settingsControls: readonly ControlReport[];
  /** The control scheme the settings screen shows and persists — readback proof a
   *  press on the CONTROLS row took effect immediately. */
  controlScheme: 'sticks' | 'tap';
  /** The scheme the RUNNING match drives with (null before the world exists). */
  matchControlScheme: 'sticks' | 'tap' | null;
  /** The local ship's live WORLD position in the running match (null before). */
  localShipPos: PhysicalPoint | null;
  /** Activate PLAY as a real tap would — opens THE DOORS. */
  play(): void;
}
/** The doors seam (src/main.ts `installOnlineSeam`) — the screen PLAY opens, and
 *  the three ways a match is entered. This spec drives PLAY SOLO through it. */
interface OnlineSeam {
  visible: boolean;
  screen: 'home' | 'join';
  doorControls: readonly ControlReport[];
  solo(): void;
}
/** The lobby seam the doors hand off to (src/main.ts `openLobby`) — the M4 gate
 *  between the menu and the match, and now the ONE lobby both modes use. This spec
 *  only needs to see it appear and to RUSH! through it. */
interface LobbySeam {
  visible: boolean;
  online: boolean;
  rush(): void;
  rushControl: { physicalCenter: PhysicalPoint };
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
  __planetRush?: unknown;
}
declare const window: Window & StageWindow;

test('a clean boot lands on the main menu; PLAY opens the doors, PLAY SOLO the lobby, RUSH the world', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // A CLEAN boot — no ?debug=1. This is the exact path the field report walked.
  // `?gate=0` (a0-50): the title gate is a DOOR in front of the title screen,
  // opened by a press over four beats. This spec walks through the front door on
  // its way somewhere else. The flag turns off that one screen and nothing else —
  // the menu, the doors and the lobby below are the real ones. See
  // `src/ui/title-gate.ts` `gateEnabled`.
  await page.goto('/?gate=0', { waitUntil: 'load' });
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

  // Press PLAY. It opens THE DOORS (ratified: one play flow) — PLAY SOLO / CREATE
  // ROOM / JOIN ROOM. Still no world, and still no lobby: PLAY is one screen, not
  // a shortcut past it.
  await page.evaluate(() => window.__mainMenu!.play());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  const atDoors = await page.evaluate(() => ({
    menuScreen: window.__mainMenu!.screen,
    doorsScreen: window.__onlineMenu!.screen,
    matchStarted: window.__mainMenu!.matchStarted,
    lobbyPresent: '__lobby' in window,
  }));
  expect(atDoors.menuScreen, 'PLAY hands the screen to the doors').toBe('online');
  expect(atDoors.doorsScreen, 'the doors open on PLAY SOLO / CREATE / JOIN').toBe('home');
  expect(atDoors.matchStarted, 'PLAY builds no world').toBe(false);
  expect(atDoors.lobbyPresent, 'PLAY does not open a lobby of its own — one way in').toBe(false);

  // PLAY SOLO opens the LOBBY, offline flavour. The world is still NOT built: the
  // lobby's RUSH! gates it, online and offline alike.
  await page.evaluate(() => window.__onlineMenu!.solo());
  await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, {
    timeout: 20_000,
  });
  const afterPlay = await page.evaluate(() => ({
    menuVisible: window.__mainMenu!.visible,
    matchStarted: window.__mainMenu!.matchStarted,
    lobbyVisible: window.__lobby!.visible,
    lobbyOnline: window.__lobby!.online,
  }));
  expect(afterPlay.menuVisible, 'the menu is dismissed once a door opens the lobby').toBe(false);
  expect(afterPlay.lobbyVisible, 'the lobby is on screen after PLAY SOLO').toBe(true);
  expect(afterPlay.lobbyOnline, 'the SOLO lobby is the offline flavour — no room code').toBe(false);
  expect(afterPlay.matchStarted, 'PLAY SOLO opens the lobby — the world is not built until RUSH').toBe(
    false,
  );

  // RUSH! runs the countdown and boots the match: matchStarted flips true only now
  // (main.ts calls the menu handle's matchStarted() right after bootOfflineMatch).
  // This is the assertion that proves the world is built by the lobby, not by boot.
  await page.evaluate(() => window.__lobby!.rush());
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
    timeout: 20_000,
  });
  const afterRush = await page.evaluate(() => window.__mainMenu!.matchStarted);
  expect(afterRush, 'RUSH! builds the match world').toBe(true);

  expect(pageErrors, 'no page errors across the menu → lobby → match transition').toEqual([]);
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

// ===========================================================================
// The CONTROLS settings row switches to Tap Commander — FRONT DOOR, both PC and
// phone (field report v0.2.4: "there was no settings option to choose tap
// controls"). OWNER: UI Engineer.
//
// Tap Commander merged, piloted and evidence-verified — but the developer could
// not TURN IT ON: the CONTROLS row from the p6-01 spec was never built into the
// settings screen. And the p6-03 "scheme switched in settings" gate never caught
// it, because that capture flipped the scheme through the `__tapCommanderStage`
// debug seam, not a real press on a settings row — so a missing row read as
// present. This closes that discipline gap: it drives the WHOLE path with real
// clicks/taps at the seam's reported physical points (front door) and reads back
// only plain state — never a hit-test or scheme seam. Boot → press SETTINGS →
// press the CONTROLS row → the scheme flips and persists → DONE → PLAY → lobby →
// RUSH → the running match drives with Tap Commander, and a real empty-space tap
// moves the ship.
// ===========================================================================

/** A real press at a PAGE coordinate — a left click on PC, a touch tap on a phone
 *  profile. The two ways a player actually reaches a control. */
type Press = (pageX: number, pageY: number) => Promise<void>;

/** The origin of the canvas in page space — the seam reports control points in
 *  canvas-local physical coordinates (its `toLogical` subtracts this), so a real
 *  press must add it back to land on the drawn control. */
async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/** The physical press point of a control by kind, from one of the seam's control
 *  lists (`controls` = the menu buttons, `settingsControls` = the settings rows +
 *  DONE). Readback only — the point is where the client itself drew the control. */
async function controlPoint(
  page: Page,
  list: 'controls' | 'settingsControls',
  kind: string,
): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(
    ({ list, kind }) => {
      const controls = window.__mainMenu?.[list] ?? [];
      const c = controls.find((x) => x.kind === kind);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { list, kind },
  );
  if (!p) throw new Error(`no ${list} control of kind ${kind}`);
  return p;
}

/** The whole front-door path, pressing with `press`. Shared by the PC and phone
 *  profiles so both prove the identical journey through their own input. */
async function switchToTapCommanderThroughSettings(page: Page, press: Press): Promise<void> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // `?gate=0` (a0-50): the title gate is a DOOR in front of the title screen,
  // opened by a press over four beats. This spec walks through the front door on
  // its way somewhere else. The flag turns off that one screen and nothing else —
  // the menu, the doors and the lobby below are the real ones. See
  // `src/ui/title-gate.ts` `gateEnabled`.
  await page.goto('/?gate=0', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 20_000,
  });

  const origin = await canvasOrigin(page);
  const pressPoint = async (p: { x: number; y: number }): Promise<void> => {
    await press(origin.x + p.x, origin.y + p.y);
  };

  // --- On the menu: Tap Commander is now the default (a0-30, GDD §2.4 amended
  // 2026-08-12: "I already said BOTH"). This read used to assert 'sticks' — the
  // walk below therefore presses the CONTROLS row TWICE, out to the sticks and
  // back, so what this spec has always proved is unchanged: a real press on that
  // row flips the scheme at once, persists it, and the choice reaches the match.
  const onMenu = await page.evaluate(() => ({
    screen: window.__mainMenu!.screen,
    scheme: window.__mainMenu!.controlScheme,
  }));
  expect(onMenu.screen, 'opens on the menu, not settings').toBe('menu');
  expect(onMenu.scheme, 'the first-run default scheme is Tap Commander, every platform').toBe('tap');

  // --- Real-press SETTINGS → the settings screen opens. -----------------------
  await pressPoint(await controlPoint(page, 'controls', 'settings'));
  await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 10_000 });

  // The CONTROLS row exists on the real settings screen — the absence the field
  // report found. Its press point is reported because the client drew the row.
  const controlsRow = await controlPoint(page, 'settingsControls', 'controls');

  // --- Real-press the CONTROLS row → the scheme flips AT ONCE, and persists. ----
  // Out to the sticks first (the row's other destination, still one press away)…
  await pressPoint(controlsRow);
  await page.waitForFunction(() => window.__mainMenu?.controlScheme === 'sticks', undefined, {
    timeout: 10_000,
  });
  expect(
    await page.evaluate(() => localStorage.getItem('planet-rush:controlScheme')),
    'the press away from the default persists too — nothing about the row changed',
  ).toBe('sticks');
  // …and back to Tap Commander, which is what the rest of this walk follows.
  await pressPoint(controlsRow);
  await page.waitForFunction(() => window.__mainMenu?.controlScheme === 'tap', undefined, { timeout: 10_000 });
  const persisted = await page.evaluate(() => localStorage.getItem('planet-rush:controlScheme'));
  expect(persisted, 'the choice persists to the same storage family as the fire mode').toBe('tap');

  // --- DONE → back to the menu (the change is already applied). ---------------
  await pressPoint(await controlPoint(page, 'settingsControls', 'back'));
  await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 10_000 });

  // --- PLAY → the doors → PLAY SOLO → the lobby, then RUSH! → the world builds. --
  // Both presses are real, at the points the client itself reported drawing the
  // controls at: the ratified flow is walked the way a player walks it.
  await pressPoint(await controlPoint(page, 'controls', 'play'));
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  const soloDoor = await page.evaluate(() => {
    const door = window.__onlineMenu!.doorControls.find((d) => d.kind === 'solo');
    return door ? { x: door.physicalCenter.x, y: door.physicalCenter.y } : null;
  });
  if (!soloDoor) throw new Error('no PLAY SOLO door reported');
  await pressPoint(soloDoor);
  await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 20_000 });
  const rush = await page.evaluate(() => {
    const c = window.__lobby!.rushControl.physicalCenter;
    return { x: c.x, y: c.y };
  });
  await pressPoint(rush);
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 20_000 });

  // The setting flipped through the FRONT DOOR carried across PLAY → lobby → RUSH
  // into the running sim — the match is driving with Tap Commander.
  await page.waitForFunction(() => window.__mainMenu?.matchControlScheme === 'tap', undefined, { timeout: 10_000 });

  // --- And a real empty-space tap MOVES the ship (developer §2). --------------
  // The camera keeps the local ship at the visible centre, so a press well off
  // centre is empty world away from the ship — a move order the pilot flies. Poll
  // the live ship position (readback) until it has travelled a clear distance.
  const ship0 = await page.evaluate(() => window.__mainMenu!.localShipPos);
  expect(ship0, 'the running match exposes the local ship position').not.toBeNull();
  const canvasBox = await page.locator('canvas').boundingBox();
  const cx = canvasBox!.x + canvasBox!.width / 2;
  const cy = canvasBox!.y + canvasBox!.height / 2;
  // Straight up from centre: clear of the ore HUD (top corners), the wave clock
  // edge, the build button (bottom) and the minimap corner — open space.
  await press(cx, cy - canvasBox!.height * 0.22);
  await page.waitForFunction(
    (start) => {
      const p = window.__mainMenu?.localShipPos;
      if (!p || !start) return false;
      return Math.hypot(p.x - start.x, p.y - start.y) > 30;
    },
    ship0,
    { timeout: 8_000 },
  );

  expect(pageErrors, `no page errors on the front-door path: ${pageErrors.join('\n')}`).toEqual([]);
}

test('PC: real clicks through SETTINGS → the CONTROLS row switch Tap Commander on, into the match', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await switchToTapCommanderThroughSettings(page, (x, y) => page.mouse.click(x, y));
});

// The exact platform the field report was on: a REAL phone, held in PORTRAIT.
// A cross-platform feature gets BOTH form factors, always — so the front-door
// walk that ran with clicks above runs again with real touch taps on each of the
// two device profiles the mobile matrix contracts (playwright.config.ts), at
// their real portrait pixel dimensions. Under the landscape lock the portrait
// viewport rotates to a wide, short logical screen; the seam reports each control
// through that rotation remap, so a touch at the reported point lands on the row
// the client actually drew — the same remap the CONTROLS row's thumb height now
// survives (it wraps to a second column rather than compressing to a sliver).
const PHONE_PROFILES = [
  { name: 'iPhone', width: 390, height: 844, dpr: 3 },
  { name: 'Pixel', width: 412, height: 915, dpr: 2.6 },
] as const;

for (const profile of PHONE_PROFILES) {
  test.describe(`phone profile — ${profile.name} (portrait, held)`, () => {
    // hasTouch + isMobile lays the menu + settings out at thumb scale, rotates the
    // portrait viewport to the landscape-locked logical screen, AND makes the
    // CONTROLS row reachable by a real touch — not a mouse click.
    test.use({
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: profile.dpr,
      viewport: { width: profile.width, height: profile.height },
    });

    test(`${profile.name}: real taps through SETTINGS → the CONTROLS row switches Tap Commander on, into the match`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await switchToTapCommanderThroughSettings(page, (x, y) => page.touchscreen.tap(x, y));
    });
  });
}
