/**
 * tests/live-stage/alarm-ownership-online.spec.ts — the alarm belongs to the seat
 * the SERVER gave you, proven on a real online join. OWNER: Sound Agent (s9-01;
 * GDD §2.2).
 *
 * THE BUG THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * The developer, 2026-08-07: *"and [the alarm] should only play for your station
 * not others"*. It did not. `src/main.ts` constructed the {@link AudioEngine}
 * before the menu — it has to, so the audio unlock is armed before the first
 * gesture — and handed it `LOCAL_PLAYER` as a constructor argument. A joiner's
 * real slot is not known until the server welcomes them, two hundred lines later.
 * The `let` was reassigned there; the engine had captured the value. So every
 * online client believed it was slot 0: on slot 3, damage to *slot 0's* station
 * rang your alarm and damage to your own was silent.
 *
 * WHY A UNIT TEST COULD NOT CATCH IT, AND WHY SLOT 0 CANNOT EITHER
 * ---------------------------------------------------------------------------
 * `src/art/audio/audio.test.ts` covers the ownership predicate thoroughly and
 * passed through this entire bug, because the defect was in *who the engine was
 * told it was*, not in what it does with that. There is no assertion about a
 * state machine that finds a wire nobody connected — only booting the real
 * bundle, joining a real room, and reading the far end of the wire can.
 *
 * And it has to be a NON-ZERO slot. With the local id wrong-but-zero, "my
 * station" and "slot 0's station" are the same set, so a host — always seated
 * first, always slot 0 — reads correct on a completely dead wire. This spec
 * therefore asserts on the GUEST, and fails outright if the guest was seated at
 * slot 0, because a green run on slot 0 would prove nothing at all.
 *
 * WHAT IT DRIVES
 * ---------------------------------------------------------------------------
 * The ratified play flow, with real clicks: PLAY → CREATE ROOM on the host,
 * PLAY → JOIN ROOM → the code typed on the keypad on the guest, host RUSH!, both
 * clients in the match. Then it reads `window.__alarmStage` — pure read-back,
 * installed on both boots (`?debug=1` skips the menu straight into an OFFLINE
 * match, so a gated seam could never see an online one) — and compares the number
 * the audio engine is listening as against the seat the room actually welcomed
 * that client into.
 *
 * It needs three real processes, and stands them up itself (`./alarm-fleet.ts`):
 * a real allocator, a real match server, and a client bundle with the allocator
 * URL baked in. Slow, deliberately — this is the class of test that catches dead
 * wiring, and there was no cheaper way to reach an online match from this suite.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startAlarmFleet, type AlarmFleet } from './alarm-fleet';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}

/** The clean-boot menu seam (`installMainMenuSeam` in `src/main.ts`). */
interface MainMenuSeam {
  visible: boolean;
  matchStarted: boolean;
  controls: readonly ControlReport[];
}

/** The doors seam (`installOnlineSeam`): the three doors, then the keypad. */
interface OnlineSeam {
  visible: boolean;
  screen: 'home' | 'join';
  status: 'idle' | 'connecting' | 'error';
  error: string;
  code: string;
  doorControls: readonly ControlReport[];
}

/** The ONE lobby seam (`installLobbySeam`), online flavour. `you` is the seat the
 *  SERVER welcomed this client into — the number the audio engine has to agree
 *  with, and the whole assertion of this file. */
interface LobbySeam {
  visible: boolean;
  online: boolean;
  room: string;
  you: number;
  isHost: boolean;
  humanCount: number;
  rushControl: { physicalCenter: PhysicalPoint };
}

/** The s9-01 seam (`installAlarmStage`). Read-only, on both boots. */
interface AlarmSeam {
  read(): {
    /** The slot the AUDIO ENGINE is listening as. The number that was wrong. */
    local: number;
    /** The slot the rest of `main.ts` is flying. */
    localPlayer: number;
    /** Whose home damage rings this client's alarm — you in FFA. */
    allies: readonly number[];
    active: boolean;
    engagements: number;
    sounds: number;
  };
}

interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
  __alarmStage?: AlarmSeam;
}
declare const window: Window & StageWindow;

/** One booted client: its page, how it presses a point the client says it drew,
 *  and every error it threw along the way. */
interface Client {
  readonly page: Page;
  readonly press: (p: PhysicalPoint) => Promise<void>;
  readonly errors: string[];
}

const PC = { width: 1280, height: 800 } as const;

let fleet: AlarmFleet | null = null;

test.beforeAll(async () => {
  // Three vite builds and three listeners. Generous, and bounded — a hung fleet
  // is a failed run, never a hung suite (GDD §3, the QA harness's own rule).
  test.setTimeout(600_000);
  fleet = await startAlarmFleet();
});

test.afterAll(async () => {
  await fleet?.stop();
  fleet = null;
});

/** Boot a client in its own context — its own storage, so the two never share a
 *  persisted hull, name or arena and each is a first-time player. */
async function bootClient(
  browser: Browser,
  baseURL: string,
): Promise<{ client: Client; context: BrowserContext }> {
  const context = await browser.newContext({
    viewport: { width: PC.width, height: PC.height },
    deviceScaleFactor: 1,
    baseURL,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, {
    timeout: 60_000,
  });
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const press = async (p: PhysicalPoint): Promise<void> => {
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  return { client: { page, press, errors }, context };
}

/** Press a control the client says it drew, or fail naming it. */
async function pressDoor(client: Client, kind: string): Promise<void> {
  const point = await client.page.evaluate((k) => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!point) throw new Error(`the entry screen reported no '${kind}' control`);
  await client.press(point);
}

/** PLAY, for real, from a fresh menu → the doors. */
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

const readAlarm = (page: Page) => page.evaluate(() => window.__alarmStage!.read());

test('the audio engine listens as the seat the SERVER gave this client — on a non-zero slot (s9-01)', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const baseURL = fleet!.baseURL;
  const { client: host, context: hostContext } = await bootClient(browser, baseURL);
  const { client: guest, context: guestContext } = await bootClient(browser, baseURL);

  try {
    // --- 1. The host: PLAY → CREATE ROOM → the lobby, with a real code. ------
    await pressPlay(host);
    await pressDoor(host, 'create');
    await host.page.waitForFunction(() => window.__lobby?.visible === true, undefined, {
      timeout: 90_000,
    });
    const room = await host.page.evaluate(() => ({
      code: window.__lobby!.room,
      you: window.__lobby!.you,
      online: window.__lobby!.online,
    }));
    // A refusal here means the bundle being served has no allocator baked into it
    // — i.e. something else is on the preview port. `./alarm-fleet.ts` pins it
    // strictly for exactly this reason; the message is the diagnosis.
    expect(room.online, 'CREATE ROOM reached a real allocator and opened the online lobby').toBe(
      true,
    );
    expect(room.code, 'the allocator minted a four-character code').toMatch(/^[A-Z2-9]{4}$/);

    // --- 2. The guest: PLAY → JOIN ROOM → the code on the keypad → in. -------
    await pressPlay(guest);
    await pressDoor(guest, 'join');
    await guest.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, {
      timeout: 30_000,
    });
    for (const ch of room.code) await pressDoor(guest, `key:${ch}`);
    await pressDoor(guest, 'submit');
    await guest.page.waitForFunction(() => window.__lobby?.visible === true, undefined, {
      timeout: 90_000,
    });
    const seat = await guest.page.evaluate(() => window.__lobby!.you);

    // --- 3. THE PRECONDITION. A guest seated at 0 would make this whole spec
    //        vacuous: with the wire dead, `local` defaults to 0 and would match.
    expect(
      seat,
      'the joiner must be seated at a NON-ZERO slot — on slot 0 a dead wire reads identical to a live one, which is exactly how s9-01 survived',
    ).toBeGreaterThan(0);
    expect(seat, 'and not the seat the host is in').not.toBe(room.you);

    // --- 4. The host starts. Authority ends the lobby on both clients. -------
    await host.page.waitForFunction(() => window.__lobby?.humanCount === 2, undefined, {
      timeout: 60_000,
    });
    const rush = await host.page.evaluate(() => window.__lobby!.rushControl.physicalCenter);
    await host.press({ x: rush.x, y: rush.y });
    for (const client of [host, guest]) {
      await client.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
        timeout: 90_000,
      });
      // The seam installs with the match loop (like `__pauseStage`), on this CLEAN
      // boot — not behind ?debug=1, which drops straight into an OFFLINE match and
      // could never see an online one. A timeout here means it was gated and the
      // claim below is unprovable in a real browser.
      await client.page.waitForFunction(
        () => typeof window.__alarmStage?.read === 'function',
        undefined,
        { timeout: 30_000 },
      );
    }
    // One rendered frame, so the match loop has run and derived the alarm's side
    // from live world truth at least once (`setAlarmScope`, `main.ts`).
    await guest.page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    // --- 5. THE ASSERTION. -----------------------------------------------------
    const guestAlarm = await readAlarm(guest.page);
    const hostAlarm = await readAlarm(host.page);
    // eslint-disable-next-line no-console -- captioned readout for the PR evidence.
    console.log(
      '[alarm-ownership] host seat',
      room.you,
      JSON.stringify(hostAlarm),
      '| guest seat',
      seat,
      JSON.stringify(guestAlarm),
    );

    expect(
      guestAlarm.local,
      'the audio engine is listening as the seat the server welcomed this client into',
    ).toBe(seat);
    expect(
      guestAlarm.local,
      'and specifically NOT slot 0 — that number was the bug, verbatim',
    ).not.toBe(0);
    expect(guestAlarm.localPlayer, "and it agrees with the ship main.ts is flying").toBe(seat);

    // The alarm's roster is the local side and nothing else. In FFA (this room's
    // default) that is one slot — the guest's own — so the host's home under fire
    // is not this player's klaxon, which is the developer's sentence exactly.
    expect(guestAlarm.allies, "only this player's own home rings their alarm (FFA)").toEqual([seat]);
    expect(guestAlarm.allies, "and the host's home is not in it").not.toContain(room.you);

    // The host is the control: it reads its own seat too. Two clients, two
    // different numbers, from one bundle — which a captured constant cannot do.
    expect(hostAlarm.local, 'the host listens as its own seat').toBe(room.you);
    expect(hostAlarm.allies, "and the guest's home is not the host's klaxon").not.toContain(seat);

    // Nothing has been shot yet, so nothing has rung: the baseline the one-shot
    // rule is counted from (`AudioEngine.alarmSounds`, one sting per engagement).
    expect(guestAlarm.engagements, 'a fresh match has raised no engagement').toBe(0);
    expect(guestAlarm.sounds, 'and sounded no alarm').toBe(0);

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
