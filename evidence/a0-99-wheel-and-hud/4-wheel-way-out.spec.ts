/**
 * evidence/a0-99-wheel-and-hud/4-wheel-way-out.spec.ts — while the wheel is up,
 * can you get out of it, and can you still pause? OWNER: QA Manager (a0-99).
 *
 * a0-96's finding was not "a plate looks covered"; it was "a control a player MUST
 * press does not answer, and here is the coordinate and here is what is on top of
 * it". The layout registry shows the same *shape* of question standing over the
 * build wheel on the phone profile: `pause-button` registers a rect every frame
 * the wheel is closed, and stops registering entirely the frame it opens. If the
 * hub's own CLOSE does not answer a finger, a phone player with the wheel up has
 * no pause and no exit.
 *
 * So, on both profiles, with the wheel up:
 *
 *   1. list what the client drew this frame, and whether `pause-button` is among it,
 *   2. ask the browser who owns the press at the hub's centre (`elementFromPoint`),
 *   3. press the hub for real and photograph what happened,
 *   4. on the phone, press where the pause button WAS at rest and photograph that too,
 *   5. and press a real Escape, which is the label the desktop hub prints.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, topmostAt, wedges } from './drive';
import { frame, note } from './shot';

for (const profile of PROFILES) {
  test(`a0-99 the way out of the build wheel — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);

    await page.waitForTimeout(500);
    const closedRows = await layoutRows(page);
    const pauseAtRest = closedRows.find((r) => r.id === 'pause-button') ?? null;
    await frame(page, `${profile.id}-wheel-closed-hud`);

    await page.evaluate(() => window.__pressStage!.openBuild(6));
    await page.waitForTimeout(700);
    const openRows = await layoutRows(page);
    await frame(page, `${profile.id}-wheel-open-before-close`);

    const hub = openRows.find((r) => r.id === 'wheel-hub-back') ?? null;
    // The registry speaks LOGICAL px; a press needs CLIENT px. `clientPoint` is the
    // client's own inverse of the mapping every real pointer crosses.
    const hubPoint = hub
      ? await page.evaluate(
          (r) => window.__pressStage!.clientPoint(r.x + r.width / 2, r.y + r.height / 2),
          hub.bounds,
        )
      : null;

    const record: Record<string, unknown> = {
      profile: profile.label,
      boot: '?debug=1 on the production bundle, openBuild(6)',
      pauseButtonAtRest: pauseAtRest,
      pauseButtonWhileWheelOpen: openRows.find((r) => r.id === 'pause-button') ?? null,
      idsAtRest: closedRows.map((r) => r.id),
      idsWhileWheelOpen: openRows.map((r) => r.id),
      hubRectLogical: hub?.bounds ?? null,
      hubPointClient: hubPoint,
    };

    // 2 + 3 — who owns the press at the hub, then press it.
    if (hubPoint) {
      record.topmostAtHub = await topmostAt(page, hubPoint.x, hubPoint.y);
      const wedgesBefore = await wedges(page);
      if (profile.touch) await page.touchscreen.tap(hubPoint.x, hubPoint.y);
      else await page.mouse.click(hubPoint.x, hubPoint.y);
      await page.waitForTimeout(800);
      await frame(page, `${profile.id}-wheel-after-hub-press`);
      record.hubPress = {
        at: hubPoint,
        kind: profile.touch ? 'tap' : 'click',
        wedgesBefore: wedgesBefore.length,
        wedgesAfter: (await wedges(page)).length,
        note: 'wedges() is empty when no Build wheel is up — the readback form of "it closed"',
      };
    }

    // 4 — the phone's missing pause. Press where the pause button stood at rest,
    //     with the wheel re-opened, and see whether anything answers.
    if (profile.touch && pauseAtRest) {
      await page.evaluate(() => window.__pressStage!.openBuild(6));
      await page.waitForTimeout(600);
      const p = await page.evaluate(
        (r) => window.__pressStage!.clientPoint(r.x + r.width / 2, r.y + r.height / 2),
        pauseAtRest.bounds,
      );
      const screenBefore = await page.evaluate(() => window.__pauseStage?.read().screen ?? '(no seam)');
      record.topmostAtOldPause = await topmostAt(page, p.x, p.y);
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(900);
      await frame(page, `${profile.id}-wheel-after-old-pause-press`);
      record.oldPausePress = {
        at: p,
        screenBefore,
        screenAfter: await page.evaluate(() => window.__pauseStage?.read().screen ?? '(no seam)'),
        wedgesAfter: (await wedges(page)).length,
      };
    }

    // 5 — a real Escape, the label the desktop hub prints.
    await page.evaluate(() => window.__pressStage!.openBuild(6));
    await page.waitForTimeout(600);
    const beforeEsc = { wedges: (await wedges(page)).length, screen: await page.evaluate(() => window.__pauseStage?.read().screen ?? '(no seam)') };
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    await frame(page, `${profile.id}-wheel-after-escape`);
    record.escape = {
      beforeEsc,
      wedgesAfter: (await wedges(page)).length,
      screenAfter: await page.evaluate(() => window.__pauseStage?.read().screen ?? '(no seam)'),
    };

    note(`${profile.id}-wheel-way-out`, record);
    await context.close();
  });
}
