/**
 * evidence/a0-75-fill-rate/fill-rig.ts — the void, layer by layer, against area.
 * OWNER: Art Agent (a0-75).
 *
 * `./sweep.mjs` measures the shipped bundle and answers *"does frame time track
 * pixels"*. It cannot answer *"which layer"*, because the shipped bundle draws
 * them all at once. This rig takes the backdrop apart: it builds the real
 * {@link VoidBackdrop} out of `src/art/backdrop.ts` at a given viewport, then
 * renders it repeatedly with individual layers hidden, so each layer's cost is a
 * subtraction rather than an argument.
 *
 * Every scenario moves its layers each frame exactly the way {@link
 * VoidBackdrop.update} does, so nothing is measured standing still — a static
 * scene lets a driver skip work a scrolling one has to do.
 *
 * Served by the Vite **dev** server only (`vite build` takes `index.html`
 * alone), so this never reaches the bundle. `./attribute.mjs` drives it.
 */
import { Application, Container, Graphics } from 'pixi.js';
import {
  NEBULAE,
  STAR_LAYERS,
  VOID_SEED,
  VoidBackdrop,
  coverSpan,
  groundSprite,
  nebulaSprite,
  skyCacheResolution,
  starFieldSprite,
  type NebulaId,
} from '../../src/art/backdrop';
import { drawSprite } from '../../src/art/textures';
import type { SpriteDef } from '../../src/art/shapes';

/** The wide arena (`src/sim/maps.ts` `WIDE`) — oval/diamond, the boards the two
 *  most expensive skies fly over. Copied rather than imported: art does not
 *  depend on the sim, and `backdrop.test.ts` already refuses to let the two
 *  drift. */
const WIDE = { width: 3200, height: 2000 };

export interface Reading {
  readonly scenario: string;
  readonly width: number;
  readonly height: number;
  readonly antialias: boolean;
  /** Stage scale the reading was taken at. 1 unless `?scales=` says otherwise —
   *  see {@link measure} for why the ½ probe is confounded. */
  readonly scale: number;
  /** Drawing commands baked into this stage's `Graphics` — the geometry half of
   *  the frame, the number that pairs with `./overdraw.ts`'s fragment count. */
  readonly shapes: number;
  readonly frames: number;
  readonly median: number;
  readonly p95: number;
  readonly mean: number;
}

export interface RigPayload {
  readonly gpu: string;
  readonly readings: readonly Reading[];
}

declare global {
  interface Window {
    __a075?: RigPayload;
    __a075Error?: string;
  }
}

function gpuString(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no webgl2';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no debug_renderer_info';
}

/** A layer the rig can move: geometry plus the parallax factor it rides at. */
interface RigLayer {
  readonly gfx: Graphics;
  readonly parallax: number;
}

/** Strip the bloom off a star field: everything a bloomed star draws BESIDES its
 *  own point — the soft halo disc and the diffraction cross. That is the
 *  a0-44/a0-45 population, and the only way to price it is to build the field
 *  without it. */
function withoutBloom(def: SpriteDef): SpriteDef {
  return {
    ...def,
    name: `${def.name}/no-bloom`,
    shapes: def.shapes.filter((s) => {
      if (s.path.kind === 'poly' && !s.path.closed) return false; // the spikes
      if (s.fill?.falloff) return false; // the halo disc
      return true;
    }),
  };
}

/** Only the bloom — the complement of {@link withoutBloom}, so the two sum. */
function bloomOnly(def: SpriteDef): SpriteDef {
  return {
    ...def,
    name: `${def.name}/bloom-only`,
    shapes: def.shapes.filter((s) => {
      if (s.path.kind === 'poly' && !s.path.closed) return true;
      return Boolean(s.fill?.falloff);
    }),
  };
}

type Build = (view: Container, w: number, h: number) => RigLayer[];

/**
 * Every drawing instruction baked into a subtree's `Graphics`. Read off the live
 * `GraphicsContext` rather than counted at build, so it is what the renderer
 * actually holds — `backdrop-bloom.test.ts` reads the same list for the same
 * reason.
 */
function countShapes(root: Container): number {
  let n = 0;
  const walk = (c: Container): void => {
    const ctx = (c as unknown as { context?: { instructions?: unknown[] } }).context;
    if (ctx?.instructions) n += ctx.instructions.length;
    for (const child of c.children) walk(child as Container);
  };
  walk(root);
  return n;
}

function layerFrom(def: SpriteDef, parallax: number, label: string, view: Container): RigLayer {
  const g = new Graphics();
  g.label = label;
  drawSprite(g, def, 1);
  view.addChild(g);
  return { gfx: g, parallax };
}

function ground(view: Container, w: number, h: number): RigLayer[] {
  return [layerFrom(groundSprite(w + 2, h + 2), 0, 'ground', view)];
}

function stars(view: Container, w: number, h: number, map: (d: SpriteDef) => SpriteDef = (d) => d): RigLayer[] {
  return STAR_LAYERS.map((spec) =>
    layerFrom(
      map(
        starFieldSprite(
          spec,
          VOID_SEED,
          coverSpan(spec.parallax, w, WIDE.width),
          coverSpan(spec.parallax, h, WIDE.height),
        ),
      ),
      spec.parallax,
      `stars-${spec.key}`,
      view,
    ),
  );
}

/**
 * One sky, either way. `cached: false` is the pre-a0-75 draw path — raw geometry
 * straight onto the frame buffer — and `cached: true` is the shipped one. Both
 * are built from the same `SpriteDef`, so the A/B in this rig is the fix and
 * nothing else, measured under one load in one run.
 */
function sky(id: NebulaId, view: Container, w: number, h: number, cached: boolean): RigLayer[] {
  const spec = NEBULAE[id];
  const nw = coverSpan(spec.parallax, w, WIDE.width);
  const nh = coverSpan(spec.parallax, h, WIDE.height);
  const g = new Graphics();
  drawSprite(g, nebulaSprite(id, VOID_SEED, nw, nh, 1, w, h), 1);
  if (spec.additive) g.blendMode = 'add';
  const holder = new Container();
  holder.label = `sky-${id}${cached ? '-cached' : ''}`;
  holder.addChild(g);
  const resolution = skyCacheResolution(nw, nh);
  if (cached && resolution !== null) {
    if (spec.additive) holder.blendMode = 'add';
    holder.cacheAsTexture({ resolution, antialias: false });
  } else if (spec.additive) {
    holder.blendMode = 'add';
  }
  view.addChild(holder);
  return [{ gfx: holder, parallax: spec.parallax }];
}

/**
 * The scenarios, in the order the audit reports them. Each is a *whole stage*,
 * so a reading is a frame time and not a fragment of one, and the differences
 * between them are what attribute the cost.
 */
export const SCENARIOS: readonly { name: string; build: Build }[] = [
  // The floor of the instrument: clear + present, nothing drawn. Every number
  // below is only meaningful above this one.
  { name: 'clear', build: () => [] },
  { name: 'ground', build: (v, w, h) => ground(v, w, h) },
  { name: 'ground+stars', build: (v, w, h) => [...ground(v, w, h), ...stars(v, w, h)] },
  {
    name: 'ground+stars-nobloom',
    build: (v, w, h) => [...ground(v, w, h), ...stars(v, w, h, withoutBloom)],
  },
  { name: 'bloom-only', build: (v, w, h) => stars(v, w, h, bloomOnly) },
  // The A/B. `-raw` is the pre-a0-75 sky, `-baked` is the shipped one, and the
  // pair is measured back to back in the same page under the same load.
  { name: 'ground+reef-raw', build: (v, w, h) => [...ground(v, w, h), ...sky('plasmaReef', v, w, h, false)] },
  { name: 'ground+reef-baked', build: (v, w, h) => [...ground(v, w, h), ...sky('plasmaReef', v, w, h, true)] },
  { name: 'ground+patina-raw', build: (v, w, h) => [...ground(v, w, h), ...sky('patinaDrift', v, w, h, false)] },
  { name: 'ground+patina-baked', build: (v, w, h) => [...ground(v, w, h), ...sky('patinaDrift', v, w, h, true)] },
  {
    name: 'full-reef-raw',
    build: (v, w, h) => [...ground(v, w, h), ...sky('plasmaReef', v, w, h, false), ...stars(v, w, h)],
  },
  {
    name: 'full-reef-baked',
    build: (v, w, h) => [...ground(v, w, h), ...sky('plasmaReef', v, w, h, true), ...stars(v, w, h)],
  },
  {
    name: 'full-patina-raw',
    build: (v, w, h) => [...ground(v, w, h), ...sky('patinaDrift', v, w, h, false), ...stars(v, w, h)],
  },
  {
    name: 'full-patina-baked',
    build: (v, w, h) => [...ground(v, w, h), ...sky('patinaDrift', v, w, h, true), ...stars(v, w, h)],
  },
  // The default map's sky is NONE, so this is what most boots actually pay.
  { name: 'full-none', build: (v, w, h) => [...ground(v, w, h), ...stars(v, w, h)] },
];

/**
 * Sample `frames` real frames of a built stage, moving it every frame.
 *
 * **The clock is closed with a `readPixels`, not with `requestAnimationFrame`.**
 * rAF in a headless browser is vsync-locked, so every delta lands on a multiple
 * of 16.7 ms and a 3 ms layer and a 15 ms layer measure the same. A one-pixel
 * read after `render()` forces the GL pipeline to drain, so the interval this
 * times is the work the frame actually did, at sub-millisecond resolution.
 *
 * `scale` shrinks the whole stage about the viewport centre.
 *
 * **It was meant to be the fill/geometry probe and it is not one — recorded here
 * so the next brief does not re-derive it.** The idea was that the triangle
 * count is identical at any scale and only the fragments change, so scale 1 vs.
 * scale ½ isolates fill. It is confounded by clipping: a backdrop field is
 * 2–5 screens across, so most of its geometry is *off* the viewport and never
 * rasterised, and halving the stage pulls four times as much of it back on.
 * Measured, the star scenarios come out **slower** at ½ than at 1 (127→157 ms at
 * 1280×720), which is the confound reading its own signature.
 *
 * The decomposition that does work is **subtraction between scenarios**, whose
 * fill is known exactly from `./overdraw.ts`: adding the reef to the ground adds
 * 2.87 Mfrag and 50 shapes, adding the stars adds 0.30 Mfrag and ~54,000, and
 * two equations in two unknowns fall out. `--scales 1` is the default because of
 * that; pass `scales=1,0.5` to reproduce the confound.
 */
async function measure(
  app: Application,
  view: Container,
  layers: RigLayer[],
  w: number,
  h: number,
  frames: number,
  settle: number,
  scale: number,
) {
  const gl = (app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl ?? null;
  const drain = new Uint8Array(4);
  view.scale.set(scale);
  view.position.set((w * (1 - scale)) / 2, (h * (1 - scale)) / 2);
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < frames + settle; i++) {
    t += 1 / 60;
    const offX = Math.sin(t * 0.7) * 900;
    const offY = Math.cos(t * 0.5) * 500;
    for (const l of layers) l.gfx.position.set(w / 2 + offX * l.parallax, h / 2 + offY * l.parallax);
    const t0 = performance.now();
    app.render();
    // Drain the pipeline: without this the driver is free to still be drawing
    // the frame we just stopped timing.
    if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, drain);
    const t1 = performance.now();
    if (i >= settle) times.push(t1 - t0);
    // Yield so the page stays responsive and the runner can see progress.
    if ((i & 7) === 7) await new Promise((r) => setTimeout(r, 0));
  }
  const sorted = [...times].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  return {
    frames: sorted.length,
    median: at(0.5),
    p95: at(0.95),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const width = Number(params.get('w') ?? 1280);
  const height = Number(params.get('h') ?? 720);
  const frames = Number(params.get('frames') ?? 60);
  const settle = Number(params.get('settle') ?? 20);
  const antialias = params.get('aa') !== '0';
  const only = params.get('only');
  const scales = (params.get('scales') ?? '1').split(',').map(Number);

  const out = document.getElementById('out') as HTMLPreElement;
  const readings: Reading[] = [];

  const app = new Application();
  await app.init({
    background: 0x0d1015,
    width,
    height,
    antialias,
    resolution: 1,
    autoDensity: false,
  });
  app.ticker.stop(); // the rig owns the clock
  document.body.appendChild(app.canvas);

  const show = (): void => {
    out.textContent = readings
      .map((x) => `${x.scenario.padEnd(22)} @${x.scale} ${x.median.toFixed(2).padStart(8)} ms`)
      .join('\n');
  };

  for (const scenario of SCENARIOS) {
    if (only && !only.split(',').includes(scenario.name)) continue;
    const view = new Container();
    app.stage.addChild(view);
    const layers = scenario.build(view, width, height);
    for (const scale of scales) {
      const r = await measure(app, view, layers, width, height, frames, settle, scale);
      readings.push({ scenario: scenario.name, width, height, antialias, scale, shapes: countShapes(view), ...r });
      show();
    }
    app.stage.removeChild(view);
    view.destroy({ children: true });
  }

  // The shipped composition, through the shipped class, as a cross-check that
  // the hand-built stages above are the same stage the game draws.
  if (!only) {
    const b = new VoidBackdrop();
    b.setMap('oval');
    b.configure(WIDE.width, WIDE.height, width, height);
    const holder = new Container();
    holder.addChild(b.view);
    app.stage.addChild(holder);
    const layers = b.view.children.map((c, i) => ({ gfx: c as Graphics, parallax: i === 0 ? 0 : 0.2 }));
    for (const scale of scales) {
      const r = await measure(app, holder, layers, width, height, frames, settle, scale);
      readings.push({ scenario: 'VoidBackdrop(oval)', width, height, antialias, scale, shapes: countShapes(holder), ...r });
      show();
    }
  }

  window.__a075 = { gpu: gpuString(), readings };
  out.textContent = `${readings.map((x) => `${x.scenario.padEnd(22)} ${x.median.toFixed(2).padStart(8)} ms`).join('\n')}\n\nDONE`;
}

run().catch((e) => {
  window.__a075Error = String(e?.stack ?? e);
  const out = document.getElementById('out');
  if (out) out.textContent = String(e?.stack ?? e);
});
