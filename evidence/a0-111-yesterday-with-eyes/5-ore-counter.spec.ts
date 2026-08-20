/**
 * evidence/a0-111-yesterday-with-eyes/5-ore-counter.spec.ts — the ore counter,
 * and what is behind it. OWNER: QA Manager (a0-111).
 *
 * a0-99's finding, in its own words: *"The ore counter has no plate behind it: on
 * this frame it sits on an asteroid, with a yellow ore crystal and a gold vein
 * ring beside its own yellow numeral."* a0-102 shipped a ground under it. The
 * brief asks for the counter photographed with that ground, **ideally with an
 * asteroid behind it — that was the original finding** — so a frame of the
 * counter over empty black space would not answer the question that was asked.
 *
 * ── FINDING THE FRAME, RATHER THAN HOPING FOR ONE ───────────────────────────
 * The counter is screen-space top-left; what is behind it is wherever the camera
 * happens to be pointing. So this does not take one frame and hope. It flies the
 * ship around the field with REAL taps (Tap Commander is the shipped default on
 * both form factors since a0-30 — a tap is a move order, which is a thing a
 * player does with a thumb), samples a frame at each stop, and MEASURES the
 * background under the counter's own registry rect: how many of those pixels are
 * something other than the near-black backdrop.
 *
 * The busiest stop is the frame the attestation is written from, and the whole
 * table goes in the readback so a reader can see it was chosen by measurement and
 * not by taste. If every stop comes back empty, that is what the note will say.
 *
 * Nothing about the HUD is staged. `__oreHudStage.mine(ore)` puts ore in the hold
 * and parks the ship away from home — the same shipped seam the ore-deposit
 * captures have always used — so the counter has a number to draw. Where the
 * counter is drawn, and what it draws behind itself, is entirely the HUD's own.
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

/** How much of a rect is NOT the flat backdrop, and how much of it leans warm.
 *
 *  "Warm" is the question the a0-99 finding turns on: an asteroid in this game is
 *  rock plus a yellow ore vein, and the counter's own numeral is yellow, so a
 *  background with warm pixels in it is the background that made the counter hard
 *  to read. Plain and unweighted — a pixel counts as lit if any channel is above
 *  a floor the backdrop never reaches, and warm if red leads blue by a margin. */
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
 *  a0-99's tool, kept. "Drawn over" is, mechanically, a non-empty intersection
 *  of two rendered rects. */
function overlap(a: LayoutRow['bounds'], b: LayoutRow['bounds']): LayoutRow['bounds'] | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bot = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || bot <= y) return null;
  return { x, y, width: r - x, height: bot - y };
}

for (const profile of PROFILES) {
  test(`a0-111 the ore counter and its ground — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);

    // A hold to count, and a ship away from home. Both shipped seams.
    const staged = await page.evaluate(() => window.__oreHudStage!.mine(37));
    await settleFrames(page, 10);
    await park(page);

    const o = await origin(page);
    // Nine stops around the field, each reached by a real tap at a point on the
    // glass. The ring of directions is deliberate: the camera is ship-locked, so
    // flying the ship is the only way to change what is behind the corner.
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
      // Anything else the client drew into the counter's own rect this frame.
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
      if (measured && (best === null || measured.warm > best.warm || (measured.warm === best.warm && measured.lit > best.lit))) {
        best = { name, lit: measured.lit, warm: measured.warm };
      }
    }

    note(`${profile.id}-ore-counter`, {
      profile: profile.label,
      boot: '?debug=1 on the production bundle (no ?freeze — the build stamp is in frame)',
      staged: `__oreHudStage.mine(37) — 37 ore in the hold, ship parked away from home: ${JSON.stringify(staged)}`,
      method:
        "nine stops around the field reached by real taps (Tap Commander, the shipped default); at each stop the counter's own registry rect is measured for how much of the background behind it is lit and how much of it is warm",
      busiestBackground: best,
      // Every frame in which something else was drawn into the counter's own
      // rect, gathered so the answer is arithmetic rather than an impression.
      framesWithSomethingDrawnIntoTheCounter: stops
        .map((s, i) => ({ stop: i, collisions: (s as { drawnIntoTheCounterRect: unknown[] }).drawnIntoTheCounterRect }))
        .filter((s) => s.collisions.length > 0),
      stops,
    });
    await context.close();
  });
}
