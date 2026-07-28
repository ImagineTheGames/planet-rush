/**
 * tests/live-stage/tap-commander.spec.ts — Tap Commander drives the ship in the
 * REAL booted client. OWNER: Platform Engineer (developer's ratified tap/click-to-
 * move, tap/click-to-attack scheme, §5).
 *
 * The pilot's geometry — converge to a waypoint, hold range on a lock, damp at
 * arrival, drop a dead lock — is unit-green (`src/platform/tap-pilot.test.ts`). But
 * a unit test builds a `World` in memory: it cannot prove the SHIPPED bundle turns
 * a tap into an order that flies the ship through the client's own input funnel and
 * fires on a lock. That wiring is the "dark matter" a unit test can't reach, and it
 * lives only on a real boot. This pins it end to end.
 *
 * It runs WITHOUT `?freeze=1` on purpose: the pilot converges over a second or two,
 * which a pinned frame cannot show. The `?debug=1` `__tapCommanderStage` seam parks
 * the local ship and one bot (in weapon range), switches to the tap scheme, and
 * places orders through the client's OWN candidate list + picker + pilot — never a
 * faked action — while we watch the live sim: an empty-space tap moves the ship, a
 * tap on the bot locks it and fires, and a fresh empty-space tap clears the lock and
 * the ship moves again (developer §2, §5).
 */
import { test, expect } from '@playwright/test';

interface Vec2 {
  x: number;
  y: number;
}
type TargetKind = 'ship' | 'turret' | 'core' | 'asteroid' | 'station';

/** The `?debug=1`-only seam this spec drives — installed in `src/main.ts`
 *  (`installTapCommanderStage`), staging through the client's real pilot and
 *  reading back plain sim data behind the flag. */
interface TapCommanderStage {
  setScheme(scheme: 'sticks' | 'tap'): void;
  stage(): { ship: Vec2; bot: Vec2; botId: number } | null;
  tapWorld(x: number, y: number): { locked: boolean; kind: TargetKind | null; id: number | null };
  order(): { kind: 'waypoint' | 'target' | 'none'; at: Vec2 | null; ref: { kind: TargetKind; id: number } | null };
  readout(): { scheme: 'sticks' | 'tap'; shipPos: Vec2 | null; firing: boolean; alive: boolean };
}
interface StageWindow {
  __tapCommanderStage?: TapCommanderStage;
}
declare const window: Window & StageWindow;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

test.describe('Tap Commander flies the real booted client', () => {
  test('empty-space tap moves, a tap on a bot locks + fires, a fresh tap clears the lock', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    // Live sim (no ?freeze): the pilot needs the loop to actually run.
    await page.goto('/?debug=1', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__tapCommanderStage?.stage === 'function', undefined, {
      timeout: 20_000,
    });

    // --- Tap empty space → the ship flies there (developer §2) -----------------
    const staged = await page.evaluate(() => {
      const s = window.__tapCommanderStage!;
      s.setScheme('tap');
      return s.stage();
    });
    expect(staged, 'seam staged a ship + a bot').not.toBeNull();
    const ship0 = staged!.ship;
    // A point well away from the ship, in the now-cleared field (empty → a move).
    const waypoint = { x: ship0.x, y: ship0.y - 320 };
    const moveRes = await page.evaluate((wp) => window.__tapCommanderStage!.tapWorld(wp.x, wp.y), waypoint);
    expect(moveRes.locked, 'a tap on empty space is a move, not a lock').toBe(false);
    const orderAfterMove = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(orderAfterMove.kind).toBe('waypoint');

    // The ship should close a meaningful part of the distance toward the waypoint.
    await page.waitForFunction(
      (wp) => {
        const r = window.__tapCommanderStage!.readout();
        if (!r.shipPos) return false;
        return Math.hypot(r.shipPos.x - wp.x, r.shipPos.y - wp.y) < 320 - 80;
      },
      waypoint,
      { timeout: 8_000 },
    );
    const afterMove = await page.evaluate(() => window.__tapCommanderStage!.readout());
    expect(dist(afterMove.shipPos!, waypoint)).toBeLessThan(dist(ship0, waypoint));

    // --- Tap a bot → lock + firing begins (developer §2) -----------------------
    const staged2 = await page.evaluate(() => window.__tapCommanderStage!.stage());
    const bot = staged2!.bot;
    const lockRes = await page.evaluate((b) => window.__tapCommanderStage!.tapWorld(b.x, b.y), bot);
    expect(lockRes.locked, 'a tap on the bot is a lock').toBe(true);
    expect(lockRes.kind).toBe('ship');
    expect(lockRes.id).toBe(staged2!.botId);
    const lockedOrder = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(lockedOrder.kind).toBe('target');
    expect(lockedOrder.ref?.id).toBe(staged2!.botId);

    // The pilot aims + fires at the in-range lock: the sim's own firing tell rises.
    await page.waitForFunction(() => window.__tapCommanderStage!.readout().firing === true, undefined, {
      timeout: 8_000,
    });

    await page.screenshot({ path: 'tests/live-stage/tap-commander-evidence.png' });

    // --- Tap empty ground again → lock clears, ship moves (developer §2) --------
    const staged3 = await page.evaluate(() => window.__tapCommanderStage!.stage());
    const ship3 = staged3!.ship;
    // Lock the bot first via a real tap, so there is a lock to clear.
    const relock = await page.evaluate((b) => window.__tapCommanderStage!.tapWorld(b.x, b.y), staged3!.bot);
    expect(relock.locked).toBe(true);
    // Now an explicit empty-space move must replace the lock. Up-field from the
    // arena centre is empty (the field was cleared; the bot is off to the side).
    const clearPoint = { x: ship3.x, y: ship3.y - 200 };
    const clearRes = await page.evaluate((p) => window.__tapCommanderStage!.tapWorld(p.x, p.y), clearPoint);
    expect(clearRes.locked).toBe(false);
    const clearedOrder = await page.evaluate(() => window.__tapCommanderStage!.order());
    expect(clearedOrder.kind).toBe('waypoint');
    expect(clearedOrder.ref, 'the lock is gone').toBeNull();

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
