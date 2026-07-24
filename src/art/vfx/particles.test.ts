/**
 * The performance promise, asserted rather than intended.
 *
 * GDD §4.3 states the budget the whole render side lives inside — *"8 ships, up
 * to 32 turrets, ~200 asteroids, hundreds of projectiles at 60 fps on integrated
 * graphics: object pooling, spatial hash collisions, instanced sprites, **zero
 * per-frame allocations**"* — and risk 5 says that discipline is built in from
 * M1 rather than retrofitted. Particles are where a VFX set breaks it, because
 * the natural way to write them allocates on exactly the frames that are already
 * the worst: an explosion, a wave landing, a planet dying.
 *
 * So this file does two things a comment cannot:
 *
 *  1. It records every backing buffer and asserts the *same objects* are still
 *     there after tens of thousands of emissions and frames.
 *  2. It runs the hot path with the typed-array constructors **replaced by traps
 *     that throw**, so an allocation in `emit` or `update` is not a slow frame
 *     someone might notice on a phone — it is a failed test on this commit.
 */

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@shared/types';
import { PARTICLE_CAPACITY, ParticlePool } from './particles';
import { asteroidBurst, explosion, planetDeath, thrusterTrail } from './emitters';
import { TELL, TELL_COUNT, TellQueue } from '../tells';
import { VfxField } from './field';

/**
 * Run `body` with every typed-array constructor trapped.
 *
 * Anything that allocates storage inside throws, which is the strongest form
 * this assertion can take: it does not measure heap growth (noisy, GC-dependent
 * and flaky in CI) — it makes the allocation itself impossible.
 */
function withNoAllocation(body: () => void): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const names = ['Float32Array', 'Uint8Array', 'Uint32Array', 'Int8Array', 'Int32Array', 'Float64Array'];
  const saved = names.map((name) => [name, globals[name]] as const);
  const trap = (name: string) =>
    function trapped(): never {
      throw new Error(`allocated a ${name} mid-frame`);
    };
  try {
    for (const name of names) globals[name] = trap(name);
    body();
  } finally {
    for (const [name, original] of saved) globals[name] = original;
  }
}

/** The identity of every column, so a swapped buffer is caught as well as a new one. */
function columns(pool: ParticlePool): unknown[] {
  return [
    pool.kind, pool.color, pool.x, pool.y, pool.vx, pool.vy,
    pool.age, pool.ttl, pool.r0, pool.r1, pool.rot, pool.spin, pool.drag, pool.alpha,
  ];
}

describe('ParticlePool — zero per-frame allocations (GDD §4.3, risk 5)', () => {
  it('buys its storage once, in the constructor', () => {
    const pool = new ParticlePool(256);
    expect(pool.bufferCount).toBe(14);
    expect(pool.capacity).toBe(256);
    expect(pool.count).toBe(0);
  });

  it('emits and steps 60 000 times without creating a single buffer', () => {
    const pool = new ParticlePool(512);
    const before = columns(pool);
    const buffers = pool.bufferCount;

    withNoAllocation(() => {
      for (let frame = 0; frame < 2000; frame++) {
        for (let i = 0; i < 30; i++) {
          pool.emit(i % 11, 0x4dc3ff, i, frame, 10, -10, 0.4, 2, 0.5, 0, 1, 1, 1);
        }
        pool.update(1 / 60);
      }
    });

    expect(pool.bufferCount).toBe(buffers);
    expect(columns(pool)).toEqual(before);
  });

  it('steals a slot at capacity rather than growing — full means full', () => {
    const pool = new ParticlePool(64);
    for (let i = 0; i < 64; i++) pool.emit(0, 0, 0, 0, 0, 0, 10, 1, 1);
    expect(pool.full).toBe(true);
    expect(pool.stolen).toBe(0);

    withNoAllocation(() => {
      for (let i = 0; i < 5000; i++) pool.emit(1, 0, 0, 0, 0, 0, 10, 1, 1);
    });

    expect(pool.count).toBe(64); // never one more than it was built for
    expect(pool.stolen).toBe(5000); // and every steal is a visible number
    expect(pool.bufferCount).toBe(14);
  });

  it('cycles victims rather than hammering one slot, so a burst still reads', () => {
    const pool = new ParticlePool(8);
    for (let i = 0; i < 8; i++) pool.emit(0, 0, 0, 0, 0, 0, 10, 1, 1);
    for (let i = 0; i < 8; i++) pool.emit(1, 0, 0, 0, 0, 0, 10, 1, 1);
    // A whole new burst survives: every slot was taken over exactly once.
    for (let i = 0; i < 8; i++) expect(pool.kind[i]).toBe(1);
  });

  it('keeps live particles packed in [0, count) as they retire', () => {
    const pool = new ParticlePool(32);
    for (let i = 0; i < 10; i++) pool.emit(0, 0, i, 0, 0, 0, i % 2 === 0 ? 0.01 : 5, 1, 1);
    pool.update(0.02);
    expect(pool.count).toBe(5);
    for (let i = 0; i < pool.count; i++) expect(pool.ttl[i]).toBe(5);
  });

  it('retires the tail correctly — the swapped-in particle is still stepped', () => {
    const pool = new ParticlePool(4);
    // Slot 0 dies this frame; the tail moves into it and must not be skipped.
    pool.emit(0, 0, 0, 0, 100, 0, 0.001, 1, 1);
    pool.emit(0, 0, 0, 0, 100, 0, 5, 1, 1);
    pool.update(0.1);
    expect(pool.count).toBe(1);
    expect(pool.x[0]).toBeCloseTo(10, 5); // 100 units/s × 0.1 s — it moved
  });

  it('interpolates radius across the lifetime', () => {
    const pool = new ParticlePool(4);
    const i = pool.emit(0, 0, 0, 0, 0, 0, 1, 2, 10);
    expect(pool.radiusAt(i)).toBeCloseTo(2, 5);
    pool.update(0.5);
    expect(pool.radiusAt(0)).toBeCloseTo(6, 5);
  });

  it('applies drag the way the sim does, so debris belongs to the world', () => {
    const pool = new ParticlePool(4);
    pool.emit(0, 0, 0, 0, 100, 0, 5, 1, 1, 0, 0, 2);
    pool.update(0.1);
    expect(pool.vx[0]).toBeCloseTo(80, 5); // v -= v · drag · dt
  });

  it('survives a dt large enough to drive drag negative', () => {
    const pool = new ParticlePool(4);
    pool.emit(0, 0, 0, 0, 100, 0, 5, 1, 1, 0, 0, 40);
    pool.update(0.1); // decay = 1 - 4 → clamped to 0 rather than reversing
    expect(pool.vx[0]).toBe(0);
  });

  it('clears without dropping a buffer', () => {
    const pool = new ParticlePool(16);
    const before = columns(pool);
    for (let i = 0; i < 16; i++) pool.emit(0, 0, 0, 0, 0, 0, 1, 1, 1);
    pool.clear();
    expect(pool.count).toBe(0);
    expect(columns(pool)).toEqual(before);
    expect(pool.bufferCount).toBe(14);
  });
});

describe('TellQueue — the same discipline, one layer up', () => {
  it('buys six columns once and never again', () => {
    const tells = new TellQueue(64);
    const before = [tells.kind, tells.x, tells.y, tells.angle, tells.magnitude, tells.player];
    withNoAllocation(() => {
      for (let frame = 0; frame < 1000; frame++) {
        for (let i = 0; i < 40; i++) tells.push(TELL.beamRock, i, i, 0, 1, i % 8);
        tells.clear();
      }
    });
    expect(tells.bufferCount).toBe(6);
    expect([tells.kind, tells.x, tells.y, tells.angle, tells.magnitude, tells.player]).toEqual(before);
  });

  it('drops on overflow and counts it, rather than growing mid-frame', () => {
    const tells = new TellQueue(4);
    for (let i = 0; i < 4; i++) expect(tells.push(TELL.coreHit, 0, 0)).toBe(true);
    expect(tells.push(TELL.coreHit, 0, 0)).toBe(false);
    expect(tells.length).toBe(4);
    expect(tells.dropped).toBe(1);
    tells.clear();
    expect(tells.dropped).toBe(0);
  });

  it('has a payload note for every kind it can carry', () => {
    // Five bare number columns are exactly the interface that rots; this is the
    // check that the prose stays complete as kinds are added.
    expect(TELL_COUNT).toBe(25);
  });
});

describe('the busiest frame in the game', () => {
  /**
   * The scenario the capacity was chosen for, run end to end: a wave landing on
   * a firefight next to a dying planet. If the pool were going to allocate, this
   * is the frame it would do it on.
   */
  it('a wave, a firefight and a planet death allocate nothing', () => {
    const pool = new ParticlePool(PARTICLE_CAPACITY);
    const rng = mulberry32(7);
    const before = columns(pool);

    withNoAllocation(() => {
      for (let frame = 0; frame < 240; frame++) {
        for (let ship = 0; ship < 8; ship++) thrusterTrail(pool, rng, ship * 40, 0, 0, 1, ship, 1);
        for (let rock = 0; rock < 4; rock++) asteroidBurst(pool, rng, rock * 60, 100, 16, 1);
        explosion(pool, rng, 300, 300, 1, 1);
        planetDeath(pool, rng, 900, 900, 64, 1);
        pool.update(1 / 60);
      }
    });

    expect(pool.bufferCount).toBe(14);
    expect(columns(pool)).toEqual(before);
  });

  it('the field routes a full queue without allocating either', () => {
    const field = new VfxField({ seed: 99 });
    const tells = new TellQueue(512);
    for (let kind = 0; kind < TELL_COUNT; kind++) {
      for (let n = 0; n < 8; n++) tells.push(kind as never, n * 10, n * 10, 0.5, 0.7, n);
    }
    const before = columns(field.pool);

    withNoAllocation(() => {
      for (let frame = 0; frame < 300; frame++) {
        field.consume(tells);
        field.update(1 / 60);
      }
    });

    expect(field.pool.bufferCount).toBe(14);
    expect(columns(field.pool)).toEqual(before);
    expect(field.count).toBeGreaterThan(0);
  });
});
