/**
 * tests/browse/lobby-browse.spec.ts — the browse screen, on a real device, with
 * a real (fixtured) allocator behind it. OWNER: UI Engineer (u17-01).
 *
 * ── WHAT THIS EXISTS FOR ───────────────────────────────────────────────────
 * The developer's ruling: *"join gives you both options BROWSE and ENTER ROOM
 * CODE, easy, solved"*, *"there should be a join button to join it"*, and *"a
 * browse shouldn't show the room code, just the room owner id and location /
 * ping"*.
 *
 * The model half of that is unit-tested in `src/ui/lobby-browser.test.ts` and the
 * rects in `src/ui/lobby-entry.test.ts`. Neither proves the screen is on a phone:
 * Planet Rush draws its whole presentation into one PixiJS/WebGL canvas, so a
 * model that returns four rows proves nothing about a screen that never painted
 * them — which is the miss that created the mobile suite in the first place.
 *
 * So this file asserts what only a device can settle, at the ONE profile the
 * developer plays at (390 px landscape):
 *
 *  1. **The list is DRAWN.** Every row's own reported rect turned into a
 *     screenshot region and the pixels inside it counted — the u5 seat-state
 *     idiom — and the JOIN button inside each row likewise, because a0-24 had
 *     just finished pulling two elements back off this exact edge.
 *  2. **A row shows owner, location and ping — and NEVER a code.** Asserted
 *     against the fixture's own room codes, which the listing route does not
 *     publish and this screen therefore cannot leak.
 *  3. **The order is the MEASURED one.** The fixture answers Virginia's probe
 *     fast and São Paulo's slow, and Virginia sorts first — the row order a0-29
 *     had to land before this screen could be honest.
 *  4. **Empty is a state.** With no open claims the screen says so in a sentence
 *     and ENTER ROOM CODE is right there, reported at a pressable rect.
 *  5. **A stale row refuses honestly.** The fixture lets the list advertise a
 *     seat and then answers the join with 409 — the room filled up while the
 *     player was looking at it — and the screen says which of the two things
 *     happened, keeps the list, and marks that row.
 *  6. **The code path is one tap away and unchanged**: pressing ENTER ROOM CODE
 *     puts the keypad up with all 32 keys at pressable rects.
 *
 * ── THE FLEET IS A FIXTURE ─────────────────────────────────────────────────
 * Every allocator call is answered by `page.route` (see `playwright.u17.config.ts`
 * for why the bundle is built with an allocator URL at all). Nothing here reaches
 * a deployment, spends a room, or costs money — §6/D5 is unanswered and the
 * developer's.
 *
 * ── EVIDENCE ───────────────────────────────────────────────────────────────
 * Under `PR_EVIDENCE=1` the same frames are written to
 * `evidence/images/u17-lobby-browse/`. They are evidence, not baselines: this
 * file makes no golden comparison and re-baselines nothing.
 */
import { test, expect, type Page, type CDPSession, type Route } from '@playwright/test';
import { count, decode, isNonVacuum, type Img, type Region } from '../mobile/pixels';
import { settleFrames } from '../mobile/render-settle';
import { budgetTest } from '../mobile/budgets';

const WRITE_EVIDENCE = process.env.PR_EVIDENCE === '1';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface MenuSeam {
  readonly visible: boolean;
  readonly controls: ReadonlyArray<{
    readonly kind: string;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  }>;
  readonly logicalViewport: { readonly width: number; readonly height: number };
}

interface BrowseRowSeam {
  readonly owner: string;
  readonly meta: string;
  readonly where: string;
  readonly action: string;
  readonly state: string;
  readonly enabled: boolean;
  readonly physicalCenter: { readonly x: number; readonly y: number };
  readonly physicalBounds: Rect;
  readonly joinBounds: Rect;
}

interface DoorsSeam {
  readonly visible: boolean;
  readonly screen: string;
  readonly status: string;
  readonly error: string;
  readonly joinMode: string;
  readonly browseRows: readonly BrowseRowSeam[];
  readonly browseStamp: string;
  readonly browseStale: boolean;
  readonly browseEmpty: readonly string[];
  readonly browseHidden: number;
  readonly doorControls: ReadonlyArray<{
    readonly kind: string;
    readonly physicalCenter: { readonly x: number; readonly y: number };
    readonly physicalBounds: Rect;
  }>;
}

// --- The fixtured fleet -----------------------------------------------------

/**
 * Two regions, and the probe targets the client times them against. The ping on
 * each row is whatever THIS client measures here, so the fixture shapes the
 * numbers by shaping the latency rather than by publishing one.
 */
const REGIONS = {
  regions: [
    {
      region: 'iad',
      machines: 2,
      capacity: 12,
      rooms: 3,
      free: 9,
      probe: { url: 'http://probe.u17.test/iad' },
    },
    {
      region: 'gru',
      machines: 1,
      capacity: 6,
      rooms: 1,
      free: 5,
      probe: { url: 'http://probe.u17.test/gru' },
    },
  ],
};

/** How long each region's probe takes to answer. Virginia is near, São Paulo is
 *  not — from the US, which is where the lane machine is. */
const PROBE_DELAY_MS: Readonly<Record<string, number>> = { iad: 25, gru: 220 };

/** The room codes the fixture's rooms actually have. They are NOT in the listing
 *  — the route publishes a derived handle and an owner tag instead — and this
 *  spec asserts they never reach the screen. */
const SECRET_CODES = ['B7GW', 'K4QP', 'ZR29'];

/** A populated listing: three open claims, two regions, different occupancies. */
const POPULATED = {
  asOf: 1_760_000_000_000,
  rooms: [
    { id: 'h-gru-1', owner: 'M4RT9K', region: 'gru', size: 8, mode: 'ffa', players: 3, joinableSeats: 5 },
    { id: 'h-iad-1', owner: 'K7M2QP', region: 'iad', size: 8, mode: 'teams', players: 2, joinableSeats: 4 },
    { id: 'h-iad-2', owner: 'W9XB4T', region: 'iad', size: 4, mode: 'ffa', players: 1, joinableSeats: 1 },
  ],
};

const EMPTY = { asOf: 1_760_000_000_000, rooms: [] };

const CORS = { 'access-control-allow-origin': '*' };

/** Answer every allocator and probe call from the fixture. `listing` is read on
 *  each request, so a test can change what the fleet says mid-run. */
async function installFleet(
  page: Page,
  state: { listing: () => unknown; joinStatus?: () => number },
): Promise<void> {
  await page.route('**/regions', async (route: Route) => {
    await route.fulfill({ status: 200, headers: CORS, json: REGIONS });
  });
  await page.route('**/probe.u17.test/**', async (route: Route) => {
    const id = new URL(route.request().url()).pathname.replace('/', '');
    await new Promise((resolve) => setTimeout(resolve, PROBE_DELAY_MS[id] ?? 100));
    await route.fulfill({ status: 200, headers: CORS, json: { region: id } });
  });
  await page.route('**/listings/*/join', async (route: Route) => {
    const status = state.joinStatus?.() ?? 409;
    await route.fulfill({ status, headers: CORS, json: { error: 'room-full' } });
  });
  // The list itself, last: `**/rooms` would otherwise also swallow the two above.
  await page.route('**/rooms', async (route: Route) => {
    await route.fulfill({ status: 200, headers: CORS, json: state.listing() });
  });
}

// --- Input ------------------------------------------------------------------

/** A real physical press: CDP touch, because this is a phone profile. */
async function press(page: Page, x: number, y: number): Promise<void> {
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

/** Hold the phone the way the developer plays: 844×390 logical. */
async function landscape(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp && vp.width < vp.height) await page.setViewportSize({ width: vp.height, height: vp.width });
}

const doors = async (page: Page): Promise<DoorsSeam> => {
  const seam = await page.evaluate(() => {
    const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
    if (!d) return null;
    return JSON.parse(JSON.stringify(d)) as DoorsSeam;
  });
  expect(seam, '__onlineMenu present').not.toBeNull();
  return seam as DoorsSeam;
};

/** Boot clean, press PLAY, press JOIN — which lands on BROWSE by default. */
async function pressThroughToBrowse(page: Page): Promise<void> {
  await landscape(page);
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu;
      return !!m && m.visible && m.controls.length > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  const play = await page.evaluate(
    () =>
      (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu?.controls.find(
        (c) => c.kind === 'play',
      )?.physicalCenter ?? null,
  );
  expect(play, 'PLAY on a clean boot').not.toBeNull();
  await press(page, play!.x, play!.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.doorControls.length,
    undefined,
    { timeout: 30_000 },
  );

  const join = (await doors(page)).doorControls.find((c) => c.kind === 'join');
  expect(join, 'the JOIN door').toBeTruthy();
  await press(page, join!.physicalCenter.x, join!.physicalCenter.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.screen === 'join',
    undefined,
    { timeout: 30_000 },
  );
  await settleFrames(page);
}

/** Wait until the list has rows AND the pings have landed (the row order is the
 *  measured one, so a frame shot before the probes answer is a frame of the
 *  right rows in the wrong order). */
async function waitForRows(page: Page, n: number): Promise<void> {
  await page.waitForFunction(
    (want) => {
      const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
      return (
        !!d && d.browseRows.length >= want && d.browseRows.every((r) => !/—$/.test(r.where))
      );
    },
    n,
    { timeout: 30_000 },
  );
  await settleFrames(page);
}

function regionOf(bounds: Rect, vp: { width: number; height: number }): Region {
  return {
    x0: bounds.x / vp.width,
    y0: bounds.y / vp.height,
    x1: (bounds.x + bounds.width) / vp.width,
    y1: (bounds.y + bounds.height) / vp.height,
  };
}

async function shoot(page: Page, file: string): Promise<Img> {
  const buf = WRITE_EVIDENCE
    ? await page.screenshot({ path: `evidence/images/u17-lobby-browse/${file}.png` })
    : await page.screenshot();
  return decode(buf);
}

/** Device pixels of anything at all inside a rect, below which it was not drawn.
 *  The same low bar the seat-state and campaign-door specs use, and for the same
 *  reason: the failure it guards against draws NOTHING. */
const DRAWN_MIN_PX = 200;

// ===========================================================================
// 1. A populated list
// ===========================================================================

test('the browse list draws a row per open claim, with owner, place and a measured ping', async ({
  page,
}) => {
  budgetTest({
    work: 'clean boot → PLAY → JOIN (lands on BROWSE) → fixtured listing + probes → shoot the frame and count pixels in every row and every JOIN button',
    measuredSeconds: 22,
  });

  await installFleet(page, { listing: () => POPULATED });
  await pressThroughToBrowse(page);
  await waitForRows(page, 3);

  const seam = await doors(page);
  const vp = page.viewportSize()!;
  expect(seam.joinMode, 'JOIN opens on BROWSE — the player with no code').toBe('browse');

  // The ORDER is the measured one: Virginia answered in ~25ms and São Paulo in
  // ~220ms, so Virginia's rooms lead. This is the row order a0-29 had to fix the
  // probe for — before it, the regions came back in the order they answered.
  const wheres = seam.browseRows.map((r) => r.where);
  expect(wheres[0], 'the nearest region leads').toMatch(/^VIRGINIA /);
  expect(wheres.some((w) => w.startsWith('SÃO PAULO')), 'the far region is on the list').toBe(true);
  expect(
    wheres.findIndex((w) => w.startsWith('SÃO PAULO')),
    'the far region sorts BELOW the near one',
  ).toBe(wheres.length - 1);
  for (const row of seam.browseRows) {
    // A real number, and never the flattering `0ms` an unmeasured region would
    // print as (region-probe rule 1).
    expect(row.where, `${row.owner} ping`).toMatch(/\d+ms$/);
    expect(row.where).not.toMatch(/\b0ms\b/);
    expect(row.meta, `${row.owner} meta`).toMatch(/PLAYER/);
    expect(row.meta).toMatch(/SEAT/);
    expect(row.action).toBe('JOIN');
    expect(row.enabled).toBe(true);
  }

  // NO CODE, anywhere on the screen or anywhere in what fed it.
  const printed = JSON.stringify(seam);
  for (const code of SECRET_CODES) expect(printed, `room code ${code} leaked`).not.toContain(code);

  // …and the age of the whole picture is stamped, in seconds, not stale.
  expect(seam.browseStamp).toMatch(/^UPDATED \d+s AGO$/);
  expect(seam.browseStale).toBe(false);

  // DRAWN: every row, and the JOIN button inside it, with real pixels in its own
  // rect and inside the phone's screen.
  const img = await shoot(page, 'browse-populated');
  for (const row of seam.browseRows) {
    for (const [what, b] of [
      ['row', row.physicalBounds],
      ['join', row.joinBounds],
    ] as const) {
      expect(b.x, `${row.owner} ${what}: x ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${row.owner} ${what}: y ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${row.owner} ${what}: right edge on screen`).toBeLessThanOrEqual(
        vp.width + 0.5,
      );
      expect(b.y + b.height, `${row.owner} ${what}: bottom edge on screen`).toBeLessThanOrEqual(
        vp.height + 0.5,
      );
      expect(
        count(img, regionOf(b, vp), isNonVacuum).matched,
        `${row.owner} ${what} drew nothing inside its own rect`,
      ).toBeGreaterThan(DRAWN_MIN_PX);
    }
    // A thumb target, not a stripe (GDD §2.4) — on the phone the developer plays.
    expect(
      Math.min(row.physicalBounds.width, row.physicalBounds.height),
      `${row.owner}: row pressable`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      Math.min(row.joinBounds.width, row.joinBounds.height),
      `${row.owner}: JOIN pressable`,
    ).toBeGreaterThanOrEqual(40);
  }
});

// ===========================================================================
// 2. Empty is a state, not a bug
// ===========================================================================

test('no open claims reads as a sentence, with ENTER ROOM CODE right there', async ({ page }) => {
  budgetTest({
    work: 'clean boot → PLAY → JOIN → an EMPTY fixtured listing → shoot the frame and read the sentence and the segment rects',
    measuredSeconds: 20,
  });

  await installFleet(page, { listing: () => EMPTY });
  await pressThroughToBrowse(page);
  await page.waitForFunction(
    () => ((window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.browseEmpty.length ?? 0) >= 2,
    undefined,
    { timeout: 30_000 },
  );
  await settleFrames(page);

  const seam = await doors(page);
  expect(seam.browseRows, 'no rows').toHaveLength(0);
  expect(seam.browseEmpty[0]).toBe('NO OPEN CLAIMS RIGHT NOW');
  // …and the line names the way out, which is a control on THIS screen.
  expect(seam.browseEmpty[1]).toContain('ENTER ROOM CODE');
  // Not an error: nothing is wrong with an empty fleet.
  expect(seam.error).toBe('');
  expect(seam.status).toBe('idle');

  const vp = page.viewportSize()!;
  const code = seam.doorControls.find((c) => c.kind === 'mode:code');
  expect(code, 'the ENTER ROOM CODE segment is reported').toBeTruthy();
  expect(
    Math.min(code!.physicalBounds.width, code!.physicalBounds.height),
    'the segment is pressable',
  ).toBeGreaterThanOrEqual(40);

  const img = await shoot(page, 'browse-empty');
  expect(
    count(img, regionOf(code!.physicalBounds, vp), isNonVacuum).matched,
    'the ENTER ROOM CODE segment drew nothing',
  ).toBeGreaterThan(DRAWN_MIN_PX);
});

// ===========================================================================
// 3. The room that filled up while the player was looking at it
// ===========================================================================

test('a row that filled up refuses with a sentence, keeps the list, and marks the row', async ({
  page,
}) => {
  budgetTest({
    work: 'clean boot → PLAY → JOIN → populated list → press a row whose seat the fixture has already given away (409) → shoot the refusal',
    measuredSeconds: 24,
  });

  // The fleet a full room actually produces: the listing advertises the seat (it
  // is up to a heartbeat stale — that is the whole staleness envelope), the join
  // is refused 409, and the NEXT listing no longer carries the room at all,
  // because the route only lists rooms it is offering.
  let attempted = false;
  await installFleet(page, {
    listing: () =>
      attempted ? { ...POPULATED, rooms: POPULATED.rooms.filter((r) => r.id !== 'h-iad-1') } : POPULATED,
    joinStatus: () => {
      attempted = true;
      return 409;
    },
  });
  await pressThroughToBrowse(page);
  await waitForRows(page, 3);

  const before = await doors(page);
  const target = before.browseRows[0]!;
  expect(target.owner, 'the nearest room leads, and is the one pressed').toBe('K7M2QP');
  await press(page, target.physicalCenter.x, target.physicalCenter.y);
  await page.waitForFunction(
    () => ((window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.error ?? '') !== '',
    undefined,
    { timeout: 30_000 },
  );
  // The refusal fires an immediate re-read, and the room is gone from it — so the
  // row reads CLOSED for one cycle, in the place it already had, before it leaves.
  await page.waitForFunction(
    () =>
      (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.browseRows.some(
        (r) => r.owner === 'K7M2QP' && r.state === 'closed',
      ) ?? false,
    undefined,
    { timeout: 30_000 },
  );
  await settleFrames(page);

  const after = await doors(page);
  // The exact words a player reads when the room fills up under them.
  expect(after.error).toBe('That claim filled up while you were looking. Pick another.');
  // Still the list — a refusal is not a dead end and never bounces the player back
  // to the doors (plan §3), and never to a modal.
  expect(after.screen).toBe('join');
  expect(after.joinMode).toBe('browse');
  expect(after.status, 'nothing is left connecting').not.toBe('connecting');

  // The row that filled: still on screen, in its own place, saying what happened
  // and refusing to be pressed again.
  const closed = after.browseRows.find((r) => r.owner === 'K7M2QP')!;
  expect(after.browseRows.indexOf(closed), 'CLOSED in the place it already had').toBe(0);
  expect(closed.action).toBe('CLOSED');
  expect(closed.enabled).toBe(false);
  // …and the rooms that are still open are still open.
  expect(after.browseRows.filter((r) => r.enabled).length).toBeGreaterThan(0);

  await shoot(page, 'browse-refused');
});

// ===========================================================================
// 4. …and the code path is one tap away, unchanged
// ===========================================================================

test('ENTER ROOM CODE is one tap away and puts the whole keypad up', async ({ page }) => {
  budgetTest({
    work: 'clean boot → PLAY → JOIN → press the ENTER ROOM CODE segment → shoot the keypad and check all 32 keys are pressable',
    measuredSeconds: 20,
  });

  await installFleet(page, { listing: () => POPULATED });
  await pressThroughToBrowse(page);
  await waitForRows(page, 3);

  const seam = await doors(page);
  const code = seam.doorControls.find((c) => c.kind === 'mode:code')!;
  await press(page, code.physicalCenter.x, code.physicalCenter.y);
  await page.waitForFunction(
    () => (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.joinMode === 'code',
    undefined,
    { timeout: 30_000 },
  );
  await settleFrames(page);

  const typing = await doors(page);
  const keys = typing.doorControls.filter((c) => c.kind.startsWith('key:'));
  expect(keys, 'the whole ambiguity-free alphabet').toHaveLength(32);
  for (const key of keys) {
    expect(key.physicalBounds.x, `${key.kind} on screen`).toBeGreaterThanOrEqual(0);
    expect(Math.min(key.physicalBounds.width, key.physicalBounds.height)).toBeGreaterThan(0);
  }
  // The keypad's own controls are back, and the list's are not.
  expect(typing.doorControls.some((c) => c.kind === 'submit')).toBe(true);
  expect(typing.doorControls.some((c) => c.kind.startsWith('row:'))).toBe(false);
  // …and BROWSE is one tap back, from the same switch.
  expect(typing.doorControls.some((c) => c.kind === 'mode:browse')).toBe(true);

  await shoot(page, 'browse-code-mode');
});
