/**
 * tests/live-stage/ore-deposit.spec.ts — depositing ore at home, verified in the
 * REAL booted client. OWNER: Gameplay Engineer (field report v0.1.2).
 *
 * The developer's report: "there's no way to deposit ore … it should fly from my
 * ship to the planet but it doesn't, it just stays on my ship." Mining filled the
 * hold; nothing emptied it into the safe bank the Build wheel spends — the human
 * had no path the bots' instant BANK press gave them. The fix is a sim rule
 * (`src/sim`): a ship **docked and parked at its own planet** auto-transfers its
 * hold into the bank at a steady rate, and ore-flight couriers fly ship→planet to
 * show it. The unit suite pins the rule; this pins that it actually happens on a
 * real boot — the hold falls, the bank rises, and flight sprites exist while it
 * does — the full path sim state → the chunk layer the renderer already draws.
 *
 * It runs WITHOUT `?freeze=1` on purpose: the point is to watch the LIVE sim drain
 * the hold over about a second, which a pinned frame cannot show. The local ship
 * is parked at its own planet by the `?debug=1` seam and given no input, so the
 * only thing moving its ore is the deposit rule under test.
 */
import { test, expect } from '@playwright/test';

/** The `?debug=1`-only seam this spec drives — installed in `src/main.ts`
 *  (`installOreDepositStage`), mutating only plain sim data behind the flag. */
interface OreDepositStage {
  /** Park the LOCAL ship at rest at its own planet with `ore` in the hold (the
   *  bay is widened to fit), starting the drain; returns the staged hold/bank. */
  stage(ore: number): { cargo: number; banked: number } | null;
  /** The live hold and bank the sim holds this frame — what the HUD ticks off. */
  readout(): { cargo: number; banked: number } | null;
  /** Ore-flight couriers in the world this frame — deposit chunks the renderer
   *  draws (it draws every chunk), so a positive count is drawn flight sprites. */
  flights(): number;
}
interface StageWindow {
  __oreDepositStage?: OreDepositStage;
}
declare const window: Window & StageWindow;

test('a docked ship deposits its hold into the bank, ore flying to the planet, in the real client', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Live sim (no ?freeze): we need the drain to actually run.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The staging seam installs during boot; wait for it before driving it.
  await page.waitForFunction(() => typeof window.__oreDepositStage?.stage === 'function', undefined, {
    timeout: 20_000,
  });

  // Stage a full-ish hold at the planet: 6 ore drains over ~3 s at 2 ore/s, a
  // comfortable window to watch the hold fall, the bank rise, and couriers fly.
  const STAGED = 6;
  const staged = await page.evaluate((ore) => window.__oreDepositStage!.stage(ore), STAGED);
  expect(staged, 'the local ship and its planet were available to stage').not.toBeNull();
  expect(staged!.cargo, 'the hold was loaded with the staged ore').toBeCloseTo(STAGED, 5);
  const bankAtStart = staged!.banked;

  // Watch the LIVE sim: the hold must fall below where it was staged while ore is
  // in flight to the planet — the developer's "it should fly from my ship to the
  // planet" made real, read straight off sim state and the drawn chunk layer.
  const midDrain = await page
    .waitForFunction(
      (start) => {
        const s = window.__oreDepositStage!;
        const r = s.readout();
        if (!r) return null;
        // The hold is draining, the bank is filling, AND couriers are on the wing.
        const draining = r.cargo < start - 0.25 && r.cargo > 0.25;
        if (draining && s.flights() > 0) return { cargo: r.cargo, banked: r.banked, flights: s.flights() };
        return null;
      },
      STAGED,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  // Caught mid-drain: hold down, bank up, ore visibly in flight.
  expect(midDrain!.cargo, 'the hold has fallen below the staged amount').toBeLessThan(STAGED);
  expect(midDrain!.banked, 'the bank has risen above where it started').toBeGreaterThan(bankAtStart);
  expect(midDrain!.flights, 'ore-flight courier sprites exist while the hold drains').toBeGreaterThan(0);

  // Screenshot the flight for the PR body — ore streaming from ship to planet.
  await page.screenshot({ path: 'tests/live-stage/ore-deposit-evidence.png' });

  // And the drain completes: the whole hold ends up banked, conserved to the ore.
  const done = await page
    .waitForFunction(
      () => {
        const r = window.__oreDepositStage!.readout();
        return r && r.cargo <= 0.001 ? r : null;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(done!.cargo, 'the hold is empty once the drain finishes').toBeLessThanOrEqual(0.001);
  expect(done!.banked, 'every ore that left the hold landed in the bank').toBeCloseTo(
    bankAtStart + STAGED,
    2,
  );

  expect(pageErrors, 'no page errors while staging the deposit').toEqual([]);
});
