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
  collapseRing: boolean;
}
interface MinimapStage {
  state(): DrawnMinimap;
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
});
