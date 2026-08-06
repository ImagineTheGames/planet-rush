/**
 * spikes/tone-audit/measure-bank-tone.ts — THROWAWAY measurement code (s7-01).
 * OWNER: Architect Agent. NOT part of the game bundle, NOT in the tsconfig
 * `include`, imported by nothing in `src/`. Run by hand:
 *
 *     npx vite-node spikes/tone-audit/measure-bank-tone.ts
 *     npx vite-node spikes/tone-audit/measure-bank-tone.ts --csv
 *
 * ## Why it exists
 *
 * `docs/audio-revoice-spec.md` claims things about the shipped bank — "21 square
 * voices", "rockChip's spectral centre is X Hz", "these two mechanics are only
 * N% apart and a re-voice can collide them". Claims in a decision document have
 * to be reproducible by whoever implements it, so this is the program that
 * produced every number in that document's tables. Run it before the re-voice to
 * reproduce the baseline; run it after to check that nothing named under
 * "what must not drift" moved.
 *
 * ## What it measures
 *
 *  - **Waveform census** — how many voices use each of the five oscillator
 *    shapes, and which sounds they belong to. This is the evidence for the
 *    amendment: `square` and `saw` are the two shapes the Gantry/Bone handoff
 *    names as *"what made earlier passes sound retro or cartoonish"*.
 *  - **Spectral centroid**, in Hz, by real FFT over the rendered buffer — the
 *    "how bright is it" number. Zero-crossing rate (what `audio.test.ts` uses as
 *    a cheap stand-in) is reported alongside it so the two can be compared.
 *  - **Level and length** — peak, RMS, duration. These carry the mix invariants
 *    the bank tests already assert (headroom, the alarm being loudest, the death
 *    having the longest tail).
 *  - **Retro tells, per sound** — the specific parameters that read as arcade
 *    rather than as a machine: a `square`/`saw` oscillator, `duty`/`dutySweep`,
 *    an `arpMul` step (jsfxr's "blip up"), `repeat`, vibrato fast enough to hear
 *    as a wobble, and a pitch glide wide enough to hear as a chirp. The spec's
 *    per-sound plan is written against this column.
 *
 * It never imports `./graph` (which needs a Web Audio context) — it reuses the
 * pure synth and the same render recipe `sound-review/render.ts` uses, so what
 * it measures is sample-for-sample what the mix would play.
 */

import {
  DEFAULT_SAMPLE_RATE,
  renderLayered,
  renderVoice,
  seamless,
  peak,
  rms,
  voiceDuration,
  type VoiceSpec,
  type Wave,
} from '../../src/art/audio/synth';
import {
  isLayered,
  loops,
  soundSpec,
  SOUND_NAMES,
  type SoundName,
  type SoundSpec,
} from '../../src/art/audio/bank';

const RATE = DEFAULT_SAMPLE_RATE;

// ---------------------------------------------------------------------------
// The faithful render recipe (copied from `graph.renderSound`, like the review
// renderer does — a spike must not be able to drift the game's own graph).
// ---------------------------------------------------------------------------

function renderSound(spec: SoundSpec): Float32Array {
  if (isLayered(spec)) {
    const looped = loops(spec);
    const samples = renderLayered(spec.layers, RATE, { edges: !looped });
    return looped ? seamless(samples, RATE, spec.crossfade ?? 0.04) : samples;
  }
  return renderVoice(spec, RATE);
}

/** Every {@link VoiceSpec} inside a sound, flattened. */
function voicesOf(spec: SoundSpec): readonly VoiceSpec[] {
  return isLayered(spec) ? spec.layers.map((l) => l.spec) : [spec];
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Spectral centroid in Hz — the amplitude-weighted mean frequency, which is the
 * closest single number to "how bright does this sound".
 *
 * Computed over a Hann-windowed 8192-point FFT of the loudest window in the
 * buffer, so a long quiet tail cannot drag a short bright transient down. Bins
 * are weighted by magnitude (not power): magnitude tracks perceived brightness
 * more evenly across the very different levels in this bank.
 */
function spectralCentroidHz(samples: Float32Array): number {
  const N = 8192;
  const frame = loudestWindow(samples, N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    // Hann window: without it, the frame edges are a step and every bin smears.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    re[i] = (frame[i] ?? 0) * w;
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

/** The `N`-sample window with the most energy, zero-padded if the sound is shorter. */
function loudestWindow(samples: Float32Array, N: number): Float32Array {
  if (samples.length <= N) {
    const out = new Float32Array(N);
    out.set(samples);
    return out;
  }
  const step = Math.max(1, Math.floor(N / 4));
  let best = 0;
  let bestEnergy = -1;
  for (let start = 0; start + N <= samples.length; start += step) {
    let e = 0;
    for (let i = start; i < start + N; i++) {
      const v = samples[i] ?? 0;
      e += v * v;
    }
    if (e > bestEnergy) {
      bestEnergy = e;
      best = start;
    }
  }
  return samples.slice(best, best + N);
}

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
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

/** Zero crossings per sample — the cheap brightness proxy `audio.test.ts` uses. */
function zeroCrossingRate(samples: Float32Array): number {
  let n = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
  }
  return samples.length > 0 ? n / samples.length : 0;
}

// ---------------------------------------------------------------------------
// Retro tells — the parameters that read arcade rather than machined
// ---------------------------------------------------------------------------

/**
 * Vibrato this fast on a voice this short is heard as a *wobble* rather than as
 * a texture — the `rockChip` finding. 8 Hz is the usual floor for "audible as
 * modulation"; anything above it on a sub-200 ms voice is a character choice.
 */
const WOBBLE_RATE_HZ = 8;

/** A pitch glide wider than a minor third is heard as a *chirp*, not as a body fall. */
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
    const dir = v.freqEnd > v.freq ? 'up' : 'down';
    if (ratio >= CHIRP_RATIO) tells.push(`chirp ${dir} ×${ratio.toFixed(2)}`);
  }
  return tells;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface Row {
  readonly name: SoundName;
  readonly voices: number;
  readonly waves: string;
  readonly seconds: number;
  readonly peak: number;
  readonly rms: number;
  readonly centroidHz: number;
  readonly zcr: number;
  readonly tells: string;
}

function measure(): Row[] {
  const rows: Row[] = [];
  for (const name of SOUND_NAMES) {
    const spec = soundSpec(name);
    const samples = renderSound(spec);
    const vs = voicesOf(spec);
    const waveCounts = new Map<Wave, number>();
    for (const v of vs) waveCounts.set(v.wave, (waveCounts.get(v.wave) ?? 0) + 1);
    const tells = new Set<string>();
    for (const v of vs) for (const t of retroTells(v)) tells.add(t);
    rows.push({
      name,
      voices: vs.length,
      waves: [...waveCounts.entries()].map(([w, n]) => (n > 1 ? `${w}×${n}` : w)).join(' '),
      seconds: samples.length / RATE,
      peak: peak(samples),
      rms: rms(samples),
      centroidHz: spectralCentroidHz(samples),
      zcr: zeroCrossingRate(samples),
      tells: [...tells].join(', '),
    });
  }
  return rows;
}

function main(): void {
  const rows = measure();
  const csv = process.argv.includes('--csv');

  if (csv) {
    console.log('name,voices,waves,seconds,peak,rms,centroidHz,zcr,tells');
    for (const r of rows) {
      console.log(
        [
          r.name,
          r.voices,
          `"${r.waves}"`,
          r.seconds.toFixed(3),
          r.peak.toFixed(3),
          r.rms.toFixed(4),
          Math.round(r.centroidHz),
          r.zcr.toFixed(4),
          `"${r.tells}"`,
        ].join(','),
      );
    }
    return;
  }

  // --- The waveform census (the amendment's evidence) ---------------------
  const census = new Map<Wave, number>();
  const byWave = new Map<Wave, string[]>();
  let totalVoices = 0;
  for (const name of SOUND_NAMES) {
    for (const v of voicesOf(soundSpec(name))) {
      totalVoices++;
      census.set(v.wave, (census.get(v.wave) ?? 0) + 1);
      const list = byWave.get(v.wave) ?? [];
      list.push(v.name);
      byWave.set(v.wave, list);
    }
  }
  console.log(`\n=== WAVEFORM CENSUS — ${SOUND_NAMES.length} sounds, ${totalVoices} voices ===\n`);
  for (const wave of ['square', 'saw', 'triangle', 'sine', 'noise'] as Wave[]) {
    const n = census.get(wave) ?? 0;
    console.log(`  ${wave.padEnd(9)} ${String(n).padStart(3)}  (${((100 * n) / totalVoices).toFixed(1)}%)`);
  }
  console.log(`\n  square voices: ${(byWave.get('square') ?? []).join(', ')}`);
  console.log(`\n  saw voices:    ${(byWave.get('saw') ?? []).join(', ')}`);

  // --- Per sound ----------------------------------------------------------
  console.log(`\n=== PER SOUND ===\n`);
  console.log(
    `  ${'sound'.padEnd(17)} ${'v'.padStart(2)} ${'waves'.padEnd(22)} ${'sec'.padStart(6)} ${'peak'.padStart(5)} ${'rms'.padStart(6)} ${'centroid'.padStart(9)} ${'zcr'.padStart(7)}  tells`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(17)} ${String(r.voices).padStart(2)} ${r.waves.padEnd(22)} ${r.seconds.toFixed(2).padStart(6)} ${r.peak.toFixed(2).padStart(5)} ${r.rms.toFixed(4).padStart(6)} ${(Math.round(r.centroidHz) + ' Hz').padStart(9)} ${r.zcr.toFixed(4).padStart(7)}  ${r.tells}`,
    );
  }

  // --- The pairs a re-voice can collide -----------------------------------
  // Every sound is a mechanic's audible tell (GDD §3.6). Two tells that a player
  // must not confuse have to stay apart in at least one measured dimension; this
  // prints the current margin for the pairs `docs/audio-revoice-spec.md` names,
  // so s7-02 can re-run it and see whether its re-voice narrowed one.
  const PAIRS: readonly (readonly [SoundName, SoundName, string])[] = [
    ['rockChip', 'hullHit', 'am I mining or shooting a ship (GDD §2.3)'],
    ['rockChip', 'shotImpact', 'my shot chipped rock vs my shot landed on a target'],
    ['shieldHit', 'coreHit', 'their shield ate it vs the reactor is taking it (§2.2)'],
    ['rejectBuzz', 'coreHit', 'a refused buy vs a reactor hit — both low, both bad news'],
    ['oreCollect', 'depositTick', 'picked up a chunk vs banked a chunk (§2.3)'],
    ['respawnBeep', 'spawnPulse', 'the respawn clock vs spawn protection (§2.1, §2.7)'],
    ['buildComplete', 'purchaseConfirm', 'the defence arrived vs the buy registered'],
    ['alarm', 'waveArrive', 'home is under attack vs a wave arrived — the §2.2 mechanic'],
    ['turretFire', 'shotImpact', 'a turret fired at me vs something hit'],
  ];
  console.log(`\n=== PAIRS THAT MUST STAY APART ===\n`);
  const byName = new Map(rows.map((r) => [r.name, r]));
  for (const [a, b, why] of PAIRS) {
    const ra = byName.get(a);
    const rb = byName.get(b);
    if (!ra || !rb) continue;
    const lo = Math.min(ra.centroidHz, rb.centroidHz);
    const hi = Math.max(ra.centroidHz, rb.centroidHz);
    const ratio = lo > 0 ? hi / lo : Infinity;
    const zLo = Math.min(ra.zcr, rb.zcr);
    const zHi = Math.max(ra.zcr, rb.zcr);
    console.log(
      `  ${(a + ' / ' + b).padEnd(30)} centroid ${Math.round(ra.centroidHz)} vs ${Math.round(rb.centroidHz)} Hz  (×${ratio.toFixed(2)})   zcr ×${(zLo > 0 ? zHi / zLo : Infinity).toFixed(2)}`,
    );
    console.log(`  ${''.padEnd(30)} ${why}`);
  }
  console.log('');
}

main();
