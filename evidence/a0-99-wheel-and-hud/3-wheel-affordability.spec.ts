/**
 * evidence/a0-99-wheel-and-hud/3-wheel-affordability.spec.ts — what the wheel
 * charges, and what it lets you buy. OWNER: QA Manager (a0-99).
 *
 * The developer's other report about this screen was **"being able to build a
 * turret with 2 ore"** — a turret costs 3. That is not a question about a colour;
 * it is a question about what happens when the press lands. So this spec re-prices
 * the wheel and then PRESSES, and records the bank and the BUILT count on both
 * sides of the press:
 *
 *   0 ore   — nothing on the station is payable
 *   2 ore   — one short of a turret. The reported bug. Press TURRET.
 *   3 ore   — exactly a turret. Press TURRET; this is the control, and a press
 *             that does nothing here would be a different bug of the same size.
 *   6 ore   — every station cost payable (turret 3, shield 5, radar 6)
 *
 * At each level the drawn cost strings and the paint the view chose for each are
 * written out beside the frame, because the ratified rule is one number per
 * segment, signal yellow when payable and threat red when not (style-guide §2) —
 * and a colour is a thing to be LOOKED at, so the frame is what the attestation
 * is written from and this readback is the cross-check.
 *
 * `?debug=1` on the production bundle: `setOre` is the only way to stand at 2 ore
 * on purpose. The press is a real click/tap at the point the client reports.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, pressWedge, wedges } from './drive';
import { frame, note } from './shot';

const LEVELS = [0, 2, 3, 6] as const;
/** Index 0 is the TOP segment, TURRET — the one the report names. */
const TURRET = 0;

for (const profile of PROFILES) {
  test(`a0-99 wheel affordability, and the 2-ore turret — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);

    const levels: unknown[] = [];
    for (const ore of LEVELS) {
      // A fresh wheel per level, so a build made at one level cannot change the
      // BUILT counts the next level is read against.
      await page.evaluate((o) => window.__pressStage!.openBuild(o), ore);
      await page.waitForTimeout(600);
      const drawn = await wedges(page);
      await frame(page, `${profile.id}-wheel-ore-${ore}`);

      // Now press TURRET and see what the sim does about it.
      const bankBefore = await page.evaluate(() => window.__pressStage!.bank());
      const capsBefore = drawn.map((w) => w.caps);
      const pressedAt = await pressWedge(page, TURRET, profile.touch);
      await page.waitForTimeout(700);
      const afterDrawn = await wedges(page);
      await frame(page, `${profile.id}-wheel-ore-${ore}-after-turret-press`);

      levels.push({
        ore,
        drawn: drawn.map((w) => ({
          label: w.label, sub: w.sub, costLabel: w.costLabel, cost: w.cost,
          costPaint: w.costPaint, caps: w.caps, ready: w.ready, selected: w.selected,
        })),
        turretPress: {
          pressedAt,
          bankBefore,
          bankAfter: await page.evaluate(() => window.__pressStage!.bank()),
          capsBefore,
          capsAfter: afterDrawn.map((w) => w.caps),
        },
      });
    }

    note(`${profile.id}-wheel-affordability`, {
      profile: profile.label,
      boot: '?debug=1 on the production bundle; openBuild(ore) per level, then a real press on TURRET',
      report: 'developer, twice: (a) selection reached only the top segment, (b) a turret was buildable with 2 ore',
      turretCostPerSimConstants: 3,
      levels,
    });
    await context.close();
  });
}
