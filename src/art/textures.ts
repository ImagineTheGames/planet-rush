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

import { Container, Graphics, type Texture } from 'pixi.js';
import type { SpriteDef } from './shapes';

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
    if (shape.fill) g.fill({ color: shape.fill.color, alpha: shape.fill.alpha });
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
