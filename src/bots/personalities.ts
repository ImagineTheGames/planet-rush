/**
 * src/bots/personalities.ts — the cast (GDD §2.9). OWNER: Bot Engineer.
 *
 * "The seven bots are **characters, not difficulty labels**." A personality is
 * three things and nothing else:
 *
 *  1. a **difficulty tier** — which behavior tree it runs (Easy / Medium / Hard);
 *  2. a **hull** — its livery is a palette swap over one of the four silhouettes
 *     (style-guide §4: "one livery per bot personality … never a new shape");
 *  3. **weights** — the numbers that bend that tree toward this character, so
 *     losing to Vulture feels different from losing to Warden.
 *
 * The load-bearing rule this file exists to keep honest (GDD §2.9): **difficulty
 * changes visible competence, not information.** Every knob in
 * {@link DIFFICULTY_TUNING} is about how fast a bot reacts, how accurately it
 * aims, and when it loses its nerve. None of them widen what a bot can see —
 * perception is one fog-honest code path for every tier (`./perception`), and a
 * Hard bot that knows you are wounded knows it because it scouted you.
 *
 * Day 4 gave the weights something to bend: `./easy`, `./medium` and `./hard`
 * read every dial below at least once per decision, so the difference between
 * losing to Vulture and losing to Warden is these numbers and nothing else —
 * same tree, same tier, same fog. They remain a hypothesis in the same spirit as
 * the sim's `TUNABLE` constants table, and QA owns the balance question they
 * answer (GDD §2.8, §3.8; measured results in `docs/bot-balance-day4.md`).
 */

import { ShipClass } from '@shared/types';

// ---------------------------------------------------------------------------
// Difficulty (GDD §2.9)
// ---------------------------------------------------------------------------

/**
 * The three behavior trees. The tier decides *which* tree runs; the personality
 * weights decide how that tree leans.
 *
 *  - `Easy`   — mines slowly, over-defends, attacks rarely, retreats at half hull.
 *  - `Medium` — balances the triangle, contests ore waves, gangs up on the leader.
 *  - `Hard`   — plays like a good human: threat, proximity, and opportunity.
 */
export enum Difficulty {
  Easy = 'easy',
  Medium = 'medium',
  Hard = 'hard',
}

/**
 * Competence knobs — the *only* axis difficulty is allowed to move (GDD §2.9).
 * Read this table as the answer to "why is a Hard bot better?": it decides more
 * often, aims straighter, and holds its nerve longer. It never sees more.
 */
export interface DifficultyTuning {
  /**
   * Seconds between decisions. A bot holds its previous action stream in
   * between, exactly like a human whose hands have not moved yet — this is
   * reaction time, modelled as cadence. TUNABLE
   */
  readonly reactionInterval: number;
  /**
   * The aim-error model is two named tunables (v0.2.2 field report — "enemies'
   * aim is too accurate"). The intercept solve (`leadAim`) is deterministically
   * perfect, which turned every bot into an aimbot and deleted the dodge that is
   * the whole point of a projectile. `aimJitter` and {@link aimLatency} put the
   * error back, scaled by tier so difficulty is *visible competence* (GDD §2.9):
   *
   * `aimJitter` — maximum angular error, radians, drawn from the bot's seeded RNG
   * and added to the aim bearing every decision. The *spread*: how far off a
   * straight-flying target a shot can land. Easy bots miss; Hard bots barely do.
   * Never negative, never zero for Easy. TUNABLE
   */
  readonly aimJitter: number;
  /**
   * Reaction latency, seconds, before the bot re-solves its intercept lead on a
   * target that changed course. The bot re-samples the target's *velocity* only
   * this often; between samples it keeps leading with the stale one, so a target
   * that juked inside the window is led *where it was going*, not where it went
   * — and the shot misses (`./steering` `trackAimVelocity`). This is the knob
   * that rewards dodging: a strafing player who reverses faster than a tier's
   * latency evades it, while a straight-line flyer is tracked cleanly. It stacks
   * on top of {@link reactionInterval} (which gates *re-aiming at all*); latency
   * is specifically the lag on the predictive lead. Zero would restore the
   * aimbot. TUNABLE
   */
  readonly aimLatency: number;
  /**
   * Hull fraction at which the tier disengages (GDD §2.9: Easy "retreats at half
   * hull"). Personality `caution` scales this. TUNABLE
   */
  readonly retreatHullFraction: number;
  /**
   * Seconds an observed fact stays actionable before the bot must look again.
   * A bot that saw your core ten seconds ago is acting on ten-second-old news,
   * and a Hard bot's memory is fresher only because it looks again, never
   * because it re-reads the world. Still true after the a0-05 amendment: the
   * ring is always drawn, but only on stations the bot can see. TUNABLE
   */
  readonly memorySeconds: number;
  /**
   * Seconds the road home must read *shut* before this tier believes it is
   * cornered and commits to fighting the blockader (`./cornered`; developer
   * report p15, ratified point 3).
   *
   * This is the whole difficulty texture of the cornered rule, expressed as
   * reaction time rather than as three different rules: a Hard bot reads the
   * trap almost at once and commits ruthlessly, an Easy bot takes long enough
   * that "a visible couple of oscillations" happen first — which the developer
   * ratified as acceptable AT EASY ONLY — and then commits exactly as hard as
   * anyone else. Nobody gets a *different* answer; the ladder is only in how
   * long they take to reach it, which is the same principle as `aimLatency`.
   * TUNABLE
   */
  readonly blockadeDetectSeconds: number;
  /**
   * How hard this tier *wants* the fight — the appetite the developer ratified
   * in the p15 note ("HARD bots seek the fight more … EASY stays timid").
   *
   * It divides the score a target must clear before the tier will leave the
   * economy for it (`./hard` `hardAttackFloor`), so a bigger appetite means a
   * bot breaks off mining for a fight it would previously have priced as not
   * worth the trip. 1.0 is exactly the shipped behaviour, which is why Easy and
   * Medium sit there: the ladder is one tier wide by design.
   *
   * It is deliberately *only* the initiation range. The note also named siege
   * willingness and target-the-leader weighting; both were built and A/B'd, and
   * both move fire off the player's **ship** and onto their **home** (−19% /
   * +12% at appetite 1.6), which reads from the cockpit as a Hard bot that has
   * lost interest in you — the exact complaint.
   *
   * Every tier ships at 1.0, i.e. this dial is currently a no-op: the raise the
   * note ratified is measured to *reduce* the fire a player draws in the cast
   * they actually meet (see {@link DIFFICULTY_TUNING}'s Hard entry). It exists
   * so the Director's decision is one constant, and so the A/B that produced
   * that finding can keep running as a test. Numbers in
   * `docs/bot-player-aggression-p15.md` §3. TUNABLE
   */
  readonly aggression: number;
}

/** Per-tier competence. All TUNABLE, all owned by this agent. */
export const DIFFICULTY_TUNING: Readonly<Record<Difficulty, DifficultyTuning>> = {
  [Difficulty.Easy]: {
    reactionInterval: 1 / 6,
    aimJitter: 0.32,
    aimLatency: 0.6,
    retreatHullFraction: 0.5,
    memorySeconds: 6,
    // ~10 decisions at Easy's 1/6 s cadence, and long enough for the flee latch
    // to enter and release a couple of times: the "visible couple of
    // oscillations" the developer ratified as acceptable at this tier, and then
    // Rusty stops being scared.
    blockadeDetectSeconds: 1.6,
    /** "EASY stays timid" — the shipped floor, untouched. */
    aggression: 1,
  },
  [Difficulty.Medium]: {
    reactionInterval: 1 / 12,
    aimJitter: 0.13,
    aimLatency: 0.32,
    retreatHullFraction: 0.35,
    memorySeconds: 12,
    /** Half a beat of confusion, then it turns and fights. */
    blockadeDetectSeconds: 0.6,
    /** The note raises HARD only; Medium keeps the balance it was tuned to. */
    aggression: 1,
  },
  [Difficulty.Hard]: {
    // Tuned *down* from v0.2.2's perfection (aimJitter 0.02, no latency): the
    // developer, a competent player, found the old Hard oppressive. 0.05 rad of
    // spread and a 0.20 s lead-lag keep it strong but genuinely beatable — a
    // player who strafes and juke-reverses shakes ~two thirds of a Hard bot's
    // shots (34% land vs a perfect gun's 43%), which was impossible against the
    // aimbot. The lag sits above the ~0.13 s cliff where a Hard gun starts
    // snapping back into aimbot territory, so `aimScale` can lean it without ever
    // crossing that line. Measured in `docs/bot-aim-error-p5.md`.
    reactionInterval: 1 / 20,
    aimJitter: 0.05,
    aimLatency: 0.2,
    retreatHullFraction: 0.2,
    memorySeconds: 20,
    // Three decisions at 1/20 s. A Hard bot reads a blockade the way a good
    // human does — instantly — and commits ruthlessly (ratified point 3).
    blockadeDetectSeconds: 0.15,
    // The ratified raise is 1.6 (p15 point 3), and it is NOT set here: measured,
    // it costs the player fire in the cast they actually meet. Raising it drops
    // Hard's attack floor 0.34 → 0.21, and a Hard bot that prices targets that
    // cheaply spends the difference on the *softest* thing in range. In an
    // all-Hard cast every rival is equally tough, so the human absorbs it (+15%
    // hull); in the shipped mixed roster there are Easy and Medium hulls to pick
    // off instead, and the Hard seats' own initiations on the human fall 38%.
    // The A/B is a standing test — `tests/harness/player-aggression.test.ts`,
    // table in `docs/bot-player-aggression-p15.md` §3. TUNABLE, and the whole
    // implementation of the ratified note is this one number.
    aggression: 1,
  },
};

// ---------------------------------------------------------------------------
// Personality weights
// ---------------------------------------------------------------------------

/**
 * Where a character sits on the triangle (GDD §2.3: "mine / defend / attack").
 * Relative, not normalized — the trees compare them against each other.
 */
export interface TriangleWeights {
  readonly mine: number;
  readonly defend: number;
  readonly attack: number;
}

/**
 * The character layer over a difficulty tree. Every field is a 0..1 dial except
 * the triangle, and every one of them answers a question the trees actually ask
 * once per decision.
 */
export interface PersonalityWeights {
  /** Standing bias across mine / defend / attack. */
  readonly triangle: TriangleWeights;
  /** How full the hold runs before heading home (GDD §2.3: "you decide how full
   *  to run"). 1 = hauls a full hold through a firefight. */
  readonly greed: number;
  /** Multiplier on the tier's retreat threshold. >1 breaks off early, <1 stays
   *  in a fight it is losing. */
  readonly caution: number;
  /** Pull toward wrecks and loose chunks — the scavenger dial (GDD §2.7). */
  readonly scavenge: number;
  /** Tendency to answer the alarm and sit on its own territory rather than
   *  chase the map. */
  readonly homebody: number;
  /** Tendency to pile onto whoever is already losing or already the leader
   *  (GDD §2.9: Medium "gangs up on the current leader"). */
  readonly opportunism: number;
  /**
   * Optional character-level modulation of the tier's aim-error model, within
   * the band (GDD §2.9: "personalities may modulate within their difficulty
   * band"). A multiplier on **both** `aimJitter` and `aimLatency`: `< 1` is a
   * steadier, sniper-ish shot (tighter spread, faster re-lead), `> 1` a sprayer.
   * Absent means 1 — the tier value unchanged, which is every character but
   * **Bolt**, the wild rusher who fires from the hip (`> 1`).
   *
   * It can never cross tiers: clamped to [0.85, 1.4] so an Easy character can
   * never snipe like a Hard one, nor a Hard one spray like an Easy one —
   * difficulty owns the band, personality only leans inside it. The clamp is
   * asymmetric on purpose: a Hard gun snaps back toward the aimbot once its
   * lead-lag drops under ~0.16 s (`docs/bot-aim-error-p5.md`), so the tight-end
   * floor is held close to 1 to keep a clear margin above that cliff, while the
   * loose end has room to spray. The tight end is left unused anyway: the harness
   * shows a Hard gun is already at its turn-rate/geometry floor, so tightening a
   * Hard character is imperceptible in landed shots — the measurable lean lives
   * at the loose end, on Bolt.
   */
  readonly aimScale?: number;
}

/** One member of the cast. */
export interface Personality {
  readonly id: PersonalityId;
  /** Display name — bots are cartoon rivals *with names* (GDD §4.7). */
  readonly name: string;
  readonly difficulty: Difficulty;
  /** The hull its livery is painted on (style-guide §4). */
  readonly shipClass: ShipClass;
  /** The one-line character read, straight out of GDD §2.9. */
  readonly blurb: string;
  readonly weights: PersonalityWeights;
}

/** The seven, by id. Ids are stable strings — they key save data and the lobby. */
export type PersonalityId =
  | 'rusty'
  | 'bolt'
  | 'foreman'
  | 'patch'
  | 'sable'
  | 'vulture'
  | 'warden';

/**
 * The cast (GDD §2.9), in the order the design lists them — which is also the
 * order empty slots are filled, so a solo match always meets Rusty first and
 * only meets Warden in a full house.
 *
 * **The hulls are not a choice this file gets to make.** GDD §2.11 assigns them
 * by name — "Bolt/Sable fly Interceptors, Foreman/Warden Excavators,
 * Rusty/Patch Haulers, Vulture a Vanguard" — because "a silhouette on the
 * minimap is information": the shape has to tell you who you are dealing with
 * before you can read the name (style-guide §4). Each row below matches that
 * sentence exactly, and a personality's weights are then written to *suit* its
 * hull rather than the other way round — Patch repairs through a siege in the
 * hull that tanks one, Warden holds its ground in the hull that out-earns
 * everyone standing still.
 */
export const PERSONALITIES: Readonly<Record<PersonalityId, Personality>> = {
  rusty: {
    id: 'rusty',
    name: 'Rusty',
    difficulty: Difficulty.Easy,
    shipClass: ShipClass.Hauler,
    blurb: 'Timid hoarder — mines, banks, and hides behind turrets.',
    weights: {
      triangle: { mine: 0.5, defend: 0.4, attack: 0.1 },
      greed: 0.3,
      caution: 1.3,
      scavenge: 0.2,
      homebody: 0.8,
      opportunism: 0.1,
    },
  },
  bolt: {
    id: 'bolt',
    name: 'Bolt',
    difficulty: Difficulty.Easy,
    shipClass: ShipClass.Interceptor,
    blurb: 'Reckless rusher — flies at the nearest thing and worries later.',
    weights: {
      triangle: { mine: 0.2, defend: 0.15, attack: 0.65 },
      greed: 0.8,
      caution: 0.5,
      scavenge: 0.3,
      homebody: 0.1,
      opportunism: 0.3,
      // Fires from the hip on the way in — the sprayer end of the Easy band, so
      // charging Bolt is even easier to strafe than a cautious Easy bot. TUNABLE
      aimScale: 1.25,
    },
  },
  foreman: {
    id: 'foreman',
    name: 'Foreman',
    difficulty: Difficulty.Medium,
    shipClass: ShipClass.Excavator,
    blurb: 'Methodical miner — works the wave, banks on schedule, buys on time.',
    weights: {
      triangle: { mine: 0.6, defend: 0.25, attack: 0.15 },
      greed: 0.5,
      caution: 1.1,
      scavenge: 0.5,
      homebody: 0.4,
      opportunism: 0.3,
    },
  },
  patch: {
    id: 'patch',
    name: 'Patch',
    difficulty: Difficulty.Medium,
    shipClass: ShipClass.Hauler,
    blurb: 'Defensive fixer — answers every alarm and repairs through a siege.',
    weights: {
      triangle: { mine: 0.35, defend: 0.5, attack: 0.15 },
      greed: 0.4,
      caution: 1.2,
      scavenge: 0.3,
      homebody: 0.9,
      opportunism: 0.2,
    },
  },
  sable: {
    id: 'sable',
    name: 'Sable',
    difficulty: Difficulty.Hard,
    shipClass: ShipClass.Interceptor,
    blurb: 'Opportunist raider — times attacks for when you are far from home.',
    weights: {
      triangle: { mine: 0.25, defend: 0.2, attack: 0.55 },
      greed: 0.6,
      caution: 0.9,
      scavenge: 0.5,
      homebody: 0.2,
      opportunism: 0.9,
      // Sable reads as the marksman of the cast, and it *is* the tight end of the
      // Hard band — but that is the tier's aim, unmodulated: the harness shows a
      // Hard gun already sits at its turn-rate floor, so a lower `aimScale` here
      // would change nothing a player could feel or a test could measure
      // (`docs/bot-aim-error-p5.md`). Left neutral rather than shipping a knob
      // that does nothing. Its raider threat is timing (opportunism 0.9), not a
      // sniper's aim the model cannot actually give it.
    },
  },
  vulture: {
    id: 'vulture',
    name: 'Vulture',
    difficulty: Difficulty.Hard,
    shipClass: ShipClass.Vanguard,
    blurb: 'Wreck scavenger — farms kill sites and hauls a dead rival home.',
    weights: {
      triangle: { mine: 0.4, defend: 0.2, attack: 0.4 },
      greed: 0.9,
      caution: 1.0,
      scavenge: 1.0,
      // A scavenger that never comes home feeds every wreck it makes to a rival:
      // enough territorial pull to survive to the collapse it profits from, still
      // well below Warden's — it patrols kill sites, it does not homestead. TUNABLE
      homebody: 0.4,
      opportunism: 0.8,
    },
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    difficulty: Difficulty.Hard,
    shipClass: ShipClass.Excavator,
    blurb: 'Territorial enforcer — treats the space around its station as its own.',
    weights: {
      triangle: { mine: 0.3, defend: 0.45, attack: 0.25 },
      greed: 0.4,
      caution: 1.0,
      scavenge: 0.3,
      // Still the most territorial of the cast — the highest homebody in the Hard
      // pool by a clear margin — but no longer *dominant*. At 1.0 its threat-near-
      // home bias out-survived every aggressor to the last core standing and it
      // won 71% of the equal-skill Hard contest (GDD §2.11: no strategy should).
      // Tempered so Sable's raiding and Vulture's scavenging are competitive
      // against it, not so it stops holding ground. TUNABLE — measured in the PR.
      homebody: 0.55,
      opportunism: 0.5,
    },
  },
};

/**
 * Roster order (GDD §2.9). Seven characters for at most seven bot slots in an
 * 8-player match; the harness cycles this list, so an all-bot match repeats the
 * first name rather than inventing an eighth character.
 */
export const ROSTER: readonly PersonalityId[] = [
  'rusty',
  'bolt',
  'foreman',
  'patch',
  'sable',
  'vulture',
  'warden',
];

/** Look up a character. Total over `PersonalityId`, so it never returns null. */
export function personality(id: PersonalityId): Personality {
  return PERSONALITIES[id];
}

/** Competence knobs for a character's tier. */
export function tuningFor(id: PersonalityId): DifficultyTuning {
  return DIFFICULTY_TUNING[PERSONALITIES[id].difficulty];
}

/** Every character at a given tier, in roster order. */
export function rosterAt(difficulty: Difficulty): readonly PersonalityId[] {
  return ROSTER.filter((id) => PERSONALITIES[id].difficulty === difficulty);
}

/**
 * The names a seated cast wears — **and what a REPEAT looks like** *(a0-06,
 * 2026-08-07)*.
 *
 * The lobby picks characters now, and there are eight slots for seven characters,
 * only three of which are Hard. A full house therefore needs a repeat and a
 * balanced 4v4 of Hard bots needs a *fourth* Hard bot that does not exist, so
 * duplicates are legal (`./harness` `fillEmptySlots`). This function answers the
 * question that legality raises: two Wardens in one match have to be tellable
 * apart, and the answer is a **numeral, and only when there is something to
 * disambiguate**.
 *
 *  - One Warden in the cast reads `Warden`, exactly as it always has. The common
 *    case — every default lobby, every match anyone has played so far — is
 *    untouched, which is the whole reason the numeral is conditional rather than
 *    always-on: `Warden 1` alone would be a worse name for no gain.
 *  - Two or more read `Warden 1`, `Warden 2`, numbered in **slot order**, so the
 *    numeral matches the roster a player just read top-to-bottom.
 *
 * It is deliberately *not* a new livery or a new character. The cast is GDD §2.9
 * and it is not this file's to extend; and the slot's identity colour and its
 * `P1`…`P8` decal already tell two Wardens apart on the field (style-guide §3
 * rule 3) — the numeral is what makes the *name* stop lying, nothing more.
 *
 * Indexed by slot: entry `i` is the name for `cast[i]`, and a slot with no
 * character (a human, a closed seat) stays `null` so the caller's own name for
 * that slot is left alone.
 */
export function castDisplayNames(
  cast: readonly (PersonalityId | null | undefined)[],
): (string | null)[] {
  const counts = new Map<PersonalityId, number>();
  for (const id of cast) {
    if (id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const seen = new Map<PersonalityId, number>();
  const out: (string | null)[] = [];
  // An indexed `for`, not `map`: callers build this table by slot id
  // (`table[bot.seat.id] = …`), which leaves HOLES wherever a human sits, and
  // `Array.prototype.map` copies a hole through as a hole rather than visiting it.
  // The contract above says a slot with no character reads `null`, and a hole
  // reads `undefined` — a distinction that would surface as a nameplate saying
  // nothing at all.
  for (let i = 0; i < cast.length; i++) {
    const id = cast[i];
    const name = id == null ? undefined : PERSONALITIES[id]?.name;
    if (id == null || name === undefined) {
      out[i] = null;
      continue;
    }
    if ((counts.get(id) ?? 0) < 2) {
      out[i] = name;
      continue;
    }
    const nth = (seen.get(id) ?? 0) + 1;
    seen.set(id, nth);
    out[i] = `${name} ${nth}`;
  }
  return out;
}
