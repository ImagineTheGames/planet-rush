/**
 * Draw-cost characterisation (a1-10, `docs/atlas-pooling-measured.md`).
 * OWNER: Platform Engineer.
 *
 * This suite asserts what the renderer costs **today**, on purpose, because the
 * cost is now a measured number attached to a deferred decision — and a deferred
 * decision written only in a document is how `src/art/atlas.ts` came to carry a
 * pooling claim for a whole milestone with nothing calling it (a1-09).
 *
 * The measurement (see the doc for the box and the method) found two things:
 *
 *  1. The renderer submits **one display object per entity**. On the GDD §4.3
 *     stress scene that is ~263 draw calls a frame, and putting the same looks
 *     through `SpriteTextureCache` instead collapses the 200-rock layer from 200
 *     draw calls to 1.8 and its cost from 26.1 ms to 3.9 ms.
 *  2. Almost none of those entities are **on screen**. The arena is 2400×2400
 *     (or 3200×2000); a desktop window sees a 1280×800 slice of it and a
 *     landscape phone sees 844×390. Nothing in this layer culls.
 *
 * Neither was fixed under a1-10: the pooled path rasterises vector art, which
 * moves the frozen-scene goldens, and that brief's own guard rail forbids it.
 * So the numbers are pinned here instead, where CI reads them.
 *
 * **(1) IS FIXED — a1-11 wired the pooling, with the golden constraint lifted.**
 * Rocks, turrets and shots are pooled `Sprite`s over shared textures now, so the
 * *draw calls* those layers cost collapsed (see the doc's revised table and
 * `./pooling.test.ts`, which asserts the sharing on the shipped renderer). What
 * this file measures is **display objects, not draw calls**, and that number is
 * unchanged and still worth pinning: the renderer still walks every entity in
 * the arena every frame, and (2) — that almost none of them are on screen — is
 * exactly as true as it was. That is what a1-10 §6A is for and it has not landed.
 *
 * **If you are here because this test failed: good.** It means the shape of the
 * frame changed. Do not loosen the assertion — re-run
 * `node spikes/atlas-pooling/run.mjs`, update `docs/atlas-pooling-measured.md`
 * with the new numbers, and update the constants below to match what you
 * measured. The test exists to make that re-measurement unskippable.
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
import type { Viewport } from '@platform/camera';

/** The desktop gate's window (GDD §4.3, and `tests/perf/playwright.perf.config.ts`). */
const DESKTOP: Viewport = { width: 1280, height: 800, originX: 0, originY: 0 };
/** The landscape-phone profile from the same config — the mobile gate's screen. */
const PHONE: Viewport = { width: 844, height: 390, originX: 0, originY: 0 };

/** The entity layers this test accounts for — the ones that scale with the
 *  scene. The backdrop and the boundary are a fixed handful and are excluded so
 *  the ratio below is about entities, not chrome. */
const ENTITY_LAYERS = ['asteroids', 'chunks', 'ships', 'turrets', 'shots'] as const;

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
 *  walks and transforms. Since a1-11 the dense ones batch, so this is no longer a
 *  draw-call count; it is still the per-frame CPU walk, and it is still the whole
 *  arena. Pooled-but-hidden children do not count; they cost nothing. */
function submitted(stage: Container): number {
  let n = 0;
  for (const label of ENTITY_LAYERS) {
    for (const child of layer(stage, label).children) if (child.visible) n++;
  }
  return n;
}

/**
 * Entities whose drawn extent intersects the visible viewport this frame —
 * inflated by each body's own radius, so anything straddling an edge counts as
 * on screen. This is the number a culling pass would submit.
 */
function onScreen(world: World, viewport: Viewport): number {
  // The camera puts the target ship at the visible centre, so the visible world
  // rectangle is that centre plus/minus half the viewport (camera.ts; the camera
  // is translate-only, no zoom, so world units are CSS px).
  const target = world.ships.find((s) => s.id === 0) ?? world.ships[0]!;
  const left = target.pos.x - viewport.width / 2;
  const right = target.pos.x + viewport.width / 2;
  const top = target.pos.y - viewport.height / 2;
  const bottom = target.pos.y + viewport.height / 2;
  const hit = (x: number, y: number, r: number): boolean =>
    x + r >= left && x - r <= right && y + r >= top && y - r <= bottom;

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

describe('draw cost on the GDD §4.3 stress scene (a1-10 characterisation)', () => {
  it('walks one display object per entity, on-screen or not', () => {
    const world = stressWorld();
    const entities =
      world.asteroids.length +
      world.chunks.length +
      world.ships.filter((s) => s.alive).length +
      world.stations.reduce((n, s) => n + s.turrets.filter((t) => t.hp > 0).length, 0) +
      world.projectiles.filter((p) => p.active).length;

    expect(entities).toBeGreaterThanOrEqual(STRESS_SCENE.asteroids);
    expect(
      submitted(drawOnce(world, DESKTOP)),
      'the renderer walks one display object per entity; if this changed, re-measure (see the file header)',
    ).toBe(entities);
  });

  it('draws the whole arena every frame, most of it off screen', () => {
    const world = stressWorld();
    const stage = drawOnce(world, DESKTOP);
    const drawn = submitted(stage);
    const visible = onScreen(world, DESKTOP);

    // The measured fact, pinned: the renderer submits several times what the
    // window contains. The bound is deliberately loose — this test is here to
    // notice a culling pass landing, not to police the field's exact seeding.
    expect(visible).toBeLessThan(drawn);
    expect(
      drawn / visible,
      'off-screen submissions per on-screen one; a culling pass would drive this to ~1',
    ).toBeGreaterThan(2);
  });

  it('is worse on the phone, which is the tighter gate', () => {
    const world = stressWorld();
    // A landscape phone sees 844×390 of the same arena — under a third of the
    // desktop window's area — so the same field costs the same submissions for
    // far fewer visible bodies. The mobile gate (GDD §4.3) is the binding one.
    expect(onScreen(world, PHONE)).toBeLessThan(onScreen(world, DESKTOP));
    expect(submitted(drawOnce(world, PHONE))).toBe(submitted(drawOnce(world, DESKTOP)));
  });
});
