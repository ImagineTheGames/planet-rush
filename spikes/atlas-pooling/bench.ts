/**
 * spikes/atlas-pooling/bench.ts — a1-10's measurement rig. OWNER: Platform Engineer.
 *
 * `src/art/atlas.ts` carries a performance claim: *"a field of 200 rocks shares a
 * couple of dozen textures (GDD §4.3: zero per-frame allocation on the hot
 * paths)"*. Eleven of its twelve value exports are uncalled — `src/render/`
 * imports `asteroidArt` and nothing else, and draws every entity as its own
 * `Graphics`. This file is the instrument that decides whether that claim is
 * worth honouring or worth deleting. It measures; it does not argue.
 *
 * ## What is actually being compared
 *
 * The render layer is **not** un-pooled. Every hot path already key-guards its
 * geometry (`asteroidKeys`, `turretKeys`, `shotKeys`): a steady frame writes
 * `x`/`y`/`scale` and nothing else, and rebuilds vector geometry only when a
 * rock's crack stage or a turret's telegraph actually moves. So the question is
 * not "pooled vs unpooled". It is three ways of spending the *same* pooled look
 * on the GPU:
 *
 *   A `graphics`  — one `Graphics` per entity, each with its own
 *                   `GraphicsContext`. What ships today.
 *   B `sprites`   — one `Sprite` per entity, all sharing a handful of `Texture`s
 *                   baked through `SpriteTextureCache`. What `atlas.ts` exists
 *                   to key, and what GDD §4.3 means by "instanced sprites".
 *   C `contexts`  — one `Graphics` per entity, but the `GraphicsContext` itself
 *                   pooled by look key. Vector geometry, shared once per look.
 *                   Not in the brief; it is the obvious third door and costs one
 *                   extra scenario to rule in or out.
 *
 * A and C draw vectors, B blits a raster of the same vectors — so the three are
 * visually equivalent at the sizes the game draws rocks (22–46 world units of
 * radius ⇒ 44–92 px across at dpr 1, against a {@link ROCK_TEXTURE_PX} bake).
 *
 * ## Why a browser, and what the numbers mean
 *
 * Frame time needs real WebGL, so this runs in Chromium under `run.mjs` with the
 * vsync cap off — an uncapped `requestAnimationFrame` delta is the frame's real
 * cost rather than a 16.67 ms sleep. Two metrics come out, and they are not
 * equally portable:
 *
 *  - **Draw calls per frame** is architecture, not hardware. N distinct
 *    `GraphicsContext`s cannot batch with each other; N `Sprite`s over a few
 *    textures collapse into a handful of batches. This number is the same on a
 *    workstation, on integrated graphics, and on a phone.
 *  - **Frame time** is the box. Stated with the box's GPU string attached, and
 *    never quoted without it.
 *
 * Scenarios are interleaved and repeated (see {@link ROUNDS}) so a warming
 * machine cannot hand the win to whichever path happened to run last.
 */

import { Application, Container, Graphics, GraphicsContext, Sprite, type Texture } from 'pixi.js';
import { stressWorld, STRESS_SCENE } from '../../harness/perf';
import type { World } from '../../src/sim';
import { asteroidSprite } from '../../src/art/asteroids';
import type { SpriteDef } from '../../src/art/shapes';
import { turretSprite, type TurretState } from '../../src/art/buildings';
import { shotSprite, type ShotFamily } from '../../src/art/vfx/shots';
import { drawSprite, SpriteTextureCache } from '../../src/art/textures';
import { asteroidArt, asteroidTexture, turretTexture } from '../../src/art/atlas';
import { VfxAutoQuality } from '../../src/platform/vfx-quality';
import { Renderer, type RenderView } from '../../src/render';

// ---------------------------------------------------------------------------
// Rig constants
// ---------------------------------------------------------------------------

/** Canvas size. The desktop profile from `tests/perf/playwright.perf.config.ts`,
 *  so this rig and QA's frame-time gate are talking about the same screen. */
const VIEW = { width: 1280, height: 800 } as const;

/** Frames timed per scenario, per round. ~2 s of a 60 fps budget each. */
const FRAMES = 180;
/** Frames rendered untimed first: shader compiles, first texture uploads, JIT. */
const WARMUP = 60;
/** Interleaved repeats of the whole scenario list. Round 1 is discarded. */
const ROUNDS = 3;

/** Pixels across which a rock texture is baked in the `sprites` path. The
 *  largest rock the game draws is `ASTEROID.maxRadius * 2` = 92 px at dpr 1, so
 *  96 is ~1:1 — the raster is not being handed a resolution advantage, and not
 *  being punished with a blurry one either. */
const ROCK_TEXTURE_PX = 96;
/** Same, for a turret: `TURRET.radius` is 14 world units ⇒ 28 px across. */
const TURRET_TEXTURE_PX = 32;
/** Same, for a shot: radius 3 ⇒ 6 px across, but the glow overhangs, so bake
 *  a little large rather than let the ramp band. */
const SHOT_TEXTURE_PX = 32;

/** Mirrors `src/render/index.ts`'s own constants, so path A is the shipped
 *  geometry at the shipped authoring scale and not a lookalike. */
const ROCK_ART_SCALE = 64;
const TURRET_ART_SCALE = 48;
const SHOT_ART_SCALE = 16;

// ---------------------------------------------------------------------------
// WebGL draw-call counter — patched before any context exists
// ---------------------------------------------------------------------------

let drawCalls = 0;

function installDrawCallCounter(): void {
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const original = proto[name] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') continue;
    proto[name] = function patched(this: unknown, ...args: unknown[]): unknown {
      drawCalls++;
      return original.apply(this, args);
    };
  }
}

/** The box this ran on — the number is meaningless without it. */
function gpuString(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no webgl2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return gl.getParameter(gl.RENDERER) as string;
    return `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`;
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface Stats {
  readonly frames: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  /** Frames per second implied by the median — the headline read. */
  readonly fps: number;
}

function stats(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  const median = at(0.5);
  return {
    frames: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1),
    median,
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    fps: median > 0 ? 1000 / median : 0,
  };
}

/**
 * Would the auto-reducer have engaged on this frame distribution? Replays the
 * captured deltas through the real {@link VfxAutoQuality} — the same state
 * machine `main.ts` feeds — rather than eyeballing the fps against 30. The
 * brief is explicit that an engagement outranks the micro-benchmark.
 */
function vfxVerdict(deltasMs: readonly number[]): { engaged: boolean; smoothedFps: number | null } {
  const q = new VfxAutoQuality();
  // The sustain window is 3 s and a capture is ~2 s, so replay the distribution
  // until the window can have elapsed — the question is "does this frame rate
  // engage it", not "does a two-second clip engage it".
  let elapsed = 0;
  let engaged = false;
  for (let pass = 0; pass < 8 && elapsed < 8; pass++) {
    for (const ms of deltasMs) {
      const s = ms / 1000;
      engaged = q.sample(s) || engaged;
      elapsed += s;
    }
  }
  return { engaged, smoothedFps: q.smoothedFps };
}

// ---------------------------------------------------------------------------
// The scene under test
// ---------------------------------------------------------------------------

/**
 * A scenario owns a layer of the stress scene, built one of the three ways, and
 * knows how to advance it by a frame. `update` does exactly what the shipped
 * renderer does per frame — writes transforms, and rebuilds a look only when its
 * key moved — so the measurement charges each path for its own steady state.
 */
interface Scenario {
  readonly name: string;
  readonly layer: Container;
  /** Distinct baked textures / pooled contexts this path ended up holding. */
  readonly pooled: () => number;
  /** Entities actually left visible on the last frame — the same as `entities`
   *  for every path that draws the whole arena, and the point of the culled
   *  ones. */
  readonly drawn?: () => number;
  update(world: World, frame: number): void;
  destroy(): void;
}

/** Rocks drift and crack over the capture, so neither path can be measured on a
 *  frozen scene it could trivially cache. The motion is identical for all three
 *  paths (a shared deterministic wobble), so nothing but the draw differs. */
function rockPose(world: World, i: number, frame: number): { x: number; y: number } {
  const a = world.asteroids[i]!;
  const t = frame * 0.016;
  return { x: a.pos.x + Math.sin(t + i) * 12, y: a.pos.y + Math.cos(t * 0.7 + i) * 12 };
}

/**
 * Every rock's ore is walked down over the capture so crack stages and payout
 * bands genuinely change mid-measurement — the look-key churn each path has to
 * absorb. Without it the "rebuild only on change" guard would never fire and all
 * three paths would be measured on a scene that never moves a vertex.
 */
function crackRocks(world: World, frame: number): void {
  // One rock per frame steps down a band: over 180 frames that is most of a
  // 200-rock field changing look once, which is far more churn than a real
  // match produces and therefore a conservative reading for the vector paths.
  const a = world.asteroids[frame % world.asteroids.length]!;
  const next = a.ore - a.maxOre / 6;
  a.ore = next > 0 ? next : a.maxOre;
  const frac = a.ore / a.maxOre;
  a.crackStage = frac > 2 / 3 ? 0 : frac > 1 / 3 ? 1 : 2;
}

/**
 * On screen this frame? The scenario layers sit at the stage origin, so the
 * visible world rectangle is simply the viewport — which is the honest ratio the
 * game runs at: a 1280×800 desktop window sees 18% of a 2400×2400 arena, and a
 * 844×390 phone sees under 6% of it.
 *
 * Inflated by the entity's own radius so a rock straddling the edge still draws.
 * That is the whole correctness argument for culling: an object entirely outside
 * this rectangle contributes no pixel, so skipping it cannot change what renders.
 */
function onScreen(x: number, y: number, radius: number): boolean {
  return (
    x + radius >= 0 && x - radius <= VIEW.width && y + radius >= 0 && y - radius <= VIEW.height
  );
}

/**
 * Pixi decides batchability per `GraphicsContext`, and in its default `'auto'`
 * mode the rule is one line of `GraphicsContextSystem`:
 *
 *     gpuContext.isBatchable = gpuContext.geometryData.vertices.length < 400
 *
 * A rock's silhouette, veins and cracks clear 400 comfortably, so every rock
 * falls out of the batcher and takes a draw call of its own. Forcing
 * `batchMode: 'batch'` puts the same triangles back in the batch buffer — same
 * geometry, same vertices, different submission path — which is the one option
 * on the table that cannot change a pixel by construction. Whether it is *fast*
 * is a different question (a forced batch re-uploads its vertices every frame
 * instead of drawing a static geometry), and that is what the scenario is for.
 */
function forceBatch(g: Graphics): Graphics {
  g.context.batchMode = 'batch';
  return g;
}

// --- A: one Graphics per rock, own context (what ships today) --------------

function rocksAsGraphics(world: World, cull = false, batch = false): Scenario {
  const layer = new Container();
  const gfx: Graphics[] = [];
  const keys: string[] = [];
  for (let i = 0; i < world.asteroids.length; i++) {
    const g = new Graphics();
    gfx.push(g);
    layer.addChild(g);
  }
  let visible = 0;
  return {
    name: batch ? 'rocks:graphics+batch' : cull ? 'rocks:graphics+cull' : 'rocks:graphics',
    layer,
    pooled: () => gfx.length, // one context each — that IS the finding
    drawn: () => visible,
    update(w, frame) {
      visible = 0;
      for (let i = 0; i < w.asteroids.length; i++) {
        const a = w.asteroids[i]!;
        const g = gfx[i]!;
        const p = rockPose(w, i, frame);
        if (cull && !onScreen(p.x, p.y, a.radius)) {
          g.visible = false;
          continue;
        }
        g.visible = true;
        visible++;
        const art = asteroidArt(a);
        if (keys[i] !== art.key) {
          g.clear();
          drawSprite(g, art.build(), ROCK_ART_SCALE);
          // `clear()` replaces the context, so the batch flag is re-applied on
          // every rebuild rather than once at construction.
          if (batch) forceBatch(g);
          keys[i] = art.key;
        }
        g.x = p.x;
        g.y = p.y;
        g.scale.set(a.radius / ROCK_ART_SCALE);
      }
    },
    destroy() {
      layer.destroy({ children: true });
    },
  };
}

/** The floor: an empty stage, rendered the same way for the same frames. Every
 *  scenario pays this (clear + present at 1280×800), so the *marginal* cost of a
 *  layer is its median minus this one, and quoting the raw medians alone would
 *  flatter whichever path is closest to the floor. */
function emptyScene(): Scenario {
  const layer = new Container();
  return {
    name: 'floor:empty',
    layer,
    pooled: () => 0,
    update() {},
    destroy() {
      layer.destroy({ children: true });
    },
  };
}

// --- B: one Sprite per rock, textures pooled through atlas.ts --------------

function rocksAsSprites(world: World, cache: SpriteTextureCache, cull = false): Scenario {
  const layer = new Container();
  const sprites: Sprite[] = [];
  // Unit space is [-extent, +extent] and the bake is ROCK_TEXTURE_PX across it,
  // so this many world units per texture pixel lands the rock at its collision
  // radius — the same arithmetic `drawAsteroids` does with ROCK_ART_SCALE.
  const extent = asteroidSprite({ seed: 0, crackStage: 0, richness: 1 }).extent;
  const unitsPerPixel = (2 * extent) / ROCK_TEXTURE_PX;
  for (let i = 0; i < world.asteroids.length; i++) {
    const s = new Sprite();
    s.anchor.set(0.5);
    sprites.push(s);
    layer.addChild(s);
  }
  let visible = 0;
  return {
    name: cull ? 'rocks:sprites+cull' : 'rocks:sprites',
    layer,
    pooled: () => cache.size,
    drawn: () => visible,
    update(w, frame) {
      visible = 0;
      for (let i = 0; i < w.asteroids.length; i++) {
        const a = w.asteroids[i]!;
        const s = sprites[i]!;
        const p = rockPose(w, i, frame);
        if (cull && !onScreen(p.x, p.y, a.radius)) {
          s.visible = false;
          continue;
        }
        s.visible = true;
        visible++;
        // A cache hit is one Map lookup and builds no geometry — the whole
        // point of the atlas keys. A miss bakes once, ever, for that look.
        const tex: Texture = asteroidTexture(cache, a, ROCK_TEXTURE_PX);
        if (s.texture !== tex) s.texture = tex;
        s.x = p.x;
        s.y = p.y;
        // The texture is ROCK_TEXTURE_PX across 2·extent units, so one texture
        // pixel is `unitsPerPixel` units; scaling by `radius · unitsPerPixel`
        // lands unit radius 1 on the rock's collision radius — the same landing
        // `drawAsteroids` makes with `a.radius / ROCK_ART_SCALE`.
        s.scale.set(a.radius * unitsPerPixel);
      }
    },
    destroy() {
      layer.destroy({ children: true });
    },
  };
}

// --- C: one Graphics per rock, GraphicsContext pooled by look key ----------

function rocksAsSharedContexts(world: World): Scenario {
  const layer = new Container();
  const gfx: Graphics[] = [];
  const contexts = new Map<string, GraphicsContext>();
  const keys: string[] = [];
  for (let i = 0; i < world.asteroids.length; i++) {
    const g = new Graphics();
    gfx.push(g);
    layer.addChild(g);
  }
  // `GraphicsContext` carries the same path/fill/stroke verbs `drawSprite`
  // speaks — a `Graphics` is a transform plus one of these. Pooling the context
  // by look key is what makes 200 rocks hold a couple of dozen geometries.
  const contextFor = (key: string, build: () => SpriteDef): GraphicsContext => {
    let ctx = contexts.get(key);
    if (!ctx) {
      ctx = new GraphicsContext();
      drawSprite(ctx as unknown as Graphics, build(), ROCK_ART_SCALE);
      contexts.set(key, ctx);
    }
    return ctx;
  };
  return {
    name: 'rocks:contexts',
    layer,
    pooled: () => contexts.size,
    update(w, frame) {
      for (let i = 0; i < w.asteroids.length; i++) {
        const a = w.asteroids[i]!;
        const g = gfx[i]!;
        const art = asteroidArt(a);
        if (keys[i] !== art.key) {
          g.context = contextFor(art.key, art.build);
          keys[i] = art.key;
        }
        const p = rockPose(w, i, frame);
        g.x = p.x;
        g.y = p.y;
        g.scale.set(a.radius / ROCK_ART_SCALE);
      }
    },
    destroy() {
      layer.destroy({ children: true });
      for (const c of contexts.values()) c.destroy();
    },
  };
}

// --- turrets: 32 of them, four telegraph states × 8 owners ------------------

function turretState(frame: number, i: number): TurretState {
  const phase = (frame + i * 7) % 180;
  return phase < 60 ? 'idle' : phase < 140 ? 'tracking' : 'firing';
}

function turretsAsGraphics(world: World): Scenario {
  const layer = new Container();
  const gfx: Graphics[] = [];
  const keys: string[] = [];
  const turrets = world.stations.flatMap((s) => s.turrets);
  for (let i = 0; i < turrets.length; i++) {
    const g = new Graphics();
    gfx.push(g);
    layer.addChild(g);
  }
  return {
    name: 'turrets:graphics',
    layer,
    pooled: () => gfx.length,
    update(_w, frame) {
      for (let i = 0; i < turrets.length; i++) {
        const t = turrets[i]!;
        const g = gfx[i]!;
        const state = turretState(frame, i);
        const key = `${t.owner}:0:${state}`;
        if (keys[i] !== key) {
          g.clear();
          drawSprite(g, turretSprite({ playerId: t.owner, state, tier: 0 }), TURRET_ART_SCALE);
          keys[i] = key;
        }
        g.x = t.pos.x;
        g.y = t.pos.y;
        g.rotation = frame * 0.01 + i;
        g.scale.set(t.radius / TURRET_ART_SCALE);
      }
    },
    destroy() {
      layer.destroy({ children: true });
    },
  };
}

function turretsAsSprites(world: World, cache: SpriteTextureCache): Scenario {
  const layer = new Container();
  const sprites: Sprite[] = [];
  const turrets = world.stations.flatMap((s) => s.turrets);
  const extent = turretSprite({ playerId: 0, state: 'idle', tier: 0 }).extent;
  for (let i = 0; i < turrets.length; i++) {
    const s = new Sprite();
    s.anchor.set(0.5);
    sprites.push(s);
    layer.addChild(s);
  }
  return {
    name: 'turrets:sprites',
    layer,
    pooled: () => cache.size,
    update(_w, frame) {
      for (let i = 0; i < turrets.length; i++) {
        const t = turrets[i]!;
        const s = sprites[i]!;
        const tex = turretTexture(cache, t.owner, turretState(frame, i), TURRET_TEXTURE_PX);
        if (s.texture !== tex) s.texture = tex;
        s.x = t.pos.x;
        s.y = t.pos.y;
        s.rotation = frame * 0.01 + i;
        s.scale.set((t.radius * 2 * extent) / TURRET_TEXTURE_PX);
      }
    },
    destroy() {
      layer.destroy({ children: true });
    },
  };
}

// --- shots: 300 of them, two families × four damage tiers -------------------

function shotLook(i: number): { family: ShotFamily; tier: number } {
  return { family: i % 2 === 0 ? 'own' : 'enemy', tier: i % 4 };
}

function shotsAsGraphics(world: World): Scenario {
  const layer = new Container();
  const gfx: Graphics[] = [];
  const keys: string[] = [];
  const shots = world.projectiles.filter((p) => p.active);
  for (let i = 0; i < shots.length; i++) {
    const g = new Graphics();
    gfx.push(g);
    layer.addChild(g);
  }
  return {
    name: 'shots:graphics',
    layer,
    pooled: () => gfx.length,
    update(_w, frame) {
      for (let i = 0; i < shots.length; i++) {
        const p = shots[i]!;
        const g = gfx[i]!;
        const { family, tier } = shotLook(i + frame);
        const key = `${family}:${tier}`;
        if (keys[i] !== key) {
          g.clear();
          drawSprite(g, shotSprite(family, tier), SHOT_ART_SCALE);
          keys[i] = key;
        }
        g.x = p.pos.x + Math.sin(frame * 0.05 + i) * 40;
        g.y = p.pos.y + Math.cos(frame * 0.05 + i) * 40;
        g.scale.set(p.radius / SHOT_ART_SCALE);
      }
    },
    destroy() {
      layer.destroy({ children: true });
    },
  };
}

function shotsAsSprites(world: World, cache: SpriteTextureCache): Scenario {
  const layer = new Container();
  const sprites: Sprite[] = [];
  const shots = world.projectiles.filter((p) => p.active);
  const extent = shotSprite('own', 0).extent;
  for (let i = 0; i < shots.length; i++) {
    const s = new Sprite();
    s.anchor.set(0.5);
    sprites.push(s);
    layer.addChild(s);
  }
  return {
    name: 'shots:sprites',
    layer,
    pooled: () => cache.size,
    update(_w, frame) {
      for (let i = 0; i < shots.length; i++) {
        const p = shots[i]!;
        const s = sprites[i]!;
        const { family, tier } = shotLook(i + frame);
        // `atlas.ts` has no shot entry — shots post-date it — so this is the
        // same cache used the same way, keyed the way atlas would key it.
        const tex = cache.getBy(`shot:${family}:${tier}:${SHOT_TEXTURE_PX}`, () => shotSprite(family, tier), SHOT_TEXTURE_PX);
        if (s.texture !== tex) s.texture = tex;
        s.x = p.pos.x + Math.sin(frame * 0.05 + i) * 40;
        s.y = p.pos.y + Math.cos(frame * 0.05 + i) * 40;
        s.scale.set((p.radius * 2 * extent) / SHOT_TEXTURE_PX);
      }
    },
    destroy() {
      layer.destroy({ children: true });
    },
  };
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

interface Result {
  readonly name: string;
  readonly entities: number;
  /** Entities left visible after culling; equal to `entities` when nothing culls. */
  readonly drawn: number;
  readonly pooled: number;
  readonly drawCallsPerFrame: number;
  readonly stats: Stats;
  readonly vfxWouldEngage: boolean;
}

/** Render `frames` frames of one scenario, timing `requestAnimationFrame`
 *  deltas — the same instrument `tests/perf/frame-time.spec.ts` uses, so the
 *  numbers here and the numbers in the gate are the same kind of number. */
async function measure(
  app: Application,
  stage: Container,
  scenario: Scenario,
  world: World,
  entities: number,
): Promise<Result> {
  stage.removeChildren();
  stage.addChild(scenario.layer);

  let frame = 0;
  // Warm-up: shader compiles, the first texture uploads, and every look key's
  // first build all land here rather than in the measurement.
  for (let i = 0; i < WARMUP; i++) {
    crackRocks(world, frame);
    scenario.update(world, frame++);
    app.renderer.render(stage);
    await nextFrame();
  }

  const deltas: number[] = [];
  const callsAtStart = drawCalls;
  let last = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    crackRocks(world, frame);
    scenario.update(world, frame++);
    app.renderer.render(stage);
    await nextFrame();
    const now = performance.now();
    deltas.push(now - last);
    last = now;
  }
  const calls = (drawCalls - callsAtStart) / FRAMES;

  return {
    name: scenario.name,
    entities,
    drawn: scenario.drawn?.() ?? entities,
    pooled: scenario.pooled(),
    drawCallsPerFrame: calls,
    stats: stats(deltas),
    vfxWouldEngage: vfxVerdict(deltas).engaged,
  };
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** The whole-frame baseline: the SHIPPED `Renderer`, drawing the SHIPPED scene.
 *  Not an A/B — it is the answer to "what does a busy frame cost today, and does
 *  `VfxAutoQuality` engage on it?", which the brief says outranks the A/B. */
async function measureShippedRenderer(app: Application, world: World, reduceVfx = false): Promise<Result> {
  const stage = new Container();
  app.stage.removeChildren();
  app.stage.addChild(stage);
  // The baker `main.ts` injects (a1-11). Without it the renderer draws the same
  // scene graph over blank textures — correct for a headless unit test, and a
  // measurement of nothing at all. `resolution: 1` is this rig's dpr.
  const renderer = new Renderer(
    stage,
    { width: VIEW.width, height: VIEW.height, originX: 0, originY: 0 },
    { baker: app.renderer, resolution: 1 },
  );
  // The auto-reducer's own switch, thrown by hand. Running the baseline both
  // ways answers the question the brief cares about more than the A/B: when
  // `VfxAutoQuality` engages, how much frame does it actually buy back?
  renderer.setReduceVfx(reduceVfx);
  const view: RenderView = { cameraTarget: 0, muzzles: [] };

  for (let i = 0; i < WARMUP; i++) {
    crackRocks(world, i);
    renderer.draw(world, view);
    app.renderer.render(app.stage);
    await nextFrame();
  }

  const deltas: number[] = [];
  const callsAtStart = drawCalls;
  let last = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    crackRocks(world, i);
    renderer.draw(world, view);
    app.renderer.render(app.stage);
    await nextFrame();
    const now = performance.now();
    deltas.push(now - last);
    last = now;
  }

  app.stage.removeChildren();
  stage.destroy({ children: true });
  return {
    name: reduceVfx ? 'shipped:whole-frame+reduceVfx' : 'shipped:whole-frame',
    entities: (() => {
      const n =
        world.asteroids.length +
        world.chunks.length +
        world.ships.length +
        world.stations.length +
        world.stations.reduce((acc, s) => acc + s.turrets.length, 0) +
        world.projectiles.filter((p) => p.active).length;
      return n;
    })(),
    drawn: 0,
    pooled: 0,
    drawCallsPerFrame: (drawCalls - callsAtStart) / FRAMES,
    stats: stats(deltas),
    vfxWouldEngage: vfxVerdict(deltas).engaged,
  };
}

async function main(): Promise<void> {
  installDrawCallCounter();
  const out = document.getElementById('out')!;
  const log = (line: string): void => {
    out.textContent = `${out.textContent}\n${line}`;
  };

  const app = new Application();
  await app.init({
    width: VIEW.width,
    height: VIEW.height,
    background: 0x0d1015,
    antialias: true,
    preference: 'webgl',
    autoStart: false,
    autoDensity: false,
    resolution: 1,
  });
  document.body.appendChild(app.canvas);

  const world = stressWorld();
  const stage = new Container();

  // The baselines first, on their own worlds, before any A/B scene exists.
  const baseline = await measureShippedRenderer(app, stressWorld(), false);
  const baselineReduced = await measureShippedRenderer(app, stressWorld(), true);

  app.stage.removeChildren();
  app.stage.addChild(stage);

  const shots = world.projectiles.filter((p) => p.active).length;
  const turrets = world.stations.reduce((n, s) => n + s.turrets.length, 0);

  // One cache per *path*, not per scenario — a shared cache would let a later
  // scenario ride on an earlier one's bakes and read as free.
  const build = (): Scenario[] => [
    emptyScene(),
    rocksAsGraphics(world),
    rocksAsSprites(world, new SpriteTextureCache(app.renderer as never, 1)),
    rocksAsSharedContexts(world),
    // The same two paths with off-screen rocks skipped. Culling is orthogonal to
    // pooling and changes no pixel, so it is the control that says how much of
    // the pooling win is really a "we draw the whole arena every frame" win.
    rocksAsGraphics(world, true),
    rocksAsSprites(world, new SpriteTextureCache(app.renderer as never, 1), true),
    // Same vectors, forced into the batcher. The only candidate on the table
    // that cannot move a pixel, so it is worth a column whatever it costs.
    rocksAsGraphics(world, false, true),
    turretsAsGraphics(world),
    turretsAsSprites(world, new SpriteTextureCache(app.renderer as never, 1)),
    shotsAsGraphics(world),
    shotsAsSprites(world, new SpriteTextureCache(app.renderer as never, 1)),
  ];

  const rounds: Result[][] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const scenarios = build();
    const results: Result[] = [];
    for (const s of scenarios) {
      const entities = s.name.startsWith('floor')
        ? 0
        : s.name.startsWith('rocks')
          ? world.asteroids.length
          : s.name.startsWith('turrets')
            ? turrets
            : shots;
      results.push(await measure(app, stage, s, world, entities));
      s.destroy();
    }
    rounds.push(results);
    log(`round ${round + 1}/${ROUNDS} done`);
  }

  // Round 1 is a warm-up for the *machine*, not for a scenario: discard it.
  const kept = rounds.slice(1);
  const merged: Result[] = kept[0]!.map((_, i) => {
    const all = kept.map((r) => r[i]!);
    const medians = all.map((r) => r.stats.median).sort((a, b) => a - b);
    const best = all.reduce((a, b) => (a.stats.median <= b.stats.median ? a : b));
    return {
      ...best,
      // Report the MEDIAN of the per-round medians: a mean would let one
      // scheduler hiccup in one round decide the comparison.
      stats: { ...best.stats, median: medians[Math.floor(medians.length / 2)]! },
    };
  });

  const payload = {
    gpu: gpuString(),
    userAgent: navigator.userAgent,
    view: VIEW,
    scene: STRESS_SCENE,
    frames: FRAMES,
    rounds: ROUNDS,
    baseline,
    baselineReduced,
    results: merged,
    allRounds: rounds,
  };
  (window as unknown as { __atlasBench?: unknown }).__atlasBench = payload;
  log(JSON.stringify(payload, null, 2));
}

void main().catch((err: unknown) => {
  (window as unknown as { __atlasBench?: unknown }).__atlasBench = { error: String(err) };
  const out = document.getElementById('out');
  if (out) out.textContent = `FAILED: ${String(err)}\n${(err as Error)?.stack ?? ''}`;
});
