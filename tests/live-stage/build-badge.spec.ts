/**
 * tests/live-stage/build-badge.spec.ts — the build badge is on EVERY screen, in
 * the REAL booted client.
 *
 * The developer's report was not "the badge is wrong", it was *"it only shows in
 * matches"* — a wiring fact, about the boot path, that no unit test can reach:
 * `src/render/build-badge.test.ts` proves the corner geometry and the clearances,
 * and stays perfectly green whether the layer is attached to one screen or to all
 * of them. Only a real boot can walk menu → settings → codex → doors → keypad →
 * lobby → match and report the stamp still in the corner at every stop. That walk
 * is this file, and it is driven with REAL presses at the points the client itself
 * reports drawing its controls at — the same discipline `./codex.spec.ts` uses,
 * because a walk driven entirely through seams proves the seams, not the screens.
 *
 * The badge is Pixi text on a canvas, so it is READ through the read-only
 * `window.__buildBadge` seam (installed in `src/main.ts` beside the layer itself),
 * which reports the drawn string, the drawn rect, and whether that rect is inside
 * the declared `bottom-left` zone — never a re-derived string, so a green run here
 * cannot mean a seam agreeing with itself while the corner says something else.
 *
 * The SERVER half of the badge — `3d7cc6a · d891dd0a (gru)` — needs a fleet to
 * connect to, and lives in `./build-badge-online.spec.ts`, which brings one up.
 * This file is the offline promise: on a build with no allocator wired, the badge
 * is the bare sha, on every page, and it never grows a server it did not reach.
 *
 * HOW TO RUN IT, AND WHAT HAS ACTUALLY BEEN RUN
 * ---------------------------------------------------------------------------
 *   npx playwright test --config tests/live-stage/playwright.config.ts build-badge.spec
 *
 * **This file has NOT been executed.** The lane it was authored in has Chromium's
 * binary but not its shared libraries (`libnss3.so`; `playwright install-deps`
 * needs root, and the lane has no sudo), so every test here fails at browser
 * launch before reaching an assertion — the same condition `./connect-trace.spec.ts`
 * and `./unified-play-flow.spec.ts` document. It needs one run on a box with those
 * libraries; the evidence PNGs it names will land with that run.
 */
import { test, expect, type Page } from '@playwright/test';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface BuildBadgeSeam {
  text: string;
  visible: boolean;
  server: { machine: string; region: string } | null;
  bounds: Rect | null;
  withinAnchor: boolean;
}
interface MainMenuSeam {
  screen: 'menu' | 'settings' | 'codex' | 'online';
  controls: readonly { kind: string; physicalCenter: PhysicalPoint }[];
  settingsControls: readonly { kind: string; physicalCenter: PhysicalPoint }[];
  codexControls: readonly { kind: string; index: number; physicalCenter: PhysicalPoint }[];
}
interface OnlineSeam {
  screen: 'home' | 'join';
  doorControls: readonly { kind: string; physicalCenter: PhysicalPoint }[];
  join(): void;
  solo(): void;
}
interface LobbySeam {
  visible: boolean;
  localShipClass: string | null;
  rush(): void;
}
declare const window: Window & {
  __buildBadge?: BuildBadgeSeam;
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
};

/** A build with no server behind it: seven hex of sha (or the `dev` fallback),
 *  optionally starred for a dirty tree, and NOTHING after it. */
const OFFLINE_TAG = /^(?:[0-9a-f]{7}|dev)\*?$/;

/** Read the badge as it is drawn right now. */
async function badge(page: Page): Promise<BuildBadgeSeam> {
  const seen = await page.evaluate(() => {
    const b = window.__buildBadge;
    if (!b) return null;
    return { text: b.text, visible: b.visible, server: b.server, bounds: b.bounds, withinAnchor: b.withinAnchor };
  });
  expect(seen, 'the client installed no __buildBadge seam').not.toBeNull();
  return seen!;
}

/**
 * The assertion made at every stop on the walk: the stamp is drawn, it says
 * something, and it is in the corner it declares. `where` names the screen, so a
 * failure reads as "the badge went missing on the codex" and not as a line number.
 */
async function expectBadgeOn(page: Page, where: string): Promise<BuildBadgeSeam> {
  const b = await badge(page);
  expect(b.visible, `the badge is not drawn on the ${where}`).toBe(true);
  expect(b.text, `the badge is blank on the ${where}`).not.toBe('');
  expect(b.withinAnchor, `the badge left its bottom-left corner on the ${where}`).toBe(true);
  // Bottom-LEFT, measured rather than declared. The seam reports in LOGICAL
  // (landscape) space, which is the space the badge lays out in on both form
  // factors — so the fractions below hold whichever way a phone is held.
  const box = b.bounds!;
  expect(box.x, `the badge is not against the LEFT edge on the ${where}`).toBeLessThan(64);
  expect(box.height, `the badge is not tiny on the ${where}`).toBeLessThan(20);
  return b;
}

/** Boot a clean client (no `?debug=1`, so the real main menu opens) and wait for
 *  the badge seam, which `boot()` installs before the menu exists. */
async function bootMenu(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__buildBadge?.text === 'string', undefined, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 30_000 });
}

/** The canvas origin in page space: every seam reports canvas-local physical
 *  points, so a real press adds it back to land on the drawn control. */
async function canvasOrigin(page: Page): Promise<PhysicalPoint> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/** A real left click at a canvas-local physical point. */
async function pressAt(page: Page, p: PhysicalPoint): Promise<void> {
  const origin = await canvasOrigin(page);
  await page.mouse.click(origin.x + p.x, origin.y + p.y);
}

/** A named main-menu button's press point. */
async function menuPoint(page: Page, kind: string): Promise<PhysicalPoint> {
  const p = await page.evaluate((k) => {
    const c = window.__mainMenu?.controls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!p) throw new Error(`the menu reported no ${kind} button`);
  return p;
}

test.describe('the build badge is on every single page', () => {
  test('menu, settings, codex, doors, keypad — the stamp never leaves the corner', async ({ page }) => {
    await bootMenu(page);

    // 1. The MAIN MENU. This is the screen the developer said had no badge at all,
    //    because the badge used to be built with the match world.
    const menu = await expectBadgeOn(page, 'main menu');
    expect(menu.text, 'offline, the badge is the build and nothing else').toMatch(OFFLINE_TAG);
    expect(menu.server, 'nothing has connected, so there is no server to name').toBeNull();
    await page.screenshot({ path: 'tests/live-stage/build-badge-menu-evidence.png' });

    // 2. SETTINGS — real press on the menu row, then back out the way in.
    await pressAt(page, await menuPoint(page, 'settings'));
    await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 10_000 });
    await expectBadgeOn(page, 'settings screen');
    const done = await page.evaluate(() => {
      const c = window.__mainMenu?.settingsControls.find((x) => x.kind === 'back');
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    });
    if (done) await pressAt(page, done);
    await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 10_000 });

    // 3. The CODEX.
    await pressAt(page, await menuPoint(page, 'codex'));
    await page.waitForFunction(() => window.__mainMenu?.screen === 'codex', undefined, { timeout: 10_000 });
    await expectBadgeOn(page, 'codex');
    const back = await page.evaluate(() => {
      const c = window.__mainMenu?.codexControls.find((x) => x.kind === 'back');
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    });
    if (back) await pressAt(page, back);
    await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 10_000 });

    // 4. The DOORS (PLAY), and 5. the code KEYPAD behind JOIN.
    await pressAt(page, await menuPoint(page, 'play'));
    await page.waitForFunction(() => window.__mainMenu?.screen === 'online', undefined, { timeout: 10_000 });
    await expectBadgeOn(page, 'doors');
    await page.evaluate(() => window.__onlineMenu?.join());
    await page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 10_000 });
    await expectBadgeOn(page, 'keypad');

    // The tag has not changed once across five screens: it is ONE component
    // riding above them, not five that each remembered to draw a stamp.
    expect((await badge(page)).text).toBe(menu.text);
  });

  test('lobby and match carry the same stamp the menu did', async ({ page }) => {
    await bootMenu(page);
    const onMenu = (await expectBadgeOn(page, 'main menu')).text;

    // PLAY SOLO — the door that needs no server — lands in the LOBBY, where every
    // door lands (ratified: one lobby, both modes).
    await pressAt(page, await menuPoint(page, 'play'));
    await page.waitForFunction(() => window.__mainMenu?.screen === 'online', undefined, { timeout: 10_000 });
    await page.evaluate(() => window.__onlineMenu?.solo());
    await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
    const inLobby = await expectBadgeOn(page, 'lobby');
    await page.screenshot({ path: 'tests/live-stage/build-badge-lobby-evidence.png' });

    // RUSH! — the MATCH, which is the one screen the badge always did reach, and
    // the one with furniture in its bottom-left corner (the desktop controls
    // strip). The stamp is lifted clear of it, and still inside its declared zone.
    await page.evaluate(() => window.__lobby?.rush());
    await page.waitForFunction(
      () => window.__lobby?.visible === false && window.__lobby?.localShipClass !== null,
      undefined,
      { timeout: 60_000 },
    );
    const inMatch = await expectBadgeOn(page, 'match');
    await page.screenshot({ path: 'tests/live-stage/build-badge-match-evidence.png' });

    expect(inLobby.text).toBe(onMenu);
    expect(inMatch.text).toBe(onMenu);
    expect(inMatch.server, 'an offline match is on no server').toBeNull();
  });

  test('stays tiny and cornered on a phone, held portrait', async ({ page }) => {
    // The landscape lock rotates the whole game root on a portrait phone, and the
    // badge rides that rotation — so "bottom-left" here means the bottom-left of
    // the LANDSCAPE game the player sees, which is the space the seam reports in.
    await page.setViewportSize({ width: 390, height: 844 });
    await bootMenu(page);

    const b = await expectBadgeOn(page, 'phone main menu');
    expect(b.text).toMatch(OFFLINE_TAG);
    // Readable but tiny (the ask): a stamp that ate a phone's bottom edge would be
    // covering controls, which is the one thing it may never do.
    expect(b.bounds!.width).toBeLessThan(390 / 2);
    await page.screenshot({ path: 'tests/live-stage/build-badge-phone-evidence.png' });
  });
});
