/**
 * The atlas is the renderer's whole interface to generated art, so what it owes
 * is narrow and testable: the right sprite for a piece of sim state, and a pool
 * key that holds a full match's entity counts down to a sane texture budget
 * (GDD §4.3: 8 ships, up to 32 turrets, ~200 asteroids at 60 fps).
 */

import { describe, expect, it, vi } from 'vitest';
import { Container, type Texture } from 'pixi.js';
import { ShipClass } from '@shared/types';
import {
  asteroidTexture,
  beaconTexture,
  buildProgressTexture,
  damageRingTexture,
  oreChunkTexture,
  stationTexture,
  shieldTexture,
  shipTexture,
  turretTexture,
} from './atlas';
import { SpriteTextureCache, type TextureBaker } from './textures';

function bakerSpy(): TextureBaker & { calls: number } {
  const state = {
    calls: 0,
    generateTexture(_options: { target: Container }): Texture {
      state.calls++;
      return { destroy: vi.fn() } as unknown as Texture;
    },
  };
  return state;
}

const ship = (id: number, spawnProtect = 0) => ({ id, shipClass: ShipClass.Vanguard, spawnProtect });

describe('atlas', () => {
  it('pools a whole match into a texture budget a phone can hold', () => {
    const baker = bakerSpy();
    const cache = new SpriteTextureCache(baker);

    // A full 8-station match at the GDD's entity counts.
    for (let frame = 0; frame < 3; frame++) {
      for (let i = 0; i < 8; i++) {
        shipTexture(cache, ship(i), 48);
        stationTexture(cache, { id: i, owner: i, alive: true, coreHp: 100, maxCoreHp: 100 }, 128);
        beaconTexture(cache, i, 160);
        for (let t = 0; t < 4; t++) turretTexture(cache, i, 'idle', 32);
      }
      for (let r = 0; r < 200; r++) {
        asteroidTexture(cache, { id: r, crackStage: r % 3, ore: r % 5, maxOre: 4 }, 40);
      }
    }

    // Ships 8 + stations 4 variants + beacons 8 + turrets 8, and the ~200-rock
    // field bounded by 12 shapes × 3 crack stages × 4 payout bands.
    expect(cache.size).toBeLessThan(12 * 3 * 4 + 30);
    expect(baker.calls).toBe(cache.size);

    // And a second identical frame bakes nothing at all.
    const before = baker.calls;
    for (let i = 0; i < 8; i++) shipTexture(cache, ship(i), 48);
    expect(baker.calls).toBe(before);
  });

  it('swaps the ship sprite when spawn protection is up, and back when it lapses', () => {
    const baker = bakerSpy();
    const cache = new SpriteTextureCache(baker);
    const guarded = shipTexture(cache, ship(0, 9.5), 48);
    const plain = shipTexture(cache, ship(0, 0), 48);
    expect(guarded).not.toBe(plain);
    expect(baker.calls).toBe(2);
  });

  it('swaps a dead station to its wreck — and the wreck keeps the same world', () => {
    const baker = bakerSpy();
    const cache = new SpriteTextureCache(baker);
    const alive = stationTexture(cache, { id: 1, owner: 1, alive: true, coreHp: 40, maxCoreHp: 100 }, 128);
    const dead = stationTexture(cache, { id: 1, owner: 1, alive: false, coreHp: 0, maxCoreHp: 100 }, 128);
    expect(alive).not.toBe(dead);
    expect(cache.has('wreck:1:128')).toBe(true);
  });

  it('bands ore richness and core HP so a ticking value is not a texture leak', () => {
    const baker = bakerSpy();
    const cache = new SpriteTextureCache(baker);
    for (let ore = 0; ore <= 100; ore++) {
      asteroidTexture(cache, { id: 0, crackStage: 0, ore, maxOre: 100 }, 32);
    }
    expect(cache.size).toBe(4); // four payout bands, not 101 textures

    const damageCache = new SpriteTextureCache(bakerSpy());
    for (let hp = 0; hp <= 100; hp++) {
      damageRingTexture(damageCache, { id: 0, owner: 0, alive: true, coreHp: hp, maxCoreHp: 100 }, 64);
    }
    expect(damageCache.size).toBe(21); // 5% steps
  });

  it('handles the degenerate inputs a live sim will hand it', () => {
    const cache = new SpriteTextureCache(bakerSpy());
    expect(() => asteroidTexture(cache, { id: 3, crackStage: 2, ore: 0, maxOre: 0 }, 16)).not.toThrow();
    expect(() => damageRingTexture(cache, { id: 0, owner: 0, alive: true, coreHp: 0, maxCoreHp: 0 }, 16)).not.toThrow();
    expect(() => shieldTexture(cache, 0, 0, 0, 0, 16)).not.toThrow();
    expect(() => buildProgressTexture(cache, 0, 0, 16)).not.toThrow();
    expect(() => oreChunkTexture(cache, 999, 16)).not.toThrow();
  });

  it('banded shield strength gives an attacker three visible steps', () => {
    const baker = bakerSpy();
    const cache = new SpriteTextureCache(baker);
    shieldTexture(cache, 0, 40, 40, 0, 64);
    shieldTexture(cache, 0, 20, 40, 0, 64);
    shieldTexture(cache, 0, 4, 40, 0, 64);
    expect(cache.size).toBe(3);
  });
});
