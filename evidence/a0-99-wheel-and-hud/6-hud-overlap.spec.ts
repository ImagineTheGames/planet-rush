/**
 * evidence/a0-99-wheel-and-hud/6-hud-overlap.spec.ts — what is drawn over what.
 * OWNER: QA Manager (a0-99).
 *
 * The brief asks for "anything drawn over anything else, and anything a player
 * must press that another element is on top of". The second half is a0-96's own
 * question and `elementFromPoint` answers it. The first half needs rectangles,
 * and the client already keeps them: under `?debug=1` every positioned element
 * registers its declared anchor and its ACTUAL rendered rect once a frame
 * (`window.__planetRush.layout`). So "drawn over" stops being a thing to squint
 * at and becomes a non-empty intersection of two rects.
 *
 * Two states, because the wheel changes the answer: the HUD alone, and the HUD
 * with the build wheel up. Both profiles. Every pair that intersects is written
 * out with the intersection, in logical px, and `placement()` — the registry's own
 * "is it inside the region it declared" — is written out beside it, so an element
 * that has drifted out of its own anchor is named as well as one that collides.
 *
 * The rectangles are the index, not the verdict: an overlap in this file is a
 * place to LOOK at the committed frame, and the manifest attestation is written
 * from the frame.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, topmostAt } from './drive';
import { frame, note, overlap } from './shot';

/** Everything a player has to be able to PRESS. Each is checked for who owns the
 *  press at its own centre — the a0-96 question, asked of the HUD. */
const PRESSABLE = ['pause-button', 'build-button', 'zoom-control', 'minimap', 'touch-fire-button'];

for (const profile of PROFILES) {
  test(`a0-99 HUD overlap and reachability audit — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);
    await page.waitForTimeout(800);

    const states: unknown[] = [];
    for (const state of ['hud-only', 'wheel-open'] as const) {
      if (state === 'wheel-open') {
        await page.evaluate(() => window.__pressStage!.openBuild(6));
        await page.waitForTimeout(700);
      }
      const rows = await layoutRows(page);
      await frame(page, `${profile.id}-overlap-${state}`);

      const pairs: unknown[] = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const o = overlap(rows[i]!.bounds, rows[j]!.bounds);
          if (o) {
            pairs.push({
              a: rows[i]!.id,
              b: rows[j]!.id,
              intersection: {
                x: +o.x.toFixed(1), y: +o.y.toFixed(1),
                width: +o.width.toFixed(1), height: +o.height.toFixed(1),
              },
              aBounds: rows[i]!.bounds,
              bBounds: rows[j]!.bounds,
            });
          }
        }
      }

      const reach: unknown[] = [];
      for (const id of PRESSABLE) {
        const r = rows.find((x) => x.id === id);
        if (!r) { reach.push({ id, drawn: false }); continue; }
        const p = await page.evaluate(
          (b) => window.__pressStage!.clientPoint(b.x + b.width / 2, b.y + b.height / 2),
          r.bounds,
        );
        reach.push({ id, drawn: true, boundsLogical: r.bounds, centreClient: p, topmost: await topmostAt(page, p.x, p.y) });
      }

      states.push({
        state,
        viewportLogical: await page.evaluate(() => window.__pressStage!.logicalViewport()),
        elements: rows,
        placement: await page.evaluate(() => window.__planetRush?.placement?.() ?? []),
        overlaps: pairs,
        reachability: reach,
      });
    }

    note(`${profile.id}-hud-overlap`, {
      profile: profile.label,
      boot: '?debug=1 on the production bundle (the layout registry is a ?debug=1 instrument)',
      units: 'logical px — the landscape space every element lays out in under the landscape lock',
      states,
    });
    await context.close();
  });
}
