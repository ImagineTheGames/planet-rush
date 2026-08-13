/**
 * tests/live-stage/haul-prompt.spec.ts — the HAUL-HOME prompt as a PLAYER reads
 * it, on the real booted bundle, on a desktop and on a phone, **in each control
 * scheme**. OWNER: UI Engineer (a0-25 and a0-33, GDD §2.10 / §2.4).
 *
 * ## What only a boot can prove
 *
 * `src/ui/onboarding.test.ts` proves `resolvePromptText` returns the right
 * sentence for every device, fire mode and scheme. What it cannot prove is what
 * the shipped client *hands it*: the binding is chosen at boot from
 * `navigator.maxTouchPoints` (`src/main.ts` `isTouch` → `activeDevice`) and the
 * LESSON is chosen by the seated scheme (`readControlScheme` → `controlScheme` →
 * `HudFrame.controlScheme`, a0-33), and both are resolved in
 * `Hud.updateOnboarding`. A unit test that passed while that wiring handed
 * `'keyboard'` to a handset would be green over a phone telling the player to
 * press a key it does not have; one that passed while the wiring never forwarded
 * the scheme would be green over the whole a0-33 bug.
 *
 * So this reads back the string the HUD DREW (`__onboardingStage.prompt()`, which
 * returns `Hud.debugOnboardingPrompt()`) beside the device AND the scheme it drew
 * it for, on the same frame it screenshots.
 *
 * ## What it asserts, and why each one
 *
 *  - the sentence carries **"collection field"** and never **"fly home"** — the
 *    2026-07-27 amendment (projectile mining, collection-field banking) retired
 *    dock-and-park banking, and the prompt taught it for two weeks after. True in
 *    BOTH schemes: Tap Commander gets its own sentence and it carries the
 *    amendment too;
 *  - the desktop frame reads **"press E"**, the phone frame reads **"press
 *    BUILD"** and never "press E" — §2.10's input-agnostic rule, at the only
 *    place it can actually fail;
 *  - a **default boot** — no stored preference, which since a0-30 means Tap
 *    Commander on every platform — reads the TAP sentence, *"tap your own station
 *    to bank in its collection field"*, and never *"fly into"*. This is the a0-33
 *    bug stated as an assertion on the drawn string;
 *  - the drawn box **fits the band it was wrapped to**. §4.7: *"Length is part of
 *    clarity."* The Tap Commander sentence is the longest the game authors, so
 *    the phone case measures rather than assumes.
 *
 * ## How it stages
 *
 * `__oreHudStage.mine(cargoCap)` — the seam that already existed for the ore HUD.
 * It parks the local ship at rest FAR from its own station with a full hold, so
 * the collection field cannot drain what it just staged, and a full hold is the
 * HAUL-HOME trigger (GDD §2.3). Nothing here fakes the UI: the prompt fires
 * through `Onboarding.update` off live sim cargo, exactly as it does in a match.
 *
 * The scheme is staged the way a player sets it — by what is in storage before
 * the client boots (`planet-rush:controlScheme`, `src/main.ts`
 * `readControlScheme`) — never by poking the HUD. `undefined` leaves storage
 * empty, which is the fresh-profile case and therefore the shipped default.
 */
import { test, expect } from '@playwright/test';

interface OreHudStage {
  mine(ore: number): { cargo: number; cargoCap: number; banked: number } | null;
  readout(): { cargo: number; banked: number } | null;
}

interface OnboardingStage {
  prompt(): { visible: boolean; text: string; wrapWidth: number; width: number; height: number };
  device(): 'keyboard' | 'gamepad' | 'touch';
  scheme(): 'sticks' | 'tap';
}

interface StageWindow {
  __oreHudStage?: OreHudStage;
  __onboardingStage?: OnboardingStage;
}
declare const window: Window & StageWindow;

/** Frames, not milliseconds — the honest unit on a software-GL runner. */
async function frames(page: import('@playwright/test').Page, n = 6): Promise<void> {
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
 * Wait out the OBJECTIVE prompt (a0-34).
 *
 * A first match now opens by naming the win condition, and that prompt outranks
 * every lesson except the siege — deliberately: the goal is what frames the verbs
 * after it. It retires once it has been on screen long enough to read, so a
 * HAUL-HOME test has to let a first-time player finish reading before it stages
 * the hold a first-time player would take a minute to fill. This waits for the
 * band to stop carrying it rather than sleeping a fixed number of seconds, so it
 * tracks the dwell instead of duplicating its number.
 *
 * It is scheme-blind on purpose (r14-01): the objective reads the same sentence
 * in all three slots of a0-33's branch, so the same wait serves every seat below.
 */
async function readTheObjective(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const p = window.__onboardingStage?.prompt();
      // `text` is whatever was last drawn even when nothing is up, so the band
      // being EMPTY is the objective having been read as much as another prompt
      // replacing it.
      return !!p && (!p.visible || !/last station standing/i.test(p.text));
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** The storage key the client reads the scheme from at boot (`src/main.ts`). */
const CONTROL_SCHEME_KEY = 'planet-rush:controlScheme';

/**
 * Boot, fill the hold away from home, and read back what the HUD drew.
 *
 * @param seatScheme What the player has saved: `'sticks'` / `'tap'`, or
 *   `undefined` for a fresh profile — which is the shipped default (a0-30: Tap
 *   Commander everywhere), and the case that matters most.
 */
async function stageFullHold(
  page: import('@playwright/test').Page,
  seatScheme?: 'sticks' | 'tap',
): Promise<{
  prompt: { visible: boolean; text: string; wrapWidth: number; width: number; height: number };
  device: string;
  scheme: string;
}> {
  if (seatScheme !== undefined) {
    // Written BEFORE the bundle runs, because the client reads it once at boot —
    // the same order a returning player's storage is in.
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [CONTROL_SCHEME_KEY, seatScheme] as const,
    );
  }
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__oreHudStage?.mine === 'function' &&
      typeof window.__onboardingStage?.prompt === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // The objective is stated first in a first match (a0-34) — let it be read, or
  // the band under test still belongs to it.
  await readTheObjective(page);

  // Fill the hold to exactly its capacity — "hold full" is the trigger, and the
  // staging widens nothing, so this is the cargo bay the hull really has.
  const staged = await page.evaluate(() => {
    const first = window.__oreHudStage!.mine(1);
    if (!first) return null;
    return window.__oreHudStage!.mine(first.cargoCap);
  });
  expect(staged, 'the stage parked the local ship away from home with a hold').not.toBeNull();
  expect(staged!.cargo).toBe(staged!.cargoCap);

  await frames(page, 8);
  return page.evaluate(() => ({
    prompt: window.__onboardingStage!.prompt(),
    device: window.__onboardingStage!.device(),
    scheme: window.__onboardingStage!.scheme(),
  }));
}

test.describe('HAUL-HOME teaches the shipped mechanic, in the words this device uses', () => {
  test('desktop, sticks seated — "fly into your collection field to bank, then press E to spend"', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { prompt, device, scheme } = await stageFullHold(page, 'sticks');

    expect(device, 'a mouse-and-keyboard boot resolves the keyboard bindings').toBe('keyboard');
    expect(scheme, 'a saved preference wins over the default (a0-30 item 2)').toBe('sticks');
    expect(prompt.visible, 'a full hold fires the HAUL-HOME prompt (GDD §2.3, §2.10)').toBe(true);
    expect(prompt.text).toBe(
      'Hold full — fly into your collection field to bank, then press E to spend',
    );
    // The two absences the brief names, asserted on the drawn string.
    expect(prompt.text).not.toMatch(/fly home/i);
    expect(prompt.text).toContain('collection field');

    await page.screenshot({ path: 'tests/live-stage/haul-prompt-desktop-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  // ── a0-33 ────────────────────────────────────────────────────────────────
  test('desktop, NOTHING saved — the default is Tap Commander, and it says TAP', async ({
    page,
  }) => {
    // The a0-33 bug on a real boot: a fresh profile is seated in Tap Commander on
    // every platform (a0-30), and until this brief the client drew the stick
    // sentence at it — telling a player whose ship is flown by taps to fly into
    // the field. No storage is seeded here; this is what a new player gets.
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { prompt, device, scheme } = await stageFullHold(page);

    expect(device).toBe('keyboard');
    expect(scheme, 'a fresh profile boots into Tap Commander on a PC too (a0-30)').toBe('tap');
    expect(prompt.visible).toBe(true);
    expect(prompt.text).toBe(
      'Hold full — tap your own station to bank in its collection field, then press E to spend',
    );
    // The gesture this scheme does not have, and the mechanic it must still teach.
    expect(prompt.text, 'Tap Commander flies the ship by tap, not by stick').not.toMatch(
      /fly into/i,
    );
    expect(prompt.text).not.toMatch(/fly home/i);
    expect(prompt.text).toContain('collection field');

    await page.screenshot({ path: 'tests/live-stage/haul-prompt-desktop-tap-evidence.png' });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  // Both orientations of the 390×844 handset in QA's matrix. Held upright the
  // client rotates its stage into landscape, so the two are NOT the same frame
  // twice: they wrap against different safe-area insets, and landscape is the
  // 390-px-tall case a0-24 had to fix the band for. The landscape shot is the
  // one that reads the way a player holds the phone.
  for (const orientation of [
    { name: 'landscape', viewport: { width: 844, height: 390 } },
    { name: 'portrait', viewport: { width: 390, height: 844 } },
  ]) {
    test.describe(`on a 390×844 handset, held ${orientation.name}`, () => {
      // A phone context: `hasTouch` is what the client reads at boot to choose the
      // touch bindings, so this is the device decision under test, not a viewport.
      test.use({
        viewport: orientation.viewport,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });

      // Both schemes on the handset: the one a player can choose, and the one
      // they are seated in if they never do (a0-30). Each states the sentence it
      // expects in full, because the point of the capture is the words.
      for (const seat of [
        {
          name: 'sticks seated',
          scheme: 'sticks' as const,
          expected:
            'Hold full — fly into your collection field to bank, then press BUILD to spend',
          shot: 'sticks',
        },
        {
          name: 'nothing saved — the shipped default, Tap Commander',
          scheme: undefined,
          expected:
            'Hold full — tap your own station to bank in its collection field, then press BUILD to spend',
          shot: 'tap',
        },
      ]) {
        test(`phone, ${seat.name} — it says press BUILD, never press E`, async ({ page }) => {
          const pageErrors: string[] = [];
          page.on('pageerror', (e) => pageErrors.push(String(e)));

          const { prompt, device, scheme } = await stageFullHold(page, seat.scheme);

          expect(device, 'a touch boot resolves the touch bindings (GDD §2.4)').toBe('touch');
          expect(scheme).toBe(seat.scheme ?? 'tap');
          expect(prompt.visible, 'a full hold fires the HAUL-HOME prompt on touch too').toBe(true);
          expect(prompt.text).toBe(seat.expected);
          // The failure a0-25 guards against, stated as the assertion it is.
          expect(prompt.text, 'a phone has no E key').not.toMatch(/press E\b/);
          expect(prompt.text).not.toMatch(/fly home/i);
          expect(prompt.text).toContain('collection field');

          // Length is part of clarity (GDD §4.7): the drawn box must fit the band
          // it was wrapped to, on the narrowest handset in QA's matrix — and the
          // Tap Commander sentence is the longest string the game authors.
          expect(
            prompt.width,
            `drawn ${prompt.width.toFixed(0)}px vs wrap ${prompt.wrapWidth.toFixed(0)}px`,
          ).toBeLessThanOrEqual(prompt.wrapWidth + 1);
          expect(
            prompt.text.endsWith('…'),
            'a prompt that ellipsizes is a prompt that didn\'t fire',
          ).toBe(false);

          await page.screenshot({
            path: `tests/live-stage/haul-prompt-phone-${orientation.name}-${seat.shot}-evidence.png`,
          });
          expect(pageErrors, pageErrors.join('\n')).toEqual([]);
        });
      }
    });
  }
});
