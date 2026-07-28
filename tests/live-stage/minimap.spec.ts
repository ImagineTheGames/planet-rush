/**
 * tests/live-stage/minimap.spec.ts — the minimap, drawn and driven on the REAL
 * booted client. OWNER: UI Engineer (GDD §2.2; field request v0.2.2).
 *
 * The model is unit-green (src/ui/minimap.test.ts) — the fit, the two-state
 * toggle, the scene. What a unit test cannot reach is the last mile: that the
 * shipped bundle routes a REAL click into the toggle, redraws the two states, and
 * tracks the local ship's dot as it moves. This spec proves exactly that, with
 * real input (the p1a rule):
 *
 *   - a click on the collapsed corner square EXPANDS the overlay;
 *   - a click on the overlay COLLAPSES it again;
 *   - the local ship's dot MOVES on the map as the player thrusts (two frames).
 *
 * It reads the drawn state back through the UI lane's `__minimapStage` seam
 * (installed in src/main.ts, reading `Hud.debugMinimap()`), which reports the
 * active rect (so the test knows where to click), the toggle state, and the
 * own-ship dot's screen position. Runs WITHOUT `?freeze=1`: the ship's motion and
 * the toggle both live on the running loop, which a pinned frame cannot show.
 *
 * Desktop profile (the live-stage config): logical == physical (no landscape
 * rotation), so the rect the seam reports maps straight to click coordinates.
 */
import { test, expect, type Page } from '@playwright/test';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface DrawnMinimap {
  expanded: boolean;
  rect: Rect;
  ownDot: { x: number; y: number } | null;
  stationCount: number;
  shipCount: number;
  oreCount: number;
  satelliteCount: number;
  coverageCount: number;
  collapseRing: boolean;
}
interface MinimapStage {
  state(): DrawnMinimap;
  buildSatellite(): { satRange: number; enemyDist: number } | null;
  killSatellite(): boolean;
}
interface StageWindow {
  __minimapStage?: MinimapStage;
}
declare const window: Window & StageWindow;

const CENTRE = (r: Rect): { x: number; y: number } => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

async function bootMinimap(page: Page): Promise<DrawnMinimap> {
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__minimapStage?.state === 'function', undefined, {
    timeout: 20_000,
  });
  // Wait until the world is wired (stations fed) and the minimap is actually drawing.
  await page.waitForFunction(
    () => {
      const s = window.__minimapStage?.state();
      return !!s && s.rect.width > 0 && s.stationCount > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  return page.evaluate(() => window.__minimapStage!.state());
}

test.describe('the minimap draws and toggles on the real booted client', () => {
  test('a real click toggles collapsed ↔ expanded', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const initial = await bootMinimap(page);
    expect(initial.expanded, 'the minimap boots collapsed').toBe(false);
    expect(initial.ownDot, 'the local ship dot is drawn on the corner map').not.toBeNull();

    // --- Click the collapsed corner → the overlay EXPANDS --------------------
    const collapsedCentre = CENTRE(initial.rect);
    await page.mouse.click(collapsedCentre.x, collapsedCentre.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === true, undefined, {
      timeout: 10_000,
    });
    const expanded = await page.evaluate(() => window.__minimapStage!.state());
    expect(expanded.expanded, 'a click on the corner expands the overlay').toBe(true);
    // The overlay is larger than the corner square it replaced.
    expect(expanded.rect.width, 'the overlay is bigger than the corner').toBeGreaterThan(initial.rect.width);

    await page.screenshot({ path: 'tests/live-stage/minimap-expanded-evidence.png' });

    // --- Click the overlay → it COLLAPSES back --------------------------------
    const overlayCentre = CENTRE(expanded.rect);
    await page.mouse.click(overlayCentre.x, overlayCentre.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === false, undefined, {
      timeout: 10_000,
    });
    const collapsed = await page.evaluate(() => window.__minimapStage!.state());
    expect(collapsed.expanded, 'a click on the overlay collapses it again').toBe(false);

    await page.screenshot({ path: 'tests/live-stage/minimap-collapsed-evidence.png' });

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });

  test('the local ship dot tracks the player thrusting (two frames)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const initial = await bootMinimap(page);
    expect(initial.ownDot, 'the local ship dot is drawn').not.toBeNull();
    const before = initial.ownDot!;

    // Real input: hold thrust (W) so the local ship flies across the arena, then
    // read the own-ship dot again — it must have moved on the map (dots track sim
    // positions, GDD §2.2). Keyboard is genuine device input, the p1a rule.
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (b) => {
        const dot = window.__minimapStage!.state().ownDot;
        if (!dot) return false;
        const dx = dot.x - b.x;
        const dy = dot.y - b.y;
        return dx * dx + dy * dy > 4; // moved > 2px on the minimap
      },
      before,
      { timeout: 10_000 },
    );
    const moved = await page.evaluate(() => window.__minimapStage!.state().ownDot);
    await page.keyboard.up('KeyW');

    expect(moved, 'the own-ship dot is still drawn after moving').not.toBeNull();
    const dx = moved!.x - before.x;
    const dy = moved!.y - before.y;
    expect(Math.hypot(dx, dy), 'the own-ship dot moved as the ship thrust').toBeGreaterThan(2);

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });

  test('the minimap is fog-of-war: a radar satellite reveals coverage, killing it collapses it', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    // The map boots as fog-of-war (feature f1): coverage is the local player's own
    // ship + station discs, so there is always at least one disc. We wait for that,
    // then STAGE a satellite through the seam — the fog itself is computed by the
    // real pipeline (`../sim/sensing` → `feedMinimap` → the pure scene), so the
    // seam cannot fake the wiring it proves.
    const before = await bootMinimap(page);
    expect(before.coverageCount, 'fog is active — the local player already senses a slice').toBeGreaterThan(0);

    // --- Build a satellite → a LARGE coverage disc appears + a distant enemy is
    //     revealed under it (the enemy is parked in the satellite-only band) ------
    const staged = await page.evaluate(() => window.__minimapStage!.buildSatellite());
    expect(staged, 'a local station + an enemy were available to stage').not.toBeNull();
    // The staged geometry is honest: the enemy sits inside the satellite's reach.
    expect(staged!.enemyDist, 'enemy is within the satellite sensor range').toBeLessThan(staged!.satRange);

    await page.waitForFunction(
      (b) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount > b.coverageCount && s.shipCount > b.shipCount;
      },
      before,
      { timeout: 10_000 },
    );
    const withSat = await page.evaluate(() => window.__minimapStage!.state());
    expect(withSat.coverageCount, 'the satellite adds a coverage disc').toBeGreaterThan(before.coverageCount);
    expect(withSat.satelliteCount, 'the satellite itself draws as a dot').toBeGreaterThan(before.satelliteCount);
    expect(withSat.shipCount, 'the distant enemy is revealed under the new coverage').toBeGreaterThan(
      before.shipCount,
    );

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-coverage-evidence.png' });

    // --- Kill the satellite → its coverage collapses the same tick; the distant
    //     enemy it revealed drops off the map (the satellite-killed moment) -------
    const killed = await page.evaluate(() => window.__minimapStage!.killSatellite());
    expect(killed, 'the staged satellite was there to kill').toBe(true);

    await page.waitForFunction(
      (w) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount < w.coverageCount && s.shipCount < w.shipCount;
      },
      withSat,
      { timeout: 10_000 },
    );
    const afterKill = await page.evaluate(() => window.__minimapStage!.state());
    expect(afterKill.coverageCount, 'the satellite coverage disc is gone').toBeLessThan(withSat.coverageCount);
    expect(afterKill.shipCount, 'the distant enemy vanished with its coverage').toBeLessThan(withSat.shipCount);

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-collapsed-evidence.png' });

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The TOUCH profile — brief item 4, "Real input, both profiles". The fog wiring
// is device-independent (feedMinimap does not branch on touch), but the toggle
// GESTURE and the collapsed-corner geometry are: a phone gets a *really small*
// corner left of the FIRE column, and the toggle is a tap, not a click. This block
// overrides the project's desktop `use` with a landscape-phone touch context — the
// spec owns which profiles ITS tests exercise, so the shared live-stage config
// (Platform's lane) stays desktop — and drives the SAME build→reveal→kill cycle
// with a REAL TAP toggle, proving the sensed-state reads on touch too and both
// states fog identically on a phone.
// ---------------------------------------------------------------------------
test.describe('the minimap is fog-of-war on TOUCH too (real tap input, brief item 4)', () => {
  test.use({
    // A landscape handset (post landscape-lock, so no rotation prompt) — the wider
    // of the two profiles the model pins the placement on (PHONE_WIDE).
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('a real tap toggles the fogged corner; a satellite reveals coverage, killing it collapses it', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const before = await bootMinimap(page);
    expect(before.expanded, 'the touch minimap boots collapsed').toBe(false);
    expect(before.coverageCount, 'fog is active on touch — the player already senses a slice').toBeGreaterThan(0);
    // The touch corner is the *really small* glance object (the developer spec), so
    // this is genuinely the phone geometry, not the desktop square.
    expect(before.rect.width, 'the collapsed corner is the small touch square').toBeLessThan(120);

    // --- Real TOUCH input: tap the collapsed corner → the overlay EXPANDS, and the
    //     expanded overlay is STILL fog-of-war (both states fog identically) --------
    const corner = CENTRE(before.rect);
    await page.touchscreen.tap(corner.x, corner.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === true, undefined, {
      timeout: 10_000,
    });
    const expanded = await page.evaluate(() => window.__minimapStage!.state());
    expect(expanded.expanded, 'a real tap on the corner expands the overlay').toBe(true);
    expect(expanded.rect.width, 'the overlay is bigger than the touch corner').toBeGreaterThan(before.rect.width);
    expect(expanded.coverageCount, 'the expanded overlay is fog-of-war too — coverage still reads').toBeGreaterThan(
      0,
    );
    // Tap the overlay back to the corner so the reveal cycle plays on the collapsed
    // glance map (the state a phone player actually lives in).
    const overlayCentre = CENTRE(expanded.rect);
    await page.touchscreen.tap(overlayCentre.x, overlayCentre.y);
    await page.waitForFunction(() => window.__minimapStage!.state().expanded === false, undefined, {
      timeout: 10_000,
    });
    const collapsed = await page.evaluate(() => window.__minimapStage!.state());

    // --- Build a satellite → a coverage disc + a distant enemy appear on the touch
    //     map, exactly as on desktop (the wiring is one code path) ------------------
    const staged = await page.evaluate(() => window.__minimapStage!.buildSatellite());
    expect(staged, 'a local station + an enemy were available to stage').not.toBeNull();
    expect(staged!.enemyDist, 'enemy is within the satellite sensor range').toBeLessThan(staged!.satRange);

    await page.waitForFunction(
      (b) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount > b.coverageCount && s.shipCount > b.shipCount;
      },
      collapsed,
      { timeout: 10_000 },
    );
    const withSat = await page.evaluate(() => window.__minimapStage!.state());
    expect(withSat.coverageCount, 'the satellite adds a coverage disc on touch').toBeGreaterThan(
      collapsed.coverageCount,
    );
    expect(withSat.shipCount, 'the distant enemy is revealed under the new coverage').toBeGreaterThan(
      collapsed.shipCount,
    );

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-touch-coverage-evidence.png' });

    // --- Kill the satellite → its coverage collapses; the distant enemy drops -----
    const killed = await page.evaluate(() => window.__minimapStage!.killSatellite());
    expect(killed, 'the staged satellite was there to kill').toBe(true);

    await page.waitForFunction(
      (w) => {
        const s = window.__minimapStage!.state();
        return s.coverageCount < w.coverageCount && s.shipCount < w.shipCount;
      },
      withSat,
      { timeout: 10_000 },
    );
    const afterKill = await page.evaluate(() => window.__minimapStage!.state());
    expect(afterKill.coverageCount, 'the satellite coverage disc is gone on touch').toBeLessThan(
      withSat.coverageCount,
    );
    expect(afterKill.shipCount, 'the distant enemy vanished with its coverage').toBeLessThan(withSat.shipCount);

    await page.screenshot({ path: 'tests/live-stage/minimap-fog-touch-collapsed-evidence.png' });

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
