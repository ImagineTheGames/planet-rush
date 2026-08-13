/**
 * src/art/textures.ts — sprites → pooled GPU textures. OWNER: Art & Audio Agent.
 *
 * The performance discipline this file exists to keep is named in GDD §4.3
 * (risk 5) and in the render layer's own header: *"sprites are batched and
 * pooled from M1"*, and the frame loop makes **zero per-frame allocations**.
 * Procedural art could easily break that — a `Graphics` per rock rebuilt every
 * frame is exactly the retrofit the risk register warns about. So generated art
 * enters the renderer the only way it is allowed to:
 *
 *  1. A generator returns a {@link SpriteDef} — plain data, no GPU (./shapes).
 *  2. {@link drawSprite} plays that data into a `Graphics` **once**.
 *  3. {@link SpriteTextureCache} bakes it to a `Texture` **once per key**, and
 *     every entity that needs that look gets a `Sprite` sharing that texture.
 *
 * Per frame, the renderer then touches only `position`, `rotation`, `scale` and
 * `alpha` — never geometry. Eight ships and ~200 asteroids cost a handful of
 * textures between them, because a rock's look is keyed by (seed, stage) and a
 * ship's by (class, slot), not by instance.
 *
 * The cache takes its generator as an interface, not as a PixiJS `Renderer`, so
 * it is unit-testable with no WebGL context — which is what lets CI assert the
 * pooling behaviour rather than trusting it.
 */

import { BufferImageSource, Container, Graphics, Matrix, Texture } from 'pixi.js';
import { falloffProfile, type Falloff, type SpriteDef } from './shapes';

// ---------------------------------------------------------------------------
// The falloff ramp — how a gradient fill reaches the GPU (a0-39)
// ---------------------------------------------------------------------------

/**
 * The ramp's resolution. 256² is 256 KB, uploaded **once for the whole
 * process**, and it is generous: the largest thing sampled from it is a nebula
 * body ~200 px across, so a texel is under a pixel and the bilinear filter does
 * the rest. Smaller would band the fix (the defect it exists to remove), and
 * bigger buys nothing a player could see.
 */
const RAMP_SIZE = 256;

/**
 * How far past the falloff's own zero rim the ramp texture reaches, as a
 * multiple of that rim.
 *
 * It is not decoration and it is not tuning: Pixi's `toFillStyle` **forces a
 * texture fill's `addressMode` to `repeat`**
 * (`utils/convertFillInputToFillStyle`), so a path vertex that lands one
 * rounding error outside the ramp's box wraps to the *opposite* rim — which on
 * this ramp is the bright core. The symptom would be a stray lit speck at the
 * exact edge of a blob, i.e. a new artefact in the fix for an artefact. 1.25
 * keeps every sampled UV inside `[0.1, 0.9]`, with the outer quarter of the
 * ramp already at zero alpha.
 */
const RAMP_OVERSCAN = 1.25;

/**
 * **Dither amplitude, in ramp code values (of 255).**
 *
 * The gradient is correct and the frame is still 8 bits, and on this backdrop
 * those two facts fight. A Deep Ember body descends about **4 luma units over
 * 180 px**, so an exact `(1 − t²)²` ramp holds each output code value for
 * 11–18 px and then steps — and a step held for 15 px, repeated concentrically,
 * is a contour ring. Measured on the undithered fix: **8 flat plateaus** per
 * blob, 11–18 px each. Fainter than the four the stack drew by a factor of
 * three, and still the same *kind* of thing the developer reported.
 *
 * Dither is the standard answer and the only one available without a shader:
 * trade a contour for noise at the size of the step it is breaking. The
 * amplitude is derived, not tuned — a sky's output step is
 * `rampΔ/255 × fillAlpha × channel`, and at a typical sky (alpha ≈ 0.055, its
 * brightest channel ≈ 180) **±13 of 255 in the ramp is ±0.5 of an output code**,
 * which is the textbook amplitude: exactly enough to make the boundary between
 * two code values fall in a different place on every pixel, and not enough to be
 * seen as grain.
 *
 * The first attempt used ±3 and moved nothing (8 plateaus before, 8 after),
 * which is the whole reason the number is now derived: at ±3 the noise was
 * ±0.13 of a code and could not cross a boundary it had to cross.
 *
 * Two details that are load-bearing rather than polish:
 *
 *  - **It is windowed by `4f(1−f)`**, so it is zero at the blob's core and zero
 *    at its rim. Un-windowed, the noise at `f = 0` would paint alpha outside the
 *    falloff and put a faint speckled edge exactly where this whole brief went
 *    to remove one.
 *  - **It is a hash of the texel, not a random number.** The ramp is built once
 *    from a pure function, so the goldens stay byte-stable (GDD §4.1).
 */
const RAMP_DITHER = 26;

/** A deterministic hash of a texel to `[-0.5, 0.5)` — the dither's noise. */
function texelNoise(x: number, y: number): number {
  let h = Math.imul(x + 0x9e37, 0x85eb_ca6b) ^ Math.imul(y + 0x79b9, 0xc2b2_ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4_eb2f);
  return ((h >>> 8) & 0xffff) / 0x10000 - 0.5;
}

let ramp: Texture | null = null;

/**
 * The one radial ramp every soft fill in the game samples: white, with
 * {@link falloffProfile} baked into its alpha.
 *
 * Built from a plain buffer rather than a canvas, so it needs no DOM and is the
 * same bytes in the browser, in the test runner and in a headless tool.
 * Premultiplied on the way in — the RGB is the alpha, because the colour comes
 * from the fill's own tint.
 *
 * **One texture, so a whole sky is still one batch.** Every gradient shape in
 * the void shares this, and Pixi batches by texture, so the sky layer submits
 * what it submitted before — over a quarter of the geometry, since one gradient
 * shape replaced four flat ones.
 */
export function falloffRamp(): Texture {
  if (ramp) return ramp;
  const px = new Uint8Array(RAMP_SIZE * RAMP_SIZE * 4);
  const half = RAMP_SIZE / 2;
  for (let y = 0; y < RAMP_SIZE; y++) {
    for (let x = 0; x < RAMP_SIZE; x++) {
      const dx = ((x + 0.5 - half) / half) * RAMP_OVERSCAN;
      const dy = ((y + 0.5 - half) / half) * RAMP_OVERSCAN;
      const f = falloffProfile(Math.hypot(dx, dy));
      // `4f(1−f)` is 1 in the middle of the falloff and 0 at both ends — noise
      // only where the contours are, and none at the rim where it would paint
      // an edge.
      const a = Math.max(
        0,
        Math.min(255, Math.round(f * 255 + texelNoise(x, y) * RAMP_DITHER * 4 * f * (1 - f))),
      );
      const i = (y * RAMP_SIZE + x) * 4;
      px[i] = a;
      px[i + 1] = a;
      px[i + 2] = a;
      px[i + 3] = a;
    }
  }
  ramp = new Texture({
    source: new BufferImageSource({
      resource: px,
      width: RAMP_SIZE,
      height: RAMP_SIZE,
      alphaMode: 'premultiplied-alpha',
      label: 'art/falloff-ramp',
      // Mipmapped, and that is the dither's own safety catch: Plasma Reef's
      // clots are 36–76 px across and *minify* this ramp 3–7×, where an
      // unmipmapped sample would alias the noise into speckle. With mip levels
      // the noise averages away exactly where it is not needed — a small blob
      // spans too few output codes to contour in the first place — and survives
      // on the big bodies that do.
      autoGenerateMipmaps: true,
      scaleMode: 'linear',
    }),
  });
  return ramp;
}

/**
 * The matrix that lays the ramp over one falloff: texture-pixel space onto the
 * shape's own (already `scale`d) space. Pixi inverts it and normalises by the
 * source size, so what it wants is the forward map.
 */
function rampMatrix(f: Falloff, scale: number): Matrix {
  const sx = (2 * f.rx * scale * RAMP_OVERSCAN) / RAMP_SIZE;
  const sy = (2 * f.ry * scale * RAMP_OVERSCAN) / RAMP_SIZE;
  // Pixi's Matrix ops post-apply, so this reads in the order it happens:
  // centre the ramp on the origin, size it, turn it, then put it on the blob.
  return new Matrix()
    .translate(-RAMP_SIZE / 2, -RAMP_SIZE / 2)
    .scale(sx, sy)
    .rotate(f.angle)
    .translate(f.cx * scale, f.cy * scale);
}

/**
 * The one thing this module needs from PixiJS: something that can bake a
 * display object into a texture. `pixi.js`'s `Renderer` satisfies it
 * structurally; a test double satisfies it in four lines.
 */
export interface TextureBaker {
  generateTexture(options: {
    target: Container;
    resolution?: number;
    antialias?: boolean;
  }): Texture;
}

/**
 * Play a sprite definition into a `Graphics`, scaled so unit space maps to
 * `scale` pixels per unit. Additive: the caller may `clear()` first.
 *
 * Draw order is the shape array's order — back to front, as authored.
 */
export function drawSprite(g: Graphics, def: SpriteDef, scale = 1): Graphics {
  for (const shape of def.shapes) {
    if (shape.path.kind === 'circle') {
      g.circle(shape.path.cx * scale, shape.path.cy * scale, shape.path.r * scale);
    } else {
      const pts = shape.path.points;
      g.moveTo(pts[0]! * scale, pts[1]! * scale);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]! * scale, pts[i + 1]! * scale);
      if (shape.path.closed) g.closePath();
    }
    if (shape.fill) {
      // A soft fill is the same path painted through the radial ramp: same
      // colour, same peak alpha, and an alpha that reaches zero at the falloff's
      // rim instead of stopping at an edge (a0-39; ./shapes `Falloff`).
      g.fill(
        shape.fill.falloff
          ? {
              texture: falloffRamp(),
              matrix: rampMatrix(shape.fill.falloff, scale),
              color: shape.fill.color,
              alpha: shape.fill.alpha,
            }
          : { color: shape.fill.color, alpha: shape.fill.alpha },
      );
    }
    if (shape.stroke) {
      g.stroke({
        color: shape.stroke.color,
        alpha: shape.stroke.alpha,
        width: Math.max(shape.stroke.width * scale, 0.5),
        cap: 'round',
        join: 'round',
      });
    }
  }
  return g;
}

/** A fresh `Graphics` holding one sprite at `pixelsPerUnit` scale. */
export function spriteGraphics(def: SpriteDef, pixelsPerUnit: number): Graphics {
  return drawSprite(new Graphics(), def, pixelsPerUnit);
}

/**
 * A keyed texture pool. One texture per distinct look, shared by every entity
 * wearing it, created lazily on first request and never rebuilt.
 *
 * Keys are the sprite's own `name` (which every generator makes carry exactly
 * the parameters that change the look: class, slot, seed, crack stage, state),
 * plus the requested pixel size — so a minimap ship and a world ship are two
 * entries rather than one blurry compromise.
 */
export class SpriteTextureCache {
  private readonly textures = new Map<string, Texture>();
  private misses = 0;

  constructor(
    private readonly baker: TextureBaker,
    /** Device pixel ratio to bake at. Pass `window.devicePixelRatio` on mobile. */
    private readonly resolution = 1,
  ) {}

  /**
   * The texture for `def` at `size` pixels across (its full extent). The
   * definition is only *evaluated* on a miss — pass a thunk for anything
   * expensive to generate.
   */
  get(def: SpriteDef, size: number): Texture {
    return this.getBy(`${def.name}@${size}`, () => def, size);
  }

  /**
   * The texture for a key, generating the sprite only on a miss. Use this on
   * hot paths (per-asteroid, per-ship) so a cache hit costs one map lookup and
   * builds no geometry at all.
   */
  getBy(key: string, make: () => SpriteDef, size: number): Texture {
    const hit = this.textures.get(key);
    if (hit) return hit;
    this.misses++;
    const def = make();
    // Unit space is [-extent, +extent], so `size` pixels across means
    // size / (2 * extent) pixels per unit.
    const g = spriteGraphics(def, size / (def.extent * 2));
    const texture = this.baker.generateTexture({
      target: g,
      resolution: this.resolution,
      antialias: true,
    });
    g.destroy();
    this.textures.set(key, texture);
    return texture;
  }

  /** Number of distinct textures held. */
  get size(): number {
    return this.textures.size;
  }

  /** How many textures were actually baked — a pooling assertion for tests. */
  get bakeCount(): number {
    return this.misses;
  }

  /** True if a key is already resident. */
  has(key: string): boolean {
    return this.textures.has(key);
  }

  /** Drop and destroy every texture (context loss, or a match teardown). */
  clear(): void {
    for (const t of this.textures.values()) t.destroy(true);
    this.textures.clear();
    this.misses = 0;
  }
}
