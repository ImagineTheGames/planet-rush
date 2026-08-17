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
 *  - **The four summary cues (p1-07).** New slots rather than a re-offer: the
 *    end-of-match sequence (`docs/progression-plan.md` §6) needs four cues the
 *    bank did not have, and it is explicitly **not** allowed to reach for
 *    `matchEnd`, `musicWin` or `musicLoss` — those are three of the forty the
 *    developer denied, so a satisfying sound taken from them is one that has
 *    already been rejected. Board goes 40 slots → 44.
 *  - **ambient (a0-48).** The one slot whose denial was never actioned, re-offered
 *    a week later after the developer met the still-shipping bed in play: *"when i
 *    press play im immediately greeted by this background sound that is deep…
 *    its annoying."* Unlike every round above it, this one does **not** re-offer in
 *    place under `a`/`b`/`c` — those three letters carry a live `deny-all` in
 *    `/status/sound-choices.json`, and a new take filed under a denied letter makes
 *    that record unreadable. The offers are `d`, `e`, `f`, and the slot also carries
 *    a {@link CandidateSlot.fourthOption}: ship the bed off by default.
 *  - **oreCollect and levelUp (a0-49).** The two slots on the whole board whose
 *    denial post-dates every offer standing against it — the developer is looking
 *    at takes they turned down and nothing is queued behind them
 *    (`docs/sound-denials-outstanding.md` derives that, slot by slot, for all 38
 *    outstanding denials). Each carries its own reason and neither is the other's:
 *    `levelUp` is *"sounds too toony, doesn't sound rewarding"* and `oreCollect` is
 *    *"add a little bit more of sparkle to it, like you've won a prize, but
 *    subtle... it shouldn't be too long"*. Lettered `d`/`e`/`f` on a0-48's rule.
 *    The same ledger dispositions a third slot — `xpBarFill`, *"all these sounds
 *    are mega annoying, we don't need this at all no need for regeneration"* — as a
 *    **cut**, so it is deliberately NOT re-offered here: three new takes on a sound
 *    somebody asked to stop hearing is the round this brief exists to prevent.
 *  - **xpSettle (a0-57).** The first **category** denial on the board: all three
 *    takes turned down on 2026-08-16 with *"none of these sound like sounds for XP
 *    collection"* — not "make them better", but "these are not sounds for the thing
 *    this slot is for". Twenty minutes then passed with the board unchanged and the
 *    developer in front of it (*"im still staring at a sound board with no
 *    regenerated options"*), which is the failure a0-49 built `denied_without_work`
 *    into `/api/sounds` to detect and which nothing was dispatching on. The re-offer
 *    is **four** takes rather than three — the letters `d`–`g` on a0-48's rule — and
 *    it does not tune the denied family: it re-reads the event (XP landing and being
 *    yours) and offers four different readings of what a collection sound IS. It is
 *    also the first slot to keep its denied takes **in this file**, under
 *    {@link CandidateSlot.denied}, rendered to `previews/xpSettle/denied-*.wav` so
 *    the board can play the re-offer against the thing it replaces.
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
 * | ship | plasma drive — matter thrown, particulate | reaction mass — pneumatic weight, a closing filter | containment field — a resonance forming or failing |
 * | station | ratchet and teeth — stepped dry contact | hydraulic seat — pressure into weight coming to rest | magnetic lock — narrow bands closing |
 * | clock | structure under load — stone and metal giving way | pressure — a low body, mass moving | resonance — a narrow band, and a room |
 * | music | granular bed — particulate, no pitch centre | filtered analogue — a low body behind a corner | wide detuned space — unisons beating, metal in the smear |
 * | interface | a dry contact — grains, nothing rings | a damped pip — felt more than heard | a narrow band — one partial, machine-clean |
 * | summary | a counter's contact — dry, granular, no pitch centre | pressure seating — a low body and a corner that moves | induction — a narrow band that rings once |
 *
 * Read down a column and the *axis* is the same on all forty slots — `a` is always
 * granular contact, `b` is always pressure and mass, `c` is always the one that
 * rings — while the *metaphor* is new in every family. That is deliberate: a
 * forty-slot board the developer has already walked away from once is swept in one
 * pass if the question is the same question each time, and re-learnt forty times if
 * it is not. The choice on offer is a material, made once and offered everywhere.
 */

import type { SoundLayer, SoundName, SoundSpec } from './bank';
import { isLayered, soundSpec } from './bank';
import { band, grains, place, plate, swept } from './instrument';
import { GLASS_PARTIALS, GLASS_PAIR, PARTIAL_DECAY, PARTIAL_ROLLOFF, STRIKE_S } from './ui-cues';

// ---------------------------------------------------------------------------
// The instrument the candidates are built out of lives in `./instrument` now.
// It moved there under s10-01 when the developer chose three of these offers and
// the bank had to build the adopted voices out of the same calls with the same
// arguments — a shipped sound that is a re-typing of an approved one is a sound
// nobody approved. The four builders are unchanged; the argument for them is
// still the file comment above.
//
// `returns` did NOT move, and stays local to this file: none of the three adopted
// voices has a room, so an export in `./instrument` would be an export no shipped
// code calls — the dark-matter gate's exact target. The seven candidates below that
// do use it are all still un-adopted offers, and offers live here.
// ---------------------------------------------------------------------------

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

/**
 * The **glass** the main menu is made of — the ratified Gantry/Bone material.
 *
 * a0-67 exists because a slot lost it. The developer's words on `pressTick` were
 * *"what happened to the glass theme we had, none of these are glass themed like
 * the main menu"* — a **regression report**, not a preference, and the thing it
 * reports is real: the shipped `pressTick` is a struck glass note at A♭6, and the
 * a0-60 re-voice offered four takes (a capacitive contact, a damped actuator, a
 * filtered band, a click) that were all correctly "modern/sci-fi" and none of
 * which was glass. A slot can pass the register test and still leave the family.
 *
 * **What the glass theme is, in sound terms** — read out of `./ui-cues`, which is
 * where it is ratified, so this is a re-use rather than a re-invention:
 *
 *  - **Sine partials on 1 / 2.76 / 5.4** ({@link GLASS_PARTIALS}). Inharmonic, and
 *    neither a harmonic series nor a bell's — that spacing is what a struck *pane*
 *    does. The thin form drops the top partial ({@link GLASS_PAIR}).
 *  - **The upper partials die first** ({@link PARTIAL_DECAY} = 0.66 of the one
 *    below). *"Steeper rolloff + faster upper-partial decay = glass, not bell
 *    metal"* — this one line is the whole difference, and it is why a chime and a
 *    pane made of the same ratios do not sound alike.
 *  - **A ~2 ms strike** ({@link STRIKE_S}), never zero, which is a click.
 *  - **A contact edge** — a breath of band-passed noise ahead of the note, which
 *    is what makes a strike read as two hard things touching rather than as a tone
 *    being switched on. `./bank`'s own `strike()` adds it and `./ui-cues` calls it
 *    `air`; it is the round-2 half of the material and it stays.
 *  - **A♭6 = 1661 Hz is the family root.** Every pitch in the menu set is measured
 *    off it.
 *
 * This is deliberately a **copy of `./bank`'s private `strike()`**, not an import
 * of it: `strike` is not exported, and the board must be able to offer glass that
 * is *not* what ships without either file reaching into the other. The numbers are
 * the ratified ones and are imported from `./ui-cues` rather than retyped, so the
 * copy cannot drift from the material it claims to be.
 */
function glass(
  name: string,
  freq: number,
  o: {
    readonly gain: number;
    /** The fundamental's decay. Each partial above it decays faster. */
    readonly decay: number;
    readonly at?: number;
    /** {@link GLASS_PARTIALS} (three, full) or {@link GLASS_PAIR} (two, thinner). */
    readonly partials?: readonly number[];
    /** Scale the contact edge, 0 to drop it. Default 1. */
    readonly contact?: number;
    /** Grain on the fundamental — a trace of pitched noise. A pure sine is a test tone. */
    readonly grain?: number;
    readonly seed: number;
  },
): SoundLayer[] {
  const contact = o.contact ?? 1;
  const grain = o.grain ?? 0.03;
  const layers: SoundLayer[] = [];

  if (contact > 0) {
    layers.push(
      band(`${name}.contact`, freq * 2.1, {
        gain: o.gain * 0.42 * contact,
        decay: Math.min(0.04, o.decay * 0.55),
        q: 3.2,
        curve: 7, // an edge, not a layer: gone almost before it registers
        punch: 0.5,
        ...(o.at === undefined ? {} : { at: o.at }),
        seed: o.seed + 90,
      }),
    );
  }

  for (const [i, ratio] of (o.partials ?? GLASS_PARTIALS).entries()) {
    layers.push(
      place(
        {
          name: `${name}.p${i}`,
          wave: 'sine',
          attack: STRIKE_S,
          hold: 0, // a struck body peaks and dies; it does not sit at full level
          decay: o.decay * Math.pow(PARTIAL_DECAY, i),
          decayCurve: 3.2 + i,
          freq: freq * ratio,
          noiseMix: grain + i * 0.012,
          gain: o.gain / Math.pow(i + 1, PARTIAL_ROLLOFF),
          seed: o.seed + i,
        },
        o.at,
      ),
    );
  }

  return layers;
}

/**
 * The sound this slot **ships today**, offered as a letter of its own.
 *
 * Four of the sixteen round-two reasons open with some form of *"i like current"*
 * (`bankOre`, `upgradeBought`, `musicWin`, `musicLoss`) and two more ask to be
 * shown directions to move *from* it (`oreCollect`, `turretFire`). In both cases
 * the incumbent is the reference and not the reject — but the board has only ever
 * been able to say that in prose. A `current` preview does exist beside every
 * slot, and it is not a thing a **verdict** can land on: `/status/sound-choices.
 * json` records a slot and a *letter*, so *"keep what ships"* has never been an
 * expressible answer, and a developer who wants it has to deny four takes and
 * hope somebody reads the reason.
 *
 * So the incumbent takes a letter. Picking it is a real verdict — *keep what
 * ships* — and, more usefully for the four "more X than this" reasons, it puts the
 * reference in the A/B where it can be heard against the new takes instead of
 * remembered between them.
 *
 * The spec is the shipped one, renamed so the review page prints which letter it
 * arrived under. It is marked {@link SoundCandidate.anchor} so nothing downstream
 * mistakes it for new work.
 */
function incumbent(name: SoundName, id: string): SoundSpec {
  const spec = soundSpec(name);
  const renamed = `${name}_${id}_current`;
  return isLayered(spec) ? { ...spec, name: renamed } : { ...spec, name: renamed };
}

/** One candidate voice for a slot: an id, a short character label, and the spec itself. */
export interface SoundCandidate {
  /**
   * Stable id within the slot — a single letter, and the whole of how a verdict
   * names an offer (`/status/sound-choices.json` records `{"verdict": "b"}`).
   *
   * Usually `a`/`b`/`c`. A slot that carries a **live verdict on a letter** does
   * not re-offer under that letter: `ambient` was denied on 2026-08-07 and offers
   * `d`/`e`/`f` (a0-48), because a second take filed under `a` would make the
   * standing record unreadable — nobody could tell which take the deny was aimed
   * at. `oreCollect` and `levelUp` follow it (a0-49). `./candidates.test.ts` holds
   * the rule as a property over the re-lettered slots rather than as three lists,
   * so the next denied slot inherits it instead of re-deriving it.
   */
  readonly id: string;
  /**
   * The slot this candidate belongs to, stated rather than implied by where it
   * sits in {@link CANDIDATE_SLOTS}.
   *
   * A verdict is a **pair** — `/status/sound-choices.json` records a slot and a
   * letter — so a candidate handed to anything on its own currently cannot say
   * what half of that pair it is. It is also a guard: this file is 2 500 lines of
   * near-identical blocks, and the cheapest mistake to make in it is to paste a
   * take under the wrong heading, where nothing would catch it and the developer
   * would be offered a sound for some other event. `sound-review/render.ts`
   * throws on a mismatch and `./candidates.test.ts` asserts it.
   *
   * Optional because the forty slots that predate it do not carry one; new and
   * re-offered takes state it (`xpSettle`, a0-57).
   */
  readonly slot?: string;
  /** 3-5 word description of the character, for the review page. */
  readonly character: string;
  /** The synth param set — the same shape as a shipped bank entry. */
  readonly spec: SoundSpec;
  /**
   * This letter **is the sound that ships today** ({@link incumbent}), offered so
   * that *"keep what ships"* is an answer a verdict can express and so that the
   * A/B against it is playable rather than remembered (a0-67).
   *
   * It is not new work and it is not one of the directions a round is offering, so
   * anything that counts or measures a round's takes excludes it — the review page
   * prints it as the current sound, and `./candidates.test.ts` holds the round's
   * bounds against the non-anchor offers.
   */
  readonly anchor?: boolean;
}

/** One reviewable slot: a shipped sound, and three candidate replacements. */
export interface CandidateSlot {
  /** Short human label. */
  readonly label: string;
  /** One line: when the player hears this sound. */
  readonly context: string;
  /** The shipped {@link SoundName} this slot proposes alternatives for (its "current"). */
  readonly current: SoundName;
  /**
   * The live offers, one letter each ({@link SoundCandidate.id}).
   *
   * Three on every slot the board has always promised three of. `xpSettle` offers
   * **four** (a0-57): its denial was a category rejection rather than a note on
   * execution, so the round needs enough spread to find out which reading of the
   * event is the right one, and a fourth letter is cheaper than a fourth round.
   */
  readonly candidates: readonly SoundCandidate[];
  /**
   * A fourth answer this slot is allowed to come back with, in the developer's
   * hands rather than this lane's — written through to the review manifest so it
   * reads on the page beside the three voices.
   *
   * Only `ambient` has one (a0-48): the bed is item 3 on the GDD §4.9 ranked cut
   * list and nothing in the mix depends on it, so *"ship it off by default, with
   * a toggle"* is a real outcome and not a failure to design one. A slot that is
   * a **mechanic** — every SFX, the alarm — can never carry this field, because
   * "cut it" is not on the table for a mechanic (§2.2, §4.9).
   */
  readonly fourthOption?: string;
  /**
   * The takes this slot has already had turned down, kept where the offer is.
   *
   * A re-offer replaces {@link candidates}, so before a0-57 the only copy of a
   * denied take was in git — and the two things a denial is *for* both need it
   * present: comparing the new offer against what was rejected, and reading, a
   * month later, what the rejection was actually aimed at. a0-49 solved that for
   * `oreCollect` and `levelUp` by inlining the denied specs into
   * `./candidates.test.ts`, which gets the tests what they need but leaves the
   * board — the thing the developer is looking at — with no way to play the take
   * beside its replacement.
   *
   * So a denied take stays here, out of `candidates` (it is not on offer and a
   * verdict may not land on it) and rendered to `previews/<slot>/denied-<id>.wav`
   * by `sound-review/render.ts`. Letters are never reused: a `denied` entry and a
   * live offer can never share an id, which `./candidates.test.ts` asserts.
   */
  readonly denied?: readonly DeniedTake[];
}

/**
 * A take that was denied: the offer as it stood, plus the verdict against it.
 *
 * The reason is quoted **verbatim** and the timestamp is the one the review page
 * recorded, because a paraphrase of a denial is the thing that produces the next
 * denial — a0-57 exists because *"none of these sound like sounds for XP
 * collection"* had been read as "make them better" rather than as what it says.
 */
export interface DeniedTake extends SoundCandidate {
  /** ISO timestamp the verdict was recorded on the review page. */
  readonly deniedAt: string;
  /** The developer's reason, word for word. Never paraphrased, never summarised. */
  readonly reason: string;
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
  // The impact family (a0-68): `shotImpact` was one slot for four physical
  // events, so it is four slots now. Kept in bank order, where the one they
  // replace sat, so a reviewer sweeping the board is not re-ordered underneath.
  'impactHull',
  'impactRock',
  'impactShield',
  'impactStation',
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
  // Two outcomes (a0-68) where `matchEnd` was one. These are the STINGS;
  // `musicWin`/`musicLoss` below are the music half and they are not the same
  // cue — see the block above `matchWin` in `CANDIDATE_SLOTS`.
  'matchWin',
  'matchLoss',
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
  // The end-of-match summary (p1-07) — four new slots, at the end of the board
  // because they are new rather than re-offers, and a reviewer sweeping the
  // forty they already denied should not have their order shuffled underneath
  // them. Bank order, which is the order the sequence plays them in.
  'xpTick',
  'xpBarFill',
  'levelUp',
  'xpSettle',
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
  // chunk up* vs *banked a chunk*. Every `depositTick` offer is kept under 700 Hz
  // and under half this slot's level, so the pair stays separable whichever letters
  // the developer picks, including a mixed pair. Round 3 widens that gap rather
  // than closing it: the sparkle below moves this slot *up*, and `depositTick` has
  // not moved at all.
  //
  // ---------------------------------------------------------------------------
  // ROUND 3 (a0-49, 2026-08-15)
  // ---------------------------------------------------------------------------
  //
  // The developer, denying `a`/`b`/`c` on 2026-08-14, quoted character for
  // character because a paraphrase of a denial is a new opinion (LESSONS §17):
  //
  //   *"add a little bit more of sparkle to it, like you've won a prize, but
  //   subtle... it shouldn't be too long"*
  //
  // Three instructions, and the second and third are the ones that make it hard.
  //
  //  - **Sparkle** is the developer's word and it is in tension with the amended
  //    §4.7 register, so it is taken as **high-frequency detail with a short life**
  //    — several small bright contacts at the top of the spectrum — and never as a
  //    glissando or a chime, which are the two retired arcade idioms (§5.3) the
  //    word could otherwise be read as. Measured: every offer puts >30% of its
  //    energy above 3 kHz, against 15% / 2% / 24% for the three that were denied.
  //  - **"But subtle"** qualifies the sparkle, not the cue, so it is held as a
  //    ceiling on the whole sound rather than on the bright layers: no offer is
  //    louder in peak or in RMS than the incumbent this slot ships today — the
  //    sound the developer has in their ear when they say *"add … to it"*.
  //  - **"It shouldn't be too long"** is a hard bound and not a preference:
  //    `oreCollect` is `TELL.oreCollect` and fires on every single ore pickup, so a
  //    tail that is merely pleasant the first time is a tail heard hundreds of
  //    times a match. Every offer is shorter than the longest denied take (90 ms)
  //    and less than half the length of the incumbent.
  //
  // The 6.5 kHz ceiling is real and it shaped all three: `./synth` clamps a
  // resonant cutoff to `SVF_MAX_HZ_FRACTION` of the sample rate, so "the top of the
  // spectrum" in this bank means 3–6.4 kHz, and a first pass written above that
  // clamp measured *darker* than the takes it was replacing. The three characters
  // are three ways of spending that band:
  //
  //   d  **flake shear** — the snap, and bright chips coming off it. Granular.
  //   e  **charged intake** — the pull, with an ionised edge riding up the top.
  //   f  **assay ping** — a dry contact and two narrow high bands reading it back.
  //
  // ---------------------------------------------------------------------------
  // ROUND 4 (a0-67, 2026-08-17) — THREE DIRECTIONS, NOT THREE TAKES
  // ---------------------------------------------------------------------------
  //
  // All three of round 3 were denied, verbatim:
  //
  //   *"they need to sound more satisfying, like you've won something, but subtle
  //   at same time, make 3 distinct sounds so that i can see what direction to go
  //   in"*
  //
  // The last clause is an instruction about the **shape of the round**, and it is
  // the one that is easy to average away. *"So that i can see what direction to go
  // in"* is not a request for three more attempts at one idea — it is a request to
  // be shown the **options space**, so one of them can be picked and developed. So
  // the three below are pushed as far apart as an 80 ms pickup allows: they are
  // three different answers to *what does winning a small thing sound like*, and a
  // reader should be able to say which one they prefer without having heard them.
  //
  //   g  **an interval** — the reward is *musical*. Two struck notes rising a
  //      fifth. If this is the direction, the slot grows a pitch grammar and the
  //      next round is about which interval.
  //   h  **a handful of material** — the reward is *the ore itself*. Many tiny
  //      bright contacts landing in a tray, no pitch anywhere. If this is the
  //      direction, the next round is about how much of it there is.
  //   i  **a breath** — the reward is a *feeling*, and nothing is struck at all: a
  //      soft bloom that opens and closes. If this is the direction, the slot
  //      stops being an event and becomes a swell.
  //   j  **the sound that ships today**, so *"more satisfying than what I have"*
  //      can be judged against what they have rather than from memory.
  //
  // What did NOT change, because it was not withdrawn:
  //
  //  - ***"but subtle at same time"*** is the same clause as round 3's *"but
  //    subtle"*, said again. It stays a **level ceiling on the whole cue**: no new
  //    take is louder in peak or in RMS than the incumbent.
  //  - ***"it shouldn't be too long"*** (round 3) was not retracted, and it is a
  //    hard bound rather than a preference — `TELL.oreCollect` fires on every
  //    pickup. Every new take is at or under the incumbent's length.
  //
  // The one bound that had to be **re-scoped**, said out loud rather than dropped
  // quietly: round 3 held *every* offer above the denied set's high-frequency
  // share, which is how *"sparkle"* was answered. Holding that per-offer now would
  // forbid two of the three directions the developer just asked for — a dry
  // handful of material and a breath are not bright by construction. So the
  // sparkle clause moves from *every offer* to *the set*: at least one direction
  // still carries it, and `./candidates.test.ts` asserts that rather than letting
  // it lapse. A clause that is answered by one of three offers is still answered;
  // a clause deleted because it was inconvenient is a denial being ignored.
  oreCollect: {
    label: "Ore Collect",
    context: "A loose ore chunk is tractored in",
    current: 'oreCollect',
    candidates: [
      {
        id: 'g',
        slot: 'oreCollect',
        character: "a prize: two notes, rising a fifth",
        spec: {
          name: 'oreCollect_g_prizeInterval',
          layers: [
            // D6 then A6. A rising fifth is the plainest "that went well" an
            // interval can be, and it is not the incumbent's material: `plate`'s
            // 1 · 2.41 spacing, deliberately not the ratified glass — an offer
            // made of the incumbent's material is the incumbent with a filter on
            // it, and this direction has to be audibly its own idea.
            // F6 then C7, not D6/A6: the §8 pair `oreCollect`/`depositTick` is
            // held on spectral centre (*picked a chunk up* vs *banked a chunk*),
            // and a fifth spelled a third lower sat inside a `depositTick` offer's
            // band. The interval is the direction; the register it is spelled in
            // is what keeps it off another mechanic.
            ...plate('oreCollect_g.one', 1396.91, { gain: 0.17, decay: 0.034, ratios: [1, 2.41], q: 9, curve: 6, punch: 0.45, grain: 0.16, seed: 30460 }),
            // 38 ms apart and 40 ms long, which is what keeps the whole gesture
            // inside the length ceiling round 3 set (*"it shouldn't be too
            // long"*). An interval needs two notes; it does not need two long
            // ones, and the second is the only one allowed any ring at all.
            ...plate('oreCollect_g.two', 2093, { gain: 0.2, decay: 0.04, ratios: [1, 2.41], q: 10, curve: 5, grain: 0.14, edge: 0.6, at: 0.038, seed: 30464 }),
            // The one bright thing in this direction, on the second note only: it
            // is the *arrival* that gets the glint, which is what makes an
            // interval read as landing somewhere rather than as two pips. It also
            // carries the round-3 sparkle clause on this take, which a plain pair
            // of struck notes would not.
            band('oreCollect_g.glint', 5040, { gain: 0.62, decay: 0.03, q: 9, curve: 5, hp: 2600, at: 0.04, seed: 30468 }),
          ],
        },
      },
      {
        id: 'h',
        slot: 'oreCollect',
        character: "a handful of chips into the tray",
        spec: {
          name: 'oreCollect_h_handfulOfChips',
          layers: [
            // No pitch anywhere: the whole cue is small contacts at a rate. The
            // satisfaction here is *quantity* — you can hear that something
            // arrived, and roughly how much of it — which is the reading of
            // "you've won something" that does not reach for a tune.
            grains('oreCollect_h.fall', { freq: 2600, freqEnd: 3400, grain: 0.0026, gain: 0.3, hold: 0.004, decay: 0.05, curve: 3.4, from: 5400, to: 3200, q: 3.4, hp: 1400, seed: 30470 }),
            grains('oreCollect_h.settle', { freq: 3900, grain: 0.0034, gain: 0.24, hold: 0.003, decay: 0.055, curve: 4.6, from: 6200, to: 3600, q: 4, hp: 2400, at: 0.018, seed: 30472 }),
            band('oreCollect_h.tray', 780, { gain: 0.34, decay: 0.05, q: 4.5, curve: 5, at: 0.006, seed: 30474 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'oreCollect',
        character: "a breath, nothing struck",
        spec: {
          name: 'oreCollect_i_breath',
          layers: [
            // The one with no transient at all — 6 ms to full where the other two
            // are under one. It is the direction that says the pickup is a state
            // change rather than an impact, and it is deliberately the hardest of
            // the three to notice, because *"but subtle at same time"* has a floor
            // as well as a ceiling and somebody should get to hear where it is.
            swept('oreCollect_i.open', { wave: 'noise', freq: 2800, from: 1800, to: 5200, q: 3.6, gain: 0.26, attack: 0.006, hold: 0.008, decay: 0.045, curve: 2.6, hp: 1200, seed: 30480 }),
            swept('oreCollect_i.close', { wave: 'noise', freq: 3600, from: 5200, to: 2400, q: 4.2, gain: 0.2, attack: 0.004, hold: 0.004, decay: 0.05, curve: 3.4, hp: 1800, at: 0.03, seed: 30482 }),
            swept('oreCollect_i.body', { wave: 'sine', freq: 392, from: 900, to: 500, q: 2.2, gain: 0.07, attack: 0.008, hold: 0.01, decay: 0.055, curve: 2.8, noiseMix: 0.1, seed: 30484 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'oreCollect',
        anchor: true,
        character: "the sound that ships today (A/B)",
        spec: incumbent('oreCollect', 'j'),
      },
    ],
  },
  // The two-event insistence is the tell — that is what says *stop mining, fly
  // home* rather than *you picked something up* — so all four keep two events and
  // keep the gap. What changes is what is making them. The denied set answered
  // "hold full" with struck steel, pressure horns and a swept band; the re-voice
  // answers it with the machine that is actually full: a hopper that has hit its
  // stop (`d`), a seal that has taken all it can (`e`), a load cell reading out
  // (`f`), and a system that simply says so twice and stops (`g`).
  holdFull: {
    label: "Cargo Hold Full",
    context: "Cargo hold reaches capacity — signals 'fly home'",
    current: 'holdFull',
    candidates: [
      {
        id: 'd',
        character: "hopper at its stop, twice, dry",
        spec: {
          name: 'holdFull_d_hopperStop',
          layers: [
            grains('holdFull_d.one', { freq: 480, grain: 0.0035, gain: 0.34, hold: 0.008, decay: 0.07, curve: 5, punch: 0.5, from: 2000, to: 700, q: 3.2, hp: 220, seed: 60490 }),
            band('holdFull_d.oneStop', 360, { gain: 0.3, decay: 0.06, q: 4, curve: 6, at: 0.008, seed: 60492 }),
            grains('holdFull_d.two', { freq: 560, grain: 0.0035, gain: 0.36, hold: 0.01, decay: 0.11, curve: 4.5, punch: 0.5, from: 2400, to: 800, q: 3.2, hp: 240, at: 0.14, seed: 60494 }),
            band('holdFull_d.twoStop', 420, { gain: 0.32, decay: 0.09, q: 4.5, curve: 5.5, at: 0.148, seed: 60496 }),
          ],
        },
      },
      {
        id: 'e',
        character: "seal taking all it can, twice",
        spec: {
          name: 'holdFull_e_sealFull',
          layers: [
            swept('holdFull_e.one', { wave: 'triangle', freq: 260, from: 700, to: 320, q: 3.6, gain: 0.34, attack: 0.005, hold: 0.03, decay: 0.09, curve: 3.4, noiseMix: 0.2, seed: 60500 }),
            swept('holdFull_e.two', { wave: 'triangle', freq: 330, from: 880, to: 380, q: 3.6, gain: 0.36, attack: 0.005, hold: 0.035, decay: 0.14, curve: 3.2, noiseMix: 0.2, at: 0.15, seed: 60502 }),
            swept('holdFull_e.mass', { wave: 'sine', freq: 88, from: 240, to: 120, q: 2, gain: 0.26, attack: 0.004, hold: 0.02, decay: 0.16, curve: 3, at: 0.15, seed: 60504 }),
          ],
        },
      },
      {
        id: 'f',
        character: "load cell reading out, two bands",
        spec: {
          name: 'holdFull_f_loadCell',
          layers: [
            band('holdFull_f.read0', 740, { gain: 0.972, decay: 0.09, q: 8, curve: 5, attack: 0.002, hold: 0.008, seed: 60510 }),
            band('holdFull_f.read1', 990, { gain: 1.0, decay: 0.14, q: 9, curve: 4.5, attack: 0.002, hold: 0.01, at: 0.145, seed: 60512 }),
            grains('holdFull_f.meter', { freq: 300, grain: 0.006, gain: 0.236, hold: 0.02, decay: 0.1, curve: 4, from: 1100, to: 500, q: 2.6, at: 0.02, seed: 60514 }),
          ],
        },
      },
      {
        id: 'g',
        character: "it says so twice and stops",
        spec: {
          name: 'holdFull_g_saysSoTwice',
          layers: [
            band('holdFull_g.one', 640, { gain: 0.912, decay: 0.045, q: 5, curve: 6.5, punch: 0.35, seed: 60520 }),
            band('holdFull_g.two', 640, { gain: 0.912, decay: 0.075, q: 5, curve: 6, punch: 0.35, at: 0.13, seed: 60522 }),
          ],
        },
      },
    ],
  },
  // === FIGHT (a0-60) ========================================================
  //
  // The `deny-all` of 2026-08-07 was aimed at a register, not at six sounds, so
  // the re-voice is a new set of *machines* rather than new settings on the ones
  // that were turned down. Denied letters `a`/`b`/`c` come off the board (the
  // a0-48 rule: a letter is how a verdict names an offer) and git carries them.
  //
  // "Modern/sci-fi, not retro/toony" for a weapon means the hardware is audible
  // and the cartoon is not: the transient is a contact or a discharge, the body
  // is short and damped, and NOTHING slides in pitch — a filter corner moving
  // over a fixed pitch is a machine gaining or losing energy, where a pitch
  // slide inside a 60 ms voice is the 1980s laser §5.4 retires. The four:
  //
  //   d  **magnetic launch** — rail contact: a dry snap and an eddy that is gone
  //      before it can ring. The one with no air and no tone in it.
  //   e  **compressed vent** — pneumatic: a low body, and gas leaving under
  //      pressure. Granular, wide, the only one with weight low down.
  //   f  **capacitor bloom** — a narrow band blooming at its corner and damped
  //      immediately. Metal, but damped metal: it is stopped, not left to ring.
  //   g  **damped hardware** — the restrained one. Mechanical contact with the
  //      body taken out from under it; shortest and quietest of the four, and
  //      the offer to pick if the answer to "too toony" is "less of everything".
  //
  // §8's shield/core grammar survives the sweep unchanged: every `shieldHit`
  // offer keeps a ring and every `coreHit` offer stays dull, low and closing, so
  // a besieged player still hears which layer is being eaten (§2.2) in all
  // sixteen combinations rather than in the three that happened to be on offer.
  // ---------------------------------------------------------------------------
  // ROUND 2 (a0-67, 2026-08-17) — THREE DIRECTIONS, NOT THREE TAKES
  // ---------------------------------------------------------------------------
  //
  // All four of the sweep's takes were denied, verbatim:
  //
  //   *"none of these sound like a gun fire or laser turret, make 3 distinct
  //   sounds for it so we can see the direciton to go in"*
  //
  // The first clause is a **category** rejection and it names the thing the sweep
  // got wrong. Read the four characters above: rail *contact*, compressed *vent*,
  // capacitor *bloom*, damped *hardware*. Every one of them is a machine doing
  // something — and not one of them is a **weapon discharging**. They were written
  // to a register note (*"nothing slides in pitch… the hardware is audible and the
  // cartoon is not"*) and they satisfy it exactly, which is how a set can be right
  // about the brief and wrong about the sound. A gun is not a mechanism noise; it
  // is energy leaving fast enough to be violent, and the sweep's own constraint —
  // no pitch motion inside a 60 ms voice, because that is the 1980s laser §5.4
  // retires — is precisely what took the violence out.
  //
  // **The developer has now asked for the laser by name, twice over.** That
  // outranks this lane's reading of §5.4, on the precedent already set by the
  // alarm: legibility outranks register (a0-60, §2.2). So `i` below is allowed a
  // bounded downward pitch fall — ×1.5 over 45 ms, which is a bolt losing energy,
  // where the retired idiom was ×4 over 86 ms with a duty sweep on a square. The
  // ratio and the oscillator are the difference between a plasma discharge and a
  // cabinet pew, and both are written down here so the next round can move the
  // number instead of re-litigating the clause.
  //
  //   h  **a report** — the gun direction. A broadband crack, a low thump under
  //      it, and the action working after. Nothing pitched, nothing electric.
  //   i  **a discharge** — the laser-turret direction. A bright narrow beam-tone
  //      falling as it leaves, over an ionised hiss. The only one with pitch
  //      motion in it, deliberately.
  //   j  **a launch** — the mass-driver direction, between the two: magnetic
  //      snap, real weight low down, and air torn behind the round.
  //   k  **the sound that ships today**, so the three directions are heard against
  //      the thing they are moving away from.
  //
  // §8 holds across all of them: the pair this slot may never collide with is
  // `shotImpact` (*a turret fired at me* vs *something landed on me*), and the
  // dimension that separates them is **length** as much as pitch — every
  // `shotImpact` offer is under 60 ms and none of these is.
  turretFire: {
    label: "Turret Fire",
    context: "Your turret or ship fires a shot.",
    current: 'turretFire',
    candidates: [
      {
        id: 'h',
        slot: 'turretFire',
        character: "a report: crack, thump, action",
        spec: {
          name: 'turretFire_h_report',
          layers: [
            // The crack is the whole tell and it is over in 12 ms: broadband,
            // high-passed so it reads as air splitting rather than as a body, and
            // steep enough that the ear takes it as an event rather than a note.
            place({ name: 'turretFire_h.crack', wave: 'noise', attack: 0.0002, hold: 0.0015, decay: 0.012, decayCurve: 9, punch: 0.9, freq: 3200, lowPass: 6200, lowPassEnd: 2400, resonance: 1.2, highPass: 900, gain: 0.34, seed: 60050 }),
            swept('turretFire_h.thump', { wave: 'sine', freq: 78, from: 420, to: 120, q: 1.8, gain: 0.23, attack: 0.0008, hold: 0.006, decay: 0.07, curve: 5.5, punch: 0.8, noiseMix: 0.1, seed: 60052 }),
            grains('turretFire_h.action', { freq: 700, grain: 0.0055, gain: 0.11, hold: 0.004, decay: 0.045, curve: 5, from: 2400, to: 800, q: 3, hp: 320, at: 0.016, seed: 60054 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'turretFire',
        character: "a discharge: beam falling, ion hiss",
        spec: {
          name: 'turretFire_i_discharge',
          layers: [
            // 2200 → 1466 Hz is ×1.5 over 45 ms. Written as a ratio on purpose:
            // the retired idiom is ×4 over 86 ms on a duty-swept square, and the
            // distance between the two is what stops "the developer asked for a
            // laser" becoming "the cartoon came back".
            place({ name: 'turretFire_i.beam', wave: 'triangle', attack: 0.0006, hold: 0.004, decay: 0.045, decayCurve: 5.5, punch: 0.6, freq: 2200, freqEnd: 1466, noiseMix: 0.12, lowPass: 4200, lowPassEnd: 1800, resonance: 6, gain: 0.3, seed: 60060 }),
            swept('turretFire_i.ion', { wave: 'noise', freq: 2600, from: 4800, to: 1600, q: 4.5, gain: 0.31, attack: 0.0004, hold: 0.003, decay: 0.05, curve: 6, punch: 0.5, hp: 1100, seed: 60062 }),
            swept('turretFire_i.coil', { wave: 'sine', freq: 132, from: 600, to: 200, q: 2.4, gain: 0.16, attack: 0.001, hold: 0.006, decay: 0.055, curve: 5, noiseMix: 0.08, seed: 60064 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'turretFire',
        character: "a launch: magnetic snap and weight",
        spec: {
          name: 'turretFire_j_launch',
          layers: [
            band('turretFire_j.snap', 1750, { gain: 0.48, decay: 0.016, q: 6, curve: 8, punch: 0.8, hp: 700, seed: 60070 }),
            swept('turretFire_j.mass', { wave: 'sine', freq: 62, from: 340, to: 96, q: 2, gain: 0.3, attack: 0.001, hold: 0.012, decay: 0.1, curve: 4.5, punch: 0.7, noiseMix: 0.08, seed: 60072 }),
            swept('turretFire_j.wake', { wave: 'noise', freq: 1400, from: 3800, to: 900, q: 2.4, gain: 0.16, attack: 0.002, hold: 0.005, decay: 0.06, curve: 4, hp: 500, at: 0.008, seed: 60074 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'turretFire',
        anchor: true,
        character: "the sound that ships today (A/B)",
        spec: incumbent('turretFire', 'k'),
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // THE IMPACT FAMILY (a0-68, 2026-08-17)
  // ---------------------------------------------------------------------------
  //
  //   *"none of these sound like impact sounds, they should also be different
  //   depending on the thing that was hit..."*
  //
  // Two requests, and the second one is why `shotImpact` is not on this board any
  // more. It was one slot for four physical events, so no set of four takes could
  // have answered it — the fourth denial would have been as fair as the third.
  // The slot is replaced by these four, the tell now carries which one
  // (`../tells` IMPACT, `../vfx/observer` impactSurface), and the sim's six
  // branches fold to four voices under a table anyone can move. The derivation is
  // in `docs/sound-structural-notes.md`; the measured proof that each branch comes
  // out carrying the right surface is `evidence/a0-68-structural-slots/`.
  //
  // ## Letters start at `a`, and that is not a mistake
  //
  // A letter is only meaningful inside a slot — `/status/sound-choices.json`
  // records a slot AND a letter. These are four slot ids no verdict has ever
  // named, so `a` here cannot be confused with `shotImpact/a`; there is no
  // `impactHull` record to make unreadable. The a0-48 re-lettering rule is about
  // a slot re-offering under its own spent letters, which is not this.
  //
  // ## What every offer in all four slots has to be
  //
  //  1. **An arrival, not a weapon.** `turretFire` is the shot leaving; these are
  //     the shot landing, and `./bank`'s own note says low is what separates them.
  //     Nothing here may read as a discharge.
  //  2. **Under its consequence.** Each impact is followed a beat later by the
  //     voice that carries the mechanic — `shieldHit`, `coreHit`, `rockCrack`.
  //     The arrival says what you hit; the consequence says what it did. Every
  //     offer is held under the shipped consequence in level, in
  //     `./candidates.test.ts`, because an arrival that drowns its own consequence
  //     is a louder game rather than a clearer one.
  //  3. **Short.** They fire at combat rate, several a second in a firefight, so
  //     every offer is inside 0.2 s and gone before the next one.
  //
  // ## And what makes the four SLOTS different from each other
  //
  // Read across the four blocks at the same letter and the *material* changes
  // while the gesture holds. That is deliberate: the player has to learn four
  // surfaces by ear during a fight, and four families that share a grammar is a
  // thing an ear picks up in one match. Four unrelated sounds is four lessons.

  impactHull: {
    label: "Impact — Hull",
    context: "A shot lands on an enemy ship. Thin plate over a body that is moving — the only one of the four that RINGS.",
    current: 'impactHull',
    candidates: [
      {
        id: 'a',
        slot: 'impactHull',
        character: "a dent: plate deforming, then ringing",
        spec: {
          name: 'impactHull_a_dent',
          layers: [
            band('impactHull_a.contact', 2150, { gain: 0.4, decay: 0.017, q: 4.5, curve: 7.5, punch: 0.6, hp: 700, seed: 68100 }),
            // Inharmonic on purpose: a panel, never the ratified glass spacing —
            // that material belongs to the interface (`./ui-cues`) and borrowing
            // it here would blur a menu tick into a firefight.
            ...plate('impactHull_a.panel', 1150, { gain: 0.26, decay: 0.07, ratios: [1, 2.37], q: 8, curve: 5, grain: 0.22, edge: 0, seed: 68102 }),
          ],
        },
      },
      {
        id: 'b',
        slot: 'impactHull',
        character: "spall: debris comes off the plate",
        spec: {
          name: 'impactHull_b_spall',
          layers: [
            grains('impactHull_b.spall', { freq: 2900, freqEnd: 2200, grain: 0.0016, gain: 0.4, hold: 0.002, decay: 0.032, curve: 6.5, punch: 0.6, from: 5800, to: 2400, q: 3.6, hp: 1500, seed: 68110 }),
            band('impactHull_b.plate', 980, { gain: 0.22, decay: 0.045, q: 7, curve: 5.5, seed: 68112 }),
          ],
        },
      },
      {
        id: 'c',
        slot: 'impactHull',
        character: "a punch-through, and the hollow behind it",
        spec: {
          name: 'impactHull_c_punchThrough',
          layers: [
            band('impactHull_c.punch', 1820, { gain: 0.62, decay: 0.012, q: 5, curve: 8.5, punch: 0.75, hp: 600, seed: 68120 }),
            // The volume on the far side of the hole: a body with the corner
            // OPENING, which is the one filter direction that reads as space
            // rather than as damage.
            swept('impactHull_c.hollow', { wave: 'triangle', freq: 210, from: 520, to: 1500, q: 3, gain: 0.4, attack: 0.0012, hold: 0.004, decay: 0.075, curve: 4.2, noiseMix: 0.3, at: 0.006, seed: 68122 }),
          ],
        },
      },
      {
        id: 'd',
        slot: 'impactHull',
        character: "armour doing its job: damped, almost no ring",
        spec: {
          name: 'impactHull_d_armour',
          layers: [
            band('impactHull_d.contact', 1650, { gain: 0.38, decay: 0.014, q: 4, curve: 8, punch: 0.65, hp: 500, seed: 68130 }),
            swept('impactHull_d.damp', { wave: 'noise', freq: 420, from: 1900, to: 380, q: 2.6, gain: 0.26, attack: 0.0005, hold: 0.003, decay: 0.036, curve: 7, punch: 0.4, seed: 68132 }),
          ],
        },
      },
    ],
  },

  impactRock: {
    label: "Impact — Rock",
    context: "A shot bites stone. Dry and low, and NOTHING rings — a rock that rings is a bell somebody painted grey.",
    current: 'impactRock',
    candidates: [
      {
        id: 'a',
        slot: 'impactRock',
        character: "a bite: granular cutting, no tone",
        spec: {
          name: 'impactRock_a_bite',
          layers: [
            grains('impactRock_a.grit', { freq: 220, grain: 0.0028, gain: 0.36, hold: 0.003, decay: 0.05, curve: 6, punch: 0.5, from: 1500, to: 420, q: 3.2, hp: 120, seed: 68200 }),
            band('impactRock_a.edge', 950, { gain: 0.2, decay: 0.013, q: 4, curve: 8, punch: 0.5, seed: 68202 }),
          ],
        },
      },
      {
        id: 'b',
        slot: 'impactRock',
        character: "mass: pressure into stone, no grit",
        spec: {
          name: 'impactRock_b_mass',
          layers: [
            swept('impactRock_b.mass', { wave: 'sine', freq: 128, from: 700, to: 170, q: 2.2, gain: 0.4, attack: 0.0008, hold: 0.008, decay: 0.075, curve: 5.5, punch: 0.55, noiseMix: 0.14, seed: 68210 }),
            band('impactRock_b.tap', 640, { gain: 0.16, decay: 0.012, q: 3.6, curve: 8, seed: 68212 }),
          ],
        },
      },
      {
        id: 'c',
        slot: 'impactRock',
        character: "shatter: chips leaving the face",
        spec: {
          name: 'impactRock_c_shatter',
          layers: [
            band('impactRock_c.strike', 1250, { gain: 0.3, decay: 0.011, q: 4.5, curve: 8.5, punch: 0.6, hp: 380, seed: 68220 }),
            grains('impactRock_c.chips', { freq: 1900, freqEnd: 1250, grain: 0.0021, gain: 0.28, hold: 0.002, decay: 0.055, curve: 4.5, from: 3600, to: 900, q: 3, hp: 700, at: 0.005, seed: 68222 }),
          ],
        },
      },
      {
        id: 'd',
        slot: 'impactRock',
        character: "dead stop: the round just ends",
        spec: {
          name: 'impactRock_d_deadStop',
          layers: [
            // The shortest offer on the board for this slot, deliberately: at
            // mining rate the most useful thing a rock impact can be is over.
            swept('impactRock_d.stop', { wave: 'noise', freq: 300, from: 1800, to: 240, q: 2.4, gain: 0.42, attack: 0.0004, hold: 0.002, decay: 0.028, curve: 8, punch: 0.5, seed: 68230 }),
          ],
        },
      },
    ],
  },

  impactShield: {
    label: "Impact — Shield",
    context: "A shot stopped by a live bubble. The round never reached anything solid, and THAT is the whole information.",
    current: 'impactShield',
    candidates: [
      // These deliberately do NOT reuse a0-67's four readings of `shieldHit`
      // (deflection · absorption · arc · flex). That slot is the FIELD'S
      // response and it plays a beat after this one; offering the same four
      // ideas twice in a row would make the pair sound like one sound with an
      // echo. These four are about the ROUND failing to arrive.
      {
        id: 'a',
        slot: 'impactShield',
        character: "stopped short: the contact is cut off",
        spec: {
          name: 'impactShield_a_stoppedShort',
          layers: [
            // A contact with its own tail removed — the decay is shorter than
            // the ear expects from an edge that bright, which is what "it did
            // not land" sounds like.
            band('impactShield_a.cut', 1700, { gain: 0.3, decay: 0.008, q: 5, curve: 9, punch: 0.5, hp: 600, seed: 68300 }),
            swept('impactShield_a.field', { wave: 'noise', freq: 720, from: 2600, to: 640, q: 3.6, gain: 0.2, attack: 0.001, hold: 0.004, decay: 0.07, curve: 4.5, hp: 320, at: 0.004, seed: 68302 }),
          ],
        },
      },
      {
        id: 'b',
        slot: 'impactShield',
        character: "swallowed: a corner closing over it",
        spec: {
          name: 'impactShield_b_swallowed',
          layers: [
            swept('impactShield_b.close', { wave: 'noise', freq: 560, from: 4200, to: 400, q: 3.8, gain: 0.32, attack: 0.0012, hold: 0.005, decay: 0.095, curve: 4, punch: 0.3, hp: 240, seed: 68310 }),
          ],
        },
      },
      {
        id: 'c',
        slot: 'impactShield',
        character: "static: it ionises, with no body at all",
        spec: {
          name: 'impactShield_c_static',
          layers: [
            grains('impactShield_c.crackle', { freq: 2400, freqEnd: 2600, grain: 0.0024, gain: 0.26, hold: 0.002, decay: 0.07, curve: 3.8, from: 4800, to: 2000, q: 4.2, hp: 1400, seed: 68320 }),
          ],
        },
      },
      {
        id: 'd',
        slot: 'impactShield',
        character: "a glance: it slides off and away",
        spec: {
          name: 'impactShield_d_glance',
          layers: [
            // The corner OPENS rather than closing — the round leaving, not the
            // round stopping. The only offer here with upward motion, and it is
            // motion in the filter, not in pitch (§5.4).
            swept('impactShield_d.skid', { wave: 'noise', freq: 900, from: 700, to: 3800, q: 3.2, gain: 0.62, attack: 0.0011, hold: 0.004, decay: 0.08, curve: 4.2, punch: 0.35, hp: 400, seed: 68330 }),
            band('impactShield_d.brush', 1560, { gain: 0.24, decay: 0.05, q: 10, curve: 4, at: 0.01, seed: 68332 }),
          ],
        },
      },
    ],
  },

  impactStation: {
    label: "Impact — Station",
    context: "A shot on anchored metal: a turret, a radar satellite, or the bare core. The darkest of the four — mass that does not move.",
    current: 'impactStation',
    candidates: [
      {
        id: 'a',
        slot: 'impactStation',
        character: "anchored: a thud that goes nowhere",
        spec: {
          name: 'impactStation_a_anchored',
          layers: [
            band('impactStation_a.contact', 700, { gain: 0.28, decay: 0.014, q: 4, curve: 8, punch: 0.5, hp: 180, seed: 68400 }),
            swept('impactStation_a.mass', { wave: 'triangle', freq: 88, from: 560, to: 150, q: 2.6, gain: 0.36, attack: 0.001, hold: 0.01, decay: 0.11, curve: 5, punch: 0.5, noiseMix: 0.18, seed: 68402 }),
          ],
        },
      },
      {
        id: 'b',
        slot: 'impactStation',
        character: "bulkhead: a big damped panel",
        spec: {
          name: 'impactStation_b_bulkhead',
          layers: [
            ...plate('impactStation_b.panel', 320, { gain: 0.3, decay: 0.1, ratios: [1, 1.83, 3.11], q: 5.5, curve: 4.5, punch: 0.45, grain: 0.35, edge: 0.7, seed: 68410 }),
          ],
        },
      },
      {
        id: 'c',
        slot: 'impactStation',
        character: "structure: the hit travels into the frame",
        spec: {
          name: 'impactStation_c_structure',
          layers: [
            band('impactStation_c.contact', 840, { gain: 0.26, decay: 0.011, q: 4.5, curve: 8.5, punch: 0.55, hp: 240, seed: 68420 }),
            // Late and low — the frame answering after the round, which is what
            // makes a station feel big without making the cue long.
            swept('impactStation_c.frame', { wave: 'sine', freq: 74, from: 300, to: 110, q: 2.2, gain: 0.3, attack: 0.004, hold: 0.012, decay: 0.13, curve: 3.8, noiseMix: 0.1, at: 0.018, seed: 68422 }),
          ],
        },
      },
      {
        id: 'd',
        slot: 'impactStation',
        character: "a ricochet off armour, into a room",
        spec: {
          name: 'impactStation_d_ricochet',
          layers: [
            band('impactStation_d.ric', 1480, { gain: 0.3, decay: 0.02, q: 6.5, curve: 7, punch: 0.7, hp: 520, seed: 68430 }),
            swept('impactStation_d.room', { wave: 'noise', freq: 260, from: 900, to: 200, q: 2, gain: 0.22, attack: 0.006, hold: 0.008, decay: 0.12, curve: 3.4, at: 0.014, seed: 68432 }),
          ],
        },
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // ROUND 2 (a0-67, 2026-08-17)
  // ---------------------------------------------------------------------------
  //
  //   *"none of these sound like ashield hit"*
  //
  // The shortest reason on the board and the most diagnosable, because the slot
  // has a **grammar** and the sweep dropped it. The shipped `shieldHit` is a
  // 1320 Hz body with a 14 Hz shimmer on it and a low-pass that *opens* 1100 →
  // 2200 — `./bank`'s own comment is *"the skin opening under the hit — absorbed,
  // not broken"* — and that opening is the entire difference between a field
  // taking a hit and a plate being struck. Round one offered a struck lattice (a
  // plate: that is a hull), a wash, a bloom and a tick. Not one of them **gives**.
  //
  // So the thing all four below have, that none of the denied four had:
  //
  //  1. **The field gives and comes back.** Something rises after the contact —
  //     a corner opening, a body bending up — because a shield deforms. A filter
  //     that only closes is a thing being damaged, which is `coreHit`'s job.
  //  2. **A shimmer.** Slow modulation across the tail, so the surface reads as
  //     energetic rather than as material. §5.4 exempts drift inside a voice this
  //     short by construction, and the shipped voice already carries it.
  //  3. **No hard edge.** No plate, no snap, no metal transient — those all say
  //     *hull*, and §2.2's whole point is that the player can hear which layer is
  //     being eaten.
  //
  // The four are four kinds of field, not four takes on one:
  //
  //   h  **deflection** — the hit skids off. Contact, then a ring that spreads
  //      upward and outward and is gone.
  //   i  **absorption** — the hit is swallowed. No contact at all: a low bloom
  //      that swells and dies, the quietest of the four.
  //   j  **arc** — the field discharges where it is struck. Granular sparks over
  //      a bubble that is still ringing. The bright one.
  //   k  **flex** — the surface bends and settles. A pitched body pushed up and
  //      let back down, with the shimmer strongest.
  shieldHit: {
    label: "Shield Hit",
    context: "A shield absorbs a hit — struck bell, not broken.",
    current: 'shieldHit',
    candidates: [
      {
        id: 'h',
        slot: 'shieldHit',
        character: "deflection: it skids off, ring spreading",
        spec: {
          name: 'shieldHit_h_deflection',
          layers: [
            swept('shieldHit_h.skid', { wave: 'noise', freq: 1500, from: 1200, to: 4200, q: 5, gain: 0.3, attack: 0.0015, hold: 0.01, decay: 0.13, curve: 3.6, hp: 700, seed: 60130 }),
            place({ name: 'shieldHit_h.ring', wave: 'sine', attack: 0.002, hold: 0.01, decay: 0.2, decayCurve: 3.4, freq: 1245, freqEnd: 1400, vibratoDepth: 0.016, vibratoRate: 11, noiseMix: 0.05, lowPass: 1400, lowPassEnd: 3000, resonance: 3.2, gain: 0.26, seed: 60132 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'shieldHit',
        character: "absorption: swallowed, a low bloom",
        spec: {
          name: 'shieldHit_i_absorption',
          layers: [
            // 8 ms to full — no transient anywhere. This is the take that says a
            // shield is not a surface you hit, it is a budget you spend.
            swept('shieldHit_i.bloom', { wave: 'sine', freq: 620, from: 700, to: 1600, q: 2.8, gain: 0.28, attack: 0.008, hold: 0.02, decay: 0.17, curve: 3, vib: [0.014, 9], noiseMix: 0.06, seed: 60140 }),
            swept('shieldHit_i.body', { wave: 'noise', freq: 420, from: 500, to: 1200, q: 3.4, gain: 0.2, attack: 0.01, hold: 0.016, decay: 0.15, curve: 2.8, hp: 200, seed: 60142 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'shieldHit',
        character: "arc: sparks over a ringing bubble",
        spec: {
          name: 'shieldHit_j_arc',
          layers: [
            grains('shieldHit_j.sparks', { freq: 3100, freqEnd: 4200, grain: 0.0022, gain: 0.24, hold: 0.006, decay: 0.09, curve: 3.8, from: 3000, to: 5600, q: 4, hp: 1600, seed: 60150 }),
            place({ name: 'shieldHit_j.bubble', wave: 'sine', attack: 0.002, hold: 0.012, decay: 0.19, decayCurve: 3.4, freq: 1568, freqEnd: 1720, vibratoDepth: 0.02, vibratoRate: 13, noiseMix: 0.05, lowPass: 1800, lowPassEnd: 3400, resonance: 3, gain: 0.22, seed: 60152 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'shieldHit',
        character: "flex: the surface bends and settles",
        spec: {
          name: 'shieldHit_k_flex',
          layers: [
            // The pitch goes UP and stays there: pushed in, and holding. A fall
            // would be the field failing, which is `shieldDown`'s ×6.9 (§8).
            place({ name: 'shieldHit_k.flex', wave: 'triangle', attack: 0.003, hold: 0.014, decay: 0.22, decayCurve: 3.2, freq: 880, freqEnd: 1010, vibratoDepth: 0.026, vibratoRate: 15, noiseMix: 0.08, lowPass: 1200, lowPassEnd: 2600, resonance: 3.6, gain: 0.32, seed: 60160 }),
            swept('shieldHit_k.skin', { wave: 'noise', freq: 1100, from: 900, to: 2800, q: 4.5, gain: 0.24, attack: 0.004, hold: 0.012, decay: 0.12, curve: 3.2, hp: 500, at: 0.004, seed: 60162 }),
          ],
        },
      },
    ],
  },
  // The ×6.9 fall stays in every offer — a bubble failing IS a collapse, and
  // §5.4 exempts it by construction. What the four differ in is what is falling.
  shieldDown: {
    label: "Shield Down",
    context: "A shield's bubble fails and falls.",
    current: 'shieldDown',
    candidates: [
      {
        id: 'd',
        character: "lattice unwinding, band walking down",
        spec: {
          name: 'shieldDown_d_latticeUnwind',
          layers: [
            swept('shieldDown_d.unwind', { wave: 'triangle', freq: 1280, freqEnd: 186, from: 4200, to: 700, q: 9, gain: 0.592, attack: 0.002, hold: 0.018, decay: 0.4, curve: 2.8, noiseMix: 0.16, hp: 260, seed: 60130 }),
            band('shieldDown_d.let', 2200, { gain: 0.592, decay: 0.04, q: 8, curve: 6, punch: 0.45, seed: 60132 }),
          ],
        },
      },
      {
        id: 'e',
        character: "vent to vacuum, air then nothing",
        spec: {
          name: 'shieldDown_e_ventToVacuum',
          layers: [
            grains('shieldDown_e.vent', { freq: 1100, freqEnd: 180, grain: 0.0022, gain: 0.46, hold: 0.03, decay: 0.36, curve: 2.8, punch: 0.4, from: 3800, to: 340, q: 2.8, hp: 220, seed: 60140 }),
            swept('shieldDown_e.floor', { wave: 'sine', freq: 84, freqEnd: 48, from: 190, q: 1.8, gain: 0.24, attack: 0.008, hold: 0.02, decay: 0.26, curve: 2.4, at: 0.04, seed: 60142 }),
          ],
        },
      },
      {
        id: 'f',
        character: "capacitor discharging, room behind",
        spec: {
          name: 'shieldDown_f_dischargeRoom',
          layers: [
            swept('shieldDown_f.arc', { wave: 'noise', freq: 1600, freqEnd: 300, from: 5000, to: 800, q: 7, gain: 0.44, attack: 0.001, hold: 0.02, decay: 0.3, curve: 3.2, punch: 0.5, hp: 500, seed: 60150 }),
            ...returns('shieldDown_f.room', { freq: 620, gain: 0.15, decay: 0.24, from: 1800, to: 560, at: 0.11, gap: 0.12, count: 2, seed: 60153 }),
          ],
        },
      },
      {
        id: 'g',
        character: "damped drop, one stage, no drama",
        spec: {
          name: 'shieldDown_g_dampedDrop',
          layers: [
            swept('shieldDown_g.drop', { wave: 'triangle', freq: 760, freqEnd: 150, from: 1900, to: 420, q: 4, gain: 0.671, attack: 0.002, hold: 0.012, decay: 0.22, curve: 3.6, noiseMix: 0.22, seed: 60160 }),
            band('shieldDown_g.settle', 380, { gain: 0.459, decay: 0.1, q: 4.5, curve: 5, at: 0.09, seed: 60162 }),
          ],
        },
      },
    ],
  },
  // One of the two sounds homes get, and the ache depends on it (§7.2): SERIOUS,
  // low, dropping, no sparkle anywhere near it. All four are dull by
  // construction — nothing above 1 kHz survives more than 40 ms in any of them —
  // and all four keep clear of `rejectBuzz`, the §8 pair that reads as *your buy
  // was refused* against *your reactor is being eaten*.
  coreHit: {
    label: "Core Hit",
    context: "A home core takes damage. SERIOUS — low, drops, no sparkle.",
    current: 'coreHit',
    candidates: [
      {
        id: 'd',
        character: "containment knock, deep and short",
        spec: {
          name: 'coreHit_d_containmentKnock',
          layers: [
            swept('coreHit_d.knock', { wave: 'sine', freq: 96, freqEnd: 58, from: 260, to: 92, q: 2.8, gain: 0.5, attack: 0.0015, hold: 0.02, decay: 0.24, curve: 3, punch: 0.7, noiseMix: 0.08, seed: 60170 }),
            band('coreHit_d.shell', 210, { gain: 0.3, decay: 0.12, q: 4, curve: 5, at: 0.006, seed: 60172 }),
          ],
        },
      },
      {
        id: 'e',
        character: "coolant surge under the hit",
        spec: {
          name: 'coreHit_e_coolantSurge',
          layers: [
            swept('coreHit_e.hit', { wave: 'triangle', freq: 88, freqEnd: 62, from: 420, to: 150, q: 3, gain: 0.42, attack: 0.002, hold: 0.018, decay: 0.22, curve: 3.2, punch: 0.6, noiseMix: 0.18, seed: 60180 }),
            grains('coreHit_e.surge', { freq: 170, freqEnd: 96, grain: 0.008, gain: 0.3, hold: 0.04, decay: 0.3, curve: 2.6, from: 400, to: 130, q: 2.6, at: 0.03, seed: 60182 }),
          ],
        },
      },
      {
        id: 'f',
        character: "load transferring through the frame",
        spec: {
          name: 'coreHit_f_frameLoad',
          layers: [
            swept('coreHit_f.strike', { wave: 'noise', freq: 130, freqEnd: 60, from: 480, to: 140, q: 2.4, gain: 0.42, attack: 0.003, hold: 0.024, decay: 0.26, curve: 2.8, punch: 0.55, seed: 60190 }),
            swept('coreHit_f.frame', { wave: 'triangle', freq: 118, freqEnd: 104, from: 320, to: 170, q: 5.5, gain: 0.32, attack: 0.03, hold: 0.05, decay: 0.32, curve: 2.2, noiseMix: 0.2, at: 0.04, seed: 60192 }),
          ],
        },
      },
      {
        id: 'g',
        character: "one dull mass, nothing after it",
        spec: {
          name: 'coreHit_g_dullMass',
          layers: [
            swept('coreHit_g.mass', { wave: 'sine', freq: 74, freqEnd: 50, from: 200, to: 84, q: 2, gain: 0.52, attack: 0.003, hold: 0.03, decay: 0.2, curve: 3.4, punch: 0.5, noiseMix: 0.06, seed: 60200 }),
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
        id: 'd',
        character: "rail mount letting go, dry",
        spec: {
          name: 'turretDown_d_mountRelease',
          layers: [
            band('turretDown_d.snap', 1150, { gain: 0.44, decay: 0.04, q: 6, curve: 6.5, punch: 0.7, seed: 60210 }),
            grains('turretDown_d.slide', { freq: 520, freqEnd: 200, grain: 0.004, gain: 0.36, hold: 0.02, decay: 0.24, curve: 3.4, from: 2400, to: 460, q: 3, hp: 180, at: 0.02, seed: 60212 }),
          ],
        },
      },
      {
        id: 'e',
        character: "pressure vessel emptying out",
        spec: {
          name: 'turretDown_e_vesselEmpty',
          layers: [
            swept('turretDown_e.rupture', { wave: 'noise', freq: 700, freqEnd: 160, from: 3200, to: 380, q: 3, gain: 0.251, attack: 0.001, hold: 0.03, decay: 0.3, curve: 3, punch: 0.6, seed: 60220 }),
            swept('turretDown_e.sink', { wave: 'sine', freq: 82, from: 210, to: 110, q: 1.9, gain: 0.159, attack: 0.004, hold: 0.03, decay: 0.28, curve: 2.6, at: 0.06, seed: 60222 }),
          ],
        },
      },
      {
        id: 'f',
        character: "cell arcing out, damped metal",
        spec: {
          name: 'turretDown_f_cellArc',
          layers: [
            band('turretDown_f.arc', 1850, { gain: 0.5, decay: 0.07, q: 9, curve: 5, punch: 0.6, hp: 700, seed: 60230 }),
            ...plate('turretDown_f.hull', 520, { gain: 0.3, decay: 0.2, ratios: [1, 2.14], q: 6, curve: 4.5, grain: 0.34, edge: 0, at: 0.03, seed: 60232 }),
            ...returns('turretDown_f.room', { freq: 420, gain: 0.11, decay: 0.2, from: 1200, to: 380, at: 0.15, gap: 0.12, count: 2, seed: 60236 }),
          ],
        },
      },
      {
        id: 'g',
        character: "it stops working, and drops",
        spec: {
          name: 'turretDown_g_stopsWorking',
          layers: [
            swept('turretDown_g.stall', { wave: 'triangle', freq: 240, freqEnd: 96, from: 1100, to: 260, q: 4, gain: 0.36, attack: 0.002, hold: 0.02, decay: 0.2, curve: 3.6, noiseMix: 0.26, seed: 60240 }),
            swept('turretDown_g.deck', { wave: 'sine', freq: 70, from: 180, to: 100, q: 2, gain: 0.3, attack: 0.002, hold: 0.02, decay: 0.18, curve: 3.4, at: 0.11, seed: 60242 }),
          ],
        },
      },
    ],
  },
  // === SHIP (a0-60) =========================================================
  //
  // A hull is a machine with a drive in it, and these four slots are that machine
  // arriving, holding, and coming apart. The denied set offered three propulsion
  // technologies; the re-voice offers four ways for the *hardware* to be audible,
  // which is the thing "modern/sci-fi" asks for and "retro/toony" never has:
  //
  //   d  **ion wash** — particulate exhaust, high-passed, dry. Matter leaving at
  //      speed. Nothing in it rings and nothing in it is a tone.
  //   e  **inertial mass** — a low body under a closing corner. Weight, and the
  //      pressure that moved it; the only offers with anything under 100 Hz.
  //   f  **magnetic containment** — narrow resonant bands forming or failing.
  //      Metal, damped rather than left to ring, and the only one with a room.
  //   g  **hardware only** — relays, clamps, contacts. The restrained offer: the
  //      event stated once, no debris, no tail, nothing added for excitement.
  //
  // `shipExplode` has no sparkle layer in any of the four. §7.2 of
  // `docs/audio-revoice-spec.md` retires the firework by name, and a bang that
  // ends in glitter is the single most retro thing this bank could still do.
  //
  // §8 guards `respawnBeep` / `spawnPulse` — the countdown against the protection
  // tick — at ×1.20 of centroid, the second-tightest pair in the bank. Four offers
  // each is sixteen possible pairings, so the margin is held on the *whole set*
  // rather than on the pair that happens to be shipping: every `spawnPulse` offer
  // stays a **field** (soft, particulate, low) and every `respawnBeep` offer a
  // **clock** (hard, narrow, above it). Measured as zero-crossing rate, the same
  // cheap centroid proxy `./audio.test.ts` uses — spawnPulse tops out at 0.030
  // (d 0.030 · e 0.008 · f 0.027 · g 0.022) and respawnBeep bottoms out at 0.040
  // (d 0.143 · e 0.040 · f 0.080 · g 0.118), so the *worst* pairing clears ×1.34.
  shipExplode: {
    label: "Ship Explosion",
    context: "A ship blows up — a pressure failure, over quickly. No sparkle (§4.7).",
    current: 'shipExplode',
    candidates: [
      {
        id: 'd',
        character: "ion wash, exhaust torn open",
        spec: {
          name: 'shipExplode_d_ionWash',
          layers: [
            grains('shipExplode_d.wash', { freq: 900, freqEnd: 240, grain: 0.0022, gain: 0.3, hold: 0.04, decay: 0.36, curve: 3, punch: 0.5, from: 4800, to: 480, q: 3, hp: 320, seed: 60250 }),
            swept('shipExplode_d.front', { wave: 'noise', freq: 300, freqEnd: 90, from: 1500, to: 260, q: 2.6, gain: 0.26, attack: 0.001, hold: 0.02, decay: 0.22, curve: 3.4, punch: 0.6, seed: 60252 }),
          ],
        },
      },
      {
        id: 'e',
        character: "inertial failure, weight going out",
        spec: {
          name: 'shipExplode_e_inertialFailure',
          layers: [
            swept('shipExplode_e.blast', { wave: 'noise', freq: 190, freqEnd: 52, from: 1300, to: 150, q: 2.2, gain: 0.34, attack: 0.002, hold: 0.04, decay: 0.4, curve: 2.5, punch: 0.75, seed: 60260 }),
            swept('shipExplode_e.mass', { wave: 'sine', freq: 58, freqEnd: 34, from: 160, q: 1.7, gain: 0.28, attack: 0.004, hold: 0.04, decay: 0.34, curve: 2.2, at: 0.01, seed: 60262 }),
          ],
        },
      },
      {
        id: 'f',
        character: "containment failing, room answering",
        spec: {
          name: 'shipExplode_f_containmentFail',
          layers: [
            band('shipExplode_f.tear', 2200, { gain: 1.0, decay: 0.045, q: 8, curve: 7, punch: 0.8, seed: 60270 }),
            swept('shipExplode_f.collapse', { wave: 'triangle', freq: 380, freqEnd: 120, from: 3000, to: 300, q: 6.5, gain: 0.842, attack: 0.001, hold: 0.02, decay: 0.26, curve: 3.6, noiseMix: 0.4, at: 0.005, seed: 60272 }),
            ...returns('shipExplode_f.room', { freq: 640, gain: 0.471, decay: 0.24, from: 1800, to: 460, at: 0.11, gap: 0.13, count: 3, seed: 60274 }),
          ],
        },
      },
      {
        id: 'g',
        character: "one failure, over immediately",
        spec: {
          name: 'shipExplode_g_oneFailure',
          layers: [
            swept('shipExplode_g.fail', { wave: 'noise', freq: 340, freqEnd: 100, from: 2200, to: 300, q: 3.2, gain: 0.42, attack: 0.0008, hold: 0.02, decay: 0.16, curve: 4.5, punch: 0.8, seed: 60280 }),
            band('shipExplode_g.hull', 480, { gain: 0.3, decay: 0.08, q: 4.5, curve: 6, at: 0.02, seed: 60282 }),
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
        id: 'd',
        character: "ion wash settling into place",
        spec: {
          name: 'shipSpawn_d_ionSettle',
          layers: [
            grains('shipSpawn_d.wash', { freq: 380, freqEnd: 700, grain: 0.0028, gain: 0.3, hold: 0.06, decay: 0.12, curve: 2.2, from: 900, to: 3200, q: 3, hp: 260, seed: 60290 }),
            grains('shipSpawn_d.settle', { freq: 640, freqEnd: 420, grain: 0.0035, gain: 0.32, hold: 0.02, decay: 0.13, curve: 4.5, from: 2600, to: 900, q: 3.6, hp: 300, at: 0.18, seed: 60292 }),
          ],
        },
      },
      {
        id: 'e',
        character: "mass arriving and seating",
        spec: {
          name: 'shipSpawn_e_massSeat',
          layers: [
            swept('shipSpawn_e.approach', { wave: 'noise', freq: 140, freqEnd: 175, from: 340, to: 1400, q: 2.4, gain: 0.184, attack: 0.035, hold: 0.05, decay: 0.09, curve: 2, seed: 60300 }),
            swept('shipSpawn_e.seat', { wave: 'sine', freq: 88, freqEnd: 66, from: 280, to: 110, q: 2.2, gain: 0.275, attack: 0.002, hold: 0.022, decay: 0.18, curve: 3.2, punch: 0.6, noiseMix: 0.12, at: 0.19, seed: 60302 }),
          ],
        },
      },
      {
        id: 'f',
        character: "containment closing on the hull",
        spec: {
          name: 'shipSpawn_f_containmentClose',
          layers: [
            swept('shipSpawn_f.close', { wave: 'triangle', freq: 294, from: 520, to: 3400, q: 7.5, gain: 0.4, attack: 0.04, hold: 0.04, decay: 0.08, curve: 2.2, noiseMix: 0.24, seed: 60310 }),
            band('shipSpawn_f.lock', 1120, { gain: 0.72, decay: 0.12, q: 8.5, curve: 6, punch: 0.5, at: 0.17, seed: 60312 }),
            band('shipSpawn_f.hold', 700, { gain: 0.5, decay: 0.18, q: 10, curve: 5, at: 0.175, seed: 60313 }),
          ],
        },
      },
      {
        id: 'g',
        character: "clamps release, and it is there",
        spec: {
          name: 'shipSpawn_g_clampRelease',
          layers: [
            band('shipSpawn_g.clamp', 820, { gain: 0.44, decay: 0.05, q: 5.5, curve: 6.5, punch: 0.5, seed: 60320 }),
            swept('shipSpawn_g.push', { wave: 'sine', freq: 130, from: 340, to: 170, q: 2.4, gain: 0.3, attack: 0.006, hold: 0.02, decay: 0.14, curve: 3.4, noiseMix: 0.16, at: 0.05, seed: 60322 }),
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
      // All four stay a **field**, and stay quiet: this repeats every second for
      // ten seconds over a player who has just died, so the offer that wins is
      // the one that is easiest to stop noticing, not the one that reads best once.
      {
        id: 'd',
        character: "field grain, soft and particulate",
        spec: {
          name: 'spawnPulse_d_fieldGrain',
          layers: [
            grains('spawnPulse_d.grain', { freq: 380, freqEnd: 290, grain: 0.005, gain: 0.19, hold: 0.014, decay: 0.09, curve: 4, from: 900, to: 460, q: 2.8, hp: 140, seed: 60330 }),
          ],
        },
      },
      {
        id: 'e',
        character: "a held-pressure pip, low",
        spec: {
          name: 'spawnPulse_e_pressurePip',
          layers: [
            swept('spawnPulse_e.pip', { wave: 'sine', freq: 176, from: 560, to: 210, q: 3, gain: 0.21, attack: 0.005, hold: 0.016, decay: 0.11, curve: 3.2, noiseMix: 0.1, seed: 60340 }),
          ],
        },
      },
      {
        id: 'f',
        character: "the field skin, one damped band",
        spec: {
          name: 'spawnPulse_f_skinBand',
          layers: [
            band('spawnPulse_f.skin', 430, { gain: 0.52, decay: 0.11, q: 7, curve: 5.5, attack: 0.004, hold: 0.006, seed: 60350 }),
          ],
        },
      },
      {
        id: 'g',
        character: "barely a sound, a breath of it",
        spec: {
          name: 'spawnPulse_g_breath',
          layers: [
            swept('spawnPulse_g.breath', { wave: 'noise', freq: 300, from: 620, to: 340, q: 2.2, gain: 0.17, attack: 0.008, hold: 0.02, decay: 0.12, curve: 3, hp: 110, seed: 60360 }),
          ],
        },
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // ROUND 2 (a0-67, 2026-08-17) — A FATIGUE COMPLAINT, HELD AS A NUMBER
  // ---------------------------------------------------------------------------
  //
  //   *"all of these sound annoying being looped, we need something more subtle
  //   since these will play all the time"*
  //
  // Both halves of that sentence are diagnosis, and neither is taste. *"Being
  // looped"* and *"play all the time"* say the same thing twice: this is the one
  // voice in the bank that a player holds down, so the thing being judged is not
  // how it sounds once but what it is like on the fiftieth second. A sound that
  // is pleasant once and unbearable at the fiftieth repeat has failed this slot,
  // and no amount of character fixes it.
  //
  // So "subtle" is spent on the three things that actually cause loop fatigue,
  // in order of how much they cause it:
  //
  //  1. **Level.** The denied four ran at 0.51 / 0.51 / 0.33 / 0.35 peak against
  //     a shipped 0.46 — two of them were *louder* than the thing being
  //     complained about. Every offer below is under **half** the shipped
  //     thruster's RMS, and `./candidates.test.ts` holds it there.
  //  2. **Bandwidth.** A wide voice masks the rest of the mix and the ear cannot
  //     stop attending to it. These are narrow: nothing here is broadband, and
  //     the two with any top end are rolled off hard.
  //  3. **Anything periodic.** A resonant peak with grain moving through it beats
  //     at the loop rate, and a beat is the single most fatiguing thing a held
  //     sound can do — you cannot un-hear a pulse. Round one already knew half of
  //     this (*"no `lowPassEnd`: a sweep inside a loop body wraps to a 2.5 Hz
  //     wobble"*) and then put a Q of 8.5 and 10 on `f`'s two bands, which
  //     rings at the rate the grains hit it. Every Q below is under 4.
  //
  // The four are four amounts of *presence*, not four materials — because the
  // question this slot is asking is now "how little is enough":
  //
  //   h  **breath** — air only, no floor. The lightest thing that still says the
  //      engine is lit.
  //   i  **pressure** — felt rather than heard: almost all of it under 120 Hz.
  //   j  **a warm band** — one soft formant, no grain in it, nothing to beat.
  //   k  **almost nothing** — the floor of the slot, offered so somebody can hear
  //      where too-quiet actually is rather than guessing at it.
  thruster: {
    label: "Thruster Loop",
    context: "Held engine note while the throttle is open (loops continuously)",
    current: 'thruster',
    candidates: [
      // A loop has no envelope to carry character — `hold` runs flat and `decay`
      // is zero, which is what `./candidates.test.ts` checks for. So all four are
      // made of *material* instead: the corner, the Q, the register. None of
      // them names a `lowPassEnd`: a filter sweep inside a loop body wraps into a
      // 2.5 Hz wobble at the loop rate, which is a helicopter, not a drive.
      {
        id: 'h',
        slot: 'thruster',
        character: "breath: air only, no floor",
        spec: {
          name: 'thruster_h_breath',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_h.air', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 240, lowPass: 620, resonance: 1.2, highPass: 130, gain: 0.13, seed: 60410 }),
            place({ name: 'thruster_h.duct', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 150, lowPass: 300, resonance: 1.4, gain: 0.1, seed: 60411 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'thruster',
        character: "pressure: felt, not heard",
        spec: {
          name: 'thruster_i_pressure',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_i.mass', wave: 'sine', attack: 0, hold: 0.4, decay: 0, freq: 52, noiseMix: 0.12, lowPass: 150, resonance: 1.4, gain: 0.11, seed: 60420 }),
            place({ name: 'thruster_i.body', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 105, lowPass: 280, resonance: 1.8, gain: 0.066, seed: 60421 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'thruster',
        character: "one warm band, nothing to beat",
        spec: {
          name: 'thruster_j_warmBand',
          loop: true,
          crossfade: 0.04,
          layers: [
            // Q 3.2, not the 8.5 and 10 the denied take used. A narrow resonance
            // with noise running through it rings at the rate the noise excites
            // it, and that ring is the thing an ear locks onto and cannot let go.
            place({ name: 'thruster_j.formant', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 300, lowPass: 640, resonance: 3.2, highPass: 90, gain: 0.16, seed: 60430 }),
            place({ name: 'thruster_j.floor', wave: 'triangle', attack: 0, hold: 0.4, decay: 0, freq: 74, noiseMix: 0.14, lowPass: 210, resonance: 1.6, gain: 0.13, seed: 60431 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'thruster',
        character: "almost nothing, the floor of the slot",
        spec: {
          name: 'thruster_k_almostNothing',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_k.trace', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 170, lowPass: 400, resonance: 1.3, highPass: 80, gain: 0.085, seed: 60440 }),
            place({ name: 'thruster_k.under', wave: 'sine', attack: 0, hold: 0.4, decay: 0, freq: 58, noiseMix: 0.08, lowPass: 140, resonance: 1.3, gain: 0.075, seed: 60441 }),
          ],
        },
      },
    ],
  },
  // === STATION / SPEND (a0-60) ==============================================
  //
  // Ore leaving your hold and coming back as structure. The register is
  // *assembly*, not reward — §7.3's own line for `buildPlaced` is "a latch, not a
  // fanfare", and it generalises across the family. That line is also the whole
  // of what went wrong with the denied set in one phrase: a fanfare is the retro
  // idiom, and a shop floor is the modern one. Four machines:
  //
  //   d  **stepper drive** — an electric actuator moving in steps. Fine grain,
  //      dry, no ring anywhere; the sound of a mechanism doing its travel.
  //   e  **vacuum seat** — suction taking up, then the weight coming to rest.
  //      Low, pneumatic, the only offers with mass under them.
  //   f  **induction weld** — a band heated and then quenched. Metal, but metal
  //      that is *stopped*: the ring is cut off rather than left to decay out.
  //   g  **plain confirmation** — the restrained one. One damped contact that
  //      means "it worked" and adds no commentary. The answer to "too toony"
  //      that is simply less sound.
  //
  // §8's `buildComplete` / `purchaseConfirm` watch runs through here: those two
  // fire seconds apart off one wheel press. This family stays *low and seated* —
  // an assembly finishing — where the interface family's confirmations stay short
  // and narrow. With four offers each that is sixteen pairings rather than one, so
  // the margin is held on the whole set: `buildComplete` tops out at 468 Hz of
  // centroid proxy (d 468 · e 380 · f 350 · g 305) and `purchaseConfirm` bottoms
  // out at 624 (d 1784 · e 624 · f 1397 · g 1813) — worst pairing ×1.33, against
  // the ×1.23 the census measured on the pair that ships today.
  // ---------------------------------------------------------------------------
  // ROUND 2 (a0-67, 2026-08-17)
  // ---------------------------------------------------------------------------
  //
  //   *"none of these sound like a build started"*
  //
  // Six words, and the operative one is **started**. Read the four denied
  // characters back: *stepper travel into a stop* · *vacuum taking up, weight
  // resting* · *weld struck and quenched* · *one latch, and that is all*. Every
  // one of them ENDS. They were written to this slot's own standing note — *"a
  // latch, never a fanfare"* (§7.3) — and they execute it perfectly, which is how
  // four correct sounds can all be the wrong sound: a latch is a **terminating**
  // gesture, and this slot fires at the moment a turret starts building, not at
  // the moment it finishes. The sweep gave the developer four `buildComplete`s.
  //
  // So the shape changes, and it is a shape change rather than a material one:
  // **every take below opens.** Something engages, and then something is
  // audibly still running when the cue ends — a bed at level, a texture
  // repeating, a corner that has moved up and stayed. The latch is still there;
  // it is now the *first* half instead of the last.
  //
  // That also repairs a §8 pair the old set had blurred. `buildPlaced` and
  // `buildComplete` are the two ends of one build, seconds apart on the same
  // structure, and both families were seating and stopping. Now the grammar is
  // one word long and audible without a manual: **placed opens, complete
  // seats.** `./candidates.test.ts` holds the first half as a number — the last
  // third of every `buildPlaced` offer is louder than its own first third, where
  // the shipped voice measures 0.02.
  //
  // The second half is **not** asserted, and the reason is on the record rather
  // than in a test: `buildComplete` was not denied this round, so its four
  // offers carry no verdict and this brief may not touch them (re-voicing
  // un-judged work destroys a review instead of doing one — the a0-48 rule).
  // Three of them seat, at 0.31 / 0.40 / 0.06. **`f` — "two welds, the second
  // holding" — opens, at 1.43.** So if the developer adopts one of the four
  // below *and* `buildComplete/f`, the two ends of one build are the same
  // gesture and want hearing as a pair. That is a note for the board, not a
  // failure for a lane that did nothing wrong.
  //
  //   h  **fabricator** — the clamp bites and a drive spins up behind it.
  //   i  **hydraulics** — pressure taking, and the line still under load.
  //   j  **printer** — a seat, then the head working, plainly repetitive.
  //   k  **power routed** — one contact, and a bus coming up to level.
  buildPlaced: {
    label: "Build Placed",
    context: "A turret/build is placed and starts building — ore spent, a latch not a fanfare.",
    current: 'buildPlaced',
    candidates: [
      {
        id: 'h',
        slot: 'buildPlaced',
        character: "clamp bites, a drive spins up",
        spec: {
          name: 'buildPlaced_h_fabricator',
          layers: [
            band('buildPlaced_h.clamp', 380, { gain: 0.42, decay: 0.05, q: 4.5, curve: 6, punch: 0.45, seed: 60570 }),
            // The corner travels UP and the level rises into the tail: the drive
            // is at speed when the cue stops, which is the whole word "started".
            swept('buildPlaced_h.drive', { wave: 'triangle', freq: 124, from: 260, to: 1150, q: 3.4, gain: 0.3, attack: 0.09, hold: 0.16, decay: 0.1, curve: 1.6, noiseMix: 0.2, at: 0.03, seed: 60572 }),
            grains('buildPlaced_h.rotor', { freq: 320, grain: 0.0075, gain: 0.14, attack: 0.06, hold: 0.14, decay: 0.09, curve: 1.8, from: 700, to: 1400, q: 2.4, hp: 150, at: 0.05, seed: 60574 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'buildPlaced',
        character: "pressure takes, the line still loaded",
        spec: {
          name: 'buildPlaced_i_hydraulics',
          layers: [
            swept('buildPlaced_i.seat', { wave: 'noise', freq: 280, from: 1300, to: 420, q: 2.8, gain: 0.15, attack: 0.003, hold: 0.018, decay: 0.07, curve: 3.6, seed: 60580 }),
            swept('buildPlaced_i.load', { wave: 'sine', freq: 82, freqEnd: 98, from: 200, to: 620, q: 2.4, gain: 0.38, attack: 0.07, hold: 0.29, decay: 0.06, curve: 1.5, noiseMix: 0.1, at: 0.04, seed: 60582 }),
            band('buildPlaced_i.hiss', 900, { gain: 0.34, decay: 0.07, q: 2.6, curve: 1.8, attack: 0.1, hold: 0.24, hp: 400, at: 0.06, seed: 60584 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'buildPlaced',
        character: "it seats, then the head starts working",
        spec: {
          name: 'buildPlaced_j_printer',
          layers: [
            band('buildPlaced_j.seat', 300, { gain: 0.4, decay: 0.055, q: 4, curve: 6, punch: 0.4, seed: 60590 }),
            // 11 ms between grains is a rate the ear reads as *work being done*
            // rather than as a texture — the one take where "started" is carried
            // by rhythm instead of by level.
            grains('buildPlaced_j.head', { freq: 540, grain: 0.011, gain: 0.26, attack: 0.05, hold: 0.19, decay: 0.09, curve: 1.6, from: 900, to: 2000, q: 3.2, hp: 240, at: 0.045, seed: 60592 }),
            swept('buildPlaced_j.bed', { wave: 'triangle', freq: 98, from: 220, to: 480, q: 2.2, gain: 0.18, attack: 0.08, hold: 0.18, decay: 0.1, curve: 1.6, noiseMix: 0.14, at: 0.045, seed: 60594 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'buildPlaced',
        character: "one contact, and a bus comes up",
        spec: {
          name: 'buildPlaced_k_powerRouted',
          layers: [
            band('buildPlaced_k.contact', 620, { gain: 0.52, decay: 0.035, q: 5, curve: 7, punch: 0.5, seed: 60600 }),
            // The restrained one: nothing is machined, a supply simply arrives and
            // is still there. It is the offer to pick if "started" should be one
            // word rather than a sentence.
            swept('buildPlaced_k.bus', { wave: 'sine', freq: 110, from: 180, to: 700, q: 2.6, gain: 0.3, attack: 0.11, hold: 0.2, decay: 0.09, curve: 1.4, noiseMix: 0.07, at: 0.025, seed: 60602 }),
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
        id: 'd',
        character: "three stepper contacts, rising, dry",
        spec: {
          name: 'buildComplete_d_stepperRun',
          layers: [
            grains('buildComplete_d.s0', { freq: 260, grain: 0.005, gain: 0.3, hold: 0.008, decay: 0.05, curve: 5, from: 700, to: 300, q: 3, hp: 110, seed: 60570 }),
            grains('buildComplete_d.s1', { freq: 300, grain: 0.005, gain: 0.32, hold: 0.008, decay: 0.055, curve: 5, from: 700, to: 320, q: 3, hp: 120, at: 0.075, seed: 60572 }),
            grains('buildComplete_d.s2', { freq: 415, grain: 0.0048, gain: 0.34, hold: 0.012, decay: 0.1, curve: 4.5, from: 820, to: 380, q: 3.2, hp: 120, at: 0.15, seed: 60574 }),
          ],
        },
      },
      {
        id: 'e',
        character: "system coming up to pressure",
        spec: {
          name: 'buildComplete_e_upToPressure',
          layers: [
            swept('buildComplete_e.rise', { wave: 'noise', freq: 220, freqEnd: 300, from: 380, to: 1500, q: 3, gain: 0.3, attack: 0.03, hold: 0.08, decay: 0.06, curve: 2.4, seed: 60580 }),
            swept('buildComplete_e.seat', { wave: 'sine', freq: 104, freqEnd: 88, from: 300, to: 140, q: 2.4, gain: 0.42, attack: 0.003, hold: 0.024, decay: 0.2, curve: 3.2, punch: 0.5, noiseMix: 0.12, at: 0.17, seed: 60582 }),
          ],
        },
      },
      {
        id: 'f',
        character: "two welds, the second holding",
        spec: {
          name: 'buildComplete_f_twoWelds',
          layers: [
            band('buildComplete_f.w0', 660, { gain: 0.6, decay: 0.06, q: 8, curve: 5.5, punch: 0.4, seed: 60590 }),
            band('buildComplete_f.w1', 880, { gain: 0.64, decay: 0.16, q: 9.5, curve: 4.5, punch: 0.35, at: 0.13, seed: 60592 }),
            swept('buildComplete_f.hold', { wave: 'triangle', freq: 220, from: 620, to: 300, q: 4, gain: 0.22, attack: 0.006, hold: 0.03, decay: 0.16, curve: 3, noiseMix: 0.2, at: 0.13, seed: 60594 }),
          ],
        },
      },
      {
        id: 'g',
        character: "done: one seated contact",
        spec: {
          name: 'buildComplete_g_done',
          layers: [
            swept('buildComplete_g.done', { wave: 'triangle', freq: 300, from: 900, to: 380, q: 4.2, gain: 0.38, attack: 0.004, hold: 0.03, decay: 0.13, curve: 3.6, punch: 0.35, noiseMix: 0.18, seed: 60600 }),
          ],
        },
      },
    ],
  },
  repairTick: {
    label: "Repair Tick",
    context: "A soft tick as a repair purchase is applied to a structure.",
    current: 'repairTick',
    candidates: [
      {
        id: 'd',
        character: "stepper pip, one small travel",
        spec: {
          name: 'repairTick_d_stepperPip',
          layers: [
            grains('repairTick_d.step', { freq: 520, grain: 0.003, gain: 0.24, hold: 0.004, decay: 0.035, curve: 5.5, from: 1500, to: 620, q: 3, hp: 240, seed: 60610 }),
          ],
        },
      },
      {
        id: 'e',
        character: "sealant taking, low and short",
        spec: {
          name: 'repairTick_e_sealantTake',
          layers: [
            swept('repairTick_e.take', { wave: 'sine', freq: 176, from: 520, to: 220, q: 2.6, gain: 0.26, attack: 0.002, hold: 0.006, decay: 0.05, curve: 4.5, noiseMix: 0.16, seed: 60620 }),
          ],
        },
      },
      {
        id: 'f',
        character: "spot weld, quenched at once",
        spec: {
          name: 'repairTick_f_spotWeld',
          layers: [
            band('repairTick_f.spot', 760, { gain: 1, decay: 0.04, q: 4.5, curve: 6, punch: 0.35, seed: 60630 }),
          ],
        },
      },
      {
        id: 'g',
        character: "the quietest tick that still reads",
        spec: {
          name: 'repairTick_g_quietest',
          layers: [
            band('repairTick_g.tick', 440, { gain: 0.9, decay: 0.028, q: 3.2, curve: 7, seed: 60640 }),
          ],
        },
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // ROUND 2 (a0-67, 2026-08-17) — GENERATE AROUND THE INCUMBENT
  // ---------------------------------------------------------------------------
  //
  //   *"i like the current and none of the new generations, they should some more
  //   like money related"*
  //
  // Two instructions, and the first one changes what kind of round this is. **The
  // shipped sound is the reference, not the reject.** Round one replaced it with
  // four machines — a conveyor stop, a vault seating, two falling bands, a filing
  // — which is what a slot under a `deny-all` deserves and is not what this one is
  // asking for. Starting over here would throw away the only thing on the board
  // the developer has said they like.
  //
  // So all three new takes are built on the incumbent's own material and gesture,
  // and the incumbent itself is on the board as `k` so the A/B is playable:
  //
  //  - **Kept: the material.** Struck glass, the ratified Gantry/Bone partials —
  //    the same {@link glass} the main menu and the shipped `bankOre` are made of.
  //  - **Kept: the gesture.** Two notes, the second lower and later. A deposit
  //    lands and settles; it does not rise, because rising is a purchase (§8's
  //    `bankOre` / `purchaseConfirm` pair).
  //  - **Changed: what "money" is made of.** Ore banked is a *transaction*, and a
  //    transaction sounds like counting: many small metal contacts, a total
  //    arriving, a drawer taking it. That is the one thing the incumbent's two
  //    clean notes do not have, and it is what each take below adds.
  //
  //   h  **coins under the notes** — the incumbent, with a scatter of small metal
  //      landing beneath it. The nearest thing to *"the current, but money"*.
  //   i  **counted and accepted** — three quick pips and a drawer taking them:
  //      the transaction rather than the deposit.
  //   j  **into the tray** — the second note lands in a mass of loose metal.
  //      The most literal, and the one with the most of it.
  //   k  **the sound that ships today**, for the A/B.
  bankOre: {
    label: "Bank Ore",
    context: "Ore is deposited into your station's store.",
    current: 'bankOre',
    candidates: [
      {
        id: 'h',
        slot: 'bankOre',
        character: "the two notes, with coins under them",
        spec: {
          name: 'bankOre_h_coinsUnder',
          layers: [
            ...glass('bankOre_h.drop', 880, { gain: 0.22, decay: 0.17, seed: 30550 }),
            ...glass('bankOre_h.settle', 587.33, { gain: 0.18, decay: 0.28, at: 0.08, partials: GLASS_PAIR, seed: 30554 }),
            // The money. Small, bright, uneven — a rate rather than a pitch, so it
            // never argues with the two notes it is sitting under.
            grains('bankOre_h.coins', { freq: 2600, freqEnd: 1900, grain: 0.0075, gain: 0.15, hold: 0.03, decay: 0.2, curve: 3.2, from: 5200, to: 2200, q: 3, hp: 1300, at: 0.03, seed: 30558 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'bankOre',
        character: "counted, then the drawer takes it",
        spec: {
          name: 'bankOre_i_countedAndAccepted',
          layers: [
            // Three pips at one pitch, not three rising — a count is a repetition,
            // and a rise here would collide with `purchaseConfirm` (§8).
            ...glass('bankOre_i.c0', 1046.5, { gain: 0.14, decay: 0.05, partials: GLASS_PAIR, contact: 0.6, seed: 30560 }),
            ...glass('bankOre_i.c1', 1046.5, { gain: 0.14, decay: 0.05, partials: GLASS_PAIR, contact: 0.6, at: 0.055, seed: 30564 }),
            ...glass('bankOre_i.c2', 1046.5, { gain: 0.14, decay: 0.06, partials: GLASS_PAIR, contact: 0.6, at: 0.11, seed: 30568 }),
            ...glass('bankOre_i.total', 587.33, { gain: 0.2, decay: 0.26, at: 0.19, seed: 30572 }),
            swept('bankOre_i.drawer', { wave: 'noise', freq: 300, from: 900, to: 320, q: 2.4, gain: 0.16, attack: 0.004, hold: 0.02, decay: 0.12, curve: 3.4, at: 0.19, seed: 30576 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'bankOre',
        character: "the second note lands in the tray",
        spec: {
          name: 'bankOre_j_intoTheTray',
          layers: [
            ...glass('bankOre_j.drop', 880, { gain: 0.185, decay: 0.14, partials: GLASS_PAIR, seed: 30580 }),
            grains('bankOre_j.tray', { freq: 1800, freqEnd: 1150, grain: 0.0045, gain: 0.22, hold: 0.02, decay: 0.24, curve: 2.8, from: 4200, to: 1400, q: 3.2, hp: 800, at: 0.08, seed: 30584 }),
            ...glass('bankOre_j.settle', 587.33, { gain: 0.17, decay: 0.3, at: 0.08, partials: GLASS_PAIR, contact: 0.5, seed: 30586 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'bankOre',
        anchor: true,
        character: "the sound that ships today (A/B)",
        spec: incumbent('bankOre', 'k'),
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // ROUND 2 (a0-67, 2026-08-17) — GENERATE AROUND THE INCUMBENT
  // ---------------------------------------------------------------------------
  //
  //   *"i like current but i want to hear new optinos that are more like it but
  //   also more subtle"*
  //
  // The clearest brief on the whole board: keep the sound, take it down. So this
  // is one axis with three points on it, and the incumbent is the fourth.
  //
  // What the incumbent is, and what is held: **three struck glass notes rising an
  // A-minor triad** — C6, E6, A6, 80 ms apart, the key the soundtrack and the
  // ambient bed already sit in. Minor rather than major on purpose (`./bank`: *"a
  // machine acknowledging a spend, not a game cheering"*). Every take below keeps
  // that material, that key and that direction. None of them is a new idea,
  // because a new idea was not asked for.
  //
  // "More subtle" is spent in three different places, one per take, so the
  // developer can hear WHICH kind of quieter they meant:
  //
  //   h  **thinner** — the same three notes, two partials each instead of three
  //      on the last, less contact edge, shorter tails. Same phrase, less of it.
  //   i  **fewer** — two notes instead of three, C6 and G6. The triad is implied
  //      by the fifth rather than spelled out; subtlety by omission.
  //   j  **receding** — the same three notes with the level falling across the
  //      phrase instead of rising into the top one, so the cue walks away rather
  //      than arriving. The most changed of the three, and still the same notes.
  //   k  **the sound that ships today**, for the A/B.
  //
  // §8's `upgradeBought` / `pressTick` pair is watched by `./audio.test.ts`, and
  // taking this slot quieter walks toward it — so every take stays above the
  // shipped press tick in level, which is the margin that keeps *you bought
  // something* apart from *you touched something*.
  upgradeBought: {
    label: "Upgrade Bought",
    context: "An upgrade is purchased from the wheel.",
    current: 'upgradeBought',
    candidates: [
      {
        id: 'h',
        slot: 'upgradeBought',
        character: "the same three notes, thinner",
        spec: {
          name: 'upgradeBought_h_thinner',
          layers: [
            ...glass('upgradeBought_h.a', 1046.5, { gain: 0.15, decay: 0.2, partials: GLASS_PAIR, contact: 0.6, seed: 30600 }),
            ...glass('upgradeBought_h.b', 1318.51, { gain: 0.15, decay: 0.2, partials: GLASS_PAIR, contact: 0.6, at: 0.08, seed: 30604 }),
            ...glass('upgradeBought_h.c', 1760, { gain: 0.16, decay: 0.3, partials: GLASS_PAIR, contact: 0.6, at: 0.16, seed: 30608 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'upgradeBought',
        character: "two notes, the triad implied",
        spec: {
          name: 'upgradeBought_i_twoNotes',
          layers: [
            ...glass('upgradeBought_i.a', 1046.5, { gain: 0.17, decay: 0.22, partials: GLASS_PAIR, contact: 0.7, seed: 30620 }),
            ...glass('upgradeBought_i.b', 1568, { gain: 0.18, decay: 0.34, contact: 0.7, at: 0.1, seed: 30624 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'upgradeBought',
        character: "the three notes, receding",
        spec: {
          name: 'upgradeBought_j_receding',
          layers: [
            ...glass('upgradeBought_j.a', 1046.5, { gain: 0.19, decay: 0.2, partials: GLASS_PAIR, seed: 30640 }),
            ...glass('upgradeBought_j.b', 1318.51, { gain: 0.13, decay: 0.2, partials: GLASS_PAIR, contact: 0.6, at: 0.08, seed: 30644 }),
            // The top note is the quietest thing in the cue rather than the
            // loudest. Same phrase, walking away from you.
            ...glass('upgradeBought_j.c', 1760, { gain: 0.085, decay: 0.3, partials: GLASS_PAIR, contact: 0.3, at: 0.16, seed: 30648 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'upgradeBought',
        anchor: true,
        character: "the sound that ships today (A/B)",
        spec: incumbent('upgradeBought', 'k'),
      },
    ],
  },
  // === THE CLOCK, AND THE ONE SERIOUS THING (a0-60) =========================
  //
  // The match's own metronome — the wave, the collapse, the end — plus the two
  // sounds §4.7 protects. At the scale of a station, "modern/sci-fi" is mostly a
  // question of what the seriousness is made of: the denied set reached for
  // volume and for tone, and this one reaches for **mass and air**. The four:
  //
  //   d  **tectonic** — weight shifting. Sub-range bodies and slow grain; the
  //      offers you feel through a desk rather than hear on a phone.
  //   e  **atmosphere** — pressure moving through structure. Broadband, filtered,
  //      no pitch centre to hum back.
  //   f  **resonant hull** — narrow bands inside something enormous, with the
  //      room it happened in written as late layers.
  //   g  **stated once** — the restrained one: the event announced with the least
  //      material that still carries it, and nothing after.
  //
  // Two fences run through this family and neither is negotiable:
  //
  //  - **`alarm` keeps its `saw`.** §5.1 sanctions it by name and §2.2 makes an
  //    unmistakable alarm a *mechanic*: legibility outranks register. All four
  //    offers keep the saw and the rising minor third; what differs is the body
  //    around it. They are also **one-shots**, matching the shipped bank — s9-01
  //    made the alarm sound once per engagement, and the looping offers that used
  //    to sit here were an A/B against a sound the game stopped making.
  //  - **`stationDeath` is protected** (§7.4: *"any change here is a developer
  //    question, not a re-voice"*), and it is the one slot this sweep re-voices
  //    LAST and by translation rather than replacement — a0-55 was moving its
  //    routing while the sweep started. Its offers are the same beat whatever
  //    letter they wear: a long fall that does not resolve, nothing bright
  //    anywhere in it, and the mix going to zero underneath. None runs past the
  //    shipped 1.32 s longest-tail invariant.
  waveArrive: {
    label: "Wave Arrive",
    context: "An asteroid wave arrives, field closes in — two low foghorn notes.",
    current: 'waveArrive',
    candidates: [
      // §7.4: *"keep the two low notes and the pitch — the foghorn is the
      // mechanic"* (§2.3's metronome). All four sound 147 Hz then 220 Hz, the
      // shipped fifth, at the shipped 0.18 s apart. §8 also guards this against
      // `alarm`, which sits an octave and a half above at 494/587 — no offer here
      // reaches up into it.
      {
        id: 'd',
        character: "two horns with tectonic weight under them",
        spec: {
          name: 'waveArrive_d_tectonicHorn',
          layers: [
            swept('waveArrive_d.h0', { wave: 'triangle', freq: 147, from: 300, to: 620, q: 4, gain: 0.4, attack: 0.03, hold: 0.2, decay: 0.3, curve: 2.2, noiseMix: 0.12, seed: 60930 }),
            swept('waveArrive_d.h1', { wave: 'triangle', freq: 220, from: 900, to: 380, q: 3.8, gain: 0.34, attack: 0.03, hold: 0.18, decay: 0.4, curve: 2.2, noiseMix: 0.1, at: 0.18, seed: 60932 }),
            swept('waveArrive_d.mass', { wave: 'sine', freq: 49, from: 150, q: 1.5, gain: 0.3, attack: 0.06, hold: 0.3, decay: 0.4, curve: 1.8, at: 0.01, seed: 60934 }),
          ],
        },
      },
      {
        id: 'e',
        character: "two air-driven horns, no tone edge",
        spec: {
          name: 'waveArrive_e_airDriven',
          layers: [
            grains('waveArrive_e.h0', { freq: 147, freqEnd: 147.6, grain: 0.017, gain: 0.34, attack: 0.025, hold: 0.2, decay: 0.28, curve: 2.4, from: 420, to: 760, q: 3.4, seed: 60940 }),
            grains('waveArrive_e.h1', { freq: 220, freqEnd: 220.8, grain: 0.013, gain: 0.28, attack: 0.025, hold: 0.18, decay: 0.38, curve: 2.2, from: 1100, to: 520, q: 3.2, at: 0.18, seed: 60942 }),
          ],
        },
      },
      {
        id: 'f',
        character: "two bands inside a hull, room behind",
        spec: {
          name: 'waveArrive_f_hullBands',
          layers: [
            band('waveArrive_f.h0', 147, { gain: 1.0, decay: 0.34, q: 9, curve: 2.6, attack: 0.03, hold: 0.16, seed: 60950 }),
            band('waveArrive_f.h1', 220, { gain: 1.0, decay: 0.42, q: 9.5, curve: 2.4, attack: 0.03, hold: 0.14, at: 0.18, seed: 60952 }),
            ...returns('waveArrive_f.room', { freq: 260, gain: 0.42, decay: 0.34, from: 700, to: 240, at: 0.4, gap: 0.2, count: 2, seed: 60954 }),
          ],
        },
      },
      {
        id: 'g',
        character: "the two notes, and nothing else",
        spec: {
          name: 'waveArrive_g_twoNotes',
          layers: [
            swept('waveArrive_g.h0', { wave: 'sine', freq: 147, from: 260, to: 380, q: 2.4, gain: 0.44, attack: 0.04, hold: 0.18, decay: 0.26, curve: 2.4, noiseMix: 0.06, seed: 60960 }),
            swept('waveArrive_g.h1', { wave: 'sine', freq: 220, from: 520, to: 300, q: 2.4, gain: 0.4, attack: 0.04, hold: 0.16, decay: 0.36, curve: 2.4, noiseMix: 0.06, at: 0.18, seed: 60962 }),
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
        id: 'd',
        character: "tectonic shift, weight moving slowly",
        spec: {
          name: 'collapseBegin_d_tectonicShift',
          layers: [
            swept('collapseBegin_d.shift', { wave: 'sine', freq: 54, freqEnd: 38, from: 150, to: 80, q: 1.6, gain: 0.42, attack: 0.5, hold: 0.6, decay: 1.3, curve: 1.3, noiseMix: 0.08, seed: 60970 }),
            grains('collapseBegin_d.grind', { freq: 130, freqEnd: 70, grain: 0.017, gain: 0.32, attack: 0.4, hold: 0.5, decay: 1.3, curve: 1.5, from: 520, to: 170, q: 2.4, seed: 60972 }),
          ],
        },
      },
      {
        id: 'e',
        character: "atmosphere leaving, a long draw",
        spec: {
          name: 'collapseBegin_e_atmosphereDraw',
          layers: [
            swept('collapseBegin_e.draw', { wave: 'noise', freq: 240, freqEnd: 90, from: 900, to: 190, q: 2.4, gain: 0.46, attack: 0.45, hold: 0.5, decay: 1.4, curve: 1.4, seed: 60980 }),
            grains('collapseBegin_e.dust', { freq: 520, freqEnd: 220, grain: 0.011, gain: 0.22, attack: 0.6, hold: 0.5, decay: 1.2, curve: 1.4, from: 1900, to: 520, q: 2.6, hp: 200, at: 0.25, seed: 60982 }),
          ],
        },
      },
      {
        id: 'f',
        character: "the hull resonating, strain rising",
        spec: {
          name: 'collapseBegin_f_hullStrain',
          layers: [
            swept('collapseBegin_f.strain', { wave: 'noise', freq: 190, freqEnd: 128, from: 320, to: 1300, q: 8.5, gain: 0.48, attack: 0.5, hold: 0.5, decay: 1.3, curve: 1.4, seed: 60990 }),
            swept('collapseBegin_f.body', { wave: 'triangle', freq: 73, freqEnd: 58, from: 230, to: 120, q: 2.6, gain: 0.32, attack: 0.55, hold: 0.6, decay: 1.2, curve: 1.3, noiseMix: 0.14, seed: 60992 }),
          ],
        },
      },
      {
        id: 'g',
        character: "one long fall, nothing added",
        spec: {
          name: 'collapseBegin_g_oneFall',
          layers: [
            swept('collapseBegin_g.fall', { wave: 'triangle', freq: 98, freqEnd: 44, from: 420, to: 110, q: 3, gain: 0.696, attack: 0.5, hold: 0.7, decay: 1.4, curve: 1.4, noiseMix: 0.16, seed: 61000 }),
          ],
        },
      },
    ],
  },
  stationDeath: {
    // ROUND 2 (a0-67, 2026-08-17) — *"they should sound like an explosion"*
    //
    // The round-one four were deliberately **not** a design: this is the most
    // serious sound in the game, §7.4 makes any change here a developer question
    // rather than a lane's re-voice, and a0-55 was moving its routing while the
    // sweep ran. So the sweep offered the SHIPPED beat in four materials — a
    // fall, a crust, a toll, and the fall alone — and the choice on the board was
    // *how much of it there is*. That was the careful reading, and it produced
    // four takes of a station **sinking**.
    //
    // The developer has now answered the question §7.4 said to ask, in seven
    // words: a station death is an **explosion**. That is a ruling, not a note on
    // execution, and it is the one thing the round-one set could not have been
    // tuned into — you cannot tune a fall into a blast, because a fall has no
    // front on it.
    //
    // **What an explosion is here, and what it is not.** It is a *station* dying,
    // not a firework: the energy is enormous and slow, and §7.2's rule for
    // `shipExplode` — no sparkle layer, ever — applies harder rather than less.
    // So every take below is built as three stages that all four share, and
    // differ in which stage carries the weight:
    //
    //   1. **A front.** Something arrives in under 20 ms. This is the whole thing
    //      round one did not have.
    //   2. **A body.** Low, broad, and long — the mass of the thing going.
    //   3. **A room.** Late, dark returns. A blast this size is heard twice.
    //
    //   h  **detonation** — the front carries it: a hard blast edge, then body.
    //   i  **breach** — the body carries it: a crack, then everything leaving at
    //      once, a roar that thins rather than falls.
    //   j  **blast into collapse** — the explosion, and then the shipped fall
    //      underneath it as its *consequence*. The bridge between the two rounds,
    //      and the one to pick if the answer is "both".
    //   k  **one concussion** — a single deep hit and the room it happened in.
    //      The restrained one; the quiet three seconds start earliest here.
    //
    // Three things do not move, because the developer did not move them:
    //
    //  - **The 1.32 s longest-tail invariant (§8).** The three seconds of near
    //    silence (§4.7) begin when this stops, and a longer tail eats them. Every
    //    offer ends inside it, which is why none of these has a debris shower —
    //    debris is what makes a film explosion long, and this one may not be.
    //  - **Nothing sparkles.** An explosion made of bright shards is a firework
    //    and this is the beat the game goes quiet for.
    //  - **It stays the longest and the heaviest thing in the bank**, clear of
    //    `shipExplode` (a ship, half the length, and allowed its top end).
    label: "MiningStation Death",
    context: "A station dies (GDD §4.7) — the most serious sound in the game; then three seconds of silence.",
    current: 'stationDeath',
    candidates: [
      {
        id: 'h',
        slot: 'stationDeath',
        character: "detonation: a blast front, then the mass",
        spec: {
          name: 'stationDeath_h_detonation',
          layers: [
            // The front. 6 ms of broadband, high-passed so it does not eat the
            // body's register, and steep enough to be an edge rather than a note.
            place({ name: 'stationDeath_h.front', wave: 'noise', attack: 0.0004, hold: 0.004, decay: 0.075, decayCurve: 7, punch: 0.9, freq: 900, lowPass: 4200, lowPassEnd: 700, resonance: 1.4, highPass: 260, gain: 0.44, seed: 61380 }),
            swept('stationDeath_h.body', { wave: 'sine', freq: 96, freqEnd: 33, from: 480, to: 78, q: 1.8, gain: 0.46, attack: 0.008, hold: 0.22, decay: 1.02, curve: 1.5, punch: 0.5, noiseMix: 0.07, seed: 61382 }),
            swept('stationDeath_h.debris', { wave: 'noise', freq: 210, freqEnd: 60, from: 1100, to: 150, q: 2.2, gain: 0.24, attack: 0.02, hold: 0.24, decay: 0.86, curve: 1.4, at: 0.03, seed: 61384 }),
            ...returns('stationDeath_h.room', { freq: 180, gain: 0.16, decay: 0.4, from: 420, to: 130, at: 0.3, gap: 0.28, count: 2, seed: 61386 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'stationDeath',
        character: "breach: a crack, then everything leaving",
        spec: {
          name: 'stationDeath_i_breach',
          layers: [
            band('stationDeath_i.crack', 640, { gain: 0.6, decay: 0.09, q: 3.6, curve: 6.5, punch: 0.8, hp: 220, seed: 61390 }),
            // The roar THINS rather than falls: the corner closes while the pitch
            // stands still, which is a compartment emptying. A fall here would be
            // round one's gesture wearing a new letter.
            swept('stationDeath_i.roar', { wave: 'noise', freq: 150, from: 1600, to: 120, q: 2, gain: 0.5, attack: 0.012, hold: 0.3, decay: 1.0, curve: 1.35, at: 0.006, seed: 61392 }),
            swept('stationDeath_i.mass', { wave: 'sine', freq: 62, freqEnd: 29, from: 200, to: 62, q: 1.6, gain: 0.34, attack: 0.02, hold: 0.26, decay: 1.0, curve: 1.5, seed: 61394 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'stationDeath',
        character: "blast, and then the structure falls",
        spec: {
          name: 'stationDeath_j_blastIntoCollapse',
          layers: [
            place({ name: 'stationDeath_j.blast', wave: 'noise', attack: 0.0006, hold: 0.006, decay: 0.11, decayCurve: 6, punch: 0.85, freq: 700, lowPass: 3400, lowPassEnd: 500, resonance: 1.6, highPass: 180, gain: 0.46, seed: 61400 }),
            // The shipped fall, kept — it is what the developer has been hearing
            // for a fortnight and nothing said to remove it. It is now the second
            // half rather than the whole sound: the station goes, and THEN it
            // comes down.
            swept('stationDeath_j.fall', { wave: 'sine', freq: 205, freqEnd: 34, from: 620, to: 90, q: 1.8, gain: 0.44, attack: 0.01, hold: 0.18, decay: 1.0, curve: 1.5, noiseMix: 0.05, at: 0.09, seed: 61402 }),
            swept('stationDeath_j.crust', { wave: 'noise', freq: 175, freqEnd: 46, from: 820, to: 140, q: 2, gain: 0.27, attack: 0.03, hold: 0.26, decay: 0.9, curve: 1.4, at: 0.11, seed: 61404 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'stationDeath',
        character: "one concussion, and the room",
        spec: {
          name: 'stationDeath_k_concussion',
          layers: [
            swept('stationDeath_k.hit', { wave: 'sine', freq: 78, freqEnd: 27, from: 620, to: 60, q: 2.2, gain: 0.56, attack: 0.003, hold: 0.16, decay: 0.92, curve: 1.6, punch: 0.9, noiseMix: 0.1, seed: 61410 }),
            ...returns('stationDeath_k.room', { freq: 150, gain: 0.2, decay: 0.44, from: 380, to: 110, at: 0.26, gap: 0.3, count: 2, seed: 61412 }),
          ],
        },
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // THE TWO STINGS (a0-68, 2026-08-17)
  // ---------------------------------------------------------------------------
  //
  //   *"none of these sound like match end and we need separate ones for winning
  //   and losing"*
  //
  // `matchEnd` is not on this board any more, for the same reason `shotImpact`
  // is not: the slot was wrong, so a fifth set of takes against it would have
  // been denied as fairly as the fourth. One cue played whether you had just won
  // or just lost, at the one moment in a match the game must not be ambiguous.
  //
  // ## The other half of why the denied four could not win
  //
  // A match resolves the tick the last opposing core dies, so the `matchEnd` tell
  // arrived in the same frame as `stationDeath` and the three-second quiet
  // (GDD §4.7) started underneath it. The cue began at full level into a mix that
  // reached zero 0.12 s later. Every one of the four denied takes is longer than
  // a second; the developer heard the first tenth of each. *"None of these sound
  // like match end"* was a fair thing to say about four sounds nobody had played.
  //
  // `./engine` now HOLDS the outcome and lands it on the far side of the quiet —
  // the silence is a ratified design element and it is protected here rather than
  // punched through. See `docs/sound-structural-notes.md` §2.
  //
  // ## Where these sit against `musicWin` / `musicLoss`
  //
  // There are two win/loss pairs in the bank and they are not competing:
  //
  //   THESE (SFX bus)          the VERDICT — short, dry, first, and the one a
  //                            player with the music slider at zero still hears
  //   musicWin/musicLoss       the READING — longer, on the music bus, arriving
  //   (music bus)              STING_LEAD_S after, and re-voiced in a0-67
  //
  // So every offer below is under 0.8 s. A sting that ran as long as the music
  // cue would collide with it however the two were scheduled, and the sequence
  // would read as two pieces of music starting near each other instead of as a
  // verdict and its answer.
  //
  // ## The letters pair ACROSS the two slots, and that is a property
  //
  // `matchWin/a` and `matchLoss/a` are the same gesture inverted; so are `b`/`b`,
  // `c`/`c`, `d`/`d`. Adopt any letter for the win and any letter for the loss and
  // the two still contrast — but adopting the SAME letter for both gets a matched
  // pair, which is the version that reads as one game. `./candidates.test.ts`
  // holds the four pairings to a measured contrast so this cannot quietly rot.
  //
  //   a  **direction** — two notes, a fifth apart. The plainest possible statement.
  //   b  **the room** — a chord opening upward, or closing downward.
  //   c  **pressure** — no melody at all: a corner opening, or shutting.
  //   d  **the stamp** — one struck note and nothing after it. The shortest "it's over".

  matchWin: {
    label: "Match End — Win",
    context: "You won. Lands AFTER the three seconds of quiet, ahead of the music sting. Arrival, never a fanfare.",
    current: 'matchWin',
    candidates: [
      {
        id: 'a',
        slot: 'matchWin',
        character: "direction: two notes rising a fifth",
        spec: {
          name: 'matchWin_a_rise',
          layers: [
            place({ name: 'matchWin_a.n0', wave: 'triangle', attack: 0.004, hold: 0.03, decay: 0.2, decayCurve: 3.4, freq: 220, noiseMix: 0.07, lowPass: 1400, resonance: 2.6, gain: 0.42, seed: 68500 }),
            place({ name: 'matchWin_a.n1', wave: 'triangle', attack: 0.004, hold: 0.05, decay: 0.4, decayCurve: 3.2, freq: 329.63, noiseMix: 0.07, lowPass: 2100, resonance: 2.6, gain: 0.42, seed: 68502 }, 0.11),
          ],
        },
      },
      {
        id: 'b',
        slot: 'matchWin',
        character: "the room: a chord opening upward",
        spec: {
          name: 'matchWin_b_roomOpens',
          layers: [
            // Three pitches at once rather than in sequence — a0-67's register
            // note for the music family is *harmony before texture*, and it
            // applies here for the same reason: a chord is one event, and a
            // verdict has to be one event.
            place({ name: 'matchWin_b.root', wave: 'triangle', attack: 0.008, hold: 0.05, decay: 0.42, decayCurve: 3, freq: 220, noiseMix: 0.06, lowPass: 1200, resonance: 2.4, gain: 0.3, seed: 68510 }),
            place({ name: 'matchWin_b.third', wave: 'triangle', attack: 0.01, hold: 0.05, decay: 0.44, decayCurve: 3, freq: 261.63, noiseMix: 0.06, lowPass: 1500, resonance: 2.4, gain: 0.26, seed: 68512 }),
            place({ name: 'matchWin_b.fifth', wave: 'triangle', attack: 0.012, hold: 0.05, decay: 0.5, decayCurve: 2.8, freq: 329.63, noiseMix: 0.06, lowPass: 1900, resonance: 2.4, gain: 0.26, seed: 68514 }),
          ],
        },
      },
      {
        id: 'c',
        slot: 'matchWin',
        character: "pressure: the corner opens, no melody",
        spec: {
          name: 'matchWin_c_pressureOpens',
          layers: [
            // For a developer who does not want a tune at the end of a match at
            // all: one sustained body, and the corner opening over it.
            //
            // The BODY carries the outcome too, and it has to. Built with the
            // same 110 Hz fundamental as its loss twin, the pair measured ×1.004
            // apart on the zero-crossing centre — the proxy this repo uses for
            // *what survives a phone speaker* — because a filter corner is not
            // something a small speaker reliably reproduces and the fundamental
            // dominated both. Two takes that are only distinguishable on good
            // headphones are ambiguous at the one moment that may not be. So the
            // win sits an octave up (A3) and the loss an octave down (A1); it is
            // still one body and still no melody.
            swept('matchWin_c.open', { wave: 'triangle', freq: 220, from: 380, to: 2600, q: 3, gain: 0.42, attack: 0.02, hold: 0.06, decay: 0.42, curve: 2.6, noiseMix: 0.14, seed: 68520 }),
          ],
        },
      },
      {
        id: 'd',
        slot: 'matchWin',
        character: "the stamp: one note, and it's over",
        spec: {
          name: 'matchWin_d_stamp',
          layers: [
            band('matchWin_d.stamp', 660, { gain: 1.6, decay: 0.24, q: 7.5, curve: 4, attack: 0.003, hold: 0.02, punch: 0.4, seed: 68530 }),
          ],
        },
      },
    ],
  },

  matchLoss: {
    label: "Match End — Loss",
    context: "You lost. The same gesture as the win, inverted — and never a joke: the home that just died is the one serious thing (§4.7).",
    current: 'matchLoss',
    candidates: [
      {
        id: 'a',
        slot: 'matchLoss',
        character: "direction: two notes falling a fifth",
        spec: {
          name: 'matchLoss_a_fall',
          layers: [
            // The SAME A3 the win opens on: both outcomes start in one place, so
            // the second note is doing all of the work and the ear only has to
            // resolve one question.
            place({ name: 'matchLoss_a.n0', wave: 'triangle', attack: 0.005, hold: 0.03, decay: 0.22, decayCurve: 3.2, freq: 220, noiseMix: 0.07, lowPass: 1200, resonance: 2.6, gain: 0.4, seed: 68600 }),
            place({ name: 'matchLoss_a.n1', wave: 'triangle', attack: 0.006, hold: 0.05, decay: 0.44, decayCurve: 2.8, freq: 146.83, noiseMix: 0.07, lowPass: 760, resonance: 2.4, gain: 0.4, seed: 68602 }, 0.12),
          ],
        },
      },
      {
        id: 'b',
        slot: 'matchLoss',
        character: "the room: a chord closing downward",
        spec: {
          name: 'matchLoss_b_roomCloses',
          layers: [
            place({ name: 'matchLoss_b.root', wave: 'triangle', attack: 0.01, hold: 0.05, decay: 0.46, decayCurve: 2.8, freq: 220, noiseMix: 0.06, lowPass: 1100, resonance: 2.4, gain: 0.28, seed: 68610 }),
            place({ name: 'matchLoss_b.third', wave: 'triangle', attack: 0.012, hold: 0.05, decay: 0.48, decayCurve: 2.6, freq: 174.61, noiseMix: 0.06, lowPass: 880, resonance: 2.4, gain: 0.26, seed: 68612 }),
            place({ name: 'matchLoss_b.low', wave: 'sine', attack: 0.014, hold: 0.05, decay: 0.54, decayCurve: 2.4, freq: 110, noiseMix: 0.05, lowPass: 420, resonance: 2.2, gain: 0.28, seed: 68614 }),
          ],
        },
      },
      {
        id: 'c',
        slot: 'matchLoss',
        character: "pressure: the corner shuts, no melody",
        spec: {
          name: 'matchLoss_c_pressureShuts',
          layers: [
            // An octave under the win's body — see the note on `matchWin/c`.
            swept('matchLoss_c.shut', { wave: 'triangle', freq: 55, from: 1600, to: 150, q: 3, gain: 0.46, attack: 0.02, hold: 0.06, decay: 0.46, curve: 2.4, noiseMix: 0.14, seed: 68620 }),
          ],
        },
      },
      {
        id: 'd',
        slot: 'matchLoss',
        character: "the stamp: one low note, and nothing",
        spec: {
          name: 'matchLoss_d_stamp',
          layers: [
            // A2, an octave under the win's stamp and under the A3 both `a`
            // takes open on. It was written at 220 and that put the LOSS stamp
            // above the WIN phrase on the centre measure — the board lets the
            // developer adopt any win letter with any loss letter, so the
            // contrast has to hold across all sixteen pairings and not only the
            // matched ones.
            band('matchLoss_d.stamp', 110, { gain: 2.6, decay: 0.28, q: 6.5, curve: 3.6, attack: 0.004, hold: 0.02, punch: 0.35, seed: 68630 }),
          ],
        },
      },
    ],
  },
  alarm: {
    // The `loops until the threat clears` this context used to carry stopped being
    // true at s9-01: the alarm is sounded **once per engagement** by `engine`
    // syncAlarm, with the screen-edge arrow carrying the duration (GDD §2.2,
    // amended 2026-08-07). All four offers are one-shots on the shipped bar.
    //
    // -------------------------------------------------------------------------
    // ROUND 2 (a0-67, 2026-08-17)
    // -------------------------------------------------------------------------
    //
    //   *"all of these are ultra annoying, more subtle"*
    //
    // Round one's note on this slot said, in as many words, that the register
    // does not get to decide here: *"a klaxon is retro because it works, and §2.2
    // makes legibility a mechanic"*, so the saw and the rising minor third were
    // held constant across all four and only the body around them moved. That is
    // a defensible reading and it produced four offers the developer calls ultra
    // annoying — three of them **louder than the alarm that ships**.
    //
    // The thing round one did not use is the amendment that had already made room
    // for this. **§2.2, amended 2026-08-07: the alarm sounds ONCE per engagement,
    // and the screen-edge arrow carries the duration.** Legibility is now split
    // across two tells and only one of them is audible. A sound that no longer
    // has to nag for the length of a siege does not have to be built like a siren
    // — it has to be *unmistakable for one second*, which is a different job and a
    // much quieter one. Round one was still voicing the pre-amendment alarm.
    //
    // So what is kept and what goes:
    //
    //  - **KEPT: the two notes and the rising minor third** (B4 → D5, then D5 →
    //    F5). That interval is the recognisable shape and it is the half of
    //    legibility that costs nothing in fatigue. `./candidates.test.ts` holds
    //    every offer to it.
    //  - **KEPT: loudest in the bank.** §2.2 is a mechanic and `./audio.test.ts`
    //    asserts the alarm out-levels the chatter. Every offer stays above every
    //    `oreCollect`, `repairTick`, `spawnPulse` and `shotImpact` voice — but
    //    **under the alarm that ships**, which is where "more subtle" is spent.
    //  - **GONE: the saw.** It is what "ultra annoying" is made of: a saw at 494
    //    Hz puts full-amplitude partials right through 2-4 kHz, the band the ear
    //    is most sensitive to and cannot habituate to. The klaxon survives the
    //    saw's removal because the *interval* is what makes a klaxon, not the
    //    waveform — which is exactly what this bank learnt on `waveArrive`, whose
    //    two-horn tell survived the same removal with its pitches held to the Hz.
    //  - **GONE: the 2.4-3.0 Q on the horn body.** A resonant peak sitting on top
    //    of a harmonic-rich tone is the pierce, and it is the first thing to go.
    //
    // The four are four ways of being unmistakable without being shrill:
    //
    //   h  **an announcement** — two filtered horn tones, warm, wide, no edge.
    //      The most "station PA" of the four.
    //   i  **a pressure horn** — driven by air: the tone is low and the top is
    //      breath rather than harmonics.
    //   j  **down a corridor** — the same two notes with the room in front of
    //      them, so it reads as *elsewhere in the structure*, which is what an
    //      alarm about a building actually is.
    //   k  **two low pulses** — the smallest thing that still spells the
    //      interval. The offer for "subtle" read as literally as it can be read
    //      without losing the mechanic.
    label: "Home Alarm",
    context: "Your home is under attack (GDD §2.2) — a mechanic, not music; sounded once per engagement.",
    current: 'alarm',
    candidates: [
      {
        id: 'h',
        slot: 'alarm',
        character: "announcement: two warm horn tones",
        spec: {
          name: 'alarm_h_announcement',
          layers: [
            swept('alarm_h.low', { wave: 'triangle', freq: 494, freqEnd: 587, from: 1500, to: 1000, q: 1.6, gain: 0.4, attack: 0.02, hold: 0.17, decay: 0.12, curve: 2.6, noiseMix: 0.07, seed: 61440 }),
            swept('alarm_h.high', { wave: 'triangle', freq: 587, freqEnd: 698, from: 1700, to: 1100, q: 1.6, gain: 0.4, attack: 0.02, hold: 0.17, decay: 0.16, curve: 2.6, noiseMix: 0.07, at: 0.3, seed: 61442 }),
            swept('alarm_h.body', { wave: 'sine', freq: 123.47, from: 300, to: 180, q: 1.5, gain: 0.24, attack: 0.03, hold: 0.5, decay: 0.16, curve: 2, seed: 61444 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'alarm',
        character: "pressure horn: tone low, top is breath",
        spec: {
          name: 'alarm_i_pressureHorn',
          layers: [
            swept('alarm_i.low', { wave: 'sine', freq: 247, freqEnd: 293.66, from: 700, to: 460, q: 1.8, gain: 0.42, attack: 0.018, hold: 0.17, decay: 0.12, curve: 2.4, noiseMix: 0.1, seed: 61450 }),
            swept('alarm_i.high', { wave: 'sine', freq: 293.66, freqEnd: 349.23, from: 800, to: 520, q: 1.8, gain: 0.42, attack: 0.018, hold: 0.17, decay: 0.16, curve: 2.4, noiseMix: 0.1, at: 0.3, seed: 61452 }),
            // The air is what makes it a horn rather than a tone, and it is kept
            // low-passed at 1.6 k — the shrill band is exactly where an alarm
            // must not put a sustained layer if it is not allowed to be annoying.
            grains('alarm_i.air', { freq: 470, grain: 0.006, gain: 0.18, attack: 0.03, hold: 0.42, decay: 0.16, curve: 2, from: 1600, q: 2, hp: 260, seed: 61454 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'alarm',
        character: "down a corridor: the notes, and the room",
        spec: {
          name: 'alarm_j_downACorridor',
          layers: [
            band('alarm_j.low', 494, { gain: 1.0, decay: 0.2, q: 3.4, curve: 2.8, attack: 0.02, hold: 0.14, seed: 61460 }),
            band('alarm_j.high', 587, { gain: 1.0, decay: 0.24, q: 3.4, curve: 2.8, attack: 0.02, hold: 0.14, at: 0.3, seed: 61462 }),
            // A band passes very little of what enters it, so the two notes above
            // arrive quiet — and an alarm that peaks under `shotImpact` is not a
            // mechanic any more (§2.2). This body is what buys the level back
            // without putting anything back into the band that made it shrill.
            swept('alarm_j.body', { wave: 'sine', freq: 123.47, from: 320, to: 200, q: 1.5, gain: 0.3, attack: 0.03, hold: 0.46, decay: 0.18, curve: 2, seed: 61466 }),
            ...returns('alarm_j.room', { freq: 420, gain: 0.34, decay: 0.22, from: 1100, to: 400, at: 0.36, gap: 0.16, count: 2, seed: 61464 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'alarm',
        character: "two low pulses, and that is all",
        spec: {
          name: 'alarm_k_twoLowPulses',
          layers: [
            swept('alarm_k.one', { wave: 'sine', freq: 246.94, freqEnd: 293.66, from: 520, to: 380, q: 1.4, gain: 0.37, attack: 0.02, hold: 0.16, decay: 0.11, curve: 2.6, noiseMix: 0.05, seed: 61470 }),
            swept('alarm_k.two', { wave: 'sine', freq: 293.66, freqEnd: 349.23, from: 600, to: 420, q: 1.4, gain: 0.37, attack: 0.02, hold: 0.16, decay: 0.15, curve: 2.6, noiseMix: 0.05, at: 0.3, seed: 61472 }),
          ],
        },
      },
    ],
  },
  ambient: {
    label: "Ambient Bed",
    context: "The constant background loop during ordinary play — must vanish into the background over ~15 minutes.",
    current: 'ambient',
    fourthOption:
      "None of the three: ship the bed OFF by default, with a settings toggle for anyone who wants it. " +
      "It is item 3 on the GDD §4.9 cut list and nothing else in the mix depends on it, so this is a " +
      "legitimate verdict rather than a failure — a bed nobody notices and a bed that is absent are " +
      "close cousins, and one of them cannot annoy anybody. Reply `ambient: off` to take it.",
    candidates: [
      {
        id: 'd',
        character: "far hull, air with no low end",
        spec: {
          name: 'ambient_d_farHull',
          loop: true,
          crossfade: 0.8,
          layers: [
            place({ name: 'ambient_d.air', wave: 'noise', attack: 0.6, hold: 9.4, decay: 0, freq: 320, lowPass: 900, resonance: 2.2, highPass: 220, gain: 0.09, seed: 33030 }),
            place({ name: 'ambient_d.room', wave: 'noise', attack: 0.6, hold: 9.4, decay: 0, freq: 90, lowPass: 260, resonance: 2.4, highPass: 120, gain: 0.07, seed: 33031 }),
            place({ name: 'ambient_d.pass', wave: 'noise', attack: 3, hold: 0.5, decay: 4, decayCurve: 1.4, freq: 480, lowPass: 520, lowPassEnd: 300, resonance: 7, bandPass: true, gain: 0.1, seed: 33032 }, 1.2),
          ],
        },
      },
      {
        id: 'e',
        character: "a slow tide, only the filters move",
        spec: {
          name: 'ambient_e_slowTide',
          loop: true,
          crossfade: 0.9,
          layers: [
            place({ name: 'ambient_e.under', wave: 'sine', attack: 0.5, hold: 9.5, decay: 0, freq: 55, noiseMix: 0.02, lowPass: 110, resonance: 1, gain: 0.09, seed: 33040 }),
            swept('ambient_e.rise', { wave: 'noise', freq: 70, from: 150, to: 700, q: 2, gain: 0.075, attack: 3.2, hold: 0.3, decay: 3.5, curve: 1.5, at: 0, seed: 33041 }),
            swept('ambient_e.fall', { wave: 'noise', freq: 120, from: 780, to: 170, q: 2.4, gain: 0.065, attack: 2.8, hold: 0.3, decay: 3.6, curve: 1.7, at: 3.3, seed: 33042 }),
            place({ name: 'ambient_e.ring', wave: 'noise', attack: 2.4, hold: 0.4, decay: 3.2, decayCurve: 1.6, freq: 300, lowPass: 340, lowPassEnd: 200, resonance: 8, bandPass: true, gain: 0.11, seed: 33043 }, 4),
          ],
        },
      },
      {
        id: 'f',
        character: "a low room with a slow pulse",
        spec: {
          name: 'ambient_f_lowPulse',
          loop: true,
          crossfade: 0.9,
          layers: [
            // 55 and 55.25 Hz both close whole cycles in a 12 s body (660 and 663),
            // so the beat is continuous across the seam instead of stepping there.
            place({ name: 'ambient_f.low', wave: 'sine', attack: 0.5, hold: 11.5, decay: 0, freq: 55, noiseMix: 0.04, lowPass: 100, resonance: 1.4, gain: 0.13, seed: 33050 }),
            place({ name: 'ambient_f.beat', wave: 'sine', attack: 0.5, hold: 11.5, decay: 0, freq: 55.25, noiseMix: 0.03, lowPass: 95, resonance: 1.3, gain: 0.1, seed: 33051 }),
            place({ name: 'ambient_f.metal', wave: 'noise', attack: 0.7, hold: 11.3, decay: 0, freq: 165, lowPass: 210, resonance: 9, bandPass: true, gain: 0.06, seed: 33052 }),
            swept('ambient_f.pulse', { wave: 'noise', freq: 60, from: 120, to: 260, q: 3, gain: 0.07, attack: 3.5, hold: 0.5, decay: 4, curve: 1.4, at: 2, seed: 33053 }),
          ],
        },
      },
      // a0-60 adds a FOURTH offer rather than re-voicing this slot, and the
      // difference matters: `d`/`e`/`f` post-date the 2026-08-07 deny-all (they
      // were written for it, under a0-48) and carry no verdict of their own.
      // Replacing an un-judged offer is not answering a denial, it is destroying
      // review work — so the three stand and this one joins them, which is what
      // brings the slot to the sweep's four. It is the far end of a0-48's own
      // axis, *how much bed there is at all*: less than `d`, and audibly so.
      {
        id: 'g',
        character: "one slow breath, and no floor at all",
        spec: {
          name: 'ambient_g_oneBreath',
          loop: true,
          crossfade: 0.9,
          layers: [
            place({ name: 'ambient_g.air', wave: 'noise', attack: 0.6, hold: 11.4, decay: 0, freq: 280, lowPass: 820, resonance: 2.2, highPass: 240, gain: 0.07, seed: 61330 }),
            place({ name: 'ambient_g.trace', wave: 'noise', attack: 0.7, hold: 11.3, decay: 0, freq: 190, lowPass: 240, resonance: 9, bandPass: true, gain: 0.05, seed: 61331 }),
            swept('ambient_g.breath', { wave: 'noise', freq: 100, from: 210, to: 560, q: 2.4, gain: 0.06, attack: 3.6, hold: 0.4, decay: 4.2, curve: 1.4, at: 1.5, seed: 61332 }),
          ],
        },
      },
    ],
  },
  // --- The soundtrack, re-voiced (a0-60) ------------------------------------
  //
  // Six slots that play for a whole match, so nothing here is allowed to be an
  // event: no attack anyone can point at, no melody in the beds, nothing a player
  // notices twice. "Modern/sci-fi" for music is the thinnest of all the family
  // readings and also the most literal — **texture before melody**. A retro
  // soundtrack is a tune played by an oscillator; this one is material that
  // happens to be in a key. The four:
  //
  //   d  **ion field** — high-passed particulate air. No low end at all, no pitch
  //      centre to hum back, nothing to get tired of.
  //   e  **magnetic mass** — a low body behind a resonant corner, with unisons
  //      beating slowly against each other. Weight, and almost no top.
  //   f  **cathedral metal** — narrow inharmonic bands in a large space, written
  //      as late layers because `./synth` will not grow a reverb.
  //   g  **almost nothing** — two layers, quiet, low. The offer for a developer
  //      whose answer to the whole soundtrack is "less of it".
  //
  // No looping offer names a `lowPassEnd` on a **sustained** layer: a corner
  // travelling across a loop body snaps back at the seam, once per lap, forever.
  // Voices that decay to silence before the seam may sweep — a gesture that has
  // finished has nothing left to snap.
  // ===========================================================================
  // THE MUSIC FOUR (a0-67, 2026-08-17) — FOUR REASONS WITH ONE ROOT CAUSE
  // ===========================================================================
  //
  //   musicBed    *"none of these sound like a calm music bed"*
  //   musicPulse  *"none of these sound musical"*
  //   musicTheme  *"these sound like very bad music"*
  //   musicDread  *"none of these sound critical they just sound annoying"*
  //
  // Four different sentences, and read together they say one thing. The a0-60
  // sweep answered ALL SIX music slots with the same three materials — *granular
  // bed / filtered analogue / wide detuned space*, printed in this file's own
  // family table as **"texture before melody"** — and applied them down the
  // board. That is the correct instinct for thirty-five SFX slots and it is the
  // wrong instinct for a soundtrack, because the four reasons above are not asking
  // for a better texture. Three of them are asking for **music**: harmony, a bass
  // that moves, a phrase that is going somewhere. The fourth is asking for weight
  // where it was given noise.
  //
  // So the register note for this family is rewritten rather than reapplied:
  //
  //   OLD (a0-60)  music = texture before melody; beds are filtered material and
  //                beating unisons; stings are one gesture, not a tune.
  //   NEW (a0-67)  **music is harmony before texture.** The material may be as
  //                clean and modern as the register wants — it still has to be
  //                *notes*, in a key, with something underneath them. A texture
  //                is what a soundtrack is made of; it is not what a soundtrack
  //                IS, and a player who has been told a bed is calm and hears an
  //                ion field is not hearing a debatable interpretation.
  //
  // The key does not move: **A minor**, the key the shipped soundtrack, the
  // ambient bed and `upgradeBought` all already sit in (§7.5). Everything below is
  // built out of A(55/110/220) · C(65.41/130.81/261.63) · E(82.41/164.81/329.63) ·
  // D(146.83/293.66) · F(87.31/174.61) · G(98/196), so any pair of these four
  // slots can be adopted together and still be in tune with each other — which is
  // a property the developer cannot test by listening to them one at a time.
  musicBed: {
    // *"None of these sound like a calm music bed."* Round one offered an ion
    // field, magnetic mass, cathedral metal and almost-nothing: four textures,
    // and the two adjectives in the reason are the two things a texture cannot
    // be. **Calm** is consonance and slow motion; **music bed** is a chord.
    //
    // So all four below are chords in A minor, held, low, and moving only in the
    // way a held chord is allowed to move — a very slow vibrato, never a filter
    // sweep, because a corner travelling inside a loop body wraps into a wobble
    // once per lap and a wobble is the opposite of calm. They differ in **how
    // much harmony there is**, which is the axis a bed actually has:
    //
    //   h  the full triad, warm and breathing
    //   i  root and fifth only — open, no third, so it commits to nothing
    //   j  the triad with one voice an octave up, barely there
    //   k  two voices and a sub: the quietest thing that is still a chord
    label: "Music Bed — Calm",
    context: "Calm layer of the adaptive soundtrack — loops under mining.",
    current: 'musicBed',
    candidates: [
      {
        id: 'h',
        slot: 'musicBed',
        character: "an A-minor triad, warm and breathing",
        spec: {
          name: 'musicBed_h_warmTriad',
          loop: true,
          crossfade: 0.5,
          layers: [
            place({ name: 'musicBed_h.root', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 55, vibratoDepth: 0.003, vibratoRate: 0.07, noiseMix: 0.03, lowPass: 420, resonance: 1.5, gain: 0.2, seed: 61540 }),
            place({ name: 'musicBed_h.third', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 65.41, vibratoDepth: 0.004, vibratoRate: 0.055, gain: 0.15, seed: 61541 }),
            place({ name: 'musicBed_h.fifth', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 82.41, vibratoDepth: 0.005, vibratoRate: 0.043, gain: 0.13, seed: 61542 }),
            place({ name: 'musicBed_h.octave', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 110, vibratoDepth: 0.003, vibratoRate: 0.031, noiseMix: 0.02, lowPass: 620, resonance: 1.4, gain: 0.07, seed: 61543 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'musicBed',
        character: "root and fifth, open, no third",
        spec: {
          name: 'musicBed_i_openFifth',
          loop: true,
          crossfade: 0.5,
          layers: [
            // No third at all, so the bed is neither minor nor major and commits
            // to nothing. It is the calmest interval there is and it leaves the
            // whole harmonic decision to whatever plays over it.
            place({ name: 'musicBed_i.root', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 55, vibratoDepth: 0.0025, vibratoRate: 0.06, noiseMix: 0.03, lowPass: 380, resonance: 1.4, gain: 0.22, seed: 61550 }),
            place({ name: 'musicBed_i.fifth', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 82.41, vibratoDepth: 0.004, vibratoRate: 0.047, gain: 0.16, seed: 61551 }),
            place({ name: 'musicBed_i.air', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 164.81, vibratoDepth: 0.003, vibratoRate: 0.037, noiseMix: 0.05, lowPass: 700, resonance: 1.3, gain: 0.05, seed: 61552 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'musicBed',
        character: "the triad, with one voice an octave up",
        spec: {
          name: 'musicBed_j_triadWithLight',
          loop: true,
          crossfade: 0.5,
          layers: [
            place({ name: 'musicBed_j.root', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 55, vibratoDepth: 0.003, vibratoRate: 0.065, noiseMix: 0.03, lowPass: 400, resonance: 1.5, gain: 0.19, seed: 61560 }),
            place({ name: 'musicBed_j.third', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 65.41, vibratoDepth: 0.004, vibratoRate: 0.05, gain: 0.13, seed: 61561 }),
            place({ name: 'musicBed_j.fifth', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 82.41, vibratoDepth: 0.004, vibratoRate: 0.041, gain: 0.11, seed: 61562 }),
            // The one light in it: C4, two octaves over the third, quiet enough
            // that it reads as a room rather than as a note. This is where "a bed
            // you notice once and never again" lives.
            place({ name: 'musicBed_j.light', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 261.63, vibratoDepth: 0.004, vibratoRate: 0.029, gain: 0.035, seed: 61563 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'musicBed',
        character: "two voices and a sub, barely there",
        spec: {
          name: 'musicBed_k_twoAndSub',
          loop: true,
          crossfade: 0.5,
          layers: [
            place({ name: 'musicBed_k.sub', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 41.2, gain: 0.16, seed: 61570 }),
            place({ name: 'musicBed_k.root', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 82.41, vibratoDepth: 0.0025, vibratoRate: 0.053, noiseMix: 0.02, lowPass: 340, resonance: 1.3, gain: 0.13, seed: 61571 }),
            place({ name: 'musicBed_k.third', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 98, vibratoDepth: 0.003, vibratoRate: 0.039, gain: 0.09, seed: 61572 }),
          ],
        },
      },
    ],
  },
  musicPulse: {
    // *"None of these sound musical."* The bluntest possible statement of the
    // family's root cause, and it is exact: round one offered an ion field with a
    // grain pulse, a magnetic thud, two bands tolling and a bare heartbeat. Four
    // rhythms. **Not one of them carried a pitch you could name**, so there was
    // nothing for the ear to hear as music — a pulse without a note in it is a
    // metronome, and the slot's own job (§2.3, the metronome of the match made a
    // metronome) is what made that mistake so easy to make.
    //
    // The fix is one ingredient: **the pulse is a bass note**. Every beat below
    // has a pitch, every pitch is in A minor, and the loop is long enough to hold
    // more than one of them — because two notes is where a rhythm becomes a
    // figure. The four differ in how much figure there is:
    //
    //   h  root and fifth, alternating — the plainest bass line there is
    //   i  the root pulsing under a held third: rhythm and harmony at once
    //   j  a two-note rise, A → C, and back. A shape rather than a beat
    //   k  a pedal on the root with the fifth answering it once per lap
    label: "Music Pulse — Rising Tension",
    context: "Tension layer — fades in as waves rise.",
    current: 'musicPulse',
    candidates: [
      {
        id: 'h',
        slot: 'musicPulse',
        character: "a bass line: root and fifth, alternating",
        spec: {
          name: 'musicPulse_h_bassAlternating',
          loop: true,
          crossfade: 0.05,
          layers: [
            // The sustained floor keeps the seam from being silent — the same job
            // the shipped `musicPulse.floor` does, at the same register.
            place({ name: 'musicPulse_h.floor', wave: 'triangle', attack: 0, hold: 1.32, decay: 0, freq: 55, lowPass: 300, resonance: 1.4, gain: 0.06, seed: 61580 }),
            place({ name: 'musicPulse_h.a', wave: 'sine', attack: 0.004, hold: 0.03, decay: 0.34, decayCurve: 3, punch: 0.4, freq: 55, noiseMix: 0.03, lowPass: 260, resonance: 1.6, gain: 0.3, seed: 61581 }),
            place({ name: 'musicPulse_h.e', wave: 'sine', attack: 0.004, hold: 0.03, decay: 0.34, decayCurve: 3, punch: 0.4, freq: 82.41, noiseMix: 0.03, lowPass: 360, resonance: 1.6, gain: 0.26, seed: 61582 }, 0.66),
          ],
        },
      },
      {
        id: 'i',
        slot: 'musicPulse',
        character: "the root pulsing under a held third",
        spec: {
          name: 'musicPulse_i_pulseUnderThird',
          loop: true,
          crossfade: 0.05,
          layers: [
            // The held C is the harmony and the pulsing A is the clock. This is
            // the take where the slot does both of its jobs with one voice each.
            place({ name: 'musicPulse_i.third', wave: 'triangle', attack: 0, hold: 1.32, decay: 0, freq: 130.81, vibratoDepth: 0.003, vibratoRate: 0.4, noiseMix: 0.04, lowPass: 620, resonance: 1.8, gain: 0.11, seed: 61590 }),
            place({ name: 'musicPulse_i.p0', wave: 'sine', attack: 0.003, hold: 0.028, decay: 0.3, decayCurve: 3.2, punch: 0.45, freq: 55, noiseMix: 0.03, lowPass: 280, resonance: 1.6, gain: 0.3, seed: 61591 }),
            place({ name: 'musicPulse_i.p1', wave: 'sine', attack: 0.003, hold: 0.028, decay: 0.3, decayCurve: 3.2, punch: 0.45, freq: 55, noiseMix: 0.03, lowPass: 280, resonance: 1.6, gain: 0.24, seed: 61592 }, 0.66),
          ],
        },
      },
      {
        id: 'j',
        slot: 'musicPulse',
        character: "a two-note rise, A to C and back",
        spec: {
          name: 'musicPulse_j_twoNoteRise',
          loop: true,
          crossfade: 0.05,
          layers: [
            place({ name: 'musicPulse_j.floor', wave: 'triangle', attack: 0, hold: 1.32, decay: 0, freq: 41.2, lowPass: 240, resonance: 1.3, gain: 0.07, seed: 61600 }),
            place({ name: 'musicPulse_j.a', wave: 'triangle', attack: 0.004, hold: 0.03, decay: 0.28, decayCurve: 3, punch: 0.4, freq: 55, noiseMix: 0.05, lowPass: 300, resonance: 1.8, gain: 0.28, seed: 61601 }),
            place({ name: 'musicPulse_j.c', wave: 'triangle', attack: 0.004, hold: 0.03, decay: 0.28, decayCurve: 3, punch: 0.4, freq: 65.41, noiseMix: 0.05, lowPass: 340, resonance: 1.8, gain: 0.26, seed: 61602 }, 0.44),
            place({ name: 'musicPulse_j.back', wave: 'triangle', attack: 0.004, hold: 0.03, decay: 0.3, decayCurve: 3, punch: 0.4, freq: 55, noiseMix: 0.05, lowPass: 300, resonance: 1.8, gain: 0.22, seed: 61603 }, 0.88),
          ],
        },
      },
      {
        id: 'k',
        slot: 'musicPulse',
        character: "a pedal, with the fifth answering once",
        spec: {
          name: 'musicPulse_k_pedalAndAnswer',
          loop: true,
          crossfade: 0.05,
          layers: [
            place({ name: 'musicPulse_k.pedal', wave: 'triangle', attack: 0, hold: 1.32, decay: 0, freq: 55, vibratoDepth: 0.002, vibratoRate: 0.3, noiseMix: 0.03, lowPass: 260, resonance: 1.5, gain: 0.16, seed: 61610 }),
            place({ name: 'musicPulse_k.answer', wave: 'sine', attack: 0.006, hold: 0.04, decay: 0.44, decayCurve: 2.6, freq: 164.81, noiseMix: 0.03, lowPass: 620, resonance: 1.8, gain: 0.2, seed: 61611 }, 0.6),
          ],
        },
      },
    ],
  },
  musicTheme: {
    // *"These sound like very bad music."* The bluntest reason on the board, and
    // the only one aimed at composition rather than at sound design — so it is
    // the only one that could not be answered by choosing better numbers.
    //
    // Round one's four takes were, in its own words, *"the same riff, same key
    // (§7.5) — the instrument is the offer, seven notes at the shipped times."*
    // Holding the melody and changing the instrument was a deliberate, written
    // decision: §7.5 protects the theme's identity, and a lane rewriting the game's
    // tune uninvited is exactly the overreach this file is careful about. The
    // developer has now looked at the result four ways and said the music is bad.
    // **That is a ruling on the riff**, and it is the one thing round one refused
    // to touch.
    //
    // What is actually wrong with it, stated so the next round can argue with the
    // diagnosis rather than with the taste: the shipped theme is **seven notes in
    // a row over one held A**. A → C → E → D → C → A → E, one voice, no chord
    // changes underneath. A melody with no harmony moving under it has nothing to
    // be *in* — every note lands on the same chord, so none of them means
    // anything, and a tune that means nothing for four seconds and then does it
    // again is what "very bad music" sounds like. It is not the instrument.
    //
    // So the four below are four **pieces**, not four instruments, and the thing
    // that is new in all of them is that **the harmony moves**:
    //
    //   h  a four-chord loop — Am · F · C · G, one per second, and no melody at
    //      all. If the harmony is the problem, this is the proof: nothing is
    //      played over the top and it is still music.
    //   i  a bass that walks — A · A · C · E under a held A-minor chord. The
    //      motion is in the bottom voice, which is where a siege belongs.
    //   j  two chords breathing — Am → F, two seconds each, with one upper voice
    //      stepping down between them. The calmest, and the most patient.
    //   k  a pedal and one answer — A held throughout, with a three-note figure
    //      (E · D · C) once per lap. The closest of the four to what ships, and
    //      the offer for "the tune is fine, it needs somewhere to sit".
    //
    // §7.5 is not ignored, it is spent deliberately and once: the key, the
    // register, the tempo (a 4-second lap), the instrument (`./bank`'s own
    // filtered triangle at `resonance` 2.6) and the pad that keeps the seam from
    // going silent are all held exactly. What changes is the writing.
    label: "Music Theme — Siege",
    context: "Full theme — plays during a siege.",
    current: 'musicTheme',
    candidates: [
      {
        id: 'h',
        slot: 'musicTheme',
        character: "four chords, one a second, no melody",
        spec: {
          name: 'musicTheme_h_fourChords',
          loop: true,
          crossfade: 0.08,
          layers: [
            place({ name: 'musicTheme_h.pad', wave: 'triangle', attack: 0.02, hold: 3.98, decay: 0, freq: 110, vibratoDepth: 0.004, vibratoRate: 0.2, noiseMix: 0.04, lowPass: 900, resonance: 2, gain: 0.09, seed: 61620 }),
            // Am — the home chord, and the only one that gets the octave over it.
            place({ name: 'musicTheme_h.c0r', wave: 'triangle', attack: 0.01, hold: 0.5, decay: 0.5, decayCurve: 2.2, freq: 110, noiseMix: 0.06, lowPass: 700, resonance: 2.6, gain: 0.15, seed: 61621 }),
            place({ name: 'musicTheme_h.c0t', wave: 'triangle', attack: 0.012, hold: 0.5, decay: 0.5, decayCurve: 2.2, freq: 261.63, noiseMix: 0.06, lowPass: 1300, resonance: 2.6, gain: 0.09, seed: 61622 }),
            // F — the lift. Same two voices a third down and a third up: the bass
            // falls, the upper voice rises, which is the whole reason a chord
            // change reads as movement rather than as a new note.
            place({ name: 'musicTheme_h.c1r', wave: 'triangle', attack: 0.01, hold: 0.5, decay: 0.5, decayCurve: 2.2, freq: 87.31, noiseMix: 0.06, lowPass: 620, resonance: 2.6, gain: 0.15, seed: 61623 }, 1),
            place({ name: 'musicTheme_h.c1t', wave: 'triangle', attack: 0.012, hold: 0.5, decay: 0.5, decayCurve: 2.2, freq: 261.63, noiseMix: 0.06, lowPass: 1300, resonance: 2.6, gain: 0.085, seed: 61624 }, 1),
            // C — the relative major, and the only bright moment in the lap.
            place({ name: 'musicTheme_h.c2r', wave: 'triangle', attack: 0.01, hold: 0.5, decay: 0.5, decayCurve: 2.2, freq: 130.81, noiseMix: 0.06, lowPass: 760, resonance: 2.6, gain: 0.14, seed: 61625 }, 2),
            place({ name: 'musicTheme_h.c2t', wave: 'triangle', attack: 0.012, hold: 0.5, decay: 0.5, decayCurve: 2.2, freq: 329.63, noiseMix: 0.06, lowPass: 1500, resonance: 2.6, gain: 0.08, seed: 61626 }, 2),
            // G — the one that has to resolve, so the lap wants to start again.
            place({ name: 'musicTheme_h.c3r', wave: 'triangle', attack: 0.01, hold: 0.5, decay: 0.55, decayCurve: 2.2, freq: 98, noiseMix: 0.06, lowPass: 660, resonance: 2.6, gain: 0.15, seed: 61627 }, 3),
            place({ name: 'musicTheme_h.c3t', wave: 'triangle', attack: 0.012, hold: 0.5, decay: 0.55, decayCurve: 2.2, freq: 293.66, noiseMix: 0.06, lowPass: 1400, resonance: 2.6, gain: 0.085, seed: 61628 }, 3),
          ],
        },
      },
      {
        id: 'i',
        slot: 'musicTheme',
        character: "a bass that walks under a held chord",
        spec: {
          name: 'musicTheme_i_walkingBass',
          loop: true,
          crossfade: 0.08,
          layers: [
            place({ name: 'musicTheme_i.chordR', wave: 'triangle', attack: 0.03, hold: 3.95, decay: 0, freq: 220, vibratoDepth: 0.003, vibratoRate: 0.15, noiseMix: 0.05, lowPass: 1000, resonance: 2.4, gain: 0.075, seed: 61630 }),
            place({ name: 'musicTheme_i.chordT', wave: 'triangle', attack: 0.04, hold: 3.94, decay: 0, freq: 261.63, vibratoDepth: 0.003, vibratoRate: 0.12, noiseMix: 0.05, lowPass: 1200, resonance: 2.4, gain: 0.06, seed: 61631 }),
            place({ name: 'musicTheme_i.chordF', wave: 'triangle', attack: 0.05, hold: 3.93, decay: 0, freq: 329.63, vibratoDepth: 0.003, vibratoRate: 0.09, noiseMix: 0.05, lowPass: 1400, resonance: 2.4, gain: 0.045, seed: 61632 }),
            place({ name: 'musicTheme_i.b0', wave: 'triangle', attack: 0.006, hold: 0.06, decay: 0.7, decayCurve: 2.6, punch: 0.35, freq: 110, noiseMix: 0.06, lowPass: 520, resonance: 2.6, gain: 0.2, seed: 61633 }),
            place({ name: 'musicTheme_i.b1', wave: 'triangle', attack: 0.006, hold: 0.06, decay: 0.7, decayCurve: 2.6, punch: 0.35, freq: 110, noiseMix: 0.06, lowPass: 520, resonance: 2.6, gain: 0.17, seed: 61634 }, 1),
            place({ name: 'musicTheme_i.b2', wave: 'triangle', attack: 0.006, hold: 0.06, decay: 0.7, decayCurve: 2.6, punch: 0.35, freq: 130.81, noiseMix: 0.06, lowPass: 600, resonance: 2.6, gain: 0.19, seed: 61635 }, 2),
            place({ name: 'musicTheme_i.b3', wave: 'triangle', attack: 0.006, hold: 0.06, decay: 0.8, decayCurve: 2.6, punch: 0.35, freq: 164.81, noiseMix: 0.06, lowPass: 700, resonance: 2.6, gain: 0.18, seed: 61636 }, 3),
          ],
        },
      },
      {
        id: 'j',
        slot: 'musicTheme',
        character: "two chords breathing, one voice stepping",
        spec: {
          name: 'musicTheme_j_twoChordsBreathing',
          loop: true,
          crossfade: 0.08,
          layers: [
            place({ name: 'musicTheme_j.pad', wave: 'triangle', attack: 0.02, hold: 3.98, decay: 0, freq: 110, vibratoDepth: 0.004, vibratoRate: 0.18, noiseMix: 0.04, lowPass: 800, resonance: 2, gain: 0.1, seed: 61640 }),
            place({ name: 'musicTheme_j.am', wave: 'triangle', attack: 0.14, hold: 1.5, decay: 0.42, decayCurve: 1.8, freq: 164.81, noiseMix: 0.05, lowPass: 900, resonance: 2.4, gain: 0.13, seed: 61641 }),
            place({ name: 'musicTheme_j.f', wave: 'triangle', attack: 0.14, hold: 1.5, decay: 0.42, decayCurve: 1.8, freq: 174.61, noiseMix: 0.05, lowPass: 900, resonance: 2.4, gain: 0.13, seed: 61642 }, 2),
            // The upper voice steps down a whole tone between the two chords —
            // the smallest amount of melody there is, and enough that the lap is
            // going somewhere rather than repeating.
            place({ name: 'musicTheme_j.v0', wave: 'triangle', attack: 0.1, hold: 1.4, decay: 0.5, decayCurve: 2, freq: 329.63, noiseMix: 0.05, lowPass: 1500, resonance: 2.6, gain: 0.075, seed: 61643 }),
            place({ name: 'musicTheme_j.v1', wave: 'triangle', attack: 0.1, hold: 1.4, decay: 0.5, decayCurve: 2, freq: 293.66, noiseMix: 0.05, lowPass: 1400, resonance: 2.6, gain: 0.075, seed: 61644 }, 2),
          ],
        },
      },
      {
        id: 'k',
        slot: 'musicTheme',
        character: "a pedal, and one three-note answer",
        spec: {
          name: 'musicTheme_k_pedalAndAnswer',
          loop: true,
          crossfade: 0.08,
          layers: [
            place({ name: 'musicTheme_k.pedal', wave: 'triangle', attack: 0.02, hold: 3.98, decay: 0, freq: 110, vibratoDepth: 0.005, vibratoRate: 0.2, noiseMix: 0.04, lowPass: 1000, resonance: 2, gain: 0.15, seed: 61650 }),
            place({ name: 'musicTheme_k.fifth', wave: 'triangle', attack: 0.06, hold: 3.9, decay: 0, freq: 164.81, vibratoDepth: 0.003, vibratoRate: 0.13, noiseMix: 0.04, lowPass: 900, resonance: 2, gain: 0.075, seed: 61651 }),
            // Three notes, falling, once. The shipped theme plays seven and comes
            // back to where it started; this says less and therefore means more.
            place({ name: 'musicTheme_k.a0', wave: 'triangle', attack: 0.005, hold: 0.04, decay: 0.5, decayCurve: 3, freq: 329.63, noiseMix: 0.06, lowPass: 1500, resonance: 2.6, gain: 0.14, seed: 61652 }, 1.2),
            place({ name: 'musicTheme_k.a1', wave: 'triangle', attack: 0.005, hold: 0.04, decay: 0.5, decayCurve: 3, freq: 293.66, noiseMix: 0.06, lowPass: 1400, resonance: 2.6, gain: 0.13, seed: 61653 }, 1.8),
            place({ name: 'musicTheme_k.a2', wave: 'triangle', attack: 0.006, hold: 0.05, decay: 0.8, decayCurve: 2.8, freq: 261.63, noiseMix: 0.06, lowPass: 1300, resonance: 2.6, gain: 0.13, seed: 61654 }, 2.4),
          ],
        },
      },
    ],
  },
  musicDread: {
    // *"None of these sound critical they just sound annoying."* Two words doing
    // two different jobs, and the second one is the diagnosis.
    //
    // **Annoying** is a register: it lives above 2 kHz, where an ear cannot
    // habituate. Round one's `d` — *"ion field thinning out, high and empty"* —
    // put 20% of its energy up there and held it for five and a half seconds
    // under a collapsing station. That is not dread, it is tinnitus, and it is
    // the direct cost of the family note (*texture before melody*) meeting a slot
    // whose brief is *"the collapse thinning out"*: thin was read as **high**.
    //
    // **Critical** is the other direction entirely. What makes a sound mean
    // *something is badly wrong and time is short* is weight and instability, low
    // down, where you feel it rather than hear it — and, above all, **something
    // that is changing**. The shipped voice already has half of this right: a
    // semitone clash beating slowly against a low drone. What it has never had is
    // anything that *develops*, so it reads as unpleasant rather than as urgent.
    //
    // So all four below are built to two rules and differ in what is unstable:
    //
    //  1. **Nothing above 1 kHz**, in any layer, in any of them. `./candidates.
    //     test.ts` holds the whole set under the shipped voice's high-frequency
    //     share — the one number that separates dread from an irritant.
    //  2. **Something moves across the lap.** A beat that quickens, a voice that
    //     creeps, a pulse that is closer than it was. A held dissonance is a
    //     state; dread is a direction.
    //
    //   h  a **tritone**, low — the most unstable interval there is, at 55 Hz
    //      where it is pressure rather than pitch
    //   i  a **pedal with a voice creeping up** a semitone across the lap: the
    //      thing that is wrong is getting worse
    //   j  the shipped clash, with a **slow heartbeat** under it — the same
    //      unease, now with a clock attached
    //   k  **one deep tone and the room emptying** around it. The restrained
    //      one, for critical read as *nothing is coming to help*
    label: "Music Dread — Collapse",
    context: "Collapse layer — replaces the others as entropy arrives.",
    current: 'musicDread',
    candidates: [
      {
        id: 'h',
        slot: 'musicDread',
        character: "a tritone, low enough to be pressure",
        spec: {
          name: 'musicDread_h_lowTritone',
          loop: true,
          crossfade: 0.4,
          layers: [
            place({ name: 'musicDread_h.root', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 55, noiseMix: 0.04, lowPass: 420, resonance: 1.8, gain: 0.24, seed: 61660 }),
            // E♭ against A: a tritone, and the interval a listener cannot resolve
            // no matter how long it is held. Down here it is felt in the chest
            // rather than identified, which is the difference from a high clash.
            place({ name: 'musicDread_h.tritone', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 77.78, noiseMix: 0.04, lowPass: 500, resonance: 1.8, gain: 0.17, seed: 61661 }),
            place({ name: 'musicDread_h.sub', wave: 'sine', attack: 0, hold: 6, decay: 0, freq: 36.71, gain: 0.14, seed: 61662 }),
            // The mover: a swell that arrives once a lap, so the lap has a shape.
            place({ name: 'musicDread_h.swell', wave: 'triangle', attack: 2.2, hold: 1.6, decay: 2.0, decayCurve: 1.3, freq: 82.41, noiseMix: 0.06, lowPass: 340, resonance: 1.6, gain: 0.12, seed: 61663 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'musicDread',
        character: "a pedal, with a voice creeping up",
        spec: {
          name: 'musicDread_i_creepingVoice',
          loop: true,
          crossfade: 0.4,
          layers: [
            place({ name: 'musicDread_i.pedal', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 55, noiseMix: 0.04, lowPass: 400, resonance: 1.7, gain: 0.26, seed: 61670 }),
            // 58.27 → 61.74: a semitone of travel across six seconds, which is
            // slow enough that nobody hears it move and everybody hears that it
            // is worse than it was. §5.4 exempts drift at this rate by
            // construction; a fall this slow is not a slide, it is a condition.
            place({ name: 'musicDread_i.creep', wave: 'sine', attack: 0.4, hold: 5.6, decay: 0, freq: 58.27, freqEnd: 61.74, gain: 0.15, seed: 61671 }),
            place({ name: 'musicDread_i.sub', wave: 'sine', attack: 0, hold: 6, decay: 0, freq: 41.2, gain: 0.13, seed: 61672 }),
            place({ name: 'musicDread_i.floor', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 27.5, noiseMix: 0.05, lowPass: 200, resonance: 1.4, gain: 0.1, seed: 61673 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'musicDread',
        character: "the clash, with a heartbeat under it",
        spec: {
          name: 'musicDread_j_clashAndHeartbeat',
          loop: true,
          crossfade: 0.4,
          layers: [
            place({ name: 'musicDread_j.low', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 55, noiseMix: 0.04, lowPass: 460, resonance: 1.8, gain: 0.22, seed: 61680 }),
            place({ name: 'musicDread_j.clash', wave: 'sine', attack: 0, hold: 6, decay: 0, freq: 58.3, gain: 0.14, seed: 61681 }),
            // Four beats in six seconds, closing up: 0.0 · 1.7 · 3.2 · 4.5. The
            // gap shortens by ~15% each time, which is the cheapest way a loop
            // can say *this is accelerating* without ever changing tempo.
            place({ name: 'musicDread_j.b0', wave: 'sine', attack: 0.01, hold: 0.05, decay: 0.5, decayCurve: 2.4, punch: 0.4, freq: 41.2, gain: 0.22, seed: 61682 }),
            place({ name: 'musicDread_j.b1', wave: 'sine', attack: 0.01, hold: 0.05, decay: 0.5, decayCurve: 2.4, punch: 0.4, freq: 41.2, gain: 0.24, seed: 61683 }, 1.7),
            place({ name: 'musicDread_j.b2', wave: 'sine', attack: 0.01, hold: 0.05, decay: 0.5, decayCurve: 2.4, punch: 0.4, freq: 41.2, gain: 0.26, seed: 61684 }, 3.2),
            place({ name: 'musicDread_j.b3', wave: 'sine', attack: 0.01, hold: 0.05, decay: 0.5, decayCurve: 2.4, punch: 0.4, freq: 41.2, gain: 0.28, seed: 61685 }, 4.5),
          ],
        },
      },
      {
        id: 'k',
        slot: 'musicDread',
        character: "one deep tone, the room emptying",
        spec: {
          name: 'musicDread_k_oneToneEmptying',
          loop: true,
          crossfade: 0.4,
          layers: [
            place({ name: 'musicDread_k.tone', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 48.99, noiseMix: 0.05, lowPass: 380, resonance: 1.6, gain: 0.3, seed: 61690 }),
            place({ name: 'musicDread_k.sub', wave: 'sine', attack: 0, hold: 6, decay: 0, freq: 32.7, gain: 0.16, seed: 61691 }),
            // The room, leaving: a wide quiet layer that swells in and goes,
            // once per lap. Nothing else answers it, which is the point.
            place({ name: 'musicDread_k.room', wave: 'triangle', attack: 1.8, hold: 1.2, decay: 2.6, decayCurve: 1.2, freq: 73.42, noiseMix: 0.09, lowPass: 260, resonance: 1.4, gain: 0.1, seed: 61692 }, 0.6),
          ],
        },
      },
    ],
  },
  musicWin: {
    // -------------------------------------------------------------------------
    // ROUND 2 (a0-67, 2026-08-17) — GENERATE AROUND THE INCUMBENT
    // -------------------------------------------------------------------------
    //
    //   *"they still sound video gamey, the current is closest but too video
    //   gamey"*
    //
    // *"The current is closest"* makes the incumbent the reference, so the round
    // is an adjustment and not a replacement — and the adjustment is nameable.
    // **What is video-gamey about the shipped sting is not its material, it is
    // its melody: four notes climbing a major triad, A3 → C♯4 → E4 → A4, with a
    // shine an octave over the top.** That is a fanfare, it is the "level
    // complete" idiom, and no amount of filtering makes a rising major arpeggio
    // read as anything else. Round one heard "video gamey" as a texture note and
    // offered ion bursts, magnetic lift and cathedral bands — new materials
    // playing the same run, which is why they came back marked *still*.
    //
    // So the material is kept exactly (filtered triangle, `noiseMix` 0.06,
    // `resonance` 2.6 — the shipped voice's own numbers) and **the run goes**:
    //
    //   h  **two notes** — A3 up a fifth to E4, long, opening. A gesture instead
    //      of a run: the shortest possible thing that is still a rise.
    //   i  **one chord** — the same pitches struck together and allowed to open.
    //      No sequence at all, so there is nothing to hum.
    //   j  **arrival, then the floor under it** — the top note first, the lower
    //      ones arriving beneath it. Nothing climbs, and the last thing you hear
    //      is the bottom of the chord rather than the top.
    //   k  **the sound that ships today**, for the A/B.
    //
    // §4.7 is the fence around all four: this lands into the three seconds of
    // near-silence, so nothing here shouts, nothing is louder than the incumbent,
    // and nothing runs past the 1.32 s longest-tail invariant (§8) — a winner has
    // to be promotable into the bank without eating the beat it lands after.
    label: "Victory Sting",
    context: "Match won (after the three-second quiet) — one-shot, a short rising resolution.",
    current: 'musicWin',
    candidates: [
      {
        id: 'h',
        slot: 'musicWin',
        character: "two notes, a fifth, opening",
        spec: {
          name: 'musicWin_h_twoNotes',
          layers: [
            place({ name: 'musicWin_h.n0', wave: 'triangle', attack: 0.02, hold: 0.14, decay: 0.4, decayCurve: 3, freq: 220, noiseMix: 0.06, lowPass: 900, lowPassEnd: 1400, resonance: 2.6, gain: 0.2369, seed: 61480 }),
            place({ name: 'musicWin_h.n1', wave: 'triangle', attack: 0.03, hold: 0.2, decay: 0.62, decayCurve: 2.8, freq: 329.63, noiseMix: 0.06, lowPass: 1200, lowPassEnd: 2000, resonance: 2.6, gain: 0.2538, seed: 61482 }, 0.3),
            place({ name: 'musicWin_h.floor', wave: 'triangle', attack: 0.04, hold: 0.3, decay: 0.5, decayCurve: 2.2, freq: 110, noiseMix: 0.04, lowPass: 320, resonance: 2, gain: 0.1861, seed: 61484 }, 0.3),
          ],
        },
      },
      {
        id: 'i',
        slot: 'musicWin',
        character: "one chord, struck and opening",
        spec: {
          name: 'musicWin_i_oneChord',
          layers: [
            // All four at `at: 0`. There is no order, so there is no tune — the
            // whole gesture is the corner opening across the held chord.
            place({ name: 'musicWin_i.root', wave: 'triangle', attack: 0.025, hold: 0.24, decay: 0.66, decayCurve: 2.6, freq: 110, noiseMix: 0.05, lowPass: 400, lowPassEnd: 700, resonance: 2.4, gain: 0.1785, seed: 61490 }),
            place({ name: 'musicWin_i.fifth', wave: 'triangle', attack: 0.03, hold: 0.22, decay: 0.62, decayCurve: 2.8, freq: 164.81, noiseMix: 0.06, lowPass: 700, lowPassEnd: 1300, resonance: 2.6, gain: 0.1373, seed: 61492 }),
            place({ name: 'musicWin_i.oct', wave: 'triangle', attack: 0.035, hold: 0.2, decay: 0.58, decayCurve: 3, freq: 220, noiseMix: 0.06, lowPass: 1000, lowPassEnd: 1800, resonance: 2.6, gain: 0.1167, seed: 61494 }),
            place({ name: 'musicWin_i.third', wave: 'triangle', attack: 0.05, hold: 0.18, decay: 0.52, decayCurve: 3, freq: 329.63, noiseMix: 0.04, lowPass: 1400, lowPassEnd: 2400, resonance: 2.2, gain: 0.0755, seed: 61496 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'musicWin',
        character: "the top note first, the floor after",
        spec: {
          name: 'musicWin_j_arrivalThenFloor',
          layers: [
            place({ name: 'musicWin_j.top', wave: 'triangle', attack: 0.02, hold: 0.16, decay: 0.44, decayCurve: 3, freq: 440, noiseMix: 0.06, lowPass: 1800, lowPassEnd: 1100, resonance: 2.6, gain: 0.22, seed: 61500 }),
            place({ name: 'musicWin_j.mid', wave: 'triangle', attack: 0.03, hold: 0.2, decay: 0.5, decayCurve: 2.8, freq: 220, noiseMix: 0.06, lowPass: 900, resonance: 2.6, gain: 0.24, seed: 61502 }, 0.18),
            place({ name: 'musicWin_j.floor', wave: 'triangle', attack: 0.05, hold: 0.28, decay: 0.56, decayCurve: 2.2, freq: 110, noiseMix: 0.04, lowPass: 300, resonance: 2, gain: 0.26, seed: 61504 }, 0.34),
          ],
        },
      },
      {
        id: 'k',
        slot: 'musicWin',
        anchor: true,
        character: "the sound that ships today (A/B)",
        spec: incumbent('musicWin', 'k'),
      },
    ],
  },
  musicLoss: {
    // -------------------------------------------------------------------------
    // ROUND 2 (a0-67, 2026-08-17) — GENERATE AROUND THE INCUMBENT
    // -------------------------------------------------------------------------
    //
    //   *"i like current, but it still sounds too video gamey"*
    //
    // The same diagnosis as `musicWin` and the same fix, aimed downward. The
    // shipped sting is a falling minor phrase — A3 → F3 → D3, with a low A under
    // it — and the phrase is the video-gamey part: **three discrete notes stepping
    // down in time is a "you lose" jingle**, no matter how dark the material is.
    // The material itself is not the problem and is kept to the number: filtered
    // triangles and sines, `noiseMix` 0.06, `resonance` 2.6, the same key.
    //
    // *"I like current"* means the fall stays. What changes is how much of it is
    // spelled out:
    //
    //   h  **two notes and a breath** — the outer two of the three, and a long
    //      low sustain under them that simply stops. Half the jingle.
    //   i  **one note sinking** — no melody at all: a held tone whose corner
    //      closes over a second and a half. The ache with nothing counting it out.
    //   j  **the phrase as one chord** — the same three pitches, overlapped
    //      instead of sequenced, decaying together. The fall becomes a harmony
    //      that is already falling when you meet it.
    //   k  **the sound that ships today**, for the A/B.
    //
    // Nothing resolves in any of them — that is §4.7's ache and it is not what
    // was complained about — and every offer stays inside the 1.32 s longest-tail
    // invariant (§8) and under the incumbent's level.
    label: "Defeat Sting",
    context: "Match lost (after the three-second quiet) — one-shot, falling minor phrase that settles low.",
    current: 'musicLoss',
    candidates: [
      {
        id: 'h',
        slot: 'musicLoss',
        character: "two notes, then a breath that stops",
        spec: {
          name: 'musicLoss_h_twoAndBreath',
          layers: [
            place({ name: 'musicLoss_h.n0', wave: 'triangle', attack: 0.012, hold: 0.12, decay: 0.36, decayCurve: 3.2, freq: 220, noiseMix: 0.06, lowPass: 1000, lowPassEnd: 620, resonance: 2.6, gain: 0.26, seed: 61510 }),
            place({ name: 'musicLoss_h.n1', wave: 'sine', attack: 0.02, hold: 0.16, decay: 0.6, decayCurve: 2.4, freq: 146.83, noiseMix: 0.05, lowPass: 620, lowPassEnd: 300, resonance: 2.4, gain: 0.28, seed: 61512 }, 0.34),
            // A triangle with a third of its signal as pitched noise, not a noise
            // layer: *"i like current"* rules out new materials as much as it
            // rules out new ideas, and the incumbent is triangles and sines.
            place({ name: 'musicLoss_h.breath', wave: 'triangle', attack: 0.12, hold: 0.3, decay: 0.42, decayCurve: 1.8, freq: 110, noiseMix: 0.34, lowPass: 400, lowPassEnd: 170, resonance: 1.6, gain: 0.12, seed: 61514 }, 0.34),
          ],
        },
      },
      {
        id: 'i',
        slot: 'musicLoss',
        character: "one note sinking, no melody at all",
        spec: {
          name: 'musicLoss_i_oneNoteSinking',
          layers: [
            // The corner closes 900 → 190 over a second and a half at a FIXED
            // pitch. §5.4 is explicit that this is a different gesture from a
            // pitch slide, and it is the one that does not spell anything.
            place({ name: 'musicLoss_i.hold', wave: 'triangle', attack: 0.03, hold: 0.28, decay: 0.92, decayCurve: 2, freq: 146.83, noiseMix: 0.06, lowPass: 900, lowPassEnd: 190, resonance: 2.6, gain: 0.249, seed: 61520 }),
            place({ name: 'musicLoss_i.under', wave: 'sine', attack: 0.06, hold: 0.34, decay: 0.8, decayCurve: 2, freq: 73.42, noiseMix: 0.04, lowPass: 220, resonance: 2, gain: 0.1992, seed: 61522 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'musicLoss',
        character: "the phrase as one falling chord",
        spec: {
          name: 'musicLoss_j_fallingChord',
          layers: [
            place({ name: 'musicLoss_j.a', wave: 'triangle', attack: 0.014, hold: 0.14, decay: 0.5, decayCurve: 2.8, freq: 220, noiseMix: 0.06, lowPass: 950, lowPassEnd: 480, resonance: 2.6, gain: 0.14, seed: 61530 }),
            place({ name: 'musicLoss_j.f', wave: 'triangle', attack: 0.02, hold: 0.16, decay: 0.62, decayCurve: 2.6, freq: 174.61, noiseMix: 0.06, lowPass: 760, lowPassEnd: 380, resonance: 2.6, gain: 0.154, seed: 61532 }, 0.06),
            place({ name: 'musicLoss_j.d', wave: 'sine', attack: 0.026, hold: 0.18, decay: 0.76, decayCurve: 2.3, freq: 146.83, noiseMix: 0.05, lowPass: 600, lowPassEnd: 270, resonance: 2.4, gain: 0.182, seed: 61534 }, 0.12),
            place({ name: 'musicLoss_j.low', wave: 'sine', attack: 0.04, hold: 0.24, decay: 0.6, decayCurve: 2.2, freq: 110, noiseMix: 0.04, lowPass: 300, resonance: 2, gain: 0.154, seed: 61536 }, 0.3),
          ],
        },
      },
      {
        id: 'k',
        slot: 'musicLoss',
        anchor: true,
        character: "the sound that ships today (A/B)",
        spec: incumbent('musicLoss', 'k'),
      },
    ],
  },
  // === THE INTERFACE FALLBACKS (a0-60) ======================================
  //
  // **Read §7.6 before judging these by ear in the running game.** Since s6-01
  // the app routes `press`, `confirm`, `reject`, `hover`, `detent`, `back`,
  // `accept`, `join` and `rush` to the ratified Gantry/Bone set in `./ui-cues`.
  // `CUE_SOUND` — these — is the fallback for when there is no cue player at all.
  // Choosing one of these changes what a fallback sounds like, not what the
  // developer hears clicking around the build, and a reviewer expecting the
  // opposite will conclude nothing changed.
  //
  // At interface scale the sweep's materials are the same materials, shrunk to a
  // few tens of milliseconds, and one of them loses a limb: no offer in this
  // family gets `returns`. A tail on a 28 ms tick is not space, it is smear, and
  // on a phone speaker it is the difference between a click and a thud. This is
  // also the family where "modern/sci-fi" is *least* about adding anything —
  // §4.7 register 2 is that the interface does not congratulate, so the four are
  // four kinds of restraint rather than four kinds of event:
  //
  //   d  a **capacitive contact** — a fingertip on glass read by a machine.
  //      Granular, no tone, nothing rings.
  //   e  a **damped actuator** — a small body with the corner closing over it.
  //      Felt more than heard; the only offers with anything low in them.
  //   f  a **filtered band** — one resonant partial, clean, gone before it rings.
  //   g  **the smallest thing that still reads** — the offer for a developer who
  //      wants the interface quieter, not different.
  //
  // §8's `rejectBuzz` / `coreHit` pair runs through here — *your buy was refused*
  // against *your reactor is taking damage* — and §7.6's own note says re-voicing
  // reject upward is what protects it. Every reject offer sits above 300 Hz of
  // spectral centre; the fight family's core offers all sit under 250.
  // ---------------------------------------------------------------------------
  // ROUND 2 (a0-67, 2026-08-17) — A REGRESSION REPORT, NOT A PREFERENCE
  // ---------------------------------------------------------------------------
  //
  //   *"what happened to the glass theme we had, none of these are glass themed
  //   like the main menu"*
  //
  // Every other reason on the round-two board is an opinion about a sound. This
  // one is a **bug report**, it is correct, and it can be read straight out of
  // the file: the sound this slot ships is `strike('pressTick', 1661, …)` —
  // sine partials on 1 / 2.76 / 5.4 at A♭6, the ratified Gantry/Bone glass, the
  // same material and the same root as the main menu's `pick` cue. The four takes
  // round one offered were a capacitive contact, a damped actuator, a filtered
  // band and a click. All four are impeccably "modern/sci-fi, not retro/toony" —
  // and all four left the family. **A slot can pass the register test and still be
  // a regression**, and nothing in the sweep was watching for that, which is the
  // actual lesson here rather than anything about taste.
  //
  // **What the glass theme IS, in sound terms** — so it stops being lost. The
  // long form is on {@link glass}, which reads the numbers out of `./ui-cues`
  // rather than retyping them; the short form is five properties:
  //
  //  1. **Sine partials on 1 / 2.76 / 5.4.** Inharmonic, and neither a harmonic
  //     series nor a bell's. That spacing is what a struck pane does.
  //  2. **Upper partials die first** (each 0.66 of the one below). This single
  //     line is the difference between glass and bell metal — a chime made of the
  //     same ratios rings *upward* and does not sound like this at all.
  //  3. **A ~2 ms strike, never zero.** Zero is a click; 2 ms is a strike.
  //  4. **A contact edge in front of the note** — a breath of band-passed noise,
  //     so it reads as two hard things touching rather than a tone switching on.
  //  5. **A♭6 = 1661 Hz is the root**, and every pitch in the menu is measured
  //     off it.
  //
  // So all four offers below are glass. What they differ in is **how much glass
  // there is** — which is the axis this slot actually has, because it is the
  // lightest sound in the game and it fires dozens of times a match:
  //
  //   h  **the pane, thinner** — the family root, two partials, less contact.
  //   i  **the pane, higher** — an octave up at A♭7, the register `detent`
  //      already uses, so a press sits under the wheel cue rather than beside it.
  //   j  **fingertip on the pane** — contact first, note second: the edge is the
  //      loudest thing in it and the glass is what it lands on.
  //   k  **the pane, three partials, quietest** — the full material at the
  //      smallest size. The offer for "keep the theme, take the level down".
  //
  // Held, and measured in `./candidates.test.ts`: every offer is quieter and
  // shorter than the SHIPPED tick (this is the slot §7.6 names as the fatigue
  // case — *"heard dozens of times a match, forever"*), and every offer really is
  // glass rather than described as glass, checked against the ratified ratios.
  pressTick: {
    label: "Press Tick",
    context: "A wheel wedge / menu control was pressed — the lightest possible click, heard dozens of times a match.",
    current: 'pressTick',
    candidates: [
      {
        id: 'h',
        slot: 'pressTick',
        character: "the pane, thinner: two partials at A♭6",
        spec: {
          name: 'pressTick_h_thinPane',
          layers: [...glass('pressTick_h', 1661, { gain: 0.088, decay: 0.042, partials: GLASS_PAIR, contact: 0.7, seed: 30510 })],
        },
      },
      {
        id: 'i',
        slot: 'pressTick',
        character: "the pane an octave up, at A♭7",
        spec: {
          name: 'pressTick_i_highPane',
          layers: [...glass('pressTick_i', 3322, { gain: 0.075, decay: 0.032, partials: GLASS_PAIR, contact: 0.5, seed: 30520 })],
        },
      },
      {
        id: 'j',
        slot: 'pressTick',
        character: "fingertip first, then the pane",
        spec: {
          name: 'pressTick_j_fingertip',
          layers: [
            // The contact carries it and the note is what it lands on — the same
            // two ingredients as the others, in the other order. It is the offer
            // for a press that should feel like touching something rather than
            // like sounding something.
            ...glass('pressTick_j', 1661, { gain: 0.055, decay: 0.044, partials: GLASS_PAIR, contact: 0, grain: 0.04, seed: 30530 }),
            band('pressTick_j.touch', 4300, { gain: 0.22, decay: 0.014, q: 2.4, curve: 7, punch: 0.4, hp: 1800, seed: 30534 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'pressTick',
        character: "the full pane, three partials, quietest",
        spec: {
          name: 'pressTick_k_fullPaneQuiet',
          layers: [...glass('pressTick_k', 1661, { gain: 0.062, decay: 0.048, partials: GLASS_PARTIALS, contact: 0.55, seed: 30540 })],
        },
      },
    ],
  },
  purchaseConfirm: {
    label: "Purchase Confirm",
    context: "A purchase or repair committed — a rising two-beat 'done'.",
    current: 'purchaseConfirm',
    candidates: [
      // Two beats, rising, in all four — that shape is the message (*committed*)
      // and the sweep is not re-deciding it. §8 keeps this clear of
      // `buildComplete`, which fires seconds later off the same press: that one
      // is low and seated, these stay short and narrow.
      {
        id: 'd',
        character: "two capacitive contacts, rising",
        spec: {
          name: 'purchaseConfirm_d_twoContacts',
          layers: [
            grains('purchaseConfirm_d.c0', { freq: 1050, grain: 0.0022, gain: 0.26, hold: 0.003, decay: 0.026, curve: 6, from: 3000, to: 1200, q: 3, hp: 500, seed: 60810 }),
            grains('purchaseConfirm_d.c1', { freq: 1400, grain: 0.002, gain: 0.3, hold: 0.004, decay: 0.04, curve: 5.5, from: 3800, to: 1500, q: 3.2, hp: 620, at: 0.055, seed: 60812 }),
          ],
        },
      },
      {
        id: 'e',
        character: "the buy landing, damped and low",
        spec: {
          name: 'purchaseConfirm_e_buyLands',
          layers: [
            swept('purchaseConfirm_e.b0', { wave: 'triangle', freq: 587, from: 1700, to: 760, q: 3.2, gain: 0.3, attack: 0.002, hold: 0.006, decay: 0.03, curve: 5, noiseMix: 0.18, seed: 60820 }),
            swept('purchaseConfirm_e.b1', { wave: 'triangle', freq: 784, from: 2200, to: 980, q: 3.4, gain: 0.34, attack: 0.002, hold: 0.008, decay: 0.06, curve: 4.2, noiseMix: 0.16, at: 0.055, seed: 60822 }),
          ],
        },
      },
      {
        id: 'f',
        character: "two bands, a fourth apart",
        spec: {
          name: 'purchaseConfirm_f_fourthApart',
          layers: [
            band('purchaseConfirm_f.b0', 880, { gain: 0.895, decay: 0.035, q: 7, curve: 6, seed: 60830 }),
            band('purchaseConfirm_f.b1', 1175, { gain: 0.966, decay: 0.07, q: 7.5, curve: 5, at: 0.055, seed: 60832 }),
          ],
        },
      },
      {
        id: 'g',
        character: "done, in one contact",
        spec: {
          name: 'purchaseConfirm_g_doneOnce',
          layers: [
            band('purchaseConfirm_g.done', 1240, { gain: 0.46, decay: 0.05, q: 6.5, curve: 5.5, punch: 0.3, seed: 60840 }),
          ],
        },
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // REJECT BUZZ (a0-68, denied 2026-08-17 with the other nineteen)
  // ---------------------------------------------------------------------------
  //
  //   *"none of these sound like rejected"*
  //
  // This slot belongs with a0-67's sixteen and was left out of both briefs; the
  // board's own `denied_without_work` flagged it. It gets what any round-two slot
  // gets — four fresh takes under letters no verdict has spent (`a`-`c` on
  // 2026-08-07, `d`-`g` on 2026-08-17, so these are `h`-`k`).
  //
  // ## Why the denied four were not refusals
  //
  // Read the characters back: *a dry refusal* · *blocked: the corner shuts* ·
  // *two bands a semitone apart* · *no, said quietly, once*. All four are
  // **understated**, and three of the four say so in their own name. They were
  // built to a §8 note about staying clear of `coreHit` and to a fear of the slot
  // being a raspberry, and between the two they arrived at a sound that is
  // tasteful and does not read as *no*.
  //
  // A refusal is not a quiet sound. It is a FLAT and UNMISTAKABLE one — you
  // pressed a thing and the thing did not happen, and the interface has to say so
  // without being asked twice. The developer has said elsewhere that a buy they
  // cannot afford must not be entertaining, and that is the other fence: never
  // funny, nothing that wobbles, nothing with a raspberry in it.
  //
  // So the three properties all four below hold, that the denied four did not:
  //
  //  1. **A hard front.** Every one of these starts at full level in under 4 ms.
  //     A refusal that fades in is a refusal you have to listen for.
  //  2. **Flat, or falling. Never rising.** No offer here ends higher than it
  //     started, in pitch OR in filter corner — up is `purchaseConfirm`'s
  //     direction and the two cues are answers to the same press.
  //  3. **It stops.** All four are inside 0.2 s and none has a tail that rings.
  //     `./candidates.test.ts` holds all three.
  //
  // The §8 clearance over the core family is kept and re-measured, not dropped:
  // the constraint that produced the timid set was never wrong, it was just the
  // only thing anybody was optimising.
  rejectBuzz: {
    label: "Reject Buzz",
    context: "A buy the player can't afford. The sound of NO: flat, short, unmistakable, and never funny.",
    current: 'rejectBuzz',
    candidates: [
      {
        id: 'h',
        slot: 'rejectBuzz',
        character: "the glass, refused: a minor second struck at once",
        spec: {
          name: 'rejectBuzz_h_glassRefused',
          layers: [
            // The pressTick precedent (a0-67): this is the material the interface
            // ACTUALLY speaks — the ratified Gantry/Bone glass — rather than a
            // fourth invention beside it. What makes it a refusal is that the two
            // partials are struck TOGETHER instead of in sequence: a minor second
            // sounded at once is a dissonance the ear reads as one flat wrong
            // event, where the same two notes in order read as a little tune.
            band('rejectBuzz_h.a', 1661, { gain: 1.05, decay: 0.09, q: 9, curve: 5, attack: 0.001, hold: 0.006, seed: 68700 }),
            band('rejectBuzz_h.b', 1760, { gain: 0.99, decay: 0.085, q: 9, curve: 5, attack: 0.001, hold: 0.006, seed: 68702 }),
            band('rejectBuzz_h.floor', 415, { gain: 0.5, decay: 0.055, q: 5, curve: 6, attack: 0.001, hold: 0.004, seed: 68704 }),
          ],
        },
      },
      {
        id: 'i',
        slot: 'rejectBuzz',
        character: "a bar dropping: the shop shuts",
        spec: {
          name: 'rejectBuzz_i_barDrops',
          layers: [
            // Weight, and a stop. The one offer with real mass in it, for the
            // reading where a refusal is a mechanism physically closing.
            band('rejectBuzz_i.latch', 520, { gain: 0.36, decay: 0.016, q: 4.5, curve: 8, punch: 0.7, seed: 68710 }),
            swept('rejectBuzz_i.drop', { wave: 'triangle', freq: 116, from: 900, to: 150, q: 2.6, gain: 0.38, attack: 0.0015, hold: 0.014, decay: 0.075, curve: 5.5, punch: 0.5, noiseMix: 0.2, seed: 68712 }),
          ],
        },
      },
      {
        id: 'j',
        slot: 'rejectBuzz',
        character: "the buzzer, done properly: one flat band, cut",
        spec: {
          name: 'rejectBuzz_j_flatBand',
          layers: [
            // The offer that is actually the slot's own name, and the one to pick
            // if *"none of these sound like rejected"* means "none of these is a
            // BUZZER". A narrow band held dead flat — no pitch motion, no filter
            // motion, no modulation — for 90 ms and then truncated with a curve
            // steep enough to read as a switch opening.
            //
            // Deliberately NOT a low-rate amplitude buzz: below about 30 Hz that
            // is a raspberry, and a raspberry is the joke this slot may not make.
            band('rejectBuzz_j.band', 330, { gain: 1.5, decay: 0.088, q: 11, curve: 9, attack: 0.001, hold: 0.055, punch: 0.35, seed: 68720 }),
            band('rejectBuzz_j.teeth', 662, { gain: 0.68, decay: 0.086, q: 12, curve: 9, attack: 0.001, hold: 0.055, seed: 68722 }),
          ],
        },
      },
      {
        id: 'k',
        slot: 'rejectBuzz',
        character: "dead: the signal is cut mid-word",
        spec: {
          name: 'rejectBuzz_k_dead',
          layers: [
            // Refusal as ABSENCE. It starts like something that was going to be a
            // confirmation and is switched off before it gets anywhere — the
            // shortest offer here, and the one that costs the player the least
            // attention on the fiftieth press of a match.
            swept('rejectBuzz_k.cut', { wave: 'triangle', freq: 392, freqEnd: 370, from: 1500, to: 900, q: 4, gain: 0.4, attack: 0.0012, hold: 0.026, decay: 0.014, curve: 9, punch: 0.4, noiseMix: 0.12, seed: 68730 }),
          ],
        },
      },
    ],
  },
  depositTick: {
    // One tick per chunk on a deposit flight, so this fires in bursts and the
    // ranking that matters is which offer disappears best. All four are the
    // station family's materials at a tenth of the size: a stepper contact, a
    // vacuum take, a quenched band, and one that is barely there at all.
    label: "Deposit Tick",
    context: "One ore chunk settling into the bank on a deposit flight — soft & falling, one tick per chunk.",
    current: 'depositTick',
    candidates: [
      {
        id: 'd',
        character: "a stepper contact, very small",
        spec: {
          name: 'depositTick_d_smallStep',
          layers: [
            grains('depositTick_d.step', { freq: 440, grain: 0.0028, gain: 0.2, hold: 0.003, decay: 0.032, curve: 6, from: 1300, to: 520, q: 2.8, hp: 200, seed: 60730 }),
          ],
        },
      },
      {
        id: 'e',
        character: "a vacuum take, no edge on it",
        spec: {
          name: 'depositTick_e_vacuumTake',
          layers: [
            swept('depositTick_e.take', { wave: 'sine', freq: 190, freqEnd: 160, from: 400, to: 200, q: 2.2, gain: 0.22, attack: 0.003, hold: 0.005, decay: 0.05, curve: 4.5, noiseMix: 0.16, seed: 60740 }),
          ],
        },
      },
      {
        id: 'f',
        character: "a quenched band, one partial",
        spec: {
          name: 'depositTick_f_quenchedBand',
          layers: [
            band('depositTick_f.band', 580, { gain: 1, decay: 0.038, q: 4.5, curve: 6, seed: 60750 }),
          ],
        },
      },
      {
        id: 'g',
        character: "air moving, and a chunk arriving",
        spec: {
          name: 'depositTick_g_airArrive',
          layers: [
            grains('depositTick_g.air', { freq: 700, grain: 0.0022, gain: 0.34, hold: 0.002, decay: 0.04, curve: 5.5, from: 1800, to: 760, q: 2.4, hp: 460, seed: 60760 }),
          ],
        },
      },
    ],
  },
  respawnBeep: {
    // §8 guards this against `spawnPulse` at ×1.20 of centroid — the respawn
    // countdown against the spawn-protection tick, two quiet repeating sounds a
    // dead player hears back to back. They keep opposite metaphors through the
    // a0-60 sweep: spawnPulse is a **field** (soft, particulate, low) and every
    // offer here is a **clock** (hard, narrow, and above it).
    //
    // What "not retro" means for a countdown specifically: no musical interval
    // between the beeps and the launch, and no rise across the count. A retro
    // countdown climbs a scale; a machine counting down repeats one contact and
    // then stops.
    label: "Respawn Beep",
    context: "A tick of the respawn countdown — one clean mid beep a second, deliberately plain, a clock.",
    current: 'respawnBeep',
    candidates: [
      {
        id: 'd',
        character: "escapement contact, dry",
        spec: {
          name: 'respawnBeep_d_escapement',
          layers: [
            grains('respawnBeep_d.tick', { freq: 1250, freqEnd: 1050, grain: 0.0022, gain: 0.206, hold: 0.016, decay: 0.05, curve: 5, from: 4200, to: 1800, q: 3.2, hp: 620, seed: 60410 }),
          ],
        },
      },
      {
        id: 'e',
        character: "a seated pip, weight behind it",
        spec: {
          name: 'respawnBeep_e_seatedPip',
          layers: [
            swept('respawnBeep_e.pip', { wave: 'triangle', freq: 880, from: 2800, to: 1150, q: 3.4, gain: 0.27, attack: 0.003, hold: 0.022, decay: 0.06, curve: 4, punch: 0.3, noiseMix: 0.16, seed: 60420 }),
          ],
        },
      },
      {
        id: 'f',
        character: "one narrow band, instrument-clean",
        spec: {
          name: 'respawnBeep_f_narrowBand',
          layers: [
            band('respawnBeep_f.tone', 1150, { gain: 0.9, decay: 0.075, q: 6.5, curve: 5, attack: 0.003, hold: 0.018, seed: 60430 }),
          ],
        },
      },
      {
        id: 'g',
        character: "a relay closing, and nothing else",
        spec: {
          name: 'respawnBeep_g_relayClose',
          layers: [
            band('respawnBeep_g.close', 1450, { gain: 0.6, decay: 0.03, q: 4.5, curve: 7, punch: 0.4, hp: 500, seed: 60440 }),
          ],
        },
      },
    ],
  },
  respawnGo: {
    label: "Respawn Go",
    context: "Respawn launch — the ship back on the field, brighter & a step up from the countdown beeps.",
    current: 'respawnGo',
    candidates: [
      {
        id: 'd',
        character: "ion wash releasing, dry top",
        spec: {
          name: 'respawnGo_d_washRelease',
          layers: [
            grains('respawnGo_d.release', { freq: 600, freqEnd: 1000, grain: 0.0026, gain: 0.3, hold: 0.03, decay: 0.05, curve: 3, from: 1600, to: 4400, q: 3, hp: 340, seed: 60450 }),
            grains('respawnGo_d.top', { freq: 1400, freqEnd: 1050, grain: 0.0024, gain: 0.28, hold: 0.014, decay: 0.1, curve: 4.5, from: 4600, to: 1900, q: 3.6, hp: 700, at: 0.09, seed: 60452 }),
          ],
        },
      },
      {
        id: 'e',
        character: "catapult mass, pressure leaving",
        spec: {
          name: 'respawnGo_e_catapultMass',
          layers: [
            swept('respawnGo_e.push', { wave: 'noise', freq: 180, freqEnd: 300, from: 420, to: 2200, q: 2.4, gain: 0.3, attack: 0.005, hold: 0.035, decay: 0.055, curve: 2.6, seed: 60460 }),
            swept('respawnGo_e.body', { wave: 'triangle', freq: 220, from: 800, to: 340, q: 3.2, gain: 0.36, attack: 0.003, hold: 0.028, decay: 0.13, curve: 3.2, punch: 0.45, noiseMix: 0.16, at: 0.085, seed: 60462 }),
          ],
        },
      },
      {
        id: 'f',
        character: "containment opening, band clearing",
        spec: {
          name: 'respawnGo_f_containmentOpen',
          layers: [
            swept('respawnGo_f.open', { wave: 'noise', freq: 500, from: 800, to: 4400, q: 7.5, gain: 0.4, attack: 0.005, hold: 0.035, decay: 0.055, curve: 2.8, seed: 60470 }),
            band('respawnGo_f.clear', 1320, { gain: 0.66, decay: 0.13, q: 8, curve: 5, punch: 0.4, at: 0.095, seed: 60472 }),
          ],
        },
      },
      {
        id: 'g',
        character: "launch clamps let go, once",
        spec: {
          name: 'respawnGo_g_clampsLetGo',
          layers: [
            band('respawnGo_g.let', 1080, { gain: 0.55, decay: 0.035, q: 5, curve: 6.5, punch: 0.5, seed: 60480 }),
            swept('respawnGo_g.away', { wave: 'sine', freq: 150, freqEnd: 210, from: 400, to: 900, q: 2.6, gain: 0.3, attack: 0.004, hold: 0.02, decay: 0.09, curve: 3, noiseMix: 0.18, at: 0.03, seed: 60482 }),
          ],
        },
      },
    ],
  },
  minimapPing: {
    // §7.6: the *name* is a fossil. The minimap ping mechanic was cut (§2.4, §4.9)
    // and this cue is raised for the minimap **toggle**, so the sound is live and
    // the label is not. Renaming a `SoundName` is a bank change and this brief does
    // not make those — but the board prints the context, so the context says it.
    //
    // The one hard rule on the slot: it locates, it never alarms. So no offer
    // repeats, none of them rises, and none of them is loud enough to be read as
    // a warning if it happens to fire while the alarm is up.
    label: "Minimap Ping",
    context: "The minimap toggle (the ping mechanic itself was cut) — it locates; it must never read as an alarm.",
    current: 'minimapPing',
    candidates: [
      {
        id: 'd',
        character: "a swept return through dust",
        spec: {
          name: 'minimapPing_d_dustReturn',
          layers: [
            grains('minimapPing_d.sweep', { freq: 700, freqEnd: 1000, grain: 0.0032, gain: 0.28, attack: 0.004, hold: 0.04, decay: 0.2, curve: 3.2, from: 1700, to: 3400, q: 3, hp: 380, seed: 60890 }),
          ],
        },
      },
      {
        id: 'e',
        character: "a soft pulse going out and back",
        spec: {
          name: 'minimapPing_e_outAndBack',
          layers: [
            swept('minimapPing_e.out', { wave: 'triangle', freq: 440, from: 800, to: 2000, q: 3.4, gain: 0.36, attack: 0.005, hold: 0.03, decay: 0.07, curve: 2.8, noiseMix: 0.14, seed: 60900 }),
            swept('minimapPing_e.back', { wave: 'triangle', freq: 330, from: 1500, to: 480, q: 3.2, gain: 0.34, attack: 0.006, hold: 0.024, decay: 0.17, curve: 3.2, noiseMix: 0.12, at: 0.095, seed: 60902 }),
          ],
        },
      },
      {
        id: 'f',
        character: "one band opening a map",
        spec: {
          name: 'minimapPing_f_mapBand',
          layers: [
            band('minimapPing_f.open', 1480, { gain: 0.8, decay: 0.09, q: 6, curve: 4.8, attack: 0.003, hold: 0.012, seed: 60910 }),
            band('minimapPing_f.under', 990, { gain: 0.5, decay: 0.14, q: 7, curve: 4.2, attack: 0.004, hold: 0.01, at: 0.02, seed: 60912 }),
          ],
        },
      },
      {
        id: 'g',
        character: "a display coming up, barely",
        spec: {
          name: 'minimapPing_g_displayUp',
          layers: [
            swept('minimapPing_g.up', { wave: 'noise', freq: 900, from: 1400, to: 2600, q: 4, gain: 0.26, attack: 0.006, hold: 0.02, decay: 0.09, curve: 3.4, hp: 600, seed: 60920 }),
            band('minimapPing_g.mark', 1320, { gain: 0.34, decay: 0.06, q: 7.5, curve: 5, at: 0.03, seed: 60922 }),
          ],
        },
      },
    ],
  },
  // === THE END-OF-MATCH SUMMARY (p1-07) =====================================
  //
  // Four **new** slots, for the choreographed end-of-match beat
  // (`docs/progression-plan.md` §6.3/§6.5). Read that timeline before judging
  // these by ear: they are heard in order, under a result that has already
  // sounded, and three of them exist so the fourth lands.
  //
  // The family's three metaphors, on the same axis as every other family:
  //
  //   a  a **counter's contact** — granular, dry, no pitch centre to memorise
  //   b  **pressure seating** — a low body with a corner travelling over it
  //   c  **induction** — a narrow band that rings once, the only one with a tail
  //
  // Two constraints hold on the whole set and every offer in it honours them,
  // because an approved candidate ships:
  //
  //  - **Under the result.** A station death is still the ache (GDD §4.7). Every
  //    offer is quieter than `matchEnd`, and the level-up — the loudest thing
  //    here by design — is quieter than it too.
  //  - **Cancellable.** A player who skipped is telling you they do not want the
  //    beat, so no offer has a tail that outlives the screen: the one-shots are
  //    all under half a second, and all three `xpBarFill` offers are **loops**,
  //    because a loop can be stopped and a one-shot in flight cannot.
  //
  // `matchEnd`, `musicWin` and `musicLoss` are not referenced by any of them,
  // and `candidates.test.ts` asserts it rather than trusting the comment.
  xpTick: {
    // The `pressTick` problem, not the `matchEnd` one: ~40 of these inside five
    // seconds, every match, forever. Held to `pressTick`'s bound in the tests —
    // shorter and quieter — because that is the only slot in the bank with the
    // same job. Nothing here rings: at forty repetitions a pitch centre becomes
    // a melody, and a melody the player did not ask for is the fatigue.
    label: "XP Tick",
    context: "One step of the end-of-match count-up — dozens in five seconds, every match. If it is interesting, it is wrong.",
    current: 'xpTick',
    candidates: [
      {
        id: 'a',
        character: "a counter contact, dry grit",
        spec: {
          name: 'xpTick_a_counterContact',
          layers: [
            grains('xpTick_a.contact', { freq: 1400, grain: 0.0018, gain: 0.105, hold: 0.002, decay: 0.014, curve: 6, from: 4800, to: 2400, q: 3, hp: 800, seed: 35000 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a damped pip, felt not heard",
        spec: {
          name: 'xpTick_b_dampedPip',
          layers: [
            swept('xpTick_b.pip', { wave: 'triangle', freq: 740, from: 2000, to: 760, q: 3, gain: 0.17, attack: 0.0005, hold: 0.002, decay: 0.017, curve: 6, noiseMix: 0.24, hp: 300, seed: 35010 }),
          ],
        },
      },
      {
        id: 'c',
        character: "one narrow band, machine-clean",
        spec: {
          name: 'xpTick_c_narrowBand',
          layers: [
            band('xpTick_c.tone', 1760, { gain: 0.62, decay: 0.019, q: 7, curve: 7, hp: 900, seed: 35020 }),
          ],
        },
      },
    ],
  },
  xpBarFill: {
    // A *filling* sound, not a repeated one — so all three are held loops with a
    // start and a stop, and none of them sweeps inside its own body: a sweep in a
    // loop restarts every lap and is heard as a pulse. The rise is ridden at the
    // seam (`./engine` xpFill) against the bar's real progress, which is the
    // only place that knows how long the fill is.
    //
    // All three sit low and mid on purpose. The level-up lands bright on top of
    // this, and two bright things at once is the one mix the beat cannot make.
    label: "XP Bar Fill",
    context: "The bed under the level bar filling — starts and ends with the bar, and ducks under a level-up landing on it.",
    current: 'xpBarFill',
    candidates: [
      {
        id: 'a',
        character: "particulate fill, poured in",
        spec: {
          name: 'xpBarFill_a_particulate',
          loop: true,
          crossfade: 0.25,
          layers: [
            grains('xpBarFill_a.pour', { freq: 120, grain: 0.0045, gain: 0.16, attack: 0, hold: 3, decay: 0, from: 760, q: 2.6, hp: 130, seed: 35100 }),
            swept('xpBarFill_a.floor', { wave: 'sine', freq: 82.41, from: 260, q: 2, gain: 0.12, attack: 0, hold: 3, decay: 0, noiseMix: 0.05, seed: 35102 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a low bed under pressure",
        spec: {
          name: 'xpBarFill_b_pressureBed',
          loop: true,
          crossfade: 0.25,
          layers: [
            swept('xpBarFill_b.body', { wave: 'triangle', freq: 110, from: 430, q: 2.4, gain: 0.15, attack: 0, hold: 3, decay: 0, noiseMix: 0.08, seed: 35110 }),
            swept('xpBarFill_b.air', { wave: 'noise', freq: 88, from: 620, q: 2.2, gain: 0.07, attack: 0, hold: 3, decay: 0, hp: 150, seed: 35111 }),
          ],
        },
      },
      {
        id: 'c',
        character: "an induction hum, taking charge",
        spec: {
          name: 'xpBarFill_c_induction',
          loop: true,
          crossfade: 0.25,
          layers: [
            swept('xpBarFill_c.coil', { wave: 'noise', freq: 165, from: 700, q: 8, gain: 0.13, attack: 0, hold: 3, decay: 0, hp: 200, seed: 35120 }),
            swept('xpBarFill_c.root', { wave: 'triangle', freq: 110, from: 500, q: 3, gain: 0.1, attack: 0, hold: 3, decay: 0, noiseMix: 0.06, seed: 35121 }),
          ],
        },
      },
    ],
  },
  levelUp: {
    // **The one moment allowed to be a reward** — and the ceiling is the amended
    // §4.7, not the old paragraph's fireworks. So all three read as *arrival*:
    // something approaches, lands once, rings out. None of them is a rising
    // phrase — that is the retired arcade idiom (§5.3) and it is also what
    // `upgradeBought` already is.
    //
    // None uses a major third either. The interface does not congratulate
    // (§4.7 register 2), and this cue can land on top of a DEFEAT headline.
    //
    // -------------------------------------------------------------------------
    // ROUND 2 (a0-49, 2026-08-15)
    // -------------------------------------------------------------------------
    //
    // The developer, denying `a`/`b`/`c` on 2026-08-14, verbatim:
    //
    //   *"sounds too toony, doesn't sound rewarding"*
    //
    // Two demands, and the second is the harder one. `a0-01`'s post-mortem already
    // paid for the lesson behind the first: retiring the arcade oscillator and
    // reaching for bare sine partials produced *"a glockenspiel… not less toony,
    // differently toony"* — so **subtracting the toy is not the same as adding the
    // reward**, and a fourth round of "same gesture, darker" would have been the
    // same mistake in a different register. Round 1 above is exactly that gesture:
    // its three takes are an approach and a landing, and what lands is thin.
    //
    // **A reward in this register is arrival with mass.** Something moves, and then
    // it is *seated* — a low body under the landing that is still there afterwards.
    // That is two numbers rather than an adjective, and both are held in
    // `./candidates.test.ts` against the takes that were denied:
    //
    //   - **mass** — RMS under 200 Hz. Round 2 measures 0.058 / 0.069 / 0.063
    //     against 0.026 / 0.045 / 0.010 for the three that were called unrewarding.
    //   - **seated** — how much sound is left in the last 60% of the cue relative
    //     to the first 40%. Round 2 measures 0.42 / 0.49 / 0.43 against 0.31 /
    //     0.27 / 0.28. The landing is not the end of the sound any more.
    //
    // Neither number may be bought by simply turning the cue up: the whole set
    // still plays *beneath* the result sting (plan §6.5), and all three sit at
    // least 20% under `matchEnd` by RMS.
    //
    // The three characters are three answers to *what the mass does once it has
    // landed* — which is the axis a reward lives on, where round 1's axis (what
    // the excitation is made of) only decided how it arrived:
    //
    //   d  **the lock engaging** — it snaps shut. Shortest travel, hardest seat.
    //   e  **the drive coming online** — it opens. The filter climbs *after* the
    //      landing, so the cue is still growing when a phrase would have ended.
    //   f  **the vault** — it rings in a room. Inharmonic contacts arriving
    //      together over a hydraulic sub; the biggest of the three.
    label: "Level Up",
    context: "The bar completed and the level ticked over — the one moment in the beat allowed to be a reward. Arrival, not fanfare.",
    current: 'levelUp',
    candidates: [
      {
        id: 'd',
        character: "a lock engaging, mass seating hard",
        spec: {
          name: 'levelUp_d_lockEngaging',
          layers: [
            grains('levelUp_d.travel', { freq: 340, grain: 0.0045, gain: 0.15, attack: 0.005, hold: 0.012, decay: 0.05, curve: 2.8, from: 700, to: 2600, q: 3.2, hp: 200, seed: 35410 }),
            swept('levelUp_d.seat', { wave: 'triangle', freq: 146.83, freqEnd: 138, from: 2600, to: 640, q: 3.6, gain: 0.34, attack: 0.0015, hold: 0.02, decay: 0.31, curve: 3, punch: 0.6, noiseMix: 0.16, at: 0.09, seed: 35412 }),
            swept('levelUp_d.mass', { wave: 'sine', freq: 55, from: 200, to: 110, q: 2, gain: 0.22, attack: 0.003, hold: 0.03, decay: 0.29, curve: 2.6, noiseMix: 0.04, at: 0.09, seed: 35413 }),
            band('levelUp_d.lock', 900, { gain: 0.2, decay: 0.18, q: 9, curve: 4, hp: 300, at: 0.09, seed: 35414 }),
          ],
        },
      },
      {
        id: 'e',
        character: "a drive coming online, opening",
        spec: {
          name: 'levelUp_e_driveOnline',
          layers: [
            swept('levelUp_e.charge', { wave: 'noise', freq: 280, from: 500, to: 3200, q: 4.5, gain: 0.13, attack: 0.012, hold: 0.01, decay: 0.05, curve: 2.2, hp: 200, seed: 35420 }),
            // The corner climbs 300 → 1900 Hz across the body, *after* the landing.
            // A filter opening is not a pitch rising (§5.4), which is what keeps
            // this off the arcade idiom while still being the one cue that grows.
            swept('levelUp_e.online', { wave: 'triangle', freq: 110, from: 300, to: 1900, q: 3, gain: 0.28, attack: 0.004, hold: 0.05, decay: 0.26, curve: 2.2, noiseMix: 0.14, at: 0.085, seed: 35422 }),
            swept('levelUp_e.mass', { wave: 'sine', freq: 55, from: 180, q: 1.8, gain: 0.22, attack: 0.004, hold: 0.06, decay: 0.28, curve: 2.4, noiseMix: 0.04, at: 0.085, seed: 35423 }),
            band('levelUp_e.field', 1240, { gain: 0.2, decay: 0.24, q: 10, curve: 3.4, hp: 700, at: 0.1, seed: 35425 }),
          ],
        },
      },
      {
        id: 'f',
        character: "a vault seating, contacts in a room",
        spec: {
          name: 'levelUp_f_vaultSeating',
          layers: [
            grains('levelUp_f.approach', { freq: 320, grain: 0.005, gain: 0.13, attack: 0.006, hold: 0.012, decay: 0.05, curve: 2.6, from: 800, to: 3000, q: 3, hp: 220, seed: 35430 }),
            // 1 · 2.41 · 4.17 over a 330 Hz root: 330 / 795 / 1376 Hz, arriving in
            // the same instant rather than in sequence. Inharmonic and struck
            // together is a mechanism closing; spaced out it would be a phrase, and
            // spaced by a third it would be a congratulation.
            ...plate('levelUp_f.contacts', 330, { gain: 0.3, decay: 0.3, ratios: [1, 2.41, 4.17], q: 7, curve: 3.4, punch: 0.55, grain: 0.34, at: 0.085, seed: 35432 }),
            swept('levelUp_f.hydraulic', { wave: 'sine', freq: 61.74, from: 190, to: 100, q: 1.9, gain: 0.24, attack: 0.004, hold: 0.04, decay: 0.3, curve: 2.4, noiseMix: 0.05, at: 0.085, seed: 35438 }),
          ],
        },
      },
    ],
  },
  xpSettle: {
    // ------------------------------------------------------------------------
    // a0-57. Denied 2026-08-16T02:29:03Z, all three, with one reason:
    //   *"none of these sound like sounds for XP collection"*
    // ------------------------------------------------------------------------
    //
    // Read as written, that is a CATEGORY rejection: not "these are not good
    // enough", but "these are not sounds for the thing this slot is for". No
    // amount of refining an object that is the wrong object produces the right
    // one, so this round does not tune `a`/`b`/`c` — it starts again from the
    // event.
    //
    // **What the previous three were voicing.** The slot's own note above them
    // read *"the full stop… the screen has finished moving and your input means
    // something again"*, and all three answered that sentence faithfully: a dry
    // stop, a damped seat, a low band ringing out. Three ways for a MACHINE TO
    // COME TO REST. That is a real event — it is just not this one. The player
    // is not being told the screen is idle; they are being told that XP they
    // earned has landed and is theirs. Punctuation was designed where a
    // transaction was asked for.
    //
    // The mistake is visible in the numbers, and it is the same mistake three
    // times, which is why one denial covered all three:
    //
    // | denied take | >3 kHz rms | <200 Hz rms | left after the landing |
    // |---|---|---|---|
    // | `a` dry stop     | 0.0059 | 0.0071 | 0.10 |
    // | `b` damped seat  | 0.0020 | 0.0183 | 0.12 |
    // | `c` low band     | 0.0017 | 0.0071 | 0.10 |
    //
    // Every one of them is a single layer; every one of them has EITHER a bright
    // detail OR a warm body, never both; and every one is over the instant it
    // arrives (the lowest late-over-early figures on the whole board). A gain is
    // warm and bright at once and leaves something behind — that is what makes it
    // read as *something was added* rather than as *something stopped*. The four
    // offers below are all held to both halves at once, measured against the
    // takes that were denied (`./candidates.test.ts`), and none of them is a
    // single layer.
    //
    // **Four readings of "sounds like XP collection", not four voicings of one.**
    // The brief's bar is that two candidates may not survive the same criticism,
    // so each one is a different answer to what collecting XP *is*:
    //
    //   d  **the deposit** — a measured quantity poured into a store and topping
    //      off. Collection as ACCRUAL: fine granular material arriving, a warm
    //      cell taking it, a body holding at its new level.
    //   e  **the credit** — two damped partials a fifth apart, struck together
    //      under a contact. Collection as a RECORD: the amount is acknowledged
    //      once and filed. A fifth and not a third — the interface does not
    //      congratulate (§4.7 register 2), and this cue can land on a defeat.
    //   f  **the uptake** — the corner OPENS across the body instead of closing,
    //      over a sub that arrives with it. Collection as the TOTAL RISING. This
    //      is the one that deliberately breaks the previous round's self-imposed
    //      rule that a settle must resolve downward or it "is a question" — that
    //      rule is the reason all three denied takes are terminations, and it was
    //      this lane's, not the developer's. If `f` is the one that reads, the
    //      rule was the defect.
    //   g  **the prize** — three narrow bands high up, quiet and short, over a
    //      warm low body. Collection as a SMALL BRIGHT REWARD, in the developer's
    //      own words for this family: *"like you've won a prize, but subtle"*
    //      (2026-08-14, on `oreCollect`) — the nearest thing on record to a
    //      positive statement of what a collection sound is supposed to do.
    //
    // **What is held constant across all four**, so the choice is about character
    // and nothing else: none is louder in rms or in peak than the loudest take
    // that was denied (brightness and warmth bought with level would be a
    // different offer, not a better one); all four stay under 0.3 s, well inside
    // the skip bound; and all four sit far beneath both the result sting and the
    // `levelUp` beat they follow, so the settle never competes with the pickup
    // ahead of it.
    label: "XP Settle",
    context: "Earned XP lands and is yours — the number has stopped moving and the total is final. Small and warm: the arrival of something already won.",
    current: 'xpSettle',
    candidates: [
      {
        id: 'd',
        slot: 'xpSettle',
        character: "a measure poured into a cell, topping off",
        spec: {
          name: 'xpSettle_d_deposit',
          layers: [
            grains('xpSettle_d.pour', { freq: 760, freqEnd: 520, grain: 0.0035, gain: 0.098, attack: 0.004, hold: 0.012, decay: 0.07, curve: 2.6, from: 4600, to: 1500, q: 3, hp: 500, seed: 35340 }),
            band('xpSettle_d.cell', 392, { gain: 0.054, decay: 0.2, q: 7, curve: 3.2, attack: 0.004, hold: 0.012, at: 0.028, seed: 35342 }),
            swept('xpSettle_d.hold', { wave: 'sine', freq: 98, from: 260, to: 380, q: 1.8, gain: 0.082, attack: 0.008, hold: 0.04, decay: 0.2, curve: 2.4, noiseMix: 0.05, at: 0.028, seed: 35344 }),
          ],
        },
      },
      {
        id: 'e',
        slot: 'xpSettle',
        character: "a credit recorded, two damped partials",
        spec: {
          name: 'xpSettle_e_credit',
          layers: [
            band('xpSettle_e.contact', 4400, { gain: 0.32, decay: 0.055, q: 3, curve: 5, punch: 0.5, hp: 1500, seed: 35350 }),
            ...plate('xpSettle_e.credit', 330, { gain: 0.057, decay: 0.17, ratios: [1, 1.5], q: 6, curve: 3.2, grain: 0.36, edge: 0, at: 0.012, seed: 35352 }),
            swept('xpSettle_e.ledger', { wave: 'sine', freq: 110, from: 300, to: 200, q: 1.8, gain: 0.072, attack: 0.006, hold: 0.05, decay: 0.19, curve: 2.4, noiseMix: 0.05, at: 0.012, seed: 35358 }),
          ],
        },
      },
      {
        id: 'f',
        slot: 'xpSettle',
        character: "an uptake, the corner opening as it takes",
        spec: {
          name: 'xpSettle_f_uptake',
          layers: [
            swept('xpSettle_f.air', { wave: 'noise', freq: 300, from: 2400, to: 5600, q: 3.2, gain: 0.125, attack: 0.01, hold: 0.012, decay: 0.06, curve: 2.2, hp: 1400, seed: 35360 }),
            swept('xpSettle_f.take', { wave: 'triangle', freq: 174.61, from: 320, to: 1500, q: 2.8, gain: 0.029, attack: 0.006, hold: 0.03, decay: 0.18, curve: 2.4, noiseMix: 0.16, at: 0.02, seed: 35362 }),
            swept('xpSettle_f.store', { wave: 'sine', freq: 87.31, from: 240, q: 1.7, gain: 0.068, attack: 0.008, hold: 0.05, decay: 0.2, curve: 2.4, noiseMix: 0.04, at: 0.02, seed: 35364 }),
          ],
        },
      },
      {
        id: 'g',
        slot: 'xpSettle',
        character: "a small bright prize over a warm body",
        spec: {
          name: 'xpSettle_g_prize',
          layers: [
            band('xpSettle_g.s0', 3300, { gain: 0.4, decay: 0.11, q: 8, curve: 4, hp: 1200, seed: 35370 }),
            band('xpSettle_g.s1', 4870, { gain: 0.31, decay: 0.09, q: 9, curve: 4.5, hp: 1600, at: 0.01, seed: 35372 }),
            band('xpSettle_g.s2', 5900, { gain: 0.22, decay: 0.07, q: 10, curve: 5, hp: 2000, at: 0.018, seed: 35374 }),
            swept('xpSettle_g.warm', { wave: 'triangle', freq: 146.83, from: 700, to: 300, q: 2.2, gain: 0.043, attack: 0.005, hold: 0.03, decay: 0.2, curve: 2.6, noiseMix: 0.12, seed: 35376 }),
            swept('xpSettle_g.body', { wave: 'sine', freq: 73.42, from: 220, q: 1.7, gain: 0.063, attack: 0.006, hold: 0.05, decay: 0.19, curve: 2.4, noiseMix: 0.04, seed: 35378 }),
          ],
        },
      },
    ],
    denied: [
      {
        id: 'a',
        slot: 'xpSettle',
        character: "a dry stop, one contact",
        deniedAt: '2026-08-16T02:29:03Z',
        reason: "none of these sound like sounds for XP collection",
        spec: {
          name: 'xpSettle_a_dryStop',
          layers: [
            grains('xpSettle_a.stop', { freq: 300, freqEnd: 240, grain: 0.004, gain: 0.2, hold: 0.008, decay: 0.09, curve: 5, from: 1100, to: 420, q: 2.6, hp: 150, seed: 35300 }),
          ],
        },
      },
      {
        id: 'b',
        slot: 'xpSettle',
        character: "a damped seat, closing",
        deniedAt: '2026-08-16T02:29:03Z',
        reason: "none of these sound like sounds for XP collection",
        spec: {
          name: 'xpSettle_b_dampedSeat',
          layers: [
            swept('xpSettle_b.seat', { wave: 'triangle', freq: 220, freqEnd: 208, from: 900, to: 240, q: 2.6, gain: 0.18, attack: 0.004, hold: 0.02, decay: 0.2, curve: 5, noiseMix: 0.09, seed: 35310 }),
          ],
        },
      },
      {
        id: 'c',
        slot: 'xpSettle',
        character: "one low band, ringing out",
        deniedAt: '2026-08-16T02:29:03Z',
        reason: "none of these sound like sounds for XP collection",
        spec: {
          name: 'xpSettle_c_lowBand',
          layers: [
            band('xpSettle_c.tone', 330, { gain: 0.5, decay: 0.2, q: 6, curve: 5, attack: 0.003, hold: 0.01, seed: 35320 }),
          ],
        },
      },
    ],
  },
};
