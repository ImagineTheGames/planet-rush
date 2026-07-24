/**
 * The pooling contract (GDD §4.3, risk 5): procedural art must not cost a
 * texture per entity, and must not rebuild geometry per frame.
 *
 * The cache is tested against a fake baker rather than a WebGL context, so this
 * runs headless in CI on the same terms as the sim tests — and so the assertion
 * is about *behaviour we control* (one bake per distinct look) rather than about
 * PixiJS internals.
 */

import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics, type Texture } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { asteroidSprite } from './asteroids';
import { shipSprite } from './ships';
import { circle, fill, poly, polyline, sprite, stroke } from './shapes';
import { PALETTE } from './palette';
import { SpriteTextureCache, drawSprite, spriteGraphics, type TextureBaker } from './textures';

/** A baker that counts calls and hands back a distinguishable fake texture. */
function fakeBaker(): TextureBaker & { calls: number; targets: Container[] } {
  const state = {
    calls: 0,
    targets: [] as Container[],
    generateTexture(options: { target: Container }): Texture {
      state.calls++;
      state.targets.push(options.target);
      return { id: state.calls, destroy: vi.fn() } as unknown as Texture;
    },
  };
  return state;
}

describe('drawSprite', () => {
  it('plays a definition into a Graphics without touching a GPU', () => {
    const def = sprite('test/mixed', 1, [
      circle(0, 0, 1, fill(PALETTE.hullSteel, 'material')),
      poly([0, 0, 1, 0, 1, 1], fill(PALETTE.patina, 'material')),
      polyline([0, 0, 1, 1], stroke(PALETTE.plasma, 0.1, 'energy')),
    ]);
    const g = drawSprite(new Graphics(), def, 32);
    expect(g.context.instructions.length).toBeGreaterThan(0);
  });

  it('scales unit space to pixels', () => {
    const def = sprite('test/dot', 1, [circle(0, 0, 1, fill(PALETTE.hullSteel, 'material'))]);
    const small = spriteGraphics(def, 8);
    const large = spriteGraphics(def, 64);
    expect(large.width).toBeGreaterThan(small.width);
  });

  it('draws real generated art — the whole ship set bakes without throwing', () => {
    for (const shipClass of [ShipClass.Interceptor, ShipClass.Vanguard, ShipClass.Excavator, ShipClass.Hauler]) {
      for (let slot = 0; slot < 8; slot++) {
        expect(() => spriteGraphics(shipSprite({ shipClass, playerId: slot }), 48)).not.toThrow();
      }
    }
  });
});

describe('SpriteTextureCache (GDD §4.3 — pooled, not per-entity)', () => {
  it('bakes a look once and shares it forever', () => {
    const baker = fakeBaker();
    const cache = new SpriteTextureCache(baker);
    const def = shipSprite({ shipClass: ShipClass.Vanguard, playerId: 0 });

    const a = cache.get(def, 64);
    const b = cache.get(def, 64);
    expect(a).toBe(b);
    expect(baker.calls).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.bakeCount).toBe(1);
  });

  it('does not even generate the sprite on a hit', () => {
    const cache = new SpriteTextureCache(fakeBaker());
    const make = vi.fn(() => asteroidSprite({ seed: 7, crackStage: 0 }));
    cache.getBy('rock:7:0', make, 32);
    cache.getBy('rock:7:0', make, 32);
    cache.getBy('rock:7:0', make, 32);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('keeps 200 asteroids down to a handful of textures', () => {
    const baker = fakeBaker();
    const cache = new SpriteTextureCache(baker);
    // A field of 200 rocks drawn from 12 shapes × 3 crack stages.
    for (let i = 0; i < 200; i++) {
      const seed = i % 12;
      const stage = Math.floor(i / 12) % 3;
      cache.getBy(`rock:${seed}:${stage}`, () => asteroidSprite({ seed, crackStage: stage }), 48);
    }
    expect(baker.calls).toBe(36);
    expect(cache.size).toBe(36);
  });

  it('separates sizes, so a minimap icon is not a scaled-down world sprite', () => {
    const baker = fakeBaker();
    const cache = new SpriteTextureCache(baker);
    const def = shipSprite({ shipClass: ShipClass.Hauler, playerId: 2 });
    cache.get(def, 64);
    cache.get(def, 16);
    expect(baker.calls).toBe(2);
    expect(cache.has('ship/hauler/p2@64')).toBe(true);
    expect(cache.has('ship/hauler/p2@16')).toBe(true);
  });

  it('bakes at the requested resolution for retina phones', () => {
    const baker = fakeBaker();
    const spy = vi.spyOn(baker, 'generateTexture');
    const cache = new SpriteTextureCache(baker, 3);
    cache.get(shipSprite({ shipClass: ShipClass.Interceptor, playerId: 0 }), 32);
    expect(spy.mock.calls[0]?.[0]?.resolution).toBe(3);
  });

  it('destroys everything on clear — a match teardown leaks nothing', () => {
    const baker = fakeBaker();
    const cache = new SpriteTextureCache(baker);
    const tex = cache.get(shipSprite({ shipClass: ShipClass.Vanguard, playerId: 1 }), 32);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bakeCount).toBe(0);
    expect(tex.destroy).toHaveBeenCalled();
    // And it repopulates cleanly afterwards.
    cache.get(shipSprite({ shipClass: ShipClass.Vanguard, playerId: 1 }), 32);
    expect(cache.size).toBe(1);
  });
});
