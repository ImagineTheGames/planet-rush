/**
 * evidence/a0-111-yesterday-with-eyes/4-doors.spec.ts — the doors screen after
 * a0-100c took SETTINGS off it. OWNER: QA Manager (a0-111).
 *
 * Two questions, and both are answered with a press rather than a readback:
 *
 *  1. Is SETTINGS gone from the footer? The frame is the evidence; the seam's
 *     `doorControls` list is recorded beside it as a cross-check, because a
 *     control that is drawn but unlisted and a control that is listed but
 *     undrawn are different defects and only having both catches either.
 *  2. Is BACK still there and does it still WORK? a0-96's whole finding was a
 *     plate that was drawn, listed, and unpressable, so "still there" is not
 *     enough: BACK is pressed at the point the client itself reports drawing it,
 *     with the browser's own `elementFromPoint` recorded for who receives that
 *     press, and the screen state written down either side of it.
 *
 * Front-door boot (`?gate=0` → PLAY), because `?debug=1` never passes this way.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootMenu, controlPoint, park, pressControl, topmostAt } from './drive';
import { frame, note } from './shot';
import { recordWords, drawnWords, hits, fullStrings } from './words';

for (const profile of PROFILES) {
  test(`a0-111 the doors screen — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await recordWords(page);
    await bootMenu(page);

    // The MENU itself first — one of the two places settings is allowed to live,
    // so the frame that says it is gone from the doors can be read against the
    // frame that says it is still where it belongs.
    await frame(page, `${profile.id}-doors-0-menu`);
    const menuKinds = await page.evaluate(() => window.__mainMenu!.controls.map((c) => c.kind));

    await page.evaluate(() => window.__mainMenu!.play());
    await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
    await park(page);
    await frame(page, `${profile.id}-doors-1-home`);

    const doors = await page.evaluate(() => ({
      screen: window.__onlineMenu!.screen,
      title: window.__onlineMenu!.title,
      notice: window.__onlineMenu!.notice,
      error: window.__onlineMenu!.error,
      controls: window.__onlineMenu!.doorControls.map((c) => ({
        kind: c.kind,
        physicalCenter: c.physicalCenter,
        physicalBounds: c.physicalBounds,
      })),
    }));

    // Is anything a press could land on still routed to a settings screen? Asked
    // of every listed control, not just of the one that used to be named for it.
    const settingsListed = doors.controls.filter((c) => /settings/i.test(c.kind));

    // BACK, pressed for real at its own reported centre.
    const backPoint = await controlPoint(page, 'doors', 'back');
    const backTopmost = backPoint.point ? await topmostAt(page, backPoint.point.x, backPoint.point.y) : null;
    const before = await page.evaluate(() => ({
      onlineVisible: window.__onlineMenu?.visible ?? null,
      onlineScreen: window.__onlineMenu?.screen ?? null,
      menuScreen: window.__mainMenu?.screen ?? null,
      menuVisible: window.__mainMenu?.visible ?? null,
    }));
    await pressControl(page, 'doors', 'back', profile.touch);
    await page.waitForTimeout(900);
    await park(page);
    const after = await page.evaluate(() => ({
      onlineVisible: window.__onlineMenu?.visible ?? null,
      onlineScreen: window.__onlineMenu?.screen ?? null,
      menuScreen: window.__mainMenu?.screen ?? null,
      menuVisible: window.__mainMenu?.visible ?? null,
    }));
    await frame(page, `${profile.id}-doors-2-after-back`);

    const words = await drawnWords(page);
    note(`${profile.id}-doors`, {
      profile: profile.label,
      boot: '?gate=0 on the production bundle → PLAY',
      menuControls: menuKinds,
      doors,
      settingsListedOnDoors: settingsListed,
      back: {
        pressedAt: backPoint.point,
        topmostAtThatPoint: backTopmost,
        before,
        after,
      },
      drawnTextCount: { drawn: words.drawn.length, measured: words.measured.length },
      claimHits: hits(words, 'claim'),
      screenText: fullStrings(words),
      rawCensus: words,
    });
    await context.close();
  });
}
