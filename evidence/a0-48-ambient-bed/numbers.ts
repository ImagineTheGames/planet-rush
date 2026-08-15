/**
 * evidence/a0-48-ambient-bed/numbers.ts — the brief's evidence line, generated.
 * OWNER: Sound Agent. NOT part of the game bundle, NOT in the tsconfig `include`.
 * Run by hand:
 *
 *     npx vite-node evidence/a0-48-ambient-bed/numbers.ts > evidence/a0-48-ambient-bed/numbers.txt
 *
 * a0-48 makes three claims about the ambient bed that are only worth anything as
 * numbers, so this is the program that produced them:
 *
 *  1. **The rebuilt bed is quieter than the one the developer called "deep"** —
 *     and quieter *in the low end specifically*, which is the word they used.
 *  2. **Nothing in it is a held tone any more.** Per layer: does it carry one of
 *     the four round-2 capabilities, and does it fade in.
 *  3. **The three offers are a real choice**, spread across "how much bed there
 *     is at all" rather than three takes on one idea.
 *
 * The denied bed is **inlined below**, copied from `src/art/audio/bank.ts` at
 * `415f0ea` (the tip of `main` when this brief opened). Evidence that compares
 * against `git show` would stop reproducing the day the row it names is rewritten,
 * and the whole point of this file is a before/after that still runs in a year.
 *
 * Everything else is measured out of the shipped modules on the same render
 * recipe `graph.renderSound` uses, so the table cannot drift from the sounds.
 */

import {
  DEFAULT_SAMPLE_RATE,
  peak,
  renderLayered,
  rms,
  seamless,
  type VoiceSpec,
} from '../../src/art/audio/synth';
import { isLayered, loops, soundSpec, type SoundSpec } from '../../src/art/audio/bank';
import { CANDIDATE_SLOTS } from '../../src/art/audio/candidates';

const RATE = DEFAULT_SAMPLE_RATE;

/** The faithful render recipe (mirrors `graph.renderSound`), headless. */
function render(spec: SoundSpec): Float32Array {
  if (!isLayered(spec)) throw new Error(`${spec.name} is not layered — a bed is a stack`);
  const looped = loops(spec);
  const samples = renderLayered(spec.layers, RATE, { edges: !looped });
  return looped ? seamless(samples, RATE, spec.crossfade ?? 0.04) : samples;
}

/**
 * RMS of everything under 100 Hz, in absolute terms rather than as a share.
 *
 * "Deep" is a level complaint about a band, so a share would hide the thing being
 * measured: a bed that halves in level keeps roughly the same *share* of its
 * energy down there while putting half as much of it into the room. One-pole, the
 * same filter `./synth` uses, so this is the bank's own arithmetic.
 */
function lowBandRms(buf: Float32Array): number {
  const a = 1 - Math.exp((-2 * Math.PI * 100) / RATE);
  let y = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    y += ((buf[i] ?? 0) - y) * a;
    sum += y * y;
  }
  return Math.sqrt(sum / Math.max(1, buf.length));
}

/** How far the loop's last sample sits from its first — a step here is a click every lap. */
function seamStep(buf: Float32Array): number {
  return Math.abs((buf[buf.length - 1] ?? 0) - (buf[0] ?? 0));
}

/** Does this voice have any of the four round-2 capabilities on it? */
function moves(v: VoiceSpec): boolean {
  return (
    (v.decayCurve ?? 0) > 0 ||
    (v.lowPassEnd !== undefined && v.lowPassEnd !== v.lowPass) ||
    v.bandPass === true ||
    (v.resonance ?? 0) > 0
  );
}

/**
 * The bed as `main` shipped it at `415f0ea` — the take the developer denied on
 * 2026-08-07 and met again in play on 2026-08-14. Four layers, every one of them
 * `attack: 0`, and not one filter sweep, decay curve or band-pass among them.
 */
const DENIED: SoundSpec = {
  name: 'ambient(denied)',
  loop: true,
  crossfade: 0.6,
  layers: [
    { spec: { name: 'ambient.bed', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 55, vibratoDepth: 0.004, vibratoRate: 0.125, gain: 0.3, seed: 0x0d12 } },
    { spec: { name: 'ambient.detune', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 55.35, gain: 0.22, seed: 0x0d13 } },
    { spec: { name: 'ambient.fifth', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 82.5, vibratoDepth: 0.003, vibratoRate: 0.0833, lowPass: 700, gain: 0.12, seed: 0x0d14 } },
    { spec: { name: 'ambient.wash', wave: 'noise', attack: 0, hold: 8, decay: 0, freq: 40, lowPass: 320, resonance: 1.6, highPass: 40, gain: 0.085, seed: 0x0d15 } },
  ],
};

const rows: { label: string; spec: SoundSpec }[] = [
  { label: 'denied  (main 415f0ea)', spec: DENIED },
  { label: 'shipped (a0-48)', spec: soundSpec('ambient') },
  ...CANDIDATE_SLOTS.ambient!.candidates.map((c) => ({
    label: `offer ${c.id} — ${c.character}`,
    spec: c.spec,
  })),
];

console.log('a0-48 — the ambient bed, measured');
console.log('');
console.log(
  ['sound'.padEnd(40), 'secs', ' peak', '   rms', '<100Hz', ' seam'].join(' '),
);
console.log('-'.repeat(78));
for (const { label, spec } of rows) {
  const buf = render(spec);
  console.log(
    [
      label.padEnd(40),
      (buf.length / RATE).toFixed(2).padStart(4),
      peak(buf).toFixed(3),
      rms(buf).toFixed(4),
      lowBandRms(buf).toFixed(4),
      seamStep(buf).toFixed(4),
    ].join(' '),
  );
}

console.log('');
console.log('per layer — `moves` is any of decayCurve / lowPassEnd / bandPass / resonance,');
console.log('and `attack` is the fade-in. Both are what `audio.test.ts` gates the bed on.');
console.log('');
for (const { label, spec } of rows) {
  if (!isLayered(spec)) continue;
  const crossfade = spec.crossfade ?? 0.04;
  console.log(`${label}   (crossfade ${crossfade.toFixed(2)}s)`);
  for (const layer of spec.layers) {
    const v = layer.spec;
    const ends = (layer.at ?? 0) + v.attack + v.hold + v.decay;
    console.log(
      [
        `   ${v.name.padEnd(22)}`,
        v.wave.padEnd(8),
        `moves ${moves(v) ? 'yes' : 'NO '}`,
        `attack ${v.attack.toFixed(3)}${v.attack === 0 ? ' <- arrives' : ''}`,
        `ends ${ends.toFixed(1)}s`,
        `gain ${v.gain.toFixed(3)}`,
      ].join('  '),
    );
  }
  console.log('');
}
