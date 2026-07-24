/**
 * src/art/audio/beams.ts — held sounds. OWNER: Art & Audio Agent.
 *
 * Most tells are moments: a rock cracks, a turret fires, a shield pops. Three
 * are not — the beam on rock, the beam on hull, and the engine — and those three
 * are *states* that persist for as long as a player holds a control down.
 *
 * Retriggering a one-shot per firing tick would play a sound 60 times a second.
 * That is not a beam; it is a machine gun, and worse, it is the sound of a
 * synthesized game giving itself away. So held states get a looping voice whose
 * gain follows the state, which is what {@link SustainedVoice} is.
 *
 * ## The two beam voices (GDD §3.6)
 *
 * The brief names *"the distinct rock-vs-hull beam sounds"* specifically,
 * because the beam is the inversion the whole game turns on: the same trigger
 * mines and kills. A player mid-fight needs to know which one they are currently
 * doing without taking their eyes off where they are flying — so the two voices
 * are as far apart as the bank can put them (low grinding stone vs. bright
 * cutting torch, `./bank`), and {@link BeamVoices} crossfades rather than
 * switching, so a beam sweeping off a rock and onto a hull *slides*.
 *
 * ## One voice per material, not one per ship
 *
 * Eight ships could be beaming at once, and eight loops of the same grind is
 * eight copies of one sound phase-cancelling into mush — it does not sound like
 * eight miners, it sounds like a fault. So the mix keeps **one** rock voice and
 * **one** hull voice, driven by the strongest beam currently on that material.
 * The information a player needs from the beam is *what is being cut*, and that
 * survives the collapse intact.
 */

import type { AudioGraph, Bus, LoopHandle } from './graph';
import { SOUND, type SoundName } from './bank';

/** Below this the voice is stopped outright rather than left running silently. */
const SILENCE = 0.004;

/** Options for {@link SustainedVoice}. */
export interface SustainedOptions {
  readonly bus?: Bus;
  /** Seconds to fall to a lower level once the state stops feeding it. */
  readonly release?: number;
  /** Seconds to rise. Fast: a beam that fades *in* feels like input lag. */
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

/** Options for {@link BeamVoices}. */
export interface BeamVoiceOptions {
  /** Ceiling on either beam voice, 0..1. */
  readonly maxGain?: number;
  /**
   * How much beam power moves the pitch. A tier-4 beam is a heavier tool and
   * sounds like one — the same number that scales the spark burst (`../vfx/`).
   */
  readonly rateSpread?: number;
}

/**
 * The two beam voices, and the crossfade between them.
 *
 * ```ts
 * // per frame, over the same TellQueue the VFX field reads:
 * beams.onBeam(kind === TELL.beamHull, power);
 * beams.update(dt);
 * ```
 */
export class BeamVoices {
  private readonly rock: SustainedVoice;
  private readonly hull: SustainedVoice;
  private readonly rateSpread: number;

  constructor(graph: AudioGraph, options: BeamVoiceOptions = {}) {
    const maxGain = clamp01(options.maxGain ?? 0.7);
    // A slower release on rock than on hull: mining is a steady activity and
    // should not flutter when the beam clips the edge of a tumbling rock, while
    // a beam coming off a ship should stop sounding like a hit immediately.
    this.rock = new SustainedVoice(graph, SOUND.beamRockLoop, { maxGain, release: 0.11, attack: 0.02 });
    this.hull = new SustainedVoice(graph, SOUND.beamHullLoop, { maxGain, release: 0.07, attack: 0.012 });
    this.rateSpread = options.rateSpread ?? 0.25;
  }

  /** One beam tell: hull or rock, at this power (0..1). */
  onBeam(onHull: boolean, power: number): void {
    const p = clamp01(power);
    // Level tracks power with a floor, so even a tier-0 beam is clearly audible:
    // this is the sound that tells a player their trigger is doing something.
    const level = 0.55 + 0.45 * p;
    const rate = 1 + (p - 0.5) * this.rateSpread;
    if (onHull) this.hull.push(level, rate);
    else this.rock.push(level, rate);
  }

  /** Advance both voices. */
  update(dt: number): void {
    this.rock.update(dt);
    this.hull.update(dt);
  }

  /** True while either voice is sounding. */
  get playing(): boolean {
    return this.rock.playing || this.hull.playing;
  }

  /** Gains of the two voices — the crossfade, as a pair of numbers, for tests. */
  get levels(): { readonly rock: number; readonly hull: number } {
    return { rock: this.rock.gain, hull: this.hull.gain };
  }

  /** Stop both. */
  stop(): void {
    this.rock.stop();
    this.hull.stop();
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
