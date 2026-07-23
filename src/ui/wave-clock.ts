/**
 * src/ui/wave-clock.ts — the ASTEROID WAVE clock. OWNER: UI Engineer.
 *
 * Top-center HUD element (GDD §2.2): it names the wave in full — "so no player
 * has to guess what is being counted" (GDD §2.3) — counts down to the next wave,
 * and shows match time. The field's yield is finite and arrives in five timed
 * waves each spawning closer to center (GDD §2.3); after the last wave the match
 * heads for collapse. This is the metronome of the match made visible.
 *
 * Pure and DOM-free: it derives everything from `world.time` and the ratified
 * wave constants (`WAVE_COUNT`, `WAVE_INTERVAL_S`), so it unit-tests headless
 * and never drifts from the sim's own clock. The Pixi view in {@link ./hud}
 * only formats what this returns.
 *
 * NOTE: the sim does not yet expose per-wave state (day-1 has a static field;
 * timed spawning lands later — see `createWorld`'s asteroidCount). Until it does,
 * this clock is computed from time + constants, the same numbers the sim will
 * spawn against, so the HUD is correct the day waves go live.
 */

import { WAVE_COUNT, WAVE_INTERVAL_S } from '../sim/constants';

/** Full names for the five waves — each "closer to the map center than the last"
 *  (GDD §2.3), so the names read outer→inner. Player-facing flavor (not a
 *  ratified interface); tune freely with QA/Art. */
export const WAVE_NAMES: readonly string[] = [
  'Outer Drift',
  'Far Belt',
  'Mid Field',
  'Inner Ring',
  'Core Fall',
];

/** A snapshot of the wave clock for one frame. */
export interface WaveClock {
  /** Current wave, 1..WAVE_COUNT. */
  readonly wave: number;
  /** Total waves in the match (WAVE_COUNT). */
  readonly waveCount: number;
  /** The current wave's full name (GDD §2.3 "named in full on the HUD"). */
  readonly name: string;
  /** Seconds until the next wave, or `null` on the final wave (none follows). */
  readonly countdownToNext: number | null;
  /** Elapsed match time, seconds. */
  readonly matchTime: number;
  /** True once the final wave has arrived — no more ore incoming (GDD §2.3). */
  readonly isFinalWave: boolean;
}

/**
 * Compute the wave clock at a given match time (seconds).
 *
 * Waves arrive on a metronome: wave 1 is present at t=0, and each subsequent
 * wave at k·`WAVE_INTERVAL_S`. The countdown is the time to the next boundary;
 * on the final wave there is no "next", so it is `null` (the HUD reads FINAL).
 */
export function computeWaveClock(timeSeconds: number): WaveClock {
  const t = Math.max(0, timeSeconds);
  const interval = WAVE_INTERVAL_S;

  // Boundaries passed so far (0-based); wave number is one more, capped.
  const boundariesPassed = Math.floor(t / interval);
  const wave = Math.min(boundariesPassed + 1, WAVE_COUNT);
  const isFinalWave = wave >= WAVE_COUNT;

  // Time to the next wave boundary — null once the last wave is out.
  const countdownToNext = isFinalWave ? null : interval - (t % interval);

  return {
    wave,
    waveCount: WAVE_COUNT,
    name: WAVE_NAMES[wave - 1] ?? `Wave ${wave}`,
    countdownToNext,
    matchTime: t,
    isFinalWave,
  };
}

/**
 * Format a duration (seconds) as `m:ss` for the HUD (Oxanium numerals, GDD §5.6).
 * Clamps negatives to 0; rounds up so a countdown never shows 0:00 while a wave
 * is still pending.
 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}
