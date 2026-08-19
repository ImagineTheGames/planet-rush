/**
 * evidence/a0-98-corner-collisions-everywhere-else/2-online-disconnect.spec.ts —
 * OWNER: UI Engineer (a0-98).
 *
 * **The state the brief says matters most, and the only one that can arrive
 * unannounced on any screen.**
 *
 * `src/main.ts` `syncDownloadLog` raises the offer whenever the session is
 * `reconnecting` or `closed`, and that branch sits BELOW the pause guard but
 * ABOVE the pause check — so with the overlay closed, which is where a player
 * flying a match actually is, a dropped connection puts a DOM button at the
 * platform's largest z-index over the live HUD. Nothing asks what is drawn there.
 *
 * Two things can be under it, and this walk measures both:
 *
 *  1. **The match's own controls**, while the session is `reconnecting` and the
 *     HUD is still up — on touch that corner is the aim stick and the FIRE button
 *     (`right-half-bottom`), on every viewport it is the minimap (`bottom-right`,
 *     GDD §2.2). Read from `__cornerStage` (a0-98), which reports the frame's own
 *     layout-registry entries; `?debug=1` builds that registry but cannot reach an
 *     online match, which is why the seam ships on both boots.
 *  2. **The CONNECTION LOST card's own doors** — RECONNECT, ABANDON MATCH, BACK TO
 *     MENU (`src/net/link-loss-view`). That card is `z-index:2147483646`, exactly
 *     one below the log affordance's `2147483647`, and it is raised by the same
 *     dropped connection. A player who has just been kicked out of a match needs
 *     those two buttons more than they need anything else on the screen.
 *
 * The disconnect is real: Chrome's own lifecycle freeze plus a severed network,
 * the recipe `tests/live-stage-online/disconnect-honesty.spec.ts` established for
 * the developer's *"left browser, came back, disconnected"*.
 *
 * Nothing is asserted. The run is the finding, taken twice (`A0_98_STAGE`).
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepState, type StateReport } from './probe';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE = process.env.A0_98_STAGE ?? 'broken';
const SHOTS = join(HERE, 'shots', STAGE);

interface Profile {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly touch: boolean;
}

/**
 * Three, not two, and the third earns its place: the log affordance's own CSS
 * re-homes it under `(pointer:coarse) and (orientation:portrait)` — the landscape
 * lock's other half — from the physical bottom-RIGHT to the physical bottom-LEFT,
 * rotated 90°. That is a different corner over a different part of the HUD, so a
 * phone held portrait is not the landscape phone with different numbers.
 */
const PROFILES: readonly Profile[] = [
  { id: 'desktop-1280x800', width: 1280, height: 800, dpr: 2, touch: false },
  { id: 'phone-798x384', width: 798, height: 384, dpr: 2, touch: true },
  { id: 'phone-portrait-390x844', width: 390, height: 844, dpr: 3, touch: true },
];

/** The other end of the room. It never loses its connection, so it is also the
 *  control: whatever this walk shows must NOT be showing over there. */
const GUEST: Profile = { id: 'guest-desktop', width: 1280, height: 800, dpr: 1, touch: false };

interface Client {
  readonly page: Page;
  readonly press: (p: { x: number; y: number }) => Promise<void>;
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
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await page.goto('/?gate=0', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(
    () => (window as never as { __mainMenu?: { visible: boolean } }).__mainMenu?.visible === true,
    undefined,
    { timeout: 60_000 },
  );
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const press = async (p: { x: number; y: number }): Promise<void> => {
    const x = box.x + p.x;
    const y = box.y + p.y;
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  return { client: { page, press }, context };
}

async function pressPlay(client: Client): Promise<void> {
  const play = await client.page.evaluate(() => {
    const c = (
      (window as never as { __mainMenu?: { controls: { kind: string; physicalCenter: { x: number; y: number } }[] } })
        .__mainMenu?.controls ?? []
    ).find((x) => x.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!play) throw new Error('the menu reported no PLAY button');
  await client.press(play);
  await client.page.waitForFunction(
    () => (window as never as { __onlineMenu?: { visible: boolean } }).__onlineMenu?.visible === true,
    undefined,
    { timeout: 60_000 },
  );
}

async function pressDoor(client: Client, kind: string): Promise<void> {
  const point = await client.page.evaluate((k) => {
    const c = (
      (window as never as { __onlineMenu?: { doorControls: { kind: string; physicalCenter: { x: number; y: number } }[] } })
        .__onlineMenu?.doorControls ?? []
    ).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!point) throw new Error(`the entry screen reported no '${kind}' control`);
  await client.press(point);
}

/** Host creates, guest joins, host starts: both clients in one live match. The
 *  same walk `disconnect-honesty.spec.ts` uses, through the real front door. */
async function twoClientsInAMatch(
  browser: Browser,
  baseURL: string,
  hostProfile: Profile,
): Promise<{ host: Client; guest: Client; contexts: BrowserContext[] }> {
  const { client: host, context: hostContext } = await bootClient(browser, hostProfile, baseURL);
  const { client: guest, context: guestContext } = await bootClient(browser, GUEST, baseURL);

  await pressPlay(host);
  await pressDoor(host, 'create');
  await host.page.waitForFunction(
    () => (window as never as { __lobby?: { visible: boolean } }).__lobby?.visible === true,
    undefined,
    { timeout: 120_000 },
  );
  const code = await host.page.evaluate(() => (window as never as { __lobby: { room: string } }).__lobby.room);

  await pressPlay(guest);
  await pressDoor(guest, 'join');
  await guest.page.waitForFunction(
    () => (window as never as { __onlineMenu?: { screen: string } }).__onlineMenu?.screen === 'join',
    undefined,
    { timeout: 30_000 },
  );
  // The list is the default mode; this walk types the code the host was given.
  await guest.page.evaluate(() =>
    (window as never as { __onlineMenu: { setJoinMode(m: string): void } }).__onlineMenu.setJoinMode('code'),
  );
  for (const ch of code) await pressDoor(guest, `key:${ch}`);
  await pressDoor(guest, 'submit');
  await guest.page.waitForFunction(
    () => (window as never as { __lobby?: { visible: boolean } }).__lobby?.visible === true,
    undefined,
    { timeout: 120_000 },
  );
  await host.page.waitForFunction(
    () => (window as never as { __lobby?: { humanCount: number } }).__lobby?.humanCount === 2,
    undefined,
    { timeout: 60_000 },
  );

  const rush = await host.page.evaluate(
    () => (window as never as { __lobby: { rushControl: { physicalCenter: { x: number; y: number } } } }).__lobby.rushControl.physicalCenter,
  );
  await host.press({ x: rush.x, y: rush.y });
  for (const client of [host, guest]) {
    await client.page.waitForFunction(
      () => (window as never as { __mainMenu?: { matchStarted: boolean } }).__mainMenu?.matchStarted === true,
      undefined,
      { timeout: 120_000 },
    );
  }
  return { host, guest, contexts: [hostContext, guestContext] };
}

/** Cut the wire under a running page. No lifecycle freeze: this is the window
 *  where the socket has gone and the client is REDIALING while the HUD is still
 *  the screen — which is exactly the state `syncDownloadLog`'s first branch reads,
 *  and the one no overlay has covered yet. */
async function severOnly(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
}

/** …and the developer's own case on top of it: the tab really goes away while the
 *  wire is cut, so the socket dies with nobody home to hear it. */
async function backgroundAndReturn(page: Page, awayMs: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await new Promise((r) => setTimeout(r, awayMs));
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
}

/** The session and overlay facts that belong beside every row. */
async function matchContext(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const corner = (window as never as {
      __cornerStage?: { session(): { state: string | null; closeReason: string | null } };
    }).__cornerStage;
    const pause = (window as never as {
      __pauseStage?: { read(): { screen: string; online: boolean } };
    }).__pauseStage;
    const card = document.getElementById('pr-link-loss');
    return {
      session: corner?.session() ?? null,
      pauseScreen: pause?.read().screen ?? null,
      online: pause?.read().online ?? null,
      linkLossCard: card ? { hidden: card.hidden, title: document.getElementById('pr-link-loss-title')?.textContent ?? '' } : null,
    };
  });
}

for (const profile of PROFILES) {
  test(`a0-98 what is on top when the connection drops — ${profile.id} (${STAGE})`, async ({ browser, baseURL }) => {
    test.setTimeout(600_000);
    mkdirSync(SHOTS, { recursive: true });
    const reports: StateReport[] = [];
    const { host, guest, contexts } = await twoClientsInAMatch(browser, baseURL!, profile);

    const record = async (state: string): Promise<void> => {
      const report = await sweepState(host.page, state, profile, await matchContext(host.page));
      reports.push(report);
      await host.page.screenshot({ path: join(SHOTS, `${profile.id}-${state}.png`) });
    };

    try {
      // --- 1. A healthy online match. The offer must be nowhere. -------------
      await host.page.waitForTimeout(3_000);
      await record('online-match-live');

      // --- 2. The wire is cut under a running page. --------------------------
      // The offer's own trigger, caught as early as the client raises it: the
      // session leaves `open` and the HUD is still the whole screen.
      await severOnly(host.page);
      await host.page
        .waitForFunction(
          () => {
            const root = document.getElementById('playtest-download-log');
            return !!root && root.hidden === false;
          },
          undefined,
          { timeout: 60_000 },
        )
        .catch(() => {
          /* recorded as "never offered" rather than failing the capture */
        });
      await host.page.waitForTimeout(400);
      await record('online-match-severed');

      // --- 3. …and the tab goes away and comes back on a dead wire. ----------
      // The developer's sentence, executed. By here the CONNECTION LOST card is
      // up with its two doors, and the log affordance is one z-index above it.
      await backgroundAndReturn(host.page, 7_000);
      await host.page
        .waitForSelector('#pr-link-loss-title', { state: 'visible', timeout: 60_000 })
        .catch(() => {
          /* recorded as "no card" rather than failing the capture */
        });
      await host.page.waitForTimeout(1_200);
      await record('online-match-kicked-out');

      // --- 4. The guest, whose wire never moved, is the control. -------------
      const guestReport = await sweepState(guest.page, 'online-match-guest-healthy', GUEST, await matchContext(guest.page));
      reports.push(guestReport);
    } finally {
      writeFileSync(
        join(SHOTS, `${profile.id}-online-report.json`),
        `${JSON.stringify({ stage: STAGE, profile: profile.id, reports }, null, 2)}\n`,
      );
      for (const context of contexts) await context.close();
    }
  });
}
