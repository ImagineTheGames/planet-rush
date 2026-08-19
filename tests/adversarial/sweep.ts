/**
 * tests/adversarial/sweep.ts — **the cross-product, run once.** OWNER: QA Agent
 * (a0-106).
 *
 * `./latches.ts` says what to watch, `./antagonist.ts` says who to watch it
 * against; this file is the loop that crosses them and the readings that come
 * out. It exists as its own module rather than inside the spec so that the
 * report generator (`./report.ts`) and the standing gate
 * (`./latch-bounds.test.ts`) measure **the same thing with the same code** — a
 * report whose numbers were produced by a second implementation is a report
 * about that implementation.
 *
 * Every cell is one antagonist × one character, run to the ceiling, with every
 * latch in the census read on every tick. One run answers every latch, which is
 * the reason this is affordable at all: the alternative — one bespoke staging
 * per latch — is both slower and less honest, because it would only ever find
 * the holds somebody already suspected.
 */

import { TICK_DT } from '../../src/sim';
import { PERSONALITIES } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';
import { ANTAGONISTS, hold, run } from './antagonist';
import type { Antagonist, Hold } from './antagonist';
import { LATCHES } from './latches';
import type { LatchSpec } from './latches';

/**
 * Ceiling on one cell, seconds of sim.
 *
 * Forty seconds is far past any patience any tier could defensibly have (the
 * loosest `standoffPatience` is five, the flee commit window is four, the
 * ally-response ceiling is forty-five and is asserted separately at a longer
 * run), and comfortably past the point where a player watching would call the
 * bot broken. The claim these runs support is *"a bound exists"*, so the ceiling
 * only has to be long enough that a latch which does not release inside it is
 * one that does not release.
 *
 * `A0106_SECONDS` overrides, which is how a suspected unbounded hold is shown to
 * be unbounded rather than merely long: run the same cell at 40, 120, 600 and
 * watch the number track the ceiling.
 */
export const CEILING_S = Number(process.env.A0106_SECONDS ?? 40);

/** The two ally latches need a longer look than everything else: their own
 *  ceiling (`ALLY_RESPONSE_MAX`) is 45 s, so a 40 s run could not tell a bounded
 *  hold from an unbounded one. The squad stagings run at this instead. */
export const SQUAD_CEILING_S = Math.max(CEILING_S, 90);

/** One (antagonist × character) cell, with every latch read out of it. */
export interface Cell {
  readonly antagonist: Antagonist;
  readonly personality: PersonalityId;
  readonly tier: string;
  /** Latch id → its longest unbroken hold in this cell. */
  readonly holds: ReadonlyMap<string, Hold>;
  /** Ticks the subject spent dead across the whole run. */
  readonly deaths: number;
  /** Length of the run, ticks — so a reader can see a hold that ran the ceiling. */
  readonly ticks: number;
}

/** Every character in the shipped cast, in roster order. */
export const CAST = Object.keys(PERSONALITIES) as PersonalityId[];

/** The tier a character plays at, as a printable string. */
export function tierOf(personality: PersonalityId): string {
  return String(PERSONALITIES[personality].difficulty);
}

/** Run one cell. */
export function measure(antagonist: Antagonist, personality: PersonalityId): Cell {
  const seconds = antagonist.staging.slots > 2 ? SQUAD_CEILING_S : CEILING_S;
  const trace = run(antagonist, personality, { seconds, watches: LATCHES });
  const holds = new Map<string, Hold>();
  for (const latch of LATCHES) holds.set(latch.id, hold(trace, latch.id));
  return {
    antagonist,
    personality,
    tier: tierOf(personality),
    holds,
    deaths: trace.deaths,
    ticks: trace.frames.length,
  };
}

/** The whole cross-product: every antagonist against every character. */
export function sweep(
  antagonists: readonly Antagonist[] = ANTAGONISTS,
  cast: readonly PersonalityId[] = CAST,
): Cell[] {
  const cells: Cell[] = [];
  for (const antagonist of antagonists) {
    for (const personality of cast) cells.push(measure(antagonist, personality));
  }
  return cells;
}

/** Seconds, for a tick count. */
export function seconds(ticks: number): number {
  return ticks * TICK_DT;
}

/**
 * Did this hold breach the latch's own ceiling?
 *
 * `null` bounds — the latches that are correctly unbounded — never breach on
 * duration. They are still asserted on, by {@link inert} below: an unbounded
 * latch is defensible only while the bot is *doing* something inside it.
 */
export function overBound(latch: LatchSpec, h: Hold): boolean {
  if (latch.boundS === null) return false;
  return seconds(h.ticks) > latch.boundS;
}

/** How long a hold has to run before "the bot did nothing in it" is a claim
 *  worth making rather than a coincidence of two quiet seconds. */
export const INERT_MIN_S = 8;

/** Trigger-down fraction below which a long hold counts as passive. */
export const INERT_FIRE_FRAC = 0.02;

/** World units a passive hold has to stay inside to count as parked. Two ship
 *  lengths: anything less is station-keeping, not travelling. */
export const INERT_TRAVEL = 64;

/**
 * **Switched off.** A hold that ran long, never fired a shot, and never went
 * anywhere — the a0-105 photograph, expressed as a predicate.
 *
 * This is the assertion that covers the latches with no duration ceiling. A bot
 * can legitimately hold `defend` for the whole match while an opponent sits on
 * its doorstep; what it cannot legitimately do is hold it while parked and
 * silent, because that is not defending, that is the switch the developer found.
 */
export function inert(h: Hold): boolean {
  return (
    seconds(h.ticks) >= INERT_MIN_S && h.firedFrac < INERT_FIRE_FRAC && h.travelled < INERT_TRAVEL
  );
}
