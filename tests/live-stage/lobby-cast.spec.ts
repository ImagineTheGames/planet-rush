/**
 * tests/live-stage/lobby-cast.spec.ts — **the cast you picked is the cast you
 * fight.** OWNER: Bot Engineer (a0-06; GDD §2.1 amended 2026-08-07, §2.9).
 *
 * ---------------------------------------------------------------------------
 * THE CLASS OF TEST THIS IS, AND WHY THE UNIT SUITE COULD NOT BE IT
 * ---------------------------------------------------------------------------
 * Every piece of the old feature was correct and tested. `fillEmptySlots` seated
 * the cast it was handed; `createBots` built the bots it was handed; the lobby
 * previewed a character per seat. What nothing tested is that the lobby's answer
 * and the match's cast are **the same answer** — because nothing connected them:
 * `bootOfflineMatch` called `fillEmptySlots` with no cast and `MatchBootConfig`
 * had no field to carry one. The setting was inert and every gate was green.
 *
 * That is LESSONS §1 — "the selection never arrived" — and it is the one class of
 * failure only a booted client can catch. So this spec drives the REAL preview
 * bundle through the REAL lobby with REAL taps: it cycles named characters onto
 * named seats by pressing the row bodies, reads back what the roster says, presses
 * RUSH!, and then asserts through the debug seam that the match the client built
 * contains **exactly** those characters, in **exactly** those slots.
 *
 * Two pictures of the same cast, one before RUSH! and one after. Them agreeing is
 * the whole fix.
 */
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface SeatControl {
  readonly index: number;
  readonly physicalCenter: PhysicalPoint;
}
interface HelpControl {
  readonly index: number;
  readonly logical: Rect;
  readonly physicalCenter: PhysicalPoint;
}
interface MainMenuSeam {
  controls: readonly ControlReport[];
  play(): void;
}
/** The doors behind PLAY — PLAY SOLO / CREATE ROOM / JOIN ROOM (the unified play
 *  flow: one PLAY button, one doors screen behind it, one lobby behind every
 *  door). The solo door is the one that needs no server. */
interface OnlineSeam {
  visible: boolean;
  doorControls: readonly ControlReport[];
}
interface LobbySeam {
  visible: boolean;
  isHost: boolean;
  hintTitle: string | null;
  seatCharacters: readonly (string | null)[];
  seatControls: readonly SeatControl[];
  seatHelpControls: readonly HelpControl[];
  worldCast: readonly (string | null)[] | null;
  rush(): void;
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
}
declare const window: Window & StageWindow;

/** The whole roster, in the order a row's tap cycles it (`CHARACTER_CYCLE`). */
const ROSTER = ['rusty', 'bolt', 'foreman', 'patch', 'sable', 'vulture', 'warden'] as const;

async function canvasOrigin(page: Page): Promise<PhysicalPoint> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  return { x: box.x, y: box.y };
}

/** Boot clean and walk the real front door: PLAY → the doors → PLAY SOLO → the
 *  lobby, every step a real press at the point the client reported drawing it at
 *  (through the landscape-lock remap). */
async function openLobby(page: Page, press: (x: number, y: number) => Promise<void>): Promise<PhysicalPoint> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20_000 });

  const origin = await canvasOrigin(page);
  const play = await page.evaluate(() => {
    const c = window.__mainMenu?.controls.find((x) => x.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!play) throw new Error('no PLAY control');
  await press(origin.x + play.x, origin.y + play.y);

  await page.waitForFunction(() => (window.__onlineMenu?.doorControls.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });
  const solo = await page.evaluate(() => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === 'solo');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!solo) throw new Error('the doors reported no PLAY SOLO');
  await press(origin.x + solo.x, origin.y + solo.y);

  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => (window.__lobby?.seatControls.length ?? 0) > 0, undefined, { timeout: 10_000 });
  return origin;
}

/**
 * Tap the row body at `slot` until it reads `want` — the way a player does it,
 * at the physical point the client itself reported drawing that row's body at
 * (through the landscape-lock remap). Bounded by the roster length so a control
 * that stopped cycling fails loudly instead of spinning.
 */
async function cycleTo(
  page: Page,
  origin: PhysicalPoint,
  press: (x: number, y: number) => Promise<void>,
  slot: number,
  want: string,
): Promise<void> {
  for (let i = 0; i <= ROSTER.length; i++) {
    const at = await page.evaluate((s) => window.__lobby!.seatCharacters[s] ?? null, slot);
    if (at === want) return;
    const point = await page.evaluate(
      (s) => window.__lobby!.seatControls.find((c) => c.index === s)?.physicalCenter ?? null,
      slot,
    );
    if (!point) throw new Error(`no row control for slot ${slot}`);
    await press(origin.x + point.x, origin.y + point.y);
    await page.waitForFunction(
      ([s, before]) => window.__lobby!.seatCharacters[s as number] !== before,
      [slot, at] as const,
      { timeout: 10_000 },
    );
  }
  throw new Error(`slot ${slot} never reached ${want} in one lap of the roster`);
}

test('the cast the lobby picked is the cast the match seats', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const origin = await openLobby(page, (x, y) => page.mouse.click(x, y));
  expect(await page.evaluate(() => window.__lobby!.isHost), 'the solo lobby is yours to author').toBe(true);

  // The developer's own case, and then some: every enemy HARD — which needs a
  // repeat, because three Hard characters exist and there are more Hard seats
  // than that. Slot 0 is you.
  const WANT: readonly (readonly [number, string])[] = [
    [1, 'warden'],
    [2, 'warden'],
    [3, 'sable'],
    [4, 'vulture'],
    [5, 'warden'],
    [6, 'sable'],
    [7, 'vulture'],
  ];
  for (const [slot, want] of WANT) await cycleTo(page, origin, (x, y) => page.mouse.click(x, y), slot, want);

  // Picture one: the roster, as the player reads it before pressing RUSH!.
  const roster = await page.evaluate(() => window.__lobby!.seatCharacters.map((c) => c));
  expect(roster[0], 'your own seat holds no character').toBeNull();
  for (const [slot, want] of WANT) expect(roster[slot], `lobby row ${slot}`).toBe(want);
  expect(roster.filter((c) => c === 'warden'), 'a repeated character survives the roster').toHaveLength(3);

  await page.screenshot({ path: 'tests/live-stage/lobby-cast-lobby-evidence.png' });

  // …and RUSH!, through the seam's own drive method (the taps are the thing under
  // test here; starting the match is not).
  await page.evaluate(() => window.__lobby!.rush());
  await page.waitForFunction(() => window.__lobby?.worldCast != null, undefined, { timeout: 30_000 });

  // Picture two: the cast the BOOTED MATCH actually seated, read off the bots the
  // client constructed — not off the lobby that asked for them. This is the
  // assertion the old model had no way to make, and the one it would have failed
  // every single time.
  const built = await page.evaluate(() => window.__lobby!.worldCast!.map((c) => c));
  expect(built, 'the match seats exactly the cast the lobby showed').toEqual(roster);
  for (const [slot, want] of WANT) expect(built[slot], `match slot ${slot}`).toBe(want);
  expect(built[0], 'your slot is yours, not a bot').toBeNull();

  await page.screenshot({ path: 'tests/live-stage/lobby-cast-match-evidence.png' });

  // The match frame above is a cockpit view: it proves the match booted from this
  // lobby, and it cannot show the other seven names, because a rival's nameplate
  // is drawn when it is on screen and at match start every ship is at its own
  // station. The names themselves are the readback, so they are written out beside
  // the frame rather than left only in an assertion nobody can look at.
  await writeFile(
    'tests/live-stage/lobby-cast-readback.txt',
    [
      'a0-06 — the cast the lobby picked vs the cast the match seated',
      '(read off window.__lobby: seatCharacters before RUSH!, worldCast after)',
      '',
      ...roster.map(
        (c, i) => `  slot ${i}  lobby: ${String(c).padEnd(8)}  match: ${String(built[i])}`,
      ),
      '',
      `identical: ${JSON.stringify(built) === JSON.stringify(roster)}`,
      '',
    ].join('\n'),
    'utf8',
  );

  expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
});

test('PC: tapping a row’s ? opens that character’s codex dossier, and tapping away dismisses it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const origin = await openLobby(page, (x, y) => page.mouse.click(x, y));
  expect(await page.evaluate(() => window.__lobby!.hintTitle), 'nothing is up to begin with').toBeNull();

  // Put a KNOWN character in a known seat, so the dossier that appears can be
  // checked against the character rather than merely against "something appeared".
  await cycleTo(page, origin, (x, y) => page.mouse.click(x, y), 2, 'vulture');

  const help = await page.evaluate(
    () => window.__lobby!.seatHelpControls.find((c) => c.index === 2) ?? null,
  );
  expect(help, 'row 2 draws a ? control at all').not.toBeNull();
  expect(help!.logical.width, 'the ? is a control, not a smudge').toBeGreaterThan(0);

  // A plain CLICK — not a hover, not a hold. That is the whole point: a
  // hover-only tooltip is a desktop-only feature (GDD §2.4 parity).
  await page.mouse.click(origin.x + help!.physicalCenter.x, origin.y + help!.physicalCenter.y);
  await page.waitForFunction(() => (window.__lobby?.hintTitle?.length ?? 0) > 0, undefined, { timeout: 10_000 });
  const title = await page.evaluate(() => window.__lobby!.hintTitle);
  expect(title?.toLowerCase(), 'the dossier is VULTURE’s, not just any entry').toContain('vulture');

  await page.screenshot({ path: 'tests/live-stage/lobby-cast-codex-evidence.png' });

  // Tapping AWAY dismisses it — the ratified dismissal grammar, and the half a
  // hover has for free and a tap does not.
  await page.mouse.click(origin.x + 4, origin.y + 4);
  await page.waitForFunction(() => window.__lobby?.hintTitle === null, undefined, { timeout: 10_000 });

  expect(await page.evaluate(() => window.__lobby!.visible), 'the dossier never gated the lobby').toBe(true);
  expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
});

// The form factor the game is landscape-locked for. The `?` has to work by TAP
// here or the developer's own device is the one device the control they asked for
// does not exist on — and the row is at its tightest, so this is also where the
// geometry's order-of-surrender is proved rather than computed.
test.describe('phone — landscape, 390px short edge', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    viewport: { width: 844, height: 390 },
  });

  test('touch: the ? is a TAP, and the row still carries a cast the match honours', async ({ page }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const tap = (x: number, y: number): Promise<void> => page.touchscreen.tap(x, y);
    const origin = await openLobby(page, tap);

    // The row is at its tightest here (u7-03 rewrote its geometry for exactly this
    // screen) and it still has to carry the control the developer asked for.
    const help = await page.evaluate(() => window.__lobby!.seatHelpControls.find((c) => c.index === 1) ?? null);
    expect(help, 'the ? survives the landscape phone row').not.toBeNull();

    await cycleTo(page, origin, tap, 1, 'warden');
    await tap(origin.x + help!.physicalCenter.x, origin.y + help!.physicalCenter.y);
    await page.waitForFunction(() => (window.__lobby?.hintTitle?.length ?? 0) > 0, undefined, { timeout: 10_000 });
    const title = await page.evaluate(() => window.__lobby!.hintTitle);
    expect(title?.toLowerCase(), 'the dossier is WARDEN’s').toContain('warden');

    await page.screenshot({ path: 'tests/live-stage/lobby-cast-phone-evidence.png' });

    // Tap away dismisses — no hover exists on this device, so this is the ONLY
    // way out and it has to work.
    await tap(origin.x + 6, origin.y + 6);
    await page.waitForFunction(() => window.__lobby?.hintTitle === null, undefined, { timeout: 10_000 });

    // …and the pick still reaches the match from a phone.
    await page.evaluate(() => window.__lobby!.rush());
    await page.waitForFunction(() => window.__lobby?.worldCast != null, undefined, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__lobby!.worldCast![1])).toBe('warden');

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
