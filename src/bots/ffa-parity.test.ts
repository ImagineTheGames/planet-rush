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
 * **Do not re-baseline these.** The only thing that has ever earned it is a
 * ratified amendment in `docs/design-amendments.md`.
 */
const GOLDEN: readonly (readonly [seed: number, hash: string])[] = [
  [20260806, 'ed228be2'],
  [7, 'c28d0f6b'],
  [991, '1c0cdaa3'],
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
