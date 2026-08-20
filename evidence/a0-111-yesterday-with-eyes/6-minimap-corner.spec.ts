/**
 * evidence/a0-111-yesterday-with-eyes/6-minimap-corner.spec.ts — the phone
 * minimap, out to the true screen edge. OWNER: QA Manager (a0-111).
 *
 * a0-99's finding: *"The phone minimap stops 132 logical px short of the right
 * edge — a sixth of the screen — while every other right-hand element hugs a 16px
 * margin, and the anchor check passes anyway."* a0-103 moved it. The brief asks
 * for the frame **with the registry numbers, so its corner can be checked rather
 * than eyeballed** — which is the whole point, because the thing that let the
 * defect ship was an anchor check that passed on a rect nobody had measured.
 *
 * So this states, for every element the registry says is anchored to a right or
 * bottom edge, the GAP between its drawn rect and that edge of the viewport, on
 * both profiles. The minimap's number is then a number among its neighbours'
 * numbers rather than a number on its own — a0-99's complaint was as much about
 * the minimap disagreeing with everything else in its half of the screen as about
 * the distance itself.
 *
 * `?debug=1`, live sim, build stamp in frame. Nothing is staged: the HUD is
 * photographed where it lays itself out.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, park } from './drive';
import { frame, note } from './shot';

for (const profile of PROFILES) {
  test(`a0-111 the minimap in its corner — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);
    await page.waitForTimeout(1_200);
    await park(page);
    await frame(page, `${profile.id}-minimap-corner`);

    const viewport = await page.evaluate(() => window.__viewStage!.viewport());
    const rows = await layoutRows(page);

    // Every element's distance from each edge of the logical viewport. Reported
    // for all four edges regardless of what the element claims to be anchored
    // to, because "the anchor check passes anyway" is exactly how a0-99's
    // 132px gap survived: an element's declared anchor and its drawn rect are
    // two different facts and only one of them is what a player sees.
    const gaps = rows.map((r) => ({
      id: r.id,
      anchor: r.anchor,
      bounds: r.bounds,
      gapLeft: Math.round(r.bounds.x * 10) / 10,
      gapTop: Math.round(r.bounds.y * 10) / 10,
      gapRight: Math.round((viewport.width - (r.bounds.x + r.bounds.width)) * 10) / 10,
      gapBottom: Math.round((viewport.height - (r.bounds.y + r.bounds.height)) * 10) / 10,
    }));
    const minimap = gaps.find((g) => g.id === 'minimap') ?? null;
    const rightEdge = gaps.filter((g) => g.anchor.region.includes('right'));
    const bottomEdge = gaps.filter((g) => g.anchor.region.includes('bottom'));

    const minimapState = await page.evaluate(
      () => (window as unknown as { __minimapStage?: { state(): unknown } }).__minimapStage?.state() ?? null,
    );

    note(`${profile.id}-minimap-corner`, {
      profile: profile.label,
      boot: '?debug=1 on the production bundle (no ?freeze — the build stamp is in frame)',
      viewport,
      minimap,
      minimapDeclaredMargin: minimap?.anchor.margin ?? null,
      rightAnchoredElements: rightEdge,
      bottomAnchoredElements: bottomEdge,
      allElements: gaps,
      minimapState,
    });
    await context.close();
  });
}
