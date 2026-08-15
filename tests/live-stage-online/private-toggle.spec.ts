/**
 * tests/live-stage-online/private-toggle.spec.ts — **PUBLIC and PRIVATE, walked
 * by two real clients against a real fleet.** OWNER: Netcode Engineer (a0-35;
 * `docs/lobby-browser-plan.md` §2 / D1, ratified *"public by default with a
 * PRIVATE toggle"*).
 *
 * THE REPORT
 * ---------------------------------------------------------------------------
 * The developer, hosting on the live build: *"when i host, i hav eno way to make
 * a match private i dont see a button to do it"*. Every part of that ruling
 * except the button had shipped — the wire field, the room flag, the heartbeat,
 * and an allocator that leaves a private room out of the payload — so the one
 * thing no test in this repo could have caught is exactly the thing that was
 * wrong: **there was nothing on screen to press.**
 *
 * That is why this file exists beside `tests/net/lobby-list-route.test.ts`, which
 * already drives the same seam over a real socket and would have stayed green
 * forever. A model test proves a function; this proves a **control**.
 *
 * THE WALK, WHICH IS THE BRIEF'S EVIDENCE
 * ---------------------------------------------------------------------------
 *   the host (a PHONE, held in landscape — the developer hosts from one)
 *     PLAY → CREATE ROOM → the lobby, showing `CLAIM · PUBLIC`
 *   the guest (a PC)
 *     PLAY → JOIN → BROWSE → the room is a ROW → press its JOIN → in the room
 *   the host
 *     presses CLAIM → the chip reads `CLAIM · PRIVATE`
 *   the allocator
 *     `GET /rooms` no longer carries it — **absent from the payload**, not
 *     greyed and not filtered on the far side
 *   the guest
 *     BROWSE is empty and says so → CODE → types the four characters → **in**
 *
 * The last step is the half that must NOT change: *"those can only be joined by
 * using the join code."* Unlisted is not unreachable.
 *
 * WHAT WOULD FAIL HERE THAT PASSES EVERYWHERE ELSE
 * ---------------------------------------------------------------------------
 *  - a CLAIM chip that is laid out but never drawn, or drawn off the phone's
 *    short axis (the seam reports the rect it drew, and the screenshot is the
 *    human check beside it);
 *  - a toggle whose value never leaves the client — the lobby saying PRIVATE
 *    over a heartbeat that still says listed;
 *  - a private room hidden only by the client, still in the JSON for anyone who
 *    reads it (this asks the allocator directly, not the browser);
 *  - a private room whose CODE stopped working, which would trade one missing
 *    control for a broken one.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ALLOCATOR_URL } from './online-fleet';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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
  joinMode: 'browse' | 'code';
  code: string;
  doorControls: readonly ControlReport[];
  browseRows: readonly {
    owner: string;
    meta: string;
    where: string;
    action: string;
    enabled: boolean;
    physicalCenter: PhysicalPoint;
    joinBounds: Box;
  }[];
  browseStamp: string;
  browseEmpty: readonly string[];
}

interface LobbySeam {
  visible: boolean;
  online: boolean;
  room: string;
  isHost: boolean;
  humanCount: number;
  /** `PUBLIC` / `PRIVATE`, or null where the chip is not on the strip (a0-35). */
  claim: string | null;
  claimControl: { logical: Box; physicalCenter: PhysicalPoint };
  leave(): void;
}

interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
}
declare const window: Window & StageWindow;

interface Client {
  readonly page: Page;
  readonly press: (p: PhysicalPoint) => Promise<void>;
  readonly errors: string[];
}

/** The developer's own device, and the one the report came from: a phone. Its
 *  viewport is portrait and the app's landscape lock rotates the whole scene, so
 *  what the screenshot shows — and what the CLAIM chip has to fit on — is a
 *  390px-short-axis LANDSCAPE screen. */
const IPHONE = { width: 390, height: 844, dpr: 3, touch: true } as const;
const PC = { width: 1280, height: 800, dpr: 1, touch: false } as const;
type Profile = typeof IPHONE | typeof PC;

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

/** Press a control the client says it DREW, or fail naming it. */
async function pressDoor(client: Client, kind: string): Promise<void> {
  const point = await client.page.evaluate((k) => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!point) throw new Error(`the entry screen reported no '${kind}' control`);
  await client.press(point);
}

/** The allocator's own list — asked of the allocator, never of a browser. This is
 *  the payload the plan says a private room must be **absent from**, and reading
 *  it here is the only way to tell "absent" from "hidden by the client". */
async function listedRooms(): Promise<{ id: string; owner: string; players: number }[]> {
  const res = await fetch(`${ALLOCATOR_URL}/rooms`);
  if (!res.ok) throw new Error(`GET /rooms answered ${res.status}`);
  const body = (await res.json()) as { rooms?: { id: string; owner: string; players: number }[] };
  return body.rooms ?? [];
}

/** Poll the list until it holds `want` rooms, or give up — the fleet only learns
 *  a room's visibility on the Machine's next heartbeat (5 s), so this is a wait
 *  and not a single read (`docs/lobby-browser-plan.md` §1: the envelope). */
async function waitForListSize(want: number, timeoutMs = 40_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    last = (await listedRooms()).length;
    if (last === want) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

/** Does the allocator still answer for this CODE? The code path, asked the way
 *  the client asks it — 200 while a Machine hosts it, 404 once nothing does. */
async function codeStillJoins(code: string): Promise<boolean> {
  const res = await fetch(`${ALLOCATOR_URL}/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return res.status === 200;
}

test('a host can make the room PRIVATE: the list drops it, the code still opens it', async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const { client: host, context: hostContext } = await bootClient(browser, IPHONE, baseURL!);
  const { client: guest, context: guestContext } = await bootClient(browser, PC, baseURL!);
  try {
    // --- 1. The host opens a room, from a phone. -----------------------------
    await pressPlay(host);
    await pressDoor(host, 'create');
    await host.page.waitForFunction(() => window.__lobby?.visible === true, undefined, {
      timeout: 60_000,
    });
    const opened = await host.page.evaluate(() => {
      const l = window.__lobby!;
      return { room: l.room, isHost: l.isHost, claim: l.claim, chip: { ...l.claimControl.logical } };
    });
    const code = opened.room;
    expect(opened.isHost, 'the creator holds the host controls').toBe(true);
    expect(code, 'the allocator minted a code').toMatch(/^[A-Z2-9]{4}$/);

    // **The button the developer could not find.** Drawn, with a word on it, and
    // on the ratified default: PUBLIC (a0-26 D1).
    expect(opened.claim, 'the CLAIM chip is drawn, and says PUBLIC').toBe('PUBLIC');
    expect(opened.chip.width, 'the chip has width on a 390px phone').toBeGreaterThan(0);
    expect(opened.chip.height, '…and height').toBeGreaterThan(0);
    await host.page.screenshot({ path: 'tests/live-stage-online/private-toggle-host-public-evidence.png' });

    // --- 2. The guest finds it in the BROWSE list and joins by its JOIN button. --
    await pressPlay(guest);
    await pressDoor(guest, 'join');
    await guest.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, {
      timeout: 15_000,
    });
    await pressDoor(guest, 'mode:browse');
    await guest.page.waitForFunction(() => window.__onlineMenu?.joinMode === 'browse', undefined, {
      timeout: 15_000,
    });
    // Up to one heartbeat plus one poll before a fresh room is a row — which is
    // correct, because that is also how long it takes to be real (plan §1).
    await guest.page.waitForFunction(() => (window.__onlineMenu?.browseRows.length ?? 0) > 0, undefined, {
      timeout: 60_000,
    });
    const listed = await guest.page.evaluate(() => ({
      rows: window.__onlineMenu!.browseRows.map((r) => ({
        owner: r.owner,
        meta: r.meta,
        where: r.where,
        action: r.action,
        enabled: r.enabled,
        join: { ...r.joinBounds },
      })),
      stamp: window.__onlineMenu!.browseStamp,
    }));
    expect(listed.rows, 'the host’s public room is on the list').toHaveLength(1);
    const row = listed.rows[0]!;
    // The row shows an owner tag and never the code — a browse screen is not a
    // code-harvesting screen (plan Trap 7 / n10-01's two derived tokens).
    expect(row.owner.length, 'the row names an owner').toBeGreaterThan(0);
    expect(`${row.owner} ${row.meta} ${row.where} ${row.action}`, 'and never the code').not.toContain(
      code,
    );
    expect(row.enabled, 'the row is joinable').toBe(true);
    expect(listed.stamp, 'and the card stamps its own age').not.toBe('');
    await guest.page.screenshot({ path: 'tests/live-stage-online/private-toggle-guest-public-list-evidence.png' });

    await guest.press({ x: row.join.x + row.join.width / 2, y: row.join.y + row.join.height / 2 });
    await guest.page.waitForFunction(() => window.__lobby?.visible === true, undefined, {
      timeout: 60_000,
    });
    const joined = await guest.page.evaluate(() => {
      const l = window.__lobby!;
      return { room: l.room, isHost: l.isHost, claim: l.claim };
    });
    expect(joined.room, 'the JOIN button put the guest in the room it named — no code typed').toBe(code);
    expect(joined.isHost, 'a joiner is not the host').toBe(false);
    // A guest gets no CLAIM chip: the room never tells them whether it is listed,
    // and a chip that could only show their own default would be inventing a fact.
    expect(joined.claim, 'no CLAIM chip on a guest’s roster').toBeNull();
    await host.page.waitForFunction(() => window.__lobby?.humanCount === 2, undefined, {
      timeout: 30_000,
    });

    // The guest steps back out to the doors, so the second half of the walk is a
    // browse and not a room they are already sitting in.
    await guest.page.evaluate(() => window.__lobby!.leave());
    // BACK out of a room lands on the MAIN MENU, not on the doors (u2 menu-back),
    // so the second walk starts where a returning player's does: at PLAY.
    await guest.page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, {
      timeout: 30_000,
    });

    // --- 3. The host presses CLAIM. A real press, on the drawn chip. ---------
    const chip = await host.page.evaluate(() => window.__lobby!.claimControl.physicalCenter);
    await host.press({ x: chip.x, y: chip.y });
    await host.page.waitForFunction(() => window.__lobby?.claim === 'PRIVATE', undefined, {
      timeout: 15_000,
    });
    await host.page.screenshot({ path: 'tests/live-stage-online/private-toggle-host-private-evidence.png' });

    // --- 4. The ALLOCATOR drops it from the payload. -------------------------
    // Asked of the allocator itself: absent, not greyed, not filtered client-side.
    expect(await waitForListSize(0), 'GET /rooms no longer carries the room').toBe(0);
    // …and the code is untouched: unlisted is not unreachable.
    expect(await codeStillJoins(code), 'the code still resolves to the room').toBe(true);

    // --- 5. The guest cannot find it, and can still walk in with the code. ---
    await pressPlay(guest);
    await pressDoor(guest, 'join');
    await guest.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, {
      timeout: 15_000,
    });
    await pressDoor(guest, 'mode:browse');
    await guest.page.waitForFunction(
      () => window.__onlineMenu?.joinMode === 'browse' && window.__onlineMenu.browseRows.length === 0,
      undefined,
      { timeout: 60_000 },
    );
    const empty = await guest.page.evaluate(() => [...window.__onlineMenu!.browseEmpty]);
    // An empty list is a sentence, not a void (plan §3 rule 4) — and it names the
    // doors that still work, which is the whole of what a private room leaves.
    expect(empty.join(' ').length, 'the empty list says something').toBeGreaterThan(0);
    await guest.page.screenshot({ path: 'tests/live-stage-online/private-toggle-guest-private-list-evidence.png' });

    await pressDoor(guest, 'mode:code');
    await guest.page.waitForFunction(() => window.__onlineMenu?.joinMode === 'code', undefined, {
      timeout: 15_000,
    });
    for (const ch of code) await pressDoor(guest, `key:${ch}`);
    await guest.page.waitForFunction((want) => window.__onlineMenu?.code === want, code, {
      timeout: 15_000,
    });
    await pressDoor(guest, 'submit');
    await guest.page.waitForFunction(() => window.__lobby?.visible === true, undefined, {
      timeout: 60_000,
    });
    expect(
      await guest.page.evaluate(() => window.__lobby!.room),
      'the private room still opens to whoever has the code',
    ).toBe(code);
    await guest.page.screenshot({ path: 'tests/live-stage-online/private-toggle-guest-code-join-evidence.png' });

    for (const [who, client] of [
      ['host', host],
      ['guest', guest],
    ] as const) {
      expect(client.errors, `no page errors on the ${who}: ${client.errors.join('\n')}`).toEqual([]);
    }
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
