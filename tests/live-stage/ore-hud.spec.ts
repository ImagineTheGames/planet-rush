/**
 * tests/live-stage/ore-hud.spec.ts — the ore-HUD split, verified in the REAL
 * booted client. OWNER: UI Engineer (field rule).
 *
 * The developer's field rule: *"We're supposed to show ore held on ship under the
 * ship, not top left — top left is to show total ore."* So the held-ore squares
 * that used to sit in the top-left move under the ship as a compact, pooled,
 * screen-space indicator (the same discipline as the health bar), and the
 * top-left keeps only the banked TOTAL the Build wheel spends.
 *
 * The pure models are unit-green (src/ui/ore-hold.test.ts, src/ui/ore-hud.test.ts),
 * but — the lesson the enemy health bars taught twice — a model can be right while
 * nothing on a real boot draws it. This spec boots the production bundle and reads
 * back what the HUD *actually drew*, through the `?debug=1` seam
 * `window.__oreHudStage` (installed in `src/main.ts`) and the read-only layout
 * registry at `window.__planetRush.layout`:
 *
 *  1. **Mine** — stage a carried hold away from home. The under-ship indicator
 *     must appear at its registered anchor, tracking the ship's screen position
 *     (centre, under the follow camera), with a pip count that matches sim hold.
 *  2. **Deposit** — park at home so the sim drains the hold into the bank. The
 *     under-ship indicator must drain (fewer filled pips) while the top-left TOTAL
 *     rises by the same ore.
 *  3. **Empty and idle** — once the hold is spent, the under-ship indicator hides
 *     and the top-left TOTAL persists (banked ore is safe, GDD §2.3).
 *
 * It runs WITHOUT `?freeze=1` on purpose: the deposit phase needs the LIVE sim to
 * drain the hold over about a second, which a pinned frame cannot show.
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

/** The `?debug=1`-only seam this spec drives — installed in `src/main.ts`
 *  (`installOreHudStage`), mutating only plain sim data behind the flag. */
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

/** One entry of the read-only layout registry at `window.__planetRush.layout`. */
interface LayoutEntry {
  id: string;
  anchor: { region: string; margin?: number };
  bounds: { x: number; y: number; width: number; height: number };
}

interface StageWindow {
  __oreHudStage?: OreHudStage;
  __planetRush?: {
    viewport: { width: number; height: number };
    layout: readonly LayoutEntry[];
    placement(): Array<{ id: string; ok: boolean }>;
  };
}
declare const window: Window & StageWindow;

test('the under-ship hold indicator appears, drains to the top-left TOTAL, then hides', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Live sim (no ?freeze): we need the deposit drain to actually run.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  // The staging seam installs during boot; wait for it before driving it.
  await page.waitForFunction(() => typeof window.__oreHudStage?.mine === 'function', undefined, {
    timeout: 20_000,
  });

  const viewport = await page.evaluate(() => window.__planetRush!.viewport);

  // --- 1. MINE: stage a carried hold away from home so it does not drain. ----
  const MINED = 3;
  const staged = await page.evaluate((ore) => window.__oreHudStage!.mine(ore), MINED);
  expect(staged, 'the local ship and its station were available to stage').not.toBeNull();
  expect(staged!.cargo, 'the hold was loaded with the mined ore').toBeCloseTo(MINED, 5);
  const bankAtStart = staged!.banked;

  // The under-ship indicator must appear, drawn (not culled), tracking the ship —
  // which the follow camera holds at the viewport centre — with the right count.
  const hold = await page
    .waitForFunction(
      (want) => {
        const h = window.__oreHudStage!.hold();
        return h && h.filled === want ? h : null;
      },
      MINED,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(hold!.slots, 'a pip per cargo slot').toBeGreaterThanOrEqual(MINED);
  expect(hold!.filled, 'the filled pip count matches sim hold').toBe(MINED);
  // It TRACKS the ship: centred on the ship's screen x, and below its centre.
  expect(hold!.x, 'the indicator is centred on the ship the camera holds').toBeCloseTo(
    viewport.width / 2,
    0,
  );
  expect(hold!.y, 'the indicator sits under the ship, below the viewport centre').toBeGreaterThan(
    viewport.height / 2,
  );

  // And it is drawn at its REGISTERED anchor: the layout registry carries an
  // `ore-hold` entry this frame, and its actual bounds sit inside its `full` zone
  // (the registry's own verdict) — placement asserted, not eyeballed.
  const placed = await page.evaluate(() => {
    const pr = window.__planetRush!;
    const entry = pr.layout.find((e) => e.id === 'ore-hold') ?? null;
    const ok = pr.placement().find((p) => p.id === 'ore-hold')?.ok ?? false;
    return { entry, ok };
  });
  expect(placed.entry, 'the under-ship indicator registered in the layout registry').not.toBeNull();
  expect(placed.entry!.anchor.region, 'registered under `full`, like the health bars').toBe('full');
  expect(placed.ok, 'its actual bounds sit inside its declared anchor zone').toBe(true);

  // The top-left TOTAL shows the safe bank — unchanged by carrying ore.
  const totalWhileCarrying = await page.evaluate(() => window.__oreHudStage!.total());
  expect(totalWhileCarrying, 'the top-left TOTAL is the banked ore, not the held ore').toBe(
    bankAtStart,
  );

  // Screenshot the mining state for the PR body: the hold indicator under the
  // ship, the TOTAL (unchanged) top-left.
  await page.screenshot({ path: 'tests/live-stage/ore-hud-mining-evidence.png' });

  // --- 2. DEPOSIT: park at home; watch the hold drain and the TOTAL rise. -----
  //
  // The deposit flies ore-flight couriers ship→station ([[ore-deposit-rule]]): the
  // hold empties as they *depart*, but the bank only rises as they *land*, so the
  // key on the drawn total rising is what proves both ends of the transfer.
  const DOCKED = 6;
  const docked = await page.evaluate((ore) => window.__oreHudStage!.dock(ore), DOCKED);
  expect(docked, 'the ship re-parked at its own station').not.toBeNull();
  const bankBeforeDeposit = docked!.banked;

  // Mid-drain: the under-ship indicator has fewer filled pips than staged AND the
  // top-left TOTAL has actually risen above where it started — the deposit, read
  // off what the HUD really drew at both ends at once.
  const mid = await page
    .waitForFunction(
      (arg) => {
        const s = window.__oreHudStage!;
        const h = s.hold();
        if (!h) return null;
        if (h.filled < arg.staged && s.total() > arg.bankBefore) {
          return { filled: h.filled, total: s.total() };
        }
        return null;
      },
      { staged: DOCKED, bankBefore: bankBeforeDeposit },
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(mid!.filled, 'the under-ship indicator drained below the staged hold').toBeLessThan(DOCKED);
  expect(mid!.total, 'the top-left TOTAL rose as the hold deposited').toBeGreaterThan(
    bankBeforeDeposit,
  );

  // Screenshot the mid-deposit state for the PR body: hold draining under the
  // ship, the total climbing top-left.
  await page.screenshot({ path: 'tests/live-stage/ore-hud-deposit-evidence.png' });

  // --- 3. EMPTY AND IDLE: the indicator hides; the TOTAL persists. -----------
  const done = await page
    .waitForFunction(
      (target) => {
        const s = window.__oreHudStage!;
        const r = s.readout();
        if (!r) return null;
        // Hold empty in the sim, the under-ship indicator hidden by the HUD, and
        // every courier landed (the bank fully risen).
        if (r.cargo <= 0.001 && s.hold() === null && r.banked >= target - 0.01) {
          return { total: s.total(), banked: r.banked };
        }
        return null;
      },
      bankBeforeDeposit + DOCKED,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue());

  expect(done!.banked, 'every deposited ore landed in the bank').toBeCloseTo(
    bankBeforeDeposit + DOCKED,
    1,
  );
  expect(done!.total, 'the persistent top-left TOTAL reflects the banked ore').toBe(
    Math.floor(done!.banked),
  );

  expect(pageErrors, 'no page errors while staging the ore HUD').toEqual([]);
});
