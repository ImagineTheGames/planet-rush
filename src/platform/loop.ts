/**
 * src/platform/loop.ts — the deterministic fixed-timestep game loop.
 * OWNER: Platform Engineer.
 *
 * 60 Hz simulation, fully decoupled from rendering (GDD §4.1): accumulate real
 * time, step the sim in fixed increments, render with interpolation. This is
 * the frame the game runs in and the foundation of the determinism replay test.
 *
 * Placeholder only — no loop yet (day-0 scaffold; lands day 1).
 */

/** The fixed simulation timestep. 60 Hz — the one true tick (GDD §4.1). */
export const FIXED_DT = 1 / 60;

export const LOOP_PLACEHOLDER = true;
