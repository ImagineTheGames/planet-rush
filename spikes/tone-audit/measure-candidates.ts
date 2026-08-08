/**
 * spikes/tone-audit/measure-candidates.ts — is each slot a real choice? (a0-01b)
 * OWNER: Sound Agent. NOT part of the game bundle, NOT in the tsconfig `include`,
 * imported by nothing in `src/`. Run by hand:
 *
 *     npx vite-node spikes/tone-audit/measure-candidates.ts
 *     npx vite-node spikes/tone-audit/measure-candidates.ts --json > evidence/a0-01b-candidate-spread.json
 *
 * ## Why it exists
 *
 * The a0-01b brief's bar is not "three new sounds" — it is *"genuinely different
 * from each other AND from `current`"*, with three variations on one idea and a
 * filtered copy of the incumbent both named as fake choices. That is a claim about
 * numbers, so this is the program that checks it, per slot, before the board is
 * ever put in front of the developer again.
 *
 * ## What it measures, per sound
 *
 *  - **Spectral centroid** (Hz, real FFT over the rendered buffer) — brightness.
 *  - **Zero-crossing rate** — the cheap proxy `audio.test.ts` and the rockChip
 *    ceiling in `candidates.test.ts` are written against; reported alongside the
 *    centroid so the two can be compared.
 *  - **Peak, RMS, duration** — the mix invariants (`docs/audio-revoice-spec.md` §8).
 *  - **A six-band spectral profile** (octave-ish bands, energy-normalised) and the
 *    **cosine distance** between every pair in the slot, including `current`. Two
 *    sounds that differ only in level or in pitch score close together here; two
 *    sounds made of different material do not. This is the number that answers
 *    "is this three takes on one idea?".
 *
 * ## The bar it prints a verdict against
 *
 * A slot PASSES when every one of the six pairs (a·b, a·c, b·c, a·cur, b·cur,
 * c·cur) clears {@link MIN_DISTANCE} in **either** the profile distance or the
 * centroid ratio. Two floors rather than one, because a legitimate pair can be
 * separated by either axis: a dark grain bed and a bright metal ring differ in
 * profile, while two struck bands an octave apart differ in centroid. The verdict
 * is advisory — it is a floor under an ear judgement, not a substitute for one.
 *
 * It never imports `./graph` (which needs a Web Audio context): it reuses the pure
 * synth and the same render recipe `sound-review/render.ts` uses, so what it
 * measures is sample-for-sample what the board plays.
 */

import {
  DEFAULT_SAMPLE_RATE,
  renderLayered,
  renderVoice,
  seamless,
  peak,
  rms,
  type VoiceSpec,
} from '../../src/art/audio/synth';
import { isLayered, loops, soundSpec, type SoundName, type SoundSpec } from '../../src/art/audio/bank';
import { CANDIDATE_SLOTS, CANDIDATE_SLOT_ORDER } from '../../src/art/audio/candidates';

const RATE = DEFAULT_SAMPLE_RATE;

/** The floor a pair has to clear on one of the two axes to count as a real choice. */
const MIN_DISTANCE = 0.06;
/** …or this much apart in spectral centre, as a ratio ≥ 1. */
const MIN_CENTROID_RATIO = 1.25;

// ---------------------------------------------------------------------------
// The faithful render recipe (mirrors `graph.renderSound`, like the review
// renderer and the s7-01 spike do — a spike must never drift the game's graph).
// ---------------------------------------------------------------------------

function renderSound(spec: SoundSpec): Float32Array {
  if (isLayered(spec)) {
    const looped = loops(spec);
    const samples = renderLayered(spec.layers, RATE, { edges: !looped });
    return looped ? seamless(samples, RATE, spec.crossfade ?? 0.04) : samples;
  }
  return renderVoice(spec as VoiceSpec, RATE);
}

// ---------------------------------------------------------------------------
// Spectrum
// ---------------------------------------------------------------------------

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

const FFT_N = 8192;

/** Magnitude spectrum of the loudest {@link FFT_N} window of a sound, Hann-windowed. */
function spectrum(samples: Float32Array): Float64Array {
  // Take the window around the peak: a long loop or a long tail otherwise
  // averages the character away into its own silence.
  let at = 0;
  let best = -1;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > best) {
      best = v;
      at = i;
    }
  }
  const start = Math.max(0, Math.min(at - (FFT_N >> 3), samples.length - FFT_N));
  const re = new Float64Array(FFT_N);
  const im = new Float64Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) {
    const s = samples[start + i] ?? 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1)));
  }
  fft(re, im);
  const mag = new Float64Array(FFT_N >> 1);
  for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(re[k]!, im[k]!);
  return mag;
}

function centroidHz(mag: Float64Array): number {
  let num = 0;
  let den = 0;
  for (let k = 1; k < mag.length; k++) {
    const f = (k * RATE) / FFT_N;
    num += f * mag[k]!;
    den += mag[k]!;
  }
  return den > 0 ? num / den : 0;
}

/** Band edges, Hz — six octave-ish bands from sub to air. */
const BANDS = [0, 90, 260, 700, 1800, 4500, RATE / 2];

/** Energy per band, normalised to sum 1 — the shape of the sound, not its level. */
function profile(mag: Float64Array): number[] {
  const out = new Array<number>(BANDS.length - 1).fill(0);
  for (let k = 1; k < mag.length; k++) {
    const f = (k * RATE) / FFT_N;
    for (let b = 0; b < out.length; b++) {
      if (f >= BANDS[b]! && f < BANDS[b + 1]!) {
        out[b] = out[b]! + mag[k]! * mag[k]!;
        break;
      }
    }
  }
  const sum = out.reduce((a, v) => a + v, 0);
  return sum > 0 ? out.map((v) => v / sum) : out;
}

/** 1 − cosine similarity over the band profile. 0 is the same shape, 1 is disjoint. */
function distance(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? 1 - dot / d : 1;
}

function zeroCrossingRate(samples: Float32Array): number {
  let n = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
  }
  return samples.length > 0 ? n / samples.length : 0;
}

// ---------------------------------------------------------------------------

interface Measured {
  id: string;
  character: string;
  centroid: number;
  zcr: number;
  peak: number;
  rms: number;
  seconds: number;
  profile: number[];
}

function measure(id: string, character: string, spec: SoundSpec): Measured {
  const buf = renderSound(spec);
  const mag = spectrum(buf);
  return {
    id,
    character,
    centroid: centroidHz(mag),
    zcr: zeroCrossingRate(buf),
    peak: peak(buf),
    rms: rms(buf),
    seconds: buf.length / RATE,
    profile: profile(mag),
  };
}

const json = process.argv.includes('--json');
const slots: unknown[] = [];
let failures = 0;

for (const slotId of CANDIDATE_SLOT_ORDER) {
  const slot = CANDIDATE_SLOTS[slotId]!;
  const rows: Measured[] = [
    measure('current', 'the shipped a0-01 re-voice', soundSpec(slot.current as SoundName)),
    ...slot.candidates.map((c) => measure(c.id, c.character, c.spec)),
  ];

  const pairs: { pair: string; distance: number; centroidRatio: number; ok: boolean }[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      const d = distance(a.profile, b.profile);
      const ratio =
        Math.max(a.centroid, b.centroid) / Math.max(1, Math.min(a.centroid, b.centroid));
      const ok = d >= MIN_DISTANCE || ratio >= MIN_CENTROID_RATIO;
      if (!ok) failures++;
      pairs.push({ pair: `${a.id}·${b.id}`, distance: d, centroidRatio: ratio, ok });
    }
  }

  if (json) {
    slots.push({ slot: slotId, label: slot.label, rows, pairs });
    continue;
  }

  console.log(`\n## ${slotId} — ${slot.label}`);
  console.log('  id       centroid    zcr    peak    rms    secs  character');
  for (const r of rows) {
    console.log(
      `  ${r.id.padEnd(8)} ${r.centroid.toFixed(0).padStart(7)} Hz ${r.zcr.toFixed(3)} ` +
        `${r.peak.toFixed(3)} ${r.rms.toFixed(3)} ${r.seconds.toFixed(3)}  ${r.character}`,
    );
  }
  console.log(
    '  spread: ' +
      pairs
        .map((p) => `${p.pair} d=${p.distance.toFixed(2)} ×${p.centroidRatio.toFixed(2)}${p.ok ? '' : ' FAIL'}`)
        .join('  '),
  );
}

if (json) {
  console.log(
    JSON.stringify(
      {
        $comment:
          'a0-01b — per-slot spread between the three new candidates and the shipped current. ' +
          `A pair passes on profile distance >= ${MIN_DISTANCE} OR centroid ratio >= ${MIN_CENTROID_RATIO}.`,
        minDistance: MIN_DISTANCE,
        minCentroidRatio: MIN_CENTROID_RATIO,
        sampleRate: RATE,
        bands: BANDS,
        slots,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} pair(s) too close`}`);
}

process.exit(failures === 0 ? 0 : 1);
