/**
 * src/art/audio/bank.ts — every sound in the game. OWNER: Art & Audio Agent.
 *
 * The Art & Audio mandate, verbatim (GDD §3.6): *"Every mechanic in section 2
 * has a visible and audible tell."* `../tells.ts` names the moments; `../vfx/`
 * draws them; this file is the other half — a sound for every one of them, with
 * the mapping stated as data ({@link TELL_SOUND}) so `audio.test.ts` can assert
 * that no mechanic is visible but silent.
 *
 * ## Judged against the tone paragraph (GDD §4.7, amended 2026-08-06)
 *
 * > *Planet Rush is a clean, modern science-fiction brawl: fast, precise, and
 * > cold. Ships are machines, explosions are pressure failures, bots are
 * > operators with names and habits. But homes are the one serious thing in it —
 * > when a station dies, the game goes briefly quiet, the wreck stays on the map
 * > all match, and nobody jokes for three seconds. Engineered on the surface, a
 * > small ache underneath.*
 *
 * So the bank is deliberately **machined**: struck bodies rather than tone
 * generators, filtered noise where the thing making the sound is genuinely
 * broadband, and nothing that bends, wobbles or arpeggios its way to a feeling.
 * `square` and `saw` do not appear in it — with one sanctioned exception,
 * {@link SOUND.alarm}, because §2.2 calls for *"an unmistakable alarm"* and a
 * saw's dense harmonic stack is what stops a klaxon sounding like music.
 * Legibility outranks register, always.
 *
 * Struck confirmations are built on the ratified Gantry/Bone instrument, whose
 * constants are **imported** from `./ui-cues` rather than copied ({@link struck}),
 * so the menu and the match are audibly one game.
 *
 * The two sounds attached to homes ({@link SOUND.coreHit},
 * {@link SOUND.stationDeath}) are untouched by that amendment and always were
 * the serious end of the set: they drop an octave, lose their brightness and
 * take their time. The death sound is the only one in the bank with a tail
 * longer than a second, and the only one followed by nothing at all
 * (`../vfx/death-moment`). A clean palette makes that silence land harder, not
 * softer — which is the one thing this re-voice was not allowed to cost.
 *
 * *The pre-amendment paragraph read "a Saturday-morning space brawl … ships are
 * toys, explosions are fireworks … Arcade on the surface", and this bank
 * implemented it faithfully. The re-voice is `docs/audio-revoice-spec.md` (s7-01),
 * executed under s7-02.*
 *
 * ## Round 2, and what round 1 got wrong (s8-01, 2026-08-08)
 *
 * The developer denied **all forty slots at once**, in the same words as before:
 * *"still have all the old sounds i said i didnt want there … make new ones that
 * match the new theme (modern/sci-fi and not retro/toony)."* Measured against the
 * live deployment first — the shipped bundle's `rockChip` is byte-identical to
 * this file's — so they were hearing round 1, not a stale build.
 *
 * Round 1 obeyed the spec to the letter and still missed, because it changed
 * **which oscillator** a sound used and nothing about **how a sound is made**.
 * `square` left; {@link strike}'s ancestor put bare sine partials in its place,
 * `sine` went to 48.3% of the bank, and **83 of 116 voices carried no grain, no
 * filter and no decay curve at all** — tone generators sounding, rather than
 * bodies being struck. An arcade blip became a toy xylophone.
 *
 * So round 2 is a change of instrument, not of palette. `../synth` grew four
 * capabilities and this file spends them:
 *
 *  - **A real tail on everything.** `decayCurve` on every voice that decays, with
 *    the klaxon the one named exception. A linear ramp to silence is a volume
 *    knob turning down, and it was on every percussive sound in both passes.
 *  - **Filter movement as the gesture.** Twenty-four voices sweep a resonant
 *    cutoff. This is the distinction the register turns on: a *pitch* slide inside
 *    a short voice is the chirp §5.4 retires, where a *filter* closing over a
 *    fixed pitch is a machine losing energy — a coil dumping charge, a bubble
 *    failing, a drive spinning up.
 *  - **Material instead of tone.** Twenty-one band-passed noise transients, where
 *    a tone's attack segment used to stand in for two hard things touching.
 *  - **One room, in one place.** {@link SOUND.shipExplode} alone gets late
 *    returns, because an explosion is the event a sense of place belongs to and a
 *    28 ms interface tick is not.
 *
 * The bare-tone count is 6 of 135 now, and all six are sustained drones where a
 * pure tone genuinely is the design. `audio.test.ts` holds the budget, and it was
 * verified RED against the bank the developer rejected before it went green here.*
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
  /** A cutting tool taking a bite out of stone — one discrete chip. Low, flat, grainy. */
  rockChip: 'rockChip',
  /** A round on plate — one discrete hit on hull/turret/shield/core. Bright, with cut. */
  hullHit: 'hullHit',
  /** A crack stage advancing — rock giving way, one step of three. */
  rockCrack: 'rockCrack',
  /** The rock coming apart and paying out. */
  rockBurst: 'rockBurst',
  /** A chunk tractored in. One struck note: a machine registering that you have it. */
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
  /** Explosions are pressure failures (GDD §4.7, amended 2026-08-06). */
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
  /** The sting on a win — brief, and after the three-second quiet. */
  musicWin: 'musicWin',
  /** The sting on a loss — the ache, falling. */
  musicLoss: 'musicLoss',

  // --- Device cues (p4-03 seams) — answered by AudioEngine.cue, not a tell ---
  /** A wheel wedge / menu control was pressed. The lightest tick, matched to `tap`. */
  pressTick: 'pressTick',
  /** A purchase or repair committed — a rising two-beat "done", matched to `confirm`. */
  purchaseConfirm: 'purchaseConfirm',
  /** A buy the player can't afford — two notes a minor second apart, resolving
   * nowhere. No haptic twin. (The name is pre-amendment; see the spec below.) */
  rejectBuzz: 'rejectBuzz',
  /** One ore chunk settling into the bank on a deposit flight — soft, conserved 1:1. */
  depositTick: 'depositTick',
  /** A tick of the respawn countdown (GDD §2.7). Clean, mid, once a second. */
  respawnBeep: 'respawnBeep',
  /** Respawn — free and fast (GDD §2.7): the ship arriving, brighter than the beeps. */
  respawnGo: 'respawnGo',
  /** The minimap toggle. A rising sonar blip — locate, not alarm. The *ping*
   * mechanic was cut (§2.4); the name is a fossil (s7-01 §11 Q7). */
  minimapPing: 'minimapPing',

  // --- The end-of-match summary (p1-07) — the XP beat, under the result -----
  //
  // Four cues for the choreographed end-of-match sequence
  // (`docs/progression-plan.md` §6.3/§6.5), and **not** the stings already in the
  // bank: `matchEnd`, `musicWin` and `musicLoss` are three of the forty slots the
  // developer pressed DENY ALL on (a0-01), so a satisfying sound drawn from them
  // is a satisfying sound that has already been rejected. They are new voices.
  //
  // Two constraints hold across the set rather than on any one of them:
  //
  //  - **They mix UNDER whatever the result already sounded.** A station death is
  //    still the ache (GDD §4.7); the XP beat plays beneath it, never over it.
  //    `audio.test.ts` states that as a number — every one of the four is quieter
  //    in RMS than `matchEnd`, and far quieter than `stationDeath`.
  //  - **Everything is cancellable.** A player who skipped the sequence is telling
  //    you they do not want the beat, so nothing here may outlive the screen: the
  //    three one-shots are all under 0.5 s, and the one sustained cue is a LOOP
  //    (`xpBarFill`) rather than a long one-shot, because a loop can be stopped
  //    and a one-shot in flight cannot. pr-05 owns the cancel; this owns being
  //    cancellable.

  /**
   * The count-up tick (beat 1–2). Heard dozens of times in five seconds, every
   * match, forever — so this is the `pressTick` problem, not the `matchEnd` one:
   * tiny, dry, and with nothing in it that can ring. If it is interesting, it is
   * wrong. It pitches *up* slightly as the count rises; that ride is playback
   * rate at the seam ({@link XP_TICK_SEMITONES}), not forty specs.
   */
  xpTick: 'xpTick',
  /**
   * The bed under the bar filling (beat 3) — a *filling* sound, not a repeated
   * one. A held loop, started and stopped with the bar (`./engine` xpFill).
   */
  xpBarFill: 'xpBarFill',
  /**
   * The level-up (beat 4) — **the one moment allowed to be a reward.** Short,
   * bright, decisive, and an *arrival* rather than a fanfare.
   */
  levelUp: 'levelUp',
  /** The settle (beat 5). The full stop: quiet, and the screen is yours again. */
  xpSettle: 'xpSettle',
} as const;

/** One of the {@link SOUND} names. */
export type SoundName = (typeof SOUND)[keyof typeof SOUND];

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** Loop bodies are rendered flat and joined tail-to-head (`./synth` seamless). */
const LOOP_CROSSFADE = 0.04;

/**
 * Where the contact transient sits relative to the note it strikes, and how
 * narrow the band is. A little under two octaves up is where hard things ring
 * when they touch; Q 5 is a band that reads as a material rather than a click.
 */
const CONTACT_RATIO = 2.4;
const CONTACT_Q = 5;
/** The contact's level, relative to the note's. A band-pass output is narrow. */
const CONTACT_LEVEL = 0.55;

/**
 * Decay curvature for the fundamental; each partial above it bends harder still.
 * A struck body loses most of its energy immediately and then hangs on, which is
 * the difference between metal ringing and an organ stop opening.
 */
const PARTIAL_CURVE = 3.4;

/** Pitched grain blended into the fundamental. Rises across the partials. */
const PARTIAL_GRAIN = 0.04;

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
 * ## Round 2: what this was, and why it had to change (s8-01)
 *
 * This function is where the first re-voice went wrong, so it is worth being
 * precise about it. s7-02 replaced `square` almost everywhere it did a
 * confirmation's job — correctly, by the letter of the spec — with a stack of
 * **bare sine partials**: a 2 ms attack, a *hold at full level*, and a **linear**
 * ramp to silence, carrying no filter, no grain and no transient. It shipped, and
 * it moved `sine` from 17 of 89 voices to **56 of 116, 48.3% of the bank**.
 *
 * A stack of unfiltered sines with a linear decay is a glockenspiel. The pass
 * traded an arcade blip for a toy xylophone, which is not less toony — only
 * differently toony — and that is why the developer said the same sentence twice.
 *
 * The **ratios were never the problem**: 1 / 2.76 / 5.4 is inharmonic, which is
 * the correct starting point for anything machined, and the developer chose them
 * by ear. What was wrong was everything around them. So round 2 keeps the
 * ratified spacing and rebuilds how it is *rendered*:
 *
 *  - **A contact transient.** The note now opens with a band of resonant noise
 *    at {@link CONTACT_RATIO} — two hard things touching. That is the sound a
 *    machine actually makes when it registers something, and it is what the
 *    attack segment of a sine was standing in for.
 *  - **No hold.** A struck body does not sit at full level and then fall; it
 *    peaks and immediately begins to die. The `hold` is gone.
 *  - **A real tail** ({@link PARTIAL_CURVE}). Exponential, bending harder on each
 *    partial above the fundamental, so the note collapses to its root and rings
 *    out rather than fading in a straight line like a volume knob turning down.
 *  - **Grain** ({@link PARTIAL_GRAIN}). A trace of pitched noise on each partial.
 *    A pure sine is a test tone; a sine with grain in it is a body.
 *
 * The result is the same note, in the same material, at the same pitch — struck
 * rather than sounded.
 *
 * @param partials {@link GLASS_PARTIALS} (three, full) or {@link GLASS_PAIR}
 *   (two, thinner — the handoff's own choice for an answering note).
 */
function strike(
  name: string,
  freq: number,
  opts: {
    /** Peak of the fundamental; upper partials roll off from it. */
    readonly gain: number;
    /** The fundamental's decay. Each partial above it decays faster. */
    readonly decay: number;
    /** Seconds from the start of the sound. */
    readonly at?: number;
    readonly partials?: readonly number[];
    readonly seed: number;
    /** Scale the contact transient, 0 to drop it. Default 1. */
    readonly contact?: number;
  },
): SoundLayer[] {
  // `exactOptionalPropertyTypes`: an absent `at` is not `at: undefined`.
  const place = (spec: VoiceSpec): SoundLayer => (opts.at === undefined ? { spec } : { spec, at: opts.at });
  const contact = opts.contact ?? 1;
  const layers: SoundLayer[] = [];

  if (contact > 0) {
    layers.push(
      place({
        name: `${name}.contact`,
        wave: 'noise',
        attack: 0.0004,
        hold: 0.0015,
        decay: Math.min(0.04, opts.decay * 0.55),
        decayCurve: 7, // gone almost before it registers: this is an edge, not a layer
        punch: 0.5,
        freq: freq * CONTACT_RATIO,
        lowPass: freq * CONTACT_RATIO,
        resonance: CONTACT_Q,
        bandPass: true,
        gain: opts.gain * CONTACT_LEVEL * contact,
        seed: opts.seed + 90,
      }),
    );
  }

  for (const [i, ratio] of (opts.partials ?? GLASS_PARTIALS).entries()) {
    layers.push(
      place({
        name: `${name}.p${i}`,
        wave: 'sine',
        attack: STRIKE_S,
        hold: 0, // a struck body peaks and dies; it does not sit at full level
        decay: opts.decay * Math.pow(PARTIAL_DECAY, i),
        decayCurve: PARTIAL_CURVE + i,
        freq: freq * ratio,
        noiseMix: PARTIAL_GRAIN + i * 0.012,
        gain: opts.gain / Math.pow(i + 1, PARTIAL_ROLLOFF),
        seed: opts.seed + i,
      }),
    );
  }

  return layers;
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
    attack: 0.0006, // a tighter strike: the transient IS the character
    hold: 0.006,
    decay: 0.078,
    decayCurve: 5.2, // the bite, then the stone: a tail, not a fade-out
    punch: 0.6,
    freq: 92,
    freqEnd: 82, // ×1.12 — a body settling, well under the chirp threshold
    lowPass: 900,
    lowPassEnd: 520, // the tool coming off the rock — a sweep, not a pitch slide
    resonance: 3.2, // the band rings: stone, rather than a duller hiss
    highPass: 130, // sub a phone cannot emit anyway
    gain: 0.5,
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
          attack: 0.0008,
          hold: 0.006,
          decay: 0.07,
          decayCurve: 6, // plate rings and stops; it does not fade evenly
          punch: 0.6,
          freq: 452,
          freqEnd: 400, // ×1.13 — a body settling, not a chirp
          noiseMix: 0.3,
          lowPass: 3600,
          resonance: 2.4, // a plate resonance under the round
          highPass: 340,
          gain: 0.5,
          seed: 0x4dc3,
        },
      },
      {
        spec: {
          name: 'hullHit.spit',
          wave: 'noise',
          attack: 0.0005,
          hold: 0.003,
          decay: 0.055,
          decayCurve: 7,
          freq: 1500,
          lowPass: 4200,
          resonance: 6,
          bandPass: true, // the metal's own ring, not a spray of hiss
          highPass: 950,
          gain: 0.42,
          seed: 0x4dc4,
        },
      },
    ],
  },

  // One crack stage advancing — **a step, not a slide.** The ×2.17 fall inside
  // 114 ms was the same downward chirp `rockChip` carried, on the sound that
  // answers it; stone gives way in stages, and a stage is a step.
  [SOUND.rockCrack]: {
    name: 'rockCrack',
    wave: 'noise',
    attack: 0.0012,
    hold: 0.008,
    decay: 0.115,
    decayCurve: 4.4, // stone gives, then settles
    punch: 0.55,
    freq: 260,
    freqEnd: 220,
    lowPass: 2100,
    lowPassEnd: 900, // the fracture closing — energy leaving, not pitch falling
    resonance: 2.8,
    gain: 0.26,
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
          attack: 0.002,
          hold: 0.03,
          decay: 0.38,
          decayCurve: 3.2, // debris settling, which is not a linear ramp
          punch: 0.6,
          freq: 340,
          freqEnd: 90,
          lowPass: 2800,
          lowPassEnd: 600, // the burst opening and closing over its own fall
          resonance: 2.2,
          gain: 0.4,
          seed: 0x33aa,
        },
      },
      // …and the payout glinting out of it: yellow means ore, and it is still
      // the one thing in this sound that goes *up* (style-guide §2). It was a
      // square gliding up a minor seventh; the rise is now two struck notes
      // instead of one bent one, which says the same thing without the chirp.
      ...strike('rockBurst.ore', 1046.5, { gain: 0.2, decay: 0.19, at: 0.05, partials: GLASS_PAIR, seed: 0x33ab }),
      ...strike('rockBurst.glint', 1567.98, { gain: 0.16, decay: 0.22, at: 0.11, partials: GLASS_PAIR, seed: 0x33ae }),
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
    layers: [...strike('oreCollect', 1046.5, { gain: 0.2, decay: 0.14, seed: 0xf2d2 })],
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
      ...strike('holdFull.a', 880, { gain: 0.26, decay: 0.13, seed: 0xf2d3 }),
      ...strike('holdFull.b', 1174.66, { gain: 0.26, decay: 0.2, at: 0.11, seed: 0xf2d4 }),
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
          attack: 0.0008,
          hold: 0.008,
          decay: 0.085,
          decayCurve: 5.5, // the dump, then the coil ringing down
          punch: 0.75,
          freq: 174.61,
          noiseMix: 0.24, // grit on the body, not a second oscillator
          lowPass: 2600,
          lowPassEnd: 420, // THE resonant sweep: charge leaving, at a fixed pitch
          resonance: 4.5,
          gain: 0.52,
          seed: 0x7e88,
        },
      },
      {
        spec: {
          name: 'turretFire.arc',
          wave: 'noise',
          attack: 0.0004,
          hold: 0.003,
          decay: 0.055,
          decayCurve: 8, // an arc is over before you can hear its shape
          punch: 0.5,
          freq: 780,
          lowPass: 2600,
          lowPassEnd: 1400,
          resonance: 7,
          bandPass: true, // the discharge itself: narrow, pitched, metallic
          highPass: 420,
          gain: 0.46,
          seed: 0x7e8b,
        },
      },
    ],
  },

  // A shot in flight landing. **A tick, not a "pew"** — the ×3.00 fall inside
  // 57 ms was the arcade half of a projectile, and the arrival is the transient.
  [SOUND.shotImpact]: {
    name: 'shotImpact',
    wave: 'noise',
    attack: 0.0005,
    hold: 0.003,
    decay: 0.058,
    decayCurve: 8, // a landing is an edge with a tail, not a burst of hiss
    punch: 0.4,
    freq: 900,
    freqEnd: 780,
    lowPass: 5200,
    lowPassEnd: 2600,
    resonance: 3,
    highPass: 400,
    gain: 0.34, // a landing shot still has to land
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
          hold: 0.012,
          decay: 0.3,
          decayCurve: 3.6, // a field flexing and settling, not a note held
          freq: 1320,
          freqEnd: 1180,
          vibratoDepth: 0.02,
          vibratoRate: 14, // 314 ms: drift, and §5.4 exempts it by construction
          noiseMix: 0.05,
          gain: 0.28,
          seed: 0x4dc5,
        },
      },
      {
        spec: {
          name: 'shieldHit.skin',
          wave: 'sine',
          attack: 0.002,
          hold: 0.008,
          decay: 0.16,
          decayCurve: 4,
          freq: 660,
          noiseMix: 0.06,
          lowPass: 1100,
          lowPassEnd: 2200, // the skin opening under the hit — absorbed, not broken
          resonance: 2.6,
          gain: 0.2,
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
          hold: 0.03,
          decay: 0.51,
          decayCurve: 2.4, // it lets go, then bleeds out
          freq: 900,
          freqEnd: 130,
          noiseMix: 0.1,
          lowPass: 3000,
          lowPassEnd: 380, // the containment closing, riding the fall down
          resonance: 3.6,
          gain: 0.42,
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
          attack: 0.0008,
          hold: 0.006,
          decay: 0.18,
          decayCurve: 6,
          punch: 0.5,
          freq: 460,
          freqEnd: 400,
          lowPass: 2800,
          resonance: 3.4, // a band that rings: pressure failing, not hiss
          gain: 0.3,
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
          hold: 0.02,
          decay: 0.31,
          decayCurve: 2.6, // the reactor absorbing it, and going on absorbing it
          punch: 0.6,
          freq: 150,
          freqEnd: 62,
          noiseMix: 0.04,
          lowPass: 300,
          resonance: 2.2, // a mass this large has a resonance; it is just low
          gain: 0.46,
          seed: 0xb23b,
        },
      },
      {
        spec: {
          name: 'coreHit.tear',
          wave: 'noise',
          attack: 0.001,
          hold: 0.008,
          decay: 0.14,
          decayCurve: 4.5,
          freq: 420,
          freqEnd: 150,
          lowPass: 1800,
          lowPassEnd: 520, // plate opening and the gap closing behind it
          resonance: 2.4,
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
          attack: 0.0015,
          hold: 0.02,
          decay: 0.33,
          decayCurve: 3, // structure failing: a rush, then debris
          punch: 0.55,
          freq: 300,
          freqEnd: 80,
          lowPass: 2200,
          lowPassEnd: 520,
          resonance: 2.6,
          gain: 0.34,
          seed: 0x7e89,
        },
      },
      {
        spec: {
          // Flattened from ×2.00: a metallic clang falling an octave inside
          // 242 ms is a boing, which is the one thing §7.2 asked to be listened
          // for here. The crumple under it carries the collapse.
          name: 'turretDown.clang',
          wave: 'triangle',
          attack: 0.0015,
          hold: 0.006,
          decay: 0.26,
          decayCurve: 5, // struck metal: it rings and it stops. A boing does not
          freq: 380,
          freqEnd: 320,
          noiseMix: 0.16,
          lowPass: 2400,
          resonance: 3.2,
          gain: 0.2,
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
          attack: 0.0015,
          hold: 0.035,
          decay: 0.53,
          decayCurve: 2.8, // a concussive front has a front. Then it disperses
          punch: 0.85,
          freq: 420,
          freqEnd: 60,
          lowPass: 2600,
          lowPassEnd: 260, // the pressure equalising — the sweep IS the failure
          resonance: 2.4,
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
          attack: 0.0006,
          hold: 0.008,
          decay: 0.12,
          decayCurve: 6.5,
          punch: 0.7,
          freq: 480,
          freqEnd: 420,
          lowPass: 3000,
          resonance: 3,
          highPass: 300,
          gain: 0.26,
          seed: 0xdeae,
        },
      },
      {
        // The metallic shear, in the sparkle's place: a band of noise up where
        // torn plate rings, gone almost immediately. It does not rise.
        spec: {
          name: 'shipExplode.shear',
          wave: 'noise',
          attack: 0.0008,
          hold: 0.008,
          decay: 0.2,
          decayCurve: 5.5,
          freq: 2400,
          lowPass: 5200,
          lowPassEnd: 1800, // plate tearing along its length, not a burst of light
          resonance: 6,
          bandPass: true,
          highPass: 1600,
          gain: 0.26,
          seed: 0xdeaf,
        },
        at: 0.07,
      },
      {
        // **The room.** Two late, quiet, band-limited returns — debris off nearby
        // structure. This is the only place in the bank that gets any reflection
        // at all, and it is written as ordinary layers rather than as a synth
        // parameter for the reason `../synth` gives: a tail on a 28 ms interface
        // tick smears the mix on the speaker the mobile gate makes a first-class
        // device, where an explosion is exactly the event a sense of place belongs
        // to. It is what puts the blast somewhere instead of in a vacuum booth.
        spec: {
          name: 'shipExplode.return',
          wave: 'noise',
          attack: 0.004,
          hold: 0.01,
          decay: 0.22,
          decayCurve: 3.5,
          freq: 300,
          lowPass: 1500,
          lowPassEnd: 500,
          resonance: 2,
          gain: 0.11,
          seed: 0xdeb0,
        },
        at: 0.15,
      },
      {
        spec: {
          name: 'shipExplode.returnLate',
          wave: 'noise',
          attack: 0.006,
          hold: 0.01,
          decay: 0.2,
          decayCurve: 3,
          freq: 220,
          lowPass: 900,
          gain: 0.06,
          seed: 0xdeb1,
        },
        at: 0.28,
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
          decayCurve: 2,
          freq: 175,
          freqEnd: 350,
          noiseMix: 0.14,
          lowPass: 400,
          lowPassEnd: 2400, // a drive spinning up: energy arriving, opening as it comes
          resonance: 4,
          gain: 0.5,
          seed: 0x3d7b,
        },
      },
      ...strike('shipSpawn.land', 1046.5, { gain: 0.2, decay: 0.26, at: 0.2, partials: GLASS_PAIR, seed: 0x3d7c }),
    ],
  },

  // Ten seconds of protection, ticking (GDD §2.1). Quiet on purpose: it repeats.
  [SOUND.spawnPulse]: {
    name: 'spawnPulse',
    wave: 'sine',
    attack: 0.004,
    hold: 0.01,
    decay: 0.14,
    decayCurve: 4, // even the quietest thing in the bank gets a real tail
    freq: 415.3,
    freqEnd: 440, // the same small lift, an octave down: a field, not a clock
    noiseMix: 0.05,
    lowPass: 900,
    resonance: 2.4,
    gain: 0.15,
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
          resonance: 1.8, // a turbine has a formant; a jet of hiss does not
          highPass: 60,
          gain: 0.34,
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
          attack: 0.0015,
          hold: 0.008,
          decay: 0.12,
          decayCurve: 5, // a mass landing on a mount and stopping dead
          punch: 0.4,
          freq: 196,
          freqEnd: 176, // ×1.11 — a body settling, not a fall
          noiseMix: 0.22,
          lowPass: 1500,
          lowPassEnd: 600,
          resonance: 3,
          gain: 0.42,
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
          attack: 0.0004,
          hold: 0.003,
          decay: 0.07,
          decayCurve: 8, // a latch is an edge. Everything after it is the mount
          freq: 620,
          freqEnd: 530,
          highPass: 300,
          lowPass: 3400,
          resonance: 6,
          bandPass: true, // steel on steel, not a puff of noise
          gain: 0.3,
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
          attack: 0.002,
          hold: 0.012,
          decay: 0.13,
          decayCurve: 4,
          freq: 523,
          noiseMix: 0.08,
          lowPass: 1900,
          resonance: 2.8, // the mount answering: struck, not sounded
          gain: 0.46,
          seed: 0x4fa2,
        },
      },
      {
        spec: {
          name: 'buildComplete.b',
          wave: 'triangle',
          attack: 0.002,
          hold: 0.012,
          decay: 0.26,
          decayCurve: 4.5,
          freq: 784,
          noiseMix: 0.08,
          lowPass: 2600,
          resonance: 2.8,
          gain: 0.46,
          seed: 0x4fa3,
        },
        at: 0.09,
      },
    ],
  },

  // Patina is the repair colour (style-guide §1) and this is its sound: a soft,
  // low acknowledgement that a repair was bought and applied.
  //
  // The comment here used to read *"a soft tick you notice mostly when it stops,
  // because a hit interrupted it"* — which describes the **retired repair
  // channel**. Repair has been a discrete purchase with no channel and nothing
  // to interrupt since the v0.3 amendment (§2.5), so that sentence had been
  // describing a mechanic the game does not have. Its ×1.33 rise goes with it.
  [SOUND.repairTick]: {
    name: 'repairTick',
    wave: 'sine',
    attack: 0.004,
    hold: 0.01,
    decay: 0.16,
    decayCurve: 3.6, // a patch going on and setting
    freq: 392,
    freqEnd: 440,
    noiseMix: 0.09,
    lowPass: 1100,
    lowPassEnd: 620, // material closing over the breach
    resonance: 2.6,
    gain: 0.19,
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
      ...strike('bankOre.drop', 880, { gain: 0.24, decay: 0.18, seed: 0xf2d5 }),
      ...strike('bankOre.settle', 587.33, { gain: 0.2, decay: 0.3, at: 0.08, partials: GLASS_PAIR, seed: 0xf2d8 }),
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
      ...strike('upgradeBought.a', 1046.5, { gain: 0.22, decay: 0.26, partials: GLASS_PAIR, seed: 0x9b5d }),
      ...strike('upgradeBought.b', 1318.51, { gain: 0.22, decay: 0.26, at: 0.08, partials: GLASS_PAIR, seed: 0x9b60 }),
      ...strike('upgradeBought.c', 1760, { gain: 0.24, decay: 0.42, at: 0.16, seed: 0x9b63 }),
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
          decayCurve: 2,
          freq: 147,
          vibratoDepth: 0.015,
          vibratoRate: 6, // 550 ms voice: drift, not a wobble (§5.4 exempt)
          noiseMix: 0.14,
          lowPass: 340,
          lowPassEnd: 900, // the horn opening as it sounds — a machine, not a note
          resonance: 3.4,
          gain: 0.5,
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
          decayCurve: 2,
          freq: 220,
          noiseMix: 0.1,
          lowPass: 1600,
          lowPassEnd: 500,
          resonance: 3,
          gain: 0.34,
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
          decayCurve: 1.6, // entropy does not stop on a schedule
          freq: 96,
          freqEnd: 40,
          lowPass: 700,
          lowPassEnd: 180, // the field closing over 2.3 s — the collapse itself
          resonance: 2,
          gain: 0.48,
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
          decayCurve: 1.3, // barely bent: entropy does not have an edge
          freq: 73,
          freqEnd: 55,
          noiseMix: 0.04,
          lowPass: 200,
          resonance: 1.8,
          gain: 0.34,
          seed: 0x0d11,
        },
      },
    ],
  },

  // --- The one serious thing ----------------------------------------------

  /**
   * The station-death sound (GDD §4.7). **Untouched by the re-voice, and that is
   * a decision rather than an omission.** The amendment carries this beat over
   * character for character — *"when a station dies, the game goes briefly quiet,
   * the wreck stays on the map all match, and nobody jokes for three seconds"* —
   * and names it a mechanic of tone rather than polish.
   *
   * It does not blip, it does not sparkle, and it does not resolve. A long fall
   * and a low tail — and then the mix goes to zero underneath it for three
   * seconds (`../vfx/death-moment`), so the sound a player actually remembers is
   * the silence after it. A quiet that follows a precise, cold soundscape is a
   * bigger drop than one that follows a firework, so the pass around it makes
   * this land harder, not softer.
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
          decay: 1.1, // HELD to the millisecond: this is the longest-tail invariant
          decayCurve: 1.5, // barely bent — it must not resolve, only run out
          punch: 0.4,
          freq: 210,
          freqEnd: 34,
          noiseMix: 0.05,
          gain: 0.38,
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
          decayCurve: 1.4,
          freq: 180,
          freqEnd: 45,
          lowPass: 900,
          lowPassEnd: 160, // the structure closing on itself over a second and a third
          resonance: 1.8,
          gain: 0.27,
          seed: 0x2f35,
        },
      },
      {
        spec: {
          name: 'stationDeath.toll',
          wave: 'triangle',
          attack: 0.006,
          hold: 0.02,
          decay: 0.94,
          decayCurve: 2.2, // struck once, and then nothing answers it
          freq: 98,
          freqEnd: 92,
          noiseMix: 0.06,
          lowPass: 420,
          resonance: 2.4,
          gain: 0.28,
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
          attack: 0.004,
          hold: 0.04,
          decay: 0.4,
          decayCurve: 3,
          freq: 392,
          noiseMix: 0.07,
          lowPass: 1600,
          resonance: 2.6,
          gain: 0.5,
          seed: 0xdce3,
        },
      },
      {
        spec: {
          name: 'matchEnd.b',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.04,
          decay: 0.52,
          decayCurve: 3,
          freq: 523,
          noiseMix: 0.07,
          lowPass: 2000,
          resonance: 2.6,
          gain: 0.48,
          seed: 0xdce4,
        },
        at: 0.12,
      },
      {
        spec: {
          name: 'matchEnd.c',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.05,
          decay: 0.95,
          decayCurve: 3.4,
          freq: 784,
          noiseMix: 0.07,
          lowPass: 2600,
          resonance: 2.6,
          gain: 0.44,
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
   * refuses to sound like music.
   *
   * **A one-shot since s9-01, not a loop** (developer, 2026-08-07: *"it should
   * only play once, and not keep playing"*). It used to be a looping body played
   * for as long as the pressure lasted; it is now a single bar, sounded once per
   * engagement by `./engine` syncAlarm, with the screen-edge arrow carrying the
   * duration instead (GDD §2.2, amended 2026-08-07). The spec loses `loop` and
   * its seam crossfade and gains the ordinary edge fades every other one-shot in
   * this bank has — the bar itself, the two tones and their levels, is untouched,
   * so what a player hears once is exactly what they used to hear repeatedly.
   */
  [SOUND.alarm]: {
    name: 'alarm',
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
          lowPassEnd: 2200,
          resonance: 2.4, // a horn body around the saw: a station siren, not a synth
          gain: 0.62,
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
          lowPassEnd: 2400,
          resonance: 2.4,
          gain: 0.62,
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
          resonance: 1.6, // a hull tone in the hiss — a place, not a noise floor
          highPass: 40,
          gain: 0.085,
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
          noiseMix: 0.03,
          lowPass: 600,
          resonance: 1.8,
          gain: 0.26,
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
          hold: 0.012,
          decay: 0.52,
          decayCurve: 3.2,
          punch: 0.8,
          freq: 110,
          freqEnd: 44,
          noiseMix: 0.04,
          lowPass: 260,
          resonance: 2.2,
          gain: 0.4,
          seed: 0xa311,
        },
      },
      {
        spec: {
          name: 'musicPulse.tick',
          wave: 'triangle',
          attack: 0.0015,
          hold: 0.004,
          decay: 0.11,
          decayCurve: 5,
          freq: 220,
          noiseMix: 0.1,
          lowPass: 1400,
          resonance: 3,
          gain: 0.14,
          seed: 0xa312,
        },
      },
    ],
  },

  /**
   * The full theme: a short A-minor riff over a sustained pad, in during a siege
   * (GDD §2.6). **Cold but driving** — triangle notes for the tune over a
   * triangle pad — because the theme has to lift a fight without commenting on a
   * station that is dying. It read *"arcade but restrained"* until the 2026-08-06
   * amendment retired the first half of that as a target; the riff, the key and
   * the timing are unchanged, and only the five square melody notes moved.
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
          noiseMix: 0.04,
          lowPass: 1200,
          resonance: 2, // the pad gets a formant, so it is an instrument not a drone
          gain: 0.17,
          seed: 0xa320,
        },
      },
      { spec: { name: 'musicTheme.n0', wave: 'triangle', attack: 0.004, hold: 0.028, decay: 0.352, decayCurve: 3.6, freq: 220, noiseMix: 0.06, lowPass: 1100, resonance: 2.6, gain: 0.1875, seed: 0xa321 }, at: 0 },
      { spec: { name: 'musicTheme.n1', wave: 'triangle', attack: 0.004, hold: 0.028, decay: 0.352, decayCurve: 3.6, freq: 261.63, noiseMix: 0.06, lowPass: 1308, resonance: 2.6, gain: 0.1875, seed: 0xa322 }, at: 0.5 },
      { spec: { name: 'musicTheme.n2', wave: 'triangle', attack: 0.004, hold: 0.035, decay: 0.416, decayCurve: 3.6, freq: 329.63, noiseMix: 0.06, lowPass: 1648, resonance: 2.6, gain: 0.1875, seed: 0xa323 }, at: 1 },
      { spec: { name: 'musicTheme.n3', wave: 'triangle', attack: 0.004, hold: 0.035, decay: 0.48, decayCurve: 3.6, freq: 293.66, noiseMix: 0.06, lowPass: 1468, resonance: 2.6, gain: 0.175, seed: 0xa324 }, at: 1.5 },
      { spec: { name: 'musicTheme.n4', wave: 'triangle', attack: 0.004, hold: 0.035, decay: 0.48, decayCurve: 3.6, freq: 261.63, noiseMix: 0.06, lowPass: 1308, resonance: 2.6, gain: 0.175, seed: 0xa325 }, at: 2.1 },
      { spec: { name: 'musicTheme.n5', wave: 'triangle', attack: 0.006, hold: 0.049, decay: 0.8, decayCurve: 3.6, freq: 220, noiseMix: 0.06, lowPass: 1100, resonance: 2.6, gain: 0.1625, seed: 0xa326 }, at: 2.7 },
      { spec: { name: 'musicTheme.n6', wave: 'triangle', attack: 0.006, hold: 0.07, decay: 0.64, decayCurve: 3.6, freq: 164.81, noiseMix: 0.06, lowPass: 824, resonance: 2.6, gain: 0.15, seed: 0xa327 }, at: 3.3 },
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
          noiseMix: 0.04,
          lowPass: 500,
          resonance: 1.8,
          gain: 0.24,
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
          resonance: 1.6,
          gain: 0.06,
          seed: 0xa333,
        },
      },
    ],
  },

  /**
   * The win sting: a rising major arpeggio, quickly over — an acknowledgement,
   * not a fanfare and no longer *"a firework for the surface"*, which quoted the
   * paragraph the 2026-08-06 amendment retired. Held back until the three-second
   * quiet has lifted (`./music`), so it lands *after* the silence.
   */
  [SOUND.musicWin]: {
    name: 'musicWin',
    layers: [
      { spec: { name: 'musicWin.n0', wave: 'triangle', attack: 0.006, hold: 0.021, decay: 0.256, decayCurve: 3.6, freq: 220, noiseMix: 0.06, lowPass: 1100, resonance: 2.6, gain: 0.3, seed: 0xa340 }, at: 0 },
      { spec: { name: 'musicWin.n1', wave: 'triangle', attack: 0.006, hold: 0.021, decay: 0.256, decayCurve: 3.6, freq: 277.18, noiseMix: 0.06, lowPass: 1385, resonance: 2.6, gain: 0.3, seed: 0xa341 }, at: 0.14 },
      { spec: { name: 'musicWin.n2', wave: 'triangle', attack: 0.006, hold: 0.021, decay: 0.288, decayCurve: 3.6, freq: 329.63, noiseMix: 0.06, lowPass: 1648, resonance: 2.6, gain: 0.3, seed: 0xa342 }, at: 0.28 },
      { spec: { name: 'musicWin.n3', wave: 'triangle', attack: 0.006, hold: 0.049, decay: 0.8, decayCurve: 3.6, freq: 440, noiseMix: 0.06, lowPass: 2200, resonance: 2.6, gain: 0.35, seed: 0xa343 }, at: 0.42 },
      { spec: { name: 'musicWin.shine', wave: 'triangle', attack: 0.01, hold: 0.035, decay: 0.64, decayCurve: 3.6, freq: 880, noiseMix: 0.06, lowPass: 4400, resonance: 2.6, gain: 0.15, seed: 0xa344 }, at: 0.42 },
    ],
  },

  /**
   * The loss sting: a falling minor phrase that settles low and stops. The ache,
   * with nothing on top of it — the one thing in the soundtrack that is allowed
   * to be sad. Untouched by the re-voice: it had no arcade in it to remove.
   */
  [SOUND.musicLoss]: {
    name: 'musicLoss',
    layers: [
      { spec: { name: 'musicLoss.n0', wave: 'triangle', attack: 0.008, hold: 0.035, decay: 0.32, decayCurve: 3.6, freq: 220, noiseMix: 0.06, lowPass: 1100, resonance: 2.6, gain: 0.275, seed: 0xa350 }, at: 0 },
      { spec: { name: 'musicLoss.n1', wave: 'triangle', attack: 0.008, hold: 0.035, decay: 0.384, decayCurve: 3.6, freq: 174.61, noiseMix: 0.06, lowPass: 873, resonance: 2.6, gain: 0.275, seed: 0xa351 }, at: 0.24 },
      { spec: { name: 'musicLoss.n2', wave: 'sine', attack: 0.008, hold: 0.042, decay: 0.7, decayCurve: 3.6, freq: 146.83, noiseMix: 0.06, lowPass: 734, resonance: 2.6, gain: 0.3, seed: 0xa352 }, at: 0.5 },
      { spec: { name: 'musicLoss.low', wave: 'sine', attack: 0.01, hold: 0.04, decay: 0.6, decayCurve: 2.4, freq: 110, noiseMix: 0.05, lowPass: 320, resonance: 2.2, gain: 0.28, seed: 0xa353 }, at: 0.62 },
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
    layers: [...strike('pressTick', 1661, { gain: 0.1, decay: 0.05, seed: 0x7a70 })],
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
          attack: 0.002,
          hold: 0.008,
          decay: 0.1,
          decayCurve: 4.5,
          freq: 659.25,
          noiseMix: 0.07,
          lowPass: 2200,
          resonance: 2.8,
          gain: 0.38,
          seed: 0x7a71,
        },
      },
      {
        spec: {
          name: 'purchaseConfirm.b',
          wave: 'triangle',
          attack: 0.002,
          hold: 0.008,
          decay: 0.17,
          decayCurve: 4.5,
          freq: 987.77,
          noiseMix: 0.07,
          lowPass: 3000,
          resonance: 2.8,
          gain: 0.38,
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
      ...strike('rejectBuzz.a', 1661, { gain: 0.14, decay: 0.17, partials: GLASS_PAIR, seed: 0xb23f }),
      ...strike('rejectBuzz.b', 1760, { gain: 0.14, decay: 0.17, at: 0.05, partials: GLASS_PAIR, seed: 0xb241 }),
      {
        // The body under the pair — the `refused` cue's own sub, which is what
        // stops two high struck notes reading as a chime.
        spec: {
          name: 'rejectBuzz.body',
          wave: 'sine',
          attack: 0.003,
          hold: 0.012,
          decay: 0.12,
          decayCurve: 4,
          freq: 84,
          freqEnd: 80,
          noiseMix: 0.05,
          lowPass: 200,
          resonance: 2,
          gain: 0.16,
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
   * Both halves of this pair are re-voiced in every pass, which makes it the one
   * place a converging palette could genuinely cost the player information: at
   * ×1.13 apart in spectral centre it was once the tightest pair in the bank. The
   * *falling* it originally carried as a chirp is carried by **register** instead
   * — the same struck material as its twin, now **exactly an octave below it**,
   * which is the plainest statement of "the same chunk, one step later" the
   * instrument can make — plus the thinner two-partial form, which is the
   * handoff's own choice for a note that answers rather than announces.
   *
   * Round 2 also pulls its **contact transient down to 0.45** (`./bank` `strike`).
   * Tractoring a chunk in is a machine closing on something; a chunk settling into
   * a bin is not. The duller edge is both the right sound and what re-opens the
   * pair — the octave alone measured ×1.75 against a guarded floor of ×1.80.
   *
   * `audio.test.ts` guards this pair by name.
   */
  [SOUND.depositTick]: {
    name: 'depositTick',
    layers: [
      ...strike('depositTick', 523.25, { gain: 0.16, decay: 0.11, partials: GLASS_PAIR, contact: 0.45, seed: 0xf2d7 }),
    ],
  },

  // The respawn countdown (GDD §2.7): one clean mid beep a second. Deliberately
  // plain — it is a clock, and the bright one below is the release it counts to.
  [SOUND.respawnBeep]: {
    name: 'respawnBeep',
    layers: [
      {
        spec: {
          name: 'respawnBeep.tick',
          wave: 'triangle',
          attack: 0.002,
          hold: 0.008,
          decay: 0.11,
          decayCurve: 4.5, // a relay closing once a second, not a tone opening
          freq: 660,
          noiseMix: 0.08,
          lowPass: 2400,
          resonance: 3,
          gain: 0.26,
          seed: 0x3d7d,
        },
      },
      {
        // The contact on the relay. It is what separates this clock from the
        // spawn-protection pulse under the ship, which is now an octave lower
        // and deliberately dull — `audio.test.ts` guards that pair by name.
        spec: {
          name: 'respawnBeep.contact',
          wave: 'noise',
          attack: 0.0004,
          hold: 0.0015,
          decay: 0.028,
          decayCurve: 7,
          freq: 1980,
          lowPass: 1980,
          resonance: 5,
          bandPass: true,
          gain: 0.16,
          seed: 0x3d80,
        },
      },
    ],
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
          hold: 0.02,
          decay: 0.18,
          decayCurve: 2.6,
          freq: 660,
          freqEnd: 780,
          noiseMix: 0.08,
          lowPass: 700,
          lowPassEnd: 3000, // the launch clamp releasing: it opens, it does not slide
          resonance: 3.6,
          gain: 0.34,
          seed: 0x3d7e,
        },
      },
      ...strike('respawnGo.top', 1320, { gain: 0.16, decay: 0.2, at: 0.12, partials: GLASS_PAIR, seed: 0x3d7f }),
    ],
  },

  // A rising sonar blip that rings a moment and fades. Plasma-blue in character
  // (style-guide §1) — this locates, it does not warn, so it must never be
  // mistaken for the alarm. The rise stays: locating is the one thing in the
  // bank a rise still legitimately means, and at 293 ms it reads as a sweep
  // rather than as a chirp. The 12 Hz wobble on top of it does not stay.
  //
  // **The name is a fossil.** The minimap *ping mechanic was cut* (§2.4, §4.9);
  // this cue is live and correctly wired, but `src/main.ts` raises it for the
  // minimap **toggle**. Renaming it (and the `'ping'` cue in {@link AudioCue})
  // touches five files and is deliberately not folded into a re-voice, where it
  // would make it impossible to review which sound actually changed — it is
  // s7-01 §11 Q7, open for the developer.
  [SOUND.minimapPing]: {
    name: 'minimapPing',
    layers: [
      {
        spec: {
          name: 'minimapPing.blip',
          wave: 'sine',
          attack: 0.003,
          hold: 0.012,
          decay: 0.28,
          decayCurve: 3.2,
          freq: 880,
          freqEnd: 1320,
          noiseMix: 0.05,
          lowPass: 1200,
          lowPassEnd: 3200, // a return coming into focus. Sonar, not a chime
          resonance: 4,
          gain: 0.3,
          seed: 0x4dc9,
        },
      },
      {
        spec: {
          name: 'minimapPing.ring',
          wave: 'triangle',
          attack: 0.002,
          hold: 0.006,
          decay: 0.24,
          decayCurve: 5,
          freq: 1760,
          noiseMix: 0.06,
          gain: 0.13,
          seed: 0x4dca,
        },
        at: 0.02,
      },
    ],
  },

  // --- The end-of-match summary (p1-07) -----------------------------------
  //
  // The developer asked the end-of-match sequence for *"a satisfying sound"*
  // (`docs/progression-plan.md` §6). These four are that ask, answered as a beat
  // rather than as one sting: three of them exist so the fourth lands.
  //
  // None of them is built out of {@link strike}. That is deliberate and it is the
  // one structural decision in this group: the Gantry/Bone material is the sound
  // of a *confirmation* — a pick, a purchase, a refusal, a chunk banked — and
  // hearing it again here would make a level-up sound like a wheel press with
  // more notes on it. These are made of swept resonance and band-passed material
  // instead: the same instrument the rest of round 2 is built from
  // (`../synth` — `decayCurve`, `resonance`, `lowPassEnd`, `bandPass`), spent on
  // a different gesture.

  /**
   * **The count-up tick** (beat 1–2), and the whole design is a subtraction.
   *
   * It fires up to ~40 times inside five seconds, on a screen the player sees
   * after every single match forever. The failure mode is not "boring", it is
   * **fatigue**: anything with a pitch centre becomes a melody at forty
   * repetitions, and anything with a tail becomes a buzz. So this is one narrow
   * band of noise, ~20 ms, band-passed so it is made of material rather than of a
   * tone, with a curve of 8 — *"a click with a whisper after it"* (`../synth`) —
   * so it is comfortably gone before the next one arrives at 8/s.
   *
   * At 0.0101 RMS it is the **quietest sound in the bank** — `xpSettle` is next,
   * and `pressTick` after that — and `audio.test.ts` holds it to `pressTick`'s
   * bound rather than `matchEnd`'s: shorter, quieter, and forty of them stacked
   * at any plausible rate must not climb into the mix.
   *
   * The *"pitched up slightly as the count rises"* the plan asks for is playback
   * rate at the seam ({@link XP_TICK_SEMITONES}, `./engine` cue), not a voice per
   * step: a rise written as data is one buffer and a number, where forty specs
   * would be forty renders of the same 20 ms of noise.
   */
  [SOUND.xpTick]: {
    name: 'xpTick',
    wave: 'noise',
    attack: 0.0004,
    hold: 0.0015,
    decay: 0.018,
    decayCurve: 8, // a click with a whisper after it — nothing left to accumulate
    freq: 1320,
    lowPass: 1320,
    resonance: 4, // narrow enough to read as a contact, not wide enough to hiss
    bandPass: true,
    highPass: 700, // no low end at all: forty of these must not thicken the mix
    gain: 0.6,
    seed: 0x7c10,
  },

  /**
   * **The bed under the bar filling** (beat 3): *a filling sound, not a repeated
   * one*.
   *
   * A **loop**, and that is the load-bearing choice. The fill runs for a tunable
   * beat and is capped shorter on each subsequent level-up (plan §6.3), so its
   * length is not knowable when it starts; and a player who skips must have it
   * *stop*, which a one-shot in flight cannot do. A loop can be started with the
   * bar and faded out with it, which is exactly what the cue is specified to be.
   *
   * So the *rising* is not inside the body — a sweep inside a loop restarts every
   * lap and reads as a pulse, which is the one artefact `../synth` seamless
   * exists to kill. The body is a still, grained bed, and `./engine` xpFill rides
   * its rate and level with the bar's own progress. A bed that opens as the bar
   * fills is a machine taking on charge; a bed that repeats is a metronome.
   *
   * It is low and mid, deliberately: {@link SOUND.levelUp} lands bright, on top
   * of it, and the two must not fight. The seam ducks this under that landing.
   */
  [SOUND.xpBarFill]: {
    name: 'xpBarFill',
    loop: true,
    crossfade: 0.25,
    layers: [
      {
        // The body. A2 — an octave over the ambient bed's A1, so the summary
        // screen is in the same room as the match it just ended.
        spec: {
          name: 'xpBarFill.bed',
          wave: 'triangle',
          attack: 0,
          hold: 3,
          decay: 0,
          freq: 110,
          noiseMix: 0.07,
          lowPass: 460,
          resonance: 2.2,
          gain: 0.13,
          seed: 0x7c20,
        },
      },
      {
        // The fifth over it, thinner. Two intervals and no third: the bed states
        // no mood of its own, because a defeat is still a defeat underneath it.
        spec: {
          name: 'xpBarFill.fifth',
          wave: 'triangle',
          attack: 0,
          hold: 3,
          decay: 0,
          freq: 165,
          noiseMix: 0.06,
          lowPass: 720,
          resonance: 2.6,
          gain: 0.065,
          seed: 0x7c21,
        },
      },
      {
        // The air that makes it a *filling* rather than a chord being held: a
        // narrow band of moving noise, the sound of something being poured in.
        spec: {
          name: 'xpBarFill.air',
          wave: 'noise',
          attack: 0,
          hold: 3,
          decay: 0,
          freq: 96,
          lowPass: 880,
          resonance: 2.8,
          highPass: 190,
          gain: 0.075,
          seed: 0x7c22,
        },
      },
    ],
  },

  /**
   * **The level-up** (beat 4) — the one moment in this set allowed to be a
   * reward, and the sound the developer's *"satisfying sound"* actually names.
   *
   * The amended §4.7 is the ceiling, not the old paragraph's fireworks, so the
   * shape is **arrival**: something approaches, lands once, and rings out. Not a
   * rising phrase — a rising arpeggio is the retired idiom (§5.3), and three
   * notes climbing is what {@link SOUND.upgradeBought} already is.
   *
   *  - **The approach** is a *filter* opening, not a pitch chirp. §5.4 separates
   *    the two by name: a corner travelling up over a fixed pitch is a machine
   *    taking on energy, where a pitch sliding up in 90 ms is a cartoon.
   *  - **The landing** is a band-passed contact — two hard things touching —
   *    struck at the same instant as the note, so the pair reads as one event.
   *  - **The note** is a bare fifth, A5 over E6, struck together rather than in
   *    sequence. No third, so it is neither triumphant nor sad: the interface
   *    voice does not congratulate (§4.7 register 2), and a level-up landing on
   *    a defeat must not argue with the headline above it.
   *  - **The seat** under it is what stops five bright layers reading as a chime.
   *
   * ~0.44 s end to end. Short enough to cancel, long enough to be the moment.
   */
  [SOUND.levelUp]: {
    name: 'levelUp',
    layers: [
      {
        spec: {
          name: 'levelUp.approach',
          wave: 'noise',
          attack: 0.006,
          hold: 0.012,
          decay: 0.07,
          decayCurve: 2.6,
          freq: 300,
          lowPass: 700,
          lowPassEnd: 3400, // energy arriving — the corner travels, the pitch does not
          resonance: 5,
          highPass: 200,
          gain: 0.15,
          seed: 0x7c30,
        },
      },
      {
        spec: {
          name: 'levelUp.contact',
          wave: 'noise',
          attack: 0.0004,
          hold: 0.002,
          decay: 0.055,
          decayCurve: 7,
          punch: 0.6,
          freq: 2200,
          lowPass: 2200,
          resonance: 5,
          bandPass: true,
          gain: 0.34,
          seed: 0x7c31,
        },
        at: 0.085,
      },
      {
        spec: {
          name: 'levelUp.note',
          wave: 'triangle',
          attack: 0.0015,
          hold: 0.004,
          decay: 0.34,
          decayCurve: 4,
          freq: 880,
          noiseMix: 0.08,
          lowPass: 2800,
          lowPassEnd: 950, // the body closing as it rings out, rather than fading
          resonance: 3.2,
          gain: 0.3,
          seed: 0x7c32,
        },
        at: 0.085,
      },
      {
        spec: {
          name: 'levelUp.fifth',
          wave: 'triangle',
          attack: 0.0015,
          hold: 0.004,
          decay: 0.26,
          decayCurve: 4.5,
          freq: 1318.51,
          noiseMix: 0.09,
          lowPass: 3200,
          lowPassEnd: 1300,
          resonance: 3.4,
          gain: 0.17,
          seed: 0x7c33,
        },
        at: 0.085,
      },
      {
        spec: {
          name: 'levelUp.seat',
          wave: 'triangle',
          attack: 0.002,
          hold: 0.01,
          decay: 0.2,
          decayCurve: 4.2,
          freq: 110,
          noiseMix: 0.06,
          lowPass: 320,
          resonance: 2,
          gain: 0.2,
          seed: 0x7c34,
        },
        at: 0.085,
      },
    ],
  },

  /**
   * **The settle** (beat 5). The full stop.
   *
   * Its whole job is to say *the screen has finished moving and your input means
   * something again*, which is a smaller job than any other cue here — so it is
   * the second-quietest sound in the bank, behind only the tick that leads to it,
   * and under `pressTick`. A machine coming to rest: a soft contact, and a low
   * body behind a corner that closes.
   *
   * It resolves **downward**, an octave under the level-up's note, because a
   * settle that ends higher than it started is a question rather than a stop.
   */
  [SOUND.xpSettle]: {
    name: 'xpSettle',
    layers: [
      {
        spec: {
          name: 'xpSettle.contact',
          wave: 'noise',
          attack: 0.0006,
          hold: 0.002,
          decay: 0.03,
          decayCurve: 7,
          freq: 520,
          lowPass: 520,
          resonance: 3.5,
          bandPass: true,
          gain: 0.13,
          seed: 0x7c40,
        },
      },
      {
        spec: {
          name: 'xpSettle.rest',
          wave: 'triangle',
          attack: 0.004,
          hold: 0.02,
          decay: 0.2,
          decayCurve: 5,
          freq: 220,
          noiseMix: 0.08,
          lowPass: 900,
          lowPassEnd: 260, // coming to rest: the corner closes and stays closed
          resonance: 2.6,
          gain: 0.16,
          seed: 0x7c41,
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
 * Three more are the **end-of-match summary's** beats (p1-07, plan §6.3), raised
 * by the sequence rather than by a finger — the count-up tick, the level-up, and
 * the settle that hands the screen back:
 *
 *  - `xpTick`   — one number ticking up. `index` is the tick's ordinal, and the
 *    cue pitches up with it ({@link XP_TICK_SEMITONES}).
 *  - `levelUp`  — the bar completed and the level readout moved.
 *  - `xpSettle` — everything has landed; the buttons are live.
 *
 * The fourth summary cue, {@link SOUND.xpBarFill}, is deliberately **not** here:
 * it is a held loop with a start and a stop, and a cue is a moment. It has its
 * own seam, {@link AudioEngine.xpFill} / {@link AudioEngine.stopXpFill}.
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
  | 'rush'
  | 'xpTick'
  | 'levelUp'
  | 'xpSettle';

/**
 * How far the count-up tick climbs per tick, in semitones, and where the climb
 * stops (plan §6.5: *"pitched up slightly as the count rises"*).
 *
 * **Slightly** is the whole specification, and the ceiling is why this is two
 * numbers rather than one. A count-up is not a fixed length — a big match ticks
 * for longer than a small one — so an uncapped rise would end somewhere
 * different every match and, on a long one, somewhere shrill. Twelve steps of a
 * third of a semitone is a four-semitone climb, arriving at the top a third of
 * the way through a typical count and staying there: audible as *rising*, and
 * never audible as a melody.
 */
export const XP_TICK_SEMITONES = 0.35;
/** Ticks after which {@link XP_TICK_SEMITONES} stops climbing. */
export const XP_TICK_STEPS_MAX = 12;

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
  xpTick: SOUND.xpTick,
  levelUp: SOUND.levelUp,
  xpSettle: SOUND.xpSettle,
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
 *
 * The three summary cues are absent for a sharper reason. The Gantry/Bone set is
 * the sound of *the interface answering a finger* — and the end-of-match sequence
 * is the one screen where the player is not touching anything: it plays itself,
 * and the first touch **skips** it. Routing `xpTick` to `pick` would tell a
 * player their taps were registering while the screen counted itself up.
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
