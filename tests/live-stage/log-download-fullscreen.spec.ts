/**
 * tests/live-stage/log-download-fullscreen.spec.ts — DOWNLOAD LOG reaches the glass
 * on a phone, in a fullscreen match. OWNER: Netcode Engineer (a0-28).
 *
 * *"download logs used to live in match as well pretty sure it was in pause menu."*
 * … *"I was on mobile."* The capture showed PAUSED / RESUME / SETTINGS / EXIT TO
 * MENU and an empty footer.
 *
 * The wiring was never missing, and this spec exists because that is exactly the
 * class of bug a unit test cannot see. `main.ts` `syncDownloadLog` offered
 * `reason: 'pause'` every frame the overlay was up; the affordance mounted; the
 * element had a 189×44 box at (643, 334), wholly inside 844×390, `visibility:
 * visible`, `opacity: 1` — and `document.elementFromPoint` at its own centre
 * returned the **canvas**. On touch, PLAY enters fullscreen on the game root
 * (`@platform/fullscreen`), which puts `#app` in the browser's **top layer** and
 * paints a `::backdrop` over the rest of the document; an affordance appended to
 * `body` beside it is painted under that backdrop holding the largest z-index the
 * platform has. The top layer is not a z-index, so nothing about stacking order
 * could have rescued it.
 *
 * Two things follow, and they are what this file is shaped by:
 *
 *  1. **The front door, with real taps.** PLAY → PLAY SOLO → RUSH! → the corner
 *     pause button, every step a real `touchscreen.tap` at the physical point the
 *     client itself reported drawing that control at. The sibling phone spec
 *     (`log-download.spec.ts`) boots `?debug=1`, which skips PLAY, which skips
 *     fullscreen — it was green through the whole of this defect. A flow that is
 *     never walked is a flow that can be blank (n8-01).
 *  2. **Visible AND hit-testable, not merely installed.** A box is not a
 *     photograph. So: `toBeVisible`, a real 44-px target wholly inside the
 *     viewport, `elementFromPoint` at the button's own centre resolving to the
 *     button, and — the only form of it nothing can fake — a real finger tap at
 *     that centre making the label answer.
 *
 * And the withdrawal, in the same run: RESUME must take it off the glass. That is
 * not a bonus assertion. `#id{display:flex}` beats the UA's `[hidden]{display:none}`,
 * so `hide()` was a no-op the whole time and was invisible only because of the bug
 * above — un-burying the affordance without fixing it would have left DOWNLOAD LOG
 * sitting over live play (GDD §2.2's HUD budget).
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * Recorded in the PR body with the evidence PNG it writes.
 *
 *   npx playwright test --config tests/live-stage/playwright.log-download-fullscreen.config.ts
 */
import { test, expect, type Page } from '@playwright/test';

/** The DOM ids the affordance mounts under (`src/net/playtest-log-button.ts`) —
 *  restated rather than imported, because a spec that imports the module under test
 *  can pass while the *bundle* mounts nothing. */
const ROOT_ID = 'playtest-download-log';
const BUTTON_ID = 'playtest-download-log-button';

/** The game root — what `FullscreenLifecycle` makes the fullscreen element, and
 *  therefore what the affordance has to live inside of (`index.html`). */
const APP_ID = 'app';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface MenuControl {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
declare const window: Window & {
  __mainMenu?: { play(): void; controls: readonly MenuControl[] };
  __onlineMenu?: { doorControls: readonly MenuControl[] };
  __lobby?: { visible: boolean; rushControl: { physicalCenter: PhysicalPoint } };
  __pauseStage?: { read(): { open: boolean; simTicks: number; buttonPoint: PhysicalPoint } };
};

async function canvasOrigin(page: Page): Promise<PhysicalPoint> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/**
 * Walk the real front door with real thumbs: PLAY → the doors → PLAY SOLO → the
 * lobby → RUSH! → a running match.
 *
 * Every press is a genuine `touchscreen.tap`, which is the load-bearing detail —
 * `requestFullscreen` needs transient activation, so a seam call (`__mainMenu.play()`)
 * would reach the same screen with no fullscreen behind it and quietly test nothing.
 */
async function bootMatchThroughTheFrontDoor(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 30_000,
  });

  const origin = await canvasOrigin(page);
  const tap = async (p: PhysicalPoint | null, what: string): Promise<void> => {
    if (!p) throw new Error(`the client reported no ${what} control to press`);
    await page.touchscreen.tap(origin.x + p.x, origin.y + p.y);
  };

  await tap(
    await page.evaluate(
      () => window.__mainMenu?.controls.find((c) => c.kind === 'play')?.physicalCenter ?? null,
    ),
    'PLAY',
  );

  await page.waitForFunction(() => (window.__onlineMenu?.doorControls.length ?? 0) > 0, undefined, {
    timeout: 30_000,
  });
  await tap(
    await page.evaluate(
      () =>
        (window.__onlineMenu?.doorControls ?? []).find((c) => c.kind === 'solo')?.physicalCenter ??
        null,
    ),
    'PLAY SOLO',
  );

  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
  await tap(
    await page.evaluate(() => window.__lobby?.rushControl.physicalCenter ?? null),
    'RUSH!',
  );

  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(() => (window.__pauseStage?.read().simTicks ?? 0) > 5, undefined, {
    timeout: 30_000,
  });
  return pageErrors;
}

/** Open the pause menu the way a thumb does — the corner affordance, at the point
 *  the client reported drawing it at (`src/ui/pause-menu` `pauseButtonRect`). */
async function openPause(page: Page): Promise<void> {
  const origin = await canvasOrigin(page);
  const point = await page.evaluate(() => window.__pauseStage!.read().buttonPoint);
  await page.touchscreen.tap(origin.x + point.x, origin.y + point.y);
  await page.waitForFunction(() => window.__pauseStage!.read().open === true, undefined, {
    timeout: 10_000,
  });
}

/** Hold the button's answer on screen past its own 4 s revert, so a tap's effect is
 *  still readable when we look. Only long timers are suppressed, so the game's own
 *  short ones still fire. */
async function holdConfirmation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const native = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
      (ms ?? 0) >= 4000 ? 0 : native(fn, ms, ...rest)) as typeof window.setTimeout;
  });
}

test('on a phone, in a fullscreen match, the pause menu actually SHOWS DOWNLOAD LOG', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors = await bootMatchThroughTheFrontDoor(page);
  await holdConfirmation(page);

  // The precondition, asserted rather than assumed: the tap on PLAY really did put
  // the game root in the top layer. Without this the rest of the file could pass on
  // a browser that simply refused fullscreen, which is the bug wearing a green tick.
  expect(
    await page.evaluate(() => document.fullscreenElement?.id ?? null),
    'PLAY did not enter fullscreen, so this run proves nothing about a0-28',
  ).toBe(APP_ID);

  // Not there during play — the match owns the screen (GDD §2.2's HUD budget).
  expect(await page.locator(`#${BUTTON_ID}`).count(), 'a log button over a live match').toBe(0);

  await openPause(page);

  const button = page.locator(`#${BUTTON_ID}`);
  await expect(button, 'the log is offered on the pause menu (brief §2)').toBeVisible();
  await expect(button, 'the label the ratification names').toHaveText('DOWNLOAD LOG');

  // A real 44-px target, wholly inside the viewport past the safe area. This half
  // was ALREADY TRUE while the phone was blank, which is why it cannot be the whole
  // assertion — and why the numbers are worth stating: 378 of 390 at the bottom edge
  // is not a0-24's clipping.
  const box = await button.boundingBox();
  expect(box, 'the button has a box').not.toBeNull();
  expect(box!.height, 'a real touch target, tall enough').toBeGreaterThanOrEqual(44);
  expect(box!.width, 'a real touch target, wide enough').toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, 'clipped by the right edge').toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height, 'clipped by the bottom edge').toBeLessThanOrEqual(viewport.height);

  // ── The assertion the defect turned on ─────────────────────────────────────
  // What is at the button's own centre? Under the bug: the canvas, because the
  // fullscreen element's backdrop is painted over everything left in `body`.
  const hit = await page.evaluate((ids) => {
    const el = document.getElementById(ids.button)!;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      topId: top?.id ?? null,
      topTag: top?.tagName ?? null,
      // The AFFORDANCE's parent, not the button's — the button's is the flex row
      // inside it. This is the property the fix actually moves.
      parentId: document.getElementById(ids.root)?.parentElement?.id ?? null,
    };
  }, { button: BUTTON_ID, root: ROOT_ID });
  expect(
    hit.topId,
    `the affordance is buried — ${hit.topTag} is painted over its own centre`,
  ).toBe(BUTTON_ID);
  expect(hit.parentId, 'it has to live INSIDE the fullscreen element, not beside it').toBe(APP_ID);

  // The frame the whole brief is about: the developer's capture, with the button in
  // it. Taken before the press, so the resting label is what a reader sees.
  await page.screenshot({ path: 'tests/live-stage/log-download-fullscreen-phone-pause-evidence.png' });

  // …and hit-testable is proven by hitting it. A real finger at the centre of the
  // box, and the label has to answer — the one form of this a screenshot cannot fake.
  const download = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(button, 'a real tap never reached the button').toHaveText(
    /SAVING|LOG SAVED|LOG SENT/,
  );
  await download;
  await page.screenshot({ path: 'tests/live-stage/log-download-fullscreen-phone-pressed-evidence.png' });

  expect(pageErrors, 'no page errors across the front door → pause → press').toEqual([]);
});

test('and RESUME takes it back off the glass', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors = await bootMatchThroughTheFrontDoor(page);
  expect(await page.evaluate(() => document.fullscreenElement?.id ?? null)).toBe(APP_ID);

  await openPause(page);
  await expect(page.locator(`#${BUTTON_ID}`)).toBeVisible();

  // RESUME, at the point the client reported drawing it at.
  const origin = await canvasOrigin(page);
  const resume = await page.evaluate(() => {
    const stage = window.__pauseStage!.read() as unknown as {
      controls: { kind: string; physicalCenter: PhysicalPoint }[];
    };
    return stage.controls.find((c) => c.kind === 'resume')?.physicalCenter ?? null;
  });
  if (!resume) throw new Error('the pause menu reported no RESUME control');
  await page.touchscreen.tap(origin.x + resume.x, origin.y + resume.y);
  await page.waitForFunction(() => window.__pauseStage!.read().open === false, undefined, {
    timeout: 10_000,
  });

  // The match owns the screen again, so the affordance is off it. `hidden` alone did
  // not do this: the module's own `#id{display:flex}` outranks the UA rule that acts
  // on the attribute, and `toBeHidden` is a computed-style read, not an attribute one.
  await expect(
    page.locator(`#${ROOT_ID}`),
    'DOWNLOAD LOG is still sitting over live play',
  ).toBeHidden();

  expect(pageErrors, 'no page errors across pause → resume').toEqual([]);
});
