/**
 * tests/adversarial/latches.ts — **every latch the trees have, enumerated from
 * the source.** OWNER: QA Agent (a0-106).
 *
 * a0-105's ruling is a property, not a bug report:
 *
 * > **Any latch whose release depends only on conditions an opponent controls
 * > can be held open by that opponent.**
 *
 * A property you can test for needs a list of things to test it on, and the list
 * has to come from `src/bots/` rather than from a brief — the whole point is to
 * catch the latch nobody thought to name. So this file is the census, taken by
 * reading the source, and it is deliberately wider than "things called Latch":
 *
 *  - the four **memory latches** on the `Brain` that gate a branch
 *    (`fleeing`, `cornered`, `standoff`, and the two `AllyResponse`s);
 *  - the two **commitments in `./behaviors`** that are latches in everything but
 *    name (the wedged escape run, and the contested-site tabu);
 *  - the **priority-leaf holds** — `last-stand`, `defend`, `haul`, `mine`,
 *    `dead` — which carry no memory at all but can still monopolise a tree for
 *    as long as an opponent holds their condition true. The brief names
 *    `last-stand`, `defend` and `haulHome` explicitly, and it is right to: a
 *    branch that always wins the selector is functionally latched whether or not
 *    a boolean is stored anywhere.
 *
 * **How each one is read.** Where the state exists as a bit on the `Brain`, that
 * bit is what is watched — the bot's own account of its commitment, taken
 * through the module's own public reader (`committed`, `corneredCommitted`,
 * `standoffCommitted`, `allyResponseTarget`) so a change to how a latch stores
 * itself cannot quietly change what this measures. Where a "latch" is really a
 * branch that keeps winning, the winning leaf's own name is what is watched
 * (`Brain.lastBehavior`, which the tree kernel writes and nothing reads back
 * into a decision).
 *
 * **The bound.** Each entry carries a generous ceiling in seconds, or `null` for
 * the latches that are *correctly* unbounded because the situation genuinely
 * does not end. The assertion next door is that a bound EXISTS, not that it is
 * tight, so every number here is set well clear of the measured hold and is
 * meant to catch a latch that runs forever — not one that runs a second longer
 * than it used to. Where a bound is `null`, the `why` field carries the argument
 * for it, and the report reprints that argument beside the measured number so a
 * reader can disagree with it.
 */

import { ALLY_RESPONSE_MAX, ASSAULT_JOIN_MAX, allyResponseTarget } from '../../src/bots';
import { ESCAPE_SECONDS, STANDOFF_COMMIT_SECONDS, TABU_SECONDS } from '../../src/bots';
// The three flee/fight primitives are not re-exported through `src/bots/index.ts`
// (they are the tree's private memory, and the module surface says so), so they
// are imported from their own files — the same way `src/bots/tree.ts` does it.
import { committed } from '../../src/bots/commitment';
import { corneredCommitted } from '../../src/bots/cornered';
import { standoffCommitted } from '../../src/bots/standoff';
import type { Stage, Watch } from './antagonist';

/** One row of the census. */
export interface LatchSpec extends Watch {
  /** Where it lives, for the report. */
  readonly where: string;
  /** What holds it on, in one line. */
  readonly what: string;
  /**
   * Generous ceiling on one unbroken hold, in **seconds of sim**, or `null` when
   * the latch is correctly unbounded. See the file header: a bound that exists
   * is the claim; a tight one is not.
   */
  readonly boundS: number | null;
  /** Why the bound is what it is — or, for `null`, why there should not be one. */
  readonly why: string;
}

/** The one latch reader that needs the sim clock as well as the bit. */
const now = (s: Stage): number => s.world.time;

/**
 * The census. Order is the order of the priority ladder in
 * `src/bots/{easy,medium,hard}.ts`, top first, with the commitments that are not
 * leaves appended — so the report reads down a tree the same way the tree does.
 */
export const LATCHES: readonly LatchSpec[] = [
  // -------------------------------------------------------------------------
  // Priority-leaf holds: no stored bit, but a branch that keeps winning
  // -------------------------------------------------------------------------
  {
    id: 'dead',
    where: 'easy.ts/medium.ts/hard.ts — `when(\'dead\', …)`',
    what: 'the respawn clock: hands still while the sim counts it down',
    // The sim's own respawn interval with room to spare. It is a latch in the
    // relevant sense (a branch that wins every tick regardless of what the tree
    // below it wants) and it is bounded by a clock nobody but the sim owns —
    // which is exactly the shape every other latch here should have and mostly
    // does not.
    boundS: 20,
    why: 'the sim owns the clock; no opponent input reaches it (GDD §2.7)',
    engaged: (s) => !s.me.alive,
  },
  {
    id: 'last-stand',
    where: 'behaviors.ts `coreUnderFinalAssault` → `lastStandDefend`',
    what: 'this bot\'s own core under attack and below CORE_FINAL_ASSAULT (0.3)',
    // Correctly unbounded, and the argument is in the report. Kept in the census
    // because "we looked and decided" is a finding; leaving it out would read as
    // "we never looked".
    boundS: null,
    why:
      'a core genuinely under final assault is a situation that does not end while it is true; ' +
      'the bot is fighting at its own turrets, not switched off, and the branch releases the ' +
      'flee/standoff/cornered latches rather than holding them',
    engaged: (s) => s.bot.brain.lastBehavior === 'last-stand',
  },
  {
    id: 'cornered',
    where: 'cornered.ts `CorneredLatch` (read via `corneredCommitted`)',
    what: 'the road home reads shut for the tier\'s detect lag; commits for a window',
    // `corneredCommit` re-promises `now + commitSeconds` on every shut read, so
    // the *committed* bit renews as long as the geometry holds. The bound is on
    // the hold, not on the window: a blockade an opponent maintains keeps the
    // bot FIGHTING, which is the ratified behaviour ("a blockaded bot FIGHTS —
    // no dithering"), so this ceiling exists to catch a hold that outlives the
    // blockade, not the blockade itself.
    boundS: null,
    why:
      'the commitment renews while the blockade stands, by design (p15 ratified) — but the bot ' +
      'is attacking the blockader the whole time, so the hold is a fight rather than a freeze; ' +
      'the assertion that matters is the ACTIVITY one, below',
    engaged: (s) => corneredCommitted(s.bot.brain.cornered, now(s)),
  },
  {
    id: 'fleeing',
    where: 'commitment.ts `Latch` on `Brain.fleeing` (read via `committed`)',
    what: 'wounded with a threat in range; exits on escaped OR recovered OR the standoff',
    // THE a0-105 latch. Both of its own exits are opponent-controlled; the third
    // — `./standoff` — is the one the bot owns, and this is the number that
    // proves it fires. Generous: the loosest `standoffPatience` is 5 s and the
    // commit window is 4 s, so a correct hold is single-digit seconds and this
    // is an order of magnitude above it.
    boundS: 30,
    why:
      'escaped and recovered are both the opponent\'s to withhold; `standoffFold` is the exit ' +
      'the bot owns, and it fires at every patience the cast can produce (a0-105)',
    engaged: (s) => committed(s.bot.brain.fleeing),
  },
  {
    id: 'standoff',
    where: 'standoff.ts `StandoffLatch` (read via `standoffCommitted`)',
    what: 'the turn-and-fight window a failed retreat commits to',
    // A fixed window that re-arms only after a fresh failed retreat, so a hold
    // longer than a few windows back to back would mean the fight never resolves.
    boundS: STANDOFF_COMMIT_SECONDS * 4,
    why: 'a fixed window (STANDOFF_COMMIT_SECONDS) measured from the turn; nothing renews it mid-window',
    engaged: (s) => standoffCommitted(s.bot.brain.standoff, now(s)),
  },
  {
    id: 'defend',
    where: 'easy.ts/medium.ts/hard.ts — `when(\'defend\', …)` → `defendHome`',
    what: 'own station under attack OR any hostile inside the alarm ring',
    // `homeIntruder` is a pure proximity read with no memory and no timer, so a
    // hostile that parks inside the ring holds this branch for as long as it
    // cares to. Whether that is a defect is the argument in the report; the
    // activity assertion is what decides it.
    boundS: null,
    why:
      'a hostile inside your own alarm ring is a situation that does not end while it is true, ' +
      'and the answer to it — meet them in front of your turrets — is the right one (GDD §2.6). ' +
      'The bound that matters here is the activity one: the defender must be shooting, not orbiting',
    engaged: (s) => s.bot.brain.lastBehavior === 'defend',
  },
  {
    id: 'ally-response',
    where: 'ally.ts `AllyResponse` on `Brain.allyResponse` (read via `allyResponseTarget`)',
    what: 'a teammate\'s klaxon answered; holds across the alarm\'s 2 s flicker',
    // The one latch in the census that ships its own explicit ceiling
    // (`ALLY_RESPONSE_MAX`), because the plan named the failure — "a siege the
    // responder cannot break becomes a permanent posting" — before it happened.
    boundS: ALLY_RESPONSE_MAX + 10,
    why: 'ALLY_RESPONSE_MAX is a hard ceiling in the primitive itself; the cooldown then gates the next one',
    engaged: (s) => allyResponseTarget(s.bot.brain.allyResponse) >= 0,
  },
  {
    id: 'ally-assault',
    where: 'ally.ts `AllyResponse` on `Brain.allyAssault` (read via `allyResponseTarget`)',
    what: 'a teammate\'s raid joined; holds across the callout gaps',
    boundS: ASSAULT_JOIN_MAX + 10,
    why: 'ASSAULT_JOIN_MAX is a hard ceiling in the same primitive',
    engaged: (s) => allyResponseTarget(s.bot.brain.allyAssault) >= 0,
  },
  {
    id: 'haul',
    where: 'easy.ts/medium.ts/hard.ts — `when(\'haul\', …)` → `haulHome`',
    what: 'the hold is full enough to be worth the trip; only docking empties it',
    // `wantsToHaul` is cargo-only and cargo only empties at the station, so an
    // opponent parked on the doorstep holds this branch indefinitely. It is the
    // clearest "opponent-controlled exit" in the census after the a0-105 one,
    // and the reason it is not the same defect is that the bot keeps FLYING at
    // the blockade rather than stopping — again, the activity assertion.
    boundS: null,
    why:
      'a full hold is emptied only by docking or by dying, and both are legitimate ends; the ' +
      'question this instrument answers is whether the bot keeps trying, which the activity ' +
      'assertion measures',
    engaged: (s) => s.bot.brain.lastBehavior === 'haul',
  },
  {
    id: 'mine-site',
    where: 'behaviors.ts `mine` → `Brain.mineSite`',
    what: 'the rock this bot committed to on its last mining decision',
    boundS: null,
    why: 'mining is the day job; a bot working a rock for minutes is the game being played, not a latch stuck on',
    engaged: (s) => s.bot.brain.lastBehavior === 'mine',
  },
  // -------------------------------------------------------------------------
  // Commitments in ./behaviors that are latches in everything but name
  // -------------------------------------------------------------------------
  {
    id: 'escape-run',
    where: 'behaviors.ts `go` → `Brain.escapeUntil` / `escapeDir`',
    what: 'a wedged bot commits to one heading, open-loop, for ESCAPE_SECONDS',
    // Open-loop and fixed-length: it cannot be renewed inside its own window
    // (the `time >= escapeUntil` guard), so the only way to a long hold is
    // back-to-back re-commits, which is a wedge rather than a latch.
    boundS: ESCAPE_SECONDS * 4,
    why: 'a fixed open-loop run; the re-commit guard (`time >= escapeUntil`) makes renewal impossible mid-run',
    engaged: (s) => s.world.time < s.bot.brain.escapeUntil,
  },
  {
    id: 'mine-tabu',
    where: 'behaviors.ts `tabuMineSite` → `Brain.tabu`',
    what: 'a rock whose approach triggered a retreat is cooled down',
    boundS: TABU_SECONDS * 4,
    why: 'entries carry an absolute expiry and are never renewed while held; the map drains on its own clock',
    engaged: (s) => {
      for (const until of s.bot.brain.tabu.values()) if (s.world.time < until) return true;
      return false;
    },
  },
];

/**
 * The leaves that mean the bot stopped running and did something about it —
 * a0-105's own definition, reused so the two reports are comparable.
 */
export const FIGHTING = new Set([
  'turn-and-fight',
  'cornered-fight',
  'defend',
  'defend-ally',
  'last-stand',
  'attack',
  'potshot',
  'hunt',
  'suppress',
  'join-assault',
]);
