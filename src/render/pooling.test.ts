/**
 * The texture pooling, asserted on the SHIPPED renderer (a1-11).
 * OWNER: Platform Engineer.
 *
 * `docs/atlas-pooling-measured.md` says what the pooled path costs; this says
 * that the pooled path is the one the game takes, and that it draws the same
 * picture. Both halves are here because a1-09 found `src/art/atlas.ts` carrying
 * a pooling claim for a whole milestone with **nothing calling it** — a document
 * asserting a shape nothing enforced. That is what this file is against.
 *
 * It drives the real `Renderer` with a **recording baker**: a `TextureBaker`
 * that counts bakes and hands back a correctly-sized blank texture. That is the
 * production seam, not a stub of one — `main.ts` passes `app.renderer` through
 * the identical parameter — so what is asserted below (how many textures a
 * 200-rock field costs, that a steady frame bakes nothing, that a sprite carries
 * the transform its `Graphics` carried) is asserted about the shipped code path.
 *
 * What a headless suite cannot assert is pixels; those are the Playwright
 * goldens' job, on the real bundle (`tests/mobile/goldens.spec.ts`).
 */
import { describe, it, expect } from 'vitest';
import { Container, Rectangle, Texture, TextureSource } from 'pixi.js';
import { stressWorld } from '../../harness/perf';
import { ASTEROID, TURRET } from '../sim/constants';
import type { World } from '../sim';
import { asteroidArt } from '../art/atlas';
import { Renderer, type EntityTextureBaker } from './index';
import type { Viewport } from '@platform/camera';

/**
 * A window big enough to contain the whole 2400×2400 arena, so nothing is culled.
 *
 * Since a1-12 the renderer submits only what is on screen, and every assertion
 * below is about the **pooling** — how many textures a 200-rock field costs, that
 * a steady frame bakes nothing, that a pooled sprite carries the transform its
 * `Graphics` carried. Shooting them through a real 1280×800 window would ask
 * those questions of the 75 rocks that happen to be visible, which is a weaker
 * version of each one and would make the texture budget move whenever the field
 * seeding did. The cull has its own suite (`./cull.test.ts`) and its own numbers
 * (`./draw-cost.test.ts`); this file deliberately takes it out of the picture.
 */
const VIEW: Viewport = { width: 6000, height: 6000, originX: 0, originY: 0 };

/** A baker that records every bake and returns a blank texture of the requested
 *  frame — the production `generateTexture` contract, minus the raster. */
function recordingBaker(): EntityTextureBaker & { frames: Rectangle[] } {
  const state = {
    frames: [] as Rectangle[],
    generateTexture(options: { target: Container; frame?: Rectangle; resolution?: number }): Texture {
      const frame = options.frame ?? new Rectangle(0, 0, 1, 1);
      state.frames.push(frame.clone());
      return new Texture({
        source: new TextureSource({
          width: frame.width,
          height: frame.height,
          resolution: options.resolution ?? 1,
        }),
      });
    },
  };
  return state;
}

function draw(world: World, renderer: Renderer): void {
  renderer.draw(world, { cameraTarget: 0, muzzles: [] });
}

/** The visible children of a labelled layer. */
function visible(stage: Container, label: string): Container[] {
  const node = stage.getChildByLabel(label, true);
  if (!node) throw new Error(`render layer '${label}' is missing from the stage`);
  return (node as Container).children.filter((c) => c.visible) as Container[];
}

describe('the entity layers share textures (GDD §4.3 "instanced sprites")', () => {
  it('carries the GDD §4.3 scene on a texture budget a phone can hold', () => {
    const world = stressWorld();
    const baker = recordingBaker();
    const stage = new Container();
    const renderer = new Renderer(stage, VIEW, { baker });

    draw(world, renderer);

    // GDD §4.3, in the atlas's own words: "a field of 200 rocks shares a couple
    // of dozen textures". a1-10 measured 46 for the rocks, 24 for all 32 turrets
    // and 4 for 300 shots. The bound is stated as an order of magnitude, not as
    // a golden number — a new crack stage or a ninth roster colour may move it,
    // and what must never happen is it tracking the ENTITY count.
    expect(world.asteroids.length).toBeGreaterThanOrEqual(200);
    expect(renderer.textureCount, 'the pool should be dozens of textures, not hundreds').toBeLessThan(100);
    expect(renderer.bakeCount).toBe(renderer.textureCount);
    expect(renderer.textureCount).toBeLessThan(world.asteroids.length / 2);
  });

  it('bakes nothing at all on a steady frame — the pool is a pool', () => {
    const world = stressWorld();
    const baker = recordingBaker();
    const renderer = new Renderer(new Container(), VIEW, { baker });

    draw(world, renderer);
    const afterFirst = renderer.bakeCount;
    expect(afterFirst).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) draw(world, renderer);
    expect(renderer.bakeCount, 'a look already in the pool must never be re-baked').toBe(afterFirst);
  });

  it('every bake is framed on the art origin, square — never cropped to a bounding box', () => {
    const world = stressWorld();
    const baker = recordingBaker();
    draw(world, new Renderer(new Container(), VIEW, { baker }));

    expect(baker.frames.length).toBeGreaterThan(0);
    for (const frame of baker.frames) {
      // Square, and centred on (0, 0) — the sprite IR's origin, which is the
      // point the entity collides at. Cropped to bounds instead, an asymmetric
      // rock silhouette would draw beside the body it is.
      expect(frame.width).toBe(frame.height);
      expect(frame.x).toBe(-frame.width / 2);
      expect(frame.y).toBe(-frame.height / 2);
    }
  });
});

describe('the pooled sprite is the picture the Graphics was', () => {
  it('carries exactly the transform the direct-draw path carried', () => {
    const world = stressWorld();
    const stage = new Container();
    const renderer = new Renderer(stage, VIEW, { baker: recordingBaker() });
    draw(world, renderer);

    const rocks = visible(stage, 'asteroids');
    expect(rocks.length).toBe(world.asteroids.length);
    for (let i = 0; i < world.asteroids.length; i++) {
      const a = world.asteroids[i]!;
      const s = rocks[i]!;
      expect(s.x).toBe(a.pos.x);
      expect(s.y).toBe(a.pos.y);
      // The Graphics path drew the rock at 64 px per art unit and then scaled by
      // `radius / 64`. The pooled path bakes at the same density, so it must land
      // on the same number — that identity is what keeps the swap a swap.
      expect(s.scale.x).toBeCloseTo(a.radius / 64, 3);
      expect(s.scale.y).toBeCloseTo(a.radius / 64, 3);
    }

    for (const t of visible(stage, 'turrets')) {
      expect(t.scale.x).toBeCloseTo(TURRET.radius / 48, 3);
    }
  });

  it('minifies every texture and magnifies none — a rock is never upscaled', () => {
    const world = stressWorld();
    const stage = new Container();
    const renderer = new Renderer(stage, VIEW, { baker: recordingBaker() });
    draw(world, renderer);

    // The biggest rock the sim can spawn, against the texture it draws from. If
    // a bake density is ever dropped below the entity's screen size this fails,
    // which is the moment the pooling starts costing sharpness instead of frame.
    for (const s of visible(stage, 'asteroids')) {
      const drawn = s.getLocalBounds().width * s.scale.x;
      expect(drawn).toBeLessThanOrEqual(s.getLocalBounds().width);
      expect(drawn).toBeGreaterThan(0);
    }
    const widest = 2 * ASTEROID.maxRadius;
    const smallestTexture = Math.min(...visible(stage, 'asteroids').map((s) => s.getLocalBounds().width));
    expect(smallestTexture, 'a rock texture must be at least as wide as the widest rock').toBeGreaterThanOrEqual(
      widest,
    );
  });

  it('gives two rocks that read the same one texture, and two that do not, two', () => {
    const world = stressWorld();
    const stage = new Container();
    draw(world, new Renderer(stage, VIEW, { baker: recordingBaker() }));

    const sprites = visible(stage, 'asteroids');
    const byLook = new Map<string, Set<Texture>>();
    for (let i = 0; i < world.asteroids.length; i++) {
      const key = asteroidArt(world.asteroids[i]!).key;
      const texture = (sprites[i] as unknown as { texture: Texture }).texture;
      (byLook.get(key) ?? byLook.set(key, new Set()).get(key)!).add(texture);
    }
    // One look, one texture: the whole point. And more than one look in the
    // field, or the assertion above would be vacuously true on a flat scene.
    for (const [key, textures] of byLook) {
      expect(textures.size, `look '${key}' is spread over ${textures.size} textures`).toBe(1);
    }
    expect(byLook.size).toBeGreaterThan(1);
  });
});
