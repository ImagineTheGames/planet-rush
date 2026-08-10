/**
 * tests/live-stage/vfx-alive.spec.ts — the effects are DRAWN, proven on a REAL
 * boot. OWNER: Art Agent (a2-07; GDD §3.6, §4.3).
 *
 * `a1-09`'s dark-matter scan found `src/art/vfx/` unreachable from every entry
 * point: fifty dark exports, the whole GDD §3.6 effect set implemented by name —
 * `weaponImpact`, `asteroidBurst`, `oreCollect`, `shieldDown`, `coreHit` — with
 * `src/main.ts` constructing none of it. It imported the observer that derives
 * the tells and used it five times, every one of them audio, and it imported
 * `VfxAutoQuality`: the governor that throttles particles shipped, and the
 * particles did not. So the tell stream was **sounded and not drawn**. An
 * explosion made its noise and left no mark, for six milestones.
 *
 * Every unit test in `src/art/vfx/` was green that whole time, and could not
 * have been anything else. A unit test asks whether an emitter emits. What was
 * broken was whether anybody ever called it — and no headless test in any
 * quantity can ask that question. **This file is the only class of test that
 * catches a dead wire**, and it is the same class that caught the identical
 * failure in the audio half (`audio-alive.spec.ts`, the developer's *"why don't
 * I hear ANY sounds in the game yet?"*).
 *
 * So it goes through the front door, on a LIVE match — no `?freeze=1`, because a
 * pinned world produces no deltas and the observer would have nothing to derive:
 *
 *  1. Boot the production bundle into a running `?debug=1` match and assert the
 *     layer is genuinely **on the stage** (`attached`). A layer that exists but
 *     hangs off nothing draws exactly as much as one that was never built, which
 *     is precisely the shape of the bug this closes.
 *  2. Kill the LOCAL ship through the sim's OWN `killShip` and assert the field
 *     drew an **explosion**, attributed to the local seat, and that the draw
 *     layer built real sprites for it.
 *  3. Stage ore arriving in the LOCAL hold and assert the field drew an
 *     **oreCollect**, likewise attributed.
 *  4. Engage the reduce-VFX floor through the REAL settings row — a trusted
 *     click on the point the client itself drew it at — and assert the field
 *     thins (density falls) and **still draws the tell** (r9-01: degrade by
 *     thinning, never by vanishing mid-match).
 *
 * Attribution matters here in a way it does not under freeze. Eight ships are
 * mining and dying on a live board, so "the ore counter went up" is a claim
 * about the match; "the last ore pickup the field drew belonged to the LOCAL
 * seat, and the counter moved when we staged it" is a claim about the wire.
 *
 * Nothing in this file draws a particle. Every effect asserted here got there
 * because the simulation did something and the shipped client noticed — which is
 * why it cannot fake the wiring it exists to prove.
 */
import { test, expect, type Page } from '@playwright/test';

/** The seat `?debug=1` seats this client at offline (src/main.ts `LOCAL_PLAYER`). */
const LOCAL_PLAYER = 0;

/** The reduced-VFX particle density (src/main.ts `REDUCED_VFX_DENSITY`). Half,
 *  not zero — the number that encodes "thin it, do not delete it". */
const REDUCED_DENSITY = 0.5;

/** The `?debug=1`-only VFX seam this spec reads. Mirrors `installVfxStage` in
 *  `src/main.ts`. Pure readback — it draws nothing and stages nothing. */
interface VfxReadout {
  /** True once the draw layer is in the live scene graph — the wire itself. */
  attached: boolean;
  /** Live particles in the field's pool this frame. */
  particles: number;
  /** Pooled sprites the draw layer holds. Zero means nothing was ever drawn. */
  sprites: number;
  /** Effect density the throttle has the field at, 0..1. */
  quality: number;
  /** True while the auto-reducer or the settings floor is engaged. */
  reduced: boolean;
  /** Tells the field has drawn since the last match reset, all kinds. */
  drawnTotal: number;
  /** Per-kind draw counts, keyed by tell name. */
  drawn: Record<string, number>;
  /** Who owned each kind's last drawn tell, −1 for nobody. */
  drawnBy: Record<string, number>;
  /** True while the frozen review sheet is what is on screen. */
  frozen: boolean;
}
interface VfxStage {
  read(): VfxReadout;
  drawnOf(name: string): number;
}
/**
 * The end-screen staging seam, for the one method that kills the local ship
 * through the sim's own `killShip` — the exact path a fatal hit takes.
 *
 * NOT `window.__planetRush.damageShip`, which was the obvious choice and is
 * wrong here: it applies real damage, and real damage includes the ten seconds
 * of spawn protection every match opens with (GDD §2.1). Staged a second after
 * boot it is refused in full, and the explosions that eventually arrive are
 * bots killing each other once protection lapses — which is how the first draft
 * of this file came to assert against slot 5.
 */
interface EndScreenStageLite {
  killLocalShip(): boolean;
  shipAlive(): boolean;
}
/** The ore staging seam (`__oreHudStage`): puts ore in the LOCAL hold, away from
 *  home so the deposit rule leaves it alone. Ore appearing in a hold is exactly
 *  what tractor collection does (GDD §2.3) — the observer derives the tell. */
interface OreHudStageLite {
  mine(ore: number): { cargo: number; cargoCap: number; banked: number } | null;
  readout(): { cargo: number; banked: number } | null;
}
/** The pause seam: read-back plus the physical points the client drew each
 *  control at, so the settings row is reached by a real click, not a hit-test. */
interface PauseStageLite {
  read(): {
    screen: string;
    open: boolean;
    controls: { kind: string; physicalCenter: { x: number; y: number } }[];
  };
}

/** This spec's view of the ?debug=1 seams on `window`. Declared LOCALLY (not a
 *  `declare global` augmentation) so its narrower stage types never merge-collide
 *  with the fuller declarations other live-stage specs make. */
interface VfxAliveWindow {
  __vfxStage?: VfxStage;
  __oreHudStage?: OreHudStageLite;
  __pauseStage?: PauseStageLite;
  __endScreenStage?: EndScreenStageLite;
}
declare const window: Window & VfxAliveWindow;

/**
 * Boot the real client into a LIVE `?debug=1` match (no freeze) and wait until
 * the VFX seam is installed and the loop has drawn frames.
 */
async function boot(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__vfxStage), undefined, { timeout: 30_000 });
  return pageErrors;
}

/** Wait until a named tell's draw count passes `above`, and report the readout. */
async function waitForDraw(page: Page, name: string, above: number): Promise<VfxReadout> {
  const handle = await page.waitForFunction(
    ([tell, floor]) => {
      const stage = window.__vfxStage;
      if (!stage) return null;
      return stage.drawnOf(tell as string) > (floor as number) ? stage.read() : null;
    },
    [name, above] as const,
    { timeout: 20_000 },
  );
  return (await handle.jsonValue()) as VfxReadout;
}

test.describe('the VFX layer is wired into the shipped client (a2-07)', () => {
  test('the draw layer is on the stage of a running match', async ({ page }) => {
    const errors = await boot(page);
    const seen = await page.evaluate(() => window.__vfxStage!.read());

    // The whole defect, as one boolean. `attached` is false if `main.ts` stops
    // adding the layer to the scene graph — the exact state the client shipped in.
    expect(seen.attached, 'the VFX layer is a child of the live scene graph').toBe(true);
    // And it is a LIVE match, not the frozen review sheet: what follows is derived
    // from a stepping simulation, not staged into a pinned one.
    expect(seen.frozen, 'this is a live match, not the frozen showcase').toBe(false);
    expect(errors, 'no page errors while the effects layer boots').toEqual([]);
  });

  test('a ship dying draws an explosion — the mark the noise never left', async ({ page }) => {
    const errors = await boot(page);
    const before = await page.evaluate(() => window.__vfxStage!.read());

    // Park the ship out in open space first. The seam that does it is the ore
    // one, which is a slightly odd door — but a ship spawns orbiting its own
    // home, and a home is the brightest object on the board, so an explosion
    // staged there is proven by the numbers and invisible in the photograph. The
    // camera follows the ship, so out here the burst lands on black, centred.
    await page.evaluate(() => window.__oreHudStage!.mine(1));

    // The sim's own kill path (`killShip`), staged through the end-screen seam.
    // Nothing here touches the art: a ship dies, and the client is left to notice.
    const killed = await page.evaluate(() => window.__endScreenStage!.killLocalShip());
    expect(killed, 'the local ship was killed through the sim').toBe(true);

    // No screenshot here, and the reason is worth writing down rather than
    // leaving as a gap: an explosion is over in about eight tenths of a second
    // (`vfx/emitters.ts`, ember ttl 0.35–0.8 s) and a headless capture takes
    // longer than that to land, so every frame this test can photograph is the
    // aftermath. Racing the capture against the burst was tried and lost. The
    // still that shows what an explosion LOOKS like is the frozen golden, where
    // the moment is pinned on purpose (`vfx/showcase.ts`); what this test is for
    // is the wire, and the wire is the readback below.
    const after = await waitForDraw(page, 'shipExplode', before.drawn.shipExplode ?? 0);

    expect(after.drawn.shipExplode!, 'the field drew an explosion').toBeGreaterThan(
      before.drawn.shipExplode ?? 0,
    );
    // Attributed to the seat we actually killed, on a board where anyone can die.
    expect(after.drawnBy.shipExplode, 'the explosion drawn was the LOCAL ship').toBe(LOCAL_PLAYER);
    // Particles reaching the pool is half the wire; the OTHER half is the draw
    // layer turning them into sprites. A field full of particles nobody draws is
    // the same silence in a different file.
    expect(after.particles, 'particles are live in the pool').toBeGreaterThan(0);
    expect(after.sprites, 'the draw layer built sprites for them').toBeGreaterThan(0);
    expect(errors, 'no page errors while an explosion draws').toEqual([]);
  });

  test('ore arriving in the hold draws its pickup', async ({ page }) => {
    const errors = await boot(page);
    const before = await page.evaluate(() => window.__vfxStage!.read());

    // Ore appears in the LOCAL hold, away from home so the deposit rule leaves it
    // there — which is what tractor collection does (GDD §2.3). The observer
    // derives `oreCollect` from the hold rising; nothing tells it to.
    // One chunk per frame for two seconds, because the observer emits one
    // `oreCollect` per unit the hold gains — so this is a SUSTAINED tractor
    // stream, which is both what a good mining run looks like and the only way a
    // headless capture can photograph a 0.28-second particle. Not awaited: the
    // stream has to still be running when the screenshot lands.
    const streaming = page.evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      let last = null;
      for (let ore = 1; ore <= 120; ore++) {
        last = window.__oreHudStage!.mine(ore);
        await frame();
      }
      return last;
    });

    const after = await waitForDraw(page, 'oreCollect', before.drawn.oreCollect ?? 0);
    const shot = page.screenshot({ path: 'tests/live-stage/vfx-ore-collect-evidence.png' });
    const staged = await streaming;
    expect(staged, 'the ore stage put ore in the local hold').not.toBeNull();
    expect(staged!.cargo).toBeGreaterThan(0);

    expect(after.drawnBy.oreCollect, 'the pickup drawn was the LOCAL ship').toBe(LOCAL_PLAYER);
    expect(after.sprites, 'the draw layer built sprites for it').toBeGreaterThan(0);

    await shot;
    expect(errors, 'no page errors while an ore pickup draws').toEqual([]);
  });

  test('the reduce-VFX floor thins the field and still draws the tell', async ({ page }) => {
    // r9-01's rule, on the live stage: the throttle sheds weight by THINNING and
    // never by making an effect vanish mid-match. The same reducer once deleted a
    // sky, so this is checked where it can actually be checked — on the client,
    // through the control a player really uses.
    const errors = await boot(page);

    // Front door: ESC opens pause, then the SETTINGS button, then the REDUCE VFX
    // row — each reached by a trusted click at the point the client drew it.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu');
    await clickControl(page, 'settings');
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'settings');
    await clickControl(page, 'reduceVfx');

    const thinned = await page.waitForFunction(
      (density) => {
        const seen = window.__vfxStage!.read();
        return seen.quality === density ? seen : null;
      },
      REDUCED_DENSITY,
      { timeout: 10_000 },
    );
    // Not asserted before the click: the AUTO reducer targets the same floor on a
    // sustained fps drop (GDD §4.3, risk 5), and a loaded software-GL runner can
    // reach it on its own. What is load-bearing is not which of the two flipped
    // the flag — it is what the flag does to the field, which is the next three
    // assertions and the burst below.
    const reduced = (await thinned.jsonValue()) as VfxReadout;
    expect(reduced.reduced, 'the field is running thinned').toBe(true);
    // Thinned, NOT off. Zero density would be the sky all over again.
    expect(reduced.quality, 'the density is reduced but not zero').toBeGreaterThan(0);

    // Back to the match, and the mechanic still has its tell at the floor.
    await clickControl(page, 'back');
    await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu');
    await clickControl(page, 'resume');
    await page.waitForFunction(() => !window.__pauseStage!.read().open);

    const before = await page.evaluate(() => window.__vfxStage!.read());
    expect(before.quality, 'still thinned after resuming').toBe(REDUCED_DENSITY);
    expect(await page.evaluate(() => window.__endScreenStage!.killLocalShip())).toBe(true);
    const after = await waitForDraw(page, 'shipExplode', before.drawn.shipExplode ?? 0);

    expect(after.drawnBy.shipExplode, 'the explosion still draws, thinned').toBe(LOCAL_PLAYER);
    expect(after.particles, 'thinned is fewer particles, never none').toBeGreaterThan(0);
    expect(errors, 'no page errors at the reduced-VFX floor').toEqual([]);
  });
});

/** Click a pause/settings control at the physical point the client drew it. */
async function clickControl(page: Page, kind: string): Promise<void> {
  const point = await page.evaluate((want) => {
    const found = window.__pauseStage!.read().controls.find((c) => c.kind === want);
    return found ? found.physicalCenter : null;
  }, kind);
  expect(point, `the pause overlay is offering a "${kind}" control`).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}
