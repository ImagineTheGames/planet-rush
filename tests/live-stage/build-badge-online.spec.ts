/**
 * tests/live-stage/build-badge-online.spec.ts — the badge grows a SERVER, over a
 * real socket to a real two-Machine fleet.
 *
 * This is the half of the developer's ask that has a purpose attached: *"once you
 * connect to a server, append the server you connected to and its region"* —
 * because *"[I want to verify] region selection is working optimally, at a glance,
 * from any screenshot."* A screenshot is the deliverable, so a screenshot is what
 * this spec produces, and the thing it photographs has to be a Machine the client
 * genuinely joined — not a stubbed string, which is exactly the kind of green that
 * would let a mis-routed region ship.
 *
 * So it reuses the fleet `./connect-trace.spec.ts` established: two match Machines
 * behind a Fly-shaped edge, a real allocator, and a bundle built against it
 * (`./playwright.build-badge-online.config.ts`). CREATE a room; when the title
 * says JOINED, the badge must read `<sha> · <8 hex> (<region>)`, and the machine
 * id in it must be the SAME one the connecting screen named while dialling.
 *
 * Skipped, not failed, when there is no fleet: the default live-stage config boots
 * an offline bundle where CREATE can only ever reach "can't reach the servers",
 * and a test that cannot run should say so rather than redden a suite about
 * something else. `./build-badge.spec.ts` covers that build's promise.
 *
 * HOW TO RUN IT, AND WHAT HAS ACTUALLY BEEN RUN
 * ---------------------------------------------------------------------------
 *   npx playwright test --config tests/live-stage/playwright.build-badge-online.config.ts
 *
 * **This file has NOT been executed.** The lane it was authored in has Chromium's
 * binary but not its shared libraries (`libnss3.so`; `playwright install-deps`
 * needs root, and the lane has no sudo), so both tests fail at browser launch
 * before reaching an assertion — the same condition `./connect-trace.spec.ts`
 * documents, and the reason its own evidence PNGs are a commit behind. The bundle
 * builds and the local fleet comes up; only the browser does not.
 */
import { test, expect, type Page } from '@playwright/test';

const EDGE_CONTROL = 'http://127.0.0.1:8794/_edge/land';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface BuildBadgeSeam {
  text: string;
  visible: boolean;
  server: { machine: string; region: string } | null;
  bounds: Rect | null;
  withinAnchor: boolean;
}
interface MainMenuSeam {
  screen: 'menu' | 'settings' | 'codex' | 'online';
  online(): void;
}
interface OnlineSeam {
  title: string;
  create(): void;
}
interface LobbySeam {
  visible: boolean;
  localShipClass: string | null;
  rush(): void;
}
declare const window: Window & {
  __buildBadge?: BuildBadgeSeam;
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
};

/** `<sha> · <machine short-form> (<region>)` — the developer's own example shape,
 *  as a pattern: `3d7cc6a · d891dd0a (gru)`. */
const CONNECTED_TAG = /^(?:[0-9a-f]{7}|dev)\*? · [0-9a-f]{8} \([a-z]{2,8}\)$/;

/** The fleet this config stands up. Absent it, there is nothing to connect to. */
const HAS_FLEET = process.env['PR_LIVE_FLEET'] === '1';

async function badge(page: Page): Promise<BuildBadgeSeam> {
  const seen = await page.evaluate(() => {
    const b = window.__buildBadge;
    if (!b) return null;
    return { text: b.text, visible: b.visible, server: b.server, bounds: b.bounds, withinAnchor: b.withinAnchor };
  });
  expect(seen, 'the client installed no __buildBadge seam').not.toBeNull();
  return seen!;
}

/** Boot a clean client and open the doors. */
async function bootDoors(page: Page): Promise<void> {
  // `?gate=0` (a0-50): the title gate is a DOOR in front of the title screen,
  // opened by a press over four beats. This spec walks through the front door on
  // its way somewhere else. The flag turns off that one screen and nothing else —
  // the menu, the doors and the lobby below are the real ones. See
  // `src/ui/title-gate.ts` `gateEnabled`.
  await page.goto('/?gate=0', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__onlineMenu?.create === 'function', undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__mainMenu?.online());
  await page.waitForFunction(() => window.__mainMenu?.screen === 'online', undefined, { timeout: 10_000 });
}

test.describe('the badge names the server, and its region', () => {
  test.skip(!HAS_FLEET, 'needs the local fleet — run the build-badge-online config');

  test('appends "<machine> (<region>)" on a live connect, and keeps it into the match', async ({ page }) => {
    // The fleet the config booted has the socket-hop pin armed; let the edge route.
    await page.request.get(`${EDGE_CONTROL}?pin=on&machine=any&wrong=0&reset=1`);
    await bootDoors(page);

    // Before the tap: the build, alone. Whatever the badge says after the connect,
    // it has to have CHANGED — a suffix that was always there proves nothing.
    const before = await badge(page);
    expect(before.text).not.toContain(' · ');
    expect(before.server).toBeNull();

    await page.evaluate(() => window.__onlineMenu?.create());

    // Mid-flow the connecting screen names the Machine it is dialling. Capture it:
    // the badge's suffix has to be THAT Machine, not merely a plausible one.
    await page.waitForFunction(() => (window.__onlineMenu?.title ?? '').includes('DIALING MACHINE'), undefined, {
      timeout: 20_000,
    });
    const dialing = await page.evaluate(() => window.__onlineMenu?.title ?? '');
    const dialledMachine = /DIALING MACHINE ([0-9a-f]{8})/.exec(dialing)?.[1];
    expect(dialledMachine, `no machine id in "${dialing}"`).toBeTruthy();

    // The welcome lands, the lobby opens — and the badge has grown its server.
    await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
    const connected = await badge(page);
    expect(connected.text, 'the badge did not name the server it joined').toMatch(CONNECTED_TAG);
    expect(connected.text).toContain(dialledMachine!);
    expect(connected.text.startsWith(before.text), 'the build half of the tag changed').toBe(true);
    expect(connected.server?.machine).toContain(dialledMachine!);
    expect(connected.server?.region, 'the region is the whole point of the ask').not.toBe('');
    expect(connected.withinAnchor, 'the longer tag escaped the corner').toBe(true);
    // The screenshot the ask is actually for: region selection, verifiable at a
    // glance, from a picture of the lobby.
    await page.screenshot({ path: 'tests/live-stage/build-badge-online-lobby-evidence.png' });

    // And into the MATCH, where the badge shares its corner with the controls
    // strip — the developer's "shown on every single page" does not stop at RUSH!.
    await page.evaluate(() => window.__lobby?.rush());
    await page.waitForFunction(
      () => window.__lobby?.visible === false && window.__lobby?.localShipClass !== null,
      undefined,
      { timeout: 60_000 },
    );
    const inMatch = await badge(page);
    expect(inMatch.text).toBe(connected.text);
    expect(inMatch.withinAnchor).toBe(true);
    await page.screenshot({ path: 'tests/live-stage/build-badge-online-match-evidence.png' });
  });

  test('claims no server when the join is refused', async ({ page }) => {
    // The production failure state: pin disarmed, every upgrade landing on a
    // Machine that does not host the room, so the server really does answer
    // `{"type":"joinError","reason":"bad-ticket"}`. A refusal is not a connection,
    // and a badge that named a Machine here would be lying in a screenshot.
    await page.request.get(`${EDGE_CONTROL}?pin=off&wrong=1&reset=1`);
    await bootDoors(page);
    await page.evaluate(() => window.__onlineMenu?.create());
    await page.waitForFunction(
      () => (window.__onlineMenu?.title ?? '').startsWith('REFUSED:'),
      undefined,
      { timeout: 40_000 },
    );

    const refused = await badge(page);
    expect(refused.server).toBeNull();
    expect(refused.text).not.toContain(' · ');
    expect(refused.visible).toBe(true);
  });
});
