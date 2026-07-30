/**
 * src/net/order-ledger.test.ts — the three ways a prediction can end.
 * OWNER: Netcode Engineer (M10 action-echo).
 *
 * The ledger is the pure decision under "one entity, never two": given what this
 * client predicted and what authority said, *what should happen to the world?* It
 * touches no world itself, so all three endings — adopted, refused, never answered
 * — are assertable here with no sim, no socket and no clock.
 *
 * The one that matters most is the third. A refusal is a message and messages get
 * tested; **silence** is the case a client can only get wrong quietly, by leaving a
 * half-built turret assembling on screen for the rest of the match because the tap
 * that ordered it never reached the server.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDER_TTL_TICKS,
  MAX_ORDER_TTL_TICKS,
  MIN_ORDER_TTL_TICKS,
  OrderLedger,
} from './order-ledger';

const TICK_MS = (1 / 60) * 1000;

describe('minting order ids', () => {
  it('never repeats an id, and namespaces it by seat', () => {
    const ledger = new OrderLedger();
    const mine = [ledger.mint(3), ledger.mint(3), ledger.mint(3)];
    expect(new Set(mine).size).toBe(3);
    // The seat is in the high bits, so two clients in one room cannot collide even
    // if the server keyed its dedupe table on the id alone.
    const other = new OrderLedger();
    const theirs = [other.mint(5), other.mint(5), other.mint(5)];
    expect(mine.some((id) => theirs.includes(id))).toBe(false);
  });
});

describe('settling a prediction', () => {
  it('adopts an accepted order and hands back authority’s job', () => {
    const ledger = new OrderLedger();
    ledger.record(11, 'buildOrder', 'turret', 100);
    ledger.attachBuild(11, 900); // the local sim's job id

    const outcome = ledger.settle({
      orderId: 11,
      accepted: true,
      tick: 104,
      build: { id: 77, remaining: 9.4, total: 10 },
    });

    expect(outcome?.kind).toBe('adopt');
    expect(outcome?.order.buildId).toBe(900);
    expect(outcome?.kind === 'adopt' && outcome.echo.build?.id).toBe(77);
    // Answered, so it can never be swept as unanswered — a rollback after an
    // adoption would take away a turret the player has paid for and owns.
    expect(ledger.pending.length).toBe(0);
    expect(ledger.sweep(100_000)).toEqual([]);
  });

  it('rolls a refused order back at once, naming the refusal', () => {
    const ledger = new OrderLedger();
    ledger.record(12, 'buildOrder', 'shield', 50);
    ledger.attachBuild(12, 901);

    const outcome = ledger.settle({ orderId: 12, accepted: false, tick: 52 });
    expect(outcome?.kind).toBe('rollback');
    expect(outcome?.kind === 'rollback' && outcome.reason).toBe('refused');
    expect(outcome?.order.buildId).toBe(901);
  });

  it('answers nothing for an id it is not waiting on', () => {
    const ledger = new OrderLedger();
    // Never predicted here — a reclaim rebuilt the world, or the frame arrived
    // twice. Acting on it is how a second rollback takes a live turret away.
    expect(ledger.settle({ orderId: 999, accepted: false, tick: 1 })).toBeNull();

    ledger.record(13, 'upgradeOrder', 'power', 10);
    expect(ledger.settle({ orderId: 13, accepted: true, tick: 12 })?.kind).toBe('adopt');
    expect(ledger.settle({ orderId: 13, accepted: true, tick: 12 })).toBeNull();
    expect(ledger.isSettled(13)).toBe(true);
  });
});

describe('the TTL — silence is a refusal', () => {
  it('holds a prediction up to its deadline and rolls it back past it', () => {
    const ledger = new OrderLedger();
    const order = ledger.record(20, 'buildOrder', 'turret', 1000);
    expect(order.deadline).toBe(1000 + DEFAULT_ORDER_TTL_TICKS);

    expect(ledger.sweep(order.deadline)).toEqual([]);
    expect(ledger.pending.length).toBe(1);

    const swept = ledger.sweep(order.deadline + 1);
    expect(swept.length).toBe(1);
    expect(swept[0]!.kind).toBe('rollback');
    expect(swept[0]!.kind === 'rollback' && swept[0]!.reason).toBe('expired');
    // Swept once, and only once: a second sweep must not roll the same ghost back
    // twice, because by then the id may have been re-used by a later match.
    expect(ledger.sweep(order.deadline + 1000)).toEqual([]);
  });

  it('sizes the deadline from the measured wire, within its bounds', () => {
    const ledger = new OrderLedger();
    // A phone at 150 ms with jitter waits longer than a LAN does; both are the
    // same rule, measured rather than assumed (`./prediction` setLeadBudget).
    expect(ledger.setTtlFromRtt(150, 30, TICK_MS)).toBeGreaterThan(MIN_ORDER_TTL_TICKS);
    expect(ledger.setTtlFromRtt(1, 0, TICK_MS)).toBe(MIN_ORDER_TTL_TICKS);
    expect(ledger.setTtlFromRtt(5000, 500, TICK_MS)).toBe(MAX_ORDER_TTL_TICKS);
    // No measurement is not a fast wire — it is a client that does not know yet.
    const fresh = new OrderLedger();
    expect(fresh.setTtlFromRtt(null, null, TICK_MS)).toBe(DEFAULT_ORDER_TTL_TICKS);
  });

  it('a reclaim forgets everything — the old world is gone', () => {
    const ledger = new OrderLedger();
    ledger.record(30, 'buildOrder', 'turret', 5);
    ledger.reset();
    expect(ledger.pending).toEqual([]);
    expect(ledger.sweep(1_000_000)).toEqual([]);
  });
});
