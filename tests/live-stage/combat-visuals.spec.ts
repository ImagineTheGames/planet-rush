/**
 * tests/live-stage/combat-visuals.spec.ts — enemy beams & turret fire, on the REAL
 * stage. OWNER: Platform Engineer.
 *
 * The round-2 field bug (builds 5254cfe…b522a78): in the booted client only the
 * LOCAL player's beam ever drew — every bot/remote beam and every turret muzzle was
 * invisible — because main.ts built its beam visuals from LOCAL fire input instead
 * of from sim combat state. m2-11's unit suite stayed green the whole time because
 * it tests the render MODEL (`combatBeams` over a hand-built world), not what the
 * booted client wires onto the PixiJS stage. No unit test could catch this: the gap
 * was the wiring itself.
 *
 * This suite closes that gap the only honest way — boot the real preview bundle,
 * deterministically stage a firefight in which a NON-LOCAL ship fires and a turret
 * engages, and assert the client actually drew BOTH beams. It reads the drawn set
 * back through the `?debug=1` instrument (`window.__planetRush.beams`), which the
 * client feeds from the exact beam array it hands `renderer.draw` each frame — so a
 * beam present here is a beam on stage. If main.ts ever regresses to feeding only
 * the local beam, `beams` carries only `shooter === 0` and these tests fail.
 *
 * Runs under `?freeze=1` so the sim never steps to clear the staged `Ship.beam` /
 * `Turret.muzzle` — a deterministic, render-rate-independent base (the sim's own
 * tick clock is pinned), not a wall-clock race.
 */
import { test, expect } from '@playwright/test';

/** The camera-followed local seat (src/main.ts `LOCAL_PLAYER`). A beam whose
 *  `shooter` is not this is a non-local shooter — a bot, a remote, or a rival
 *  turret: exactly the fire the field report found invisible. */
const LOCAL_PLAYER = 0;

/** The shape `window.__planetRush.stageCombat()` returns and `.beams` reports —
 *  mirrors src/main.ts `StagedCombat` / the combat-debug readout. */
interface StagedBeam {
  shooter: number;
  source: 'ship' | 'turret';
  origin: { x: number; y: number };
  end: { x: number; y: number };
  hit: { x: number; y: number } | null;
}
interface StagedCombat {
  ship: StagedBeam;
  turret: StagedBeam;
}
interface DrawnBeam {
  shooter: number;
  source: 'ship' | 'turret';
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

test.describe('combat visuals — every shooter draws, not just the local player', () => {
  test('a non-local ship beam AND a turret muzzle are both on stage', async ({ page }) => {
    await bootFrozen(page);

    // Deterministically stage the firefight the field report could only reach by
    // kiting bots for 60s: a bot ship publishes a beam, a rival turret a muzzle.
    const staged = (await page.evaluate(() =>
      (
        window as unknown as { __planetRush: { stageCombat(): StagedCombat } }
      ).__planetRush.stageCombat(),
    )) as StagedCombat;

    // Both staged emitters are non-local (the bug was that these two never drew).
    expect(staged.ship.shooter, 'staged ship beam is a non-local shooter').not.toBe(LOCAL_PLAYER);
    expect(staged.turret.shooter, 'staged turret is a non-local owner').not.toBe(LOCAL_PLAYER);

    // Let the render loop pick up the staged combat state (freeze never clears it,
    // so the drawn beam count rises and stays up).
    await page.waitForFunction(
      () =>
        ((window as unknown as { __planetRush: { beams: DrawnBeam[] } }).__planetRush.beams ?? [])
          .length >= 2,
      undefined,
      { timeout: 10_000 },
    );

    const beams = (await page.evaluate(
      () => (window as unknown as { __planetRush: { beams: DrawnBeam[] } }).__planetRush.beams,
    )) as DrawnBeam[];

    // --- The enemy laser: a ship beam whose shooter is NOT the local player. ---
    const enemyShipBeams = beams.filter((b) => b.source === 'ship' && b.shooter !== LOCAL_PLAYER);
    expect(
      enemyShipBeams.length,
      'at least one NON-LOCAL ship beam is drawn (the round-2 "invisible enemy lasers" bug)',
    ).toBeGreaterThanOrEqual(1);

    // --- The turret firing: a muzzle beam on stage (the round-2 "turret never
    //     visibly fires" bug). It is owned by a non-local planet here. ---
    const turretBeams = beams.filter((b) => b.source === 'turret');
    expect(
      turretBeams.length,
      'at least one turret muzzle beam is drawn (the round-2 "turret never fires" bug)',
    ).toBeGreaterThanOrEqual(1);
    expect(turretBeams.some((b) => b.shooter !== LOCAL_PLAYER), 'a non-local turret is firing').toBe(
      true,
    );

    // --- Endpoints match the staged shots exactly: the client draws the SAME
    //     clamp-to-hit geometry the merged model publishes, for a non-local
    //     shooter, not a re-derived guess. ---
    const drawnShip = enemyShipBeams.find((b) => b.shooter === staged.ship.shooter);
    expect(drawnShip, 'the staged bot beam is the one drawn').toBeTruthy();
    expect(dist(drawnShip!.end, staged.ship.end), 'ship beam endpoint matches the staged shot').toBeLessThan(
      0.5,
    );
    expect(drawnShip!.hit, 'the staged bot beam clamps to a hit point').toBeTruthy();
    expect(dist(drawnShip!.hit!, staged.ship.end), 'clamp-to-hit: endpoint sits on the hit point').toBeLessThan(
      0.5,
    );

    const drawnTurret = turretBeams.find((b) => b.shooter === staged.turret.shooter);
    expect(drawnTurret, 'the staged turret muzzle is the one drawn').toBeTruthy();
    expect(
      dist(drawnTurret!.end, staged.turret.end),
      'turret muzzle endpoint matches the staged shot',
    ).toBeLessThan(0.5);

    // --- Count: BOTH non-local emitters are on stage together (the failing
    //     evidence frames had zero). ---
    const nonLocal = beams.filter((b) => b.shooter !== LOCAL_PLAYER);
    expect(nonLocal.length, 'both non-local shooters draw in one frame').toBeGreaterThanOrEqual(2);
  });

  test('with no firefight staged, no phantom non-local beams appear', async ({ page }) => {
    // Guard the other way: the frozen scene has nobody firing, so the drawn beam
    // set must NOT invent non-local beams — the instrument reflects real combat
    // state, so a passing "enemy beam drawn" test above means something.
    await bootFrozen(page);
    const beams = (await page.evaluate(
      () => (window as unknown as { __planetRush: { beams: DrawnBeam[] } }).__planetRush.beams,
    )) as DrawnBeam[];
    expect(
      beams.every((b) => b.shooter === LOCAL_PLAYER),
      'no non-local beam is drawn until a shooter actually fires',
    ).toBe(true);
  });
});
