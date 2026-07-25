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

/** The `window.__planetRush` centring instrument (src/platform/debug-hook.ts). */
interface DebugState {
  readonly shipScreen: { readonly x: number; readonly y: number };
  readonly viewport: { readonly w: number; readonly h: number };
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
// 3. CDP touch at a physical portrait coordinate lands on the logical PLAY button
// ===========================================================================

test('a physical touch lands on the logical PLAY control (touch remapped through rotation)', async ({
  page,
}, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'the touch remap only rotates on mobile');

  await setOrientation(page, 'portrait');
  await bootMenu(page);
  const m = await readMenu(page);
  expect(m.rotated).toBe(true);

  const play = m.controls.find((c) => c.kind === 'play');
  expect(play, 'PLAY control present in the layout registry').toBeTruthy();
  const target = play!.physicalCenter;

  // The physical tap point sits inside the physical portrait canvas — proof the
  // logical (landscape) rect was mapped back through the rotation, not read raw
  // (the raw logical x would exceed the portrait width).
  const vp = page.viewportSize()!;
  expect(target.x).toBeGreaterThanOrEqual(0);
  expect(target.x).toBeLessThanOrEqual(vp.width);
  expect(target.y).toBeGreaterThanOrEqual(0);
  expect(target.y).toBeLessThanOrEqual(vp.height);

  // Tap the physical spot the logical PLAY button occupies. The DOM edge un-rotates
  // it back to the logical PLAY rect, hit-tests PLAY, and opens the lobby.
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(target.x), y: Math.round(target.y) }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }

  // Since M4, PLAY opens the LOBBY between the menu and the match (GDD §2.1). The
  // lobby seam appearing proves the tap landed on PLAY — the un-rotation worked —
  // and RUSH! through it then builds the match world (matchStarted flips true),
  // which is the end of the same chain this test was always asserting.
  await page.waitForFunction(
    () => typeof (window as unknown as { __lobby?: { rush(): void } }).__lobby?.rush === 'function',
    undefined,
    { timeout: 15_000 },
  );
  await page.evaluate(() => (window as unknown as { __lobby: { rush(): void } }).__lobby.rush());
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu?.matchStarted === true,
    undefined,
    { timeout: 15_000 },
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
