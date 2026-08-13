/**
 * src/art/audio/instrument.ts — the round-2 sound-design instrument. OWNER: Sound Agent.
 *
 * Five builders, all of them made of the round-2 synth (`./synth`) rather than of a
 * bare oscillator, so nothing built here can be round 1 under a new name. Everything
 * that carries character — the corner, the Q, the grain rate, the tail — is a number
 * at the call site, not a default in here.
 *
 * ## Why it is its own module (s10-01)
 *
 * These builders were written inside `./candidates`, the review board, because that
 * is where the offers lived and the shipped bank was untouched by construction. Then
 * the developer chose three of them — `rockChip` **b**, `hullHit` **a**, `rockCrack`
 * **c** — and a chosen candidate has to become a shipped sound.
 *
 * The bank cannot import `./candidates`: that file is a 2 500-line review artifact
 * imported by nothing in the game, and pulling it into the bundle to reach two
 * helper functions would ship the thirty-seven takes the developer denied. Copying
 * the builders into `./bank` instead would be worse — an adopted voice would then be
 * a *transcription* of the one that was approved, and the first typo in it ships a
 * sound nobody agreed to.
 *
 * So the instrument moves here and both sides import it. An adopted voice in `./bank`
 * is then the same call with the same arguments as the candidate the developer heard,
 * and `candidates.test.ts` asserts the two render sample-for-sample identical — the
 * adoption is machine-checked rather than eyeballed.
 *
 * Nothing about the builders themselves changed in the move. See `./candidates` for
 * the design argument they were written under (the material carries the register, not
 * the oscillator) and `docs/audio-revoice-spec.md` §5 for the clauses they satisfy.
 */

import type { SoundLayer } from './bank';
import type { VoiceSpec } from './synth';

/** `exactOptionalPropertyTypes`: an absent `at` is not `at: undefined`. */
export function place(spec: VoiceSpec, at?: number): SoundLayer {
  return at === undefined ? { spec } : { spec, at };
}

/**
 * One resonant band of noise — a single partial of a struck body.
 *
 * `bandPass` over `noise` is the transient this register runs on: narrow, pitched,
 * and made entirely of the material that went into it. The alternative — the attack
 * segment of a tone standing in for a strike — is what round 1 shipped.
 */
export function band(
  name: string,
  freq: number,
  o: {
    readonly gain: number;
    readonly decay: number;
    /** Q. 4 is a knock, 8 is a struck plate, 12 is a tuning fork. */
    readonly q?: number;
    readonly attack?: number;
    readonly hold?: number;
    readonly curve?: number;
    readonly punch?: number;
    readonly hp?: number;
    readonly at?: number;
    readonly seed: number;
  },
): SoundLayer {
  return place(
    {
      name,
      wave: 'noise',
      attack: o.attack ?? 0.0004,
      hold: o.hold ?? 0.002,
      decay: o.decay,
      decayCurve: o.curve ?? 6,
      ...(o.punch === undefined ? {} : { punch: o.punch }),
      freq,
      lowPass: freq,
      resonance: o.q ?? 6,
      bandPass: true,
      ...(o.hp === undefined ? {} : { highPass: o.hp }),
      gain: o.gain,
      seed: o.seed,
    },
    o.at,
  );
}

/**
 * A struck **plate**: an edge, then two or three **inharmonic** partials ringing.
 *
 * Three things make this metal rather than the glockenspiel round 1 shipped, and
 * all three are deliberate departures from the incumbent's struck note:
 *
 *  - **The spacing is not `GLASS_PARTIALS`** (1 · 2.76 · 5.4). That set is the
 *    ratified Gantry/Bone material and it is what every struck slot of the shipped
 *    bank is already made of — re-offering it would make a candidate an A/B against
 *    itself. 1 · 2.41 · 4.17 is a different plate.
 *  - **Each partial is a grained body behind its own resonant corner**, not a bare
 *    sine. A pure partial is a test tone; a triangle with a third of its signal as
 *    pitched noise, sung through a Q at its own frequency, is a body that was hit.
 *    It is also *audible*: a narrow noise band passes so little of what enters it
 *    that a band-only plate arrives at a tenth of the level the bank works at.
 *  - **The edge is separate** — a short {@link band} an octave and a half up, gone
 *    in 30 ms. Two hard things touching, ahead of the note they produce.
 *
 * Partials above the fundamental decay faster and roll off, so the stack collapses
 * to its root and rings out rather than fading like a volume knob turning down.
 */
export function plate(
  name: string,
  freq: number,
  o: {
    readonly gain: number;
    readonly decay: number;
    readonly ratios?: readonly number[];
    readonly q?: number;
    readonly curve?: number;
    readonly punch?: number;
    /** Grain on the fundamental, 0..1. Rises on each partial above it. */
    readonly grain?: number;
    /** Scale the contact edge, 0 to drop it. Default 1. */
    readonly edge?: number;
    readonly at?: number;
    readonly seed: number;
  },
): SoundLayer[] {
  const ratios = o.ratios ?? [1, 2.41, 4.17];
  const grain = o.grain ?? 0.3;
  const edge = o.edge ?? 1;
  const layers: SoundLayer[] = [];

  if (edge > 0) {
    layers.push(
      band(`${name}.edge`, freq * 3.1, {
        gain: Math.min(1, o.gain * 0.55 * edge),
        decay: Math.min(0.03, o.decay * 0.5),
        q: 5,
        curve: 7,
        punch: 0.5,
        ...(o.at === undefined ? {} : { at: o.at }),
        seed: o.seed + 40,
      }),
    );
  }

  for (const [i, r] of ratios.entries()) {
    layers.push(
      place(
        {
          name: `${name}.p${i}`,
          wave: 'triangle',
          attack: 0.0008,
          hold: 0.0015,
          decay: o.decay * Math.pow(0.62, i),
          decayCurve: (o.curve ?? 5) + i,
          ...(i === 0 && o.punch !== undefined ? { punch: o.punch } : {}),
          freq: freq * r,
          noiseMix: Math.min(0.6, grain + i * 0.08),
          lowPass: freq * r * 1.25,
          resonance: (o.q ?? 7) + i * 1.5,
          gain: Math.min(1, o.gain / Math.pow(i + 1, 1.4)),
          seed: o.seed + i,
        },
        o.at,
      ),
    );
  }

  return layers;
}

/**
 * A body with the filter travelling across it.
 *
 * The gesture is energy arriving or leaving — a coil charging, a field failing, a
 * drive spinning up — and §5.4 separates it from a pitch chirp for exactly that
 * reason: the pitch may stand still while the corner moves, which is a machine, or
 * the pitch may slide, which is a cartoon.
 */
export function swept(
  name: string,
  o: {
    readonly wave: VoiceSpec['wave'];
    readonly freq: number;
    readonly freqEnd?: number;
    /** Cutoff at the start and at the end, Hz. */
    readonly from: number;
    readonly to?: number;
    readonly q: number;
    readonly gain: number;
    readonly attack: number;
    readonly hold: number;
    readonly decay: number;
    readonly curve?: number;
    readonly punch?: number;
    readonly noiseMix?: number;
    readonly hp?: number;
    readonly vib?: readonly [depth: number, rate: number];
    readonly at?: number;
    readonly seed: number;
  },
): SoundLayer {
  return place(
    {
      name,
      wave: o.wave,
      attack: o.attack,
      hold: o.hold,
      decay: o.decay,
      ...(o.curve === undefined ? {} : { decayCurve: o.curve }),
      ...(o.punch === undefined ? {} : { punch: o.punch }),
      freq: o.freq,
      ...(o.freqEnd === undefined ? {} : { freqEnd: o.freqEnd }),
      ...(o.vib === undefined ? {} : { vibratoDepth: o.vib[0], vibratoRate: o.vib[1] }),
      ...(o.noiseMix === undefined ? {} : { noiseMix: o.noiseMix }),
      lowPass: o.from,
      ...(o.to === undefined ? {} : { lowPassEnd: o.to }),
      resonance: o.q,
      ...(o.hp === undefined ? {} : { highPass: o.hp }),
      gain: o.gain,
      seed: o.seed,
    },
    o.at,
  );
}

/**
 * Granular excitation — one short grain retriggered every few milliseconds.
 *
 * A cutting head on stone, gravel under load, a servo stepping: many tiny contacts,
 * not one tone with a texture painted on it. `repeat` restarts the pitch envelope,
 * so the grain rate is audible as rate rather than as pitch, which is the
 * non-arcade use `docs/audio-revoice-spec.md` §5.3 explicitly leaves open. It never
 * carries a melody here and never repeats a musical interval.
 */
export function grains(
  name: string,
  o: {
    readonly freq: number;
    readonly freqEnd?: number;
    /** Seconds between grains. 0.002–0.008 is texture; above 0.02 is a rattle. */
    readonly grain: number;
    readonly gain: number;
    readonly attack?: number;
    readonly hold: number;
    readonly decay: number;
    readonly curve?: number;
    readonly from: number;
    readonly to?: number;
    readonly q?: number;
    readonly hp?: number;
    readonly punch?: number;
    readonly at?: number;
    readonly seed: number;
  },
): SoundLayer {
  return place(
    {
      name,
      wave: 'noise',
      attack: o.attack ?? 0.0008,
      hold: o.hold,
      decay: o.decay,
      decayCurve: o.curve ?? 4,
      ...(o.punch === undefined ? {} : { punch: o.punch }),
      freq: o.freq,
      ...(o.freqEnd === undefined ? {} : { freqEnd: o.freqEnd }),
      repeat: o.grain,
      lowPass: o.from,
      ...(o.to === undefined ? {} : { lowPassEnd: o.to }),
      resonance: o.q ?? 2.6,
      ...(o.hp === undefined ? {} : { highPass: o.hp }),
      gain: o.gain,
      seed: o.seed,
    },
    o.at,
  );
}

/**
 * Late, quiet, diffuse returns — the space the event happened in.
 *
 * Written as ordinary layers because `./synth` refuses to grow a reverb into the
 * voice model, and reserved for the handful of events big enough to have a room:
 * an explosion, a structure failing, a station dying. Each return is darker and
 * quieter than the one before it, which is what a real reflection does.
 */
export function returns(
  name: string,
  o: {
    readonly freq: number;
    readonly gain: number;
    readonly decay: number;
    readonly from: number;
    readonly to?: number;
    readonly at: number;
    /** Seconds between returns. */
    readonly gap?: number;
    readonly count?: number;
    readonly seed: number;
  },
): SoundLayer[] {
  const count = o.count ?? 2;
  const gap = o.gap ?? 0.13;
  return Array.from({ length: count }, (_, i) =>
    swept(`${name}.r${i}`, {
      wave: 'noise',
      freq: o.freq * Math.pow(0.72, i),
      from: o.from * Math.pow(0.6, i),
      ...(o.to === undefined ? {} : { to: o.to * Math.pow(0.6, i) }),
      q: 1.8,
      gain: o.gain * Math.pow(0.55, i),
      attack: 0.004 + i * 0.004,
      hold: 0.01,
      decay: o.decay * Math.pow(0.85, i),
      curve: 3 - i * 0.4,
      at: o.at + gap * i,
      seed: o.seed + i,
    }),
  );
}
