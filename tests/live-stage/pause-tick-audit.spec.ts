/**
 * tests/live-stage/pause-tick-audit.spec.ts — the OFFLINE half of the pause audit:
 * a paused offline match really stops. OWNER: Gameplay Engineer (ratified M10 §2;
 * GDD §4.2 "No pause online").
 *
 * The ratification asks for both halves to be tested, on both form factors:
 *
 *   > pause menu in an online match must NOT pause the sim — menu opens
 *   > (exit/settings reachable), world keeps running, ship keeps flying (or
 *   > drifts), server unaffected. Offline pause still truly pauses. Test BOTH:
 *   > online pause tick continuity, offline pause tick freeze. Live-stage both
 *   > form factors.
 *
 * This file is the offline half. The online half is
 * `tests/live-stage-online/online-pause.spec.ts`, which needs a real fleet and so
 * lives in the suite that stands one up.
 *
 * ── WHY THIS EXISTS WHEN `./pause-menu.spec.ts` ALREADY PASSES ──────────────
 * That spec proves the freeze once, at the default desk viewport, as one step of
 * a longer walk through SETTINGS and EXIT. Two things it does not do, and the
 * ratification asks for both:
 *
 *  1. **The phone.** The freeze is reached there by a THUMB on the corner
 *     affordance, through the landscape-lock remap, on a portrait touch viewport —
 *     a different path into the same state, and the path the developer plays on.
 *  2. **The ship.** A tick counter that stops is not quite the claim. "Offline
 *     pause still truly pauses" is a claim about the WORLD: the ship must be in
 *     the same place, at the same velocity, after real seconds have passed. A sim
 *     that stepped a frozen tick would move it; a counter alone would not notice.
 *
 * Both profiles boot `?debug=1` — straight into an offline match, the harness
 * contract — because offline is the only world that flag can reach, and offline is
 * exactly what this file is about.
 *
 * ── HAS THIS RUN? ──────────────────────────────────────────────────────────
 * Recorded in the PR body with the evidence PNGs it writes. Chromium in this lane
 * needs its shared libraries staged on `LD_LIBRARY_PATH` before it will launch —
 * the same condition `./copy-log-touch.spec.ts` documents.
 *
 *   npx playwright test --config tests/live-stage/playwright.config.ts pause-tick-audit
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface PauseControl {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface ShipRead {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}
interface PauseRead {
  readonly screen: 'closed' | 'menu' | 'settings' | 'confirm';
  readonly open: boolean;
  readonly pausable: boolean;
  readonly frozen: boolean;
  readonly simTicks: number;
  readonly online: boolean;
  readonly ship: ShipRead | null;
  readonly controls: readonly PauseControl[];
  readonly buttonPoint: PhysicalPoint;
}
declare const window: Window & { __pauseStage?: { read(): PauseRead } };

const PC = { width: 1280, height: 800, dpr: 1, touch: false } as const;
/** Portrait, held — the landscape lock is in play on every press. */
const IPHONE = { width: 390, height: 844, dpr: 3, touch: true } as const;
type Profile = typeof PC | typeof IPHONE;

/** How long "real time passed" is. ~30 sim ticks at 60 Hz — far more than the
 *  one-or-two a scheduling wobble could explain away. */
const DWELL_MS = 500;

interface Client {
  readonly page: Page;
  readonly profile: Profile;
  readonly press: (p: PhysicalPoint) => Promise<void>;
  readonly errors: string[];
}

/** Boot one client straight into an offline match and wait for the sim to run. */
async function bootMatch(
  browser: Browser,
  profile: Profile,
  baseURL: string,
): Promise<{ client: Client; context: BrowserContext }> {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
    baseURL,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, {
    timeout: 30_000,
  });
  // Let the world actually run, so "it stopped" is a change and not a start-up state.
  await page.waitForFunction(() => window.__pauseStage!.read().simTicks > 30, undefined, {
    timeout: 15_000,
  });

  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const press = async (p: PhysicalPoint): Promise<void> => {
    const x = box.x + p.x;
    const y = box.y + p.y;
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  return { client: { page, profile, press, errors }, context };
}

async function readPause(page: Page): Promise<PauseRead> {
  return page.evaluate(() => window.__pauseStage!.read());
}

/**
 * Open the overlay the way this device does — ESC on a keyboard, a thumb on the
 * corner affordance on a phone. Two paths into one state, which is the reason this
 * file runs on both profiles rather than parameterising a viewport.
 */
async function openPause(client: Client): Promise<void> {
  if (client.profile.touch) {
    const point = await client.page.evaluate(() => window.__pauseStage!.read().buttonPoint);
    await client.press(point);
  } else {
    await client.page.keyboard.press('Escape');
  }
  await client.page.waitForFunction(() => window.__pauseStage!.read().open === true, undefined, {
    timeout: 10_000,
  });
}

/** Press the pause control of a given kind at the point the client drew it. */
async function pressControl(client: Client, kind: string): Promise<void> {
  const p = await client.page.evaluate((k) => {
    const c = window.__pauseStage!.read().controls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!p) throw new Error(`the pause overlay reported no '${kind}' control`);
  await client.press(p);
}

for (const [name, profile] of [
  ['desk (ESC)', PC],
  ['phone, portrait (thumb on the corner button)', IPHONE],
] as const) {
  test(`offline pause TRULY pauses — ${name}: no tick, no metre moved`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const { client, context } = await bootMatch(browser, profile, baseURL!);
    try {
      // --- The world is running, and it is the offline one. -------------------
      const running = await readPause(client.page);
      expect(running.pausable, 'an offline match is the pausable one (GDD §4.2)').toBe(true);
      expect(running.online).toBe(false);
      expect(running.open).toBe(false);
      expect(running.frozen).toBe(false);
      expect(running.ship, 'the harness boot puts a local ship in the world').not.toBeNull();

      // --- First: prove the ship CAN move, so "it didn't" means something. ----
      // A ship at zero velocity with no input does not move even in a perfectly
      // live sim — Euler plus drag, and nothing to integrate. Without this the
      // freeze assertion below would pass over a running world.
      await client.page.keyboard.down('KeyW');
      const thrustFrom = await readPause(client.page);
      await client.page.waitForTimeout(DWELL_MS);
      const thrustTo = await readPause(client.page);
      expect(
        Math.hypot(thrustTo.ship!.x - thrustFrom.ship!.x, thrustTo.ship!.y - thrustFrom.ship!.y),
        'the ship did not move under thrust in a RUNNING offline match',
      ).toBeGreaterThan(1);

      // --- Pause, with the thrust still held down. ---------------------------
      await openPause(client);
      const paused = await readPause(client.page);
      expect(paused.screen).toBe('menu');
      expect(paused.frozen, 'offline + overlay up ⇒ frozen').toBe(true);
      // The way out is reachable here too — the overlay is not a trap on either
      // device (the ratification asks for exit/settings online; offline it has
      // always been true and this is the guard that keeps it so).
      const kinds = paused.controls.map((c) => c.kind);
      expect(kinds).toEqual(['resume', 'settings', 'exit']);

      // --- Half a second of real time, thrust held, and NOTHING moved. -------
      try {
        const before = await readPause(client.page);
        await client.page.waitForTimeout(DWELL_MS);
        const after = await readPause(client.page);

        expect(after.simTicks, 'a tick advanced under a frozen offline overlay').toBe(
          before.simTicks,
        );
        // The half a tick counter cannot see: the world itself is still — and
        // still under a held throttle, which is the strong form of the claim.
        expect(after.ship!.x, 'the ship flew on while the match was paused').toBe(before.ship!.x);
        expect(after.ship!.y).toBe(before.ship!.y);
        expect(after.ship!.vx, 'the ship kept accelerating while the match was paused').toBe(
          before.ship!.vx,
        );
        expect(after.ship!.vy).toBe(before.ship!.vy);
      } finally {
        await client.page.keyboard.up('KeyW');
      }

      await client.page.screenshot({
        path: `tests/live-stage/pause-tick-audit-offline-${profile.touch ? 'phone' : 'pc'}-evidence.png`,
      });

      // --- RESUME picks it back up exactly where it left off. ----------------
      await pressControl(client, 'resume');
      await client.page.waitForFunction(() => window.__pauseStage!.read().open === false, undefined, {
        timeout: 10_000,
      });
      const frozenAt = (await readPause(client.page)).simTicks;
      await client.page.waitForFunction(
        (prev) => window.__pauseStage!.read().simTicks > prev,
        frozenAt,
        { timeout: 10_000 },
      );

      expect(client.errors, `page errors across the offline pause: ${client.errors.join('\n')}`).toEqual(
        [],
      );
    } finally {
      await context.close();
    }
  });
}
