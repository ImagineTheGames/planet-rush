/**
 * tests/live-stage/radar-wedge.spec.ts — the RESTORED RADAR (satellite) build wedge,
 * verified in the REAL booted client with REAL clicks. OWNER: Gameplay Engineer
 * (p13 regression, feature f1, GDD §2.5).
 *
 * The regression this file exists for: when the manual BANK segment was cut from the
 * wheel, `satellite` was swept out alongside it in a bare `Exclude<BuildItem, 'bank' |
 * 'satellite'>` — the sim still built satellites (bots do), but the PLAYER lost the
 * wedge, silently, for four versions, with no test to notice. The pure model is
 * unit-green again (src/ui/build-wheel.test.ts) and a structural guard now fails the
 * build if any buildable item loses its wedge; what only a boot can prove is the whole
 * LIVE wiring the wedge vanished inside of — that the shipped bundle DRAWS the fifth
 * wedge, routes a genuine pointer press on it into one satellite build order, the
 * sim's minimap fog then LIFTS (a new coverage disc), and when the satellite is shot
 * down the wedge RE-ARMS while the fog RETURNS. That is exactly the "green model, dead
 * on the real client" dark matter a unit test cannot reach.
 *
 * Every press here is a REAL synthesized `pointerdown` at the wedge's drawn centre
 * (the p1a rule) — the same event a mouse click / thumb tap fires, into the same
 * `main.ts` handler — NOT a debug method that fakes the order. It runs WITHOUT
 * `?freeze` on purpose: a frozen sim never drains the wheel order and never constructs
 * the satellite, so the whole build has to run live. The ship is parked docked and
 * given no input, so the only thing placing an order and lifting the fog is the click.
 *
 * Driven through the `?debug=1` `window.__radarWedgeStage` seam (installed in
 * `main.ts`, the same discipline as `__repairStage`): it parks the ship docked, funds
 * the bank, opens the Build wheel, hands back the wedge's DRAWN "0/1" line and the live
 * minimap fog counts, gives the client point to click, and shoots the built satellite
 * down. The fog is computed by the real minimap pipeline, so the seam cannot fake the
 * wiring it proves.
 */
import { test, expect } from '@playwright/test';

/** The sim's ratified radar-satellite balance, kept local so the spec reads as a
 *  black-box check of the shipped numbers (feature f1). */
const RADAR_COST = 6;
const RADAR_CAP = 1;

/** The `?debug=1`-only radar-wedge seam this spec drives (mirrors
 *  `installRadarWedgeStage` in `src/main.ts`). */
interface RadarWedgeStage {
  /** Park docked at rest, bank `banked` ore, lift station spawn protection, open the
   *  Build wheel. Returns the satellite cost + staged bank, or null with no ship/station. */
  stage(banked: number): { cost: number; banked: number } | null;
  /** The RADAR wedge centre in CLIENT (physical CSS) space — the same point rotated
   *  back through the landscape lock, so a real tap lands on it on BOTH form factors. */
  radarWedgeClientPoint(): { x: number; y: number } | null;
  /** The RADAR wedge the real view drew this frame — its label, its "0/1" count line,
   *  whether it drew bright (pressable), and its cost. */
  wedge(): { label: string; sub: string; ready: boolean; cost: number | null } | null;
  /** The live minimap fog counts this frame: coverage discs drawn (grows when the
   *  satellite goes live) and sensed radar-satellite dots. */
  fog(): { coverageCount: number; satelliteCount: number } | null;
  /** Satellites standing OR building on the local station (the sim's count — 1 the
   *  instant a build order lands, which the wedge's "0/1" mirrors). */
  satelliteCount(): number;
  /** Shoot the built satellite down (zero its HP): it stops being a sensor source, its
   *  coverage disc collapses, and the wedge re-arms. True if one was there to kill. */
  killSatellite(): boolean;
}
interface StageWindow {
  __radarWedgeStage?: RadarWedgeStage;
}
declare const window: Window & StageWindow;

/** Boot the real client WITHOUT ?freeze — the sim steps, so a real press places an
 *  order that resolves and the satellite actually constructs against sim state. */
async function boot(page: import('@playwright/test').Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__radarWedgeStage?.stage === 'function', undefined, {
    timeout: 20_000,
  });
  return pageErrors;
}

/** Press the RADAR wedge through the REAL door: a synthesized `pointerdown` at the
 *  exact CLIENT point the wedge is drawn, into the same `main.ts` handler a real click
 *  hits — NOT a debug order method. This is the wiring the regression was about (the
 *  wedge that was not drawn at all, so no press could ever reach it). */
async function realTapRadar(page: import('@playwright/test').Page): Promise<void> {
  const point = await page.evaluate(() => window.__radarWedgeStage!.radarWedgeClientPoint());
  if (!point) throw new Error('no RADAR wedge to tap');
  await page.evaluate((p) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas to tap');
    const ev = new PointerEvent('pointerdown', {
      clientX: p.x,
      clientY: p.y,
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(ev);
  }, point);
}

/**
 * The full restore, driven through the REAL door on the REAL bundle:
 *
 *   RADAR wedge drawn "0/1" pressable  →  a real click places one build order (the
 *   wedge caps to "1/1")  →  the satellite constructs and the minimap fog LIFTS (a new
 *   coverage disc)  →  the satellite is shot down and the fog RETURNS  →  the wedge
 *   RE-ARMS to "0/1", pressable again.
 *
 * The fog counts are read off the real minimap pipeline (`fog()`), and the satellite
 * builds live (no ?freeze), so nothing here is faked. Run on BOTH form factors so the
 * click-to-build wiring is proven on the two devices the game ships to.
 */
async function driveRadarRestoreCycle(page: import('@playwright/test').Page): Promise<void> {
  const pageErrors = await boot(page);

  // Dock at the own station and open the wheel, banking enough for TWO satellites
  // (RADAR costs 6): one built here, and the fare still in the bank so the re-armed
  // wedge is genuinely buildable again after the first is shot down — the "rebuildable
  // after it's shot down" the regression brief names, not merely un-capped-but-broke.
  const staged = await page.evaluate(() => window.__radarWedgeStage!.stage(20));
  expect(staged, 'the local ship and its station were available to stage').not.toBeNull();
  expect(staged!.cost, 'the wheel prices RADAR at the sim satellite cost').toBe(RADAR_COST);

  // The RESTORED wedge draws on the real bundle: labelled RADAR, its "0/1" count line,
  // pressable, priced at a bare 6 — the exact wedge that was silently gone.
  const wedge = await page
    .waitForFunction(() => window.__radarWedgeStage!.wedge(), undefined, { timeout: 20_000 })
    .then((h) => h.jsonValue());
  expect(wedge!.label, 'the fifth wedge is drawn and labelled in words').toBe('RADAR');
  expect(wedge!.sub, 'it shows the u2-02 "0/1" count before any is built').toBe(`0/${RADAR_CAP}`);
  expect(wedge!.ready, 'a funded, uncapped RADAR wedge is pressable').toBe(true);
  expect(wedge!.cost, 'the only cost numeral is the bare satellite cost').toBe(RADAR_COST);

  // Baseline fog: no satellite up yet, whatever coverage the ship/station already give.
  const baseline = await page.evaluate(() => window.__radarWedgeStage!.fog());
  expect(baseline!.satelliteCount, 'no radar satellite is sensed before the build').toBe(0);
  const baseCoverage = baseline!.coverageCount;

  // --- A REAL click places one satellite build order ------------------------------
  await realTapRadar(page);

  // The order lands: the sim's count ticks to one (it counts building satellites) and
  // the wedge caps to "1/1", disabled — a second build is refused because coverage now
  // exists, exactly as the model says.
  await page.waitForFunction(() => window.__radarWedgeStage!.satelliteCount() === 1, undefined, {
    timeout: 15_000,
  });
  const capped = await page
    .waitForFunction(
      () => {
        const w = window.__radarWedgeStage!.wedge();
        return w && !w.ready ? w : null;
      },
      undefined,
      { timeout: 15_000 },
    )
    .then((h) => h.jsonValue());
  expect(capped!.sub, 'the wedge shows "1/1" once a satellite is built or building').toBe(`1/${RADAR_CAP}`);
  expect(capped!.ready, 'at the cap the wedge is disabled-gray, not a dangling press').toBe(false);

  // --- The satellite constructs and the fog LIFTS ---------------------------------
  // Construction takes real seconds (feature f1 buildTime = 12 s); the coverage disc
  // appears when the satellite goes live, computed by the real minimap pipeline.
  const lifted = await page
    .waitForFunction(
      (base) => {
        const f = window.__radarWedgeStage!.fog();
        return f && f.satelliteCount >= 1 && f.coverageCount > base ? f : null;
      },
      baseCoverage,
      { timeout: 30_000 },
    )
    .then((h) => h.jsonValue());
  expect(lifted!.satelliteCount, 'the built satellite is sensed on the minimap').toBeGreaterThanOrEqual(1);
  expect(lifted!.coverageCount, 'building RADAR paints a new coverage disc — the fog lifts').toBeGreaterThan(
    baseCoverage,
  );
  const liftedCoverage = lifted!.coverageCount;

  await page.screenshot({ path: 'tests/live-stage/radar-wedge-evidence.png' });

  // --- The satellite is shot down and the fog RETURNS -----------------------------
  const killed = await page.evaluate(() => window.__radarWedgeStage!.killSatellite());
  expect(killed, 'there was a built satellite to shoot down').toBe(true);
  const returned = await page
    .waitForFunction(
      (lift) => {
        const f = window.__radarWedgeStage!.fog();
        return f && f.satelliteCount === 0 && f.coverageCount < lift ? f : null;
      },
      liftedCoverage,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(returned!.satelliteCount, 'the killed satellite stops being sensed').toBe(0);
  expect(returned!.coverageCount, 'its coverage disc collapses — the fog returns').toBeLessThan(liftedCoverage);

  // --- The wedge RE-ARMS: "1/1" → "0/1", pressable again --------------------------
  await page.waitForFunction(() => window.__radarWedgeStage!.satelliteCount() === 0, undefined, {
    timeout: 20_000,
  });
  const rearmed = await page
    .waitForFunction(
      () => {
        const w = window.__radarWedgeStage!.wedge();
        return w && w.ready ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(rearmed!.sub, 'the count drops back to "0/1" the frame the satellite dies').toBe(`0/${RADAR_CAP}`);
  expect(rearmed!.ready, 'the wedge is buildable again — the count IS the re-arm tell').toBe(true);

  expect(pageErrors, 'no page errors across the whole RADAR build/kill cycle').toEqual([]);
}

test('PC: the RADAR wedge draws "0/1", a real click builds it (fog lifts), and it re-arms when shot down', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await driveRadarRestoreCycle(page);
});

// The same restore on the two device profiles the mobile matrix contracts, at their
// real portrait pixels: under the landscape lock the wedge point is rotated back to
// physical space, so a real touch lands on the wedge the client drew — proving the
// fifth wedge is reachable by thumb, not just by mouse.
const PHONE_PROFILES = [
  { name: 'iPhone', width: 390, height: 844, dpr: 3 },
  { name: 'Pixel', width: 412, height: 915, dpr: 2.6 },
] as const;

for (const profile of PHONE_PROFILES) {
  test.describe(`phone profile — ${profile.name} (portrait, held)`, () => {
    test.use({
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: profile.dpr,
      viewport: { width: profile.width, height: profile.height },
    });

    test(`${profile.name}: a real touch on the RADAR wedge builds it and it re-arms when shot down`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await driveRadarRestoreCycle(page);
    });
  });
}
