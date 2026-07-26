/**
 * src/art/audio/graph.ts — the mix. OWNER: Art & Audio Agent.
 *
 * Four gain nodes and a buffer cache. That is the entire audio architecture,
 * and it is small on purpose: every sound was already synthesized offline into
 * a `Float32Array` (`./synth`), so nothing here has to do DSP at 48 kHz on the
 * same thread that is trying to hold 60 fps on a phone (GDD §4.3).
 *
 * ```
 *   sfx ─────┐
 *   alarm ───┼──► master ──► duck ──► destination
 *   ambient ─┘                 ▲
 *                              └── the planet-death hush (../vfx/death-moment)
 * ```
 *
 * **Why the duck is its own node.** The tone contract's three seconds of quiet
 * multiply the *whole* mix, alarm included — "audio drops out … nobody jokes"
 * (GDD §4.7). Putting it downstream of master means it cannot be routed around
 * by accident, and it leaves `master` free to be the player's volume setting.
 *
 * **Why three buses.** They are the three things a player or the game turns down
 * independently: the ambient loop is cuttable (GDD §4.9 item 3), the alarm is a
 * mechanic that must stay audible over everything else (§2.2), and the SFX are
 * the rest. A "reduce VFX" style audio setting is a bus gain, not a code path.
 *
 * ## Pooling and voice limits
 *
 * Buffer sources are single-use by the Web Audio spec, so this is the one place
 * in `src/art/` that legitimately allocates per event — but it allocates a
 * *node*, not a buffer: the rendered samples are cached per sound and shared by
 * every playback of it, forever. Concurrency is capped ({@link MixOptions.
 * maxVoices}) and repeats of the same sound inside {@link MixOptions.repeatGap}
 * are refused, which is what keeps eight ships collecting ore on one frame from
 * turning into one loud smear.
 */

import { mulberry32, type Rng } from '@shared/types';
import {
  isLayered,
  loops,
  soundSpec,
  SOUND_NAMES,
  type SoundName,
  type SoundSpec,
} from './bank';
import {
  toAudioBuffer,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioParamLike,
  type BufferSourceLike,
  type GainNodeLike,
} from './context';
import { DEFAULT_SAMPLE_RATE, renderLayered, renderVoice, seamless } from './synth';

/** The four buses. */
export type Bus = 'sfx' | 'alarm' | 'ambient' | 'music';

/** Options for {@link AudioGraph}. */
export interface MixOptions {
  /** Player volume, 0..1. */
  readonly master?: number;
  readonly sfx?: number;
  readonly alarm?: number;
  readonly ambient?: number;
  /** The adaptive soundtrack's own level — its slider (GDD §4.9 item 3). */
  readonly music?: number;
  /** Concurrent one-shots. Beyond this, new ones are refused, not queued. */
  readonly maxVoices?: number;
  /** Minimum seconds between two plays of the *same* sound. */
  readonly repeatGap?: number;
  /** Seed for the pitch jitter, so a replay sounds like the match (GDD §4.1). */
  readonly seed?: number;
}

/** Defaults. Balance lives in the bank; these are the bus trims over it. */
export const MIX_DEFAULTS = {
  master: 0.8,
  sfx: 1,
  alarm: 0.9,
  ambient: 0.35,
  music: 0.5,
  maxVoices: 24,
  repeatGap: 0.035,
} as const;

/** A held voice — the firing loops, the thruster, the alarm, the ambient bed. */
export interface LoopHandle {
  /** Ramp this voice's gain over `seconds`. Ramped, because a jump clicks. */
  setGain(value: number, seconds?: number): void;
  /** Ramp the playback rate — the firing voices ride this with weapon power. */
  setRate(value: number, seconds?: number): void;
  /** Fade out and stop. The handle is dead afterwards. */
  stop(fadeSeconds?: number): void;
  readonly gain: number;
  readonly alive: boolean;
}

/** A one-shot in flight, tracked only so the voice cap can be enforced. */
interface Voice {
  source: BufferSourceLike;
  endsAt: number;
}

/**
 * The mix graph.
 *
 * Constructed against the {@link AudioContextLike} subset, so `audio.test.ts`
 * builds the whole thing against a plain object with no browser, no canvas and
 * no audio hardware — which is the "audio graph builds headless" gate, and the
 * same discipline the sim and the match server run under (GDD §4.1).
 */
export class AudioGraph {
  readonly ctx: AudioContextLike;
  /** Everything sums here; this is the player's volume. */
  readonly master: GainNodeLike;
  /** Downstream of master: the planet-death hush multiplies the whole mix. */
  readonly duck: GainNodeLike;
  readonly buses: Readonly<Record<Bus, GainNodeLike>>;

  private readonly buffers = new Map<string, AudioBufferLike>();
  private readonly voices: Voice[] = [];
  private readonly lastPlayed = new Map<SoundName, number>();
  private readonly maxVoices: number;
  private readonly repeatGap: number;
  private readonly rng: Rng;
  private live = true;
  private refusals = 0;

  /**
   * A bus's gain is `base × duck`: the player/settings level, times the alarm's
   * ducking multiplier. They are tracked apart so ducking under the alarm and
   * releasing after it can never overwrite the player's slider — the release
   * restores the *base*, not a hard-coded 1 (`./engine` syncAlarm).
   */
  private readonly base: Record<Bus, number>;
  private readonly busDuck: Record<Bus, number> = { sfx: 1, alarm: 1, ambient: 1, music: 1 };

  constructor(ctx: AudioContextLike, options: MixOptions = {}) {
    this.ctx = ctx;
    this.maxVoices = Math.max(1, options.maxVoices ?? MIX_DEFAULTS.maxVoices);
    this.repeatGap = Math.max(0, options.repeatGap ?? MIX_DEFAULTS.repeatGap);
    this.rng = mulberry32((options.seed ?? 0x50a17e5) >>> 0);

    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.duck.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = clamp01(options.master ?? MIX_DEFAULTS.master);
    this.master.connect(this.duck);

    this.base = {
      sfx: clamp01(options.sfx ?? MIX_DEFAULTS.sfx),
      alarm: clamp01(options.alarm ?? MIX_DEFAULTS.alarm),
      ambient: clamp01(options.ambient ?? MIX_DEFAULTS.ambient),
      music: clamp01(options.music ?? MIX_DEFAULTS.music),
    };
    this.buses = {
      sfx: this.bus(this.base.sfx),
      alarm: this.bus(this.base.alarm),
      ambient: this.bus(this.base.ambient),
      music: this.bus(this.base.music),
    };
  }

  /** Sample rate the bank is rendered at — the context's own, so nothing resamples. */
  get sampleRate(): number {
    return this.ctx.sampleRate > 0 ? this.ctx.sampleRate : DEFAULT_SAMPLE_RATE;
  }

  /** One-shots currently in flight. */
  get voiceCount(): number {
    this.prune();
    return this.voices.length;
  }

  /** Playbacks refused by the voice cap or the repeat gap. A visible number. */
  get refused(): number {
    return this.refusals;
  }

  /** Sounds rendered and cached so far. */
  get cached(): number {
    return this.buffers.size;
  }

  /**
   * Render and cache every sound in the bank.
   *
   * Optional — the cache fills lazily on first play — but worth doing behind the
   * unlock gesture (`./unlock`), because the one place a first-play render is
   * audible is the first explosion of the match, and that is the worst frame to
   * spend a few milliseconds on.
   */
  preload(): void {
    for (const name of SOUND_NAMES) this.buffer(name);
  }

  /** The player's volume, 0..1. */
  setMaster(value: number, seconds = 0.05): void {
    ramp(this.master.gain, clamp01(value), this.ctx.currentTime, seconds);
  }

  /**
   * A bus's base level, 0..1 — the player's setting: the music slider, the
   * ambient trim. Kept apart from the alarm duck ({@link setBusDuck}) so the two
   * multiply rather than clobber each other.
   */
  setBus(bus: Bus, value: number, seconds = 0.05): void {
    this.base[bus] = clamp01(value);
    ramp(this.buses[bus].gain, this.base[bus] * this.busDuck[bus], this.ctx.currentTime, seconds);
  }

  /**
   * A bus's alarm-duck multiplier, 0..1 — how far under the alarm it is pulled.
   * 1 is unducked. The gain rides `base × duck`, so releasing to 1 restores the
   * player's level, whatever they set it to (`./engine` syncAlarm, GDD §2.2).
   */
  setBusDuck(bus: Bus, factor: number, seconds = 0.3): void {
    this.busDuck[bus] = clamp01(factor);
    ramp(this.buses[bus].gain, this.base[bus] * this.busDuck[bus], this.ctx.currentTime, seconds);
  }

  /** A bus's current base (player) level, before the alarm duck. */
  busLevel(bus: Bus): number {
    return this.base[bus];
  }

  /**
   * The whole-mix multiplier: 1 normally, 0 through the planet-death hush.
   *
   * Set from `DeathMoment.gain` every frame (`../vfx/death-moment`). Assigned
   * rather than ramped because the moment already *is* a ramp — a shaped one,
   * with a fast cut and a slow return — and ramping a ramp would round off the
   * exact shape the tone contract asks for.
   */
  setDuck(value: number): void {
    this.duck.gain.value = clamp01(value);
  }

  /** The current hush multiplier. */
  get duckGain(): number {
    return this.duck.gain.value;
  }

  /**
   * Play a one-shot.
   *
   * Refused — and counted — when the voice cap is full or the same sound played
   * within {@link MixOptions.repeatGap}. Returns whether it started, so callers
   * that care (tests, the debug overlay) can see the difference between "played"
   * and "the mix was too busy".
   *
   * @param gain  Level 0..1 over the bank's own; scale it with the tell's magnitude.
   * @param rate  Playback rate. 1 is as rendered; {@link jitter} adds variety.
   */
  play(name: SoundName, gain = 1, rate = 1, bus: Bus = 'sfx'): boolean {
    if (!this.live) return false;
    const now = this.ctx.currentTime;
    this.prune();

    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < this.repeatGap) {
      this.refusals++;
      return false;
    }
    if (this.voices.length >= this.maxVoices) {
      this.refusals++;
      return false;
    }

    const buffer = this.buffer(name);
    const level = clamp01(gain);
    if (level <= 0) return false;

    const node = this.ctx.createGain();
    node.gain.value = level;
    node.connect(this.buses[bus]);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const speed = rate > 0 ? rate : 1;
    source.playbackRate.value = speed;
    source.connect(node);
    source.start(now);

    this.lastPlayed.set(name, now);
    this.voices.push({ source, endsAt: now + buffer.duration / speed + 0.05 });
    return true;
  }

  /**
   * Start a held voice and return its handle.
   *
   * Loop buffers are joined tail-to-head when rendered (`./synth` seamless), so
   * `loop = true` here is genuinely gapless rather than merely repeated.
   */
  startLoop(name: SoundName, gain = 0, bus: Bus = 'sfx', rate = 1): LoopHandle {
    const buffer = this.buffer(name);
    const node = this.ctx.createGain();
    node.gain.value = clamp01(gain);
    node.connect(this.buses[bus]);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    source.playbackRate.value = rate > 0 ? rate : 1;
    source.connect(node);
    source.start(this.ctx.currentTime);

    return new Loop(this.ctx, source, node);
  }

  /**
   * A deterministic playback-rate jitter around 1.
   *
   * Repetition is what makes synthesized audio sound cheap: the twentieth
   * identical rock crack is noise, the twentieth slightly different one is
   * texture. Drawn from ratified mulberry32, never `Math.random`, so a replay
   * sounds like the match it replays (GDD §4.1).
   *
   * @param amount Half-width of the range, e.g. 0.08 → rates in [0.92, 1.08].
   */
  jitter(amount = 0.06): number {
    return 1 + (this.rng.next() * 2 - 1) * amount;
  }

  /** Stop everything and drop the graph. A match teardown, or a page hide. */
  dispose(): void {
    this.live = false;
    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {
        // A source that already ended throws on some engines. Nothing to do.
      }
      voice.source.disconnect();
    }
    this.voices.length = 0;
    for (const bus of Object.values(this.buses)) bus.disconnect();
    this.master.disconnect();
    this.duck.disconnect();
  }

  /** The rendered buffer for a sound, cached across every playback of it. */
  private buffer(name: SoundName): AudioBufferLike {
    const key = `${name}:${this.sampleRate}`;
    const hit = this.buffers.get(key);
    if (hit) return hit;
    const buffer = toAudioBuffer(this.ctx, renderSound(soundSpec(name), this.sampleRate), this.sampleRate);
    this.buffers.set(key, buffer);
    return buffer;
  }

  private bus(gain: number): GainNodeLike {
    const node = this.ctx.createGain();
    node.gain.value = gain;
    node.connect(this.master);
    return node;
  }

  /**
   * Retire finished one-shots by their scheduled end time.
   *
   * Deliberately not `source.onended`: a callback per voice is a closure per
   * voice, and the end time is already known exactly — buffer length over
   * playback rate — so the cheap way is also the precise one.
   */
  private prune(): void {
    const now = this.ctx.currentTime;
    let kept = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i]!;
      if (voice.endsAt > now) {
        this.voices[kept++] = voice;
      } else {
        voice.source.disconnect();
      }
    }
    this.voices.length = kept;
  }
}

/** Render a bank entry to samples: one voice, or a stack, looped or not. */
export function renderSound(spec: SoundSpec, sampleRate: number = DEFAULT_SAMPLE_RATE): Float32Array {
  const looped = loops(spec);
  const options = looped ? { edges: false } : {};
  const samples = isLayered(spec)
    ? renderLayered(spec.layers, sampleRate, options)
    : renderVoice(spec, sampleRate, options);
  if (!looped) return samples;
  const crossfade = (isLayered(spec) ? spec.crossfade : undefined) ?? 0.04;
  return seamless(samples, sampleRate, crossfade);
}

// ---------------------------------------------------------------------------

class Loop implements LoopHandle {
  private stopped = false;
  /** The gain most recently *asked* for. The node's own value is mid-ramp. */
  private target: number;

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly source: BufferSourceLike,
    private readonly node: GainNodeLike,
  ) {
    this.target = node.gain.value;
  }

  get gain(): number {
    return this.target;
  }

  get alive(): boolean {
    return !this.stopped;
  }

  setGain(value: number, seconds = 0.05): void {
    if (this.stopped) return;
    this.target = clamp01(value);
    ramp(this.node.gain, this.target, this.ctx.currentTime, seconds);
  }

  setRate(value: number, seconds = 0.05): void {
    if (this.stopped) return;
    ramp(this.source.playbackRate, value > 0 ? value : 1, this.ctx.currentTime, seconds);
  }

  stop(fadeSeconds = 0.06): void {
    if (this.stopped) return;
    this.stopped = true;
    this.target = 0;
    const now = this.ctx.currentTime;
    ramp(this.node.gain, 0, now, fadeSeconds);
    try {
      this.source.stop(now + fadeSeconds);
    } catch {
      // Already stopped. Harmless.
    }
  }
}

/**
 * Ramp a param from wherever it is to `value`.
 *
 * The `setValueAtTime(param.value, now)` before the ramp is not ceremony:
 * without an anchor point, `linearRampToValueAtTime` interpolates from the
 * *previous* scheduled event, so a fade started during an earlier fade jumps to
 * that earlier fade's target first. Zero-length ramps assign instead, because a
 * ramp ending at `now` is a no-op on some engines.
 *
 * Nothing assigns `param.value` *after* scheduling: in Web Audio that is
 * shorthand for `setValueAtTime(v, now)`, which would cancel the ramp that was
 * the entire point. Callers that need to know the target keep it themselves.
 */
function ramp(param: AudioParamLike, value: number, now: number, seconds: number): void {
  if (seconds <= 0) {
    param.cancelScheduledValues(now);
    param.value = value;
    return;
  }
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
