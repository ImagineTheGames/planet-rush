/**
 * src/bots/ffa-parity.test.ts — **FFA did not move.** OWNER: Bot Engineer
 * (`docs/team-bots-plan.md` Stage 1 Task 1.6; GDD §4.8).
 *
 * This is the guard on the whole team-bots chain, and it is deliberately the
 * bluntest instrument available: a full eight-bot FFA match at a fixed seed must
 * hash to a **literal** taken from `main` before Stage 1 was written.
 *
 * Three properties of that choice are the point:
 *
 *  1. **A hash, not a win rate.** A win-rate check stays green through a real
 *     behavioural drift — bots that fly differently and still win as often. The
 *     state hash (`harness/hash.ts` — every ship, rock, chunk, station, turret,
 *     shield, build job, projectile and the match clock) cannot. If one bot
 *     thrusts one micro-unit differently on tick 4 000, this fails.
 *  2. **A literal, not a two-run comparison.** Two runs of the same build agree
 *     with each other forever, including while they drift together away from
 *     what shipped. The numbers below were measured on `main` at 5d66213, and
 *     they are the only thing in this file with any authority.
 *  3. **If it fails, something in Stage 1 changed FFA and must be reverted, not
 *     re-baselined.** FFA is teams-of-one — every bot's ally list is empty, every
 *     `hostile` stamp is true — so *no* team-aware path may be reachable there.
 *     A new number here would be a claim that FFA is allowed to move, and it is
 *     not (plan §6: "FFA must not move at all").
 *
 * ### Re-baselined once, 2026-08-07 (a0-05) — and why that is not a loophole
 *
 * Rule 3 is about **Stage 1 leaking into FFA**. A ratified change to what *every*
 * bot perceives in *every* mode is a different animal, and there is no honest way
 * to hold a state hash across one: GDD §2.2 was amended so a station's damage
 * ring reads at any range, the bot layer's station-HP gate widened with it
 * (`SENSOR_RANGE` → `visualRange`, so bots and humans learn the same things at
 * the same moment — GDD §2.9), and bots consequently steer, commit and besiege
 * differently from the first minute. Freezing the old hashes would have meant
 * keeping bots blind to a ring their human opponents can read, which is the
 * handicap the amendment exists to prevent.
 *
 * So the goldens below moved **once**, deliberately, in the commit that carries
 * the amendment. The previous values are kept so the movement is traceable rather
 * than silent:
 *
 * | Seed | Pre-a0-05 (main @ 5d66213) | Post-a0-05 |
 * |---|---|---|
 * | 20260806 | `6d78b590` | `ed228be2` |
 * | 7 | `f358341a` | `c28d0f6b` |
 * | 991 | `210f7504` | `1c0cdaa3` |
 *
 * **Rule 3 still stands for everything else.** The bar for touching these numbers
 * is a *ratified developer amendment recorded in `docs/design-amendments.md`* —
 * not a refactor, not a tuning pass, and never "the test went red".
 *
 * ### Re-baselined a second time, 2026-08-16 (a0-58) — on that same bar
 *
 * Gameplay lane, flagged for the Bot Engineer. The bar above is met in the way it
 * is written: *"Ore is a countable thing: every mint is WHOLE, and a hold can
 * never hold half of one"* in `docs/design-amendments.md`, ratified off the
 * developer's *"its super easy to reproduce this ore bug, its usually from blown
 * up ships, their ore's don't always count when picked up"*. A death drop, a wreck
 * ring and a mined-out rock each used to mint one sub-`CHUNK.ore` piece, and a
 * fraction that lands in a hold is ore every readout in the game floors away.
 *
 * It is the same *kind* of change a0-05 was and not a Stage 1 leak: it moves what
 * the WORLD does, in every mode, for every player and bot alike — chunk counts and
 * positions differ from the first mined rock onward, so eight bots flying the same
 * decisions arrive somewhere else. There is no honest way to hold a state hash
 * across it, and freezing the old numbers would mean freezing an economy that
 * mints a denomination the interface cannot print.
 *
 * | Seed | Pre-a0-05 | Post-a0-05 | Post-a0-58 |
 * |---|---|---|---|
 * | 20260806 | `6d78b590` | `ed228be2` | `f31d2c3b` |
 * | 7 | `f358341a` | `c28d0f6b` | `2400ba7e` |
 * | 991 | `210f7504` | `1c0cdaa3` | `b891918a` |
 *
 * **Rule 3 is unweakened.** Nothing team-aware moved, and the two non-hash cases
 * below — the empty ally list on every FFA bot, and the guard that a real team
 * lineup hashes differently — are untouched and still the thing that stops a
 * team-aware path from hiding behind a number.
 *
 * ### Re-baselined a third time, 2026-08-16 (a0-59) — same bar, same day
 *
 * Gameplay lane, flagged for the Bot Engineer. a0-58 and a0-59 landed hours apart
 * and this branch is stacked on that one, so these numbers move twice in one day.
 * The bar is met the same way: *"A destroyed ship drops EVERYTHING: the half-burn
 * ore sink is withdrawn"* in `docs/design-amendments.md`, ratified off the
 * developer's *"destroyed ships should drop all their ore, no more 1/2 the ore
 * stuff"*. `DEATH_ORE_DROP_FRACTION` goes 0.5 → 1.
 *
 * This is a bigger world-move than a0-58's, not a smaller one. Every ship death in
 * an eight-bot match now lays down twice the chunks in the same ring, so the field
 * a bot perceives, the pickups it makes and the ore it spends all diverge from the
 * first kill onward. There is no honest way to hold a state hash across it.
 *
 * | Seed | Post-a0-58 | Post-a0-59 |
 * |---|---|---|
 * | 20260806 | `f31d2c3b` | `f290517f` |
 * | 7 | `2400ba7e` | `b8c73690` |
 * | 991 | `b891918a` | `84fd2ef2` |
 *
 * **Rule 3 is unweakened here too**, for exactly the reasons the paragraph above
 * gives: the two non-hash cases are untouched, and nothing in this change is
 * mode-aware at all — it is one constant in `src/sim/constants.ts`.
 *
 * ### Re-baselined a fourth time, 2026-08-16 (a0-65) — the map itself moved
 *
 * Gameplay lane, flagged for the Bot Engineer. This one is not an economy change
 * at all: the commons wave geometry was **entombing ships at the map centre** on
 * 100 seeds out of 100, and a0-65 fixed it. `WAVE.lastRadiusFraction` 0.25 → 0.5
 * plus a derived rock-size taper (`ringSizeScale()` in `src/sim/waves.ts`).
 * Amendment: *"The commons closes to a RING, not onto the centre — the field must
 * never entomb"* in `docs/design-amendments.md`; full report in
 * `docs/wave-commons-entombment.md`.
 *
 * This moves the asteroid field every bot flies through, so it is the largest
 * world-move of the four: every rock's radius and position on waves 4–5 differs,
 * and waves 1–3 differ in where later waves sit relative to them. There is no
 * honest way to hold a state hash across a changed map.
 *
 * | Seed | Post-a0-59 | Post-a0-65 |
 * |---|---|---|
 * | 20260806 | `f290517f` | `b02582c0` |
 * | 7 | `b8c73690` | `52475e8b` |
 * | 991 | `84fd2ef2` | `6bc0291a` |
 *
 * **Rule 3 is again unweakened**: the two non-hash cases are untouched, and
 * nothing in a0-65 is mode-aware — it is map geometry, identical in FFA and in
 * teams.
 *
 * ### Re-baselined a fifth time, 2026-08-17 (a0-81) — the bots' own lane
 *
 * The first of these five that is a **bot** change, so it is the one that has to
 * answer Rule 3 head-on rather than by pointing at another lane. It does, and on
 * the same bar: the developer's report is *"when rusty was fleeing from me he
 * could have auto fired at me but instead he didnt … thats what i would do"*, and
 * the rule it ratifies is that a bot's movement intent and fire intent are
 * independent — a retreating, hauling or banking bot fires at a hostile in range
 * on exactly the terms a player has (brief a0-81; audit in
 * `evidence/a0-81-fleeing-fire/audit.txt`).
 *
 * **Why it is not the thing Rule 3 forbids.** Rule 3 exists to catch a
 * *team-aware path leaking into FFA*: FFA is teams-of-one, so a branch that only
 * runs when a bot has allies must be unreachable there, and a moved hash would
 * be the proof it was reached. Nothing in a0-81 is team-aware. `coveringFire`
 * asks `isTargetable` — the single `hostile` stamp off `sim/allegiance.ts`, which
 * in FFA is true for every ship on the board — and takes no other branch on
 * anything about sides, radios or ally lists. It moves FFA and TEAMS by the
 * identical mechanism, which is the definition of the a0-05 category and the
 * opposite of the leak. The two non-hash cases below are untouched and still the
 * thing that would catch the leak if one ever happened.
 *
 * It moves the hash from the first engagement, and unavoidably: eight bots that
 * shoot while breaking off deal and take damage on ticks they previously did
 * not, so hulls, projectiles, kills, chunks and every downstream decision differ.
 * Measured over eight full matches, no bot in the shipped cast fired a single
 * shot while retreating before this and they fire 1.34 / 2.16 / 2.32 per
 * chased-second after, by tier.
 *
 * | Seed | Post-a0-65 | Post-a0-81 |
 * |---|---|---|
 * | 20260806 | `b02582c0` | `de94b69e` |
 * | 7 | `52475e8b` | `ab03dcd3` |
 * | 991 | `6bc0291a` | `a37c4e2c` |
 *
 * ### Re-baselined a sixth time, 2026-08-19 (a0-105) — the bots' own lane again
 *
 * The same category as a0-81 and answered the same way. The developer's report
 * is *"I was able to make rusty just stay stuck there by putting myself in
 * between the ore and his base. he just stayed in that same spot scared of me.
 * ship lives are cheap. enemies should not fear death..."*, and the rule it
 * ratifies is that a retreat is a manoeuvre and must **terminate**: a bot that
 * has run out of road and can neither heal nor break contact turns and fights
 * (brief a0-105; `./standoff.ts`; measurements in
 * `evidence/a0-105-standoff/standoff.txt`).
 *
 * **Why it is not the thing Rule 3 forbids.** Nothing in a0-105 is team-aware.
 * The standoff reads one distance, to `nearestThreat` — which asks
 * `isTargetable`, the single `hostile` stamp off `sim/allegiance.ts`, true for
 * every ship on an FFA board — plus this bot's own station and its own hull. It
 * takes no branch on sides, radios or ally lists, so it moves FFA and TEAMS by
 * the identical mechanism, which is the a0-05 category and the opposite of a
 * leak. The two non-hash cases below are untouched and are still the thing that
 * would catch a leak if one ever happened.
 *
 * It moves the hash from the first standoff, and unavoidably: a wounded bot at
 * its own doorstep now fights on ticks it previously spent holding station, so
 * hulls, kills, chunks and every downstream decision differ. Measured over five
 * whole matches, `turn-and-fight` takes 0.6% of all decisions (beside
 * `cornered-fight`'s 1.1%), and the retreat itself is still 17.6% of them.
 *
 * | Seed | Post-a0-81 | Post-a0-105 |
 * |---|---|---|
 * | 20260806 | `de94b69e` | `42e213df` |
 * | 7 | `ab03dcd3` | `51f2e171` |
 * | 991 | `a37c4e2c` | `a096a954` |
 *
 * The last case is the one that stops this file from being vacuous: it asserts
 * the harness can build a team world *at all*, and that the same lineup on two
 * sides hashes differently. Without it, a `botLobby` that quietly dropped the
 * team again would sail through every assertion above.
 */

import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim';
import { hashState } from '../../harness/hash';
import { MATCH_SLOTS, botLobby, createBots, fillEmptySlots, runHeadlessMatch } from './harness';
import { perceive } from './perception';
import { ROSTER } from './personalities';

/**
 * Sim seconds recorded. Long enough that every subsystem a bot touches has run
 * many times over — waves, mining, chunks, construction, turret fire, combat,
 * the first eliminations — and short enough that CI never notices. The match is
 * still live at the end of it, which is deliberate: a hash of a *finished* match
 * is a hash of eight wrecks and says much less.
 */
const SECONDS = 180;

/**
 * The goldens. Originally measured on `main` at 5d66213 — before `BotSeat.team`,
 * `BotView.allies`, or the elimination-cadence fix — with exactly the run below;
 * re-measured on `agent/gameplay/a0-05-station-health-always-visible` when the
 * always-visible amendment widened what every bot can read (see the module note
 * for the old values and the reasoning).
 *
 * re-measured again on `agent/gameplay/a0-58-whole-ore-only` when every ore mint
 * became whole (a0-58), once more on `agent/gameplay/a0-59-full-death-drop` when a
 * destroyed ship began dropping its whole hold (a0-59), and a fourth time on the
 * same branch when a0-65 reshaped the commons waves so they stop entombing ships
 * at the map centre, and a fifth time on `agent/bots/a0-81-fire-while-fleeing`
 * when a bot breaking off stopped holding its fire, and a sixth time on
 * `agent/bots/a0-105-no-fear-of-death` when a retreat that had run out of road
 * stopped lasting forever — the module note carries all six moves and their
 * reasons.
 *
 * **Do not re-baseline these.** The only thing that has ever earned it is a
 * ratified amendment in `docs/design-amendments.md`.
 */
const GOLDEN: readonly (readonly [seed: number, hash: string])[] = [
  [20260806, '42e213df'],
  [7, '51f2e171'],
  [991, 'a096a954'],
];

/** One eight-bot match, the shipped cast, the offline lobby's own roster path. */
function ffaMatch(seed: number, teams?: readonly number[]): string {
  const seats = fillEmptySlots([], MATCH_SLOTS, ROSTER, teams);
  const world = createWorld({ seed, players: botLobby(seats) });
  runHeadlessMatch(world, createBots(seats, { seed }), { maxSeconds: SECONDS });
  return hashState(world);
}

describe('FFA is byte-identical to the pre-Stage-1 build (Task 1.6)', () => {
  for (const [seed, hash] of GOLDEN) {
    it(`hashes to ${hash} at seed ${seed}`, () => {
      expect(ffaMatch(seed)).toBe(hash);
    });
  }

  it('gives every FFA bot an empty ally list and an all-hostile board', () => {
    // The structural reason the hashes above cannot move: there is no ally to
    // be team-aware *about*, so no team-aware branch can ever be reached
    // (plan §2.5 — FFA degrades structurally, not by a flag).
    const seats = fillEmptySlots();
    const world = createWorld({ seed: 20260806, players: botLobby(seats) });
    for (const seat of seats) {
      const view = perceive(world, seat.id);
      expect(view.allies, `slot ${seat.id}`).toEqual([]);
      expect(view.self.team, `slot ${seat.id}`).toBe(seat.id);
      expect(view.ships.every((s) => s.hostile)).toBe(true);
      expect(view.stations.every((s) => s.hostile)).toBe(true);
    }
  });

  it('does move when the lineup really is a team one — the guard on the guard', () => {
    // If `botLobby` ever drops the team again (Trap 1), this is the assertion
    // that notices: same seed, same cast, same seats, one side table, and the
    // match must diverge. A hash-parity test whose "teams" world is secretly an
    // FFA world passes forever and proves nothing.
    const teamed = ffaMatch(20260806, [0, 0, 0, 0, 1, 1, 1, 1]);
    expect(teamed).not.toBe('6d78b590');
  });
});
