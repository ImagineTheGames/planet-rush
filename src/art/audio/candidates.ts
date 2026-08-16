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
  /** Exactly three candidates, one letter each ({@link SoundCandidate.id}). */
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
            band('holdFull_f.read0', 740, { gain: 0.66, decay: 0.09, q: 8, curve: 5, attack: 0.002, hold: 0.008, seed: 60510 }),
            band('holdFull_f.read1', 990, { gain: 0.7, decay: 0.14, q: 9, curve: 4.5, attack: 0.002, hold: 0.01, at: 0.145, seed: 60512 }),
            grains('holdFull_f.meter', { freq: 300, grain: 0.006, gain: 0.16, hold: 0.02, decay: 0.1, curve: 4, from: 1100, to: 500, q: 2.6, at: 0.02, seed: 60514 }),
          ],
        },
      },
      {
        id: 'g',
        character: "it says so twice and stops",
        spec: {
          name: 'holdFull_g_saysSoTwice',
          layers: [
            band('holdFull_g.one', 640, { gain: 0.5, decay: 0.045, q: 5, curve: 6.5, punch: 0.35, seed: 60520 }),
            band('holdFull_g.two', 640, { gain: 0.5, decay: 0.075, q: 5, curve: 6, punch: 0.35, at: 0.13, seed: 60522 }),
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
  turretFire: {
    label: "Turret Fire",
    context: "Your turret or ship fires a shot.",
    current: 'turretFire',
    candidates: [
      {
        id: 'd',
        character: "rail contact, dry snap and eddy",
        spec: {
          name: 'turretFire_d_railContact',
          layers: [
            band('turretFire_d.contact', 2050, { gain: 0.5, decay: 0.022, q: 7, curve: 7, punch: 0.7, seed: 60010 }),
            swept('turretFire_d.eddy', { wave: 'triangle', freq: 205, from: 1600, to: 300, q: 5, gain: 0.3, attack: 0.0006, hold: 0.004, decay: 0.05, curve: 6.5, noiseMix: 0.34, seed: 60012 }),
          ],
        },
      },
      {
        id: 'e',
        character: "compressed vent, body and gas",
        spec: {
          name: 'turretFire_e_compressedVent',
          layers: [
            swept('turretFire_e.body', { wave: 'sine', freq: 96, from: 300, to: 130, q: 2.2, gain: 0.4, attack: 0.001, hold: 0.01, decay: 0.08, curve: 5, punch: 0.75, noiseMix: 0.14, seed: 60020 }),
            grains('turretFire_e.gas', { freq: 1150, freqEnd: 700, grain: 0.0024, gain: 0.44, hold: 0.006, decay: 0.07, curve: 4.5, from: 4600, to: 1100, q: 3.2, hp: 700, at: 0.003, seed: 60022 }),
          ],
        },
      },
      {
        id: 'f',
        character: "capacitor bloom, damped at once",
        spec: {
          name: 'turretFire_f_capacitorBloom',
          layers: [
            band('turretFire_f.bloom', 3100, { gain: 0.6, decay: 0.038, q: 10, curve: 5.5, punch: 0.5, hp: 1200, seed: 60030 }),
            band('turretFire_f.damp', 1250, { gain: 0.34, decay: 0.026, q: 4, curve: 8, seed: 60032 }),
          ],
        },
      },
      {
        id: 'g',
        character: "damped hardware, mechanism only",
        spec: {
          name: 'turretFire_g_dampedHardware',
          layers: [
            grains('turretFire_g.action', { freq: 620, grain: 0.0032, gain: 0.34, hold: 0.003, decay: 0.03, curve: 7, punch: 0.5, from: 2600, to: 900, q: 3, hp: 260, seed: 60040 }),
            band('turretFire_g.seat', 430, { gain: 0.26, decay: 0.03, q: 3.5, curve: 7, seed: 60042 }),
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
        id: 'd',
        character: "absorber tick, hull taking it",
        spec: {
          name: 'shotImpact_d_absorberTick',
          layers: [
            band('shotImpact_d.tick', 1750, { gain: 0.42, decay: 0.016, q: 6, curve: 8, punch: 0.6, seed: 60050 }),
            swept('shotImpact_d.absorb', { wave: 'sine', freq: 150, from: 420, to: 150, q: 2.4, gain: 0.3, attack: 0.0008, hold: 0.005, decay: 0.045, curve: 6, seed: 60052 }),
          ],
        },
      },
      {
        id: 'e',
        character: "spall, micro debris off plate",
        spec: {
          name: 'shotImpact_e_spall',
          layers: [
            grains('shotImpact_e.spall', { freq: 3100, freqEnd: 2400, grain: 0.0018, gain: 0.5, hold: 0.003, decay: 0.038, curve: 6, punch: 0.55, from: 6300, to: 2600, q: 3.4, hp: 1800, seed: 60060 }),
            band('shotImpact_e.plate', 900, { gain: 0.24, decay: 0.02, q: 4, curve: 8, seed: 60062 }),
          ],
        },
      },
      {
        id: 'f',
        character: "ferrite knock, two damped partials",
        spec: {
          name: 'shotImpact_f_ferriteKnock',
          layers: [
            ...plate('shotImpact_f.knock', 1180, { gain: 0.34, decay: 0.03, ratios: [1, 2.41], q: 6, curve: 7, punch: 0.6, grain: 0.42, edge: 0.6, seed: 60070 }),
          ],
        },
      },
      {
        id: 'g',
        character: "charge dump, corner slamming shut",
        spec: {
          name: 'shotImpact_g_chargeDump',
          layers: [
            swept('shotImpact_g.dump', { wave: 'noise', freq: 640, from: 5200, to: 380, q: 4.5, gain: 0.5, attack: 0.0006, hold: 0.004, decay: 0.05, curve: 7, punch: 0.5, hp: 200, seed: 60080 }),
          ],
        },
      },
    ],
  },
  shieldHit: {
    label: "Shield Hit",
    context: "A shield absorbs a hit — struck bell, not broken.",
    current: 'shieldHit',
    candidates: [
      {
        id: 'd',
        character: "lattice ring, struck and held",
        spec: {
          name: 'shieldHit_d_latticeRing',
          layers: [
            ...plate('shieldHit_d.lattice', 1320, { gain: 0.34, decay: 0.22, ratios: [1, 2.14, 3.63], q: 10, curve: 3.6, punch: 0.35, grain: 0.18, seed: 60090 }),
          ],
        },
      },
      {
        id: 'e',
        character: "absorption wash, pressure taken",
        spec: {
          name: 'shieldHit_e_absorptionWash',
          layers: [
            swept('shieldHit_e.wash', { wave: 'noise', freq: 1250, from: 1400, to: 3000, q: 5.5, gain: 0.46, attack: 0.004, hold: 0.02, decay: 0.19, curve: 3.4, hp: 600, seed: 60100 }),
            band('shieldHit_e.skin', 1900, { gain: 0.3, decay: 0.15, q: 9, curve: 4, attack: 0.002, seed: 60102 }),
          ],
        },
      },
      {
        id: 'f',
        character: "capacitor bloom over the bubble",
        spec: {
          name: 'shieldHit_f_bubbleBloom',
          layers: [
            band('shieldHit_f.bloom', 2450, { gain: 0.5, decay: 0.17, q: 11, curve: 4.2, punch: 0.4, hp: 900, seed: 60110 }),
            band('shieldHit_f.under', 980, { gain: 0.3, decay: 0.1, q: 7, curve: 5, at: 0.004, seed: 60112 }),
          ],
        },
      },
      {
        id: 'g',
        character: "damped tick, the field barely notices",
        spec: {
          name: 'shieldHit_g_dampedTick',
          layers: [
            grains('shieldHit_g.contact', { freq: 1650, grain: 0.0035, gain: 0.34, hold: 0.004, decay: 0.06, curve: 6, from: 3600, to: 1500, q: 4, hp: 900, seed: 60120 }),
            band('shieldHit_g.trace', 2150, { gain: 0.26, decay: 0.09, q: 10, curve: 5, at: 0.006, seed: 60122 }),
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
            swept('shieldDown_d.unwind', { wave: 'triangle', freq: 1280, freqEnd: 186, from: 4200, to: 700, q: 9, gain: 0.4, attack: 0.002, hold: 0.018, decay: 0.4, curve: 2.8, noiseMix: 0.16, hp: 260, seed: 60130 }),
            band('shieldDown_d.let', 2200, { gain: 0.4, decay: 0.04, q: 8, curve: 6, punch: 0.45, seed: 60132 }),
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
            swept('shieldDown_g.drop', { wave: 'triangle', freq: 760, freqEnd: 150, from: 1900, to: 420, q: 4, gain: 0.38, attack: 0.002, hold: 0.012, decay: 0.22, curve: 3.6, noiseMix: 0.22, seed: 60160 }),
            band('shieldDown_g.settle', 380, { gain: 0.26, decay: 0.1, q: 4.5, curve: 5, at: 0.09, seed: 60162 }),
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
            grains('coreHit_e.surge', { freq: 260, freqEnd: 130, grain: 0.006, gain: 0.3, hold: 0.04, decay: 0.3, curve: 2.6, from: 780, to: 200, q: 2.6, at: 0.03, seed: 60182 }),
          ],
        },
      },
      {
        id: 'f',
        character: "load transferring through the frame",
        spec: {
          name: 'coreHit_f_frameLoad',
          layers: [
            swept('coreHit_f.strike', { wave: 'noise', freq: 170, freqEnd: 70, from: 800, to: 190, q: 2.4, gain: 0.4, attack: 0.003, hold: 0.024, decay: 0.26, curve: 2.8, punch: 0.55, seed: 60190 }),
            swept('coreHit_f.frame', { wave: 'triangle', freq: 132, freqEnd: 118, from: 520, to: 260, q: 5.5, gain: 0.3, attack: 0.03, hold: 0.05, decay: 0.32, curve: 2.2, noiseMix: 0.24, at: 0.04, seed: 60192 }),
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
            swept('turretDown_e.rupture', { wave: 'noise', freq: 700, freqEnd: 160, from: 3200, to: 380, q: 3, gain: 0.44, attack: 0.001, hold: 0.03, decay: 0.3, curve: 3, punch: 0.6, seed: 60220 }),
            swept('turretDown_e.sink', { wave: 'sine', freq: 82, from: 210, to: 110, q: 1.9, gain: 0.28, attack: 0.004, hold: 0.03, decay: 0.28, curve: 2.6, at: 0.06, seed: 60222 }),
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
            band('shipExplode_f.tear', 2200, { gain: 0.7, decay: 0.045, q: 8, curve: 7, punch: 0.8, seed: 60270 }),
            swept('shipExplode_f.collapse', { wave: 'triangle', freq: 380, freqEnd: 120, from: 3000, to: 300, q: 6.5, gain: 0.5, attack: 0.001, hold: 0.02, decay: 0.26, curve: 3.6, noiseMix: 0.4, at: 0.005, seed: 60272 }),
            ...returns('shipExplode_f.room', { freq: 640, gain: 0.28, decay: 0.24, from: 1800, to: 460, at: 0.11, gap: 0.13, count: 3, seed: 60274 }),
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
            swept('shipSpawn_e.approach', { wave: 'noise', freq: 140, freqEnd: 175, from: 340, to: 1400, q: 2.4, gain: 0.28, attack: 0.035, hold: 0.05, decay: 0.09, curve: 2, seed: 60300 }),
            swept('shipSpawn_e.seat', { wave: 'sine', freq: 88, freqEnd: 66, from: 280, to: 110, q: 2.2, gain: 0.42, attack: 0.002, hold: 0.022, decay: 0.18, curve: 3.2, punch: 0.6, noiseMix: 0.12, at: 0.19, seed: 60302 }),
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
  thruster: {
    label: "Thruster Loop",
    context: "Held engine note while the throttle is open (loops continuously)",
    current: 'thruster',
    candidates: [
      // A loop has no envelope to carry character — `hold` runs flat and `decay`
      // is zero, which is what `./candidates.test.ts` checks for. So all four are
      // made of *material* instead: the grain rate, the corner, the Q. None of
      // them names a `lowPassEnd`: a filter sweep inside a loop body wraps into a
      // 2.5 Hz wobble at the loop rate, which is a helicopter, not a drive.
      {
        id: 'd',
        character: "ion wash, fine grain and hiss",
        spec: {
          name: 'thruster_d_ionWash',
          loop: true,
          crossfade: 0.04,
          layers: [
            grains('thruster_d.wash', { freq: 260, freqEnd: 260, grain: 0.0018, gain: 0.3, attack: 0, hold: 0.4, decay: 0, from: 3000, q: 2.2, hp: 220, seed: 60370 }),
            place({ name: 'thruster_d.duct', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 96, lowPass: 380, resonance: 1.8, gain: 0.17, seed: 60371 }),
          ],
        },
      },
      {
        id: 'e',
        character: "inertial mass, low and pressurised",
        spec: {
          name: 'thruster_e_inertialMass',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_e.mass', wave: 'sine', attack: 0, hold: 0.4, decay: 0, freq: 46, noiseMix: 0.2, lowPass: 180, resonance: 1.6, gain: 0.3, seed: 60380 }),
            place({ name: 'thruster_e.press', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 135, lowPass: 600, resonance: 2.6, gain: 0.28, seed: 60381 }),
          ],
        },
      },
      {
        id: 'f',
        character: "containment hum, two narrow bands",
        spec: {
          name: 'thruster_f_containmentHum',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_f.b0', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 360, lowPass: 1200, resonance: 8.5, bandPass: true, gain: 0.55, seed: 60390 }),
            place({ name: 'thruster_f.b1', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 540, lowPass: 1800, resonance: 10, bandPass: true, gain: 0.34, seed: 60391 }),
            place({ name: 'thruster_f.floor', wave: 'triangle', attack: 0, hold: 0.4, decay: 0, freq: 90, noiseMix: 0.24, lowPass: 340, resonance: 3, gain: 0.2, seed: 60392 }),
          ],
        },
      },
      {
        id: 'g',
        character: "hardware only, a quiet running machine",
        spec: {
          name: 'thruster_g_runningMachine',
          loop: true,
          crossfade: 0.04,
          layers: [
            place({ name: 'thruster_g.run', wave: 'noise', attack: 0, hold: 0.4, decay: 0, freq: 155, lowPass: 700, resonance: 3.4, highPass: 70, gain: 0.24, seed: 60400 }),
            place({ name: 'thruster_g.rotor', wave: 'triangle', attack: 0, hold: 0.4, decay: 0, freq: 62, noiseMix: 0.3, lowPass: 240, resonance: 2.2, gain: 0.18, seed: 60401 }),
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
  // and narrow. Neither reaches for the other's register.
  buildPlaced: {
    label: "Build Placed",
    context: "A turret/build is placed and starts building — ore spent, a latch not a fanfare.",
    current: 'buildPlaced',
    candidates: [
      {
        id: 'd',
        character: "stepper travel into a stop",
        spec: {
          name: 'buildPlaced_d_stepperStop',
          layers: [
            grains('buildPlaced_d.travel', { freq: 420, freqEnd: 340, grain: 0.0055, gain: 0.32, hold: 0.02, decay: 0.07, curve: 4, from: 1700, to: 620, q: 3, hp: 180, seed: 60530 }),
            band('buildPlaced_d.stop', 300, { gain: 0.34, decay: 0.06, q: 4.5, curve: 6, punch: 0.4, at: 0.05, seed: 60532 }),
          ],
        },
      },
      {
        id: 'e',
        character: "vacuum taking up, weight resting",
        spec: {
          name: 'buildPlaced_e_vacuumSeat',
          layers: [
            swept('buildPlaced_e.take', { wave: 'noise', freq: 300, from: 1400, to: 380, q: 2.8, gain: 0.32, attack: 0.004, hold: 0.02, decay: 0.09, curve: 3.4, seed: 60540 }),
            swept('buildPlaced_e.rest', { wave: 'sine', freq: 84, from: 240, to: 110, q: 2.2, gain: 0.4, attack: 0.002, hold: 0.02, decay: 0.14, curve: 3.6, punch: 0.5, noiseMix: 0.12, at: 0.055, seed: 60542 }),
          ],
        },
      },
      {
        id: 'f',
        character: "weld struck and quenched",
        spec: {
          name: 'buildPlaced_f_weldQuench',
          layers: [
            band('buildPlaced_f.weld', 880, { gain: 0.62, decay: 0.05, q: 9, curve: 6, punch: 0.5, seed: 60550 }),
            band('buildPlaced_f.quench', 520, { gain: 0.4, decay: 0.075, q: 6, curve: 5.5, at: 0.03, seed: 60552 }),
          ],
        },
      },
      {
        id: 'g',
        character: "one latch, and that is all",
        spec: {
          name: 'buildPlaced_g_oneLatch',
          layers: [
            band('buildPlaced_g.latch', 560, { gain: 0.48, decay: 0.045, q: 5, curve: 6.5, punch: 0.45, seed: 60560 }),
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
            grains('buildComplete_d.s0', { freq: 340, grain: 0.004, gain: 0.28, hold: 0.008, decay: 0.05, curve: 5, from: 1300, to: 520, q: 3, hp: 160, seed: 60570 }),
            grains('buildComplete_d.s1', { freq: 430, grain: 0.004, gain: 0.3, hold: 0.008, decay: 0.055, curve: 5, from: 1600, to: 620, q: 3, hp: 180, at: 0.075, seed: 60572 }),
            grains('buildComplete_d.s2', { freq: 540, grain: 0.004, gain: 0.32, hold: 0.012, decay: 0.1, curve: 4.5, from: 2000, to: 760, q: 3.2, hp: 200, at: 0.15, seed: 60574 }),
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
            band('repairTick_f.spot', 760, { gain: 0.5, decay: 0.04, q: 7, curve: 6, punch: 0.35, seed: 60630 }),
          ],
        },
      },
      {
        id: 'g',
        character: "the quietest tick that still reads",
        spec: {
          name: 'repairTick_g_quietest',
          layers: [
            band('repairTick_g.tick', 440, { gain: 0.34, decay: 0.028, q: 4, curve: 7, seed: 60640 }),
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
        id: 'd',
        character: "conveyor stop, gravel settling",
        spec: {
          name: 'bankOre_d_conveyorStop',
          layers: [
            grains('bankOre_d.pour', { freq: 500, freqEnd: 300, grain: 0.0035, gain: 0.34, hold: 0.03, decay: 0.16, curve: 3.2, from: 2200, to: 560, q: 2.8, hp: 200, seed: 60650 }),
            band('bankOre_d.stop', 260, { gain: 0.3, decay: 0.09, q: 4, curve: 5.5, at: 0.09, seed: 60652 }),
          ],
        },
      },
      {
        id: 'e',
        character: "vault seating, mass coming down",
        spec: {
          name: 'bankOre_e_vaultSeat',
          layers: [
            swept('bankOre_e.drop', { wave: 'sine', freq: 150, freqEnd: 92, from: 460, to: 160, q: 2.4, gain: 0.42, attack: 0.002, hold: 0.02, decay: 0.18, curve: 3.4, punch: 0.55, noiseMix: 0.12, seed: 60660 }),
            swept('bankOre_e.settle', { wave: 'noise', freq: 210, from: 700, to: 260, q: 2.6, gain: 0.22, attack: 0.006, hold: 0.02, decay: 0.14, curve: 3, at: 0.06, seed: 60662 }),
          ],
        },
      },
      {
        id: 'f',
        character: "two bands falling to rest",
        spec: {
          name: 'bankOre_f_fallingBands',
          layers: [
            band('bankOre_f.b0', 620, { gain: 0.6, decay: 0.08, q: 7.5, curve: 5, punch: 0.35, seed: 60670 }),
            band('bankOre_f.b1', 415, { gain: 0.56, decay: 0.17, q: 8, curve: 4.5, at: 0.075, seed: 60672 }),
          ],
        },
      },
      {
        id: 'g',
        character: "counted, filed, nothing more",
        spec: {
          name: 'bankOre_g_counted',
          layers: [
            grains('bankOre_g.count', { freq: 380, grain: 0.0045, gain: 0.26, hold: 0.008, decay: 0.06, curve: 5, from: 1200, to: 460, q: 2.8, hp: 150, seed: 60680 }),
            swept('bankOre_g.file', { wave: 'sine', freq: 110, from: 300, to: 140, q: 2, gain: 0.3, attack: 0.003, hold: 0.014, decay: 0.1, curve: 3.6, at: 0.045, seed: 60682 }),
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
      // "The brightest confirmation in the bank" is a ranking inside this family,
      // not permission to sparkle: §4.7 register 2 is that the interface does not
      // congratulate. So brightness here is *bandwidth* — a higher corner, a
      // narrower band, a faster contact — and never a chime, an arpeggio or a
      // major third. All four are three rising events, because what the player is
      // being told is that a thing went UP.
      {
        id: 'd',
        character: "three stepper contacts, no shine",
        spec: {
          name: 'upgradeBought_d_threeSteps',
          layers: [
            grains('upgradeBought_d.s0', { freq: 620, grain: 0.0035, gain: 0.3, hold: 0.006, decay: 0.045, curve: 5, from: 2200, to: 800, q: 3.2, hp: 300, seed: 60690 }),
            grains('upgradeBought_d.s1', { freq: 780, grain: 0.0032, gain: 0.32, hold: 0.006, decay: 0.05, curve: 5, from: 2800, to: 950, q: 3.2, hp: 340, at: 0.07, seed: 60692 }),
            grains('upgradeBought_d.s2', { freq: 980, grain: 0.003, gain: 0.34, hold: 0.01, decay: 0.11, curve: 4.5, from: 3400, to: 1200, q: 3.4, hp: 400, at: 0.14, seed: 60694 }),
          ],
        },
      },
      {
        id: 'e',
        character: "pressure lifting, sub under it",
        spec: {
          name: 'upgradeBought_e_pressureLift',
          layers: [
            swept('upgradeBought_e.lift', { wave: 'triangle', freq: 330, freqEnd: 392, from: 700, to: 2600, q: 4.5, gain: 0.36, attack: 0.02, hold: 0.07, decay: 0.1, curve: 2.6, noiseMix: 0.16, seed: 60700 }),
            swept('upgradeBought_e.seat', { wave: 'sine', freq: 98, from: 280, to: 140, q: 2.2, gain: 0.34, attack: 0.003, hold: 0.03, decay: 0.2, curve: 3, punch: 0.45, at: 0.15, seed: 60702 }),
          ],
        },
      },
      {
        id: 'f',
        character: "three welds rising, each quenched",
        spec: {
          name: 'upgradeBought_f_threeWelds',
          layers: [
            band('upgradeBought_f.w0', 700, { gain: 0.56, decay: 0.06, q: 8, curve: 5.5, punch: 0.35, seed: 60710 }),
            band('upgradeBought_f.w1', 880, { gain: 0.58, decay: 0.07, q: 8.5, curve: 5, punch: 0.35, at: 0.075, seed: 60712 }),
            band('upgradeBought_f.w2', 1100, { gain: 0.62, decay: 0.19, q: 9.5, curve: 4.2, punch: 0.35, at: 0.15, seed: 60714 }),
          ],
        },
      },
      {
        id: 'g',
        character: "up one step, said once",
        spec: {
          name: 'upgradeBought_g_upOneStep',
          layers: [
            swept('upgradeBought_g.step', { wave: 'triangle', freq: 392, from: 1100, to: 480, q: 4.4, gain: 0.38, attack: 0.004, hold: 0.03, decay: 0.15, curve: 3.4, punch: 0.35, noiseMix: 0.16, seed: 60720 }),
            band('upgradeBought_g.mark', 784, { gain: 0.4, decay: 0.09, q: 7, curve: 5, at: 0.09, seed: 60722 }),
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
            band('depositTick_f.band', 580, { gain: 0.4, decay: 0.038, q: 6.5, curve: 6, seed: 60750 }),
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
            grains('respawnBeep_d.tick', { freq: 1250, freqEnd: 1050, grain: 0.0022, gain: 0.29, hold: 0.016, decay: 0.05, curve: 5, from: 4200, to: 1800, q: 3.2, hp: 620, seed: 60410 }),
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
    // The full stop, and the smallest job in the set: *the screen has finished
    // moving and your input means something again*. All three resolve DOWNWARD
    // and none of them rings for long — a settle that ends higher than it began
    // is a question, and a settle with a tail is still the screen talking.
    label: "XP Settle",
    context: "The end of the sequence — everything holds at its final value and the buttons take focus. Quiet: the full stop.",
    current: 'xpSettle',
    candidates: [
      {
        id: 'a',
        character: "a dry stop, one contact",
        spec: {
          name: 'xpSettle_a_dryStop',
          layers: [
            grains('xpSettle_a.stop', { freq: 300, freqEnd: 240, grain: 0.004, gain: 0.2, hold: 0.008, decay: 0.09, curve: 5, from: 1100, to: 420, q: 2.6, hp: 150, seed: 35300 }),
          ],
        },
      },
      {
        id: 'b',
        character: "a damped seat, closing",
        spec: {
          name: 'xpSettle_b_dampedSeat',
          layers: [
            swept('xpSettle_b.seat', { wave: 'triangle', freq: 220, freqEnd: 208, from: 900, to: 240, q: 2.6, gain: 0.18, attack: 0.004, hold: 0.02, decay: 0.2, curve: 5, noiseMix: 0.09, seed: 35310 }),
          ],
        },
      },
      {
        id: 'c',
        character: "one low band, ringing out",
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
