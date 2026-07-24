/**
 * src/sim/rng.ts — the seeded RNG over explicit state. OWNER: Gameplay Engineer.
 *
 * Determinism is sacred (GDD §4.1, §4.8): the sim never calls `Math.random`.
 * All in-sim randomness is drawn from the ratified mulberry32 in
 * `@shared/types`, threaded through the world tree as a bare 32-bit
 * `world.rngState` so the whole state stays plain, serializable, and hashable.
 *
 * Every helper here is **pure**: it takes a state, returns a value *and* the
 * advanced state. The caller decides where the new state lives, so there is no
 * hidden generator anywhere in the codebase.
 *
 * (These lived in `./state` through day 1. They moved out when wave spawning
 * (`./waves`) became a second consumer — a leaf module with no imports of its
 * own keeps the dependency graph acyclic.)
 */

import { mulberry32 } from '@shared/types';

/** One draw: a float in [0, 1) and the advanced state. */
export interface RngDraw {
  readonly value: number;
  readonly state: number;
}

/**
 * Draw one float in [0, 1) and return it with the advanced state. Uses the
 * ratified mulberry32 algorithm by seeding a fresh instance at `state` and
 * reading its next output — identical sequence, no hidden state.
 */
export function advanceRng(state: number): RngDraw {
  // mulberry32's internal step: state += 0x6d2b79f5, then mix. We reproduce it
  // by advancing the shared implementation one step from `state`.
  const next = (state + 0x6d2b79f5) | 0;
  const value = mulberry32(state).next();
  return { value, state: next >>> 0 };
}

/** Draw an integer in [min, max] inclusive, deterministically. */
export function rngInt(state: number, min: number, max: number): RngDraw {
  const r = advanceRng(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
}

/** Draw a float in [min, max), deterministically. */
export function rngRange(state: number, min: number, max: number): RngDraw {
  const r = advanceRng(state);
  return { value: min + r.value * (max - min), state: r.state };
}
