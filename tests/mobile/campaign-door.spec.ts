/**
 * tests/mobile/campaign-door.spec.ts — the CAMPAIGN door, on a real device.
 * OWNER: UI Engineer (u9-01).
 *
 * ── WHAT THIS EXISTS FOR ───────────────────────────────────────────────────
 * Developer, 2026-08-06: *"i also asked for a campaign button but i see it never
 * got delivered, it should say Coming Soon... when you click it (it goes ontop
 * of Solo)."*
 *
 * The model half of that is unit-tested to death in `src/ui/lobby-entry.test.ts`
 * — order, `comingSoon`, the notice, the absent intent. None of it proves the
 * door is on the screen. Planet Rush draws its whole presentation into one
 * PixiJS/WebGL canvas, so a model that returns a fourth door proves nothing
 * about a screen that never painted it, and the miss that created this suite
 * (`playwright.config.ts`) was exactly that: invisible touch UI.
 *
 * So this file asserts the things only a device can settle:
 *
 *  1. **The door is DRAWN.** Its own reported rect turned into a screenshot
 *     region and the pixels inside it counted — the u5 seat-state idiom.
 *  2. **A real press ANSWERS.** Synthesized input at the point the app itself
 *     reports (CDP touch on the phones, a mouse click on the desktop control),
 *     after which `Coming Soon…` is on the screen as PIXELS in the message slot,
 *     which was empty-ish tagline text a frame earlier.
 *  3. **And goes NOWHERE.** The doors are still up, the keypad is not, no lobby
 *     opened, and the other three doors still report at pressable rects.
 *  4. **Nobody is stranded.** BACK still leaves for the main menu after the
 *     teaser has been pressed — the standing "every screen you can leave" rule
 *     (u2 menu-back), checked in the one state that did not exist before.
 *
 * ── ORIENTATION ────────────────────────────────────────────────────────────
 * The phone projects declare PORTRAIT viewports and portrait is walked as-is:
 * the developer holds the phone, the landscape lock rotates the root, and the
 * press has to un-rotate back onto the logical door. This is the first screen a
 * player touches, so both phones and the desktop pointer control run it.
 *
 * ── EVIDENCE ───────────────────────────────────────────────────────────────
 * Each run also writes two full-frame PNGs to `evidence/images/u9-campaign-door/`
 * — the doors screen, and the answered state — so the change is reviewable as a
 * picture rather than as a description of one. They are evidence, not baselines:
 * no golden covers this screen (the six in `goldens.spec.ts` are the title, the
 * settings screen and the frozen match scenes), so nothing here is a comparison
 * and nothing needed re-baselining.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { count, decode, isNonVacuum, isPlasma, type Img, type Region } from './pixels';
import { settleFrames } from './render-settle';
import { budgetTest } from './budgets';

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

/** The exact words the developer asked for. */
const COMING_SOON = 'Coming Soon…';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The `window.__mainMenu` seam (src/main.ts `MenuSeam`) — only PLAY is needed. */
interface MenuSeam {
  readonly visible: boolean;
  readonly logicalViewport: { readonly width: number; readonly height: number };
  readonly controls: ReadonlyArray<{
    readonly kind: string;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  }>;
}

/** The `window.__onlineMenu` doors seam (src/main.ts `OnlineSeam`). */
interface DoorsSeam {
  readonly visible: boolean;
  readonly screen: string;
  readonly status: string;
  readonly error: string;
  readonly notice: string;
  readonly title: string;
  readonly doorControls: ReadonlyArray<{
    readonly kind: string;
    readonly physicalCenter: { readonly x: number; readonly y: number };
    readonly physicalBounds: Rect;
  }>;
  readonly messageBounds: Rect;
}

/** The `window.__lobby` seam — read only to prove it never opened. */
interface LobbySeam {
  readonly visible: boolean;
}

// --- Thresholds -------------------------------------------------------------

/**
 * Device pixels of *anything at all* inside a door's own rect, below which the
 * door is not on the screen. The same low bar `slot-state.spec.ts` uses and for
 * the same reason: this is the "was it drawn" check, and the failure it guards
 * against draws NOTHING — the number that matters is 0 vs. thousands. A door is
 * 288–420 CSS px wide and 49–64 tall, so even at dpr 1 its border and its word
 * are a large multiple of this.
 */
const DRAWN_MIN_PX = 200;

/**
 * …and of PLASMA inside the message slot, which is what `Coming Soon…` is drawn
 * in (`src/ui/lobby-entry-view.ts` — plasma, never threat red, because a door
 * that is not built yet is not a failure). The standing tagline in that same
 * slot is dim steel and contributes none, so this count separates the answered
 * state from the resting one without reading a string off the seam.
 *
 * Low, because it is twelve characters of 12px text: at dpr 1 the lit glyph body
 * is a few hundred pixels, and the phones have 2.6–3× that.
 */
const NOTICE_PLASMA_MIN_PX = 40;

// --- Input ------------------------------------------------------------------

/** A real physical press at a raw canvas coordinate: CDP touch on the phones, a
 *  mouse click on the desktop control. The app's own pointer handlers see the
 *  same event a finger or a mouse produces — no seam method is called. */
async function press(page: Page, projectName: string, x: number, y: number): Promise<void> {
  if (!isTouchProject(projectName)) {
    await page.mouse.click(Math.round(x), Math.round(y));
    return;
  }
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

// --- Fixtures ---------------------------------------------------------------

/** Hold the device the other way. The phone projects declare PORTRAIT viewports,
 *  so this is how the landscape-held case is reached — and both are real ways to
 *  hold a phone, which is why the doors are shot in each. */
async function setOrientation(page: Page, mode: 'landscape' | 'portrait'): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) return;
  const isLandscape = vp.width >= vp.height;
  if (isLandscape !== (mode === 'landscape')) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
  }
}

/** Boot the real preview build clean (no `?debug=1`, which skips the menu by
 *  contract) and press PLAY — the one and only way to the doors. */
async function pressThroughToDoors(page: Page, projectName: string): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu;
      return !!m && m.visible && m.controls.length > 0 && m.logicalViewport.width > 0;
    },
    undefined,
    { timeout: 30_000 },
  );

  const play = await page.evaluate(() => {
    const c = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu?.controls.find(
      (x) => x.kind === 'play',
    );
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(play, 'PLAY control present on a clean boot').not.toBeNull();
  await press(page, projectName, play!.x, play!.y);

  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
      return !!d && d.visible && d.doorControls.length > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  await settleFrames(page);
}

/** Snapshot the doors seam (structured-cloned, so the live object cannot shift
 *  under the assertions that read it). */
async function readDoors(page: Page): Promise<DoorsSeam> {
  const s = await page.evaluate(() => {
    const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
    if (!d) return null;
    return {
      visible: d.visible,
      screen: d.screen,
      status: d.status,
      error: d.error,
      notice: d.notice,
      title: d.title,
      doorControls: d.doorControls.map((c) => ({
        kind: c.kind,
        physicalCenter: { ...c.physicalCenter },
        physicalBounds: { ...c.physicalBounds },
      })),
      messageBounds: { ...d.messageBounds },
    } satisfies DoorsSeam;
  });
  expect(s, '__onlineMenu present after PLAY').not.toBeNull();
  return s as DoorsSeam;
}

const lobbyVisible = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __lobby?: LobbySeam }).__lobby?.visible ?? false);

/**
 * A control's own physical rect as a screenshot region. The shot is the CSS
 * viewport scaled uniformly by the device pixel ratio, so CSS px ÷ CSS viewport
 * is the fraction the region wants — no dpr arithmetic and no assumption about
 * which orientation the canvas ended up in.
 */
function regionOf(bounds: Rect, vp: { width: number; height: number }): Region {
  return {
    x0: bounds.x / vp.width,
    y0: bounds.y / vp.height,
    x1: (bounds.x + bounds.width) / vp.width,
    y1: (bounds.y + bounds.height) / vp.height,
  };
}

async function shoot(page: Page, file?: string): Promise<Img> {
  const buf = file
    ? await page.screenshot({ path: `evidence/images/u9-campaign-door/${file}.png` })
    : await page.screenshot();
  return decode(buf);
}

// ===========================================================================
// 1. The door is drawn, it is first, and it is a real target
// ===========================================================================

test('the doors screen draws FOUR doors, CAMPAIGN first and PLAY SOLO under it', async ({
  page,
}, testInfo) => {
  budgetTest({
    work: 'clean boot → press PLAY → the doors → shoot the frame and count pixels inside all four door rects',
    measuredSeconds: 10,
  });

  await pressThroughToDoors(page, testInfo.project.name);
  const doors = await readDoors(page);
  const vp = page.viewportSize()!;

  // The order the SCREEN reports, which is the order it drew in.
  const kinds = doors.doorControls.map((c) => c.kind);
  expect(kinds.slice(0, 4), 'four doors, CAMPAIGN above PLAY SOLO').toEqual([
    'campaign',
    'solo',
    'create',
    'join',
  ]);

  const img = await shoot(page, `doors-${testInfo.project.name}`);
  for (const control of doors.doorControls.slice(0, 4)) {
    const b = control.physicalBounds;
    // Inside the physical canvas — a door reported off-screen is a door nobody
    // can press, which is the whole class of bug the landscape lock exists for.
    expect(b.x, `${control.kind}: x ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${control.kind}: y ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${control.kind}: right edge inside`).toBeLessThanOrEqual(vp.width + 0.5);
    expect(b.y + b.height, `${control.kind}: bottom edge inside`).toBeLessThanOrEqual(vp.height + 0.5);
    // A thumb target, not a stripe (GDD §2.4). The fourth door is what put this at
    // risk: four stacked blocks do not fit a landscape phone's band.
    expect(Math.min(b.width, b.height), `${control.kind}: pressable size`).toBeGreaterThanOrEqual(40);
    // …and DRAWN. Pixels inside its own rect, against the vacuum background.
    expect(
      count(img, regionOf(b, vp), isNonVacuum).matched,
      `${control.kind} drew nothing inside its own rect`,
    ).toBeGreaterThan(DRAWN_MIN_PX);
  }
});

// ===========================================================================
// 2. A real press answers, and goes nowhere
// ===========================================================================

test('a real press on CAMPAIGN says Coming Soon… and does not navigate', async ({
  page,
}, testInfo) => {
  budgetTest({
    work: 'clean boot → press PLAY → the doors → press CAMPAIGN for real → settle → shoot, count the lit message, and prove no lobby opened',
    measuredSeconds: 17,
  });

  await pressThroughToDoors(page, testInfo.project.name);
  const before = await readDoors(page);
  const vp = page.viewportSize()!;
  const message = regionOf(before.messageBounds, vp);

  // Resting: the standing tagline, drawn dim. Nothing in the slot is lit.
  expect(before.notice, 'nothing answered yet').toBe('');
  const restingLit = count(await shoot(page), message, isPlasma).matched;

  const campaign = before.doorControls.find((c) => c.kind === 'campaign');
  expect(campaign, 'CAMPAIGN door reported').toBeTruthy();
  await press(page, testInfo.project.name, campaign!.physicalCenter.x, campaign!.physicalCenter.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.notice !== '',
    undefined,
    { timeout: 15_000 },
  );
  await settleFrames(page);

  const after = await readDoors(page);
  // The words, verbatim.
  expect(after.notice, 'the developer’s own string').toBe(COMING_SOON);
  // Not an error: the red line is for a refusal, and this is not one.
  expect(after.error, 'a door that is not built yet is not a failure').toBe('');
  expect(after.status, 'nothing is connecting').toBe('idle');

  // …and it is on the SCREEN, lit, where a moment ago the slot held dim text.
  const img = await shoot(page, `coming-soon-${testInfo.project.name}`);
  const lit = count(img, message, isPlasma).matched;
  expect(lit, 'Coming Soon… is drawn in the message slot').toBeGreaterThan(NOTICE_PLASMA_MIN_PX);
  expect(lit, 'and the slot was not already lit before the press').toBeGreaterThan(restingLit);

  // NOWHERE. Still the doors, not the keypad, no lobby, and the other three doors
  // are still reported at rects a finger can reach.
  expect(after.visible, 'still on the doors').toBe(true);
  expect(after.screen, 'and not in the room-code keypad').toBe('home');
  expect(await lobbyVisible(page), 'the teaser opened no lobby').toBe(false);
  for (const kind of ['solo', 'create', 'join']) {
    const door = after.doorControls.find((c) => c.kind === kind);
    expect(door, `${kind} still reported`).toBeTruthy();
    expect(Math.min(door!.physicalBounds.width, door!.physicalBounds.height)).toBeGreaterThanOrEqual(
      40,
    );
  }
});

// ===========================================================================
// 3. The message clears, and nobody is stranded behind it
// ===========================================================================

test('after the teaser, JOIN ROOM still opens the keypad and BACK still leaves', async ({
  page,
}, testInfo) => {
  budgetTest({
    work: 'clean boot → press PLAY → press CAMPAIGN → press JOIN ROOM (keypad, notice cleared) → press BACK twice (doors, then main menu)',
    measuredSeconds: 14,
  });

  await pressThroughToDoors(page, testInfo.project.name);
  const doors = await readDoors(page);
  const at = (seam: DoorsSeam, kind: string): { x: number; y: number } => {
    const c = seam.doorControls.find((d) => d.kind === kind);
    expect(c, `${kind} reported`).toBeTruthy();
    return { x: c!.physicalCenter.x, y: c!.physicalCenter.y };
  };

  const campaign = at(doors, 'campaign');
  await press(page, testInfo.project.name, campaign.x, campaign.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.notice !== '',
    undefined,
    { timeout: 15_000 },
  );

  // Another door still works, and takes the message slot back with it.
  const join = at(await readDoors(page), 'join');
  await press(page, testInfo.project.name, join.x, join.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.screen === 'join',
    undefined,
    { timeout: 15_000 },
  );
  expect((await readDoors(page)).notice, 'the answer cleared when something else was asked for').toBe(
    '',
  );

  // BACK to the doors, then BACK out to the main menu — the exit every screen
  // carries (u2), walked through the state the teaser created.
  const backFromKeypad = at(await readDoors(page), 'back');
  await press(page, testInfo.project.name, backFromKeypad.x, backFromKeypad.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.screen === 'home',
    undefined,
    { timeout: 15_000 },
  );

  const backFromDoors = at(await readDoors(page), 'back');
  await press(page, testInfo.project.name, backFromDoors.x, backFromDoors.y);
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
      const m = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu;
      return !!m && m.visible && !d?.visible;
    },
    undefined,
    { timeout: 15_000 },
  );
  expect(await lobbyVisible(page), 'and no match was ever entered').toBe(false);
});

// ===========================================================================
// 4. Held the other way — the landscape phone, which is where the fourth door
//    stopped fitting in one column
// ===========================================================================

test('held in LANDSCAPE, the four doors still fit and CAMPAIGN still answers', async ({
  page,
}, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'the desktop control is already landscape');
  budgetTest({
    work: 'landscape phone → press PLAY → the doors (two columns) → count pixels in all four → press CAMPAIGN → shoot the answer',
    measuredSeconds: 17,
  });

  // This is the profile the two-column door shape exists for: 187 px of band,
  // four blocks of button-plus-hint, and a stack that would have drawn 20px
  // stripes. The assertion is the same one as portrait — every door drawn, every
  // door pressable — because the arrangement changing must cost the player
  // nothing.
  await setOrientation(page, 'landscape');
  await pressThroughToDoors(page, testInfo.project.name);
  const doors = await readDoors(page);
  const vp = page.viewportSize()!;

  expect(doors.doorControls.map((c) => c.kind).slice(0, 4)).toEqual([
    'campaign',
    'solo',
    'create',
    'join',
  ]);

  const img = await shoot(page, `doors-landscape-${testInfo.project.name}`);
  for (const control of doors.doorControls.slice(0, 4)) {
    const b = control.physicalBounds;
    expect(Math.min(b.width, b.height), `${control.kind}: pressable size`).toBeGreaterThanOrEqual(40);
    expect(
      count(img, regionOf(b, vp), isNonVacuum).matched,
      `${control.kind} drew nothing inside its own rect`,
    ).toBeGreaterThan(DRAWN_MIN_PX);
  }

  const campaign = doors.doorControls.find((c) => c.kind === 'campaign')!;
  await press(page, testInfo.project.name, campaign.physicalCenter.x, campaign.physicalCenter.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.notice !== '',
    undefined,
    { timeout: 15_000 },
  );
  await settleFrames(page);

  const after = await readDoors(page);
  expect(after.notice).toBe(COMING_SOON);
  expect(after.visible, 'still on the doors').toBe(true);
  expect(await lobbyVisible(page), 'no lobby opened').toBe(false);
  const answered = await shoot(page, `coming-soon-landscape-${testInfo.project.name}`);
  expect(
    count(answered, regionOf(after.messageBounds, vp), isPlasma).matched,
    'Coming Soon… is drawn in the message slot',
  ).toBeGreaterThan(NOTICE_PLASMA_MIN_PX);
});
