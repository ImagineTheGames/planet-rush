/**
 * evidence/a0-99-wheel-and-hud/2-wheel-selection.spec.ts — does the selection
 * reach every segment? OWNER: QA Manager (a0-99).
 *
 * The developer reported this screen twice, and one of the two reports was "a
 * selection animation that only reached the top segment". So this walks all five
 * in order — 0 is the TOP one — and at each step does three things a frame alone
 * cannot separate:
 *
 *   1. reads what the view says is selected BEFORE anything moves,
 *   2. moves a real cursor onto the wedge at the point the client says it drew it
 *      (`__pressStage.wedgeClientPoint`, the shipped `pointermove` route) and
 *      reads the selection again,
 *   3. presses there for real and reads the selection, the BUILT counts and the
 *      bank again, and photographs the result.
 *
 * Every coordinate pressed is written to the readback beside the frames, so the
 * manifest can state where the press landed rather than describe it.
 *
 * `?debug=1` on the production bundle: the front door has no seam that can say
 * which wedge is selected, and "the highlight moved" is a claim about exactly
 * that. The press itself is a genuine click at a genuine coordinate either way.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, hoverWedge, pressWedge, wedges } from './drive';
import { frame, note } from './shot';

/** Enough ore that affordability cannot be what stops a selection from moving —
 *  the two reports are separate, and this spec is about the highlight. */
const RICH = 999;

for (const profile of PROFILES) {
  test(`a0-99 selection on all five build segments — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);
    await page.evaluate((ore) => window.__pressStage!.openBuild(ore), RICH);
    await page.waitForTimeout(600);
    await frame(page, `${profile.id}-wheel-rest-rich`);

    const steps: unknown[] = [];
    for (const i of [0, 1, 2, 3, 4]) {
      // Re-open: pressing wedge 4 (UPGRADE SHIP) swaps the Build wheel for the
      // upgrade panel, so every step starts from a Build wheel that is up.
      await page.evaluate((ore) => window.__pressStage!.openBuild(ore), RICH);
      await page.waitForTimeout(400);
      const before = await wedges(page);

      // Desktop gets a hover leg (there is no hover on a finger); the touch
      // profile goes straight to the tap.
      let hoverAt: unknown = null;
      let onHover: unknown = null;
      if (!profile.touch) {
        hoverAt = await hoverWedge(page, i);
        onHover = (await wedges(page)).map((w) => w.selected);
        await frame(page, `${profile.id}-wheel-hover-${i}`);
      }

      const pressedAt = await pressWedge(page, i, profile.touch);
      await page.waitForTimeout(500);
      const after = await wedges(page);
      await frame(page, `${profile.id}-wheel-press-${i}`);

      steps.push({
        index: i,
        wedge: before[i]?.label ?? '(no wedge reported)',
        pressedAt,
        hoverAt,
        selectedBefore: before.map((w) => w.selected),
        selectedOnHover: onHover,
        selectedAfterPress: after.map((w) => w.selected),
        labelsAfter: after.map((w) => w.label),
        capsBefore: before.map((w) => w.caps),
        capsAfter: after.map((w) => w.caps),
        bankAfter: await page.evaluate(() => window.__pressStage!.bank()),
      });
    }

    note(`${profile.id}-wheel-selection`, {
      profile: profile.label,
      boot: `?debug=1 on the production bundle, openBuild(${RICH})`,
      wedgeOrder: 'index 0 is the TOP segment; 1..4 run clockwise',
      steps,
    });
    await context.close();
  });
}
