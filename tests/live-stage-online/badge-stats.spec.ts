/**
 * tests/live-stage-online/badge-stats.spec.ts — the badge grows a CONNECTION, over
 * a real socket. OWNER: Gameplay Engineer (ratified M10 §1).
 *
 *   > BADGE + CONNECTION STATS: build badge (bottom-left, every screen) gains live
 *   > stats when connected: "3cb36f5 · d891dd0a (gru) · 62ms" — network rtt (the
 *   > decomposed NETWORK number, never the composite), updated ~2s. Keep
 *   > pointer-transparent, never covers controls.
 *
 * The unit suite owns the string and the cadence (`src/platform/build-identity.test.ts`)
 * and the geometry (`src/render/build-badge.test.ts`). Neither can say the one
 * thing this file is for: that a third field appears on a badge drawn by the
 * shipped bundle, because a real client timed a real wire — and that it says
 * NOTHING before one has been timed.
 *
 * `../live-stage/build-badge-online.spec.ts` is this file's older sibling and
 * covers the *server* half of the tag against a two-Machine fleet, under a config
 * that skips itself when no fleet is up. This one runs in the suite that always
 * stands one up, so the stats half is exercised on every run of it.
 *
 * ── WHAT IT CANNOT PROVE, AND WHERE THAT LIVES ─────────────────────────────
 * That the number is the *decomposed NETWORK* figure rather than the composite is
 * a claim about which accessor the wiring reads. Over a loopback fleet both are a
 * millisecond or two, so no live assertion can separate them — the guard for that
 * is `src/main.ts`'s `matchNetworkRtt()` reading `hudNetworkRttMs`, and
 * `src/net/telemetry.ts`'s own documentation of the difference. Said here rather
 * than left implied, so nobody reads a green run as covering it.
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * Recorded in the PR body with the evidence PNGs it writes.
 *
 *   npx playwright test --config tests/live-stage-online/playwright.config.ts badge-stats
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
interface BuildBadgeSeam {
  text: string;
  visible: boolean;
  server: { machine: string; region: string } | null;
  rttMs: number | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
  withinAnchor: boolean;
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
interface PauseRead {
  readonly controls: readonly ControlReport[];
  readonly buttonPoint: PhysicalPoint;
}
declare const window: Window & {
  __buildBadge?: BuildBadgeSeam;
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
  __pauseStage?: { read(): PauseRead };
};

const PC = { width: 1280, height: 800, dpr: 1, touch: false } as const;
/** Portrait, held — the badge rides the landscape-lock rotation with the world. */
const IPHONE = { width: 390, height: 844, dpr: 3, touch: true } as const;
type Profile = typeof PC | typeof IPHONE;

/**
 * The developer's own example shape, as a pattern:
 * `3cb36f5 · d891dd0a (gru) · 62ms`.
 *
 * The region parenthetical is optional because a *local* fleet Machine reports no
 * region ("local — no region preference"), and the tag correctly drops the
 * parenthetical rather than printing an empty one. The two mandatory parts are the
 * build and the milliseconds — this file is about the third field existing.
 */
const STATS_TAG = /^\S+ · \S+(?: \([a-z]{2,8}\))? · \d+ms$/;
/** The tag once a server is named and before the wire has been timed. */
const CONNECTED_TAG = /^\S+ · \S+(?: \([a-z]{2,8}\))?$/;

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

async function badge(page: Page): Promise<BuildBadgeSeam> {
  const seen = await page.evaluate(() => {
    const b = window.__buildBadge;
    if (!b) return null;
    return {
      text: b.text,
      visible: b.visible,
      server: b.server,
      rttMs: b.rttMs,
      bounds: b.bounds,
      withinAnchor: b.withinAnchor,
    };
  });
  expect(seen, 'the client installed no __buildBadge seam').not.toBeNull();
  return seen!;
}

async function pressReported(
  client: Client,
  read: () => Promise<PhysicalPoint | null>,
  what: string,
): Promise<void> {
  const point = await read();
  if (!point) throw new Error(`the client reported no '${what}' control`);
  await client.press(point);
}

/** PLAY → CREATE ROOM, landing in the online lobby on a live session. */
async function createRoom(client: Client): Promise<void> {
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
  await client.page.waitForFunction(() => window.__lobby?.visible === true, undefined, {
    timeout: 60_000,
  });
}

for (const [name, profile] of [
  ['desk', PC],
  ['phone, portrait', IPHONE],
] as const) {
  test(`the badge grows "· NNms" once the wire is timed, and carries none before — ${name}`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const { client, context } = await bootClient(browser, profile, baseURL!);
    const evidence = profile.touch ? 'phone' : 'pc';
    const page = client.page;
    try {
      // --- On the menu: the build, alone. -------------------------------------
      // Whatever the badge says once connected has to have CHANGED. A stats field
      // that was always there would prove nothing.
      const onMenu = await badge(page);
      expect(onMenu.visible, 'the badge is on the menu — "every single page"').toBe(true);
      expect(onMenu.text, 'an offline tag is the bare sha').not.toContain(' · ');
      expect(onMenu.server).toBeNull();
      expect(onMenu.rttMs, 'a round trip with nothing at the far end of it').toBeNull();

      // --- Connected: the server lands first, then the wire is timed. ---------
      await createRoom(client);
      const connected = await badge(page);
      expect(connected.server, 'the client is on a real Machine').not.toBeNull();
      expect(connected.text, 'the badge did not name the server it joined').toMatch(CONNECTED_TAG);
      expect(connected.text.startsWith(`${onMenu.text} · `), 'the build half moved').toBe(true);

      // In the LOBBY there is no stats field yet, and that is correct rather than
      // missing: the client's ping probe rides `sendInput` (`@net/session`), so
      // nothing has timed this wire until the match is predicting. "A number is a
      // measurement or it is absent" (`@net/ping` rule 1) — a `0ms` here would be
      // a claim about a wire nobody has measured. (The lobby is not blind: the
      // roster already shows each seat's ping from the SERVER's own probe.)
      expect(connected.rttMs, 'the badge invented a round trip in the lobby').toBeNull();
      expect(connected.withinAnchor, 'the connected tag escaped the corner').toBe(true);
      await page.screenshot({ path: `tests/live-stage-online/badge-stats-${evidence}-lobby-evidence.png` });

      // --- Into the MATCH: the wire gets timed, and the field appears. --------
      // "Every single page" does not stop at RUSH!, and in-match is where the
      // corner is busiest — the controls strip on a desk, the thrust stick on a
      // phone. The badge is lifted clear of both.
      const rush = await page.evaluate(() => window.__lobby!.rushControl.physicalCenter);
      await client.press({ x: rush.x, y: rush.y });
      await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
        timeout: 60_000,
      });
      await page.waitForFunction(() => (window.__buildBadge?.rttMs ?? null) !== null, undefined, {
        timeout: 30_000,
      });
      const timed = await badge(page);
      expect(timed.text, 'the tag is not the developer\'s three-field string').toMatch(STATS_TAG);
      expect(timed.text.endsWith(`${timed.rttMs}ms`), 'the drawn number is the seam\'s').toBe(true);
      expect(timed.rttMs!).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(timed.rttMs!)).toBe(true);
      // The build and server halves did not move when the stats field landed.
      expect(timed.text.startsWith(`${onMenu.text} · `)).toBe(true);
      expect(timed.text.startsWith(connected.text)).toBe(true);
      // It never covers a control: still inside its declared bottom-left zone, at
      // its longest, on this viewport (the third field made the tag ~40% wider).
      expect(timed.withinAnchor, 'the longer tag escaped the corner').toBe(true);
      expect(timed.bounds!.width).toBeGreaterThan(0);
      await page.screenshot({ path: `tests/live-stage-online/badge-stats-${evidence}-match-evidence.png` });

      // (The other two halves of "never covers a control" are asserted where they
      // can be: `eventMode = 'none'` and the clearance from the controls strip and
      // the thrust-stick ghost, measured against those layers' own rects at the
      // WIDEST tag, in `src/render/build-badge.test.ts`. What only a live run can
      // add is `withinAnchor` on a real viewport with a real font, above.)

      // --- Leaving carries no stale connection back to the menu. --------------
      // EXIT navigates to a clean menu URL (`exitToMenu`), so this is the "no
      // stale identity survives" check rather than an in-place disconnect; the
      // in-place path — `disconnected()` dropping the rtt with the socket — is
      // asserted in `src/platform/build-identity.test.ts`, which can force it.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window.__pauseStage?.read().controls.length ?? 0) > 0, undefined, {
        timeout: 10_000,
      });
      await pressReported(
        client,
        () =>
          page.evaluate(() => {
            const c = window.__pauseStage!.read().controls.find((x) => x.kind === 'exit');
            return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
          }),
        'exit',
      );
      await pressReported(
        client,
        () =>
          page.evaluate(() => {
            const c = window.__pauseStage!.read().controls.find((x) => x.kind === 'leave');
            return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
          }),
        'leave',
      );
      await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, {
        timeout: 60_000,
      });
      const backOnMenu = await badge(page);
      expect(backOnMenu.server, 'the badge still claimed a server after leaving').toBeNull();
      expect(backOnMenu.rttMs, 'a stale round trip outlived its socket').toBeNull();
      expect(backOnMenu.text, 'and the tag is the bare build again').not.toContain(' · ');

      expect(client.errors, `page errors: ${client.errors.join('\n')}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
