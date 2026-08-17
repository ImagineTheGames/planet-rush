/**
 * evidence/a0-75-fill-rate/cache-diff.ts — does the baked sky look like the sky?
 * OWNER: Art Agent (a0-75).
 *
 * The a0-75 fill fix bakes the sky into a texture at a third of linear
 * resolution (`src/art/backdrop.ts` `skyCacheResolution`). The argument for
 * why that is invisible is arithmetic on the falloff curve, and arithmetic is
 * not a frame. This page renders **the same sky twice** into the same canvas —
 * once through the raw geometry, once through the cache — reads both back, and
 * reports the difference per channel and in ΔE, plus a banding measure across a
 * clot's own gradient, which is the one thing a downsample could plausibly hurt
 * (`./textures` `rampPixels` puts dither in the ramp precisely to prevent it).
 *
 * Every sky, at the viewports that matter. `./cache-diff.mjs` drives it and
 * writes the crops out as PNGs so the frames can be looked at with eyes, which
 * is the part no number replaces.
 */
import { Application, Container, Graphics } from 'pixi.js';
import {
  NEBULAE,
  NEBULA_IDS,
  VOID_SEED,
  coverSpan,
  groundSprite,
  nebulaSprite,
  skyCacheResolution,
  type NebulaId,
} from '../../src/art/backdrop';
import { drawSprite } from '../../src/art/textures';

const WIDE = { width: 3200, height: 2000 };

export interface SkyDiff {
  readonly sky: NebulaId;
  readonly width: number;
  readonly height: number;
  readonly fitsCache: boolean;
  /** Largest absolute per-channel difference, 0..255. */
  readonly maxChannel: number;
  /** Mean absolute per-channel difference, 0..255. */
  readonly meanChannel: number;
  /** Largest CIE76 ΔE between the two frames at any pixel. */
  readonly maxDeltaE: number;
  readonly meanDeltaE: number;
  /** Share of pixels that differ at all. */
  readonly changedFraction: number;
  /**
   * Banding: the largest single-step jump in luma along a horizontal scan
   * through the frame's middle, in code values. A downsample that averaged the
   * ramp's dither away would show as this rising.
   */
  readonly maxStepDirect: number;
  readonly maxStepCached: number;
  /** Peak luma of each frame — the a0-40 ladder, measured both ways. */
  readonly peakDirect: number;
  readonly peakCached: number;
  /** Both frames, as data URLs, so the runner can write them out to look at. */
  readonly pngDirect: string;
  readonly pngCached: string;
}

declare global {
  interface Window {
    __a075diff?: { gpu: string; diffs: SkyDiff[] };
    __a075diffError?: string;
  }
}

/** Build the ground + one sky, cached or not, at a given viewport. */
function stage(id: NebulaId, w: number, h: number, cached: boolean): Container {
  const root = new Container();
  const ground = new Graphics();
  drawSprite(ground, groundSprite(w + 2, h + 2), 1);
  ground.position.set(w / 2, h / 2);
  root.addChild(ground);
  if (id === 'none') return root;

  const spec = NEBULAE[id];
  const nw = coverSpan(spec.parallax, w, WIDE.width);
  const nh = coverSpan(spec.parallax, h, WIDE.height);
  const g = new Graphics();
  drawSprite(g, nebulaSprite(id, VOID_SEED, nw, nh, 1, w, h), 1);
  if (spec.additive) g.blendMode = 'add';
  const holder = new Container();
  holder.addChild(g);
  // The SAME offset both ways — a diff between two different camera positions
  // would be a diff about nothing.
  holder.position.set(w / 2, h / 2);
  const resolution = skyCacheResolution(nw, nh);
  if (cached && resolution !== null) {
    if (spec.additive) holder.blendMode = 'add';
    holder.cacheAsTexture({ resolution, antialias: false });
  } else if (spec.additive) {
    holder.blendMode = 'add';
  }
  root.addChild(holder);
  return root;
}

function lumaOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function lin(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB → CIELAB (D65). Same transform `backdrop.test.ts` uses. */
function lab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The largest single-pixel luma step along the middle scanline — the banding
 *  read. A contour reads as a step; dither reads as noise well under one code. */
function maxStep(px: Uint8Array, w: number, h: number): number {
  const y = Math.floor(h / 2);
  let worst = 0;
  for (let x = 1; x < w; x++) {
    const i = (y * w + x) * 4;
    const j = (y * w + x - 1) * 4;
    const d = Math.abs(lumaOf(px[i]!, px[i + 1]!, px[i + 2]!) - lumaOf(px[j]!, px[j + 1]!, px[j + 2]!));
    if (d > worst) worst = d;
  }
  return worst;
}

async function readBack(app: Application, w: number, h: number): Promise<Uint8Array> {
  const gl = (app.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const width = Number(params.get('w') ?? 1280);
  const height = Number(params.get('h') ?? 720);
  const out = document.getElementById('out') as HTMLPreElement;

  const app = new Application();
  await app.init({ background: 0x0d1015, width, height, antialias: true, resolution: 1, autoDensity: false });
  app.ticker.stop();
  document.body.appendChild(app.canvas);

  const diffs: SkyDiff[] = [];
  for (const id of NEBULA_IDS) {
    if (id === 'none') continue;
    const spec = NEBULAE[id];
    const nw = coverSpan(spec.parallax, width, WIDE.width);
    const nh = coverSpan(spec.parallax, height, WIDE.height);

    const direct = stage(id, width, height, false);
    app.stage.addChild(direct);
    app.render();
    const a = await readBack(app, width, height);
    const pngDirect = app.canvas.toDataURL('image/png');
    app.stage.removeChild(direct);
    direct.destroy({ children: true });

    const cached = stage(id, width, height, true);
    app.stage.addChild(cached);
    app.render();
    const b = await readBack(app, width, height);
    const pngCached = app.canvas.toDataURL('image/png');
    app.stage.removeChild(cached);
    if (cached.isCachedAsTexture) cached.cacheAsTexture(false);
    cached.destroy({ children: true });

    let maxChannel = 0;
    let sumChannel = 0;
    let maxDeltaE = 0;
    let sumDeltaE = 0;
    let changed = 0;
    let peakDirect = 0;
    let peakCached = 0;
    const n = width * height;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const dr = Math.abs(a[o]! - b[o]!);
      const dg = Math.abs(a[o + 1]! - b[o + 1]!);
      const db = Math.abs(a[o + 2]! - b[o + 2]!);
      const m = Math.max(dr, dg, db);
      if (m > maxChannel) maxChannel = m;
      sumChannel += (dr + dg + db) / 3;
      if (m > 0) {
        changed++;
        const la = lab(a[o]!, a[o + 1]!, a[o + 2]!);
        const lb = lab(b[o]!, b[o + 1]!, b[o + 2]!);
        const dE = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
        if (dE > maxDeltaE) maxDeltaE = dE;
        sumDeltaE += dE;
      }
      const ya = lumaOf(a[o]!, a[o + 1]!, a[o + 2]!);
      const yb = lumaOf(b[o]!, b[o + 1]!, b[o + 2]!);
      if (ya > peakDirect) peakDirect = ya;
      if (yb > peakCached) peakCached = yb;
    }

    diffs.push({
      sky: id,
      width,
      height,
      fitsCache: skyCacheResolution(nw, nh) !== null,
      maxChannel,
      meanChannel: sumChannel / n,
      maxDeltaE,
      meanDeltaE: changed > 0 ? sumDeltaE / changed : 0,
      changedFraction: changed / n,
      maxStepDirect: maxStep(a, width, height),
      maxStepCached: maxStep(b, width, height),
      peakDirect,
      peakCached,
      pngDirect,
      pngCached,
    });
    out.textContent = diffs
      .map(
        (d) =>
          `${d.sky.padEnd(13)} maxΔ ${String(d.maxChannel).padStart(3)}  meanΔ ${d.meanChannel.toFixed(3)}  ` +
          `maxΔE ${d.maxDeltaE.toFixed(2)}  changed ${(d.changedFraction * 100).toFixed(1)}%  ` +
          `step ${d.maxStepDirect.toFixed(2)}→${d.maxStepCached.toFixed(2)}  ` +
          `peak ${d.peakDirect.toFixed(1)}→${d.peakCached.toFixed(1)}`,
      )
      .join('\n');
  }

  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  window.__a075diff = {
    gpu: ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown',
    diffs,
  };
  out.textContent += '\n\nDONE';
}

run().catch((e) => {
  window.__a075diffError = String(e?.stack ?? e);
  const out = document.getElementById('out');
  if (out) out.textContent = String(e?.stack ?? e);
});
