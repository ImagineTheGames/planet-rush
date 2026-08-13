/**
 * tests/live-stage/a0-37-controls-strip.spec.ts — the controls strip as the
 * player reads it, on the REAL booted bundle, in each scheme and each fire mode.
 * OWNER: UI Engineer (a0-37; GDD §2.2, §2.4).
 *
 * ## What only a boot can prove
 *
 * `src/ui/controls-strip.test.ts` proves `controlsStripView` returns the right
 * rows for every (device, mode, scheme). What it cannot prove is what the shipped
 * client HANDS it — and that hand-off is the entire a0-37 bug. The seated scheme
 * travels `readControlScheme` (storage) → `controlScheme` → `HudFrame.controlScheme`
 * → `Hud.updateControlsStrip`, and until this branch the last leg did not exist:
 * the HUD called a function that had no scheme parameter, so a developer sitting
 * in Tap Commander read the sticks' bindings off the bottom of their own screen.
 * A unit test is green over that wiring gap in either direction.
 *
 * So this reads back the rows the HUD actually RESOLVED for the frame it drew
 * (`__upgradeWheelStage.legend()`, which returns `Hud.debugControlsStrip()`),
 * beside the device and scheme the client seated itself in.
 *
 * ## What it asserts
 *
 *  - **the developer's own frame**: a fresh profile on a PC — which since a0-30
 *    means Tap Commander + Auto-aim on every platform — must not read
 *    `WASD Thrust · Left mouse Fire / Mine`. It reads *"Click anywhere · Move or
 *    attack"*, the developer's own words;
 *  - **Sticks + Manual is untouched**, to the letter: GDD §2.4's table;
 *  - **Sticks + Auto-aim** says when to fire rather than how to aim;
 *  - **the verb is the device's** (§2.4, 2026-08-06): a PC is told to *click*.
 *    With a pad seated, the same tap row stands and the Build key becomes the
 *    pad's own `Y / △` — the binding Tap Commander leaves live;
 *  - **Build & Upgrade is still named in full** (GDD §2.5) in every scheme.
 *
 * Everything is staged the way a player arrives: what is in storage before the
 * bundle's first line runs (`planet-rush:controlScheme`, `planet-rush:fireMode`
 * — `src/main.ts`), never by poking the HUD. An empty store is the fresh profile,
 * and therefore the shipped default.
 */
import { test, expect, type Page } from '@playwright/test';

/** One resolved strip row, as `Hud.debugControlsStrip()` returns it. A dimmed row
 *  drops its key entirely (`binding: null`) — the legend never prints a dead one. */
interface LegendRow {
  readonly action: string;
  readonly label: string;
  readonly binding: string | null;
  readonly dimmed: boolean;
}
interface WheelStage {
  legend(): readonly LegendRow[];
}
interface OnboardingStage {
  device(): 'keyboard' | 'gamepad' | 'touch';
  scheme(): 'sticks' | 'tap';
}
declare const window: Window & {
  __upgradeWheelStage?: WheelStage;
  __onboardingStage?: OnboardingStage;
  __padAxes?: number[];
};

/** The two storage keys the client seats itself from at boot (`src/main.ts`). */
const SCHEME_KEY = 'planet-rush:controlScheme';
const FIRE_KEY = 'planet-rush:fireMode';

/** Frames, not milliseconds — the honest unit on a software-GL runner. */
async function frames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = (): void => {
          if (left-- <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

/** The strip as a player reads it, left→right, exactly as `Hud.rebuildStrip`
 *  lays it out: the key glyph, then the action. */
function read(rows: readonly LegendRow[]): string {
  return rows.map((r) => (r.binding === null ? r.label : `${r.binding} ${r.label}`)).join('    ');
}

/**
 * Boot the real bundle with a KNOWN profile and read back the strip the HUD
 * resolved. `scheme` / `mode` left undefined means nothing saved — the fresh
 * profile, which is the case the brief is about.
 */
async function bootStrip(
  page: Page,
  { scheme, mode, pad }: { scheme?: 'sticks' | 'tap'; mode?: 'manual' | 'auto-aim'; pad?: boolean } = {},
): Promise<{ rows: LegendRow[]; line: string; device: string; scheme: string }> {
  const seed: [string, string][] = [];
  if (scheme !== undefined) seed.push([SCHEME_KEY, scheme]);
  if (mode !== undefined) seed.push([FIRE_KEY, mode]);
  await page.addInitScript((entries: [string, string][]) => {
    localStorage.clear();
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, seed);

  if (pad) {
    // One connected standard pad whose left stick this test can move. The client
    // switches `activeDevice` on the device that last ACTED (`src/main.ts`
    // `sampleInput`), so a connected-but-idle pad would leave the strip on the
    // keyboard — the stick has to be pushed, which is what `__padAxes` is for.
    await page.addInitScript(() => {
      window.__padAxes = [0, 0, 0, 0];
      const pads = [
        {
          connected: true,
          id: 'stub pad (standard)',
          index: 0,
          mapping: 'standard',
          get axes(): number[] {
            return window.__padAxes!;
          },
          buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        },
      ];
      Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
    });
  }

  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__upgradeWheelStage?.legend === 'function' &&
      typeof window.__onboardingStage?.scheme === 'function',
    undefined,
    { timeout: 20_000 },
  );

  if (pad) {
    // Push the stick, let the client poll it, then centre it again: the pad has
    // acted, so it owns the strip, and the ship is not left flying into a rock.
    await page.evaluate(() => {
      window.__padAxes = [0.9, 0, 0, 0];
    });
    await frames(page, 8);
    await page.evaluate(() => {
      window.__padAxes = [0, 0, 0, 0];
    });
  }

  await frames(page, 8);
  const out = await page.evaluate(() => ({
    rows: window.__upgradeWheelStage!.legend() as LegendRow[],
    device: window.__onboardingStage!.device(),
    scheme: window.__onboardingStage!.scheme(),
  }));
  return { ...out, line: read(out.rows) };
}

test.describe('the controls strip names the scheme the player is actually in', () => {
  test("the developer's own frame — fresh PC profile, Tap Commander + Auto-aim", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { rows, line, device, scheme } = await bootStrip(page);

    expect(device, 'a mouse-and-keyboard boot resolves the keyboard bindings').toBe('keyboard');
    expect(scheme, 'a fresh profile boots into Tap Commander on a PC too (a0-30)').toBe('tap');

    // The brief's acceptance test, on the drawn legend.
    expect(line, 'the row build 75ec737 drew — thrust keys this scheme zeroes').not.toContain('WASD');
    expect(line, 'the fire key the local pilot presses, not the player').not.toContain(
      'Left mouse Fire / Mine',
    );
    expect(line, "the developer's own words").toContain('Click anywhere Move or attack');
    expect(rows[0]?.action, 'the primary action comes first').toBe('command');

    // Tap Commander leaves the build binding as the devices wrote it, so the key
    // is real here — and named in full, never just "BUILD" (GDD §2.5).
    const build = rows.find((r) => r.action === 'build');
    expect(build?.label === 'Build & Upgrade' || build?.dimmed, 'build row present').toBeTruthy();

    await page.screenshot({ path: 'tests/live-stage/a0-37-strip-tap-autoaim-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Sticks + Manual is GDD §2.4’s own table, to the letter', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { rows, line, scheme } = await bootStrip(page, { scheme: 'sticks', mode: 'manual' });

    expect(scheme, 'a saved preference wins over the default (a0-30 item 2)').toBe('sticks');
    expect(rows.map((r) => r.action)).toEqual(['thrust', 'aim', 'fire', 'build']);
    expect(line).toContain('WASD Thrust    Mouse Aim    Left mouse Fire / Mine');

    await page.screenshot({ path: 'tests/live-stage/a0-37-strip-sticks-manual-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('Sticks + Auto-aim says WHEN to fire, not how to aim', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { rows, line } = await bootStrip(page, { scheme: 'sticks', mode: 'auto-aim' });

    expect(rows.some((r) => r.action === 'aim'), 'the aim row folds away (GDD §2.4)').toBe(false);
    const fire = rows.find((r) => r.action === 'fire');
    expect(fire?.binding, 'the key is unchanged — auto-aim moved the aiming').toBe('Left mouse');
    expect(fire?.label).toBe('Hold to fire / mine — auto-aim picks the target');
    expect(line).toContain('WASD Thrust');

    await page.screenshot({ path: 'tests/live-stage/a0-37-strip-sticks-autoaim-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('with a pad in hand, Tap Commander keeps the tap row and the pad’s own build key', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { rows, line, device, scheme } = await bootStrip(page, { scheme: 'tap', pad: true });

    expect(device, 'the pad acted last, so the strip is the pad’s').toBe('gamepad');
    expect(scheme).toBe('tap');
    // The order is still placed with a pointer — no pad button places one — so the
    // verb stays "click" and the strip does not invent a pad binding for it.
    expect(line).toContain('Click anywhere Move or attack');
    expect(line).not.toContain('Left stick Thrust');
    const build = rows.find((r) => r.action === 'build');
    expect(build?.binding === 'Y / △' || build?.dimmed, 'the pad’s own build key, or dimmed away from home').toBeTruthy();

    await page.screenshot({ path: 'tests/live-stage/a0-37-strip-tap-gamepad-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
