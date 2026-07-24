/**
 * src/art/vfx/layer.ts — particles on the GPU. OWNER: Art & Audio Agent.
 *
 * The thin PixiJS end of the VFX system, and deliberately the *only* file in
 * `src/art/vfx/` that imports PixiJS: everything upstream of it — the pool, the
 * emitters, the observer, the death moment — is numbers, so all of it tests
 * headless with no canvas and no GPU (GDD §4.1: the sim and the harness never
 * touch a renderer, and art follows the same rule for the same reason).
 *
 * It obeys the same pooling contract as the rest of the render path (GDD §4.3,
 * risk 5; `../textures`):
 *
 *  - **Eleven textures for every effect in the game.** A particle's look is
 *    baked once per kind (`./kinds`) into the shared `SpriteTextureCache`.
 *  - **Sprites are pooled, never rebuilt.** The pool grows to the high-water
 *    mark of simultaneous particles and stops; after that a frame only writes
 *    `position`, `rotation`, `scale`, `tint` and `alpha`.
 *  - **Two containers, two blend modes.** Light (sparks, embers, rings) is
 *    additive; matter (chips, shards, smoke) is not. Splitting them by container
 *    means blend mode is set once per sprite at creation instead of thrashing
 *    the batcher every frame.
 */

import { Container, Sprite, type Texture } from 'pixi.js';
import { fadeAt, PARTICLE_KINDS, particleKind, particleSprite } from './kinds';
import type { ParticlePool } from './particles';
import type { SpriteTextureCache } from '../textures';

/** Pixels across which each particle texture is baked. */
export const PARTICLE_TEXTURE_PX = 48;

/** Options for {@link VfxLayer}. */
export interface VfxLayerOptions {
  /** Baked texture size in pixels. Bigger = smoother large rings, more VRAM. */
  readonly textureSize?: number;
}

/**
 * A drawable particle layer. Add it to the world root, above the entities and
 * below the HUD, and call {@link draw} once per frame with the field's pool:
 *
 * ```ts
 * const vfx = new VfxLayer(textureCache);
 * worldRoot.addChild(vfx);
 * // per frame, after field.update(dt):
 * vfx.draw(field.pool);
 * ```
 */
export class VfxLayer extends Container {
  private readonly matter = new Container();
  private readonly light = new Container();
  private readonly matterSprites: Sprite[] = [];
  private readonly lightSprites: Sprite[] = [];
  private readonly textures: Texture[] = [];
  private readonly size: number;

  constructor(cache: SpriteTextureCache, options: VfxLayerOptions = {}) {
    super();
    this.size = options.textureSize ?? PARTICLE_TEXTURE_PX;
    this.label = 'vfx';
    this.matter.label = 'vfx-matter';
    this.light.label = 'vfx-light';
    // Matter first: sparks and embers read as light *over* the debris they came
    // off, which is the way round that looks like heat rather than paint.
    this.addChild(this.matter, this.light);

    for (const spec of PARTICLE_KINDS) {
      this.textures[spec.kind] = cache.getBy(
        `vfx:${spec.name}:${this.size}`,
        () => particleSprite(spec.kind),
        this.size,
      );
    }
  }

  /**
   * Draw one frame from the pool. Allocation-free once the sprite pools have
   * reached their high-water mark.
   */
  draw(pool: ParticlePool): void {
    let matterUsed = 0;
    let lightUsed = 0;

    for (let i = 0; i < pool.count; i++) {
      const kind = pool.kind[i]!;
      const spec = particleKind(kind);
      const additive = spec.additive;
      const sprite = additive
        ? this.take(this.lightSprites, this.light, lightUsed++, true)
        : this.take(this.matterSprites, this.matter, matterUsed++, false);

      sprite.texture = this.textures[kind] ?? sprite.texture;
      sprite.x = pool.x[i]!;
      sprite.y = pool.y[i]!;
      sprite.rotation = pool.rot[i]!;
      // The texture is `size` px across the sprite's full extent (radius 1), so
      // a world radius of r wants a scale of 2r / size.
      sprite.scale.set((pool.radiusAt(i) * 2) / this.size);
      sprite.tint = pool.color[i]!;
      sprite.alpha = pool.alpha[i]! * fadeAt(kind, pool.progress(i));
    }

    hideFrom(this.matterSprites, matterUsed);
    hideFrom(this.lightSprites, lightUsed);
  }

  /** Live sprites in the two pools — a pooling assertion for tests. */
  get spriteCount(): number {
    return this.matterSprites.length + this.lightSprites.length;
  }

  private take(pool: Sprite[], layer: Container, index: number, additive: boolean): Sprite {
    let sprite = pool[index];
    if (!sprite) {
      sprite = new Sprite(this.textures[0]);
      sprite.anchor.set(0.5);
      if (additive) sprite.blendMode = 'add';
      pool[index] = sprite;
      layer.addChild(sprite);
    }
    sprite.visible = true;
    return sprite;
  }
}

function hideFrom(sprites: readonly Sprite[], used: number): void {
  for (let i = used; i < sprites.length; i++) {
    const s = sprites[i];
    if (s) s.visible = false;
  }
}
