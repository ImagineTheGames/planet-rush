/**
 * tests/adversarial/latch-bounds.test.ts — **the standing gate.** OWNER: QA
 * Agent (a0-106).
 *
 * a0-81 and a0-105 both reached this studio as a screenshot and a sentence,
 * because both of them are things that only happen when somebody stands
 * somewhere a bot does not expect. The match harness cannot find them: it plays
 * bot-vs-bot, and bots play the game the way it is meant to be played. This file
 * is the part of the suite that plays it badly on purpose.
 *
 * It runs the whole cross-product — every latch in the census (`./latches.ts`) ×
 * every antagonist (`./antagonist.ts`) × every character in the shipped cast —
 * and asserts one property, a0-105's own ruling generalised:
 *
 * > **Any latch whose release depends only on conditions an opponent controls
 * > can be held open by that opponent.**
 *
 * ── The three assertions ───────────────────────────────────────────────────
 *
 *  1. **A bound exists.** Every latch that carries a ceiling releases inside it,
 *     in every cell. The ceilings are deliberately generous (`./latches.ts`):
 *     the claim is that a bound EXISTS, not that it is tight, so this fails on a
 *     latch that runs forever rather than on one that runs a second longer than
 *     it used to.
 *  2. **An unbounded latch still leaves the bot playing.** Some latches are
 *     *correctly* unbounded — `defend` while a hostile sits in your alarm ring,
 *     `last-stand` while your own core is being taken, `haul` while your hold is
 *     full. Those have no ceiling and should not have one. What they must never
 *     be is the a0-105 photograph: a hold that ran long with the trigger up and
 *     the ship parked. That predicate is `inert` (`./sweep.ts`) and it is the
 *     assertion that keeps "unbounded by design" from becoming a place to hide.
 *  3. **Every pinned defect still reproduces, exactly where its report says.**
 *     a0-106 found one, on the flee latch, and QA does not own `src/bots/` — the
 *     bots agent does — so it shipped pinned rather than fixed: {@link
 *     KNOWN_UNBOUNDED} was the reproduction and the assertion failed **the day
 *     it was fixed**, which is the signal to delete the entry rather than to go
 *     looking for what broke. That day was a0-107, so the list is now empty and
 *     assertion 1 exempts nothing. The mechanism stands for the next finding.
 *
 * ── Why it is affordable ───────────────────────────────────────────────────
 *
 * One run per cell answers every latch at once, because every latch is read on
 * every tick of it. Twelve antagonists × seven characters is eighty-four runs and
 * about seven seconds of wall clock — cheap enough to be a standing gate rather
 * than an evidence script somebody remembers to run.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ANTAGONISTS } from './antagonist';
import { LATCHES } from './latches';
import { CAST, inert, overBound, seconds, sweep } from './sweep';
import type { Cell } from './sweep';

/**
 * **The a0-106 finding, pinned — and closed.**
 * `latch | antagonist | character` for every cell that breaches today.
 *
 * It is empty, and that is the finding's ending rather than its absence. a0-106
 * pinned twenty-five cells here, all of them one defect: the retreat's
 * turn-and-fight exit — the thing a0-105 added so that a retreat *ends* — was
 * itself gated behind two preconditions an opponent controls, so an opponent who
 * stood in the right place switched it off and the flee latch was unbounded
 * again. a0-107 removed both gates: the standoff now measures the two things a
 * retreat can be doing (opening ground on the threat, closing the road to its
 * refuge), both of them the bot's own doing, and a read that shows neither
 * *spends* the patience clock rather than resetting it. All twenty-five cells
 * release inside the `fleeing` bound, `park@580` first among them.
 * `tests/reports/a0-107-dead-band.md` is the write-up, with the held ticks
 * before and after at three ceilings.
 *
 * **It stays here, and empty.** The two assertions that read it point in
 * opposite directions on purpose — assertion 1 subtracts this list, assertion 3
 * requires every entry in it to still breach — so the list cannot rot in either
 * direction, and an empty one is the strongest form of both: every cell in the
 * cross-product is now held to its own ceiling with nothing exempted. A future
 * finding is pinned by adding lines back.
 */
const KNOWN_UNBOUNDED: readonly string[] = [];

/**
 * The one latch the census enumerates and this instrument cannot reach:
 * `join-assault` needs a **teammate to open a raid**, and no antagonist can
 * cause that — the antagonist is a hostile, and the only bots that could open a
 * raid are running their own unscripted trees.
 *
 * Declared here rather than quietly omitted, because a coverage hole that is not
 * written down reads as coverage. Its primitive is the same `AllyResponse` that
 * `ally-response` exercises (measured below, and it holds to its own
 * `ALLY_RESPONSE_MAX` exactly), and its own ceiling `ASSAULT_JOIN_MAX` is pinned
 * directly in `src/bots/ally-assault.test.ts`.
 */
const NOT_REACHABLE = new Set(['ally-assault']);

const key = (latch: string, antagonist: string, personality: string): string =>
  `${latch}|${antagonist}|${personality}`;

/** Every breaching cell in the sweep, as a printable line. */
interface Breach {
  readonly key: string;
  readonly line: string;
}

describe('a0-106 — the adversarial latch sweep', () => {
  let cells: Cell[] = [];
  let breaches: Breach[] = [];

  beforeAll(() => {
    cells = sweep();
    breaches = [];
    for (const cell of cells) {
      for (const latch of LATCHES) {
        const h = cell.holds.get(latch.id)!;
        const over = overBound(latch, h);
        const dead = inert(h);
        if (!over && !dead) continue;
        breaches.push({
          key: key(latch.id, cell.antagonist.id, cell.personality),
          line:
            `${latch.id} held ${h.ticks} ticks (${seconds(h.ticks).toFixed(2)}s` +
            `${h.openAtCeiling ? ', STILL OPEN at the ceiling' : ''}) ` +
            `by ${cell.antagonist.id} against ${cell.personality} [${cell.tier}] — ` +
            `${over ? `over its ${latch.boundS}s bound` : 'inert'}, ` +
            `fired ${(h.firedFrac * 100).toFixed(0)}% of it, moved ${h.travelled.toFixed(0)}u, ` +
            `turned to '${h.turnedTo}'`,
        });
      }
    }
  }, 120_000);

  it('no behaviour latch is held open by an opponent standing still', () => {
    // The whole property, in one list. A latch that carries a ceiling must
    // release inside it under every antagonist, at every tier — and a latch with
    // no ceiling must at least never leave the bot parked and silent.
    //
    // `KNOWN_UNBOUNDED` is subtracted rather than skipped at measurement time,
    // so a cell that is on the list AND breaches for a second, unrelated reason
    // is still only one line to remove once the first one is fixed.
    const fresh = breaches.filter((b) => !KNOWN_UNBOUNDED.includes(b.key));
    expect(fresh.map((b) => b.line)).toEqual([]);
  });

  it('a latch with no ceiling still never leaves the bot switched off', () => {
    // The half of the property that a duration bound cannot express. `defend`,
    // `last-stand`, `haul`, `mine` and `cornered` are all allowed to run for as
    // long as the situation that caused them lasts — that is the game being
    // played. None of them is allowed to run long with the trigger up and the
    // ship parked, because that is not a situation, that is the switch the
    // developer found.
    const unbounded = LATCHES.filter((l) => l.boundS === null);
    const parked: string[] = [];
    for (const cell of cells) {
      for (const latch of unbounded) {
        const h = cell.holds.get(latch.id)!;
        if (!inert(h)) continue;
        parked.push(
          `${latch.id} × ${cell.antagonist.id} × ${cell.personality}: ` +
            `${seconds(h.ticks).toFixed(2)}s parked and silent`,
        );
      }
    }
    expect(parked).toEqual([]);
  });

  it('the a0-106 flee-latch defect still reproduces where the report says it does', () => {
    // The pin, and it points the other way on purpose: this fails on the day the
    // bots agent lands the fix, and the failure means "delete these lines", not
    // "something broke". QA owns `tests/` and `harness/`; the behaviour is the
    // bots agent's, so the finding ships as an instrument and a report rather
    // than as an edit to `src/bots/`.
    const seen = new Set(breaches.map((b) => b.key));
    const healed = KNOWN_UNBOUNDED.filter((k) => !seen.has(k));
    expect(
      healed,
      'these no longer reproduce — if a0-106 has been fixed, remove them from KNOWN_UNBOUNDED',
    ).toEqual([]);
  });

  it('every latch in the census was actually engaged by something', () => {
    // Coverage honesty. A sweep that asserts a bound on a latch it never turned
    // on is a green tick that means nothing, and this is the assertion that
    // stops the census growing entries nobody exercises.
    const never = LATCHES.filter(
      (l) => !NOT_REACHABLE.has(l.id) && cells.every((c) => c.holds.get(l.id)!.ticks === 0),
    ).map((l) => l.id);
    expect(never).toEqual([]);
  });

  it('the cross-product is the full one — every antagonist, every character', () => {
    // The gate the DoD names runs the whole thing; this is what says so, so that
    // a future edit which quietly narrows the cast or drops an antagonist fails
    // here rather than passing more easily.
    expect(cells.length).toBe(ANTAGONISTS.length * CAST.length);
    expect(new Set(cells.map((c) => c.antagonist.id)).size).toBe(ANTAGONISTS.length);
    expect(new Set(cells.map((c) => c.personality)).size).toBe(CAST.length);
    expect(new Set(cells.map((c) => c.tier))).toEqual(new Set(['easy', 'medium', 'hard']));
  });
});
