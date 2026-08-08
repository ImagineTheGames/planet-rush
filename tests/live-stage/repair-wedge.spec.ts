/**
 * tests/live-stage/repair-wedge.spec.ts — discrete REPAIR REACTOR, verified in the
 * REAL booted client with REAL clicks. OWNER: UI Engineer (p5-07/p5-08, GDD §2.5).
 *
 * p5-07 ratified repair as a DISCRETE purchase (developer amendment, 2026-07-26):
 * one wheel press spends 1 ore and restores `REPAIR_HP_PER_ORE` (15) core HP,
 * clamped — no channel, no drain, no stacking. p5-08 (this deliverable) makes the
 * wedge state the deal before the tap: "REPAIR REACTOR / +15 HP / 1", the REAL
 * partial ("+7 HP") near full, and disabled-with-a-reason ("REACTOR FULL", "NO
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
   *  Build wheel. Returns the staged core/bank, or null if there is no ship/station. */
  siege(damage: number, banked: number): { coreHp: number; maxCoreHp: number; banked: number } | null;
  /** Set the local core to exactly `hp` — stage the near-full / full cases. */
  setCore(hp: number): { coreHp: number; maxCoreHp: number } | null;
  /** The LOGICAL screen point at the centre of the REPAIR wedge (the real-click door). */
  repairWedgePoint(): { x: number; y: number } | null;
  /** The REPAIR wedge centre in CLIENT (physical CSS) space — the same point rotated
   *  back through the landscape lock, so a real tap lands on it on BOTH form factors
   *  (identity on desktop, un-rotated on a portrait phone). */
  repairWedgeClientPoint(): { x: number; y: number } | null;
  /** The REPAIR wedge the real view drew this frame — its second line, whether it
   *  drew bright (pressable), and its cost. */
  wedge(): { sub: string; ready: boolean; cost: number | null } | null;
  /** The live core HP / max / bank / repair tell / repair COOLDOWN remaining this
   *  frame. `repairGate > 0` ⇒ the wedge draws its "REPAIR IN Ns" countdown and a
   *  press is refused `cooling-down`. */
  readout(): {
    coreHp: number;
    maxCoreHp: number;
    banked: number;
    repairing: boolean;
    repairGate: number;
  } | null;
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
  // The CLIENT-space wedge centre: identical to the logical point on desktop, and
  // correctly un-rotated on a portrait phone under the landscape lock — so the one
  // tap door drives both form factors.
  const point = await page.evaluate(() => window.__repairStage!.repairWedgeClientPoint());
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
  expect(staged, 'the local ship and its station were available to stage').not.toBeNull();
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

test('one real click heals once and arms the cooldown; the four rapid re-taps behind it are refused', async ({
  page,
}) => {
  // The cooldown truth on the shipped bundle (RATIFIED developer, 2026-07-28): repair
  // is a rationed patch now, NOT a heal-tank. One tap heals 15 HP and arms the 15 s
  // gate; every rapid re-tap behind it is refused `cooling-down`, spending nothing —
  // the live-stage analog of the sim's `buildings.test.ts` cooldown check, proven
  // through the REAL wedge on the REAL bundle (the wiring the finding was about).
  const pageErrors = await boot(page);

  // Siege 80 HP down (so a full 15-HP tap never hits the clamp) and bank a comfortable
  // 10 ore — plenty to (wrongly) over-spend if the gate were not honoured.
  const staged = await page.evaluate(() => window.__repairStage!.siege(80, 10));
  expect(staged, 'staged').not.toBeNull();
  const coreAtStart = staged!.coreHp;

  // The first tap heals once and arms the gate.
  await realTapRepair(page);
  await waitForCore(page, coreAtStart + REPAIR_HP);
  const armed = await page.evaluate(() => window.__repairStage!.readout());
  expect(armed!.repairGate, 'the first repair armed the cooldown gate').toBeGreaterThan(0);
  const bankAfterFirst = armed!.banked;

  // Four more rapid taps while the gate is live — each refused, changing nothing.
  for (let i = 0; i < 4; i++) await realTapRepair(page);
  // Let several live ticks pass (the gate visibly drains) so a leaked order would have
  // had every chance to spend or heal — then prove none did.
  await page.waitForFunction(
    (g0) => (window.__repairStage!.readout()?.repairGate ?? 0) < g0 - 0.3,
    armed!.repairGate,
    { timeout: 8_000 },
  );
  const after = await page.evaluate(() => window.__repairStage!.readout());
  expect(after!.coreHp, 'the four rapid re-taps healed nothing — one tap, not five').toBeCloseTo(
    coreAtStart + REPAIR_HP,
    1,
  );
  expect(after!.banked, 'the four refused taps spent no extra ore — one ore, not five').toBeCloseTo(
    bankAfterFirst,
    5,
  );
  expect(pageErrors, 'no page errors placing one real repair order then four refused').toEqual([]);
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

test('at full, the REPAIR wedge is disabled with a reason ("REACTOR FULL")', async ({ page }) => {
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
  expect(wedge!.sub, 'a full core reads REACTOR FULL, the reason it is refused').toBe('REACTOR FULL');
  expect(wedge!.ready, 'a full core makes the wedge unpressable').toBe(false);
  expect(pageErrors).toEqual([]);
});

/**
 * The finding this deliverable fixes (evidence: repair-cooldown-countdown-ui): after
 * a repair the sim arms a 15 s cooldown and refuses every further order
 * `cooling-down`, spending nothing — but the wedge was drawing "+15 HP" at full
 * brightness the whole time, a ready-looking press that silently did nothing. The
 * full cycle, driven through the REAL door on the REAL bundle:
 *
 *   ready "+15 HP"  →  tap heals + arms cooldown  →  disabled "REPAIR IN Ns" that
 *   ticks down and refuses a second tap (no ore, no HP)  →  re-arms to "+15 HP" the
 *   moment the gate drains.
 *
 * The countdown is read straight off `station.repairGate` each frame (no UI timer,
 * the p4-17 rule); the spec waits real seconds for the gate to drain so the re-arm is
 * the sim's, not a fake. Run on BOTH form factors — desktop mouse and portrait phone
 * touch — so the wiring is proven on the two devices the game ships to.
 */
async function driveFullCooldownCycle(page: import('@playwright/test').Page): Promise<void> {
  const pageErrors = await boot(page);

  // Siege 30 HP down and bank a comfortable 5 ore, then open the wheel.
  const staged = await page.evaluate(() => window.__repairStage!.siege(30, 5));
  expect(staged, 'the local ship and its station were available to stage').not.toBeNull();
  const coreAtStart = staged!.coreHp;

  // Before the tap the wedge is the pressable "+15 HP" deal — the cooldown is cold.
  const ready = await page
    .waitForFunction(() => {
      const w = window.__repairStage!.wedge();
      return w && w.ready ? w : null;
    }, undefined, { timeout: 20_000 })
    .then((h) => h.jsonValue());
  expect(ready!.sub, 'the cold wedge shows the full tap it will buy').toBe(`+${REPAIR_HP} HP`);

  // --- Tap: the core heals and the cooldown ARMS ---------------------------------
  await realTapRepair(page);
  await waitForCore(page, coreAtStart + REPAIR_HP);
  const armed = await page.evaluate(() => window.__repairStage!.readout());
  expect(armed!.repairGate, 'the successful repair armed the cooldown gate').toBeGreaterThan(0);

  // --- Cooling down: the wedge is DISABLED with a live "REPAIR IN Ns" countdown ---
  // Read the DRAWN wedge and the LIVE sim gate in the SAME evaluate, so the two
  // reflect one snapshot and the match below is not raced by a tick landing between
  // two reads.
  const cooling = await page
    .waitForFunction(() => {
      const w = window.__repairStage!.wedge();
      const r = window.__repairStage!.readout();
      return w && r && !w.ready && /^REPAIR IN \d+s$/.test(w.sub)
        ? { sub: w.sub, ready: w.ready, repairGate: r.repairGate }
        : null;
    }, undefined, { timeout: 20_000 })
    .then((h) => h.jsonValue());
  expect(cooling!.ready, 'a cooling core makes the wedge unpressable — never a ready-looking press').toBe(false);
  // The shown seconds are the ceiling of the sim's remaining gate (no UI timer). The
  // drawn wedge lags the live sim by at most one render frame, so the shown ceil sits
  // within 1 s of `repairGate` — proving the copy TRACKS sim state (a UI timer would
  // drift free), while the exact re-arm below proves it hits zero on the sim's tick.
  const shown = Number(/^REPAIR IN (\d+)s$/.exec(cooling!.sub)![1]);
  expect(
    Math.abs(shown - Math.max(1, Math.ceil(cooling!.repairGate))),
    'the countdown tracks the sim remaining, ceiled (within one render frame)',
  ).toBeLessThanOrEqual(1);

  // --- A second REAL tap while cooling changes NOTHING: no ore, no HP -------------
  const before = await page.evaluate(() => window.__repairStage!.readout());
  await realTapRepair(page);
  // Let several live ticks pass (the gate visibly drains) so a refused order would
  // have had every chance to (wrongly) spend — then prove it did not.
  await page.waitForFunction(
    (g0) => (window.__repairStage!.readout()?.repairGate ?? 0) < g0 - 0.3,
    before!.repairGate,
    { timeout: 8_000 },
  );
  const afterRefused = await page.evaluate(() => window.__repairStage!.readout());
  expect(afterRefused!.banked, 'the refused tap spent no ore from the bank').toBeCloseTo(before!.banked, 5);
  expect(afterRefused!.coreHp, 'the refused tap healed no HP').toBeCloseTo(before!.coreHp, 5);

  await page.screenshot({ path: 'tests/live-stage/repair-cooldown-evidence.png' });

  // --- Re-arm: the moment the gate drains, the wedge is the "+15 HP" deal again ---
  const rearmed = await page
    .waitForFunction(() => {
      const r = window.__repairStage!.readout();
      const w = window.__repairStage!.wedge();
      return r && w && r.repairGate <= 0 && w.ready ? w : null;
    }, undefined, { timeout: 20_000 })
    .then((h) => h.jsonValue());
  expect(rearmed!.sub, 'the drained gate restores the "+15 HP" deal at full brightness').toBe(`+${REPAIR_HP} HP`);
  expect(rearmed!.ready, 'the re-armed wedge is pressable again').toBe(true);

  expect(pageErrors, 'no page errors across the whole cooldown cycle').toEqual([]);
}

test('PC: the REPAIR wedge counts the cooldown down and re-arms — no ready-looking press that does nothing', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await driveFullCooldownCycle(page);
});

// The same full cycle on the two device profiles the mobile matrix contracts, at
// their real portrait pixels: under the landscape lock the wedge point is rotated
// back to physical space, so a real touch lands on the wedge the client drew.
const PHONE_PROFILES = [
  { name: 'iPhone', width: 390, height: 844, dpr: 3 },
  { name: 'Pixel', width: 412, height: 915, dpr: 2.6 },
] as const;

for (const profile of PHONE_PROFILES) {
  test.describe(`phone profile — ${profile.name} (portrait, held)`, () => {
    test.use({
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: profile.dpr,
      viewport: { width: profile.width, height: profile.height },
    });

    test(`${profile.name}: the REPAIR wedge counts the cooldown down and re-arms on touch`, async ({ page }) => {
      test.setTimeout(120_000);
      await driveFullCooldownCycle(page);
    });
  });
}
