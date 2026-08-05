/**
 * sound-review/render-ui-cues.ts — hear the Gantry/Bone cue set. OWNER: Sound Agent.
 *
 * NOT part of the game bundle and NOT in the tsconfig `include` (like its sibling
 * `render.ts`): a review-artifact generator, run by hand with
 * `npx vite-node sound-review/render-ui-cues.ts`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The developer chose this audio themselves, from an interactive prototype
 * (`docs/design/gantry-bone-handoff.html`). The one review question that matters
 * for s6-01 is therefore not "is it good" — that is settled — but **"is what
 * shipped the same sound?"** That is an A/B, and an A/B needs a file you can
 * play next to the prototype. This writes one WAV per cue, plus a `walk.wav`
 * that plays the whole set in the handoff's table order, into
 * `sound-review/previews/ui-cues/`.
 *
 * ── FAITHFUL TO WHAT THE GAME PLAYS ─────────────────────────────────────────
 * It imports the real `src/art/audio/ui-cues` — the same specs, the same
 * renderer, the same impulse — rather than re-deriving anything, so a preview is
 * sample-for-sample the dry signal the mix plays. The one thing it has to do for
 * itself is the **room**: in the game that is a live `ConvolverNode` on a shared
 * send, and a file has no graph, so the send is convolved into the dry here at
 * the same 25% and through the same 620 Hz high-pass. Convolution is linear, so
 * "convolve each cue and sum" is identical to "sum into one shared reverb" —
 * baking it per file loses nothing but the ability to overlap two cues' tails.
 *
 * The convolution runs on a small radix-2 FFT rather than the naive O(n·m) loop:
 * a 2.2-second impulse against nine cues is about 1.5×10¹⁰ multiply-adds the
 * honest way, and about a second this way. It is offline, exact, and belongs
 * here rather than in the game precisely because the game does not need it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SAMPLE_RATE, peak } from '../src/art/audio/synth';
import {
  ROOM,
  UI_CUES,
  UI_CUE_NAMES,
  cueDuration,
  renderUiCue,
  roomImpulse,
  type UiCueName,
} from '../src/art/audio/ui-cues';

const HERE = dirname(fileURLToPath(import.meta.url));
const RATE = DEFAULT_SAMPLE_RATE;
const OUT = resolve(HERE, 'previews/ui-cues');

// ---------------------------------------------------------------------------
// A radix-2 FFT, and convolution over it
// ---------------------------------------------------------------------------

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + half]! * cr - im[i + k + half]! * ci;
        const vi = re[i + k + half]! * ci + im[i + k + half]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }
}

function convolve(signal: Float32Array, impulse: Float32Array): Float32Array {
  const need = signal.length + impulse.length - 1;
  let n = 1;
  while (n < need) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(signal);
  br.set(impulse);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const r = ar[i]! * br[i]! - ai[i]! * bi[i]!;
    const m = ar[i]! * bi[i]! + ai[i]! * br[i]!;
    ar[i] = r;
    ai[i] = m;
  }
  fft(ar, ai, true);
  const out = new Float32Array(need);
  for (let i = 0; i < need; i++) out[i] = ar[i]!;
  return out;
}

/** A one-pole high-pass, standing in for the wet path's 620 Hz biquad. */
function highPass(samples: Float32Array, cutoffHz: number, rate: number): Float32Array {
  const a = 1 / (1 + (2 * Math.PI * cutoffHz) / rate);
  const out = new Float32Array(samples.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    prevOut = a * (prevOut + x - prevIn);
    prevIn = x;
    out[i] = prevOut;
  }
  return out;
}

/**
 * `ConvolverNode` normalises its impulse by default, and the game's room is
 * authored for that — so the preview has to normalise it the *same* way or it is
 * not the same room. This is the Web Audio spec's own
 * `calculateNormalizationScale`, calibration constants and all: an RMS-power
 * normalisation with a fixed gain calibration and a sample-rate term.
 *
 * Copying it verbatim rather than approximating it matters here more than it
 * usually would: the whole purpose of this file is an A/B against the prototype,
 * and a preview with a louder reverb than the game would fail the comparison for
 * a reason that has nothing to do with the cues.
 */
function normalize(ir: Float32Array): Float32Array {
  const GAIN_CALIBRATION = 0.00125;
  const GAIN_CALIBRATION_RATE = 44100;
  const MIN_POWER = 0.000125;
  let energy = 0;
  for (let i = 0; i < ir.length; i++) energy += ir[i]! * ir[i]!;
  let power = Math.sqrt(energy / ir.length);
  if (!Number.isFinite(power) || power < MIN_POWER) power = MIN_POWER;
  const scale = (GAIN_CALIBRATION / power) * (GAIN_CALIBRATION_RATE / RATE);
  const out = new Float32Array(ir.length);
  for (let i = 0; i < ir.length; i++) out[i] = ir[i]! * scale;
  return out;
}

// ---------------------------------------------------------------------------

const IR = normalize(roomImpulse(RATE)[0]!);

/** One cue, dry + its own send through the shared room, as the mix would sum it. */
function renderWithRoom(name: UiCueName): Float32Array {
  const { dry, send } = renderUiCue(UI_CUES[name], RATE);
  const wet = convolve(highPass(send, ROOM.highPassHz, RATE), IR);
  const out = new Float32Array(wet.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = (dry[i] ?? 0) + wet[i]! * ROOM.wet;
  }
  // Fade the file's tail so the preview never ends on a step. The game does not
  // need this — the tail decays into the mix — but a WAV's last sample does.
  const fade = Math.min(Math.round(0.02 * RATE), out.length);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] = out[out.length - 1 - i]! * (i / fade);
  return out;
}

/** Encode mono float samples as a 16-bit PCM WAV (the same encoder as `render.ts`). */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

mkdirSync(OUT, { recursive: true });

const rendered = new Map<UiCueName, Float32Array>();
for (const name of UI_CUE_NAMES) {
  const samples = renderWithRoom(name);
  rendered.set(name, samples);
  writeFileSync(resolve(OUT, `${name}.wav`), encodeWav(samples, RATE));
  console.log(
    `${name.padEnd(9)} ${cueDuration(UI_CUES[name]).toFixed(2)}s  peak ${peak(samples).toFixed(3)}  ${UI_CUES[name].shape}`,
  );
}

// The walk: every cue in the handoff's table order, 0.9 s apart — the file to
// play beside the prototype, because the SET is the thing that was ratified and
// a cue alone cannot show that it belongs to one pane of glass.
const GAP_S = 0.9;
const walkLength = Math.round(
  UI_CUE_NAMES.reduce((t, name) => t + Math.max(GAP_S, (rendered.get(name)?.length ?? 0) / RATE + 0.3), 0) * RATE,
);
const walk = new Float32Array(walkLength);
let cursor = 0;
for (const name of UI_CUE_NAMES) {
  const samples = rendered.get(name)!;
  for (let i = 0; i < samples.length && cursor + i < walk.length; i++) {
    walk[cursor + i] = Math.max(-1, Math.min(1, walk[cursor + i]! + samples[i]!));
  }
  cursor += Math.round(Math.max(GAP_S, samples.length / RATE + 0.3) * RATE);
}
writeFileSync(resolve(OUT, 'walk.wav'), encodeWav(walk, RATE));

console.log(`\n${UI_CUE_NAMES.length} cues + walk.wav → sound-review/previews/ui-cues/`);
