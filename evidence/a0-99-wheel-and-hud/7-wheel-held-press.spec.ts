/**
 * evidence/a0-99-wheel-and-hud/7-wheel-held-press.spec.ts — the selected state,
 * photographed while it is actually up. OWNER: QA Manager (a0-99).
 *
 * Written after looking at `phone-798x384-wheel-press-*.png` and finding that
 * none of the five shows a highlighted wedge. That is not a finding about the
 * phone; it is a hole in the capture. `touchscreen.tap()` is a down and an up,
 * and every one of those frames was taken after the up — so what they prove is
 * what the wheel looks like with nothing pressed, which is not what the brief
 * asked to be photographed hardest.
 *
 * A finger that is still down has no `tap()` in the Playwright API, so this goes
 * one level lower and dispatches the touch through CDP directly:
 * `Input.dispatchTouchEvent` with `touchStart`, a frame settle, the screenshot,
 * and only then `touchEnd`. The desktop leg does the same with a real
 * `mouse.down()` held across the shot. Both cross the shipped pointer route; the
 * only thing changed is when the shutter opens.
 *
 * The cost is stated too: the ore is 999, so a held press on a payable wedge is a
 * press that WILL buy something the moment it lifts. The order the wedges are
 * pressed in is therefore recorded with the bank on both sides, exactly as spec 3
 * does, and each wedge gets its own freshly-opened wheel.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, wedges } from './drive';
import { frame, note } from './shot';

const RICH = 999;

for (const profile of PROFILES) {
  test(`a0-99 the wedge selected state, held — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await bootDebugMatch(page);

    const steps: unknown[] = [];
    for (const i of [0, 1, 2, 3, 4]) {
      await page.evaluate((ore) => window.__pressStage!.openBuild(ore), RICH);
      await page.waitForTimeout(500);
      const before = await wedges(page);
      const p = await page.evaluate((k) => {
        const c = window.__pressStage!.wedgeClientPoint(k);
        return c ? { ...c } : null;
      }, i);
      if (!p) { steps.push({ index: i, error: 'the client reported no point for this wedge' }); continue; }

      if (profile.touch) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: p.x, y: p.y, id: 1 }],
        });
      } else {
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
      }
      await page.waitForTimeout(500); // the finger/button is still down here
      const held = await wedges(page);
      await frame(page, `${profile.id}-wheel-held-${i}`);

      if (profile.touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
      await page.waitForTimeout(600);
      const released = await wedges(page);

      steps.push({
        index: i,
        wedge: before[i]?.label ?? '(no wedge reported)',
        heldAt: p,
        gesture: profile.touch ? 'CDP Input.dispatchTouchEvent touchStart, held across the shot' : 'mouse.down() held across the shot',
        selectedBefore: before.map((w) => w.selected),
        selectedWhileHeld: held.map((w) => w.selected),
        selectedAfterRelease: released.map((w) => w.selected),
        capsWhileHeld: held.map((w) => w.caps),
        capsAfterRelease: released.map((w) => w.caps),
        bankAfterRelease: await page.evaluate(() => window.__pressStage!.bank()),
      });
    }

    note(`${profile.id}-wheel-held-press`, {
      profile: profile.label,
      boot: `?debug=1 on the production bundle, openBuild(${RICH}) before each wedge`,
      why: 'the tap frames in spec 2 were all taken after the finger lifted; these are taken with it down',
      steps,
    });
    await context.close();
  });
}
