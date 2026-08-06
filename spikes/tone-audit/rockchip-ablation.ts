/**
 * spikes/tone-audit/rockchip-ablation.ts — THROWAWAY measurement code (s7-01).
 * OWNER: Architect Agent. Not in the bundle, not in tsconfig `include`, imported
 * by nothing. Run by hand:
 *
 *     npx vite-node spikes/tone-audit/rockchip-ablation.ts
 *     npx vite-node spikes/tone-audit/rockchip-ablation.ts --wav
 *
 * ## The question
 *
 * The developer has judged `rockChip` twice — *"almost there, but they should be
 * lower in tone"* (s4-01) and then, after s4-01 shipped, *"rockchip needs to be
 * redone as well, it still has that toony sound"*. If the note is the same sound
 * twice, either the fix did not land or the fix was aimed at the wrong parameter.
 * This script answers which, by ablation: it renders the shipped voice with one
 * parameter removed at a time and measures what each one is worth.
 *
 * ## What it measures, and why each number is here
 *
 *  - **centroid** — spectral centroid in Hz, the "how bright" number. The one the
 *    word *"lower"* is usually about.
 *  - **zcr(2k)** — zero crossings per sample over a fixed 2048-sample window past
 *    the attack. This is exactly the proxy `candidates.test.ts` locks the s4-01
 *    direction with, so a proposal can be checked against that ceiling directly.
 *  - **phone** — the share of energy above 500 Hz. A phone speaker rolls off hard
 *    below that, so this is roughly "how much of this sound a phone can emit at
 *    all". It is the number that makes "lower" dangerous: the sound is
 *    `TELL.mineHit`, it fires all match, and the mobile gate (GDD §4.3) is a
 *    first-class target.
 *  - **sub** — the share of energy below 200 Hz. Energy here costs headroom,
 *    stacks when the voice retriggers, and a phone cannot reproduce it.
 *  - **rate** — RMS of the voice overlap-added at the mix's retrigger ceiling
 *    (`graph.ts` `repeatGap` = 0.035 s → 28.6 Hz). Mining is a held trigger, so
 *    this — not the single hit — is what the player actually hears. It is the
 *    "does it go boomy at rate" check.
 *  - **vs hull** — the shipped `hullHit`'s zcr over the rock's. `audio.test.ts`
 *    requires hull > rock × 1.8, so this column must never fall under 1.8.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SAMPLE_RATE,
  renderVoice,
  renderLayered,
  peak,
  rms,
  type VoiceSpec,
} from '../../src/art/audio/synth';
import { isLayered, soundSpec, SOUND } from '../../src/art/audio/bank';

const RATE = DEFAULT_SAMPLE_RATE;
const HERE = dirname(fileURLToPath(import.meta.url));

/** The mix's repeat gap (`src/art/audio/graph.ts` MIX_DEFAULTS.repeatGap). */
const REPEAT_GAP_S = 0.035;

/** The shipped voice, byte-identical to `bank.ts` since a3-02 (`6cb84d8`). */
const SHIPPED = soundSpec(SOUND.rockChip) as VoiceSpec;

// ---------------------------------------------------------------------------
// The variants
// ---------------------------------------------------------------------------

interface Variant {
  readonly label: string;
  readonly note: string;
  readonly spec: VoiceSpec;
}

const noVibrato = { vibratoDepth: undefined, vibratoRate: undefined };

const VARIANTS: readonly Variant[] = [
  { label: 'shipped', note: 'bank.ts as it stands — the sound judged twice', spec: SHIPPED },
  {
    label: '−wobble',
    note: 'vibratoDepth/Rate removed, everything else identical',
    spec: { ...SHIPPED, ...noVibrato },
  },
  {
    label: '−chirp',
    note: 'freqEnd = freq (no glide), everything else identical',
    spec: { ...SHIPPED, freqEnd: SHIPPED.freq },
  },
  {
    label: '−both',
    note: 'no wobble and no chirp — the shipped voice with its character removed',
    spec: { ...SHIPPED, ...noVibrato, freqEnd: SHIPPED.freq },
  },
  {
    label: 's4-01 "a"',
    note: 'the transposition the developer never heard in game (candidates.ts only)',
    spec: {
      name: 'rockChip_dryTick',
      wave: 'noise',
      attack: 0.001,
      hold: 0.008,
      decay: 0.05,
      punch: 0.5,
      freq: 76,
      freqEnd: 54,
      lowPass: 220,
      highPass: 50,
      gain: 0.44,
      seed: 20480,
    },
  },
  {
    label: 'octave-only',
    note: 'the shipped voice transposed down an octave, wobble and chirp KEPT',
    spec: { ...SHIPPED, freq: 75, freqEnd: 50, lowPass: 575 },
  },
  {
    label: 'octave −wob',
    note: 'the same transposition with the wobble removed — the control for the row above',
    spec: { ...SHIPPED, ...noVibrato, freq: 75, freqEnd: 50, lowPass: 575 },
  },
  {
    label: 'PROPOSED',
    note: 'lower AND unshaped: no wobble, glide under the chirp threshold, sub trimmed',
    spec: {
      name: 'rockChip',
      wave: 'noise',
      attack: 0.0008,
      hold: 0.009,
      decay: 0.062,
      punch: 0.55,
      freq: 92,
      freqEnd: 82,
      lowPass: 820,
      highPass: 130,
      gain: 0.42,
      seed: 0x9e37,
    },
  },
];

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function render(spec: VoiceSpec): Float32Array {
  return renderVoice(spec, RATE);
}

function renderShipped(name: keyof typeof SOUND): Float32Array {
  const spec = soundSpec(SOUND[name]);
  return isLayered(spec) ? renderLayered(spec.layers, RATE) : renderVoice(spec, RATE);
}

/** Magnitude spectrum of the loudest 8192-sample window, Hann-windowed. */
function spectrum(samples: Float32Array): { mag: Float64Array; binHz: number } {
  const N = 8192;
  const frame = new Float32Array(N);
  frame.set(samples.subarray(0, Math.min(N, samples.length)));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    re[i] = (frame[i] ?? 0) * w;
  }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k] ?? 0, im[k] ?? 0);
  return { mag, binHz: RATE / N };
}

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

function centroidHz(samples: Float32Array): number {
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
    const f = k * binHz;
    total += e;
    if (f >= lo && f < hi) band += e;
  }
  return total > 0 ? band / total : 0;
}

/** The `candidates.test.ts` proxy, verbatim, so a proposal can be checked against it. */
function zcrWindow(samples: Float32Array): number {
  const from = Math.round(0.003 * RATE);
  const to = Math.min(samples.length, from + 2048);
  let n = 0;
  for (let i = from + 1; i < to; i++) if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
  return n / Math.max(1, to - from);
}

/**
 * **The modulation index** — the number the brightness metrics cannot see.
 *
 * A vibrato on a pitched-noise grain does not move the average spectrum at all;
 * it moves the grain rate *periodically*, and the ear hears that as a wobble.
 * So: take the zero-crossing rate in short frames, and report how much it varies
 * frame to frame (coefficient of variation) plus where that variation peaks in
 * frequency. A steady grain sits near zero with no peak; a 22 Hz vibrato shows a
 * peak at ~22 Hz. This is the measurement that separates *"lower"* from
 * *"not a toy"*, and it is why s4-01 could hit its number and still be re-reported.
 */
function modulation(samples: Float32Array): { cv: number; peakHz: number } {
  const frame = Math.round(0.005 * RATE); // 5 ms — resolves modulation up to 100 Hz
  const frames: number[] = [];
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let n = 0;
    for (let i = start + 1; i < start + frame; i++) {
      if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
    }
    frames.push(n / frame);
  }
  if (frames.length < 16) return { cv: 0, peakHz: 0 };
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  if (mean <= 0) return { cv: 0, peakHz: 0 };
  const variance = frames.reduce((a, b) => a + (b - mean) ** 2, 0) / frames.length;
  const cv = Math.sqrt(variance) / mean;

  // Where does that variation live? A naive DFT over the (short) frame series.
  const frameRate = RATE / frame;
  let bestHz = 0;
  let bestMag = 0;
  for (let hz = 4; hz <= frameRate / 2; hz += 0.5) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < frames.length; i++) {
      const ang = (-2 * Math.PI * hz * i) / frameRate;
      const d = frames[i]! - mean;
      re += d * Math.cos(ang);
      im += d * Math.sin(ang);
    }
    const mag = Math.hypot(re, im);
    if (mag > bestMag) {
      bestMag = mag;
      bestHz = hz;
    }
  }
  return { cv, peakHz: bestHz };
}

/**
 * Isolate the modulation by giving it room to show.
 *
 * At the shipped envelope the whole voice is 103 ms, so a 22 Hz vibrato gets 2.3
 * cycles — too few for any frame-based statistic to separate from the grain's own
 * randomness (that is a real limit, and it is reported as one). Re-rendering the
 * *same* spec with a 1-second sustain gives the modulation 22 cycles, which is
 * enough to see it and to say whether removing a parameter removed anything.
 *
 * The probe also flattens the glide (`freqEnd = freq`), because a one-second
 * sweep is itself a slow modulation and would sit on top of the vibrato it is
 * trying to isolate. So this column reads **vibrato only**: a coherent peak at
 * the vibrato rate means the wobble is present, no peak means it is not.
 */
function modulationProbe(spec: VoiceSpec): { cv: number; peakHz: number } {
  return modulation(
    renderVoice({ ...spec, attack: 0.002, hold: 1, decay: 0.01, freqEnd: spec.freq }, RATE),
  );
}

/** The `audio.test.ts` proxy — whole-buffer zero crossings. */
function zcrWhole(samples: Float32Array): number {
  let n = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
  }
  return samples.length > 0 ? n / samples.length : 0;
}

/**
 * RMS of the voice overlap-added at the mix's retrigger ceiling — what a player
 * holding fire on a rock actually hears. Deliberately naive (straight sum, then
 * clamp) because that is what the Web Audio graph does with N concurrent voices.
 */
function rmsAtRate(samples: Float32Array): number {
  const stride = Math.round(REPEAT_GAP_S * RATE);
  const reps = 24;
  const out = new Float32Array(stride * reps + samples.length);
  for (let r = 0; r < reps; r++) {
    const off = r * stride;
    for (let i = 0; i < samples.length; i++) {
      const v = (out[off + i] ?? 0) + (samples[i] ?? 0);
      out[off + i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
  }
  // Measure the steady state, past the ramp-in.
  return rms(out.subarray(stride * 8, stride * (reps - 2)));
}

// ---------------------------------------------------------------------------
// WAV out (for an A/B by ear — the developer has judged this sound by ear twice)
// ---------------------------------------------------------------------------

/** 16-bit mono WAV, same encoder shape as `sound-review/render.ts`. */
function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Eight hits at the mining retrigger rate — the way the sound is actually heard. */
function burst(samples: Float32Array): Float32Array {
  const stride = Math.round(REPEAT_GAP_S * RATE);
  const out = new Float32Array(stride * 8 + samples.length);
  for (let r = 0; r < 8; r++) {
    const off = r * stride;
    for (let i = 0; i < samples.length; i++) {
      const v = (out[off + i] ?? 0) + (samples[i] ?? 0);
      out[off + i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function main(): void {
  const hullZcr = zcrWhole(renderShipped('hullHit'));

  console.log(`\n=== rockChip ablation — what each parameter is worth ===`);
  console.log(`hullHit zcr (whole buffer) = ${hullZcr.toFixed(4)}; audio.test.ts needs hull > rock × 1.8\n`);
  console.log(
    `  ${'variant'.padEnd(13)} ${'centroid'.padStart(9)} ${'zcr(2k)'.padStart(8)} ${'phone'.padStart(6)} ${'sub'.padStart(6)} ${'peak'.padStart(5)} ${'rms'.padStart(6)} ${'@rate'.padStart(6)} ${'vs hull'.padStart(8)} ${'mod cv'.padStart(7)} ${'mod pk'.padStart(7)}`,
  );
  for (const v of VARIANTS) {
    const s = render(v.spec);
    const rz = zcrWhole(s);
    const m = modulationProbe(v.spec);
    console.log(
      `  ${v.label.padEnd(13)} ${(Math.round(centroidHz(s)) + ' Hz').padStart(9)} ${zcrWindow(s).toFixed(4).padStart(8)} ${(100 * bandShare(s, 500, RATE / 2)).toFixed(0).padStart(5)}% ${(100 * bandShare(s, 0, 200)).toFixed(0).padStart(5)}% ${peak(s).toFixed(2).padStart(5)} ${rms(s).toFixed(4).padStart(6)} ${rmsAtRate(s).toFixed(4).padStart(6)} ${('×' + (rz > 0 ? hullZcr / rz : Infinity).toFixed(2)).padStart(8)} ${m.cv.toFixed(3).padStart(7)} ${(m.peakHz.toFixed(0) + 'Hz').padStart(7)}`,
    );
    console.log(`  ${''.padEnd(13)} ${v.note}`);
  }
  console.log(
    `\n  candidates.test.ts s4-01 ceiling on zcr(2k) = 0.034 (the darkest denied take). ` +
      `It guards candidates.ts only — nothing guards the shipped bank.\n`,
  );

  if (process.argv.includes('--wav')) {
    const dir = resolve(HERE, 'previews');
    mkdirSync(dir, { recursive: true });
    for (const v of VARIANTS) {
      const slug = v.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const s = render(v.spec);
      writeFileSync(resolve(dir, `${slug}.wav`), wav(s));
      writeFileSync(resolve(dir, `${slug}-burst.wav`), wav(burst(s)));
    }
    console.log(`  wrote ${VARIANTS.length * 2} WAVs to spikes/tone-audit/previews/\n`);
  }
}

main();
