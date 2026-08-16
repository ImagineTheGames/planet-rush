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
import { band, grains, place, plate, swept } from './instrument';

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
  oreCollect: {
    label: "Ore Collect",
    context: "A loose ore chunk is tractored in",
    current: 'oreCollect',
    candidates: [
      {
        id: 'd',
        character: "flake shear, bright chips off the snap",
        spec: {
          name: 'oreCollect_d_flakeShear',
          layers: [
            ...plate('oreCollect_d.snap', 1400, { gain: 0.26, decay: 0.04, ratios: [1, 2.41], q: 8, curve: 6, punch: 0.6, grain: 0.34, seed: 30410 }),
            grains('oreCollect_d.flecks', { freq: 4300, freqEnd: 5600, grain: 0.0032, gain: 0.32, hold: 0.004, decay: 0.055, curve: 4.2, from: 6200, to: 4400, q: 5, hp: 2600, at: 0.01, seed: 30414 }),
            band('oreCollect_d.glint', 5900, { gain: 0.4, decay: 0.04, q: 10, curve: 4.5, hp: 3000, at: 0.022, seed: 30416 }),
          ],
        },
      },
      {
        id: 'e',
        character: "charged intake, an ionised edge",
        spec: {
          name: 'oreCollect_e_chargedIntake',
          layers: [
            swept('oreCollect_e.intake', { wave: 'triangle', freq: 520, from: 420, to: 2200, q: 5, gain: 0.08, attack: 0.002, hold: 0.01, decay: 0.05, curve: 3.8, noiseMix: 0.24, seed: 30420 }),
            swept('oreCollect_e.ion', { wave: 'noise', freq: 3400, from: 2600, to: 6200, q: 7, gain: 0.46, attack: 0.003, hold: 0.006, decay: 0.05, curve: 4, hp: 2600, at: 0.012, seed: 30422 }),
            grains('oreCollect_e.spark', { freq: 5200, grain: 0.0028, gain: 0.36, hold: 0.003, decay: 0.045, curve: 5, from: 6200, to: 4600, q: 4.5, hp: 3600, at: 0.026, seed: 30424 }),
          ],
        },
      },
      {
        id: 'f',
        character: "assay ping, two high bands reading back",
        spec: {
          name: 'oreCollect_f_assayPing',
          layers: [
            grains('oreCollect_f.contact', { freq: 1100, grain: 0.0025, gain: 0.28, hold: 0.003, decay: 0.026, curve: 6, from: 2600, to: 1200, q: 3, hp: 600, seed: 30430 }),
            // `band` passes very little of what enters it (see `./instrument`), so
            // a gain near 1 here is a quiet layer, not a hot one: this is the
            // quietest of the three offers by RMS and by peak.
            band('oreCollect_f.read0', 3600, { gain: 0.98, decay: 0.05, q: 11, curve: 5, hp: 2000, at: 0.008, seed: 30432 }),
            band('oreCollect_f.read1', 5700, { gain: 0.88, decay: 0.042, q: 12, curve: 5.5, hp: 3200, at: 0.022, seed: 30433 }),
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
  // === THE SOUNDTRACK AND THE AIR (a0-01b) ==================================
  //
  // Seven slots that play for a whole match, so nothing here is allowed to be an
  // event: no attack anyone can point at, no melody in the beds, nothing a player
  // notices twice. This family had the worst measured spread on the whole board
  // before this pass — `musicBed` and `musicDread` each scored a profile distance
  // of 0.00 against `current` AND against each other on every pair, because all
  // four sounds in each slot were the same sub-bass triad at four levels. Three
  // takes on one idea is exactly what the brief calls a fake choice, and here it
  // was literally true.
  //
  // So the three offers separate on *material*, which is the only axis a drone has:
  //
  //   a  a **granular bed** — particulate texture, no pitch centre to speak of
  //   b  **filtered analogue** — a low body behind a resonant corner, mass and weight
  //   c  **wide detuned space** — unisons beating against each other, with metal in
  //      the smear and a room behind it
  //
  // None of the looping offers names a `lowPassEnd` on a **sustained** layer, for
  // the reason the thruster comment gives: a corner travelling across a loop body
  // snaps back at the seam, once per lap, forever. `d`–`f` below do sweep — on
  // voices that have decayed to silence *before* the seam, which is the case the
  // rule was never about: a gesture that finishes has nothing left to snap.
  //
  // ---------------------------------------------------------------------------
  // ROUND 3, and only on this slot (a0-48, 2026-08-14)
  // ---------------------------------------------------------------------------
  //
  // The developer, on the SHIPPED bed: *"when i press play im immediately greeted
  // by this background sound that is deep and i dont see it anywhere in the
  // board... its annoying."* It was on the board — this slot — and they denied it
  // on 2026-08-07 with the deny-all reason; nothing was briefed to replace it, so
  // the denied sound was still playing a week later. `./bank` is rebuilt in the
  // same commit series; these are the offers that let the developer pick by ear.
  //
  // **The ids are `d`, `e`, `f` and the denied `a`/`b`/`c` are gone.** A letter is
  // how a verdict is recorded (`/status/sound-choices.json` holds `{"verdict":
  // "b"}` per slot), so re-offering under a denied letter makes the record
  // ambiguous forever: nobody reading it later can tell whether `deny-all` on
  // 2026-08-07 was aimed at the take that is in the file today. Every other slot
  // re-offers in place under a/b/c because none of them has a *live* verdict this
  // one has to be told apart from.
  //
  // The axis is not material this time — it is **how much bed there is at all**,
  // because that is what the complaint is about:
  //
  //   d  **almost nothing** — air and a far room, no low end whatsoever. The
  //      complaint is "deep"; this one answers it by having no depth to notice.
  //   e  **movement without a note** — no steady level anywhere: overlapping
  //      swells with the corners travelling, a floor barely there under them.
  //   f  **a felt low pulse** — keeps a low centre and a slow beat, the incumbent's
  //      own idea built out of the round-2 instrument instead of held sines.
  //
  // **And there is a fourth answer, which is none of them.** The bed is item 3 on
  // the GDD §4.9 ranked cut list and this file's own note says it was built to be
  // cuttable — nothing else in the mix depends on it. *Ship it off by default,
  // with a settings toggle* is a legitimate verdict on this slot, not a failure:
  // a bed nobody notices and a bed that is absent are close cousins, and one of
  // them cannot annoy anybody. It is recorded in `sound-review/manifest.json` as
  // this slot's `fourthOption` so it reads on the review page beside the three,
  // and it is the developer's call, not this lane's.
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
    ],
  },
  musicBed: {
    label: "Music Bed — Calm",
    context: "Mining / building with no active threat — the calm foundation drone.",
    current: 'musicBed',
    candidates: [
      {
        id: 'a',
        character: "granular bed, texture under an open fifth",
        spec: {
          name: 'musicBed_a_granularBed',
          loop: true,
          crossfade: 0.5,
          layers: [
            place({ name: 'musicBed_a.texture', wave: 'noise', attack: 0, hold: 7, decay: 0, freq: 430, lowPass: 1300, resonance: 3.4, highPass: 140, gain: 0.26, seed: 33030 }),
            place({ name: 'musicBed_a.grain', wave: 'noise', attack: 0, hold: 7, decay: 0, freq: 165, lowPass: 640, resonance: 4.2, gain: 0.2, seed: 33031 }),
            place({ name: 'musicBed_a.root', wave: 'triangle', attack: 0, hold: 7, decay: 0, freq: 55, noiseMix: 0.06, lowPass: 260, resonance: 2, gain: 0.2, seed: 33032 }),
            place({ name: 'musicBed_a.fifth', wave: 'sine', attack: 0, hold: 7, decay: 0, freq: 82.41, gain: 0.12, seed: 33033 }),
          ],
        },
      },
      {
        id: 'b',
        character: "filtered analogue triad, low and seated",
        spec: {
          name: 'musicBed_b_filteredAnalogue',
          loop: true,
          crossfade: 0.6,
          layers: [
            place({ name: 'musicBed_b.root', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 55, vibratoDepth: 0.004, vibratoRate: 0.09, noiseMix: 0.05, lowPass: 155, resonance: 3.6, gain: 0.4, seed: 33040 }),
            place({ name: 'musicBed_b.third', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 65.41, noiseMix: 0.05, lowPass: 150, resonance: 3.2, gain: 0.26, seed: 33041 }),
            place({ name: 'musicBed_b.fifth', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 82.41, lowPass: 160, resonance: 2.4, gain: 0.18, seed: 33042 }),
          ],
        },
      },
      {
        id: 'c',
        character: "wide detuned space, unisons beating",
        spec: {
          name: 'musicBed_c_detunedSpace',
          loop: true,
          crossfade: 0.6,
          layers: [
            place({ name: 'musicBed_c.u0', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 110, noiseMix: 0.07, lowPass: 720, resonance: 6, gain: 0.26, seed: 33050 }),
            place({ name: 'musicBed_c.u1', wave: 'triangle', attack: 0, hold: 8, decay: 0, freq: 110.8, noiseMix: 0.07, lowPass: 700, resonance: 6, gain: 0.24, seed: 33051 }),
            place({ name: 'musicBed_c.u2', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 164.81, vibratoDepth: 0.003, vibratoRate: 0.05, lowPass: 900, resonance: 4, gain: 0.16, seed: 33052 }),
            place({ name: 'musicBed_c.floor', wave: 'sine', attack: 0, hold: 8, decay: 0, freq: 55, gain: 0.16, seed: 33053 }),
          ],
        },
      },
    ],
  },
  musicPulse: {
    label: "Music Pulse — Rising Tension",
    context: "Threat detected, tension climbing toward a siege — a heartbeat over a floor.",
    current: 'musicPulse',
    candidates: [
      {
        id: 'a',
        character: "a dry contact pulse, machine-timed",
        spec: {
          name: 'musicPulse_a_contactPulse',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'musicPulse_a.floor', wave: 'noise', attack: 0, hold: 0.75, decay: 0, freq: 90, lowPass: 280, resonance: 2.4, gain: 0.1, seed: 33060 }),
            grains('musicPulse_a.hit', { freq: 340, freqEnd: 190, grain: 0.008, gain: 0.34, attack: 0.002, hold: 0.02, decay: 0.16, curve: 4, from: 1500, q: 3, hp: 110, punch: 0.5, seed: 33061 }),
            grains('musicPulse_a.tail', { freq: 210, freqEnd: 140, grain: 0.022, gain: 0.16, attack: 0.004, hold: 0.03, decay: 0.3, curve: 3, from: 700, q: 2.6, at: 0.06, seed: 33062 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a low pressure thud, a room under it",
        spec: {
          name: 'musicPulse_b_pressureThud',
          loop: true,
          crossfade: 0.05,
          layers: [
            place({ name: 'musicPulse_b.floor', wave: 'sine', attack: 0, hold: 1, decay: 0, freq: 55, noiseMix: 0.04, lowPass: 200, resonance: 2, gain: 0.1, seed: 33070 }),
            swept('musicPulse_b.thud', { wave: 'sine', freq: 104, freqEnd: 44, from: 320, to: 110, q: 2.4, gain: 0.38, attack: 0.004, hold: 0.02, decay: 0.34, curve: 2.8, punch: 0.6, seed: 33071 }),
            swept('musicPulse_b.room', { wave: 'noise', freq: 130, freqEnd: 80, from: 420, to: 160, q: 1.8, gain: 0.14, attack: 0.02, hold: 0.04, decay: 0.4, curve: 2, at: 0.09, seed: 33072 }),
          ],
        },
      },
      {
        id: 'c',
        character: "a narrow band pip, doubling",
        spec: {
          name: 'musicPulse_c_bandPip',
          loop: true,
          crossfade: 0.03,
          layers: [
            place({ name: 'musicPulse_c.floor', wave: 'triangle', attack: 0, hold: 0.8, decay: 0, freq: 55, noiseMix: 0.05, lowPass: 240, resonance: 2.2, gain: 0.1, seed: 33080 }),
            band('musicPulse_c.p0', 620, { gain: 0.92, decay: 0.1, q: 5.5, curve: 5, attack: 0.002, seed: 33081 }),
            band('musicPulse_c.p1', 465, { gain: 0.8, decay: 0.16, q: 6, curve: 4.5, attack: 0.002, at: 0.19, seed: 33082 }),
          ],
        },
      },
    ],
  },
  musicTheme: {
    // §7.5 re-voices this slot and says what to keep: *"same riff, same key"*. So
    // all three offers sound the shipped seven notes — A3 C4 E4 D4 C4 A3 E3 — at
    // the shipped times, and the ONLY thing the developer is choosing between is
    // what is playing them. That is the whole thesis of the round in one slot:
    // round 1 changed the oscillator under this riff and the developer heard the
    // same music. The instrument is the offer.
    label: "Music Theme — Siege",
    context: "Active combat / base under assault — a short A-minor riff over a pad.",
    current: 'musicTheme',
    candidates: [
      {
        id: 'a',
        character: "the riff as grained plucks, no sustain",
        spec: {
          name: 'musicTheme_a_grainedPlucks',
          loop: true,
          crossfade: 0.08,
          layers: [
            place({ name: 'musicTheme_a.pad', wave: 'noise', attack: 0, hold: 4, decay: 0, freq: 220, lowPass: 700, resonance: 3.6, highPass: 90, gain: 0.14, seed: 33090 }),
            grains('musicTheme_a.n0', { freq: 220, freqEnd: 176, grain: 0.007, gain: 0.21, attack: 0.003, hold: 0.03, decay: 0.3, curve: 3.6, from: 1500, q: 3.4, hp: 150, seed: 33091 }),
            grains('musicTheme_a.n1', { freq: 261.63, freqEnd: 209, grain: 0.007, gain: 0.21, attack: 0.003, hold: 0.03, decay: 0.3, curve: 3.6, from: 1700, q: 3.4, hp: 170, at: 0.5, seed: 33092 }),
            grains('musicTheme_a.n2', { freq: 329.63, freqEnd: 264, grain: 0.006, gain: 0.21, attack: 0.003, hold: 0.035, decay: 0.36, curve: 3.6, from: 2100, q: 3.4, hp: 200, at: 1, seed: 33093 }),
            grains('musicTheme_a.n3', { freq: 293.66, freqEnd: 235, grain: 0.006, gain: 0.196, attack: 0.003, hold: 0.035, decay: 0.42, curve: 3.6, from: 1900, q: 3.4, hp: 190, at: 1.5, seed: 33094 }),
            grains('musicTheme_a.n4', { freq: 261.63, freqEnd: 209, grain: 0.007, gain: 0.196, attack: 0.003, hold: 0.035, decay: 0.42, curve: 3.6, from: 1700, q: 3.4, hp: 170, at: 2.1, seed: 33095 }),
            grains('musicTheme_a.n5', { freq: 220, freqEnd: 176, grain: 0.007, gain: 0.182, attack: 0.004, hold: 0.05, decay: 0.7, curve: 3.4, from: 1500, q: 3.4, hp: 150, at: 2.7, seed: 33096 }),
            grains('musicTheme_a.n6', { freq: 164.81, freqEnd: 132, grain: 0.009, gain: 0.182, attack: 0.004, hold: 0.07, decay: 0.56, curve: 3.4, from: 1100, q: 3.2, hp: 110, at: 3.3, seed: 33097 }),
          ],
        },
      },
      {
        id: 'b',
        character: "the riff on filtered analogue, corner closing",
        spec: {
          name: 'musicTheme_b_filteredAnalogue',
          loop: true,
          crossfade: 0.08,
          layers: [
            place({ name: 'musicTheme_b.pad', wave: 'triangle', attack: 0, hold: 4, decay: 0, freq: 110, noiseMix: 0.05, lowPass: 260, resonance: 3, gain: 0.18, seed: 33100 }),
            swept('musicTheme_b.n0', { wave: 'triangle', freq: 220, from: 2625, to: 380, q: 5.5, gain: 0.3, attack: 0.004, hold: 0.028, decay: 0.352, curve: 3.6, noiseMix: 0.1, seed: 33101 }),
            swept('musicTheme_b.n1', { wave: 'triangle', freq: 261.63, from: 2975, to: 430, q: 5.5, gain: 0.3, attack: 0.004, hold: 0.028, decay: 0.352, curve: 3.6, noiseMix: 0.1, at: 0.5, seed: 33102 }),
            swept('musicTheme_b.n2', { wave: 'triangle', freq: 329.63, from: 3675, to: 540, q: 5.5, gain: 0.3, attack: 0.004, hold: 0.035, decay: 0.416, curve: 3.6, noiseMix: 0.1, at: 1, seed: 33103 }),
            swept('musicTheme_b.n3', { wave: 'triangle', freq: 293.66, from: 3325, to: 480, q: 5.5, gain: 0.29, attack: 0.004, hold: 0.035, decay: 0.48, curve: 3.6, noiseMix: 0.1, at: 1.5, seed: 33104 }),
            swept('musicTheme_b.n4', { wave: 'triangle', freq: 261.63, from: 2975, to: 430, q: 5.5, gain: 0.29, attack: 0.004, hold: 0.035, decay: 0.48, curve: 3.6, noiseMix: 0.1, at: 2.1, seed: 33105 }),
            swept('musicTheme_b.n5', { wave: 'triangle', freq: 220, from: 2625, to: 380, q: 5.5, gain: 0.28, attack: 0.006, hold: 0.049, decay: 0.8, curve: 3.6, noiseMix: 0.1, at: 2.7, seed: 33106 }),
            swept('musicTheme_b.n6', { wave: 'triangle', freq: 164.81, from: 1925, to: 300, q: 5.5, gain: 0.28, attack: 0.006, hold: 0.07, decay: 0.64, curve: 3.6, noiseMix: 0.1, at: 3.3, seed: 33107 }),
          ],
        },
      },
      {
        id: 'c',
        character: "the riff in detuned metal, space behind it",
        spec: {
          name: 'musicTheme_c_detunedMetal',
          loop: true,
          crossfade: 0.08,
          layers: [
            place({ name: 'musicTheme_c.pad', wave: 'triangle', attack: 0, hold: 4, decay: 0, freq: 110, noiseMix: 0.08, lowPass: 800, resonance: 5.5, gain: 0.14, seed: 33110 }),
            place({ name: 'musicTheme_c.pad2', wave: 'triangle', attack: 0, hold: 4, decay: 0, freq: 110.6, noiseMix: 0.08, lowPass: 800, resonance: 5.5, gain: 0.12, seed: 33111 }),
            ...plate('musicTheme_c.n0', 220, { gain: 0.3, decay: 0.352, ratios: [1, 2.41], q: 8, curve: 3.6, grain: 0.22, edge: 0.5, seed: 33112 }),
            ...plate('musicTheme_c.n1', 261.63, { gain: 0.3, decay: 0.352, ratios: [1, 2.41], q: 8, curve: 3.6, grain: 0.22, edge: 0.5, at: 0.5, seed: 33115 }),
            ...plate('musicTheme_c.n2', 329.63, { gain: 0.3, decay: 0.416, ratios: [1, 2.41], q: 8, curve: 3.6, grain: 0.22, edge: 0.5, at: 1, seed: 33118 }),
            ...plate('musicTheme_c.n3', 293.66, { gain: 0.29, decay: 0.48, ratios: [1, 2.41], q: 8, curve: 3.6, grain: 0.22, edge: 0.5, at: 1.5, seed: 33121 }),
            ...plate('musicTheme_c.n4', 261.63, { gain: 0.29, decay: 0.48, ratios: [1, 2.41], q: 8, curve: 3.6, grain: 0.22, edge: 0.5, at: 2.1, seed: 33124 }),
            ...plate('musicTheme_c.n5', 220, { gain: 0.28, decay: 0.8, ratios: [1, 2.41], q: 8, curve: 3.4, grain: 0.22, edge: 0.5, at: 2.7, seed: 33127 }),
            ...plate('musicTheme_c.n6', 164.81, { gain: 0.28, decay: 0.64, ratios: [1, 2.41], q: 8, curve: 3.4, grain: 0.22, edge: 0.5, at: 3.3, seed: 33130 }),
          ],
        },
      },
    ],
  },
  musicDread: {
    label: "Music Dread — Collapse",
    context: "Core critical, defeat imminent — no melody, no resolution; thinning dread.",
    current: 'musicDread',
    candidates: [
      {
        id: 'a',
        character: "a grinding grain bed, no pitch centre",
        spec: {
          name: 'musicDread_a_grindingGrain',
          loop: true,
          crossfade: 0.4,
          layers: [
            place({ name: 'musicDread_a.grind', wave: 'noise', attack: 0, hold: 6, decay: 0, freq: 260, lowPass: 820, resonance: 3.8, highPass: 110, gain: 0.3, seed: 33140 }),
            place({ name: 'musicDread_a.scrape', wave: 'noise', attack: 0, hold: 6, decay: 0, freq: 96, lowPass: 340, resonance: 4.4, gain: 0.24, seed: 33141 }),
            place({ name: 'musicDread_a.floor', wave: 'sine', attack: 0, hold: 6, decay: 0, freq: 41.2, gain: 0.18, seed: 33142 }),
          ],
        },
      },
      {
        id: 'b',
        character: "sub rumble with pressure in the room",
        spec: {
          name: 'musicDread_b_pressureRumble',
          loop: true,
          crossfade: 0.5,
          layers: [
            place({ name: 'musicDread_b.rumble', wave: 'triangle', attack: 0, hold: 7, decay: 0, freq: 41.2, noiseMix: 0.1, lowPass: 130, resonance: 4, gain: 0.44, seed: 33150 }),
            place({ name: 'musicDread_b.beat', wave: 'sine', attack: 0, hold: 7, decay: 0, freq: 41.55, lowPass: 130, resonance: 2.6, gain: 0.28, seed: 33151 }),
            place({ name: 'musicDread_b.sub', wave: 'sine', attack: 0, hold: 7, decay: 0, freq: 30.9, gain: 0.2, seed: 33152 }),
          ],
        },
      },
      {
        id: 'c',
        character: "detuned unisons beating, metal in the smear",
        spec: {
          name: 'musicDread_c_metalSmear',
          loop: true,
          crossfade: 0.45,
          layers: [
            place({ name: 'musicDread_c.band', wave: 'noise', attack: 0, hold: 6, decay: 0, freq: 165, lowPass: 400, resonance: 11, bandPass: true, gain: 0.4, seed: 33160 }),
            place({ name: 'musicDread_c.u0', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 82.41, noiseMix: 0.08, lowPass: 560, resonance: 6, gain: 0.24, seed: 33161 }),
            place({ name: 'musicDread_c.u1', wave: 'triangle', attack: 0, hold: 6, decay: 0, freq: 87.31, noiseMix: 0.08, lowPass: 560, resonance: 6, gain: 0.22, seed: 33162 }),
            place({ name: 'musicDread_c.floor', wave: 'sine', attack: 0, hold: 6, decay: 0, freq: 27.5, gain: 0.14, seed: 33163 }),
          ],
        },
      },
    ],
  },
  musicWin: {
    label: "Victory Sting",
    context: "Match won (after the three-second quiet) — one-shot, rising major arpeggio.",
    current: 'musicWin',
    candidates: [
      {
        id: 'a',
        character: "three dry hits rising, no shine",
        spec: {
          name: 'musicWin_a_dryHits',
          layers: [
            grains('musicWin_a.n0', { freq: 440, freqEnd: 350, grain: 0.006, gain: 0.34, attack: 0.005, hold: 0.06, decay: 0.14, curve: 4, from: 2200, to: 900, q: 3.4, hp: 300, seed: 33170 }),
            grains('musicWin_a.n1', { freq: 554.37, freqEnd: 440, grain: 0.005, gain: 0.32, attack: 0.005, hold: 0.06, decay: 0.16, curve: 4, from: 2800, to: 1150, q: 3.4, hp: 380, at: 0.12, seed: 33171 }),
            grains('musicWin_a.n2', { freq: 659.25, freqEnd: 520, grain: 0.005, gain: 0.3, attack: 0.005, hold: 0.09, decay: 0.5, curve: 3.4, from: 3300, to: 1350, q: 3.6, hp: 440, at: 0.26, seed: 33172 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a low swell lifting, weight behind it",
        spec: {
          name: 'musicWin_b_lowSwell',
          layers: [
            swept('musicWin_b.lift', { wave: 'triangle', freq: 220, from: 400, to: 2200, q: 4, gain: 0.36, attack: 0.03, hold: 0.16, decay: 0.1, curve: 2.4, noiseMix: 0.12, seed: 33180 }),
            swept('musicWin_b.top', { wave: 'triangle', freq: 330, from: 2000, to: 620, q: 4.4, gain: 0.4, attack: 0.006, hold: 0.06, decay: 0.5, curve: 2.8, punch: 0.4, noiseMix: 0.1, at: 0.28, seed: 33181 }),
            swept('musicWin_b.floor', { wave: 'sine', freq: 110, from: 300, q: 1.8, gain: 0.24, attack: 0.01, hold: 0.1, decay: 0.44, curve: 2.4, at: 0.04, seed: 33182 }),
          ],
        },
      },
      {
        id: 'c',
        character: "bands opening, metal ringing out",
        spec: {
          name: 'musicWin_c_bandsOpening',
          layers: [
            band('musicWin_c.n0', 440, { gain: 0.46, decay: 0.14, q: 8, curve: 4.5, attack: 0.003, hold: 0.01, seed: 33190 }),
            band('musicWin_c.n1', 554.37, { gain: 0.44, decay: 0.18, q: 8.5, curve: 4.2, attack: 0.003, hold: 0.01, at: 0.12, seed: 33191 }),
            ...plate('musicWin_c.n2', 659.25, { gain: 0.46, decay: 0.56, ratios: [1, 2.41], q: 9, curve: 3.6, grain: 0.18, edge: 0.6, at: 0.26, seed: 33193 }),
          ],
        },
      },
    ],
  },
  musicLoss: {
    // *"The one thing in the soundtrack allowed to be sad"* (§7.5). All three fall
    // and none of them lands anywhere: no offer here resolves to its root, and no
    // offer runs past the shipped 1.32 s longest-tail invariant (§8) — a winner
    // has to be promotable into the bank without breaking the beat it protects.
    label: "Defeat Sting",
    context: "Match lost (after the three-second quiet) — one-shot, falling minor phrase that settles low.",
    current: 'musicLoss',
    candidates: [
      {
        id: 'a',
        character: "a grained fall, everything letting go",
        spec: {
          name: 'musicLoss_a_grainedFall',
          layers: [
            grains('musicLoss_a.n0', { freq: 220, freqEnd: 186, grain: 0.012, gain: 0.32, attack: 0.012, hold: 0.14, decay: 0.2, curve: 3, from: 1000, to: 560, q: 3, hp: 90, seed: 33200 }),
            grains('musicLoss_a.n1', { freq: 174.61, freqEnd: 148, grain: 0.014, gain: 0.3, attack: 0.014, hold: 0.14, decay: 0.24, curve: 2.8, from: 800, to: 440, q: 3, hp: 70, at: 0.3, seed: 33201 }),
            grains('musicLoss_a.n2', { freq: 130.81, freqEnd: 108, grain: 0.018, gain: 0.28, attack: 0.016, hold: 0.16, decay: 0.5, curve: 2.4, from: 600, to: 300, q: 2.8, hp: 55, at: 0.62, seed: 33202 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a low descent, pressure leaving",
        spec: {
          name: 'musicLoss_b_pressureLeaving',
          layers: [
            swept('musicLoss_b.n0', { wave: 'triangle', freq: 164.81, freqEnd: 155.56, from: 560, to: 230, q: 4, gain: 0.34, attack: 0.014, hold: 0.14, decay: 0.22, curve: 2.6, noiseMix: 0.1, seed: 33210 }),
            swept('musicLoss_b.n1', { wave: 'triangle', freq: 123.47, freqEnd: 116.54, from: 400, to: 170, q: 4, gain: 0.34, attack: 0.016, hold: 0.14, decay: 0.26, curve: 2.4, noiseMix: 0.1, at: 0.3, seed: 33211 }),
            swept('musicLoss_b.n2', { wave: 'sine', freq: 82.41, freqEnd: 73.42, from: 200, to: 88, q: 2.6, gain: 0.38, attack: 0.02, hold: 0.16, decay: 0.52, curve: 2, noiseMix: 0.06, at: 0.62, seed: 33212 }),
          ],
        },
      },
      {
        id: 'c',
        character: "one detuned toll, unresolved",
        spec: {
          name: 'musicLoss_c_detunedToll',
          layers: [
            swept('musicLoss_c.toll', { wave: 'triangle', freq: 146.83, freqEnd: 138, from: 760, to: 260, q: 5, gain: 0.54, attack: 0.008, hold: 0.03, decay: 0.62, curve: 2.6, noiseMix: 0.12, seed: 33220 }),
            swept('musicLoss_c.beat', { wave: 'triangle', freq: 148.6, freqEnd: 139.6, from: 720, to: 250, q: 5, gain: 0.4, attack: 0.01, hold: 0.03, decay: 0.6, curve: 2.6, noiseMix: 0.12, at: 0.012, seed: 33221 }),
            ...returns('musicLoss_c.room', { freq: 300, gain: 0.18, decay: 0.3, from: 700, to: 240, at: 0.42, gap: 0.3, count: 2, seed: 33223 }),
          ],
        },
      },
    ],
  },
  // === THE INTERFACE FALLBACKS (a0-01b) =====================================
  //
  // **Read §7.6 before judging these by ear in the running game.** Since s6-01
  // the app routes `press`, `confirm`, `reject`, `hover`, `detent`, `back`,
  // `accept`, `join` and `rush` to the ratified Gantry/Bone set in `./ui-cues`.
  // `CUE_SOUND` — these — is the fallback for when there is no cue player at all.
  // Choosing one of these changes what a fallback sounds like, not what the
  // developer hears clicking around the build, and a reviewer expecting the
  // opposite will conclude nothing changed.
  //
  // At interface scale the three tools are the same three, shrunk to a few tens
  // of milliseconds, and one of them loses a limb: no offer in this family gets
  // `returns`. A tail on a 28 ms tick is not space, it is smear, and on a phone
  // speaker it is the difference between a click and a thud.
  //
  //   a  a **dry contact** — grains, no tone, nothing rings
  //   b  a **damped pip** — a low body behind a closing corner, felt not heard
  //   c  a **narrow band** — one resonant partial, machine-clean
  //
  // §8's `rejectBuzz` / `coreHit` pair runs through here — *your buy was refused*
  // against *your reactor is taking damage* — and §7.6's own note says re-voicing
  // reject upward is what protects it. Every offer below sits above 300 Hz of
  // spectral centre; the fight family's core offers all sit under 250.
  pressTick: {
    // §7.6 asks for the ratified family root, A♭6 = 1661 Hz, so the fallback and
    // the real `pick` cue agree instead of diverging. All three are built on it
    // or an octave under it.
    label: "Press Tick",
    context: "A wheel wedge / menu control was pressed — the lightest possible click, heard dozens of times a match.",
    current: 'pressTick',
    candidates: [
      {
        id: 'a',
        character: "a dry contact, no tone in it",
        spec: {
          name: 'pressTick_a_dryContact',
          layers: [
            grains('pressTick_a.contact', { freq: 1661, freqEnd: 1200, grain: 0.002, gain: 0.26, hold: 0.004, decay: 0.02, curve: 5, from: 5200, to: 2200, q: 2.8, hp: 700, seed: 34000 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a damped pip, felt more than heard",
        spec: {
          name: 'pressTick_b_dampedPip',
          layers: [
            swept('pressTick_b.pip', { wave: 'triangle', freq: 830, from: 2400, to: 700, q: 3.2, gain: 0.2, attack: 0.0006, hold: 0.003, decay: 0.022, curve: 5, noiseMix: 0.2, seed: 34010 }),
          ],
        },
      },
      {
        id: 'c',
        character: "one narrow band at the family root",
        spec: {
          name: 'pressTick_c_familyRoot',
          layers: [
            band('pressTick_c.root', 1661, { gain: 0.95, decay: 0.024, q: 5, curve: 6, seed: 34020 }),
          ],
        },
      },
    ],
  },
  purchaseConfirm: {
    label: "Purchase Confirm",
    context: "A purchase or repair committed — a rising two-beat 'done'.",
    current: 'purchaseConfirm',
    candidates: [
      {
        id: 'a',
        character: "two dry contacts, rising",
        spec: {
          name: 'purchaseConfirm_a_dryContacts',
          layers: [
            grains('purchaseConfirm_a.n0', { freq: 620, freqEnd: 500, grain: 0.004, gain: 0.28, hold: 0.012, decay: 0.05, curve: 5, from: 2600, to: 1100, q: 3.2, hp: 320, seed: 34030 }),
            grains('purchaseConfirm_a.n1', { freq: 930, freqEnd: 740, grain: 0.003, gain: 0.26, hold: 0.016, decay: 0.1, curve: 4.5, from: 3600, to: 1500, q: 3.4, hp: 420, at: 0.045, seed: 34031 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a low seat, the buy landing",
        spec: {
          name: 'purchaseConfirm_b_buyLanding',
          layers: [
            swept('purchaseConfirm_b.n0', { wave: 'triangle', freq: 330, from: 1400, to: 480, q: 3.6, gain: 0.28, attack: 0.002, hold: 0.02, decay: 0.06, curve: 4, noiseMix: 0.16, seed: 34040 }),
            swept('purchaseConfirm_b.n1', { wave: 'triangle', freq: 440, from: 1700, to: 560, q: 3.8, gain: 0.32, attack: 0.002, hold: 0.026, decay: 0.13, curve: 3.4, punch: 0.3, noiseMix: 0.12, at: 0.05, seed: 34041 }),
          ],
        },
      },
      {
        id: 'c',
        character: "two narrow bands, a fourth apart",
        spec: {
          name: 'purchaseConfirm_c_bandsFourth',
          layers: [
            band('purchaseConfirm_c.n0', 587, { gain: 0.44, decay: 0.05, q: 6.5, curve: 5.5, seed: 34050 }),
            ...plate('purchaseConfirm_c.n1', 784, { gain: 0.28, decay: 0.13, ratios: [1, 2.41], q: 8, curve: 4.5, grain: 0.2, edge: 0.6, at: 0.045, seed: 34052 }),
          ],
        },
      },
    ],
  },
  rejectBuzz: {
    label: "Reject Buzz",
    context: "A buy the player can't afford — a low, flat, faintly gritty 'nope' that falls a little and stops.",
    current: 'rejectBuzz',
    candidates: [
      // §7.6: two notes a **minor second** apart resolving nowhere — the ratified
      // `refused` shape, so the fallback carries the same meaning as the real cue.
      // All three keep the interval and the "goes nowhere"; the material differs.
      {
        id: 'a',
        character: "grit refusal, dry and flat",
        spec: {
          name: 'rejectBuzz_a_gritRefusal',
          layers: [
            grains('rejectBuzz_a.n0', { freq: 440, freqEnd: 400, grain: 0.0055, gain: 0.34, hold: 0.03, decay: 0.05, curve: 3.4, from: 1500, to: 900, q: 2.8, hp: 200, seed: 34060 }),
            grains('rejectBuzz_a.n1', { freq: 415.3, freqEnd: 380, grain: 0.006, gain: 0.32, hold: 0.04, decay: 0.06, curve: 3, from: 1300, to: 760, q: 2.8, hp: 190, at: 0.055, seed: 34061 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a blocked thud, nothing opens",
        spec: {
          name: 'rejectBuzz_b_blockedThud',
          layers: [
            swept('rejectBuzz_b.n0', { wave: 'triangle', freq: 466.16, from: 1700, to: 640, q: 3, gain: 0.34, attack: 0.002, hold: 0.03, decay: 0.05, curve: 3.6, punch: 0.3, noiseMix: 0.2, seed: 34070 }),
            swept('rejectBuzz_b.n1', { wave: 'triangle', freq: 440, from: 1450, to: 540, q: 3, gain: 0.32, attack: 0.002, hold: 0.04, decay: 0.07, curve: 3, noiseMix: 0.22, at: 0.055, seed: 34071 }),
          ],
        },
      },
      {
        id: 'c',
        character: "two bands a semitone apart, unresolved",
        spec: {
          name: 'rejectBuzz_c_semitoneBands',
          layers: [
            band('rejectBuzz_c.n0', 523.25, { gain: 0.95, decay: 0.06, q: 5, curve: 4.5, attack: 0.002, hold: 0.02, seed: 34080 }),
            band('rejectBuzz_c.n1', 493.88, { gain: 0.92, decay: 0.09, q: 5.2, curve: 4, attack: 0.002, hold: 0.02, at: 0.055, seed: 34081 }),
          ],
        },
      },
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
    // §8 guards this against `spawnPulse` at ×1.20 of centroid — the respawn
    // countdown against the spawn-protection tick, two quiet repeating sounds a
    // dead player hears back to back. They are given opposite metaphors on
    // purpose: spawnPulse is a **field** (soft, particulate, low) and this is a
    // **clock** (hard, narrow, and above it on every offer).
    label: "Respawn Beep",
    context: "A tick of the respawn countdown — one clean mid beep a second, deliberately plain, a clock.",
    current: 'respawnBeep',
    candidates: [
      {
        id: 'a',
        character: "a dry clock contact, no ring",
        spec: {
          name: 'respawnBeep_a_clockContact',
          layers: [
            grains('respawnBeep_a.tick', { freq: 1100, freqEnd: 880, grain: 0.0025, gain: 0.3, hold: 0.02, decay: 0.06, curve: 4.5, from: 3800, to: 1600, q: 3, hp: 500, seed: 34090 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a countdown pip with weight in it",
        spec: {
          name: 'respawnBeep_b_weightedPip',
          layers: [
            swept('respawnBeep_b.pip', { wave: 'triangle', freq: 587, from: 2000, to: 760, q: 3.6, gain: 0.3, attack: 0.003, hold: 0.026, decay: 0.07, curve: 3.6, punch: 0.3, noiseMix: 0.14, seed: 34100 }),
          ],
        },
      },
      {
        id: 'c',
        character: "a narrow band tone, machine-clean",
        spec: {
          name: 'respawnBeep_c_machineClean',
          layers: [
            band('respawnBeep_c.tone', 880, { gain: 0.95, decay: 0.09, q: 5.5, curve: 4.5, attack: 0.003, hold: 0.02, seed: 34110 }),
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
        id: 'a',
        character: "release into a dry contact",
        spec: {
          name: 'respawnGo_a_releaseContact',
          layers: [
            grains('respawnGo_a.release', { freq: 520, freqEnd: 900, grain: 0.0035, gain: 0.3, hold: 0.03, decay: 0.05, curve: 3, from: 1400, to: 4200, q: 3, hp: 300, seed: 34120 }),
            grains('respawnGo_a.top', { freq: 1200, freqEnd: 950, grain: 0.003, gain: 0.28, hold: 0.016, decay: 0.11, curve: 4, from: 4400, to: 1800, q: 3.4, hp: 550, at: 0.1, seed: 34121 }),
          ],
        },
      },
      {
        id: 'b',
        character: "pressure dumping, mass leaving",
        spec: {
          name: 'respawnGo_b_massLeaving',
          layers: [
            swept('respawnGo_b.dump', { wave: 'noise', freq: 200, freqEnd: 320, from: 500, to: 2400, q: 2.6, gain: 0.3, attack: 0.006, hold: 0.04, decay: 0.06, curve: 2.6, seed: 34130 }),
            swept('respawnGo_b.body', { wave: 'triangle', freq: 262, from: 900, to: 380, q: 3.4, gain: 0.36, attack: 0.003, hold: 0.03, decay: 0.14, curve: 3, punch: 0.4, noiseMix: 0.14, at: 0.09, seed: 34131 }),
          ],
        },
      },
      {
        id: 'c',
        character: "a band sweeping open, launch clear",
        spec: {
          name: 'respawnGo_c_bandOpening',
          layers: [
            swept('respawnGo_c.open', { wave: 'noise', freq: 440, from: 700, to: 4600, q: 8, gain: 0.42, attack: 0.005, hold: 0.04, decay: 0.06, curve: 2.6, seed: 34140 }),
            ...plate('respawnGo_c.clear', 1046, { gain: 0.4, decay: 0.14, ratios: [1, 2.41], q: 9, curve: 4.5, grain: 0.18, edge: 0.7, at: 0.1, seed: 34142 }),
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
    label: "Minimap Ping",
    context: "The minimap toggle (the ping mechanic itself was cut) — it locates; it must never read as an alarm.",
    current: 'minimapPing',
    candidates: [
      {
        id: 'a',
        character: "a grained sweep, sonar through dust",
        spec: {
          name: 'minimapPing_a_dustSonar',
          layers: [
            grains('minimapPing_a.sweep', { freq: 600, freqEnd: 1150, grain: 0.004, gain: 0.3, attack: 0.004, hold: 0.05, decay: 0.24, curve: 3, from: 1500, to: 4000, q: 3.2, hp: 320, seed: 34150 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a round pulse returning, low and soft",
        spec: {
          name: 'minimapPing_b_returningPulse',
          layers: [
            swept('minimapPing_b.out', { wave: 'triangle', freq: 392, from: 700, to: 2200, q: 3.6, gain: 0.42, attack: 0.006, hold: 0.04, decay: 0.08, curve: 2.6, noiseMix: 0.12, seed: 34160 }),
            swept('minimapPing_b.back', { wave: 'triangle', freq: 294, from: 1800, to: 520, q: 3.4, gain: 0.4, attack: 0.006, hold: 0.03, decay: 0.2, curve: 3, noiseMix: 0.1, at: 0.1, seed: 34161 }),
          ],
        },
      },
      {
        id: 'c',
        character: "two narrow bands, a sonar return",
        spec: {
          name: 'minimapPing_c_sonarReturn',
          layers: [
            band('minimapPing_c.out', 1760, { gain: 0.95, decay: 0.11, q: 5.5, curve: 4.5, attack: 0.003, hold: 0.014, seed: 34170 }),
            band('minimapPing_c.back', 1175, { gain: 0.8, decay: 0.18, q: 6, curve: 4, attack: 0.004, hold: 0.014, at: 0.09, seed: 34171 }),
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
