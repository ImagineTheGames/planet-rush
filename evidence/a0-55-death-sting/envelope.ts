/**
 * evidence/a0-55-death-sting/envelope.ts — the sting through the hush, measured.
 * OWNER: Sound Agent. NOT part of the game bundle, NOT in the tsconfig `include`.
 * Run by hand:
 *
 *     npx vite-node evidence/a0-55-death-sting/envelope.ts > evidence/a0-55-death-sting/envelope.txt
 *
 * Sound cannot screenshot, so the evidence is numbers (the a3-03 precedent, and
 * a0-49's before/after tables). The claim under test is one sentence:
 *
 *   > the death sting is audible THROUGH the 0.12 s cut, and out to its own end,
 *   > while everything else in the mix goes to zero underneath it.
 *
 * Both halves are measured on the *shipped* modules — the fall is rendered by
 * `graph.renderSound`, the exact call the mix makes, and the envelope is
 * `DeathMoment.gain` advanced by the same 1/60 s frames `AudioEngine.update`
 * hands it. Nothing here re-implements either, so this table cannot drift away
 * from the game: change the sound or the quiet and re-running moves the numbers.
 *
 * The two routings differ by one multiplication, which is the whole fix:
 *
 *   before (a0-54 and earlier)  sting → sfx bus → duck → master   ×  gain(t)
 *   after  (a0-55)              sting → master                    ×  1
 *
 * The bus trims and the master volume are deliberately left OUT of both: they
 * are identical on the two paths (the sting rides the sfx level either way), so
 * including them would only scale every column by the same constant and invite
 * someone to read an absolute number off a table whose point is a ratio.
 */

import { writeFileSync } from 'node:fs';
import { SOUND, soundSpec } from '../../src/art/audio/bank';
import { renderSound } from '../../src/art/audio/graph';
import { DEFAULT_SAMPLE_RATE, peak, rms } from '../../src/art/audio/synth';
import { DeathMoment, HUSH_CUT_S, HUSH_RETURN_S, HUSH_S } from '../../src/art/vfx/death-moment';

const RATE = DEFAULT_SAMPLE_RATE;
const FRAME = 1 / 60;

/** The fall, rendered exactly as the mix renders it. */
const fall = renderSound(soundSpec(SOUND.stationDeath), RATE);
const seconds = fall.length / RATE;

/**
 * The hush envelope, sampled at audio rate.
 *
 * Advanced in 1/60 s steps and held between them, because that is what the mix
 * actually does: `AudioEngine.update` assigns `DeathMoment.gain` onto the duck
 * node once a frame. Sampling the curve continuously would flatter the old
 * routing by a frame's worth of fade it never had.
 */
function hushEnvelope(length: number): Float32Array {
  const out = new Float32Array(length);
  const death = new DeathMoment();
  death.trigger(); // the same frame the sting is fired (`./engine` TELL.stationDeath)
  let nextFrame = 0;
  let held = death.gain;
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    while (t >= nextFrame) {
      held = death.gain;
      death.update(FRAME);
      nextFrame += FRAME;
    }
    out[i] = held;
  }
  return out;
}

const hush = hushEnvelope(fall.length);

/** The fall as the player heard it before a0-55, and as they hear it now. */
const before = fall.map((s, i) => s * hush[i]!);
const after = fall;

/** Energy (∫x²) over a sample range — what "how much of the sound arrived" means. */
function energy(x: Float32Array, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return sum;
}

function slice(x: Float32Array, from: number, to: number): Float32Array {
  return x.subarray(Math.max(0, from), Math.min(x.length, to));
}

/** The last sample index that is not silent, in seconds. */
function audibleUntil(x: Float32Array, floor = 1e-4): number {
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]!) > floor) return i / RATE;
  return 0;
}

const out: string[] = [];
const say = (line = ''): void => void out.push(line);

say('a0-55 — the station-death sting, through the hush. MEASURED.');
say();
say(`  sound      ${SOUND.stationDeath} (${seconds.toFixed(3)} s rendered at ${RATE} Hz)`);
say(`  hush       cut ${HUSH_CUT_S} s → ${HUSH_S} s silent → ${HUSH_RETURN_S} s back (UNCHANGED by this brief)`);
say('  before     sting → sfx bus → duck → master   (multiplied by the hush)');
say('  after      sting → master                    (summed past the duck — a0-55)');
say();
say('Per 50 ms window. `rms`/`peak` are of the fall as it reaches the destination;');
say('`mix` is what any OTHER voice is multiplied by in the same window (the duck).');
say();
say('window (s)      mix     before rms   after rms    before peak  after peak');
say('--------------------------------------------------------------------------');

const WINDOW = 0.05;
for (let t = 0; t < seconds; t += WINDOW) {
  const from = Math.round(t * RATE);
  const to = Math.round(Math.min(t + WINDOW, seconds) * RATE);
  const b = slice(before, from, to);
  const a = slice(after, from, to);
  const mix = peak(slice(hush, from, to));
  say(
    `${t.toFixed(2)}–${Math.min(t + WINDOW, seconds).toFixed(2)}    ` +
      `${mix.toFixed(3)}    ${rms(b).toFixed(6)}     ${rms(a).toFixed(6)}     ` +
      `${peak(b).toFixed(4)}       ${peak(a).toFixed(4)}`,
  );
}

const cutSample = Math.round(HUSH_CUT_S * RATE);
const deliveredBefore = energy(before) / energy(after);
const pastTheCut = energy(after, cutSample) / energy(after);

say();
say('The headline');
say('------------');
say(`  the fall runs for                      ${audibleUntil(after).toFixed(3)} s`);
say(`  the cut reaches zero at                ${HUSH_CUT_S.toFixed(3)} s`);
say(`  BEFORE: audible until                  ${audibleUntil(before).toFixed(3)} s  (${((audibleUntil(before) / audibleUntil(after)) * 100).toFixed(1)}% of its own length)`);
say(`  AFTER:  audible until                  ${audibleUntil(after).toFixed(3)} s  (100.0% — nothing multiplies it but master)`);
say(`  energy of the fall that arrived, BEFORE ${(deliveredBefore * 100).toFixed(1)}%`);
say(`  energy of the fall that arrived, AFTER  100.0%`);
say(`  energy that lives PAST the cut          ${(pastTheCut * 100).toFixed(1)}%  ← what the player was losing`);
say();
say('So the reported bug, in one number: the developer heard the first');
say(`${(deliveredBefore * 100).toFixed(1)}% of the game's most serious sound and then nothing.`);
say();
say("The envelope, drawn — each row is 25 ms, the bar is that row's PEAK scaled to");
say('the fall\'s own peak over 28 characters, and `·` is anything under a 56th of it.');
say('-------------------------------------------------------------------------------');
say('           t   BEFORE (through the duck)      AFTER (past it)');

const ROW = 0.025;
const bar = (v: number, scale: number): string => {
  const n = Math.round((v / scale) * 28);
  return n <= 0 ? '·' : '█'.repeat(n);
};
const scale = peak(after);
for (let t = 0; t < seconds; t += ROW) {
  const from = Math.round(t * RATE);
  const to = Math.round(Math.min(t + ROW, seconds) * RATE);
  const b = peak(slice(before, from, to));
  const a = peak(slice(after, from, to));
  const mark = t < HUSH_CUT_S && t + ROW > HUSH_CUT_S ? '  ← the cut completes here' : '';
  say(`       ${t.toFixed(3)}   ${bar(b, scale).padEnd(30)} ${bar(a, scale)}${mark}`);
}

say();
say('Read the left column top to bottom: that is the bug. It is the same sound as');
say('the right column for four rows, and then it is a dead channel for a second and');
say('a third while the mix around it is also at zero — three seconds of silence that');
say('began mid-sting instead of after it. GDD §4.7 asks for the quiet to land ON TOP');
say('OF the fall; the right column is a sound running out under a silence, which is');
say('the picture the design describes ("nobody jokes for three seconds").');
say();
say('What the quiet still does (the other half of the claim)');
say('------------------------------------------------------');
say('  `mix` above is the multiplier every other voice gets, and it is 0.000 from');
say(`  ${HUSH_CUT_S.toFixed(2)} s onward — the alarm, the ambience, the soundtrack, the UI cues, all of`);
say('  it. The exemption is one voice wide. `src/art/audio/engine.test.ts` asserts');
say('  the same thing structurally (nothing else starts, and the four buses measure');
say('  zero to the destination while the sting does not), and');
say('  `src/art/vfx/death-moment.test.ts` pins the three numbers so a later pass');
say('  cannot restore the old behaviour by moving the cut or trimming the quiet.');

// ---------------------------------------------------------------------------
// The listenable half: four WAVs, so the table can be checked by ear
// ---------------------------------------------------------------------------

/**
 * A 16-bit mono WAV. Written by hand rather than pulled in as a dependency —
 * this is a 40-line header and the project ships no binary audio assets by
 * policy (everything in `src/art/audio/` is synthesized at runtime); these files
 * are *evidence*, sitting outside the bundle, and they are reproducible from
 * this script the day anyone doubts them.
 */
function wav(samples: Float32Array, rate = RATE): Buffer {
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    body.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

/**
 * The moment as a player meets it: a match still making noise, a home dying two
 * frames in, and then the quiet.
 *
 * The bed is real bank sounds on the real routing — turret fire and rock cracks
 * at the level `./engine` gives them — multiplied by the same hush envelope,
 * because that is what the duck does to them. Only the sting's own multiplier
 * differs between the two files, which is the entire diff under test.
 */
function room(stingRouting: Float32Array): Float32Array {
  const total = Math.round((HUSH_S + 0.6) * RATE);
  const mix = new Float32Array(total);
  const bed: [string, number, number][] = [
    [SOUND.turretFire, -0.45, 0.5],
    [SOUND.rockCrack, -0.3, 0.6],
    [SOUND.turretFire, -0.12, 0.5],
    [SOUND.rockChip, 0.25, 0.6], // the match trying to carry on, under the quiet
    [SOUND.turretFire, 0.7, 0.5],
    [SOUND.rockCrack, 1.6, 0.6],
    [SOUND.turretFire, 2.4, 0.5],
    [SOUND.rockChip, 3.15, 0.6], // the first thing back after the three seconds
  ];
  const death = new DeathMoment();
  death.trigger();
  const env = new Float32Array(total);
  {
    let nextFrame = 0;
    let held = death.gain;
    for (let i = 0; i < total; i++) {
      while (i / RATE >= nextFrame) {
        held = death.gain;
        death.update(FRAME);
        nextFrame += FRAME;
      }
      env[i] = held;
    }
  }
  // The bed, ducked — every voice but the fall.
  for (const [name, at, level] of bed) {
    const voice = renderSound(soundSpec(name as never), RATE);
    const start = Math.round((at + 0.5) * RATE); // 0.5 s of match before the death
    for (let i = 0; i < voice.length; i++) {
      const j = start + i;
      if (j < 0 || j >= total) continue;
      mix[j]! += voice[i]! * level * env[j]!;
    }
  }
  // The fall, at 0.5 s, on whichever routing this file is showing.
  const start = Math.round(0.5 * RATE);
  for (let i = 0; i < stingRouting.length; i++) {
    const j = start + i;
    if (j < total) mix[j]! += stingRouting[i]!;
  }
  return mix;
}

const here = new URL('.', import.meta.url).pathname;
const files: [string, Float32Array][] = [
  ['fall-before.wav', before],
  ['fall-after.wav', after],
  ['room-before.wav', room(before)],
  ['room-after.wav', room(after)],
];
for (const [name, samples] of files) writeFileSync(here + name, wav(samples));

say();
say('By ear');
say('------');
say('  fall-before.wav / fall-after.wav   the sting alone, on each routing.');
say('  room-before.wav / room-after.wav   the moment in context: half a second of');
say('                                     match, a home dying, the quiet, and the');
say('                                     match coming back. The bed is identical');
say('                                     in both — ducked, as it should be. The');
say('                                     only difference is whether the fall is');
say('                                     ducked with it.');
say('  Written by this script; no binary audio ships in `src/` (GDD §3.6 — every');
say('  sound in the game is synthesized at runtime, and these are evidence, not');
say('  assets).');

process.stdout.write(out.join('\n') + '\n');
