/**
 * evidence/a0-99-wheel-and-hud/5-hud-rest-and-fight.spec.ts — the match HUD, at
 * rest and mid-fight. OWNER: QA Manager (a0-99).
 *
 * The FRONT DOOR, because the HUD a player gets is the one with the menu's saved
 * settings behind it and the match's own DOM overlays available on top — and the
 * overlay half is exactly where a0-96's bug lived. The brief names five things to
 * photograph: the ore counter, the ship HP, the minimap, the controls strip and
 * the pause affordance. All five are on the frames this spec writes.
 *
 * "Mid-fight" is not staged here: the offline match seats real bots on real
 * difficulties (a `Warden (HARD)` and a `Rusty (EASY)` are on the boot frame) and
 * the wave clock is running, so this flies the local ship OUT of the station with
 * real thrust and real fire, waits out a chunk of the first wave, and shoots.
 * Whatever the fight looks like by then is what is photographed. A staged fight
 * would be a picture of the stage.
 *
 * `__pauseStage` ships on both boots, so the ship's live position and velocity,
 * the sim's tick counter and the pause button's own drawn centre are all readable
 * here without `?debug=1` — including, at the end, a real press on that centre.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootMatchFrontDoor, bootMenu, origin, park, topmostAt } from './drive';
import { frame, note } from './shot';

for (const profile of PROFILES) {
  test(`a0-99 match HUD at rest and mid-fight — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await bootMenu(page);
    await bootMatchFrontDoor(page);
    await park(page);
    await frame(page, `${profile.id}-hud-rest`);
    const rest = await page.evaluate(() => window.__pauseStage!.read());

    // Out of the dock and into the wave, with the controls the profile actually
    // has: keys on the desktop, a thumb on the phone.
    if (profile.touch) {
      // Drag from the lower-left quadrant — the thrust stick's own half — and hold.
      await page.touchscreen.tap(profile.width * 0.75, profile.height * 0.4);
      await page.waitForTimeout(400);
      for (let i = 0; i < 6; i++) {
        await page.touchscreen.tap(profile.width * 0.8, profile.height * 0.35);
        await page.waitForTimeout(700);
      }
    } else {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(2_200);
      await page.keyboard.up('KeyW');
      for (let i = 0; i < 8; i++) {
        await page.mouse.click(profile.width * 0.8, profile.height * 0.35);
        await page.waitForTimeout(500);
      }
    }
    await page.waitForTimeout(6_000);
    const flying = await page.evaluate(() => window.__pauseStage!.read());
    await frame(page, `${profile.id}-hud-midfight`);

    // The pause affordance, at the centre the client itself reports drawing it —
    // a0-96's discipline, and the last of the brief's five HUD elements.
    const o = await origin(page);
    const bp = flying.buttonPoint;
    const topmostAtPause = await topmostAt(page, o.x + bp.x, o.y + bp.y);
    const screenBefore = await page.evaluate(() => window.__pauseStage!.read().screen);
    if (profile.touch) await page.touchscreen.tap(o.x + bp.x, o.y + bp.y);
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(1_200);
    await frame(page, `${profile.id}-hud-pause-pressed`);
    const afterPause = await page.evaluate(() => window.__pauseStage!.read());

    note(`${profile.id}-hud`, {
      profile: profile.label,
      boot: 'front door: /?gate=0 → PLAY → PLAY SOLO → RUSH (no ?debug=1)',
      atRest: rest,
      midFight: flying,
      shipMoved: rest.ship && flying.ship
        ? { dx: +(flying.ship.x - rest.ship.x).toFixed(1), dy: +(flying.ship.y - rest.ship.y).toFixed(1) }
        : null,
      pausePress: {
        kind: profile.touch ? 'tap on the corner pause button' : 'real Escape',
        at: profile.touch ? { x: o.x + bp.x, y: o.y + bp.y } : null,
        clientReportedButtonCentre: bp,
        topmostAtPause,
        screenBefore,
        screenAfter: afterPause.screen,
        frozenAfter: afterPause.frozen,
      },
      downloads,
    });
    await context.close();
  });
}
