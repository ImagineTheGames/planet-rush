/**
 * src/progression/xp.ts — what a match earned is worth. OWNER: UI Engineer
 * (brief `docs/briefs/pr-04-accrual-and-xp.md`; plan `docs/progression-plan.md`
 * §1.3a–d).
 *
 * `./accrual` measures; this module prices. It is the §1.3d table and nothing
 * else: a pure function from one {@link MatchAccrual} to a total and the rows
 * that explain it, with **every number TUNABLE** and gathered at the top of the
 * file so a re-tune is one diff and QA owns them from m10 (GDD §2.8's
 * discipline).
 *
 * Where the numbers come from, so nobody re-derives them:
 *
 *  - **Rows 1–4 are the developer's, verbatim** (ratified 2026-08-07): ore mined
 *    1×, damage dealt 2×, ships destroyed 5×, stations destroyed 10×.
 *  - **Rows 5–11 are s4's** — ore banked, structures, upgrades, repairs, waves,
 *    placement, the win — and they are plan **Question A**, shipped under the
 *    recommendation to keep them. They are what makes XP "a hook that rewards
 *    showing up": on the ratified four alone, measured, the first player knocked
 *    out of an Easy lobby out-earns the winner (0.3× spread) and a typical match
 *    pays 149 XP instead of 399. **If the developer drops them, `XP_CURVE_BASE`
 *    must be re-tuned to 75 in the same change** (plan §1.4) — 300 stops landing
 *    level 2 inside a first match, and `src/progression/curve.test.ts`'s table
 *    lock is the test that goes red to say so.
 *  - **`DAMAGE_HP_PER_UNIT = 25` is plan Question B.** A weight is not an economy
 *    until its unit is chosen: at the literal 1 HP, damage becomes 94% of all XP
 *    earned and stations destroyed — the row weighted *highest* — rounds to 0%.
 *    At 25 HP all four ratified rows are legible at once (combat 42% of pay, ore
 *    17%), and a full 50-HP hull melted pays about what the kill that ends it
 *    does. It is one constant and one dial.
 *
 * Two rules the shape below is obeying, both for the summary sequence (§6.3):
 *
 *  1. **The rows sum to the total, exactly.** Each row is rounded once, and the
 *     total is the sum of the rounded rows — never a rounded sum. A screen that
 *     counts eleven rows up and then shows a total that is one XP off is a screen
 *     nobody can trust.
 *  2. **The list is fixed-length and fixed-order**, zero-count rows included, so
 *     the animation's timeline does not change shape with the match. Filtering is
 *     the view's business.
 */

import { Difficulty } from '../bots';
import { TIER_ORDER, type MatchAccrual } from './accrual';

// ---------------------------------------------------------------------------
// The dials — plan §1.3d, every one TUNABLE
// ---------------------------------------------------------------------------

/** XP per ore that entered the hold (mined + scavenged). The base unit the whole
 *  economy is denominated in. RATIFIED 2026-08-07. TUNABLE */
export const XP_PER_ORE_MINED = 1;
/** XP per unit of damage dealt. RATIFIED 2026-08-07. TUNABLE */
export const XP_PER_DAMAGE_UNIT = 2;
/** HP in one unit of "damage dealt" — plan §1.3a, Question B. TUNABLE */
export const DAMAGE_HP_PER_UNIT = 25;
/** XP per enemy ship destroyed. RATIFIED 2026-08-07. TUNABLE */
export const XP_PER_SHIP_KILL = 5;
/** XP per enemy station destroyed. RATIFIED 2026-08-07. TUNABLE */
export const XP_PER_STATION_KILL = 10;
/** XP per ore banked. Weighted 2× gathered on purpose: gathering is the effort,
 *  banking is the result the design rewards — held ore is not safe (GDD §2.3), so
 *  XP nudges toward the loop's payoff exactly as the economy does. TUNABLE */
export const XP_PER_ORE_BANKED = 2;
/** XP per structure ordered (turret, shield, satellite). TUNABLE */
export const XP_PER_STRUCTURE = 12;
/** XP per upgrade tier bought, on any of the four tracks. TUNABLE */
export const XP_PER_UPGRADE_TIER = 20;
/** XP per reactor patch (`REPAIR_HP_PER_ORE` of core HP). TUNABLE */
export const XP_PER_REPAIR = 3;
/** XP per asteroid wave survived. TUNABLE */
export const XP_PER_WAVE = 15;
/** XP per placement rung — one rung per player you outlasted. TUNABLE */
export const XP_PER_PLACEMENT_RUNG = 20;
/** Flat XP for winning the match. TUNABLE */
export const XP_FOR_WIN = 200;

/**
 * What an opponent's difficulty multiplies the three opponent-facing rows by
 * (plan §1.3b). A kill is worth its weight **times what it cost to get**, and the
 * tier is local, deterministic and unspoofable: nothing about a bot's difficulty
 * ever arrives over a wire. TUNABLE
 */
export const TIER_MULTIPLIER: Readonly<Record<Difficulty, number>> = {
  [Difficulty.Easy]: 0.75,
  [Difficulty.Medium]: 1.0,
  [Difficulty.Hard]: 1.25,
};

/**
 * The tier a **human** opponent is scored at.
 *
 * **A human counts as Hard by decision, not by measurement.** A human is not
 * reliably harder than Warden — a beginner is reliably easier than Rusty. They
 * are scored at the top tier because *contesting a person is the point of the
 * mode*: the multiplier pays for the KIND of opposition, not for a measured
 * difficulty. Written here so it is not "corrected" in six weeks on the argument
 * that humans lose more often than Warden does, which is true and irrelevant
 * (plan §1.3b). TUNABLE
 */
export const HUMAN_TIER: Difficulty = Difficulty.Hard;

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

/** Stable identity for one row of the §1.3d table — what a view keys off, and
 *  what a test names. */
export type XpRowKey =
  | 'oreMined'
  | 'damage'
  | 'shipKills'
  | 'stationKills'
  | 'oreBanked'
  | 'structures'
  | 'upgrades'
  | 'repairs'
  | 'waves'
  | 'placement'
  | 'win';

/** One priced row: what happened, and what it paid. */
export interface XpRow {
  readonly key: XpRowKey;
  /** Display label, upper-case like every other plate on the end screen. */
  readonly label: string;
  /** How much of it there was, in the row's own unit — ore, HP, kills, tiers,
   *  patches, waves, rungs, or 1/0 for the win. Fractional where the measurement
   *  is (repairs, apportioned damage); a view rounds it for display. */
  readonly count: number;
  /** XP this row paid, already rounded to a whole number. */
  readonly xp: number;
  /** Whether the opponent-tier multiplier applied to it. True for exactly three
   *  rows — damage, ship kills, station kills — and false for the other eight.
   *  Ore mined is never multiplied: it has no opponent (plan §1.3b). */
  readonly tierScaled: boolean;
}

/** The priced match: the rows, and the total they sum to. */
export interface MatchXp {
  readonly total: number;
  readonly rows: readonly XpRow[];
}

/** Σ over tiers of `count[tier] · weight · multiplier[tier]` — the opponent-facing
 *  arithmetic, in one place so the three rows that use it cannot drift apart. */
function tierWeighted(counts: Record<Difficulty, number>, weight: number): number {
  let xp = 0;
  for (const tier of TIER_ORDER) xp += counts[tier] * weight * TIER_MULTIPLIER[tier];
  return xp;
}

/** Σ over tiers, unweighted — the raw count a row displays. */
function tierCount(counts: Record<Difficulty, number>): number {
  let n = 0;
  for (const tier of TIER_ORDER) n += counts[tier];
  return n;
}

/**
 * Price one match.
 *
 * Deterministic and pure: same accrual in, same rows and same total out, on every
 * run and every machine. No clock, no randomness, and no iteration over object
 * keys in an order the runtime chooses ({@link TIER_ORDER} fixes it).
 */
export function xpForMatch(a: MatchAccrual): MatchXp {
  const damageUnits = tierScaledUnits(a.damageDealt);
  /** Players outlasted: the winner of an eight-seat lobby cleared seven rungs,
   *  the first out cleared none. */
  const rungs = Math.max(0, a.slots - a.placement);

  const rows: XpRow[] = [
    row('oreMined', 'ORE MINED', a.oreMined, a.oreMined * XP_PER_ORE_MINED, false),
    row('damage', 'DAMAGE DEALT', tierCount(a.damageDealt), damageUnits * XP_PER_DAMAGE_UNIT, true),
    row('shipKills', 'SHIPS DESTROYED', tierCount(a.shipKills), tierWeighted(a.shipKills, XP_PER_SHIP_KILL), true),
    row(
      'stationKills',
      'STATIONS DESTROYED',
      tierCount(a.stationKills),
      tierWeighted(a.stationKills, XP_PER_STATION_KILL),
      true,
    ),
    row('oreBanked', 'ORE BANKED', a.oreBanked, a.oreBanked * XP_PER_ORE_BANKED, false),
    row('structures', 'DEFENCES BUILT', a.structures, a.structures * XP_PER_STRUCTURE, false),
    row('upgrades', 'UPGRADES BOUGHT', a.upgrades, a.upgrades * XP_PER_UPGRADE_TIER, false),
    row('repairs', 'REACTOR PATCHED', a.repairs, a.repairs * XP_PER_REPAIR, false),
    row('waves', 'WAVES SURVIVED', a.wavesSurvived, a.wavesSurvived * XP_PER_WAVE, false),
    row('placement', 'PLACEMENT', rungs, rungs * XP_PER_PLACEMENT_RUNG, false),
    row('win', 'MATCH WON', a.won ? 1 : 0, a.won ? XP_FOR_WIN : 0, false),
  ];

  // The total is the sum of the ROUNDED rows, never a rounded sum: the rows a
  // player watches count up must add up to the number underneath them (§6.3).
  return { total: rows.reduce((sum, r) => sum + r.xp, 0), rows };
}

/** Damage, converted from HP to units and tier-multiplied — the one row whose
 *  count and pay are in different units. */
function tierScaledUnits(hpByTier: Record<Difficulty, number>): number {
  let units = 0;
  for (const tier of TIER_ORDER) units += (hpByTier[tier] / DAMAGE_HP_PER_UNIT) * TIER_MULTIPLIER[tier];
  return units;
}

function row(key: XpRowKey, label: string, count: number, xp: number, scaled: boolean): XpRow {
  return {
    key,
    label,
    count,
    // Round once, here, and never again. A negative or non-finite input folds to
    // zero rather than propagating into a level bar.
    xp: Number.isFinite(xp) ? Math.max(0, Math.round(xp)) : 0,
    tierScaled: scaled,
  };
}
