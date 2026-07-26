/**
 * tests/live-stage/combat-visuals.spec.ts — turret fire on the REAL stage. OWNER:
 * Platform Engineer.
 *
 * The round-2 field bug (builds 5254cfe…b522a78): in the booted client only the
 * LOCAL player's fire ever drew — every rival turret muzzle was invisible —
 * because main.ts built its combat visuals from LOCAL fire input instead of from
 * sim combat state. m2-11's unit suite stayed green the whole time because it
 * tests the render MODEL (`muzzleFlashes` over a hand-built world), not what the
 * booted client wires onto the PixiJS stage. No unit test could catch this: the
 * gap was the wiring itself.
 *
 * Since the v0.3 laser funeral a ship's shots are pooled projectiles drawn from
 * the shot pool, not a standing line — so the only muzzle *flashes* are turrets'.
 * This suite closes the wiring gap for those: boot the real preview bundle,
 * deterministically stage a non-local turret firing, and assert the client drew
 * its muzzle flash. It reads the drawn set back through the `?debug=1` instrument
 * (`window.__planetRush.muzzles`), which the client feeds from the exact flash
 * array it hands `renderer.draw` each frame — so a flash present here is a flash
 * on stage. If main.ts ever regresses to feeding only the local shooter,
 * `muzzles` carries only `shooter === 0` and these tests fail.
 *
 * Runs under `?freeze=1` so the sim never steps to clear the staged `Turret.muzzle`
 * — a deterministic, render-rate-independent base (the sim's own tick clock is
 * pinned), not a wall-clock race.
 */
import { test, expect } from '@playwright/test';

/** The camera-followed local seat (src/main.ts `LOCAL_PLAYER`). A flash whose
 *  `shooter` is not this is a non-local shooter — a rival turret: exactly the fire
 *  the field report found invisible. */
const LOCAL_PLAYER = 0;

/** The shape `window.__planetRush.stageCombat()` returns and `.muzzles` reports —
 *  mirrors src/main.ts `StagedCombat` / the combat-debug readout. */
interface StagedMuzzle {
  shooter: number;
  origin: { x: number; y: number };
  end: { x: number; y: number };
  hit: { x: number; y: number } | null;
}
interface StagedCombat {
  firingShip: number;
  turret: StagedMuzzle;
}
interface DrawnMuzzle {
  shooter: number;
  origin: { x: number; y: number };
  end: { x: number; y: number };
  hit: { x: number; y: number } | null;
}

/** Boot the frozen debug client and wait until it is pinned and drawing. */
async function bootFrozen(page: import('@playwright/test').Page): Promise<void> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  // The instrument reports `frozen` once the sim is pinned at the seeded tick.
  await page.waitForFunction(
    () => (window as unknown as { __planetRush?: { frozen?: boolean } }).__planetRush?.frozen === true,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(200); // a few composited frames
  expect(pageErrors, 'no page errors during boot').toEqual([]);
}

/** Distance between two points — used to assert a drawn endpoint lands where the
 *  staged shot said it would (sub-pixel; the same clamp-to-hit maths both sides). */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test.describe('combat visuals — every turret draws, not just the local player', () => {
  test('a non-local turret muzzle flash is on stage', async ({ page }) => {
    await bootFrozen(page);

    // Deterministically stage the firefight the field report could only reach by
    // kiting bots for 60s: a non-local ship's trigger goes down and a rival turret
    // looses a shot, publishing a muzzle flash.
    const staged = (await page.evaluate(() =>
      (
        window as unknown as { __planetRush: { stageCombat(): StagedCombat } }
      ).__planetRush.stageCombat(),
    )) as StagedCombat;

    // The staged shooters are non-local (the bug was that non-local fire never drew).
    expect(staged.firingShip, 'staged firing ship is a non-local shooter').not.toBe(LOCAL_PLAYER);
    expect(staged.turret.shooter, 'staged turret is a non-local owner').not.toBe(LOCAL_PLAYER);

    // Let the render loop pick up the staged combat state (freeze never clears it,
    // so the drawn flash count rises and stays up).
    await page.waitForFunction(
      () =>
        ((window as unknown as { __planetRush: { muzzles: DrawnMuzzle[] } }).__planetRush.muzzles ?? [])
          .length >= 1,
      undefined,
      { timeout: 10_000 },
    );

    const muzzles = (await page.evaluate(
      () => (window as unknown as { __planetRush: { muzzles: DrawnMuzzle[] } }).__planetRush.muzzles,
    )) as DrawnMuzzle[];

    // --- The turret firing: a muzzle flash on stage (the round-2 "turret never
    //     visibly fires" bug). It is owned by a non-local planet here. ---
    expect(
      muzzles.length,
      'at least one turret muzzle flash is drawn (the round-2 "turret never fires" bug)',
    ).toBeGreaterThanOrEqual(1);
    expect(muzzles.some((m) => m.shooter !== LOCAL_PLAYER), 'a non-local turret is firing').toBe(true);

    // --- Endpoint matches the staged shot exactly: the client draws the SAME
    //     clamp-to-hit geometry the sim publishes, for a non-local shooter, not a
    //     re-derived guess. ---
    const drawnTurret = muzzles.find((m) => m.shooter === staged.turret.shooter);
    expect(drawnTurret, 'the staged turret muzzle is the one drawn').toBeTruthy();
    expect(
      dist(drawnTurret!.end, staged.turret.end),
      'turret muzzle endpoint matches the staged shot',
    ).toBeLessThan(0.5);
  });

  test('with no firefight staged, no phantom non-local muzzles appear', async ({ page }) => {
    // Guard the other way: the frozen scene has nobody firing, so the drawn flash
    // set must NOT invent non-local muzzles — the instrument reflects real combat
    // state, so a passing "turret flash drawn" test above means something.
    await bootFrozen(page);
    const muzzles = (await page.evaluate(
      () => (window as unknown as { __planetRush: { muzzles: DrawnMuzzle[] } }).__planetRush.muzzles,
    )) as DrawnMuzzle[];
    expect(
      muzzles.every((m) => m.shooter === LOCAL_PLAYER),
      'no non-local muzzle is drawn until a turret actually fires',
    ).toBe(true);
  });
});
