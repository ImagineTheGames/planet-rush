/**
 * tests/live-stage/fullscreen.spec.ts — FULLSCREEN ON PLAY, verified in the REAL
 * booted client. OWNER: Platform Engineer (field request v0.1.1).
 *
 * The developer's ask: "hide the browser's title bar — it takes up so much game
 * space." The answer is the Fullscreen API entered on the PLAY gesture, plus the
 * native landscape lock it makes legal. The trap this class of test exists for
 * (like the enemy-fire and main-menu field bugs before it): a lifecycle that is
 * component-green but never actually WIRED into the booted client. Only booting
 * the shipped bundle and driving the real menu → match → fullscreen path can
 * prove the wire.
 *
 * The Fullscreen API is *stubbed* here — a controllable fake installed before
 * boot — for two reasons the brief sanctions ("stub the API to throw"): a real
 * grant needs a live user gesture headless can't reliably synthesise, and the
 * thing under test is our WIRING, not the browser's fullscreen implementation. So
 * the fake lets us drive enter, a system-gesture exit, and outright rejection
 * deterministically, and assert what the client does with each:
 *
 *  1. PLAY makes the GAME ROOT (`#app`) the fullscreen element.
 *  2. Backing out of fullscreen keeps the game running and raises the re-enter
 *     affordance at its registered top-right anchor (no dead corners).
 *  3. A rejected request boots into exactly today's behaviour — no error screen,
 *     no affordance nagged onto a working game.
 *
 * Phone profile: a touch, landscape phone viewport — fullscreen-on-PLAY and the
 * affordance are a mobile concern (desktop is deliberately never auto-fullscreened).
 */
import { test, expect, type Page } from '@playwright/test';

// The phone profile (field request: mobile). Touch + a landscape phone viewport,
// overriding the config's desktop project for this file only.
test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

/** The read-only `window.__mainMenu` seam (src/main.ts) — we only need PLAY here. */
interface MenuSeam {
  matchStarted: boolean;
  play(): void;
}
/** The read-only `window.__lobby` seam (src/main.ts `openLobby`). Since M4, PLAY
 *  opens the LOBBY between the menu and the match; RUSH! is what boots the world,
 *  so reaching the match (and this fullscreen seam) now goes through it. Fullscreen
 *  itself is still entered on PLAY (unchanged) — the lobby just sits inside it. */
interface LobbySeam {
  rush(): void;
}
/** The read-only `window.__fullscreen` seam (src/main.ts `FullscreenSeam`). */
interface FullscreenSeam {
  supported: boolean;
  active: boolean;
  everEntered: boolean;
  affordanceVisible: boolean;
  activeElementId: string | null;
  rootId: string | null;
  anchor: { region: string; margin: number };
  bounds: { x: number; y: number; width: number; height: number } | null;
  withinAnchor: boolean;
}
interface StageWindow {
  __mainMenu?: MenuSeam;
  __lobby?: LobbySeam;
  __fullscreen?: FullscreenSeam;
}
declare const window: Window & StageWindow;

/** Install a WORKING controllable Fullscreen API before any page script runs: a
 *  request makes its element the `fullscreenElement` and fires `fullscreenchange`;
 *  `exitFullscreen` clears it and fires the event too. Deterministic, no gesture. */
async function installWorkingFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const holder: { current: Element | null } = { current: null };
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => holder.current });
    Element.prototype.requestFullscreen = function (this: Element): Promise<void> {
      holder.current = this;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    document.exitFullscreen = function (): Promise<void> {
      holder.current = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });
}

/** Install a Fullscreen API whose requests REJECT — the iOS/odd-embed path. The
 *  API exists (so the client attempts it), it just never grants. */
async function installRejectingFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
    Element.prototype.requestFullscreen = function (): Promise<void> {
      return Promise.reject(new Error('fullscreen denied (stubbed)'));
    };
  });
}

/** Boot a clean (non-debug) build and wait for the menu seam + the PLAY method. */
async function bootToMenu(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20_000 });
}

/** Press PLAY and drive the lobby's RUSH! through to a built match world.
 *
 * Fullscreen is entered on PLAY (a user gesture — unchanged by M4). Since M4, PLAY
 * opens the LOBBY rather than building the world directly, so reaching the match
 * (and the `__fullscreen` seam, which installs after the match boots) now goes
 * through RUSH!. Every fullscreen assertion below is unchanged; only the path to
 * the match gained the lobby it always should have had (GDD §2.1). */
async function pressPlay(page: Page): Promise<void> {
  await page.evaluate(() => window.__mainMenu!.play());
  // The lobby seam appears after PLAY; RUSH! runs the countdown and boots the match.
  await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__lobby!.rush());
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 20_000 });
  // The __fullscreen seam installs on the same synchronous boot continuation.
  await page.waitForFunction(() => '__fullscreen' in window, undefined, { timeout: 20_000 });
}

test('PLAY makes the game root the fullscreen element', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await installWorkingFullscreen(page);
  await bootToMenu(page);
  await pressPlay(page);

  // The whole game (#app) is fullscreen — the browser chrome / title bar is gone.
  const el = await page.evaluate(() => document.fullscreenElement?.id ?? null);
  expect(el, 'PLAY makes #app (the game root) the fullscreen element').toBe('app');

  // And the seam agrees: active, on the game root it targeted.
  const seam = await page.evaluate(() => {
    const f = window.__fullscreen!;
    return { active: f.active, activeElementId: f.activeElementId, rootId: f.rootId, supported: f.supported };
  });
  expect(seam.supported, 'fullscreen is supported on this profile').toBe(true);
  expect(seam.active, 'the client reports itself fullscreen after PLAY').toBe(true);
  expect(seam.activeElementId, 'the fullscreen element is the game root').toBe('app');
  expect(seam.rootId, 'the client targeted the game root for fullscreen').toBe('app');

  expect(pageErrors, 'no page errors entering fullscreen on PLAY').toEqual([]);
});

test('backing out of fullscreen keeps the game running and offers the re-enter affordance at its anchor', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await installWorkingFullscreen(page);
  await bootToMenu(page);
  await pressPlay(page);

  // A render frame has run in fullscreen — the lifecycle has recorded that the
  // game HAS been fullscreen, the precondition for offering re-entry.
  await page.waitForFunction(() => window.__fullscreen?.everEntered === true, undefined, { timeout: 20_000 });

  // The user backs out with a system gesture / ESC (the exact thing the brief
  // says must never strand the game). Simulate it via the stubbed exit.
  await page.evaluate(() => document.exitFullscreen());

  // The game keeps running and the small re-enter affordance appears.
  await page.waitForFunction(() => window.__fullscreen?.affordanceVisible === true, undefined, { timeout: 20_000 });

  const after = await page.evaluate(() => {
    const f = window.__fullscreen!;
    return {
      active: f.active,
      affordanceVisible: f.affordanceVisible,
      withinAnchor: f.withinAnchor,
      anchor: f.anchor,
      bounds: f.bounds,
      matchStarted: window.__mainMenu?.matchStarted ?? false,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });

  expect(after.active, 'no longer fullscreen after backing out').toBe(false);
  expect(after.matchStarted, 'the match is still running — the exit did not kill it').toBe(true);
  expect(after.affordanceVisible, 'the re-enter affordance is on screen').toBe(true);
  // Registered in the layout registry at its declared anchor — "no dead corners".
  expect(after.anchor.region, 'the affordance is anchored top-right').toBe('top-right');
  expect(after.withinAnchor, 'the affordance sits inside its declared anchor zone').toBe(true);
  expect(after.bounds, 'the affordance has a real rendered rect').not.toBeNull();
  const b = after.bounds!;
  expect(b.width, 'the affordance has extent').toBeGreaterThan(0);
  expect(b.x + b.width, 'the affordance is on screen (right edge)').toBeLessThanOrEqual(after.vw + 1);
  expect(b.y, 'the affordance is on screen (top edge)').toBeGreaterThanOrEqual(-1);

  expect(pageErrors, 'no page errors across the fullscreen exit').toEqual([]);
});

test('a rejected fullscreen request boots into exactly today’s behaviour', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await installRejectingFullscreen(page);
  await bootToMenu(page);
  await pressPlay(page);

  // The world was still built — PLAY's fullscreen rejection never blocked boot.
  const state = await page.evaluate(() => {
    const f = window.__fullscreen!;
    return {
      matchStarted: window.__mainMenu?.matchStarted ?? false,
      active: f.active,
      everEntered: f.everEntered,
      affordanceVisible: f.affordanceVisible,
      activeElementId: f.activeElementId,
    };
  });

  expect(state.matchStarted, 'the match boots normally despite the rejected fullscreen').toBe(true);
  expect(state.active, 'never entered fullscreen (the request was rejected)').toBe(false);
  expect(state.activeElementId, 'nothing is fullscreen').toBeNull();
  expect(state.everEntered, 'the game was never fullscreen').toBe(false);
  // Crucially: no re-enter affordance nagged onto a working game (requirement 2).
  expect(state.affordanceVisible, 'no affordance is shown when fullscreen was never granted').toBe(false);

  // No error screen over the game — the boot-error DOM screen must be absent.
  const bootError = await page.evaluate(() => !!document.querySelector('.boot-error, #boot-error, [data-boot-error]'));
  expect(bootError, 'no error screen over a working game').toBe(false);

  expect(pageErrors, 'a rejected fullscreen request raises no page error').toEqual([]);
});
