/**
 * tests/live-stage-online/disconnect-honesty.spec.ts — the tab really goes away,
 * and the game really says so. OWNER: Netcode Engineer (GDD §4.2; the developer's
 * zombie-match report, m10 disconnect honesty §5).
 *
 * WHAT THIS PROVES THAT NOTHING ELSE CAN
 * ---------------------------------------------------------------------------
 * `src/net/link-loss.test.ts` proves the watchdog's rules, and
 * `tests/net/disconnect-honesty.test.ts` proves the whole client/server cycle over
 * real sockets — but both *simulate* the backgrounded tab, because neither has a
 * browser. This spec does the thing itself: a real Chromium page is put through
 * Chrome's own lifecycle transitions (`hidden` → `frozen`, the states a phone's
 * browser uses when you leave the app), its network is cut underneath it while it
 * cannot run a line of JavaScript, and then it is brought back — which is the
 * developer's sentence, executed: *"left browser, came back, disconnected."*
 *
 * The assertion is the overlay itself, in the real DOM (`src/net/link-loss-view`):
 * a full-screen kick-out that names what was detected, with RECONNECT and ABANDON
 * MATCH on it as real 44-px targets. No test seam is involved — the overlay is
 * plain DOM precisely because the moment it exists for is the moment the canvas
 * may not be drawing, and that property is what makes it assertable here.
 *
 * BOTH FORM FACTORS
 * ---------------------------------------------------------------------------
 * The walk runs twice — a PC pair and a phone pair, the phone held in PORTRAIT so
 * the landscape-lock remap is in play — because backgrounding is a *phone* story
 * first (GDD §4.2: "screen lock, app backgrounding and cellular drops are routine
 * in a way they are not on desktop").
 *
 * Runs against the real fleet stood up by `./online-fleet.ts`, like its neighbour
 * `./online-play-flow.spec.ts`; it is not part of `npx vitest run` and not part of
 * CI. The command is the config's own, deliberately, on a machine with browsers:
 *
 *   npx playwright test --config tests/live-stage-online/playwright.config.ts
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface MainMenuSeam {
  visible: boolean;
  matchStarted: boolean;
  controls: readonly ControlReport[];
}
interface OnlineSeam {
  visible: boolean;
  screen: 'home' | 'join';
  code: string;
  doorControls: readonly ControlReport[];
}
interface LobbySeam {
  visible: boolean;
  room: string;
  humanCount: number;
  rushControl: { physicalCenter: PhysicalPoint };
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
}
declare const window: Window & StageWindow;

/** The overlay's own ids (`src/net/link-loss-view`). Spelled here rather than
 *  imported, so the spec fails if a rename silently drops the surface. */
const OVERLAY = '#pr-link-loss';
const OVERLAY_TITLE = '#pr-link-loss-title';
const OVERLAY_RECONNECT = '#pr-link-loss-reconnect';
const OVERLAY_ABANDON = '#pr-link-loss-abandon';
const OVERLAY_MENU = '#pr-link-loss-menu';

const PC = { width: 1280, height: 800, dpr: 1, touch: false } as const;
const IPHONE = { width: 390, height: 844, dpr: 3, touch: true } as const;
const PIXEL = { width: 412, height: 915, dpr: 2.6, touch: true } as const;
type Profile = typeof PC | typeof IPHONE | typeof PIXEL;

interface Client {
  readonly page: Page;
  readonly press: (p: PhysicalPoint) => Promise<void>;
  readonly errors: string[];
}

async function bootClient(
  browser: Browser,
  profile: Profile,
  baseURL: string,
): Promise<{ client: Client; context: BrowserContext }> {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
    baseURL,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 30_000 });

  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const press = async (p: PhysicalPoint): Promise<void> => {
    const x = box.x + p.x;
    const y = box.y + p.y;
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  return { client: { page, press, errors }, context };
}

async function pressPlay(client: Client): Promise<void> {
  const play = await client.page.evaluate(() => {
    const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!play) throw new Error('the menu reported no PLAY button');
  await client.press(play);
  await client.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, {
    timeout: 30_000,
  });
}

async function pressDoor(client: Client, kind: string): Promise<void> {
  const point = await client.page.evaluate((k) => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!point) throw new Error(`the entry screen reported no '${kind}' control`);
  await client.press(point);
}

/** Host creates, guest joins, host starts: both clients in one live match. */
async function twoClientsInAMatch(
  browser: Browser,
  baseURL: string,
  hostProfile: Profile,
  guestProfile: Profile,
): Promise<{ host: Client; guest: Client; contexts: BrowserContext[]; code: string }> {
  const { client: host, context: hostContext } = await bootClient(browser, hostProfile, baseURL);
  const { client: guest, context: guestContext } = await bootClient(browser, guestProfile, baseURL);

  await pressPlay(host);
  await pressDoor(host, 'create');
  await host.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
  const code = await host.page.evaluate(() => window.__lobby!.room);

  await pressPlay(guest);
  await pressDoor(guest, 'join');
  await guest.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, {
    timeout: 15_000,
  });
  for (const ch of code) await pressDoor(guest, `key:${ch}`);
  await pressDoor(guest, 'submit');
  await guest.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
  await host.page.waitForFunction(() => window.__lobby?.humanCount === 2, undefined, { timeout: 30_000 });

  const rush = await host.page.evaluate(() => window.__lobby!.rushControl.physicalCenter);
  await host.press({ x: rush.x, y: rush.y });
  for (const client of [host, guest]) {
    await client.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
      timeout: 60_000,
    });
  }
  return { host, guest, contexts: [hostContext, guestContext], code };
}

/**
 * **Background the tab for real, and cut the wire while it cannot look.**
 *
 * `frozen` is Chrome's own lifecycle state for a backgrounded page, and the only
 * one the protocol lets a test ask for (`Page.setWebLifecycleState` takes exactly
 * `frozen` and `active` — there is no CDP way to force `hidden`, so the
 * visibility-return rule stays unit-tested in `src/net/link-loss.test.ts` and this
 * spec asserts whichever signal wins the race here). Frozen is the half that
 * matters anyway: timers stop and not one line of the page's JavaScript runs.
 *
 * The network is cut *while it is frozen*, so the socket dies with nobody home to
 * hear it — which is the whole bug: no `onclose` was ever going to run. It stays
 * cut after the page wakes, because the developer's sentence ends "came back,
 * disconnected": what the player sees on return is the subject here, and a
 * reclaim that succeeds against a reachable server is already proven over real
 * sockets in `tests/net/disconnect-honesty.test.ts`.
 *
 * So on return, everything the client can know it has to work out from the state
 * of the world: the last frame it received is `awayMs` old, and nothing is coming.
 */
async function backgroundAndSever(page: Page, awayMs: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, awayMs));
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
}

async function walkTheDisconnect(
  browser: Browser,
  baseURL: string,
  hostProfile: Profile,
  guestProfile: Profile,
  evidence: string,
): Promise<void> {
  const { host, guest, contexts } = await twoClientsInAMatch(browser, baseURL, hostProfile, guestProfile);
  try {
    // --- 1. A healthy match shows NOTHING. -----------------------------------
    // The negative half, and the one that would catch a watchdog too eager to
    // fire: a match that is working must never see this overlay.
    await host.page.waitForTimeout(3_000);
    expect(await host.page.locator(OVERLAY).count(), 'no overlay over a live match').toBe(0);

    // --- 2. The player leaves the browser. The socket dies unheard. ----------
    await backgroundAndSever(host.page, 6_000);

    // --- 3. Coming back, the client KICKS THE PLAYER OUT and says why. -------
    await host.page.waitForSelector(`${OVERLAY} ${OVERLAY_TITLE}`, { state: 'visible', timeout: 30_000 });
    const title = (await host.page.locator(OVERLAY_TITLE).innerText()).trim();
    // Whichever of the three signals won the race (silence, the return, or the
    // socket's own close once the page could run again), the line has to name
    // something true rather than shrug — that is the whole feature.
    expect(title, `the overlay names what happened: "${title}"`).toMatch(
      /^(CONNECTION LOST|RECONNECTING|SEAT EXPIRED|MATCH ENDED)/,
    );
    await host.page.screenshot({ path: `tests/live-stage-online/${evidence}-lost-evidence.png` });

    // --- 4. …with the two doors, as real touch targets. ----------------------
    // ABANDON MATCH is on every non-terminal state; RECONNECT joins it while the
    // seat is still reclaimable; a spent window replaces both with BACK TO MENU.
    const abandon = host.page.locator(OVERLAY_ABANDON);
    const menu = host.page.locator(OVERLAY_MENU);
    const doors = (await abandon.count()) + (await menu.count());
    expect(doors, 'there is always a way out of the overlay').toBeGreaterThan(0);
    for (const door of [OVERLAY_RECONNECT, OVERLAY_ABANDON, OVERLAY_MENU]) {
      const locator = host.page.locator(door);
      if ((await locator.count()) === 0) continue;
      const box = await locator.boundingBox();
      expect(box, `${door} is drawn`).not.toBeNull();
      // 44 px, on the phone as on the desktop (mobile amendment §1).
      expect(box!.height, `${door} is a real touch target`).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    // --- 5. The overlay covers the match it is kicking the player out of. ----
    const viewport = host.page.viewportSize()!;
    const overlayBox = await host.page.locator(OVERLAY).boundingBox();
    expect(overlayBox!.width, 'full-bleed: this is a kick-out, not a toast').toBeGreaterThanOrEqual(
      viewport.width - 1,
    );
    expect(overlayBox!.height).toBeGreaterThanOrEqual(viewport.height - 1);

    // --- 6. The GUEST, whose connection never moved, is untouched. -----------
    // The one thing worse than a silent disconnect is a disconnect overlay on a
    // client that is fine.
    expect(await guest.page.locator(OVERLAY).count(), 'the other player is still playing').toBe(0);

    // --- 7. The way out works: leaving lands back on the real main menu. -----
    const exit = (await abandon.count()) > 0 ? abandon : menu;
    await exit.click();
    await host.page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, {
      timeout: 30_000,
    });

    expect(guest.errors, `no page errors on the guest: ${guest.errors.join('\n')}`).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
}

test('PC: backgrounding the tab kicks the player out with a reason and two doors', async ({
  browser,
  baseURL,
}) => {
  await walkTheDisconnect(browser, baseURL!, PC, PC, 'disconnect-honesty-pc');
});

test('phones (portrait, held): the same, on the form factor backgrounding actually happens on', async ({
  browser,
  baseURL,
}) => {
  await walkTheDisconnect(browser, baseURL!, IPHONE, PIXEL, 'disconnect-honesty-phones');
});
