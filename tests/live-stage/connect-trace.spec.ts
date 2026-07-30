/**
 * tests/live-stage/connect-trace.spec.ts — photograph the connecting screen while
 * it is connecting. OWNER: Netcode Engineer (M10 verbose connecting, brief §3).
 *
 * The developer asked twice for a connecting screen that says what it is doing.
 * The unit suite proves the wording and the affordances; this proves the thing a
 * unit test structurally cannot — that the REAL bundle, over a REAL socket to a
 * REAL two-Machine fleet, puts those words on the screen at the moments they are
 * supposed to appear. It boots `vite preview` on a bundle built against the local
 * fleet (`playwright.connect-trace.config.ts`), taps CREATE through the same seam
 * the other live-stage specs use, and captures:
 *
 *   connect-trace-dialing-evidence.png  — mid-flow: ALLOCATING and TICKET SIGNED
 *                                         behind a live DIALING MACHINE 0800d5b6…
 *   connect-trace-joined-evidence.png   — JOINED · SEAT 1, over the lobby it opened
 *   connect-trace-refused-evidence.png  — REFUSED: bad-ticket — machine mismatch,
 *                                         with RETRY and COPY LOG on the panel
 *
 * The refusal is not simulated: the fleet is put back into the production state —
 * pin disarmed, every upgrade landed on a Machine that does not host the room —
 * so the client really does receive `{"type":"joinError","reason":"bad-ticket"}`,
 * arriving at a screen that can finally say so.
 */
import { test, expect, type Page } from '@playwright/test';

const EDGE_CONTROL = 'http://127.0.0.1:8792/_edge/land';

/** The panel `src/net/connect-trace-view.ts` mounts. */
const PANEL = '#pr-connect-trace';

interface MainMenuSeam {
  screen: 'menu' | 'settings' | 'codex' | 'online';
  online(): void;
}
interface OnlineSeam {
  status: 'idle' | 'connecting' | 'error';
  open(): void;
  create(): void;
}
declare const window: Window & { __mainMenu?: MainMenuSeam; __onlineMenu?: OnlineSeam };

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

/** The panel's steps, in order, as the player reads them. */
async function steps(page: Page): Promise<string[]> {
  return page.$$eval(`${PANEL} .pr-ct-step`, (nodes) => nodes.map((n) => n.textContent?.trim() ?? ''));
}

test.describe('the verbose connecting screen, in the real client', () => {
  test('names each step as it happens, and ends on a seat', async ({ page }) => {
    // The fleet the config booted has the pin armed; let the edge round-robin.
    await page.request.get(`${EDGE_CONTROL}?pin=on&machine=any&wrong=0&reset=1`);
    await bootDoors(page);

    await page.evaluate(() => window.__onlineMenu?.create());

    // --- Mid-flow. The edge is holding the upgrade (hopDelayMs), so the dial is
    // --- a state that lasts long enough to be photographed rather than a frame.
    await expect(page.locator(`${PANEL} .pr-ct-live`)).toContainText('DIALING MACHINE', {
      timeout: 20_000,
    });
    const dialing = await steps(page);
    expect(dialing[0]).toContain('ALLOCATING ROOM');
    expect(dialing[1]).toContain('TICKET SIGNED');
    expect(dialing[1]).toMatch(/ROOM [A-Z2-9]{4}/); // the allocator's own code, verbatim
    expect(dialing[2]).toMatch(/DIALING MACHINE [0-9a-f]{8}…/);
    // Nothing has failed, so the panel offers nothing yet.
    await expect(page.locator('#pr-connect-trace-retry')).toHaveCount(0);
    await page.screenshot({ path: 'tests/live-stage/connect-trace-dialing-evidence.png' });

    // --- The seat. It lingers over the lobby it just opened.
    await expect(page.locator(`${PANEL} .pr-ct-step`).last()).toContainText('JOINED · SEAT', {
      timeout: 20_000,
    });
    await page.screenshot({ path: 'tests/live-stage/connect-trace-joined-evidence.png' });
  });

  test('stops on the exact refusal, with RETRY and COPY LOG on the panel', async ({ page }) => {
    // Put the fleet back into the exact state production was in: the pin DISARMED
    // (the fixture's stand-in for `MATCH_ROUTER` never reaching a Machine, because
    // the image would not build) and the edge landing every upgrade on a Machine
    // that does NOT host the room (`?wrong=1`). That is the coin flip losing, made
    // certain — and with no pin to catch it, the join gate answers the exact frame
    // the Director's probe caught: {"type":"joinError","reason":"bad-ticket"}.
    await page.request.get(`${EDGE_CONTROL}?pin=off&wrong=1&reset=1`);
    await bootDoors(page);

    await page.evaluate(() => window.__onlineMenu?.create());
    await expect(page.locator(`${PANEL} .pr-ct-bad`)).toContainText('REFUSED: bad-ticket', {
      timeout: 40_000,
    });

    const lines = await steps(page);
    // `×` is the step's own mark element, so the concatenated text has no space.
    expect(lines[lines.length - 1]).toBe('×REFUSED: bad-ticket — machine mismatch');
    // Both affordances, on the panel, at the moment of failure — the ask, verbatim.
    await expect(page.locator('#pr-connect-trace-retry')).toBeVisible();
    await expect(page.locator('#pr-connect-trace-copy')).toBeVisible();
    await expect(page.locator(`${PANEL} .pr-ct-hint`)).toContainText('COPY LOG to report this.');
    await page.screenshot({ path: 'tests/live-stage/connect-trace-refused-evidence.png' });

    // RETRY means a FRESH allocate, never a redial of the ticket that just lost —
    // so the story starts over from ALLOCATING rather than appending to the corpse.
    await page.locator('#pr-connect-trace-retry').click();
    await expect(page.locator(`${PANEL} .pr-ct-step`).first()).toContainText('ALLOCATING ROOM');
  });
});
