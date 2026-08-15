/**
 * src/art/audio/ui-cues.ts — the Gantry / Bone UI cue set. OWNER: Art & Audio Agent.
 *
 * ── WHAT THIS IS, AND WHY IT IS NOT A STARTING POINT ────────────────────────
 * The developer chose this audio themselves (2026-08-05: *"I chose the audio
 * myself"*). The spec is `docs/design/gantry-bone-handoff.html` — a working
 * prototype that synthesises the whole set in a few hundred lines with no audio
 * assets — and `docs/design/gantry-bone-handoff.md` is its written brief. **The
 * parameters in that file are the spec.** Every number below is read out of it,
 * not chosen here; where this file departs from the prototype at all, the
 * departure is named in a comment and it is never a taste call.
 *
 * ── THE SET: ONE PANE OF STRUCK GLASS ───────────────────────────────────────
 * Nine cues, differentiated only by **pitch, direction and note count** — never
 * by material. A♭6 (1661 Hz) is the family's root and everything is measured off
 * it, which is why the detent is *"the octave above the click"* (3322) rather
 * than a second sound.
 *
 * | cue | shape |
 * |---|---|
 * | {@link UI_CUES.hover}    | one note, high, fixed pitch |
 * | {@link UI_CUES.detent}   | one note, an octave above the click, fixed pitch |
 * | {@link UI_CUES.pick}     | one note, A♭6 — the forward pick |
 * | {@link UI_CUES.confirm}  | two notes **rising** a fifth |
 * | {@link UI_CUES.back}     | two notes **falling** a fourth |
 * | {@link UI_CUES.purchase} | three notes rising — A♭6, the fifth, the octave |
 * | {@link UI_CUES.refused}  | two notes a minor second apart, resolving nowhere |
 * | {@link UI_CUES.join}     | one note, stepping up by slot index |
 * | {@link UI_CUES.rush}     | five notes climbing, then the confirm's three struck at once and held |
 *
 * ── THE THREE RULES, WRITTEN AS TESTS (`./ui-cues.test.ts`) ─────────────────
 *  1. **One sound per state change.** No cue stacking — enforced in
 *     {@link UiCuePlayer.play} by a stacking window, not by reviewer discipline.
 *  2. **The sound tells you the outcome before the pixels do.** A refused
 *     purchase and a completed one are opposite shapes: three consonant notes
 *     rising versus two notes a minor second apart that resolve nowhere.
 *  3. **Back never uses a forward cue.** A falling interval means backwards, and
 *     no forward cue in the set falls ({@link isForward}).
 *
 * ── THE INSTRUMENT ──────────────────────────────────────────────────────────
 * **Sine partials only**, on the inharmonic ratios **1 / 2.76 / 5.4** — that
 * spacing is what a struck pane does, and it is what keeps this out of bell-metal
 * territory. ~2 ms strike; upper partials decay fastest ({@link PARTIAL_DECAY}),
 * which is the whole difference between glass and a chime. **No square, no saw,
 * no pitch bends** anywhere: the handoff names each of those as what made earlier
 * passes sound retro or cartoonish, so they are absent by construction rather
 * than by preference — {@link renderUiCue} has no oscillator but a sine.
 *
 * One short **shared** reverb sits behind all nine at 25% wet
 * ({@link ROOM}). *"One space for every cue is what makes a UI sound like one
 * instrument instead of a pile of samples."*
 *
 * Every press is detuned ±0.5 semitone, **one factor per cue** so the intervals
 * stay exact — applied as a playback rate over the whole rendered cue
 * ({@link detuneFactor}), which is precisely "one factor" and cannot drift a
 * fifth into something else. **Hover and detent are excluded**: they fire
 * constantly, and a wobbling hover reads as a fault.
 *
 * ── WHAT IT MUST NOT TOUCH ──────────────────────────────────────────────────
 *  - **The three seconds of near-silence on planet death** (GDD §4.7) — the
 *    strongest beat in the spec, and protected *in the mixer*: this player's
 *    output is wired into the `sfx` bus, which is upstream of `../audio/graph`'s
 *    duck node, so the hush multiplies these cues like everything else. The
 *    engine additionally refuses to start one while the mix is at zero. Both are
 *    asserted.
 *  - **The rockChip family** (s4-01, lowered in tone at the developer's request)
 *    is untouched. These are UI cues; those are world tells, and nothing here
 *    reads or rewrites the bank's voices.
 *  - The ambient bed and the HP-tied core alarm are listed in the handoff as
 *    *"worth a conversation"*, not decided — so neither is wired from here.
 *
 * ── WHY IT RENDERS OFFLINE, LIKE THE REST OF `src/art/audio/` ───────────────
 * {@link renderUiCue} is a pure function — spec in, samples out, no context, no
 * clock, no globals — so the whole cue set is testable headless on a CI box with
 * no audio hardware (GDD §4.1), and the mix only has to *play* a buffer. The one
 * live node this file adds is the shared room's `ConvolverNode`: convolving a
 * 2.2-second impulse into all nine cues offline would cost the phone hundreds of
 * milliseconds at unlock and buy nothing, whereas one native convolver on one
 * shared bus is free and is literally the shared room the handoff specifies. It
 * is optional (`createConvolver?`), so a context without one plays the set dry
 * rather than not at all.
 */

import { mulberry32, type Rng } from '@shared/types';
import {
  toAudioBuffer,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type ConvolverNodeLike,
  type GainNodeLike,
} from './context';
import { DEFAULT_SAMPLE_RATE } from './synth';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * The nine cues, named for what the player did rather than for how they sound —
 * `back` is the one whose name is also its rule.
 */
export type UiCueName =
  /** A fingertip crossing a live control. High, fixed, undetuned. */
  | 'hover'
  /** A selection stepping one notch — a wheel detent. Fixed, undetuned. */
  | 'detent'
  /** A forward pick: one note, A♭6. The family's root, and its plainest form. */
  | 'pick'
  /** Yes: two notes rising a fifth. Not a spend — a spend is `purchase`. */
  | 'confirm'
  /** Backwards: two notes falling a fourth. BACK and CANCEL only. */
  | 'back'
  /** A spend that landed: three notes rising — A♭6, the fifth, the octave. */
  | 'purchase'
  /** No: two notes a minor second apart, resolving nowhere. */
  | 'refused'
  /** A seat filling: one note, stepping up by slot index. */
  | 'join'
  /** RUSH!: five notes climbing, then the confirm's three struck at once and held. */
  | 'rush'
  | DoorCueName;

/**
 * The title gate's four beats (`src/ui/title-gate.ts`, a0-50) — the one screen
 * in this game whose sound is a **sequence** rather than an answer to a
 * fingertip.
 *
 *  - `gateUnlock` — the opening press. Everything the machine does, in the order
 *    it does it: the valve cracks, the compartment vents, the lock ratchets
 *    round its seven detents, and the door's weight moves last.
 *  - `gateSeated` — we are through, and the room we arrived in has a size.
 *  - `gateReseal` — `Escape`: two notes stepping down, then the leaves taking up
 *    their own weight.
 *  - `gateSealed` — the lock throwing back, and pressure returning.
 *
 * They live here, as slots, because the alternative is the one the design file
 * ships: **a second synthesiser.** The prototype builds `unlock`, `seated`,
 * `hover`, `confirm` and `select` from scratch in a few hundred lines — and
 * three of those five were already ratified slots above, so only the door's own
 * beats are actually new. A second engine would mean two tone contracts and a
 * `spikes/tone-audit/measure-bank-tone.ts` that measures one of them.
 */
export type DoorCueName = 'gateUnlock' | 'gateSeated' | 'gateReseal' | 'gateSealed';

/** Every cue name, in the handoff's own table order. */
export const UI_CUE_NAMES: readonly UiCueName[] = [
  'hover',
  'detent',
  'pick',
  'confirm',
  'back',
  'purchase',
  'refused',
  'join',
  'rush',
] as const;

/**
 * The door's four, kept as their own list rather than appended to the nine.
 *
 * **This is not bookkeeping.** Every rule `ui-cues.test.ts` states over
 * {@link UI_CUE_NAMES} — *back is the only falling cue in the whole set*,
 * *nothing forward borrows back's note*, *everything resolves but `refused`* —
 * is a statement about **the interface answering a fingertip**, where a rising
 * interval means yes and a falling one means backwards. The door is not
 * answering anything: it is a machine running a sequence, and its pitches are
 * what a lock and a compartment do, in the order they do them. Folding it into
 * the nine would either break those rules or quietly weaken them into rules
 * about a smaller set, which is worse.
 */
export const DOOR_CUE_NAMES: readonly DoorCueName[] = [
  'gateUnlock',
  'gateSeated',
  'gateReseal',
  'gateSealed',
] as const;

// ---------------------------------------------------------------------------
// The instrument's constants — every one of them read out of the handoff
// ---------------------------------------------------------------------------

/**
 * The glass partial stack: inharmonic ratios over the fundamental.
 *
 * 2.76 and 5.4 are neither harmonics nor a bell's ratios — they are the spacing
 * the handoff specifies, and the reason the set reads as a *pane* rather than as
 * a chime or a synth tone.
 */
export const GLASS_PARTIALS: readonly number[] = [1, 2.76, 5.4];

/** The two-partial form: thinner, used for a cue's answering (second) note. */
export const GLASS_PAIR: readonly number[] = [1, 2.76];

/** The strike: ~2 ms to full. Small but never zero — zero is a click. */
export const STRIKE_S = 0.002;

/**
 * Partial amplitude rolloff, `gain / (i + 1) ^ ROLLOFF`.
 *
 * Steeper than a bell's, which is the point: *"steeper rolloff + faster
 * upper-partial decay = glass, not bell metal."*
 */
export const PARTIAL_ROLLOFF = 1.45;

/** Each partial's decay is this fraction of the one below it — upper first. */
export const PARTIAL_DECAY = 0.66;

/** The floor an exponential ramp aims at. Web Audio cannot ramp to zero. */
export const GAIN_FLOOR = 0.0001;

/** Seconds of silence kept past a note's decay, so nothing is truncated. */
export const NOTE_TAIL_S = 0.05;

// --- The pitches ------------------------------------------------------------

/** **A♭6.** The family's root: the forward pick, and the first note of every pair. */
export const A_FLAT_6 = 1661;

/** A fifth above the root (E♭7). The answering note of `confirm` and `purchase`. */
export const FIFTH_ABOVE = 2489;

/** An octave above the root (A♭7) — the third note of `purchase`, and the detent. */
export const OCTAVE_ABOVE = 3322;

/** A fourth *below* the root (E♭6). The answering note of `back`, and only of `back`. */
export const FOURTH_BELOW = 1245;

/** A minor second above the root (A6). `refused`, and nothing else in the set. */
export const MINOR_SECOND_ABOVE = 1760;

/** Hover's fixed pitch (A7). Above everything else, so it never competes. */
export const HOVER_HZ = 3520;

// --- The door's own numbers (a0-50) -----------------------------------------

/**
 * The lock's ratchet detent (E7).
 *
 * Deliberately **not** measured off {@link A_FLAT_6} like everything above it.
 * The nine cues spell intervals because they are speaking; a detent is a pawl
 * dropping into a tooth seven times at one fixed pitch, and it means nothing
 * except *the lock is turning*. Giving it a scale degree would make the ear
 * listen for a melody in a ratchet.
 */
export const RATCHET_HZ = 2637;

/** The ratchet's partials: a hard, thin pair. Metal on metal, not glass. */
export const RATCHET_PARTIALS: readonly number[] = [1, 4.2];

/** Detents in one throw — the handoff's *"seven detent clicks, not a servo whine"*. */
export const RATCHET_DETENTS = 7;

/** Seconds between two detents while opening. Slower than the reseal's, because
 *  the lock is being wound against the pressure rather than falling back. */
export const RATCHET_GAP_S = 0.098;

/** Seconds between two detents while the lock throws home. */
export const RATCHET_GAP_HOME_S = 0.086;

/**
 * **Pressure relief, the cue this screen owns.**
 *
 * *"A hiss is not a tone: it is broadband noise whose FILTER falls as the
 * pressure drops."* Three stages, and the numbers are the handoff's own:
 *
 *  1. the valve cracking — 7.6 kHz → 3 kHz over 200 ms
 *  2. the compartment venting — 4.8 kHz → 620 Hz over 1.7 s
 *  3. a shorter blast as the leaves break contact, with the sub arriving only
 *     when the door's weight actually moves
 *
 * The fourth entry is the reverse gesture: pressure returning to a compartment
 * *rises*, because the air is going back in.
 */
export const RELIEF = {
  /** Stage 1: the valve cracks. */
  crack: { from: 7600, to: 3000, seconds: 0.2, q: 0.8 },
  /** Stage 2: the compartment vents. The long one — this is the cue's body. */
  vent: { from: 4800, to: 620, seconds: 1.7, q: 0.5 },
  /** Stage 3: the leaves breaking contact. */
  breakaway: { from: 3200, to: 480, seconds: 0.9, q: 0.4 },
  /** The reseal's answer: pressure coming back, so the filter climbs. */
  repressurise: { from: 800, to: 2800, seconds: 0.62, q: 0.5 },
} as const;

/**
 * The floor under a swept relief stage, Hz.
 *
 * The sweep is a *band*, and a band-pass with a falling centre still passes
 * skirt energy below it. Without this the vent's last half second turns into
 * rumble competing with the door's sub, which is the one thing on this screen
 * carrying the sense of weight.
 */
export const AIR_FLOOR_HZ = 320;

// --- The detune -------------------------------------------------------------

/**
 * Per-press detune, ±0.5 semitone: a factor in `[0.971, 1.029]`.
 *
 * *"Every press varies a little so a fast sequence of clicks reads as a person
 * operating a machine rather than a sample retriggering."* Applied as **one
 * factor for the whole cue**, so a rising fifth is still exactly a rising fifth.
 */
export const DETUNE_MIN = 0.971;
/** Width of the detune range; `DETUNE_MIN + DETUNE_SPAN` is +0.5 semitone. */
export const DETUNE_SPAN = 0.058;

/** One press's detune factor. Deterministic: `mulberry32`, never `Math.random`. */
export function detuneFactor(rng: Rng): number {
  return DETUNE_MIN + rng.next() * DETUNE_SPAN;
}

// --- The room ---------------------------------------------------------------

/**
 * The one shared room. Short, bright, and behind every cue at the same level.
 *
 * The impulse is procedural — decaying noise, high-passed so the tail is air
 * rather than mud — which is what keeps this file free of binary assets like the
 * rest of the audio stack (GDD §4.5).
 */
export const ROOM = {
  /** Impulse length, seconds. */
  seconds: 2.2,
  /** Decay exponent on `(1 − x)`. Higher is a faster, drier fall. */
  decay: 2.1,
  /** Samples of onset ramp, so the impulse does not start on a step. */
  onset: 220,
  /** The wet path's high-pass, Hz. Below this the room would be mud. */
  highPassHz: 620,
  /** Wet level of the shared send: 25%. */
  wet: 0.25,
  /** Impulse channels — a stereo room, so it is wider than the dry signal. */
  channels: 2,
} as const;

/**
 * Level trim over the whole cue set.
 *
 * The prototype ran its own master at 0.5 into a bare destination; here the cues
 * sum into the `sfx` bus alongside the rest of the game, where the ratified
 * per-note gains already land them in the same 0.14–0.26 peak band the bank's
 * existing UI voices occupy. So the trim is 1: the balance is the handoff's.
 */
export const UI_CUE_LEVEL = 1;

/**
 * Minimum seconds between any two cues — rule 1, *"one sound per state change"*.
 *
 * The number is chosen to mean **"the same frame"**: shorter than one 60 Hz frame
 * (16.7 ms), so two cues raised by one handler — a press tick under a purchase,
 * a wedge that sounds itself and a caller that sounds it again — collapse to one,
 * while a genuinely *later* state change still gets its own voice. That matters
 * concretely: a wheel press and the spend the sim lands a frame or two afterwards
 * are two beats, and swallowing the second would cost the player the one cue that
 * carries the outcome (rule 2).
 */
export const STACK_GAP_S = 0.012;

/** Minimum seconds between two plays of the *same* cue. A hover is not a trill. */
export const REPEAT_GAP_S = 0.05;

// ---------------------------------------------------------------------------
// The spec shapes
// ---------------------------------------------------------------------------

/** One struck note: a stack of sine partials on {@link GLASS_PARTIALS}. */
export interface GlassNote {
  /** Seconds from the start of the cue. The note *count* and these offsets are
   *  the whole difference between confirm, purchase and rush. */
  readonly at: number;
  /** The fundamental, Hz. Every pitch in the set is measured off {@link A_FLAT_6}. */
  readonly f: number;
  /** Decay of the fundamental, seconds. Upper partials decay faster. */
  readonly dur: number;
  /** Peak amplitude of the fundamental. */
  readonly gain: number;
  /** Partial ratios — {@link GLASS_PARTIALS} or {@link GLASS_PAIR}. */
  readonly parts: readonly number[];
  /** This note's send into the shared room, 0..1. */
  readonly wet: number;
  /** Attack, seconds. ~2 ms everywhere ({@link STRIKE_S}). */
  readonly strike: number;
}

/**
 * A breath of air, not grit: high-passed noise, always quiet, always short.
 *
 * It is the transient that makes a strike sound like contact. It carries no
 * pitch, so it can never argue with the interval a cue is spelling out.
 */
export interface AirNote {
  readonly at: number;
  readonly dur: number;
  /** Filter cutoff (or band centre), Hz — where the sweep STARTS. */
  readonly freq: number;
  /** Filter Q. */
  readonly q: number;
  readonly gain: number;
  readonly wet: number;
  /**
   * Where the filter LANDS, Hz. Omitted on every one of the nine — their air is
   * a 20 ms transient and a filter has nowhere to go in 20 ms.
   *
   * Present, it is what turns a breath into **pressure relief**: the gesture is
   * the filter falling, not the level. Exponential, because a cutoff is heard in
   * ratios exactly as a pitch is — and it is not a pitch bend, because there is
   * no pitch in noise to bend (§4.7's *"no pitch bends"* is about tones).
   */
  readonly to?: number;
  /**
   * Band-pass the noise instead of high-passing it, over {@link AIR_FLOOR_HZ}.
   *
   * A high-pass that falls hands you everything above the cutoff, so a falling
   * high-pass gets *brighter* as it drops — the opposite of a compartment
   * emptying. A band that falls is the sound the handoff describes.
   */
  readonly band?: boolean;
}

/**
 * A clean low body for weight — a filtered sine falling a little, never a saw.
 *
 * Dry only: the room is for the glass. A sub through a reverb is mud.
 */
export interface SubNote {
  readonly at: number;
  /** Start frequency, Hz. */
  readonly f0: number;
  /** End frequency, Hz — an exponential fall, well inside "no pitch bends":
   *  this is a body thump's shape, not a melodic slide, and it is inaudible as
   *  pitch at 90 Hz over 70 ms. */
  readonly f1: number;
  readonly dur: number;
  readonly gain: number;
}

/** One cue: its notes, its air, its body, and how a press varies it. */
export interface UiCueSpec {
  readonly name: UiCueName;
  /** The struck notes, in strike order. */
  readonly notes: readonly GlassNote[];
  readonly air: readonly AirNote[];
  readonly sub: readonly SubNote[];
  /**
   * Whether a press detunes this cue. **False for hover and detent** — they fire
   * constantly, and a wobbling hover reads as a fault.
   */
  readonly detuned: boolean;
  /**
   * Whether the cue steps by an index — one semitone per slot, so a roster
   * filling up walks up the scale. Only `join` does.
   */
  readonly stepped: boolean;
  /** One line on what the shape means, for the debug overlay and test failures. */
  readonly shape: string;
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/** A struck note, with the handoff's defaults filled in. */
function ping(
  f: number,
  dur: number,
  gain: number,
  wet: number,
  parts: readonly number[] = GLASS_PARTIALS,
  at = 0,
  strike = STRIKE_S,
): GlassNote {
  return { at, f, dur, gain, parts, wet, strike };
}

function air(dur: number, freq: number, gain: number, wet: number, at = 0, q = 0.7): AirNote {
  return { at, dur, freq, q, gain, wet };
}

/** One stage of {@link RELIEF}: broadband noise whose band falls (or climbs). */
function relief(
  stage: { readonly from: number; readonly to: number; readonly seconds: number; readonly q: number },
  gain: number,
  wet: number,
  at = 0,
): AirNote {
  return { at, dur: stage.seconds, freq: stage.from, to: stage.to, q: stage.q, gain, wet, band: true };
}

function sub(f0: number, f1: number, dur: number, gain: number, at = 0): SubNote {
  return { at, f0, f1, dur, gain };
}

/**
 * The nine cues, verbatim from the handoff prototype's `cue()` switch.
 *
 * Read this table as the handoff's own one: hover and detent are single fixed
 * notes; pick is the root alone; confirm and back are the same two-note gesture
 * mirrored; purchase extends confirm by one note; refused is the same two-note
 * gesture with the interval poisoned; join is pick, stepped; rush is the whole
 * family arriving at once.
 */
export const UI_CUES: Readonly<Record<UiCueName, UiCueSpec>> = {
  // Fingertip on glass. High and fixed — it must be the lightest thing in the
  // set, and it must not wobble, because a wobbling hover reads as a fault.
  hover: {
    name: 'hover',
    notes: [ping(HOVER_HZ, 0.16, 0.04, 0.34)],
    air: [air(0.02, 9000, 0.014, 0.2)],
    sub: [],
    detuned: false,
    stepped: false,
    shape: 'one note, high, fixed pitch',
  },

  // Wheel selection: the hover an octave up from the click, one note, very short
  // — it fires constantly, so it is the lightest thing in the set while still
  // obviously the same pane.
  detent: {
    name: 'detent',
    notes: [ping(OCTAVE_ABOVE, 0.12, 0.038, 0.28, GLASS_PAIR)],
    air: [],
    sub: [],
    detuned: false,
    stepped: false,
    shape: 'one note, an octave above the click, fixed pitch',
  },

  // The hover itself, an octave down and a touch longer — one note, no answer.
  pick: {
    name: 'pick',
    notes: [ping(A_FLAT_6, 0.19, 0.05, 0.3)],
    air: [air(0.014, 9000, 0.01, 0.18)],
    sub: [],
    detuned: true,
    stepped: false,
    shape: 'one note, A♭6',
  },

  // The hover's material, an affirmation's shape: the same three-partial glass,
  // dropped an octave, struck twice — A♭6 then a fifth above it 45 ms later. Two
  // consonant notes rising is what the ear reads as "yes". No noise transient
  // anywhere; that was the hard edge.
  confirm: {
    name: 'confirm',
    notes: [
      ping(A_FLAT_6, 0.3, 0.075, 0.36),
      ping(FIFTH_ABOVE, 0.22, 0.05, 0.34, GLASS_PAIR, 0.045),
    ],
    air: [air(0.016, 9000, 0.012, 0.2)],
    sub: [sub(104, 78, 0.07, 0.055)],
    detuned: true,
    stepped: false,
    shape: 'two notes rising a fifth',
  },

  // Same glass, mirrored: two notes stepping DOWN a fourth, struck separately
  // (never a glide — that was the toony part). Reserved for BACK and CANCEL
  // only; a forward action must never use it.
  back: {
    name: 'back',
    notes: [
      ping(A_FLAT_6, 0.2, 0.055, 0.3, GLASS_PAIR),
      ping(FOURTH_BELOW, 0.26, 0.06, 0.32, GLASS_PARTIALS, 0.05),
    ],
    air: [],
    sub: [sub(92, 62, 0.08, 0.06)],
    detuned: true,
    stepped: false,
    shape: 'two notes falling a fourth',
  },

  // The confirm's rising pair, extended to three notes — A♭6, the fifth, the
  // octave. Same material, same direction, more of it: a purchase is a confirm
  // with consequences.
  purchase: {
    name: 'purchase',
    notes: [
      ping(A_FLAT_6, 0.26, 0.07, 0.36),
      ping(FIFTH_ABOVE, 0.24, 0.055, 0.36, GLASS_PAIR, 0.06),
      ping(OCTAVE_ABOVE, 0.34, 0.045, 0.4, GLASS_PARTIALS, 0.13),
    ],
    air: [air(0.016, 9000, 0.012, 0.2)],
    sub: [sub(104, 74, 0.09, 0.07)],
    detuned: true,
    stepped: false,
    shape: 'three notes rising — A♭6, the fifth, the octave',
  },

  // Same two-note shape as the others, but the interval is a minor second and it
  // goes nowhere — the pair beats against itself instead of resolving.
  // Recognisable as the family; unmistakably not a yes.
  refused: {
    name: 'refused',
    notes: [
      ping(A_FLAT_6, 0.26, 0.055, 0.26, GLASS_PAIR),
      ping(MINOR_SECOND_ABOVE, 0.32, 0.055, 0.26, GLASS_PAIR, 0.05),
    ],
    air: [],
    sub: [sub(84, 80, 0.14, 0.075)],
    detuned: true,
    stepped: false,
    shape: 'two notes a minor second apart, resolving nowhere',
  },

  // One note per seat, stepping up the roster — the family's single-note form.
  // The step itself is a playback rate at fire time ({@link UiCuePlayer.play}),
  // so one rendered buffer serves all eight seats.
  join: {
    name: 'join',
    notes: [ping(A_FLAT_6, 0.26, 0.055, 0.4, GLASS_PARTIALS, 0.04)],
    air: [air(0.1, 6000, 0.02, 0.3)],
    sub: [],
    detuned: true,
    stepped: true,
    shape: 'one note, stepping up by slot index',
  },

  // Five single notes climbing, then the confirm's three notes struck at once and
  // held. Nothing new is introduced — it is the whole family arriving together,
  // which is why it lands.
  rush: {
    name: 'rush',
    notes: [
      ...Array.from({ length: 5 }, (_unused, i) =>
        ping(A_FLAT_6 * Math.pow(2, i / 12), 0.28, 0.062, 0.42, GLASS_PARTIALS, i * 0.42),
      ),
      ping(A_FLAT_6, 1.3, 0.075, 0.6, GLASS_PARTIALS, 2.1, 0.003),
      ping(FIFTH_ABOVE, 1.1, 0.055, 0.6, GLASS_PAIR, 2.1, 0.003),
      ping(OCTAVE_ABOVE, 0.9, 0.04, 0.6, GLASS_PAIR, 2.1, 0.003),
    ],
    air: [air(0.5, 8000, 0.018, 0.5, 2.1)],
    sub: [sub(104, 78, 0.4, 0.11, 2.1)],
    detuned: true,
    stepped: false,
    shape: 'five notes climbing, then the three confirm notes struck at once and held',
  },

  // --- The door (a0-50) ----------------------------------------------------
  //
  // Same material as the nine — struck glass over one shared room — with the one
  // thing the interface never needed: broadband noise whose FILTER moves. A door
  // is the only object in this game that vents.

  /**
   * Beat 1, and the longest cue in the set at ~2.7 s.
   *
   * The order is the machine's, not the edit's: the valve cracks, the
   * compartment vents underneath everything, the lock ratchets round its seven
   * detents, it seats on the family's root — and **the sub arrives last**,
   * because the door's weight does not move until the lock has let go of it.
   * Playing the weight early is what makes a pressure door read as a sliding
   * panel.
   */
  gateUnlock: {
    name: 'gateUnlock',
    notes: [
      ...Array.from({ length: RATCHET_DETENTS }, (_unused, i) =>
        ping(RATCHET_HZ, 0.09, 0.036, 0.22, RATCHET_PARTIALS, 0.14 + i * RATCHET_GAP_S, 0.001),
      ),
      ping(A_FLAT_6, 0.3, 0.062, 0.36, GLASS_PARTIALS, 0.86),
    ],
    air: [
      relief(RELIEF.crack, 0.11, 0.3),
      relief(RELIEF.vent, 0.1, 0.45, 0.05),
      relief(RELIEF.breakaway, 0.075, 0.45, 0.92),
    ],
    sub: [sub(116, 48, 0.6, 0.17, 0.94)],
    detuned: true,
    stepped: false,
    shape: 'a valve, a compartment venting, seven detents, and the weight moving last',
  },

  /**
   * Beat 4: we are through, and the room we arrived in has a size.
   *
   * `purchase`'s three notes — root, fifth, octave — struck **at one instant**
   * and left to ring at double the wet of anything else in the set. Nothing new
   * is introduced: it is the arrival the family already spells, held long enough
   * to be a place rather than an answer.
   */
  gateSeated: {
    name: 'gateSeated',
    notes: [
      ping(A_FLAT_6, 0.9, 0.055, 0.5),
      ping(FIFTH_ABOVE, 0.7, 0.04, 0.5, GLASS_PAIR),
      ping(OCTAVE_ABOVE, 0.55, 0.03, 0.5, GLASS_PAIR),
    ],
    air: [],
    sub: [],
    detuned: true,
    stepped: false,
    shape: 'the confirm triad struck at once and held in the room',
  },

  /**
   * `Escape`, beat 1 in reverse: **`back`'s two notes**, note for note, with the
   * door's weight under them.
   *
   * It is literally the ratified `back` — A♭6 then a fourth below it 50 ms later
   * — because going back through the door is going back, and rule 3 does not
   * stop applying because the control is a whole screen. What it adds is the sub
   * at 0.62 s: not the cue's punctuation but the leaves taking up their own
   * weight, which happens well after the notes have said what they mean.
   */
  gateReseal: {
    name: 'gateReseal',
    notes: [
      ping(A_FLAT_6, 0.2, 0.055, 0.3, GLASS_PAIR),
      ping(FOURTH_BELOW, 0.26, 0.06, 0.32, GLASS_PARTIALS, 0.05),
    ],
    air: [],
    sub: [sub(128, 54, 0.4, 0.16, 0.62)],
    detuned: true,
    stepped: false,
    shape: "back's falling fourth, with the leaves' weight under it",
  },

  /**
   * The lock throwing home, once the leaves are measurably shut.
   *
   * The same seven detents, a little faster — a lock falling back is not being
   * wound against anything — then the one stage of {@link RELIEF} that **climbs**:
   * pressure returning to a compartment is air going back in. It lands on
   * `back`'s answering note, so the reseal opens and closes on the same word.
   */
  gateSealed: {
    name: 'gateSealed',
    notes: [
      ...Array.from({ length: RATCHET_DETENTS }, (_unused, i) =>
        ping(RATCHET_HZ, 0.09, 0.032, 0.22, RATCHET_PARTIALS, i * RATCHET_GAP_HOME_S, 0.001),
      ),
      ping(FOURTH_BELOW, 0.3, 0.05, 0.28, GLASS_PARTIALS, 0.66),
    ],
    air: [relief(RELIEF.repressurise, 0.06, 0.45, 0.62)],
    sub: [],
    detuned: true,
    stepped: false,
    shape: 'seven detents throwing home, and pressure returning',
  },
};

// ---------------------------------------------------------------------------
// Reading the shapes — what the tests assert, and what a reviewer can check
// ---------------------------------------------------------------------------

/** A cue's fundamentals, in strike order. The melody, with the timbre removed. */
export function cueNotes(spec: UiCueSpec): readonly number[] {
  return spec.notes.map((n) => n.f);
}

/**
 * A cue's **distinct successive pitches**, in strike order.
 *
 * `rush`'s final chord is three notes struck at one instant, which is a chord
 * rather than a step; folding simultaneous strikes into their lowest note is
 * what lets one direction test read every cue in the set.
 */
export function cueSteps(spec: UiCueSpec): readonly number[] {
  const steps: number[] = [];
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const note of spec.notes) {
    if (note.at === lastAt) continue; // struck together — a chord, not a step
    steps.push(note.f);
    lastAt = note.at;
  }
  return steps;
}

/**
 * The interval direction a cue spells out: `+1` rising, `−1` falling, `0` for a
 * single note (no interval at all).
 *
 * This is rule 3 as a number. `back` is the only cue in the set that returns −1.
 */
export function cueDirection(spec: UiCueSpec): -1 | 0 | 1 {
  const steps = cueSteps(spec);
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (first === undefined || last === undefined || steps.length < 2) return 0;
  if (last > first) return 1;
  if (last < first) return -1;
  return 0;
}

/**
 * Whether a cue means *forward* — a pick, a yes, a spend, an arrival.
 *
 * The complement is not "backward": `refused` is neither, which is the point of
 * it. Rule 3 reads "back never uses a forward cue", and this is the predicate
 * the test spells that with.
 */
export function isForward(name: UiCueName): boolean {
  return name === 'pick' || name === 'confirm' || name === 'purchase' || name === 'join' || name === 'rush';
}

/**
 * Whether a cue's final interval **resolves** — lands on a consonance the ear
 * hears as an arrival (unison, fourth, fifth, octave, and their inversions).
 *
 * `refused` is the one cue in the set for which this is false: a minor second
 * beats against itself and goes nowhere, which is exactly why a refused purchase
 * cannot be mistaken for a completed one with your eyes on the fight (rule 2).
 */
export function resolves(spec: UiCueSpec): boolean {
  const notes = spec.notes;
  const last = notes[notes.length - 1];
  if (last === undefined) return true;

  // A cue that ENDS ON A CHORD is judged by the chord: `rush` lands on the
  // confirm's three notes struck at once and held, and what the ear hears arrive
  // is that stack, not the melodic step into it.
  const chord = notes.filter((n) => n.at === last.at).map((n) => n.f).sort((a, b) => a - b);
  const root = chord[0];
  if (chord.length > 1 && root !== undefined) return chord.every((f) => isConsonant(f / root));

  const steps = cueSteps(spec);
  if (steps.length < 2) return true; // one note is already at rest
  const a = steps[steps.length - 2];
  const b = steps[steps.length - 1];
  if (a === undefined || b === undefined) return true;
  return isConsonant(b > a ? b / a : a / b);
}

/** Unison, perfect fourth, perfect fifth, octave — the intervals that arrive. */
const CONSONANT_SEMITONES: readonly number[] = [0, 5, 7, 12];

/**
 * Whether a frequency ratio is one of the consonances, within a quarter-tone.
 *
 * The tolerance is deliberately loose: the handoff's pitches are round numbers
 * (2489 for the fifth over 1661) rather than exact equal temperament, and a
 * couple of cents is not what separates a "yes" from a "no" — a minor second is.
 */
function isConsonant(ratio: number): boolean {
  const semis = 12 * Math.log2(ratio > 0 ? ratio : 1);
  const folded = ((semis % 12) + 12) % 12;
  return CONSONANT_SEMITONES.some((c) => Math.abs(folded - c) < 0.25 || Math.abs(folded - (c + 12)) < 0.25);
}

/** Total length of a cue in seconds, tail included. */
export function cueDuration(spec: UiCueSpec): number {
  let end = 0;
  for (const n of spec.notes) end = Math.max(end, n.at + n.dur + NOTE_TAIL_S);
  for (const n of spec.air) end = Math.max(end, n.at + n.dur + NOTE_TAIL_S);
  for (const n of spec.sub) end = Math.max(end, n.at + n.dur + NOTE_TAIL_S);
  return end;
}

// ---------------------------------------------------------------------------
// Rendering — pure, headless, deterministic
// ---------------------------------------------------------------------------

/**
 * One rendered cue: the signal that goes straight to the bus, and the signal
 * that goes into the shared room.
 *
 * They are kept apart rather than mixed because the handoff gives **each note**
 * its own send level (0.18 … 0.6) while the room itself is one shared 25% bus.
 * Two buffers reproduces that exactly; one buffer would force a single average
 * wet per cue, which is a taste call this file is not allowed to make.
 */
export interface RenderedCue {
  /** The dry signal — glass, air and body. */
  readonly dry: Float32Array;
  /** The send: every note scaled by its own wet level. Sub is dry-only. */
  readonly send: Float32Array;
}

/**
 * Render a cue to samples. Pure: same spec and rate in, deep-equal buffers out.
 *
 * @param seed Noise seed for the air transients. Deterministic by construction —
 *   `mulberry32`, never `Math.random`, so a cue is sample-for-sample the same on
 *   every engine and in every replay (GDD §4.1).
 */
export function renderUiCue(spec: UiCueSpec, sampleRate: number = DEFAULT_SAMPLE_RATE, seed = 0x91a55): RenderedCue {
  const rate = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
  const total = Math.max(1, Math.ceil(cueDuration(spec) * rate));
  const dry = new Float32Array(total);
  const send = new Float32Array(total);

  for (const note of spec.notes) renderGlass(note, rate, dry, send);
  const rng = mulberry32((seed ^ hashName(spec.name)) >>> 0);
  for (const note of spec.air) renderAir(note, rate, dry, send, rng);
  for (const note of spec.sub) renderSub(note, rate, dry);

  // The buffers are clamped, not normalised: the handoff's per-note gains ARE the
  // balance between the nine cues, and normalising would flatten it.
  clampInto(dry);
  clampInto(send);
  return { dry, send };
}

/**
 * A struck note: sine partials on inharmonic ratios, each with its own decay.
 *
 * The envelope is the prototype's, sample-accurate: a linear strike from the
 * floor to the partial's peak over `strike`, then an exponential fall back to
 * the floor — exponential because that is what a struck body does, and because a
 * linear tail is the single most synthetic-sounding thing in a UI set.
 *
 * The `i`-th partial decays in `dur × 0.66ⁱ` — upper partials first, which is the
 * whole difference between glass and bell metal.
 */
function renderGlass(note: GlassNote, rate: number, dry: Float32Array, send: Float32Array): void {
  const start = Math.round(note.at * rate);
  const strike = Math.max(1 / rate, note.strike);
  const span = Math.max(1, Math.ceil((note.dur + NOTE_TAIL_S) * rate));
  for (let p = 0; p < note.parts.length; p++) {
    const mult = note.parts[p] ?? 1;
    const peak = note.gain / Math.pow(p + 1, PARTIAL_ROLLOFF);
    const decayEnd = note.dur * Math.pow(PARTIAL_DECAY, p);
    // The exponential ramp runs from the end of the strike to `decayEnd`, both
    // measured from the note's own start — exactly as the prototype schedules it.
    const fall = Math.max(1 / rate, decayEnd - strike);
    const ratio = GAIN_FLOOR / peak;
    const step = (2 * Math.PI * note.f * mult) / rate;
    let phase = 0;
    for (let i = 0; i < span; i++) {
      const at = start + i;
      if (at >= dry.length) break;
      const t = i / rate;
      let env: number;
      if (t < strike) {
        env = GAIN_FLOOR + (peak - GAIN_FLOOR) * (t / strike);
      } else if (t < decayEnd) {
        env = peak * Math.pow(ratio, (t - strike) / fall);
      } else {
        env = GAIN_FLOOR;
      }
      const v = Math.sin(phase) * env;
      phase += step;
      dry[at] = (dry[at] ?? 0) + v;
      send[at] = (send[at] ?? 0) + v * note.wet;
    }
  }
}

/**
 * A breath of air: noise through a 2nd-order high-pass, quiet and short.
 *
 * With {@link AirNote.to} set it is the other thing this shape can be — pressure
 * relief, where the *filter* is the gesture. The band's centre is retuned every
 * {@link SWEEP_BLOCK} samples rather than every sample: the coefficients are
 * recomputed ~1500 times over a 1.7 s vent instead of 82 000, the state is
 * carried across the retune so nothing clicks, and 0.7 ms of stair-stepping on a
 * cutoff is inaudible where the same stepping on a *pitch* would not be.
 */
function renderAir(note: AirNote, rate: number, dry: Float32Array, send: Float32Array, rng: Rng): void {
  const start = Math.round(note.at * rate);
  const span = Math.max(1, Math.ceil((note.dur + NOTE_TAIL_S) * rate));
  const kind = note.band ? 'bandpass' : 'highpass';
  let filter = biquad(kind, note.freq, note.q, rate);
  // A falling band still passes skirt energy below itself; the floor is what
  // keeps a vent's last half second out of the door's sub (AIR_FLOOR_HZ).
  const floorHp = note.band ? biquad('highpass', AIR_FLOOR_HZ, 0.7, rate) : null;
  const attack = 0.01;
  const ratio = GAIN_FLOOR / Math.max(GAIN_FLOOR, note.gain);
  const fall = Math.max(1 / rate, note.dur - attack);
  for (let i = 0; i < span; i++) {
    const at = start + i;
    if (at >= dry.length) break;
    const t = i / rate;
    if (note.to !== undefined && i % SWEEP_BLOCK === 0) {
      // Exponential, like every frequency move in this module: a cutoff is heard
      // in ratios exactly as a pitch is.
      const p = Math.min(1, t / Math.max(1e-6, note.dur));
      const f = note.freq * Math.pow(note.to / note.freq, p);
      filter = biquad(kind, f, note.q, rate, filter);
    }
    const raw = rng.next() * 2 - 1;
    const banded = filter.step(raw);
    const filtered = floorHp ? floorHp.step(banded) : banded;
    let env: number;
    if (t < attack) {
      env = GAIN_FLOOR + (note.gain - GAIN_FLOOR) * (t / attack);
    } else if (t < note.dur) {
      env = note.gain * Math.pow(ratio, (t - attack) / fall);
    } else {
      env = GAIN_FLOOR;
    }
    const v = filtered * env;
    dry[at] = (dry[at] ?? 0) + v;
    send[at] = (send[at] ?? 0) + v * note.wet;
  }
}

/** The body: a sine falling a little, through a 320 Hz low-pass. Dry only. */
function renderSub(note: SubNote, rate: number, dry: Float32Array): void {
  const start = Math.round(note.at * rate);
  const span = Math.max(1, Math.ceil((note.dur + NOTE_TAIL_S) * rate));
  const lp = biquad('lowpass', SUB_LOWPASS_HZ, 1, rate);
  const attack = 0.01;
  const ratio = GAIN_FLOOR / Math.max(GAIN_FLOOR, note.gain);
  const fall = Math.max(1 / rate, note.dur - attack);
  let phase = 0;
  for (let i = 0; i < span; i++) {
    const at = start + i;
    if (at >= dry.length) break;
    const t = i / rate;
    // Exponential, like every pitch fall in `./synth`: pitch is heard in ratios.
    const p = Math.min(1, t / Math.max(1e-6, note.dur));
    const f = note.f0 * Math.pow(note.f1 / note.f0, p);
    let env: number;
    if (t < attack) {
      env = GAIN_FLOOR + (note.gain - GAIN_FLOOR) * (t / attack);
    } else if (t < note.dur) {
      env = note.gain * Math.pow(ratio, (t - attack) / fall);
    } else {
      env = GAIN_FLOOR;
    }
    const v = lp.step(Math.sin(phase)) * env;
    phase += (2 * Math.PI * f) / rate;
    dry[at] = (dry[at] ?? 0) + v;
  }
}

/** The body's low-pass — a clean low body for weight, never a saw. */
export const SUB_LOWPASS_HZ = 320;

/**
 * The shared room's impulse: `(1 − x)^2.1` over 2.2 s, with a 220-sample onset
 * ramp so it does not start on a step. The handoff's own curve, verbatim.
 *
 * Deliberately **not** high-passed here: the 620 Hz filter lives on the wet
 * *path*, ahead of the convolver, exactly where the prototype puts it — one
 * filter for the send rather than one baked per channel of the impulse. Stereo,
 * with an independent noise draw per channel, which is what makes the room wider
 * than the mono cue that feeds it.
 */
export function roomImpulse(sampleRate: number = DEFAULT_SAMPLE_RATE, seed = 0x9e0d0f): Float32Array[] {
  const rate = sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE;
  const len = Math.max(1, Math.floor(rate * ROOM.seconds));
  const rng = mulberry32(seed >>> 0);
  const channels: Float32Array[] = [];
  for (let c = 0; c < ROOM.channels; c++) {
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      data[i] = (rng.next() * 2 - 1) * Math.pow(1 - x, ROOM.decay) * (1 - Math.exp(-i / ROOM.onset));
    }
    channels.push(data);
  }
  return channels;
}

// --- A 2nd-order (RBJ) biquad, so the offline filters match the node ones -----

interface Biquad {
  step(x: number): number;
  /** The two-sample history, so a retuned filter can carry it (see {@link SWEEP_BLOCK}). */
  state(): readonly [number, number, number, number];
}

/**
 * Samples between two retunes of a swept filter.
 *
 * 32 at 48 kHz is 0.67 ms — finer than the ear resolves a cutoff moving, and
 * 2500× cheaper than recomputing four transcendentals per sample.
 */
const SWEEP_BLOCK = 32;

function biquad(
  kind: 'lowpass' | 'highpass' | 'bandpass',
  freq: number,
  q: number,
  rate: number,
  carry?: Biquad,
): Biquad {
  const w0 = (2 * Math.PI * Math.max(1, freq)) / rate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(0.0001, q));
  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = b0;
  } else if (kind === 'bandpass') {
    // Constant 0 dB peak gain (RBJ) — the same normalisation a Web Audio
    // `bandpass` node uses, so the offline render matches the node one.
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = b0;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const n0 = b0 / a0;
  const n1 = b1 / a0;
  const n2 = b2 / a0;
  const d1 = a1 / a0;
  const d2 = a2 / a0;
  // A retuned filter inherits the outgoing one's history: dropping it would
  // restart the difference equation from silence every 32 samples, which is a
  // 1.5 kHz buzz laid over the sweep.
  const [cx1, cx2, cy1, cy2] = carry?.state() ?? [0, 0, 0, 0];
  let x1 = cx1;
  let x2 = cx2;
  let y1 = cy1;
  let y2 = cy2;
  return {
    step(x: number): number {
      const y = n0 * x + n1 * x1 + n2 * x2 - d1 * y1 - d2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      return y;
    },
    state() {
      return [x1, x2, y1, y2];
    },
  };
}

function clampInto(buffer: Float32Array): void {
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i] ?? 0;
    buffer[i] = !Number.isFinite(v) ? 0 : v < -1 ? -1 : v > 1 ? 1 : v;
  }
}

/** A stable per-cue noise seed, so two cues never share an air transient. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Playing them
// ---------------------------------------------------------------------------

/** Options for {@link UiCuePlayer}. */
export interface UiCuePlayerOptions {
  /** Seed for the per-press detune, so a replay presses the same way (GDD §4.1). */
  readonly seed?: number;
  /** Level trim over the whole set. Default {@link UI_CUE_LEVEL}. */
  readonly level?: number;
  /** The stacking window — rule 1. Default {@link STACK_GAP_S}. */
  readonly gap?: number;
  /** Minimum gap between two plays of the same cue. Default {@link REPEAT_GAP_S}. */
  readonly repeatGap?: number;
  /** Build the shared room. Default true; false plays the set dry. */
  readonly room?: boolean;
}

/**
 * The cue set, wired into a mix.
 *
 * Constructed against `./context`'s structural subset like the rest of the audio
 * module, so the whole thing builds and plays against a plain object in a test
 * with no browser and no audio hardware.
 *
 * **Where it connects matters.** `destination` is the graph's `sfx` bus, which
 * sums into `master` and then through the **duck** node — so the three seconds of
 * near-silence on planet death multiply these cues exactly as they multiply
 * everything else, in the mixer rather than in gameplay code (GDD §4.7). Nothing
 * in this file can route around it, which is the property the tone contract needs
 * and the one `./ui-cues.test.ts` asserts.
 */
export class UiCuePlayer {
  /** The shared room's send gain, or `null` where the context has no convolver. */
  readonly room: GainNodeLike | null;

  private readonly ctx: AudioContextLike;
  private readonly destination: AudioNodeLike;
  private readonly level: number;
  private readonly gap: number;
  private readonly repeatGap: number;
  private readonly rng: Rng;
  private readonly buffers = new Map<string, { dry: AudioBufferLike; send: AudioBufferLike }>();
  private readonly lastPlayed = new Map<UiCueName, number>();
  private lastAny = Number.NEGATIVE_INFINITY;
  private played = 0;
  private stacked = 0;
  private live = true;

  constructor(ctx: AudioContextLike, destination: AudioNodeLike, options: UiCuePlayerOptions = {}) {
    this.ctx = ctx;
    this.destination = destination;
    this.level = clamp01(options.level ?? UI_CUE_LEVEL);
    this.gap = Math.max(0, options.gap ?? STACK_GAP_S);
    this.repeatGap = Math.max(0, options.repeatGap ?? REPEAT_GAP_S);
    this.rng = mulberry32((options.seed ?? 0x6a17e5) >>> 0);
    this.room = (options.room ?? true) ? this.buildRoom() : null;
  }

  /** Cues actually started. One per state change — never two. */
  get playCount(): number {
    return this.played;
  }

  /** Cues refused because another had just fired: rule 1, as a visible number. */
  get stackedCount(): number {
    return this.stacked;
  }

  /** Cues rendered and cached so far. */
  get cached(): number {
    return this.buffers.size;
  }

  /** The sample rate the set is rendered at — the context's own, so nothing resamples. */
  get sampleRate(): number {
    return this.ctx.sampleRate > 0 ? this.ctx.sampleRate : DEFAULT_SAMPLE_RATE;
  }

  /**
   * Render and cache the nine, and the door's four.
   *
   * Worth doing behind the unlock gesture (`./unlock`): the one place a first-play
   * render is audible is the very first press of the menu, which is the worst
   * possible first impression of a set the developer chose by ear.
   *
   * The door's cues are the sharpest case of that, and the reason they are not
   * left out of this loop for being longer: the gesture that unlocks audio IS
   * the press that opens the door (`src/ui/title-gate.ts`), so `gateUnlock` is
   * the very first sound this game is permitted to make.
   */
  preload(): void {
    for (const name of UI_CUE_NAMES) this.buffer(name);
    for (const name of DOOR_CUE_NAMES) this.buffer(name);
  }

  /**
   * Sound a cue.
   *
   * **Rule 1 lives here.** A cue landing inside the stacking window of the
   * previous one is refused and counted, so two cues can never answer one state
   * change — the failure mode the handoff calls out by name, and the one that
   * turns a designed set into a pile.
   *
   * @param index Slot index for a stepped cue (`join`): one semitone per seat.
   * @returns whether it started.
   */
  play(name: UiCueName, index = 0): boolean {
    if (!this.live) return false;
    const spec = UI_CUES[name];
    const now = this.ctx.currentTime;

    if (now - this.lastAny < this.gap) {
      this.stacked++;
      return false;
    }
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < this.repeatGap) {
      this.stacked++;
      return false;
    }

    // ONE factor for the whole cue, so the intervals stay exactly what the table
    // says: a rising fifth detuned note-by-note is no longer a fifth. Hover and
    // detent opt out entirely — a wobbling hover reads as a fault.
    const detune = spec.detuned ? detuneFactor(this.rng) : 1;
    const step = spec.stepped ? Math.pow(2, index / 12) : 1;
    const rate = detune * step;

    const buffers = this.buffer(name);
    this.start(buffers.dry, rate, this.level, this.destination, now);
    if (this.room) this.start(buffers.send, rate, this.level, this.room, now);

    this.lastPlayed.set(name, now);
    this.lastAny = now;
    this.played++;
    return true;
  }

  /** Drop the room and stop answering. A teardown, or a page unload. */
  dispose(): void {
    this.live = false;
    this.buffers.clear();
    this.room?.disconnect();
  }

  // -------------------------------------------------------------------------

  private start(
    buffer: AudioBufferLike,
    rate: number,
    gain: number,
    destination: AudioNodeLike,
    when: number,
  ): void {
    const node = this.ctx.createGain();
    node.gain.value = gain;
    node.connect(destination);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate > 0 ? rate : 1;
    source.connect(node);
    source.start(when);
  }

  private buffer(name: UiCueName): { dry: AudioBufferLike; send: AudioBufferLike } {
    const key = `${name}:${this.sampleRate}`;
    const hit = this.buffers.get(key);
    if (hit) return hit;
    const rendered = renderUiCue(UI_CUES[name], this.sampleRate);
    const pair = {
      dry: toAudioBuffer(this.ctx, rendered.dry, this.sampleRate),
      send: toAudioBuffer(this.ctx, rendered.send, this.sampleRate),
    };
    this.buffers.set(key, pair);
    return pair;
  }

  /**
   * The shared room: `send(25%) → high-pass 620 → convolver → the sfx bus`.
   *
   * Built once and shared by all nine, which is the point — *"one space for every
   * cue is what makes a UI sound like one instrument instead of a pile of
   * samples."* Returns `null` where the context has no convolver (an old webview,
   * a stub): the set then plays dry, which is a colour difference, not a silence.
   */
  private buildRoom(): GainNodeLike | null {
    const make = this.ctx.createConvolver;
    if (!make) return null;
    let convolver: ConvolverNodeLike;
    try {
      convolver = make.call(this.ctx);
    } catch {
      return null;
    }
    const rate = this.sampleRate;
    const impulse = roomImpulse(rate);
    const buffer = this.ctx.createBuffer(ROOM.channels, impulse[0]?.length ?? 1, rate);
    for (let c = 0; c < ROOM.channels; c++) {
      const channel = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      channel.set((impulse[c] ?? impulse[0] ?? new Float32Array(1)).subarray(0, channel.length));
    }
    convolver.buffer = buffer;

    const highPass = this.ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = ROOM.highPassHz;

    const send = this.ctx.createGain();
    send.gain.value = ROOM.wet;
    send.connect(highPass);
    highPass.connect(convolver);
    convolver.connect(this.destination);
    return send;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
