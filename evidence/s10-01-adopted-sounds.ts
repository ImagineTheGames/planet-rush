/**
 * evidence/s10-01-adopted-sounds.ts — the three chosen sounds, played off the
 * shipped bank. OWNER: Sound Agent.
 *
 * Usage:
 *   npx vite-node evidence/s10-01-adopted-sounds.ts
 *   npx vite-node evidence/s10-01-adopted-sounds.ts dist   # also check a built bundle
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * s10-01 adopts three verdicts from `/status/sound-choices.json` — `rockChip` b,
 * `hullHit` a, `rockCrack` c — and the brief asks for the three slots *playing
 * their chosen candidates*, plus a statement of which file each letter resolved
 * to. A green test suite is not that: the suite proves the bank and the board
 * agree, which is worth having, but the developer's question is "is the sound I
 * picked the sound the game makes".
 *
 * So this writes the audio out, three times over, from three different places,
 * and shows the bytes are the same each time:
 *
 *   1. **What the game plays.** `src/art/audio/bank.ts` rendered through the real
 *      recipe (`graph.renderSound`, copied here for the same reason
 *      `sound-review/render.ts` copies it: `graph` wants a Web Audio context and
 *      this has to run headless).
 *   2. **What the developer heard.** The committed preview WAV the review page
 *      served them for that letter — untouched by this brief on the candidate
 *      side, and re-rendered on the `current` side so the board plays what ships.
 *   3. **What is in the bundle.** With a `dist` argument, the built entry chunk is
 *      searched for the adopted voices' seeds and for the names of the denied
 *      offers. This is the deployment question (LESSONS §1: "merged, tested and
 *      dead-wired"), asked mechanically — which CODE is being served.
 *
 * It also prints the measurements the brief's baselines moved on, so the numbers
 * in the PR are reproducible rather than quoted.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SAMPLE_RATE,
  renderLayered,
  renderVoice,
  seamless,
  peak,
  rms,
  type VoiceSpec,
} from '../src/art/audio/synth';
import { isLayered, loops, soundSpec, type SoundSpec, type SoundName } from '../src/art/audio/bank';
import { CANDIDATE_SLOTS } from '../src/art/audio/candidates';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(HERE, 's10-01-adopted-sounds');
const RATE = DEFAULT_SAMPLE_RATE;

/** The three verdicts this brief acted on, verbatim from `/status/sound-choices.json`. */
const ADOPTED = [
  { slot: 'rockChip', letter: 'b', at: '2026-08-13T04:01:48.225Z' },
  { slot: 'hullHit', letter: 'a', at: '2026-08-13T04:02:30.839Z' },
  { slot: 'rockCrack', letter: 'c', at: '2026-08-13T04:03:05.100Z' },
] as const;

/** The faithful render recipe, copied from `graph.renderSound` (no Web Audio here). */
function render(spec: SoundSpec): Float32Array {
  const looped = loops(spec);
  const options = looped ? { edges: false } : {};
  const samples = isLayered(spec)
    ? renderLayered(spec.layers, RATE, options)
    : renderVoice(spec as VoiceSpec, RATE, options);
  if (!looped) return samples;
  return seamless(samples, RATE, (isLayered(spec) ? spec.crossfade : undefined) ?? 0.04);
}

/** 16-bit mono WAV, the same writer `sound-review/render.ts` uses. */
function wav(samples: Float32Array): Buffer {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40); // data chunk size — the byte that makes this the same file
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const sha = (b: Buffer | Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Zero crossings per sample over the whole buffer — the bank's brightness proxy. */
function zcr(s: Float32Array): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) if ((s[i]! >= 0) !== (s[i - 1]! >= 0)) n++;
  return s.length > 0 ? n / s.length : 0;
}

/** The s4-01 window: past the attack transient, 2048 samples. The ratified ceiling is 0.034. */
function windowedZcr(s: Float32Array): number {
  const from = Math.round(0.003 * RATE);
  const to = Math.min(s.length, from + 2048);
  let n = 0;
  for (let i = from + 1; i < to; i++) if ((s[i]! >= 0) !== (s[i - 1]! >= 0)) n++;
  return n / Math.max(1, to - from);
}

mkdirSync(OUT, { recursive: true });

const slots = ADOPTED.map(({ slot, letter, at }) => {
  const chosen = CANDIDATE_SLOTS[slot]!.candidates.find((c) => c.id === letter);
  if (!chosen) throw new Error(`${slot}: letter ${letter} does not resolve to a candidate — STOP AND REPORT`);

  const shipped = render(soundSpec(slot as SoundName));
  const offered = render(chosen.spec);

  // The bytes the game would play, written out so a person can listen to them.
  const shippedWav = wav(shipped);
  writeFileSync(join(OUT, `${slot}.shipped.wav`), shippedWav);

  // The bytes the developer was served when they pressed the letter.
  const heardPath = join(ROOT, 'sound-review', 'previews', slot, `${letter}.wav`);
  const heard = readFileSync(heardPath);
  // And the board's "current", re-rendered on adoption so the page plays what ships.
  const currentPath = join(ROOT, 'sound-review', 'previews', slot, 'current.wav');
  const current = readFileSync(currentPath);

  let identical = shipped.length === offered.length;
  if (identical) for (let i = 0; i < shipped.length; i++) if (shipped[i] !== offered[i]) { identical = false; break; }

  return {
    slot,
    letter,
    decidedAt: at,
    character: chosen.character,
    resolvedTo: {
      previewTheDeveloperHeard: `sound-review/previews/${slot}/${letter}.wav`,
      params: `src/art/audio/candidates.ts#${slot}.${letter}`,
      candidateSpecName: chosen.spec.name,
    },
    shippedPlaysTheChosenCandidate: identical,
    sha256: {
      shippedFromBankTs: sha(shippedWav),
      previewTheDeveloperHeard: sha(heard),
      boardCurrentAfterAdoption: sha(current),
    },
    // The board's `current` is what the review page plays beside the offers. After
    // adoption it must BE the offer that was chosen, byte for byte.
    boardCurrentMatchesTheChosenPreview: sha(current) === sha(heard),
    // …and the WAV this script wrote off `bank.ts` must be that same file too.
    shippedWavMatchesTheChosenPreview: sha(shippedWav) === sha(heard),
    measured: {
      seconds: +(shipped.length / RATE).toFixed(4),
      peak: +peak(shipped).toFixed(4),
      rms: +rms(shipped).toFixed(4),
      zcr: +zcr(shipped).toFixed(5),
      windowedZcr: +windowedZcr(shipped).toFixed(5),
    },
  };
});

/** Every slot the developer has NOT ruled on: still denied, and must play none of its offers. */
const denied = Object.keys(CANDIDATE_SLOTS)
  .filter((id) => !ADOPTED.some((a) => a.slot === id))
  .map((id) => {
    const slot = CANDIDATE_SLOTS[id]!;
    const shipped = render(soundSpec(slot.current));
    const revived = slot.candidates
      .filter((c) => {
        const offered = render(c.spec);
        if (offered.length !== shipped.length) return false;
        for (let i = 0; i < offered.length; i++) if (offered[i] !== shipped[i]) return false;
        return true;
      })
      .map((c) => c.id);
    return { slot: id, revived };
  });

/** With a `dist` argument: is the adopted voice in the built bundle? */
function bundleCheck(distDir: string) {
  const assets = join(ROOT, distDir, 'assets');
  if (!existsSync(assets)) return { checked: false, why: `${distDir}/assets does not exist — run \`npm run build\`` };
  // Every emitted JS chunk, not a guessed filename: the entry is `main-*.js` here
  // and a chunking change must not silently turn this check into "nothing found".
  const entries = readdirSync(assets).filter((f) => f.endsWith('.js'));
  if (entries.length === 0) return { checked: false, why: `no .js chunks under ${distDir}/assets` };
  const js = entries.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
  return {
    checked: true,
    chunks: entries,
    // The seeds of the adopted voices. Numeric literals survive minification, and
    // these six are unique to the three candidates that were chosen.
    adoptedSeedsPresent: {
      'rockChip.mass (30110)': js.includes('30110'),
      'rockChip.crush (30112)': js.includes('30112'),
      'hullHit.plate (30300)': js.includes('30300'),
      'hullHit.coil (30304)': js.includes('30304'),
      'rockCrack.shard (30150)': js.includes('30150'),
      'rockCrack.dust (30154)': js.includes('30154'),
    },
    // The retired voices' seeds. `rockChip` 0x9e37 / `hullHit` 0x4dc3, 0x4dc4 /
    // `rockCrack` 0x1a2b — the numbers every revision back to a3-02 carried.
    retiredSeedsGone: {
      'rockChip (0x9e37 = 40503)': !js.includes('40503'),
      'hullHit.bite (0x4dc3 = 19907)': !js.includes('19907'),
      'rockCrack (0x1a2b = 6699)': !js.includes('6699'),
    },
    // The review board must not be in the game bundle at all — it carries the
    // thirty-seven denied takes, and pulling it in would ship them.
    reviewBoardNotBundled: !js.includes('_pressureBite') && !js.includes('CANDIDATE_SLOT_ORDER'),
  };
}

const report = {
  brief: 's10-01',
  what: 'the three chosen sounds, played off the shipped bank',
  source: '/status/sound-choices.json',
  slots,
  everySlotPlaysItsChosenCandidate: slots.every((s) => s.shippedPlaysTheChosenCandidate),
  deniedSlotsChecked: denied.length,
  deniedSlotsRevived: denied.filter((d) => d.revived.length > 0),
  bundle: process.argv[2] ? bundleCheck(process.argv[2]) : { checked: false, why: 'no dist argument given' },
  wavsWritten: `evidence/s10-01-adopted-sounds/*.shipped.wav`,
};

writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
