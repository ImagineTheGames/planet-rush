/**
 * tests/live-stage/tap-markers.spec.ts — the Tap Commander order MARKERS, drawn on
 * the REAL booted client. OWNER: UI Engineer (developer §4, p6-02).
 *
 * The Platform lane's `tap-commander.spec.ts` proves the pilot FLIES the ship from
 * a tap; this proves the UI half — that the shipped bundle projects the standing
 * order to screen and the layer DRAWS its tells: a lock-on reticle riding the
 * locked target (and gone the frame the lock clears), a line of intent while the
 * pilot is firing, and a waypoint pulse that appears where the player tapped and
 * fades rather than blinking away. That last mile is the "dark matter" a unit test
 * cannot reach — the model + the animation are unit-green, but only a real boot
 * proves the feed hands the layer the projected order and the layer paints it.
 *
 * It drives the pilot through the Platform lane's `__tapCommanderStage` seam (real
 * candidate list → picker → pilot, never a faked order) and reads back what the UI
 * actually drew through the UI lane's `__tapMarkerStage` seam. It runs WITHOUT
 * `?freeze=1` on purpose: the pilot and the marker animation live on a running
 * loop, which a pinned frame cannot show.
 */
import { test, expect } from '@playwright/test';

interface Vec2 {
  x: number;
  y: number;
}
type TargetKind = 'ship' | 'turret' | 'core' | 'asteroid' | 'planet';

/** The Platform lane's `?debug=1` seam that drives the pilot (mirrors
 *  `tap-commander.spec.ts`). */
interface TapCommanderStage {
  setScheme(scheme: 'sticks' | 'tap'): void;
  stage(): { ship: Vec2; bot: Vec2; botId: number } | null;
  tapWorld(x: number, y: number): { locked: boolean; kind: TargetKind | null; id: number | null };
  order(): { kind: 'waypoint' | 'target' | 'none'; at: Vec2 | null; ref: { kind: TargetKind; id: number } | null };
  readout(): { scheme: 'sticks' | 'tap'; shipPos: Vec2 | null; firing: boolean; alive: boolean };
}

/** The UI lane's `?debug=1` seam that reports the drawn order markers — installed
 *  in `src/main.ts` (`installTapMarkerStage`), reading `Hud.debugTapMarkers()`. */
interface TapMarkerStage {
  markers(): {
    reticle: { x: number; y: number; radius: number; color: number } | null;
    waypoint: { x: number; y: number } | null;
    waypointFading: boolean;
    intent: boolean;
  };
}

interface StageWindow {
  __tapCommanderStage?: TapCommanderStage;
  __tapMarkerStage?: TapMarkerStage;
  __planetRush?: { viewport: { width: number; height: number } };
}
declare const window: Window & StageWindow;

async function bootTapScheme(page: import('@playwright/test').Page): Promise<{ botId: number }> {
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__tapCommanderStage?.stage === 'function' &&
      typeof window.__tapMarkerStage?.markers === 'function',
    undefined,
    { timeout: 20_000 },
  );
  const staged = await page.evaluate(() => {
    const s = window.__tapCommanderStage!;
    s.setScheme('tap');
    return s.stage();
  });
  expect(staged, 'the seam staged a ship + a bot').not.toBeNull();
  return { botId: staged!.botId };
}

test.describe('Tap Commander order markers draw on the real booted client', () => {
  test('a lock draws a reticle on the target, clears on release, and fires a line of intent', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const { botId } = await bootTapScheme(page);
    const viewport = await page.evaluate(() => window.__planetRush!.viewport);

    // No order yet → no reticle.
    const idle = await page.evaluate(() => window.__tapMarkerStage!.markers());
    expect(idle.reticle, 'no reticle before anything is locked').toBeNull();

    // --- Tap the bot → a reticle rides it ------------------------------------
    const staged = await page.evaluate(() => window.__tapCommanderStage!.stage());
    const bot = staged!.bot;
    const lockRes = await page.evaluate((b) => window.__tapCommanderStage!.tapWorld(b.x, b.y), bot);
    expect(lockRes.locked, 'a tap on the bot is a lock').toBe(true);
    expect(lockRes.id).toBe(botId);

    // The reticle appears and rides the LOCKED target — the bot was parked to the
    // right of the centred local ship, so its reticle sits right of screen centre.
    const reticle = await page
      .waitForFunction(() => {
        const r = window.__tapMarkerStage!.markers().reticle;
        return r ? r : null;
      }, undefined, { timeout: 10_000 })
      .then((h) => h.jsonValue());
    expect(reticle!.radius, 'the reticle frames a real target radius').toBeGreaterThan(0);
    expect(reticle!.x, 'the reticle rides the bot, right of the centred local ship').toBeGreaterThan(
      viewport.width / 2,
    );

    // While the pilot is firing on the in-range lock, the line of intent draws.
    await page.waitForFunction(() => window.__tapCommanderStage!.readout().firing === true, undefined, {
      timeout: 10_000,
    });
    await page.waitForFunction(() => window.__tapMarkerStage!.markers().intent === true, undefined, {
      timeout: 10_000,
    });

    await page.screenshot({ path: 'tests/live-stage/tap-markers-lock-evidence.png' });

    // --- Tap empty space → the lock clears, and so does its reticle ----------
    const staged2 = await page.evaluate(() => window.__tapCommanderStage!.stage());
    // Re-lock (stage() clears the order), then replace it with an empty-space move.
    await page.evaluate((b) => window.__tapCommanderStage!.tapWorld(b.x, b.y), staged2!.bot);
    const clearPoint = { x: staged2!.ship.x, y: staged2!.ship.y - 200 };
    const clearRes = await page.evaluate((p) => window.__tapCommanderStage!.tapWorld(p.x, p.y), clearPoint);
    expect(clearRes.locked, 'the empty-space tap is a move, not a lock').toBe(false);

    await page.waitForFunction(() => window.__tapMarkerStage!.markers().reticle === null, undefined, {
      timeout: 10_000,
    });
    const afterClear = await page.evaluate(() => window.__tapMarkerStage!.markers());
    expect(afterClear.reticle, 'the reticle is gone once the lock clears').toBeNull();
    expect(afterClear.intent, 'the line of intent is gone with the lock').toBe(false);

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });

  test('a waypoint tap draws a pulse marker that fades on arrival', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await bootTapScheme(page);

    // --- Tap empty space → a waypoint pulse appears at the tapped point -------
    const staged = await page.evaluate(() => window.__tapCommanderStage!.stage());
    const wp = { x: staged!.ship.x, y: staged!.ship.y - 260 };
    const moveRes = await page.evaluate((p) => window.__tapCommanderStage!.tapWorld(p.x, p.y), wp);
    expect(moveRes.locked, 'a tap on empty space is a move').toBe(false);

    await page.waitForFunction(() => window.__tapMarkerStage!.markers().waypoint !== null, undefined, {
      timeout: 10_000,
    });
    const shown = await page.evaluate(() => window.__tapMarkerStage!.markers());
    expect(shown.waypoint, 'the waypoint pulse appears where the player tapped').not.toBeNull();
    expect(shown.reticle, 'a move order draws no reticle').toBeNull();

    await page.screenshot({ path: 'tests/live-stage/tap-markers-waypoint-evidence.png' });

    // --- Clear the order (switch schemes) → the pulse FADES, then is gone -----
    // Switching to sticks drops the standing order deterministically; the layer
    // then eases the last pulse out rather than blinking it off.
    await page.evaluate(() => window.__tapCommanderStage!.setScheme('sticks'));
    await page.waitForFunction(() => window.__tapMarkerStage!.markers().waypointFading === true, undefined, {
      timeout: 10_000,
    });
    await page.waitForFunction(() => window.__tapMarkerStage!.markers().waypoint === null, undefined, {
      timeout: 10_000,
    });

    expect(pageErrors, `no page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
