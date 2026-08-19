/**
 * src/bots/standoff.ts — the memory that makes a retreat **end**. OWNER: Bot
 * Engineer (GDD §2.3, §2.7, §2.9; developer reports a0-105 and a0-107, both
 * ratified).
 *
 * The developer, 2026-08-19, with a screenshot of Rusty parked at its own
 * station at 20/70 hull:
 *
 * > *"I was able to make rusty just stay stuck there by putting myself in
 * > between the ore and his base. he just stayed in that same spot scared of me.
 * > ship lives are cheap. enemies should not fear death..."*
 *
 * `./commitment` gave the flee/fight pair *memory*, so a hull fraction hovering
 * on one boundary can no longer toggle the state. `./cornered` gave it a
 * *geometry*, so a bot whose road home is shut fights rather than dithers.
 * Neither of them gave the retreat an **end**, and that is the hole the
 * developer stood in: the flee latch releases on `recovered || escaped`, and
 * both of those are conditions the *opponent* controls. Park inside the clear
 * range and the bot can never read escaped; keep the pressure on a game with no
 * hull repair and it can never read recovered. Nothing else opens the latch, so
 * the retreat runs forever and the player has found a switch that turns an
 * opponent off by standing still. Measured before the fix at 7200 ticks of held
 * `retreat` out of 7200, at every tier (`evidence/a0-105-standoff/`).
 *
 * The ruling is the developer's last sentence, and it is already the design:
 * respawn is free (GDD §2.3, §2.7), so a bot that holds position because it is
 * afraid is trading a free thing for the match's whole tempo. **A retreat is a
 * manoeuvre, not a state of mind. It must terminate.**
 *
 * What terminates it is this file: the memory of *whether running is working*.
 *
 * ── a0-107: what "working" has to mean ─────────────────────────────────────
 *
 * a0-105 measured working as **opening ground on the threat**, and that reading
 * is right as far as it goes. What it could not carry on its own was the case
 * where the bot is not opening ground but is still *going somewhere* — flying
 * home to its turrets, which is what a retreat IS ({@link
 * import('./behaviors').retreat}). So the caller put two positional gates in
 * front of the fold to protect that case, and QA's adversarial sweep (a0-106,
 * defect `a0-106-01`) found what gates cost: both of them were things an
 * **opponent** could hold false, and a read that failed either one *reset the
 * patience clock*. Park in the 260-unit annulus between `THREAT_RANGE` and
 * `RETREAT_CLEAR_RANGE` and the fold was never evaluated at all; stand on the
 * road home and it was evaluated and thrown away every other tick. Either way
 * the clock never reached any character's patience, and the retreat was
 * unbounded again — 17 860 held ticks of 18 000 against a hostile doing nothing.
 *
 * So this file now measures **both** kinds of progress, and the caller has no
 * gates left:
 *
 *  - {@link StandoffLatch.gap} — the widest separation this retreat has opened
 *    on the thing it is running from. *Am I getting away?*
 *  - {@link StandoffLatch.road} — the shortest distance to its refuge this
 *    retreat has achieved. *Am I getting home?*
 *
 * A retreat that improves on **either** anchor is working, and keeps its
 * patience. A retreat that improves on neither is going nowhere, and after the
 * character's own patience the bot turns and fights, with its home turrets
 * behind it (GDD §2.6). Both anchors are things the **bot** does; an opponent
 * can stop the clock only by letting the bot get away or letting it get home,
 * and both of those are the retreat succeeding. That is the a0-107 property, and
 * it is the general lesson the two reports share: *an exit condition an opponent
 * alone can satisfy is not an exit* (`docs/LESSONS.md`).
 *
 * Both anchors are **monotone** — a best is only ever beaten, never given back —
 * so an oscillation cannot buy the bot's patience back a second time, however an
 * opponent jitters. The bound that gives the whole file its point falls straight
 * out of that: there is only so much ground to open and only so much road to
 * close, so there are only finitely many legitimate resets, and every retreat
 * ends.
 *
 * The end condition is still deliberately one a player can read from outside:
 * **the bot turns when running stops helping**, not when a clock runs out. Back
 * off a little and the gap opens, the meter resets, and the bot keeps running —
 * so a player who is genuinely out-flying a wounded bot never sees it wheel
 * around. Get out of its way home and it flies home instead. Park on it, or on
 * its doorstep, and it turns, every time.
 *
 * Like `./commitment` and `./cornered` this is one small struct and four pure
 * functions, and it carries no domain knowledge on purpose: no hull fractions,
 * no ranges, no personalities. The caller supplies the two measurements, the
 * margin and the two durations; this file supplies the memory of having stopped
 * getting anywhere. The bits live on the {@link import('./tree').Brain}, beside
 * the sim rather than inside it, so they can never desync a determinism replay
 * (GDD §4.8).
 */

/**
 * The distance to pass as `road` when this retreat has **no refuge** — its
 * station is gone, or the thing it is running from is sitting on it, so
 * {@link import('./behaviors').retreat} is not travelling anywhere at all and
 * there is no homeward progress to be made or to be credited.
 *
 * A negative sentinel rather than `Infinity` because it must never read as an
 * improvement on anything, including on itself: a bot with nowhere to go is
 * measured on the gap alone.
 */
export const NO_ROAD = -1;

/**
 * A bot's memory of a retreat that is not working: the best it has managed on
 * each axis, when it stopped managing better, and how long it has promised to
 * fight instead.
 *
 * {@link gap} and {@link road} are the two **progress anchors** — the widest
 * separation and the shortest distance home this retreat has achieved — and
 * together they are what makes "running is working" a measurement rather than an
 * opinion. {@link since} is the **patience clock**, running only while *both*
 * anchors stand unbeaten. {@link until} is the **commitment clock**: while it is
 * in the future the bot has decided to fight and its fear model gets no vote,
 * exactly as `./cornered`'s does.
 */
export interface StandoffLatch {
  /** Widest gap this retreat has opened on what it is running from, world units.
   *  `-1` when nothing is being measured. */
  gap: number;
  /** Shortest distance to its refuge this retreat has achieved, world units.
   *  `-1` ({@link NO_ROAD}) when there is no refuge, or nothing measured yet. */
  road: number;
  /** Sim time both anchors last stopped being beaten; `-1` while the retreat is
   *  working on either of them. */
  since: number;
  /** Sim time the turn-and-fight window closes; `-1` when uncommitted. */
  until: number;
}

/** A fresh latch: no ground measured, no road measured, nothing promised. */
export function newStandoff(): StandoffLatch {
  return { gap: -1, road: NO_ROAD, since: -1, until: -1 };
}

/**
 * Forget everything — the retreat ended, the bot died, or a strictly-higher
 * priority took the tick.
 *
 * This clears the *patience* clock and both anchors as well as the commitment,
 * which is deliberate and is the same argument `resetCornered` makes: a bot
 * whose retreat genuinely succeeded should earn its next turn-and-fight from
 * scratch rather than inherit credit for a standoff that is over. It is called
 * only when the retreat itself is over — never as a way of saying "this tick was
 * hard to read", which is precisely the mistake a0-106 caught.
 */
export function resetStandoff(latch: StandoffLatch): void {
  latch.gap = -1;
  latch.road = NO_ROAD;
  latch.since = -1;
  latch.until = -1;
}

/**
 * Has this bot already decided to stop running and fight? Read *before* any
 * fresh measurement: inside the window there is nothing to re-derive, because
 * the answer cannot change — the same "no fear re-evaluation mid-commitment"
 * rule the cornered latch is built on (developer report p15, ratified point 2).
 */
export function standoffCommitted(latch: StandoffLatch, now: number): boolean {
  return latch.until >= 0 && now < latch.until;
}

/**
 * Fold one decision's two measurements into the latch, and return whether the
 * bot is now committed to turning and fighting.
 *
 * `gap` is the distance to the thing being run from. `road` is the distance to
 * the refuge the retreat is flying to, or {@link NO_ROAD} when it has none. The
 * three behaviours the caller supplies are:
 *
 *  - `progress` — how much better than its own best a retreat must get, on
 *    either axis, before it counts as *working*. A margin rather than a bare
 *    comparison, so the hand-width of jitter a chase produces every decision
 *    never reads as escape; the same shape as the wedged counter's
 *    {@link import('./tree').STUCK_PROGRESS} anchor, and for the same reason.
 *  - `patienceSeconds` — how long the bot keeps running a retreat that is
 *    getting nowhere before it turns. This is where the personality spread
 *    lives: timid characters take longer to run out of patience, reckless ones
 *    turn almost at once. Nobody gets a *different* rule, and **every** value
 *    ends the retreat, which is the point of the whole file.
 *  - `commitSeconds` — the minimum window the resulting fight holds for, so the
 *    turn is a decision and not another twitch (`./commitment`).
 *
 * A read that beats **either** anchor re-anchors that axis and stops the
 * patience clock: the bot is getting somewhere, so there is nothing to fix. The
 * clock only counts an *unbroken* run of reads that beat neither, so a threat
 * that drops back for a moment — or a road that opens for a moment — genuinely
 * buys the bot's patience back. Because both anchors only ever move in the
 * improving direction, that credit cannot be handed out twice for the same
 * ground.
 *
 * On commitment both anchors are moved to *here*, which is what stops a bot that
 * turned from chasing a fleeing player across the map: once the fight starts,
 * progress is measured from where the fight started, so an opponent who breaks
 * off opens the gap, releases the standoff, and hands the bot back its retreat.
 */
export function standoffFold(
  latch: StandoffLatch,
  now: number,
  gap: number,
  road: number,
  progress: number,
  patienceSeconds: number,
  commitSeconds: number,
): boolean {
  if (standoffCommitted(latch, now)) return true;
  let working = false;
  // Getting away: bank the new best separation.
  if (latch.gap < 0 || gap >= latch.gap + progress) {
    latch.gap = gap;
    working = true;
  }
  // Getting home: bank the new best distance to the refuge. A retreat with no
  // refuge (`NO_ROAD`) has no second axis and is measured on the gap alone.
  if (road >= 0 && (latch.road < 0 || road <= latch.road - progress)) {
    latch.road = road;
    working = true;
  }
  // Working on at least one axis: give the patience back.
  if (working) {
    latch.since = -1;
    return false;
  }
  if (latch.since < 0) latch.since = now;
  // Still running, still getting nowhere — but this character has not had enough
  // yet. A visible stretch of continuing to run is what makes the turn read as
  // the bot deciding rather than a timer firing.
  if (now - latch.since < patienceSeconds) return false;
  // Had enough. Turn, and measure any future progress from where this fight
  // starts rather than from the best the failed retreat ever managed.
  latch.until = now + commitSeconds;
  latch.gap = gap;
  latch.road = road;
  return true;
}
