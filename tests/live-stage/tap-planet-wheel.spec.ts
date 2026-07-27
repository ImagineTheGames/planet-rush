/**
 * tests/live-stage/tap-planet-wheel.spec.ts — TAP YOUR PLANET to open the build
 * wheel, on the REAL booted client with REAL taps. OWNER: Platform Engineer
 * (developer p10 ratification: "You should be able to click on your planet if you
 * are close enough to open the build menu, and then click out of it to close it").
 *
 * The pilot's tap semantics are unit-green (`src/platform/tap-pilot.test.ts`,
 * `resolveTap`): near-tap opens, far-tap moves, outside-tap closes without moving,
 * wheel taps pass through. What a unit test cannot reach is that the SHIPPED bundle
 * routes a genuine pointer press on the drawn planet into the SAME wheel E / Y / the
 * BUILD button open, buys a turret through the wheel's own funnel, and closes on a
 * press off the wheel — the "dark matter" only a boot proves.
 *
 * Every press here is a REAL synthesized `pointerdown` at a LOGICAL screen point the
 * `?debug=1` `__tapCommanderStage` hands back (the same event a mouse click / thumb
 * tap fires, into the same `main.ts` handler) — NEVER a debug method that fakes the
 * order. It runs WITHOUT `?freeze` on purpose: the wheel's build order only drains on
 * a live tick, and "moving again" only shows in motion. The seam docks the ship at
 * its own planet in the TAP scheme, funds the bank, and clears the field so the
 * planet tap is unambiguous; we watch the live sim + wheel state throughout.
 */
import { test, expect } from '@playwright/test';

interface Vec2 {
  x: number;
  y: number;
}
type TargetKind = 'ship' | 'turret' | 'core' | 'asteroid' | 'planet';

/** One turret's ore cost, mirroring the sim's ratified `TURRET.cost` (kept local so
 *  the spec reads as a black-box check of the shipped number). */
const TURRET_COST = 3;

/** The `?debug=1`-only seam this spec drives (installed in `installTapCommanderStage`,
 *  `src/main.ts`) — staging through the client's real pilot + wheel and reading back
 *  plain sim/wheel data behind the flag. */
interface TapCommanderStage {
  setScheme(scheme: 'sticks' | 'tap'): void;
  stagePlanetWheel(): {
    planetPoint: Vec2;
    turretWedgePoint: Vec2;
    outsidePoint: Vec2;
    movePoint: Vec2;
    banked: number;
    turretCount: number;
  } | null;
  wheelState(): { open: boolean; panelOpen: boolean };
  buildReadout(): { banked: number; turretCount: number } | null;
  order(): { kind: 'waypoint' | 'target' | 'none'; at: Vec2 | null; ref: { kind: TargetKind; id: number } | null };
  readout(): { scheme: 'sticks' | 'tap'; shipPos: Vec2 | null; firing: boolean; alive: boolean };
}
interface StageWindow {
  __tapCommanderStage?: TapCommanderStage;
}
declare const window: Window & StageWindow;

/** A REAL press: a synthesized `pointerdown` at a LOGICAL point, into the same
 *  `main.ts` canvas handler a mouse click / thumb tap hits (the p1a rule). NOT a
 *  debug order method — this is the wiring only a boot exercises. */
async function realTap(page: import('@playwright/test').Page, at: Vec2): Promise<void> {
  await page.evaluate((p) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas to tap');
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: p.x,
        clientY: p.y,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
        cancelable: true,
      }),
    );
  }, at);
}

test.describe('Tap your planet to open the build wheel on the real booted client', () => {
  test('fly-to planet → tap → wheel → buy turret → tap outside → closed, moving again', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    // Live sim (no ?freeze): the build order and the pilot both need the loop running.
    await page.goto('/?debug=1', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__tapCommanderStage?.stagePlanetWheel === 'function', undefined, {
      timeout: 20_000,
    });

    // Switch to the tap ("click-to-move") scheme the settings row selects, then dock
    // the ship at its own planet with a funded bank and a cleared field.
    const staged = await page.evaluate(() => {
      window.__tapCommanderStage!.setScheme('tap');
      return window.__tapCommanderStage!.stagePlanetWheel();
    });
    expect(staged, 'the seam docked the ship at its own planet').not.toBeNull();

    // The wheel starts CLOSED — the real tap must be what opens it.
    const before = await page.evaluate(() => window.__tapCommanderStage!.wheelState());
    expect(before.open, 'the wheel is closed before the tap').toBe(false);

    // --- Tap your planet in build range → the Build wheel opens (developer p10 §1) ---
    await realTap(page, staged!.planetPoint);
    await page.waitForFunction(() => window.__tapCommanderStage!.wheelState().open === true, undefined, {
      timeout: 8_000,
    });

    // --- Buy a turret through the OPEN wheel's own funnel (a real press on the wedge) --
    const buildBefore = await page.evaluate(() => window.__tapCommanderStage!.buildReadout());
    expect(buildBefore, 'a ship + planet to build at').not.toBeNull();
    await realTap(page, staged!.turretWedgePoint);
    // The buy drains on a live tick: the bank drops by exactly one turret's cost and
    // the planet's turret count (queued job included) rises.
    await page.waitForFunction(
      (b) => {
        const r = window.__tapCommanderStage!.buildReadout();
        return !!r && r.banked <= b.banked - 1 && r.turretCount > b.turretCount;
      },
      buildBefore!,
      { timeout: 8_000 },
    );
    const buildAfter = await page.evaluate(() => window.__tapCommanderStage!.buildReadout());
    expect(buildAfter!.banked, 'one turret spent exactly its cost from the bank').toBeCloseTo(
      buildBefore!.banked - TURRET_COST,
      5,
    );
    expect(buildAfter!.turretCount, 'a turret was placed at the planet').toBe(buildBefore!.turretCount + 1);

    await page.screenshot({ path: 'tests/live-stage/tap-planet-wheel-evidence.png' });

    // --- Tap OUTSIDE the wheel → it closes, and does NOT double as a move (§2) --------
    await realTap(page, staged!.outsidePoint);
    await page.waitForFunction(() => window.__tapCommanderStage!.wheelState().open === false, undefined, {
      timeout: 8_000,
    });
    const dismissed = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(dismissed.kind, 'the dismiss tap placed no move order — one tap dismisses').toBe('none');

    // --- Tap empty space → the ship flies again (developer §2, "the next tap acts") --
    const shipAtClose = (await page.evaluate(() => window.__tapCommanderStage!.readout())).shipPos!;
    await realTap(page, staged!.movePoint);
    const moveOrder = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(moveOrder.kind, 'the fresh tap is a move order').toBe('waypoint');
    // The ship closes up-field toward the tapped point — moving again.
    await page.waitForFunction(
      (y0) => {
        const r = window.__tapCommanderStage!.readout();
        return !!r.shipPos && r.shipPos.y < y0 - 40;
      },
      shipAtClose.y,
      { timeout: 8_000 },
    );

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
