/**
 * Draw-cost characterisation (a1-10 → a1-11 → a1-12).
 * OWNER: Platform Engineer.
 *
 * This suite asserts what the renderer costs **today**, on purpose, because the
 * cost is a measured number attached to a decision — and a decision written only
 * in a document is how `src/art/atlas.ts` came to carry a pooling claim for a
 * whole milestone with nothing calling it (a1-09).
 *
 * a1-10 measured two things on the GDD §4.3 stress scene and fixed neither:
 *
 *  1. The renderer submitted **one display object per entity**, ~263 draw calls
 *     a frame, because every body drew its own `Graphics`.
 *  2. Almost none of those entities were **on screen**. The arena is 2400×2400
 *     (or 3200×2000); a desktop window sees a 1280×800 slice of it and a
 *     landscape phone sees 844×390. Nothing in this layer culled.
 *
 * **(1) is fixed — a1-11 wired the pooling** (`./pooling.test.ts`,
 * `docs/atlas-pooling-wired.md`): 263 draw calls → 32.1, median frame 96.9 ms →
 * 53.1 ms, and still not under budget.
 *
 * **(2) is fixed — a1-12 culls to the viewport** (`./cull.ts`,
 * `./cull.test.ts`, `docs/viewport-cull-measured.md`). What this file pins is the
 * *shape* that produced: the entity layers now submit what the window contains
 * and not the arena, and the phone — the tighter gate — submits a small fraction
 * of what the desktop does off the very same field.
 *
 * The two bounds below are a **sandwich**, deliberately, rather than a
 * re-implementation of `./cull.ts` in test code (which would assert only that
 * the file equals itself):
 *
 *   - the lower bound is every body whose own collision radius touches the
 *     window — nothing genuinely visible may be missing;
 *   - the upper bound inflates each radius by the widest art extent any of these
 *     layers wears, so nothing beyond the reach of its own art may be present.
 *
 * **If you are here because this test failed: good.** It means the shape of the
 * frame changed. Do not loosen the assertion — re-run
 * `node spikes/atlas-pooling/run.mjs`, update the measurement docs with the new
 * numbers, and update the constants below to match what you measured. The test
 * exists to make that re-measurement unskippable.
 *
 * Headless, still: a1-10 flagged that baking needs a live `generateTexture` and
 * that paying for it with a second, Graphics-shaped fallback path would be worse
 * than not pooling. a1-11 did not pay it — the baker is injected, and with none
 * the renderer draws the same sprites over blank textures of the right size.
 */
import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import { stressWorld, STRESS_SCENE } from '../../harness/perf';
import type { World } from '../sim';
import { Renderer } from './index';
import { CULL_SLOP, RENDER_EXTENT } from './cull';
import type { Viewport } from '@platform/camera';

/** The desktop gate's window (GDD §4.3, and `tests/perf/playwright.perf.config.ts`). */
const DESKTOP: Viewport = { width: 1280, height: 800, originX: 0, originY: 0 };
/** The landscape-phone profile from the same config — the mobile gate's screen. */
const PHONE: Viewport = { width: 844, height: 390, originX: 0, originY: 0 };

/** The entity layers this test accounts for — the ones that scale with the
 *  scene. The backdrop and the boundary are a fixed handful and are excluded so
 *  the ratio below is about entities, not chrome. */
const ENTITY_LAYERS = ['asteroids', 'chunks', 'ships', 'turrets', 'shots'] as const;

/** The widest art any of those layers wears, times the bake slop — the upper
 *  bound on how far past its collision radius a body in them can reach. It is
 *  the turret, whose extent deliberately tracks its muzzle telegraph. */
const WIDEST_REACH = Math.max(...Object.values(RENDER_EXTENT)) * CULL_SLOP;

function drawOnce(world: World, viewport: Viewport): Container {
  const stage = new Container();
  const renderer = new Renderer(stage, viewport);
  renderer.draw(world, { cameraTarget: 0, muzzles: [] });
  return stage;
}

function layer(stage: Container, label: string): Container {
  const node = stage.getChildByLabel(label, true);
  if (!node) throw new Error(`render layer '${label}' is missing from the stage`);
  return node as Container;
}

/** Display objects the renderer left visible in the entity layers — i.e. what it
 *  hands the GPU. Since a1-11 the dense ones batch, so this is no longer a
 *  draw-call count; it is the per-frame walk and the batch geometry, and since
 *  a1-12 it is the window rather than the arena. Pooled-but-hidden children do
 *  not count; they cost nothing. */
function submitted(stage: Container): number {
  let n = 0;
  for (const label of ENTITY_LAYERS) {
    for (const child of layer(stage, label).children) if (child.visible) n++;
  }
  return n;
}

/**
 * Entities whose extent intersects the visible viewport this frame, each body
 * inflated by `pad` times its own collision radius. `pad = 1` is the minimum
 * that can possibly show a pixel; a larger `pad` is the generous reading that
 * accounts for art overhanging the collider.
 */
function onScreen(world: World, viewport: Viewport, pad: number): number {
  // The camera puts the target ship at the visible centre, so the visible world
  // rectangle is that centre plus/minus half the viewport (camera.ts; the camera
  // is translate-only, no zoom, so world units are CSS px).
  const target = world.ships.find((s) => s.id === 0) ?? world.ships[0]!;
  const left = target.pos.x - viewport.width / 2;
  const right = target.pos.x + viewport.width / 2;
  const top = target.pos.y - viewport.height / 2;
  const bottom = target.pos.y + viewport.height / 2;
  const hit = (x: number, y: number, r: number): boolean =>
    x + r * pad >= left && x - r * pad <= right && y + r * pad >= top && y - r * pad <= bottom;

  let n = 0;
  for (const a of world.asteroids) if (hit(a.pos.x, a.pos.y, a.radius)) n++;
  for (const c of world.chunks) if (hit(c.pos.x, c.pos.y, c.radius)) n++;
  for (const s of world.ships) if (s.alive && hit(s.pos.x, s.pos.y, s.radius)) n++;
  for (const st of world.stations) {
    for (const t of st.turrets) if (t.hp > 0 && hit(t.pos.x, t.pos.y, t.radius)) n++;
  }
  for (const p of world.projectiles) if (p.active && hit(p.pos.x, p.pos.y, p.radius)) n++;
  return n;
}

/** Every entity in the arena, on screen or not — what the layer used to walk. */
function entityCount(world: World): number {
  return (
    world.asteroids.length +
    world.chunks.length +
    world.ships.filter((s) => s.alive).length +
    world.stations.reduce((n, s) => n + s.turrets.filter((t) => t.hp > 0).length, 0) +
    world.projectiles.filter((p) => p.active).length
  );
}

describe('draw cost on the GDD §4.3 stress scene', () => {
  it('submits the window, not the arena', () => {
    const world = stressWorld();
    expect(entityCount(world)).toBeGreaterThanOrEqual(STRESS_SCENE.asteroids);

    const drawn = submitted(drawOnce(world, DESKTOP));

    // The sandwich. Below the floor something visible went missing — that is the
    // bug this whole change is most likely to introduce, and it is a bug even if
    // it makes the numbers look better. Above the ceiling the cull is not culling.
    expect(drawn, 'a body touching the window must be submitted').toBeGreaterThanOrEqual(
      onScreen(world, DESKTOP, 1),
    );
    expect(drawn, 'a body beyond the reach of its own art must not be').toBeLessThanOrEqual(
      onScreen(world, DESKTOP, WIDEST_REACH),
    );

    // …and the whole point: it is a fraction of the field, not the field.
    expect(drawn).toBeLessThan(entityCount(world) / 2);
  });

  it('is best on the phone, which is the tighter gate', () => {
    const world = stressWorld();
    const phone = submitted(drawOnce(world, PHONE));
    const desktop = submitted(drawOnce(world, DESKTOP));

    // A landscape phone sees 844×390 of the same arena — under a third of the
    // desktop window's area. Before a1-12 these two numbers were EQUAL, and that
    // equality was the finding: the same field cost the same submissions however
    // little of it the device could show. The mobile gate (GDD §4.3) is the
    // binding one, and it is where the cull pays most.
    expect(phone).toBeLessThan(desktop);
    expect(phone, 'a body touching the phone window must be submitted').toBeGreaterThanOrEqual(
      onScreen(world, PHONE, 1),
    );
    expect(phone, 'a body beyond the reach of its own art must not be').toBeLessThanOrEqual(
      onScreen(world, PHONE, WIDEST_REACH),
    );
  });

  it('keeps the pooled slots it is not using — hidden, not destroyed', () => {
    const world = stressWorld();
    const stage = drawOnce(world, PHONE);

    // The cull hides; it does not tear the pool down and rebuild it when the
    // camera pans back (GDD §4.3, zero per-frame allocation). Rocks the phone
    // could not show still occupy no draw and no bake — but the ones it showed
    // once keep their slot.
    const rocks = layer(stage, 'asteroids');
    expect(rocks.children.length).toBeGreaterThan(0);
    expect(rocks.children.filter((c) => c.visible).length).toBeLessThan(world.asteroids.length);
  });
});
