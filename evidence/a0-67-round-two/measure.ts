/**
 * evidence/a0-67-round-two/measure.ts — the numbers behind round two. OWNER: Sound Agent.
 *
 * Run: `npx vite-node evidence/a0-67-round-two/measure.ts [slot...]`
 *
 * Not part of the game bundle and not in the tsconfig `include`. It renders each
 * named slot's live offers, its denied takes (where the file keeps them) and the
 * sound the slot currently ships, through the SAME recipe `graph.renderSound` uses,
 * and prints the four numbers the round-two reasons actually turn into:
 *
 *   sec    — length. `oreCollect`'s *"shouldn't be too long"*, and the station
 *            death's 1.32 s longest-tail invariant (§8).
 *   peak   — the loudest sample. *"More subtle"* is a ceiling, not a character.
 *   rms    — energy over the whole cue. The one that says whether a loop fatigues.
 *   hf     — share of energy above 3 kHz. *"Annoying"* lives up here; so does
 *            *"sparkle"*, which is why the two complaints need separate numbers.
 *   zc     — zero-crossing rate past the attack: a cheap spectral centre, the same
 *            proxy `audio.test.ts` uses to keep rock and hull apart.
 *
 * A re-offer is an answer rather than another guess only if it MOVED, in the
 * direction that was asked for, from the thing that was rejected — so every
 * number here is printed beside the denied take it replaces.
 */

import { renderLayered, renderVoice, seamless, peak, rms, type VoiceSpec } from '../../src/art/audio/synth';
import { isLayered, loops, soundSpec, type SoundSpec, type SoundName } from '../../src/art/audio/bank';
import { CANDIDATE_SLOTS, CANDIDATE_SLOT_ORDER } from '../../src/art/audio/candidates';

const RATE = 44100;

function render(spec: SoundSpec): Float32Array {
  const looped = loops(spec);
  const options = looped ? { edges: false } : {};
  const samples = isLayered(spec)
    ? renderLayered(spec.layers, RATE, options)
    : renderVoice(spec as VoiceSpec, RATE, options);
  if (!looped) return samples;
  const crossfade = (isLayered(spec) ? spec.crossfade : undefined) ?? 0.04;
  return seamless(samples, RATE, crossfade);
}

/** Share of energy above ~3 kHz, by one-pole split. Cheap, and comparable slot to slot. */
function hfShare(buf: Float32Array): number {
  const rc = 1 / (2 * Math.PI * 3000);
  const a = rc / (rc + 1 / RATE);
  let prevIn = 0;
  let prevOut = 0;
  let hi = 0;
  let all = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] ?? 0;
    const y = a * (prevOut + x - prevIn);
    prevIn = x;
    prevOut = y;
    hi += y * y;
    all += x * x;
  }
  return all > 0 ? hi / all : 0;
}

/** Zero crossings per sample over a fixed window past the attack. */
function zc(buf: Float32Array): number {
  const from = Math.min(buf.length - 2, Math.round(0.003 * RATE));
  const to = Math.min(buf.length, from + 2048);
  let n = 0;
  for (let i = from + 1; i < to; i++) if (((buf[i] ?? 0) >= 0) !== ((buf[i - 1] ?? 0) >= 0)) n++;
  return n / Math.max(1, to - from);
}

function row(tag: string, spec: SoundSpec): string {
  const b = render(spec);
  const f = (n: number, d = 3): string => n.toFixed(d).padStart(d + 3);
  return `  ${tag.padEnd(26)} sec ${f(b.length / RATE)}  peak ${f(peak(b))}  rms ${f(rms(b))}  hf ${f(hfShare(b))}  zc ${f(zc(b))}`;
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const slots = wanted.length > 0 ? wanted : CANDIDATE_SLOT_ORDER;

for (const id of slots) {
  const slot = CANDIDATE_SLOTS[id];
  if (!slot) {
    console.log(`${id}: not on the board`);
    continue;
  }
  console.log(`\n=== ${id} — ${slot.label}`);
  console.log(row(`current (${slot.current})`, soundSpec(slot.current as SoundName)));
  for (const d of slot.denied ?? []) console.log(row(`denied ${d.id}  ${d.character}`, d.spec));
  for (const c of slot.candidates) console.log(row(`${c.id}  ${c.character}`, c.spec));
}
