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
 * sounds attached to homes ({@link SOUND.coreHit}, {@link SOUND.planetDeath})
 * drop an octave, lose their brightness and take their time. The death sound is
 * the only one in the bank with a tail longer than a second, and the only one
 * that is followed by nothing at all (`../vfx/death-moment`).
 *
 * ## The rock-vs-hull firing voices
 *
 * GDD §3.6 asks for *"the distinct rock-vs-hull firing sounds"* by name, because
 * firing is the game's central inversion — the same trigger mines and kills —
 * and the player needs to know which one they are doing without looking. They
 * are the two entries here that **loop**: firing is a held state, not an event,
 * so retriggering a one-shot per firing tick would be a machine-gun rattle at
 * 60 Hz. `./weapons.ts` sustains them and crossfades between them.
 *
 *  - **Rock** is low, grainy, band-limited — a grinder chewing stone.
 *  - **Hull** is bright, thin and rude — a cutting torch on plate.
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
 * most map 1:1 to a {@link TELL}, and the rest ({@link SOUND.alarm},
 * {@link SOUND.mineLoop}, {@link SOUND.weaponLoop}, {@link SOUND.thruster})
 * are held states rather than moments.
 */
export const SOUND = {
  // --- Mine ---------------------------------------------------------------
  /** A shot on rock, held. Low, grainy: a grinder chewing stone. */
  mineLoop: 'mineLoop',
  /** A shot on hull, held. Bright and rude: a cutting torch on plate. */
  weaponLoop: 'weaponLoop',
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
  planetDeath: 'planetDeath',
  matchEnd: 'matchEnd',

  // --- Mechanics that are not moments -------------------------------------
  /** The under-attack alarm (GDD §2.2) — a mechanic, not polish. See `./alarm`. */
  alarm: 'alarm',
  /** The ambient bed (GDD §3.6). See `./ambient`. */
  ambient: 'ambient',
} as const;

/** One of the {@link SOUND} names. */
export type SoundName = (typeof SOUND)[keyof typeof SOUND];

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** Loop bodies are rendered flat and joined tail-to-head (`./synth` seamless). */
const LOOP_CROSSFADE = 0.04;

const SPECS: Readonly<Record<SoundName, SoundSpec>> = {
  // --- Mine ---------------------------------------------------------------

  // Rock: pitched noise low in the spectrum with the top rolled off, so it
  // reads as *material* being removed rather than as energy being spent.
  [SOUND.mineLoop]: {
    name: 'mineLoop',
    loop: true,
    crossfade: LOOP_CROSSFADE,
    layers: [
      {
        spec: {
          name: 'mineLoop.grind',
          wave: 'noise',
          attack: 0,
          hold: 0.5,
          decay: 0,
          freq: 118,
          vibratoDepth: 0.08,
          vibratoRate: 21,
          lowPass: 1500,
          highPass: 90,
          gain: 0.42,
          seed: 0x9e37,
        },
      },
      {
        // A little body under the grit, so it has a pitch and not just a hiss.
        spec: {
          name: 'mineLoop.body',
          wave: 'saw',
          attack: 0,
          hold: 0.5,
          decay: 0,
          freq: 74,
          noiseMix: 0.35,
          lowPass: 900,
          gain: 0.2,
          seed: 0x9e38,
        },
        level: 0.8,
      },
    ],
  },

  // Hull: the same held state, an octave and a half up, thin and buzzy. A
  // player who has hit a ship by accident knows it in about 80 ms.
  [SOUND.weaponLoop]: {
    name: 'weaponLoop',
    loop: true,
    crossfade: LOOP_CROSSFADE,
    layers: [
      {
        spec: {
          name: 'weaponLoop.torch',
          wave: 'saw',
          attack: 0,
          hold: 0.5,
          decay: 0,
          freq: 366,
          vibratoDepth: 0.05,
          vibratoRate: 33,
          noiseMix: 0.22,
          highPass: 320,
          gain: 0.34,
          seed: 0x4dc3,
        },
      },
      {
        spec: {
          name: 'weaponLoop.spit',
          wave: 'noise',
          attack: 0,
          hold: 0.5,
          decay: 0,
          freq: 1450,
          highPass: 900,
          gain: 0.18,
          seed: 0x4dc4,
        },
        level: 0.9,
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
      {
        // …and the payout glinting out of it: yellow means ore, and it is the
        // one thing in this sound that goes *up* (style-guide §2).
        spec: {
          name: 'rockBurst.ore',
          wave: 'square',
          attack: 0.004,
          hold: 0.02,
          decay: 0.12,
          freq: 640,
          freqEnd: 1180,
          duty: 0.35,
          gain: 0.24,
          seed: 0x33ab,
        },
        at: 0.05,
      },
    ],
  },

  [SOUND.oreCollect]: {
    name: 'oreCollect',
    wave: 'square',
    attack: 0.002,
    hold: 0.014,
    decay: 0.07,
    freq: 720,
    freqEnd: 1080,
    duty: 0.3,
    gain: 0.22,
    seed: 0xf2d2,
  },

  [SOUND.holdFull]: {
    name: 'holdFull',
    layers: [
      {
        spec: {
          name: 'holdFull.a',
          wave: 'square',
          attack: 0.003,
          hold: 0.05,
          decay: 0.06,
          freq: 880,
          duty: 0.45,
          gain: 0.3,
          seed: 0xf2d3,
        },
      },
      {
        spec: {
          name: 'holdFull.b',
          wave: 'square',
          attack: 0.003,
          hold: 0.05,
          decay: 0.1,
          freq: 1174,
          duty: 0.45,
          gain: 0.3,
          seed: 0xf2d4,
        },
        at: 0.11,
      },
    ],
  },

  // --- Fight --------------------------------------------------------------

  [SOUND.turretFire]: {
    name: 'turretFire',
    wave: 'square',
    attack: 0.001,
    hold: 0.01,
    decay: 0.075,
    punch: 0.6,
    freq: 520,
    freqEnd: 130,
    duty: 0.22,
    dutySweep: 1.6,
    noiseMix: 0.25,
    gain: 0.3,
    seed: 0x7e88,
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
  [SOUND.shieldDown]: {
    name: 'shieldDown',
    layers: [
      {
        spec: {
          name: 'shieldDown.fall',
          wave: 'saw',
          attack: 0.004,
          hold: 0.04,
          decay: 0.5,
          freq: 900,
          freqEnd: 130,
          lowPass: 3000,
          gain: 0.34,
          seed: 0x4dc7,
        },
      },
      {
        spec: {
          name: 'shieldDown.pop',
          wave: 'noise',
          attack: 0.001,
          hold: 0.01,
          decay: 0.16,
          freq: 520,
          freqEnd: 160,
          gain: 0.22,
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

  // "Ships are toys, explosions are fireworks" (GDD §4.7): a bang, then a
  // sparkle over the top of it. Generous, and quickly over.
  [SOUND.shipExplode]: {
    name: 'shipExplode',
    layers: [
      {
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
        spec: {
          name: 'shipExplode.crack',
          wave: 'square',
          attack: 0.001,
          hold: 0.012,
          decay: 0.1,
          freq: 660,
          freqEnd: 120,
          duty: 0.2,
          gain: 0.22,
          seed: 0xdeae,
        },
      },
      {
        spec: {
          name: 'shipExplode.sparkle',
          wave: 'square',
          attack: 0.004,
          hold: 0.03,
          decay: 0.3,
          freq: 1240,
          freqEnd: 1900,
          repeat: 0.07,
          duty: 0.28,
          gain: 0.16,
          seed: 0xdeaf,
        },
        at: 0.07,
      },
    ],
  },

  // Free and fast (GDD §2.7): arriving, not being born. Rises and stops.
  [SOUND.shipSpawn]: {
    name: 'shipSpawn',
    layers: [
      {
        spec: {
          name: 'shipSpawn.rise',
          wave: 'triangle',
          attack: 0.02,
          hold: 0.05,
          decay: 0.16,
          freq: 220,
          freqEnd: 880,
          gain: 0.3,
          seed: 0x3d7b,
        },
      },
      {
        spec: {
          name: 'shipSpawn.land',
          wave: 'square',
          attack: 0.002,
          hold: 0.02,
          decay: 0.12,
          freq: 1046,
          duty: 0.4,
          gain: 0.2,
          seed: 0x3d7c,
        },
        at: 0.2,
      },
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

  // Ore is gone and only time remains (GDD §2.5): a latch, not a fanfare.
  [SOUND.buildPlaced]: {
    name: 'buildPlaced',
    layers: [
      {
        spec: {
          name: 'buildPlaced.clunk',
          wave: 'square',
          attack: 0.003,
          hold: 0.02,
          decay: 0.1,
          freq: 196,
          freqEnd: 147,
          duty: 0.5,
          gain: 0.3,
          seed: 0x4fa0,
        },
      },
      {
        spec: {
          name: 'buildPlaced.latch',
          wave: 'noise',
          attack: 0.001,
          hold: 0.008,
          decay: 0.06,
          freq: 620,
          freqEnd: 240,
          highPass: 300,
          gain: 0.16,
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

  [SOUND.bankOre]: {
    name: 'bankOre',
    layers: [
      {
        spec: {
          name: 'bankOre.drop',
          wave: 'square',
          attack: 0.002,
          hold: 0.02,
          decay: 0.09,
          freq: 880,
          freqEnd: 587,
          duty: 0.35,
          gain: 0.26,
          seed: 0xf2d5,
        },
      },
      {
        spec: {
          name: 'bankOre.settle',
          wave: 'square',
          attack: 0.002,
          hold: 0.02,
          decay: 0.16,
          freq: 440,
          duty: 0.4,
          gain: 0.22,
          seed: 0xf2d6,
        },
        at: 0.08,
      },
    ],
  },

  // The half of the economy a player can most easily miss (GDD §2.10) — so when
  // they do find it, it is the brightest confirmation in the bank.
  [SOUND.upgradeBought]: {
    name: 'upgradeBought',
    layers: [
      {
        spec: {
          name: 'upgradeBought.arp',
          wave: 'square',
          attack: 0.003,
          hold: 0.12,
          decay: 0.1,
          freq: 523,
          arpMul: 1.5,
          arpTime: 0.07,
          repeat: 0.14,
          duty: 0.3,
          gain: 0.26,
          seed: 0x9b5d,
        },
      },
      {
        spec: {
          name: 'upgradeBought.top',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.05,
          decay: 0.2,
          freq: 1046,
          gain: 0.2,
          seed: 0x9b5e,
        },
        at: 0.16,
      },
    ],
  },

  // --- The clock ----------------------------------------------------------

  // The metronome of the match (GDD §2.3). Two low notes, like a foghorn: the
  // field just moved closer to the middle and everyone is nearer everyone.
  [SOUND.waveArrive]: {
    name: 'waveArrive',
    layers: [
      {
        spec: {
          name: 'waveArrive.horn',
          wave: 'saw',
          attack: 0.03,
          hold: 0.22,
          decay: 0.3,
          freq: 147,
          vibratoDepth: 0.015,
          vibratoRate: 6,
          lowPass: 1400,
          gain: 0.34,
          seed: 0xff8a,
        },
      },
      {
        spec: {
          name: 'waveArrive.fifth',
          wave: 'saw',
          attack: 0.03,
          hold: 0.2,
          decay: 0.4,
          freq: 220,
          lowPass: 1600,
          gain: 0.22,
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
   * The planet-death sound (GDD §4.7). Everything the arcade half of the bank
   * does, this one refuses to do: it does not blip, it does not sparkle, and it
   * does not resolve. A long fall and a low tail — and then the mix goes to
   * zero underneath it for three seconds (`../vfx/death-moment`), so the sound
   * a player actually remembers is the silence after it.
   */
  [SOUND.planetDeath]: {
    name: 'planetDeath',
    layers: [
      {
        spec: {
          name: 'planetDeath.fall',
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
          name: 'planetDeath.crust',
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
          name: 'planetDeath.toll',
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
 * Three kinds map to `null`, and each is a *deliberate* silence rather than a
 * gap — every one of them is a held state whose sound is sustained elsewhere,
 * because retriggering a one-shot every tick is a rattle, not a tell:
 *
 *  - `mineHit` / `weaponHit` → the two looping firing voices (`./weapons`).
 *  - `thrust` → the thruster loop, on the local ship (`./engine`).
 */
export const TELL_SOUND: Readonly<Record<TellKind, SoundName | null>> = {
  [TELL.mineHit]: null,
  [TELL.weaponHit]: null,
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
  [TELL.planetDeath]: SOUND.planetDeath,
  [TELL.matchEnd]: SOUND.matchEnd,
  [TELL.turretDown]: SOUND.turretDown,
};

/**
 * Tells whose sound is a *held* voice rather than a one-shot. Named here so the
 * coverage test can assert that a `null` in {@link TELL_SOUND} is one of these
 * three and never a mechanic somebody forgot.
 */
export const SUSTAINED_TELLS: readonly TellKind[] = [TELL.mineHit, TELL.weaponHit, TELL.thrust];
