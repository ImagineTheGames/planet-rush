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
   * Maximum aim error, radians, applied to a manual aim vector. Easy bots miss;
   * Hard bots don't. Never negative, never zero for Easy. TUNABLE
   */
  readonly aimJitter: number;
  /**
   * Hull fraction at which the tier disengages (GDD §2.9: Easy "retreats at half
   * hull"). Personality `caution` scales this. TUNABLE
   */
  readonly retreatHullFraction: number;
  /**
   * Seconds a scouted fact stays actionable before the bot must look again.
   * Fog is a mechanic (GDD §2.2): a bot that scouted your core ten seconds ago
   * is acting on ten-second-old news, and a Hard bot's memory is fresher only
   * because it re-scouts, never because it re-reads the world. TUNABLE
   */
  readonly memorySeconds: number;
}

/** Per-tier competence. All TUNABLE, all owned by this agent. */
export const DIFFICULTY_TUNING: Readonly<Record<Difficulty, DifficultyTuning>> = {
  [Difficulty.Easy]: {
    reactionInterval: 1 / 6,
    aimJitter: 0.22,
    retreatHullFraction: 0.5,
    memorySeconds: 6,
  },
  [Difficulty.Medium]: {
    reactionInterval: 1 / 12,
    aimJitter: 0.09,
    retreatHullFraction: 0.35,
    memorySeconds: 12,
  },
  [Difficulty.Hard]: {
    reactionInterval: 1 / 20,
    aimJitter: 0.02,
    retreatHullFraction: 0.2,
    memorySeconds: 20,
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
      homebody: 0.2,
      opportunism: 0.8,
    },
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    difficulty: Difficulty.Hard,
    shipClass: ShipClass.Excavator,
    blurb: 'Territorial enforcer — treats the space around its planet as its own.',
    weights: {
      triangle: { mine: 0.3, defend: 0.45, attack: 0.25 },
      greed: 0.4,
      caution: 1.0,
      scavenge: 0.3,
      homebody: 1.0,
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
