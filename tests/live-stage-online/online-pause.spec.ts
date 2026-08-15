/**
 * tests/live-stage-online/online-pause.spec.ts — an ONLINE pause does not pause
 * anything. OWNER: Gameplay Engineer (ratified M10 §2; GDD §4.2 "No pause online").
 *
 * The ratification, in full:
 *
 *   > pause menu in an online match must NOT pause the sim — menu opens
 *   > (exit/settings reachable), world keeps running, ship keeps flying (or
 *   > drifts), server unaffected. Offline pause still truly pauses. Test BOTH:
 *   > online pause tick continuity, offline pause tick freeze. Live-stage both
 *   > form factors.
 *
 * This is the online half; the offline half is
 * `tests/live-stage/pause-tick-audit.spec.ts`.
 *
 * ── WHY IT HAS TO BE LIVE, AND HERE ────────────────────────────────────────
 * The rule is one boolean — `pausable = onlineSession === null` (`src/main.ts`),
 * consumed by `shouldFreezeSim` (`src/ui/pause-menu.ts`) — and both halves of it
 * are already unit-tested as pure functions. What no unit test can reach is
 * whether the boolean is *wired to a real socket*: an online match booted through
 * the front door, a real allocator behind CREATE ROOM, a real match server
 * ticking, and the overlay up over it. The flag was built long before the
 * networked transport existed ("testable before the networked transport exists",
 * `pause-menu.ts`), so the `false` branch has never once been exercised against an
 * actual session. This file is that exercise.
 *
 * It is also the only place the *last* clause is checkable at all: "server
 * unaffected" is a claim about a process in another port, and it is asked the way
 * the rest of this suite asks — of the ALLOCATOR, after the fact, not of the
 * client that would be the thing at fault.
 *
 * ── BOTH FORM FACTORS ──────────────────────────────────────────────────────
 * Desk with a real ESC, and an iPhone held PORTRAIT with a real thumb on the
 * corner affordance — two different paths into one state, through the
 * landscape-lock remap on the second. The developer plays on the second.
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * Recorded in the PR body with the evidence PNGs it writes. Chromium in this lane
 * needs its shared libraries staged on `LD_LIBRARY_PATH` before it will launch.
 *
 *   npx playwright test --config tests/live-stage-online/playwright.config.ts online-pause
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ALLOCATOR_URL } from './online-fleet';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface ShipRead {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}
interface PauseRead {
  readonly screen: 'closed' | 'menu' | 'settings' | 'confirm';
  readonly open: boolean;
  readonly pausable: boolean;
  readonly frozen: boolean;
  readonly simTicks: number;
  readonly online: boolean;
  readonly ship: ShipRead | null;
  readonly controls: readonly ControlReport[];
  readonly buttonPoint: PhysicalPoint;
}
interface MainMenuSeam {
  visible: boolean;
  matchStarted: boolean;
  controls: readonly ControlReport[];
}
interface OnlineSeam {
  visible: boolean;
  doorControls: readonly ControlReport[];
}
interface LobbySeam {
  visible: boolean;
  room: string;
  rushControl: { physicalCenter: PhysicalPoint };
}
interface BuildBadgeSeam {
  text: string;
  server: { machine: string; region: string } | null;
  rttMs: number | null;
}
declare const window: Window & {
  __pauseStage?: { read(): PauseRead };
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
  __buildBadge?: BuildBadgeSeam;
};

const PC = { width: 1280, height: 800, dpr: 1, touch: false } as const;
/** Portrait, held — the landscape lock is in play on every press. */
const IPHONE = { width: 390, height: 844, dpr: 3, touch: true } as const;
type Profile = typeof PC | typeof IPHONE;

/** Real time to sit on the paused screen. ~30 ticks at 60 Hz, and long enough for
 *  the server to have broadcast several snapshots into it. */
const DWELL_MS = 500;

interface Client {
  readonly page: Page;
  readonly profile: Profile;
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
  // `?gate=0` (a0-50): the title gate is a DOOR in front of the title screen,
  // opened by a press over four beats. This spec walks through the front door on
  // its way somewhere else. The flag turns off that one screen and nothing else —
  // the menu, the doors and the lobby below are the real ones. See
  // `src/ui/title-gate.ts` `gateEnabled`.
  await page.goto('/?gate=0', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, {
    timeout: 30_000,
  });

  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const press = async (p: PhysicalPoint): Promise<void> => {
    const x = box.x + p.x;
    const y = box.y + p.y;
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  return { client: { page, profile, press, errors }, context };
}

/** Press a control the client says it drew, or fail naming it. */
async function pressReported(
  client: Client,
  read: () => Promise<PhysicalPoint | null>,
  what: string,
): Promise<void> {
  const point = await read();
  if (!point) throw new Error(`the client reported no '${what}' control`);
  await client.press(point);
}

/**
 * PLAY → CREATE ROOM → RUSH!, pressed for real, landing in a live online match.
 *
 * One client, not two: the audit is about this client's own overlay over its own
 * session, and a room's bots fill the seats a second human would (GDD §2.1). The
 * two-client walk is `./online-play-flow.spec.ts`'s job.
 */
async function startOnlineMatch(client: Client): Promise<string> {
  await pressReported(
    client,
    () =>
      client.page.evaluate(() => {
        const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === 'play');
        return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
      }),
    'play',
  );
  await client.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, {
    timeout: 30_000,
  });
  await pressReported(
    client,
    () =>
      client.page.evaluate(() => {
        const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === 'create');
        return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
      }),
    'create',
  );
  // A REAL allocator is behind this door in this suite, so it opens a real room.
  await client.page.waitForFunction(() => window.__lobby?.visible === true, undefined, {
    timeout: 60_000,
  });
  const code = await client.page.evaluate(() => window.__lobby!.room);
  expect(code, 'the allocator minted a room code').toMatch(/^[A-Z2-9]{4}$/);

  const rush = await client.page.evaluate(() => window.__lobby!.rushControl.physicalCenter);
  await client.press({ x: rush.x, y: rush.y });
  await client.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
    timeout: 60_000,
  });
  await client.page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, {
    timeout: 30_000,
  });
  // Authority is ticking and the client is following it.
  await client.page.waitForFunction(() => window.__pauseStage!.read().simTicks > 30, undefined, {
    timeout: 30_000,
  });
  return code;
}

/** Open the overlay the way this device does — ESC, or a thumb on the corner. */
async function openPause(client: Client): Promise<void> {
  if (client.profile.touch) {
    const point = await client.page.evaluate(() => window.__pauseStage!.read().buttonPoint);
    await client.press(point);
  } else {
    await client.page.keyboard.press('Escape');
  }
  await client.page.waitForFunction(() => window.__pauseStage!.read().open === true, undefined, {
    timeout: 10_000,
  });
}

async function pressPauseControl(client: Client, kind: string): Promise<void> {
  await pressReported(
    client,
    () =>
      client.page.evaluate((k) => {
        const c = window.__pauseStage!.read().controls.find((x) => x.kind === k);
        return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
      }, kind),
    kind,
  );
}

/** Ask the ALLOCATOR whether the room is still live — the honest way to ask
 *  "server unaffected", since the client is the thing under suspicion. */
async function roomIsLive(code: string): Promise<boolean> {
  const res = await fetch(`${ALLOCATOR_URL}/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return res.status === 200;
}

for (const [name, profile] of [
  ['desk (ESC)', PC],
  ['phone, portrait (thumb on the corner button)', IPHONE],
] as const) {
  test(`online pause does NOT pause — ${name}: ticks continue, the ship moves, the room lives`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const { client, context } = await bootClient(browser, profile, baseURL!);
    const evidence = profile.touch ? 'phone' : 'pc';
    try {
      const code = await startOnlineMatch(client);

      // --- This is the networked world, and it says so. -----------------------
      const running = await readPause(client.page);
      expect(running.online, 'an online match reports itself as such').toBe(true);
      expect(running.pausable, 'a networked match is NEVER pausable (GDD §4.2)').toBe(false);
      expect(running.ship, 'the server seated us a ship').not.toBeNull();
      const badge = await client.page.evaluate(() => ({
        text: window.__buildBadge!.text,
        server: window.__buildBadge!.server,
      }));
      expect(badge.server, 'the client is on a real Machine').not.toBeNull();

      // --- The menu OPENS. ---------------------------------------------------
      await openPause(client);
      const paused = await readPause(client.page);
      expect(paused.screen, 'ESC / the corner button opens the overlay online too').toBe('menu');
      // The whole point of an overlay you cannot pause behind: the way OUT still
      // has to be there. Both of the ratification's named controls, drawn.
      const kinds = paused.controls.map((c) => c.kind);
      expect(kinds, 'exit and settings are reachable over a running online match').toEqual([
        'resume',
        'settings',
        'exit',
      ]);
      expect(paused.frozen, 'an online overlay must never freeze the sim').toBe(false);

      // --- …and the world does NOT stop. -------------------------------------
      //
      // Thrust is HELD across the whole dwell. A ship sitting at zero velocity
      // with no input does not move even in a perfectly live sim — Euler plus
      // drag, and nothing to integrate — so an unmoved ship would have proved
      // nothing either way. (That is not a hypothetical: the first run of this
      // spec failed here for exactly that reason, on a sim the tick counter
      // showed running.) Holding W makes the clause checkable and, as a bonus,
      // checks the thing behind it: a player's input still reaches an online sim
      // while the overlay is up, which is what "the ship keeps flying" means from
      // the cockpit.
      //
      // The keyboard on both profiles is deliberate. The form factor under test
      // here is how the overlay is OPENED — ESC versus a thumb through the
      // landscape-lock remap — and the sim advancing a ship underneath it is the
      // same code either way; a synthetic virtual-stick drag would test
      // `touch.ts`, which `tests/live-stage/input-parity.spec.ts` already owns.
      await client.page.keyboard.down('KeyW');
      try {
        const before = await readPause(client.page);
        await client.page.waitForTimeout(DWELL_MS);
        const after = await readPause(client.page);

        expect(
          after.simTicks,
          'the sim stopped under an online pause — one player paused eight',
        ).toBeGreaterThan(before.simTicks);
        // Half a second is ~30 ticks at 60 Hz; anything in double figures is a
        // running loop rather than a stray frame or two.
        expect(after.simTicks - before.simTicks, 'the sim barely ticked').toBeGreaterThan(10);
        // "the ship keeps flying (or drifts)" — the clause a tick counter cannot see.
        const moved = Math.hypot(after.ship!.x - before.ship!.x, after.ship!.y - before.ship!.y);
        expect(moved, 'the ship was pinned in place while the overlay was up').toBeGreaterThan(1);
      } finally {
        await client.page.keyboard.up('KeyW');
      }

      await client.page.screenshot({
        path: `tests/live-stage-online/online-pause-${evidence}-evidence.png`,
      });

      // --- The SETTINGS round-trip, over a still-running sim. ----------------
      await pressPauseControl(client, 'settings');
      await client.page.waitForFunction(
        () => window.__pauseStage!.read().screen === 'settings',
        undefined,
        { timeout: 10_000 },
      );
      const onSettings = await readPause(client.page);
      expect(onSettings.frozen, 'the settings screen does not freeze it either').toBe(false);
      const settled = await readPause(client.page);
      await client.page.waitForTimeout(DWELL_MS);
      expect(
        (await readPause(client.page)).simTicks,
        'the sim stopped behind the settings screen',
      ).toBeGreaterThan(settled.simTicks);
      await pressPauseControl(client, 'back');
      await client.page.waitForFunction(
        () => window.__pauseStage!.read().screen === 'menu',
        undefined,
        { timeout: 10_000 },
      );

      // --- The SERVER is unaffected. -----------------------------------------
      // Asked of the allocator, not of the client: the room is still hosted, so
      // nothing about one player's overlay reached the match server. And this
      // client is still on the same Machine it started on — no drop, no reconnect
      // dressed up as a pause.
      expect(await roomIsLive(code), 'the room did not survive one player pausing').toBe(true);
      const stillOn = await client.page.evaluate(() => window.__buildBadge!.server);
      expect(stillOn?.machine, 'the session moved Machines across the pause').toBe(
        badge.server!.machine,
      );

      // --- RESUME. ------------------------------------------------------------
      await pressPauseControl(client, 'resume');
      await client.page.waitForFunction(() => window.__pauseStage!.read().open === false, undefined, {
        timeout: 10_000,
      });

      expect(client.errors, `page errors across the online pause: ${client.errors.join('\n')}`).toEqual(
        [],
      );
    } finally {
      await context.close();
    }
  });
}

async function readPause(page: Page): Promise<PauseRead> {
  return page.evaluate(() => window.__pauseStage!.read());
}
