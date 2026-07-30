/**
 * tests/mobile/landscape-lock.spec.ts — the landscape lock. OWNER: Platform Engineer.
 *
 * Field report v0.1.1: the developer opened Planet Rush in portrait by mistake,
 * turned the phone to landscape, and "the menus were all off screen and it
 * couldn't be fixed." Two truths, both proven here:
 *
 *  1. **Re-layout regression.** Every screen must re-lay-out on a viewport change,
 *     so rotating the phone can never strand the UI drawn for the old viewport.
 *  2. **The game IS landscape on mobile, always** (ratified). A portrait phone is
 *     rotated 90° so the player sees a landscape game; touch input is remapped
 *     through that rotation, so a physical tap still lands on the logical control.
 *
 * These assert against the Platform Engineer's own seams — no pixel-hunting:
 *   - `window.__mainMenu` (a clean, non-`?debug=1` boot) reports the LOGICAL
 *     (landscape) viewport, the `rotated` flag, and every menu button's logical
 *     rect + the physical point a tap must hit to reach it.
 *   - `window.__planetRush` (a `?debug=1` boot, which drops straight into a match)
 *     reports the local ship in the logical viewport, for the centring contract.
 *
 * The DoD gate for this branch is `tsc`, unit tests, and `playwright test --list`;
 * the live run belongs in the mobile container against the built bundle.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';

// Touch profiles rotate a portrait viewport to landscape; the desktop control
// never does (it is the un-rotated baseline). See playwright.config.ts.
const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

/** A rect in logical (landscape) screen space, CSS px. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The `window.__mainMenu` seam this suite reads (src/main.ts `MainMenuSeam`). */
interface MenuSeam {
  readonly visible: boolean;
  readonly matchStarted: boolean;
  readonly rotated: boolean;
  readonly logicalViewport: { readonly width: number; readonly height: number };
  readonly controls: ReadonlyArray<{
    readonly kind: 'play' | 'settings';
    readonly logical: Rect;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  }>;
}

/**
 * The `window.__onlineMenu` doors seam (src/main.ts `OnlineSeam`) — the screen PLAY
 * opens since the ratified ONE play flow: PLAY SOLO / CREATE ROOM / JOIN ROOM, plus
 * BACK. Each door reports the physical point a tap must hit to reach it, exactly as
 * the main menu's controls do, so the rotation remap is provable on this screen too.
 */
interface DoorsSeam {
  readonly visible: boolean;
  readonly doorControls: ReadonlyArray<{
    readonly kind: string;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  }>;
}

/** The `window.__planetRush` centring instrument (src/platform/debug-hook.ts). */
interface DebugState {
  readonly shipScreen: { readonly x: number; readonly y: number };
  readonly viewport: { readonly w: number; readonly h: number };
}

/** The `window.__lobby` seam this suite reads (src/main.ts `LobbySeam`). PLAY now
 *  opens the LOBBY before the match (GDD §2.1), so the remap must be proven a
 *  second time here — a physical tap on RUSH!, whose logical rect + physical tap
 *  point the seam reports the same way the menu reports its buttons. */
interface LobbySeam {
  readonly visible: boolean;
  readonly slotCount: number;
  readonly online: boolean;
  readonly selectedClass: string;
  readonly defaultClass: string;
  readonly classOrder: readonly string[];
  readonly logicalViewport: { readonly width: number; readonly height: number };
  readonly content: Rect;
  readonly rushControl: {
    readonly logical: Rect;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  };
  readonly localShipClass: string | null;
}

const CENTER_TOL = 0.05; // within 5% of centre — the M1 phone-report gate

// --- Fixtures ---------------------------------------------------------------

/** Force the viewport to a given orientation, swapping the project's default dims
 *  if needed. Run before a `goto`, or as a rotation mid-test. */
async function setOrientation(page: Page, mode: 'landscape' | 'portrait'): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) return;
  const isLandscape = vp.width >= vp.height;
  if (isLandscape !== (mode === 'landscape')) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
  }
}

/** Boot a clean (non-debug) build and wait until the main menu seam is live. */
async function bootMenu(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu;
      return !!m && m.visible && m.logicalViewport.width > 0 && m.controls.length > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** Snapshot the menu seam (structured-cloned, so the live object can't shift). */
async function readMenu(page: Page): Promise<MenuSeam> {
  const m = await page.evaluate(() => {
    const s = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu;
    if (!s) return null;
    return {
      visible: s.visible,
      matchStarted: s.matchStarted,
      rotated: s.rotated,
      logicalViewport: { width: s.logicalViewport.width, height: s.logicalViewport.height },
      controls: s.controls.map((c) => ({
        kind: c.kind,
        logical: { x: c.logical.x, y: c.logical.y, width: c.logical.width, height: c.logical.height },
        physicalCenter: { x: c.physicalCenter.x, y: c.physicalCenter.y },
      })),
    } satisfies MenuSeam;
  });
  expect(m, '__mainMenu present on a clean boot').not.toBeNull();
  return m as MenuSeam;
}

/** Wait until the lobby seam is live and laid out (via the layout registry), then
 *  snapshot it (structured-cloned, so the live object can't shift under the test). */
async function readLobby(page: Page): Promise<LobbySeam> {
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __lobby?: LobbySeam }).__lobby;
      return !!s && s.visible && s.slotCount > 0 && s.logicalViewport.width > 0;
    },
    undefined,
    // Generous: CI boots the dev server cold and mobile runs on software WebGL, so
    // the menu-boot → PLAY → lobby-install chain is slow under parallel projects.
    { timeout: 30_000 },
  );
  const s = await page.evaluate(() => {
    const l = (window as unknown as { __lobby?: LobbySeam }).__lobby;
    if (!l) return null;
    return {
      visible: l.visible,
      slotCount: l.slotCount,
      online: l.online,
      selectedClass: l.selectedClass,
      defaultClass: l.defaultClass,
      classOrder: [...l.classOrder],
      logicalViewport: { width: l.logicalViewport.width, height: l.logicalViewport.height },
      content: { ...l.content },
      rushControl: {
        logical: { ...l.rushControl.logical },
        physicalCenter: { x: l.rushControl.physicalCenter.x, y: l.rushControl.physicalCenter.y },
      },
      localShipClass: l.localShipClass,
    } satisfies LobbySeam;
  });
  expect(s, '__lobby present after PLAY on a clean boot').not.toBeNull();
  return s as LobbySeam;
}

/** Dispatch a physical single-tap at a raw canvas coordinate through CDP — the
 *  same touch a finger makes, un-rotated by the DOM edge into logical space. */
async function physicalTap(page: Page, x: number, y: number): Promise<void> {
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

/** Assert a rect sits entirely inside the logical viewport (1px slop for rounding). */
function assertInside(r: Rect, vp: { width: number; height: number }, tag: string): void {
  const t = 1;
  expect(r.width, `${tag}: has extent`).toBeGreaterThan(0);
  expect(r.height, `${tag}: has extent`).toBeGreaterThan(0);
  expect(r.x, `${tag}: left inside`).toBeGreaterThanOrEqual(-t);
  expect(r.y, `${tag}: top inside`).toBeGreaterThanOrEqual(-t);
  expect(r.x + r.width, `${tag}: right inside (vp.w=${vp.width})`).toBeLessThanOrEqual(vp.width + t);
  expect(r.y + r.height, `${tag}: bottom inside (vp.h=${vp.height})`).toBeLessThanOrEqual(vp.height + t);
}

/** Every menu control inside the logical viewport, labelled by `tag`. */
function assertMenuInside(m: MenuSeam, tag: string): void {
  for (const c of m.controls) assertInside(c.logical, m.logicalViewport, `${tag}/${c.kind}`);
}

// ===========================================================================
// 1. Portrait boot → menu renders, all anchors inside the logical landscape vp
// ===========================================================================

test('portrait boot: the menu lays out inside the logical landscape viewport', async ({ page }, testInfo) => {
  await setOrientation(page, 'portrait');
  await bootMenu(page);
  const m = await readMenu(page);

  if (isTouchProject(testInfo.project.name)) {
    // The landscape lock fired: the root is rotated and the logical viewport the
    // menu laid out against is landscape (wider than tall), despite a portrait phone.
    expect(m.rotated, 'portrait mobile viewport is rotated to landscape').toBe(true);
    expect(
      m.logicalViewport.width,
      `logical viewport is landscape (${m.logicalViewport.width}×${m.logicalViewport.height})`,
    ).toBeGreaterThanOrEqual(m.logicalViewport.height);
  }

  // Every registered menu control sits inside the logical viewport — none stranded.
  expect(m.controls.length).toBeGreaterThan(0);
  assertMenuInside(m, 'portrait @ boot');
});

// ===========================================================================
// 2. The report's exact sequence: portrait → landscape → portrait, valid always
// ===========================================================================

test('rotate portrait→landscape→portrait keeps the menu on screen (re-layout regression)', async ({
  page,
}, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'the landscape lock is a mobile concern');

  // Boot portrait (the developer's mistaken opening orientation).
  await setOrientation(page, 'portrait');
  await bootMenu(page);
  let m = await readMenu(page);
  expect(m.rotated).toBe(true);
  assertMenuInside(m, 'boot portrait');

  // Turn the phone to landscape — the moment the old build stranded the menu.
  await setOrientation(page, 'landscape');
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu?.rotated === false,
    undefined,
    { timeout: 10_000 },
  );
  m = await readMenu(page);
  expect(m.rotated, 'now natively landscape — no rotation needed').toBe(false);
  assertMenuInside(m, 'rotated to landscape');

  // Turn it back to portrait — anchors must be valid again (re-layout, not a one-shot).
  await setOrientation(page, 'portrait');
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu?.rotated === true,
    undefined,
    { timeout: 10_000 },
  );
  m = await readMenu(page);
  expect(m.rotated, 're-rotated to landscape from portrait').toBe(true);
  assertMenuInside(m, 'rotated back to portrait');
});

// ===========================================================================
// 3. Three physical portrait taps, remapped through the rotation: PLAY opens the
//    DOORS, PLAY SOLO opens the LOBBY, RUSH! boots the match with the hull
//    picked there (GDD §2.1; the ratified ONE play flow).
// ===========================================================================
//
// Since M4, PLAY no longer builds the match directly, and since the ratified ONE
// play flow it no longer opens the lobby directly either: PLAY opens the DOORS
// (PLAY SOLO / CREATE ROOM / JOIN ROOM), PLAY SOLO opens the lobby, and RUSH! is
// the door that boots the world. The old separate offline-lobby entry point is
// gone — one way in — so the journey this test walks gained a screen.
//
// That makes the landscape-lock remap provable on THREE screens rather than two,
// which is the point: a physical portrait tap has to land on the logical PLAY
// control (→ the doors render), then on the logical PLAY SOLO door (→ the lobby
// renders), then on the logical RUSH! control (→ the match boots with the chosen
// hull). Each touch is proven against the owning screen's own layout-registry seam
// — `__mainMenu.controls`, `__onlineMenu.doorControls`, `__lobby.rushControl` — so
// none of it is pixel-hunting, and a screen that drew its control in the wrong
// place fails on its own report rather than on a screenshot.

test('three physical taps remap through the rotation: PLAY → doors → PLAY SOLO → lobby, RUSH! → match with the chosen hull', async ({
  page,
}, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'the touch remap only rotates on mobile');
  // This is the longest journey any mobile test takes (portrait boot ->
  // rotation -> menu tap -> lobby tap -> full match assembly) and CI's
  // software-GL runners spend most of a default 60s budget on the preamble
  // alone — it flaked #71 four times and then main itself. Budget the whole
  // journey, not just the waits.
  test.setTimeout(180_000);

  const vp = page.viewportSize()!;
  /** A remapped tap point must sit inside the PHYSICAL portrait canvas — proof the
   *  logical (landscape) rect was mapped back through the rotation, not read raw
   *  (a raw logical x would exceed the portrait width). */
  const assertInsidePhysical = (p: { x: number; y: number }, tag: string): void => {
    expect(p.x, `${tag}: physical x ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(p.x, `${tag}: physical x ≤ vp.width (${vp.width})`).toBeLessThanOrEqual(vp.width);
    expect(p.y, `${tag}: physical y ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(p.y, `${tag}: physical y ≤ vp.height (${vp.height})`).toBeLessThanOrEqual(vp.height);
  };

  await setOrientation(page, 'portrait');
  await bootMenu(page);
  const m = await readMenu(page);
  expect(m.rotated).toBe(true);

  // --- Tap 1: PLAY. The physical spot the logical PLAY button occupies. -------
  const play = m.controls.find((c) => c.kind === 'play');
  expect(play, 'PLAY control present in the layout registry').toBeTruthy();
  assertInsidePhysical(play!.physicalCenter, 'PLAY');
  await physicalTap(page, play!.physicalCenter.x, play!.physicalCenter.y);

  // --- Tap 2: PLAY SOLO, on the doors PLAY opens (the ONE play flow). ---------
  // The doors seam appearing is proof the PLAY tap un-rotated onto the logical
  // control. PLAY builds no match and no lobby — it opens exactly this screen.
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
      return !!d && d.visible && d.doorControls.length > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  const solo = await page.evaluate(() => {
    const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
    const c = (d?.doorControls ?? []).find((x) => x.kind === 'solo');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(solo, 'PLAY SOLO door present in the doors layout registry').toBeTruthy();
  assertInsidePhysical(solo!, 'PLAY SOLO');
  await physicalTap(page, solo!.x, solo!.y);

  // The lobby seam appearing — laid out via its own layout registry (eight seats,
  // a content box inside the logical viewport) — is proof the PLAY SOLO tap
  // un-rotated onto the logical door. It opens the screen; it builds no match.
  const lobby = await readLobby(page);
  expect(lobby.visible, 'lobby is up after the PLAY SOLO tap').toBe(true);
  expect(lobby.slotCount, 'lobby laid out its eight seats (GDD §2.1)').toBe(8);
  expect(lobby.online, 'offline solo-vs-bots lobby').toBe(false);
  expect(
    lobby.localShipClass,
    'no match world built yet — PLAY SOLO only opens the lobby',
  ).toBeNull();
  assertInside(lobby.content, lobby.logicalViewport, 'lobby content box');

  // --- Pick a NON-default hull, so "boots with the chosen hull" is meaningful. -
  const pickIndex = lobby.classOrder.findIndex((c) => c !== lobby.defaultClass);
  expect(pickIndex, 'a hull other than the default exists to pick').toBeGreaterThanOrEqual(0);
  const chosen = lobby.classOrder[pickIndex];
  await page.evaluate(
    (i) => (window as unknown as { __lobby: { selectClass(i: number): void } }).__lobby.selectClass(i),
    pickIndex,
  );
  await page.waitForFunction(
    (cls) => (window as unknown as { __lobby?: LobbySeam }).__lobby?.selectedClass === cls,
    chosen,
    { timeout: 15_000 },
  );

  // --- Tap 2: RUSH!. Re-read the seam so the RUSH rect reflects the current
  //     layout, then tap the physical spot the logical RUSH! button occupies. ---
  const withPick = await readLobby(page);
  expect(withPick.selectedClass, 'the non-default hull is the selected one').toBe(chosen);
  expect(withPick.selectedClass, 'and it is not the onboarding default').not.toBe(withPick.defaultClass);

  const rush = withPick.rushControl;
  assertInside(rush.logical, withPick.logicalViewport, 'RUSH! control'); // not stranded off-screen
  assertInsidePhysical(rush.physicalCenter, 'RUSH!'); // remapped back into the portrait canvas
  await physicalTap(page, rush.physicalCenter.x, rush.physicalCenter.y);

  // RUSH! is the one door that builds a match world — matchStarted flips only after
  // the world is assembled, so this proves the second tap landed on the logical
  // RUSH! control. And the world's local ship IS the hull picked here: the chosen
  // class threaded through the rotation-remapped lobby all the way into the sim.
  // 60s, not 20s: CI's software-GL runners assemble the match world slowly, and
  // the tight wait flaked PR #71 three times on an unrelated red (it flakes on
  // main too). Same lesson as the drag test: never race the wall clock in CI.
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu?.matchStarted === true,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    (cls) => (window as unknown as { __lobby?: LobbySeam }).__lobby?.localShipClass === cls,
    chosen,
    { timeout: 60_000 },
  );
});

// ===========================================================================
// 4. In-match: a portrait viewport still centres the ship in logical space
// ===========================================================================

test('in-match: a portrait viewport keeps the ship centred in logical (landscape) space', async ({
  page,
}, testInfo) => {
  // ?debug=1 skips the menu and boots straight into a match, exposing the centring
  // instrument. It must report the LOGICAL viewport and a centred ship under rotation.
  await setOrientation(page, 'portrait');
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __planetRush?: DebugState }).__planetRush;
      return !!d && d.viewport.w > 0 && d.viewport.h > 0;
    },
    undefined,
    { timeout: 15_000 },
  );

  const d = await page.evaluate(() => {
    const s = (window as unknown as { __planetRush?: DebugState }).__planetRush!;
    return { shipScreen: { x: s.shipScreen.x, y: s.shipScreen.y }, viewport: { w: s.viewport.w, h: s.viewport.h } };
  });

  if (isTouchProject(testInfo.project.name)) {
    // The debug hook reports the LOGICAL viewport — landscape even on a portrait phone.
    expect(d.viewport.w, `logical viewport landscape (${d.viewport.w}×${d.viewport.h})`).toBeGreaterThanOrEqual(
      d.viewport.h,
    );
  }

  // Centring holds in logical space: the ship sits within 5% of {w/2, h/2}.
  const dx = Math.abs(d.shipScreen.x - d.viewport.w / 2);
  const dy = Math.abs(d.shipScreen.y - d.viewport.h / 2);
  expect(dx, `ship x off-centre by ${dx.toFixed(1)}px (limit ${(CENTER_TOL * d.viewport.w).toFixed(1)})`).toBeLessThan(
    CENTER_TOL * d.viewport.w,
  );
  expect(dy, `ship y off-centre by ${dy.toFixed(1)}px (limit ${(CENTER_TOL * d.viewport.h).toFixed(1)})`).toBeLessThan(
    CENTER_TOL * d.viewport.h,
  );
});
