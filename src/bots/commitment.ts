/**
 * src/bots/commitment.ts — the anti-flap primitive. OWNER: Bot Engineer
 * (GDD §2.9; v0.2.2 field report — "low-HP bot stuck flapping between attack and
 * flee").
 *
 * A behavior tree re-evaluates from scratch every decision (`./tree`), which is
 * exactly what makes a bot testable — but it is also what lets two
 * mutually-exclusive branches *flap*. FLEE engages at `hp < X`; the next
 * decision the bot has backed off a hair, the condition reads false, ATTACK
 * re-engages, the bot drives back in, `hp < X` again — and the ship twitches in
 * place, "never actually going anywhere" (the field report, verbatim). A single
 * boundary shared by two behaviors has no memory, so it cannot commit to either.
 *
 * The fix is **hysteresis**: give the pair two thresholds instead of one, and a
 * scrap of memory to sit between them. A {@link Latch} enters its committed
 * state on one condition and leaves it only on a *different*, deliberately
 * separated one — so a value hovering on the enter boundary can never toggle the
 * committed state, because leaving needs the far boundary, not the near one.
 *
 * This is one tiny struct and one pure function on purpose. It carries no
 * domain knowledge — no hull fractions, no ranges, no personalities — so the
 * same primitive guards every flap-prone pair the trees have (flee/fight,
 * siege/retreat, and any future chase/mine): the caller supplies the two
 * conditions, this file supplies the memory between them. The committed bit
 * lives on the {@link import('./tree').Brain}, beside the sim rather than inside
 * it, so it can never desync a determinism replay (GDD §4.8).
 */

/**
 * A two-state latch — the memory that turns a single threshold into a band.
 *
 * `on` is the committed state. It is written by {@link commit} alone: true only
 * when the *enter* condition fires from off, false only when the *exit*
 * condition fires from on. Between the two it holds, which is the whole point.
 */
export interface Latch {
  on: boolean;
}

/** A fresh latch, released. */
export function newLatch(): Latch {
  return { on: false };
}

/**
 * Fold this decision's two conditions into the latch and return the committed
 * state. Called once per decision (the tree evaluates a branch's test once), so
 * the latch tracks exactly one enter/exit history and nothing re-reads it into a
 * second update.
 *
 *  - **Off** → flips **on** iff `enter`.
 *  - **On**  → flips **off** iff `exit`.
 *  - Neither condition ⇒ the latch **holds**, which is the hysteresis.
 *
 * `exit` is evaluated against the *on* state and wins a tie: if both `enter` and
 * `exit` read true while committed, the latch releases — safety (arrival, a
 * recovered hull, a higher-priority override) always breaks a commitment rather
 * than renewing it, so a latch can never wedge *on* the way the raw condition
 * wedged the ship.
 */
export function commit(latch: Latch, enter: boolean, exit: boolean): boolean {
  if (latch.on) {
    if (exit) latch.on = false;
  } else if (enter) {
    latch.on = true;
  }
  return latch.on;
}

/**
 * Force a latch off. For the strictly-higher-priority override that pre-empts a
 * commitment (a core under final assault outranking self-preservation): the
 * override takes the tick, and clears the latch so the pre-empted behavior
 * re-decides from scratch once the override lifts rather than silently resuming.
 */
export function release(latch: Latch): void {
  latch.on = false;
}

/** Read the committed state without touching it — for tests and a debug overlay. */
export function committed(latch: Latch): boolean {
  return latch.on;
}
