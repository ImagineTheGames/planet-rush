/**
 * tests/live-stage/connect-trace.spec.ts — photograph the connecting screen's
 * TITLE while it is connecting, on BOTH form factors. OWNER: Netcode Engineer
 * (M10 verbose connecting, brief §3; the developer's third pass, "status in the
 * title").
 *
 * The developer asked three times for a connecting screen that says what it is
 * doing, and the third time named the place: *"show it at the top where it says
 * CONNECTING… we don't need a separate pop-up for it."* So the assertion moved with
 * the words. The unit suite proves the wording and the affordances; this proves the
 * thing a unit test structurally cannot — that in the REAL bundle, over a REAL
 * socket to a REAL two-Machine fleet, the one big line at the top of the screen
 * ADVANCES: a different true sentence at each stage, never the static word.
 *
 * It boots `vite preview` on a bundle built against the local fleet
 * (`playwright.connect-trace.config.ts`), taps CREATE through the same seam the
 * other live-stage specs use, and captures — at the desk and, with the same walk at
 * a phone's viewport in portrait, in a hand:
 *
 *   connect-trace-dialing-evidence.png  — the title mid-flow: DIALING MACHINE
 *                                         0800d5b6…, with no panel under it
 *   connect-trace-joined-evidence.png   — where JOINED · SEAT n leads: the lobby.
 *                                         The seat is announced in the title of the
 *                                         screen being replaced, so the *photograph*
 *                                         of the ending is the room; the title that
 *                                         announced it is asserted from the sampled
 *                                         record below, which cannot miss a frame.
 *   connect-trace-refused-evidence.png  — REFUSED: bad-ticket — machine mismatch
 *                                         in the title, RETRY and DOWNLOAD LOG below it
 *
 *   connect-trace-phone-*-evidence.png  — the same three, at {@link PHONE}
 *
 * The refusal is not simulated: the fleet is put back into the production state —
 * pin disarmed, every upgrade landed on a Machine that does not host the room —
 * so the client really does receive `{"type":"joinError","reason":"bad-ticket"}`,
 * arriving at a title that can finally say so.
 *
 * HOW TO RUN IT, AND WHAT HAS ACTUALLY BEEN RUN
 * ---------------------------------------------------------------------------
 *   npx playwright test --config tests/live-stage/playwright.connect-trace.config.ts
 *
 * **This file has NOT been executed since the title rewrite.** The lane it was
 * authored in has Chromium's binary but not its shared libraries (`libnss3.so`;
 * `playwright install-deps` needs root, and the lane has no sudo), so all four
 * tests fail at browser launch before reaching an assertion — the same condition
 * `./unified-play-flow.spec.ts` documents. The bundle builds and the local fleet
 * comes up; only the browser does not. It needs one run on a box with those
 * libraries, and until then the three evidence PNGs beside this file are from
 * commit cbacc59 — the run of the PREVIOUS shape, photographing the bottom panel
 * this change deletes. That run will replace them and add the phone three.
 *
 * The wording, the affordances, the empty-render and the title's whole state walk
 * are proven with no browser at all in `src/net/connect-trace.test.ts`,
 * `src/net/connect-trace-view.test.ts` and `src/ui/lobby-entry.test.ts`, which do
 * run in the DoD suite.
 *
 * The title is Pixi text on the canvas, so it is read through the read-only
 * `window.__onlineMenu.title` seam, which `src/main.ts` fills from the very model
 * the view draws (`entryModel(entry, connectNarration()).prompt`) — never
 * re-derived, so a green run here cannot mean a seam that agrees with itself while
 * the screen says something else.
 *
 * WHY THE PHONE IS NOT JUST THE DESK AGAIN
 * ---------------------------------------------------------------------------
 * Two things only a narrow screen can answer. The title is now the biggest line on
 * the connecting screen and it spells out machine ids and room codes, so it has a
 * width to overrun that 1280px never tests. And the two affordances are DOM buttons
 * floating near the top of the page while the doors are drawn in a rotated canvas
 * underneath — so the phone run ends by tapping PLAY SOLO for real with a dead
 * online join on screen, which is the only honest way to prove the container's
 * `pointer-events:none` (`src/net/connect-trace-view.ts`) keeps the door that always
 * works (GDD §4.8 risk 6) pressable.
 */
import { test, expect, type Page } from '@playwright/test';

const EDGE_CONTROL = 'http://127.0.0.1:8792/_edge/land';

/** The affordances `src/net/connect-trace-view.ts` mounts — RETRY and DOWNLOAD LOG,
 *  and, since the developer's third pass, nothing else. The log affordance is ONE
 *  button and it is a download: the clipboard route was ratified away for every
 *  device, so there is no sibling here to select between (`./log-download.spec.ts`). */
const PANEL = '#pr-connect-trace';
const RETRY = '#pr-connect-trace-retry';
const DOWNLOAD = '#pr-connect-trace-download';

/** The phone the second half of this spec runs in, held PORTRAIT so the landscape
 *  lock's rotation remap is in play — the same profile the play-flow walk contracts
 *  (`./unified-play-flow.spec.ts`). */
const PHONE = { width: 390, height: 844, dpr: 3 } as const;

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface MainMenuSeam {
  screen: 'menu' | 'settings' | 'codex' | 'online';
  online(): void;
}
interface OnlineSeam {
  status: 'idle' | 'connecting' | 'error';
  /** The screen's title, exactly as drawn. */
  title: string;
  /** Where the doors are drawn, in canvas-local physical pixels. */
  doorControls: readonly { kind: string; physicalCenter: PhysicalPoint }[];
  open(): void;
  create(): void;
}
declare const window: Window & {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: { visible: boolean };
  /** Every distinct title this page has shown, in order (installed below). */
  __prTitles?: string[];
};

/** Boot a clean client and wait for both front-door seams. */
async function bootDoors(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__onlineMenu?.create === 'function', undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__mainMenu?.online());
  await page.waitForFunction(() => window.__mainMenu?.screen === 'online', undefined, { timeout: 10_000 });
}

/**
 * Start recording the title. Sampling rather than snapshotting, because "it says
 * JOINED at the end" is not the ask — *advancing* is, and a stage that flashed past
 * between two `expect`s is a stage this spec would otherwise never have seen.
 *
 * The stall tail (`… 12s`, `connect-trace` `connectTitleLine`) is trimmed before
 * comparing, so a slow fleet records one DIALING and not one per second.
 */
async function recordTitles(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = (window.__prTitles ??= []);
    const tick = (): void => {
      const title = (window.__onlineMenu?.title ?? '').replace(/ \d+s$/, '');
      if (title !== '' && title !== seen[seen.length - 1]) seen.push(title);
    };
    tick();
    window.setInterval(tick, 40);
  });
}

/** Every distinct title the page has shown so far, oldest first. */
async function titles(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__prTitles ?? []);
}

/**
 * CREATE a room on a healthy fleet and follow the title to a seat, photographing
 * the two moments worth a picture. Returns every distinct title the page showed.
 */
async function connectToASeat(page: Page, evidence: string): Promise<string[]> {
  // The fleet the config booted has the pin armed; let the edge round-robin.
  await page.request.get(`${EDGE_CONTROL}?pin=on&machine=any&wrong=0&reset=1`);
  await bootDoors(page);
  await recordTitles(page);

  await page.evaluate(() => window.__onlineMenu?.create());

  // --- Mid-flow. The edge is holding the upgrade (hopDelayMs), so the dial is
  // --- a state that lasts long enough to be photographed rather than a frame.
  await page.waitForFunction(() => (window.__onlineMenu?.title ?? '').includes('DIALING MACHINE'), undefined, {
    timeout: 20_000,
  });
  // Nothing has failed, so there is no second surface on the screen at all —
  // this is the pop-up the developer asked us to delete, asserted gone.
  await expect(page.locator(PANEL)).toBeHidden();
  await page.screenshot({ path: `tests/live-stage/${evidence}-dialing-evidence.png` });

  // --- The seat, arriving over the lobby it just opened.
  await page.waitForFunction(() => (window.__onlineMenu?.title ?? '').includes('JOINED · SEAT'), undefined, {
    timeout: 20_000,
  });
  await page.screenshot({ path: `tests/live-stage/${evidence}-joined-evidence.png` });

  return titles(page);
}

/** The ask itself: the title was a different true sentence at every stage. */
function expectTheTitleAdvanced(advanced: readonly string[]): void {
  expect(advanced[0]).toBe('MINE · DEFEND · ATTACK'); // the standing line, before the tap
  expect(advanced.slice(1, 4)).toEqual([
    'ALLOCATING ROOM…',
    expect.stringMatching(/^ROOM [A-Z2-9]{4} · TICKET SIGNED$/), // the allocator's own code
    expect.stringMatching(/^DIALING MACHINE [0-9a-f]{8}…$/),
  ]);
  expect(advanced[advanced.length - 1]).toMatch(/^JOINED · SEAT \d$/);
  // Never the word it replaced, and never the same line twice in a row.
  expect(advanced).not.toContain('CONNECTING…');
  expect(new Set(advanced).size).toBe(advanced.length);
}

/**
 * CREATE against a fleet that will refuse, and stop on the refusal — the title
 * saying it exactly, with both affordances under it and nothing repeating it.
 */
async function connectToARefusal(page: Page, evidence: string): Promise<void> {
  // Put the fleet back into the exact state production was in: the pin DISARMED
  // (the fixture's stand-in for `MATCH_ROUTER` never reaching a Machine, because
  // the image would not build) and the edge landing every upgrade on a Machine
  // that does NOT host the room (`?wrong=1`). That is the coin flip losing, made
  // certain — and with no pin to catch it, the join gate answers the exact frame
  // the Director's probe caught: {"type":"joinError","reason":"bad-ticket"}.
  await page.request.get(`${EDGE_CONTROL}?pin=off&wrong=1&reset=1`);
  await bootDoors(page);
  await recordTitles(page);

  await page.evaluate(() => window.__onlineMenu?.create());
  await page.waitForFunction(
    () => (window.__onlineMenu?.title ?? '').startsWith('REFUSED: bad-ticket'),
    undefined,
    { timeout: 40_000 },
  );

  // The server's own token first (greppable in a bug report), then the gloss —
  // in the title, where the player is already looking.
  const title = await page.evaluate(() => window.__onlineMenu?.title ?? '');
  expect(title).toBe('REFUSED: bad-ticket — machine mismatch');

  // Both affordances, under that line, at the moment of failure — the ask,
  // verbatim. And the failure is said ONCE: the buttons do not repeat it.
  await expect(page.locator(RETRY)).toBeVisible();
  await expect(page.locator(DOWNLOAD)).toBeVisible();
  await expect(page.locator(DOWNLOAD)).toHaveText('DOWNLOAD LOG');
  await expect(page.locator(`${PANEL} .pr-ct-hint`)).toContainText('DOWNLOAD LOG to report this.');
  await expect(page.locator(PANEL)).not.toContainText('machine mismatch');

  // Two buttons under the refusal, not three: a screen that still offered a
  // clipboard beside the download would be the ratified-away shape growing back
  // on the surface nobody photographs.
  await expect(page.locator(`${PANEL} .pr-ct-button`)).toHaveCount(2);
  await expect(page.locator(PANEL)).not.toContainText(/COP/i);

  // "I see the verbosity (it's on the bottom)" — measured, on whatever screen this
  // is running on: the affordances sit in the top half, under the title, not down
  // where the developer found them.
  const box = await page.locator(PANEL).boundingBox();
  const viewport = page.viewportSize();
  expect(box, 'the affordances have a box on screen').not.toBeNull();
  expect(box!.y).toBeLessThan((viewport?.height ?? 0) / 2);

  await page.screenshot({ path: `tests/live-stage/${evidence}-refused-evidence.png` });
}

/** The canvas origin in page space: the seam reports canvas-local physical points,
 *  so a real press adds it back to land on the drawn door. */
async function doorPagePoint(page: Page, kind: string): Promise<PhysicalPoint> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const local = await page.evaluate(
    (k) => {
      const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    kind,
  );
  if (!local) throw new Error(`the doors reported no ${kind}`);
  return { x: box.x + local.x, y: box.y + local.y };
}

test.describe('the connecting screen says what it is doing, in its title', () => {
  test('advances the title through every stage, and ends on a seat', async ({ page }) => {
    expectTheTitleAdvanced(await connectToASeat(page, 'connect-trace'));
  });

  test('stops the title on the exact refusal, with RETRY and DOWNLOAD LOG below it', async ({ page }) => {
    await connectToARefusal(page, 'connect-trace');

    // RETRY means a FRESH allocate, never a redial of the ticket that just lost —
    // so the title starts the story over rather than sitting on the corpse.
    await page.locator(RETRY).click();
    await page.waitForFunction(() => (window.__onlineMenu?.title ?? '').startsWith('ALLOCATING ROOM'), undefined, {
      timeout: 20_000,
    });
    expect(await titles(page)).toContain('REFUSED: bad-ticket — machine mismatch');
  });
});

// Both form factors, always (brief §3). The same two walks in a hand: the title is
// the biggest line on this screen now and it has a phone's width to overrun, and the
// affordances are DOM buttons over a rotated canvas that the doors are drawn in.
test.describe('…and says it in a hand, too (phone, portrait, held)', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: PHONE.dpr,
    viewport: { width: PHONE.width, height: PHONE.height },
  });

  test('phone: advances the title through every stage, and ends on a seat', async ({ page }) => {
    expectTheTitleAdvanced(await connectToASeat(page, 'connect-trace-phone'));
  });

  test('phone: refuses in the title, and PLAY SOLO is still tappable under it', async ({ page }) => {
    await connectToARefusal(page, 'connect-trace-phone');

    // The two buttons float near the top of the page while the doors are drawn in
    // the canvas below. Only the button rects take taps
    // (`src/net/connect-trace-view.ts` `pointer-events`), so the door that always
    // works is still pressable with a dead online join on the screen — pressed for
    // real, because a CSS rule asserted in node is not a tap that landed.
    const solo = await doorPagePoint(page, 'solo');
    await page.touchscreen.tap(solo.x, solo.y);
    await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
  });
});
