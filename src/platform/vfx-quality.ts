/**
 * src/platform/vfx-quality.ts — automatic VFX reduction. OWNER: Platform Engineer.
 *
 * The mobile gate is 60 fps on the developer's phone with a 30 fps floor on a
 * 3-year-old mid-range Android; **sustained drops below the floor auto-engage the
 * "reduce VFX" setting** (GDD §4.3, risk 5). This module is that trigger: it
 * watches per-frame times and flips a single `reduced` flag the render layer
 * reads to shed the non-load-bearing VFX (impact glows, spawn shimmer) while
 * keeping the readable tells (muzzle flashes, ship, ore) intact.
 *
 * Two rules keep the flag from **flapping** — the whole reason this is a state
 * machine and not a threshold:
 *
 *  1. **Sustain, not spikes.** A single slow frame (a GC pause, a tab thaw) must
 *     not reduce VFX. The measured rate must stay below the floor for a sustained
 *     window before it engages.
 *  2. **Hysteresis.** It engages below the floor but only *releases* once the
 *     rate recovers well above it — a gap so a device sitting right at 30 fps
 *     doesn't toggle VFX on and off every second (which would look worse than
 *     either state). Engage-low / release-high, the classic thermostat.
 *
 * Pure and DOM-free: it is driven by frame *deltas* passed in, so it unit-tests
 * headless and the loop owns the clock (mirrors loop.ts's `advance`).
 */

/** Tunables for the auto-reducer. All `TUNABLE` — QA owns the phone gate (§4.3). */
export interface VfxQualityConfig {
  /** Engage reduce-VFX when the smoothed rate sits at/below this (the floor). */
  readonly engageFps: number;
  /** Release only once the smoothed rate climbs back above this (> engageFps). */
  readonly releaseFps: number;
  /** Seconds the rate must stay in the bad band before engaging (spike guard). */
  readonly engageSustainSeconds: number;
  /** Seconds it must stay recovered before releasing (avoids a premature flip). */
  readonly releaseSustainSeconds: number;
  /** EMA smoothing factor in (0,1]; lower = smoother/slower. Damps frame jitter
   *  so one fast/slow frame doesn't swing the measured rate. */
  readonly smoothing: number;
}

/**
 * Defaults tied to the GDD numbers: the 30 fps floor engages, and recovery must
 * clear 50 fps (comfortably back toward the 60 fps target) before VFX return —
 * a 20 fps hysteresis gap. Three seconds of sustain on each side rides out
 * transient stalls without making the player wait through a real slog.
 */
export const DEFAULT_VFX_QUALITY: VfxQualityConfig = {
  engageFps: 30,
  releaseFps: 50,
  engageSustainSeconds: 3,
  releaseSustainSeconds: 3,
  smoothing: 0.1,
};

/**
 * Watches frame deltas and decides whether reduce-VFX is auto-engaged. Feed it
 * one real frame's elapsed seconds per {@link sample}; read {@link reduced}.
 * Stateful but allocation-free — no per-frame garbage (GDD §4.3).
 */
export class VfxAutoQuality {
  private readonly cfg: VfxQualityConfig;
  /** Exponential moving average of instantaneous fps; `null` until first sample. */
  private emaFps: number | null = null;
  /** Seconds spent continuously in the engage/release band (whichever applies). */
  private bandSeconds = 0;
  private engaged = false;

  constructor(config: VfxQualityConfig = DEFAULT_VFX_QUALITY) {
    this.cfg = config;
  }

  /** Is reduce-VFX currently auto-engaged? */
  get reduced(): boolean {
    return this.engaged;
  }

  /** The current smoothed frame rate (for a HUD/debug readout), or `null` before
   *  the first sample. Not used by the decision beyond the EMA it reflects. */
  get smoothedFps(): number | null {
    return this.emaFps;
  }

  /**
   * Consume one real frame's elapsed time (seconds) and update the decision.
   * Returns the (possibly just-changed) `reduced` flag. Non-positive or absurd
   * deltas (a paused tab handing back a multi-second frame) are ignored so a
   * thaw spike can't be mistaken for a sustained drop.
   */
  sample(frameSeconds: number): boolean {
    if (!(frameSeconds > 0) || frameSeconds > 1) return this.engaged;

    const fps = 1 / frameSeconds;
    this.emaFps = this.emaFps === null ? fps : this.emaFps + this.cfg.smoothing * (fps - this.emaFps);
    const rate = this.emaFps;

    if (!this.engaged) {
      // Engage after the smoothed rate holds at/below the floor for the window.
      if (rate <= this.cfg.engageFps) {
        this.bandSeconds += frameSeconds;
        if (this.bandSeconds >= this.cfg.engageSustainSeconds) {
          this.engaged = true;
          this.bandSeconds = 0;
        }
      } else {
        this.bandSeconds = 0;
      }
    } else {
      // Release only after recovery clears the (higher) release rate — hysteresis.
      if (rate >= this.cfg.releaseFps) {
        this.bandSeconds += frameSeconds;
        if (this.bandSeconds >= this.cfg.releaseSustainSeconds) {
          this.engaged = false;
          this.bandSeconds = 0;
        }
      } else {
        this.bandSeconds = 0;
      }
    }

    return this.engaged;
  }

  /** Reset to the initial (VFX-on) state — e.g. on a fresh match or a manual
   *  override taking control. Clears the EMA and the sustain timer. */
  reset(): void {
    this.emaFps = null;
    this.bandSeconds = 0;
    this.engaged = false;
  }
}
