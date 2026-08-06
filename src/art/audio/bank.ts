/**
 * src/art/audio/bank.ts — every sound in the game. OWNER: Art & Audio Agent.
 *
 * The Art & Audio mandate, verbatim (GDD §3.6): *"Every mechanic in section 2
 * has a visible and audible tell."* `../tells.ts` names the moments; `../vfx/`
 * draws them; this file is the other half — a sound for every one of them, with
 * the mapping stated as data ({@link TELL_SOUND}) so `audio.test.ts` can assert
 * that no mechanic is visible but silent.
 *
 * ## Judged against the tone paragraph
 *
 * > *Saturday-morning space brawl: fast, bright, and a little cheeky. Ships are
 * > toys, explosions are fireworks … But homes are the one serious thing in it.*
 *
 * So the arcade half is deliberately synthetic and unembarrassed — square waves,
 * blips that arpeggio upward, a firework rather than a war film — while the two
 * sounds attached to homes ({@link SOUND.coreHit}, {@link SOUND.stationDeath})
 * drop an octave, lose their brightness and take their time. The death sound is
 * the only one in the bank with a tail longer than a second, and the only one
 * that is followed by nothing at all (`../vfx/death-moment`).
 *
 * ## The rock-vs-hull firing voices, after the laser's retirement
 *
 * GDD §3.6 asks for *"the distinct rock-vs-hull firing sounds"* by name, because
 * firing is the game's central inversion — the same trigger mines and kills —
 * and the player needs to know which one they are doing without looking. That
 * requirement outlives the mechanism it was written for: the ratified amendment
 * v0.3 retired the held mining laser and made *everything* a discrete projectile
 * (`src/sim/projectiles.ts`), so these two voices retire with the laser that bore
 * them. A shot is now an **event**, not a sustained state, so the pair are one-
 * shots ({@link SOUND.rockChip}, {@link SOUND.hullHit}) rather than crossfaded
 * loops — a rapid trigger reads as a stream because the mix's repeat-gap thins a
 * per-tick burst to a chatter (`./graph`), which is the machine-gun rattle the
 * old loops existed to avoid, solved one layer down instead of with a held tone.
 *
 *  - **Rock chip** is low, grainy, band-limited — stone giving way under a shot.
 *  - **Hull hit** is bright, thin and rude — a round biting plate.
 *
 * The impact of a shot in flight ({@link SOUND.shotImpact}) is the turret/ship
 * projectile landing; it and the two chip voices carry weapon power in their gain
 * (`./engine` `levelFor`), so a tier-4 tool hits heavier than a tier-0 one.
 *
 * ## The device cues (the p4-03 seams)
 *
 * A handful of sounds here are **not** wired to a world tell — they answer a
 * finger, not a diff: a wheel press, a purchase landing, a rejected buy, the ping,
 * the respawn countdown, an ore chunk settling into the bank. They are the audible
 * half of the haptic vocabulary (`src/platform/haptics.ts`) and share its rhythm —
 * a whisper for a press, a two-beat for a commit — and they are played through
 * {@link AudioEngine.cue} rather than the tell router. See {@link CUE_SOUND}.
 *
 * ## Levels
 *
 * Peak amplitudes are set here rather than in the mix, so relative balance is
 * reviewable as a column of numbers. The rule of thumb the bank follows: things
 * a player *did* are louder than things that merely happened, and the alarm is
 * louder than both because it is a mechanic (GDD §2.2), not a notification.
 */

import { TELL, type TellKind } from '../tells';
import type { VoiceSpec } from './synth';
import {
  GLASS_PAIR,
  GLASS_PARTIALS,
  PARTIAL_DECAY,
  PARTIAL_ROLLOFF,
  STRIKE_S,
  type UiCueName,
} from './ui-cues';

// ---------------------------------------------------------------------------
// Spec shapes
// ---------------------------------------------------------------------------

/** One layer of a stacked sound: a voice, when it starts, and at what level. */
export interface SoundLayer {
  readonly spec: VoiceSpec;
  /** Seconds from the start of the sound. */
  readonly at?: number;
  readonly level?: number;
}

/** A sound built from several voices — the alarm, the death fall, the ambient bed. */
export interface LayeredSpec {
  readonly name: string;
  readonly layers: readonly SoundLayer[];
  /** Render for looping: no edge fades, and the tail joined onto the head. */
  readonly loop?: boolean;
  /** Crossfade seconds used to join the loop, when `loop`. */
  readonly crossfade?: number;
}

/** Either a single voice or a stack of them. */
export type SoundSpec = VoiceSpec | LayeredSpec;

/** True for the stacked form. */
export function isLayered(spec: SoundSpec): spec is LayeredSpec {
  return 'layers' in spec;
}

/** Does this sound loop? Single voices never do; layered ones may say so. */
export function loops(spec: SoundSpec): boolean {
  return isLayered(spec) && spec.loop === true;
}

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

/**
 * Every sound, by name. Keys are the vocabulary the engine and the tests speak;
 * most map 1:1 to a {@link TELL}, a few ({@link SOUND.alarm},
 * {@link SOUND.thruster}) are held states rather than moments, and the last group
 * ({@link CUE_SOUND}) answers a device cue rather than a world tell.
 */
export const SOUND = {
  // --- Mine ---------------------------------------------------------------
  /** A mining shot biting rock — one discrete chip. Low, grainy: stone giving way. */
  rockChip: 'rockChip',
  /** A weapon shot biting hull/turret/shield/core — one discrete hit. Bright, rude. */
  hullHit: 'hullHit',
  /** A crack stage advancing — rock giving way, one step of three. */
  rockCrack: 'rockCrack',
  /** The rock coming apart and paying out. */
  rockBurst: 'rockBurst',
  /** A chunk tractored in. Small, and up: the sound of getting something. */
  oreCollect: 'oreCollect',
  /** Hold full — "fly home" (GDD §2.3). Two notes, insistent. */
  holdFull: 'holdFull',

  // --- Fight --------------------------------------------------------------
  turretFire: 'turretFire',
  shotImpact: 'shotImpact',
  shieldHit: 'shieldHit',
  shieldDown: 'shieldDown',
  /** The core taking damage. Low, and one of the two sounds homes get. */
  coreHit: 'coreHit',
  turretDown: 'turretDown',
  /** Explosions are fireworks (GDD §4.7). */
  shipExplode: 'shipExplode',
  shipSpawn: 'shipSpawn',
  spawnPulse: 'spawnPulse',
  /** The engine, held while the throttle is open. */
  thruster: 'thruster',

  // --- Spend --------------------------------------------------------------
  buildPlaced: 'buildPlaced',
  buildComplete: 'buildComplete',
  repairTick: 'repairTick',
  bankOre: 'bankOre',
  upgradeBought: 'upgradeBought',

  // --- The clock ----------------------------------------------------------
  waveArrive: 'waveArrive',
  collapseBegin: 'collapseBegin',

  // --- The one serious thing ----------------------------------------------
  stationDeath: 'stationDeath',
  matchEnd: 'matchEnd',

  // --- Mechanics that are not moments -------------------------------------
  /** The under-attack alarm (GDD §2.2) — a mechanic, not polish. See `./alarm`. */
  alarm: 'alarm',
  /** The ambient bed (GDD §3.6). See `./ambient`. */
  ambient: 'ambient',

  // --- The adaptive soundtrack (a3) — phase-following music. See `./music` ---
  /** The calm foundation drone, on until the collapse. */
  musicBed: 'musicBed',
  /** The heartbeat that rises with the asteroid waves. */
  musicPulse: 'musicPulse',
  /** The full theme, in during a siege. */
  musicTheme: 'musicTheme',
  /** The bleak drone that replaces the bed through the collapse. */
  musicDread: 'musicDread',
  /** The sting on a win — brief, bright, and after the three-second quiet. */
  musicWin: 'musicWin',
  /** The sting on a loss — the ache, falling. */
  musicLoss: 'musicLoss',

  // --- Device cues (p4-03 seams) — answered by AudioEngine.cue, not a tell ---
  /** A wheel wedge / menu control was pressed. The lightest tick, matched to `tap`. */
  pressTick: 'pressTick',
  /** A purchase or repair committed — a rising two-beat "done", matched to `confirm`. */
  purchaseConfirm: 'purchaseConfirm',
  /** A buy the player can't afford — a low, flat nope. No haptic twin; the buzzer. */
  rejectBuzz: 'rejectBuzz',
  /** One ore chunk settling into the bank on a deposit flight — soft, conserved 1:1. */
  depositTick: 'depositTick',
  /** A tick of the respawn countdown (GDD §2.7). Clean, mid, once a second. */
  respawnBeep: 'respawnBeep',
  /** Respawn — free and fast (GDD §2.7): the ship arriving, brighter than the beeps. */
  respawnGo: 'respawnGo',
  /** A minimap ping (GDD §2.4). A rising sonar blip — locate, not alarm. */
  minimapPing: 'minimapPing',
} as const;

/** One of the {@link SOUND} names. */
export type SoundName = (typeof SOUND)[keyof typeof SOUND];

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** Loop bodies are rendered flat and joined tail-to-head (`./synth` seamless). */
const LOOP_CROSSFADE = 0.04;

/**
 * **One struck note, in the ratified material** — the world bank's half of the
 * Gantry/Bone instrument (`./ui-cues`, s6-01).
 *
 * The amended tone contract (GDD §4.7, 2026-08-06) asks for one game, not a menu
 * game and a match game: the cue set the developer chose by ear is *sine
 * partials at the inharmonic ratios 1 / 2.76 / 5.4, struck in about 2 ms, with
 * a steep rolloff and the upper partials decaying first*. Where a world tell
 * wants that exact material — a pick-up, a confirmation, an acknowledgement —
 * it says so by calling this and reusing {@link GLASS_PARTIALS}, rather than
 * re-inventing a spacing that would drift away from the ratified one.
 *
 * The constants are imported, never copied. If the handoff's ratios are ever
 * re-tuned, the world moves with the UI by construction.
 *
 * This is also what replaces `square` almost everywhere it did a *confirmation's*
 * job: a square with a low duty was a tone generator standing in for a struck
 * body, and a struck body is what the register actually wants.
 *
 * @param partials {@link GLASS_PARTIALS} (three, full) or {@link GLASS_PAIR}
 *   (two, thinner — the handoff's own choice for an answering note).
 */
function struck(
  name: string,
  freq: number,
  opts: {
    /** Peak of the fundamental; upper partials roll off from it. */
    readonly gain: number;
    /** The fundamental's decay. Each partial above it decays faster. */
    readonly decay: number;
    readonly hold?: number;
    /** Seconds from the start of the sound. */
    readonly at?: number;
    readonly partials?: readonly number[];
    readonly seed: number;
  },
): SoundLayer[] {
  return (opts.partials ?? GLASS_PARTIALS).map((ratio, i) => ({
    spec: {
      name: `${name}.p${i}`,
      wave: 'sine',
      attack: STRIKE_S,
      hold: opts.hold ?? 0.006,
      decay: opts.decay * Math.pow(PARTIAL_DECAY, i),
      freq: freq * ratio,
      gain: opts.gain / Math.pow(i + 1, PARTIAL_ROLLOFF),
      seed: opts.seed + i,
    },
    at: opts.at,
  }));
}

const SPECS: Readonly<Record<SoundName, SoundSpec>> = {
  // --- Mine ---------------------------------------------------------------

  /**
   * **A cutting tool taking a bite out of stone.** One flat percussive hit: no
   * pitch movement in it, no wobble, and the whole character in the transient.
   *
   * This is the worked example of the re-voice (GDD §4.7 amended 2026-08-06,
   * `docs/audio-revoice-spec.md` §6) and the sound the developer has judged
   * twice, so it is worth saying what changed and what did not.
   *
   * The oscillator was never the problem — rock IS broadband, and it stays
   * `noise`. What made it read as a cartoon were two parameters that made it
   * *move* the way a cartoon moves: a 22 Hz vibrato inside a 12 ms hold (a
   * wobble, not a texture) and a ×1.50 fall inside 103 ms (a chirp, not a body
   * settling). Both are gone; the punch they were decorating went up to carry
   * the hit on its own, which is where a machine keeps it.
   *
   * The pitch also comes down — the ratified s4-01 direction, *"lower in tone"*,
   * which this bank never actually received (that brief moved `./candidates`,
   * which the game does not import). Lower stops where a phone does: the audit
   * measured s4-01's own candidate at 89% of its energy below 500 Hz, and this
   * is `TELL.mineHit` firing all match on a device the mobile gate makes a
   * first-class target. So `highPass` goes UP to 130 Hz, trimming sub a phone
   * cannot emit and the mix would otherwise carry on every shot.
   *
   * Measured, shipped → here: centroid 2281 → 1815 Hz, windowed zcr 0.0483 →
   * 0.0327 (under the ratified 0.034 ceiling), energy above 500 Hz 69% → 56%,
   * RMS at the mix's 28.6 Hz retrigger ceiling 0.180 → 0.147 — a *quieter* held
   * fire, which is the point on a voice that repeats all match. The seed is
   * unchanged: same seed, same noise, so a replay hears the match (GDD §4.1).
   */
  [SOUND.rockChip]: {
    name: 'rockChip',
    wave: 'noise',
    attack: 0.0008, // a tighter strike: the transient IS the character now
    hold: 0.009,
    decay: 0.062, // ~72 ms, from 103 — a bite, not a grind
    punch: 0.55, // what the wobble and the chirp used to carry, moved here
    freq: 92,
    freqEnd: 82, // ×1.12 — a body settling, well under the chirp threshold
    lowPass: 820, // was 1150
    highPass: 130, // was 60 — sub a phone cannot emit anyway
    gain: 0.42,
    seed: 0x9e37,
  },

  // Hull hit: the same event on plate, an octave and a half up — **a round on
  // plate, not a buzz.** The saw is retired (§5.1): its documented job was
  // *"bright and rude"*, and rudeness is not the register — *cut* is, which a
  // triangle with noise mixed into it and the same high-pass gives without the
  // buzz. The spit is kept untouched: it is what puts this voice's spectral
  // centre well above the chip's, the one dimension that survives a bad phone
  // speaker, and that pair is the game's central inversion (GDD §2.3).
  [SOUND.hullHit]: {
    name: 'hullHit',
    layers: [
      {
        spec: {
          name: 'hullHit.bite',
          wave: 'triangle',
          attack: 0.001,
          hold: 0.01,
          decay: 0.06,
          punch: 0.5,
          freq: 452,
          freqEnd: 400, // ×1.13 — was ×1.69, a chirp inside 71 ms
          noiseMix: 0.22,
          highPass: 340,
          gain: 0.33,
          seed: 0x4dc3,
        },
      },
      {
        spec: {
          name: 'hullHit.spit',
          wave: 'noise',
          attack: 0.001,
          hold: 0.006,
          decay: 0.05,
          freq: 1500,
          highPass: 950,
          gain: 0.16,
          seed: 0x4dc4,
        },
      },
    ],
  },

  [SOUND.rockCrack]: {
    name: 'rockCrack',
    wave: 'noise',
    attack: 0.002,
    hold: 0.012,
    decay: 0.1,
    punch: 0.4,
    freq: 260,
    freqEnd: 120,
    lowPass: 2400,
    gain: 0.4,
    seed: 0x1a2b,
  },

  [SOUND.rockBurst]: {
    name: 'rockBurst',
    layers: [
      {
        // The rock letting go.
        spec: {
          name: 'rockBurst.crumble',
          wave: 'noise',
          attack: 0.003,
          hold: 0.05,
          decay: 0.34,
          punch: 0.5,
          freq: 340,
          freqEnd: 90,
          lowPass: 2600,
          gain: 0.5,
          seed: 0x33aa,
        },
      },
      // …and the payout glinting out of it: yellow means ore, and it is still
      // the one thing in this sound that goes *up* (style-guide §2). It was a
      // square gliding up a minor seventh; the rise is now two struck notes
      // instead of one bent one, which says the same thing without the chirp.
      ...struck('rockBurst.ore', 784, { gain: 0.22, decay: 0.1, hold: 0.02, at: 0.05, partials: GLASS_PAIR, seed: 0x33ab }),
      ...struck('rockBurst.glint', 1174.66, { gain: 0.18, decay: 0.12, hold: 0.02, at: 0.11, partials: GLASS_PAIR, seed: 0x33ae }),
    ],
  },

  /**
   * A chunk tractored in: **one clean struck note at a fixed pitch**.
   *
   * It was a square with duty 0.3 chirping up a fifth — a coin blip, and the
   * single clearest example of the retired register doing an economy's job.
   * *Getting something* now reads as a machine registering it.
   *
   * The pitch is fixed because the register has no pitch bends in it, and the
   * *up* the chirp used to carry is expressed instead as **register**: this note
   * sits a fifth and an octave above {@link SOUND.depositTick}, which is the
   * same information (picked up vs put down) held in the one dimension a phone
   * speaker still reproduces. That pair is the tightest in the bank and both
   * halves of it are re-voiced here, so it is guarded by name in `audio.test.ts`.
   */
  [SOUND.oreCollect]: {
    name: 'oreCollect',
    layers: [...struck('oreCollect', 1046.5, { gain: 0.2, decay: 0.07, hold: 0.014, seed: 0xf2d2 })],
  },

  /**
   * Hold full — *"fly home"* (GDD §2.3). Two notes, insistent.
   *
   * The **interval and the insistence are the tell** and both are kept exactly:
   * A5 then D6, a rising fourth, 110 ms apart. Only the oscillator changes —
   * two struck notes where two squares were. A pair of squares a fourth apart is
   * a game telling you something; the same pair struck is a machine telling you
   * the same thing, which is the whole amendment in one sound.
   */
  [SOUND.holdFull]: {
    name: 'holdFull',
    layers: [
      ...struck('holdFull.a', 880, { gain: 0.26, decay: 0.06, hold: 0.05, seed: 0xf2d3 }),
      ...struck('holdFull.b', 1174.66, { gain: 0.26, decay: 0.1, hold: 0.05, at: 0.11, seed: 0xf2d4 }),
    ],
  },

  // --- Fight --------------------------------------------------------------

  /**
   * **A coil discharging.** The single most arcade voice in the bank before the
   * re-voice, and the clearest illustration of what the amended §4.7 is asking
   * for: a duty-swept square falling four-to-one in 86 ms is a 1980s cabinet
   * laser, and every part of that sentence is an idiom rather than a sound a
   * machine makes. The sweep is gone, the slide is gone, the square is gone.
   *
   * What replaces them is the event itself, in two layers: a low tonal **body**
   * that is the coil dumping its charge, and a short band-limited **arc** over
   * the top of it that is the discharge crossing the gap. Neither one moves in
   * pitch. It stays low on purpose — the pair it must never be confused with is
   * `shotImpact` (*a turret fired at me* vs *something landed on me*), and low
   * is the dimension that separates them.
   */
  [SOUND.turretFire]: {
    name: 'turretFire',
    layers: [
      {
        spec: {
          name: 'turretFire.body',
          wave: 'triangle',
          attack: 0.001,
          hold: 0.012,
          decay: 0.072,
          punch: 0.6,
          freq: 174.61,
          noiseMix: 0.2, // grit on the body, not a second oscillator
          lowPass: 1300,
          gain: 0.32,
          seed: 0x7e88,
        },
      },
      {
        spec: {
          name: 'turretFire.arc',
          wave: 'noise',
          attack: 0.0006,
          hold: 0.006,
          decay: 0.05,
          punch: 0.5,
          freq: 780,
          lowPass: 2600, // banded, not a hiss: an arc, not a spray
          highPass: 420,
          gain: 0.18,
          seed: 0x7e8b,
        },
      },
    ],
  },

  [SOUND.shotImpact]: {
    name: 'shotImpact',
    wave: 'noise',
    attack: 0.001,
    hold: 0.006,
    decay: 0.05,
    freq: 900,
    freqEnd: 300,
    highPass: 400,
    gain: 0.22,
    seed: 0xb23a,
  },

  // Shimmer: a bell that rings a moment and fades. Struck, not broken.
  [SOUND.shieldHit]: {
    name: 'shieldHit',
    layers: [
      {
        spec: {
          name: 'shieldHit.ring',
          wave: 'sine',
          attack: 0.002,
          hold: 0.03,
          decay: 0.28,
          freq: 1320,
          freqEnd: 1180,
          vibratoDepth: 0.02,
          vibratoRate: 14,
          gain: 0.24,
          seed: 0x4dc5,
        },
      },
      {
        spec: {
          name: 'shieldHit.skin',
          wave: 'sine',
          attack: 0.002,
          hold: 0.02,
          decay: 0.14,
          freq: 660,
          gain: 0.14,
          seed: 0x4dc6,
        },
      },
    ],
  },

  // Pressure beat regeneration (GDD §2.6): the bubble failing, and falling.
  //
  // **The ×6.92 fall stays.** A bubble failing *is* a collapse, it runs over
  // 544 ms where a glide reads as a fall rather than as a chirp, and §5.4 exempts
  // it by construction — a reviewer who "fixes" this glide has removed the
  // mechanic. Only the oscillator moves: triangle with noise mixed in, same
  // envelope, same glide, same level.
  [SOUND.shieldDown]: {
    name: 'shieldDown',
    layers: [
      {
        spec: {
          name: 'shieldDown.fall',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.04,
          decay: 0.5,
          freq: 900,
          freqEnd: 130,
          noiseMix: 0.06,
          lowPass: 2400,
          gain: 0.36,
          seed: 0x4dc7,
        },
      },
      {
        // The burst. Its own ×3.25 glide *was* inside 171 ms, which is a chirp
        // by the same rule the fall is exempt from; the fall underneath is what
        // carries the drop, so the pop only has to be the transient.
        spec: {
          name: 'shieldDown.pop',
          wave: 'noise',
          attack: 0.001,
          hold: 0.01,
          decay: 0.16,
          freq: 460,
          freqEnd: 400,
          lowPass: 2800, // banded, so the burst is pressure rather than hiss
          gain: 0.24,
          seed: 0x4dc8,
        },
      },
    ],
  },

  // Homes are the one serious thing: this drops instead of blipping, and it is
  // the sound the alarm is built on top of (GDD §2.2).
  [SOUND.coreHit]: {
    name: 'coreHit',
    layers: [
      {
        spec: {
          name: 'coreHit.thud',
          wave: 'sine',
          attack: 0.002,
          hold: 0.03,
          decay: 0.3,
          punch: 0.5,
          freq: 150,
          freqEnd: 62,
          gain: 0.46,
          seed: 0xb23b,
        },
      },
      {
        spec: {
          name: 'coreHit.tear',
          wave: 'noise',
          attack: 0.001,
          hold: 0.012,
          decay: 0.12,
          freq: 420,
          freqEnd: 150,
          lowPass: 1800,
          gain: 0.2,
          seed: 0xb23c,
        },
      },
    ],
  },

  [SOUND.turretDown]: {
    name: 'turretDown',
    layers: [
      {
        spec: {
          name: 'turretDown.crumple',
          wave: 'noise',
          attack: 0.002,
          hold: 0.03,
          decay: 0.3,
          punch: 0.4,
          freq: 300,
          freqEnd: 80,
          lowPass: 2000,
          gain: 0.36,
          seed: 0x7e89,
        },
      },
      {
        spec: {
          name: 'turretDown.clang',
          wave: 'triangle',
          attack: 0.002,
          hold: 0.02,
          decay: 0.22,
          freq: 380,
          freqEnd: 190,
          gain: 0.18,
          seed: 0x7e8a,
        },
        at: 0.04,
      },
    ],
  },

  /**
   * **A pressure failure**, in the amended contract's own words (GDD §4.7): *"a
   * hard concussive front, a metallic shear, debris settling. No sparkle."*
   *
   * The retired paragraph said *"explosions are fireworks"* and this sound was
   * that sentence implemented — a bang with a bright square trill sparkling over
   * the top of it. The `sparkle` layer is **deleted rather than re-voiced**: it
   * had no job except to be a firework, and the contract that asked for one is
   * gone. Nothing replaces it in kind; what stands where it stood is a **shear**,
   * a short band of filtered noise that decays fast — plate letting go, not
   * light going up.
   *
   * The `boom` is untouched. A concussive front was always the right sound; it
   * is `noise`, which §5.2 keeps wherever the thing making the sound is
   * genuinely broadband, and an explosion is the definition of that.
   */
  [SOUND.shipExplode]: {
    name: 'shipExplode',
    layers: [
      {
        // The concussive front. Unchanged — this was never the arcade half.
        spec: {
          name: 'shipExplode.boom',
          wave: 'noise',
          attack: 0.002,
          hold: 0.06,
          decay: 0.5,
          punch: 0.7,
          freq: 420,
          freqEnd: 60,
          lowPass: 2200,
          gain: 0.34,
          seed: 0xdead,
        },
      },
      {
        // The hull failing: was a square with duty 0.2 falling ×5.50 — a tone
        // generator doing an impact's job. Filtered noise does the job itself.
        spec: {
          name: 'shipExplode.crack',
          wave: 'noise',
          attack: 0.001,
          hold: 0.014,
          decay: 0.1,
          punch: 0.6,
          freq: 480,
          freqEnd: 420,
          lowPass: 3000,
          highPass: 300,
          gain: 0.24,
          seed: 0xdeae,
        },
      },
      {
        // The metallic shear, in the sparkle's place: a band of noise up where
        // torn plate rings, gone almost immediately. It does not rise.
        spec: {
          name: 'shipExplode.shear',
          wave: 'noise',
          attack: 0.002,
          hold: 0.02,
          decay: 0.16,
          freq: 2400,
          lowPass: 5200,
          highPass: 1600,
          gain: 0.15,
          seed: 0xdeaf,
        },
        at: 0.07,
      },
    ],
  },

  /**
   * Free and fast (GDD §2.7): **arriving, not powering up.** The two-part shape
   * is kept — something approaches, something lands — because that shape is the
   * tell; what goes is the ×4.00 sweep over 340 ms, which is a power-up and not
   * an arrival, and the square that terminated it.
   *
   * The approach is now a low filtered swell rather than a rocketing glide, and
   * the landing is a struck note: a ship setting down on a pad.
   */
  [SOUND.shipSpawn]: {
    name: 'shipSpawn',
    layers: [
      {
        spec: {
          name: 'shipSpawn.rise',
          wave: 'triangle',
          attack: 0.03,
          hold: 0.06,
          decay: 0.17, // 260 ms — long enough that its glide is a move, not a chirp
          freq: 175,
          freqEnd: 350,
          noiseMix: 0.12,
          lowPass: 1200,
          gain: 0.26,
          seed: 0x3d7b,
        },
      },
      ...struck('shipSpawn.land', 1046.5, { gain: 0.2, decay: 0.14, hold: 0.02, at: 0.2, partials: GLASS_PAIR, seed: 0x3d7c }),
    ],
  },

  // Ten seconds of protection, ticking (GDD §2.1). Quiet on purpose: it repeats.
  [SOUND.spawnPulse]: {
    name: 'spawnPulse',
    wave: 'sine',
    attack: 0.006,
    hold: 0.02,
    decay: 0.12,
    freq: 1046,
    freqEnd: 1320,
    gain: 0.1,
    seed: 0x22d3,
  },

  [SOUND.thruster]: {
    name: 'thruster',
    loop: true,
    crossfade: LOOP_CROSSFADE,
    layers: [
      {
        spec: {
          name: 'thruster.roar',
          wave: 'noise',
          attack: 0,
          hold: 0.4,
          decay: 0,
          freq: 210,
          lowPass: 900,
          highPass: 60,
          gain: 0.3,
          seed: 0x5c6c,
        },
      },
      {
        spec: {
          name: 'thruster.hum',
          wave: 'triangle',
          attack: 0,
          hold: 0.4,
          decay: 0,
          freq: 88,
          noiseMix: 0.15,
          lowPass: 700,
          gain: 0.16,
          seed: 0x5c6d,
        },
      },
    ],
  },

  // --- Spend --------------------------------------------------------------

  // Ore is gone and only time remains (GDD §2.5): a latch, not a fanfare — which
  // was already the right idea in the right register, so only the oscillator was
  // wrong. The clunk was a plain square with duty 0.5 standing in for a body;
  // it is a filtered triangle with grit in it now, which is the body itself.
  [SOUND.buildPlaced]: {
    name: 'buildPlaced',
    layers: [
      {
        spec: {
          name: 'buildPlaced.clunk',
          wave: 'triangle',
          attack: 0.003,
          hold: 0.02,
          decay: 0.1,
          freq: 196,
          freqEnd: 176, // ×1.11 — a body settling, not a fall
          noiseMix: 0.18,
          lowPass: 1500,
          gain: 0.34,
          seed: 0x4fa0,
        },
      },
      {
        // The latch itself. Untouched but for its glide: a ×2.58 fall inside
        // 69 ms was a chirp, and the snap was never coming from it — it comes
        // from the transient and the high-pass.
        spec: {
          name: 'buildPlaced.latch',
          wave: 'noise',
          attack: 0.001,
          hold: 0.008,
          decay: 0.06,
          freq: 620,
          freqEnd: 530,
          highPass: 300,
          lowPass: 3400, // banded: the latch is a snap, not the whole sound
          gain: 0.13,
          seed: 0x4fa1,
        },
        at: 0.03,
      },
    ],
  },

  // The defence a player paid for, arriving: a rising perfect fifth.
  [SOUND.buildComplete]: {
    name: 'buildComplete',
    layers: [
      {
        spec: {
          name: 'buildComplete.a',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.05,
          decay: 0.09,
          freq: 523,
          gain: 0.28,
          seed: 0x4fa2,
        },
      },
      {
        spec: {
          name: 'buildComplete.b',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.06,
          decay: 0.18,
          freq: 784,
          gain: 0.28,
          seed: 0x4fa3,
        },
        at: 0.09,
      },
    ],
  },

  // Patina is the repair colour (style-guide §1) and this is its sound: a soft
  // tick you notice mostly when it *stops*, because a hit interrupted it.
  [SOUND.repairTick]: {
    name: 'repairTick',
    wave: 'sine',
    attack: 0.008,
    hold: 0.02,
    decay: 0.13,
    freq: 392,
    freqEnd: 523,
    gain: 0.14,
    seed: 0x4fa4,
  },

  /**
   * The hold emptying into the reactor: two struck notes, **falling** — ore
   * coming to rest, which is the interval the two squares here always carried
   * and the one thing about this sound that had to survive the re-voice.
   */
  [SOUND.bankOre]: {
    name: 'bankOre',
    layers: [
      ...struck('bankOre.drop', 880, { gain: 0.24, decay: 0.09, hold: 0.02, seed: 0xf2d5 }),
      ...struck('bankOre.settle', 587.33, { gain: 0.2, decay: 0.16, hold: 0.02, at: 0.08, partials: GLASS_PAIR, seed: 0xf2d8 }),
    ],
  },

  /**
   * The half of the economy a player can most easily miss (GDD §2.10) — so when
   * they do find it, it is the brightest confirmation in the bank.
   *
   * It used to be that by being a jsfxr arpeggio: a square with `arpMul` 1.5
   * (the synth's own comment calls it *"the arcade 'blip up'"*) restarted every
   * 140 ms as a trill. Both idioms are retired outright by the amended contract,
   * and neither has a non-arcade use.
   *
   * Now it is **three struck notes rising** — an A-minor triad, the key the
   * soundtrack and the ambient bed already sit in, so a purchase harmonises with
   * the room it lands in instead of cutting across it. Minor rather than major
   * on purpose: this is a machine acknowledging a spend, not a game cheering.
   *
   * It deliberately borrows the *shape* of the ratified `purchase` UI cue
   * without becoming it — that one is three notes at A♭6/E♭7/A♭7 rising a fifth
   * then a fourth. This is a world tell, an octave lower and on different
   * intervals, so a player who buys from the wheel hears the UI answer their
   * finger and the world answer the spend, and can still tell the two apart.
   */
  [SOUND.upgradeBought]: {
    name: 'upgradeBought',
    layers: [
      ...struck('upgradeBought.a', 880, { gain: 0.24, decay: 0.14, hold: 0.02, partials: GLASS_PAIR, seed: 0x9b5d }),
      ...struck('upgradeBought.b', 1046.5, { gain: 0.24, decay: 0.14, hold: 0.02, at: 0.08, partials: GLASS_PAIR, seed: 0x9b60 }),
      ...struck('upgradeBought.c', 1318.51, { gain: 0.26, decay: 0.24, hold: 0.02, at: 0.16, seed: 0x9b63 }),
    ],
  },

  // --- The clock ----------------------------------------------------------

  // The metronome of the match (GDD §2.3). Two low notes, like a foghorn: the
  // field just moved closer to the middle and everyone is nearer everyone.
  //
  // **The two notes and their pitches are the mechanic**, so they are kept to the
  // Hz. Only the saw goes: filtered triangles with low noise air in them, which
  // is the same signal without the buzz. This one is watched — the alarm keeps
  // its saw (§5.1) and the saw was the thing separating these two most, so
  // `audio.test.ts` guards the alarm/waveArrive pair by name.
  [SOUND.waveArrive]: {
    name: 'waveArrive',
    layers: [
      {
        spec: {
          name: 'waveArrive.horn',
          wave: 'triangle',
          attack: 0.03,
          hold: 0.22,
          decay: 0.3,
          freq: 147,
          vibratoDepth: 0.015,
          vibratoRate: 6, // 550 ms voice: drift, not a wobble (§5.4 exempt)
          noiseMix: 0.12,
          lowPass: 1400,
          gain: 0.36,
          seed: 0xff8a,
        },
      },
      {
        spec: {
          name: 'waveArrive.fifth',
          wave: 'triangle',
          attack: 0.03,
          hold: 0.2,
          decay: 0.4,
          freq: 220,
          noiseMix: 0.1,
          lowPass: 1600,
          gain: 0.24,
          seed: 0xff8b,
        },
        at: 0.18,
      },
    ],
  },

  // No regeneration, no repair, no new ore (GDD §2.3): entropy arriving.
  [SOUND.collapseBegin]: {
    name: 'collapseBegin',
    layers: [
      {
        spec: {
          name: 'collapseBegin.rumble',
          wave: 'noise',
          attack: 0.4,
          hold: 0.5,
          decay: 1.4,
          freq: 96,
          freqEnd: 40,
          lowPass: 420,
          gain: 0.5,
          seed: 0x0d10,
        },
      },
      {
        spec: {
          name: 'collapseBegin.drone',
          wave: 'sine',
          attack: 0.5,
          hold: 0.6,
          decay: 1.2,
          freq: 73,
          freqEnd: 55,
          gain: 0.3,
          seed: 0x0d11,
        },
      },
    ],
  },

  // --- The one serious thing ----------------------------------------------

  /**
   * The station-death sound (GDD §4.7). Everything the arcade half of the bank
   * does, this one refuses to do: it does not blip, it does not sparkle, and it
   * does not resolve. A long fall and a low tail — and then the mix goes to
   * zero underneath it for three seconds (`../vfx/death-moment`), so the sound
   * a player actually remembers is the silence after it.
   */
  [SOUND.stationDeath]: {
    name: 'stationDeath',
    layers: [
      {
        spec: {
          name: 'stationDeath.fall',
          wave: 'sine',
          attack: 0.01,
          hold: 0.2,
          decay: 1.1,
          punch: 0.4,
          freq: 210,
          freqEnd: 34,
          gain: 0.42,
          seed: 0x2f34,
        },
      },
      {
        spec: {
          name: 'stationDeath.crust',
          wave: 'noise',
          attack: 0.02,
          hold: 0.3,
          decay: 1.0,
          freq: 180,
          freqEnd: 45,
          lowPass: 900,
          gain: 0.28,
          seed: 0x2f35,
        },
      },
      {
        spec: {
          name: 'stationDeath.toll',
          wave: 'triangle',
          attack: 0.006,
          hold: 0.06,
          decay: 0.9,
          freq: 98,
          freqEnd: 92,
          gain: 0.26,
          seed: 0x2f36,
        },
        at: 0.12,
      },
    ],
  },

  [SOUND.matchEnd]: {
    name: 'matchEnd',
    layers: [
      {
        spec: {
          name: 'matchEnd.a',
          wave: 'triangle',
          attack: 0.01,
          hold: 0.14,
          decay: 0.3,
          freq: 392,
          gain: 0.3,
          seed: 0xdce3,
        },
      },
      {
        spec: {
          name: 'matchEnd.b',
          wave: 'triangle',
          attack: 0.01,
          hold: 0.14,
          decay: 0.4,
          freq: 523,
          gain: 0.28,
          seed: 0xdce4,
        },
        at: 0.12,
      },
      {
        spec: {
          name: 'matchEnd.c',
          wave: 'triangle',
          attack: 0.01,
          hold: 0.2,
          decay: 0.8,
          freq: 784,
          gain: 0.26,
          seed: 0xdce5,
        },
        at: 0.24,
      },
    ],
  },

  // --- Mechanics that are not moments -------------------------------------

  /**
   * **The under-attack alarm** (GDD §2.2), and the design says exactly what it
   * has to be: *"an unmistakable alarm."* It is listed as a mechanic, not
   * polish, and it is on the not-cuttable list (§4.9).
   *
   * Two rising klaxon tones, the second a minor third above the first — the
   * interval every emergency signal ever built uses, because it is the one that
   * refuses to sound like music. It loops for as long as the pressure lasts
   * (`./alarm`), so the body is a single bar with no silence at the seam.
   */
  [SOUND.alarm]: {
    name: 'alarm',
    loop: true,
    crossfade: 0.02,
    layers: [
      {
        spec: {
          name: 'alarm.low',
          wave: 'saw',
          attack: 0.012,
          hold: 0.16,
          decay: 0.1,
          freq: 494,
          freqEnd: 587,
          lowPass: 3200,
          gain: 0.46,
          seed: 0xb23d,
        },
      },
      {
        spec: {
          name: 'alarm.high',
          wave: 'saw',
          attack: 0.012,
          hold: 0.16,
          decay: 0.14,
          freq: 587,
          freqEnd: 698,
          lowPass: 3400,
          gain: 0.46,
          seed: 0xb23e,
        },
        at: 0.3,
      },
    ],
  },

  /**
   * **The ambient loop** (GDD §3.6). Cold Vacuum as a sound: a low bed with a
   * slow beat in it, and no melody — this plays for fifteen minutes and must
   * never become something a player notices twice.
   *
   * It is item 3 on the ranked cut list (GDD §4.9), unlike the SFX and the alarm
   * either side of it, which are mechanics. Built to be cuttable: nothing else
   * in the mix depends on it.
   */
  [SOUND.ambient]: {
    name: 'ambient',
    loop: true,
    crossfade: 0.6,
    layers: [
      {
        spec: {
          name: 'ambient.bed',
          wave: 'sine',
          attack: 0,
          hold: 8,
          decay: 0,
          freq: 55,
          vibratoDepth: 0.004,
          vibratoRate: 0.125,
          gain: 0.3,
          seed: 0x0d12,
        },
      },
      {
        // Detuned a hair from the bed: the two drift in and out of phase over
        // several seconds, which is the whole "slow beat" and costs one voice.
        spec: {
          name: 'ambient.detune',
          wave: 'sine',
          attack: 0,
          hold: 8,
          decay: 0,
          freq: 55.35,
          gain: 0.22,
          seed: 0x0d13,
        },
      },
      {
        spec: {
          name: 'ambient.fifth',
          wave: 'triangle',
          attack: 0,
          hold: 8,
          decay: 0,
          freq: 82.5,
          vibratoDepth: 0.003,
          vibratoRate: 0.0833,
          lowPass: 700,
          gain: 0.12,
          seed: 0x0d14,
        },
      },
      {
        // Vacuum hiss, way down. Gives the bed an air so it is not a test tone.
        spec: {
          name: 'ambient.wash',
          wave: 'noise',
          attack: 0,
          hold: 8,
          decay: 0,
          freq: 40,
          lowPass: 320,
          highPass: 40,
          gain: 0.07,
          seed: 0x0d15,
        },
      },
    ],
  },

  // --- The adaptive soundtrack (a3) ---------------------------------------
  //
  // Cold Vacuum has an ache under it (style-guide §8), so the soundtrack lives
  // in A minor and harmonises with the ambient bed's A rather than fighting it.
  // Every stem loops, so at least one voice in each is *sustained* (no decay to
  // silence at the loop point) — a stem that faded to zero at its edges would
  // pulse once per lap, the one artefact `../synth` seamless exists to kill.

  /**
   * The calm foundation drone: a low minor triad. The minor third is the ache —
   * it is the one interval the ambient bed does not have, so the soundtrack reads
   * as *music over* the atmosphere rather than a second copy of it.
   */
  [SOUND.musicBed]: {
    name: 'musicBed',
    loop: true,
    crossfade: 0.5,
    layers: [
      {
        spec: {
          name: 'musicBed.root',
          wave: 'triangle',
          attack: 0,
          hold: 8,
          decay: 0,
          freq: 55,
          vibratoDepth: 0.004,
          vibratoRate: 0.1,
          lowPass: 600,
          gain: 0.22,
          seed: 0xa300,
        },
      },
      {
        spec: {
          name: 'musicBed.third',
          wave: 'sine',
          attack: 0,
          hold: 8,
          decay: 0,
          freq: 65.41,
          vibratoDepth: 0.006,
          vibratoRate: 0.083,
          gain: 0.16,
          seed: 0xa301,
        },
      },
      {
        spec: {
          name: 'musicBed.fifth',
          wave: 'sine',
          attack: 0,
          hold: 8,
          decay: 0,
          freq: 82.41,
          gain: 0.12,
          seed: 0xa302,
        },
      },
    ],
  },

  /**
   * The heartbeat: a low kick once per lap over a near-silent sub-drone, so the
   * loop reads as a driving pulse rather than a held note. It fades in with the
   * asteroid waves — the metronome of the match made a metronome (GDD §2.3).
   */
  [SOUND.musicPulse]: {
    name: 'musicPulse',
    loop: true,
    crossfade: 0.04,
    layers: [
      {
        // A quiet sustained floor so the loop's edges are never silent.
        spec: {
          name: 'musicPulse.floor',
          wave: 'triangle',
          attack: 0,
          hold: 0.7,
          decay: 0,
          freq: 55,
          lowPass: 400,
          gain: 0.08,
          seed: 0xa310,
        },
      },
      {
        spec: {
          name: 'musicPulse.kick',
          wave: 'sine',
          attack: 0.004,
          hold: 0.02,
          decay: 0.5,
          punch: 0.7,
          freq: 110,
          freqEnd: 44,
          gain: 0.3,
          seed: 0xa311,
        },
      },
      {
        spec: {
          name: 'musicPulse.tick',
          wave: 'triangle',
          attack: 0.002,
          hold: 0.01,
          decay: 0.08,
          freq: 220,
          gain: 0.1,
          seed: 0xa312,
        },
      },
    ],
  },

  /**
   * The full theme: a short A-minor riff over a sustained pad, in during a siege
   * (GDD §2.6). Arcade but restrained — square notes for the tune, a triangle pad
   * to sit them on — because the theme has to lift a fight without becoming a
   * cartoon over a station that is dying.
   */
  [SOUND.musicTheme]: {
    name: 'musicTheme',
    loop: true,
    crossfade: 0.08,
    layers: [
      {
        // The pad sets the 4-second loop length and sustains (no decay) so the
        // seam is never a silent edge.
        spec: {
          name: 'musicTheme.pad',
          wave: 'triangle',
          attack: 0.02,
          hold: 3.98,
          decay: 0,
          freq: 110,
          vibratoDepth: 0.005,
          vibratoRate: 0.2,
          lowPass: 1200,
          gain: 0.14,
          seed: 0xa320,
        },
      },
      { spec: { name: 'musicTheme.n0', wave: 'triangle', attack: 0.004, hold: 0.08, decay: 0.22, freq: 220, gain: 0.15, seed: 0xa321 }, at: 0 },
      { spec: { name: 'musicTheme.n1', wave: 'triangle', attack: 0.004, hold: 0.08, decay: 0.22, freq: 261.63, gain: 0.15, seed: 0xa322 }, at: 0.5 },
      { spec: { name: 'musicTheme.n2', wave: 'triangle', attack: 0.004, hold: 0.1, decay: 0.26, freq: 329.63, gain: 0.15, seed: 0xa323 }, at: 1 },
      { spec: { name: 'musicTheme.n3', wave: 'triangle', attack: 0.004, hold: 0.1, decay: 0.3, freq: 293.66, gain: 0.14, seed: 0xa324 }, at: 1.5 },
      { spec: { name: 'musicTheme.n4', wave: 'triangle', attack: 0.004, hold: 0.1, decay: 0.3, freq: 261.63, gain: 0.14, seed: 0xa325 }, at: 2.1 },
      { spec: { name: 'musicTheme.n5', wave: 'triangle', attack: 0.006, hold: 0.14, decay: 0.5, freq: 220, gain: 0.13, seed: 0xa326 }, at: 2.7 },
      { spec: { name: 'musicTheme.n6', wave: 'triangle', attack: 0.006, hold: 0.2, decay: 0.4, freq: 164.81, gain: 0.12, seed: 0xa327 }, at: 3.3 },
    ],
  },

  /**
   * The collapse's own voice: a low drone with a semitone clash beating against
   * it and a sub underneath, everything rolled off. No melody, no resolution —
   * entropy arriving (GDD §2.3). The director thins the bed, pulse and theme out
   * and brings this up, which is the "thinning dread" of the brief.
   */
  [SOUND.musicDread]: {
    name: 'musicDread',
    loop: true,
    crossfade: 0.4,
    layers: [
      {
        spec: {
          name: 'musicDread.low',
          wave: 'triangle',
          attack: 0,
          hold: 6,
          decay: 0,
          freq: 55,
          lowPass: 500,
          gain: 0.2,
          seed: 0xa330,
        },
      },
      {
        // A hair sharp of the low: the two beat slowly against each other, which
        // is the unease, and it costs one voice.
        spec: {
          name: 'musicDread.clash',
          wave: 'sine',
          attack: 0,
          hold: 6,
          decay: 0,
          freq: 58.3,
          gain: 0.14,
          seed: 0xa331,
        },
      },
      {
        spec: {
          name: 'musicDread.sub',
          wave: 'sine',
          attack: 0,
          hold: 6,
          decay: 0,
          freq: 41,
          gain: 0.12,
          seed: 0xa332,
        },
      },
      {
        spec: {
          name: 'musicDread.air',
          wave: 'noise',
          attack: 0,
          hold: 6,
          decay: 0,
          freq: 30,
          lowPass: 260,
          gain: 0.05,
          seed: 0xa333,
        },
      },
    ],
  },

  /**
   * The win sting: a rising major arpeggio, bright and quickly over — a firework
   * for the surface (GDD §4.7), not a fanfare. Held back until the three-second
   * quiet has lifted (`./music`), so it lands *after* the silence.
   */
  [SOUND.musicWin]: {
    name: 'musicWin',
    layers: [
      { spec: { name: 'musicWin.n0', wave: 'triangle', attack: 0.006, hold: 0.06, decay: 0.16, freq: 220, gain: 0.24, seed: 0xa340 }, at: 0 },
      { spec: { name: 'musicWin.n1', wave: 'triangle', attack: 0.006, hold: 0.06, decay: 0.16, freq: 277.18, gain: 0.24, seed: 0xa341 }, at: 0.14 },
      { spec: { name: 'musicWin.n2', wave: 'triangle', attack: 0.006, hold: 0.06, decay: 0.18, freq: 329.63, gain: 0.24, seed: 0xa342 }, at: 0.28 },
      { spec: { name: 'musicWin.n3', wave: 'triangle', attack: 0.006, hold: 0.14, decay: 0.5, freq: 440, gain: 0.28, seed: 0xa343 }, at: 0.42 },
      { spec: { name: 'musicWin.shine', wave: 'triangle', attack: 0.01, hold: 0.1, decay: 0.4, freq: 880, gain: 0.12, seed: 0xa344 }, at: 0.42 },
    ],
  },

  /**
   * The loss sting: a falling minor phrase that settles low and stops. The ache,
   * with no arcade left on top of it — the one thing in the soundtrack that is
   * allowed to be sad.
   */
  [SOUND.musicLoss]: {
    name: 'musicLoss',
    layers: [
      { spec: { name: 'musicLoss.n0', wave: 'triangle', attack: 0.008, hold: 0.1, decay: 0.2, freq: 220, gain: 0.22, seed: 0xa350 }, at: 0 },
      { spec: { name: 'musicLoss.n1', wave: 'triangle', attack: 0.008, hold: 0.1, decay: 0.24, freq: 174.61, gain: 0.22, seed: 0xa351 }, at: 0.24 },
      { spec: { name: 'musicLoss.n2', wave: 'sine', attack: 0.008, hold: 0.12, decay: 0.5, freq: 146.83, gain: 0.24, seed: 0xa352 }, at: 0.5 },
      { spec: { name: 'musicLoss.low', wave: 'sine', attack: 0.01, hold: 0.14, decay: 0.42, freq: 110, gain: 0.22, seed: 0xa353 }, at: 0.62 },
    ],
  },

  // --- Device cues (p4-03 seams) ------------------------------------------
  //
  // These answer a finger, not a world diff, and they borrow the haptic
  // vocabulary's rhythm (`src/platform/haptics.ts`) so the buzz and the blip land
  // together: `tap` is a whisper, `confirm` a two-beat, and so on. Kept quiet and
  // short — a control the player works dozens of times a match must never nag.

  /**
   * `tap` (10 ms whisper): the lightest possible click that a press registered.
   *
   * It is now **one struck note at the family root, A♭6** — deliberately the same
   * pitch and the same material as the ratified `pick` cue (`./ui-cues`), so the
   * fallback and the cue a player actually hears agree instead of diverging. A
   * device with no cue player should sound like a quieter version of the game,
   * not a different one.
   */
  [SOUND.pressTick]: {
    name: 'pressTick',
    layers: [...struck('pressTick', 1661, { gain: 0.1, decay: 0.022, hold: 0.005, seed: 0x7a70 })],
  },

  // `confirm` ([12, 40, 12]): a rising perfect fourth, the two beats spaced to the
  // haptic's 40 ms gap so finger and ear read one "done", not two events.
  [SOUND.purchaseConfirm]: {
    name: 'purchaseConfirm',
    layers: [
      {
        spec: {
          name: 'purchaseConfirm.a',
          wave: 'triangle',
          attack: 0.003,
          hold: 0.03,
          decay: 0.07,
          freq: 659.25,
          gain: 0.24,
          seed: 0x7a71,
        },
      },
      {
        spec: {
          name: 'purchaseConfirm.b',
          wave: 'triangle',
          attack: 0.003,
          hold: 0.04,
          decay: 0.12,
          freq: 987.77,
          gain: 0.24,
          seed: 0x7a72,
        },
        at: 0.052,
      },
    ],
  },

  /**
   * **Two notes a minor second apart, resolving nowhere** — the amended §4.7
   * writes this asset out by hand, and the ratified `refused` cue (`./ui-cues`)
   * is already exactly that. This is its fallback, so it is built to the same
   * shape at the same pitches: A♭6 and the minor second above it, beating
   * against each other, over the same low body that keeps it from floating.
   *
   * It was a saw — *"the nope"*, a buzzer. Recognisable as the family and
   * unmistakably not a yes is a better refusal than a buzz, and it moves this
   * voice UP and away from {@link SOUND.coreHit}, which is the pair §8 flags:
   * *a refused buy* and *your reactor is being eaten* were ×1.12 apart.
   *
   * Still no haptic twin — a rejected buy is the one cue the motor stays out of
   * — so the ear carries it alone.
   */
  [SOUND.rejectBuzz]: {
    name: 'rejectBuzz',
    layers: [
      ...struck('rejectBuzz.a', 1661, { gain: 0.14, decay: 0.09, hold: 0.03, partials: GLASS_PAIR, seed: 0xb23f }),
      ...struck('rejectBuzz.b', 1760, { gain: 0.14, decay: 0.09, hold: 0.03, at: 0.05, partials: GLASS_PAIR, seed: 0xb241 }),
      {
        // The body under the pair — the `refused` cue's own sub, which is what
        // stops two high struck notes reading as a chime.
        spec: {
          name: 'rejectBuzz.body',
          wave: 'sine',
          attack: 0.003,
          hold: 0.03,
          decay: 0.1,
          freq: 84,
          freqEnd: 80,
          gain: 0.13,
          seed: 0xb243,
        },
      },
    ],
  },

  /**
   * Ore settling into the bank, one chunk at a time — the deposit twin of
   * {@link SOUND.oreCollect}, softer and lower, because it is coming to rest
   * rather than being won. One tick per chunk, conserved 1:1 like the sprites; a
   * burst thins to a stream through the mix's repeat-gap (`./graph`), exactly as
   * a wave of ore-collects does.
   *
   * Both halves of this pair were `square` and both are re-voiced, which makes
   * it the one place in the pass where a converging palette could genuinely cost
   * the player information: at ×1.13 apart in spectral centre it was the tightest
   * pair in the bank. The *falling* it used to carry as a chirp is now carried by
   * **register** — the same struck material as its twin, a fifth and an octave
   * below it — and the thinner two-partial form of the instrument, which is the
   * handoff's own choice for a note that answers rather than announces.
   *
   * Measured after the re-voice the pair is ×2.0 apart, not ×1.13. `audio.test.ts`
   * guards it by name.
   */
  [SOUND.depositTick]: {
    name: 'depositTick',
    layers: [
      ...struck('depositTick', 587.33, { gain: 0.15, decay: 0.05, hold: 0.01, partials: GLASS_PAIR, seed: 0xf2d7 }),
    ],
  },

  // The respawn countdown (GDD §2.7): one clean mid beep a second. Deliberately
  // plain — it is a clock, and the bright one below is the release it counts to.
  [SOUND.respawnBeep]: {
    name: 'respawnBeep',
    wave: 'triangle',
    attack: 0.004,
    hold: 0.035,
    decay: 0.08,
    freq: 660,
    gain: 0.2,
    seed: 0x3d7d,
  },

  // Free and fast (GDD §2.7): the ship back on the field. The same two-part
  // shape — a rise, then a top note a step above the countdown — with the square
  // replaced by a struck note and the rise trimmed from ×1.50 to ×1.18, which is
  // a lift rather than a chirp inside 200 ms.
  [SOUND.respawnGo]: {
    name: 'respawnGo',
    layers: [
      {
        spec: {
          name: 'respawnGo.rise',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.04,
          decay: 0.16,
          freq: 660,
          freqEnd: 780,
          gain: 0.26,
          seed: 0x3d7e,
        },
      },
      ...struck('respawnGo.top', 1320, { gain: 0.16, decay: 0.1, hold: 0.02, at: 0.12, partials: GLASS_PAIR, seed: 0x3d7f }),
    ],
  },

  // A minimap ping (GDD §2.4): a rising sonar blip that rings a moment and fades.
  // Plasma-blue in character (style-guide §1) — this locates, it does not warn, so
  // it must never be mistaken for the alarm.
  [SOUND.minimapPing]: {
    name: 'minimapPing',
    layers: [
      {
        spec: {
          name: 'minimapPing.blip',
          wave: 'sine',
          attack: 0.003,
          hold: 0.03,
          decay: 0.26,
          freq: 880,
          freqEnd: 1320,
          vibratoDepth: 0.02,
          vibratoRate: 12,
          gain: 0.22,
          seed: 0x4dc9,
        },
      },
      {
        spec: {
          name: 'minimapPing.ring',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.02,
          decay: 0.2,
          freq: 1760,
          gain: 0.1,
          seed: 0x4dca,
        },
        at: 0.02,
      },
    ],
  },
};

/** The spec for a named sound. */
export function soundSpec(name: SoundName): SoundSpec {
  return SPECS[name];
}

/** Every sound name, for the render-everything test and the preload pass. */
export const SOUND_NAMES: readonly SoundName[] = Object.keys(SPECS) as SoundName[];

// ---------------------------------------------------------------------------
// Tells → sounds
// ---------------------------------------------------------------------------

/**
 * The audible half of "every mechanic has a visible and audible tell"
 * (GDD §3.6), stated as data so a test can walk it.
 *
 * One kind maps to `null` — `thrust`, a *deliberate* silence rather than a gap:
 * it is a held state whose voice is sustained on the local ship (`./weapons`,
 * `./engine`), because retriggering a one-shot every tick is a rattle, not a tell.
 * The two firing kinds used to sit here too; since the laser's retirement they are
 * ordinary one-shots (the discrete rock-chip and hull-hit above), so a per-tick
 * trigger thins to a stream through the mix's repeat-gap rather than a held tone.
 */
export const TELL_SOUND: Readonly<Record<TellKind, SoundName | null>> = {
  [TELL.mineHit]: SOUND.rockChip,
  [TELL.weaponHit]: SOUND.hullHit,
  [TELL.rockCrack]: SOUND.rockCrack,
  [TELL.rockBurst]: SOUND.rockBurst,
  [TELL.oreCollect]: SOUND.oreCollect,
  [TELL.holdFull]: SOUND.holdFull,
  [TELL.turretFire]: SOUND.turretFire,
  [TELL.shotImpact]: SOUND.shotImpact,
  [TELL.shieldHit]: SOUND.shieldHit,
  [TELL.shieldDown]: SOUND.shieldDown,
  [TELL.coreHit]: SOUND.coreHit,
  [TELL.shipExplode]: SOUND.shipExplode,
  [TELL.shipSpawn]: SOUND.shipSpawn,
  [TELL.spawnPulse]: SOUND.spawnPulse,
  [TELL.thrust]: null,
  [TELL.buildPlaced]: SOUND.buildPlaced,
  [TELL.buildComplete]: SOUND.buildComplete,
  [TELL.repairTick]: SOUND.repairTick,
  [TELL.bankOre]: SOUND.bankOre,
  [TELL.upgradeBought]: SOUND.upgradeBought,
  [TELL.waveArrive]: SOUND.waveArrive,
  [TELL.collapseBegin]: SOUND.collapseBegin,
  [TELL.stationDeath]: SOUND.stationDeath,
  [TELL.matchEnd]: SOUND.matchEnd,
  [TELL.turretDown]: SOUND.turretDown,
};

/**
 * Tells whose sound is a *held* voice rather than a one-shot. Named here so the
 * coverage test can assert that a `null` in {@link TELL_SOUND} is one of these and
 * never a mechanic somebody forgot. Since the laser's retirement this is the thruster
 * alone: firing became discrete (the two chip voices), so the engine no longer has
 * two firing loops to sustain — only the engine note under the local player's thumb.
 */
export const SUSTAINED_TELLS: readonly TellKind[] = [TELL.thrust];

// ---------------------------------------------------------------------------
// Device cues → sounds
// ---------------------------------------------------------------------------

/**
 * A cue the game raises directly rather than through a world diff — a finger on a
 * control, the ping, the respawn clock, an ore chunk coming to rest. These are the
 * audible half of the p4-03 haptic seams, so the vocabulary mirrors the haptic one
 * (`src/platform/haptics.ts`, {@link HapticKind}) wherever they overlap:
 *
 *  - `press`   ↔ haptic `tap`     — a wheel wedge / menu control was pressed.
 *  - `confirm` ↔ haptic `confirm` — a purchase or a repair committed.
 *  - `reject`  — a buy the player can't afford. No haptic twin; the buzzer alone.
 *  - `deposit` — one ore chunk settling into the bank on a deposit flight.
 *  - `respawnBeep` / `respawnGo` — the respawn countdown, and the launch (GDD §2.7).
 *  - `ping`    — a minimap ping (GDD §2.4).
 *
 * Six more name the interactions the **Gantry/Bone cue set** (`./ui-cues`, s6-01)
 * distinguishes and the original three could not. They are additive: `press`,
 * `confirm` and `reject` still mean what `src/ui/sfx.ts` says they mean, and the
 * UI seam's three-word vocabulary is unchanged.
 *
 *  - `hover`  — a fingertip crossed a live control.
 *  - `detent` — a selection stepped one notch (a wheel, a roster row, a hull tile).
 *  - `back`   — BACK or CANCEL. **Never a forward cue**: falling interval = backwards.
 *  - `accept` — a forward confirm that is *not* a spend (a screen entered, REMATCH).
 *  - `join`   — a seat filled, stepping up by slot index.
 *  - `rush`   — RUSH!, the countdown starting.
 *
 * Played through {@link AudioEngine.cue}: full level, no earshot falloff (they are
 * non-diegetic UI, not a thing at a place in the world), but still under the
 * three-second hush like everything else (GDD §4.7).
 */
export type AudioCue =
  | 'press'
  | 'confirm'
  | 'reject'
  | 'deposit'
  | 'respawnBeep'
  | 'respawnGo'
  | 'ping'
  | 'hover'
  | 'detent'
  | 'back'
  | 'accept'
  | 'join'
  | 'rush';

/**
 * The bank sound each device cue falls back to.
 *
 * *"Falls back"*, because since s6-01 every cue the Gantry/Bone set covers is
 * played by `./ui-cues` instead — the ratified struck-glass voices the developer
 * chose by ear ({@link CUE_UI}). This map is what sounds when there is no cue
 * player at all, and it is what keeps the vocabulary total: no cue is ever silent
 * for want of a mapping.
 */
export const CUE_SOUND: Readonly<Record<AudioCue, SoundName>> = {
  press: SOUND.pressTick,
  confirm: SOUND.purchaseConfirm,
  reject: SOUND.rejectBuzz,
  deposit: SOUND.depositTick,
  respawnBeep: SOUND.respawnBeep,
  respawnGo: SOUND.respawnGo,
  ping: SOUND.minimapPing,
  hover: SOUND.pressTick,
  detent: SOUND.pressTick,
  back: SOUND.pressTick,
  accept: SOUND.purchaseConfirm,
  join: SOUND.pressTick,
  rush: SOUND.purchaseConfirm,
};

/**
 * Device cue → the Gantry/Bone cue that answers it (`./ui-cues` s6-01).
 *
 * The interesting rows are the three that already existed, because they are what
 * makes the ratified set audible everywhere the UI already speaks without the UI
 * seam learning a single new word:
 *
 *  - `press`   → **pick**     — one note, A♭6. The plainest forward thing there is.
 *  - `confirm` → **purchase** — a spend landed: three notes rising. The UI raises
 *    `confirm` only when the SIM confirmed the spend (`src/ui/sfx.ts`), which is
 *    exactly what the handoff calls a purchase.
 *  - `reject`  → **refused**  — two notes a minor second apart, resolving nowhere.
 *
 * `deposit`, `respawnBeep`, `respawnGo` and `ping` are absent on purpose: they are
 * world/clock tells wearing a cue's clothes, not the UI's struck glass, and the
 * handoff's set does not cover them.
 */
export const CUE_UI: Readonly<Partial<Record<AudioCue, UiCueName>>> = {
  press: 'pick',
  confirm: 'purchase',
  reject: 'refused',
  hover: 'hover',
  detent: 'detent',
  back: 'back',
  accept: 'confirm',
  join: 'join',
  rush: 'rush',
};
