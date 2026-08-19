/**
 * evidence/a0-99-wheel-and-hud/1-wheel-front-door.spec.ts — the build wheel as a
 * player opens it. OWNER: QA Manager (a0-99).
 *
 * The FRONT DOOR leg, and the only leg with no seam under it: menu → PLAY →
 * PLAY SOLO → RUSH, then the player's own way in — a real `E` on the desktop
 * profile, a real tap on the BUILD & UPGRADE button on the phone. No ore is
 * staged, so the wheel is priced against the three ore a match actually starts
 * you with, which is the honest "not enough to build most of it" case and costs
 * nothing to arrange.
 *
 * The phone's BUILD button has no shipped seam reporting where it was drawn, so
 * its press point is taken from the layout registry on the SAME profile under
 * `?debug=1` (`build-button`, logical 54,134 76x76 → centre 92,172) and stated
 * here rather than derived silently. Whether that coordinate was right is not
 * argued: the frame after the tap shows the wheel or it does not.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootMatchFrontDoor, bootMenu, park, topmostAt } from './drive';
import { frame, note } from './shot';

/** The phone BUILD button's centre, logical px — see the header for provenance. */
const BUILD_BUTTON_CENTRE = { x: 92, y: 172 };

for (const profile of PROFILES) {
  test(`a0-99 build wheel through the front door — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();

    await bootMenu(page);
    await bootMatchFrontDoor(page);
    await park(page);
    await frame(page, `${profile.id}-front-hud-at-rest`);

    // What the client says about the match before anything is pressed. `__pauseStage`
    // ships on both boots, so this much readback is available even here.
    const before = await page.evaluate(() => window.__pauseStage!.read());

    // The player's own way in.
    const opened: Record<string, unknown> = { profile: profile.id };
    if (profile.touch) {
      const top = await topmostAt(page, BUILD_BUTTON_CENTRE.x, BUILD_BUTTON_CENTRE.y);
      await page.touchscreen.tap(BUILD_BUTTON_CENTRE.x, BUILD_BUTTON_CENTRE.y);
      opened.press = { kind: 'tap on BUILD & UPGRADE', at: BUILD_BUTTON_CENTRE, topmostBefore: top };
    } else {
      await page.keyboard.press('KeyE');
      opened.press = { kind: 'real E key', at: null };
    }
    await park(page);
    await frame(page, `${profile.id}-front-wheel-open`);
    const after = await page.evaluate(() => window.__pauseStage!.read());

    note(`${profile.id}-front-wheel`, {
      profile: profile.label,
      boot: 'front door: /?gate=0 → PLAY → PLAY SOLO → RUSH (no ?debug=1, no staged ore)',
      ...opened,
      pauseSeamBefore: before,
      pauseSeamAfter: after,
      caveat:
        'the front-door boot installs no wheel seam, so nothing here reads the wheel; ' +
        'what the wheel says is read off the committed frame by eye.',
    });
    await context.close();
  });
}
