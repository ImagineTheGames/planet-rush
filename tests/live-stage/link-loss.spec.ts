/**
 * tests/live-stage/link-loss.spec.ts — the CONNECTION LOST overlay, in the shipped
 * client, over a socket that really dies. OWNER: Netcode Engineer (n6-01).
 *
 * *"Left browser, came back, disconnected — bots frozen but I could still move. I
 * should get kicked out and presented reconnect / abandon buttons, and verbosity of
 * what happened."*
 *
 * Everything that report asked for was built: the watchdog (`src/net/link-loss`),
 * the overlay (`src/net/link-loss-view`), the freeze in `session.sendInput`,
 * RECONNECT and ABANDON on the session, and a test over the real stack
 * (`tests/net/disconnect-honesty.test.ts`) that drives all of it. All of it was
 * green. **And `installLinkLossView` was called from nowhere** — it appeared exactly
 * once in `src/`, at its own definition — so none of it ever ran in the game. The
 * developer's zombie match was still a zombie match, and every existing test still
 * passed, because every existing test held both ends of the wire itself (a1-09).
 *
 * That is the hole this file exists to close, and it is why it cannot be a unit
 * test. It boots the **production bundle** (`vite build` → `vite preview`), puts two
 * real browsers into one real room on a real fleet, starts a real match, and then
 * kills the link the only way that reproduces the report:
 *
 *   **the edge stops delivering and nothing hangs up** — `?gag=1`
 *   (`tests/net/fly-edge.ts`). Sockets open at both ends, `readyState` still `OPEN`,
 *   no `onclose`, no error, no frame. The lie the client used to believe.
 *
 * Then it reads the DOM the shipped client drew and clicks the shipped buttons.
 * Nothing here is a seam: `#pr-link-loss` is the overlay's own element id and the
 * clicks are real clicks on real buttons. If the install is ever dropped again, this
 * goes red on the same commit.
 *
 * Skipped, not failed, without a fleet: the default live-stage config boots an
 * offline bundle where CREATE can only ever reach "can't reach the servers".
 *
 *   npx playwright test --config tests/live-stage/playwright.link-loss.config.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test';

const EDGE_CONTROL = 'http://127.0.0.1:8796/_edge/land';

interface MainMenuSeam {
  screen: 'menu' | 'settings' | 'codex' | 'online';
  matchStarted: boolean;
  localShipPos: { x: number; y: number } | null;
  online(): void;
}
interface OnlineSeam {
  screen: string;
  title: string;
  create(): void;
  join(): void;
  typeCode(ch: string): void;
  submit(): void;
}
interface LobbySeam {
  visible: boolean;
  room: string;
  humanCount: number;
  rush(): void;
}
declare const window: Window & {
  __mainMenu?: MainMenuSeam;
  __onlineMenu?: OnlineSeam;
  __lobby?: LobbySeam;
};

/** The fleet this config stands up. Absent it, there is nothing to disconnect from. */
const HAS_FLEET = process.env['PR_LIVE_FLEET'] === '1';

/** The overlay's own ids (`src/net/link-loss-view` — `LINK_LOSS_ROOT_ID` and
 *  `LINK_LOSS_BUTTON_IDS`). Written out rather than imported: this spec is meant to
 *  fail if the shipped page stops containing them, and an import would make it
 *  assert against the module instead of against the page. */
const ROOT = '#pr-link-loss';
const TITLE = '#pr-link-loss-title';
const DETAIL = '#pr-link-loss-detail';
const RECONNECT = '#pr-link-loss-reconnect';
const ABANDON = '#pr-link-loss-abandon';
const MENU = '#pr-link-loss-menu';

/** Boot a clean client and open the doors. */
async function bootDoors(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__onlineMenu?.create === 'function', undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__mainMenu?.online());
  await page.waitForFunction(() => window.__mainMenu?.screen === 'online', undefined, { timeout: 10_000 });
}

/** CREATE a room and wait for the lobby the welcome opens. Returns its code. */
async function createRoom(page: Page): Promise<string> {
  await bootDoors(page);
  await page.evaluate(() => window.__onlineMenu?.create());
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
  const room = await page.evaluate(() => window.__lobby?.room ?? '');
  expect(room, 'the lobby showed no room code').toMatch(/^[A-Z0-9]{3,8}$/);
  return room;
}

/** JOIN that room from a second browser — through the keypad, a character at a
 *  time, the way a second player in a classroom does it. */
async function joinRoom(page: Page, room: string): Promise<void> {
  await bootDoors(page);
  await page.evaluate(() => window.__onlineMenu?.join());
  await page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 10_000 });
  for (const ch of room) await page.evaluate((c) => window.__onlineMenu?.typeCode(c), ch);
  await page.evaluate(() => window.__onlineMenu?.submit());
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
}

/**
 * Two browsers, one room, one live match — the smallest thing that is a real online
 * game. Two humans is not a detail: a room whose only human is the host RUSHes into
 * a LOCAL match with no socket at all (a0-11, `src/net/local-revert`), and a match
 * with no socket has no link to lose.
 */
async function twoPlayerMatch(browser: Browser): Promise<{ host: Page; guest: Page; close(): Promise<void> }> {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const room = await createRoom(host);
  await joinRoom(guest, room);
  await host.waitForFunction(() => (window.__lobby?.humanCount ?? 0) >= 2, undefined, { timeout: 60_000 });

  await host.evaluate(() => window.__lobby?.rush());
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
  }
  return {
    host,
    guest,
    close: async (): Promise<void> => {
      await hostContext.close();
      await guestContext.close();
    },
  };
}

/** Stop (or restart) delivery from every Machine — the silent death, and its undo.
 *  Over plain `fetch` rather than a page's request context, so teardown can put the
 *  fleet back even when the browser it was driving is already gone. */
async function gag(on: boolean): Promise<void> {
  const response = await fetch(`${EDGE_CONTROL}?gag=${on ? '1' : '0'}`);
  expect(response.ok, 'the edge control route did not answer').toBe(true);
}

/**
 * Press a button the way a player does: a real mouse click at the point it is
 * actually drawn, then wait for the screen to answer.
 *
 * Not `locator.click()`, and the reason is the overlay's own design: the grace
 * countdown rides the RECONNECT button, so the card is re-written once a second
 * (`src/net/link-loss-view` — "one DOM write per second") and every button element
 * is replaced with it. Playwright's actionability check wants one element to stay
 * attached for the whole of its sequence, and under a live match's frame load it
 * loses that race about as often as it wins it. A player's click does not care
 * which element object is under the pixel — so neither does this, and the retry
 * covers the one-in-a-thousand press that lands mid-rewrite.
 */
async function press(page: Page, selector: string, answered: () => Promise<void>): Promise<void> {
  await expect(async () => {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} is not on screen`).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await answered();
  }).toPass({ timeout: 45_000 });
}

test.describe('the link dies and the player is told', () => {
  test.skip(!HAS_FLEET, 'needs the local fleet — run the link-loss config');

  test('the overlay covers the screen, names the cause, and ABANDON MATCH gets out', async ({ browser }) => {
    const match = await twoPlayerMatch(browser);
    try {
      // Flying, and nothing is on screen but the game. This is the assertion that
      // makes the next one mean something: the overlay is not simply always there.
      await expect(match.guest.locator(ROOT)).toBeHidden();

      // The socket dies the way a backgrounded tab's does: silently.
      await gag(true);

      // …and the client says so, on its own, with no event to go on. The wait is
      // real time: `SILENCE_FLOOR_MS` is 2.5 s and this run has no clock to move.
      await expect(match.guest.locator(ROOT)).toBeVisible({ timeout: 30_000 });

      // A KICK-OUT, not a notification (the developer: "I should get kicked out").
      // The scrim covers the whole viewport, so the frozen world underneath cannot
      // be flown by a stray tap.
      const box = await match.guest.locator(ROOT).boundingBox();
      const view = match.guest.viewportSize()!;
      expect(box, 'the overlay drew no box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(view.width - 1);
      expect(box!.height).toBeGreaterThanOrEqual(view.height - 1);

      // VERBOSITY: the line names what was actually detected, never "connection
      // problem", and the grace seconds are on screen.
      const said = `${await match.guest.locator(TITLE).innerText()} ${await match.guest
        .locator(DETAIL)
        .innerText()}`;
      expect(said).toContain('no server data for');
      expect(said).toMatch(/\d+s/);
      // What the developer asked to see, as a picture: the kick-out over their own
      // frozen match, with the cause and the seconds on it.
      await match.guest.screenshot({ path: 'tests/live-stage/link-loss-lost-evidence.png' });

      // And there is a way out — a button, not just a sentence. Which buttons
      // depends on the card: the client spends its one automatic redial the instant
      // it detects a loss, so what a player usually meets is RECONNECTING… with
      // ABANDON MATCH under it, and RECONNECT is drawn on the card where nothing is
      // dialling (`src/net/link-loss` `linkNotice`). ABANDON is on both.
      expect(await match.guest.locator(`${RECONNECT}, ${ABANDON}`).count()).toBeGreaterThan(0);
      await expect(match.guest.locator(ABANDON)).toBeVisible();

      // The wire, proven by a sentence only `session.leave()` can produce: the
      // watchdog's `'left'` ending (`src/net/link-loss` `endingTitle`). A drawn
      // button that did nothing would leave the previous card standing.
      await press(match.guest, ABANDON, async () => {
        await expect(match.guest.locator(TITLE)).toContainText('MATCH ABANDONED', { timeout: 3_000 });
      });
      await expect(match.guest.locator(MENU)).toBeVisible();
      await match.guest.screenshot({ path: 'tests/live-stage/link-loss-abandoned-evidence.png' });

      // BACK TO MENU is the second half of "get me out of here": it lands on the
      // real main menu, which only a clean boot shows.
      await press(match.guest, MENU, async () => {
        await match.guest.waitForFunction(() => window.__mainMenu?.matchStarted === false, undefined, {
          timeout: 20_000,
        });
      });
      await expect(match.guest.locator(ROOT)).toBeHidden();
    } finally {
      await gag(false).catch(() => {});
      await match.close();
    }
  });

  test('the overlay comes down by itself when the link comes back', async ({ browser }) => {
    const match = await twoPlayerMatch(browser);
    try {
      await gag(true);
      await expect(match.guest.locator(ROOT)).toBeVisible({ timeout: 30_000 });

      // The network returns. Nothing is pressed: the client had already spent its
      // one automatic reclaim attempt (GDD §4.2 — the seat, the ship, the cargo and
      // the upgrades are still ours inside the grace window), and a frame arriving
      // is what takes the overlay down.
      await gag(false);
      await expect(match.guest.locator(ROOT)).toBeHidden({ timeout: 60_000 });
      await match.guest.screenshot({ path: 'tests/live-stage/link-loss-recovered-evidence.png' });

      // Still in the match it never left, and the world is being drawn again.
      expect(await match.guest.evaluate(() => window.__mainMenu?.matchStarted)).toBe(true);
      expect(await match.guest.evaluate(() => window.__mainMenu?.localShipPos)).not.toBeNull();
    } finally {
      await gag(false).catch(() => {});
      await match.close();
    }
  });
});
