/**
 * src/sim/ore-journal.ts — every ore movement, in words, for the log the
 * developer hands back. OWNER: Gameplay Engineer.
 *
 * `./ore-ledger` proves the economy CONSERVES — it is nine running totals, and it
 * has settled two "my ore vanished" reports on its own (a0-08). What it cannot do
 * is answer *"i had 2 ore and was able to build a turret"* (a0-52), because a
 * report of that shape is not about a total, it is about **one purchase**: which
 * item, at what price, against what balance, at which tick. The ledger says 47 ore
 * was spent this match; it cannot say the turret at 03:12 was bought with 2.
 *
 * The developer sent a playtest log for a0-52 and it contained no economy events
 * at all — a session start, a webgl note, two connect lines, eight seconds — so
 * the report had to be answered from screenshots and inference, which is how a
 * legibility bug and an economy exploit end up looking identical for two days.
 * This module is the missing line: **a bounded, write-only journal of every event
 * that moves a player's ore, each carrying the balance BEFORE and the balance
 * AFTER and the item bought.** The netcode copies it into the playtest log
 * (`src/net/playtest-log-attach`), so the next report of this shape is decided in
 * one read rather than a day of reasoning.
 *
 * It also carries the one line nobody ever wants to see. {@link spendOre}'s guard
 * is the only thing between a purchase and an overdraft, and the clamp two lines
 * under it (`if (ship.cargo < 1e-9) ship.cargo = 0`) would erase the evidence in
 * the same function — a player who underpaid would land on exactly `0`, which is
 * what a0-52's screenshot shows. So the balance is checked BEFORE that clamp and
 * an `overdraft` event is written with the raw negative number in it
 * ({@link oreOverdrafts}). If the report is ever real, the log now says so in one
 * line instead of looking like a clean zero.
 *
 * **Bounded, like the log it feeds.** A journal that grows all match is a leak;
 * this one is a ring of {@link ORE_JOURNAL_CAPACITY} events that counts what it
 * evicted ({@link OreJournal.dropped}) — the same discipline `src/net/playtest-log`
 * uses, for the same reason. The two high-frequency flows are coalesced at the
 * source rather than trimmed here: the atmosphere drain journals one line per
 * WHOLE ore banked (the courier rule, `./step`), not one per 60 Hz tick.
 *
 * **Determinism (GDD §4.8).** Write-only accounting, exactly like `./ore-ledger`:
 * the sim never reads it to make a decision, so a world with a journal and a world
 * without one step identically, and `hashState` (harness) does not fingerprint it.
 * The field is OPTIONAL on `World` — `createWorld` attaches one, the hand-built
 * worlds other lanes construct omit it, and {@link journalOre} no-ops when it is
 * absent — so the accounting can never break a foreign world nor a test literal.
 */

import type { PlayerId } from '@shared/types';
import type { World } from './state';

/**
 * Events retained. A busy minute of play is a few dozen lines — a purchase, a
 * chunk, one bank line per whole ore drained — so 240 covers several minutes of
 * the economy and costs a few KB of the log's paste budget.
 */
export const ORE_JOURNAL_CAPACITY = 240;

/**
 * What moved the ore. Deliberately the player's vocabulary rather than the
 * ledger's bucket names: these are the four things that happen to a wallet, plus
 * the two that should not.
 *
 *  - `mined` — ore arriving in the hold, whatever chipped it loose (mined rock, a
 *    death drop, wreck debris — one pool, GDD §2.7).
 *  - `banked` — hold → bank, by the atmosphere drain or the wheel's BANK wedge.
 *  - `spent` — ore leaving the economy for good: a building, a repair, a turret
 *    mark, a ship upgrade. `item` names which.
 *  - `refused` — a purchase the sim declined for want of ore. The line that turns
 *    *"the button did nothing"* into a fact, and the counterpart every `spent`
 *    line needs to be read against.
 *  - `overdraft` — a spend that left a balance below zero *before* the clamp.
 *    This must never appear. If it does, it is a0-52 for real and this line is
 *    the evidence the clamp would otherwise have erased.
 */
export type OreFlow = 'mined' | 'banked' | 'spent' | 'refused' | 'overdraft';

/**
 * One ore movement, flat and scalar so the playtest log can carry it without a
 * schema negotiation (`src/net/playtest-log` property 2).
 *
 * The balances are the whole point: `hold`/`bank` are the wallet BEFORE the
 * movement and `holdAfter`/`bankAfter` the wallet after it, so a reader can check
 * the arithmetic of any single line without replaying the match. For a `refused`
 * event the two pairs are equal — that IS the assertion (a refusal charges
 * nothing), written down.
 */
export interface OreEvent {
  /** The tick it happened on. */
  readonly tick: number;
  /** Whose wallet moved. */
  readonly player: PlayerId;
  readonly flow: OreFlow;
  /**
   * What was bought, or where the ore came from — `'turret'`, `'shield'`,
   * `'satellite'`, `'repair'`, `'turret-mk'` (a mark on the ladder),
   * `'upgrade:cargo'` …, `'drain'` (the atmosphere), `'bank-order'` (the wedge),
   * `'chunk'` (anything tractored in).
   */
  readonly item: string;
  /**
   * Ore moved, always positive — `flow` says which way.
   *
   * Exact for every flow but one. The atmosphere drain moves a sliver per 60 Hz
   * tick and is journalled on the WHOLE-ore boundary instead (the courier rule,
   * `./step`), so a `banked`/`drain` line's `amount` is the whole ore that
   * crossed since the last line rather than that one tick's sliver. The four
   * balances below stay exact live readings on every line, which is what a
   * reader checks; only this number is coalesced, and only for that flow.
   */
  readonly amount: number;
  /** Hold and bank as this event found them. */
  readonly hold: number;
  readonly bank: number;
  /** Hold and bank as it left them. */
  readonly holdAfter: number;
  readonly bankAfter: number;
}

/** The per-match ring. Bounded, and honest about what it dropped. */
export interface OreJournal {
  readonly events: OreEvent[];
  /** Events evicted by the ring, so a truncated log says so rather than lying by
   *  omission. */
  dropped: number;
}

/** A fresh, empty journal. */
export function makeOreJournal(): OreJournal {
  return { events: [], dropped: 0 };
}

/**
 * Write one movement, if this world keeps a journal. Silently does nothing when
 * it does not (foreign worlds, test literals) — the same discipline `ledgerAdd`
 * uses, and the reason no caller has to check.
 *
 * The event is recorded whatever its size: a 0.03-ore mining chip is a real
 * movement and the reader can filter. What is NOT recorded here is a movement the
 * caller chose not to send — see the drain's whole-ore coalescing in `./step`.
 */
export function journalOre(world: World, event: OreEvent): void {
  const journal = world.oreJournal;
  if (!journal) return;
  journal.events.push(event);
  while (journal.events.length > ORE_JOURNAL_CAPACITY) {
    journal.events.shift();
    journal.dropped++;
  }
}

/**
 * Take everything written since the last drain and leave the ring empty. The
 * playtest log calls this once per frame (`src/net/playtest-log-attach`); a match
 * with no reader simply lets the ring roll.
 *
 * Returns a plain array — never the journal's own, which keeps being written to.
 */
export function drainOreJournal(world: World): readonly OreEvent[] {
  const journal = world.oreJournal;
  if (!journal || journal.events.length === 0) return [];
  return journal.events.splice(0, journal.events.length);
}

/**
 * Every overdraft this world has recorded and not yet drained — the a0-52 alarm.
 * Empty is the only correct answer; a test that drives the economy hard asserts
 * exactly that (`./buildings.test.ts` "never leaves a negative balance").
 */
export function oreOverdrafts(world: World): readonly OreEvent[] {
  return (world.oreJournal?.events ?? []).filter((e) => e.flow === 'overdraft');
}

/**
 * One event as a log line: `spent 3 turret · hold 2→0 bank 1→0`.
 *
 * Lives here rather than in the netcode because the vocabulary is this module's:
 * a reader of a pasted log and a reader of this file should be reading the same
 * words. Numbers are trimmed to two decimals — ore is whole on the wheel but
 * mining lands fractional, and eight decimal places of float is noise, not
 * evidence.
 */
export function oreEventLine(event: OreEvent): string {
  const n = (v: number): string => String(Math.round(v * 100) / 100);
  return (
    `${event.flow} ${n(event.amount)} ${event.item} · ` +
    `hold ${n(event.hold)}→${n(event.holdAfter)} bank ${n(event.bank)}→${n(event.bankAfter)}`
  );
}
