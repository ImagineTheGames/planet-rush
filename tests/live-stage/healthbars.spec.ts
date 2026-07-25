/**
 * tests/live-stage/healthbars.spec.ts — enemy health bars, verified in the REAL
 * booted client. OWNER: UI Engineer (GDD §2.2).
 *
 * QA reported `enemy-healthbars` FAILED twice (rounds 1 and 2): a bot mid-fight,
 * visibly taking beam damage, with no health bar. The model tests were green —
 * `src/ui/healthbar` decides correctly — but the layer was never fed on a real
 * boot: `main.ts` populated no `combatants`, so the pooled `HealthBarView` sat
 * on the stage drawing nothing. A headless unit test cannot catch that; only
 * booting the actual bundle and reading back what the layer drew can.
 *
 * This spec boots the production build, stages a bot taking damage through the
 * `?debug=1` live-stage seam (`window.__healthbarStage`, installed in `main.ts`),
 * and asserts a real health-bar display object tracks that enemy with the fill
 * it was left at — i.e. the full path sim state → feed → model → drawn bar.
 *
 * **Field request v0.1.1 — the OWN ship.** The developer could not see their own
 * ship's health in a fight, so the local ship now gets a first-class bar too. The
 * second test here stages the LOCAL ship taking damage and asserts its own bar
 * draws over it (centred, since the follow camera holds the ship there), carrying
 * the distinct `local` style flag and the fill it was left at — and that the
 * top-right HUD hull readout agrees with the bar (one source: sim hull).
 *
 * `?freeze=1` pins the sim to a fixed seeded frame so the staged ships hold still
 * (the sim does not step them away), which is what makes the assertion
 * deterministic on a slow CI runner rather than a race against the bots.
 */
import { test, expect } from '@playwright/test';

/** The shape of the `?debug=1`-only globals this spec drives. Mirrors the seams
 *  installed in `src/main.ts` (`installHealthbarStage`) and `debug-hook.ts`. */
interface HealthbarStage {
  /** Park a live enemy beside the local ship at `fraction` of max hull; returns
   *  the staged enemy's slot and exact fill, or null if none is available. */
  damageEnemy(fraction: number): { owner: number; fraction: number } | null;
  /** Field request v0.1.1: set the LOCAL ship's hull to `fraction` of max (it is
   *  already centred by the follow camera); returns its slot and exact fill. */
  damageLocal(fraction: number): { owner: number; fraction: number } | null;
  /** The bars the real layer drew last frame — owner, fill, `local` flag, pos. */
  bars(): Array<{ owner: number; fraction: number; x: number; y: number; local: boolean }>;
  /** The hull fraction the HUD readout last drew (or -1 when hidden). */
  hullReadout(): number;
}
interface StageWindow {
  __healthbarStage?: HealthbarStage;
  __planetRush?: { viewport: { width: number; height: number } };
}
declare const window: Window & StageWindow;

test('a health bar renders over a damaged enemy in the real booted client', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The staging seam installs during boot; wait for it before driving it.
  await page.waitForFunction(
    () => typeof window.__healthbarStage?.damageEnemy === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // Baseline: with no enemy near the centred local ship, the layer draws no bar.
  // (A frozen frame at spawn has the rivals a full ring away, off screen.)
  const before = await page.evaluate(() => window.__healthbarStage!.bars());
  expect(before, 'no bars before an enemy is staged into the frame').toEqual([]);

  // Stage a bot at 40% hull, beside the ship the camera holds centred.
  const staged = await page.evaluate(() => window.__healthbarStage!.damageEnemy(0.4));
  expect(staged, 'an enemy was available to stage').not.toBeNull();

  // Let the render loop draw at least one frame with the staged enemy, then read
  // back what the REAL layer drew — this is the assertion the field report needed.
  const bars = await page
    .waitForFunction(
      () => {
        const b = window.__healthbarStage!.bars();
        return b.length > 0 ? b : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  // A bar exists for the staged enemy, at the fill we set — the model mapped hull
  // → fraction and the layer drew it (not culled, not hidden).
  const bar = bars!.find((b) => b.owner === staged!.owner);
  expect(bar, 'a drawn health bar tracks the staged enemy').toBeDefined();
  expect(bar!.fraction, 'the bar fill matches the staged hull fraction').toBeCloseTo(0.4, 2);

  // And it TRACKS the entity: the enemy was parked 120 world-px right of the
  // centred local ship, so its bar sits to the right of the viewport centre.
  const viewport = await page.evaluate(() => window.__planetRush!.viewport);
  expect(bar!.x, 'the bar is centred over the enemy, right of the local ship').toBeGreaterThan(
    viewport.width / 2,
  );

  expect(pageErrors, 'no page errors while staging the fight').toEqual([]);
});

test('the local player’s own ship gets its own bar when it takes damage (v0.1.1)', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  await page.waitForFunction(
    () => typeof window.__healthbarStage?.damageLocal === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // Baseline: at the frozen spawn frame the own ship is full and idle, so — same
  // "keep the field clean" rule as an enemy — it shows NO bar of its own.
  const before = await page.evaluate(() => window.__healthbarStage!.bars());
  expect(
    before.some((b) => b.local),
    'no own-ship bar while the ship is full and idle',
  ).toBe(false);

  // Damage the LOCAL ship to 35% hull — it is already centred by the camera.
  const staged = await page.evaluate(() => window.__healthbarStage!.damageLocal(0.35));
  expect(staged, 'the local ship was available to damage').not.toBeNull();

  // Let the render loop draw a frame with the damaged own ship, then read back
  // the OWN bar the real layer drew (the one flagged `local`).
  const bars = await page
    .waitForFunction(
      () => {
        const b = window.__healthbarStage!.bars();
        return b.some((x) => x.local) ? b : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  const own = bars!.find((b) => b.local);
  expect(own, 'a drawn health bar, flagged local, tracks the own ship').toBeDefined();
  expect(own!.owner, 'the own bar belongs to the local player slot').toBe(staged!.owner);
  expect(own!.fraction, 'the own bar fill matches the staged hull fraction').toBeCloseTo(0.35, 2);

  // It TRACKS the own ship, which the follow camera holds at the viewport centre.
  const viewport = await page.evaluate(() => window.__planetRush!.viewport);
  expect(own!.x, 'the own bar is centred on the ship the camera holds').toBeCloseTo(
    viewport.width / 2,
    0,
  );

  // And the top-right HUD hull readout agrees with the bar — one source, sim hull.
  const readout = await page.evaluate(() => window.__healthbarStage!.hullReadout());
  expect(readout, 'the HUD hull readout matches the over-ship bar fill').toBeCloseTo(0.35, 2);

  expect(pageErrors, 'no page errors while staging own-ship damage').toEqual([]);
});
