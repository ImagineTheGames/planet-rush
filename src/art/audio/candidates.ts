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
  hullHit: {
    label: "Hull Hit",
    context: "A weapon shot bites an enemy ship/turret/shield/core.",
    current: 'hullHit',
    candidates: [
      { id: 'a', character: "sharp metallic clang-ping", spec: {"name":"hh_a_clang","layers":[{"spec":{"name":"hh_a_clangBody","wave":"square","attack":0.001,"hold":0.008,"decay":0.05,"punch":0.6,"freq":900,"freqEnd":500,"duty":0.3,"highPass":400,"gain":0.22,"seed":20483}},{"spec":{"name":"hh_a_clangTick","wave":"noise","attack":0.001,"hold":0.004,"decay":0.03,"freq":2200,"highPass":1200,"gain":0.14,"seed":20484}}]} },
      { id: 'b', character: "meaty crunching impact", spec: {"name":"hh_b_crunch","layers":[{"spec":{"name":"hh_b_crunchBody","wave":"noise","attack":0.001,"hold":0.02,"decay":0.09,"freq":500,"freqEnd":200,"lowPass":1800,"gain":0.3,"seed":20485}},{"spec":{"name":"hh_b_crunchSnap","wave":"triangle","attack":0.001,"hold":0.008,"decay":0.04,"freq":300,"freqEnd":150,"gain":0.18,"seed":20486},"at":0.005}]} },
      { id: 'c', character: "bright zippy sweep-hit", spec: {"name":"hh_c_bright","layers":[{"spec":{"name":"hh_c_brightSweep","wave":"saw","attack":0.001,"hold":0.012,"decay":0.07,"freq":600,"freqEnd":1400,"highPass":300,"gain":0.2,"seed":20487}},{"spec":{"name":"hh_c_airHiss","wave":"noise","attack":0.001,"hold":0.01,"decay":0.06,"freq":1800,"highPass":1000,"gain":0.14,"seed":20488}}]} },
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
  turretFire: {
    label: "Turret Fire",
    context: "Your turret or ship fires a shot.",
    current: 'turretFire',
    candidates: [
      { id: 'a', character: "sharp bright arcade zap", spec: {"name":"tf_a_zap","wave":"square","attack":0.001,"hold":0.008,"decay":0.05,"punch":0.7,"freq":900,"freqEnd":300,"freqMin":30,"duty":0.15,"dutySweep":-2,"gain":0.28,"seed":20507} },
      { id: 'b', character: "meaty punchy cannon thud", spec: {"name":"tf_b_thud","wave":"triangle","attack":0.001,"hold":0.02,"decay":0.09,"punch":0.8,"freq":260,"freqEnd":90,"freqMin":30,"noiseMix":0.15,"lowPass":2500,"gain":0.32,"seed":20508} },
      { id: 'c', character: "airy breathy pulse", spec: {"name":"tf_c_pulse","wave":"sine","attack":0.002,"hold":0.015,"decay":0.07,"freq":700,"freqEnd":350,"vibratoDepth":0.05,"vibratoRate":40,"noiseMix":0.3,"highPass":200,"gain":0.24,"seed":20509} },
    ],
  },
  shotImpact: {
    label: "Shot Impact",
    context: "A turret/ship projectile lands.",
    current: 'shotImpact',
    candidates: [
      { id: 'a', character: "sharp tight crack", spec: {"name":"si_a_crack","wave":"noise","attack":0.001,"hold":0.004,"decay":0.035,"freq":1400,"freqEnd":500,"highPass":700,"gain":0.24,"seed":20510} },
      { id: 'b', character: "meaty low thump", spec: {"name":"si_b_thump","layers":[{"spec":{"name":"si_b_thumpBody","wave":"sine","attack":0.001,"hold":0.015,"decay":0.06,"punch":0.4,"freq":180,"freqEnd":90,"freqMin":30,"gain":0.28,"seed":20511}},{"spec":{"name":"si_b_thumpGrit","wave":"noise","attack":0.001,"hold":0.008,"decay":0.04,"freq":700,"highPass":300,"gain":0.12,"seed":20512}}]} },
      { id: 'c', character: "airy muffled puff", spec: {"name":"si_c_puff","wave":"noise","attack":0.003,"hold":0.02,"decay":0.09,"freq":500,"freqEnd":200,"lowPass":1200,"gain":0.18,"seed":20513} },
    ],
  },
  shieldHit: {
    label: "Shield Hit",
    context: "A shield absorbs a hit — struck bell, not broken.",
    current: 'shieldHit',
    candidates: [
      { id: 'a', character: "crystal chime shimmer", spec: {"name":"sh_a_chime","layers":[{"spec":{"name":"sh_a_chimeMain","wave":"sine","attack":0.002,"hold":0.04,"decay":0.35,"freq":1800,"freqEnd":1600,"vibratoDepth":0.03,"vibratoRate":18,"gain":0.22,"seed":20514}},{"spec":{"name":"sh_a_overtone","wave":"sine","attack":0.002,"hold":0.02,"decay":0.15,"freq":2600,"gain":0.1,"seed":20515}}]} },
      { id: 'b', character: "rubbery elastic bounce", spec: {"name":"sh_b_bounce","layers":[{"spec":{"name":"sh_b_bounceMain","wave":"triangle","attack":0.002,"hold":0.02,"decay":0.12,"punch":0.4,"freq":500,"freqEnd":350,"gain":0.3,"seed":20516}},{"spec":{"name":"sh_b_body","wave":"sine","attack":0.002,"hold":0.015,"decay":0.1,"freq":250,"gain":0.16,"seed":20517}}]} },
      { id: 'c', character: "synthetic energy-field buzz", spec: {"name":"sh_c_buzz","layers":[{"spec":{"name":"sh_c_buzzMain","wave":"square","attack":0.002,"hold":0.03,"decay":0.2,"freq":1100,"freqEnd":980,"duty":0.4,"vibratoDepth":0.04,"vibratoRate":22,"gain":0.2,"seed":20518}},{"spec":{"name":"sh_c_shimmer","wave":"triangle","attack":0.002,"hold":0.02,"decay":0.12,"freq":2000,"gain":0.12,"seed":20519}}]} },
    ],
  },
  shieldDown: {
    label: "Shield Down",
    context: "A shield's bubble fails and falls.",
    current: 'shieldDown',
    candidates: [
      { id: 'a', character: "descending power-down wail", spec: {"name":"sd_a_wail","layers":[{"spec":{"name":"sd_a_wailMain","wave":"square","attack":0.005,"hold":0.05,"decay":0.6,"freq":1100,"freqEnd":100,"freqMin":30,"duty":0.35,"dutySweep":-1,"lowPass":2500,"gain":0.3,"seed":20520}},{"spec":{"name":"sd_a_thud","wave":"sine","attack":0.002,"hold":0.02,"decay":0.1,"freq":200,"freqEnd":80,"freqMin":30,"gain":0.16,"seed":20521}}]} },
      { id: 'b', character: "bubble-burst pop and splash", spec: {"name":"sd_b_pop","layers":[{"spec":{"name":"sd_b_popMain","wave":"noise","attack":0.001,"hold":0.008,"decay":0.1,"punch":0.6,"freq":700,"freqEnd":200,"gain":0.28,"seed":20522}},{"spec":{"name":"sd_b_splash","wave":"noise","attack":0.002,"hold":0.03,"decay":0.25,"freq":400,"freqEnd":150,"lowPass":1500,"gain":0.2,"seed":20523}}]} },
      { id: 'c', character: "electrical fizzle-out crackle", spec: {"name":"sd_c_fizzle","layers":[{"spec":{"name":"sd_c_fizzleMain","wave":"noise","attack":0.002,"hold":0.05,"decay":0.35,"freq":900,"freqEnd":300,"repeat":0.03,"highPass":500,"gain":0.22,"seed":20524}},{"spec":{"name":"sd_c_spark","wave":"square","attack":0.001,"hold":0.01,"decay":0.08,"freq":1800,"freqEnd":600,"duty":0.15,"gain":0.14,"seed":20525},"at":0.01}]} },
    ],
  },
  coreHit: {
    label: "Core Hit",
    context: "A home core takes damage. SERIOUS — low, drops, no sparkle.",
    current: 'coreHit',
    candidates: [
      { id: 'a', character: "deep sub thud with grit", spec: {"name":"ch_a_thud","layers":[{"spec":{"name":"ch_a_thudMain","wave":"sine","attack":0.002,"hold":0.03,"decay":0.3,"punch":0.45,"freq":150,"freqEnd":45,"freqMin":30,"gain":0.4,"seed":20526}},{"spec":{"name":"ch_a_rumble","wave":"noise","attack":0.002,"hold":0.03,"decay":0.2,"freq":200,"freqEnd":80,"lowPass":900,"gain":0.16,"seed":20527}}]} },
      { id: 'b', character: "low metallic groan and creak", spec: {"name":"ch_b_groan","layers":[{"spec":{"name":"ch_b_groanMain","wave":"saw","attack":0.005,"hold":0.06,"decay":0.45,"freq":140,"freqEnd":55,"freqMin":30,"lowPass":1200,"gain":0.4,"seed":20528}},{"spec":{"name":"ch_b_creak","wave":"noise","attack":0.003,"hold":0.02,"decay":0.15,"freq":300,"freqEnd":100,"lowPass":700,"gain":0.14,"seed":20529}}]} },
      { id: 'c', character: "muffled distant boom", spec: {"name":"ch_c_boom","layers":[{"spec":{"name":"ch_c_boomMain","wave":"sine","attack":0.004,"hold":0.08,"decay":0.55,"punch":0.3,"freq":90,"freqEnd":40,"freqMin":30,"gain":0.42,"seed":20530}},{"spec":{"name":"ch_c_dust","wave":"noise","attack":0.005,"hold":0.05,"decay":0.3,"freq":250,"freqEnd":90,"lowPass":600,"gain":0.16,"seed":20531}}]} },
    ],
  },
  turretDown: {
    label: "Turret Destroyed",
    context: "A turret is destroyed.",
    current: 'turretDown',
    candidates: [
      { id: 'a', character: "sparking short-circuit collapse", spec: {"name":"td_a_fizz","layers":[{"spec":{"name":"td_a_fizzMain","wave":"noise","attack":0.002,"hold":0.05,"decay":0.3,"freq":600,"freqEnd":150,"repeat":0.04,"highPass":300,"gain":0.3,"seed":20532}},{"spec":{"name":"td_a_spark","wave":"square","attack":0.001,"hold":0.015,"decay":0.1,"freq":1600,"freqEnd":400,"duty":0.2,"gain":0.18,"seed":20533},"at":0.02}]} },
      { id: 'b', character: "heavy metal collapse thud", spec: {"name":"td_b_collapse","layers":[{"spec":{"name":"td_b_collapseMain","wave":"noise","attack":0.003,"hold":0.05,"decay":0.4,"punch":0.5,"freq":220,"freqEnd":70,"freqMin":30,"lowPass":1200,"gain":0.32,"seed":20534}},{"spec":{"name":"td_b_thud","wave":"sine","attack":0.002,"hold":0.03,"decay":0.25,"freq":120,"freqEnd":60,"freqMin":30,"gain":0.24,"seed":20535},"at":0.03}]} },
      { id: 'c', character: "brittle glassy shatter-clang", spec: {"name":"td_c_shatter","layers":[{"spec":{"name":"td_c_shatterMain","wave":"noise","attack":0.001,"hold":0.02,"decay":0.2,"freq":1400,"freqEnd":500,"highPass":600,"gain":0.28,"seed":20536}},{"spec":{"name":"td_c_clang","wave":"square","attack":0.002,"hold":0.02,"decay":0.18,"freq":900,"freqEnd":450,"duty":0.25,"gain":0.2,"seed":20537},"at":0.03}]} },
    ],
  },
  shipExplode: {
    label: "Ship Explosion",
    context: "A ship blows up — firework: bang then sparkle, quickly over.",
    current: 'shipExplode',
    candidates: [
      { id: 'a', character: "deep boom with shimmer trail", spec: {"name":"se_a_boom","layers":[{"spec":{"name":"se_a_boomMain","wave":"noise","attack":0.002,"hold":0.07,"decay":0.55,"punch":0.5,"freq":380,"freqEnd":50,"freqMin":30,"lowPass":2000,"gain":0.34,"seed":20538}},{"spec":{"name":"se_a_crack","wave":"square","attack":0.001,"hold":0.01,"decay":0.09,"freq":700,"freqEnd":140,"duty":0.22,"gain":0.2,"seed":20539}},{"spec":{"name":"se_a_trail","wave":"triangle","attack":0.005,"hold":0.04,"decay":0.4,"freq":1400,"freqEnd":2200,"repeat":0.09,"gain":0.14,"seed":20540},"at":0.08}]} },
      { id: 'b', character: "chaotic popcorn crackle burst", spec: {"name":"se_b_popcorn","layers":[{"spec":{"name":"se_b_pop1","wave":"noise","attack":0.001,"hold":0.02,"decay":0.12,"freq":800,"freqEnd":300,"repeat":0.045,"gain":0.26,"seed":20541}},{"spec":{"name":"se_b_pop2","wave":"noise","attack":0.001,"hold":0.015,"decay":0.1,"freq":1100,"freqEnd":400,"repeat":0.06,"gain":0.2,"seed":20542},"at":0.02},{"spec":{"name":"se_b_snap","wave":"square","attack":0.001,"hold":0.008,"decay":0.06,"freq":900,"freqEnd":200,"duty":0.18,"gain":0.16,"seed":20543}}]} },
      { id: 'c', character: "cartoon whistle then bang", spec: {"name":"se_c_whistle","layers":[{"spec":{"name":"se_c_whistleMain","wave":"sine","attack":0.004,"hold":0.05,"decay":0.12,"freq":500,"freqEnd":1600,"vibratoDepth":0.02,"vibratoRate":10,"gain":0.2,"seed":20544}},{"spec":{"name":"se_c_bang","wave":"noise","attack":0.001,"hold":0.05,"decay":0.4,"punch":0.5,"freq":400,"freqEnd":70,"freqMin":30,"lowPass":2000,"gain":0.28,"seed":20545},"at":0.13},{"spec":{"name":"se_c_bling","wave":"square","attack":0.003,"hold":0.02,"decay":0.2,"freq":1800,"freqEnd":2400,"duty":0.3,"gain":0.14,"seed":20546},"at":0.16}]} },
    ],
  },
  shipSpawn: {
    label: "Ship Spawn",
    context: "A ship arrives on the field",
    current: 'shipSpawn',
    candidates: [
      { id: 'a', character: "smooth rise, soft landing thud", spec: {"name":"shipSpawn_smoothRise","layers":[{"spec":{"name":"riseSmooth","wave":"triangle","attack":0.02,"hold":0.06,"decay":0.18,"freq":180,"freqEnd":760,"gain":0.32,"seed":20547},"at":0},{"spec":{"name":"landSoft","wave":"square","attack":0.002,"hold":0.02,"decay":0.1,"freq":900,"duty":0.35,"gain":0.2,"seed":20548},"at":0.22}]} },
      { id: 'b', character: "sci-fi sweep, bell settle", spec: {"name":"shipSpawn_sweepChime","layers":[{"spec":{"name":"sweepWarp","wave":"saw","attack":0.015,"hold":0.05,"decay":0.2,"freq":150,"freqEnd":1000,"vibratoDepth":0.06,"vibratoRate":8,"gain":0.3,"seed":20549},"at":0},{"spec":{"name":"chimeSettle","wave":"triangle","attack":0.003,"hold":0.04,"decay":0.15,"freq":1200,"gain":0.22,"seed":20550},"at":0.24}]} },
      { id: 'c', character: "impact thud then power-up rise", spec: {"name":"shipSpawn_thudRise","layers":[{"spec":{"name":"thudArrive","wave":"noise","attack":0.002,"hold":0.02,"decay":0.08,"punch":0.5,"freq":150,"freqEnd":80,"lowPass":800,"highPass":30,"gain":0.3,"seed":20551},"at":0},{"spec":{"name":"riseQuick","wave":"square","attack":0.01,"hold":0.04,"decay":0.14,"freq":300,"freqEnd":820,"duty":0.4,"gain":0.26,"seed":20552},"at":0.03}]} },
    ],
  },
  spawnPulse: {
    label: "Spawn Protection Pulse",
    context: "Quiet repeating tick during 10s of spawn protection",
    current: 'spawnPulse',
    candidates: [
      { id: 'a', character: "soft sine blip", spec: {"name":"spawnPulse_softSine","wave":"sine","attack":0.005,"hold":0.015,"decay":0.1,"freq":900,"freqEnd":1100,"gain":0.1,"seed":20553} },
      { id: 'b', character: "gentle round pulse", spec: {"name":"spawnPulse_gentlePulse","wave":"triangle","attack":0.008,"hold":0.03,"decay":0.15,"freq":700,"freqEnd":850,"gain":0.09,"seed":20554} },
      { id: 'c', character: "faint shimmer tick", spec: {"name":"spawnPulse_shimmerTick","wave":"square","attack":0.006,"hold":0.02,"decay":0.1,"freq":1200,"freqEnd":1500,"duty":0.2,"vibratoDepth":0.05,"vibratoRate":25,"gain":0.1,"seed":20555} },
    ],
  },
  thruster: {
    label: "Thruster Loop",
    context: "Held engine note while the throttle is open (loops continuously)",
    current: 'thruster',
    candidates: [
      { id: 'a', character: "deep gritty roar", spec: {"name":"thruster_deepRoar","loop":true,"crossfade":0.04,"layers":[{"spec":{"name":"roarDeep","wave":"noise","attack":0,"hold":0.4,"decay":0,"freq":160,"lowPass":700,"highPass":50,"gain":0.32,"seed":20556},"at":0},{"spec":{"name":"subTone","wave":"sine","attack":0,"hold":0.4,"decay":0,"freq":60,"gain":0.14,"seed":20557},"at":0}]} },
      { id: 'b', character: "buzzy electric hum", spec: {"name":"thruster_buzzyHum","loop":true,"crossfade":0.04,"layers":[{"spec":{"name":"buzzSquare","wave":"square","attack":0,"hold":0.4,"decay":0,"freq":140,"duty":0.5,"noiseMix":0.2,"lowPass":1200,"gain":0.22,"seed":20558},"at":0},{"spec":{"name":"humSine","wave":"sine","attack":0,"hold":0.4,"decay":0,"freq":70,"gain":0.16,"seed":20559},"at":0}]} },
      { id: 'c', character: "airy whoosh thrust", spec: {"name":"thruster_airyWhoosh","loop":true,"crossfade":0.04,"layers":[{"spec":{"name":"airNoise","wave":"noise","attack":0,"hold":0.4,"decay":0,"freq":260,"lowPass":1800,"highPass":150,"gain":0.24,"seed":20560},"at":0},{"spec":{"name":"toneUnder","wave":"triangle","attack":0,"hold":0.4,"decay":0,"freq":100,"noiseMix":0.1,"lowPass":900,"gain":0.18,"seed":20561},"at":0}]} },
    ],
  },
  buildPlaced: {
    label: "Build Placed",
    context: "A turret/build is placed and starts building — ore spent, a latch not a fanfare.",
    current: 'buildPlaced',
    candidates: [
      { id: 'a', character: "heavy iron clank and settle", spec: {"name":"buildPlaced_a","layers":[{"spec":{"name":"buildPlaced_a_thud","wave":"square","attack":0.002,"hold":0.03,"decay":0.12,"freq":164,"freqEnd":110,"duty":0.45,"gain":0.32,"seed":20562}},{"spec":{"name":"buildPlaced_a_settle","wave":"noise","attack":0.001,"hold":0.01,"decay":0.05,"freq":500,"freqEnd":200,"highPass":250,"gain":0.14,"seed":20563},"at":0.04}]} },
      { id: 'b', character: "soft magnetic snap and lock", spec: {"name":"buildPlaced_b","layers":[{"spec":{"name":"buildPlaced_b_snap","wave":"triangle","attack":0.001,"hold":0.015,"decay":0.07,"freq":340,"freqEnd":220,"gain":0.26,"seed":20564}},{"spec":{"name":"buildPlaced_b_lock","wave":"sine","attack":0.002,"hold":0.02,"decay":0.09,"freq":180,"gain":0.18,"seed":20565},"at":0.04}]} },
      { id: 'c', character: "ratchet click-lock, stepped texture", spec: {"name":"buildPlaced_c","layers":[{"spec":{"name":"buildPlaced_c_ratchet","wave":"square","attack":0.001,"hold":0.008,"decay":0.05,"freq":700,"freqEnd":400,"duty":0.2,"repeat":0.02,"gain":0.22,"seed":20566}},{"spec":{"name":"buildPlaced_c_base","wave":"square","attack":0.002,"hold":0.02,"decay":0.1,"freq":130,"freqEnd":100,"duty":0.5,"gain":0.24,"seed":20567},"at":0.02}]} },
    ],
  },
  buildComplete: {
    label: "Build Complete",
    context: "A paid-for defence finishes building — rising perfect fifth confirmation.",
    current: 'buildComplete',
    candidates: [
      { id: 'a', character: "single-voice chiptune arpeggio fifth", spec: {"name":"buildComplete_a","wave":"square","attack":0.003,"hold":0.1,"decay":0.12,"freq":440,"arpMul":1.5,"arpTime":0.06,"duty":0.35,"gain":0.28,"seed":20568} },
      { id: 'b', character: "warm sine swell, soft glow", spec: {"name":"buildComplete_b","layers":[{"spec":{"name":"buildComplete_b_base","wave":"sine","attack":0.01,"hold":0.08,"decay":0.15,"freq":392,"gain":0.3,"seed":20569}},{"spec":{"name":"buildComplete_b_fifth","wave":"sine","attack":0.01,"hold":0.09,"decay":0.22,"freq":587,"gain":0.24,"seed":20570},"at":0.1}]} },
      { id: 'c', character: "chunky retro two-step blip", spec: {"name":"buildComplete_c","layers":[{"spec":{"name":"buildComplete_c_step1","wave":"square","attack":0.004,"hold":0.05,"decay":0.08,"freq":349,"duty":0.5,"gain":0.3,"seed":20571}},{"spec":{"name":"buildComplete_c_step2","wave":"square","attack":0.004,"hold":0.07,"decay":0.16,"freq":523,"duty":0.5,"gain":0.28,"seed":20572},"at":0.08}]} },
    ],
  },
  repairTick: {
    label: "Repair Tick",
    context: "A soft repair tick while a structure heals — noticed mostly when it stops.",
    current: 'repairTick',
    candidates: [
      { id: 'a', character: "gentle rising sine chirp", spec: {"name":"repairTick_a","wave":"sine","attack":0.006,"hold":0.015,"decay":0.1,"freq":440,"freqEnd":560,"gain":0.13,"seed":20573} },
      { id: 'b', character: "mellow steady triangle pulse", spec: {"name":"repairTick_b","wave":"triangle","attack":0.01,"hold":0.03,"decay":0.08,"freq":330,"gain":0.15,"seed":20574} },
      { id: 'c', character: "tiny narrow-duty square blip", spec: {"name":"repairTick_c","wave":"square","attack":0.005,"hold":0.01,"decay":0.06,"freq":600,"duty":0.12,"gain":0.1,"seed":20575} },
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
      { id: 'a', character: "fast bright square arpeggio sparkle", spec: {"name":"upgradeBought_a","layers":[{"spec":{"name":"upgradeBought_a_arp","wave":"square","attack":0.002,"hold":0.1,"decay":0.08,"freq":659,"arpMul":1.5,"arpTime":0.05,"repeat":0.1,"duty":0.25,"gain":0.28,"seed":20582}},{"spec":{"name":"upgradeBought_a_sparkle","wave":"square","attack":0.003,"hold":0.04,"decay":0.15,"freq":1318,"duty":0.2,"gain":0.16,"seed":20583},"at":0.12}]} },
      { id: 'b', character: "shimmering layered bell harmonics", spec: {"name":"upgradeBought_b","layers":[{"spec":{"name":"upgradeBought_b_bell1","wave":"triangle","attack":0.003,"hold":0.08,"decay":0.25,"freq":880,"gain":0.24,"seed":20584}},{"spec":{"name":"upgradeBought_b_bell2","wave":"sine","attack":0.003,"hold":0.06,"decay":0.3,"freq":1320,"gain":0.18,"seed":20585},"at":0.02},{"spec":{"name":"upgradeBought_b_bell3","wave":"sine","attack":0.003,"hold":0.05,"decay":0.2,"freq":1760,"gain":0.12,"seed":20586},"at":0.05}]} },
      { id: 'c', character: "glissando sparkle sweep upward", spec: {"name":"upgradeBought_c","layers":[{"spec":{"name":"upgradeBought_c_sweep","wave":"saw","attack":0.005,"hold":0.05,"decay":0.18,"freq":600,"freqEnd":1400,"vibratoDepth":0.08,"vibratoRate":14,"gain":0.24,"seed":20587}},{"spec":{"name":"upgradeBought_c_top","wave":"triangle","attack":0.004,"hold":0.04,"decay":0.15,"freq":1568,"gain":0.18,"seed":20588},"at":0.1}]} },
    ],
  },
  waveArrive: {
    label: "Wave Arrive",
    context: "An asteroid wave arrives, field closes in — two low foghorn notes.",
    current: 'waveArrive',
    candidates: [
      { id: 'a', character: "deep dual-note saw foghorn", spec: {"name":"waveArrive_a","layers":[{"spec":{"name":"waveArrive_a_horn1","wave":"saw","attack":0.04,"hold":0.2,"decay":0.28,"freq":130,"vibratoDepth":0.02,"vibratoRate":5,"lowPass":1200,"gain":0.34,"seed":20589}},{"spec":{"name":"waveArrive_a_horn2","wave":"saw","attack":0.04,"hold":0.18,"decay":0.36,"freq":196,"lowPass":1400,"gain":0.22,"seed":20590},"at":0.16}]} },
      { id: 'b', character: "pulsing square siren, mechanical", spec: {"name":"waveArrive_b","layers":[{"spec":{"name":"waveArrive_b_siren1","wave":"square","attack":0.03,"hold":0.25,"decay":0.3,"freq":110,"duty":0.5,"dutySweep":-0.2,"lowPass":1000,"gain":0.3,"seed":20591}},{"spec":{"name":"waveArrive_b_siren2","wave":"square","attack":0.03,"hold":0.2,"decay":0.35,"freq":165,"duty":0.5,"lowPass":1100,"gain":0.22,"seed":20592},"at":0.2}]} },
      { id: 'c', character: "gritty noise-and-sub drone horn", spec: {"name":"waveArrive_c","layers":[{"spec":{"name":"waveArrive_c_drone","wave":"noise","attack":0.05,"hold":0.3,"decay":0.4,"freq":140,"freqEnd":100,"lowPass":500,"gain":0.3,"seed":20593}},{"spec":{"name":"waveArrive_c_subhorn","wave":"sine","attack":0.04,"hold":0.25,"decay":0.4,"freq":98,"gain":0.28,"seed":20594},"at":0.15}]} },
    ],
  },
  collapseBegin: {
    label: "Collapse Begin",
    context: "The collapse phase begins — entropy arriving; low rumble and drone, slow.",
    current: 'collapseBegin',
    candidates: [
      { id: 'a', character: "grinding low noise rumble bed", spec: {"name":"collapseBegin_a","layers":[{"spec":{"name":"collapseBegin_a_rumble","wave":"noise","attack":0.35,"hold":0.45,"decay":1.3,"freq":90,"freqEnd":38,"lowPass":400,"gain":0.48,"seed":20595}},{"spec":{"name":"collapseBegin_a_drone","wave":"sine","attack":0.45,"hold":0.55,"decay":1.1,"freq":70,"freqEnd":52,"gain":0.28,"seed":20596}}]} },
      { id: 'b', character: "throbbing vibrato dread pulse", spec: {"name":"collapseBegin_b","layers":[{"spec":{"name":"collapseBegin_b_throb","wave":"sine","attack":0.3,"hold":0.4,"decay":1,"vibratoDepth":0.25,"vibratoRate":3,"freq":60,"freqEnd":45,"gain":0.35,"seed":20597}},{"spec":{"name":"collapseBegin_b_undernoise","wave":"noise","attack":0.4,"hold":0.5,"decay":0.9,"freq":80,"freqEnd":35,"lowPass":300,"gain":0.2,"seed":20598},"at":0.1}]} },
      { id: 'c', character: "crumbling stepped structural groan", spec: {"name":"collapseBegin_c","layers":[{"spec":{"name":"collapseBegin_c_crumble","wave":"noise","attack":0.2,"hold":0.3,"decay":1.1,"freq":200,"freqEnd":60,"lowPass":600,"repeat":0.35,"gain":0.32,"seed":20599}},{"spec":{"name":"collapseBegin_c_groan","wave":"triangle","attack":0.3,"hold":0.4,"decay":1,"freq":65,"freqEnd":48,"gain":0.26,"seed":20600},"at":0.05}]} },
    ],
  },
  stationDeath: {
    label: "MiningStation Death",
    context: "A station dies (GDD §4.7) — the most serious sound in the game; then three seconds of silence.",
    current: 'stationDeath',
    candidates: [
      { id: 'a', character: "deep collapsing sine descent", spec: {"name":"stationDeath_a","layers":[{"spec":{"name":"stationDeath_a_coreFall","wave":"sine","attack":0.02,"hold":0.3,"decay":1.3,"punch":0.3,"freq":180,"freqEnd":28,"gain":0.42,"seed":20601}},{"spec":{"name":"stationDeath_a_dustNoise","wave":"noise","attack":0.05,"hold":0.4,"decay":1.2,"freq":150,"freqEnd":35,"lowPass":600,"gain":0.28,"seed":20602},"at":0.1},{"spec":{"name":"stationDeath_a_subToll","wave":"triangle","attack":0.01,"hold":0.1,"decay":1.4,"freq":80,"freqEnd":70,"gain":0.2,"seed":20603},"at":0.15}]} },
      { id: 'b', character: "muffled noise implosion, sub-bass swallow", spec: {"name":"stationDeath_b","layers":[{"spec":{"name":"stationDeath_b_implode","wave":"noise","attack":0.03,"hold":0.35,"decay":1.25,"freq":130,"freqEnd":25,"lowPass":350,"gain":0.5,"seed":20604}},{"spec":{"name":"stationDeath_b_subDrone","wave":"sine","attack":0.4,"hold":0.5,"decay":0.8,"freq":55,"freqEnd":42,"gain":0.3,"seed":20605},"at":0.05},{"spec":{"name":"stationDeath_b_crackle","wave":"noise","attack":0.15,"hold":0.2,"decay":0.9,"freq":200,"freqEnd":60,"highPass":400,"lowPass":1200,"gain":0.12,"seed":20606},"at":0.3}]} },
      { id: 'c', character: "slow tolling drone, cracking decay", spec: {"name":"stationDeath_c","layers":[{"spec":{"name":"stationDeath_c_toll","wave":"triangle","attack":0.02,"hold":0.15,"decay":1.5,"freq":110,"freqEnd":85,"gain":0.4,"seed":20607}},{"spec":{"name":"stationDeath_c_rumbleBed","wave":"sine","attack":0.3,"hold":0.4,"decay":1,"freq":48,"freqEnd":38,"gain":0.3,"seed":20608},"at":0.05},{"spec":{"name":"stationDeath_c_crustNoise","wave":"noise","attack":0.05,"hold":0.3,"decay":1.1,"freq":160,"freqEnd":50,"lowPass":700,"gain":0.25,"seed":20609},"at":0.15}]} },
    ],
  },
  matchEnd: {
    label: "Match End",
    context: "The match resolves — a short rising resolution.",
    current: 'matchEnd',
    candidates: [
      { id: 'a', character: "triumphant triangle fanfare", spec: {"name":"matchEnd_a","layers":[{"spec":{"name":"matchEnd_a_1","wave":"triangle","attack":0.008,"hold":0.12,"decay":0.25,"freq":440,"gain":0.3,"seed":20610}},{"spec":{"name":"matchEnd_a_2","wave":"triangle","attack":0.008,"hold":0.12,"decay":0.35,"freq":587,"gain":0.28,"seed":20611},"at":0.1},{"spec":{"name":"matchEnd_a_3","wave":"triangle","attack":0.008,"hold":0.18,"decay":0.7,"freq":880,"gain":0.24,"seed":20612},"at":0.2}]} },
      { id: 'b', character: "warm blended sine chord swell", spec: {"name":"matchEnd_b","layers":[{"spec":{"name":"matchEnd_b_pad1","wave":"sine","attack":0.02,"hold":0.2,"decay":0.5,"freq":330,"gain":0.28,"seed":20613}},{"spec":{"name":"matchEnd_b_pad2","wave":"sine","attack":0.02,"hold":0.2,"decay":0.5,"freq":415,"gain":0.24,"seed":20614},"at":0.03},{"spec":{"name":"matchEnd_b_pad3","wave":"sine","attack":0.02,"hold":0.25,"decay":0.6,"freq":494,"gain":0.22,"seed":20615},"at":0.06}]} },
      { id: 'c', character: "bouncy square staircase climb", spec: {"name":"matchEnd_c","layers":[{"spec":{"name":"matchEnd_c_step1","wave":"square","attack":0.004,"hold":0.08,"decay":0.1,"freq":392,"duty":0.4,"gain":0.28,"seed":20616}},{"spec":{"name":"matchEnd_c_step2","wave":"square","attack":0.004,"hold":0.08,"decay":0.12,"freq":523,"duty":0.4,"gain":0.26,"seed":20617},"at":0.09},{"spec":{"name":"matchEnd_c_step3","wave":"square","attack":0.004,"hold":0.1,"decay":0.25,"freq":659,"duty":0.4,"gain":0.24,"seed":20618},"at":0.18}]} },
    ],
  },
  alarm: {
    label: "Home Alarm",
    context: "Your home is under attack (GDD §2.2) — a mechanic, not music; loops until the threat clears.",
    current: 'alarm',
    candidates: [
      { id: 'a', character: "classic twin-tone klaxon", spec: {"name":"alarm_classicKlaxon","loop":true,"crossfade":0.02,"layers":[{"spec":{"name":"alarmA_low","wave":"saw","attack":0.015,"hold":0.18,"decay":0.12,"freq":440,"freqEnd":523.25,"lowPass":3000,"gain":0.42,"seed":20619},"at":0},{"spec":{"name":"alarmA_high","wave":"saw","attack":0.015,"hold":0.18,"decay":0.16,"freq":523.25,"freqEnd":622.25,"lowPass":3200,"gain":0.42,"seed":20620},"at":0.32},{"spec":{"name":"alarmA_hum","wave":"saw","attack":0,"hold":0.7,"decay":0,"freq":110,"lowPass":800,"gain":0.05,"seed":20621},"at":0}]} },
      { id: 'b', character: "slow blaring foghorn siren", spec: {"name":"alarm_foghorn","loop":true,"crossfade":0.05,"layers":[{"spec":{"name":"alarmB_low","wave":"saw","attack":0.05,"hold":0.5,"decay":0.3,"freq":220,"freqEnd":261.6,"lowPass":2200,"gain":0.4,"seed":20622},"at":0},{"spec":{"name":"alarmB_high","wave":"saw","attack":0.05,"hold":0.5,"decay":0.34,"freq":261.6,"freqEnd":311.1,"lowPass":2400,"gain":0.4,"seed":20623},"at":0.55},{"spec":{"name":"alarmB_hum","wave":"saw","attack":0,"hold":1.45,"decay":0,"freq":55,"lowPass":600,"gain":0.06,"seed":20624},"at":0}]} },
      { id: 'c', character: "rapid stuttering distress pulse", spec: {"name":"alarm_stutter","loop":true,"crossfade":0.01,"layers":[{"spec":{"name":"alarmC_low","wave":"saw","attack":0.006,"hold":0.06,"decay":0.04,"freq":660,"freqEnd":784.9,"lowPass":4000,"gain":0.4,"seed":20625},"at":0},{"spec":{"name":"alarmC_high","wave":"saw","attack":0.006,"hold":0.06,"decay":0.05,"freq":784.9,"freqEnd":933.3,"lowPass":4200,"gain":0.4,"seed":20626},"at":0.12},{"spec":{"name":"alarmC_hum","wave":"saw","attack":0,"hold":0.24,"decay":0,"freq":165,"lowPass":1000,"gain":0.05,"seed":20627},"at":0}]} },
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
