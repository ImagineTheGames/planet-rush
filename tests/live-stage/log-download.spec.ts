/**
 * tests/live-stage/log-download.spec.ts — the log comes off the device AS A FILE,
 * on a phone and on a desk. OWNER: Gameplay Engineer (ratified M10).
 *
 * *"Clipboard goes away for all (PC and mobile). It should be DOWNLOAD LOG not COPY
 * LOG."*
 *
 * This file used to have a sibling — a spec that proved the clipboard route worked
 * on touch. It proved the wrong thing. The developer's earlier six words explain
 * why: *"too large for mobile clipboard."* A route that reports success and leaves a
 * 40 KB paste no chat app takes is worse than one that fails, and the ratification
 * then killed it on the desk too, so there is now one control, one promise, and one
 * spec — run against **both form factors**, because "for all (PC and mobile)" is a
 * claim about two devices and a phone-only run could only ever assert half of it.
 *
 * Each project runs three checks:
 *
 *  1. The affordance on the pause menu is a **single** control, it reads **DOWNLOAD
 *     LOG**, and it is a real 44-px target wholly inside the viewport. One button is
 *     the assertion, not a detail: a second one offering a worse export is the choice
 *     the ratification removed.
 *  2. **With no share sheet at all** — a desktop browser without Web Share, a phone
 *     browser or older WebView without it — the press performs a real **blob
 *     download**, and the file the browser actually wrote is opened off disk and
 *     parsed. Not a recorded call, not a stubbed sink: the bytes Chromium saved.
 *  3. The clipboard is granted, wrapped, and asserted **untouched**. Denying it would
 *     prove nothing — a route that tried and was refused looks identical to one that
 *     never tried — so the real method is counted, not removed. This is the
 *     ratification stated as an executable fact on both devices.
 *
 * And on the phone only, a fourth: the share sheet is handed a **FILE**, never text.
 * That is the phone's own route out (M10 action-echo §5) and it is a download with
 * the OS chooser in front of it, which is why one button covers both.
 *
 * Offline bundle on purpose — no allocator. The pause menu and the log are reachable
 * in an offline match, which is the mode the developer plays while travelling
 * (GDD §4.3 constraint 2), and pulling a fleet up would only add ways for this to
 * fail for reasons that are not about the log.
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * Recorded in the PR body with the evidence PNGs it writes, one pair per project.
 * Chromium in this lane needs its shared libraries staged on `LD_LIBRARY_PATH`
 * first.
 *
 *   npx playwright test --config tests/live-stage/playwright.log-download.config.ts
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** The DOM ids the affordance mounts under (`src/net/playtest-log-button.ts`) —
 *  restated rather than imported, because a spec that imports the module under test
 *  can pass while the *bundle* mounts nothing. */
const ROOT_ID = 'playtest-download-log';
const BUTTON_ID = 'playtest-download-log-button';
const HINT_ID = 'playtest-download-log-hint';

interface SharedRecord {
  title: string;
  text: string;
  files: { name: string; type: string; body: string }[];
}
interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface PauseRead {
  readonly open: boolean;
  readonly simTicks: number;
  readonly buttonPoint: PhysicalPoint;
}
declare const window: Window & {
  __pauseStage?: { read(): PauseRead };
  __sharedLog?: SharedRecord[];
  __clipboardWrites?: number;
};

/** The export payload, as the reader at the other end sees it
 *  (`PlaytestLogExport`, `src/net/playtest-log.ts`). */
interface ParsedLog {
  schema: string;
  version: number;
  summary: string;
  env: { sha: string; build: string; touch: boolean; viewport: string; formFactor: string };
  events: { at: number; kind: string; msg: string }[];
  capacity: number;
  dropped: number;
}

/** Which device this run is: the config's two projects, and the only thing the
 *  shared body of these tests branches on. */
function isPhone(info: TestInfo): boolean {
  return info.project.name === 'phone';
}

async function bootMatch(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => window.__pauseStage!.read().simTicks > 5, undefined, {
    timeout: 10_000,
  });
  return pageErrors;
}

/**
 * Count clipboard writes without blocking them.
 *
 * Denying the clipboard would prove nothing: the assertion is that the export does
 * not *reach* for it, and a route that tried and was refused would look identical
 * to one that never tried. So the real method is wrapped, not removed.
 */
async function watchClipboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__clipboardWrites = 0;
    const clipboard = navigator.clipboard as { writeText?: (t: string) => Promise<void> };
    const native = clipboard.writeText?.bind(navigator.clipboard);
    clipboard.writeText = async (text: string): Promise<void> => {
      window.__clipboardWrites = (window.__clipboardWrites ?? 0) + 1;
      if (native) await native(text);
    };
  });
}

/** Install a recording `navigator.share` — headless Chromium has no Web Share, and
 *  the shipped export looks it up itself. */
async function armShareSheet(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__sharedLog = [];
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    nav.canShare = () => true;
    nav.share = async (data: ShareData): Promise<void> => {
      const files = await Promise.all(
        (data.files ?? []).map(async (f) => ({ name: f.name, type: f.type, body: await f.text() })),
      );
      window.__sharedLog!.push({ title: data.title ?? '', text: data.text ?? '', files });
    };
  });
}

/** A device with no Web Share: the desk's normal state, and a phone browser or older
 *  WebView's. This is the blob-download route, which has to work when nothing else
 *  does. */
async function removeShareSheet(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });
}

/** Hold the button's answer on screen past its own 4 s revert, for the photograph.
 *  Only long timers are suppressed, so the game's own short ones still fire. */
async function holdConfirmation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const native = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
      (ms ?? 0) >= 4000 ? 0 : native(fn, ms, ...rest)) as typeof window.setTimeout;
  });
}

/** Open the pause menu the way this device does: a thumb on the corner affordance,
 *  or ESC on a keyboard. The corner button is touch-only by design
 *  (`src/ui/pause-menu` `pauseButtonVisible`), so the desk has no other route. */
async function openPause(page: Page, info: TestInfo): Promise<void> {
  if (isPhone(info)) {
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('no canvas bounding box');
    const point = await page.evaluate(() => window.__pauseStage!.read().buttonPoint);
    await page.touchscreen.tap(box.x + point.x, box.y + point.y);
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForFunction(() => window.__pauseStage!.read().open === true, undefined, {
    timeout: 5_000,
  });
}

/** Press the log button the way this device does. */
async function pressLogButton(page: Page, info: TestInfo): Promise<void> {
  const button = page.locator(`#${BUTTON_ID}`);
  const box = await button.boundingBox();
  if (!box) throw new Error('the log button has no box');
  if (isPhone(info)) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await button.click();
}

/** Everything a report needs to be readable at the other end. */
function assertReadableLog(parsed: ParsedLog, info: TestInfo, viewport: { width: number; height: number }): void {
  expect(parsed.schema, 'a log found in a chat thread says what it is').toBe(
    'planet-rush.playtest-log',
  );
  expect(parsed.version).toBeGreaterThanOrEqual(1);
  expect(parsed.summary, 'the top of it reads as a sentence').toMatch(/Planet Rush playtest log/);
  // The ring, whole: as many events as the session produced, the bound they were
  // kept under, and an honest count of anything evicted. A download that silently
  // truncated would be worse than none — it would look complete.
  expect(parsed.events.length, 'the log is empty').toBeGreaterThan(0);
  expect(parsed.capacity, 'the export states the ring it came out of').toBeGreaterThan(0);
  expect(parsed.events.length).toBeLessThanOrEqual(parsed.capacity);
  expect(parsed.dropped, 'the export owns up to what the ring evicted').toBeGreaterThanOrEqual(0);
  expect(parsed.events.every((e) => typeof e.msg === 'string' && typeof e.at === 'number')).toBe(
    true,
  );
  // And the header describes the device the report came from — which is the half of
  // "for all (PC and mobile)" this project is standing in for.
  expect(parsed.env.touch).toBe(isPhone(info));
  expect(parsed.env.formFactor).toBe(isPhone(info) ? 'phone' : 'desktop');
  expect(parsed.env.viewport).toBe(`${viewport.width}x${viewport.height}`);
  expect(parsed.env.sha, 'and which build it came off').not.toBe('');
}

test('the pause menu offers ONE log control, and it reads DOWNLOAD LOG', async ({ page }, info) => {
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);

  // Not there during play — the match owns the screen (GDD §2.2's HUD budget).
  expect(await page.locator(`#${BUTTON_ID}`).count(), 'a log button over a live match').toBe(0);

  await openPause(page, info);
  const button = page.locator(`#${BUTTON_ID}`);
  await expect(button, 'the log is offered on the pause menu (brief §2)').toBeVisible();
  await expect(button, 'the label the ratification names').toHaveText('DOWNLOAD LOG');

  // ONE control. The sibling that offered a clipboard is gone, on this device too:
  // a button count is the only form of that assertion a screenshot cannot fake.
  const buttons = page.locator(`#${ROOT_ID} button`);
  await expect(buttons, 'the affordance still offers a choice of export routes').toHaveCount(1);
  const words = (await page.locator(`#${ROOT_ID}`).innerText()).toUpperCase();
  expect(words, 'a copy affordance survived on this screen').not.toContain('COPY');

  // A real touch target, wholly inside the viewport past the safe area.
  const box = await button.boundingBox();
  expect(box, 'the button has a box').not.toBeNull();
  expect(box!.height, 'a real touch target, tall enough').toBeGreaterThanOrEqual(44);
  expect(box!.width, 'a real touch target, wide enough').toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

  // The landscape lock (`@platform/orientation`): the game root rotates +90° on a
  // touch viewport held portrait, and this affordance — DOM over the canvas — has to
  // turn with it. On a desk it must NOT, which is the same rule read the other way.
  const matrix = await page.evaluate(
    (id) => getComputedStyle(document.getElementById(id)!).transform,
    ROOT_ID,
  );
  if (isPhone(info)) {
    expect(matrix, 'the affordance turns with the landscape lock').toMatch(
      /^matrix\(0,\s*1,\s*-1,\s*0,/,
    );
  } else {
    expect(matrix, 'the desk has no landscape lock to turn with').toMatch(/none|matrix\(1,\s*0/);
  }

  await page.screenshot({ path: `tests/live-stage/log-download-${info.project.name}-pause-evidence.png` });
  expect(pageErrors, 'no page errors reaching the pause menu').toEqual([]);
});

test('with NO share sheet, the press writes a real file — and it parses', async ({ page }, info) => {
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await watchClipboard(page);
  await holdConfirmation(page);
  await removeShareSheet(page);

  await openPause(page, info);
  const button = page.locator(`#${BUTTON_ID}`);
  await expect(button).toBeVisible();

  const [saved] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    pressLogButton(page, info),
  ]);

  // The name the developer will be looking at in their Downloads folder:
  // `planet-rush-log-<sha>-<YYYYMMDD-HHMMSS>.json` — build first, because the first
  // question of any log is which build.
  expect(saved.suggestedFilename()).toMatch(/^planet-rush-log-[A-Za-z0-9-]+-\d{8}-\d{6}\.json$/);

  // The BYTES CHROMIUM WROTE, read back off disk. This is the ratification's own
  // test and the only form of it that cannot be satisfied by a stub.
  const path = await saved.path();
  expect(path, 'the browser saved nothing').toBeTruthy();
  const parsed = JSON.parse(await readFile(path!, 'utf8')) as ParsedLog;
  assertReadableLog(parsed, info, page.viewportSize()!);

  // Granted, working, and never asked — on this device, whichever it is.
  expect(
    await page.evaluate(() => window.__clipboardWrites ?? 0),
    'the export reached for the clipboard, which is the thing it exists to avoid',
  ).toBe(0);

  await expect(button, 'and the button says where it went').toHaveText('LOG SAVED');
  await expect(page.locator(`#${HINT_ID}`)).toHaveText(/downloads/i);
  await page.screenshot({ path: `tests/live-stage/log-download-${info.project.name}-saved-evidence.png` });

  expect(pageErrors, 'no page errors across pause → file').toEqual([]);
});

test('on a phone, the share sheet is handed a FILE and never text', async ({ page }, info) => {
  test.skip(!isPhone(info), 'the share sheet is the phone’s route out; a desk has none');
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await watchClipboard(page);
  await armShareSheet(page);
  await holdConfirmation(page);

  await openPause(page, info);
  await pressLogButton(page, info);
  await page.waitForFunction(() => (window.__sharedLog?.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });

  const shared = await page.evaluate(() => window.__sharedLog![0]!);
  expect(shared.files.length, 'the log went as a FILE, not as a wall of text').toBe(1);
  expect(shared.files[0]!.name).toMatch(/^planet-rush-log-.+-\d{8}-\d{6}\.json$/);
  expect(shared.files[0]!.type).toBe('application/json');
  assertReadableLog(JSON.parse(shared.files[0]!.body) as ParsedLog, info, page.viewportSize()!);

  expect(
    await page.evaluate(() => window.__clipboardWrites ?? 0),
    'the share route fell back to the clipboard',
  ).toBe(0);

  await expect(page.locator(`#${BUTTON_ID}`)).toHaveText('LOG SENT');
  await expect(page.locator(`#${HINT_ID}`)).toHaveText(/share sheet/);
  await page.screenshot({ path: 'tests/live-stage/log-download-phone-shared-evidence.png' });

  expect(pageErrors, 'no page errors across pause → share').toEqual([]);
});
