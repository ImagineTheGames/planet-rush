/**
 * tests/live-stage/upgrade-wheel.spec.ts — the v0.2 upgrade-wheel field report,
 * verified in the REAL booted client. OWNER: UI Engineer (GDD §2.5, §2.2).
 *
 * Three developer reports, one screen family, all three checkable only on a real
 * boot (the pure models are unit-green; what a boot proves is that they are wired
 * and DRAWN):
 *
 *  1. **"…it should be a wheel menu as well."** The upgrade screen is now a radial
 *     wheel. This spec opens it and reads back the wedges the real view drew, then
 *     buys a tier through the sim's own `buyUpgrade` and asserts the wedge
 *     re-renders the new tier — the full path sim state → feed → model → drawn
 *     wedge. It also stages an unaffordable wedge and asserts it dims *with a
 *     reason* (`unaffordable`), not silently.
 *  2. **"…opened and closed a few times, then it wouldn't open anymore."** The
 *     cycle test mashes each wheel open/closed 15× and asserts it still opens and
 *     is interactive — the exact field bug, end to end through the real
 *     `WheelInput` + the shared leak-safe `WheelToggle`.
 *  3. **"I don't need to see hull on top right."** The top-right HULL readout was
 *     removed; this asserts it is GONE from the layout registry (`hull-hud` no
 *     longer registers) while the over-ship bar remains the truth.
 *
 * Driven through the `?debug=1` `window.__upgradeWheelStage` seam (installed in
 * `main.ts`, the same way `__healthbarStage` is) plus the read-only layout
 * registry at `window.__planetRush.layout`. `?freeze=1` pins the sim to a fixed
 * seeded frame so the staged wheel holds still and the assertions are
 * deterministic on a slow CI runner rather than a race against the bots.
 */
import { test, expect } from '@playwright/test';

/** The `?debug=1`-only upgrade-wheel seam this spec drives (mirrors
 *  `installUpgradeWheelStage` in `src/main.ts`). */
interface UpgradeWheelStage {
  openBuild(): { open: boolean } | null;
  openUpgrade(ore?: number): { open: boolean } | null;
  close(): void;
  interactive(): boolean;
  buyTier(i: number): { result: string; tier: number } | null;
  tierOf(i: number): number | null;
  setOre(ore: number): { banked: number } | null;
  wedges(): Array<{
    track: string;
    label: string;
    tier: number;
    current: string;
    next: string | null;
    cost: number | null;
    state: 'ready' | 'unaffordable' | 'maxed';
  }>;
}
interface LayoutEntry {
  id: string;
  anchor: { region: string; margin: number };
  bounds: { x: number; y: number; width: number; height: number };
}
interface StageWindow {
  __upgradeWheelStage?: UpgradeWheelStage;
  __planetRush?: { layout: readonly LayoutEntry[] };
}
declare const window: Window & StageWindow;

/** BEAM leads TRACK_ORDER, so wedge index 0 is BEAM on the Vanguard: current 10,
 *  first tier 13 (10 × 1.25), cost 4. */
const BEAM = 0;

async function boot(page: import('@playwright/test').Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__upgradeWheelStage?.openUpgrade === 'function',
    undefined,
    { timeout: 20_000 },
  );
  return pageErrors;
}

test('the top-right HULL readout is gone from the layout registry (field report #3)', async ({
  page,
}) => {
  const pageErrors = await boot(page);

  // The registry refreshes every rendered frame; read it once the HUD has drawn.
  const layout = await page
    .waitForFunction(() => window.__planetRush?.layout ?? null, undefined, { timeout: 20_000 })
    .then((h) => h.jsonValue());

  const ids = layout!.map((e) => e.id);
  // The own-ship hull readout used to register here; it must be gone now.
  expect(ids, 'no hull-hud entry — the top-right readout was removed').not.toContain('hull-hud');
  // …and its old top-right neighbour (own-planet HP) is untouched, so the corner
  // is tidied, not blown away.
  expect(ids, 'own-planet HP still registers top-right').toContain('planet-hp');

  expect(pageErrors, 'no page errors on a clean boot').toEqual([]);
});

test('opening the upgrade wheel draws a wedge per track, buying a tier re-renders it (field report #1)', async ({
  page,
}) => {
  const pageErrors = await boot(page);

  // Open the upgrade wheel with ore to spend, then read the wedges the REAL view
  // drew — one per upgrade track, all at stock tier on a fresh ship.
  await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade(999));
  const before = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges();
        return w.length > 0 ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(before!.length, 'one wedge per upgrade track').toBeGreaterThanOrEqual(4);
  const beamBefore = before!.find((w) => w.label === 'BEAM')!;
  expect(beamBefore, 'a BEAM wedge is drawn').toBeDefined();
  expect(beamBefore.tier, 'stock ship starts at tier 0').toBe(0);
  expect(beamBefore.current, 'Vanguard beam reads 10 at stock').toBe('10');
  expect(beamBefore.next, 'next tier previews the value, not the delta').toBe('13');
  expect(beamBefore.state, 'affordable with ore banked').toBe('ready');

  // The upgrade wheel is registered as a drawn overlay.
  const openIds = await page.evaluate(() => window.__planetRush!.layout.map((e) => e.id));
  expect(openIds, 'the upgrade wheel registers its drawn footprint').toContain('upgrade-wheel');

  // Buy one tier through the sim's real validated purchase.
  const bought = await page.evaluate((i) => window.__upgradeWheelStage!.buyTier(i), BEAM);
  expect(bought, 'the purchase went through the sim').not.toBeNull();
  expect(bought!.result, 'buyUpgrade accepted it').toBe('ok');
  expect(bought!.tier, 'the ship is now one tier up on BEAM').toBe(1);

  // The wedge must re-render the new tier — the whole point of report #1.
  const beamAfter = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges().find((x) => x.label === 'BEAM');
        return w && w.tier === 1 ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(beamAfter!.tier, 'the drawn BEAM wedge advanced a tier').toBe(1);
  expect(beamAfter!.current, 'its current value re-rendered to the new tier (10 → 13)').toBe('13');

  expect(pageErrors, 'no page errors staging the upgrade wheel').toEqual([]);
});

test('an unaffordable wedge dims with a reason (field report #1)', async ({ page }) => {
  const pageErrors = await boot(page);

  // Open the wheel with too little ore to buy anything — every wedge should be
  // dimmed, and specifically flagged `unaffordable`, not just greyed.
  await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade(0));
  const wedges = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges();
        return w.length > 0 ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  const beam = wedges!.find((w) => w.label === 'BEAM')!;
  expect(beam.state, 'a broke player sees BEAM dimmed *because* unaffordable').toBe('unaffordable');
  expect(beam.cost, 'the cost is still shown — the trade stays legible').not.toBeNull();

  expect(pageErrors, 'no page errors staging an unaffordable wedge').toEqual([]);
});

test('mashing each wheel open/closed 15× still opens and stays interactive (field report #2)', async ({
  page,
}) => {
  const pageErrors = await boot(page);

  // The exact field bug: open and close a wheel a bunch, then it "wouldn't open
  // anymore." Do it 15× for real (through WheelInput + the shared WheelToggle),
  // with a rendered frame between each flip so the transition is actually caught
  // mid-cycle, then assert one more open still works and is interactive.
  const cycle = async (open: 'openBuild' | 'openUpgrade', registryId: string) => {
    for (let i = 0; i < 15; i++) {
      await page.evaluate((m) => window.__upgradeWheelStage![m](), open);
      await page.waitForFunction(() => window.__upgradeWheelStage!.interactive() === true, undefined, {
        timeout: 20_000,
      });
      await page.evaluate(() => window.__upgradeWheelStage!.close());
      await page.waitForFunction(() => window.__upgradeWheelStage!.interactive() === false, undefined, {
        timeout: 20_000,
      });
    }
    // One more open after all the mashing — the assertion the field bug fails.
    await page.evaluate((m) => window.__upgradeWheelStage![m](), open);
    const interactive = await page
      .waitForFunction(() => (window.__upgradeWheelStage!.interactive() ? true : null), undefined, {
        timeout: 20_000,
      })
      .then((h) => h.jsonValue());
    expect(interactive, `${open} still opens interactively after 15 cycles`).toBe(true);
    const ids = await page.evaluate(() => window.__planetRush!.layout.map((e) => e.id));
    expect(ids, `${open} still draws (${registryId}) after 15 cycles`).toContain(registryId);
    await page.evaluate(() => window.__upgradeWheelStage!.close());
  };

  await cycle('openBuild', 'build-wheel');
  await cycle('openUpgrade', 'upgrade-wheel');

  expect(pageErrors, 'no page errors while mashing the wheels').toEqual([]);
});
