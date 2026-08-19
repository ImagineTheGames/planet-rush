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
 *  3. **The known defect still reproduces, exactly where the report says.**
 *     a0-106 found one, on the flee latch, and QA does not own `src/bots/` — the
 *     bots agent does. So it is pinned rather than fixed: {@link KNOWN_UNBOUNDED}
 *     is the reproduction, `tests/reports/a0-106-adversarial.md` is the write-up,
 *     and the third assertion below fails **the day it is fixed**, which is the
 *     signal to delete the entry rather than to go looking for what broke.
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
 * **The a0-106 finding, pinned.** `latch | antagonist | character` for every
 * cell that breaches today.
 *
 * Every entry here is one reproduction of **one defect**: the retreat's
 * turn-and-fight exit — the thing a0-105 added so that a retreat *ends* — is
 * itself gated behind two preconditions an opponent controls, so an opponent who
 * stands in the right place switches it off and the flee latch is unbounded
 * again. `tests/reports/a0-106-adversarial.md` has the mechanism, the geometry
 * and the numbers at three ceilings; this list is the machine-readable half of
 * it.
 *
 * **It is not an exemption.** Assertion 1 skips these cells and assertion 3
 * requires every one of them to still breach, so the list cannot rot in either
 * direction: a new unbounded hold fails assertion 1, and a fixed one fails
 * assertion 3.
 */
const KNOWN_UNBOUNDED: readonly string[] = [
  // (A) The RANGE DEAD-BAND. A hostile parked in the annulus between
  // `THREAT_RANGE` (416) and `RETREAT_CLEAR_RANGE` (676) is too far for
  // `wantsRetreat` to fold the standoff and too near for the flee latch to read
  // *escaped*. The patience clock is reset every tick and never starts.
  'fleeing|park@580|rusty',
  'fleeing|park@580|bolt',
  'fleeing|park@580|foreman',
  'fleeing|park@580|patch',
  'fleeing|park@580|sable',
  'fleeing|park@580|vulture',
  'fleeing|park@580|warden',
  'fleeing|park-squad|rusty',
  'fleeing|park-squad|bolt',
  'fleeing|park-squad|foreman',
  'fleeing|park-squad|patch',
  'fleeing|park-squad|sable',
  'fleeing|park-squad|vulture',
  'fleeing|park-squad|warden',
  // The same band, reached by standing on the ore instead of on the lane home.
  'fleeing|block-ore|rusty',
  'fleeing|block-ore|bolt',
  'fleeing|block-ore|foreman',
  'fleeing|block-ore|patch',
  'fleeing|block-ore|warden',
  // (B) The OUT-OF-ROAD FLAP. The hostile is inside `THREAT_RANGE` throughout,
  // but `retreatOutOfRoad` alternates as the subject oscillates around its own
  // `ARRIVE_RADIUS` — and every read that comes back "still has road" resets the
  // patience clock, so it never reaches even the shortest tier's patience.
  'fleeing|block-home|rusty',
  'fleeing|block-home|bolt',
  'fleeing|never-die|rusty',
  'fleeing|never-die|bolt',
  'fleeing|never-die-squad|rusty',
  'fleeing|never-die-squad|bolt',
];

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
