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
 * The countdown is computed with the sim's **own** {@link waveTime} — the
 * function `src/sim/waves.ts` spawns against — rather than a second copy of the
 * schedule here. That is structural, not tidiness: the spawner's own note says
 * "the same function the HUD's wave clock counts down to, so the clock can never
 * promise a wave the sim does not deliver," and calling it is what makes that
 * true instead of merely intended.
 */

import { WAVE_COUNT, waveTime } from '../sim/constants';

/** Full names for the five waves — each "closer to the map center than the last"
 *  (GDD §2.3), so the names read outer→inner. Player-facing flavor (not a
 *  ratified interface); tune freely with QA/Art. */
export const WAVE_NAMES: readonly string[] = [
  'Outer Drift',
  'Far Belt',
  'Mid Field',
  'Inner Ring',
  'Claim Fall',
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
  /**
   * True once the collapse phase has begun (the sim's `isCollapsed`): no shield
   * regeneration, no repair, no new ore (GDD §2.3). The clock says so, because
   * this is the moment the match stops being about the economy — and a player
   * who does not know it has started cannot read why their repair stopped
   * working. Note the sim can enter collapse *during* the final wave, the
   * instant the field runs dry, so this is not merely "final wave, later".
   */
  readonly isCollapsed: boolean;
}

/**
 * Compute the wave clock at a given match time (seconds).
 *
 * Waves arrive on a metronome: wave 1 is present at t=0 and wave `n` lands at
 * the sim's own {@link waveTime}`(n)`. The countdown is the time to the next
 * wave's arrival; on the final wave there is no "next", so it is `null` (the HUD
 * reads FINAL).
 *
 * @param timeSeconds `world.time`.
 * @param collapsed   The sim's `isCollapsed(world)`. Optional — a caller that
 *                    predates the endgame reads as "not collapsed".
 */
export function computeWaveClock(timeSeconds: number, collapsed = false): WaveClock {
  const t = Math.max(0, timeSeconds);

  // The highest wave whose arrival time has passed, from the sim's schedule.
  let wave = 1;
  while (wave < WAVE_COUNT && t >= waveTime(wave + 1)) wave++;
  const isFinalWave = wave >= WAVE_COUNT;

  // Time to the next wave's arrival — null once the last wave is out.
  const countdownToNext = isFinalWave ? null : waveTime(wave + 1) - t;

  return {
    wave,
    waveCount: WAVE_COUNT,
    name: WAVE_NAMES[wave - 1] ?? `Wave ${wave}`,
    countdownToNext,
    matchTime: t,
    isFinalWave,
    isCollapsed: collapsed,
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
