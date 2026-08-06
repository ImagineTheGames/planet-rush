/**
 * src/art/audio/context.ts — the Web Audio seam. OWNER: Art & Audio Agent.
 *
 * `src/art/vfx/` puts every line that touches PixiJS in one file (`vfx/layer`)
 * so the whole effects system tests headless. Audio gets the same treatment for
 * the same reason, and one extra: the match server and the QA harness run the
 * game with "no GPU, no canvas, no window" (GDD §4.1), and there is no
 * `AudioContext` in any of them either.
 *
 * So nothing in `src/art/audio/` references a browser global. Everything is
 * written against the **structural subset** below — the eight or so calls the
 * mix actually makes — and a real `AudioContext` satisfies it without being
 * named. That buys three things:
 *
 *  1. `audio.test.ts` builds the entire graph against a plain object and
 *     asserts its shape, which is the "audio graph builds headless" gate.
 *  2. A headless run costs nothing: {@link AudioEngine} with no context is a
 *     no-op, so bots playing 8-slot matches in CI do not need a stub.
 *  3. Safari's and Chrome's differences live in one adapter
 *     ({@link openAudioContext}) rather than through the sound bank.
 *
 * The subset is deliberately tiny — gain nodes, buffer sources, and buffers.
 * Every sound in the game is synthesized to a `Float32Array` by `./synth` on the
 * CPU, so the graph never needs an oscillator, a filter node, or a worklet: the
 * interesting DSP already happened, offline and deterministically.
 */

// ---------------------------------------------------------------------------
// The subset
// ---------------------------------------------------------------------------

/**
 * The scheduling half of an `AudioParam`.
 *
 * Ramps are used rather than bare `value =` assignments wherever a change would
 * otherwise click: a gain jumping between two sample values is a step
 * discontinuity, and a step discontinuity is audible as a tick on every device.
 */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}

/** Anything the mix can connect into: a gain node, or the destination. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): unknown;
}

/** A gain node — the workhorse processing node of the mix. */
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/**
 * A stereo panner — the one spatial node the mix uses. Placing a sound left or
 * right of the camera is the audible half of *"I can hear every single thing on
 * the map"* (ratified a3-03); `../spatial` computes the value, this applies it.
 */
export interface StereoPannerNodeLike extends AudioNodeLike {
  /** −1 hard left … 0 centred … +1 hard right. */
  readonly pan: AudioParamLike;
}

/**
 * A lowpass biquad — the optional distance filter (`../spatial`). Far things lose
 * their highs, so distance *feels* like distance; the mix only builds one once a
 * sound is far enough to actually muffle, so the near field pays nothing for it.
 */
export interface BiquadFilterNodeLike extends AudioNodeLike {
  /** Set to `'lowpass'`. Typed as a plain string so the subset names no enum. */
  type: string;
  readonly frequency: AudioParamLike;
}

/**
 * A convolver — the one shared room behind the UI cue set (`./ui-cues`).
 *
 * The single exception to *"the interesting DSP already happened, offline"*, and
 * a deliberate one: the Gantry/Bone handoff specifies **one short shared reverb**
 * behind all nine cues, and convolving its 2.2-second impulse into every cue on
 * the CPU would cost a phone hundreds of milliseconds at unlock to reproduce
 * something one native node does for free. It is **optional** on the context
 * below, so a webview without it plays the cues dry rather than not at all.
 */
export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  /** Web Audio normalises an impulse by default; the room is authored for that. */
  normalize: boolean;
}

/** A rendered mono sound, ready to play. */
export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** A one-shot (or looping) player for one {@link AudioBufferLike}. */
export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

/**
 * The subset of `AudioContext` the mix uses. A real one satisfies this
 * structurally — `audio.test.ts` asserts exactly that with a type-level
 * assignment, so a browser API change breaks the build rather than the mobile
 * build only (GDD risk 7).
 */
export interface AudioContextLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  /** `suspended` until a user gesture resumes it — see `./unlock` (risk 7). */
  readonly state: string;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  /** Spatial pan (`../spatial`). Universally supported; no webkit-prefix dance. */
  createStereoPanner(): StereoPannerNodeLike;
  /** The optional distance lowpass (`../spatial`), built only when it muffles. */
  createBiquadFilter(): BiquadFilterNodeLike;
  /**
   * The UI cue set's shared room (`./ui-cues`). **Optional** — the one call in
   * the subset that a context is allowed not to have, because a context that
   * lacks it should cost the player a reverb tail and nothing else.
   */
  createConvolver?(): ConvolverNodeLike;
  resume(): Promise<void>;
}

/** A constructor for one. Both `AudioContext` and `webkitAudioContext` fit. */
export type AudioContextCtor = new () => AudioContextLike;

// ---------------------------------------------------------------------------
// Opening one, without naming a global
// ---------------------------------------------------------------------------

/**
 * The window fields {@link openAudioContext} looks for. Declared as a shape
 * rather than reached for through `globalThis.window`, because `src/art/` must
 * not depend on a browser existing — in Node both are simply absent.
 */
export interface AudioGlobals {
  readonly AudioContext?: AudioContextCtor;
  /** Older iOS Safari. Present until the prefix was dropped, and still shipping
   *  on devices the classroom will open the game on. */
  readonly webkitAudioContext?: AudioContextCtor;
}

/**
 * Construct an audio context, or return `null` where there is none.
 *
 * Never throws. A browser that refuses to construct one (an obscure privacy
 * mode, a locked-down webview) costs the player sound and nothing else — the
 * game keeps its visible tells, and every audible one has a visible twin by
 * construction (GDD §3.6).
 *
 * @param globals Injectable for tests; defaults to `globalThis`.
 */
export function openAudioContext(globals: AudioGlobals = globalThis as AudioGlobals): AudioContextLike | null {
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/**
 * Copy a rendered mono signal into a context-owned buffer.
 *
 * The synth works in plain `Float32Array`s (`./synth`) precisely so the sounds
 * can be rendered, tested and compared with no context at all; this is the one
 * place a rendered sound crosses into the audio hardware's world.
 */
export function toAudioBuffer(ctx: AudioContextLike, samples: Float32Array, sampleRate: number): AudioBufferLike {
  const buffer = ctx.createBuffer(1, Math.max(1, samples.length), sampleRate);
  const channel = buffer.getChannelData(0);
  channel.set(samples.subarray(0, channel.length));
  return buffer;
}
