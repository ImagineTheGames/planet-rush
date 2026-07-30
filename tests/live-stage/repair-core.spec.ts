/**
 * tests/live-stage/repair-core.spec.ts — REPAIR CORE moves sim state, verified in
 * the REAL booted client. OWNER: Gameplay Engineer (field report v0.2; GDD §2.5).
 *
 * The report, verbatim: *"repair core isn't working — does nothing, doesn't
 * subtract ore."* The sim's repair channel is unit-green (tests/sim/
 * repair-channel.test.ts) and so is the wheel→action→sim verb path, but a unit
 * test constructs a `World` in memory — it cannot prove the SHIPPED bundle carries
 * a REPAIR wedge whose confirm actually reaches the sim. That wiring is exactly the
 * "dark matter" the report warns about (the wedge fires the wrong verb, or the
 * order never leaves the client), and it lives nowhere a unit test can reach. This
 * pins it on the real artifact.
 *
 * It stages the report's ACTUAL precondition, the one the repro missed: a core only
 * takes damage from a **siege** (GDD §2.6) — the asteroid field you mine never
 * touches it — so "let a wave hit your core" leaves the core full and REPAIR
 * correctly no-ops. The seam sieges the core (damages it) and funds the bank, then
 * places a REPAIR order through the client's OWN wheel controller (not a faked
 * action), and we watch the LIVE sim: core HP rises, the bank falls, the channel
 * holds open — the report's "does nothing / doesn't subtract ore", refuted end to
 * end on the booted client.
 *
 * It runs WITHOUT `?freeze=1` on purpose: the channel heals over a second or two,
 * which a pinned frame cannot show. The local ship is parked docked by the seam and
 * given no input, so the only thing moving core HP and the bank is the repair rule.
 */
import { test, expect } from '@playwright/test';

/** The `?debug=1`-only seam this spec drives — installed in `src/main.ts`
 *  (`installRepairStage`), staging inputs through the client's real controllers
 *  and reading back plain sim data behind the flag. */
interface RepairStage {
  /** Siege the LOCAL core down by `damage` HP and fund the bank with `banked`,
   *  parking the ship docked and at rest so the channel can open. Returns the
   *  staged core HP / max / bank, or null if there is no local ship/planet. */
  siege(damage: number, banked: number): { coreHp: number; maxCoreHp: number; banked: number } | null;
  /** Confirm the REPAIR wedge through the real wheel controller — the order the
   *  wheel funnels into the sim, driven exactly as a gamepad confirm would. */
  order(): void;
  /** The live core HP / bank / channel flag the sim holds this frame. */
  readout(): { coreHp: number; maxCoreHp: number; banked: number; repairing: boolean } | null;
}
interface StageWindow {
  __repairStage?: RepairStage;
}
declare const window: Window & StageWindow;

test('a REPAIR order placed on the real wheel heals the core and spends ore, in the real client', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Live sim (no ?freeze): we need the repair channel to actually run.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The staging seam installs during boot; wait for it before driving it.
  await page.waitForFunction(() => typeof window.__repairStage?.siege === 'function', undefined, {
    timeout: 20_000,
  });

  // Siege the core down 30 HP (only a siege damages a core — the report's missed
  // precondition) and bank a comfortable 50 ore: at 2 HP/s and 1 ore ⁄ 5 HP the
  // channel heals for ~15 s, a wide window to catch HP rising and the bank falling.
  const DAMAGE = 30;
  const BANKED = 50;
  const staged = await page.evaluate(
    ([d, b]) => window.__repairStage!.siege(d, b),
    [DAMAGE, BANKED] as const,
  );
  expect(staged, 'the local ship and its planet were available to stage').not.toBeNull();
  expect(staged!.coreHp, 'the core was sieged down by the staged damage').toBeCloseTo(staged!.maxCoreHp - DAMAGE, 5);
  expect(staged!.banked, 'the bank was funded with the staged ore').toBeCloseTo(BANKED, 5);
  const coreAtStart = staged!.coreHp;

  // Place the REPAIR order the way the player does — the wheel's own confirm,
  // through the real controller — then watch the LIVE sim. This is the exact thing
  // the report said did nothing: a REPAIR press that moves no HP and spends no ore.
  await page.evaluate(() => window.__repairStage!.order());

  const healing = await page
    .waitForFunction(
      (start) => {
        const r = window.__repairStage!.readout();
        if (!r) return null;
        // The channel is open, HP has risen above where the siege left it (but not
        // yet full), and the bank has fallen to pay for it.
        const rising = r.coreHp > start + 0.25 && r.coreHp < r.maxCoreHp;
        if (r.repairing && rising) return r;
        return null;
      },
      coreAtStart,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  // Caught mid-heal: HP up, bank down, the channel holding open — the report's
  // "does nothing, doesn't subtract ore" refuted on the real booted client.
  expect(healing!.repairing, 'the repair channel is open on the real client').toBe(true);
  expect(healing!.coreHp, 'core HP has risen above where the siege left it').toBeGreaterThan(coreAtStart);
  expect(healing!.banked, 'the bank has fallen to pay for the repair').toBeLessThan(BANKED);

  // Screenshot the healed-in-progress core for the PR body.
  await page.screenshot({ path: 'tests/live-stage/repair-core-evidence.png' });

  // Conservation: every HP healed cost its ratified ore (1 ore ⁄ 5 HP), drawn from
  // the bank — the "doesn't subtract ore" half, made an equality on live sim state.
  const healed = healing!.coreHp - coreAtStart;
  const spent = BANKED - healing!.banked;
  expect(spent, 'every point of HP cost its ratified ore from the bank').toBeCloseTo(healed / 5, 2);

  expect(pageErrors, 'no page errors while staging the repair').toEqual([]);
});
