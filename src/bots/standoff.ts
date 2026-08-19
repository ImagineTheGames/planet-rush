/**
 * src/bots/standoff.ts — the memory that makes a retreat **end**. OWNER: Bot
 * Engineer (GDD §2.3, §2.7, §2.9; developer report a0-105, ratified).
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
 * A retreat is working while the bot is opening ground on the thing it is
 * running from. When it stops opening ground — pinned at its own doorstep, or
 * chased by something exactly as fast — the retreat has failed, and after the
 * character's own patience runs out the bot turns and fights, with its home
 * turrets behind it (GDD §2.6, and the whole reason a bot retreats *into* its
 * defences).
 *
 * The end condition is deliberately one a player can read from outside: **the
 * bot turns when running stops helping**, not when a clock runs out. Back off a
 * little and the gap opens, the meter resets, and the bot keeps running — so a
 * player who is genuinely out-flying a wounded bot never sees it wheel around.
 * A player who parks on it does, every time.
 *
 * Like `./commitment` and `./cornered` this is one small struct and four pure
 * functions, and it carries no domain knowledge on purpose: no hull fractions,
 * no ranges, no personalities. The caller supplies the gap, the margin and the
 * two durations; this file supplies the memory of having stopped getting away.
 * The bits live on the {@link import('./tree').Brain}, beside the sim rather
 * than inside it, so they can never desync a determinism replay (GDD §4.8).
 */

/**
 * A bot's memory of a retreat that is not working: the best it has managed, when
 * it stopped managing better, and how long it has promised to fight instead.
 *
 * Three fields, and each does a different job. {@link gap} is the **progress
 * anchor** — the widest separation this retreat has achieved — and it is what
 * makes "running is working" a measurement rather than an opinion. {@link since}
 * is the **patience clock**, running only while the anchor stands unbeaten.
 * {@link until} is the **commitment clock**: while it is in the future the bot
 * has decided to fight and its fear model gets no vote, exactly as
 * `./cornered`'s does.
 */
export interface StandoffLatch {
  /** Widest gap this retreat has opened on what it is running from, world units.
   *  `-1` when nothing is being measured. */
  gap: number;
  /** Sim time the gap last stopped widening; `-1` while the retreat is working. */
  since: number;
  /** Sim time the turn-and-fight window closes; `-1` when uncommitted. */
  until: number;
}

/** A fresh latch: no ground measured, nothing promised. */
export function newStandoff(): StandoffLatch {
  return { gap: -1, since: -1, until: -1 };
}

/**
 * Forget everything — the retreat ended, the bot died, or a strictly-higher
 * priority took the tick.
 *
 * This clears the *patience* clock as well as the commitment, which is
 * deliberate and is the same argument `resetCornered` makes: a bot whose retreat
 * genuinely succeeded should earn its next turn-and-fight from scratch rather
 * than inherit credit for a standoff that is over.
 */
export function resetStandoff(latch: StandoffLatch): void {
  latch.gap = -1;
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
 * Fold one decision's separation into the latch, and return whether the bot is
 * now committed to turning and fighting.
 *
 * `gap` is the distance to the thing being run from. The three behaviours the
 * caller supplies are:
 *
 *  - `progress` — how much further than its own best a retreat must get before
 *    it counts as *working*. A margin rather than a bare comparison, so the
 *    hand-width of jitter a chase produces every decision never reads as escape;
 *    the same shape as the wedged counter's {@link import('./tree').STUCK_PROGRESS}
 *    anchor, and for the same reason.
 *  - `patienceSeconds` — how long the bot keeps running a retreat that is not
 *    opening any ground before it turns. This is where the personality spread
 *    lives: timid characters take longer to run out of patience, reckless ones
 *    turn almost at once. Nobody gets a *different* rule, and **every** value
 *    ends the retreat, which is the point of the whole file.
 *  - `commitSeconds` — the minimum window the resulting fight holds for, so the
 *    turn is a decision and not another twitch (`./commitment`).
 *
 * A read that beats the anchor re-anchors and stops the patience clock: the bot
 * is getting away, so there is nothing to fix. The clock only counts an
 * *unbroken* run of reads that failed to beat it, so a threat that drops back
 * for a moment genuinely buys the bot's patience back.
 *
 * On commitment the anchor is moved to *here*, which is what stops a bot that
 * turned from chasing a fleeing player across the map: once the fight starts,
 * progress is measured from the range the fight started at, so an opponent who
 * breaks off opens the gap, releases the standoff, and hands the bot back its
 * retreat.
 */
export function standoffFold(
  latch: StandoffLatch,
  now: number,
  gap: number,
  progress: number,
  patienceSeconds: number,
  commitSeconds: number,
): boolean {
  if (standoffCommitted(latch, now)) return true;
  // Getting away: bank the new best and give the patience back.
  if (latch.gap < 0 || gap >= latch.gap + progress) {
    latch.gap = gap;
    latch.since = -1;
    return false;
  }
  if (latch.since < 0) latch.since = now;
  // Still running, still not gaining — but this character has not had enough
  // yet. A visible stretch of continuing to run is what makes the turn read as
  // the bot deciding rather than a timer firing.
  if (now - latch.since < patienceSeconds) return false;
  // Had enough. Turn, and measure any future progress from the range this fight
  // starts at rather than from the best the failed retreat ever managed.
  latch.until = now + commitSeconds;
  latch.gap = gap;
  return true;
}
