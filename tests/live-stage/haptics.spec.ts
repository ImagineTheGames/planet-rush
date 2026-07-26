/**
 * tests/live-stage/haptics.spec.ts — vibration in the REAL booted client.
 * OWNER: Platform Engineer (field request v0.2.2; src/platform/haptics.ts).
 *
 * The unit tests (`src/platform/haptics.test.ts`) prove the vocabulary and its
 * gates in isolation. What a boot proves is that the service is *wired*: a real
 * pointer tap on an on-screen control reaches `haptic('tap')` and drives the real
 * `navigator.vibrate`.
 *
 * Headless Chromium has no motor, so `navigator.vibrate` is absent and the service
 * would (correctly) run as a silent no-op. To exercise the wired path we inject a
 * recording `navigator.vibrate` *before any page script runs* (`addInitScript`),
 * so `createBrowserHaptics` feature-detects it as supported at construction. Every
 * pattern the game plays is then captured in `window.__vibrateLog` for assertion —
 * the same trick a physical device's motor would perform, minus the buzz.
 *
 * Driven through the `?debug=1` `window.__upgradeWheelStage` seam (to open the
 * wheel) plus a genuine `page.mouse.click` (to tap it) — the click travels the
 * real `pointerdown` path in `main.ts`, so this asserts the wiring, not a stub.
 */
import { test, expect } from '@playwright/test';

interface UpgradeWheelStage {
  openBuild(): { open: boolean } | null;
  interactive(): boolean;
}
interface HapticsTestWindow {
  __upgradeWheelStage?: UpgradeWheelStage;
  /** The patterns handed to the injected `navigator.vibrate`, in order. */
  __vibrateLog?: Array<number | number[]>;
}
declare const window: Window & HapticsTestWindow;

/** Install a recording `navigator.vibrate` before the client boots, so the
 *  haptics service detects a "motor" and every fired pattern is captured. */
async function armVibrateSpy(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const log: Array<number | number[]> = [];
    (window as HapticsTestWindow).__vibrateLog = log;
    // `configurable` so it defines cleanly whether or not the platform already
    // exposes a (no-op) `vibrate`; return true like the real API.
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: (pattern: number | number[]) => {
        log.push(pattern);
        return true;
      },
    });
  });
}

async function boot(page: import('@playwright/test').Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__upgradeWheelStage?.openBuild === 'function',
    undefined,
    { timeout: 20_000 },
  );
  return pageErrors;
}

test('tapping an open wheel fires the tap pattern through the real navigator.vibrate', async ({
  page,
}) => {
  await armVibrateSpy(page);
  const pageErrors = await boot(page);

  // The spy is installed and empty — nothing has buzzed yet on a quiet boot.
  const before = await page.evaluate(() => window.__vibrateLog!.slice());
  expect(before, 'no haptic before any interaction').toEqual([]);

  // Open the build wheel via the debug seam, then tap it with a REAL pointer at
  // screen centre — that click travels the live `pointerdown` path, where an open
  // wheel's press fires `haptic('tap')`.
  await page.evaluate(() => window.__upgradeWheelStage!.openBuild());
  await page.waitForFunction(() => window.__upgradeWheelStage!.interactive() === true, undefined, {
    timeout: 20_000,
  });

  const box = await page.locator('canvas').boundingBox();
  expect(box, 'the canvas is on screen').not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The tap pattern (a single ~10ms buzz) must have reached the motor.
  const log = await page
    .waitForFunction(() => (window.__vibrateLog!.length > 0 ? window.__vibrateLog! : null), undefined, {
      timeout: 20_000,
    })
    .then((h) => h.jsonValue());

  expect(log, 'exactly the tap event fired').toEqual([10]);
  expect(pageErrors, 'no page errors driving the haptics path').toEqual([]);
});
