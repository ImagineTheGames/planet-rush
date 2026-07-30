/**
 * tests/live-stage/unified-play-flow.spec.ts — ONE play flow, walked with REAL input
 * in the REAL booted client, on both form factors. OWNER: Gameplay Engineer
 * (ratified developer: the unified play flow; GDD §2.1, §4.2).
 *
 * THE RATIFIED SHAPE, AS A TEST
 * ---------------------------------------------------------------------------
 *   "PLAY → goes to the same online menu (which already has offline play).
 *    CREATE ROOM → goes to a lobby where you select players, just like when you
 *    press the play button. Right now PLAY going to a separate offline lobby is
 *    just redundant."
 *
 * So: one PLAY button, one doors screen behind it, one lobby behind every door.
 * This spec presses that path — with mouse clicks on the PC profile and real touch
 * taps on the two phone profiles the mobile matrix contracts — at the physical
 * points the client itself reports drawing its controls at, so a control that moved,
 * shrank to nothing, or was never drawn fails here rather than in a playtest.
 *
 * WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * The shipped bundle is the OFFLINE artifact — no `VITE_ALLOCATOR_URL` — so there is
 * no allocator for CREATE ROOM to reach in CI. What this spec can prove about the
 * online door is therefore exactly what a serverless build can honestly show: that
 * CREATE ROOM is reachable through the one PLAY button and fails *gracefully*,
 * naming PLAY SOLO as the door that still works (GDD §4.8 risk 6).
 *
 * The rest of the online half — the room code up while the host configures, a second
 * client's name appearing in an open seat as they join, the guest's read-only map and
 * mode, RUSH! at the end of the countdown, and the match arriving from authority — is
 * walked by TWO real browsers against a REAL allocator and a REAL match server in
 * `tests/live-stage-online/online-play-flow.spec.ts` (which stands the fleet up
 * itself), and proven at the model level, with nothing mocked, in
 * `tests/net/online-lobby-flow.test.ts`. The three together are the flow; none is the
 * whole of it alone.
 *
 * HOW TO RUN IT
 * ---------------------------------------------------------------------------
 * `npm run test:live-stage`. Note that `.github/workflows/ci.yml` does NOT run this
 * suite (it runs typecheck, vitest, the build, `tests/mobile` and `tests/live`), so
 * this file is only ever exercised deliberately, on a machine with browsers
 * installed — and on a Linux box that also needs Chromium's shared libraries
 * (`playwright install-deps`), which is why it was first authored unexecuted. It has
 * since been RUN: all four tests green, PC and both phone profiles, and the evidence
 * PNGs beside this file are from that run.
 */
import { test, expect, type Page } from '@playwright/test';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}

/** The clean-boot menu seam (`installMainMenuSeam` in `src/main.ts`). */
interface MainMenuSeam {
  visible: boolean;
  screen: 'menu' | 'settings' | 'codex' | 'online';
  matchStarted: boolean;
  controls: readonly ControlReport[];
  play(): void;
}

/** The doors seam (`installOnlineSeam`) — PLAY SOLO / CREATE ROOM / JOIN ROOM. */
interface OnlineSeam {
  visible: boolean;
  screen: 'home' | 'join';
  status: 'idle' | 'connecting' | 'error';
  error: string;
  resolvedCode: string | null;
  doorControls: readonly ControlReport[];
}

/** The ONE lobby seam (`installLobbySeam`), both modes. */
interface LobbySeam {
  visible: boolean;
  online: boolean;
  room: string;
  you: number;
  isHost: boolean;
  humanCount: number;
  slotCount: number;
  size: number;
  mode: 'ffa' | 'teams';
  abundance: 'scarce' | 'standard' | 'rich';
  /** `ShipClass` is a string enum on the wire ('vanguard', …) — read as strings. */
  selectedClass: string;
  classOrder: readonly string[];
  classControls: readonly { index: number; physicalCenter: PhysicalPoint }[];
  mapCards: readonly { width: number; height: number }[];
  seatHeight: number;
  rushControl: { physicalCenter: PhysicalPoint };
  leave(): void;
}

interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
}
declare const window: Window & StageWindow;

/** A real press at a PAGE coordinate — a left click on PC, a touch tap on a phone. */
type Press = (pageX: number, pageY: number) => Promise<void>;

/** The canvas origin in page space: the seam reports canvas-local physical points,
 *  so a real press adds it back to land on the drawn control. */
async function canvasOrigin(page: Page): Promise<PhysicalPoint> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

async function bootMenu(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 20_000,
  });
  return pageErrors;
}

/** The physical point of a main-menu button, or null if the client draws none. */
async function menuPoint(page: Page, kind: string): Promise<PhysicalPoint | null> {
  return page.evaluate(
    (k) => {
      const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    kind,
  );
}

/** The physical point of a door, or null. */
async function doorPoint(page: Page, kind: string): Promise<PhysicalPoint | null> {
  return page.evaluate(
    (k) => {
      const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    kind,
  );
}

/**
 * The whole ratified walk, pressed with `press`. Shared by the PC and phone
 * profiles so both prove the identical journey through their own input.
 */
async function walkThePlayFlow(page: Page, press: Press, evidence: string): Promise<void> {
  const pageErrors = await bootMenu(page);
  const origin = await canvasOrigin(page);
  const pressPoint = async (p: PhysicalPoint): Promise<void> => {
    await press(origin.x + p.x, origin.y + p.y);
  };

  // --- 1. ONE way in. The menu draws PLAY, CODEX, SETTINGS — and no second front
  //        door beside PLAY (the removed ONLINE button, asserted as an absence).
  const menu = await page.evaluate(() => ({
    screen: window.__mainMenu!.screen,
    kinds: window.__mainMenu!.controls.map((c) => c.kind),
    matchStarted: window.__mainMenu!.matchStarted,
  }));
  expect(menu.screen, 'a clean boot opens on the menu').toBe('menu');
  expect(menu.kinds, 'one PLAY, and no second front door').toEqual(['play', 'codex', 'settings']);
  expect(menu.matchStarted, 'no world exists on the menu').toBe(false);

  // --- 2. Real-press PLAY → THE DOORS (not a lobby, not a match). ---------------
  const play = await menuPoint(page, 'play');
  if (!play) throw new Error('the menu reported no PLAY button');
  await pressPoint(play);
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  const doors = await page.evaluate(() => ({
    menuScreen: window.__mainMenu!.screen,
    screen: window.__onlineMenu!.screen,
    kinds: window.__onlineMenu!.doorControls.map((d) => d.kind),
    lobbyPresent: '__lobby' in window,
    matchStarted: window.__mainMenu!.matchStarted,
  }));
  expect(doors.menuScreen, 'PLAY hands the screen to the doors').toBe('online');
  expect(doors.screen).toBe('home');
  expect(doors.kinds, 'all three ways in are drawn, plus BACK').toEqual(['solo', 'create', 'join', 'back']);
  expect(doors.lobbyPresent, 'PLAY opens no lobby of its own — the doors do that').toBe(false);
  expect(doors.matchStarted, 'and builds no world').toBe(false);
  await page.screenshot({ path: `tests/live-stage/${evidence}-doors-evidence.png` });

  // --- 3. Real-press CREATE ROOM. With no allocator in the shipped bundle this is
  //        a graceful refusal that names the door which still works — the offline
  //        promise (GDD §4.8 risk 6). The room-code-and-configure half of CREATE is
  //        proven against a real server in tests/net/online-lobby-flow.test.ts.
  const create = await doorPoint(page, 'create');
  if (!create) throw new Error('the doors reported no CREATE ROOM');
  await pressPoint(create);
  await page.waitForFunction(() => window.__onlineMenu?.status === 'error', undefined, { timeout: 20_000 });
  const refused = await page.evaluate(() => ({
    error: window.__onlineMenu!.error,
    resolvedCode: window.__onlineMenu!.resolvedCode,
    visible: window.__onlineMenu!.visible,
  }));
  expect(refused.error, 'names the offline fallback').toMatch(/SOLO/i);
  expect(refused.resolvedCode, 'no code without the allocator (M3 rule)').toBeNull();
  expect(refused.visible, 'and the doors are still up, ready for another').toBe(true);

  // --- 4. Real-press PLAY SOLO → THE LOBBY, offline flavour. --------------------
  const solo = await doorPoint(page, 'solo');
  if (!solo) throw new Error('the doors reported no PLAY SOLO');
  await pressPoint(solo);
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
  const lobby = await page.evaluate(() => {
    const l = window.__lobby!;
    return {
      online: l.online,
      isHost: l.isHost,
      humanCount: l.humanCount,
      slotCount: l.slotCount,
      size: l.size,
      mapCards: l.mapCards.length,
      classControls: l.classControls.length,
      seatHeight: l.seatHeight,
      rush: l.rushControl.physicalCenter,
      selectedClass: l.selectedClass,
      classOrder: l.classOrder,
      matchStarted: window.__mainMenu!.matchStarted,
    };
  });
  expect(lobby.online, 'the SOLO lobby is the offline flavour — no room code').toBe(false);
  expect(lobby.isHost, 'offline you are the host, so every control is live').toBe(true);
  expect(lobby.slotCount, 'eight seats (GDD §2.1)').toBe(8);
  // The whole affordance set is DRAWN, not just modelled: the arena cards and hull
  // tiles have rects, the roster rows have thumb height, RUSH! has a press point.
  expect(lobby.mapCards, 'the arena cards are laid out').toBeGreaterThan(0);
  expect(lobby.classControls, 'the four hull tiles are laid out').toBe(4);
  expect(lobby.seatHeight, 'the roster rows have height').toBeGreaterThan(0);
  expect(lobby.matchStarted, 'still no world — RUSH! gates it').toBe(false);
  await page.screenshot({ path: `tests/live-stage/${evidence}-lobby-evidence.png` });

  // --- 5. Configure it with a real press: pick a hull that is not the default. ---
  const other = lobby.classOrder.findIndex((c) => c !== lobby.selectedClass);
  const tile = await page.evaluate((i) => {
    const c = window.__lobby!.classControls.find((x) => x.index === i);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, other);
  if (!tile) throw new Error('no hull tile reported');
  await pressPoint(tile);
  await page.waitForFunction(
    (want) => window.__lobby?.selectedClass === want,
    lobby.classOrder[other],
    { timeout: 10_000 },
  );

  // --- 6. Real-press RUSH! → the countdown runs and the world is built. ---------
  await pressPoint(lobby.rush);
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 30_000 });

  expect(pageErrors, `no page errors across the whole flow: ${pageErrors.join('\n')}`).toEqual([]);
}

test('PC: real clicks walk PLAY → doors → PLAY SOLO → lobby → RUSH → match', async ({ page }) => {
  test.setTimeout(120_000);
  await walkThePlayFlow(page, (x, y) => page.mouse.click(x, y), 'unified-play-flow-pc');
});

// Both form factors, always: the same walk with real touch taps at the two device
// profiles the mobile matrix contracts, held in PORTRAIT so the landscape lock's
// rotation remap is in play — a door whose press point does not survive that remap
// is a door a phone player cannot open.
const PHONE_PROFILES = [
  { name: 'iPhone', width: 390, height: 844, dpr: 3 },
  { name: 'Pixel', width: 412, height: 915, dpr: 2.6 },
] as const;

for (const profile of PHONE_PROFILES) {
  test.describe(`phone profile — ${profile.name} (portrait, held)`, () => {
    test.use({
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: profile.dpr,
      viewport: { width: profile.width, height: profile.height },
    });

    test(`${profile.name}: real taps walk PLAY → doors → PLAY SOLO → lobby → RUSH → match`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await walkThePlayFlow(
        page,
        (x, y) => page.touchscreen.tap(x, y),
        `unified-play-flow-${profile.name.toLowerCase()}`,
      );
    });
  });
}

test('BACK out of the lobby lands on a fresh main menu, with no match started (u2)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors = await bootMenu(page);

  // Straight through the doors to the lobby (seam-driven — this test is about the
  // way OUT, and the way in is pressed for real in the walks above).
  await page.evaluate(() => window.__mainMenu!.play());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  const solo = await doorPoint(page, 'solo');
  expect(solo, 'the doors draw PLAY SOLO').not.toBeNull();
  await page.evaluate(() => {
    // The same call the drawn door makes; pressed for real in the walks above.
    (window.__onlineMenu as unknown as { solo(): void }).solo();
  });
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });

  // BACK — the exit every screen carries. It reloads onto a fresh main menu (and in
  // an online room it closes the socket first, so the room is not left holding a
  // seat: `main.ts` `leaveToMenu`).
  await page.evaluate(() => window.__lobby!.leave());
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 30_000,
  });
  const back = await page.evaluate(() => ({
    screen: window.__mainMenu!.screen,
    visible: window.__mainMenu!.visible,
    matchStarted: window.__mainMenu!.matchStarted,
    lobbyPresent: '__lobby' in window,
  }));
  expect(back.screen, 'BACK lands on the main menu').toBe('menu');
  expect(back.visible, 'and the menu is up').toBe(true);
  expect(back.matchStarted, 'leaving a lobby never starts a match').toBe(false);
  expect(back.lobbyPresent, 'the lobby is gone, not hidden behind the menu').toBe(false);

  expect(pageErrors, `no page errors on the way out: ${pageErrors.join('\n')}`).toEqual([]);
});
