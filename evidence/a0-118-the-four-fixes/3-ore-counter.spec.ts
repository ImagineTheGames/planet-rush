/**
 * evidence/a0-118-the-four-fixes/3-ore-counter.spec.ts — the counter, sampled the
 * way it was sampled before. OWNER: QA Manager (a0-118).
 *
 * a0-111's verdict, in its own words: *"something other than the counter itself
 * was drawn into the counter's rect on 3 of 14 desktop stops and 1 of 14 phone
 * stops"* — a teal `Rusty (EASY)` with its R across the E of ORE. a0-115 was
 * briefed off that frame and merged (b48cf2cd / c5aceaf0 / ce6d2d04, PR #492): a
 * world label now steps sideways out of a HUD readout's rect, and stands down for
 * the frame if it has nowhere to go.
 *
 * This is a0-111's spec with the measurement untouched — the SAME fourteen
 * headings in the SAME order, reached by the SAME real taps, with every other
 * registered element's rect intersected against `ore-hud`'s at every stop. The
 * brief asks for a rate, not a clean frame: *"A number that is now zero is worth
 * more than a single clean frame."* A single frame cannot say that, because the
 * collision only exists at certain camera positions — which is precisely why a
 * golden frame taken at one position never caught it.
 *
 * ONE THING IS ADDED, and it is a cross-check rather than a new ruler: the labels
 * the layer actually DREW this frame (`__nameplateStage.plates()`). a0-115's own
 * commit warns that a plate which yields must be distinguishable from a plate
 * that broke, so a run where the intersection count falls to zero AND every bot
 * still has a label somewhere is a different result from one where the labels
 * simply stopped being drawn. The count is the verdict; this says what paid for it.
 *
 * Nothing about the HUD is staged. `__oreHudStage.mine(37)` puts ore in the hold
 * and parks the ship away from home — the shipped seam — so the counter has a
 * number to draw. Where the counter is drawn, and what lands in it, is the HUD's.
 */
import { test } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, origin, park } from './drive';
import type { LayoutRow } from './drive';
import { frame, note, SHOTS } from './shot';
import { settleFrames } from '../../tests/mobile/render-settle';

/** How much of a rect is NOT the flat backdrop, and how much of it leans warm —
 *  a0-111's instrument, unchanged, so "the busiest background fourteen stops
 *  could find" means the same thing in both runs. */
function backdrop(
  file: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number,
): { total: number; lit: number; warm: number; litPct: number } {
  const png = PNG.sync.read(readFileSync(file));
  const x0 = Math.max(0, Math.round(rect.x * dpr));
  const y0 = Math.max(0, Math.round(rect.y * dpr));
  const x1 = Math.min(png.width, Math.round((rect.x + rect.width) * dpr));
  const y1 = Math.min(png.height, Math.round((rect.y + rect.height) * dpr));
  let total = 0;
  let lit = 0;
  let warm = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) * 4;
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      total++;
      if (Math.max(r, g, b) > 40) lit++;
      if (r > b + 25 && r > 60) warm++;
    }
  }
  return { total, lit, warm, litPct: total === 0 ? 0 : Math.round((lit / total) * 1000) / 10 };
}

/** Rectangle intersection in the logical viewport the registry reports in —
 *  a0-99's tool, kept through a0-111, kept here. "Drawn over" is, mechanically, a
 *  non-empty intersection of two rendered rects. */
function overlap(a: LayoutRow['bounds'], b: LayoutRow['bounds']): LayoutRow['bounds'] | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bot = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || bot <= y) return null;
  return { x, y, width: r - x, height: bot - y };
}

for (const profile of PROFILES) {
  test(`a0-118 the ore counter, sampled again — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);

    const staged = await page.evaluate(() => window.__oreHudStage!.mine(37));
    await settleFrames(page, 10);
    await park(page);

    const o = await origin(page);
    // a0-111's fourteen headings, in a0-111's order. The camera is ship-locked,
    // so flying the ship is the only way to change what is behind the corner.
    const heading = [
      [0.5, 0.5],
      [0.15, 0.2],
      [0.85, 0.2],
      [0.85, 0.8],
      [0.15, 0.8],
      [0.5, 0.12],
      [0.9, 0.5],
      [0.5, 0.88],
      [0.1, 0.5],
      [0.2, 0.15],
      [0.8, 0.15],
      [0.2, 0.85],
      [0.8, 0.85],
      [0.5, 0.15],
    ] as const;

    const stops: unknown[] = [];
    let best: { name: string; lit: number; warm: number } | null = null;
    for (let i = 0; i < heading.length; i++) {
      const [fx, fy] = heading[i]!;
      const px = o.x + profile.width * fx;
      const py = o.y + profile.height * fy;
      if (i > 0) {
        if (profile.touch) await page.touchscreen.tap(px, py);
        else await page.mouse.click(px, py);
        await page.waitForTimeout(1_800);
      }
      await park(page);
      const name = `${profile.id}-ore-stop-${i}`;
      await frame(page, name);
      const rows = await layoutRows(page);
      const ore = rows.find((r) => r.id === 'ore-hud');
      const collisions = ore
        ? rows
            .filter((r) => r.id !== 'ore-hud' && r.id !== 'banked-total')
            .map((r) => ({ with: r.id, rect: r.bounds, intersection: overlap(ore.bounds, r.bounds) }))
            .filter((c) => c.intersection !== null)
        : [];
      const measured = ore ? backdrop(join(SHOTS, `${name}.png`), ore.bounds, profile.dpr) : null;
      const state = await page.evaluate(() => ({
        readout: window.__oreHudStage!.readout(),
        total: window.__oreHudStage!.total(),
        ship: window.__pauseStage?.read().ship ?? null,
        world: window.__viewStage?.world() ?? null,
        // a0-115's cross-check: the labels the layer actually drew this frame.
        // A zero collision count paid for by labels that stopped existing is a
        // different result, and this is how the note can tell.
        platesDrawn: (
          (window as unknown as { __nameplateStage?: { plates(): { text?: string; owner?: number }[] } })
            .__nameplateStage?.plates() ?? []
        ).map((p) => ({ owner: p.owner, text: p.text })),
      }));
      stops.push({
        stop: i,
        tappedAt: i === 0 ? null : { x: px, y: py },
        oreHudRect: ore?.bounds ?? null,
        measured,
        drawnIntoTheCounterRect: collisions,
        elements: rows.map((r) => r.id),
        ...state,
      });
      if (
        measured &&
        (best === null || measured.warm > best.warm || (measured.warm === best.warm && measured.lit > best.lit))
      ) {
        best = { name, lit: measured.lit, warm: measured.warm };
      }
    }

    const withSomething = stops
      .map((s, i) => ({ stop: i, collisions: (s as { drawnIntoTheCounterRect: unknown[] }).drawnIntoTheCounterRect }))
      .filter((s) => s.collisions.length > 0);

    note(`${profile.id}-ore-counter`, {
      profile: profile.label,
      boot: '?debug=1 on the production bundle (no ?freeze — the build stamp is in frame)',
      staged: `__oreHudStage.mine(37) — 37 ore in the hold, ship parked away from home: ${JSON.stringify(staged)}`,
      method:
        "a0-111's measurement, unchanged: fourteen stops around the field reached by real taps (Tap Commander, the shipped default), with every other registered element's rect intersected against the counter's own rect at each stop",
      // The headline number, next to the one it is being compared with.
      stopsWithSomethingInTheCounterRect: withSomething.length,
      stopsSampled: heading.length,
      a0111Baseline: profile.id.startsWith('desktop') ? '3 of 14 desktop stops' : '1 of 14 phone stops',
      busiestBackground: best,
      framesWithSomethingDrawnIntoTheCounter: withSomething,
      stops,
    });
    await context.close();
  });
}
