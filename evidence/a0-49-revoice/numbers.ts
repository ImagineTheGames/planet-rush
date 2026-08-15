/**
 * evidence/a0-49-revoice/numbers.ts — the two revoices, measured. OWNER: Sound
 * Agent. NOT part of the game bundle, NOT in the tsconfig `include`. Run by hand:
 *
 *     npx vite-node evidence/a0-49-revoice/numbers.ts > evidence/a0-49-revoice/numbers.txt
 *
 * `docs/sound-denials-outstanding.md` dispositions 38 outstanding denials and
 * comes out with exactly two **revoices** — the two slots whose denial post-dates
 * every offer standing against it. Each carries its own reason in the developer's
 * own words, and the two reasons ask for opposite things:
 *
 *   oreCollect  *"add a little bit more of sparkle to it, like you've won a prize,
 *                but subtle... it shouldn't be too long"*
 *   levelUp     *"sounds too toony, doesn't sound rewarding"*
 *
 * A re-offer is only an *answer* if it moved, in the direction that was asked
 * for, from the thing that was rejected — which is a before/after and therefore a
 * number. This is the program that produced them.
 *
 * The denied takes are **inlined below**, copied from `src/art/audio/candidates.ts`
 * at `334c460` (the tip of `main` when this brief opened). They are gone from that
 * file by design — that is what a re-offer is — so evidence that reached for them
 * with a `git show` would stop reproducing the day the commit is rewritten, and
 * the whole point of this file is a before/after that still runs in a year. The
 * same six specs are inlined in `src/art/audio/candidates.test.ts`, where they are
 * the bound the tests assert against.
 *
 * Everything else is measured out of the shipped modules on the same render recipe
 * `graph.renderSound` uses, so the table cannot drift from the sounds.
 */

import {
  DEFAULT_SAMPLE_RATE,
  peak,
  renderLayered,
  renderVoice,
  rms,
  seamless,
  type VoiceSpec,
} from '../../src/art/audio/synth';
import { isLayered, loops, soundSpec, type SoundName, type SoundSpec } from '../../src/art/audio/bank';
import { grains, plate, swept } from '../../src/art/audio/instrument';
import { CANDIDATE_SLOTS } from '../../src/art/audio/candidates';

const RATE = DEFAULT_SAMPLE_RATE;

/** The faithful render recipe (mirrors `graph.renderSound`), headless. */
function render(spec: SoundSpec): Float32Array {
  const looped = loops(spec);
  const options = looped ? { edges: false } : {};
  const samples = isLayered(spec)
    ? renderLayered(spec.layers, RATE, options)
    : renderVoice(spec as VoiceSpec, RATE, options);
  if (!looped) return samples;
  return seamless(samples, RATE, (isLayered(spec) ? spec.crossfade : undefined) ?? 0.04);
}

/**
 * RMS under `hz`, in absolute terms — one-pole, the same filter `./synth` uses.
 *
 * This is the *mass* number. "Doesn't sound rewarding" is not a level complaint
 * about the whole cue (the denied takes were not quiet), it is about what is under
 * the landing, so a share would hide it: a cue can move all of its energy up and
 * keep the same total RMS while losing every bit of its body.
 */
function lowBandRms(buf: Float32Array, hz: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / RATE);
  let y = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    y += ((buf[i] ?? 0) - y) * a;
    sum += y * y;
  }
  return Math.sqrt(sum / Math.max(1, buf.length));
}

/**
 * Share of total energy above `hz` — the *sparkle* number.
 *
 * A share and not a level, because "sparkle" is a character while "but subtle" is
 * the clause that bounds the level, and the two must be able to move independently
 * or the brief cannot be satisfied at all. 3 kHz is the crossover because
 * `./synth` clamps a resonant cutoff to `SVF_MAX_HZ_FRACTION` (~6.5 kHz at 44.1 k),
 * so 3–6.4 kHz *is* the top of this bank's spectrum — a first pass written above
 * that clamp measured darker than the takes it was replacing.
 */
function brightShare(buf: Float32Array, hz: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / RATE);
  let y = 0;
  let hi = 0;
  let all = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] ?? 0;
    y += (x - y) * a;
    hi += (x - y) * (x - y);
    all += x * x;
  }
  return all > 0 ? hi / all : 0;
}

/**
 * RMS of the last 60% over the first 40% — the *seated* number.
 *
 * Is anything left after the thing lands. A reward that is over the instant it
 * arrives is an announcement; one that is still there is an arrival with mass.
 */
function lateOverEarly(buf: Float32Array): number {
  const split = Math.floor(buf.length * 0.4);
  const seg = (from: number, to: number): number => {
    let s = 0;
    for (let i = from; i < to; i++) s += (buf[i] ?? 0) ** 2;
    return Math.sqrt(s / Math.max(1, to - from));
  };
  return seg(split, buf.length) / Math.max(1e-9, seg(0, split));
}

/** Zero-crossing rate — the cheap brightness proxy `audio.test.ts` separates the bank with. */
function zcr(buf: Float32Array): number {
  let n = 0;
  for (let i = 1; i < buf.length; i++) if ((buf[i]! >= 0) !== (buf[i - 1]! >= 0)) n++;
  return n / Math.max(1, buf.length);
}

// ---------------------------------------------------------------------------
// The takes that were denied, inlined from `candidates.ts` at `334c460`.
// ---------------------------------------------------------------------------

const DENIED: Readonly<Record<string, readonly SoundSpec[]>> = {
  oreCollect: [
    {
      name: 'oreCollect_a_magneticSnap',
      layers: [
        ...plate('oreCollect_a.snap', 1500, { gain: 0.4, decay: 0.05, ratios: [1, 2.41], q: 8, curve: 6, punch: 0.6, grain: 0.34, seed: 30190 }),
        swept('oreCollect_a.pull', { wave: 'noise', freq: 300, from: 900, to: 380, q: 2.4, gain: 0.18, attack: 0.0008, hold: 0.004, decay: 0.045, curve: 5, seed: 30193 }),
      ],
    },
    {
      name: 'oreCollect_b_servoIntake',
      layers: [
        swept('oreCollect_b.intake', { wave: 'triangle', freq: 460, from: 380, to: 2600, q: 5.5, gain: 0.34, attack: 0.003, hold: 0.012, decay: 0.075, curve: 3.4, noiseMix: 0.22, seed: 30195 }),
        grains('oreCollect_b.step', { freq: 900, grain: 0.004, gain: 0.14, hold: 0.004, decay: 0.03, curve: 6, from: 2600, q: 3, hp: 500, seed: 30196 }),
      ],
    },
    {
      name: 'oreCollect_c_telemetry',
      layers: [
        ...plate('oreCollect_c.blip', 2200, { gain: 0.3, decay: 0.055, ratios: [1, 2.05], q: 12, curve: 6, punch: 0.4, grain: 0.08, edge: 0, seed: 30200 }),
      ],
    },
  ],
  levelUp: [
    {
      name: 'levelUp_a_dryArrival',
      layers: [
        grains('levelUp_a.approach', { freq: 300, grain: 0.005, gain: 0.2, attack: 0.006, hold: 0.014, decay: 0.06, curve: 2.6, from: 800, to: 3600, q: 3.4, hp: 220, seed: 35200 }),
        grains('levelUp_a.land', { freq: 900, grain: 0.0022, gain: 0.34, hold: 0.01, decay: 0.16, curve: 5, from: 5200, to: 1800, q: 3.6, hp: 500, at: 0.085, seed: 35201 }),
        swept('levelUp_a.seat', { wave: 'triangle', freq: 110, from: 300, to: 180, q: 2, gain: 0.2, attack: 0.002, hold: 0.012, decay: 0.2, curve: 4, noiseMix: 0.1, at: 0.085, seed: 35203 }),
      ],
    },
    {
      name: 'levelUp_b_pressureSeating',
      layers: [
        swept('levelUp_b.charge', { wave: 'noise', freq: 260, from: 600, to: 2800, q: 4.5, gain: 0.16, attack: 0.008, hold: 0.014, decay: 0.06, curve: 2.4, hp: 180, seed: 35210 }),
        swept('levelUp_b.seat', { wave: 'triangle', freq: 220, freqEnd: 208, from: 2400, to: 520, q: 3.4, gain: 0.36, attack: 0.002, hold: 0.016, decay: 0.3, curve: 4, punch: 0.5, noiseMix: 0.12, at: 0.085, seed: 35211 }),
        swept('levelUp_b.sub', { wave: 'sine', freq: 82.41, from: 240, to: 120, q: 2, gain: 0.22, attack: 0.003, hold: 0.012, decay: 0.22, curve: 3.6, noiseMix: 0.05, at: 0.085, seed: 35212 }),
      ],
    },
    {
      name: 'levelUp_c_struckPlate',
      layers: [
        swept('levelUp_c.approach', { wave: 'noise', freq: 320, from: 700, to: 3000, q: 5, gain: 0.13, attack: 0.006, hold: 0.012, decay: 0.06, curve: 2.6, hp: 200, seed: 35220 }),
        ...plate('levelUp_c.root', 880, { gain: 0.3, decay: 0.32, ratios: [1, 2.41], q: 8, curve: 4, punch: 0.4, grain: 0.22, at: 0.085, seed: 35222 }),
        ...plate('levelUp_c.fifth', 1318.51, { gain: 0.16, decay: 0.24, ratios: [1], q: 9, curve: 4.5, grain: 0.18, edge: 0, at: 0.085, seed: 35226 }),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const num = (v: number, d: number, n: number): string => {
  const s = v.toFixed(d);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
};

function row(label: string, buf: Float32Array): void {
  console.log(
    [
      pad(label, 46),
      num(buf.length / RATE, 3, 6),
      num(peak(buf), 3, 6),
      num(rms(buf), 4, 7),
      num(lowBandRms(buf, 200), 4, 8),
      num(brightShare(buf, 3000), 3, 7),
      num(lateOverEarly(buf), 3, 6),
    ].join(' '),
  );
}

const HEAD = `${pad('sound', 46)} ${pad('secs', 6)} ${pad('peak', 6)} ${pad('rms', 7)} ${pad('<200Hz', 8)} ${pad('>3kHz', 7)} late/early`;
const RULE = '-'.repeat(96);

console.log('a0-49 — the two revoices, measured\n');
console.log('`<200Hz` is absolute RMS (mass); `>3kHz` is a SHARE of total energy (sparkle);');
console.log('`late/early` is RMS of the last 60% over the first 40% (is anything left after it lands).\n');

for (const slot of ['oreCollect', 'levelUp'] as const) {
  const reason =
    slot === 'oreCollect'
      ? '"add a little bit more of sparkle to it, like you\'ve won a prize, but subtle... it shouldn\'t be too long"'
      : '"sounds too toony, doesn\'t sound rewarding"';
  console.log(`=== ${slot} — denied 2026-08-14`);
  console.log(`    ${reason}\n`);
  console.log(HEAD);
  console.log(RULE);
  row(`incumbent (bank, unchanged)`, render(soundSpec(slot as SoundName)));
  for (const [i, spec] of DENIED[slot]!.entries()) row(`denied ${'abc'[i]} — ${spec.name}`, render(spec));
  for (const c of CANDIDATE_SLOTS[slot]!.candidates) row(`offer ${c.id} — ${c.character}`, render(c.spec));
  console.log('');
}

console.log('=== the bounds these are held to, resolved\n');

{
  const denied = DENIED.oreCollect!.map((s) => render(s));
  const inc = render(soundSpec('oreCollect'));
  const brightest = Math.max(...denied.map((b) => brightShare(b, 3000)));
  const longest = Math.max(...denied.map((b) => b.length));
  console.log(`oreCollect  sparkle  > ${(brightest * 1.25).toFixed(3)}  (1.25x the brightest denied take, ${brightest.toFixed(3)})`);
  console.log(`            level    <= rms ${rms(inc).toFixed(4)} / peak ${peak(inc).toFixed(3)}  (the incumbent it adds sparkle TO)`);
  console.log(`            length   <= ${(longest / RATE).toFixed(3)}s  (the longest denied take)`);
  for (const c of CANDIDATE_SLOTS.oreCollect!.candidates) {
    const b = render(c.spec);
    console.log(
      `              ${c.id}: sparkle ${brightShare(b, 3000).toFixed(3)}  rms ${rms(b).toFixed(4)}  peak ${peak(b).toFixed(3)}  ${(b.length / RATE).toFixed(3)}s`,
    );
  }
}
console.log('');
{
  const denied = DENIED.levelUp!.map((s) => render(s));
  const mass = Math.max(...denied.map((b) => lowBandRms(b, 200)));
  const sustain = Math.max(...denied.map((b) => lateOverEarly(b)));
  const result = rms(render(soundSpec('matchEnd')));
  console.log(`levelUp     mass     > ${mass.toFixed(4)}  (the heaviest denied take)`);
  console.log(`            seated   > ${sustain.toFixed(3)}  (the longest-ringing denied take)`);
  console.log(`            level    < ${(result * 0.8).toFixed(4)}  (0.8x matchEnd — the XP beat plays BENEATH the result)`);
  for (const c of CANDIDATE_SLOTS.levelUp!.candidates) {
    const b = render(c.spec);
    console.log(
      `              ${c.id}: mass ${lowBandRms(b, 200).toFixed(4)}  seated ${lateOverEarly(b).toFixed(3)}  rms ${rms(b).toFixed(4)}`,
    );
  }
}

console.log('\n=== the pair that must not collide: oreCollect vs depositTick (§8)\n');
console.log('zero-crossing rate — the proxy `audio.test.ts` separates the bank with. The sparkle');
console.log('moves oreCollect UP and depositTick has not moved, so the gap can only widen.\n');
for (const c of CANDIDATE_SLOTS.oreCollect!.candidates) {
  console.log(`  oreCollect/${c.id}  zcr ${zcr(render(c.spec)).toFixed(4)}`);
}
console.log(`  depositTick (bank) zcr ${zcr(render(soundSpec('depositTick'))).toFixed(4)}`);
for (const c of CANDIDATE_SLOTS.depositTick!.candidates) {
  console.log(`  depositTick/${c.id} zcr ${zcr(render(c.spec)).toFixed(4)}`);
}

console.log('\n=== what was NOT regenerated, and why\n');
console.log('xpBarFill  denied 2026-08-14 — "all these sounds are mega annoying, we don\'t need');
console.log('           this at all no need for regeneration". Dispositioned CUT, not revoiced:');
console.log('           three new takes on a sound somebody asked to stop hearing is the round');
console.log('           this brief exists to prevent. The proposal and its cost are in');
console.log('           docs/sound-denials-outstanding.md; the bed still plays.');
console.log('the 35 R1 rows  superseded by a0-01b on 2026-08-08, the day after the deny-all.');
console.log('           The work is not missing, it is invisible — it was filed under the same');
console.log('           letters the denial had just spent. Nothing owed but a listen.');
console.log('the music six   a decision ("does this game want music at all right now"), not a');
console.log('           batch. Six regenerated tracks nobody asked for is worse than none.');
