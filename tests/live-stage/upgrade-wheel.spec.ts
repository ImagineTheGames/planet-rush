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
interface WeaponPip {
  track: string;
  label: string;
  tier: number;
  maxTier: number;
}
interface UpgradeWheelStage {
  openBuild(): { open: boolean } | null;
  openUpgrade(ore?: number): { open: boolean } | null;
  /** Drill into the nested WEAPON sub-wheel (RATIFIED v0.2.2 — "tap WEAPON"). */
  openWeapon(): { weaponOpen: boolean } | null;
  /** Back out of the sub-wheel to the main wheel (the BACK wedge). */
  back(): { weaponOpen: boolean };
  close(): void;
  interactive(): boolean;
  buyTier(i: number): { result: string; tier: number } | null;
  /** Buy a tier on a named track — used to buy SPEED off the drawn sub-wheel. */
  buyByTrack(track: string): { result: string; tier: number } | null;
  tierOf(i: number): number | null;
  setOre(ore: number): { banked: number } | null;
  wedges(): Array<{
    kind: 'track' | 'weapon' | 'back';
    track: string | null;
    label: string;
    tier: number;
    current: string;
    next: string | null;
    cost: number | null;
    state: 'ready' | 'unaffordable' | 'maxed';
    summary: WeaponPip[] | null;
  }>;
}
interface LayoutEntry {
  id: string;
  anchor: { region: string; margin: number };
  bounds: { x: number; y: number; width: number; height: number };
}
/** The `?debug=1`-only press-feedback seam (field report v0.2.2), mirrors
 *  `installPressStage` in `src/main.ts`. */
interface ControlFeedback {
  scale: number;
  glow: number;
  shakeX: number;
  reject: number;
  shimmer: number;
}
interface CostFloat {
  surface: 'build' | 'upgrade';
  index: number;
  amount: number;
  progress: number;
  alpha: number;
  deposit: boolean;
}
interface PressStage {
  openBuild(ore?: number): { open: boolean; banked: number } | null;
  press(surface: 'build' | 'upgrade', index: number): void;
  confirm(surface: 'build' | 'upgrade', index: number, amount: number, deposit?: boolean, core?: boolean): void;
  feedback(surface: 'build' | 'upgrade', index: number): ControlFeedback;
  floats(): CostFloat[];
  coreShimmer(): number;
  bank(): number | null;
}
interface StageWindow {
  __upgradeWheelStage?: UpgradeWheelStage;
  __pressStage?: PressStage;
  __planetRush?: { layout: readonly LayoutEntry[] };
}
declare const window: Window & StageWindow;

/** Build-wheel wedge indices, from WHEEL_ORDER [turret, shield, repair, upgrade, bank]. */
const TURRET_WEDGE = 0;
const REPAIR_WEDGE = 2;

/** buyTier maps onto the flat funnel order [Power, Engine, Cargo, Hull], so index
 *  1 is ENGINE — a SHIP track that stays on the main wheel (the weapon tracks moved
 *  into the sub-wheel). On the Vanguard it reads 100% at stock, 115% at tier 1. */
const ENGINE = 1;

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

test('the main upgrade wheel is about the SHIP: HULL, ENGINE, CARGO and a WEAPON wedge (RATIFIED v0.2.2)', async ({
  page,
}) => {
  const pageErrors = await boot(page);

  // Open the upgrade wheel with ore to spend, then read the wedges the REAL view
  // drew — the main wheel is the ship: HULL, ENGINE, CARGO and a WEAPON wedge that
  // opens the sub-wheel. A bare SPEED/DAMAGE wedge never sits next to ENGINE.
  await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade(999));
  const main = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges();
        return w.length > 0 ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  const labels = main!.map((w) => w.label);
  expect(labels, 'the main wheel names the ship tracks + WEAPON').toEqual([
    'WEAPON',
    'ENGINE',
    'CARGO',
    'HULL',
  ]);
  expect(labels, 'DAMAGE is a weapon-group track — it lives in the sub-wheel').not.toContain('DAMAGE');
  expect(labels, 'so does SPEED — the whole reason for the sub-wheel').not.toContain('SPEED');

  // The WEAPON wedge opens a screen and summarises the weapon tiers as pips (item 3).
  const weapon = main!.find((w) => w.label === 'WEAPON')!;
  expect(weapon.kind, 'the WEAPON wedge opens the sub-wheel, it does not buy').toBe('weapon');
  expect(weapon.cost, 'a screen-opening wedge shows no cost').toBeNull();
  expect(weapon.summary, 'it carries a pip summary of the weapon tracks').not.toBeNull();
  expect(weapon.summary!.map((p) => p.label), 'DAMAGE and SPEED tiers at a glance').toEqual([
    'DAMAGE',
    'SPEED',
  ]);

  // The upgrade wheel is registered as a drawn overlay.
  const openIds = await page.evaluate(() => window.__planetRush!.layout.map((e) => e.id));
  expect(openIds, 'the upgrade wheel registers its drawn footprint').toContain('upgrade-wheel');

  // Buy a tier on a main-wheel track (ENGINE) through the sim's real validated
  // purchase, and assert the wedge re-renders — the path report #1 asked for.
  const engineBefore = main!.find((w) => w.label === 'ENGINE')!;
  expect(engineBefore.current, 'Vanguard engine reads 100% at stock').toBe('100%');
  expect(engineBefore.state, 'affordable with ore banked').toBe('ready');

  const bought = await page.evaluate((i) => window.__upgradeWheelStage!.buyTier(i), ENGINE);
  expect(bought!.result, 'buyUpgrade accepted it').toBe('ok');
  expect(bought!.tier, 'the ship is now one tier up on ENGINE').toBe(1);

  const engineAfter = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges().find((x) => x.label === 'ENGINE');
        return w && w.tier === 1 ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(engineAfter!.current, 'its current value re-rendered to the new tier (100% → 115%)').toBe(
    '115%',
  );

  expect(pageErrors, 'no page errors staging the upgrade wheel').toEqual([]);
});

test('an unaffordable wedge dims with a reason (field report #1)', async ({ page }) => {
  const pageErrors = await boot(page);

  // Open the wheel with too little ore to buy anything — a buyable wedge should be
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

  const engine = wedges!.find((w) => w.label === 'ENGINE')!;
  expect(engine.state, 'a broke player sees ENGINE dimmed *because* unaffordable').toBe('unaffordable');
  expect(engine.cost, 'the cost is still shown — the trade stays legible').not.toBeNull();
  // The WEAPON wedge opens a screen, so it is never dimmed for being broke.
  const weapon = wedges!.find((w) => w.label === 'WEAPON')!;
  expect(weapon.state, 'WEAPON still invites exploration when broke').toBe('ready');

  expect(pageErrors, 'no page errors staging an unaffordable wedge').toEqual([]);
});

// --- The WEAPON sub-wheel + its exact-cost boundary (RATIFIED v0.2.2) --------
//
// The full field flow, proved on the REAL booted client: open upgrades → tap
// WEAPON → a sub-wheel with both weapon tracks (DAMAGE, SPEED) → buy SPEED at
// exactly its cost through the sim's own `buyUpgrade` → back out → the main wheel
// is intact. The exact-cost boundary (p4-06's shared affordability helper, GDD
// screenshot "TOTAL == cost, can't buy") is inherited here: bank == cost buys and
// empties the bank; bank == cost-1 dims SPEED with the cost still shown.

test('tap WEAPON → sub-wheel with DAMAGE & SPEED → buy SPEED at exact cost → back out → main wheel intact (RATIFIED v0.2.2)', async ({
  page,
}) => {
  const pageErrors = await boot(page);
  // The bank read-back lives on the sibling press seam (same local ship, same
  // world); both are installed at boot, so wait for it before reading.
  await page.waitForFunction(() => typeof window.__pressStage?.bank === 'function', undefined, {
    timeout: 20_000,
  });

  // Open upgrades — the main wheel — then TAP WEAPON to drill into the sub-wheel.
  await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade(999));
  await page.evaluate(() => window.__upgradeWheelStage!.openWeapon());

  const sub = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges();
        return w.some((x) => x.label === 'SPEED') ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(sub!.map((w) => w.label), 'the sub-wheel is DAMAGE, SPEED, then BACK').toEqual([
    'DAMAGE',
    'SPEED',
    'BACK',
  ]);
  const backWedge = sub!.find((w) => w.label === 'BACK')!;
  expect(backWedge.kind, 'BACK navigates home, it does not buy').toBe('back');

  // Screenshot the drawn sub-wheel (attached to the PR body).
  await page.screenshot({ path: 'tests/live-stage/weapon-subwheel-evidence.png' });

  // Read SPEED's real cost off the DRAWN sub-wheel rather than hard-coding it, so
  // a retune of the ladder cannot silently rot this test.
  const cost = sub!.find((w) => w.label === 'SPEED')!.cost;
  expect(cost, 'the SPEED wedge prints a cost').toBeGreaterThan(0);

  // --- bank == cost - 1: one ore short. SPEED dims WITH its cost, and the sim's
  //     real purchase refuses it, spending nothing. ---
  await page.evaluate((c) => window.__upgradeWheelStage!.setOre(c - 1), cost!);
  const short = await page
    .waitForFunction(
      () => {
        const p = window.__upgradeWheelStage!.wedges().find((w) => w.label === 'SPEED');
        return p && p.state === 'unaffordable' ? p : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(short!.cost, 'the cost stays on the dimmed SPEED wedge so the shortfall reads').toBe(cost);

  const refused = await page.evaluate(() => window.__upgradeWheelStage!.buyByTrack('speed'));
  expect(refused!.result, 'the sim refuses a bank one ore short').toBe('cannot-afford');
  expect(refused!.tier, 'a refused purchase advances no tier').toBe(0);
  expect(await page.evaluate(() => window.__pressStage!.bank()), 'a refused purchase spends nothing').toBe(
    cost! - 1,
  );

  // --- bank == cost exactly: SPEED is ready, the purchase succeeds, bank → 0. ---
  await page.evaluate((c) => window.__upgradeWheelStage!.setOre(c), cost!);
  const ready = await page
    .waitForFunction(
      () => {
        const p = window.__upgradeWheelStage!.wedges().find((w) => w.label === 'SPEED');
        return p && p.state === 'ready' ? p : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(ready!.state, 'bank == cost → SPEED is purchasable, not dimmed').toBe('ready');

  const bought = await page.evaluate(() => window.__upgradeWheelStage!.buyByTrack('speed'));
  expect(bought!.result, 'the exact-cost purchase went through the sim').toBe('ok');
  expect(bought!.tier, 'the ship advanced one tier on SPEED').toBe(1);
  expect(await page.evaluate(() => window.__pressStage!.bank()), 'the last ore spent — the bank hit zero').toBe(
    0,
  );

  // --- Back out: the main wheel is intact, and the WEAPON pip summary caught up. ---
  await page.evaluate(() => window.__upgradeWheelStage!.back());
  const main = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges();
        return w.some((x) => x.label === 'WEAPON') ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(main!.map((w) => w.label), 'back out lands on the main wheel, unchanged').toEqual([
    'WEAPON',
    'ENGINE',
    'CARGO',
    'HULL',
  ]);
  const speedPip = main!.find((w) => w.label === 'WEAPON')!.summary!.find((p) => p.label === 'SPEED')!;
  expect(speedPip.tier, 'the WEAPON summary shows the SPEED tier just bought').toBe(1);

  expect(pageErrors, 'no page errors staging the WEAPON sub-wheel').toEqual([]);
});

test('the build wheel shares the same exact-cost boundary: TURRET buys at exactly its cost, refuses one ore short (field report v0.2.2)', async ({
  page,
}) => {
  const pageErrors = await bootPress(page);

  // TURRET costs 3 ore (GDD §2.8; sim `TURRET.cost`) — the same boundary helper
  // the upgrade wheel above obeys, verified through the drawn build wheel.
  const TURRET_COST = 3;

  // bank == cost: the wedge is live, so a press reads as an ACCEPTED press
  // (glow, scale-down) and never the red rejection tell.
  const opened = await page.evaluate((c) => window.__pressStage!.openBuild(c), TURRET_COST);
  expect(opened?.banked, 'the bank was staged to exactly the turret cost').toBe(TURRET_COST);
  const accepted = await page
    .waitForFunction(
      (i) => {
        window.__pressStage!.press('build', i);
        const fb = window.__pressStage!.feedback('build', i);
        return fb && fb.glow > 0 ? fb : null;
      },
      TURRET_WEDGE,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(accepted!.glow, 'a press at exactly the cost is accepted (glows)').toBeGreaterThan(0);
  expect(accepted!.reject, 'an exactly-affordable press never red-flashes').toBe(0);

  // bank == cost - 1: one ore short. The same press must read as a REJECTION.
  await page.evaluate((c) => window.__pressStage!.openBuild(c - 1), TURRET_COST);
  const rejected = await page
    .waitForFunction(
      (i) => {
        window.__pressStage!.press('build', i);
        const fb = window.__pressStage!.feedback('build', i);
        return fb && fb.reject > 0 ? fb : null;
      },
      TURRET_WEDGE,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(rejected!.reject, 'a press one ore short is rejected (red-flashes)').toBeGreaterThan(0);
  expect(rejected!.glow, 'a rejected press never glows like an accepted one').toBe(0);

  expect(pageErrors, 'no page errors staging the build-wheel boundary').toEqual([]);
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

  // Extend the robustness to the NESTED pair (RATIFIED v0.2.2): drill WEAPON in
  // and out 15× and assert the sub-wheel still draws and the wheel stays
  // interactive — the p2-05 leak fix must hold across the extra level too.
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade());
    await page.evaluate(() => window.__upgradeWheelStage!.openWeapon());
    await page.waitForFunction(
      () => window.__upgradeWheelStage!.wedges().some((w) => w.label === 'SPEED'),
      undefined,
      { timeout: 20_000 },
    );
    await page.evaluate(() => window.__upgradeWheelStage!.back());
    await page.waitForFunction(
      () => window.__upgradeWheelStage!.wedges().some((w) => w.label === 'WEAPON'),
      undefined,
      { timeout: 20_000 },
    );
    await page.evaluate(() => window.__upgradeWheelStage!.close());
  }
  // One more full drill after all the mashing — the assertion the field bug fails.
  await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade());
  await page.evaluate(() => window.__upgradeWheelStage!.openWeapon());
  const drilled = await page
    .waitForFunction(
      () => {
        const w = window.__upgradeWheelStage!.wedges();
        return window.__upgradeWheelStage!.interactive() && w.some((x) => x.label === 'SPEED')
          ? w
          : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(drilled!.map((w) => w.label), 'the sub-wheel still drills after 15 cycles').toEqual([
    'DAMAGE',
    'SPEED',
    'BACK',
  ]);
  const ids = await page.evaluate(() => window.__planetRush!.layout.map((e) => e.id));
  expect(ids, 'the upgrade wheel still draws its footprint after the drill mash').toContain(
    'upgrade-wheel',
  );
  await page.evaluate(() => window.__upgradeWheelStage!.close());

  expect(pageErrors, 'no page errors while mashing the wheels').toEqual([]);
});

// --- Press & action feedback (field report v0.2.2) -------------------------
//
// "UI needs visual feedback when it's clicked; when going to repair core it's
// tough to know it did anything." These drive the HUD's own press/confirm seams
// on the REAL booted client and read the motion back — the derivation of a
// confirmation from sim state is unit-tested headless (press-feedback.test.ts);
// what a boot proves is that it is wired to the drawn wheel.

async function bootPress(page: import('@playwright/test').Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__pressStage?.openBuild === 'function', undefined, {
    timeout: 20_000,
  });
  return pageErrors;
}

test('pressing an affordable wedge shows the pressed tell on the real client (report #1)', async ({
  page,
}) => {
  const pageErrors = await bootPress(page);

  // Open the Build wheel with ore to spend, so TURRET is a live wedge.
  const opened = await page.evaluate(() => window.__pressStage!.openBuild(999));
  expect(opened?.open, 'the Build wheel opened at the planet').toBe(true);

  // Press the wedge and read the motion back — a live press scales it down and
  // glows it, and never red-flashes it (that is the rejected tell).
  const f = await page
    .waitForFunction(
      (i) => {
        window.__pressStage!.press('build', i);
        const fb = window.__pressStage!.feedback('build', i);
        return fb && fb.glow > 0 && fb.scale < 1 ? fb : null;
      },
      TURRET_WEDGE,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(f!.scale, 'the pressed wedge scaled down').toBeLessThan(1);
  expect(f!.glow, 'the pressed wedge glowed').toBeGreaterThan(0);
  expect(f!.reject, 'an affordable press never red-flashes').toBe(0);

  await page.screenshot({ path: 'tests/live-stage/press-feedback-evidence.png' });
  expect(pageErrors, 'no page errors while pressing a wedge').toEqual([]);
});

test('a REPAIR confirmation floats a cost and shimmers the core (report #2 — the flagship)', async ({
  page,
}) => {
  const pageErrors = await bootPress(page);

  await page.evaluate(() => window.__pressStage!.openBuild(50));

  // Inject the confirmation the sim's real repair channel produces (core healing
  // for 1 ore), then read back that the cost floated and the core shimmered — the
  // "tough to know it did anything" report, refuted on the drawn client.
  await page.evaluate((i) => window.__pressStage!.confirm('build', i, 1, false, true), REPAIR_WEDGE);

  const floats = await page
    .waitForFunction(
      () => {
        const fs = window.__pressStage!.floats();
        return fs.length > 0 ? fs : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  const repairFloat = floats!.find((f) => f.index === REPAIR_WEDGE);
  expect(repairFloat, 'a cost floated off the REPAIR wedge').toBeDefined();
  expect(repairFloat!.amount, 'it floats the repair entry cost').toBe(1);
  expect(repairFloat!.alpha, 'the float is visible').toBeGreaterThan(0);

  const shimmer = await page.evaluate(() => window.__pressStage!.coreShimmer());
  expect(shimmer, 'the core shimmered as it healed').toBeGreaterThan(0);

  // The wedge itself pulses/shimmers on confirm.
  const fb = await page.evaluate((i) => window.__pressStage!.feedback('build', i), REPAIR_WEDGE);
  expect(fb.shimmer, 'the REPAIR wedge shimmered on confirm').toBeGreaterThan(0);

  expect(pageErrors, 'no page errors while confirming a repair').toEqual([]);
});

test('a disabled wedge press red-flashes and changes no sim state (report #3)', async ({ page }) => {
  const pageErrors = await bootPress(page);

  // Open the wheel with NO ore, so TURRET is unaffordable — a press must read as a
  // rejection, not a dead press.
  const opened = await page.evaluate(() => window.__pressStage!.openBuild(0));
  expect(opened?.banked, 'the bank was drained so the wedge is disabled').toBe(0);

  const f = await page
    .waitForFunction(
      (i) => {
        window.__pressStage!.press('build', i);
        const fb = window.__pressStage!.feedback('build', i);
        return fb && fb.reject > 0 ? fb : null;
      },
      TURRET_WEDGE,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(f!.reject, 'the disabled wedge red-flashed').toBeGreaterThan(0);
  expect(f!.glow, 'a rejected press never glows like an accepted one').toBe(0);

  // "Nothing happened" made checkable: the visual fired, but the bank did not move
  // — a press tell is not a purchase.
  const bank = await page.evaluate(() => window.__pressStage!.bank());
  expect(bank, 'a rejected press spends nothing').toBe(0);

  expect(pageErrors, 'no page errors while pressing a disabled wedge').toEqual([]);
});
