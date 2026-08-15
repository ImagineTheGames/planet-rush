/**
 * The audible half of the mandate, checked headless.
 *
 * Two gates the brief names by hand, and one it implies:
 *
 *  1. **The audio graph builds headless.** Every test in this file runs against
 *     {@link FakeAudioContext} — a plain object implementing the small subset in
 *     `./context` — on a CI box with no audio hardware, in the same `node`
 *     environment the match server and the QA harness run in (GDD §4.1). A
 *     type-level assertion checks that a *real* `AudioContext` satisfies that
 *     same subset, so the fake cannot drift away from the thing it stands in for.
 *  2. **Every mechanic has an audible tell** (GDD §3.6): the routing is walked
 *     kind by kind, and a `null` in the map has to be one of the three
 *     documented held states rather than a mechanic someone forgot.
 *  3. **The alarm is sustained-damage only** (GDD §2.2): *"not a single stray
 *     shot — a taunt-tap must not trigger it."* That sentence is a test.
 */

import { describe, expect, it } from 'vitest';
import { TELL, TELL_NAMES, TellQueue, type TellKind } from '../tells';
import { DeathMoment, HUSH_S } from '../vfx/death-moment';
import { ENGAGE, LEAK, MIN_HOLD_S, UnderAttackAlarm, WEIGHTS } from './alarm';
import { SustainedVoice } from './weapons';
import {
  CUE_SOUND,
  isLayered,
  loops,
  SOUND,
  SOUND_NAMES,
  SUSTAINED_TELLS,
  soundSpec,
  TELL_SOUND,
  XP_TICK_SEMITONES,
  XP_TICK_STEPS_MAX,
  type AudioCue,
  type SoundName,
} from './bank';
import {
  openAudioContext,
  toAudioBuffer,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BiquadFilterNodeLike,
  type BufferSourceLike,
  type GainNodeLike,
  type StereoPannerNodeLike,
} from './context';
import {
  ALARM_DUCK_S,
  AMBIENT_FADE_IN_S,
  AudioEngine,
  EARSHOT_FAR,
  EARSHOT_NEAR,
  XP_FILL_DUCK,
  XP_FILL_DUCK_S,
  XP_FILL_GAIN,
} from './engine';
import { AudioGraph, MIX_DEFAULTS, renderSound } from './graph';
import {
  cutoffFor,
  falloff,
  panFor,
  place,
  LP_BYPASS_HZ,
  LP_FAR_HZ,
  LP_NEAR_HZ,
  PAN_WIDTH,
  R_FAR,
  R_NEAR,
} from './spatial';
import { MusicDirector, MusicScore, MUSIC_COMBAT, SIEGE_ON, STING_GATE } from './music';
import { DEFAULT_SAMPLE_RATE, peak, renderVoice, rms, seamless, voiceDuration, type VoiceSpec } from './synth';
import { AudioUnlock, defaultUnlockTarget, UNLOCK_EVENTS, type UnlockTarget } from './unlock';

// ---------------------------------------------------------------------------
// A headless AudioContext
// ---------------------------------------------------------------------------

class FakeParam implements AudioParamLike {
  value: number;
  /** Every scheduled event, so a test can prove a fade was ramped, not jumped. */
  readonly events: { kind: string; value: number; time: number }[] = [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.events.push({ kind: 'set', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.events.push({ kind: 'ramp', value, time: endTime });
  }

  cancelScheduledValues(startTime: number): void {
    this.events.push({ kind: 'cancel', value: 0, time: startTime });
  }
}

class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  disconnected = 0;

  connect(destination: AudioNodeLike): void {
    this.outputs.push(destination);
  }

  disconnect(): void {
    this.disconnected++;
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
}

class FakePanner extends FakeNode implements StereoPannerNodeLike {
  readonly pan = new FakeParam(0);
}

class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type = 'lowpass';
  readonly frequency = new FakeParam(20000);
}

class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  starts = 0;
  stops = 0;

  start(): void {
    this.starts++;
  }

  stop(): void {
    this.stops++;
  }
}

class FakeBuffer implements AudioBufferLike {
  readonly numberOfChannels = 1;
  private readonly data: Float32Array;

  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeAudioContext implements AudioContextLike {
  sampleRate = DEFAULT_SAMPLE_RATE;
  currentTime = 0;
  state = 'running';
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly panners: FakePanner[] = [];
  readonly filters: FakeBiquad[] = [];
  resumes = 0;

  createGain(): GainNodeLike {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBufferSource(): BufferSourceLike {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }

  createStereoPanner(): StereoPannerNodeLike {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    const node = new FakeBiquad();
    this.filters.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(length, sampleRate);
  }

  async resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
  }

  /** Move the clock, the way a browser would between frames. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

/**
 * The compile-time half: a real `AudioContext` satisfies the subset the whole
 * module is written against. If a browser API shifts, this fails `tsc` rather
 * than failing silently on a phone (GDD risk 7).
 */
type RealSatisfiesSubset = AudioContext extends AudioContextLike ? true : false;
const REAL_CONTEXT_FITS: RealSatisfiesSubset = true;

const ALL_KINDS: TellKind[] = Object.values(TELL);

// ---------------------------------------------------------------------------
// Spectral measurement — the s7-02 re-voice's evidence
// ---------------------------------------------------------------------------
//
// The re-voice (GDD §4.7 as amended 2026-08-06, `docs/audio-revoice-spec.md`) is
// judged by ear but *asserted* by number, and the numbers are the audit's: the
// working implementations below are copied from `spikes/tone-audit/`, not
// imported from it. A test may not depend on a throwaway spike — but it also may
// not measure a different thing than the document it is enforcing, so these are
// deliberately the same arithmetic rather than a tidier equivalent.

/** In-place iterative radix-2 FFT. Lengths are powers of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]!;
        const uIm = im[i + k]!;
        const vRe = re[i + k + len / 2]! * curRe - im[i + k + len / 2]! * curIm;
        const vIm = re[i + k + len / 2]! * curIm + im[i + k + len / 2]! * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** The FFT_N-sample window with the most energy, zero-padded if the sound is shorter. */
function loudestWindow(samples: Float32Array, n: number): Float32Array {
  if (samples.length <= n) {
    const out = new Float32Array(n);
    out.set(samples);
    return out;
  }
  const step = Math.max(1, Math.floor(n / 4));
  let best = 0;
  let bestEnergy = -1;
  for (let start = 0; start + n <= samples.length; start += step) {
    let e = 0;
    for (let i = start; i < start + n; i++) {
      const v = samples[i] ?? 0;
      e += v * v;
    }
    if (e > bestEnergy) {
      bestEnergy = e;
      best = start;
    }
  }
  return samples.slice(best, best + n);
}

/** Hann-windowed magnitude spectrum of the loudest window, and its bin width in Hz. */
function spectrum(samples: Float32Array): { mag: Float64Array; binHz: number } {
  const N = 8192;
  const frame = loudestWindow(samples, N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    // Hann: without it the frame edges are a step and every bin smears.
    re[i] = (frame[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k] ?? 0, im[k] ?? 0);
  return { mag, binHz: DEFAULT_SAMPLE_RATE / N };
}

/**
 * Spectral centroid in Hz — the amplitude-weighted mean frequency, and the single
 * closest number to *"how bright is this"*. Magnitude-weighted rather than
 * power-weighted: magnitude tracks perceived brightness more evenly across the
 * very different levels in this bank.
 */
function spectralCentroidHz(samples: Float32Array): number {
  const { mag, binHz } = spectrum(samples);
  let num = 0;
  let den = 0;
  for (let k = 1; k < mag.length; k++) {
    num += (mag[k] ?? 0) * k * binHz;
    den += mag[k] ?? 0;
  }
  return den > 0 ? num / den : 0;
}

/** Share of spectral energy in `[lo, hi)` Hz, 0..1. */
function bandShare(samples: Float32Array, lo: number, hi: number): number {
  const { mag, binHz } = spectrum(samples);
  let band = 0;
  let total = 0;
  for (let k = 1; k < mag.length; k++) {
    const e = (mag[k] ?? 0) ** 2;
    total += e;
    if (k * binHz >= lo && k * binHz < hi) band += e;
  }
  return total > 0 ? band / total : 0;
}

/** Zero crossings per sample over the whole buffer — the cheap brightness proxy. */
function zeroCrossingRate(samples: Float32Array): number {
  let n = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
  }
  return samples.length > 0 ? n / samples.length : 0;
}

/** Drive an engine for `seconds` at 60 Hz, advancing the fake clock with it. */
function run(engine: AudioEngine, ctx: FakeAudioContext, seconds: number, each?: () => void): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    each?.();
    engine.update(dt);
    ctx.advance(dt);
  }
}

// ---------------------------------------------------------------------------

describe('the Web Audio seam (`./context`)', () => {
  it('is a subset a real AudioContext satisfies', () => {
    expect(REAL_CONTEXT_FITS).toBe(true);
  });

  it('returns null where there is no audio at all — Node, the server, the harness', () => {
    expect(openAudioContext({})).toBeNull();
  });

  it('prefers AudioContext, falls back to the webkit prefix (older iOS)', () => {
    const made: string[] = [];
    const Standard = class {
      constructor() {
        made.push('standard');
      }
    } as unknown as new () => AudioContextLike;
    const Webkit = class {
      constructor() {
        made.push('webkit');
      }
    } as unknown as new () => AudioContextLike;

    openAudioContext({ AudioContext: Standard, webkitAudioContext: Webkit });
    openAudioContext({ webkitAudioContext: Webkit });
    expect(made).toEqual(['standard', 'webkit']);
  });

  it('never throws when the browser refuses — sound is lost, the game is not', () => {
    const Broken = class {
      constructor() {
        throw new Error('nope');
      }
    } as unknown as new () => AudioContextLike;
    expect(openAudioContext({ AudioContext: Broken })).toBeNull();
  });

  it('copies rendered samples into a context buffer', () => {
    const ctx = new FakeAudioContext();
    const samples = new Float32Array([0.5, -0.5, 0.25]);
    const buffer = toAudioBuffer(ctx, samples, 44100);
    expect(buffer.length).toBe(3);
    expect([...buffer.getChannelData(0)]).toEqual([0.5, -0.5, 0.25]);
  });
});

describe('the synth (`./synth`) — sounds as numbers', () => {
  const bleep: VoiceSpec = {
    name: 'test',
    wave: 'square',
    attack: 0.01,
    hold: 0.05,
    decay: 0.1,
    freq: 440,
    freqEnd: 220,
    gain: 0.5,
    seed: 7,
  };

  it('renders the length the envelope adds up to', () => {
    expect(voiceDuration(bleep)).toBeCloseTo(0.16, 6);
    expect(renderVoice(bleep, 48000).length).toBe(Math.round(0.16 * 48000));
  });

  it('is pure — same spec, same samples, on any engine (GDD §4.1)', () => {
    expect([...renderVoice(bleep)]).toEqual([...renderVoice(bleep)]);
    const noisy: VoiceSpec = { ...bleep, wave: 'noise' };
    expect([...renderVoice(noisy)]).toEqual([...renderVoice(noisy)]);
    // …and a different seed is a different sound, so the seed is load-bearing.
    expect([...renderVoice(noisy)]).not.toEqual([...renderVoice({ ...noisy, seed: 8 })]);
  });

  it('never produces a NaN, an infinity or an out-of-range sample', () => {
    for (const name of SOUND_NAMES) {
      const samples = renderSound(soundSpec(name));
      expect(samples.length, name).toBeGreaterThan(0);
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i]!;
        if (!Number.isFinite(v) || v < -1 || v > 1) {
          throw new Error(`${name}[${i}] = ${v}`);
        }
      }
    }
  });

  it('starts and ends at silence, so no one-shot can click', () => {
    for (const name of SOUND_NAMES) {
      if (loops(soundSpec(name))) continue; // loops are joined instead — below
      const samples = renderSound(soundSpec(name));
      expect(Math.abs(samples[0]!), name).toBeLessThan(1e-6);
      expect(Math.abs(samples[samples.length - 1]!), name).toBeLessThan(1e-6);
    }
  });

  it('joins a loop tail to head, so the seam is not a click once per lap', () => {
    // A rendered loop's last sample and first sample are adjacent samples of the
    // source signal, so the step across the loop point is an ordinary one.
    const rate = 44100;
    const tone: VoiceSpec = { name: 'tone', wave: 'sine', attack: 0, hold: 0.5, decay: 0, freq: 100, gain: 1 };
    const flat = renderVoice(tone, rate, { edges: false });
    const looped = seamless(flat, rate, 0.05);
    expect(looped.length).toBe(flat.length - Math.floor(0.05 * rate));
    const seam = Math.abs(looped[0]! - looped[looped.length - 1]!);
    const biggestStepInside = (() => {
      let max = 0;
      for (let i = 1; i < looped.length; i++) max = Math.max(max, Math.abs(looped[i]! - looped[i - 1]!));
      return max;
    })();
    expect(seam).toBeLessThanOrEqual(biggestStepInside * 1.5);
  });

  it('leaves loops alone at the edges, so they do not pulse once per lap', () => {
    for (const name of SOUND_NAMES) {
      const spec = soundSpec(name);
      if (!loops(spec)) continue;
      const samples = renderSound(spec);
      // A faded edge would put a near-zero sample at both ends of the loop.
      const ends = Math.abs(samples[0]!) + Math.abs(samples[samples.length - 1]!);
      expect(ends, name).toBeGreaterThan(1e-4);
    }
  });

  it('rolls off a low-pass and lets a high-pass through', () => {
    // The bug this guards: sharing one coefficient mapping between the two
    // filters, which costs ~25 dB on every sound that names a `highPass`.
    const bright: VoiceSpec = { name: 'b', wave: 'saw', attack: 0.001, hold: 0.05, decay: 0.05, freq: 2000, gain: 0.8 };
    const open = peak(renderVoice(bright));
    const muffled = peak(renderVoice({ ...bright, lowPass: 200 }));
    const thinned = peak(renderVoice({ ...bright, highPass: 400 }));
    expect(muffled).toBeLessThan(open * 0.6);
    expect(thinned).toBeGreaterThan(open * 0.4); // thinner, not silenced
  });

  it('glides pitch exponentially and floors it rather than reaching zero', () => {
    const fall: VoiceSpec = { name: 'f', wave: 'sine', attack: 0, hold: 0, decay: 0.3, freq: 800, freqEnd: 1, freqMin: 40, gain: 1 };
    const samples = renderVoice(fall);
    expect(samples.every((v) => Number.isFinite(v))).toBe(true);
    expect(peak(samples)).toBeGreaterThan(0.3);
  });

  it('survives a degenerate spec instead of producing garbage', () => {
    const nothing: VoiceSpec = { name: 'n', wave: 'sine', attack: 0, hold: 0, decay: 0, freq: 0, gain: 5 };
    const samples = renderVoice(nothing);
    expect(samples.length).toBe(1);
    expect(Number.isFinite(samples[0]!)).toBe(true);
    expect(peak(renderVoice({ ...nothing, gain: Number.NaN }))).toBe(0);
  });
});

describe('the bank (`./bank`) — a sound for every mechanic (GDD §3.6)', () => {
  it('maps every tell kind to a sound, or to a documented held state', () => {
    for (const kind of ALL_KINDS) {
      const sound = TELL_SOUND[kind];
      if (sound === null) {
        // The only legal silences: states whose voice is sustained elsewhere.
        expect(SUSTAINED_TELLS, `${TELL_NAMES[kind]} has no sound`).toContain(kind);
      } else {
        expect(SOUND_NAMES, `${TELL_NAMES[kind]} → ${sound}`).toContain(sound);
      }
    }
    // The thruster alone is held now: firing became discrete with amendment v0.3.
    expect(SUSTAINED_TELLS).toHaveLength(1);
    expect(SUSTAINED_TELLS).toContain(TELL.thrust);
  });

  it('keeps the two firing voices as discrete one-shots after the mining laser retired', () => {
    // The held rock/hull loops retired with the mining laser (amendment v0.3): a shot is
    // an event now, so both firing voices are ordinary one-shots, not loops.
    expect(loops(soundSpec(SOUND.rockChip))).toBe(false);
    expect(loops(soundSpec(SOUND.hullHit))).toBe(false);
    // And the tells that used to be "sustained" now route to those one-shots.
    expect(TELL_SOUND[TELL.mineHit]).toBe(SOUND.rockChip);
    expect(TELL_SOUND[TELL.weaponHit]).toBe(SOUND.hullHit);
  });

  it('makes rock and hull genuinely distinct, not two takes of one sound (GDD §3.6)', () => {
    // A player mid-fight has to know which one they are doing without looking,
    // so the two are far apart in the one dimension that survives a bad phone
    // speaker: spectral centre. Zero crossings stand in for it, cheaply.
    const crossings = (samples: Float32Array): number => {
      let n = 0;
      for (let i = 1; i < samples.length; i++) {
        if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
      }
      return n / samples.length;
    };
    const rock = crossings(renderSound(soundSpec(SOUND.rockChip)));
    const hull = crossings(renderSound(soundSpec(SOUND.hullHit)));
    expect(hull).toBeGreaterThan(rock * 1.8);
  });

  it('keeps every sound inside the headroom the mix assumes', () => {
    for (const name of SOUND_NAMES) {
      const samples = renderSound(soundSpec(name));
      // 1.0 is the CLAMP, not the ceiling — `renderVoice` limits every sample to
      // [-1, 1], so a sound that reaches exactly 1.0 is not "at full level", it
      // is being flattened. Round 2 of the re-voice put coreHit, stationDeath
      // and shipExplode on that clamp by adding resonance without re-balancing,
      // and `<= 1` could not see it. 0.95 leaves the distortion visible.
      expect(peak(samples), `${name} is clipping, not peaking`).toBeLessThanOrEqual(0.95);
      expect(peak(samples), `${name} is silent`).toBeGreaterThan(0.01);
      expect(rms(samples), `${name} rms`).toBeLessThan(0.5);
    }
  });

  it('makes the alarm the loudest thing in the bank — it is a mechanic (§2.2)', () => {
    const alarm = rms(renderSound(soundSpec(SOUND.alarm)));
    const chatter = [SOUND.oreCollect, SOUND.repairTick, SOUND.spawnPulse, SOUND.shotImpact];
    for (const name of chatter) {
      expect(alarm, `alarm vs ${name}`).toBeGreaterThan(rms(renderSound(soundSpec(name))));
    }
  });

  it('gives the station death the longest tail in the bank (GDD §4.7)', () => {
    const length = (name: SoundName) => renderSound(soundSpec(name)).length;
    const death = length(SOUND.stationDeath);
    for (const name of SOUND_NAMES) {
      const spec = soundSpec(name);
      if (loops(spec)) continue; // loops are bodies, not tails
      if (name === SOUND.stationDeath || name === SOUND.collapseBegin) continue;
      expect(death, `${name} outlasts the death`).toBeGreaterThanOrEqual(length(name));
    }
  });

  it('layers the sounds that are layered and keeps the rest single voices', () => {
    // `rockCrack` was the single-voice example here until s10-01, when the
    // developer chose its candidate **c** — a struck plate with a grain of dust
    // behind it, which is a stack. `shotImpact` takes its place as the one-voice
    // case: it is still one band-limited hit, and it is one of the thirty-seven
    // slots sitting at deny-all, so it is not about to become a stack either.
    expect(isLayered(soundSpec(SOUND.shotImpact))).toBe(false);
    expect(isLayered(soundSpec(SOUND.shipExplode))).toBe(true);
    expect(isLayered(soundSpec(SOUND.rockCrack))).toBe(true); // adopted: candidates.ts#rockCrack.c
    expect(loops(soundSpec(SOUND.rockCrack))).toBe(false);
  });

  it('holds the amended tone contract: no arcade oscillators or idioms in the bank (GDD §4.7)', () => {
    // **The definition of done for the re-voice**, and the last thing written:
    // it was red for the whole pass and went green when the pass finished, which
    // is the only ordering that makes it mean anything.
    //
    // The four clauses are `docs/audio-revoice-spec.md` §5. Each names its
    // exceptions here rather than in a reviewer's head, because the failure mode
    // of a policy nobody can read is that the next agent quietly re-adds the
    // thing it was written to keep out.
    const voices: { sound: SoundName; spec: VoiceSpec }[] = [];
    for (const name of SOUND_NAMES) {
      const spec = soundSpec(name);
      for (const v of isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec as VoiceSpec]) {
        voices.push({ sound: name, spec: v });
      }
    }
    expect(voices.length).toBeGreaterThan(80); // it walks the whole bank, not a corner

    // §5.1 — the oscillators. `square` and `saw` are the two shapes the ratified
    // Gantry/Bone handoff independently names as "what made earlier passes sound
    // retro or cartoonish", and they were 28 of the bank's 89 voices.
    //
    // The alarm is the ONE sanctioned exception, and the reason is a precedence
    // rule rather than a taste: §2.2 specifies "an unmistakable alarm", §4.9 puts
    // it on the not-cuttable list, and a saw's dense harmonic stack is what makes
    // a klaxon refuse to sound like music. Softening it would trade a mechanic
    // for a register, which §4.7's own precedence forbids.
    const SANCTIONED_SAW = new Set(['alarm.low', 'alarm.high']);
    for (const { sound, spec } of voices) {
      if (SANCTIONED_SAW.has(spec.name)) {
        expect(spec.wave, `${spec.name} is the sanctioned klaxon`).toBe('saw');
        continue;
      }
      expect(spec.wave, `${sound}/${spec.name} is an arcade oscillator`).not.toBe('square');
      expect(spec.wave, `${sound}/${spec.name} is an arcade oscillator`).not.toBe('saw');
    }

    // §5.3 — the arcade idioms, retired outright. These are jsfxr's own
    // vocabulary: `arpMul`/`arpTime` is the "blip up" (the synth's doc comment
    // calls it that), `dutySweep` is "the classic sweeping buzz", and `repeat` in
    // this bank was only ever a trill.
    //
    // Two of the three have no exceptions and never will. `repeat` is the one the
    // clause itself leaves a door open for — *"`repeat` in particular has a
    // legitimate non-arcade use (a rattle, a stutter) and may return with a
    // written reason"* — and s10-01 is the brief that walked through it: the
    // developer chose `rockChip` **b** and `rockCrack` **c**, and the grain rate
    // of a granular texture is what `repeat` is doing in both. So the door is
    // used exactly as written — named voices, a reason each, and a bound.
    //
    // The bound is the line between the two uses and it is not a matter of
    // taste: below ~20 ms the retriggers fuse into a texture you hear as
    // *material*, and above it they separate into events you hear as *notes* —
    // which is the trill. `candidates.test.ts` holds the offers to the same 20 ms
    // and has since p1-07, so this is the same rule on both sides of the board.
    const GRAIN_RATTLE: Readonly<Record<string, string>> = {
      'rockChip.crush': 'the crush under the pressure bite — a 6 ms grain, the cutting head biting, adopted with candidate b (s10-01)',
      'rockCrack.dust': 'dust falling off the fracture — an 11 ms grain behind the plate, adopted with candidate c (s10-01)',
    };
    const RATTLE_MAX_S = 0.02;
    for (const { sound, spec } of voices) {
      const where = `${sound}/${spec.name}`;
      expect(spec.arpMul, `${where} arpeggios`).toBeUndefined();
      expect(spec.arpTime, `${where} arpeggios`).toBeUndefined();
      expect(spec.dutySweep, `${where} sweeps its duty`).toBeUndefined();
      if (spec.repeat === undefined) continue;
      const reason = GRAIN_RATTLE[spec.name];
      expect(reason, `${where} trills — no written reason on file for its \`repeat\``).toBeDefined();
      expect(reason!.length, `${spec.name} claims an exemption with no reason`).toBeGreaterThan(20);
      expect(spec.repeat, `${where} repeats every ${(spec.repeat * 1000).toFixed(0)} ms — that is a trill, not a grain`).toBeLessThanOrEqual(RATTLE_MAX_S);
    }
    // A budget as well as a list: a rattle is a texture two voices reach for, not
    // a habit. If a third one wants it, it wants a look rather than a line here.
    expect(Object.keys(GRAIN_RATTLE).length, 'the rattle exemption is growing into a policy').toBeLessThanOrEqual(2);

    // §5.4 — modulation and glide, the clauses the audit proved actually carry
    // the register. Removing rockChip's vibrato moved its spectral centroid by
    // 0.6% (noise) and removing its chirp moved it 154 Hz — so a pass that only
    // swapped waveforms could have hit every brightness target and left the toy
    // exactly where it was.
    //
    // 250 ms is where a glide stops reading as a *chirp* and starts reading as a
    // *fall*, and where a few cycles of vibrato stop reading as a *wobble* and
    // start reading as *drift*. Longer voices are exempt by construction, which
    // is deliberate: the station-death fall (×6.18 over 1.32 s), the collapse,
    // the shield bubble failing (×6.92 over 0.54 s) and the ambient bed's
    // 0.125 Hz drift are all the opposite of the thing being banned.
    const SHORT_S = 0.25;
    const MAX_GLIDE = 1.2;
    /** Voices under the threshold that keep a wide glide, each with its reason. */
    const GLIDE_EXEMPT: Readonly<Record<string, string>> = {
      // HOLD by ratification (s7-01 §7.2): one of the two sounds a home gets,
      // and the ache depends on it. The tear falling under the thud is the
      // reactor being opened, not a chirp — and at 0.0063 it is the darkest
      // voice in the bank, which is the opposite of the complaint.
      'coreHit.tear': 'the ache — held untouched by s7-01 §7.2, and the darkest voice in the bank',
    };
    for (const { sound, spec } of voices) {
      const duration = voiceDuration(spec);
      if (duration >= SHORT_S) continue;
      const where = `${sound}/${spec.name} (${(duration * 1000).toFixed(0)} ms)`;

      // A wobble inside a voice this short is a cartoon, full stop — no exemptions.
      expect(spec.vibratoDepth ?? 0, `${where} wobbles`).toBe(0);

      if (spec.freqEnd === undefined || spec.freqEnd === spec.freq) continue;
      const glide = Math.max(spec.freq, spec.freqEnd) / Math.max(1, Math.min(spec.freq, spec.freqEnd));
      const reason = GLIDE_EXEMPT[spec.name];
      if (reason !== undefined) {
        expect(reason.length, `${where} claims an exemption with no reason`).toBeGreaterThan(20);
        continue;
      }
      expect(glide, `${where} chirps ×${glide.toFixed(2)}`).toBeLessThanOrEqual(MAX_GLIDE);
    }
  });

  it('holds the round-2 register: the bank is not one bare oscillator in three hats (s8-01)', () => {
    // **Why this test exists, and why the one above it was not enough.**
    //
    // The test above forbids `square`, `saw` and the jsfxr idioms. It was GREEN
    // on the bank the developer listened to and rejected for the second time:
    //
    //   > "still have all the old sounds i said i didnt want there, we need to
    //   >  deny all of those sounds at once and make new ones that match the new
    //   >  theme (modern/sci-fi and not retro/toony)"   — 2026-08-07, all 40 slots
    //
    // A contract that can only fail on an oscillator NAME cannot fail on the
    // sound being complained about, which is exactly what happened. Round 1
    // satisfied every clause of §5 by replacing `square` with `struck()` — two or
    // three BARE SINE PARTIALS, 2 ms attack, a hold at full level and a linear
    // ramp to silence — and shipped a glockenspiel in sixteen places. Retiring an
    // arcade blip for a toy xylophone is a lateral move, and it measured as a
    // success on every number the old contract knew how to look at.
    //
    // So this pins the thing that was actually wrong. It is stated as budgets
    // rather than bans because the defect was never one voice: it was the SHAPE
    // OF THE WHOLE BANK, and a per-voice rule cannot see a monoculture.
    const voices: { sound: SoundName; spec: VoiceSpec }[] = [];
    for (const name of SOUND_NAMES) {
      const spec = soundSpec(name);
      for (const v of isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec as VoiceSpec]) {
        voices.push({ sound: name, spec: v });
      }
    }
    const share = (n: number) => n / voices.length;

    // --- Clause 1: the bare-tone budget. THE ONE WITH TEETH. ----------------
    //
    // A voice is **bare** when it is a tonal wave carrying no grain, no filter of
    // either kind and no decay curve — a tone generator, sounding rather than
    // being struck. On the bank the developer rejected twice this was **83 of
    // 116 voices, 71.6%**, and that single number is the whole bug report: it was
    // not that the oscillators were retro, it was that nothing was ever DONE to
    // them. `noise` is excluded by construction — filtered noise is the register,
    // not a shortcut out of it (s7-01 §5.2).
    //
    // The exemptions are the four places a pure tone genuinely IS the design: the
    // sustained drones that run for minutes under everything else. A drone is the
    // opposite of a struck note and grain on one is an artefact, not a texture.
    //
    // It used to be six. `ambient.bed` and `ambient.detune` claimed exactly this
    // exemption — "a player must never notice it twice" — and the developer
    // noticed the pair in the first second of a match (a0-48). Two bare 55 Hz
    // sines are a test tone whatever a comment says they are, so the bed was
    // rebuilt out of the round-2 instrument and neither voice needs the carve-out
    // any more. The four below are the soundtrack's, and none of them has been
    // complained about; they stay on the same terms, with the same written reason.
    const SUSTAINED_DRONES: Readonly<Record<string, string>> = {
      'musicBed.third': 'the minor third that makes the soundtrack an ache and not a pad',
      'musicBed.fifth': 'the drone the theme sits on; anything in it would be heard as a fault',
      'musicDread.clash': 'a semitone beating against the low — the unease, and it costs one voice',
      'musicDread.sub': 'a sub under the collapse: felt rather than heard, so nothing to colour',
    };
    const bare = voices.filter(
      ({ spec }) =>
        spec.wave !== 'noise' &&
        (spec.noiseMix ?? 0) === 0 &&
        spec.lowPass === undefined &&
        spec.highPass === undefined &&
        (spec.decayCurve ?? 0) === 0,
    );
    for (const { sound, spec } of bare) {
      const reason = SUSTAINED_DRONES[spec.name];
      expect(
        reason,
        `${sound}/${spec.name} is a bare tone generator with no reason on file — ` +
          `give it grain, a filter or a decay tail, or name it a sustained drone here`,
      ).toBeDefined();
      expect(reason!.length, `${spec.name} claims an exemption with no reason`).toBeGreaterThan(20);
    }
    // A budget as well as a list, so the list cannot quietly become the bank.
    expect(share(bare.length), `${bare.length} of ${voices.length} voices are bare tone generators`).toBeLessThan(0.08);

    // --- Clause 2: no oscillator monoculture. A BACKSTOP, not the point. -----
    //
    // Round 1 landed `sine` at 48.3% of the bank. A single waveform carrying half
    // of everything a player hears is a monoculture whatever that waveform is, and
    // the pass that produced it believed it was diversifying.
    //
    // The ceiling is 45% rather than something rounder on purpose: **bare-ness is
    // the defect, not sine-ness.** Round 2 sits at 41.5% sine and that is fine,
    // because those are the ratified Gantry/Bone partials (`./ui-cues`, chosen by
    // ear by the developer in s6-01) and every one of them now carries grain and
    // a real tail. Contorting the sound design to hit a prettier percentage would
    // be optimising the metric instead of the sound — the exact mistake s7-01 §4.1
    // warned about when it proved the brightness numbers were blind to the
    // character. This clause only has to catch a collapse; clause 1 does the work.
    const byWave = new Map<string, number>();
    for (const { spec } of voices) byWave.set(spec.wave, (byWave.get(spec.wave) ?? 0) + 1);
    for (const [wave, n] of byWave) {
      expect(share(n), `${wave} is ${(100 * share(n)).toFixed(1)}% of the bank — a monoculture`).toBeLessThan(0.45);
    }

    // --- Clause 3: a decay is a tail, not a fade-out. ------------------------
    //
    // Until round 2 the synth had exactly one envelope, `1 - d`. Nothing physical
    // decays in a straight line — a linear ramp to silence is a volume knob being
    // turned down, and it is audible as "synthesized" under any oscillator. It was
    // on every percussive voice in the bank across BOTH re-voices.
    //
    // The klaxon is the one exception and it is the same precedence rule as its
    // saw: it loops, its envelope is the rhythm of the alarm rather than the shape
    // of a body, and bending it would change a mechanic (§2.2) to buy a register.
    const LINEAR_BY_DESIGN: Readonly<Record<string, string>> = {
      'alarm.low': 'the klaxon loops — its envelope is the alarm rhythm, not a body decaying (§2.2)',
      'alarm.high': 'the klaxon loops — its envelope is the alarm rhythm, not a body decaying (§2.2)',
    };
    for (const { sound, spec } of voices) {
      if (spec.decay <= 0) continue; // sustained loop bodies have no decay at all
      if ((spec.decayCurve ?? 0) > 0) continue;
      const reason = LINEAR_BY_DESIGN[spec.name];
      expect(reason, `${sound}/${spec.name} fades in a straight line`).toBeDefined();
      expect(reason!.length, `${spec.name} claims an exemption with no reason`).toBeGreaterThan(20);
    }

    // --- Clause 4: the new register is actually present. --------------------
    //
    // The anti-gaming clause, and the reason the three above are not sufficient.
    // Every one of them can be satisfied by sprinkling `noiseMix: 0.01` across the
    // bank and calling it a re-voice — which is precisely the shape of the failure
    // this brief exists to stop repeating. Modern science fiction is carried by
    // **filter movement and material**, so the bank has to contain a working
    // amount of both, counted rather than asserted about.
    const swept = voices.filter(({ spec }) => spec.lowPassEnd !== undefined && spec.lowPassEnd !== spec.lowPass);
    const resonant = voices.filter(({ spec }) => (spec.resonance ?? 0) > 0);
    const metallic = voices.filter(({ spec }) => spec.bandPass === true);
    expect(swept.length, 'no filter sweeps in the bank — the register is not there').toBeGreaterThanOrEqual(20);
    expect(resonant.length, 'nothing in the bank resonates — every filter is flat').toBeGreaterThanOrEqual(40);
    expect(metallic.length, 'no metallic band-pass transients anywhere').toBeGreaterThanOrEqual(8);
  });

  it('the ambient bed is not a bare held tone', () => {
    // **The bug report, as a property.** The developer, 2026-08-14: *"when i press
    // play im immediately greeted by this background sound that is deep and i dont
    // see it anywhere in the board... its annoying"* — and the bed's own spec, in
    // `./bank`, is *"this plays for fifteen minutes and must never become something
    // a player notices twice."* It was noticed in the first second, so the spec is
    // the requirement that failed, not a matter of taste.
    //
    // What failed it is visible in the numbers: four layers of `wave: 'sine'` /
    // `attack: 0` / `hold: 8` / `decay: 0`, one of them a bare 55 Hz sine. That is
    // a0-01 round 2's finding — *"a stack of unfiltered sines with a linear decay
    // is a glockenspiel"* — applied to a sustained tone: held pitch, no movement,
    // no filter, and an onset at the very first sample.
    //
    // Both halves are asserted, because either alone is gameable (LESSONS §26): a
    // filter with a zero attack still arrives as an event, and a fade-in on a bare
    // sine is still a test tone. The properties, not a number equal to itself.
    const spec = soundSpec(SOUND.ambient);
    expect(isLayered(spec), 'the bed is a single voice — it cannot be a bed').toBe(true);
    if (!isLayered(spec)) return;
    const layers = spec.layers;
    const crossfade = spec.crossfade ?? 0.04;

    for (const { spec: v } of layers) {
      // Half one: made of something. A bed that is never noticed twice is made of
      // movement and filtering — the four capabilities `./synth` grew in round 2 —
      // and not of a pitch being held at a level.
      const moves =
        (v.decayCurve ?? 0) > 0 ||
        (v.lowPassEnd !== undefined && v.lowPassEnd !== v.lowPass) ||
        v.bandPass === true ||
        (v.resonance ?? 0) > 0;
      expect(
        moves,
        `ambient/${v.name} is a held pitch: no decayCurve, no lowPassEnd, no bandPass, no resonance`,
      ).toBe(true);

      // Half two: nothing in it arrives. `attack: 0` starts a voice at full level
      // on sample zero, which is an *event* — the thing a bed must never be.
      expect(v.attack, `ambient/${v.name} arrives at full level on its first sample`).toBeGreaterThan(0);
    }

    // The bed genuinely breathes rather than merely avoiding a click: at least one
    // voice swells over seconds. A 2 ms click-guard on every layer would satisfy
    // the clause above and change nothing anybody hears.
    const swells = layers.filter((l) => l.spec.attack >= 1);
    expect(swells.length, 'nothing in the bed swells — every attack is a click-guard').toBeGreaterThanOrEqual(1);

    // And a swell is only allowed where it cannot become a pulse once per lap. A
    // voice still sounding at the body's edges (`decay: 0`) has its head crossfaded
    // onto its own tail by `synth.seamless`, so an attack longer than that
    // crossfade is heard as a dip every lap — which is the definition of a bed a
    // player notices twice. Swells therefore belong to voices that decay away
    // inside the body; sustained voices get a click-guard and no more.
    for (const { spec: v } of layers) {
      if (v.decay > 0) continue;
      expect(
        v.attack,
        `ambient/${v.name} is sustained across the loop seam but fades in over ${v.attack}s — ` +
          `longer than the ${crossfade}s crossfade, so it dips once per lap`,
      ).toBeLessThanOrEqual(crossfade);
    }
  });

  it('keeps the shipped mining voice under the tone the developer ratified (s4-01, s7-01)', () => {
    // **The bug report, reproduced as a number.** The developer denied the
    // rockChip trio in s4-01 with one note — *"almost there, but they should be
    // lower in tone"* — and `candidates.test.ts` locked that ratification into a
    // ceiling on `./candidates`. But candidates are a review artifact imported by
    // nothing in the game, so the SHIPPED voice was never held to it: s7-01
    // measured `bank.ts`'s rockChip byte-identical to its a3-02 form, at 0.0483
    // against a ratified ceiling of 0.034, and nothing looked. That is why the
    // second report — *"rockchip needs to be redone as well, it still has that
    // toony sound"* (2026-08-05) — describes a sound that never changed.
    //
    // This test is the missing guard. Same window, same ceiling, same arithmetic
    // as `candidates.test.ts`, pointed at the voice the player actually hears.
    const CEILING = 0.034;
    const windowedZcr = (samples: Float32Array): number => {
      const from = Math.round(0.003 * DEFAULT_SAMPLE_RATE); // past the attack transient
      const to = Math.min(samples.length, from + 2048);
      let n = 0;
      for (let i = from + 1; i < to; i++) if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
      return n / Math.max(1, to - from);
    };
    const chip = renderSound(soundSpec(SOUND.rockChip));
    expect(windowedZcr(chip), 'the shipped mining voice is not lower in tone').toBeLessThan(CEILING);
    // Adopted candidate **b** measures 0.0024 here — an order of magnitude under
    // the ceiling. "Lower in tone" is not in doubt any more.

    // **The floor that used to be here, and why it is gone (s10-01).**
    //
    // This test also asserted `bandShare(chip, 500, Nyquist) > 0.4` — that at
    // least 40% of the chip's energy stays above 500 Hz — under the heading
    // *"lower has a floor, and it is the phone"*. The reasoning was s7-01 §4.1
    // Finding 3: a phone speaker rolls off hard below 500 Hz, `TELL.mineHit`
    // fires all match, the mobile gate (GDD §4.3) makes the developer's own phone
    // a first-class target, and s4-01's candidate at 89% below that line would
    // therefore have arrived as *"the mining sound is gone"*.
    //
    // On 2026-08-13 the developer listened to the board and chose `rockChip`
    // candidate **b** — which puts 100.0% of its energy below 500 Hz. It is not
    // near the floor, it is entirely under it. The other two offers were audibly
    // brighter (a at 5.4% above the line, c at 0.6%) and both were passed over.
    //
    // **Finding 3 was a prediction about a sound nobody had heard; this is a
    // decision about a sound they did hear.** A measurement that exists to
    // anticipate the developer's ear does not get to overrule it once the ear has
    // spoken (LESSONS §17, §19) — and a guard kept in place by weakening its
    // number until the ratified voice slips under it would be worse than one
    // removed on purpose, because it would look like it still meant something.
    //
    // The risk it was guarding is REAL and is not closed: if the mining voice
    // reads thin or absent on a phone speaker, the fix is to put a new offer on
    // the board, not to quietly re-brighten what was chosen. That is written into
    // `docs/sound-adoptions.md` and into s10-01's PR rather than left here.
    //
    // What is still true, and still worth pinning: the chip has to be AUDIBLE, and
    // the thing it is most often heard beside is a shot landing. Candidate b is
    // the loudest of the three offers, and it stays comfortably above the
    // projectile impact it shares a fight with — so "lower" did not become "gone"
    // in the mix, whatever it does to a small speaker.
    expect(
      rms(chip),
      'the mining voice is quieter than the shot landing beside it — lower has become gone',
    ).toBeGreaterThan(rms(renderSound(soundSpec(SOUND.shotImpact))));

    // And the half of the pair that a phone CAN emit, which is the part of
    // Finding 3 that survives. §2.3's inversion is *am I mining or shooting a
    // ship*, and it is only answerable on a small speaker if at least one of the
    // two voices lives above the roll-off. The chip no longer does, by the
    // developer's choice — so `hullHit` carries it, and this is now the line that
    // fails if someone darkens the hull as well. Adopted candidate a measures
    // 99.9% above 500 Hz; the floor is set where "most of it" starts.
    expect(
      bandShare(renderSound(soundSpec(SOUND.hullHit)), 500, DEFAULT_SAMPLE_RATE / 2),
      'neither firing voice is left above what a phone speaker can emit (§2.3)',
    ).toBeGreaterThan(0.6);
  });

  // -------------------------------------------------------------------------
  // The end-of-match summary set (p1-07) — `docs/progression-plan.md` §6.5
  // -------------------------------------------------------------------------
  //
  // Four cues for a screen the player sees after **every match, forever**, so
  // they are held to the set-level constraints the plan states rather than only
  // to the bank-wide ones above. The bank-wide contracts already walk these four
  // — they are in `SOUND_NAMES` — and these add what is true of this set alone.

  /** The four, in the order the sequence plays them (plan §6.3 beats 1–5). */
  const SUMMARY: readonly SoundName[] = [SOUND.xpTick, SOUND.xpBarFill, SOUND.levelUp, SOUND.xpSettle];
  /** The three slots the plan forbids this beat to reach for — all under deny-all. */
  const DENIED_STINGS: readonly SoundName[] = [SOUND.matchEnd, SOUND.musicWin, SOUND.musicLoss];

  it('puts each summary cue inside the amended tone envelope (GDD §4.7, p1-07)', () => {
    // The same clauses `docs/audio-revoice-spec.md` §5 states and the two tests
    // above assert bank-wide, restated pointed at the four so a failure names the
    // cue rather than the bank. Cheap, and the reason it is worth the duplication
    // is a0-01's own finding: these four were written *after* the contract, and a
    // new slot is exactly where a retired idiom walks back in unnoticed.
    for (const name of SUMMARY) {
      const spec = soundSpec(name);
      const voices = isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec as VoiceSpec];
      expect(voices.length, `${name} has no voices`).toBeGreaterThan(0);
      for (const v of voices) {
        const where = `${name}/${v.name}`;
        // §5.1 — the oscillators. There is no sanctioned exception here: the one
        // in the bank is the klaxon, and none of these is a mechanic's alarm.
        expect(v.wave, `${where} is an arcade oscillator`).not.toBe('square');
        expect(v.wave, `${where} is an arcade oscillator`).not.toBe('saw');
        // §5.3 — the arcade idioms, retired outright.
        expect(v.arpMul, `${where} arpeggios`).toBeUndefined();
        expect(v.arpTime, `${where} arpeggios`).toBeUndefined();
        expect(v.dutySweep, `${where} sweeps its duty`).toBeUndefined();
        expect(v.repeat, `${where} trills`).toBeUndefined();
        // §5.4 — no wobble, and no chirp, inside a short voice.
        if (voiceDuration(v) < 0.25) {
          expect(v.vibratoDepth ?? 0, `${where} wobbles`).toBe(0);
          if (v.freqEnd !== undefined && v.freqEnd !== v.freq) {
            const glide = Math.max(v.freq, v.freqEnd) / Math.max(1, Math.min(v.freq, v.freqEnd));
            expect(glide, `${where} chirps ×${glide.toFixed(2)}`).toBeLessThanOrEqual(1.2);
          }
        }
        // a0-01's round-2 finding, which is the sharper one: a stack of
        // unfiltered tones with a linear decay is a glockenspiel whatever the
        // oscillator. Every voice here carries material, and every decay is a
        // tail rather than a volume knob turning down.
        const material =
          v.wave === 'noise' || (v.noiseMix ?? 0) > 0 || v.lowPass !== undefined || v.highPass !== undefined;
        expect(material, `${where} is a bare tone generator`).toBe(true);
        if (v.decay > 0) expect(v.decayCurve ?? 0, `${where} fades in a straight line`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the count-up tick inside the `pressTick` bound, not the `matchEnd` one', () => {
    // The plan is explicit that this is the `pressTick` problem: *"heard dozens
    // of times in five seconds… it must survive being heard every match
    // forever."* `pressTick` is the only other slot in the bank with that job, so
    // it is the bound — shorter, quieter, and quieter still in RMS.
    const tick = renderSound(soundSpec(SOUND.xpTick));
    const press = renderSound(soundSpec(SOUND.pressTick));
    expect(tick.length, 'the count-up tick is longer than a press tick').toBeLessThanOrEqual(press.length);
    expect(peak(tick), 'the count-up tick peaks over a press tick').toBeLessThanOrEqual(peak(press));
    expect(rms(tick), 'the count-up tick is louder than a press tick').toBeLessThan(rms(press));
    // It is in fact the quietest thing in the bank, which is the design: at forty
    // repetitions the failure mode is fatigue, and the fix is subtraction.
    for (const name of SOUND_NAMES) {
      if (name === SOUND.xpTick) continue;
      expect(rms(tick), `${name} is quieter than the count-up tick`).toBeLessThan(rms(renderSound(soundSpec(name))));
    }
  });

  it('survives repetition: forty ticks in five seconds do not accumulate or clip', () => {
    // The assertion the slot exists for. Forty ticks, each pitched by the rise
    // the seam applies (`./engine` cueRate), stacked at three rates spanning
    // "dozens in five seconds" up to a rate no count-up will ever ask for — and
    // the sum must stay inside the same headroom the mix assumes of one sound.
    const tick = renderSound(soundSpec(SOUND.xpTick));
    const stack = (perSecond: number): Float32Array => {
      const gap = Math.round(DEFAULT_SAMPLE_RATE / perSecond);
      const out = new Float32Array(gap * 40 + tick.length * 2);
      for (let k = 0; k < 40; k++) {
        // The same rate the engine plays tick k at: resampled by reading faster.
        const rate = Math.pow(2, (Math.min(k, XP_TICK_STEPS_MAX) * XP_TICK_SEMITONES) / 12);
        const len = Math.floor(tick.length / rate);
        for (let i = 0; i < len; i++) {
          out[k * gap + i] = (out[k * gap + i] ?? 0) + (tick[Math.floor(i * rate)] ?? 0);
        }
      }
      return out;
    };
    const alone = peak(tick);
    for (const perSecond of [8, 20, 40]) {
      const buf = stack(perSecond);
      expect(peak(buf), `forty ticks at ${perSecond}/s clip`).toBeLessThanOrEqual(0.95);
      // Not merely under the ceiling — they do not stack **at all**: each tick is
      // gone before the next arrives, so the burst peaks at one tick's level.
      // That is what "does not accumulate into a buzz" means as a number.
      expect(peak(buf), `forty ticks at ${perSecond}/s accumulate`).toBeLessThanOrEqual(alone * 1.02);
    }
  });

  it('mixes the whole summary set UNDER the result that already sounded', () => {
    // Plan §6.5's first set-level constraint: *"they mix under whatever the
    // result already sounded — a station death is still the ache."* Stated as
    // levels, which is the only place the constraint can actually live.
    //
    // **As played, not as rendered.** A one-shot cue sounds at gain 1 (`./engine`
    // cue), where the bar's bed is a held voice whose ceiling is a mix parameter
    // ({@link XP_FILL_GAIN}) — so comparing its raw body against a one-shot would
    // be comparing a buffer to a sound. The ceiling is used rather than the ride's
    // current value, because the constraint has to hold at the loudest the bed can
    // ever get.
    const level = (name: SoundName) =>
      rms(renderSound(soundSpec(name))) * (name === SOUND.xpBarFill ? XP_FILL_GAIN : 1);
    const result = level(SOUND.matchEnd);
    for (const name of SUMMARY) {
      expect(level(name), `${name} is louder than the result it plays under`).toBeLessThan(result);
      expect(level(name), `${name} is louder than a home dying`).toBeLessThan(level(SOUND.stationDeath));
    }
    // The level-up is the one moment allowed to be a reward, so it is the
    // loudest of the four — and still under the result.
    for (const name of SUMMARY) {
      if (name === SOUND.levelUp) continue;
      expect(level(SOUND.levelUp), `${name} is louder than the level-up`).toBeGreaterThan(level(name));
    }
  });

  it('is cancellable: nothing in the set can outlive the screen', () => {
    // Plan §6.5's second set-level constraint. pr-05 owns the cancel; this owns
    // being cancellable — which for a one-shot means being SHORT (the mix has no
    // handle on one in flight), and for the sustained cue means being a LOOP,
    // which is the only thing in this graph that can be told to stop.
    for (const name of SUMMARY) {
      const spec = soundSpec(name);
      if (loops(spec)) {
        expect(name, 'the only sustained cue in the set is the bar bed').toBe(SOUND.xpBarFill);
        continue;
      }
      const seconds = renderSound(spec).length / DEFAULT_SAMPLE_RATE;
      expect(seconds, `${name} has a tail that outlives a skip`).toBeLessThanOrEqual(0.5);
    }
    expect(loops(soundSpec(SOUND.xpBarFill)), 'the bar bed cannot be stopped').toBe(true);
  });

  it('reaches for none of the three denied stings (plan §6.5)', () => {
    // *"A satisfying sound drawn from the denied bank is a satisfying sound the
    // developer has already rejected."* All forty slots are under deny-all
    // (a0-01) and three of them are the obvious ones to reach for here, so this
    // asserts the set is new material rather than a re-route: no shared voice, no
    // shared name, and — the one that would actually ship the mistake — no cue in
    // the vocabulary pointing at them.
    const denied = new Set<string>(DENIED_STINGS);
    const deniedVoices = new Set<string>();
    for (const name of DENIED_STINGS) {
      const spec = soundSpec(name);
      for (const v of isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec as VoiceSpec]) {
        deniedVoices.add(JSON.stringify(v));
      }
    }
    for (const name of SUMMARY) {
      expect(denied.has(name), `${name} IS one of the denied stings`).toBe(false);
      const spec = soundSpec(name);
      for (const v of isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec as VoiceSpec]) {
        expect(deniedVoices.has(JSON.stringify(v)), `${name}/${v.name} is a denied voice, re-used`).toBe(false);
        for (const sting of DENIED_STINGS) {
          expect(v.name, `${v.name} is named after ${sting}`).not.toContain(sting);
        }
      }
    }
    for (const cue of ['xpTick', 'levelUp', 'xpSettle'] as const) {
      expect(denied.has(CUE_SOUND[cue]), `the ${cue} cue plays a denied sting`).toBe(false);
    }
  });

  it('keeps every pair of tells a player must not confuse apart (s7-01 §8)', () => {
    // **A regression net, not a goal** (s7-01 §9 T1). It went up GREEN on the
    // pre-re-voice bank and is asserted here so the s7-02 re-voice cannot do the
    // one thing a re-voice is uniquely able to do: converge nine voices onto one
    // clean struck note and turn two obvious mechanics into a coin flip. GDD §4.7
    // as amended is explicit that the audible-tell mandate (§3.6) OUTRANKS the
    // register — "an asset pass that makes two mechanics harder to tell apart has
    // failed this section, not satisfied it."
    //
    // A pair's **separation** is the larger of its two measured ratios:
    // {@link spectralCentroidHz} (how bright) and {@link zeroCrossingRate} (the
    // cheap proxy the rock-vs-hull test already uses). Larger-of-two, because the pairs
    // do not all separate on the same axis — `shieldHit`/`coreHit` is carried
    // almost entirely by zcr (×9.02) and barely at all by centroid (×1.61), and
    // requiring both would fail a bank that is perfectly legible.
    //
    // The floor is **90% of today's separation, capped at ×3** — the cap is the
    // deliberate part. 90% is the tolerance a legitimate re-voice needs; the cap
    // exists because past a factor of three in brightness two tells are already
    // unmistakable, and a bare 90%-of-today rule would have frozen
    // `turretFire`/`shotImpact` at ×16.78 and forbidden exactly the re-voice
    // s7-01 §7.2 orders for it ("the single most arcade voice in the bank").
    // A net catches a collapse; it does not pin the bank to its own history.
    const CAP = 3;

    const measured = new Map<SoundName, { centroid: number; zcr: number }>();
    const measure = (name: SoundName) => {
      let m = measured.get(name);
      if (!m) {
        const samples = renderSound(soundSpec(name));
        m = { centroid: spectralCentroidHz(samples), zcr: zeroCrossingRate(samples) };
        measured.set(name, m);
      }
      return m;
    };
    const ratio = (a: number, b: number) => (Math.min(a, b) > 0 ? Math.max(a, b) / Math.min(a, b) : Infinity);

    // [a, b, separation measured on the pre-re-voice bank, the mechanic it protects]
    const PAIRS: readonly (readonly [SoundName, SoundName, number, string])[] = [
      // The tightest pair in the bank, and BOTH are re-voiced by s7-02: picked a
      // chunk up vs banked a chunk — the whole held-ore-vs-banked-ore economy.
      [SOUND.oreCollect, SOUND.depositTick, 2.0, 'picked a chunk up vs banked a chunk (§2.3)'],
      // Your buy was refused vs your reactor is being eaten. Both low, both bad
      // news, and the second is what the alarm is built on top of.
      [SOUND.rejectBuzz, SOUND.coreHit, 1.26, 'a refused buy vs a reactor hit (§2.2)'],
      // §2.2's grammar: shields redden and die before the reactor begins to fill.
      // A besieged player must hear which layer is being eaten. Carried by zcr.
      [SOUND.shieldHit, SOUND.coreHit, 9.02, 'their shield ate it vs the reactor did (§2.2)'],
      // Seconds apart, off one wheel press.
      [SOUND.buildComplete, SOUND.purchaseConfirm, 1.27, 'the defence arrived vs the buy registered'],
      [SOUND.respawnBeep, SOUND.spawnPulse, 1.77, 'the respawn clock vs spawn protection (§2.1, §2.7)'],
      // Both low, both two-note, both loud — and `waveArrive` is losing the saw
      // that currently separates them most, while the alarm keeps its own (§5.1).
      [SOUND.alarm, SOUND.waveArrive, 2.45, 'home is under attack vs a wave arrived (§2.2, §2.3)'],
      // The game's central inversion. Also guarded on its own, below.
      [SOUND.rockChip, SOUND.hullHit, 3.92, 'am I mining or shooting a ship (§2.3)'],
      [SOUND.rockChip, SOUND.shotImpact, 4.68, 'my shot chipped rock vs my shot landed'],
      [SOUND.turretFire, SOUND.shotImpact, 16.78, 'a turret fired at me vs something landed'],

      // --- Pairs the s7-02 re-voice CREATED, guarded at what it ships -------
      //
      // Sweeping all 780 pairs in the bank before and after the re-voice turned
      // up twenty that converged, which is the predicted failure mode of a
      // unified palette and the reason this sweep was run rather than assumed.
      // Two of them were pairs a player genuinely has to tell apart AND had
      // become similar in structure as well as in brightness; both were moved
      // apart before shipping, and are pinned here at what they ship as.
      //
      // holdFull and upgradeBought both became "several struck notes rising",
      // both mid-match, and both starting on A5 — they measured ×1.03 apart, the
      // tightest thing this pass produced. upgradeBought went up a register
      // rather than holdFull moving, because holdFull REPEATS while a hold is
      // full and must not fatigue, where a purchase lands once and §7.3 wants it
      // the brighter of the two.
      [SOUND.holdFull, SOUND.upgradeBought, 1.28, 'fly home vs your purchase landed'],
      // "A rock paid out" vs "my turret just died" — both broadband bodies with
      // a tonal tail, both about a third of a second. The ore glint went up a
      // fourth to clear it, which also keeps it the one thing in `rockBurst`
      // that goes up (style-guide §2).
      [SOUND.rockBurst, SOUND.turretDown, 1.2, 'a rock paid out vs my turret died'],
    ];

    // **What this metric cannot see, stated so nobody "fixes" a non-problem.**
    // Centroid and zcr are brightness proxies. They are blind to timbre class
    // (broadband noise vs a harmonic stack), to phrase structure (one note vs
    // three), and to duration. The other eighteen converged pairs are all
    // separated by exactly those: a held loop against a one-shot
    // (thruster/respawnGo, holdFull/thruster), noise against struck sine at the
    // same brightness (rockCrack/upgradeBought, rockChip/purchaseConfirm), or a
    // 0.03 s tick against a 1.25 s phrase (bankOre/matchEnd). Two of them —
    // pressTick/rejectBuzz and upgradeBought/pressTick — involve a voice that is
    // FALLBACK ONLY: `CUE_UI` routes `press` to the ratified `pick` cue, so the
    // bank's pressTick does not sound in a browser at all.

    for (const [a, b, today, mechanic] of PAIRS) {
      const ma = measure(a);
      const mb = measure(b);
      const separation = Math.max(ratio(ma.centroid, mb.centroid), ratio(ma.zcr, mb.zcr));
      const floor = Math.min(0.9 * today, CAP);
      expect(
        separation,
        `${a} / ${b} collapsed — ${mechanic}. was ×${today.toFixed(2)}, now ×${separation.toFixed(2)}, floor ×${floor.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe('the listener model (`./spatial`) — hear every thing on the map (a3-03)', () => {
  it('is full within R_NEAR, a straight line to zero at R_FAR', () => {
    // The exact curve, checked by hand: 1 up to the near radius, linear down,
    // 0 at and past the far one. A siege one screen away is background, not gone.
    expect(falloff(0)).toBe(1);
    expect(falloff(R_NEAR)).toBe(1);
    expect(falloff(R_NEAR - 10)).toBe(1);
    const mid = R_NEAR + (R_FAR - R_NEAR) / 2;
    expect(falloff(mid)).toBeCloseTo(0.5, 6);
    expect(falloff(R_FAR)).toBe(0);
    expect(falloff(R_FAR + 1000)).toBe(0);
    // Monotone non-increasing across the whole range.
    let prev = 1;
    for (let d = 0; d <= R_FAR + 200; d += 50) {
      const g = falloff(d);
      expect(g).toBeLessThanOrEqual(prev + 1e-9);
      prev = g;
    }
  });

  it('pans from the horizontal offset, and the sign flips across the ship', () => {
    expect(panFor(0)).toBe(0);
    expect(panFor(PAN_WIDTH / 2)).toBeCloseTo(0.5, 6); // to the right → +
    expect(panFor(-PAN_WIDTH / 2)).toBeCloseTo(-0.5, 6); // to the left → −
    // Clamped hard at the panner's rails, never past them.
    expect(panFor(PAN_WIDTH * 3)).toBe(1);
    expect(panFor(-PAN_WIDTH * 3)).toBe(-1);
    // The one property the live-stage spy attests: same distance, opposite side,
    // opposite sign, equal magnitude.
    expect(panFor(700)).toBe(-panFor(-700));
  });

  it('opens the lowpass near and closes it gently with distance', () => {
    expect(cutoffFor(0)).toBe(LP_NEAR_HZ);
    expect(cutoffFor(R_NEAR)).toBe(LP_NEAR_HZ);
    expect(cutoffFor(R_FAR)).toBe(LP_FAR_HZ);
    expect(cutoffFor(R_FAR + 500)).toBe(LP_FAR_HZ);
    // Monotone falling, so nothing gets brighter as it recedes.
    expect(cutoffFor(R_NEAR + 100)).toBeGreaterThan(cutoffFor(R_FAR - 100));
    // The near field stays open past the bypass threshold, so it pays no filter.
    expect(cutoffFor(R_NEAR + 1)).toBeGreaterThan(LP_BYPASS_HZ);
  });

  it('places a point: gain, pan, cutoff and the cull flag together', () => {
    // Directly right, at the near radius: full gain, panned right, still open.
    const right = place(R_NEAR, 0, 0, 0);
    expect(right.culled).toBe(false);
    expect(right.gain).toBe(1);
    expect(right.pan).toBeGreaterThan(0);
    // Directly left of the listener (listener at 500,0; sound at 0,0) → pan left.
    expect(place(0, 0, 500, 0).pan).toBeLessThan(0);
    // Well past the far radius: culled, zero gain — synthesise nothing.
    const gone = place(R_FAR + 500, 0, 0, 0);
    expect(gone.culled).toBe(true);
    expect(gone.gain).toBe(0);
  });

  it('survives a NaN offset by centring rather than throwing', () => {
    expect(panFor(Number.NaN)).toBe(0);
    expect(falloff(Number.NaN)).toBe(1);
  });
});

describe('the mix (`./graph`) — built headless', () => {
  it('builds four gain nodes wired to the destination and nothing else', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);

    expect(ctx.gains).toHaveLength(6); // duck, master, and the four buses
    expect((graph.duck as FakeGain).outputs).toEqual([ctx.destination]);
    expect((graph.master as FakeGain).outputs).toEqual([graph.duck]);
    for (const bus of Object.values(graph.buses)) {
      expect((bus as FakeGain).outputs).toEqual([graph.master]);
    }
    expect(graph.master.gain.value).toBe(MIX_DEFAULTS.master);
    expect(graph.buses.ambient.gain.value).toBe(MIX_DEFAULTS.ambient);
    expect(graph.buses.music.gain.value).toBe(MIX_DEFAULTS.music);
  });

  it('renders and caches every sound in the bank without a browser', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    expect(graph.cached).toBe(0);
    graph.preload();
    expect(graph.cached).toBe(SOUND_NAMES.length);
    graph.play(SOUND.rockCrack);
    expect(graph.cached).toBe(SOUND_NAMES.length); // shared, not re-rendered
  });

  it('plays a one-shot through a gain into the bus it was asked for', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    expect(graph.play(SOUND.turretFire, 0.5, 1.02)).toBe(true);

    const source = ctx.sources[ctx.sources.length - 1]!;
    expect(source.starts).toBe(1);
    expect(source.loop).toBe(false);
    expect(source.playbackRate.value).toBeCloseTo(1.02, 6);
    const node = source.outputs[0] as FakeGain;
    expect(node.gain.value).toBe(0.5);
    expect(node.outputs).toEqual([graph.buses.sfx]);
  });

  it('routes an off-centre sound through a stereo panner into the bus (a3-03)', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    expect(graph.play(SOUND.turretFire, 1, 1, 'sfx', { pan: -0.6, cutoff: LP_NEAR_HZ })).toBe(true);

    expect(ctx.panners).toHaveLength(1);
    const panner = ctx.panners[0]!;
    expect(panner.pan.value).toBeCloseTo(-0.6, 6);
    // source → gain → panner → bus. The panner sits between the gain and the bus.
    const source = ctx.sources[ctx.sources.length - 1]!;
    const gain = source.outputs[0] as FakeGain;
    expect(gain.outputs).toEqual([panner]);
    expect(panner.outputs).toEqual([graph.buses.sfx]);
    // Near enough that the lowpass is bypassed — no filter node was spent.
    expect(ctx.filters).toHaveLength(0);
  });

  it('leaves a centred sound panner-free — a cue costs one gain node, not three', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    graph.play(SOUND.turretFire, 1, 1, 'sfx', { pan: 0, cutoff: LP_NEAR_HZ });
    expect(ctx.panners).toHaveLength(0);
    expect(ctx.filters).toHaveLength(0);
    const source = ctx.sources[ctx.sources.length - 1]!;
    expect((source.outputs[0] as FakeGain).outputs).toEqual([graph.buses.sfx]);
  });

  it('inserts a lowpass only once a sound is far enough to muffle', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    graph.play(SOUND.turretFire, 1, 1, 'sfx', { pan: 0.4, cutoff: LP_FAR_HZ });
    expect(ctx.filters).toHaveLength(1);
    const filter = ctx.filters[0]!;
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBeCloseTo(LP_FAR_HZ, 6);
    // source → filter → gain → panner → bus.
    const source = ctx.sources[ctx.sources.length - 1]!;
    expect(source.outputs).toEqual([filter]);
    expect((filter.outputs[0] as FakeGain).outputs).toEqual([ctx.panners[0]!]);
  });

  it('refuses a repeat of the same sound inside the gap, and counts it', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { repeatGap: 0.05 });
    expect(graph.play(SOUND.oreCollect)).toBe(true);
    expect(graph.play(SOUND.oreCollect)).toBe(false); // eight ships, one frame
    expect(graph.play(SOUND.rockCrack)).toBe(true); // a different sound is fine
    expect(graph.refused).toBe(1);
    ctx.advance(0.06);
    expect(graph.play(SOUND.oreCollect)).toBe(true);
  });

  it('caps concurrent voices rather than letting a firefight open hundreds', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { maxVoices: 3, repeatGap: 0 });
    for (let i = 0; i < 3; i++) expect(graph.play(SOUND.shotImpact)).toBe(true);
    expect(graph.play(SOUND.shotImpact)).toBe(false);
    expect(graph.voiceCount).toBe(3);
  });

  it('retires finished voices by their known end time, with no callback', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { repeatGap: 0 });
    graph.play(SOUND.rockCrack);
    expect(graph.voiceCount).toBe(1);
    ctx.advance(5);
    expect(graph.voiceCount).toBe(0);
  });

  it('starts a loop looping, and fades it out on stop rather than cutting', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const loop = graph.startLoop(SOUND.ambient, 0, 'ambient');
    const source = ctx.sources[ctx.sources.length - 1]!;
    expect(source.loop).toBe(true);
    expect(source.loopEnd).toBeGreaterThan(0);
    expect(loop.alive).toBe(true);

    loop.setGain(0.8, 2);
    expect(loop.gain).toBe(0.8);
    const node = source.outputs[0] as FakeGain;
    expect(node.gain.events.some((e) => e.kind === 'ramp' && e.value === 0.8)).toBe(true);
    // …and nothing assigns `.value` after scheduling, which would cancel it.
    expect(node.gain.value).toBe(0);

    loop.stop(0.1);
    expect(loop.alive).toBe(false);
    expect(source.stops).toBe(1);
    loop.stop(); // idempotent
    expect(source.stops).toBe(1);
  });

  it('anchors a ramp at the current value so a fade cannot jump', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    graph.setMaster(0.2, 0.5);
    const events = (graph.master.gain as FakeParam).events;
    expect(events.map((e) => e.kind)).toEqual(['cancel', 'set', 'ramp']);
    expect(events[1]!.value).toBe(MIX_DEFAULTS.master);
    expect(events[2]!.value).toBe(0.2);
  });

  it('puts the hush on its own node, downstream of master (GDD §4.7)', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    graph.setDuck(0);
    expect(graph.duckGain).toBe(0);
    expect(graph.master.gain.value).toBe(MIX_DEFAULTS.master); // untouched
    graph.setDuck(1);
    expect(graph.duckGain).toBe(1);
  });

  it('jitters deterministically, so a replay sounds like the match', () => {
    const a = new AudioGraph(new FakeAudioContext(), { seed: 5 });
    const b = new AudioGraph(new FakeAudioContext(), { seed: 5 });
    const draws = Array.from({ length: 8 }, () => a.jitter(0.1));
    expect(draws).toEqual(Array.from({ length: 8 }, () => b.jitter(0.1)));
    for (const r of draws) expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.1);
  });

  it('tears down every node it made', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { repeatGap: 0 });
    graph.play(SOUND.rockCrack);
    graph.dispose();
    expect((graph.master as FakeGain).disconnected).toBe(1);
    expect((graph.duck as FakeGain).disconnected).toBe(1);
    expect(graph.play(SOUND.rockCrack)).toBe(false);
  });
});

describe('held voices (`./weapons`)', () => {
  it('starts on demand and stops itself when the state goes quiet', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const voice = new SustainedVoice(graph, SOUND.thruster, { release: 0.05, attack: 0 });

    expect(voice.playing).toBe(false);
    voice.push(1);
    voice.update(1 / 60);
    expect(voice.playing).toBe(true);
    expect(voice.gain).toBeGreaterThan(0.5);

    for (let i = 0; i < 60; i++) voice.update(1 / 60); // nothing pushed: release
    expect(voice.playing).toBe(false);
    expect(voice.gain).toBe(0);
  });

  it('takes the strongest source rather than summing them into a clip', () => {
    const graph = new AudioGraph(new FakeAudioContext());
    const voice = new SustainedVoice(graph, SOUND.thruster, { attack: 0 });
    for (let i = 0; i < 8; i++) voice.push(0.4);
    voice.push(0.9);
    voice.update(1 / 60);
    expect(voice.gain).toBeCloseTo(0.9, 5);
  });

  it('rides pitch with what is pushed — a heavier state sounds like one', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const voice = new SustainedVoice(graph, SOUND.thruster, { attack: 0 });
    voice.push(1, 1.2);
    voice.update(1 / 60);
    const source = ctx.sources[ctx.sources.length - 1]!;
    expect(source.playbackRate.value).toBeCloseTo(1.2, 5);
  });

  it('is a no-op when nothing is ever pushed — a quiet match makes no nodes', () => {
    const ctx = new FakeAudioContext();
    const voice = new SustainedVoice(new AudioGraph(ctx), SOUND.thruster);
    for (let i = 0; i < 120; i++) voice.update(1 / 60);
    expect(voice.playing).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });
});

describe('the under-attack alarm (GDD §2.2) — sustained, not stray', () => {
  it('does not fire on a taunt-tap', () => {
    // "not a single stray shot — a taunt-tap must not trigger it". A rival who
    // taps your shield from across the map must not be able to pull you off a
    // full asteroid; if they could, the alarm would be the weapon.
    const alarm = new UnderAttackAlarm();
    alarm.damage(TELL.coreHit);
    alarm.update(1 / 60);
    expect(alarm.active).toBe(false);

    for (let i = 0; i < 5; i++) {
      alarm.damage(TELL.shieldHit);
      alarm.update(1 / 60);
    }
    expect(alarm.active).toBe(false);

    for (let i = 0; i < 120; i++) alarm.update(1 / 60); // and it leaks away
    expect(alarm.pressure).toBe(0);
  });

  it('fires on sustained fire held on the core, in well under a second', () => {
    const alarm = new UnderAttackAlarm();
    let elapsed = 0;
    while (!alarm.active && elapsed < 3) {
      alarm.damage(TELL.coreHit); // the observer emits this every damaging tick
      alarm.update(1 / 60);
      elapsed += 1 / 60;
    }
    expect(alarm.active).toBe(true);
    expect(elapsed).toBeLessThan(1);
    expect(alarm.count).toBe(1);
  });

  it('fires immediately when a turret or a shield is picked off (GDD §2.6)', () => {
    // These are not ticks of damage, they are the siege *winning* — and the
    // whole point is that the owner hears about it while they are elsewhere.
    const alarm = new UnderAttackAlarm();
    alarm.damage(TELL.turretDown);
    alarm.damage(TELL.shieldDown);
    alarm.update(1 / 60);
    expect(alarm.active).toBe(true);
  });

  it('holds through a lull rather than stuttering on and off', () => {
    const alarm = new UnderAttackAlarm();
    while (!alarm.active) {
      alarm.damage(TELL.coreHit);
      alarm.update(1 / 60);
    }
    // The attacker breaks off to dodge a turret. A flickering alarm is one a
    // player learns to ignore, which would cost the mechanic everything.
    for (let t = 0; t < MIN_HOLD_S - 0.1; t += 1 / 60) {
      alarm.update(1 / 60);
      expect(alarm.active).toBe(true);
    }
    for (let i = 0; i < 30; i++) alarm.update(1 / 60);
    expect(alarm.active).toBe(false);
  });

  it('keeps ringing while the siege continues', () => {
    const alarm = new UnderAttackAlarm();
    for (let t = 0; t < 10; t += 1 / 60) {
      alarm.damage(TELL.coreHit);
      alarm.update(1 / 60);
    }
    expect(alarm.active).toBe(true);
    expect(alarm.pressure).toBeLessThanOrEqual(2.5); // capped, not banked
  });

  it('weights only the three damage kinds the design names', () => {
    // "your core, shield, or turrets take sustained damage" — and nothing else.
    const alarm = new UnderAttackAlarm();
    for (const kind of ALL_KINDS) {
      const weight = alarm.damage(kind);
      if (weight > 0) expect(WEIGHTS[kind], TELL_NAMES[kind]).toBeGreaterThan(0);
    }
    expect(alarm.damage(TELL.oreCollect)).toBe(0);
    expect(alarm.damage(TELL.rockBurst)).toBe(0);
    expect(alarm.damage(TELL.thrust)).toBe(0);
  });

  it('goes quiet when the home it was defending is gone', () => {
    const alarm = new UnderAttackAlarm();
    while (!alarm.active) {
      alarm.damage(TELL.coreHit);
      alarm.update(1 / 60);
    }
    alarm.silence();
    expect(alarm.active).toBe(false);
    expect(alarm.pressure).toBe(0);
  });

  it('leaks at the documented rate, so the arithmetic is inspectable', () => {
    const alarm = new UnderAttackAlarm();
    alarm.damage(TELL.turretDown); // 0.8
    alarm.update(0.5);
    expect(alarm.pressure).toBeCloseTo(0.8 - LEAK * 0.5, 5);
    expect(ENGAGE).toBe(1);
  });
});

describe('the engine (`./engine`) — tells in, sound out', () => {
  const engineOn = (options = {}) => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, local: 0, ...options });
    engine.start();
    return { ctx, engine };
  };

  it('sounds every tell kind that is not a held state', () => {
    for (const kind of ALL_KINDS) {
      if (SUSTAINED_TELLS.includes(kind)) continue;
      const { engine } = engineOn();
      const tells = new TellQueue(8);
      tells.push(kind, 0, 0, 0, 0.7, 0);
      engine.consume(tells);
      expect(engine.playCount, `${TELL_NAMES[kind]} made no sound`).toBe(1);
    }
  });

  it('sustains the one held state (the thruster) instead of retriggering it', () => {
    const { ctx, engine } = engineOn();
    const tells = new TellQueue(8);
    tells.push(TELL.thrust, 0, 0, 0, 1, 0);

    for (let i = 0; i < 60; i++) {
      engine.consume(tells);
      engine.update(1 / 60);
      ctx.advance(1 / 60);
    }
    // A whole second of held throttle: one looping source, not 60 one-shots.
    expect(engine.playCount).toBe(0);
    // Three loops: the thruster, the ambient bed, and the soundtrack's calm drone
    // — firing is no longer a held voice, so there are no firing loops here.
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(3);
  });

  it('sounds firing as discrete shots now, thinned to a stream by the repeat-gap', () => {
    // Since amendment v0.3 (the mining laser retired) a shot is an event: a held trigger
    // makes a rapid train of one-shots, which the mix's repeat-gap thins so it
    // reads as a stream rather than a 60 Hz smear — no firing loop is ever made.
    const { ctx, engine } = engineOn();
    const tells = new TellQueue(4);
    tells.push(TELL.mineHit, 0, 0, 0, 1, 0);

    for (let i = 0; i < 60; i++) {
      engine.consume(tells);
      engine.update(1 / 60);
      ctx.advance(1 / 60);
    }
    // Thinned: fewer than the 60 frames, but plainly audible as a stream.
    expect(engine.playCount).toBeGreaterThan(1);
    expect(engine.playCount).toBeLessThan(60);
    // Only the standing loops (ambient + calm drone); firing made none.
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(2);
  });

  it('goes quiet for three seconds when a home dies (GDD §4.7)', () => {
    const { ctx, engine } = engineOn();
    const death = new TellQueue(4);
    death.push(TELL.stationDeath, 0, 0, 0, 1, 1);
    const noise = new TellQueue(4);
    noise.push(TELL.turretFire, 0, 0, 0, 1, 1);

    engine.consume(death);
    expect(engine.playCount).toBe(1); // the fall itself plays…

    // …the mix takes HUSH_CUT_S to reach zero, which is a shaped cut and not an
    // instant mute, so a few sounds are still starting during it.
    run(engine, ctx, 0.3, () => engine.consume(noise));
    const atSilence = engine.playCount;
    expect(engine.death.gain).toBe(0);

    // From here to the end of the three seconds: nothing starts at all. Not
    // turned down — not started (GDD §4.7).
    run(engine, ctx, HUSH_S - 0.5, () => engine.consume(noise));
    expect(engine.playCount).toBe(atSilence);
    expect(engine.hushedCount).toBeGreaterThan(50);
    expect(engine.death.silent).toBe(true);

    run(engine, ctx, 1.5, () => engine.consume(noise));
    expect(engine.playCount).toBeGreaterThan(atSilence); // the mix comes back
  });

  it('shares one death moment with the VFX field when handed one', () => {
    const death = new DeathMoment();
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, death });
    engine.start();

    const tells = new TellQueue(4);
    tells.push(TELL.stationDeath, 0, 0, 0, 1, 1);
    engine.consume(tells);
    // The field owns the trigger in that arrangement; the engine must not
    // double-count it, and must not advance it either.
    expect(death.count).toBe(0);

    death.trigger();
    death.update(0.5);
    engine.update(1 / 60);
    expect(engine.graph!.duckGain).toBe(0); // it still reads the shared object
  });

  it('rings the alarm only for the home the local player owns', () => {
    const mine = engineOn({ local: 3 });
    const theirs = engineOn({ local: 3 });
    const at = (owner: number) => {
      const q = new TellQueue(4);
      q.push(TELL.coreHit, 0, 0, 0, 0.5, owner);
      return q;
    };
    run(mine.engine, mine.ctx, 1.5, () => mine.engine.consume(at(3)));
    run(theirs.engine, theirs.ctx, 1.5, () => theirs.engine.consume(at(5)));

    expect(mine.engine.alarm.active).toBe(true);
    expect(theirs.engine.alarm.active).toBe(false);
  });

  it('scopes the alarm to a SIDE, not a slot — a teammate rings it, both enemies stay silent (TEAMS, s5)', () => {
    // Local player is slot 0; its side is {0,2} (the sim's `sameSide` roster);
    // the enemies own {1,3}. A home taking sustained fire rings the alarm iff its
    // owner is on the local player's side.
    const rings = (owner: number) => {
      const { ctx, engine } = engineOn({ local: 0 });
      engine.setAlarmScope(new Set([0, 2]), false);
      const q = new TellQueue(4);
      q.push(TELL.coreHit, 0, 0, 0, 0.5, owner);
      run(engine, ctx, 1.5, () => engine.consume(q));
      return engine.alarm.active;
    };
    expect(rings(0)).toBe(true); // your own home
    expect(rings(2)).toBe(true); // a TEAMMATE's home — the developer-report fix
    expect(rings(1)).toBe(false); // an enemy's home is never your klaxon
    expect(rings(3)).toBe(false); // …and neither is the other enemy's
  });

  it("silences on a teammate's home death the same as your own — the klaxon never rings over a dead home (TEAMS, s5)", () => {
    // The alarm rings for your SIDE {0,2}; whichever of those homes raised it,
    // that home falling must stop it (`alarm.silence`) — else it keeps ringing
    // over a station that no longer exists. The silence gate mirrors the ring gate.
    const dies = (owner: number) => {
      const { ctx, engine } = engineOn({ local: 0 });
      engine.setAlarmScope(new Set([0, 2]), false);
      const siege = new TellQueue(4);
      siege.push(TELL.coreHit, 0, 0, 0, 0.5, owner);
      run(engine, ctx, 1.5, () => engine.consume(siege)); // it is ringing…
      expect(engine.alarm.active).toBe(true);
      const death = new TellQueue(1);
      death.push(TELL.stationDeath, 0, 0, 0, 1, owner);
      engine.consume(death); // …the home falls
      return engine.alarm.active;
    };
    expect(dies(0)).toBe(false); // your own home's death silences it (as ever)
    expect(dies(2)).toBe(false); // a TEAMMATE's home death silences it too — the fix
  });

  it('does not let collapse core-entropy ring the alarm, but a real siege still does (GDD §2.3 vs §2.2)', () => {
    // During collapse every core decays on its own — that is entropy, not an
    // attacker (developer report s5, "alarm out of nowhere"). Core-hit tells the
    // decay emits must stay silent…
    const decay = engineOn({ local: 0 });
    decay.engine.setAlarmScope(new Set([0]), true);
    const core = new TellQueue(4);
    core.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(decay.engine, decay.ctx, 3, () => decay.engine.consume(core));
    expect(decay.engine.alarm.active).toBe(false);

    // …but shields and turrets do NOT decay, so a real attacker felling them
    // during collapse is honest fire and rings the alarm exactly as ever.
    const siege = engineOn({ local: 0 });
    siege.engine.setAlarmScope(new Set([0]), true);
    const falling = new TellQueue(4);
    falling.push(TELL.shieldDown, 0, 0, 0, 1, 0);
    falling.push(TELL.turretDown, 0, 0, 0, 1, 0);
    siege.engine.consume(falling);
    siege.engine.update(1 / 60);
    expect(siege.engine.alarm.active).toBe(true);
  });

  it('sounds ONE alarm sting and starts no loop — the klaxon does not keep playing (s9-01)', () => {
    // The developer, 2026-08-07: "also for the alarm, it should only play once,
    // and not keep playing". It used to be `graph.startLoop(SOUND.alarm)`, held
    // for as long as the state machine was `active` — which under sustained fire
    // is the whole siege. Music off so the loop count is only what this is about.
    const { ctx, engine } = engineOn({ local: 0, music: false });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(engine, ctx, 1, () => engine.consume(q));

    expect(engine.alarm.active).toBe(true);
    const loops = ctx.sources.filter((s) => s.loop);
    expect(loops.length).toBe(1); // the ambient bed, and nothing else
    expect(engine.alarmSounds).toBe(1); // one sting for the engagement
    const ambientRamps = (engine.graph!.buses.ambient.gain as FakeParam).events;
    expect(ambientRamps.some((e) => e.kind === 'ramp' && e.value < 1)).toBe(true);
  });

  it('sounds the alarm ONCE per engagement, however long the siege lasts (s9-01)', () => {
    // The defect, as arithmetic. `UnderAttackAlarm` holds `active` for at least
    // MIN_HOLD_S and keeps holding while the pressure stays over RELEASE, so a
    // besieger who never lets up holds it up indefinitely. Ten seconds of
    // unbroken fire is one engagement, and therefore exactly one sound.
    const { ctx, engine } = engineOn({ local: 0, music: false });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(engine, ctx, 10, () => engine.consume(q));

    expect(engine.alarm.active).toBe(true); // still under siege…
    expect(engine.alarmSounds).toBe(1); // …and it rang once, ten seconds ago
  });

  it('rings again only after a release and a RE-engage — the hysteresis is the re-trigger guard (s9-01)', () => {
    // MIN_HOLD_S and the separate lower RELEASE were written to stop a *looping*
    // alarm stuttering. With a one-shot they keep the same numbers and do a
    // better job: they are what stops an attacker's dodge-and-return
    // machine-gunning the klaxon. So the second sting has to cost a real release.
    const { ctx, engine } = engineOn({ local: 0, music: false });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);

    run(engine, ctx, 2, () => engine.consume(q)); // siege one
    expect(engine.alarmSounds).toBe(1);

    // The attacker breaks off. The hold expires, the pressure leaks away, and
    // the alarm releases — nothing sounds on the way down.
    run(engine, ctx, 4);
    expect(engine.alarm.active).toBe(false);
    expect(engine.alarmSounds).toBe(1);

    run(engine, ctx, 2, () => engine.consume(q)); // …and comes back: siege two
    expect(engine.alarm.active).toBe(true);
    expect(engine.alarmSounds).toBe(2); // one more, not one per frame
  });

  it('retries a sting the busy mix refused, rather than losing the announcement (s9-01)', () => {
    // A loop never had to survive the voice cap; a single sting does. The mix
    // refuses a one-shot when all 24 voices are in flight, and a fierce siege
    // frame is exactly when that happens — which is exactly when the alarm must
    // not be the thing that gets dropped (§4.9, not cuttable). So the engagement
    // stays unclaimed until a sting actually starts.
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, local: 0, music: false, ambient: false, mix: { maxVoices: 1 } });
    engine.start();
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);

    // Every voice spent on core-hit one-shots: the alarm engages with the mix full.
    run(engine, ctx, 1, () => engine.consume(q));
    expect(engine.alarm.active).toBe(true);

    // Stop feeding tells and let the in-flight voice expire; the pending sting
    // lands on the first frame there is room for it, and only once.
    run(engine, ctx, 1.5);
    expect(engine.alarmSounds).toBe(1);
  });

  it('counts one sting per engagement with no audio hardware at all (GDD §4.1)', () => {
    // The rule is arithmetic, not a mix feature: it holds in the mode the match
    // server, the QA harness and CI run in, where there is no context to play into.
    const engine = new AudioEngine({ local: 4 });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 4);
    for (let i = 0; i < 600; i++) {
      engine.consume(q);
      engine.update(1 / 60);
    }
    expect(engine.alarm.active).toBe(true);
    expect(engine.alarmSounds).toBe(1);
  });

  it('lets the mix back up after the sting, rather than pinning it down for the whole siege (s9-01)', () => {
    // The other half of the one-shot: `syncAlarm` used to duck for the length of
    // the LOOP and restore on release, which with a one-shot would leave the game
    // quiet for a siege that is no longer announcing itself. Duck for the sting;
    // restore; leave the siege to the arrow.
    const { ctx, engine } = engineOn({ local: 0 });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(engine, ctx, 1, () => engine.consume(q));
    expect(engine.alarmSounds).toBe(1);

    // A bus's gain rides `player level × duck factor`, so "unducked" is the
    // player's own level — which is the point of the duck being a factor: the
    // restore gives back exactly what the slider was set to, not a hardcoded 1.
    const lastGain = (bus: 'music' | 'sfx' | 'ambient') => {
      const events = (engine.graph!.buses[bus].gain as FakeParam).events;
      return events[events.length - 1]!.value;
    };
    const level = (bus: 'music' | 'sfx' | 'ambient') => engine.graph!.busLevel(bus);
    expect(lastGain('music')).toBeLessThan(level('music')); // ducked, mid-sting

    // Keep the siege going well past the sting: the mix comes back anyway.
    run(engine, ctx, 3, () => engine.consume(q));
    expect(engine.alarm.active).toBe(true); // still besieged…
    expect(engine.alarmSounds).toBe(1); // …still one sound…
    expect(lastGain('music')).toBe(level('music')); // …and the soundtrack is back
    expect(lastGain('ambient')).toBe(level('ambient'));
    expect(lastGain('sfx')).toBe(level('sfx'));
  });

  it('ducks for at least as long as the alarm actually sounds', () => {
    // ALARM_DUCK_S is a constant rather than the rendered buffer's length,
    // because the duck runs headless too. This is what keeps the constant honest:
    // re-voice the klaxon longer and the duck must be re-tuned, not silently left
    // to lift halfway through its own sound.
    const samples = renderSound(soundSpec(SOUND.alarm));
    const seconds = samples.length / DEFAULT_SAMPLE_RATE;
    expect(ALARM_DUCK_S).toBeGreaterThanOrEqual(seconds);
  });

  it('keeps the sting on the ALARM bus, so the SFX slider cannot turn a mechanic off', () => {
    // The alarm is a mechanic and on the not-cuttable list (§4.9); it has its own
    // bus for exactly that reason. The loop used to name it and the one-shot has
    // to as well — `flat()` defaults to `sfx`, which is the easy way to lose this.
    const { ctx, engine } = engineOn({ local: 0, music: false, ambient: false });
    // Follow every playing source through its gain node to the bus it sums into,
    // and measure the DELTA the siege causes — the mix has other voices in it.
    const into = (bus: AudioNodeLike) =>
      ctx.sources.filter((s) => (s.outputs[0] as FakeGain | undefined)?.outputs[0] === bus).length;
    const before = into(engine.graph!.buses.alarm);

    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(engine, ctx, 1, () => engine.consume(q));
    expect(engine.alarmSounds).toBe(1);

    // Exactly one new voice on the alarm bus — the sting. (The core-hit tells
    // that raised it are ordinary located combat and sum into `sfx`, as ever.)
    expect(into(engine.graph!.buses.alarm)).toBe(before + 1);

    // And the SFX slider at zero leaves it audible, which is what the separate
    // bus is FOR: a mechanic on the not-cuttable list is not a sound effect.
    engine.setSfxVolume(0);
    expect(engine.graph!.busLevel('sfx')).toBe(0);
    expect(engine.graph!.busLevel('alarm')).toBeGreaterThan(0);
  });

  it('rings for YOUR station and no other, with the listener on a NON-ZERO slot (s9-01)', () => {
    // The bug the developer reported was never in this predicate — it was in who
    // told it the local slot (`main.ts` captured LOCAL_PLAYER by value at boot,
    // before the server had seated the joiner, so every online client believed it
    // was slot 0). A test on slot 0 cannot see that class of defect at all: with
    // `local` wrong-but-zero, "my station" and "slot 0's station" are the same
    // set. So this one sits on slot 3 and asserts both directions.
    const ringsFor = (owner: number) => {
      const { ctx, engine } = engineOn({ local: 3, music: false });
      const q = new TellQueue(4);
      q.push(TELL.coreHit, 0, 0, 0, 0.5, owner);
      run(engine, ctx, 2, () => engine.consume(q));
      return { active: engine.alarm.active, sounds: engine.alarmSounds };
    };
    expect(ringsFor(3)).toEqual({ active: true, sounds: 1 }); // your own home
    expect(ringsFor(0)).toEqual({ active: false, sounds: 0 }); // slot 0's — the bug
    expect(ringsFor(5)).toEqual({ active: false, sounds: 0 }); // any other rival
  });

  it('KNOWN LIMIT: sustained core fire cannot raise the alarm below ~20 fps (s9-01 finding)', () => {
    // Found while trying to prove the one-shot in a booted client rather than in
    // memory: headless Chromium renders this scene at 2–4 fps, and the alarm
    // could not be made to fire there AT ALL, however hard the core was hit.
    //
    // The cause is a units mismatch that predates this lane and is not its to
    // change. Pressure is deposited per EVENT (`damage()`, +WEIGHTS[kind]) and
    // leaked per SECOND (`update(dt)`, −LEAK·dt), and `art/vfx/observer.ts`
    // emits at most ONE `coreHit` per station per rendered frame — it compares
    // the core's HP against last frame's, so ten hits in one frame are one tell.
    // Deposits therefore scale with FRAME RATE while the leak scales with time,
    // and the break-even is a frame rate, not a damage rate:
    //
    //     LEAK / WEIGHTS[coreHit]  =  1.2 / 0.06  =  20 fps
    //
    // Above it the pressure climbs to ENGAGE; below it every frame leaks more
    // than it deposits and the alarm is unreachable no matter how long the siege
    // runs. This test pins the number so a change to either constant has to face
    // it, and so the next person to find a silent alarm on a slow device finds
    // this instead of the wire.
    //
    // NOT the whole mechanic: `shieldDown` and `turretDown` weigh 0.8 — over ENGAGE
    // on their own — so a station actually losing its defences still rings at any
    // frame rate (GDD §2.6, the events that mean the siege is winning). It is
    // specifically the slow grind on a bare core that goes unannounced, which is
    // also the case a player is most likely to be away from.
    const breakEven = LEAK / WEIGHTS[TELL.coreHit]!;
    expect(breakEven, 'the arithmetic above, from the shipped constants').toBeCloseTo(20, 6);

    /** One coreHit per rendered frame for `seconds`, at `fps`. */
    const siege = (fps: number, seconds: number) => {
      const alarm = new UnderAttackAlarm();
      const dt = 1 / fps;
      for (let t = 0; t < seconds; t += dt) {
        alarm.damage(TELL.coreHit);
        alarm.update(dt);
      }
      return { active: alarm.active, pressure: alarm.pressure };
    };

    // 60 fps: 3.6/s in, 1.2/s out — it engages, and fast (this is every other
    // test in this file, and real play on real hardware).
    expect(siege(60, 2).active, 'a normal frame rate raises the alarm').toBe(true);
    // 30 fps: 1.8/s in, still ahead. The design holds through a bad-but-playable
    // frame rate, which is the case worth protecting.
    expect(siege(30, 4).active, 'and so does a struggling one').toBe(true);
    // 10 fps: 0.6/s in against 1.2/s out. Thirty seconds of unbroken fire on your
    // core, and the klaxon never sounds — the pressure cannot even reach ENGAGE.
    const slow = siege(10, 30);
    expect(slow.active, 'but a slow device never hears it').toBe(false);
    expect(slow.pressure, 'and is not even close — it is pinned near zero').toBeLessThan(ENGAGE);
  });

  it('ducks the soundtrack and the SFX under the alarm, not just the ambience', () => {
    // The brief's mix pass: "music and SFX duck under the alarm." The soundtrack
    // and ambience drop hard; the SFX only step aside, because they are the
    // mechanics the alarm is telling you about (GDD §2.2).
    const { ctx, engine } = engineOn({ local: 0 });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(engine, ctx, 1, () => engine.consume(q));
    expect(engine.alarm.active).toBe(true);

    const ducked = (bus: 'music' | 'sfx' | 'ambient') =>
      (engine.graph!.buses[bus].gain as FakeParam).events.some((e) => e.kind === 'ramp' && e.value < 1);
    expect(ducked('music')).toBe(true);
    expect(ducked('sfx')).toBe(true);
    expect(ducked('ambient')).toBe(true);

    // …and the SFX are ducked *less* than the soundtrack — they must stay heard.
    const lowest = (bus: 'music' | 'sfx') => {
      const ramps = (engine.graph!.buses[bus].gain as FakeParam).events.filter((e) => e.kind === 'ramp');
      return Math.min(...ramps.map((e) => e.value));
    };
    expect(lowest('sfx')).toBeGreaterThan(lowest('music'));
  });

  it('stops the alarm when the home it was defending dies', () => {
    const { ctx, engine } = engineOn({ local: 2 });
    const hits = new TellQueue(4);
    hits.push(TELL.coreHit, 0, 0, 0, 0.1, 2);
    run(engine, ctx, 1, () => engine.consume(hits));
    expect(engine.alarm.active).toBe(true);

    const death = new TellQueue(4);
    death.push(TELL.stationDeath, 0, 0, 0, 1, 2);
    engine.consume(death);
    engine.update(1 / 60);
    // An alarm over a dead station would tell a player to defend a wreck — and
    // it would ring straight through the three seconds nobody jokes in.
    expect(engine.alarm.active).toBe(false);
  });

  it('falls off with distance so a far siege is background, not a wall', () => {
    const { engine } = engineOn();
    engine.setListener(0, 0);
    const near = new TellQueue(4);
    near.push(TELL.turretFire, EARSHOT_NEAR / 2, 0, 0, 1, 1);
    const far = new TellQueue(4);
    far.push(TELL.turretFire, EARSHOT_FAR * 2, 0, 0, 1, 1);

    engine.consume(far);
    expect(engine.playCount).toBe(0); // over the horizon
    engine.consume(near);
    expect(engine.playCount).toBe(1);
  });

  it('plays everything at full level with no listener — a spectator, or a test', () => {
    const { engine } = engineOn();
    const q = new TellQueue(4);
    q.push(TELL.turretFire, 99999, 99999, 0, 1, 1);
    engine.consume(q);
    expect(engine.playCount).toBe(1);
  });

  it('places world sound around the listener: own fire full, a far fight silent, pan by side (a3-03)', () => {
    const { engine } = engineOn({ local: 0 });
    engine.setListener(0, 0);
    // Own gun, at the camera: full and centred.
    const here = engine.probe(0, 0);
    expect(here.gain).toBe(1);
    expect(here.pan).toBe(0);
    // A fight to the right vs the left, same distance: opposite pan, equal weight.
    const right = engine.probe(700, 0);
    const left = engine.probe(-700, 0);
    expect(right.pan).toBeGreaterThan(0);
    expect(left.pan).toBeLessThan(0);
    expect(right.pan).toBeCloseTo(-left.pan, 6);
    // A siege on the far side of the claim: culled to silence.
    const farFight = engine.probe(EARSHOT_FAR * 2, 0);
    expect(farFight.gain).toBe(0);
    expect(farFight.culled).toBe(true);
  });

  it('actually pans a placed one-shot and records it for the audio spy', () => {
    const { ctx, engine } = engineOn({ local: 0 });
    engine.setListener(0, 0);
    const q = new TellQueue(4);
    q.push(TELL.turretFire, -700, 0, 0, 1, 1); // an enemy turret, off to the left
    engine.consume(q);

    expect(engine.playCount).toBe(1);
    expect(engine.lastPlacement.pan).toBeLessThan(0); // the spy sees the direction
    expect(ctx.panners).toHaveLength(1);
    expect(ctx.panners[0]!.pan.value).toBeLessThan(0); // and the mix applied it
  });

  it('keeps the wave klaxon, the collapse and the match-end non-spatial (GDD §2.3)', () => {
    // Emitted "at the arena centre", these must not fall off for a player at the
    // rim of an eight-facility claim: the wave clock is a mechanic everyone hears.
    for (const kind of [TELL.waveArrive, TELL.collapseBegin, TELL.matchEnd]) {
      const { engine } = engineOn({ local: 0 });
      engine.setListener(0, 0);
      const q = new TellQueue(4);
      q.push(kind, EARSHOT_FAR * 4, 0, 0, 0.6, -1); // far past the horizon
      engine.consume(q);
      expect(engine.playCount, `${TELL_NAMES[kind]} was culled`).toBe(1);
    }
  });

  it('plays the death sting full and centred wherever the home died (GDD §4.7, a3-03)', () => {
    const { ctx, engine } = engineOn({ local: 0 });
    engine.setListener(0, 0);
    const death = new TellQueue(4);
    death.push(TELL.stationDeath, EARSHOT_FAR * 4, 0, 0, 1, 1); // way off-screen
    engine.consume(death);
    expect(engine.playCount).toBe(1); // heard, not culled
    expect(ctx.panners).toHaveLength(0); // and not panned — it is a sting
  });

  it('runs silent with no context at all — the server, the harness (GDD §4.1)', () => {
    const engine = new AudioEngine({ local: 0 });
    expect(engine.audible).toBe(false);
    expect(engine.graph).toBeNull();

    const q = new TellQueue(64);
    // Every kind except the death — a station dying every frame would silence
    // the alarm every frame, which is correct behaviour and a useless test.
    for (const kind of ALL_KINDS) {
      if (kind !== TELL.stationDeath) q.push(kind, 0, 0, 0, 0.5, 0);
    }
    for (let i = 0; i < 120; i++) {
      engine.consume(q);
      engine.update(1 / 60);
    }
    // The numbers still run: the alarm state machine is not an audio feature.
    expect(engine.alarm.active).toBe(true);
    expect(engine.playCount).toBe(0);
    engine.dispose();
  });

  it('opens the ambient bed at silence and fades it up, so it never arrives (a0-48)', () => {
    // *"when i press play im immediately greeted by this background sound"* — the
    // other half of a0-48, and the half that is not in the voice. The bed is the
    // one loop in the mix that is never an event, so it may not have an onset at
    // any level: the source starts at gain 0 and is ramped, never assigned.
    const { ctx, engine } = engineOn({ music: false });
    const source = ctx.sources.find((s) => s.loop);
    expect(source, 'the bed did not start at all').toBeDefined();
    const node = source!.outputs[0] as FakeGain;
    expect(node.gain.value, 'the bed opens at a level — that is an onset').toBe(0);
    const ramp = node.gain.events.find((e) => e.kind === 'ramp' && e.value === 1);
    expect(ramp, 'the bed jumps to full instead of ramping').toBeDefined();
    // And the ramp is long enough to be a fade rather than a fast open. Asserted
    // against the constant so the two cannot drift, and against a floor so the
    // constant cannot be quietly turned back down to something audible as a start.
    expect(ramp!.time - ctx.currentTime).toBeCloseTo(AMBIENT_FADE_IN_S, 5);
    expect(AMBIENT_FADE_IN_S, 'a bed that reaches full this fast is heard arriving').toBeGreaterThanOrEqual(4);
    engine.dispose();
  });

  it('can drop the ambient bed without touching anything else (GDD §4.9)', () => {
    const { ctx, engine } = engineOn();
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(1);
    engine.setAmbient(false);
    const q = new TellQueue(4);
    q.push(TELL.rockCrack, 0, 0, 0, 1, 1);
    engine.consume(q);
    expect(engine.playCount).toBe(1); // SFX are mechanics; they stay
  });

  it('resets for a rematch and disposes cleanly', () => {
    const { ctx, engine } = engineOn({ local: 0 });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.2, 0);
    run(engine, ctx, 1, () => engine.consume(q));
    expect(engine.alarm.active).toBe(true);

    engine.reset();
    expect(engine.alarm.active).toBe(false);
    engine.dispose();
    expect(engine.running).toBe(false);
  });

  it('scales the projectile impact with damage — a tier-4 shot lands heavier', () => {
    const gainOf = (magnitude: number): number => {
      const ctx = new FakeAudioContext();
      const engine = new AudioEngine({ context: ctx, local: 0 });
      engine.start();
      const q = new TellQueue(4);
      q.push(TELL.shotImpact, 0, 0, 0, magnitude, 1);
      engine.consume(q);
      const source = ctx.sources[ctx.sources.length - 1]!;
      return (source.outputs[0] as FakeGain).gain.value;
    };
    expect(gainOf(1)).toBeGreaterThan(gainOf(0));
  });
});

describe('the device cues (`./engine` cue — the p4-03 seams)', () => {
  const engineOn = () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, local: 0 });
    engine.start();
    return { ctx, engine };
  };
  const CUES: AudioCue[] = ['press', 'confirm', 'reject', 'deposit', 'respawnBeep', 'respawnGo', 'ping'];

  it('sounds every cue in the vocabulary, into a mapped bank sound', () => {
    for (const kind of CUES) {
      const { engine } = engineOn();
      engine.cue(kind);
      expect(engine.playCount, `${kind} made no sound`).toBe(1);
      expect(SOUND_NAMES).toContain(CUE_SOUND[kind]);
    }
  });

  it('plays a cue at full level regardless of the listener — a menu is nowhere', () => {
    const { engine } = engineOn();
    engine.setListener(0, 0);
    engine.cue('ping'); // even from "nowhere", a UI cue is not distance-attenuated
    expect(engine.playCount).toBe(1);
  });

  it('stays silent through the three-second hush like everything else (GDD §4.7)', () => {
    const { ctx, engine } = engineOn();
    const death = new TellQueue(4);
    death.push(TELL.stationDeath, 0, 0, 0, 1, 1);
    engine.consume(death);
    run(engine, ctx, 0.3); // let the mix reach zero
    expect(engine.death.gain).toBe(0);

    const before = engine.playCount;
    engine.cue('confirm');
    expect(engine.playCount).toBe(before); // not started — the quiet is protected
    expect(engine.hushedCount).toBeGreaterThan(0);
  });

  it('runs silent with no context — a UI cue on the server or the harness is a no-op', () => {
    const engine = new AudioEngine({ local: 0 });
    expect(() => engine.cue('press')).not.toThrow();
    expect(engine.playCount).toBe(0);
  });
});

describe('the end-of-match summary cues (p1-07 — the seam pr-05 plays)', () => {
  const engineOn = () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, local: 0 });
    engine.start();
    return { ctx, engine };
  };

  it('sounds the three summary cues into their own new bank slots', () => {
    // The one that would be a real defect: a summary cue quietly wired to a
    // DENIED slot. `CUE_SOUND` is the map pr-05 plays through, so it is the map
    // that has to be checked, not the bank entries beside it.
    const map: readonly (readonly [AudioCue, SoundName])[] = [
      ['xpTick', SOUND.xpTick],
      ['levelUp', SOUND.levelUp],
      ['xpSettle', SOUND.xpSettle],
    ];
    for (const [cue, sound] of map) {
      const { engine } = engineOn();
      expect(CUE_SOUND[cue], `${cue} is not wired to its own slot`).toBe(sound);
      engine.cue(cue);
      expect(engine.playCount, `${cue} made no sound`).toBe(1);
    }
  });

  it('rides the count-up tick UP, and stops climbing rather than going shrill', () => {
    // *"Pitched up slightly as the count rises"* (plan §6.5) is playback rate at
    // this seam, not forty specs — so this is where it is asserted. The cap is
    // the half that matters: a count-up has no fixed length, and an uncapped
    // rise ends somewhere different, and eventually somewhere shrill, on a long
    // match.
    const { ctx, engine } = engineOn();
    const rates: number[] = [];
    for (const i of [0, 1, 2, 5, XP_TICK_STEPS_MAX, XP_TICK_STEPS_MAX + 40]) {
      const before = ctx.sources.length;
      engine.cue('xpTick', i);
      // A tick may be refused by the repeat gap; advance past it so each lands.
      ctx.advance(MIX_DEFAULTS.repeatGap * 2);
      const source = ctx.sources[before];
      expect(source, `tick ${i} started no source`).toBeDefined();
      rates.push(source!.playbackRate.value);
    }
    expect(rates[0]).toBeCloseTo(1, 6); // the first tick is the pitch it was voiced at
    for (let i = 1; i < 4; i++) expect(rates[i]!).toBeGreaterThan(rates[i - 1]!);
    // The climb is *slight*: four semitones end to end, and it stops there.
    expect(rates[4]).toBeCloseTo(Math.pow(2, (XP_TICK_STEPS_MAX * XP_TICK_SEMITONES) / 12), 6);
    expect(rates[5]).toBe(rates[4]);
    expect(rates[4]!).toBeLessThan(Math.pow(2, 5 / 12)); // under a fourth, always
  });

  it('starts the bar bed on the first frame of the fill and rides it open', () => {
    const { ctx, engine } = engineOn();
    expect(engine.xpFilling).toBe(false);
    engine.xpFill(0);
    expect(engine.xpFilling).toBe(true);
    const started = ctx.sources.filter((s) => s.loop).length;

    const loopGain = ctx.gains[ctx.gains.length - 1]!;
    const opening = loopGain.gain.events.at(-1)!.value;
    engine.xpFill(1);
    expect(engine.xpFilling).toBe(true);
    // Riding it is not restarting it: one loop source for the whole fill.
    expect(ctx.sources.filter((s) => s.loop).length).toBe(started);
    expect(loopGain.gain.events.at(-1)!.value).toBeGreaterThan(opening);
    // Every level change is ramped, never set — a jump on a held voice clicks.
    expect(loopGain.gain.events.every((e) => e.kind !== 'set' || e.value === 0)).toBe(true);
  });

  it('ducks the bed under a level-up landing on it, and lets it back up', () => {
    // Plan §6.5: *"must duck cleanly under a `levelUp` landing on top of it."*
    // Ducked and not stopped, because beat 4 is a pause in the fill and not the
    // end of it — the bar resumes with whatever XP is left.
    const { ctx, engine } = engineOn();
    engine.xpFill(0.5);
    const loopGain = ctx.gains[ctx.gains.length - 1]!;
    const level = () => loopGain.gain.events.at(-1)!.value;
    const open = level();

    engine.cue('levelUp');
    const ducked = level();
    expect(ducked).toBeLessThan(open);
    expect(ducked / open).toBeCloseTo(XP_FILL_DUCK, 6);
    expect(engine.xpFilling, 'the bed stopped instead of stepping aside').toBe(true);

    run(engine, ctx, XP_FILL_DUCK_S + 0.2);
    expect(level()).toBeCloseTo(open, 6);
  });

  it('stops the bed on a skip rather than leaving it under the buttons', () => {
    const { ctx, engine } = engineOn();
    engine.xpFill(0.4);
    const source = ctx.sources.filter((s) => s.loop).at(-1)!;
    engine.stopXpFill();
    expect(engine.xpFilling).toBe(false);
    run(engine, ctx, 0.5);
    expect(source.stops, 'the bar bed outlived the screen').toBeGreaterThan(0);
    // And a rematch cannot inherit last match's bar.
    engine.xpFill(0.4);
    engine.reset();
    expect(engine.xpFilling).toBe(false);
  });

  it('never starts the bed inside the three-second hush (GDD §4.7)', () => {
    const { ctx, engine } = engineOn();
    const death = new TellQueue(4);
    death.push(TELL.stationDeath, 0, 0, 0, 1, 1);
    engine.consume(death);
    run(engine, ctx, 0.3);
    expect(engine.death.gain).toBe(0);

    engine.xpFill(0.5);
    expect(engine.xpFilling, 'a bar filled through the quiet').toBe(false);
    // And it recovers on its own once the ache has had its beat.
    run(engine, ctx, HUSH_S + 0.5);
    engine.xpFill(0.6);
    expect(engine.xpFilling).toBe(true);
  });

  it('runs silent with no context — the summary on the server or the harness', () => {
    const engine = new AudioEngine({ local: 0 });
    expect(() => {
      engine.cue('xpTick', 3);
      engine.xpFill(0.5);
      engine.stopXpFill();
    }).not.toThrow();
    expect(engine.xpFilling).toBe(false);
    expect(engine.playCount).toBe(0);
  });
});

describe('the adaptive soundtrack (`./music`) — following the match', () => {
  /** Advance a pure score for `seconds`, optionally doing something each frame. */
  const drive = (score: MusicScore, seconds: number, each?: () => void): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      each?.();
      score.update(1 / 60);
    }
  };

  it('opens on the calm drone — bed only, no theme, no pulse', () => {
    const score = new MusicScore();
    expect(score.phase).toBe('calm');
    expect(score.gains).toEqual({ bed: 1, pulse: 0, theme: 0, dread: 0 });
  });

  it('raises the pulse as the waves arrive, and never lowers it again', () => {
    const score = new MusicScore();
    score.wave(0.4); // wave 2 of 5
    score.update(1 / 60);
    expect(score.phase).toBe('rising');
    expect(score.tension).toBeCloseTo(0.4, 5);
    expect(score.gains.pulse).toBeCloseTo(0.4, 5);

    // A later, *smaller* magnitude must not walk the tension back down — the
    // waves only ever pull the match tighter (GDD §2.3).
    score.wave(0.2);
    score.update(1 / 60);
    expect(score.tension).toBeCloseTo(0.4, 5);
  });

  it('heats the theme in a fight, but not while mining — the inversion (GDD §2.3)', () => {
    const fighting = new MusicScore();
    drive(fighting, 0.6, () => fighting.combat(TELL.weaponHit));
    expect(fighting.gains.theme).toBeGreaterThan(0);

    const mining = new MusicScore();
    drive(mining, 0.6, () => mining.combat(TELL.mineHit));
    expect(mining.gains.theme).toBe(0);
    expect(mining.phase).toBe('calm');
  });

  it('forces the full theme fast when the local home is under siege (GDD §2.6)', () => {
    const score = new MusicScore();
    score.setUnderAttack(true); // the alarm is ringing
    drive(score, 0.5);
    expect(score.intensity).toBeGreaterThan(SIEGE_ON);
    expect(score.phase).toBe('siege');
    expect(score.gains.theme).toBeGreaterThan(SIEGE_ON);
  });

  it('lets the theme recede once the shooting stops', () => {
    const score = new MusicScore();
    score.setUnderAttack(true);
    drive(score, 1);
    const peak = score.gains.theme;
    score.setUnderAttack(false);
    drive(score, 3); // the leak takes over
    expect(score.gains.theme).toBeLessThan(peak);
    expect(score.gains.theme).toBeLessThan(0.1);
  });

  it('thins the bed to dread through the collapse (GDD §2.3)', () => {
    const score = new MusicScore();
    score.wave(0.6);
    score.collapse();
    score.update(1 / 60);
    expect(score.phase).toBe('collapse');
    expect(score.gains.bed).toBe(0);
    expect(score.gains.pulse).toBe(0);
    expect(score.gains.theme).toBe(0);
    expect(score.gains.dread).toBe(1);
  });

  it('goes silent and queues a sting on the win or the loss', () => {
    const win = new MusicScore();
    win.collapse();
    win.end(true);
    win.update(1 / 60);
    expect(win.phase).toBe('over');
    expect(win.gains).toEqual({ bed: 0, pulse: 0, theme: 0, dread: 0 }); // the sting owns the last beat
    expect(win.pendingSting).toBe('win');
    expect(win.won).toBe(true);

    const loss = new MusicScore();
    loss.end(false);
    expect(loss.pendingSting).toBe('loss');
    expect(loss.won).toBe(false);
  });

  it('weights combat broadly but leaves mining and the clock out of it', () => {
    const score = new MusicScore();
    expect(score.combat(TELL.mineHit)).toBe(0);
    expect(score.combat(TELL.waveArrive)).toBe(0);
    expect(score.combat(TELL.coreHit)).toBeGreaterThan(0);
    for (const kind of ALL_KINDS) {
      const w = MUSIC_COMBAT[kind];
      if (w !== undefined) expect(w).toBeGreaterThan(0);
    }
  });

  it('resets to the opening drone for a rematch', () => {
    const score = new MusicScore();
    score.wave(1);
    score.setUnderAttack(true);
    drive(score, 1);
    score.collapse();
    score.end(false);
    score.reset();
    expect(score.phase).toBe('calm');
    expect(score.gains).toEqual({ bed: 1, pulse: 0, theme: 0, dread: 0 });
    expect(score.pendingSting).toBeNull();
  });

  it('starts its stems lazily and crossfades them in — no cut', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const score = new MusicScore();
    const director = new MusicDirector(graph, score);

    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(0); // nothing until driven
    for (let i = 0; i < 120; i++) {
      score.update(1 / 60);
      director.update(1 / 60, 1);
      ctx.advance(1 / 60);
    }
    // The calm bed came up on its own, and it came up ramped, not snapped on.
    expect(ctx.sources.filter((s) => s.loop).length).toBeGreaterThanOrEqual(1);
    const bed = ctx.sources.find((s) => s.loop)!;
    const node = bed.outputs[0] as FakeGain;
    expect(node.gain.events.some((e) => e.kind === 'ramp')).toBe(true);
  });

  it('holds the win sting until the three-second quiet has lifted (GDD §4.7)', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const score = new MusicScore();
    const director = new MusicDirector(graph, score);
    score.end(true);

    // Through the hush — the mix is at (or near) zero — nothing sounds.
    for (let i = 0; i < 60; i++) {
      score.update(1 / 60);
      director.update(1 / 60, 0);
      ctx.advance(1 / 60);
    }
    expect(director.stingCount).toBe(0);
    expect(score.pendingSting).toBe('win');

    // The quiet lifts (gain climbs back past the gate): the sting lands, once.
    director.update(1 / 60, STING_GATE + 0.1);
    expect(director.stingCount).toBe(1);
    expect(score.pendingSting).toBeNull();
    director.update(1 / 60, 1);
    expect(director.stingCount).toBe(1); // not again
  });

  it('stops its stems when the soundtrack is switched off (GDD §4.9 item 3)', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const score = new MusicScore();
    const director = new MusicDirector(graph, score);
    for (let i = 0; i < 30; i++) {
      score.update(1 / 60);
      director.update(1 / 60, 1);
      ctx.advance(1 / 60);
    }
    const started = ctx.sources.filter((s) => s.loop).length;
    expect(started).toBeGreaterThanOrEqual(1);

    director.setEnabled(false);
    expect(director.playing).toBe(false);
    director.update(1 / 60, 1);
    // Every loop it started has been asked to stop, and nothing new is pushed.
    for (const s of ctx.sources.filter((x) => x.loop)) expect(s.stops).toBeGreaterThan(0);
  });

  it('drives the whole arc through the engine, sting and all', () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, local: 0 });
    engine.start();
    const step = () => {
      engine.update(1 / 60);
      ctx.advance(1 / 60);
    };
    const feed = (kind: TellKind, magnitude = 1, player = 0) => {
      const q = new TellQueue(4);
      q.push(kind, 0, 0, 0, magnitude, player);
      engine.consume(q);
    };

    expect(engine.musicScore.phase).toBe('calm');

    feed(TELL.waveArrive, 0.4, -1);
    step();
    expect(engine.musicScore.phase).toBe('rising');

    for (let i = 0; i < 40; i++) {
      feed(TELL.coreHit, 0.5, 0); // a siege on my own home
      step();
    }
    expect(engine.musicScore.phase).toBe('siege');
    expect(engine.alarm.active).toBe(true);

    feed(TELL.collapseBegin, 1, -1);
    step();
    expect(engine.musicScore.phase).toBe('collapse');

    feed(TELL.matchEnd, 1, -1); // a win
    // No station death in this synthetic arc, so the hush is not down: the sting
    // lands on the next frame.
    step();
    expect(engine.musicScore.phase).toBe('over');
    expect(engine.music!.stingCount).toBe(1);
  });
});

describe('the first gesture (`./unlock`) — GDD risk 7', () => {
  class FakeTarget implements UnlockTarget {
    readonly handlers = new Map<string, (() => void)[]>();

    addEventListener(type: string, listener: () => void): void {
      const list = this.handlers.get(type) ?? [];
      list.push(listener);
      this.handlers.set(type, list);
    }

    removeEventListener(type: string, listener: () => void): void {
      const list = (this.handlers.get(type) ?? []).filter((l) => l !== listener);
      this.handlers.set(type, list);
    }

    get count(): number {
      let n = 0;
      for (const list of this.handlers.values()) n += list.length;
      return n;
    }

    fire(type: string): void {
      for (const listener of [...(this.handlers.get(type) ?? [])]) listener();
    }
  }

  it('listens for every gesture a player could make first', () => {
    const target = new FakeTarget();
    const unlock = new AudioUnlock(new FakeAudioContext(), target);
    unlock.arm();
    expect(target.count).toBe(UNLOCK_EVENTS.length);
    unlock.arm(); // idempotent
    expect(target.count).toBe(UNLOCK_EVENTS.length);
  });

  it('resumes and starts a silent source inside the gesture (the iOS half)', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    const unlock = new AudioUnlock(ctx, new FakeTarget());
    const ok = await unlock.unlockNow();

    expect(ok).toBe(true);
    expect(ctx.resumes).toBe(1);
    // resume() alone is not sufficient on iOS Safari: a buffer source must have
    // been started from inside a real user-gesture task.
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.starts).toBe(1);
    expect(unlock.unlocked).toBe(true);
  });

  it('detaches its listeners once, and calls back once', async () => {
    const ctx = new FakeAudioContext();
    const target = new FakeTarget();
    let unlocked = 0;
    const unlock = new AudioUnlock(ctx, target, { onUnlock: () => unlocked++ });
    unlock.arm();

    target.fire('pointerdown');
    await Promise.resolve();
    await Promise.resolve();

    expect(unlock.gestures).toBe(1);
    expect(target.count).toBe(0);
    expect(unlocked).toBe(1);
  });

  it('re-arms when the context is suspended again — a phone that locked', async () => {
    const ctx = new FakeAudioContext();
    const target = new FakeTarget();
    const unlock = new AudioUnlock(ctx, target);
    await unlock.unlockNow();
    expect(unlock.listening).toBe(false);

    ctx.state = 'suspended'; // screen lock, tab backgrounded, a phone call
    unlock.recheck();
    expect(unlock.listening).toBe(true);
    expect(target.count).toBe(UNLOCK_EVENTS.length);
  });

  it('reports failure rather than throwing when a browser refuses', async () => {
    const ctx = new FakeAudioContext();
    ctx.resume = async () => {
      throw new Error('denied');
    };
    const unlock = new AudioUnlock(ctx, new FakeTarget());
    await expect(unlock.unlockNow()).resolves.toBe(false);
    expect(unlock.unlocked).toBe(false);
  });

  it('stays suspended-aware: a resume that did not take is not an unlock', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    ctx.resume = async () => {
      ctx.resumes++; // some engines resolve without actually resuming
    };
    const unlock = new AudioUnlock(ctx, new FakeTarget());
    expect(await unlock.unlockNow()).toBe(false);
    expect(unlock.unlocked).toBe(false);
  });

  it('finds no target in Node, where there is no gesture to wait for', () => {
    // `globalThis` in Node has no addEventListener; the game runs silent and
    // says so, rather than throwing on the server (GDD §4.1).
    const target = defaultUnlockTarget();
    if (target !== null) expect(typeof target.addEventListener).toBe('function');
  });
});
