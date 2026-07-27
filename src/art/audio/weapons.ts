/**
 * src/art/audio/weapons.ts — held sounds. OWNER: Art & Audio Agent.
 *
 * Most tells are moments: a rock cracks, a turret fires, a shield pops. One is
 * not — the engine — and it is a *state* that persists for as long as a player
 * holds the throttle open. (Firing used to belong here too, as a held rock/hull
 * pair; the laser's retirement — amendment v0.3 — made a shot a discrete projectile, so
 * the two firing voices retired to one-shots in `./bank`. See {@link SOUND.rockChip}.)
 *
 * Retriggering a one-shot per throttle tick would play a sound 60 times a second.
 * That is not a running engine; it is a machine gun, and worse, it is the sound of
 * a synthesized game giving itself away. So the held state gets a looping voice
 * whose gain follows it, which is what {@link SustainedVoice} is. The adaptive
 * soundtrack's stems (`./music`) are the same class under a different name — a bed
 * that rises and falls with the match rather than restarting.
 *
 * ## One voice, not one per source
 *
 * Eight ships could be under power at once, and eight loops of the same engine is
 * eight copies of one sound phase-cancelling into mush — it does not sound like
 * eight ships, it sounds like a fault. So the engine keeps **one** thruster voice,
 * on the local ship alone (`./engine`): the one a player needs to feel is the one
 * under their own thumb.
 */

import type { AudioGraph, Bus, LoopHandle } from './graph';
import type { SoundName } from './bank';

/** Below this the voice is stopped outright rather than left running silently. */
const SILENCE = 0.004;

/** Options for {@link SustainedVoice}. */
export interface SustainedOptions {
  readonly bus?: Bus;
  /** Seconds to fall to a lower level once the state stops feeding it. */
  readonly release?: number;
  /** Seconds to rise. Fast: a shot that fades *in* feels like input lag. */
  readonly attack?: number;
  /** Ceiling on the voice's gain, 0..1. */
  readonly maxGain?: number;
}

/**
 * A looping voice whose gain tracks a held state.
 *
 * Feed it with {@link push} while the state is on — once per tell, as often as
 * the tell arrives — and call {@link update} once per frame. It starts its loop
 * lazily on first sound and stops it when the state goes quiet, so a match where
 * nobody ever fires never creates the node at all.
 */
export class SustainedVoice {
  private handle: LoopHandle | null = null;
  private level = 0;
  private pending = 0;
  private pendingRate = 1;
  private rate = 1;

  private readonly bus: Bus;
  private readonly release: number;
  private readonly attack: number;
  private readonly maxGain: number;

  constructor(
    private readonly graph: AudioGraph,
    private readonly sound: SoundName,
    options: SustainedOptions = {},
  ) {
    this.bus = options.bus ?? 'sfx';
    this.release = Math.max(0.001, options.release ?? 0.09);
    this.attack = Math.max(0, options.attack ?? 0.02);
    this.maxGain = clamp01(options.maxGain ?? 1);
  }

  /** True while the loop node exists and is audible. */
  get playing(): boolean {
    return this.handle !== null;
  }

  /** Current gain, 0..1. */
  get gain(): number {
    return this.level;
  }

  /**
   * The state is on this frame, at this strength.
   *
   * Strongest wins: several sources feeding one voice (eight ships on rock) is
   * the loudest of them, not the sum, which would clip on the third miner.
   */
  push(level: number, rate = 1): void {
    const v = clamp01(level);
    if (v > this.pending) {
      this.pending = v;
      this.pendingRate = rate > 0 ? rate : 1;
    }
  }

  /** Advance one frame: rise fast to what was pushed, fall slowly to silence. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    const target = this.pending * this.maxGain;
    this.pending = 0;

    if (target > this.level) {
      this.level = this.attack <= 0 ? target : approach(this.level, target, step / this.attack);
      this.rate = this.pendingRate;
    } else {
      this.level = approach(this.level, target, step / this.release);
    }

    if (this.level <= SILENCE) {
      this.level = 0;
      if (this.handle) {
        this.handle.stop(0.05);
        this.handle = null;
      }
      return;
    }

    if (!this.handle) {
      this.handle = this.graph.startLoop(this.sound, this.level, this.bus, this.rate);
      return;
    }
    this.handle.setGain(this.level, 0.03);
    this.handle.setRate(this.rate, 0.06);
  }

  /** Stop now — a match teardown, or the mix going away. */
  stop(): void {
    this.pending = 0;
    this.level = 0;
    if (this.handle) {
      this.handle.stop(0.04);
      this.handle = null;
    }
  }
}

// ---------------------------------------------------------------------------

/** Move `from` toward `to` by fraction `k`, clamped so a big dt cannot overshoot. */
function approach(from: number, to: number, k: number): number {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  return from + (to - from) * t;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
