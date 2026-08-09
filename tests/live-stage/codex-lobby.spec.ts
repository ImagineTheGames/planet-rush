/**
 * tests/live-stage/codex-lobby.spec.ts — the LOBBY reuses the codex data, wired
 * into the booted client and driven with a REAL hover (PC) and a REAL long-press
 * (touch). OWNER: Gameplay Engineer (brief c1-codex-screen; GDD §2.10 point 2).
 *
 * "The lobby reuses the same data where it answers a live question … hull
 * description on the ship-class picker … small, non-blocking, dismissible." The
 * resolvers unit-test headless (`codexShipHint` / `codexBotHint`), but — the M2
 * lesson again — only the booted client proves the tooltip is actually wired to a
 * hover and a long-press. So this boots clean, opens the lobby off PLAY, and:
 *  - PC: moves the mouse over a hull tile → the codex hull description appears
 *    (`__lobby.hintTitle` goes non-null); moving away dismisses it.
 *  - touch: presses and HOLDS on a hull tile → the same hint appears after the
 *    hold; it is a passive overlay, so it never eats the tile's tap.
 * Readback only (`hintTitle`), pressed at the physical points the client itself
 * reported drawing the hull tiles at (through the landscape-lock remap).
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface ClassControl {
  readonly index: number;
  readonly physicalCenter: PhysicalPoint;
}
interface MainMenuSeam {
  controls: readonly ControlReport[];
  play(): void;
}
interface LobbySeam {
  visible: boolean;
  hintTitle: string | null;
  /** Which of the room's three screens is up (u10-01). */
  screen: string;
  /** The lobby's ONE ship card — the control that opens SHIP SELECT. */
  shipCardControl: { physicalCenter: PhysicalPoint };
  /** The four hull tiles, once SHIP SELECT is open. Empty on the roster. */
  classControls: readonly ClassControl[];
  rush(): void;
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __lobby?: LobbySeam;
}
declare const window: Window & StageWindow;

async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/**
 * Boot clean, open the lobby off a real PLAY press, **press the lobby's one ship
 * card to open SHIP SELECT** (u10-01 — the four hull tiles moved there), and
 * return the canvas origin + the physical page point of hull tile #`tile`.
 *
 * The dossiers moved with the tiles rather than being dropped: GDD §2.10 point 2's
 * codex reuse is a property of a hull tile, so it is wherever the tiles are.
 */
async function openLobbyToTile(
  page: Page,
  press: (x: number, y: number) => Promise<void>,
  tile: number,
): Promise<{ origin: { x: number; y: number }; point: PhysicalPoint }> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20_000 });

  const origin = await canvasOrigin(page);
  const play = await page.evaluate(() => {
    const c = window.__mainMenu?.controls.find((x) => x.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!play) throw new Error('no PLAY control');
  await press(origin.x + play.x, origin.y + play.y);

  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });

  // …then the ship card, pressed the way a player presses it.
  const card = await page.evaluate(() => {
    const c = window.__lobby?.shipCardControl;
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!card) throw new Error('no ship card control');
  await press(origin.x + card.x, origin.y + card.y);
  await page.waitForFunction(
    (t) => window.__lobby?.screen === 'ship-select' && (window.__lobby?.classControls.length ?? 0) > t,
    tile,
    { timeout: 10_000 },
  );
  const point = await page.evaluate((t) => {
    const c = window.__lobby!.classControls.find((x) => x.index === t)!;
    return { x: c.physicalCenter.x, y: c.physicalCenter.y };
  }, tile);
  return { origin, point };
}

test('PC: hovering a hull tile shows the codex hull description, moving away dismisses it', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Open the lobby with a real CLICK on PLAY; the hover comes after.
  const { origin, point } = await openLobbyToTile(page, (x, y) => page.mouse.click(x, y), 1);

  // No hint before hovering.
  expect(await page.evaluate(() => window.__lobby!.hintTitle)).toBeNull();

  // Move the mouse onto the hull tile → the codex hull description appears.
  await page.mouse.move(origin.x + point.x, origin.y + point.y);
  await page.waitForFunction(() => (window.__lobby?.hintTitle?.length ?? 0) > 0, undefined, { timeout: 10_000 });
  const shown = await page.evaluate(() => window.__lobby!.hintTitle);
  expect(shown && shown.length, 'a hull description is shown on hover').toBeTruthy();

  // Move well away (top-left corner) → the tooltip dismisses.
  await page.mouse.move(origin.x + 2, origin.y + 2);
  await page.waitForFunction(() => window.__lobby?.hintTitle === null, undefined, { timeout: 10_000 });

  expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
});

// The touch form factor: a press-and-HOLD on a hull tile reveals the same codex
// hull description (the long-press equivalent of the desktop hover), on the two
// mobile profiles the matrix contracts.
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

    test(`${profile.name}: long-pressing a hull tile shows the codex hull description`, async ({ page }) => {
      test.setTimeout(120_000);
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));

      // Open the lobby with a real tap on PLAY.
      const { origin, point } = await openLobbyToTile(page, (x, y) => page.touchscreen.tap(x, y), 1);
      expect(await page.evaluate(() => window.__lobby!.hintTitle)).toBeNull();

      // Press and HOLD on the hull tile: touchStart, wait past the hold threshold,
      // then touchEnd — the hint must appear during the hold (a passive overlay).
      const client: CDPSession = await page.context().newCDPSession(page);
      const px = Math.round(origin.x + point.x);
      const py = Math.round(origin.y + point.y);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py }] });
      await page.waitForFunction(() => (window.__lobby?.hintTitle?.length ?? 0) > 0, undefined, { timeout: 10_000 });
      const shown = await page.evaluate(() => window.__lobby!.hintTitle);
      expect(shown && shown.length, 'a hull description is shown on long-press').toBeTruthy();
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();

      // Still in the lobby — the dossier never gated play.
      expect(await page.evaluate(() => window.__lobby!.visible)).toBe(true);
      expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
    });
  });
}
