/**
 * tests/perf/draw-budget.rig.ts — the in-page half of the CI performance gate.
 * OWNER: Platform Engineer (a1-16).
 *
 * Renders the GDD §4.3 stress scene through the **shipped** `Renderer` on each
 * screen in `./budget.ts`, and reports the two columns that travel off this box:
 * draw calls per frame and entities submitted per frame. It asserts nothing —
 * `./draw-budget.spec.ts` owns the thresholds, because a gate whose limits live
 * in the page under test is a page that can be made to pass by editing itself.
 *
 * It is a shrunk, gate-shaped sibling of `spikes/atlas-pooling/bench.ts`, and
 * that ancestry is deliberate: the baselines in `./budget.ts` were measured on
 * that rig, so this one draws the same scene through the same shipped renderer
 * at the same two viewports, and only drops what a gate does not need — the A/B
 * scenarios, the interleaved rounds, and every millisecond. **No frame time is
 * reported here at all.** A CI runner has no GPU, so a millisecond it produced
 * would be a number about SwiftShader wearing the costume of a claim about a
 * phone, and the surest way to never emit one is to never measure it.
 *
 * Served by the Vite **dev** server (see `./playwright.draw-budget.config.ts`);
 * `vite build` takes `index.html` alone, so nothing here reaches the bundle.
 */
import { Application, Container } from 'pixi.js';
import { stressWorld } from '../../harness/perf';
import type { World } from '../../src/sim';
import { Renderer, type RenderView } from '../../src/render';
import { PROFILE_BUDGETS, WARMUP_FRAMES, COUNTED_FRAMES } from './budget';

/** What the rig hands back, per profile. Read by the spec through
 *  `window.__drawBudget`. */
export interface ProfileReading {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Entities in the whole arena, on screen or not — the denominator. */
  readonly entities: number;
  /** Display objects the renderer left visible in the entity layers on the last
   *  counted frame: what it actually handed the GPU for this screen. */
  readonly submitted: number;
  /** `WebGL2RenderingContext.prototype.draw*` calls, averaged over the counted
   *  frames. */
  readonly drawCallsPerFrame: number;
}

export interface RigPayload {
  /** The box, so a reading is never quoted without it. */
  readonly gpu: string;
  readonly userAgent: string;
  readonly warmupFrames: number;
  readonly countedFrames: number;
  readonly profiles: readonly ProfileReading[];
}

/** The entity layers the cull acts on. The same list as
 *  `src/render/draw-cost.test.ts` and `spikes/atlas-pooling/bench.ts`,
 *  deliberately: the headless test, the spike and this gate must all be counting
 *  the same thing or their numbers cannot be put in one table. The backdrop and
 *  the boundary are a fixed handful and are excluded, so the number is about
 *  entities rather than chrome. */
const ENTITY_LAYERS = ['asteroids', 'chunks', 'ships', 'turrets', 'shots'] as const;

// ---------------------------------------------------------------------------
// The draw-call counter — patched before any context exists
// ---------------------------------------------------------------------------

let drawCalls = 0;

/**
 * Count every draw the page issues, by patching the prototype rather than a
 * context instance. It has to happen before `Application.init` creates one, and
 * patching the prototype means it catches whatever context Pixi ends up with,
 * including one it makes for a texture bake.
 */
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
// The scene
// ---------------------------------------------------------------------------

/**
 * Walk one rock per frame down a crack band, exactly as the bench rig does.
 *
 * It is here for comparability first — the 10.9 / 9.0 baselines in `./budget.ts`
 * were measured with this churn running, and a gate measured on a frozen scene
 * would not be quoting the same number. It also earns its place: with the look
 * keys never moving, the renderer's "rebuild only when the key changed" guard
 * never fires, and the gate would be blind to a regression that rebuilds
 * geometry every frame.
 */
function crackRocks(world: World, frame: number): void {
  const a = world.asteroids[frame % world.asteroids.length]!;
  const next = a.ore - a.maxOre / 6;
  a.ore = next > 0 ? next : a.maxOre;
  const frac = a.ore / a.maxOre;
  a.crackStage = frac > 2 / 3 ? 0 : frac > 1 / 3 ? 1 : 2;
}

function submittedEntities(stage: Container): number {
  let n = 0;
  for (const label of ENTITY_LAYERS) {
    const layer = stage.getChildByLabel(label, true) as Container | null;
    if (!layer) throw new Error(`render layer '${label}' is missing from the stage`);
    for (const child of layer.children) if (child.visible) n++;
  }
  return n;
}

function entityCount(world: World): number {
  return (
    world.asteroids.length +
    world.chunks.length +
    world.ships.filter((s) => s.alive).length +
    world.stations.reduce((n, s) => n + s.turrets.filter((t) => t.hp > 0).length, 0) +
    world.projectiles.filter((p) => p.active).length
  );
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/**
 * One profile: resize the render target to the screen, draw the §4.3 scene
 * through the shipped renderer, and count.
 *
 * The canvas is resized as well as the camera viewport. Quoting an 844×390
 * viewport over a 1280×800 render target would charge the phone for pixels it
 * does not have — it would not change the draw-call count, but it would change
 * what "submitted" means, and a gate should not be measuring a screen that does
 * not exist.
 */
async function readProfile(
  app: Application,
  profile: (typeof PROFILE_BUDGETS)[number],
): Promise<ProfileReading> {
  const world = stressWorld();
  const stage = new Container();
  app.stage.removeChildren();
  app.stage.addChild(stage);
  app.renderer.resize(profile.width, profile.height);

  // The baker `main.ts` injects (a1-11). Without one the renderer draws the same
  // scene graph over blank textures of the right size — correct for a headless
  // unit test, and a measurement of nothing at all in a browser.
  const renderer = new Renderer(
    stage,
    { width: profile.width, height: profile.height, originX: 0, originY: 0 },
    { baker: app.renderer, resolution: 1 },
  );
  // Explicitly OFF. `VfxAutoQuality` is r9-01's, it engages on sustained low
  // frame rates, and on a GPU-less runner it would engage — which would mean the
  // gate measured the degraded renderer on CI and the full one on a laptop, and
  // silently reported the reduced number as the budget.
  renderer.setReduceVfx(false);
  const view: RenderView = { cameraTarget: 0, muzzles: [] };

  for (let i = 0; i < WARMUP_FRAMES; i++) {
    crackRocks(world, i);
    renderer.draw(world, view);
    app.renderer.render(app.stage);
    await nextFrame();
  }

  const callsAtStart = drawCalls;
  for (let i = 0; i < COUNTED_FRAMES; i++) {
    crackRocks(world, i);
    renderer.draw(world, view);
    app.renderer.render(app.stage);
    await nextFrame();
  }
  const drawCallsPerFrame = (drawCalls - callsAtStart) / COUNTED_FRAMES;

  // Counted BEFORE teardown, off the last frame drawn.
  const submitted = submittedEntities(stage);

  app.stage.removeChildren();
  stage.destroy({ children: true });

  return {
    name: profile.name,
    width: profile.width,
    height: profile.height,
    entities: entityCount(world),
    submitted,
    drawCallsPerFrame,
  };
}

async function main(): Promise<void> {
  installDrawCallCounter();
  const out = document.getElementById('out');

  const app = new Application();
  await app.init({
    width: PROFILE_BUDGETS[0]!.width,
    height: PROFILE_BUDGETS[0]!.height,
    background: 0x0d1015,
    antialias: true,
    preference: 'webgl',
    autoStart: false,
    autoDensity: false,
    resolution: 1,
  });
  document.body.appendChild(app.canvas);

  const profiles: ProfileReading[] = [];
  for (const profile of PROFILE_BUDGETS) profiles.push(await readProfile(app, profile));

  const payload: RigPayload = {
    gpu: gpuString(),
    userAgent: navigator.userAgent,
    warmupFrames: WARMUP_FRAMES,
    countedFrames: COUNTED_FRAMES,
    profiles,
  };
  (window as unknown as { __drawBudget?: unknown }).__drawBudget = payload;
  if (out) out.textContent = JSON.stringify(payload, null, 2);
}

void main().catch((err: unknown) => {
  // The spec fails on `error` rather than timing out on a payload that never
  // arrives, so a broken rig reads as a broken rig and not as a hung gate.
  (window as unknown as { __drawBudget?: unknown }).__drawBudget = { error: String(err) };
  const out = document.getElementById('out');
  if (out) out.textContent = `FAILED: ${String(err)}\n${(err as Error)?.stack ?? ''}`;
});
