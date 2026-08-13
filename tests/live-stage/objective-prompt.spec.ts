/**
 * tests/live-stage/objective-prompt.spec.ts — the OBJECTIVE prompt as a PLAYER
 * reads it, on the real booted bundle, on a desktop and on a 390 px handset; and
 * the codex section behind it, opened through the front door.
 * OWNER: UI Engineer (a0-34, GDD §1 / §2.10).
 *
 * ## What only a boot can prove
 *
 * `src/ui/onboarding.test.ts` proves the machine returns the objective prompt
 * first and retires it once read. What it cannot prove is that a *match* ever
 * shows it: the prompt's dwell is measured on `HudFrame.time`, which the HUD is
 * handed by `src/main.ts`'s render loop, and a feed that never carried the clock
 * would leave the machine green and the screen silent — the M2 lesson, in the one
 * place it can still bite. So this reads back the sentence the HUD DREW on the
 * first frames of a real match (`__onboardingStage.prompt()`), on the same frame
 * it screenshots.
 *
 * ## What it asserts, and why each one
 *
 *  - the FIRST prompt of a first match **names the win condition** — the failure
 *    this brief exists for is a game that teaches four verbs and never the goal;
 *  - it carries the developer's four beats (last station standing, mine ore,
 *    spend on defenses / your ship, attack when you judge it) — the substance is
 *    ratified even though the wording is polish;
 *  - it reads **identically on the phone**: no binding in it, so nothing to
 *    resolve per device, and the 390 px landscape case measures the drawn box
 *    against the band it was wrapped to (§4.7: "length is part of clarity") —
 *    this is the longest onboarding sentence in the game;
 *  - the CODEX opens on **OBJECTIVE**, whose first entry is the win condition —
 *    the developer's ruling on where the answer lives, proved through a real
 *    press rather than a model.
 */
import { test, expect, type Page } from '@playwright/test';

interface OnboardingStage {
  prompt(): { visible: boolean; text: string; wrapWidth: number; width: number; height: number };
  device(): 'keyboard' | 'gamepad' | 'touch';
}
interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface MainMenuSeam {
  screen: string;
  controls: readonly ControlReport[];
  codexTab: string;
  codexEntry: string;
  play(): void;
}
interface StageWindow {
  __onboardingStage?: OnboardingStage;
  __mainMenu?: MainMenuSeam;
}
declare const window: Window & StageWindow;

/** Frames, not milliseconds — the honest unit on a software-GL runner. */
async function frames(page: Page, n = 4): Promise<void> {
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

/**
 * Boot a match and read back the prompt the HUD has up. Nothing is staged: the
 * objective prompt has no contextual trigger — it is what the game says first —
 * so a plain boot is the whole test fixture, and that is the point.
 */
async function readFirstPrompt(page: Page): Promise<{
  prompt: { visible: boolean; text: string; wrapWidth: number; width: number; height: number };
  device: string;
}> {
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__onboardingStage?.prompt === 'function',
    undefined,
    { timeout: 20_000 },
  );
  await frames(page, 4);
  return page.evaluate(() => ({
    prompt: window.__onboardingStage!.prompt(),
    device: window.__onboardingStage!.device(),
  }));
}

/** The four beats the developer ratified, each as the assertion it is. */
function expectTheObjective(text: string): void {
  expect(text, 'the win condition, in the first three words').toMatch(/last station standing/i);
  expect(text, 'mine ore').toMatch(/mine ore/i);
  expect(text, 'spend it on the station').toMatch(/defen[cs]e/i);
  expect(text, '…or on the ship').toMatch(/upgrade your ship/i);
  expect(text, 'attack when you judge it right').toMatch(/attack when you judge it right/i);
  // Input-agnostic by having nothing device-shaped in it at all (GDD §2.10).
  expect(text, 'no unresolved action token').not.toMatch(/[{}]/);
  expect(text, 'a phone has no E key').not.toMatch(/press E\b/);
}

test.describe('the first match says what winning is, before it teaches a verb', () => {
  test('desktop — the first prompt on screen is the objective', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { prompt, device } = await readFirstPrompt(page);

    expect(device, 'a mouse-and-keyboard boot').toBe('keyboard');
    expect(prompt.visible, 'a first match opens with the objective (a0-34)').toBe(true);
    expectTheObjective(prompt.text);

    await page.screenshot({ path: 'tests/live-stage/objective-prompt-desktop-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test.describe('on a 390 px handset, held landscape', () => {
    // The way a player holds the phone, and the 390-px-tall case a0-24 had to fix
    // the prompt band for. `hasTouch` is what the client reads at boot.
    test.use({
      viewport: { width: 844, height: 390 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });

    test('phone — the same sentence, and it fits the band it was wrapped to', async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));

      const { prompt, device } = await readFirstPrompt(page);

      expect(device, 'a touch boot (GDD §2.4)').toBe('touch');
      expect(prompt.visible, 'the objective is not a desktop feature').toBe(true);
      expectTheObjective(prompt.text);

      // Length is part of clarity (GDD §4.7). This is the longest onboarding
      // sentence in the game, so the narrow case measures rather than assumes.
      expect(
        prompt.width,
        `drawn ${prompt.width.toFixed(0)}px vs wrap ${prompt.wrapWidth.toFixed(0)}px`,
      ).toBeLessThanOrEqual(prompt.wrapWidth + 1);
      expect(
        prompt.text.endsWith('…'),
        "a prompt that ellipsizes is a prompt that didn't fire",
      ).toBe(false);

      await page.screenshot({
        path: 'tests/live-stage/objective-prompt-phone-landscape-evidence.png',
      });
      expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    });
  });
});

test('the codex opens on OBJECTIVE, and its first entry is the win condition', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 20_000,
  });

  // A real click on CODEX, at the point the client says it drew the plate.
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const point = await page.evaluate(() => {
    const c = window.__mainMenu?.controls.find((x) => x.kind === 'codex');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!point) throw new Error('no CODEX control on the menu');
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => window.__mainMenu?.screen === 'codex', undefined, {
    timeout: 10_000,
  });

  const opened = await page.evaluate(() => ({
    tab: window.__mainMenu!.codexTab,
    entry: window.__mainMenu!.codexEntry,
  }));
  // "id make it the first thing in the codex, and make sure it's section is the
  // first" — the developer, ruling on placement (a0-34).
  expect(opened.tab).toBe('objective');
  expect(opened.entry).toMatch(/last station standing/i);

  await frames(page, 4);
  await page.screenshot({ path: 'tests/live-stage/objective-codex-evidence.png' });
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
