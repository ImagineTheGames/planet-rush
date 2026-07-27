/**
 * tests/live-stage/repair-wedge.spec.ts — discrete REPAIR CORE, verified in the
 * REAL booted client with REAL clicks. OWNER: UI Engineer (p5-07/p5-08, GDD §2.5).
 *
 * p5-07 ratified repair as a DISCRETE purchase (developer amendment, 2026-07-26):
 * one wheel press spends 1 ore and restores `REPAIR_HP_PER_ORE` (15) core HP,
 * clamped — no channel, no drain, no stacking. p5-08 (this deliverable) makes the
 * wedge state the deal before the tap: "REPAIR CORE / +15 HP / 1", the REAL
 * partial ("+7 HP") near full, and disabled-with-a-reason ("CORE FULL", "NO
 * REPAIR", "NEED 1 ORE"). The pure model is unit-green (src/ui/build-wheel.test.ts);
 * what only a boot can prove is that the shipped bundle DRAWS that deal and routes
 * a genuine pointer press on the drawn wedge into one discrete order that moves the
 * sim — the "dark matter" a unit test can't reach.
 *
 * Every press here is a REAL synthesized `pointerdown` at the wedge's drawn centre
 * (the p1a rule) — the same event a mouse click / thumb tap fires, into the same
 * `main.ts` handler — NOT a debug method that fakes the order. It runs WITHOUT
 * `?freeze` on purpose: a frozen sim never drains the wheel order, so the purchase
 * has to run live. The ship is parked docked and given no input, so the only thing
 * moving core HP and the bank is the repair the click bought.
 *
 * Driven through the `?debug=1` `window.__repairStage` seam (installed in
 * `main.ts`, the same discipline as `__pressStage`): it sieges the local core,
 * funds the bank, opens the Build wheel, hands back the wedge's DRAWN line and the
 * live sim readout, and gives the LOGICAL point to click.
 */
import { test, expect } from '@playwright/test';

/** One tap's HP and ore, mirroring the sim's ratified constants (kept local so the
 *  spec reads as a black-box check of the shipped numbers). */
const REPAIR_HP = 15;
const REPAIR_ORE = 1;

/** The `?debug=1`-only repair seam this spec drives (mirrors `installRepairStage`
 *  in `src/main.ts`). */
interface RepairStage {
  /** Siege the local core down by `damage`, bank `banked`, park docked, open the
   *  Build wheel. Returns the staged core/bank, or null if there is no ship/planet. */
  siege(damage: number, banked: number): { coreHp: number; maxCoreHp: number; banked: number } | null;
  /** Set the local core to exactly `hp` — stage the near-full / full cases. */
  setCore(hp: number): { coreHp: number; maxCoreHp: number } | null;
  /** The LOGICAL screen point at the centre of the REPAIR wedge (the real-click door). */
  repairWedgePoint(): { x: number; y: number } | null;
  /** The REPAIR wedge the real view drew this frame — its second line, whether it
   *  drew bright (pressable), and its cost. */
  wedge(): { sub: string; ready: boolean; cost: number | null } | null;
  /** The live core HP / max / bank / repair tell this frame. */
  readout(): { coreHp: number; maxCoreHp: number; banked: number; repairing: boolean } | null;
}
interface StageWindow {
  __repairStage?: RepairStage;
}
declare const window: Window & StageWindow;

/** Boot the real client WITHOUT ?freeze — the sim steps, so a real press places an
 *  order that actually resolves against sim state on the next tick. */
async function boot(page: import('@playwright/test').Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__repairStage?.siege === 'function', undefined, {
    timeout: 20_000,
  });
  return pageErrors;
}

/** Press the REPAIR wedge through the REAL door: a synthesized `pointerdown` at the
 *  exact LOGICAL point the wedge is drawn, into the same `main.ts` handler a real
 *  click hits. NOT a debug order method — this is the wiring the field report warns
 *  about ("the wedge fires the wrong verb, or the order never leaves the client"). */
async function realTapRepair(page: import('@playwright/test').Page): Promise<void> {
  const point = await page.evaluate(() => window.__repairStage!.repairWedgePoint());
  if (!point) throw new Error('no REPAIR wedge to tap');
  await page.evaluate((p) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas to tap');
    const ev = new PointerEvent('pointerdown', {
      clientX: p.x,
      clientY: p.y,
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(ev);
  }, point);
}

/** Wait until the live core HP reaches (roughly) `target` — how the spec proves a
 *  press RESOLVED before the next one, so N presses are N independent purchases. */
async function waitForCore(page: import('@playwright/test').Page, target: number): Promise<number> {
  const handle = await page.waitForFunction(
    (t) => {
      const r = window.__repairStage!.readout();
      return r && r.coreHp >= t - 0.5 ? r.coreHp : null;
    },
    target,
    { timeout: 20_000 },
  );
  return (await handle.jsonValue()) as number;
}

test('the REPAIR wedge shows "+15 HP" and a real click heals the core and spends one ore', async ({
  page,
}) => {
  const pageErrors = await boot(page);

  // Siege the core down a comfortable 30 HP (only a siege damages a core — GDD
  // §2.6) and bank 5 ore, then open the wheel.
  const staged = await page.evaluate(() => window.__repairStage!.siege(30, 5));
  expect(staged, 'the local ship and its planet were available to stage').not.toBeNull();
  const coreAtStart = staged!.coreHp;
  expect(coreAtStart, 'the core was sieged down by the staged damage').toBeCloseTo(
    staged!.maxCoreHp - 30,
    1,
  );

  // The wedge states the deal BEFORE the tap: a full tap's HP, and the bare 1-ore
  // cost — never the ore-per-HP rate as a rate, but the informed "+15 HP" number.
  const wedge = await page
    .waitForFunction(() => window.__repairStage!.wedge(), undefined, { timeout: 20_000 })
    .then((h) => h.jsonValue());
  expect(wedge!.sub, 'the wedge shows the full tap it will buy').toBe(`+${REPAIR_HP} HP`);
  expect(wedge!.ready, 'a damaged, funded core makes the wedge pressable').toBe(true);
  expect(wedge!.cost, 'the only cost numeral is the bare 1 ore').toBe(REPAIR_ORE);

  // A REAL click on the drawn wedge — the exact thing the report said "does
  // nothing, doesn't subtract ore".
  await realTapRepair(page);
  const healed = await waitForCore(page, coreAtStart + REPAIR_HP);

  // The shown deal was delivered: +15 HP on the core, −1 ore from the bank, the
  // two numbers agreeing with the wedge that promised them.
  const after = await page.evaluate(() => window.__repairStage!.readout());
  expect(healed, 'one tap lifted the core by exactly one tap of HP').toBeCloseTo(coreAtStart + REPAIR_HP, 1);
  expect(after!.banked, 'one tap spent exactly one ore from the bank').toBeCloseTo(
    staged!.banked - REPAIR_ORE,
    5,
  );

  await page.screenshot({ path: 'tests/live-stage/repair-wedge-evidence.png' });
  expect(pageErrors, 'no page errors placing a real repair order').toEqual([]);
});

test('five real clicks are five discrete purchases — exactly +75 HP for 5 ore', async ({ page }) => {
  const pageErrors = await boot(page);

  // Siege 80 HP down so five full 15-HP taps (75) never hit the clamp, and bank a
  // comfortable 10 ore. Each press is drained in its own frame (we wait for the
  // core to step up between clicks), so five clicks are five independent orders.
  const staged = await page.evaluate(() => window.__repairStage!.siege(80, 10));
  expect(staged, 'staged').not.toBeNull();
  const coreAtStart = staged!.coreHp;

  const TAPS = 5;
  for (let i = 1; i <= TAPS; i++) {
    await realTapRepair(page);
    await waitForCore(page, coreAtStart + i * REPAIR_HP);
  }

  const after = await page.evaluate(() => window.__repairStage!.readout());
  expect(after!.coreHp, 'five discrete taps healed exactly 5 × 15 HP').toBeCloseTo(
    coreAtStart + TAPS * REPAIR_HP,
    1,
  );
  expect(after!.banked, 'five discrete taps spent exactly 5 ore — no channel over-spend').toBeCloseTo(
    staged!.banked - TAPS * REPAIR_ORE,
    5,
  );
  expect(pageErrors, 'no page errors placing five real repair orders').toEqual([]);
});

test('near full, the wedge shows the REAL partial number, not a full tap', async ({ page }) => {
  const pageErrors = await boot(page);

  // Open the wheel on a damaged core, then set the core to exactly 7 HP short of
  // full: one ore still heals to the top, but only 7 HP — the informed partial.
  const staged = await page.evaluate(() => window.__repairStage!.siege(30, 9));
  expect(staged, 'staged').not.toBeNull();
  await page.evaluate(() => window.__repairStage!.setCore(window.__repairStage!.readout()!.maxCoreHp - 7));

  const wedge = await page
    .waitForFunction(
      () => {
        const w = window.__repairStage!.wedge();
        // Wait for the frame that reflects the near-full core (the sub settles).
        return w && w.sub !== `+${15} HP` ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(wedge!.sub, 'the wedge shows the partial HP a tap really buys near full').toBe('+7 HP');
  expect(wedge!.ready, 'a near-full damaged core is still pressable').toBe(true);
  expect(pageErrors).toEqual([]);
});

test('at full, the REPAIR wedge is disabled with a reason ("CORE FULL")', async ({ page }) => {
  const pageErrors = await boot(page);

  // Open the wheel, then top the core back to full: the tap would be a no-op, so
  // the wedge dims and SAYS why rather than dangling a dead press.
  const staged = await page.evaluate(() => window.__repairStage!.siege(30, 9));
  expect(staged, 'staged').not.toBeNull();
  await page.evaluate(() => window.__repairStage!.setCore(window.__repairStage!.readout()!.maxCoreHp));

  const wedge = await page
    .waitForFunction(
      () => {
        const w = window.__repairStage!.wedge();
        return w && !w.ready ? w : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(wedge!.sub, 'a full core reads CORE FULL, the reason it is refused').toBe('CORE FULL');
  expect(wedge!.ready, 'a full core makes the wedge unpressable').toBe(false);
  expect(pageErrors).toEqual([]);
});
