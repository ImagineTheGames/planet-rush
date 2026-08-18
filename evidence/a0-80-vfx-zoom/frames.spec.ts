/**
 * evidence/a0-80-vfx-zoom/frames.spec.ts — OWNER: UI Engineer (a0-80).
 *
 * The frames the report is about:
 *
 * > *"when the screen is 1.5x or 2 the thrusters draw In the wrong place"*
 *
 * Three effect kinds at three rungs, on the SAME phone the a0-74 report was
 * filed from, captured identically on both builds:
 *
 *  - **thrust** — the one the developer watched. Fired through the FRONT DOOR: a
 *    real touch tap places a Tap Commander waypoint, the pilot flies the ship,
 *    and the engine burns. Nothing here pushes a tell.
 *  - **oreCollect** — `__oreHudStage.mine()`, the sim's own hold, so the observer
 *    derives the pickup exactly as a real one.
 *  - **shipExplode** — on the FROZEN review sheet (`?freeze=1`), where the death
 *    burst is pinned mid-bang by `src/art/vfx/showcase.ts` and stays there. A live
 *    explosion is over in about eight tenths of a second and every frame a headless
 *    capture can get is the aftermath (`tests/live-stage/vfx-alive.spec.ts` tried
 *    and said so), so photographing one live would be evidence about the shutter
 *    rather than about the camera. The frozen sheet has no race at all: the field
 *    is staged once at a fixed timestep and never updated again, so the same 42
 *    particles sit in the same world positions on every boot and every machine —
 *    and it is the scene the goldens are taken on, which is the other reason to
 *    shoot it here.
 *
 * The two staged ones are here because the brief asks for the CLASS, not the
 * thruster: every tell in the field had the same parent, so a frame that only
 * showed the engine would be evidence for the report rather than for the bug.
 *
 * ── Never label a frame with an effect that did not fire ────────────────────
 *
 * Each capture waits on `__vfxStage.read()` until the field's own draw counter
 * for that kind has CLIMBED since the moment before it was staged, and a capture
 * that cannot prove it FAILS instead of shooting — in both halves of the pair.
 *
 * The two staged kinds also require `drawnBy` to name the local seat, because
 * eight ships are mining and dying on a live board and "an ore pickup was drawn"
 * would be a claim about the match rather than about this frame. The thruster
 * cannot use that check and does not pretend to: every ship under way emits one
 * every frame, so `drawnBy.thrust` reports whichever seat drew LAST (the highest
 * id flying, in practice) no matter who else is burning. What it uses instead is
 * the sim's own answer to the same question — `__planetRush.shipWorld`, the local
 * ship's world position, sampled twice: a ship that has MOVED is a ship whose
 * engine is lit. The plume is then in the frame by construction.
 *
 * ── The readback ────────────────────────────────────────────────────────────
 *
 * Every frame is accompanied by a reading in `./readback.json`: the field's live
 * particle and sprite counts AT CAPTURE, the seated rung, and where the local
 * ship was in world and screen space. That is what separates "the effect is drawn
 * in the wrong place" from "the effect is not drawn at all" — under the broken
 * build the field is provably drawing into every frame that looks empty.
 *
 * The scene is LIVE (`?debug=1&gate=0`), not `?freeze=1`: a pinned world emits no
 * deltas, and the frozen showcase stages only two of the twenty-five kinds and no
 * thruster at all (`src/art/vfx/showcase.ts`). A live board is also the honest
 * specimen — it is what the developer was looking at.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
const LABEL = process.env.A0_80_LABEL ?? 'after';
const SCENE = '/?debug=1&gate=0';
/** The frozen review sheet — the goldens' own scene (`@platform/freeze`). */
const FROZEN = '/?debug=1&freeze=1&gate=0';

/** The seat `?debug=1` seats this client at offline (src/main.ts `LOCAL_PLAYER`). */
const LOCAL_PLAYER = 0;

/** The phone the report was filed from (a0-74's `phone-798x384`). */
const PHONE = { width: 798, height: 384, dpr: 3 } as const;

/** The ladder, from `@ui/viewport` `VIEW_ZOOM_STEPS`. */
const RUNGS = [1, 1.5, 2] as const;

interface VfxRead {
  attached: boolean;
  particles: number;
  drawn: Record<string, number>;
  drawnBy: Record<string, number>;
}

declare global {
  interface Window {
    __vfxStage?: { read(): VfxRead };
    __viewStage?: { setZoom(step: number): number; zoom(): number };
    __oreHudStage?: { mine(ore: number): unknown };
    __endScreenStage?: { killLocalShip(): boolean; shipAlive(): boolean };
    __tapCommanderStage?: {
      tapWorld(x: number, y: number): { locked: boolean; kind: string | null; id: number | null };
    };
    __planetRush?: { shipWorld: { x: number; y: number }; shipScreen: { x: number; y: number } };
  }
}

/** One line of `./readback.json` — what the client itself said as the shutter fell. */
interface Reading {
  label: string;
  frame: string;
  rung: number;
  effect: string;
  /** Live particles in the field's pool. Non-zero in a frame that looks empty is
   *  the whole point: the effects were drawn, just not where the emitter is. */
  particles: number;
  sprites: number;
  drawn: number;
  shipWorld: { x: number; y: number };
  shipScreen: { x: number; y: number };
}

const readings: Reading[] = [];

async function boot(page: Page): Promise<void> {
  await page.goto(SCENE);
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__vfxStage), undefined, { timeout: 60_000 });
  await settleFrames(page, 16);
}

/** Seat a rung through the client's own zoom seam, and prove it took. A frame
 *  captioned 2× that is really 1× is the worst kind of evidence. */
async function setZoom(page: Page, step: number): Promise<void> {
  const seated = await page.evaluate((s) => window.__viewStage!.setZoom(s), step);
  expect(seated).toBeCloseTo(step, 6);
  await settleFrames(page, 8);
}

/** How many of `kind` the field has DRAWN, and who owned the last one. */
async function drawn(page: Page, kind: string): Promise<{ n: number; by: number }> {
  return page.evaluate((k) => {
    const r = window.__vfxStage!.read();
    return { n: r.drawn[k] ?? 0, by: r.drawnBy[k] ?? -1 };
  }, kind);
}

/**
 * Wait until `kind` has been drawn since `from`. `owned` additionally requires the
 * last one to belong to the local seat — right for the two STAGED kinds, and
 * impossible for the thruster (see the header: every ship under way emits one).
 */
async function waitDrawn(page: Page, kind: string, from: number, owned: boolean): Promise<void> {
  await page.waitForFunction(
    ([k, n, who, own]) => {
      const r = window.__vfxStage!.read();
      if ((r.drawn[k as string] ?? 0) <= (n as number)) return false;
      return !own || (r.drawnBy[k as string] ?? -1) === who;
    },
    [kind, from, LOCAL_PLAYER, owned] as const,
    { timeout: 60_000, polling: 50 },
  );
}

/** The local ship's world position, straight off the debug hook. */
async function shipWorld(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({ ...window.__planetRush!.shipWorld }));
}

/** Wait until the local ship has actually travelled — the sim's own evidence that
 *  its engine is lit, which `drawnBy.thrust` cannot give (see the header). */
async function waitUnderWay(page: Page, from: { x: number; y: number }, units: number): Promise<void> {
  await page.waitForFunction(
    ([x, y, d]) => {
      const w = window.__planetRush!.shipWorld;
      return Math.hypot(w.x - (x as number), w.y - (y as number)) > (d as number);
    },
    [from.x, from.y, units] as const,
    { timeout: 60_000, polling: 50 },
  );
}

async function shoot(page: Page, name: string, step: number, kind: string): Promise<void> {
  const rung = String(step).replace('.', '_');
  const frame = `${LABEL}-${name}-${rung}x.png`;
  const seen = await page.evaluate(
    (k) => {
      const v = window.__vfxStage!.read();
      return {
        particles: v.particles,
        sprites: (v as unknown as { sprites: number }).sprites,
        drawn: v.drawn[k] ?? 0,
        shipWorld: { ...window.__planetRush!.shipWorld },
        shipScreen: { ...window.__planetRush!.shipScreen },
      };
    },
    kind,
  );
  await page.screenshot({ path: join(FRAMES, frame) });
  readings.push({ label: LABEL, frame, rung: step, effect: kind, ...seen });
}

test.describe('a0-80 — where the effects land, at every rung', () => {
  test.beforeAll(() => {
    mkdirSync(FRAMES, { recursive: true });
  });

  test.afterAll(() => {
    writeFileSync(join(HERE, `readback-${LABEL}.json`), `${JSON.stringify(readings, null, 2)}\n`);
  });

  for (const step of RUNGS) {
    test(`shoots the three effect kinds at ${step}x`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: PHONE.width, height: PHONE.height },
        deviceScaleFactor: PHONE.dpr,
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await boot(page);
      await setZoom(page, step);

      // The layer is on the stage at all — the a2-07 wire, which this branch
      // re-parents and must not break.
      expect((await page.evaluate(() => window.__vfxStage!.read())).attached).toBe(true);

      // 1. THRUST — the effect the report is about. The order goes in through the
      //    client's OWN hit-test and picker (`tapWorld` resolves the world point
      //    exactly as a finger does and hands the pilot the order), the sim flies
      //    the ship, and the engine burns because the ship is under way. Nothing
      //    here pushes a tell.
      const before = await drawn(page, 'thrust');
      const from = await shipWorld(page);
      await page.evaluate(() => window.__tapCommanderStage!.tapWorld(200, 200));
      await waitDrawn(page, 'thrust', before.n, false);
      await waitUnderWay(page, from, 120); // travelled: the engine is lit
      await settleFrames(page, 3);
      await shoot(page, 'thrust', step, 'thrust');

      // 2. ORE COLLECT — the sim's own hold, diffed by the same observer. Streamed
      //    one chunk per frame and NOT awaited, because the observer emits one
      //    pickup per unit gained and a single chunk's particles are gone in
      //    0.28 s: a sustained tractor stream is both what a mining run looks like
      //    and the only way a headless capture can photograph one
      //    (`tests/live-stage/vfx-alive.spec.ts` learned this the hard way).
      const ore = await drawn(page, 'oreCollect');
      const streaming = page.evaluate(async () => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
        for (let n = 1; n <= 240; n++) {
          window.__oreHudStage!.mine(n);
          await frame();
        }
      });
      await waitDrawn(page, 'oreCollect', ore.n, true);
      await settleFrames(page, 2);
      await shoot(page, 'ore-collect', step, 'oreCollect');
      await streaming;

      await ctx.close();
    });
  }

  // The frozen review sheet, at the same three rungs. Deterministic twice over:
  // the sim is pinned (`@platform/freeze`) and the particle field is staged once
  // at a fixed timestep and then left alone, so nothing here is racing anything.
  for (const step of RUNGS) {
    test(`shoots the frozen review sheet at ${step}x`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: PHONE.width, height: PHONE.height },
        deviceScaleFactor: PHONE.dpr,
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.goto(FROZEN);
      await page.waitForSelector('canvas', { timeout: 60_000 });
      await page.waitForFunction(() => Boolean(window.__vfxStage), undefined, { timeout: 60_000 });
      // The showcase has actually been staged: both kinds drawn, for the LOCAL
      // seat, and particles live in the pool. A frozen sheet with an empty field
      // would photograph as "the effects are gone" in both halves of the pair.
      await page.waitForFunction(
        () => {
          const r = window.__vfxStage!.read();
          return (r.drawn.shipExplode ?? 0) > 0 && (r.drawn.oreCollect ?? 0) > 0 && r.particles > 0;
        },
        undefined,
        { timeout: 60_000, polling: 50 },
      );
      const owned = await page.evaluate(() => window.__vfxStage!.read().drawnBy);
      expect(owned.shipExplode, 'the staged burst is the local seat\'s').toBe(LOCAL_PLAYER);
      expect(owned.oreCollect, 'the staged pickup is the local seat\'s').toBe(LOCAL_PLAYER);

      await settleFrames(page, 16);
      await setZoom(page, step);
      await shoot(page, 'frozen-showcase', step, 'shipExplode');
      await ctx.close();
    });
  }
});
