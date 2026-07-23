/**
 * src/platform/freeze.test.ts — freeze determinism (the brief's second Vitest ask).
 *
 * `?freeze=1` pins the sim at a seeded tick so a screenshot is reproducible.
 * That only holds if the freeze entry point is deterministic: **two boots →
 * identical world hash.** These tests boot the frozen world twice, from scratch,
 * and assert the worlds are deep-equal and hash identically — the same property
 * the CI replay test guards (GDD §4.1, §4.8), exercised through the freeze seam.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../sim';
import { ShipClass } from '@shared/types';
import {
  buildFrozenWorld,
  advanceToFreezeTick,
  hashWorld,
  freezePlayers,
  FREEZE_TICK,
  FREEZE_SEED,
  FREEZE_PLAYER_COUNT,
} from './freeze';

describe('freeze determinism — two boots, identical world hash', () => {
  it('builds byte-identical worlds on repeat boots', () => {
    const a = buildFrozenWorld();
    const b = buildFrozenWorld();
    expect(a).toEqual(b);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('freezes at exactly FREEZE_TICK', () => {
    const w = buildFrozenWorld();
    expect(w.tick).toBe(FREEZE_TICK);
    // Two seconds of sim time at 60 Hz.
    expect(w.time).toBeCloseTo(FREEZE_TICK / 60, 6);
  });

  it('populates the full ring of Vanguards (mirrors the boot world)', () => {
    const w = buildFrozenWorld();
    expect(w.ships).toHaveLength(FREEZE_PLAYER_COUNT);
    expect(w.ships.every((s) => s.shipClass === ShipClass.Vanguard)).toBe(true);
  });

  it('produces a different hash for a different seed', () => {
    const a = buildFrozenWorld(FREEZE_TICK, FREEZE_SEED);
    const b = buildFrozenWorld(FREEZE_TICK, FREEZE_SEED + 1);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('produces a different hash at a different tick', () => {
    const a = buildFrozenWorld(60);
    const b = buildFrozenWorld(120);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('advanceToFreezeTick is idempotent — re-freezing does not advance past', () => {
    const w = createWorld({ seed: FREEZE_SEED, players: freezePlayers() });
    advanceToFreezeTick(w, FREEZE_TICK);
    const once = hashWorld(w);
    advanceToFreezeTick(w, FREEZE_TICK); // already at/past the tick → no-op
    expect(w.tick).toBe(FREEZE_TICK);
    expect(hashWorld(w)).toBe(once);
  });

  it('matches an independent manual advance to the same tick', () => {
    // The freeze seam must equal stepping the seeded world by hand — no hidden
    // input, no drift from the plain determinism the sim already guarantees.
    const manual = createWorld({ seed: FREEZE_SEED, players: freezePlayers() });
    for (let i = 0; i < FREEZE_TICK; i++) step(manual, []);
    expect(hashWorld(buildFrozenWorld())).toBe(hashWorld(manual));
  });
});

describe('hashWorld — shape', () => {
  it('is an 8-char lowercase hex string', () => {
    expect(hashWorld(buildFrozenWorld())).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is stable across calls on the same world', () => {
    const w = buildFrozenWorld();
    expect(hashWorld(w)).toBe(hashWorld(w));
  });
});
