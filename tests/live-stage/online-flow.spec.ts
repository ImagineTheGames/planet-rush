/**
 * tests/live-stage/online-flow.spec.ts — the ONLINE button is wired, and every
 * way it can fail says the right thing. OWNER: UI Engineer (M3/online step 3;
 * GDD §2.1, §4.2, §4.8 risk 6).
 *
 * The M-series lesson, again: a screen can be model-green in the unit suite and
 * still be unreachable — the main menu itself was retracted for exactly that. The
 * ONLINE front door (CREATE / JOIN a room by code) is new surface on the menu, so
 * this spec boots the REAL production bundle and drives the button a first-time
 * player would press, through the read-only `window.__mainMenu` / `__onlineMenu`
 * seams `main.ts` installs on a clean boot.
 *
 * WHAT A BOOTED CLIENT CAN PROVE HERE, AND WHAT IT CANNOT
 * ------------------------------------------------------------------------------
 * The shipped bundle is the **offline** artifact (no `VITE_ALLOCATOR_URL`), so it
 * has no allocator to reach — which is the point. The M3 brief's contract is that
 * the failures are graceful and *distinct*, and the one a serverless build hits is
 * "can't reach the servers", with PLAY SOLO still named as the door that works
 * (the offline promise, §4.8 risk 6). That is exactly what this spec asserts —
 * that the button opens the door, that CREATE and JOIN each fail *gracefully*
 * rather than hang or throw, that the typed code survives a refusal, and that the
 * region picker is suppressed at one region.
 *
 * The full **two clients joining one room on a deployed server** walk-through
 * needs a live allocator + the match transport (m9-09), neither of which this
 * repo's CI can stand up; the transport handoff on a *successful* resolve is
 * m9-09's seam. The exhaustive per-reason copy (three failures → three messages;
 * server-lost vs grace-expired) is pinned in the unit suite
 * (`src/ui/online-copy.test.ts`, `src/ui/connection-status.test.ts`). Here we
 * prove the wire the unit suite cannot see: that pressing ONLINE reaches a live,
 * graceful screen at all.
 */
import { test, expect, type Page } from '@playwright/test';

/** The clean-boot menu seam (mirrors `installMainMenuSeam` in `main.ts`). */
interface MainMenuSeam {
  visible: boolean;
  screen: 'menu' | 'settings' | 'codex' | 'online';
  play(): void;
  online(): void;
}

/** The ONLINE front-door seam (mirrors `installOnlineSeam` in `main.ts`). */
interface OnlineSeam {
  visible: boolean;
  screen: 'home' | 'join';
  status: 'idle' | 'connecting' | 'error';
  error: string;
  code: string;
  regionPickerVisible: boolean;
  resolvedCode: string | null;
  open(): void;
  create(): void;
  join(): void;
  typeCode(ch: string): void;
  erase(): void;
  submit(): void;
  back(): void;
}

interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
}
declare const window: Window & StageWindow;

/** Boot a clean client and wait until both front-door seams are installed. */
async function bootMenu(page: Page): Promise<void> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.online === 'function', undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => typeof window.__onlineMenu?.open === 'function', undefined, {
    timeout: 20_000,
  });
  // No page errors are allowed across the whole boot — a throw on ONLINE would be
  // exactly the kind of wiring bug this suite exists to catch.
  expect(pageErrors, 'no page errors booting the menu').toEqual([]);
}

test('MAIN MENU → ONLINE opens the room-code front door', async ({ page }) => {
  await bootMenu(page);

  // Before ONLINE, the front door is present in the code but off-screen.
  const before = await page.evaluate(() => ({
    onlineVisible: window.__onlineMenu!.visible,
    menuScreen: window.__mainMenu!.screen,
  }));
  expect(before.onlineVisible, 'the front door is hidden until ONLINE is pressed').toBe(false);
  expect(before.menuScreen).toBe('menu');

  // Press ONLINE — the same call the button makes.
  await page.evaluate(() => window.__mainMenu!.online());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 5_000 });

  const open = await page.evaluate(() => ({
    onlineVisible: window.__onlineMenu!.visible,
    menuScreen: window.__mainMenu!.screen,
    screen: window.__onlineMenu!.screen,
    status: window.__onlineMenu!.status,
    error: window.__onlineMenu!.error,
    regionPickerVisible: window.__onlineMenu!.regionPickerVisible,
  }));
  expect(open.onlineVisible, 'ONLINE opens the front door').toBe(true);
  expect(open.menuScreen, 'the menu hands the screen to the front door').toBe('online');
  expect(open.screen, 'it opens on the CREATE / JOIN home').toBe('home');
  expect(open.status).toBe('idle');
  expect(open.error, 'nothing is wrong on a fresh screen').toBe('');
  // Region is modelled but suppressed at one region (launch): the picker is hidden.
  expect(open.regionPickerVisible, 'one region → no picker (present in code, hidden on screen)').toBe(
    false,
  );

  await page.screenshot({ path: 'tests/live-stage/online-flow-home-evidence.png' });
});

test('CREATE with no server fails gracefully — the offline promise is kept', async ({ page }) => {
  await bootMenu(page);
  await page.evaluate(() => window.__mainMenu!.online());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 5_000 });

  // CREATE with no allocator configured: the request never leaves, so this is a
  // network failure — and it must land as a message, never a hang or a throw.
  await page.evaluate(() => window.__onlineMenu!.create());
  await page.waitForFunction(() => window.__onlineMenu?.status === 'error', undefined, { timeout: 5_000 });

  const failed = await page.evaluate(() => ({
    status: window.__onlineMenu!.status,
    error: window.__onlineMenu!.error,
    visible: window.__onlineMenu!.visible,
    resolvedCode: window.__onlineMenu!.resolvedCode,
  }));
  expect(failed.status, 'the attempt resolved into an error, not a hang').toBe('error');
  expect(failed.error.length, 'the failure says something').toBeGreaterThan(0);
  // Graceful server-unreachable messaging: plain words, and the door that works.
  expect(failed.error, 'names the offline fallback (§4.8 risk 6)').toMatch(/SOLO/i);
  expect(failed.error, 'reads as unreachable, not a raw code').toMatch(/reach|connection/i);
  // The client never minted a room code (M3 rule — only the allocator does).
  expect(failed.resolvedCode, 'no code without the allocator').toBeNull();
  // Still on the front door, ready to retry — a dead server costs a session, not the game.
  expect(failed.visible).toBe(true);

  await page.screenshot({ path: 'tests/live-stage/online-flow-offline-evidence.png' });
});

test('JOIN takes a typed code and fails gracefully, keeping the code for a retry', async ({ page }) => {
  await bootMenu(page);
  await page.evaluate(() => window.__mainMenu!.online());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 5_000 });

  // Open the keypad and type a four-character code (the ambiguity-free alphabet).
  await page.evaluate(() => window.__onlineMenu!.join());
  await page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 5_000 });
  const CODE = 'K7QM';
  await page.evaluate((code) => {
    for (const ch of code) window.__onlineMenu!.typeCode(ch);
  }, CODE);
  expect(await page.evaluate(() => window.__onlineMenu!.code), 'the code is what was typed').toBe(CODE);

  // Submit: with no server this refuses, but the code survives so a retry is one tap.
  await page.evaluate(() => window.__onlineMenu!.submit());
  await page.waitForFunction(() => window.__onlineMenu?.status === 'error', undefined, { timeout: 5_000 });

  const afterSubmit = await page.evaluate(() => ({
    status: window.__onlineMenu!.status,
    error: window.__onlineMenu!.error,
    code: window.__onlineMenu!.code,
    screen: window.__onlineMenu!.screen,
  }));
  expect(afterSubmit.status).toBe('error');
  expect(afterSubmit.error.length).toBeGreaterThan(0);
  expect(afterSubmit.code, 're-typing four keys is not the price of one refusal').toBe(CODE);
  expect(afterSubmit.screen, 'still on the keypad, ready to retry').toBe('join');
});

test('two independent clients each reach the ONLINE front door', async ({ browser }) => {
  // The real "two clients join one room on the deployed server" needs a live
  // allocator + the m9-09 transport (out of this harness). What a serverless boot
  // CAN prove is that two independent clients each stand the ONLINE screen up
  // cleanly and independently — no shared global state, no cross-talk, no throw.
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    await bootMenu(a);
    await bootMenu(b);

    for (const page of [a, b]) {
      await page.evaluate(() => window.__mainMenu!.online());
      await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, {
        timeout: 5_000,
      });
    }

    const [openA, openB] = await Promise.all([
      a.evaluate(() => window.__onlineMenu!.visible && window.__onlineMenu!.screen),
      b.evaluate(() => window.__onlineMenu!.visible && window.__onlineMenu!.screen),
    ]);
    expect(openA, 'client A reaches the front door').toBe('home');
    expect(openB, 'client B reaches the front door').toBe('home');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('BACK walks the front door back to the menu', async ({ page }) => {
  await bootMenu(page);
  await page.evaluate(() => window.__mainMenu!.online());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 5_000 });

  // Into the keypad, then BACK to the doors…
  await page.evaluate(() => window.__onlineMenu!.join());
  await page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 5_000 });
  await page.evaluate(() => window.__onlineMenu!.back());
  await page.waitForFunction(() => window.__onlineMenu?.screen === 'home', undefined, { timeout: 5_000 });

  // …then BACK again returns the whole screen to the main menu.
  await page.evaluate(() => window.__onlineMenu!.back());
  await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 5_000 });
  expect(await page.evaluate(() => window.__onlineMenu!.visible), 'the front door is dismissed').toBe(false);
});

test('the home screen itself has a BACK to the main menu (u2 — the field-report fix)', async ({
  page,
}) => {
  // The developer report: the ONLINE screen (PLAY SOLO / CREATE ROOM / JOIN ROOM /
  // SETTINGS) had no way back to the main menu. From the *home* screen — not the
  // keypad — BACK must now return straight to the menu, the exit every screen
  // carries. The screenshot is the visual evidence that the BACK button is drawn
  // and that the subtitle is the tagline, not the title repeated.
  await bootMenu(page);
  await page.evaluate(() => window.__mainMenu!.online());
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 5_000 });
  await page.waitForFunction(() => window.__onlineMenu?.screen === 'home', undefined, { timeout: 5_000 });

  await page.screenshot({ path: 'tests/live-stage/online-flow-back-evidence.png' });

  // One BACK from the home screen returns the whole screen to the main menu — no
  // keypad detour, no reload.
  await page.evaluate(() => window.__onlineMenu!.back());
  await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 5_000 });
  const after = await page.evaluate(() => ({
    menuScreen: window.__mainMenu!.screen,
    onlineVisible: window.__onlineMenu!.visible,
  }));
  expect(after.menuScreen, 'home BACK lands on the main menu').toBe('menu');
  expect(after.onlineVisible, 'the front door is dismissed').toBe(false);
});
