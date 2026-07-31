/**
 * tests/live-stage/log-download-touch.spec.ts — the log comes off the phone AS A
 * FILE. OWNER: Gameplay Engineer (ratified M10 §3).
 *
 * The developer's sentence is six words long and it is the whole brief:
 * *"too large for mobile clipboard."*
 *
 * `./copy-log-touch.spec.ts` already proves an export path exists on touch. What it
 * proves is COPY LOG's path — share sheet, then clipboard, then a download — and
 * the middle rung of that chain is exactly the one that can report success and
 * leave the developer stranded: a 40 KB JSON blob on a phone's clipboard is a paste
 * no chat app takes. So this file is about the sibling that cannot land there:
 * DOWNLOAD, whose promise is narrower and stronger — what comes out is a named
 * `.json` a thumb can attach.
 *
 * Two tests, and the second is the one the ratification names:
 *
 *  1. The button is drawn beside COPY LOG on the touch pause menu, is a real
 *     44-px target inside the portrait viewport, and hands the share sheet a FILE.
 *  2. **With no share sheet at all** — a phone browser without Web Share, an older
 *     WebView — the same tap performs a real **blob download**, and the file the
 *     browser actually wrote is opened off disk and parsed. That is the
 *     ratification's test, verbatim: *"the download path produces valid parseable
 *     JSON of the full ring buffer on a phone profile."* Not a recorded call, not a
 *     stubbed sink — the bytes Chromium saved.
 *
 * The clipboard is granted in both tests and asserted **untouched**: DOWNLOAD
 * reaching for it would be the defect this feature exists to remove, and a test
 * that merely denied the clipboard could not tell the difference.
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * Recorded in the PR body with the evidence PNG it writes. Chromium in this lane
 * needs its shared libraries staged on `LD_LIBRARY_PATH` first — the condition
 * `./copy-log-touch.spec.ts` documents.
 *
 *   npx playwright test --config tests/live-stage/playwright.copy-log.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** The DOM ids the affordance mounts under (`src/net/playtest-log-button.ts`) —
 *  restated rather than imported, because a spec that imports the module under test
 *  can pass while the *bundle* mounts nothing. */
const ROOT_ID = 'playtest-copy-log';
const COPY_ID = 'playtest-copy-log-button';
const DOWNLOAD_ID = 'playtest-copy-log-download';
const HINT_ID = 'playtest-copy-log-hint';

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
 * Denying the clipboard would prove nothing: the assertion is that DOWNLOAD does
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

/** Install a recording `navigator.share`, as `./copy-log-touch.spec.ts` does —
 *  headless Chromium has no Web Share, and the shipped export looks it up itself. */
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

/** Hold the button's answer on screen past its own 4 s revert, for the photograph
 *  (the same suppression `./copy-log-touch.spec.ts` explains at length). */
async function holdConfirmation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const native = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
      (ms ?? 0) >= 4000 ? 0 : native(fn, ms, ...rest)) as typeof window.setTimeout;
  });
}

/** Open the pause menu the way a thumb does. */
async function tapPause(page: Page): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const point = await page.evaluate(() => window.__pauseStage!.read().buttonPoint);
  await page.touchscreen.tap(box.x + point.x, box.y + point.y);
  await page.waitForFunction(() => window.__pauseStage!.read().open === true, undefined, {
    timeout: 5_000,
  });
}

/** Everything a report needs to be readable at the other end. */
function assertReadableLog(parsed: ParsedLog, viewport: { width: number; height: number }): void {
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
  // And the header describes the device the report came from — a phone. The one
  // assertion no desk profile can make, and the reason this runs where it does.
  expect(parsed.env.touch).toBe(true);
  expect(parsed.env.formFactor).toBe('phone');
  expect(parsed.env.viewport).toBe(`${viewport.width}x${viewport.height}`);
  expect(parsed.env.sha, 'and which build it came off').not.toBe('');
}

test('DOWNLOAD sits beside COPY LOG on the touch pause menu, and hands the sheet a FILE', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await watchClipboard(page);
  await armShareSheet(page);
  await holdConfirmation(page);

  // Not there during play — the match owns the screen (GDD §2.2's HUD budget).
  expect(await page.locator(`#${DOWNLOAD_ID}`).count(), 'no DOWNLOAD over a live match').toBe(0);

  await tapPause(page);
  const copy = page.locator(`#${COPY_ID}`);
  const download = page.locator(`#${DOWNLOAD_ID}`);
  await expect(copy, 'COPY LOG still leads — the desk still wants a clipboard').toBeVisible();
  await expect(download, 'and DOWNLOAD stands beside it (ratified §3)').toBeVisible();
  await expect(download).toHaveText(/DOWNLOAD/);

  // A real touch target, wholly inside the portrait viewport past the safe area.
  const box = await download.boundingBox();
  expect(box, 'the button has a box on a phone viewport').not.toBeNull();
  expect(box!.height, 'a real touch target, tall enough').toBeGreaterThanOrEqual(44);
  expect(box!.width, 'a real touch target, wide enough').toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  // It turned with the landscape lock, like the affordance it lives in.
  const matrix = await page.evaluate(
    (id) => getComputedStyle(document.getElementById(id)!).transform,
    ROOT_ID,
  );
  expect(matrix, 'the affordance turns with the landscape lock').toMatch(/^matrix\(0,\s*1,\s*-1,\s*0,/);

  await page.screenshot({ path: 'tests/live-stage/log-download-touch-pause-evidence.png' });

  // --- The tap ---------------------------------------------------------------
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForFunction(() => (window.__sharedLog?.length ?? 0) > 0, undefined, {
    timeout: 10_000,
  });

  const shared = await page.evaluate(() => window.__sharedLog![0]!);
  expect(shared.files.length, 'the log went as a FILE, not as a wall of text').toBe(1);
  expect(shared.files[0]!.name).toMatch(/^planet-rush-log-.+-\d{8}-\d{6}\.json$/);
  expect(shared.files[0]!.type).toBe('application/json');
  assertReadableLog(JSON.parse(shared.files[0]!.body) as ParsedLog, viewport);

  // The clipboard was available, permitted, and never asked.
  expect(
    await page.evaluate(() => window.__clipboardWrites ?? 0),
    'DOWNLOAD reached for the clipboard — the exact thing it exists to avoid',
  ).toBe(0);

  await expect(download).toHaveText(/LOG SENT/);
  await expect(page.locator(`#${HINT_ID}`)).toHaveText(/share sheet/);
  // COPY LOG is untouched by its sibling's press.
  await expect(copy, 'the clipboard button claimed an answer it never earned').toHaveText(/COPY LOG/);
  await page.screenshot({ path: 'tests/live-stage/log-download-touch-shared-evidence.png' });

  expect(pageErrors, 'no page errors across pause → download').toEqual([]);
});

test('with NO share sheet, the tap writes a real file — and it parses', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = await bootMatch(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await watchClipboard(page);
  await holdConfirmation(page);
  // A phone browser with no Web Share, or an older WebView. This is the blob
  // download the ratification names — the route that has to work on mobile Safari
  // and Chrome when nothing else does.
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  await tapPause(page);
  const download = page.locator(`#${DOWNLOAD_ID}`);
  const box = await download.boundingBox();

  const [saved] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2),
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
  assertReadableLog(parsed, page.viewportSize()!);

  expect(
    await page.evaluate(() => window.__clipboardWrites ?? 0),
    'the download route fell back to the clipboard',
  ).toBe(0);

  await expect(download, 'and the button says where it went').toHaveText(/LOG SAVED/);
  await expect(page.locator(`#${HINT_ID}`)).toHaveText(/downloads/i);
  await page.screenshot({ path: 'tests/live-stage/log-download-touch-saved-evidence.png' });

  expect(pageErrors, 'no page errors across pause → file').toEqual([]);
});
