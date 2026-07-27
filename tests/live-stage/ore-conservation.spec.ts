/**
 * tests/live-stage/ore-conservation.spec.ts — ore numbers that never lie, proven
 * in the REAL booted client. OWNER: UI Engineer (field report v0.2.2 "ore numbers
 * lie").
 *
 * Two field reports, one accuracy contract:
 *   1. "Sometimes the ore held in ship indicator isn't accurate."
 *   2. "When depositing it shows a bunch of ore going into the planet and doesn't
 *      represent actual amounts."
 *
 * The fix the reports demand — and what this spec locks — is that **every ore
 * readout is a pure projection of sim state at render time, never an accumulator**.
 * The under-ship hold pips are `floor(sim.cargo)`; the top-left TOTAL is
 * `floor(sim.banked)`; both are recomputed each frame from the one truth
 * ([[ore-hud]], [[ore-hold]], `Hud.updateOre`), so a missed or doubled mining /
 * deposit / undock event can never leave them desynced the way a delta-accumulating
 * indicator would. The pure models are unit-green; only booting the shipped bundle
 * proves the WIRED HUD actually draws those projections and holds them accurate
 * through the nastiest path — a deposit **interrupted by undocking** and resumed.
 *
 * It boots the production bundle and reads back what the HUD *drew* through the
 * `?debug=1` seam `window.__oreHudStage` (installed in `src/main.ts`) and counts
 * the deposit-flight couriers through `window.__oreDepositStage.flights()`. It runs
 * WITHOUT `?freeze=1`: the whole point is to watch the LIVE sim drain the hold, stop
 * it mid-transfer, and restart it, sampling EVERY rendered frame in between.
 *
 * The cycle under test — the field report's own reproduction list:
 *   MINE (carry, away from home)  → the indicator appears, exact.
 *   DEPOSIT (park at home)        → hold drains, TOTAL rises, ore CONSERVED.
 *   UNDOCK MID-DRAIN (interrupt)  → the transfer stops; the frozen readouts stay
 *                                    EXACTLY on sim state (the likely bug: an
 *                                    accumulator would drift here). No phantom
 *                                    couriers, no phantom banking.
 *   RE-DOCK                       → the transfer resumes and completes.
 *   EMPTY                         → hold hidden, whole staged hold banked, to the ore.
 *
 * Across all of it the invariant asserted every frame is:
 *   drawn under-ship pips  == floor(sim hold)      (± the one-frame draw lag during
 *   drawn top-left TOTAL   == floor(sim bank)        a live drain; EXACT when static)
 *   sim hold + sim bank    == constant              (no ore created or destroyed —
 *                                                     the deposit is conserved, the
 *                                                     couriers carry none)
 *
 * ── The deposit-flight COURIER COUNT, now on the ATMOSPHERE path (field report p8) ─
 * The field report also asks for "one flight sprite per ore unit … chunks spawned
 * during a deposit MUST equal units banked." That was true of the retired DOCK-era
 * flight (p4-01) but NOT of the ATMOSPHERE drain that replaced it (p4-11): the new
 * drain spawned couriers on a free-running *time* cadence (~3 per ore at
 * `drainRate`), so the developer kept seeing "more ore flying than you hold" through
 * v0.2.4. The p8 fix keys the courier spawn to the hold's whole-unit boundary
 * crossings — the same numbers the bank credits — so across a full atmosphere drain
 * the total sprites flown == the whole ore banked, exactly. The second test below
 * proves that on a REAL boot with a SMALL hold (an off-by-one courier is glaring),
 * and proves the interrupt case: exit the atmosphere mid-drain and the flight stops
 * cold — no courier spawns for a ship that is no longer depositing.
 */
import { test, expect } from '@playwright/test';

/** The under-ship hold indicator the HUD drew this frame (screen pos + pips). */
interface DrawnHold {
  x: number;
  y: number;
  slots: number;
  filled: number;
  full: boolean;
}

/** `window.__oreHudStage` — the `?debug=1` seam (installed in `src/main.ts`,
 *  `installOreHudStage`), mutating only plain sim data behind the flag. */
interface OreHudStage {
  /** Stage a carried hold away from home (no drain); returns hold/cap/bank. */
  mine(ore: number): { cargo: number; cargoCap: number; banked: number } | null;
  /** Park at home to start the sim's auto-deposit drain; returns hold/bank. */
  dock(ore: number): { cargo: number; banked: number } | null;
  /** The under-ship hold indicator the HUD actually drew, or null when hidden. */
  hold(): DrawnHold | null;
  /** The banked TOTAL the top-left actually drew this frame. */
  total(): number;
  /** The live hold and bank the sim holds this frame. */
  readout(): { cargo: number; banked: number } | null;
}

/** `window.__oreDepositStage` — its `flights()` counts the deposit couriers the
 *  renderer draws this frame (chunks flagged `deposit` in `world.chunks`). */
interface OreDepositStage {
  flights(): number;
}

interface StageWindow {
  __oreHudStage?: OreHudStage;
  __oreDepositStage?: OreDepositStage;
}
declare const window: Window & StageWindow;

/** One rejected frame from an in-page sampler — a human-readable reason. */
type Violation = string;

test('ore readouts are exact projections of sim state, conserved across mine → deposit → undock-mid-drain → re-dock', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Live sim (no ?freeze): we need the drain to actually run, stop, and restart.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // Both staging seams install during boot; wait for the ore-HUD one before driving.
  await page.waitForFunction(
    () =>
      typeof window.__oreHudStage?.mine === 'function' &&
      typeof window.__oreDepositStage?.flights === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // === 1. MINE — carry a hold away from home; the indicator is EXACT and stable ===
  const MINED = 4;
  const staged = await page.evaluate((ore) => window.__oreHudStage!.mine(ore), MINED);
  expect(staged, 'the local ship and its planet were available to stage').not.toBeNull();
  expect(staged!.cargo, 'the hold was loaded with the mined ore').toBeCloseTo(MINED, 5);
  const bank0 = staged!.banked;

  // The indicator must appear with exactly `MINED` filled pips.
  const firstHold = await page
    .waitForFunction(
      (want) => {
        const h = window.__oreHudStage!.hold();
        return h && h.filled === want ? h : null;
      },
      MINED,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());
  expect(firstHold!.slots, 'one pip per cargo slot').toBeGreaterThanOrEqual(MINED);

  // Static phase: away from home nothing drains, so the drawn readouts must equal
  // sim state EXACTLY on every rendered frame for ~0.4 s. This is the pure-projection
  // guarantee at its strictest — no lag to hide behind.
  const carrying = await sampleStatic(page, {
    expectFilled: MINED,
    expectCargo: MINED,
    expectBanked: bank0,
    durationMs: 400,
  });
  expect(carrying.frames, 'the carrying phase actually rendered frames').toBeGreaterThan(3);
  expect(carrying.violations, 'held pips and TOTAL match sim exactly while carrying').toEqual([]);

  // === 2. DEPOSIT — park at home; hold drains, TOTAL rises, ore CONSERVED ===
  const DEP = 6;
  const docked = await page.evaluate((ore) => window.__oreHudStage!.dock(ore), DEP);
  expect(docked, 'the ship re-parked at its own planet with the deposit hold').not.toBeNull();
  const bankBeforeDeposit = docked!.banked;
  // The conserved quantity for the whole rest of the run: hold + bank never changes.
  const CONSERVED = docked!.cargo + docked!.banked;

  // Sample every frame while the hold drains from DEP down past the halfway mark,
  // asserting conservation + that the drawn readouts track sim within the one-frame
  // draw lag and never move the wrong way. Returns where the drain had reached so we
  // can interrupt it.
  const firstDrain = await sampleDrain(page, { conserved: CONSERVED, stopAtCargo: DEP / 2 });
  expect(firstDrain.violations, 'hold/TOTAL track sim and ore is conserved while depositing').toEqual(
    [],
  );
  expect(firstDrain.sawFlight, 'deposit-flight couriers exist while the hold drains').toBe(true);
  expect(firstDrain.stoppedCargo, 'the drain reached mid-hold before we interrupt it').toBeLessThan(
    DEP,
  );
  expect(firstDrain.stoppedCargo, 'and there is still ore left to interrupt').toBeGreaterThan(0.5);

  // Screenshot the mid-deposit for the PR body: hold draining, TOTAL climbing.
  await page.screenshot({ path: 'tests/live-stage/ore-conservation-evidence.png' });

  // === 3. UNDOCK MID-DRAIN — the interrupt case (the likely bug) ===
  // Yank the ship off its planet (mine() re-parks it far away without touching the
  // bank), stopping the transfer mid-flight. An indicator that ACCUMULATED deposit
  // deltas would keep ticking or freeze on a stale value here; a pure projection
  // simply holds on the exact ore still in the hold.
  //
  // Read the live hold and re-park on it in ONE in-page call: the sim only advances
  // inside a rAF callback, so nothing drains between the read and the re-set, and
  // the frozen phase's conserved total is the exact hold+bank at the interrupt.
  // (Two round-trips let the live drain move `banked` between them while `mine`
  // resets `cargo` to the older, higher value — a staging race that inflated
  // hold+bank under load.)
  const undocked = await page.evaluate(() => {
    const r = window.__oreHudStage!.readout();
    return r ? window.__oreHudStage!.mine(r.cargo) : null;
  });
  expect(undocked, 'the ship undocked mid-drain, hold preserved').not.toBeNull();

  // The frozen phase: for ~0.5 s the sim hold must not move (drain stopped), the
  // drawn pips must stay EXACTLY floor(hold), the TOTAL EXACTLY floor(bank), and the
  // bank must not creep up on phantom deposits. Couriers already in the air land and
  // are swept, so the flight count must fall to zero and STAY there — no new courier
  // is spawned for a ship that is no longer depositing.
  const frozen = await sampleFrozen(page, { durationMs: 550, conserved: CONSERVED });
  expect(frozen.frames, 'the frozen phase actually rendered frames').toBeGreaterThan(3);
  expect(
    frozen.violations,
    'undocked mid-drain: readouts hold exactly on sim, no phantom bank, no phantom couriers',
  ).toEqual([]);
  expect(frozen.cargoDrift, 'the interrupted hold did not drain while undocked').toBeLessThan(0.02);

  // === 4. RE-DOCK — the transfer resumes and completes ===
  const reCargo = await page.evaluate(() => window.__oreHudStage!.readout()).then((r) => r!.cargo);
  const redocked = await page.evaluate((c) => window.__oreHudStage!.dock(c), reCargo);
  expect(redocked, 'the ship re-docked to finish the deposit').not.toBeNull();

  const secondDrain = await sampleDrain(page, { conserved: CONSERVED, stopAtCargo: 0.001 });
  expect(secondDrain.violations, 'the resumed deposit tracks sim and conserves ore').toEqual([]);

  // === 5. EMPTY — indicator hidden, whole staged hold banked to the ore ===
  const done = await page
    .waitForFunction(
      (target) => {
        const s = window.__oreHudStage!;
        const r = s.readout();
        if (!r) return null;
        // Hold empty in the sim, the under-ship indicator HIDDEN by the HUD, the bank
        // fully risen and the drawn TOTAL agreeing with it.
        if (r.cargo <= 0.001 && s.hold() === null && r.banked >= target - 0.01) {
          return { total: s.total(), banked: r.banked };
        }
        return null;
      },
      bankBeforeDeposit + DEP,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  // Conserved end to end, across the interrupt: every ore that started in the hold
  // ended in the bank, none invented by the flight, none lost to the undock.
  expect(done!.banked, 'the whole staged hold banked, conserved across the interrupt').toBeCloseTo(
    bank0 + DEP,
    2,
  );
  expect(done!.total, 'the persistent TOTAL is the exact floor of the banked ore').toBe(
    Math.floor(done!.banked),
  );

  expect(pageErrors, 'no page errors across the whole conserved deposit cycle').toEqual([]);
});

/**
 * The literal "one flight sprite per ore unit" half of the field report, now on the
 * ATMOSPHERE drain (field report p8) and GREEN — the p8 fix keyed the sim's courier
 * spawn to the hold's whole-unit boundary crossings, so across a full atmosphere
 * drain the sprites flown total the ore banked, exactly.
 *
 * Counting is by rising edge of the LIVE flight count. The renderer draws one chunk
 * per sim courier, and at `drainRate = 2 ore/s` the fix spawns one courier per whole
 * unit ~0.5 s apart while each courier's short hop home lasts well under that — so
 * the count returns to 0 between spawns and every spawn is its own rising edge. The
 * dock happens INSIDE the sampler (no cross-process gap that could let the first
 * courier fly and land unseen), and the baseline is 0, so even a courier already
 * aloft on the first sampled frame is counted exactly once.
 */
test('atmosphere drain flies exactly one courier per ore banked — and stops cold on a mid-drain exit', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__oreHudStage?.dock === 'function' &&
      typeof window.__oreDepositStage?.flights === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // === A. FULL DRAIN — total couriers flown == whole ore banked ===
  // A SMALL, INTEGER hold: small so an off-by-one courier is glaring, integer so
  // "whole ore banked" is exactly the hold. The ship parks in its own atmosphere
  // (dock() places it inside DEPOSIT_RANGE) and the auto-deposit drains it.
  const HOLD = 3;
  const drain = await page.evaluate(async (hold) => {
    const s = window.__oreHudStage!;
    const d = window.__oreDepositStage!;
    if (!s.dock(hold)) return null; // no local ship/planet to stage
    let spawned = 0;
    let prev = 0; // baseline BEFORE the first courier, so the first one is counted
    let maxConcurrent = 0;
    let endCargo = hold;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const now = d.flights();
        if (now > prev) spawned += now - prev; // rising edge == this frame's new couriers
        if (now > maxConcurrent) maxConcurrent = now;
        prev = now;
        const r = s.readout();
        if (r) endCargo = r.cargo;
        if (r && r.cargo <= 0.001) return resolve();
        if (performance.now() - start > 12_000) return resolve(); // stall guard
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { spawned, maxConcurrent, endCargo };
  }, HOLD);
  expect(drain, 'the local ship parked in its own atmosphere with the hold').not.toBeNull();
  expect(drain!.endCargo, 'the hold fully drained').toBeLessThanOrEqual(0.01);
  // The whole point of field report p8: sprites flown == ore banked, to the unit.
  expect(drain!.spawned, 'one courier flew per whole ore banked, no rate-based extras').toBe(HOLD);
  expect(
    drain!.maxConcurrent,
    'the conserved stream never floods — at most a courier or two aloft',
  ).toBeLessThanOrEqual(2);

  // === B. INTERRUPT — exit the atmosphere mid-drain; the flight stops cold ===
  // Re-dock a fresh hold, let one whole unit bank (>= one courier), then yank the
  // ship out of the atmosphere (mine() re-parks it far from home without touching
  // the bank). No courier may spawn for a ship no longer depositing; couriers
  // already aloft land and are swept, so no NEW rising edge appears.
  const HOLD2 = 3;
  const interrupt = await page.evaluate(async (hold) => {
    const s = window.__oreHudStage!;
    const d = window.__oreDepositStage!;
    if (!s.dock(hold)) return null;
    // Wait until at least one whole unit has banked, then exit the atmosphere.
    await new Promise<void>((resolve) => {
      const wait = (): void => {
        const r = s.readout();
        if (r && r.cargo <= hold - 1.1) return resolve();
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });
    s.mine(s.readout()!.cargo); // re-park far from home; hold preserved, drain stops
    const cargoAtExit = s.readout()!.cargo;
    let spawnedAfterExit = 0;
    let prev = d.flights(); // couriers already aloft are NOT new spawns
    let cargoDrift = 0;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const now = d.flights();
        if (now > prev) spawnedAfterExit += now - prev;
        prev = now;
        const r = s.readout();
        if (r) cargoDrift = Math.max(cargoDrift, Math.abs(r.cargo - cargoAtExit));
        if (performance.now() - start >= 700) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { spawnedAfterExit, cargoDrift };
  }, HOLD2);
  expect(interrupt, 're-staged the ship to interrupt a live atmosphere drain').not.toBeNull();
  expect(
    interrupt!.spawnedAfterExit,
    'no courier spawns once the ship exits the atmosphere mid-drain',
  ).toBe(0);
  expect(
    interrupt!.cargoDrift,
    'the interrupted hold does not drain outside the atmosphere',
  ).toBeLessThan(0.05);

  expect(pageErrors, 'no page errors across the atmosphere-drain conservation run').toEqual([]);
});

// ---------------------------------------------------------------------------
// In-page frame samplers. Each drives a requestAnimationFrame loop inside the
// booted client so it inspects EVERY rendered frame (not a polled snapshot),
// returning the frames it saw and any that broke the invariant.
// ---------------------------------------------------------------------------

/** A STATIC phase: nothing is transferring, so the drawn readouts must equal sim
 *  state EXACTLY on every frame — the strictest form of the projection contract. */
async function sampleStatic(
  page: import('@playwright/test').Page,
  opts: { expectFilled: number; expectCargo: number; expectBanked: number; durationMs: number },
): Promise<{ frames: number; violations: Violation[] }> {
  return page.evaluate(async (o) => {
    const s = window.__oreHudStage!;
    const bad: string[] = [];
    let frames = 0;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        frames++;
        const h = s.hold();
        const r = s.readout();
        const total = s.total();
        if (!r) {
          bad.push('sim readout null while static');
        } else {
          if (Math.abs(r.cargo - o.expectCargo) > 0.02)
            bad.push(`sim hold drifted while static: ${r.cargo.toFixed(3)} vs ${o.expectCargo}`);
          if (Math.abs(r.banked - o.expectBanked) > 0.02)
            bad.push(`sim bank drifted while static: ${r.banked.toFixed(3)} vs ${o.expectBanked}`);
          if (total !== Math.floor(r.banked))
            bad.push(`TOTAL ${total} != floor(bank ${r.banked.toFixed(3)})`);
          if (!h) bad.push('under-ship indicator hidden while carrying a hold');
          else if (h.filled !== o.expectFilled)
            bad.push(`held pips ${h.filled} != expected ${o.expectFilled}`);
          else if (h.filled !== Math.floor(r.cargo))
            bad.push(`held pips ${h.filled} != floor(hold ${r.cargo.toFixed(3)})`);
        }
        if (performance.now() - start >= o.durationMs) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { frames, violations: bad };
  }, opts);
}

/** A LIVE DRAIN phase: the hold is transferring to the bank. The drawn readouts are
 *  last frame's, so they lag sim by ≤1 frame — held pips sit in [floor(hold),
 *  floor(hold)+1] and never rise; the TOTAL sits in [floor(bank)-1, floor(bank)] and
 *  never falls. Ore is conserved every frame. Stops when the hold reaches
 *  `stopAtCargo`, reporting where it stopped and whether couriers ever flew. */
async function sampleDrain(
  page: import('@playwright/test').Page,
  opts: { conserved: number; stopAtCargo: number },
): Promise<{ violations: Violation[]; stoppedCargo: number; sawFlight: boolean }> {
  return page.evaluate(async (o) => {
    const s = window.__oreHudStage!;
    const d = window.__oreDepositStage!;
    const bad: string[] = [];
    let prevFilled = Number.POSITIVE_INFINITY;
    let prevTotal = Number.NEGATIVE_INFINITY;
    let sawFlight = false;
    let stoppedCargo = Number.NaN;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const h = s.hold();
        const r = s.readout();
        const total = s.total();
        if (!r) {
          bad.push('sim readout null mid-drain');
          return resolve();
        }
        stoppedCargo = r.cargo;
        if (d.flights() > 0) sawFlight = true;
        // Conservation: no ore created or destroyed by the deposit or its couriers.
        if (Math.abs(r.cargo + r.banked - o.conserved) > 0.02)
          bad.push(`ore not conserved: hold+bank=${(r.cargo + r.banked).toFixed(3)} vs ${o.conserved}`);
        const fc = Math.floor(r.cargo);
        const fb = Math.floor(r.banked);
        if (h) {
          if (h.filled < fc || h.filled > fc + 1)
            bad.push(`held pips ${h.filled} outside [${fc},${fc + 1}] mid-drain`);
          if (h.filled > prevFilled)
            bad.push(`held pips rose during a drain: ${prevFilled} -> ${h.filled}`);
          prevFilled = h.filled;
        }
        if (total > fb || total < fb - 1)
          bad.push(`TOTAL ${total} outside [${fb - 1},${fb}] mid-drain`);
        if (total < prevTotal) bad.push(`TOTAL fell during a deposit: ${prevTotal} -> ${total}`);
        prevTotal = total;
        // 12 s is far beyond a 6-ore/2-per-s drain; a stall is a failure, not a hang.
        if (r.cargo <= o.stopAtCargo || performance.now() - start > 12_000) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { violations: bad, stoppedCargo, sawFlight };
  }, opts);
}

/** A FROZEN phase: the ship undocked mid-drain, so the transfer has STOPPED. The sim
 *  hold must not move, the drawn readouts must stay EXACTLY on sim state, the bank
 *  must not creep up on a phantom deposit, and no NEW courier may spawn (existing
 *  ones land and are swept, so the count falls to zero). Reports the largest hold
 *  drift seen — the drain must be genuinely stopped, not merely slow. */
async function sampleFrozen(
  page: import('@playwright/test').Page,
  opts: { durationMs: number; conserved: number },
): Promise<{ frames: number; violations: Violation[]; cargoDrift: number }> {
  return page.evaluate(async (o) => {
    const s = window.__oreHudStage!;
    const d = window.__oreDepositStage!;
    const bad: string[] = [];
    let frames = 0;
    let cargo0 = Number.NaN;
    let bank0 = Number.NaN;
    let cargoDrift = 0;
    let flightsBottomedOut = false;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        frames++;
        const h = s.hold();
        const r = s.readout();
        const total = s.total();
        if (!r) {
          bad.push('sim readout null while frozen');
          return resolve();
        }
        if (Number.isNaN(cargo0)) {
          cargo0 = r.cargo;
          bank0 = r.banked;
        }
        cargoDrift = Math.max(cargoDrift, Math.abs(r.cargo - cargo0));
        // The transfer is stopped: bank must not rise (no phantom deposit) and ore
        // stays conserved.
        if (r.banked > bank0 + 0.02) bad.push(`bank crept up while undocked: ${bank0} -> ${r.banked}`);
        if (Math.abs(r.cargo + r.banked - o.conserved) > 0.05)
          bad.push(`ore not conserved while frozen: hold+bank=${(r.cargo + r.banked).toFixed(3)}`);
        // Drawn readouts sit EXACTLY on sim state — the interrupt's whole point.
        if (total !== Math.floor(r.banked))
          bad.push(`frozen TOTAL ${total} != floor(bank ${r.banked.toFixed(3)})`);
        if (!h) bad.push('under-ship indicator hidden while still holding ore');
        else if (h.filled !== Math.floor(r.cargo))
          bad.push(`frozen held pips ${h.filled} != floor(hold ${r.cargo.toFixed(3)})`);
        if (d.flights() === 0) flightsBottomedOut = true;
        else if (flightsBottomedOut)
          bad.push('a new deposit courier spawned after the ship undocked');
        if (performance.now() - start >= o.durationMs) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { frames, violations: bad, cargoDrift };
  }, opts);
}
