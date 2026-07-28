/**
 * tests/live-stage/tap-autofire.spec.ts — Tap Commander AUTO-ENGAGES on the REAL
 * booted client. OWNER: Platform Engineer (developer p9-02: "You should be able to
 * move and it auto-fires at the closest high priority target... if ore is full it
 * shouldn't fire at asteroids automatically").
 *
 * The pilot's geometry and its auto-engage contract are unit-green
 * (`src/platform/tap-pilot.test.ts`), and the ladder's full-hold rock suppression is
 * sim-green (`tests/sim/target-priority.test.ts`, the SHARED ladder that names the
 * tap pilot). What neither can reach is that the SHIPPED bundle wires the two
 * together: a tap-to-move order that, with NO lock, holds the trigger and lets the
 * sim's Auto-aim ladder fire mid-flight — enemy en route → fires; hold full + only
 * rocks → holds fire; and the move continues throughout. This pins that end to end
 * through the client's own input funnel (`?debug=1` `__tapCommanderStage`), reading
 * back plain sim data. Runs WITHOUT `?freeze=1`: auto-engage only shows in motion.
 */
import { test, expect } from '@playwright/test';

interface Vec2 {
  x: number;
  y: number;
}
type TargetKind = 'ship' | 'turret' | 'core' | 'asteroid' | 'station';

interface TapCommanderStage {
  setScheme(scheme: 'sticks' | 'tap'): void;
  stageAutoEngage(): { ship: Vec2; bot: Vec2; botId: number; waypoint: Vec2 } | null;
  stageRockOnly(full: boolean): { ship: Vec2; rock: Vec2; waypoint: Vec2 } | null;
  tapWorld(x: number, y: number): { locked: boolean; kind: TargetKind | null; id: number | null };
  order(): { kind: 'waypoint' | 'target' | 'none'; at: Vec2 | null; ref: { kind: TargetKind; id: number } | null };
  readout(): { scheme: 'sticks' | 'tap'; shipPos: Vec2 | null; firing: boolean; alive: boolean };
}
interface StageWindow {
  __tapCommanderStage?: TapCommanderStage;
}
declare const window: Window & StageWindow;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

test.describe('Tap Commander auto-engages on the real booted client', () => {
  test('move order + enemy en route → fires mid-flight with NO lock', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/?debug=1', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__tapCommanderStage?.stageAutoEngage === 'function', undefined, {
      timeout: 20_000,
    });

    const staged = await page.evaluate(() => {
      const s = window.__tapCommanderStage!;
      s.setScheme('tap');
      return s.stageAutoEngage();
    });
    expect(staged, 'seam staged a ship + a bot').not.toBeNull();

    // Tap empty space up-field → a MOVE, not a lock (the bot is off to the side).
    const wp = staged!.waypoint;
    const moveRes = await page.evaluate((p) => window.__tapCommanderStage!.tapWorld(p.x, p.y), wp);
    expect(moveRes.locked, 'empty-space tap is a move, not a lock').toBe(false);
    const order = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(order.kind).toBe('waypoint');
    expect(order.ref, 'no lock — auto-engage must do the firing').toBeNull();

    // Auto-engage: while flying the waypoint (no lock) the ship fires at the bot in
    // range — the sim's own firing tell rises with the order still a waypoint.
    await page.waitForFunction(() => window.__tapCommanderStage!.readout().firing === true, undefined, {
      timeout: 8_000,
    });
    const midFlight = await page.evaluate(() => ({
      order: window.__tapCommanderStage!.order(),
      readout: window.__tapCommanderStage!.readout(),
    }));
    expect(midFlight.order.kind, 'still a move order — not a lock').toBe('waypoint');
    expect(midFlight.readout.firing, 'fires mid-flight').toBe(true);
    // And the move actually progressed (movement ⟂ firing).
    expect(dist(midFlight.readout.shipPos!, wp)).toBeLessThan(dist(staged!.ship, wp));

    await page.screenshot({ path: 'tests/live-stage/tap-autofire-evidence.png' });
    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });

  test('hold full + only rocks → shots stop, but the tap-move continues', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/?debug=1', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__tapCommanderStage?.stageRockOnly === 'function', undefined, {
      timeout: 20_000,
    });

    // --- Empty hold + a rock in range → the ship mines it while moving -----------
    const empty = await page.evaluate(() => {
      window.__tapCommanderStage!.setScheme('tap');
      return window.__tapCommanderStage!.stageRockOnly(false);
    });
    expect(empty, 'seam staged a ship + a rock').not.toBeNull();
    await page.evaluate((p) => window.__tapCommanderStage!.tapWorld(p.x, p.y), empty!.waypoint);
    // Auto-engage mines the rock (hold has room) — firing rises with no lock.
    await page.waitForFunction(() => window.__tapCommanderStage!.readout().firing === true, undefined, {
      timeout: 8_000,
    });

    // --- Full hold + the same rock → the ladder suppresses it, shots stop --------
    const full = await page.evaluate(() => window.__tapCommanderStage!.stageRockOnly(true));
    expect(full).not.toBeNull();
    await page.evaluate((p) => window.__tapCommanderStage!.tapWorld(p.x, p.y), full!.waypoint);
    const order = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(order.kind).toBe('waypoint');

    // The move continues (the ship closes on the waypoint)...
    await page.waitForFunction(
      (wp) => {
        const r = window.__tapCommanderStage!.readout();
        return !!r.shipPos && Math.hypot(r.shipPos.x - wp.x, r.shipPos.y - wp.y) < 320 - 60;
      },
      full!.waypoint,
      { timeout: 8_000 },
    );

    // ...while the weapon stays silent — a full hold never auto-fires at a rock. Sample
    // across several frames so a transient shot could not slip past (firing is a
    // per-tick tell; the ladder returns no target, so every tick is silent).
    for (let i = 0; i < 6; i++) {
      const firing = await page.evaluate(() => window.__tapCommanderStage!.readout().firing);
      expect(firing, 'full hold → no auto-fire at rocks (developer p9-02 §1)').toBe(false);
      await page.waitForTimeout(120);
    }

    await page.screenshot({ path: 'tests/live-stage/tap-fullhold-evidence.png' });
    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
