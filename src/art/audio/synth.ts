/**
 * src/art/audio/synth.ts — sounds as numbers. OWNER: Art & Audio Agent.
 *
 * The brief asks for *"synthesized SFX (jsfxr-style)"* (GDD §3.6), and the
 * reason it asks for that rather than a folder of `.wav` files is the same
 * reason the sprites are functions: **art is code** — reproducible, diffable,
 * licence-clean, regenerable offline (GDD §4.5, §4.8). A sound here is a struct
 * of about twenty numbers ({@link VoiceSpec}); the whole game's audio is a few
 * kilobytes of source and no binary assets at all.
 *
 * ## Why it renders offline into a Float32Array
 *
 * {@link renderVoice} is a pure function: spec in, samples out, no context, no
 * clock, no globals. That is what lets the entire sound design be tested
 * headless — amplitude bounds, envelope shape, determinism, the fact that a
 * spec never produces a NaN and never clicks — on a CI box with no audio
 * hardware. The Web Audio graph (`./graph`) then only has to *play* buffers,
 * which is why its node subset is as small as it is (`./context`).
 *
 * It also means the synthesis is deterministic: noise is drawn from the ratified
 * mulberry32 (`@shared/types`), never `Math.random`, so the explosion in a
 * replay is sample-for-sample the explosion in the match (GDD §4.1).
 *
 * ## The model
 *
 * A jsfxr-shaped monophonic voice, in the order the signal flows:
 *
 * ```
 *   frequency  ── glide ── vibrato ── arpeggio ─┐
 *                                               ▼
 *   oscillator (square / saw / triangle / sine / pitched noise)
 *                                               │
 *   ADSR-ish envelope (attack · hold+punch · decay)
 *                                               │
 *   one-pole low-pass ── one-pole high-pass ── clamp ── edge fades
 * ```
 *
 * There is no filter node, no oscillator node and no worklet anywhere in the
 * game: all of this happens once, on the CPU, at load.
 */

import { mulberry32 } from '@shared/types';

/** The five oscillator shapes. */
export type Wave =
  /** Hollow and arcade — the default voice of a toy (tone contract, §8). */
  | 'square'
  /** Bright and rude: firing voices, alarms. */
  | 'saw'
  /** Soft: ambience, the mote-quiet end of the set. */
  | 'sine'
  /** Between the two: builds, confirmations. */
  | 'triangle'
  /** Pitched sample-and-hold noise: rock, explosions, grinding. */
  | 'noise';

/**
 * One synthesized sound.
 *
 * Times are seconds and frequencies are Hz — no normalised 0..1 parameters, so
 * a spec reads as a description of a sound rather than as slider positions.
 * Total length is `attack + hold + decay`, which is why there is no separate
 * duration field to contradict them.
 */
export interface VoiceSpec {
  /** Name, for the bank index, test failures and the debug overlay. */
  readonly name: string;
  readonly wave: Wave;

  // --- Envelope ------------------------------------------------------------
  /** Rise to full, seconds. Small but never zero: 0 would click. */
  readonly attack: number;
  /** Time at full, seconds. */
  readonly hold: number;
  /** Fall to silence, seconds. */
  readonly decay: number;
  /** Extra gain at the start of `hold`, decaying across it. Adds a transient. */
  readonly punch?: number;

  // --- Pitch ---------------------------------------------------------------
  /** Starting frequency, Hz. */
  readonly freq: number;
  /** Frequency at the end of the sound, Hz — an exponential glide. */
  readonly freqEnd?: number;
  /** Floor the glide stops at, Hz. A sound that falls to 0 Hz is a click. */
  readonly freqMin?: number;
  /** Vibrato depth as a fraction of the current frequency, 0..1. */
  readonly vibratoDepth?: number;
  /** Vibrato rate, Hz. */
  readonly vibratoRate?: number;
  /** Frequency multiplier applied once, at {@link arpTime}. The arcade "blip up". */
  readonly arpMul?: number;
  /** When the arpeggio step lands, seconds from the start. */
  readonly arpTime?: number;
  /** Restart the pitch envelope every this many seconds — jsfxr's repeat. */
  readonly repeat?: number;

  // --- Timbre --------------------------------------------------------------
  /** Square duty cycle, 0..1 (`square` only). 0.5 is a plain square. */
  readonly duty?: number;
  /** Duty change per second (`square` only) — the classic sweeping buzz. */
  readonly dutySweep?: number;
  /** Blend of noise over the tonal wave, 0..1. Grit without going full noise. */
  readonly noiseMix?: number;
  /** One-pole low-pass cutoff, Hz. Omit for none. */
  readonly lowPass?: number;
  /** One-pole high-pass cutoff, Hz. Omit for none. */
  readonly highPass?: number;

  // --- Level ---------------------------------------------------------------
  /** Peak amplitude, 0..1. Bank-level balance lives here, not in the mix. */
  readonly gain: number;
  /** Noise seed. Same seed, same sound, on every engine (GDD §4.1). */
  readonly seed?: number;
}

/** Sample rate everything is rendered at when a context has not said otherwise. */
export const DEFAULT_SAMPLE_RATE = 44100;

/** Seconds of fade at each end of a rendered sound, so an edge can never click. */
export const EDGE_FADE_S = 0.0015;

/** Entries in the sample-and-hold noise table — jsfxr's pitched-noise trick. */
const NOISE_TABLE = 32;

/** Total length of a voice in seconds. */
export function voiceDuration(spec: VoiceSpec): number {
  return Math.max(0, spec.attack) + Math.max(0, spec.hold) + Math.max(0, spec.decay);
}

/** Knobs on the rendering itself rather than on the sound. */
export interface RenderOptions {
  /**
   * Fade the first and last few samples (default true). Turned **off** for
   * anything destined to loop, where the edges are joined by {@link seamless}
   * instead — a fade at both ends of a loop is an audible pulse once per lap.
   */
  readonly edges?: boolean;
}

/**
 * Render one voice to mono samples.
 *
 * Pure: same spec and sample rate in, deep-equal `Float32Array` out, on any
 * engine. The output is clamped to [-1, 1] and faded at both edges, so no spec —
 * including a badly tuned one — can produce a click or an out-of-range sample
 * that a browser would clip on its own terms.
 */
export function renderVoice(
  spec: VoiceSpec,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
  options: RenderOptions = {},
): Float32Array {
  const rate = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
  const duration = voiceDuration(spec);
  const total = Math.max(1, Math.round(duration * rate));
  const out = new Float32Array(total);

  const attack = Math.max(0, spec.attack);
  const hold = Math.max(0, spec.hold);
  const decay = Math.max(0, spec.decay);
  const punch = spec.punch ?? 0;
  const gain = clamp(spec.gain, 0, 1);

  const freq0 = Math.max(1, spec.freq);
  const freq1 = Math.max(1, spec.freqEnd ?? spec.freq);
  const freqMin = Math.max(0.5, spec.freqMin ?? 8);
  const vibDepth = clamp(spec.vibratoDepth ?? 0, 0, 1);
  const vibRate = Math.max(0, spec.vibratoRate ?? 0);
  const arpMul = spec.arpMul ?? 1;
  const arpTime = spec.arpTime ?? Infinity;
  const repeat = spec.repeat && spec.repeat > 0 ? spec.repeat : Infinity;
  const noiseMix = clamp(spec.noiseMix ?? (spec.wave === 'noise' ? 1 : 0), 0, 1);

  // One-pole coefficients. The two filters do **not** share a mapping: a
  // low-pass smooths toward the input (`1 - exp(-2π fc/sr)`, which tends to 0 as
  // the cutoff falls), while an RC high-pass differentiates and its coefficient
  // tends to 1. Using the low-pass number for both is the classic mistake, and
  // it costs about 25 dB on every sound that names a `highPass`.
  const lpA = spec.lowPass ? onePoleLow(spec.lowPass, rate) : 1;
  const hpA = spec.highPass ? onePoleHigh(spec.highPass, rate) : 0;

  const rng = mulberry32((spec.seed ?? 1) >>> 0);
  const noise = new Float32Array(NOISE_TABLE);
  for (let i = 0; i < NOISE_TABLE; i++) noise[i] = rng.next() * 2 - 1;

  let phase = 0;
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  let duty = clamp(spec.duty ?? 0.5, 0.01, 0.99);

  for (let i = 0; i < total; i++) {
    const t = i / rate;

    // --- Pitch -------------------------------------------------------------
    // The glide restarts on every repeat period, which is what turns one spec
    // into a stuttering alarm or a machine-gun rattle rather than one long fall.
    const cycle = repeat === Infinity ? t : t % repeat;
    const span = repeat === Infinity ? Math.max(duration, 1e-6) : repeat;
    const p = clamp(cycle / span, 0, 1);
    // Exponential rather than linear: pitch is perceived in ratios, so a linear
    // sweep sounds like it slows down as it falls.
    let f = freq0 * Math.pow(freq1 / freq0, p);
    if (t >= arpTime) f *= arpMul;
    if (vibDepth > 0 && vibRate > 0) f *= 1 + vibDepth * Math.sin(2 * Math.PI * vibRate * t);
    if (f < freqMin) f = freqMin;

    // --- Oscillator --------------------------------------------------------
    const step = f / rate;
    const wrapped = phase + step >= 1;
    phase = (phase + step) % 1;
    if (wrapped) {
      // Re-roll the table on each cycle: noise pitched by the wrap rate.
      for (let n = 0; n < NOISE_TABLE; n++) noise[n] = rng.next() * 2 - 1;
    }
    if (spec.dutySweep) duty = clamp(duty + spec.dutySweep / rate, 0.01, 0.99);

    let sample = oscillate(spec.wave, phase, duty, noise);
    if (noiseMix > 0 && spec.wave !== 'noise') {
      const n = noise[Math.min(NOISE_TABLE - 1, (phase * NOISE_TABLE) | 0)] ?? 0;
      sample = sample * (1 - noiseMix) + n * noiseMix;
    }

    // --- Envelope ----------------------------------------------------------
    let env: number;
    if (t < attack) {
      env = attack > 0 ? t / attack : 1;
    } else if (t < attack + hold) {
      const h = hold > 0 ? (t - attack) / hold : 1;
      env = 1 + punch * (1 - h);
    } else {
      const d = decay > 0 ? (t - attack - hold) / decay : 1;
      env = Math.max(0, 1 - d);
    }

    // --- Filters -----------------------------------------------------------
    let v = sample * env * gain;
    if (lpA < 1) {
      lp += (v - lp) * lpA;
      v = lp;
    }
    if (hpA > 0) {
      hpOut = hpA * (hpOut + v - hpPrev);
      hpPrev = v;
      v = hpOut;
    }

    out[i] = clamp(v, -1, 1);
  }

  if (options.edges !== false) fadeEdges(out, rate);
  return out;
}

/**
 * Join a rendered signal's tail onto its head so it loops without a seam.
 *
 * The ambient bed, the thruster, the alarm and the soundtrack's stems all run as
 * looping buffer sources, and a loop point is the one place a click is guaranteed rather than
 * merely likely: the player hears it once per lap, forever. Crossfading the last
 * `crossfade` seconds over the first and dropping them from the end makes the
 * end sample continuous with the start sample by construction.
 *
 * Returns a new, shorter buffer; the input is left alone.
 */
export function seamless(samples: Float32Array, sampleRate: number, crossfade = 0.05): Float32Array {
  const c = Math.min(Math.floor(crossfade * sampleRate), Math.floor(samples.length / 2));
  if (c <= 0) return samples.slice();
  const out = samples.slice(0, samples.length - c);
  for (let i = 0; i < c; i++) {
    const k = i / c;
    const head = samples[i] ?? 0;
    const tail = samples[samples.length - c + i] ?? 0;
    out[i] = head * k + tail * (1 - k);
  }
  return out;
}

/**
 * Mix one signal into another at an offset, in place.
 *
 * The layered sounds — the two-tone alarm, the planet-death fall, the ambient
 * bed — are built by rendering their parts and stacking them here, rather than
 * by growing the voice model into a small modular synth nobody can tune.
 */
export function mixInto(target: Float32Array, source: Float32Array, offsetSamples = 0, level = 1): Float32Array {
  const start = Math.max(0, Math.round(offsetSamples));
  const n = Math.min(source.length, target.length - start);
  for (let i = 0; i < n; i++) {
    target[start + i] = clamp((target[start + i] ?? 0) + (source[i] ?? 0) * level, -1, 1);
  }
  return target;
}

/** Render several voices, each at its own offset, into one buffer. */
export function renderLayered(
  layers: readonly { readonly spec: VoiceSpec; readonly at?: number; readonly level?: number }[],
  sampleRate: number = DEFAULT_SAMPLE_RATE,
  options: RenderOptions = {},
): Float32Array {
  const rate = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
  let length = 1;
  for (const layer of layers) {
    const end = Math.round(((layer.at ?? 0) + voiceDuration(layer.spec)) * rate);
    if (end > length) length = end;
  }
  const out = new Float32Array(length);
  for (const layer of layers) {
    mixInto(
      out,
      renderVoice(layer.spec, rate, options),
      Math.round((layer.at ?? 0) * rate),
      layer.level ?? 1,
    );
  }
  if (options.edges !== false) fadeEdges(out, rate);
  return out;
}

/** Peak absolute amplitude — a test assertion, and the bank's balance check. */
export function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > max) max = v;
  }
  return max;
}

/** Root-mean-square level. Loudness as heard, rather than as peaked. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

// ---------------------------------------------------------------------------

function oscillate(wave: Wave, phase: number, duty: number, noise: Float32Array): number {
  switch (wave) {
    case 'square':
      return phase < duty ? 1 : -1;
    case 'saw':
      return 1 - 2 * phase;
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'sine':
      return Math.sin(2 * Math.PI * phase);
    case 'noise':
      return noise[Math.min(NOISE_TABLE - 1, (phase * NOISE_TABLE) | 0)] ?? 0;
  }
}

/** Smoothing factor for `y += (x - y) · a`. Falls toward 0 as the cutoff falls. */
function onePoleLow(cutoffHz: number, sampleRate: number): number {
  return clamp(1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate), 0, 1);
}

/** RC factor for `y = a · (y + x - x₋₁)`. Rises toward 1 as the cutoff falls. */
function onePoleHigh(cutoffHz: number, sampleRate: number): number {
  return clamp(1 / (1 + (2 * Math.PI * cutoffHz) / sampleRate), 0, 1);
}

/**
 * Fade the first and last few samples. A buffer that starts or ends on a
 * non-zero sample is a step discontinuity, and a step discontinuity is a click
 * on every device — the one artefact that makes synthesized audio sound cheap.
 */
export function fadeEdges(samples: Float32Array, sampleRate: number): void {
  const n = Math.min(Math.floor(EDGE_FADE_S * sampleRate), Math.floor(samples.length / 2));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    samples[i] = (samples[i] ?? 0) * k;
    const j = samples.length - 1 - i;
    samples[j] = (samples[j] ?? 0) * k;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}
