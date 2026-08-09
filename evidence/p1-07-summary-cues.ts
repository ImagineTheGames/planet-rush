/**
 * evidence/p1-07-summary-cues.ts — the brief's evidence line, generated.
 * OWNER: Sound Agent. NOT part of the game bundle. Run by hand:
 *
 *     npx vite-node evidence/p1-07-summary-cues.ts > evidence/p1-07-summary-cues.txt
 *
 * The brief asks for two things, *"so 'it is in the amended envelope' is a number
 * rather than an opinion"*:
 *
 *  1. **The four slots on the review board**, each with its three candidates and
 *     the WAV the developer will actually hear.
 *  2. **A tone-audit row for each new cue beside the bank's** — the same columns
 *     `spikes/tone-audit/measure-bank-tone.ts` prints for the other forty, with
 *     the retro-tell column that has to be empty, and the neighbours that bound
 *     each cue printed next to it rather than left to be looked up.
 *
 * Everything here is measured out of the shipped modules on the same render
 * recipe `graph.renderSound` uses, so the table cannot drift from the sounds.
 * The *retro tells* and the spectral arithmetic are deliberately the audit's own,
 * copied rather than imported — a spike is throwaway and evidence is not, and the
 * point of the column is to be the same measurement the bank was judged on.
 */

import { readFileSync } from 'node:fs';

import {
  DEFAULT_SAMPLE_RATE as RATE,
  peak,
  renderLayered,
  renderVoice,
  rms,
  seamless,
  voiceDuration,
  type VoiceSpec,
  type Wave,
} from '../src/art/audio/synth';
import { isLayered, loops, soundSpec, SOUND_NAMES, XP_TICK_SEMITONES, XP_TICK_STEPS_MAX, type SoundName, type SoundSpec } from '../src/art/audio/bank';
import { CANDIDATE_SLOTS } from '../src/art/audio/candidates';
import { XP_FILL_GAIN } from '../src/art/audio/engine';

const SUMMARY: readonly SoundName[] = ['xpTick', 'xpBarFill', 'levelUp', 'xpSettle'];
/** Printed beside the four, because each is the bound one of them is held to. */
const NEIGHBOURS: readonly SoundName[] = ['pressTick', 'matchEnd', 'musicWin', 'musicLoss', 'stationDeath'];

// --- the render recipe (`graph.renderSound`), copied like the audit does -----

function render(spec: SoundSpec): Float32Array {
  const looped = loops(spec);
  const samples = isLayered(spec)
    ? renderLayered(spec.layers, RATE, { edges: !looped })
    : renderVoice(spec as VoiceSpec, RATE, { edges: !looped });
  return looped ? seamless(samples, RATE, (isLayered(spec) ? spec.crossfade : undefined) ?? 0.04) : samples;
}

const voicesOf = (spec: SoundSpec): readonly VoiceSpec[] =>
  isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec as VoiceSpec];

// --- the audit's measurements -----------------------------------------------

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

function spectralCentroidHz(samples: Float32Array): number {
  const N = 8192;
  const frame = loudestWindow(samples, N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    re[i] = (frame[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  fft(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < N / 2; k++) {
    const mag = Math.hypot(re[k] ?? 0, im[k] ?? 0);
    num += mag * ((k * RATE) / N);
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

function zeroCrossingRate(samples: Float32Array): number {
  let n = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
  }
  return samples.length > 0 ? n / samples.length : 0;
}

/** The audit's retro-tell column, verbatim: this is what has to come back empty. */
const WOBBLE_RATE_HZ = 8;
const CHIRP_RATIO = 1.2;

function retroTells(v: VoiceSpec): string[] {
  const tells: string[] = [];
  if (v.wave === 'square') tells.push('square');
  if (v.wave === 'saw') tells.push('saw');
  if (v.duty !== undefined && v.wave === 'square') tells.push(`duty=${v.duty}`);
  if (v.dutySweep) tells.push(`dutySweep=${v.dutySweep}`);
  if (v.arpMul !== undefined && v.arpMul !== 1) tells.push(`arp×${v.arpMul}`);
  if (v.repeat) tells.push(`repeat=${v.repeat}s`);
  if ((v.vibratoDepth ?? 0) > 0 && (v.vibratoRate ?? 0) >= WOBBLE_RATE_HZ) {
    tells.push(`wobble ${v.vibratoRate}Hz×${v.vibratoDepth}`);
  }
  if (v.freqEnd !== undefined && v.freqEnd !== v.freq) {
    const ratio = Math.max(v.freq, v.freqEnd) / Math.max(1, Math.min(v.freq, v.freqEnd));
    if (ratio >= CHIRP_RATIO) tells.push(`chirp ${v.freqEnd > v.freq ? 'up' : 'down'} ×${ratio.toFixed(2)}`);
  }
  return tells;
}

// --- the rows ---------------------------------------------------------------

interface Row {
  name: string;
  voices: number;
  waves: string;
  seconds: number;
  peak: number;
  rms: number;
  centroidHz: number;
  zcr: number;
  tells: string;
}

function row(name: SoundName): Row {
  const spec = soundSpec(name);
  const samples = render(spec);
  const vs = voicesOf(spec);
  const counts = new Map<Wave, number>();
  for (const v of vs) counts.set(v.wave, (counts.get(v.wave) ?? 0) + 1);
  const tells = new Set<string>();
  for (const v of vs) for (const t of retroTells(v)) tells.add(t);
  return {
    name,
    voices: vs.length,
    waves: [...counts.entries()].map(([w, n]) => (n > 1 ? `${w}×${n}` : w)).join(' '),
    seconds: samples.length / RATE,
    peak: peak(samples),
    rms: rms(samples),
    centroidHz: spectralCentroidHz(samples),
    zcr: zeroCrossingRate(samples),
    tells: [...tells].join(', '),
  };
}

function head(): string {
  return `  ${'sound'.padEnd(14)} ${'v'.padStart(2)} ${'waves'.padEnd(22)} ${'sec'.padStart(6)} ${'peak'.padStart(5)} ${'rms'.padStart(7)} ${'centroid'.padStart(9)} ${'zcr'.padStart(7)}  retro tells`;
}

function line(r: Row): string {
  return `  ${r.name.padEnd(14)} ${String(r.voices).padStart(2)} ${r.waves.padEnd(22)} ${r.seconds.toFixed(2).padStart(6)} ${r.peak.toFixed(2).padStart(5)} ${r.rms.toFixed(4).padStart(7)} ${(Math.round(r.centroidHz) + ' Hz').padStart(9)} ${r.zcr.toFixed(4).padStart(7)}  ${r.tells === '' ? '—' : r.tells}`;
}

// ---------------------------------------------------------------------------

console.log('p1-07 — the four end-of-match summary cues. Evidence, generated out of the modules.');
console.log('       npx vite-node evidence/p1-07-summary-cues.ts');
console.log('');

// --- 1. the review board ----------------------------------------------------

const manifest = JSON.parse(readFileSync('sound-review/manifest.json', 'utf8')) as {
  slots: { id: string; label: string; context: string; current: string; candidates: { id: string; wav: string; character: string }[] }[];
};

console.log('=== 1. THE REVIEW BOARD — four new slots, three candidates each ===');
console.log('');
for (const id of SUMMARY) {
  const slot = manifest.slots.find((s) => s.id === id);
  if (!slot) throw new Error(`${id} is not on the board`);
  console.log(`  ${slot.label}  (${slot.id})`);
  console.log(`    ${slot.context}`);
  console.log(`    current  ${slot.current}`);
  for (const c of slot.candidates) console.log(`    ${c.id}        ${c.wav.padEnd(34)} ${c.character}`);
  console.log('');
}
console.log(`  board size: ${manifest.slots.length} slots (40 denied + 4 new), ${manifest.slots.length * 3} candidates`);
console.log('');

// --- 2. the tone audit ------------------------------------------------------

console.log('=== 2. THE TONE AUDIT — the four, beside the bank ===');
console.log('');
console.log('  The `retro tells` column is the audit\'s own (square/saw, duty sweep, arpeggio,');
console.log('  repeat, an audible wobble, a chirp). Empty is the whole claim: each new cue is');
console.log('  inside the amended §4.7 envelope on the same measurement the other forty are.');
console.log('');
console.log(head());
for (const name of SUMMARY) console.log(line(row(name)));
console.log('  ' + '-'.repeat(96));
for (const name of NEIGHBOURS) console.log(line(row(name)));
console.log('');

const census = new Map<Wave, number>();
let voices = 0;
for (const name of SOUND_NAMES) {
  for (const v of voicesOf(soundSpec(name))) {
    voices++;
    census.set(v.wave, (census.get(v.wave) ?? 0) + 1);
  }
}
console.log(`  census — ${SOUND_NAMES.length} sounds, ${voices} voices`);
for (const wave of ['square', 'saw', 'triangle', 'sine', 'noise'] as Wave[]) {
  const n = census.get(wave) ?? 0;
  console.log(`    ${wave.padEnd(9)} ${String(n).padStart(3)}  (${((100 * n) / voices).toFixed(1)}%)`);
}
console.log('    the two saws are alarm.low / alarm.high — the sanctioned klaxon (§2.2), unchanged.');
console.log('');

// --- 3. the two set-level constraints, as numbers ---------------------------

console.log('=== 3. THE TWO SET-LEVEL CONSTRAINTS (plan §6.5) ===');
console.log('');
const level = (name: SoundName) => rms(render(soundSpec(name))) * (name === 'xpBarFill' ? XP_FILL_GAIN : 1);
console.log(`  UNDER THE RESULT — RMS as played (the bed at its seam ceiling, ×${XP_FILL_GAIN})`);
console.log(`    matchEnd     ${level('matchEnd').toFixed(4)}   the result this beat plays under`);
console.log(`    stationDeath ${level('stationDeath').toFixed(4)}   the ache, untouched`);
for (const name of SUMMARY) {
  console.log(`    ${name.padEnd(12)} ${level(name).toFixed(4)}   ×${(level(name) / level('matchEnd')).toFixed(2)} of the result`);
}
console.log('');
console.log('  CANCELLABLE — nothing outlives the screen');
for (const name of SUMMARY) {
  const spec = soundSpec(name);
  const seconds = render(spec).length / RATE;
  console.log(
    `    ${name.padEnd(12)} ${loops(spec) ? 'LOOP — started and stopped with the bar (engine.xpFill / stopXpFill)' : `${seconds.toFixed(3)} s one-shot`}`,
  );
}
console.log('');

// --- 4. the tick under repetition -------------------------------------------

console.log('=== 4. THE COUNT-UP TICK UNDER REPETITION ===');
console.log('');
const tick = render(soundSpec('xpTick'));
const press = render(soundSpec('pressTick'));
console.log(`  one tick     ${(tick.length / RATE).toFixed(4)} s  peak ${peak(tick).toFixed(4)}  rms ${rms(tick).toFixed(5)}`);
console.log(`  pressTick    ${(press.length / RATE).toFixed(4)} s  peak ${peak(press).toFixed(4)}  rms ${rms(press).toFixed(5)}   (the bound)`);
const quietest = [...SOUND_NAMES].sort((a, b) => rms(render(soundSpec(a))) - rms(render(soundSpec(b)))).slice(0, 3);
console.log(`  quietest in the bank: ${quietest.join(', ')}`);
console.log('');
console.log('  forty ticks, each pitched by the rise the seam applies:');
for (const perSecond of [8, 20, 40]) {
  const gap = Math.round(RATE / perSecond);
  const out = new Float32Array(gap * 40 + tick.length * 2);
  for (let k = 0; k < 40; k++) {
    const rate = Math.pow(2, (Math.min(k, XP_TICK_STEPS_MAX) * XP_TICK_SEMITONES) / 12);
    const len = Math.floor(tick.length / rate);
    for (let i = 0; i < len; i++) out[k * gap + i] = (out[k * gap + i] ?? 0) + (tick[Math.floor(i * rate)] ?? 0);
  }
  console.log(
    `    ${String(perSecond).padStart(2)}/s   peak ${peak(out).toFixed(4)}   rms ${rms(out).toFixed(5)}   ${peak(out) <= peak(tick) * 1.02 ? 'does not stack — each tick is gone before the next arrives' : 'ACCUMULATES'}`,
  );
}
const topRate = Math.pow(2, (XP_TICK_STEPS_MAX * XP_TICK_SEMITONES) / 12);
console.log('');
console.log(
  `  the rise: ${XP_TICK_SEMITONES} semitones per tick, capped at ${XP_TICK_STEPS_MAX} — ×${topRate.toFixed(4)} playback rate at the top,`,
);
console.log(`  ${(XP_TICK_STEPS_MAX * XP_TICK_SEMITONES).toFixed(1)} semitones end to end, and it stops there however long the count runs.`);
console.log('');

// --- 5. what it is NOT ------------------------------------------------------

console.log('=== 5. NOT THE DENIED STINGS (plan §6.5) ===');
console.log('');
const deniedVoices = new Set<string>();
for (const name of ['matchEnd', 'musicWin', 'musicLoss'] as SoundName[]) {
  for (const v of voicesOf(soundSpec(name))) deniedVoices.add(JSON.stringify(v));
  for (const c of CANDIDATE_SLOTS[name]!.candidates) for (const v of voicesOf(c.spec)) deniedVoices.add(JSON.stringify(v));
}
let reused = 0;
let checked = 0;
for (const id of SUMMARY) {
  for (const spec of [soundSpec(id), ...CANDIDATE_SLOTS[id]!.candidates.map((c) => c.spec)]) {
    for (const v of voicesOf(spec)) {
      checked++;
      if (deniedVoices.has(JSON.stringify(v))) reused++;
    }
  }
}
console.log(`  ${checked} voices across the four shipped cues and their twelve candidates,`);
console.log(`  checked against the ${deniedVoices.size} voices of matchEnd / musicWin / musicLoss`);
console.log(`  and their offers: ${reused} re-used.`);
console.log('');
console.log('  Longest voice in the set vs the ache it must never outlast:');
console.log(`    levelUp      ${voiceDuration(voicesOf(soundSpec('levelUp')).reduce((a, b) => (voiceDuration(a) > voiceDuration(b) ? a : b))).toFixed(3)} s`);
console.log(`    stationDeath ${voiceDuration(voicesOf(soundSpec('stationDeath')).reduce((a, b) => (voiceDuration(a) > voiceDuration(b) ? a : b))).toFixed(3)} s   (the longest tail in the bank, held)`);
console.log('');
