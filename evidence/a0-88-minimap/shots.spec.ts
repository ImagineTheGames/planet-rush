/**
 * evidence/a0-88-minimap/shots.spec.ts — OWNER: UI Engineer (a0-88).
 *
 * The frames the report is about:
 *
 * > *"the minimap shows two circles. ships should be a different icon though to
 * > differentiate. also it shows a circle around my ship and a circle around the
 * > station not sure what the station circle is but it's unneeded"*
 *
 * Every frame is shot at **798×384 dpr 3** — the developer's own phone viewport
 * from the screenshot (`evidence/a0-74-viewport/profiles.ts` already carries it as
 * `phone-798x384`) — on the frozen, seeded scene, so the only thing that differs
 * between the `before` and `after` sets is the branch.
 *
 * The same spec runs against both halves. It uses only seams that exist on
 * `origin/main` (`__minimapStage`, `__viewStage`), because a capture script that
 * needs the change in order to run cannot photograph the thing before the change.
 *
 * **Every rung.** The report came in with a0-74's `2×` active, so the minimap is
 * shot at all three rungs of `VIEW_ZOOM_STEPS`. The rung is seated through
 * `__viewStage.setZoom`, which is the same `setViewZoom` a real tap on the
 * control runs — camera, storage and all.
 *
 * Usage (from the repo root):
 *   npx playwright test --config evidence/a0-88-minimap/playwright.config.ts
 *   A0_88_LABEL=before A0_88_REUSE=1 PREVIEW_PORT=4289 npx playwright test \
 *     --config evidence/a0-88-minimap/playwright.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
/** `after` (this branch) or `before` (a worktree of origin/main). */
const LABEL = process.env.A0_88_LABEL ?? 'after';

/** The developer's viewport, from the screenshot the report came with. */
const PHONE = { width: 798, height: 384 };
const DPR = 3;

/** The frozen, seeded scene the goldens use. `gate=0` skips the title gate. */
const SCENE = '/?debug=1&freeze=1&gate=0';
/** The same scene with the sim RUNNING — the underway frame has to fly. */
const LIVE_SCENE = '/?debug=1&gate=0';

/** The rungs of the zoom ladder (`@ui/viewport` VIEW_ZOOM_STEPS). The report
 *  arrived at 2×; the map has to read at every one of them. */
const RUNGS = [1, 1.5, 2] as const;

/** What the minimap layer actually DREW, read off `Hud.debugMinimap`. */
interface Drawn {
  expanded: boolean;
  rect: { x: number; y: number; width: number; height: number };
  ownDot: { x: number; y: number } | null;
  stationCount: number;
  shipCount: number;
  oreCount: number;
  satelliteCount: number;
  coverageCount: number;
  collapseRing: boolean;
}

declare global {
  interface Window {
    __minimapStage?: {
      state(): Drawn;
      viewport(): { width: number; height: number };
      physicalPoint(x: number, y: number): { x: number; y: number };
      buildSatellite(): { satRange: number; enemyDist: number } | null;
    };
    __viewStage?: { setZoom(step: number): number; zoom(): number };
    /** Read-back ONLY here: `points()` re-stages the whole scene (it docks the
     *  ship and clears every asteroid), so the underway frame never calls it —
     *  it flies with a real tap on the canvas and reads the result back. */
    __tapCommanderStage?: {
      readout(): {
        scheme: 'sticks' | 'tap';
        shipPos: { x: number; y: number } | null;
        firing: boolean;
        alive: boolean;
      };
    };
  }
}

const readback: Record<string, unknown> = { label: LABEL, viewport: PHONE, dpr: DPR };

async function boot(page: Page): Promise<void> {
  await page.goto(SCENE);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => window.__minimapStage !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settleFrames(page, 16);
}

/** Seat a zoom rung through the shipped path and confirm it took. */
async function setZoom(page: Page, step: number): Promise<number> {
  const got = await page.evaluate((s) => window.__viewStage!.setZoom(s), step);
  await settleFrames(page, 8);
  expect(got).toBeCloseTo(step, 5);
  return got;
}

/**
 * Force the minimap's cached content to rebuild, by toggling the overlay shut and
 * open (or open and shut) with the REAL tap.
 *
 * This is not belt-and-braces. The content is a cached Graphics rebuilt every
 * `MINIMAP_REDRAW_TICKS` **sim ticks, or on a rect/state change**; under
 * `?freeze=1` the tick never advances, so a scene re-staged after boot would keep
 * showing the first rebuild while the numbers moved underneath it (a0-42 hit this
 * and wrote it down). A toggle is the state change that forces an honest rebuild,
 * through the same gesture a player uses.
 */
async function refresh(page: Page, wantExpanded: boolean): Promise<Drawn> {
  for (let i = 0; i < 3; i++) {
    const s = await page.evaluate(() => window.__minimapStage!.state());
    if (s.expanded === wantExpanded && i > 0) break;
    const p = await page.evaluate(
      (r) => window.__minimapStage!.physicalPoint(r.x + r.width / 2, r.y + r.height / 2),
      s.rect,
    );
    await page.mouse.click(p.x, p.y);
    await settleFrames(page, 8);
  }
  const out = await page.evaluate(() => window.__minimapStage!.state());
  expect(out.expanded).toBe(wantExpanded);
  return out;
}

/** Full frame + a clip of the minimap alone. At dpr 3 the clip comes out 3× its
 *  CSS size, which is what makes a 80 px corner map readable on the page. */
async function shoot(page: Page, name: string, drawn: Drawn): Promise<void> {
  writeFileSync(join(SHOTS, `${LABEL}-${name}-full.png`), await page.screenshot());
  const tl = await page.evaluate(
    (r) => window.__minimapStage!.physicalPoint(r.x, r.y),
    drawn.rect,
  );
  const br = await page.evaluate(
    (r) => window.__minimapStage!.physicalPoint(r.x + r.width, r.y + r.height),
    drawn.rect,
  );
  // A few px of air round the frame border so the chamfer and the edge are in.
  const pad = 4;
  const x = Math.max(0, Math.min(tl.x, br.x) - pad);
  const y = Math.max(0, Math.min(tl.y, br.y) - pad);
  const width = Math.min(PHONE.width - x, Math.abs(br.x - tl.x) + pad * 2);
  const height = Math.min(PHONE.height - y, Math.abs(br.y - tl.y) + pad * 2);
  writeFileSync(
    join(SHOTS, `${LABEL}-${name}-map.png`),
    await page.screenshot({ clip: { x, y, width, height } }),
  );
  readback[name] = { drawn, clip: { x, y, width, height } };
}

test.describe(`a0-88 — the minimap at 798×384 (${LABEL})`, () => {
  test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
  test.afterAll(() => {
    writeFileSync(join(SHOTS, `${LABEL}-readback.json`), JSON.stringify(readback, null, 2));
  });

  test.use({ viewport: PHONE, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });

  for (const rung of RUNGS) {
    const id = `${rung}x`.replace('.', '_');

    test(`collapsed corner map at ${rung}× — the frame the report is of`, async ({ page }) => {
      await boot(page);
      await setZoom(page, rung);
      const drawn = await refresh(page, false);
      // The frame must actually carry the three kinds and both discs, or it is
      // not evidence for anything.
      expect(drawn.ownDot).not.toBeNull(); // a SHIP
      expect(drawn.stationCount).toBeGreaterThan(0); // a STATION
      expect(drawn.oreCount).toBeGreaterThan(0); // ORE
      expect(drawn.coverageCount).toBeGreaterThanOrEqual(2); // both coverage discs
      await shoot(page, `collapsed-${id}`, drawn);
    });

    test(`expanded overlay at ${rung}× — the same decision, large enough to read`, async ({
      page,
    }) => {
      await boot(page);
      await setZoom(page, rung);
      const drawn = await refresh(page, true);
      expect(drawn.ownDot).not.toBeNull();
      expect(drawn.stationCount).toBeGreaterThan(0);
      expect(drawn.oreCount).toBeGreaterThan(0);
      expect(drawn.coverageCount).toBeGreaterThanOrEqual(2);
      await shoot(page, `expanded-${id}`, drawn);
    });
  }

  test('every mark at once — a satellite built, an enemy revealed under it', async ({ page }) => {
    // `buildSatellite` stages sim data only (push a satellite, park an enemy in
    // the band only its LARGE sensor reaches) and lets the shipped pipeline do the
    // fog — the same discipline every other stage seam here follows. It buys the
    // frame a fourth kind (the satellite), a second ship that is not mine, and a
    // third coverage disc, so all four marks and a three-lobed sensed region are
    // in one picture.
    await boot(page);
    await setZoom(page, 2);
    const built = await page.evaluate(() => window.__minimapStage!.buildSatellite());
    expect(built).not.toBeNull();
    const drawn = await refresh(page, true);
    expect(drawn.ownDot).not.toBeNull();
    expect(drawn.satelliteCount).toBeGreaterThan(0);
    expect(drawn.shipCount).toBeGreaterThan(0); // an enemy, revealed by the satellite
    expect(drawn.stationCount).toBeGreaterThan(0);
    expect(drawn.oreCount).toBeGreaterThan(0);
    expect(drawn.coverageCount).toBeGreaterThanOrEqual(3);
    readback.satellite = built;
    await shoot(page, 'all-marks-2x', drawn);
  });

  /**
   * The frame the frozen scene cannot give: the ship OUT from its home.
   *
   * Every other frame here is shot on the pinned scene, where the ship sits at
   * its station and the station's 300 disc is swallowed whole by the ship's 520.
   * That is the developer's own frame — but read alone it would let a reviewer
   * conclude the station's coverage was simply deleted. It was not: fly out and
   * it reappears as a bulge on the sensed region's far side, which is the whole
   * claim of §2 made visible rather than asserted.
   *
   * So this one runs UNFROZEN and flies with a REAL tap — Tap Commander is the
   * default scheme (GDD §2.4, amended 2026-08-12), so a tap on empty space is
   * "fly there". No seam moves the ship: `__tapCommanderStage` is read from only.
   * A live sim means the frame is not pixel-reproducible, and it does not need to
   * be — it is a legibility read, not a golden, and the flown distance is written
   * into the readback so the two halves can be compared honestly.
   */
  test('underway at 2× — the ship out from its home, and both coverages in one region', async ({
    page,
  }) => {
    await page.goto(LIVE_SCENE);
    await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
    await page.waitForFunction(
      () => window.__minimapStage !== undefined && window.__tapCommanderStage !== undefined,
      null,
      { timeout: 30_000 },
    );
    await page.evaluate(() => document.fonts?.ready);
    await settleFrames(page, 16);
    // Fly at the WIDEST rung: a tap's waypoint is a screen offset, so one gesture
    // buys more world at 1× and the flight is a handful of taps instead of thirty.
    // The frames themselves are shot at 2×, seated again below.
    await setZoom(page, 1);

    const start = await page.evaluate(() => window.__tapCommanderStage!.readout());
    expect(start.scheme).toBe('tap'); // the default; the tap below is the real gesture
    expect(start.shipPos).not.toBeNull();
    const home = start.shipPos!; // the spawn point IS the home station

    // Out to the left and a little down: empty space, clear of the ore readout and
    // pause button (top-left), the wave clock (top-centre), the BUILD button (the
    // left band, while docked) and the corner map (bottom-right) — so the tap
    // lands on the world and means exactly one thing.
    const AWAY = { x: Math.round(PHONE.width * 0.2), y: Math.round(PHONE.height * 0.62) };
    // Far enough out that the station's own 300 disc is no longer swallowed by the
    // ship's 520 — that is the whole point of the frame. (Past 820 the two stop
    // touching altogether and the region reads as two lobes, which is just as
    // honest a picture; whatever it comes out as is recorded, not steered.)
    const FLY_MIN = 700;
    const out = async (): Promise<number> => {
      const now = await page.evaluate(() => window.__tapCommanderStage!.readout());
      if (!now.shipPos || !now.alive) return 0; // dead ships respawn AT home
      return Math.hypot(now.shipPos.x - home.x, now.shipPos.y - home.y);
    };

    // This is a LIVE match: the bots are hunting, and a ship that dies out there
    // respawns at its home — which would quietly put the frame back at the exact
    // scene it is meant to contrast with. So the distance is re-read at the moment
    // of every screenshot, and a flight that ends in a respawn is simply flown
    // again. Nothing is staged; the ship only ever moves because a tap told it to.
    let flown = 0;
    for (let attempt = 0; attempt < 6 && flown < FLY_MIN; attempt++) {
      for (let i = 0; i < 40; i++) {
        await page.mouse.click(AWAY.x, AWAY.y);
        await settleFrames(page, 12);
        flown = await out();
        if (flown >= FLY_MIN) break;
      }
      await setZoom(page, 2); // the rung the report arrived at
      await settleFrames(page, 8);
      flown = await out();
      if (flown < FLY_MIN) await setZoom(page, 1); // died on the way — go again
    }
    expect(flown).toBeGreaterThan(FLY_MIN);

    const collapsed = await page.evaluate(() => window.__minimapStage!.state());
    expect(collapsed.expanded).toBe(false);
    expect(collapsed.coverageCount).toBeGreaterThanOrEqual(2);
    await shoot(page, 'underway-2x', collapsed);
    const flownCollapsed = await out();
    expect(flownCollapsed).toBeGreaterThan(FLY_MIN);

    // The same moment, opened with the real tap on the corner square.
    const corner = await page.evaluate(
      (r) => window.__minimapStage!.physicalPoint(r.x + r.width / 2, r.y + r.height / 2),
      collapsed.rect,
    );
    await page.mouse.click(corner.x, corner.y);
    await settleFrames(page, 8);
    const expanded = await page.evaluate(() => window.__minimapStage!.state());
    expect(expanded.expanded).toBe(true);
    expect(expanded.coverageCount).toBeGreaterThanOrEqual(2);
    const flownExpanded = await out();
    expect(flownExpanded).toBeGreaterThan(FLY_MIN);
    readback.flown = { atCollapsedShot: flownCollapsed, atExpandedShot: flownExpanded };
    await shoot(page, 'underway-expanded-2x', expanded);
  });
});
