/**
 * tests/live-stage/codex.spec.ts — the CODEX reference is wired into the booted
 * client and driven with REAL clicks/taps, on both form factors.
 * OWNER: Gameplay Engineer (brief c1-codex-screen; GDD §2.10).
 *
 * The CODEX model + view unit-test headless (`src/ui/codex.test.ts`), but the M2
 * lesson is that a screen can be model-green and never reached — a missing *wire*
 * no unit test catches. So this spec boots the production build on a clean boot,
 * opens CODEX off the main menu, and proves the whole loop through the front
 * door: CODEX opens the reference (and builds NO match world — it is a door,
 * never a gate, GDD §2.10), a real press on a TAB switches sections, a real press
 * on an ENTRY switches the detail, and BACK returns to the menu with PLAY still
 * ready. It reads back only plain state (the screen name, the active tab, the
 * selected entry title) — never a hit-test seam — and presses at the physical
 * points the client itself reported drawing the controls at (through the
 * landscape-lock remap), so a missing or mis-placed control fails it.
 *
 * A cross-platform feature gets BOTH form factors: the identical walk runs with
 * mouse clicks (PC) and with real touch taps on the two mobile profiles.
 */
import { test, expect, type Page } from '@playwright/test';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface CodexControlReport {
  readonly kind: 'back' | 'tab' | 'entry';
  readonly index: number;
  readonly physicalCenter: PhysicalPoint;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface MainMenuSeam {
  visible: boolean;
  screen: 'menu' | 'settings' | 'codex';
  matchStarted: boolean;
  controls: readonly ControlReport[];
  codexControls: readonly CodexControlReport[];
  codexTab: string;
  codexEntry: string;
  play(): void;
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __planetRush?: unknown;
}
declare const window: Window & StageWindow;

/** A real press at a PAGE coordinate — a left click on PC, a touch tap on a phone. */
type Press = (pageX: number, pageY: number) => Promise<void>;

async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/** A menu button's physical press point by kind (the `controls` list). */
async function menuPoint(page: Page, kind: string): Promise<PhysicalPoint> {
  const p = await page.evaluate((k) => {
    const c = window.__mainMenu?.controls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!p) throw new Error(`no menu control of kind ${kind}`);
  return p;
}

/** A codex control's physical press point by kind + index (the `codexControls`
 *  list — BACK is index -1). Readback only: the client drew it there. */
async function codexPoint(page: Page, kind: 'back' | 'tab' | 'entry', index: number): Promise<PhysicalPoint> {
  const p = await page.evaluate(
    ({ kind, index }) => {
      const c = window.__mainMenu?.codexControls.find((x) => x.kind === kind && x.index === index);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { kind, index },
  );
  if (!p) throw new Error(`no codex control ${kind}#${index}`);
  return p;
}

/** The whole front-door walk, pressing with `press`. Shared by PC and phone so
 *  both prove the identical journey through their own input. */
async function browseCodexThroughMenu(page: Page, press: Press): Promise<void> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20_000 });

  const origin = await canvasOrigin(page);
  const pressPoint = async (p: PhysicalPoint): Promise<void> => {
    await press(origin.x + p.x, origin.y + p.y);
  };

  // On the menu, no world exists — the whole point of the fix.
  expect(await page.evaluate(() => window.__mainMenu!.screen)).toBe('menu');

  // --- Real-press CODEX → the reference opens, and STILL no match world. -------
  await pressPoint(await menuPoint(page, 'codex'));
  await page.waitForFunction(() => window.__mainMenu?.screen === 'codex', undefined, { timeout: 10_000 });
  const onCodex = await page.evaluate(() => ({
    matchStarted: window.__mainMenu!.matchStarted,
    debugPresent: '__planetRush' in window,
    tab: window.__mainMenu!.codexTab,
    entry: window.__mainMenu!.codexEntry,
  }));
  expect(onCodex.matchStarted, 'CODEX is a door, never a gate — it builds no world').toBe(false);
  expect(onCodex.debugPresent, 'clean boot: no match instrument').toBe(false);
  // It opens on the first tab with an entry selected — OBJECTIVE since a0-34
  // put the win condition at the head of the strip (the developer's ruling).
  expect(onCodex.tab).toBe('objective');
  expect(onCodex.entry.length).toBeGreaterThan(0);

  // --- Real-press the SYSTEMS tab (index 3) → the section switches. ------------
  // Index 3, not 2: OBJECTIVE joined the strip in front of the original four
  // (a0-34), and this walk presses where the client says it drew the chip.
  await pressPoint(await codexPoint(page, 'tab', 3));
  await page.waitForFunction(() => window.__mainMenu?.codexTab === 'systems', undefined, { timeout: 10_000 });
  const firstSystemsEntry = await page.evaluate(() => window.__mainMenu!.codexEntry);
  expect(firstSystemsEntry.length).toBeGreaterThan(0);

  // --- Real-press a different ENTRY (index 1) → the detail switches. -----------
  await pressPoint(await codexPoint(page, 'entry', 1));
  await page.waitForFunction(
    (was) => {
      const e = window.__mainMenu?.codexEntry;
      return typeof e === 'string' && e.length > 0 && e !== was;
    },
    firstSystemsEntry,
    { timeout: 10_000 },
  );

  // --- Real-press BACK → the menu, PLAY still ready. --------------------------
  await pressPoint(await codexPoint(page, 'back', -1));
  await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => typeof window.__mainMenu?.play === 'function')).toBe(true);
  expect(await page.evaluate(() => window.__mainMenu!.matchStarted), 'still no world after browsing the codex').toBe(
    false,
  );

  expect(pageErrors, `no page errors browsing the codex: ${pageErrors.join('\n')}`).toEqual([]);
}

test('PC: real clicks open CODEX, switch a tab and an entry, and BACK to the menu', async ({ page }) => {
  test.setTimeout(120_000);
  await browseCodexThroughMenu(page, (x, y) => page.mouse.click(x, y));
});

// The cross-platform contract: the same walk with real touch taps on each of the
// two device profiles the mobile matrix contracts, at their real portrait pixels.
// Under the landscape lock the portrait viewport rotates to a wide, short logical
// screen; the seam reports each control through that remap, so a touch at the
// reported point lands on the control the client actually drew.
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

    test(`${profile.name}: real taps open CODEX, switch a tab and an entry, and BACK`, async ({ page }) => {
      test.setTimeout(120_000);
      await browseCodexThroughMenu(page, (x, y) => page.touchscreen.tap(x, y));
    });
  });
}
