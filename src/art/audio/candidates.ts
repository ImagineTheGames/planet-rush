/**
 * src/art/audio/candidates.ts — sound-design candidates for review. OWNER: Sound Agent.
 *
 * The s2 brief: *"Sound design is pretty bad right now… generate them and I have a
 * page to hear them and approve or deny (3 options always for each sound)."* This
 * file is the source of truth for that page — three meaningfully-different candidate
 * voices for every slot in the bank ({@link SOUND}), each a synth param set in the
 * same {@link SoundSpec} shape the shipped bank uses. Art is code, so a candidate is
 * data you can diff and render, not a binary blob.
 *
 * ## It is NOT wired into the game
 *
 * Nothing in `./index` or the app imports this module, so it never enters the game
 * bundle — it is a review artifact, alongside the rendered .wav previews under
 * `sound-review/` (which `sound-review/render.ts` writes from this file, plus the
 * `sound-review/manifest.json` the portal reads). The SHIPPED sounds in `./bank`
 * stay untouched this brief; these candidates are parallel. A follow-up brief applies
 * the Director's approvals (arriving as `status/sound-choices.json`) back into the bank.
 *
 * ## The three characters
 *
 * For each slot the three candidates are distinct *characters* — e.g. for a weapon:
 * a sharp zap, a meaty thud, an airy pulse — not micro-variations of one idea, so the
 * review is a real choice. Where the tone contract constrains a slot (homes are the one
 * serious thing — {@link SOUND.coreHit}, {@link SOUND.stationDeath} — and the alarm must
 * be an unmistakable klaxon, GDD §2.2/§4.7), all three candidates honour it.
 *
 * Generated in bank order; see `sound-review/render.ts` for how previews are rendered.
 *
 * ## Review rounds
 *
 * A denied slot is regenerated *here*, in place — the file is the current offer, and
 * git carries the takes that were turned down. The rounds so far:
 *
 *  - **rockChip (s4-01).** All three denied, with one note: *"almost there, but they
 *    should be lower in tone."* Re-offered a transposition down — same three
 *    characters, same envelopes, pitch and filter corners moved.
 *  - **All 40 slots (a0-01b).** The developer pressed **DENY ALL** on every slot on
 *    the board, and the board promises *"generate 3 new options"* on that press. This
 *    file is that generation: `a`, `b`, `c` are new everywhere, in the amended §4.7
 *    register — clean, modern, futura sci-fi. The takes they replace are the ones
 *    printed on the board as `blunt dry tick, low` · `deep slow grinding rasp` ·
 *    `sharp metallic clang-ping` · `bright zippy sweep-hit`, and git carries them.
 *
 * ## What the round-2 candidates are made of, and why
 *
 * `a0-01`'s own post-mortem is the map, and it is not re-learnt here: the first
 * re-voice retired `square`, replaced it with bare sine partials on a linear decay,
 * and produced *"a glockenspiel… an arcade blip swapped for a toy xylophone. Not
 * less toony, differently toony."* **The instrument carries the register, not the
 * oscillator.** So every candidate below is built out of the round-2 instrument
 * (`./synth`: `decayCurve`, `resonance`, `lowPassEnd`, `bandPass`) through the five
 * builders under this comment, and a bare waveform with an envelope on it is not an
 * offer this file makes any more:
 *
 *  - {@link band} / {@link plate} — resonant **band-passed noise**: a partial of a
 *    struck body, made of material rather than of a tone. `plate` stacks two or three
 *    **inharmonic** bands, deliberately *not* the ratified `GLASS_PARTIALS` spacing —
 *    an offer that reuses the incumbent's material is the incumbent with a filter on
 *    it, which the brief names as a fake choice.
 *  - {@link swept} — a body with the **filter moving across it**: a coil dumping
 *    charge, a bubble failing, a drive spinning up. §5.4 is explicit that a filter
 *    sweep is a different gesture from a pitch chirp, and it is the one this register
 *    is built on.
 *  - {@link grains} — **granular** excitation: one short grain retriggered every few
 *    milliseconds, so the texture is many tiny contacts rather than one tone. This is
 *    `repeat` used as a rattle, the non-arcade use `docs/audio-revoice-spec.md` §5.3
 *    keeps open with a written reason; it is never a trill and never carries pitch.
 *  - {@link returns} — **space**, written as ordinary late layers rather than as a
 *    reverb in the voice model (`./synth`'s own rule). Reserved for the big events;
 *    a tail on a 28 ms interface tick only smears the mix on a phone speaker.
 *
 * ## The three characters, per family
 *
 * The brief's bar is that the three options differ **from each other and from the
 * incumbent** in the thing that carries the register — the excitation, the body, the
 * tail — rather than in pitch. So each family gets its own three metaphors, and they
 * are not the same three metaphors twice:
 *
 * | family | a | b | c |
 * |---|---|---|---|
 * | mine | abrasive cutting head — grains, dry, no tone | pressure and mass — low swept body, sub weight | induction — band-passed metal that rings |
 * | fight | coil discharge — charge into a snap | mass driver — pneumatic weight and air | particle shear — thin ionised band, room behind it |
 * | station | magnetic clamp — dull thunk, servo settle | hydraulic seat — pressure released into a seat | telemetry — narrow filtered bands, machine-fast |
 * | ship | drive spinning up | reaction mass — thrust and pressure | field collapse — a resonance closing |
 * | clock | struck steel | pressure horn | swept siren band |
 * | music | filtered analogue | granular texture bed | wide detuned space |
 */

import type { SoundLayer, SoundName, SoundSpec } from './bank';
import type { VoiceSpec } from './synth';

// ---------------------------------------------------------------------------
// The candidate instrument. Five builders, all of them made of the round-2 synth
// (`./synth`) rather than of a bare oscillator, so no candidate in this file can
// be round 1 under a new name. Everything that carries character — the corner, the
// Q, the grain rate, the tail — is a number at the call site, not a default here.
// ---------------------------------------------------------------------------

/** `exactOptionalPropertyTypes`: an absent `at` is not `at: undefined`. */
function place(spec: VoiceSpec, at?: number): SoundLayer {
  return at === undefined ? { spec } : { spec, at };
}

/**
 * One resonant band of noise — a single partial of a struck body.
 *
 * `bandPass` over `noise` is the transient this register runs on: narrow, pitched,
 * and made entirely of the material that went into it. The alternative — the attack
 * segment of a tone standing in for a strike — is what round 1 shipped.
 */
function band(
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
function plate(
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
function swept(
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
function grains(
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
function returns(
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

/** One candidate voice for a slot: an id, a short character label, and the spec itself. */
export interface SoundCandidate {
  /** Stable id within the slot — always 'a' | 'b' | 'c'. */
  readonly id: string;
  /** 3-5 word description of the character, for the review page. */
  readonly character: string;
  /** The synth param set — the same shape as a shipped bank entry. */
  readonly spec: SoundSpec;
}

/** One reviewable slot: a shipped sound, and three candidate replacements. */
export interface CandidateSlot {
  /** Short human label. */
  readonly label: string;
  /** One line: when the player hears this sound. */
  readonly context: string;
  /** The shipped {@link SoundName} this slot proposes alternatives for (its "current"). */
  readonly current: SoundName;
  /** Exactly three candidates, ids 'a' | 'b' | 'c'. */
  readonly candidates: readonly SoundCandidate[];
}

/** The slots, in bank order — the order the review page walks. */
export const CANDIDATE_SLOT_ORDER: readonly string[] = [
  'rockChip',
  'hullHit',
  'rockCrack',
  'rockBurst',
  'oreCollect',
  'holdFull',
  'turretFire',
  'shotImpact',
  'shieldHit',
  'shieldDown',
  'coreHit',
  'turretDown',
  'shipExplode',
  'shipSpawn',
  'spawnPulse',
  'thruster',
  'buildPlaced',
  'buildComplete',
  'repairTick',
  'bankOre',
  'upgradeBought',
  'waveArrive',
  'collapseBegin',
  'stationDeath',
  'matchEnd',
  'alarm',
  'ambient',
  'musicBed',
  'musicPulse',
  'musicTheme',
  'musicDread',
  'musicWin',
  'musicLoss',
  'pressTick',
  'purchaseConfirm',
  'rejectBuzz',
  'depositTick',
  'respawnBeep',
  'respawnGo',
  'minimapPing',
];

/** Every reviewable slot, keyed by id (each id is also its shipped {@link SoundName}). */
export const CANDIDATE_SLOTS: Readonly<Record<string, CandidateSlot>> = {
  // === MINE (a0-01b) ========================================================
  //
  // Three tools, not three settings on one tool. Across the whole family:
  //
  //   a  an abrasive **cutting head** — granular excitation, dry, no tone in it
  //   b  **pressure and mass** — a low body under a closing filter, sub weight
  //   c  **induction** — band-passed metal, the only one of the three with a ring
  //
  // The s4-01 direction on `rockChip` — *"almost there, but they should be lower
  // in tone"* — is ratified developer feedback and survives this reset even though
  // the takes it was given about do not: all three offers still sit under the
  // ceiling `./candidates.test.ts` guards, and still spread far enough apart to be
  // a choice rather than three takes on one idea.
  //
  // Why none of them go boomy at rate: `rockChip` fires at ~28 Hz, so what matters
  // is not the corner but the envelope. Every offer here decays inside 60 ms with a
  // curve of 5 or more — a real tail that is *gone* before the next tick, where the
  // linear ramps of the denied set were still at half level when it arrived.
  rockChip: {
    label: "Rock Chip",
    context: "Per-tick mining laser hit while chipping a rock — fires rapidly, must read as a stream",
    current: 'rockChip',
    candidates: [
      {
        id: 'a',
        character: "abrasive cutting head, dry grit",
        spec: {
          name: 'rockChip_a_cuttingHead',
          layers: [
            grains('rockChip_a.grit', { freq: 68, grain: 0.0035, gain: 0.4, hold: 0.004, decay: 0.05, curve: 6, punch: 0.55, from: 520, to: 300, q: 3.4, hp: 90, seed: 30100 }),
            band('rockChip_a.edge', 300, { gain: 0.18, decay: 0.026, q: 4.5, curve: 7, seed: 30103 }),
          ],
        },
      },
      {
        id: 'b',
        character: "blunt pressure bite, sub weight",
        spec: {
          name: 'rockChip_b_pressureBite',
          layers: [
            swept('rockChip_b.mass', { wave: 'sine', freq: 58, from: 240, to: 120, q: 2.4, gain: 0.5, attack: 0.0008, hold: 0.007, decay: 0.055, curve: 5.5, punch: 0.9, noiseMix: 0.35, seed: 30110 }),
            grains('rockChip_b.crush', { freq: 44, grain: 0.006, gain: 0.16, hold: 0.004, decay: 0.03, curve: 6, from: 340, q: 2, hp: 40, seed: 30112 }),
          ],
        },
      },
      {
        id: 'c',
        character: "induction tick, short metal ring",
        spec: {
          name: 'rockChip_c_induction',
          layers: [
            ...plate('rockChip_c.ring', 250, { gain: 0.4, decay: 0.055, ratios: [1, 2.41], q: 8, curve: 5, punch: 0.5, seed: 30120 }),
            swept('rockChip_c.floor',
              { wave: 'noise', freq: 90, from: 300, to: 160, q: 2.2, gain: 0.2, attack: 0.0006, hold: 0.004, decay: 0.03, curve: 6, seed: 30124 }),
          ],
        },
      },
    ],
  },
  // === FIGHT (a0-01b) =======================================================
  //
  // §4.7's own worked line for this family is *"a pressure failure: a hard
  // concussive front, a metallic shear, debris settling. No sparkle"* — so none of
  // the twenty-one offers below has a sparkle layer in it, and the three that a
  // slot does offer are three different machines rather than three levels of one:
  //
  //   a  a **coil discharge** — a corner opening under charge, then a hard snap
  //   b  a **mass driver** — pneumatic weight, air released, a low body moving
  //   c  a **particle shear** — a thin ionised band with the room behind it
  //
  // The pair §8 guards hardest runs through here: `rockChip` / `hullHit` is *am I
  // mining or shooting a ship*, the game's central inversion. Every `hullHit` offer
  // keeps a hard transient above 1.4 kHz for that reason, including the heavy one.
  hullHit: {
    label: "Hull Hit",
    context: "A weapon shot bites an enemy ship/turret/shield/core.",
    current: 'hullHit',
    candidates: [
      {
        id: 'a',
        character: "coil bite on plate, hard and dry",
        spec: {
          name: 'hullHit_a_coilBite',
          layers: [
            ...plate('hullHit_a.plate', 1450, { gain: 0.42, decay: 0.06, ratios: [1, 2.41], q: 8, curve: 6, punch: 0.7, grain: 0.34, seed: 30300 }),
            swept('hullHit_a.coil', { wave: 'noise', freq: 900, from: 1200, to: 3600, q: 7, gain: 0.34, attack: 0.0006, hold: 0.003, decay: 0.035, curve: 7, hp: 600, seed: 30304 }),
          ],
        },
      },
      {
        id: 'b',
        character: "mass driver round, weight behind it",
        spec: {
          name: 'hullHit_b_massDriver',
          layers: [
            swept('hullHit_b.body', { wave: 'triangle', freq: 190, freqEnd: 160, from: 2600, to: 420, q: 3.4, gain: 0.44, attack: 0.0008, hold: 0.01, decay: 0.1, curve: 5, punch: 0.8, noiseMix: 0.3, seed: 30310 }),
            band('hullHit_b.strike', 1700, { gain: 0.4, decay: 0.03, q: 5, curve: 7, punch: 0.6, seed: 30312 }),
            swept('hullHit_b.air', { wave: 'noise', freq: 420, from: 1800, to: 700, q: 2.2, gain: 0.2, attack: 0.002, hold: 0.008, decay: 0.07, curve: 4, hp: 220, at: 0.008, seed: 30313 }),
          ],
        },
      },
      {
        id: 'c',
        character: "particle shear, thin and ionised",
        spec: {
          name: 'hullHit_c_particleShear',
          layers: [
            swept('hullHit_c.shear', { wave: 'noise', freq: 2600, from: 5200, to: 1800, q: 7, gain: 0.75, attack: 0.0006, hold: 0.005, decay: 0.06, curve: 6, hp: 1400, seed: 30320 }),
            band('hullHit_c.skin', 3200, { gain: 0.5, decay: 0.035, q: 9, curve: 7, punch: 0.5, seed: 30322 }),
            swept('hullHit_c.floor', { wave: 'noise', freq: 300, from: 700, to: 300, q: 2, gain: 0.14, attack: 0.001, hold: 0.004, decay: 0.05, curve: 5, seed: 30323 }),
          ],
        },
      },
    ],
  },
  rockCrack: {
    label: "Rock Crack Stage",
    context: "A rock advances one of its three crack stages",
    current: 'rockCrack',
    candidates: [
      {
        id: 'a',
        character: "fracture step, splintering grains",
        spec: {
          name: 'rockCrack_a_fractureStep',
          layers: [
            band('rockCrack_a.step', 420, { gain: 0.4, decay: 0.05, q: 5, curve: 6, punch: 0.7, seed: 30130 }),
            grains('rockCrack_a.splinter', { freq: 190, grain: 0.009, gain: 0.24, hold: 0.012, decay: 0.11, curve: 4, from: 1500, to: 500, q: 3, hp: 140, at: 0.012, seed: 30131 }),
          ],
        },
      },
      {
        id: 'b',
        character: "deep stone shear, pressure released",
        spec: {
          name: 'rockCrack_b_shear',
          layers: [
            swept('rockCrack_b.shear', { wave: 'noise', freq: 150, from: 1100, to: 190, q: 3, gain: 0.44, attack: 0.0015, hold: 0.012, decay: 0.14, curve: 3.4, punch: 0.5, seed: 30140 }),
            swept('rockCrack_b.sub', { wave: 'sine', freq: 70, freqEnd: 52, from: 180, q: 1.8, gain: 0.26, attack: 0.002, hold: 0.01, decay: 0.12, curve: 3, seed: 30142 }),
          ],
        },
      },
      {
        id: 'c',
        character: "crystalline shear, ringing shards",
        spec: {
          name: 'rockCrack_c_crystal',
          layers: [
            ...plate('rockCrack_c.shard', 640, { gain: 0.34, decay: 0.13, ratios: [1, 2.41, 4.17], q: 9, curve: 5, punch: 0.5, seed: 30150 }),
            grains('rockCrack_c.dust', { freq: 260, grain: 0.011, gain: 0.12, hold: 0.008, decay: 0.09, curve: 4.5, from: 2200, to: 900, q: 2.4, hp: 300, at: 0.02, seed: 30154 }),
          ],
        },
      },
    ],
  },
  // The ore payout is the mechanic in this slot, so all three keep one element
  // that RISES — §2.3's "signal yellow means ore" — but each pays it out in its
  // own material: a rattles it out of the debris, b lifts it on the pressure
  // wave, c rings it off the shards.
  rockBurst: {
    label: "Rock Burst + Ore Payout",
    context: "A rock breaks apart entirely and pays out ore",
    current: 'rockBurst',
    candidates: [
      {
        id: 'a',
        character: "shell fracture, debris rattle, ore lifting out",
        spec: {
          name: 'rockBurst_a_debrisRattle',
          layers: [
            band('rockBurst_a.fracture', 380, { gain: 0.4, decay: 0.09, q: 4.5, curve: 5, punch: 0.8, seed: 30160 }),
            grains('rockBurst_a.debris', { freq: 210, freqEnd: 120, grain: 0.026, gain: 0.3, hold: 0.05, decay: 0.34, curve: 3.2, from: 1800, to: 420, q: 2.8, hp: 90, at: 0.015, seed: 30161 }),
            ...plate('rockBurst_a.ore0', 880, { gain: 0.2, decay: 0.11, ratios: [1, 2.41], q: 9, curve: 5, edge: 0.4, at: 0.11, seed: 30163 }),
            ...plate('rockBurst_a.ore1', 1320, { gain: 0.17, decay: 0.14, ratios: [1, 2.41], q: 10, curve: 5, edge: 0.4, at: 0.17, seed: 30166 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure burst, dust settling, ore on the wave",
        spec: {
          name: 'rockBurst_b_pressureBurst',
          layers: [
            swept('rockBurst_b.burst', { wave: 'noise', freq: 320, freqEnd: 70, from: 2400, to: 260, q: 2.6, gain: 0.32, attack: 0.0015, hold: 0.03, decay: 0.42, curve: 2.8, punch: 0.85, seed: 30170 }),
            swept('rockBurst_b.sub', { wave: 'sine', freq: 62, freqEnd: 44, from: 160, q: 1.6, gain: 0.18, attack: 0.004, hold: 0.02, decay: 0.3, curve: 2.4, seed: 30172 }),
            swept('rockBurst_b.ore', { wave: 'noise', freq: 620, from: 700, to: 2600, q: 7, gain: 0.24, attack: 0.006, hold: 0.02, decay: 0.2, curve: 3.4, hp: 400, at: 0.09, seed: 30173 }),
            ...returns('rockBurst_b.dust', { freq: 260, gain: 0.1, decay: 0.26, from: 900, to: 300, at: 0.16, gap: 0.15, count: 2, seed: 30175 }),
          ],
        },
      },
      {
        id: 'c',
        character: "shattered plate, shards ringing out",
        spec: {
          name: 'rockBurst_c_shatteredPlate',
          layers: [
            ...plate('rockBurst_c.shatter', 300, { gain: 0.42, decay: 0.3, ratios: [1, 2.41, 4.17], q: 6, curve: 4, punch: 0.7, seed: 30180 }),
            ...plate('rockBurst_c.ore', 990, { gain: 0.2, decay: 0.2, ratios: [1, 2.05], q: 10, curve: 5, edge: 0.5, at: 0.12, seed: 30184 }),
            ...returns('rockBurst_c.room', { freq: 340, gain: 0.08, decay: 0.22, from: 1200, to: 420, at: 0.2, gap: 0.14, count: 2, seed: 30187 }),
          ],
        },
      },
    ],
  },
  // The tightest pair in the bank is `oreCollect` / `depositTick` (§8) — *picked a
  // chunk up* vs *banked a chunk*. Every offer here is kept in the 900–2000 Hz
  // region and every `depositTick` offer under 700 Hz and under half its level, so
  // the pair stays separable whichever letters the developer picks, including a
  // mixed pair.
  oreCollect: {
    label: "Ore Collect",
    context: "A loose ore chunk is tractored in",
    current: 'oreCollect',
    candidates: [
      {
        id: 'a',
        character: "magnetic capture, one hard snap",
        spec: {
          name: 'oreCollect_a_magneticSnap',
          layers: [
            ...plate('oreCollect_a.snap', 1500, { gain: 0.4, decay: 0.05, ratios: [1, 2.41], q: 8, curve: 6, punch: 0.6, grain: 0.34, seed: 30190 }),
            swept('oreCollect_a.pull', { wave: 'noise', freq: 300, from: 900, to: 380, q: 2.4, gain: 0.18, attack: 0.0008, hold: 0.004, decay: 0.045, curve: 5, seed: 30193 }),
          ],
        },
      },
      {
        id: 'b',
        character: "servo intake, filter opening",
        spec: {
          name: 'oreCollect_b_servoIntake',
          layers: [
            swept('oreCollect_b.intake', { wave: 'triangle', freq: 460, from: 380, to: 2600, q: 5.5, gain: 0.34, attack: 0.003, hold: 0.012, decay: 0.075, curve: 3.4, noiseMix: 0.22, seed: 30195 }),
            grains('oreCollect_b.step', { freq: 900, grain: 0.004, gain: 0.14, hold: 0.004, decay: 0.03, curve: 6, from: 2600, q: 3, hp: 500, seed: 30196 }),
          ],
        },
      },
      {
        id: 'c',
        character: "telemetry blip, two narrow bands",
        spec: {
          name: 'oreCollect_c_telemetry',
          layers: [
            ...plate('oreCollect_c.blip', 2200, { gain: 0.3, decay: 0.055, ratios: [1, 2.05], q: 12, curve: 6, punch: 0.4, grain: 0.08, edge: 0, seed: 30200 }),
          ],
        },
      },
    ],
  },
  // The two-note insistence is the tell — that is what says *stop mining, fly
  // home* rather than *you picked something up* — so all three keep two events
  // and keep the interval. What changes is what is making them: a is struck
  // steel with a mass under it, b is two pressure horns, c is a thin band swept
  // upward twice, which is the only one of the three with no strike in it at all.
  holdFull: {
    label: "Cargo Hold Full",
    context: "Cargo hold reaches capacity — signals 'fly home'",
    current: 'holdFull',
    candidates: [
      {
        id: 'a',
        character: "two clamps closing, rising",
        spec: {
          name: 'holdFull_a_clamps',
          layers: [
            ...plate('holdFull_a.one', 700, { gain: 0.34, decay: 0.1, ratios: [1, 2.41], q: 7, curve: 5, punch: 0.5, seed: 30210 }),
            swept('holdFull_a.oneMass', { wave: 'sine', freq: 120, from: 300, to: 170, q: 2.2, gain: 0.3, attack: 0.001, hold: 0.008, decay: 0.09, curve: 4.5, noiseMix: 0.12, seed: 30213 }),
            ...plate('holdFull_a.two', 1050, { gain: 0.34, decay: 0.16, ratios: [1, 2.41], q: 8, curve: 5, punch: 0.5, at: 0.13, seed: 30215 }),
            swept('holdFull_a.twoMass', { wave: 'sine', freq: 150, from: 340, to: 190, q: 2.2, gain: 0.3, attack: 0.001, hold: 0.008, decay: 0.11, curve: 4.5, noiseMix: 0.12, at: 0.13, seed: 30218 }),
          ],
        },
      },
      {
        id: 'b',
        character: "twin pressure horns, insistent",
        spec: {
          name: 'holdFull_b_pressureHorns',
          layers: [
            swept('holdFull_b.one', { wave: 'triangle', freq: 350, from: 500, to: 1400, q: 4.5, gain: 0.36, attack: 0.006, hold: 0.05, decay: 0.09, curve: 3, noiseMix: 0.16, seed: 30220 }),
            swept('holdFull_b.two', { wave: 'triangle', freq: 525, from: 700, to: 1800, q: 4.5, gain: 0.36, attack: 0.006, hold: 0.05, decay: 0.14, curve: 3, noiseMix: 0.16, at: 0.15, seed: 30221 }),
          ],
        },
      },
      {
        id: 'c',
        character: "thin band swept up, twice, no strike",
        spec: {
          name: 'holdFull_c_sweptBand',
          layers: [
            swept('holdFull_c.one', { wave: 'noise', freq: 1500, from: 900, to: 3400, q: 8, gain: 0.9, attack: 0.005, hold: 0.02, decay: 0.08, curve: 3.4, hp: 700, seed: 30230 }),
            swept('holdFull_c.two', { wave: 'noise', freq: 1800, from: 1100, to: 4200, q: 8, gain: 0.9, attack: 0.005, hold: 0.02, decay: 0.12, curve: 3.4, hp: 800, at: 0.12, seed: 30232 }),
          ],
        },
      },
    ],
  },
  // The single most arcade voice in the denied bank was a duty-swept square with a
  // four-to-one downward sweep — a 1980s laser. None of these three slides in
  // pitch at all: what moves in every one of them is the filter, which is a
  // machine losing or gaining energy rather than a cartoon falling over (§5.4).
  turretFire: {
    label: "Turret Fire",
    context: "Your turret or ship fires a shot.",
    current: 'turretFire',
    candidates: [
      {
        id: 'a',
        character: "coil discharge, corner snapping open",
        spec: {
          name: 'turretFire_a_coilDischarge',
          layers: [
            swept('turretFire_a.charge', { wave: 'noise', freq: 700, from: 400, to: 4200, q: 8, gain: 0.85, attack: 0.004, hold: 0.004, decay: 0.045, curve: 6, hp: 300, seed: 30330 }),
            swept('turretFire_a.body', { wave: 'triangle', freq: 145, from: 2200, to: 380, q: 4.5, gain: 0.4, attack: 0.0008, hold: 0.006, decay: 0.075, curve: 5.5, punch: 0.7, noiseMix: 0.28, seed: 30332 }),
          ],
        },
      },
      {
        id: 'b',
        character: "gas-driven slug, breech and air",
        spec: {
          name: 'turretFire_b_gasSlug',
          layers: [
            swept('turretFire_b.breech', { wave: 'sine', freq: 74, from: 240, to: 110, q: 2.4, gain: 0.42, attack: 0.001, hold: 0.012, decay: 0.1, curve: 4.5, punch: 0.8, noiseMix: 0.16, seed: 30340 }),
            grains('turretFire_b.gas', { freq: 820, freqEnd: 560, grain: 0.003, gain: 0.5, hold: 0.008, decay: 0.09, curve: 4, from: 3800, to: 1300, q: 3, hp: 620, at: 0.004, seed: 30342 }),
          ],
        },
      },
      {
        id: 'c',
        character: "particle lance, thin band and hiss",
        spec: {
          name: 'turretFire_c_particleLance',
          layers: [
            band('turretFire_c.lance', 2400, { gain: 0.55, decay: 0.05, q: 9, curve: 6, punch: 0.6, seed: 30350 }),
            swept('turretFire_c.hiss', { wave: 'noise', freq: 1800, from: 4200, to: 1200, q: 3.6, gain: 0.6, attack: 0.001, hold: 0.006, decay: 0.07, curve: 5, hp: 900, seed: 30351 }),
            swept('turretFire_c.kick', { wave: 'sine', freq: 120, from: 260, q: 2, gain: 0.2, attack: 0.001, hold: 0.004, decay: 0.05, curve: 5, seed: 30352 }),
          ],
        },
      },
    ],
  },
  shotImpact: {
    label: "Shot Impact",
    context: "A turret/ship projectile lands.",
    current: 'shotImpact',
    candidates: [
      {
        id: 'a',
        character: "hard contact tick, no body",
        spec: {
          name: 'shotImpact_a_contactTick',
          layers: [
            ...plate('shotImpact_a.tick', 1900, { gain: 0.4, decay: 0.028, ratios: [1, 2.41], q: 7, curve: 7, punch: 0.7, grain: 0.4, seed: 30360 }),
            band('shotImpact_a.edge', 4400, { gain: 0.4, decay: 0.018, q: 8, curve: 8, seed: 30364 }),
          ],
        },
      },
      {
        id: 'b',
        character: "dull thump into structure",
        spec: {
          name: 'shotImpact_b_structureThump',
          layers: [
            swept('shotImpact_b.thump', { wave: 'sine', freq: 130, freqEnd: 105, from: 480, to: 210, q: 2.6, gain: 0.44, attack: 0.0008, hold: 0.008, decay: 0.07, curve: 5.5, punch: 0.7, noiseMix: 0.2, seed: 30365 }),
            band('shotImpact_b.contact', 1500, { gain: 0.3, decay: 0.02, q: 5, curve: 8, seed: 30366 }),
          ],
        },
      },
      {
        id: 'c',
        character: "spray of grit off the hull",
        spec: {
          name: 'shotImpact_c_gritSpray',
          layers: [
            grains('shotImpact_c.spray', { freq: 2600, freqEnd: 1900, grain: 0.002, gain: 0.55, hold: 0.004, decay: 0.055, curve: 5, punch: 0.5, from: 7400, to: 3200, q: 3, hp: 2200, seed: 30370 }),
          ],
        },
      },
    ],
  },
  // §8's most important pair mechanically is `shieldHit` / `coreHit` — §2.2's
  // grammar is *shields redden and die before the reactor begins to fill*, and a
  // besieged player has to hear which layer is being eaten. So every shield offer
  // here rings and every core offer below is dull, low and closing: the two slots
  // are separated by material, not just by pitch, in all nine combinations.
  shieldHit: {
    label: "Shield Hit",
    context: "A shield absorbs a hit — struck bell, not broken.",
    current: 'shieldHit',
    candidates: [
      {
        id: 'a',
        character: "field skin ringing, tight",
        spec: {
          name: 'shieldHit_a_fieldSkin',
          layers: [
            ...plate('shieldHit_a.skin', 1550, { gain: 0.36, decay: 0.26, ratios: [1, 2.41, 4.17], q: 9, curve: 4, punch: 0.4, grain: 0.22, seed: 30380 }),
          ],
        },
      },
      {
        id: 'b',
        character: "absorbed pressure, elastic give",
        spec: {
          name: 'shieldHit_b_elasticGive',
          layers: [
            swept('shieldHit_b.give', { wave: 'triangle', freq: 520, freqEnd: 470, from: 900, to: 2600, q: 6, gain: 0.4, attack: 0.003, hold: 0.02, decay: 0.2, curve: 3.2, noiseMix: 0.18, vib: [0.012, 11], seed: 30390 }),
            swept('shieldHit_b.load', { wave: 'sine', freq: 175, from: 400, to: 220, q: 2.4, gain: 0.24, attack: 0.002, hold: 0.01, decay: 0.12, curve: 4, seed: 30392 }),
          ],
        },
      },
      {
        id: 'c',
        character: "static discharge across the bubble",
        spec: {
          name: 'shieldHit_c_staticDischarge',
          layers: [
            grains('shieldHit_c.static', { freq: 1700, freqEnd: 1500, grain: 0.0045, gain: 0.55, hold: 0.012, decay: 0.2, curve: 4, from: 3600, to: 1600, q: 4, hp: 800, seed: 30400 }),
            band('shieldHit_c.ring', 2300, { gain: 0.34, decay: 0.16, q: 11, curve: 4.5, seed: 30402 }),
          ],
        },
      },
    ],
  },
  // The ×6.9 fall stays in all three — a bubble failing IS a collapse, and §5.4
  // exempts it by construction. What differs is what is falling.
  shieldDown: {
    label: "Shield Down",
    context: "A shield's bubble fails and falls.",
    current: 'shieldDown',
    candidates: [
      {
        id: 'a',
        character: "field collapsing, resonance closing",
        spec: {
          name: 'shieldDown_a_fieldCollapse',
          layers: [
            swept('shieldDown_a.fall', { wave: 'triangle', freq: 1450, freqEnd: 210, from: 4800, to: 900, q: 10, gain: 0.44, attack: 0.003, hold: 0.02, decay: 0.44, curve: 2.6, noiseMix: 0.12, hp: 300, seed: 30410 }),
            band('shieldDown_a.snap', 2600, { gain: 0.45, decay: 0.05, q: 7, curve: 6, punch: 0.5, seed: 30412 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure loss, air dumping out",
        spec: {
          name: 'shieldDown_b_pressureLoss',
          layers: [
            swept('shieldDown_b.dump', { wave: 'noise', freq: 700, freqEnd: 110, from: 2600, to: 220, q: 2.4, gain: 0.44, attack: 0.002, hold: 0.04, decay: 0.42, curve: 2.4, punch: 0.5, seed: 30420 }),
            swept('shieldDown_b.sub', { wave: 'sine', freq: 90, freqEnd: 52, from: 200, q: 1.8, gain: 0.26, attack: 0.006, hold: 0.03, decay: 0.3, curve: 2.2, at: 0.05, seed: 30422 }),
          ],
        },
      },
      {
        id: 'c',
        character: "ionised skin tearing, room behind it",
        spec: {
          name: 'shieldDown_c_skinTear',
          layers: [
            grains('shieldDown_c.tear', { freq: 1500, freqEnd: 260, grain: 0.006, gain: 0.5, hold: 0.03, decay: 0.34, curve: 3, from: 4200, to: 600, q: 3.4, hp: 400, seed: 30430 }),
            ...returns('shieldDown_c.room', { freq: 500, gain: 0.16, decay: 0.26, from: 1600, to: 500, at: 0.12, gap: 0.13, count: 2, seed: 30433 }),
          ],
        },
      },
    ],
  },
  // One of the two sounds homes get, and the ache depends on it (§7.2): SERIOUS,
  // low, dropping, no sparkle anywhere near it. All three are dull by
  // construction — nothing above 1 kHz survives more than 40 ms in any of them —
  // and all three keep clear of `rejectBuzz`, the §8 pair that reads as *your buy
  // was refused* against *your reactor is being eaten*.
  coreHit: {
    label: "Core Hit",
    context: "A home core takes damage. SERIOUS — low, drops, no sparkle.",
    current: 'coreHit',
    candidates: [
      {
        id: 'a',
        character: "reactor slug, deep and closing",
        spec: {
          name: 'coreHit_a_reactorSlug',
          layers: [
            swept('coreHit_a.slug', { wave: 'sine', freq: 112, freqEnd: 44, from: 300, to: 96, q: 2.6, gain: 0.5, attack: 0.002, hold: 0.024, decay: 0.3, curve: 2.6, punch: 0.7, noiseMix: 0.1, seed: 30440 }),
            swept('coreHit_a.tear', { wave: 'noise', freq: 230, freqEnd: 100, from: 700, to: 200, q: 2.4, gain: 0.2, attack: 0.001, hold: 0.01, decay: 0.16, curve: 4, seed: 30442 }),
          ],
        },
      },
      {
        id: 'b',
        character: "structural groan under the hit",
        spec: {
          name: 'coreHit_b_structuralGroan',
          layers: [
            swept('coreHit_b.hit', { wave: 'triangle', freq: 108, freqEnd: 74, from: 600, to: 200, q: 3.4, gain: 0.44, attack: 0.002, hold: 0.02, decay: 0.26, curve: 3, punch: 0.6, noiseMix: 0.22, seed: 30450 }),
            swept('coreHit_b.groan', { wave: 'triangle', freq: 168, freqEnd: 140, from: 620, to: 330, q: 6, gain: 0.32, attack: 0.02, hold: 0.06, decay: 0.34, curve: 2.2, noiseMix: 0.2, vib: [0.02, 5], at: 0.05, seed: 30452 }),
          ],
        },
      },
      {
        id: 'c',
        character: "distant concussion, room answering",
        spec: {
          name: 'coreHit_c_distantConcussion',
          layers: [
            swept('coreHit_c.front', { wave: 'noise', freq: 190, freqEnd: 62, from: 900, to: 180, q: 2.2, gain: 0.42, attack: 0.004, hold: 0.03, decay: 0.28, curve: 2.6, punch: 0.5, seed: 30460 }),
            swept('coreHit_c.sub', { wave: 'sine', freq: 62, freqEnd: 46, from: 160, q: 1.8, gain: 0.28, attack: 0.006, hold: 0.02, decay: 0.24, curve: 2.4, seed: 30462 }),
            ...returns('coreHit_c.room', { freq: 220, gain: 0.14, decay: 0.22, from: 600, to: 220, at: 0.1, gap: 0.12, count: 2, seed: 30464 }),
          ],
        },
      },
    ],
  },
  turretDown: {
    label: "Turret Destroyed",
    context: "A turret is destroyed.",
    current: 'turretDown',
    candidates: [
      {
        id: 'a',
        character: "mount shearing, metal letting go",
        spec: {
          name: 'turretDown_a_mountShear',
          layers: [
            swept('turretDown_a.shear', { wave: 'noise', freq: 420, freqEnd: 130, from: 3000, to: 420, q: 3.4, gain: 0.34, attack: 0.001, hold: 0.02, decay: 0.28, curve: 3.4, punch: 0.7, seed: 30470 }),
            ...plate('turretDown_a.mount', 640, { gain: 0.3, decay: 0.22, ratios: [1, 2.41], q: 7, curve: 4.5, at: 0.05, seed: 30472 }),
          ],
        },
      },
      {
        id: 'b',
        character: "collapse onto the deck, weight down",
        spec: {
          name: 'turretDown_b_deckCollapse',
          layers: [
            swept('turretDown_b.fall', { wave: 'noise', freq: 260, freqEnd: 70, from: 1600, to: 260, q: 2.6, gain: 0.42, attack: 0.002, hold: 0.03, decay: 0.34, curve: 2.8, punch: 0.6, seed: 30480 }),
            swept('turretDown_b.deck', { wave: 'sine', freq: 74, from: 200, to: 120, q: 2, gain: 0.3, attack: 0.002, hold: 0.02, decay: 0.26, curve: 3, at: 0.08, seed: 30482 }),
            grains('turretDown_b.debris', { freq: 300, freqEnd: 190, grain: 0.03, gain: 0.22, hold: 0.04, decay: 0.24, curve: 3.4, from: 1400, to: 420, q: 2.6, hp: 160, at: 0.1, seed: 30483 }),
          ],
        },
      },
      {
        id: 'c',
        character: "power cell venting, then quiet",
        spec: {
          name: 'turretDown_c_cellVent',
          layers: [
            band('turretDown_c.rupture', 1400, { gain: 0.44, decay: 0.05, q: 6, curve: 6, punch: 0.7, seed: 30490 }),
            grains('turretDown_c.vent', { freq: 900, freqEnd: 380, grain: 0.0035, gain: 0.55, hold: 0.05, decay: 0.3, curve: 3, from: 3400, to: 700, q: 3.6, hp: 500, at: 0.01, seed: 30491 }),
            ...returns('turretDown_c.room', { freq: 380, gain: 0.12, decay: 0.2, from: 1200, to: 400, at: 0.16, gap: 0.12, count: 2, seed: 30493 }),
          ],
        },
      },
    ],
  },
  // === SHIP (a0-01b) ========================================================
  //
  // A hull is a machine with a drive in it, and these four slots are that machine
  // arriving, holding, and coming apart. The three offers are three propulsion
  // technologies rather than three sizes of one bang:
  //
  //   a  a **plasma drive** — granular, particulate, the sound of matter being
  //      thrown; dry, no ring anywhere in it
  //   b  **reaction mass** — pneumatic weight, a low body under a closing filter
  //   c  a **containment field** — a narrow resonant band that forms or fails,
  //      the only one of the three with metal in it, and the only one with a room
  //
  // `shipExplode`'s `context` used to read *"firework: bang then sparkle"* — a
  // direct quote of the retired §4.7 paragraph, printed on the board next to the
  // play button. §7.2 of `docs/audio-revoice-spec.md` retires that layer by name
  // (*"explosions are fireworks implemented — delete it"*), so the line goes too:
  // a description the offers deliberately contradict is worse than no description.
  //
  // §8 guards `respawnBeep` / `spawnPulse` — the countdown against the protection
  // tick — at ×1.20 of centroid, the second-tightest pair in the bank. They are
  // deliberately given different metaphors here and in the interface family: this
  // one is a **field** (soft, particulate, low), that one is a **clock** (hard,
  // narrow, high). Measured at the bottom of the family, not assumed.
  shipExplode: {
    label: "Ship Explosion",
    context: "A ship blows up — a pressure failure, over quickly. No sparkle (§4.7).",
    current: 'shipExplode',
    candidates: [
      {
        id: 'a',
        character: "hull rupture, debris scattering",
        spec: {
          name: 'shipExplode_a_hullRupture',
          layers: [
            swept('shipExplode_a.front', { wave: 'noise', freq: 260, freqEnd: 66, from: 1700, to: 240, q: 2.8, gain: 0.34, attack: 0.001, hold: 0.03, decay: 0.3, curve: 3, punch: 0.8, seed: 31000 }),
            band('shipExplode_a.shear', 1450, { gain: 0.3, decay: 0.05, q: 5, curve: 6, punch: 0.5, at: 0.006, seed: 31001 }),
            grains('shipExplode_a.debris', { freq: 560, freqEnd: 200, grain: 0.011, gain: 0.32, hold: 0.05, decay: 0.42, curve: 3, from: 2400, to: 560, q: 3, hp: 220, at: 0.04, seed: 31002 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure blast, air dumping out",
        spec: {
          name: 'shipExplode_b_pressureBlast',
          layers: [
            swept('shipExplode_b.blast', { wave: 'noise', freq: 210, freqEnd: 48, from: 1500, to: 160, q: 2.2, gain: 0.32, attack: 0.002, hold: 0.05, decay: 0.42, curve: 2.4, punch: 0.7, seed: 31010 }),
            swept('shipExplode_b.sub', { wave: 'sine', freq: 66, freqEnd: 38, from: 180, q: 1.8, gain: 0.24, attack: 0.003, hold: 0.03, decay: 0.36, curve: 2.2, seed: 31011 }),
            grains('shipExplode_b.vent', { freq: 780, freqEnd: 300, grain: 0.004, gain: 0.24, hold: 0.06, decay: 0.34, curve: 2.8, from: 2200, to: 500, q: 2.8, hp: 300, at: 0.02, seed: 31012 }),
          ],
        },
      },
      {
        id: 'c',
        character: "containment breach, shear and room",
        spec: {
          name: 'shipExplode_c_containmentBreach',
          layers: [
            band('shipExplode_c.tear', 2600, { gain: 0.78, decay: 0.05, q: 7, curve: 7, punch: 0.8, seed: 31020 }),
            swept('shipExplode_c.field', { wave: 'triangle', freq: 420, freqEnd: 150, from: 3800, to: 380, q: 6, gain: 0.62, attack: 0.001, hold: 0.02, decay: 0.3, curve: 3.4, noiseMix: 0.35, at: 0.004, seed: 31021 }),
            ...returns('shipExplode_c.room', { freq: 700, gain: 0.34, decay: 0.26, from: 2000, to: 500, at: 0.12, gap: 0.14, count: 3, seed: 31023 }),
          ],
        },
      },
    ],
  },
  shipSpawn: {
    label: "Ship Spawn",
    context: "A ship arrives on the field",
    current: 'shipSpawn',
    candidates: [
      {
        id: 'a',
        character: "drive spooling into a contact",
        spec: {
          name: 'shipSpawn_a_driveSpool',
          layers: [
            grains('shipSpawn_a.spool', { freq: 240, freqEnd: 460, grain: 0.006, gain: 0.3, hold: 0.06, decay: 0.14, curve: 2, from: 700, to: 2800, q: 3.4, hp: 140, seed: 31030 }),
            ...plate('shipSpawn_a.arrive', 520, { gain: 0.34, decay: 0.2, ratios: [1, 2.41], q: 6, curve: 5, grain: 0.36, at: 0.19, seed: 31032 }),
          ],
        },
      },
      {
        id: 'b',
        character: "mass arriving, pressure seating",
        spec: {
          name: 'shipSpawn_b_massArrive',
          layers: [
            swept('shipSpawn_b.approach', { wave: 'noise', freq: 150, freqEnd: 190, from: 400, to: 1700, q: 2.6, gain: 0.3, attack: 0.03, hold: 0.06, decay: 0.1, curve: 2, seed: 31040 }),
            swept('shipSpawn_b.seat', { wave: 'sine', freq: 96, freqEnd: 72, from: 300, to: 120, q: 2.2, gain: 0.4, attack: 0.002, hold: 0.024, decay: 0.2, curve: 3, punch: 0.6, noiseMix: 0.14, at: 0.2, seed: 31042 }),
          ],
        },
      },
      {
        id: 'c',
        character: "field forming, band closing on a note",
        spec: {
          name: 'shipSpawn_c_fieldForm',
          layers: [
            swept('shipSpawn_c.form', { wave: 'triangle', freq: 330, from: 600, to: 4200, q: 8, gain: 0.42, attack: 0.04, hold: 0.05, decay: 0.09, curve: 2, noiseMix: 0.22, seed: 31050 }),
            band('shipSpawn_c.lock', 1240, { gain: 0.8, decay: 0.16, q: 9, curve: 5.5, punch: 0.5, at: 0.18, seed: 31052 }),
            band('shipSpawn_c.ring', 830, { gain: 0.55, decay: 0.24, q: 11, curve: 4.5, at: 0.185, seed: 31053 }),
          ],
        },
      },
    ],
  },
  spawnPulse: {
    label: "Spawn Protection Pulse",
    context: "Quiet repeating tick during 10s of spawn protection",
    current: 'spawnPulse',
    candidates: [
      {
        id: 'a',
        character: "field grain, a soft particulate tick",
        spec: {
          name: 'spawnPulse_a_fieldGrain',
          layers: [
            grains('spawnPulse_a.grain', { freq: 700, freqEnd: 520, grain: 0.004, gain: 0.2, hold: 0.012, decay: 0.08, curve: 4, from: 1600, to: 800, q: 3, hp: 240, seed: 31060 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a low bubble pip, pressure holding",
        spec: {
          name: 'spawnPulse_b_bubblePip',
          layers: [
            swept('spawnPulse_b.pip', { wave: 'sine', freq: 210, from: 700, to: 260, q: 3.2, gain: 0.22, attack: 0.004, hold: 0.014, decay: 0.1, curve: 3.4, noiseMix: 0.12, seed: 31070 }),
          ],
        },
      },
      {
        id: 'c',
        character: "a thin band shimmering, barely there",
        spec: {
          name: 'spawnPulse_c_thinBand',
          layers: [
            band('spawnPulse_c.skin', 1560, { gain: 0.62, decay: 0.11, q: 7, curve: 5, attack: 0.003, hold: 0.006, seed: 31080 }),
          ],
        },
      },
    ],
  },
  thruster: {
    label: "Thruster Loop",
    context: "Held engine note while the throttle is open (loops continuously)",
    current: 'thruster',
    candidates: [
      // A loop has no envelope to carry character — `hold` runs flat and `decay`
      // is zero, which is what `./candidates.test.ts` checks for. So all three
      // are made of *material* instead: the grain rate, the corner, the Q. None
      // of them names a `lowPassEnd`: a filter sweep inside a loop body wraps
      // into a 2.5 Hz wobble at the loop rate, which is a helicopter, not a drive.
      {
        id: 'a',
        character: "plasma drive, particulate and dry",
        spec: {
          name: 'thruster_a_plasmaDrive',
          loop: true,
          crossfade: 0.04,
          layers: [
            grains('thruster_a.plasma', { freq: 190, freqEnd: 190, grain: 0.0025, gain: 0.34, attack: 0, hold: 0.4, decay: 0, from: 2200, q: 2.4, hp: 90, seed: 31090 }),
            place({ name: 'thruster_a.core', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 74, lowPass: 300, resonance: 1.6, gain: 0.2, seed: 31091 }),
          ],
        },
      },
      {
        id: 'b',
        character: "reaction mass, low pressure roar",
        spec: {
          name: 'thruster_b_reactionMass',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_b.roar', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 120, lowPass: 520, resonance: 2.8, gain: 0.36, seed: 31100 }),
            place({ name: 'thruster_b.mass', wave: 'sine', attack: 0, hold: 0.4, decay: 0, freq: 52, noiseMix: 0.18, lowPass: 200, resonance: 1.4, gain: 0.24, seed: 31101 }),
          ],
        },
      },
      {
        id: 'c',
        character: "induction turbine, one narrow band",
        spec: {
          name: 'thruster_c_inductionTurbine',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_c.turbine', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 430, lowPass: 1450, resonance: 9, bandPass: true, gain: 0.6, seed: 31110 }),
            place({ name: 'thruster_c.stator', wave: 'triangle', attack: 0, hold: 0.4, decay: 0, freq: 145, noiseMix: 0.3, lowPass: 900, resonance: 4, gain: 0.3, seed: 31111 }),
          ],
        },
      },
    ],
  },
  // === STATION / SPEND (a0-01b) =============================================
  //
  // Ore leaving your hold and coming back as structure. The register here is
  // *assembly*, not reward — §7.3's own line for `buildPlaced` is "a latch, not
  // a fanfare", and it generalises across the family. Three shop-floor machines:
  //
  //   a  **ratchet and teeth** — stepped dry contact, mechanical, nothing rings
  //   b  a **hydraulic seat** — pressure released into weight coming to rest
  //   c  a **magnetic lock** — narrow bands closing, the only offers with metal
  //
  // §8's `buildComplete` / `purchaseConfirm` watch runs through here: those two
  // fire seconds apart off one wheel press. This family stays *low and seated* —
  // an assembly finishing — where the interface family's confirmations stay short
  // and narrow. Neither reaches for the other's register.
  buildPlaced: {
    label: "Build Placed",
    context: "A turret/build is placed and starts building — ore spent, a latch not a fanfare.",
    current: 'buildPlaced',
    candidates: [
      {
        id: 'a',
        character: "ratchet teeth, a dry stepped bite",
        spec: {
          name: 'buildPlaced_a_ratchetTeeth',
          layers: [
            grains('buildPlaced_a.teeth', { freq: 520, freqEnd: 300, grain: 0.012, gain: 0.4, hold: 0.02, decay: 0.1, curve: 4.5, from: 2600, to: 900, q: 3.2, hp: 200, punch: 0.5, seed: 32000 }),
            band('buildPlaced_a.pawl', 380, { gain: 0.3, decay: 0.06, q: 4, curve: 5, at: 0.03, seed: 32001 }),
          ],
        },
      },
      {
        id: 'b',
        character: "clamp seating under load, weight down",
        spec: {
          name: 'buildPlaced_b_clampSeat',
          layers: [
            swept('buildPlaced_b.clamp', { wave: 'noise', freq: 260, freqEnd: 130, from: 1600, to: 300, q: 2.8, gain: 0.36, attack: 0.001, hold: 0.02, decay: 0.09, curve: 4, punch: 0.6, seed: 32010 }),
            swept('buildPlaced_b.seat', { wave: 'sine', freq: 104, freqEnd: 86, from: 300, to: 150, q: 2.4, gain: 0.42, attack: 0.002, hold: 0.024, decay: 0.11, curve: 3.4, noiseMix: 0.14, at: 0.035, seed: 32011 }),
          ],
        },
      },
      {
        id: 'c',
        character: "magnetic lock, one narrow band shutting",
        spec: {
          name: 'buildPlaced_c_magneticLock',
          layers: [
            band('buildPlaced_c.approach', 1150, { gain: 0.4, decay: 0.03, q: 6, curve: 6, punch: 0.6, seed: 32020 }),
            ...plate('buildPlaced_c.lock', 470, { gain: 0.44, decay: 0.13, ratios: [1, 2.41], q: 8, curve: 5, grain: 0.26, at: 0.025, seed: 32022 }),
          ],
        },
      },
    ],
  },
  buildComplete: {
    label: "Build Complete",
    context: "A paid-for defence finishes building — a rising confirmation.",
    current: 'buildComplete',
    candidates: [
      {
        id: 'a',
        character: "assembly settling, three dry contacts",
        spec: {
          name: 'buildComplete_a_assemblySettle',
          layers: [
            grains('buildComplete_a.s0', { freq: 420, freqEnd: 340, grain: 0.008, gain: 0.34, hold: 0.015, decay: 0.07, curve: 5, from: 1800, to: 800, q: 3.4, hp: 180, seed: 32030 }),
            grains('buildComplete_a.s1', { freq: 540, freqEnd: 430, grain: 0.008, gain: 0.32, hold: 0.015, decay: 0.08, curve: 5, from: 2200, to: 950, q: 3.4, hp: 180, at: 0.075, seed: 32031 }),
            grains('buildComplete_a.s2', { freq: 660, freqEnd: 520, grain: 0.007, gain: 0.3, hold: 0.02, decay: 0.16, curve: 4, from: 2600, to: 1100, q: 3.6, hp: 200, at: 0.15, seed: 32032 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure system coming up to seat",
        spec: {
          name: 'buildComplete_b_pressureSeat',
          layers: [
            swept('buildComplete_b.rise', { wave: 'triangle', freq: 196, from: 340, to: 1500, q: 3.6, gain: 0.34, attack: 0.02, hold: 0.09, decay: 0.06, curve: 2.4, noiseMix: 0.18, seed: 32040 }),
            swept('buildComplete_b.seat', { wave: 'triangle', freq: 294, from: 1400, to: 520, q: 4.2, gain: 0.4, attack: 0.004, hold: 0.03, decay: 0.24, curve: 3, punch: 0.4, noiseMix: 0.12, at: 0.14, seed: 32041 }),
          ],
        },
      },
      {
        id: 'c',
        character: "two bands locking, a fifth apart",
        spec: {
          name: 'buildComplete_c_bandsLock',
          layers: [
            band('buildComplete_c.n0', 392, { gain: 0.92, decay: 0.14, q: 6.5, curve: 4.5, attack: 0.002, seed: 32050 }),
            ...plate('buildComplete_c.n1', 588, { gain: 0.5, decay: 0.26, ratios: [1, 2.41], q: 7, curve: 4, grain: 0.24, edge: 0.8, at: 0.11, seed: 32052 }),
          ],
        },
      },
    ],
  },
  repairTick: {
    // §7.3: the old context here — "noticed mostly when it stops" — described the
    // retired repair *channel*, which a hit could interrupt. Repair has been a
    // discrete purchase since §2.5 was amended (2026-07-27); nothing interrupts it,
    // so the line was describing a mechanic that no longer exists.
    label: "Repair Tick",
    context: "A soft tick as a repair purchase is applied to a structure.",
    current: 'repairTick',
    candidates: [
      {
        id: 'a',
        character: "weld grain, dry and stepped",
        spec: {
          name: 'repairTick_a_weldGrain',
          layers: [
            grains('repairTick_a.weld', { freq: 480, freqEnd: 360, grain: 0.0035, gain: 0.26, hold: 0.014, decay: 0.09, curve: 4, from: 1900, to: 700, q: 3, hp: 200, seed: 32060 }),
          ],
        },
      },
      {
        id: 'b',
        character: "sealant press, low and closing",
        spec: {
          name: 'repairTick_b_sealantPress',
          layers: [
            swept('repairTick_b.press', { wave: 'triangle', freq: 168, from: 900, to: 240, q: 3.4, gain: 0.3, attack: 0.004, hold: 0.02, decay: 0.1, curve: 3.4, noiseMix: 0.2, seed: 32070 }),
          ],
        },
      },
      {
        id: 'c',
        character: "servo pip, one narrow band",
        spec: {
          name: 'repairTick_c_servoPip',
          layers: [
            band('repairTick_c.pip', 940, { gain: 0.85, decay: 0.1, q: 9, curve: 5, attack: 0.002, hold: 0.005, seed: 32080 }),
          ],
        },
      },
    ],
  },
  bankOre: {
    label: "Bank Ore",
    context: "Ore banked into your economy — a drop that settles.",
    current: 'bankOre',
    candidates: [
      {
        id: 'a',
        character: "hopper drop, gravel settling",
        spec: {
          name: 'bankOre_a_hopper',
          layers: [
            band('bankOre_a.drop', 560, { gain: 0.34, decay: 0.07, q: 5, curve: 5.5, punch: 0.6, seed: 30240 }),
            grains('bankOre_a.gravel', { freq: 240, freqEnd: 170, grain: 0.014, gain: 0.22, hold: 0.02, decay: 0.19, curve: 3.6, from: 1400, to: 420, q: 2.6, hp: 120, at: 0.03, seed: 30241 }),
          ],
        },
      },
      {
        id: 'b',
        character: "vault clamp, low seat",
        spec: {
          name: 'bankOre_b_vaultClamp',
          layers: [
            swept('bankOre_b.clamp', { wave: 'triangle', freq: 220, freqEnd: 180, from: 1600, to: 320, q: 3.6, gain: 0.42, attack: 0.0015, hold: 0.012, decay: 0.13, curve: 4.5, punch: 0.5, noiseMix: 0.2, seed: 30250 }),
            swept('bankOre_b.seat', { wave: 'sine', freq: 88, from: 200, q: 2, gain: 0.24, attack: 0.003, hold: 0.014, decay: 0.16, curve: 3, at: 0.07, seed: 30252 }),
          ],
        },
      },
      {
        id: 'c',
        character: "two filtered tones, falling to rest",
        spec: {
          name: 'bankOre_c_fallingPair',
          layers: [
            ...plate('bankOre_c.high', 780, { gain: 0.28, decay: 0.12, ratios: [1, 2.41], q: 9, curve: 5, punch: 0.4, seed: 30260 }),
            ...plate('bankOre_c.low', 520, { gain: 0.28, decay: 0.24, ratios: [1, 2.41], q: 9, curve: 4.5, at: 0.09, seed: 30263 }),
          ],
        },
      },
    ],
  },
  upgradeBought: {
    label: "Upgrade Bought",
    context: "An upgrade purchased — the brightest confirmation in the bank.",
    current: 'upgradeBought',
    candidates: [
      // §7.3 asks for **three notes rising** here and it is kept in all three, so
      // what the developer is choosing is only the material carrying them. The
      // old offers were an `arpMul` arpeggio, a bell stack and a saw glissando —
      // three names for "sparkle", which §4.7 as amended retires by name.
      {
        id: 'a',
        character: "three dry contacts rising, no shine",
        spec: {
          name: 'upgradeBought_a_dryContacts',
          layers: [
            grains('upgradeBought_a.n0', { freq: 560, freqEnd: 440, grain: 0.005, gain: 0.34, hold: 0.014, decay: 0.08, curve: 5, from: 2400, to: 900, q: 3.4, hp: 240, seed: 32090 }),
            grains('upgradeBought_a.n1', { freq: 740, freqEnd: 580, grain: 0.005, gain: 0.32, hold: 0.014, decay: 0.09, curve: 5, from: 3000, to: 1100, q: 3.4, hp: 260, at: 0.08, seed: 32091 }),
            grains('upgradeBought_a.n2', { freq: 980, freqEnd: 760, grain: 0.004, gain: 0.3, hold: 0.02, decay: 0.2, curve: 4, from: 3800, to: 1400, q: 3.6, hp: 300, at: 0.16, seed: 32092 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure lifting into a seat, sub under it",
        spec: {
          name: 'upgradeBought_b_pressureLift',
          layers: [
            swept('upgradeBought_b.lift', { wave: 'triangle', freq: 262, from: 420, to: 2600, q: 4, gain: 0.34, attack: 0.02, hold: 0.13, decay: 0.05, curve: 2.4, noiseMix: 0.16, seed: 32100 }),
            swept('upgradeBought_b.seat', { wave: 'triangle', freq: 392, from: 2400, to: 700, q: 4.4, gain: 0.4, attack: 0.004, hold: 0.03, decay: 0.24, curve: 3, punch: 0.4, noiseMix: 0.12, at: 0.17, seed: 32101 }),
            swept('upgradeBought_b.sub', { wave: 'sine', freq: 98, from: 260, q: 1.8, gain: 0.22, attack: 0.006, hold: 0.05, decay: 0.2, curve: 2.6, at: 0.02, seed: 32102 }),
          ],
        },
      },
      {
        id: 'c',
        character: "three narrow bands rising, metal ringing",
        spec: {
          name: 'upgradeBought_c_bandsRising',
          layers: [
            band('upgradeBought_c.n0', 523, { gain: 0.42, decay: 0.1, q: 10, curve: 5, attack: 0.002, seed: 32110 }),
            band('upgradeBought_c.n1', 698, { gain: 0.4, decay: 0.12, q: 10.5, curve: 4.6, attack: 0.002, at: 0.08, seed: 32111 }),
            ...plate('upgradeBought_c.n2', 880, { gain: 0.46, decay: 0.28, ratios: [1, 2.41], q: 11, curve: 4, grain: 0.2, edge: 0.7, at: 0.16, seed: 32113 }),
          ],
        },
      },
    ],
  },
  // === THE CLOCK, AND THE ONE SERIOUS THING (a0-01b) ========================
  //
  // The match's own metronome — the wave, the collapse, the end — plus the two
  // sounds §4.7 protects. The same three tools, at the scale of a station:
  //
  //   a  **structure under load** — grains, stone and metal giving way
  //   b  **pressure** — a low body and a filter closing, mass moving
  //   c  **resonance** — a narrow band, the only one with a room behind it
  //
  // Two fences run through this family and neither is negotiable:
  //
  //  - **`alarm` keeps its `saw`.** §5.1 sanctions it by name and §2.2 makes an
  //    unmistakable alarm a *mechanic*: legibility outranks register. All three
  //    offers keep the saw and the rising minor third; what differs is the body
  //    around it. They are also **one-shots**, matching the shipped bank — s9-01
  //    made the alarm sound once per engagement, and the three looping offers
  //    that used to sit here were an A/B against a sound the game stopped making.
  //  - **`stationDeath` is protected** (§7.4: *"any change here is a developer
  //    question, not a re-voice"*). It still gets three offers, because the board
  //    promised forty slots — but every one of them is the same beat: a long fall
  //    that does not resolve, nothing bright anywhere in it, and the mix going to
  //    zero underneath. None runs past the shipped 1.32 s longest-tail invariant.
  waveArrive: {
    label: "Wave Arrive",
    context: "An asteroid wave arrives, field closes in — two low foghorn notes.",
    current: 'waveArrive',
    candidates: [
      // §7.4: *"keep the two low notes and the pitch — the foghorn is the
      // mechanic"* (§2.3's metronome). All three sound 147 Hz then 220 Hz, the
      // shipped fifth, at the shipped 0.18 s apart. §8 also guards this against
      // `alarm`, which sits an octave and a half above at 494/587 — no offer
      // here reaches up into it.
      {
        id: 'a',
        character: "two horn blasts, air-driven and grained",
        spec: {
          name: 'waveArrive_a_airHorn',
          layers: [
            grains('waveArrive_a.h0', { freq: 147, freqEnd: 147.9, grain: 0.02, gain: 0.32, attack: 0.02, hold: 0.2, decay: 0.28, curve: 2.4, from: 500, to: 900, q: 3.6, seed: 32120 }),
            grains('waveArrive_a.h1', { freq: 220, freqEnd: 221.4, grain: 0.016, gain: 0.26, attack: 0.02, hold: 0.18, decay: 0.36, curve: 2.2, from: 1300, to: 600, q: 3.2, at: 0.18, seed: 32121 }),
          ],
        },
      },
      {
        id: 'b',
        character: "twin pressure horns, mass behind them",
        spec: {
          name: 'waveArrive_b_pressureHorn',
          layers: [
            swept('waveArrive_b.h0', { wave: 'triangle', freq: 147, from: 260, to: 760, q: 4.4, gain: 0.46, attack: 0.03, hold: 0.22, decay: 0.3, curve: 2, noiseMix: 0.1, seed: 32130 }),
            swept('waveArrive_b.h1', { wave: 'triangle', freq: 220, from: 1200, to: 400, q: 4, gain: 0.34, attack: 0.03, hold: 0.2, decay: 0.4, curve: 2, noiseMix: 0.08, at: 0.18, seed: 32131 }),
            swept('waveArrive_b.mass', { wave: 'sine', freq: 73.5, from: 200, q: 1.6, gain: 0.24, attack: 0.05, hold: 0.24, decay: 0.34, curve: 2, at: 0.02, seed: 32132 }),
          ],
        },
      },
      {
        id: 'c',
        character: "two swept bands, siren metal",
        spec: {
          name: 'waveArrive_c_sirenMetal',
          layers: [
            swept('waveArrive_c.h0', { wave: 'noise', freq: 147, from: 320, to: 1100, q: 9, gain: 0.42, attack: 0.03, hold: 0.2, decay: 0.3, curve: 2.2, seed: 32140 }),
            swept('waveArrive_c.h1', { wave: 'noise', freq: 220, from: 1500, to: 520, q: 9.5, gain: 0.42, attack: 0.03, hold: 0.18, decay: 0.4, curve: 2, at: 0.18, seed: 32141 }),
          ],
        },
      },
    ],
  },
  collapseBegin: {
    label: "Collapse Begin",
    context: "The collapse phase begins — entropy arriving; low rumble and drone, slow.",
    current: 'collapseBegin',
    candidates: [
      {
        id: 'a',
        character: "structure grinding, grains under load",
        spec: {
          name: 'collapseBegin_a_structureGrind',
          layers: [
            grains('collapseBegin_a.grind', { freq: 190, freqEnd: 62, grain: 0.09, gain: 0.44, attack: 0.3, hold: 0.5, decay: 1.4, curve: 1.6, from: 900, to: 220, q: 2.4, seed: 32150 }),
            grains('collapseBegin_a.dust', { freq: 460, freqEnd: 200, grain: 0.013, gain: 0.2, attack: 0.5, hold: 0.5, decay: 1.2, curve: 1.4, from: 1800, to: 500, q: 2.6, hp: 180, at: 0.2, seed: 32151 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure dropping, a long low swallow",
        spec: {
          name: 'collapseBegin_b_pressureDrop',
          layers: [
            swept('collapseBegin_b.drop', { wave: 'noise', freq: 104, freqEnd: 36, from: 620, to: 120, q: 2.2, gain: 0.5, attack: 0.4, hold: 0.5, decay: 1.4, curve: 1.5, seed: 32160 }),
            swept('collapseBegin_b.sub', { wave: 'sine', freq: 62, freqEnd: 44, from: 170, to: 90, q: 1.6, gain: 0.36, attack: 0.5, hold: 0.6, decay: 1.2, curve: 1.3, noiseMix: 0.05, seed: 32161 }),
          ],
        },
      },
      {
        id: 'c',
        character: "resonance opening, metal under strain",
        spec: {
          name: 'collapseBegin_c_strainedMetal',
          layers: [
            swept('collapseBegin_c.strain', { wave: 'noise', freq: 240, freqEnd: 150, from: 380, to: 1500, q: 8, gain: 0.5, attack: 0.45, hold: 0.5, decay: 1.3, curve: 1.5, seed: 32170 }),
            swept('collapseBegin_c.body', { wave: 'triangle', freq: 82, freqEnd: 66, from: 260, to: 140, q: 2.4, gain: 0.3, attack: 0.5, hold: 0.6, decay: 1.2, curve: 1.3, noiseMix: 0.12, seed: 32171 }),
          ],
        },
      },
    ],
  },
  stationDeath: {
    label: "MiningStation Death",
    context: "A station dies (GDD §4.7) — the most serious sound in the game; then three seconds of silence.",
    current: 'stationDeath',
    candidates: [
      {
        id: 'a',
        character: "the floor going out, everything letting go",
        spec: {
          name: 'stationDeath_a_floorGone',
          layers: [
            swept('stationDeath_a.fall', { wave: 'sine', freq: 205, freqEnd: 33, from: 800, to: 90, q: 1.8, gain: 0.4, attack: 0.01, hold: 0.2, decay: 1.08, curve: 1.5, punch: 0.4, noiseMix: 0.06, seed: 32180 }),
            grains('stationDeath_a.letGo', { freq: 300, freqEnd: 70, grain: 0.055, gain: 0.28, attack: 0.02, hold: 0.3, decay: 1.0, curve: 1.4, from: 1100, to: 180, q: 2.2, seed: 32181 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure loss, a long fall with no bottom",
        spec: {
          name: 'stationDeath_b_noBottom',
          layers: [
            swept('stationDeath_b.loss', { wave: 'noise', freq: 170, freqEnd: 30, from: 700, to: 80, q: 2, gain: 0.46, attack: 0.03, hold: 0.28, decay: 1.05, curve: 1.4, seed: 32190 }),
            swept('stationDeath_b.sub', { wave: 'sine', freq: 74, freqEnd: 29, from: 190, to: 70, q: 1.6, gain: 0.34, attack: 0.02, hold: 0.24, decay: 1.06, curve: 1.5, punch: 0.3, seed: 32191 }),
          ],
        },
      },
      {
        id: 'c',
        character: "one detuned resonance, leaving the room",
        spec: {
          name: 'stationDeath_c_leavingRoom',
          layers: [
            swept('stationDeath_c.toll', { wave: 'triangle', freq: 104, freqEnd: 88, from: 460, to: 130, q: 3.4, gain: 0.68, attack: 0.006, hold: 0.02, decay: 1.2, curve: 1.9, noiseMix: 0.08, seed: 32200 }),
            swept('stationDeath_c.beat', { wave: 'triangle', freq: 105.6, freqEnd: 89.2, from: 420, to: 120, q: 3.2, gain: 0.5, attack: 0.008, hold: 0.02, decay: 1.18, curve: 1.9, noiseMix: 0.07, at: 0.01, seed: 32201 }),
            ...returns('stationDeath_c.room', { freq: 210, gain: 0.26, decay: 0.5, from: 500, to: 150, at: 0.24, gap: 0.26, count: 2, seed: 32203 }),
          ],
        },
      },
    ],
  },
  matchEnd: {
    label: "Match End",
    context: "The match resolves — a short rising resolution.",
    current: 'matchEnd',
    candidates: [
      {
        id: 'a',
        character: "three dry contacts, rising and settling",
        spec: {
          name: 'matchEnd_a_contactsSettle',
          layers: [
            grains('matchEnd_a.n0', { freq: 523, freqEnd: 430, grain: 0.006, gain: 0.36, attack: 0.006, hold: 0.09, decay: 0.24, curve: 3.4, from: 3400, to: 1500, q: 3.4, hp: 420, seed: 32210 }),
            grains('matchEnd_a.n1', { freq: 698, freqEnd: 560, grain: 0.005, gain: 0.34, attack: 0.006, hold: 0.09, decay: 0.32, curve: 3.4, from: 4200, to: 1800, q: 3.4, hp: 500, at: 0.11, seed: 32211 }),
            grains('matchEnd_a.n2', { freq: 932, freqEnd: 740, grain: 0.004, gain: 0.32, attack: 0.006, hold: 0.12, decay: 0.62, curve: 3, from: 5200, to: 2200, q: 3.6, hp: 620, at: 0.23, seed: 32212 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a low swell coming to rest",
        spec: {
          name: 'matchEnd_b_lowSwell',
          layers: [
            swept('matchEnd_b.swell', { wave: 'triangle', freq: 165, from: 300, to: 1400, q: 3.6, gain: 0.4, attack: 0.06, hold: 0.22, decay: 0.2, curve: 2, noiseMix: 0.1, seed: 32220 }),
            swept('matchEnd_b.rest', { wave: 'triangle', freq: 247, from: 1300, to: 420, q: 3.8, gain: 0.38, attack: 0.01, hold: 0.08, decay: 0.66, curve: 2.6, noiseMix: 0.08, at: 0.24, seed: 32221 }),
            swept('matchEnd_b.floor', { wave: 'sine', freq: 82.5, from: 220, q: 1.6, gain: 0.24, attack: 0.03, hold: 0.2, decay: 0.5, curve: 2.2, seed: 32222 }),
          ],
        },
      },
      {
        id: 'c',
        character: "wide bands opening, metal resolving",
        spec: {
          name: 'matchEnd_c_bandsOpening',
          layers: [
            band('matchEnd_c.n0', 330, { gain: 0.42, decay: 0.26, q: 9, curve: 4, attack: 0.004, hold: 0.02, seed: 32230 }),
            band('matchEnd_c.n1', 494, { gain: 0.4, decay: 0.34, q: 10, curve: 3.6, attack: 0.004, hold: 0.02, at: 0.11, seed: 32231 }),
            ...plate('matchEnd_c.n2', 660, { gain: 0.44, decay: 0.66, ratios: [1, 2.41], q: 10, curve: 3.4, grain: 0.18, edge: 0.6, at: 0.23, seed: 32233 }),
          ],
        },
      },
    ],
  },
  alarm: {
    // The `loops until the threat clears` this context used to carry stopped being
    // true at s9-01: the alarm is sounded **once per engagement** by `engine`
    // syncAlarm, with the screen-edge arrow carrying the duration (GDD §2.2,
    // amended 2026-08-07). All three offers are one-shots on the shipped bar.
    label: "Home Alarm",
    context: "Your home is under attack (GDD §2.2) — a mechanic, not music; sounded once per engagement.",
    current: 'alarm',
    candidates: [
      {
        id: 'a',
        character: "klaxon with grain in it, driven hard",
        spec: {
          name: 'alarm_a_grainedKlaxon',
          layers: [
            swept('alarm_a.low', { wave: 'saw', freq: 494, freqEnd: 587, from: 2400, to: 1600, q: 2.4, gain: 0.44, attack: 0.012, hold: 0.16, decay: 0.1, noiseMix: 0.12, seed: 32240 }),
            swept('alarm_a.high', { wave: 'saw', freq: 587, freqEnd: 698, from: 2600, to: 1800, q: 2.4, gain: 0.44, attack: 0.012, hold: 0.16, decay: 0.14, noiseMix: 0.12, at: 0.3, seed: 32241 }),
            grains('alarm_a.air', { freq: 1600, freqEnd: 2000, grain: 0.006, gain: 0.4, attack: 0.01, hold: 0.16, decay: 0.12, curve: 2.6, from: 6200, to: 4400, q: 3, hp: 1400, seed: 32242 }),
            grains('alarm_a.air2', { freq: 1900, freqEnd: 2300, grain: 0.005, gain: 0.38, attack: 0.01, hold: 0.16, decay: 0.16, curve: 2.6, from: 6400, to: 4600, q: 3, hp: 1600, at: 0.3, seed: 32243 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure siren, a horn body under the tone",
        spec: {
          name: 'alarm_b_pressureSiren',
          layers: [
            swept('alarm_b.low', { wave: 'saw', freq: 494, freqEnd: 587, from: 2000, to: 1200, q: 3.6, gain: 0.52, attack: 0.02, hold: 0.16, decay: 0.1, seed: 32250 }),
            swept('alarm_b.high', { wave: 'saw', freq: 587, freqEnd: 698, from: 2200, to: 1300, q: 3.6, gain: 0.52, attack: 0.02, hold: 0.16, decay: 0.14, at: 0.3, seed: 32251 }),
            swept('alarm_b.body', { wave: 'triangle', freq: 123.5, from: 400, to: 240, q: 2.4, gain: 0.3, attack: 0.02, hold: 0.46, decay: 0.14, curve: 2.2, noiseMix: 0.12, seed: 32252 }),
          ],
        },
      },
      {
        id: 'c',
        character: "swept band klaxon, metal in the corner",
        spec: {
          name: 'alarm_c_bandKlaxon',
          layers: [
            swept('alarm_c.low', { wave: 'saw', freq: 494, freqEnd: 587, from: 1400, to: 4400, q: 7, gain: 0.46, attack: 0.012, hold: 0.16, decay: 0.1, seed: 32260 }),
            swept('alarm_c.high', { wave: 'saw', freq: 587, freqEnd: 698, from: 4600, to: 1600, q: 7, gain: 0.46, attack: 0.012, hold: 0.16, decay: 0.14, at: 0.3, seed: 32261 }),
            band('alarm_c.edge', 2480, { gain: 0.24, decay: 0.06, q: 6, curve: 5, attack: 0.002, seed: 32262 }),
            band('alarm_c.edge2', 2960, { gain: 0.24, decay: 0.06, q: 6, curve: 5, attack: 0.002, at: 0.3, seed: 32263 }),
          ],
        },
      },
    ],
  },
  ambient: {
    label: "Ambient Bed",
    context: "The constant background loop during ordinary play — must vanish into the background over ~15 minutes.",
    current: 'ambient',
    candidates: [
      { id: 'a', character: "deep frozen drone, distant creak", spec: {"name":"ambient_frozenDrone","loop":true,"crossfade":0.7,"layers":[{"spec":{"name":"ambientA_bed","wave":"sine","attack":0,"hold":9,"decay":0,"freq":55,"vibratoDepth":0.005,"vibratoRate":0.09,"gain":0.28,"seed":20628},"at":0},{"spec":{"name":"ambientA_detune","wave":"sine","attack":0,"hold":9,"decay":0,"freq":55.4,"gain":0.2,"seed":20629},"at":0},{"spec":{"name":"ambientA_fifth","wave":"triangle","attack":0,"hold":9,"decay":0,"freq":82.5,"vibratoDepth":0.004,"vibratoRate":0.07,"lowPass":650,"gain":0.1,"seed":20630},"at":0},{"spec":{"name":"ambientA_creak","wave":"noise","attack":0,"hold":9,"decay":0,"freq":35,"lowPass":250,"highPass":35,"gain":0.06,"seed":20631},"at":0}]} },
      { id: 'b', character: "thin metallic hull hum, static crackle", spec: {"name":"ambient_hullHum","loop":true,"crossfade":0.5,"layers":[{"spec":{"name":"ambientB_hum","wave":"triangle","attack":0,"hold":7,"decay":0,"freq":110,"vibratoDepth":0.006,"vibratoRate":0.15,"lowPass":1200,"gain":0.22,"seed":20632},"at":0},{"spec":{"name":"ambientB_detune","wave":"triangle","attack":0,"hold":7,"decay":0,"freq":110.6,"lowPass":1200,"gain":0.16,"seed":20633},"at":0},{"spec":{"name":"ambientB_overtone","wave":"sine","attack":0,"hold":7,"decay":0,"freq":165,"gain":0.08,"seed":20634},"at":0},{"spec":{"name":"ambientB_crackle","wave":"noise","attack":0,"hold":7,"decay":0,"freq":60,"lowPass":500,"highPass":80,"gain":0.1,"seed":20635},"at":0}]} },
      { id: 'c', character: "void breath, slow pressure swell", spec: {"name":"ambient_voidBreath","loop":true,"crossfade":0.8,"layers":[{"spec":{"name":"ambientC_swell","wave":"sine","attack":0,"hold":10,"decay":0,"freq":55,"vibratoDepth":0.02,"vibratoRate":0.03,"gain":0.26,"seed":20636},"at":0},{"spec":{"name":"ambientC_beat","wave":"sine","attack":0,"hold":10,"decay":0,"freq":55.25,"vibratoDepth":0.02,"vibratoRate":0.03,"gain":0.2,"seed":20637},"at":0},{"spec":{"name":"ambientC_undertone","wave":"sine","attack":0,"hold":10,"decay":0,"freq":41,"gain":0.14,"seed":20638},"at":0},{"spec":{"name":"ambientC_hiss","wave":"noise","attack":0,"hold":10,"decay":0,"freq":25,"lowPass":200,"highPass":20,"gain":0.05,"seed":20639},"at":0}]} },
    ],
  },
  musicBed: {
    label: "Music Bed — Calm",
    context: "Mining / building with no active threat — the calm foundation drone.",
    current: 'musicBed',
    candidates: [
      { id: 'a', character: "warm hollow triad, breathing", spec: {"name":"musicBed_warmHollow","loop":true,"crossfade":0.5,"layers":[{"spec":{"name":"bedA_root","wave":"triangle","attack":0,"hold":7,"decay":0,"freq":55,"vibratoDepth":0.005,"vibratoRate":0.12,"lowPass":650,"gain":0.2,"seed":20640},"at":0},{"spec":{"name":"bedA_third","wave":"sine","attack":0,"hold":7,"decay":0,"freq":65.41,"vibratoDepth":0.007,"vibratoRate":0.09,"gain":0.15,"seed":20641},"at":0},{"spec":{"name":"bedA_fifth","wave":"sine","attack":0,"hold":7,"decay":0,"freq":82.41,"vibratoDepth":0.004,"vibratoRate":0.1,"gain":0.11,"seed":20642},"at":0}]} },
      { id: 'b', character: "sparse open fifth, airy", spec: {"name":"musicBed_openFifth","loop":true,"crossfade":0.6,"layers":[{"spec":{"name":"bedB_root","wave":"sine","attack":0,"hold":8,"decay":0,"freq":55,"vibratoDepth":0.003,"vibratoRate":0.06,"gain":0.2,"seed":20643},"at":0},{"spec":{"name":"bedB_fifth","wave":"triangle","attack":0,"hold":8,"decay":0,"freq":82.41,"lowPass":900,"gain":0.14,"seed":20644},"at":0},{"spec":{"name":"bedB_octave","wave":"sine","attack":0,"hold":8,"decay":0,"freq":110,"vibratoDepth":0.004,"vibratoRate":0.05,"gain":0.08,"seed":20645},"at":0}]} },
      { id: 'c', character: "murky sub-heavy triad, muffled", spec: {"name":"musicBed_murkySub","loop":true,"crossfade":0.4,"layers":[{"spec":{"name":"bedC_root","wave":"triangle","attack":0,"hold":6,"decay":0,"freq":55,"lowPass":350,"gain":0.24,"seed":20646},"at":0},{"spec":{"name":"bedC_third","wave":"triangle","attack":0,"hold":6,"decay":0,"freq":65.41,"lowPass":300,"gain":0.16,"seed":20647},"at":0},{"spec":{"name":"bedC_fifth","wave":"sine","attack":0,"hold":6,"decay":0,"freq":82.41,"lowPass":400,"gain":0.1,"seed":20648},"at":0},{"spec":{"name":"bedC_sub","wave":"sine","attack":0,"hold":6,"decay":0,"freq":27.5,"gain":0.1,"seed":20649},"at":0}]} },
    ],
  },
  musicPulse: {
    label: "Music Pulse — Rising Tension",
    context: "Threat detected, tension climbing toward a siege — a heartbeat over a floor.",
    current: 'musicPulse',
    candidates: [
      { id: 'a', character: "single deep thud heartbeat", spec: {"name":"musicPulse_singleThud","loop":true,"crossfade":0.04,"layers":[{"spec":{"name":"pulseA_floor","wave":"triangle","attack":0,"hold":0.75,"decay":0,"freq":55,"lowPass":380,"gain":0.07,"seed":20650},"at":0},{"spec":{"name":"pulseA_kick","wave":"sine","attack":0.005,"hold":0.02,"decay":0.55,"punch":0.6,"freq":100,"freqEnd":40,"freqMin":35,"gain":0.28,"repeat":0.75,"seed":20651},"at":0},{"spec":{"name":"pulseA_tick","wave":"triangle","attack":0.002,"hold":0.008,"decay":0.06,"freq":200,"gain":0.08,"repeat":0.75,"seed":20652},"at":0}]} },
      { id: 'b', character: "double-thump lub-dub heartbeat", spec: {"name":"musicPulse_lubDub","loop":true,"crossfade":0.05,"layers":[{"spec":{"name":"pulseB_floor","wave":"triangle","attack":0,"hold":1,"decay":0,"freq":55,"lowPass":350,"gain":0.06,"seed":20653},"at":0},{"spec":{"name":"pulseB_lub","wave":"sine","attack":0.004,"hold":0.015,"decay":0.18,"punch":0.65,"freq":120,"freqEnd":48,"freqMin":35,"gain":0.26,"repeat":1,"seed":20654},"at":0},{"spec":{"name":"pulseB_dub","wave":"sine","attack":0.004,"hold":0.015,"decay":0.35,"punch":0.5,"freq":95,"freqEnd":38,"freqMin":35,"gain":0.22,"repeat":1,"seed":20655},"at":0.22}]} },
      { id: 'c', character: "fast nervous ticking pulse", spec: {"name":"musicPulse_nervousTick","loop":true,"crossfade":0.02,"layers":[{"spec":{"name":"pulseC_floor","wave":"triangle","attack":0,"hold":0.4,"decay":0,"freq":55,"lowPass":400,"gain":0.05,"seed":20656},"at":0},{"spec":{"name":"pulseC_kick","wave":"sine","attack":0.003,"hold":0.01,"decay":0.22,"punch":0.4,"freq":140,"freqEnd":60,"freqMin":40,"gain":0.18,"repeat":0.4,"seed":20657},"at":0},{"spec":{"name":"pulseC_tick","wave":"square","attack":0.002,"hold":0.006,"decay":0.05,"duty":0.3,"freq":440,"gain":0.1,"repeat":0.4,"seed":20658},"at":0}]} },
    ],
  },
  musicTheme: {
    label: "Music Theme — Siege",
    context: "Active combat / base under assault — a short A-minor riff over a pad.",
    current: 'musicTheme',
    candidates: [
      { id: 'a', character: "marching square-lead riff", spec: {"name":"musicTheme_marching","loop":true,"crossfade":0.08,"layers":[{"spec":{"name":"themeA_pad","wave":"triangle","attack":0,"hold":4,"decay":0,"freq":110,"vibratoDepth":0.004,"vibratoRate":0.18,"lowPass":1100,"gain":0.13,"seed":20659},"at":0},{"spec":{"name":"themeA_n0","wave":"square","attack":0.01,"hold":0.18,"decay":0.05,"duty":0.4,"freq":220,"gain":0.13,"seed":20660},"at":0},{"spec":{"name":"themeA_n1","wave":"square","attack":0.01,"hold":0.18,"decay":0.05,"duty":0.4,"freq":261.63,"gain":0.13,"seed":20661},"at":0.45},{"spec":{"name":"themeA_n2","wave":"square","attack":0.01,"hold":0.18,"decay":0.05,"duty":0.4,"freq":329.63,"gain":0.13,"seed":20662},"at":0.9},{"spec":{"name":"themeA_n3","wave":"square","attack":0.01,"hold":0.22,"decay":0.06,"duty":0.4,"freq":293.66,"gain":0.13,"seed":20663},"at":1.35},{"spec":{"name":"themeA_n4","wave":"square","attack":0.01,"hold":0.18,"decay":0.05,"duty":0.4,"freq":261.63,"gain":0.13,"seed":20664},"at":1.9},{"spec":{"name":"themeA_n5","wave":"square","attack":0.01,"hold":0.18,"decay":0.05,"duty":0.4,"freq":220,"gain":0.13,"seed":20665},"at":2.35},{"spec":{"name":"themeA_n6","wave":"square","attack":0.01,"hold":0.3,"decay":0.08,"duty":0.4,"freq":196,"gain":0.12,"seed":20666},"at":2.8}]} },
      { id: 'b', character: "syncopated staccato stabs", spec: {"name":"musicTheme_staccatoStabs","loop":true,"crossfade":0.06,"layers":[{"spec":{"name":"themeB_pad","wave":"triangle","attack":0,"hold":4,"decay":0,"freq":82.41,"vibratoDepth":0.006,"vibratoRate":0.25,"lowPass":900,"gain":0.12,"seed":20667},"at":0},{"spec":{"name":"themeB_n0","wave":"square","attack":0.004,"hold":0.06,"decay":0.03,"duty":0.2,"dutySweep":0.15,"freq":220,"gain":0.14,"seed":20668},"at":0.1},{"spec":{"name":"themeB_n1","wave":"square","attack":0.004,"hold":0.06,"decay":0.03,"duty":0.2,"dutySweep":0.15,"freq":220,"gain":0.13,"seed":20669},"at":0.35},{"spec":{"name":"themeB_n2","wave":"square","attack":0.004,"hold":0.06,"decay":0.03,"duty":0.2,"dutySweep":0.15,"freq":329.63,"gain":0.14,"seed":20670},"at":0.7},{"spec":{"name":"themeB_n3","wave":"square","attack":0.004,"hold":0.06,"decay":0.03,"duty":0.2,"dutySweep":0.15,"freq":261.63,"gain":0.13,"seed":20671},"at":1.15},{"spec":{"name":"themeB_n4","wave":"square","attack":0.004,"hold":0.08,"decay":0.04,"duty":0.2,"dutySweep":0.15,"freq":349.23,"gain":0.14,"seed":20672},"at":1.6},{"spec":{"name":"themeB_n5","wave":"square","attack":0.004,"hold":0.06,"decay":0.03,"duty":0.2,"dutySweep":0.15,"freq":293.66,"gain":0.13,"seed":20673},"at":2.2},{"spec":{"name":"themeB_n6","wave":"square","attack":0.004,"hold":0.1,"decay":0.05,"duty":0.2,"dutySweep":0.15,"freq":220,"gain":0.12,"seed":20674},"at":2.8}]} },
      { id: 'c', character: "slow rising modal march", spec: {"name":"musicTheme_risingModal","loop":true,"crossfade":0.1,"layers":[{"spec":{"name":"themeC_pad","wave":"triangle","attack":0,"hold":4,"decay":0,"freq":110,"vibratoDepth":0.003,"vibratoRate":0.12,"lowPass":1000,"gain":0.14,"seed":20675},"at":0},{"spec":{"name":"themeC_n0","wave":"square","attack":0.015,"hold":0.5,"decay":0.1,"duty":0.5,"freq":220,"gain":0.12,"seed":20676},"at":0},{"spec":{"name":"themeC_n1","wave":"square","attack":0.015,"hold":0.5,"decay":0.1,"duty":0.5,"freq":246.94,"gain":0.12,"seed":20677},"at":0.7},{"spec":{"name":"themeC_n2","wave":"square","attack":0.015,"hold":0.5,"decay":0.1,"duty":0.5,"freq":261.63,"gain":0.13,"seed":20678},"at":1.4},{"spec":{"name":"themeC_n3","wave":"square","attack":0.015,"hold":0.6,"decay":0.15,"duty":0.5,"freq":329.63,"gain":0.13,"seed":20679},"at":2.1},{"spec":{"name":"themeC_n4","wave":"square","attack":0.015,"hold":0.7,"decay":0.2,"duty":0.5,"freq":440,"gain":0.12,"seed":20680},"at":2.9}]} },
    ],
  },
  musicDread: {
    label: "Music Dread — Collapse",
    context: "Core critical, defeat imminent — no melody, no resolution; thinning dread.",
    current: 'musicDread',
    candidates: [
      { id: 'a', character: "grinding semitone clash", spec: {"name":"musicDread_semitoneGrind","loop":true,"crossfade":0.4,"layers":[{"spec":{"name":"dreadA_low","wave":"triangle","attack":0,"hold":6,"decay":0,"freq":55,"lowPass":450,"gain":0.19,"seed":20681},"at":0},{"spec":{"name":"dreadA_clash","wave":"sine","attack":0,"hold":6,"decay":0,"freq":58.27,"gain":0.15,"seed":20682},"at":0},{"spec":{"name":"dreadA_sub","wave":"sine","attack":0,"hold":6,"decay":0,"freq":27.5,"gain":0.13,"seed":20683},"at":0},{"spec":{"name":"dreadA_air","wave":"noise","attack":0,"hold":6,"decay":0,"freq":28,"lowPass":220,"gain":0.05,"seed":20684},"at":0}]} },
      { id: 'b', character: "distant sub rumble, faint flutter", spec: {"name":"musicDread_subRumble","loop":true,"crossfade":0.5,"layers":[{"spec":{"name":"dreadB_low","wave":"sine","attack":0,"hold":7,"decay":0,"freq":41.2,"lowPass":200,"gain":0.2,"seed":20685},"at":0},{"spec":{"name":"dreadB_beat","wave":"sine","attack":0,"hold":7,"decay":0,"freq":41.5,"lowPass":200,"gain":0.16,"seed":20686},"at":0},{"spec":{"name":"dreadB_sub","wave":"sine","attack":0,"hold":7,"decay":0,"freq":30.9,"gain":0.14,"seed":20687},"at":0},{"spec":{"name":"dreadB_flutter","wave":"noise","attack":0,"hold":7,"decay":0,"freq":20,"lowPass":150,"gain":0.04,"seed":20688},"at":0}]} },
      { id: 'c', character: "detuned unison smear", spec: {"name":"musicDread_unisonSmear","loop":true,"crossfade":0.45,"layers":[{"spec":{"name":"dreadC_low","wave":"triangle","attack":0,"hold":6,"decay":0,"freq":55,"lowPass":400,"gain":0.18,"seed":20689},"at":0},{"spec":{"name":"dreadC_smear","wave":"triangle","attack":0,"hold":6,"decay":0,"freq":55.6,"lowPass":400,"gain":0.16,"seed":20690},"at":0},{"spec":{"name":"dreadC_smear2","wave":"sine","attack":0,"hold":6,"decay":0,"freq":54.5,"vibratoDepth":0.01,"vibratoRate":0.04,"gain":0.12,"seed":20691},"at":0},{"spec":{"name":"dreadC_sub","wave":"sine","attack":0,"hold":6,"decay":0,"freq":27.5,"gain":0.1,"seed":20692},"at":0},{"spec":{"name":"dreadC_dust","wave":"noise","attack":0,"hold":6,"decay":0,"freq":32,"lowPass":280,"highPass":25,"gain":0.06,"seed":20693},"at":0}]} },
    ],
  },
  musicWin: {
    label: "Victory Sting",
    context: "Match won (after the three-second quiet) — one-shot, rising major arpeggio.",
    current: 'musicWin',
    candidates: [
      { id: 'a', character: "quick bright fanfare pop", spec: {"name":"musicWin_fanfarePop","layers":[{"spec":{"name":"winA_n0","wave":"square","attack":0.008,"hold":0.08,"decay":0.05,"duty":0.4,"freq":220,"gain":0.22,"seed":20694},"at":0},{"spec":{"name":"winA_n1","wave":"triangle","attack":0.008,"hold":0.08,"decay":0.05,"freq":277.18,"gain":0.22,"seed":20695},"at":0.1},{"spec":{"name":"winA_n2","wave":"square","attack":0.008,"hold":0.08,"decay":0.05,"duty":0.4,"freq":329.63,"gain":0.22,"seed":20696},"at":0.2},{"spec":{"name":"winA_n3","wave":"triangle","attack":0.006,"hold":0.14,"decay":0.18,"freq":440,"gain":0.24,"seed":20697},"at":0.3},{"spec":{"name":"winA_shine","wave":"sine","attack":0.004,"hold":0.1,"decay":0.4,"freq":880,"gain":0.14,"seed":20698},"at":0.3}]} },
      { id: 'b', character: "cascading bell shimmer", spec: {"name":"musicWin_bellCascade","layers":[{"spec":{"name":"winB_n0","wave":"triangle","attack":0.01,"hold":0.05,"decay":0.3,"freq":440,"gain":0.18,"seed":20699},"at":0},{"spec":{"name":"winB_n1","wave":"sine","attack":0.01,"hold":0.05,"decay":0.3,"freq":554.37,"gain":0.18,"seed":20700},"at":0.09},{"spec":{"name":"winB_n2","wave":"triangle","attack":0.01,"hold":0.05,"decay":0.35,"freq":659.25,"gain":0.18,"seed":20701},"at":0.18},{"spec":{"name":"winB_n3","wave":"sine","attack":0.008,"hold":0.08,"decay":0.45,"freq":880,"gain":0.2,"seed":20702},"at":0.27},{"spec":{"name":"winB_shine","wave":"sine","attack":0.006,"hold":0.06,"decay":0.6,"freq":1108.73,"gain":0.14,"seed":20703},"at":0.34}]} },
      { id: 'c', character: "big brassy triumphant swell", spec: {"name":"musicWin_brassySwell","layers":[{"spec":{"name":"winC_n0","wave":"saw","attack":0.02,"hold":0.1,"decay":0.15,"punch":0.3,"freq":220,"gain":0.2,"seed":20704},"at":0},{"spec":{"name":"winC_n1","wave":"saw","attack":0.02,"hold":0.1,"decay":0.15,"punch":0.3,"freq":277.18,"gain":0.2,"seed":20705},"at":0.14},{"spec":{"name":"winC_n2","wave":"saw","attack":0.015,"hold":0.16,"decay":0.3,"punch":0.4,"freq":329.63,"gain":0.22,"seed":20706},"at":0.28},{"spec":{"name":"winC_swell","wave":"saw","attack":0.02,"hold":0.2,"decay":0.5,"punch":0.5,"freq":440,"lowPass":3500,"gain":0.24,"seed":20707},"at":0.42}]} },
    ],
  },
  musicLoss: {
    label: "Defeat Sting",
    context: "Match lost (after the three-second quiet) — one-shot, falling minor phrase that settles low.",
    current: 'musicLoss',
    candidates: [
      { id: 'a', character: "slow descending sigh", spec: {"name":"musicLoss_descendingSigh","layers":[{"spec":{"name":"lossA_n0","wave":"triangle","attack":0.015,"hold":0.18,"decay":0.2,"freq":220,"gain":0.2,"seed":20708},"at":0},{"spec":{"name":"lossA_n1","wave":"sine","attack":0.015,"hold":0.18,"decay":0.22,"freq":196,"gain":0.19,"seed":20709},"at":0.28},{"spec":{"name":"lossA_n2","wave":"triangle","attack":0.02,"hold":0.2,"decay":0.3,"freq":164.81,"gain":0.18,"seed":20710},"at":0.58},{"spec":{"name":"lossA_n3","wave":"sine","attack":0.02,"hold":0.4,"decay":0.8,"freq":110,"lowPass":900,"gain":0.2,"seed":20711},"at":0.92}]} },
      { id: 'b', character: "dissonant stumbling collapse", spec: {"name":"musicLoss_stumblingCollapse","layers":[{"spec":{"name":"lossB_n0","wave":"square","attack":0.01,"hold":0.1,"decay":0.12,"duty":0.35,"freq":220,"gain":0.19,"seed":20712},"at":0},{"spec":{"name":"lossB_n1","wave":"saw","attack":0.01,"hold":0.08,"decay":0.15,"freq":207.65,"gain":0.17,"seed":20713},"at":0.18},{"spec":{"name":"lossB_n2","wave":"square","attack":0.015,"hold":0.12,"decay":0.18,"duty":0.35,"freq":174.61,"gain":0.18,"seed":20714},"at":0.4},{"spec":{"name":"lossB_n3","wave":"saw","attack":0.02,"hold":0.3,"decay":0.7,"freq":87.31,"lowPass":700,"gain":0.2,"seed":20715},"at":0.68}]} },
      { id: 'c', character: "single low tolling bell", spec: {"name":"musicLoss_tollingBell","layers":[{"spec":{"name":"lossC_n0","wave":"sine","attack":0.02,"hold":0.1,"decay":0.6,"freq":220,"gain":0.2,"seed":20716},"at":0},{"spec":{"name":"lossC_n1","wave":"sine","attack":0.02,"hold":0.15,"decay":0.9,"freq":130.81,"gain":0.2,"seed":20717},"at":0.75},{"spec":{"name":"lossC_n2","wave":"sine","attack":0.025,"hold":0.2,"decay":1.4,"freq":55,"lowPass":500,"gain":0.22,"seed":20718},"at":1.7}]} },
    ],
  },
  pressTick: {
    label: "Press Tick",
    context: "A wheel wedge / menu control was pressed — the lightest possible click, heard dozens of times a match.",
    current: 'pressTick',
    candidates: [
      { id: 'a', character: "soft triangle tap", spec: {"name":"pressSoftTri","wave":"triangle","attack":0.001,"hold":0.004,"decay":0.02,"freq":900,"gain":0.12,"seed":20719} },
      { id: 'b', character: "crisp gritty square click", spec: {"name":"pressCrispNoise","wave":"square","attack":0.001,"hold":0.004,"decay":0.018,"freq":1600,"duty":0.2,"noiseMix":0.12,"gain":0.11,"seed":20720} },
      { id: 'c', character: "round low sine thump", spec: {"name":"pressRoundSine","wave":"sine","attack":0.001,"hold":0.003,"decay":0.02,"freq":700,"gain":0.1,"seed":20721} },
    ],
  },
  purchaseConfirm: {
    label: "Purchase Confirm",
    context: "A purchase or repair committed — a rising two-beat 'done'.",
    current: 'purchaseConfirm',
    candidates: [
      { id: 'a', character: "bright square two-note chime", spec: {"name":"purchaseConfirmSquare","layers":[{"spec":{"name":"purchaseConfirmSquare_lo","wave":"square","attack":0.002,"hold":0.025,"decay":0.05,"freq":523.25,"duty":0.4,"gain":0.2,"seed":20722}},{"spec":{"name":"purchaseConfirmSquare_hi","wave":"square","attack":0.002,"hold":0.03,"decay":0.09,"freq":783.99,"duty":0.4,"gain":0.2,"seed":20723},"at":0.045}]} },
      { id: 'b', character: "soft sine bell ding", spec: {"name":"purchaseConfirmBell","layers":[{"spec":{"name":"purchaseConfirmBell_lo","wave":"sine","attack":0.003,"hold":0.02,"decay":0.09,"freq":880,"punch":0.3,"gain":0.22,"seed":20724}},{"spec":{"name":"purchaseConfirmBell_hi","wave":"sine","attack":0.003,"hold":0.03,"decay":0.14,"freq":1318.51,"punch":0.2,"gain":0.2,"seed":20725},"at":0.06}]} },
      { id: 'c', character: "synthetic saw rising blip", spec: {"name":"purchaseConfirmSaw","layers":[{"spec":{"name":"purchaseConfirmSaw_lo","wave":"saw","attack":0.003,"hold":0.02,"decay":0.06,"freq":440,"gain":0.18,"seed":20726}},{"spec":{"name":"purchaseConfirmSaw_hi","wave":"saw","attack":0.003,"hold":0.03,"decay":0.1,"freq":659.25,"lowPass":4000,"gain":0.18,"seed":20727},"at":0.045}]} },
    ],
  },
  rejectBuzz: {
    label: "Reject Buzz",
    context: "A buy the player can't afford — a low, flat, faintly gritty 'nope' that falls a little and stops.",
    current: 'rejectBuzz',
    candidates: [
      { id: 'a', character: "flat gritty square drone", spec: {"name":"rejectBuzzSquare","wave":"square","attack":0.002,"hold":0.07,"decay":0.05,"freq":140,"freqEnd":130,"duty":0.5,"noiseMix":0.05,"lowPass":1800,"gain":0.24,"seed":20728} },
      { id: 'b', character: "short low triangle thud", spec: {"name":"rejectThudTriangle","wave":"triangle","attack":0.002,"hold":0.03,"decay":0.05,"freq":110,"punch":0.3,"gain":0.22,"seed":20729} },
      { id: 'c', character: "gritty pitchless noise rasp", spec: {"name":"rejectRaspNoise","wave":"noise","attack":0.002,"hold":0.05,"decay":0.06,"freq":160,"lowPass":1200,"gain":0.2,"seed":20730} },
    ],
  },
  depositTick: {
    label: "Deposit Tick",
    context: "One ore chunk settling into the bank on a deposit flight — soft & falling, one tick per chunk.",
    current: 'depositTick',
    candidates: [
      {
        id: 'a',
        character: "soft magnetic tick, dry",
        spec: {
          name: 'depositTick_a_magneticTick',
          layers: [
            ...plate('depositTick_a.tick', 520, { gain: 0.17, decay: 0.045, ratios: [1, 2.41], q: 7, curve: 6, punch: 0.35, edge: 0.5, seed: 30270 }),
          ],
        },
      },
      {
        id: 'b',
        character: "muted felt thud, no edge",
        spec: {
          name: 'depositTick_b_feltThud',
          layers: [
            swept('depositTick_b.thud', { wave: 'sine', freq: 210, freqEnd: 170, from: 420, to: 220, q: 2.2, gain: 0.24, attack: 0.002, hold: 0.006, decay: 0.06, curve: 4.5, noiseMix: 0.14, seed: 30275 }),
          ],
        },
      },
      {
        id: 'c',
        character: "thin air tick, breath of one chunk",
        spec: {
          name: 'depositTick_c_airTick',
          layers: [
            grains('depositTick_c.air', { freq: 620, grain: 0.0035, gain: 0.5, hold: 0.003, decay: 0.05, curve: 5, from: 1600, to: 700, q: 2.4, hp: 520, seed: 30280 }),
          ],
        },
      },
    ],
  },
  respawnBeep: {
    label: "Respawn Beep",
    context: "A tick of the respawn countdown — one clean mid beep a second, deliberately plain, a clock.",
    current: 'respawnBeep',
    candidates: [
      { id: 'a', character: "pure plain sine tone", spec: {"name":"respawnBeepSine","wave":"sine","attack":0.004,"hold":0.03,"decay":0.07,"freq":600,"gain":0.18,"seed":20734} },
      { id: 'b', character: "crisp digital square clock", spec: {"name":"respawnBeepSquareDigital","wave":"square","attack":0.003,"hold":0.025,"decay":0.05,"freq":880,"duty":0.5,"gain":0.14,"seed":20735} },
      { id: 'c', character: "warm low triangle beep", spec: {"name":"respawnBeepTriangleWarm","wave":"triangle","attack":0.005,"hold":0.04,"decay":0.09,"freq":494,"gain":0.19,"seed":20736} },
    ],
  },
  respawnGo: {
    label: "Respawn Go",
    context: "Respawn launch — the ship back on the field, brighter & a step up from the countdown beeps.",
    current: 'respawnGo',
    candidates: [
      { id: 'a', character: "punchy square power-up rise", spec: {"name":"respawnGoSquarePower","layers":[{"spec":{"name":"respawnGoSquarePower_rise","wave":"square","attack":0.004,"hold":0.03,"decay":0.12,"freq":700,"freqEnd":1100,"duty":0.4,"punch":0.3,"gain":0.22,"seed":20737}},{"spec":{"name":"respawnGoSquarePower_top","wave":"square","attack":0.003,"hold":0.015,"decay":0.08,"freq":1568,"duty":0.3,"gain":0.14,"seed":20738},"at":0.1}]} },
      { id: 'b', character: "bright sine and triangle launch chime", spec: {"name":"respawnGoChime","layers":[{"spec":{"name":"respawnGoChime_rise","wave":"sine","attack":0.004,"hold":0.03,"decay":0.14,"freq":523.25,"freqEnd":783.99,"vibratoDepth":0.03,"vibratoRate":10,"gain":0.24,"seed":20739}},{"spec":{"name":"respawnGoChime_top","wave":"triangle","attack":0.003,"hold":0.02,"decay":0.1,"freq":1046.5,"gain":0.15,"seed":20740},"at":0.1}]} },
      { id: 'c', character: "energetic saw double-step launch", spec: {"name":"respawnGoSawStep","layers":[{"spec":{"name":"respawnGoSawStep_1","wave":"saw","attack":0.003,"hold":0.02,"decay":0.06,"freq":660,"gain":0.18,"seed":20741}},{"spec":{"name":"respawnGoSawStep_2","wave":"saw","attack":0.003,"hold":0.03,"decay":0.12,"freq":990,"lowPass":5000,"gain":0.2,"seed":20742},"at":0.06}]} },
    ],
  },
  minimapPing: {
    label: "Minimap Ping",
    context: "A minimap ping — a rising sonar blip that rings a moment & fades; it locates, it must never read as an alarm.",
    current: 'minimapPing',
    candidates: [
      { id: 'a', character: "clean rising sine sonar sweep", spec: {"name":"minimapPingSineSweep","wave":"sine","attack":0.004,"hold":0.04,"decay":0.3,"freq":700,"freqEnd":1400,"vibratoDepth":0.015,"vibratoRate":8,"gain":0.2,"seed":20743} },
      { id: 'b', character: "soft triangle pulse with airy overtone", spec: {"name":"minimapPingTrianglePulse","layers":[{"spec":{"name":"minimapPingTrianglePulse_pulse","wave":"triangle","attack":0.004,"hold":0.03,"decay":0.22,"freq":900,"freqEnd":1300,"gain":0.2,"seed":20744}},{"spec":{"name":"minimapPingTrianglePulse_overtone","wave":"sine","attack":0.005,"hold":0.02,"decay":0.18,"freq":1800,"gain":0.08,"seed":20745},"at":0.03}]} },
      { id: 'c', character: "bright bell-like two-partial ping", spec: {"name":"minimapPingBellTwoPartial","layers":[{"spec":{"name":"minimapPingBellTwoPartial_fundamental","wave":"sine","attack":0.003,"hold":0.03,"decay":0.24,"freq":1046.5,"freqEnd":1568,"gain":0.19,"seed":20746}},{"spec":{"name":"minimapPingBellTwoPartial_partial","wave":"sine","attack":0.004,"hold":0.02,"decay":0.16,"freq":2093,"gain":0.07,"seed":20747},"at":0.04}]} },
    ],
  },
};
