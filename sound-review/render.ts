/**
 * sound-review/render.ts — render the review previews. OWNER: Sound Agent.
 *
 * NOT part of the game bundle and NOT in the tsconfig `include`: this is a
 * review-artifact generator, run by hand with `npx vite-node sound-review/render.ts`.
 * It renders every current-shipped sound and every candidate (`src/art/audio/
 * candidates.ts`) to a 16-bit mono WAV under `sound-review/previews/`, and writes
 * `sound-review/manifest.json` — the contract the Director's review page reads.
 *
 * Faithful to the game: it reuses the real synth (`../src/art/audio/synth`) and
 * the real render recipe (loops joined tail-to-head, edge-faded one-shots) rather
 * than re-deriving it, so a preview is sample-for-sample what the mix would play.
 * It deliberately imports only `synth` + `bank` (never `graph`, which needs a Web
 * Audio context), so it runs headless on a CI box with no audio hardware.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SAMPLE_RATE,
  renderLayered,
  renderVoice,
  seamless,
  peak,
  type VoiceSpec,
} from '../src/art/audio/synth';
import { isLayered, loops, soundSpec, type SoundSpec, type SoundName } from '../src/art/audio/bank';
import { CANDIDATE_SLOTS, CANDIDATE_SLOT_ORDER } from '../src/art/audio/candidates';

const HERE = dirname(fileURLToPath(import.meta.url));
const RATE = DEFAULT_SAMPLE_RATE;

/**
 * The faithful render recipe, copied from `graph.renderSound` so this script does
 * not have to import the Web-Audio-shaped `graph` module. One voice or a stack,
 * looped (edges off, tail joined onto head) or one-shot (edge-faded).
 */
function renderSound(spec: SoundSpec): Float32Array {
  const looped = loops(spec);
  const options = looped ? { edges: false } : {};
  const samples = isLayered(spec)
    ? renderLayered(spec.layers, RATE, options)
    : renderVoice(spec as VoiceSpec, RATE, options);
  if (!looped) return samples;
  const crossfade = (isLayered(spec) ? spec.crossfade : undefined) ?? 0.04;
  return seamless(samples, RATE, crossfade);
}

/** Loops render one lap; a preview needs several. Music/ambient/alarm want a long excerpt. */
const LONG_LOOP = new Set<string>(['alarm', 'ambient', 'musicBed', 'musicPulse', 'musicTheme', 'musicDread']);

/** Target preview seconds for a looping sound. */
function loopTargetSeconds(slotId: string): number {
  if (LONG_LOOP.has(slotId)) return 16; // 15-20s music/ambient/alarm excerpt, per brief
  return 4; // a held SFX loop (the thruster): enough to hear it settle
}

/** Tile a seamless loop body up to a target length and soft-fade the file edges. */
function toPreview(spec: SoundSpec, slotId: string): Float32Array {
  const body = renderSound(spec);
  if (!loops(spec)) return body; // one-shots are already edge-faded by the synth

  const target = Math.round(loopTargetSeconds(slotId) * RATE);
  const reps = Math.max(1, Math.ceil(target / body.length));
  const out = new Float32Array(body.length * reps);
  for (let r = 0; r < reps; r++) out.set(body, r * body.length);

  // The tiled file starts and ends on the loop seam (non-zero), so fade its edges
  // — this is a preview file, not a looping source, so the ends must reach silence.
  const fade = Math.min(Math.round(0.015 * RATE), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = (out[i] ?? 0) * k;
    const j = out.length - 1 - i;
    out[j] = (out[j] ?? 0) * k;
  }
  return out;
}

/** Encode mono float samples as a 16-bit PCM WAV. */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// ---------------------------------------------------------------------------

const previewsDir = resolve(HERE, 'previews');

/**
 * Clear only the slot directories this script owns.
 *
 * It used to `rmSync` the whole `previews/` tree, which quietly deleted
 * `previews/ui-cues/` — the ratified Gantry/Bone set, written by the sibling
 * `render-ui-cues.ts` and reviewed by ear by the developer in s6-01. Running one
 * renderer should not destroy the other's output, and the loss is invisible in a
 * terminal: the script prints a cheerful success line either way, and the damage
 * only shows up as ten deletions in `git status` that a reviewer has to notice.
 */
mkdirSync(previewsDir, { recursive: true });
for (const slotId of CANDIDATE_SLOT_ORDER) {
  rmSync(resolve(previewsDir, slotId), { recursive: true, force: true });
}

interface ManifestCandidate {
  id: string;
  wav: string;
  character: string;
  params: string;
}
interface ManifestDenied extends ManifestCandidate {
  deniedAt: string;
  reason: string;
}
interface ManifestSlot {
  id: string;
  label: string;
  context: string;
  current: string | null;
  candidates: ManifestCandidate[];
  /**
   * Takes this slot has already had turned down, rendered beside the live offers
   * so the board can play a re-offer against the thing it replaces (a0-57). NOT
   * candidates: no verdict may land on one, so they are a separate list and their
   * wavs are written under a `denied-` prefix that no letter can collide with.
   */
  denied?: ManifestDenied[];
  /**
   * A fourth answer the slot is allowed to come back with, when it has one — the
   * `ambient` bed's "ship it off by default" (a0-48). Written through from
   * `CANDIDATE_SLOTS` so the page can show it beside the three voices; absent on
   * every slot that is a mechanic, where "cut it" is not on the table.
   */
  fourthOption?: string;
}

const slots: ManifestSlot[] = [];
let maxPeak = 0;
const hot: string[] = [];

function writePreview(slotId: string, name: string, spec: SoundSpec): string {
  const samples = toPreview(spec, slotId);
  const p = peak(samples);
  if (p > maxPeak) maxPeak = p;
  if (p > 0.95) hot.push(`${slotId}/${name} peak=${p.toFixed(3)}`);
  const rel = `previews/${slotId}/${name}.wav`;
  const abs = resolve(HERE, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, encodeWav(samples, RATE));
  return rel;
}

for (const slotId of CANDIDATE_SLOT_ORDER) {
  const slot = CANDIDATE_SLOTS[slotId];
  if (!slot) throw new Error(`slot ${slotId} in order but not in CANDIDATE_SLOTS`);

  const currentWav = writePreview(slotId, 'current', soundSpec(slot.current as SoundName));

  const candidates: ManifestCandidate[] = slot.candidates.map((c) => ({
    id: c.id,
    wav: writePreview(slotId, c.id, c.spec),
    character: c.character,
    params: `src/art/audio/candidates.ts#${slotId}.${c.id}`,
  }));

  const denied: ManifestDenied[] = (slot.denied ?? []).map((d) => ({
    id: d.id,
    wav: writePreview(slotId, `denied-${d.id}`, d.spec),
    character: d.character,
    params: `src/art/audio/candidates.ts#${slotId}.denied.${d.id}`,
    deniedAt: d.deniedAt,
    reason: d.reason,
  }));

  slots.push({
    id: slotId,
    label: slot.label,
    context: slot.context,
    current: currentWav,
    candidates,
    ...(denied.length === 0 ? {} : { denied }),
    ...(slot.fourthOption === undefined ? {} : { fourthOption: slot.fourthOption }),
  });
}

const manifest = {
  $comment:
    'Sound-review candidates for the s2 brief. Rendered by sound-review/render.ts. ' +
    'Review artifacts only — excluded from the game bundle. WAV paths are relative to this file.',
  brief: 's2-candidates',
  sampleRate: RATE,
  slots,
};

writeFileSync(resolve(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const nCand = slots.reduce((a, s) => a + s.candidates.length, 0);
const nDenied = slots.reduce((a, s) => a + (s.denied?.length ?? 0), 0);
console.log(
  `rendered ${slots.length} slots, ${nCand} candidates + ${slots.length} current previews` +
    (nDenied === 0 ? '' : ` + ${nDenied} denied takes kept for comparison`),
);
console.log(`peak across all previews: ${maxPeak.toFixed(3)}`);
if (hot.length) {
  console.log(`WARNING hot previews (peak > 0.95):\n  ${hot.join('\n  ')}`);
}
