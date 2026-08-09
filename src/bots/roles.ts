/**
 * src/bots/roles.ts — **who, of a side, answers an alarm.** OWNER: Bot Engineer
 * (GDD §2.9, §4.8; `docs/team-bots-plan.md` Stage 4, the role split).
 *
 * `a0-10` shipped `defend-ally` and `b2-03` shipped `join-assault`, both as
 * independent per-bot decisions. Nothing in either stops **every** teammate
 * answering the same klaxon, which is the plan's own stated risk for Stage 2:
 *
 * > *"two bots abandoning two economies to answer one alarm."*
 *
 * The commitment latch (`./ally`) and its cooldown bound how *long* that lasts.
 * They do not stop it happening. This file is the fix the plan names, and it is
 * **not a second latch**: it is a derived assignment. Every bot on the side
 * computes the same function over the same public roster and arrives at the same
 * answer, so two allies never both believe they are the defender and never both
 * believe the other is — **without a message, and therefore without a negotiation
 * protocol to get wrong** (plan Trap 11).
 *
 * ---
 *
 * ## The information problem, which is the whole design
 *
 * The plan sketches the defender as *"nearest to the team's most-threatened
 * home"*. **A teammate's ship position is not public.** {@link
 * import('./perception').AllyView} deliberately carries no ship position and no
 * ship `alive` — its own doc comment argues the point at length — and
 * `view.ships` holds an ally only while it is inside sensor range. So "nearest"
 * measured on *ships* is a quantity each bot knows a different subset of, and a
 * function two bots disagree about is precisely the bug this feature exists to
 * prevent. Reaching for the radio instead is worse: a bot *claiming* the role and
 * others yielding is distributed consensus with an iteration-order hazard, which
 * is the thing Trap 11 forbids by name.
 *
 * What *is* public, range-free, and identical on every member of the side: the
 * roster ids, and for each of them the home's **position**, its **`alive`**, and
 * its **`underAttack`** klaxon. Everything below is derived from those four facts
 * and nothing else, which is what makes agreement structural rather than hoped
 * for.
 *
 * ## The assignment
 *
 * For an alarm on `owner`'s home, the defender is the **eligible** slot on that
 * side whose *own* home is nearest to the burning one, ties broken by
 * {@link import('./targeting').tiebreakKey}. Ranking by home-to-home distance is
 * the only distance the fog allows, and it is a meaningful one rather than a
 * consolation prize: `teamHomeSlots` seats teammates adjacent (`sim/state.ts`),
 * so a side's homes have a real neighbour ordering and the teammate next door is
 * the one with the shortest way back if its own door is next.
 *
 * Eligible excludes three sets, each for its own reason:
 *
 *  1. **The besieged owner itself.** It is already going: its own `defend` branch
 *     strictly outranks every ally branch in all three trees. Spending the role
 *     on it would designate a bot that needed no designating and leave **zero**
 *     teammates breaking off.
 *  2. **A slot whose own home is dead.** A dead core eliminates its owner
 *     (`sim/match.ts`, GDD §2.7 — plan Question 1 answer (a)), so that slot is
 *     not in the match to send.
 *  3. **A slot whose own home is itself under attack.** Public, through the same
 *     klaxon, and it mirrors the selfish-first ladder: `ownHomeThreatened`
 *     (`./behaviors`) would block that bot anyway, so designating it would mean
 *     the role is held by someone who structurally cannot go and the alarm goes
 *     unanswered. Only the klaxon half of that gate is public — `homeIntruder` is
 *     a sighting — so this is a proxy for it, not a copy of it.
 *
 * ## Two things this deliberately does NOT do
 *
 * **There is no quiet-time defender.** The plan's alternative clause — *"or the
 * highest `homebody` if none is threatened"* — is not buildable honestly:
 * `homebody` is a private character weight (`./personalities`) that no teammate
 * can read, so assigning on it needs either a view addition exposing ally
 * personalities or a radio negotiation, and the second is Trap 11. Its companion
 * clause, *"raises its own defend weights and lowers its attack floor's
 * appetite"*, is then a clause with no subject — and the appetite half is already
 * structural, because `defend-ally` sits above `join-assault` in all three trees.
 *
 * **The role is not latched here.** The plan asks for a role that is
 * *"re-derived each decision but latched so it cannot flap"*, and the latch it
 * needs already exists: this gates the *candidate* a response starts on, and
 * `./ally`'s `AllyResponse` then holds that response across the klaxon's
 * two-second flicker exactly as it always has. A second latch over the top would
 * be a second memory of the same decision, which is how two answers to one
 * question start to drift (Trap 9's lesson, one layer up).
 */

import type { PlayerId, Vec2 } from '@shared/types';
import type { BotView } from './perception';
import { dist } from './steering';
import { breaksTie } from './targeting';

/** No slot holds the role — nobody is designated, so nobody breaks off. */
export const NO_DEFENDER: PlayerId = -1;

/**
 * The home of slot `id`, if that slot is on this bot's side and still holds one.
 * `null` for a stranger, for a slot with no station, and for a dead core.
 *
 * Reads the bot's *own* station through `self` and everyone else's through the
 * roster, and the two agree because they are the same three fields off the same
 * station (`./perception` — `ownStationView` and `allyRoster` compute
 * `underAttack` from one expression on purpose).
 */
function homeOf(view: BotView, id: PlayerId): Vec2 | null {
  if (id === view.self.id) {
    const own = view.self.station;
    return own && own.alive ? own.pos : null;
  }
  for (const ally of view.allies) {
    if (ally.id !== id) continue;
    return ally.stationAlive ? ally.stationPos : null;
  }
  return null;
}

/**
 * **The slot designated to answer an alarm on `owner`'s home**, or
 * {@link NO_DEFENDER} when the side has nobody free to send.
 *
 * Deterministic and negotiation-free: every member of `owner`'s side computes
 * this from its own view and gets the same answer, because every input is public
 * at any range and every ordering is total. Nothing here draws a random number,
 * reads a clock other than the view's, or depends on the order `view.allies`
 * happens to be in beyond the ascending order `./perception` guarantees.
 *
 * **Per alarm, not per side — and that is a deliberate departure from a single
 * side-wide role holder.** A side-wide role has to first choose *the*
 * most-threatened home out of however many are burning, which makes the answer a
 * function of the **set** of live alarms. Bots decide on their own cadence
 * (`./harness` `thinkOnce`), so two teammates read that set a tick or two apart;
 * when it differs they choose different homes and both commit, latched for up to
 * `ALLY_RESPONSE_MAX` — the two-defender bug, reintroduced by the mechanism meant
 * to remove it. Keyed on a single `owner` there is no such window: two bots that
 * both see this home burning agree about it whatever else is on fire. The
 * invariant is therefore *at most one ally answers **any given alarm***, which is
 * the plan's risk stated verbatim, and with two homes alight it sends one
 * defender to each rather than leaving one home unanswered.
 *
 * Allocation-free: one pass, no closure, no temporary record (GDD §4.3). The
 * `-1` index is this bot itself, which is on the roster for this question even
 * though `view.allies` excludes it — the assignment is over the whole **side**,
 * and a function that left out the observer would give a different answer to
 * every observer.
 */
export function defenderFor(view: BotView, owner: PlayerId): PlayerId {
  const allies = view.allies;
  // FFA is teams-of-one: no roster, no role, and nothing that reads this can
  // fire anyway (plan §2.5 — structural degradation, not a mode flag).
  if (allies.length === 0) return NO_DEFENDER;
  const post = homeOf(view, owner);
  if (post === null) return NO_DEFENDER;

  let best: PlayerId = NO_DEFENDER;
  let bestDistance = Infinity;

  for (let i = -1; i < allies.length; i++) {
    const isSelf = i < 0;
    const ally = isSelf ? null : allies[i]!;
    const id = isSelf ? view.self.id : ally!.id;
    if (id === owner) continue;

    // Public fact 1: does this slot still hold a core? A dead one is an
    // eliminated player, not a candidate.
    const own = isSelf ? view.self.station : null;
    const homeAlive = isSelf ? own !== null && own.alive : ally!.stationAlive;
    if (!homeAlive) continue;

    // Public fact 2: is its own door the one burning? Then it is not going
    // anywhere, and designating it would silence the alarm it cannot answer.
    if (isSelf ? own!.underAttack : ally!.underAttack) continue;

    // Public fact 3: where it lives.
    const home = isSelf ? own!.pos : ally!.stationPos;
    if (home === null) continue;

    const d = dist(home, post);
    if (d < bestDistance || (d === bestDistance && breaksTie(owner, id, best))) {
      best = id;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * **Is answering this alarm my job?** The one question the tree asks.
 *
 * `breaksTie` is fed `owner` as its observer rather than `view.self.id`, and that
 * substitution is the load-bearing line of this file. `tiebreakKey` is
 * observer-keyed *on purpose* — p8's fix for the aggression bias that sent seven
 * of eight bots at slot 0 — so two teammates each passing their own id would
 * break the same dead heat toward **different** slots, which is the disagreement
 * this whole mechanism forbids. The alarm's owner is one number that every member
 * of the side reads identically, so keying on it keeps the tie index-blind (no
 * slot is privileged, and the preferred neighbour differs from alarm to alarm)
 * while making it *agreed*. Trap 11 says to use `tiebreakKey` for the ties; it
 * does not say to hand it `self`, and handing it `self` here would be a
 * determinism bug wearing a ratified helper's clothes.
 */
export function holdsDefenderRole(view: BotView, owner: PlayerId): boolean {
  return defenderFor(view, owner) === view.self.id;
}
