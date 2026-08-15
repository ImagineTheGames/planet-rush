/**
 * tests/live-stage/a0-30-defaults.spec.ts — Tap Commander and Auto-aim are what a
 * FRESH PROFILE gets, on every platform, in the REAL booted client.
 * OWNER: Platform Engineer (GDD §2.4, amended 2026-08-12; `docs/design-amendments.md`).
 *
 * The ratification: *"is tap commander and auto aim default on all platforms it
 * should be"* … *"I already said BOTH"*. Two defaults moved, and a unit test can
 * prove neither of the two things that can actually go wrong in the shipped game:
 *
 *  1. **What the settings screen SAYS on the device in front of the player.** The
 *     CONTROLS row's wording is a rule (u8-01, 2026-08-06: the row names the
 *     DEVICE, never the internal scheme name) and the developer has caught that
 *     row lying once already, with a screenshot. `controlsValue()` is pure and its
 *     unit tests pass every device in by hand — only a booted client decides which
 *     device it actually passes. So this spec reads the words off the seam
 *     (`__mainMenu.settingsRows`, the same {@link settingsModel} the view draws) on
 *     a desktop profile, a touch profile, and with a pad connected.
 *  2. **That a SAVED preference still wins.** Moving a default is one line; moving
 *     everyone's setting with it is the regression, and it lives in the boot path's
 *     storage read, not in any pure model. The last test here boots a profile that
 *     has already chosen Sticks + Manual and asserts the client seats them.
 *
 * Front door only: every screen is reached by a REAL press at the physical point
 * the client itself reported drawing the control at (the discipline the original
 * CONTROLS-row evidence was missing — it flipped the scheme through a debug seam,
 * so a missing row read as present). The only seam reads are plain state.
 */
import { test, expect, type Page } from '@playwright/test';

/** The read-only clean-boot seam, narrowed to what this spec drives. Mirrors the
 *  object `main.ts` installs in `openMainMenu`. */
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: { readonly x: number; readonly y: number };
}
interface RowReport {
  readonly kind: string;
  readonly label: string;
  readonly value: string;
}
interface MainMenuSeam {
  screen: 'menu' | 'settings' | 'codex' | 'online' | 'hangar';
  controls: readonly ControlReport[];
  settingsControls: readonly ControlReport[];
  settingsRows: readonly RowReport[];
  controlScheme: 'sticks' | 'tap';
}
declare const window: Window & { __mainMenu?: MainMenuSeam };

/** The storage keys the two defaults are read through — the real ones, spelled the
 *  way `main.ts` spells them, because a typo here would make this spec pass by
 *  testing an empty profile twice. */
const SCHEME_KEY = 'planet-rush:controlScheme';
const FIRE_KEY = 'planet-rush:fireMode';

/** Boot the real bundle on a clean menu with a KNOWN profile.
 *
 * `stored` is written before the app's first line runs, so the client's own boot
 * read is what sees it — no reload, no post-hoc poke at a value already read. An
 * empty `stored` is the fresh profile: storage is cleared, so this cannot pass on a
 * leftover value from the previous test in the file. */
async function bootMenu(page: Page, stored: Record<string, string> = {}): Promise<void> {
  await page.addInitScript((entries: [string, string][]) => {
    localStorage.clear();
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, Object.entries(stored));
  // `?gate=0` (a0-50): the title gate is a DOOR in front of the title screen,
  // opened by a press over four beats. This spec walks through the front door on
  // its way somewhere else. The flag turns off that one screen and nothing else —
  // the menu, the doors and the lobby below are the real ones. See
  // `src/ui/title-gate.ts` `gateEnabled`.
  await page.goto('/?gate=0', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, {
    timeout: 20_000,
  });
}

/** Make every `navigator.getGamepads()` slot report one connected standard pad,
 *  before boot — the one browser read behind `TWIN STICKS` (`anyGamepadConnected`). */
async function withGamepad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = { connected: true, id: 'stub pad (standard)', index: 0, mapping: 'standard' };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
  });
}

/** The physical press point of a menu button / settings row, from the seam's own
 *  report, in page space (the seam reports canvas-local physical points). */
async function pressPoint(
  page: Page,
  list: 'controls' | 'settingsControls',
  kind: string,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const p = await page.evaluate(
    ({ list, kind }) => {
      const c = (window.__mainMenu?.[list] ?? []).find((x) => x.kind === kind);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { list, kind },
  );
  if (!p) throw new Error(`no ${list} control of kind ${kind}`);
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Walk the front door to the settings screen and return the rows it is drawing. */
async function openSettings(page: Page, touch: boolean): Promise<RowReport[]> {
  const at = await pressPoint(page, 'controls', 'settings');
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 10_000 });
  // The rows are reported by the frame that draws them, so wait for a drawn frame
  // rather than reading the empty pre-open array.
  await page.waitForFunction(() => (window.__mainMenu?.settingsRows.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });
  return page.evaluate(() => window.__mainMenu!.settingsRows.map((r) => ({ ...r })));
}

/** The value of one row by kind — `FIRE MODE`'s and `CONTROLS`'s words. */
function valueOf(rows: readonly RowReport[], kind: string): string {
  const row = rows.find((r) => r.kind === kind);
  if (!row) throw new Error(`no settings row of kind ${kind} (got: ${rows.map((r) => r.kind).join(', ')})`);
  return row.value;
}

/** The whole assertion, for a fresh profile on any device: both defaults seated,
 *  and the two rows saying so in the ratified words. */
async function expectFreshDefaults(page: Page, rows: readonly RowReport[]): Promise<void> {
  expect(valueOf(rows, 'fireMode'), 'FIRE MODE reads AUTO-AIM on a fresh profile').toBe('AUTO-AIM');
  expect(valueOf(rows, 'controls'), 'CONTROLS reads TAP COMMANDER on every device').toBe('TAP COMMANDER');
  const seated = await page.evaluate(() => window.__mainMenu!.controlScheme);
  expect(seated, 'and the scheme the client actually seated is the tap scheme').toBe('tap');
}

// ---------------------------------------------------------------------------
// Fresh profile — desktop (keyboard + mouse), the platform whose default moved
// on BOTH counts.
// ---------------------------------------------------------------------------

test('a fresh profile on desktop boots Tap Commander + Auto-aim', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await bootMenu(page);
  // Nothing stored — the precondition the whole change is scoped to.
  const stored = await page.evaluate(
    (k) => ({ scheme: localStorage.getItem(k.scheme), fire: localStorage.getItem(k.fire) }),
    { scheme: SCHEME_KEY, fire: FIRE_KEY },
  );
  expect(stored, 'a fresh profile has chosen nothing').toEqual({ scheme: null, fire: null });

  const rows = await openSettings(page, false);
  await expectFreshDefaults(page, rows);
  await page.screenshot({ path: 'tests/live-stage/a0-30-desktop-fresh-evidence.png' });

  expect(pageErrors, 'no page errors on the settings screen').toEqual([]);
});

// ---------------------------------------------------------------------------
// Fresh profile — with a pad connected. The one device whose CONTROLS row has a
// *different* word for the other scheme (`TWIN STICKS`), so it is the device the
// row is most likely to lie on.
// ---------------------------------------------------------------------------

test('a fresh profile with a gamepad connected boots the same pair', async ({ page }) => {
  await withGamepad(page);
  await bootMenu(page);
  expect(await page.evaluate(() => navigator.getGamepads().length), 'the stub pad is visible').toBe(1);

  const rows = await openSettings(page, false);
  await expectFreshDefaults(page, rows);
  // TAP COMMANDER is the scheme's word on every device — the pad does not get its
  // own, and `TWIN STICKS` appears only when the sticks are actually seated (below).
  expect(valueOf(rows, 'controls')).not.toBe('TWIN STICKS');
  await page.screenshot({ path: 'tests/live-stage/a0-30-gamepad-fresh-evidence.png' });
});

// ---------------------------------------------------------------------------
// Fresh profile — a touch device. Auto-aim was already the touch default; Tap
// Commander was not, so this proves the half that moved here too.
// ---------------------------------------------------------------------------

test.describe('on a touch device', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('a fresh profile boots Tap Commander + Auto-aim, reached by a real tap', async ({ page }) => {
    await bootMenu(page);
    expect(await page.evaluate(() => navigator.maxTouchPoints > 0), 'the client sees a touch device').toBe(
      true,
    );

    const rows = await openSettings(page, true);
    await expectFreshDefaults(page, rows);
    await page.screenshot({ path: 'tests/live-stage/a0-30-touch-fresh-evidence.png' });
  });
});

// ---------------------------------------------------------------------------
// A SAVED preference survives — the regression this change could most easily
// have caused (a0-30 item 2: read before you default).
// ---------------------------------------------------------------------------

test('a profile that already chose Sticks + Manual keeps both', async ({ page }) => {
  await bootMenu(page, { [SCHEME_KEY]: 'sticks', [FIRE_KEY]: 'manual' });

  const rows = await openSettings(page, false);
  expect(valueOf(rows, 'fireMode'), 'the stored Manual survives the new default').toBe('MANUAL');
  // And the row names the DEVICE, not the scheme's internal name (u8-01): a PC with
  // no pad reads KEYBOARD + MOUSE. That rule is untouched by the default moving.
  expect(valueOf(rows, 'controls'), 'the stored sticks survive, worded for the device').toBe(
    'KEYBOARD + MOUSE',
  );
  const seated = await page.evaluate(() => window.__mainMenu!.controlScheme);
  expect(seated, 'the client seated the saved scheme, not the default').toBe('sticks');
  await page.screenshot({ path: 'tests/live-stage/a0-30-saved-preference-evidence.png' });
});

test('a saved-Sticks profile WITH a pad reads TWIN STICKS — the other scheme still words itself', async ({
  page,
}) => {
  await withGamepad(page);
  await bootMenu(page, { [SCHEME_KEY]: 'sticks', [FIRE_KEY]: 'manual' });

  const rows = await openSettings(page, false);
  expect(valueOf(rows, 'controls')).toBe('TWIN STICKS');
  expect(valueOf(rows, 'fireMode')).toBe('MANUAL');
  await page.screenshot({ path: 'tests/live-stage/a0-30-saved-gamepad-evidence.png' });
});
