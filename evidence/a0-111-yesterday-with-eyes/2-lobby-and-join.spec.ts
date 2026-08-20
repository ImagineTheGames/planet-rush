/**
 * evidence/a0-111-yesterday-with-eyes/2-lobby-and-join.spec.ts — every online
 * screen a player can walk to, photographed and read back word for word.
 * OWNER: QA Manager (a0-111).
 *
 * a0-108 took the fiction noun off these screens: `CLAIM CODE` became `ROOM
 * CODE`, `OPEN CLAIMS` became `OPEN ROOMS`, `PICK A CLAIM` became `PICK A ROOM`,
 * `WAITING FOR THE CLAIM HOLDER` became `WAITING FOR THE HOST`. The brief's
 * instruction is not to check that list — it is to walk the screens and look.
 *
 * ── THE WALK ────────────────────────────────────────────────────────────────
 * One page, one boot, in the order a player would take it, so the word census
 * ({@link ./words}) accumulates across the whole flow rather than per screen:
 *
 *   menu → PLAY → doors
 *        → JOIN            the browse half (OPEN ROOMS / PICK A ROOM, empty list)
 *        → mode:code       the keypad half (ROOM CODE / ENTER THE ROOM CODE)
 *        → BACK → doors
 *        → SOLO → lobby    the roster, the chips, the footer hint
 *        → the MAP card    map select — eyebrow and hint
 *   (fresh boot) → HOST   whatever a host press does with no allocator to reach
 *
 * Every press lands at the point the client itself reports drawing the control
 * at. Where a seam call was used instead of a press, the readback says so at
 * that stop — a screen reached through a back door is a screen whose frame is
 * quietly claiming more than it proved.
 *
 * ── THE HUNT ────────────────────────────────────────────────────────────────
 * "The word *claim* must not appear on any screen a player can reach. Look for
 * it; do not assume the audit test caught every path, because a string can be
 * assembled at runtime." So the hunt runs over what this walk RASTERISED, not
 * over the source — see ./words.ts for how, and for what it cannot see.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootMenu, controlPoint, origin, park, pressAt, pressControl } from './drive';
import { frame, note } from './shot';
import { recordWords, drawnWords, hits, fullStrings } from './words';
import { settleFrames } from '../../tests/mobile/render-settle';

interface StopReadback {
  readonly at: string;
  readonly pressedAt?: { x: number; y: number } | null;
  readonly seen: unknown;
}

for (const profile of PROFILES) {
  test(`a0-111 the lobby and the join flow — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await recordWords(page);
    const stops: StopReadback[] = [];

    const entry = (): Promise<unknown> =>
      page.evaluate(() => {
        const m = window.__onlineMenu;
        if (!m) return null;
        return {
          screen: m.screen,
          joinMode: m.joinMode,
          title: m.title,
          status: m.status,
          error: m.error,
          notice: m.notice,
          code: m.code,
          rows: m.browseRows.length,
          browseEmpty: (m as unknown as { browseEmpty?: readonly string[] }).browseEmpty ?? null,
          controls: m.doorControls.map((c) => c.kind),
        };
      });
    const lobby = (): Promise<unknown> =>
      page.evaluate(() => {
        const l = window.__lobby as unknown as Record<string, unknown> | undefined;
        if (!l) return null;
        return {
          visible: l.visible,
          screen: l.screen,
          room: l.room,
          online: l.online,
          you: l.you,
          isHost: l.isHost,
          humanCount: l.humanCount,
          mode: l.mode,
          abundance: l.abundance,
          size: l.size,
          hintTitle: l.hintTitle,
          claim: l.claim,
          seatStates: (l.seatStates as { label: string }[]).map((s) => s.label),
        };
      });

    await bootMenu(page);
    await page.evaluate(() => window.__mainMenu!.play());
    await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
    await park(page);

    // --- JOIN, the browse half -----------------------------------------------
    const joinAt = await pressControl(page, 'doors', 'join', profile.touch);
    await page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 20_000 });
    await settleFrames(page, 10);
    await frame(page, `${profile.id}-join-1-browse`);
    stops.push({ at: 'JOIN → browse (OPEN ROOMS)', pressedAt: joinAt.point, seen: await entry() });

    // --- JOIN, the keypad half -----------------------------------------------
    const codeAt = await pressControl(page, 'doors', 'mode:code', profile.touch);
    await page.waitForFunction(() => window.__onlineMenu?.joinMode === 'code', undefined, { timeout: 20_000 });
    await settleFrames(page, 10);
    await frame(page, `${profile.id}-join-2-code`);
    stops.push({ at: 'JOIN → keypad (ROOM CODE)', pressedAt: codeAt.point, seen: await entry() });

    // --- back out to the doors ----------------------------------------------
    await pressControl(page, 'doors', 'back', profile.touch);
    await page.waitForFunction(() => window.__onlineMenu?.screen === 'home', undefined, { timeout: 20_000 });
    await park(page);

    // --- SOLO → the lobby ----------------------------------------------------
    const soloAt = await pressControl(page, 'doors', 'solo', profile.touch);
    await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
    await settleFrames(page, 12);
    await park(page);
    await frame(page, `${profile.id}-lobby-1-roster`);
    stops.push({ at: 'SOLO → the lobby', pressedAt: soloAt.point, seen: await lobby() });

    // --- the MAP card → map select ------------------------------------------
    const o = await origin(page);
    const mapPoint = await page.evaluate(() => {
      const c = (window.__lobby as unknown as { mapCardControl?: { physicalCenter?: { x: number; y: number } } })
        ?.mapCardControl;
      return c?.physicalCenter ? { ...c.physicalCenter } : null;
    });
    let mapOpenedBy = 'the MAP card, pressed where the lobby reports drawing it';
    if (mapPoint) {
      await pressAt(page, { x: o.x + mapPoint.x, y: o.y + mapPoint.y }, profile.touch);
    } else {
      await page.evaluate(() => (window.__lobby as unknown as { openMapSelect(): void }).openMapSelect());
      mapOpenedBy = 'the __lobby.openMapSelect() seam — the lobby reported no physical point for the MAP card';
    }
    await page
      .waitForFunction(() => (window.__lobby as unknown as { screen?: string })?.screen === 'map', undefined, {
        timeout: 20_000,
      })
      .catch(() => undefined);
    await settleFrames(page, 12);
    await park(page);
    await frame(page, `${profile.id}-lobby-2-map-select`);
    stops.push({
      at: `map select (opened by ${mapOpenedBy})`,
      pressedAt: mapPoint ? { x: o.x + mapPoint.x, y: o.y + mapPoint.y } : null,
      seen: await lobby(),
    });

    // --- HOST, on a fresh boot ----------------------------------------------
    // Backing out of the lobby with the `leave()` seam takes the canvas out from
    // under the page for long enough that its bounding box is gone, and the
    // first cut of this spec died there with four good frames already on disk.
    // The screen after it is a screen a player CAN reach, so it is reached the
    // way a player would reach it after a match — from a fresh front door — and
    // this walk's word census is banked first so the re-navigation cannot erase
    // it (`addInitScript` re-arms an empty recorder on every navigation).
    const walkWords = await drawnWords(page);

    await bootMenu(page);
    await page.evaluate(() => window.__mainMenu!.play());
    await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
    await park(page);
    const hostControl = await controlPoint(page, 'doors', 'create');
    let hostPressed: { x: number; y: number } | null = null;
    if (hostControl.point) {
      hostPressed = hostControl.point;
      await pressAt(page, hostControl.point, profile.touch);
      // A HOST press with no allocator to reach ends somewhere; wait for it to
      // stop moving rather than for a state this capture has decided on.
      await page.waitForTimeout(8_000);
      await park(page);
    }
    await frame(page, `${profile.id}-join-3-host`);

    // a0-96's tool, pointed at this screen: after the refusal, who does the
    // browser say receives a press at each door's own reported centre? The
    // refusal draws DOM buttons over the canvas, and a DOM button at the top of
    // the stack is what made the pause DONE plate unpressable. `isCanvas: true`
    // means the press reaches the game; anything else names what eats it.
    const doorReach = await page.evaluate(async () => {
      const out: unknown[] = [];
      for (const c of window.__onlineMenu?.doorControls ?? []) {
        const el = document.elementFromPoint(c.physicalCenter.x, c.physicalCenter.y);
        out.push({
          door: c.kind,
          at: { ...c.physicalCenter },
          receivedBy: el
            ? {
                tag: el.tagName.toLowerCase(),
                text: (el.textContent ?? '').trim().slice(0, 40),
                zIndex: getComputedStyle(el).zIndex,
                isCanvas: el.tagName.toLowerCase() === 'canvas',
              }
            : null,
        });
      }
      return out;
    });
    stops.push({ at: 'HOST, with no allocator reachable', pressedAt: hostPressed, seen: await entry() });

    const hostWords = await drawnWords(page);
    const words = {
      drawn: [...new Set([...walkWords.drawn, ...hostWords.drawn])],
      measured: [...new Set([...walkWords.measured, ...hostWords.measured])],
    };
    note(`${profile.id}-lobby-and-join`, {
      profile: profile.label,
      boot: '?gate=0 on the production bundle — the front door, walked',
      stops,
      // After the HOST refusal: what would receive a press at each door's centre.
      doorReachAfterTheRefusal: doorReach,
      claimHits: hits(words, 'claim'),
      roomHits: hits(words, 'room'),
      screenText: fullStrings(words),
      rawCensus: words,
    });
    await context.close();
  });
}
