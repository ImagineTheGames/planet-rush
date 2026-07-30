/**
 * src/net/latency-transport.test.ts — the artificial-delay `Transport` wrapper
 * (`./latency-transport`, M10 reconcile-feel brief).
 *
 * Two properties carry the wrapper: every message is held for the configured
 * delay in *both* directions, and — the one that is easy to get wrong — jitter
 * never reorders, because the `Transport` contract promises input order. A
 * virtual clock stands in for the wall clock and the timer, so a "150 ms + jitter"
 * scenario is exact and instant.
 */

import { describe, expect, it } from 'vitest';
import { LatencyTransport } from './latency-transport';
import type { TimerHandle } from './websocket-transport';
import type {
  ClientMessage,
  ConnectionState,
  ServerMessage,
  Transport,
} from './transport';

/** A controllable clock + scheduler: nothing fires until {@link advance}. */
class VirtualClock {
  private t = 0;
  private id = 1;
  private tasks: { at: number; id: number; fn: () => void }[] = [];

  now = (): number => this.t;
  schedule = (fn: () => void, ms: number): TimerHandle => {
    const id = this.id++;
    this.tasks.push({ at: this.t + ms, id, fn });
    return id as unknown as TimerHandle;
  };
  cancel = (handle: TimerHandle): void => {
    this.tasks = this.tasks.filter((task) => task.id !== (handle as unknown as number));
  };

  /** Advance wall time by `ms`, firing every task that comes due, in time order. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.tasks.filter((task) => task.at <= target).sort((a, b) => a.at - b.at);
      if (due.length === 0) break;
      const next = due[0]!;
      this.tasks = this.tasks.filter((task) => task.id !== next.id);
      this.t = next.at;
      next.fn();
    }
    this.t = target;
  }
}

/** A do-nothing inner transport that records sends and can push server messages. */
class FakeInner implements Transport {
  state: ConnectionState = 'open';
  readonly sent: ClientMessage[] = [];
  private handler: ((m: ServerMessage) => void) | null = null;
  private onState: ((s: ConnectionState) => void) | null = null;
  closed = false;

  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  onMessage(handler: (m: ServerMessage) => void): void {
    this.handler = handler;
  }
  onStateChange(handler: (s: ConnectionState) => void): void {
    this.onState = handler;
  }
  close(): void {
    this.closed = true;
    this.state = 'closed';
  }

  /** Deliver a server message as if it just arrived from the socket. */
  emit(message: ServerMessage): void {
    this.handler?.(message);
  }
  setState(state: ConnectionState): void {
    this.state = state;
    this.onState?.(state);
  }
}

const START: ClientMessage = { type: 'startMatch' };
const input = (seq: number): ClientMessage => ({ type: 'input', tick: seq, seq, actions: [] });
const welcome = (): ServerMessage => ({ type: 'welcome', you: 0, room: 'R', tick: 0 });

describe('LatencyTransport', () => {
  it('holds an outbound send for the one-way delay', () => {
    const clock = new VirtualClock();
    const inner = new FakeInner();
    const wire = new LatencyTransport(inner, {
      oneWayMs: 75,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    wire.send(START);
    expect(inner.sent).toHaveLength(0);
    clock.advance(74);
    expect(inner.sent).toHaveLength(0);
    clock.advance(1);
    expect(inner.sent).toEqual([START]);
  });

  it('holds an inbound message for the one-way delay', () => {
    const clock = new VirtualClock();
    const inner = new FakeInner();
    const wire = new LatencyTransport(inner, {
      oneWayMs: 75,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    const got: ServerMessage[] = [];
    wire.onMessage((m) => got.push(m));

    inner.emit(welcome());
    expect(got).toHaveLength(0);
    clock.advance(75);
    expect(got).toHaveLength(1);
    expect(got[0]!.type).toBe('welcome');
  });

  it('preserves order under jitter — a later message never overtakes an earlier one', () => {
    const clock = new VirtualClock();
    const inner = new FakeInner();
    // First draw is large jitter, second is zero: without the monotonic clamp the
    // second message would be delivered before the first.
    const draws = [0.9, 0.0];
    let i = 0;
    const wire = new LatencyTransport(inner, {
      oneWayMs: 75,
      jitterMs: 50,
      rng: () => draws[i++] ?? 0,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    wire.send(input(1)); // at = 75 + 0.9*50 = 120
    wire.send(input(2)); // would be 75, clamped up to 120
    clock.advance(200);
    expect(inner.sent.map((m) => (m as { seq: number }).seq)).toEqual([1, 2]);
  });

  it('adds jitter on top of the base delay', () => {
    const clock = new VirtualClock();
    const inner = new FakeInner();
    const wire = new LatencyTransport(inner, {
      oneWayMs: 75,
      jitterMs: 40,
      rng: () => 0.5, // +20 ms
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    wire.send(START);
    clock.advance(94);
    expect(inner.sent).toHaveLength(0); // 75 + 20 = 95 not yet due
    clock.advance(1);
    expect(inner.sent).toHaveLength(1);
  });

  it('passes connection state through immediately, undelayed', () => {
    const clock = new VirtualClock();
    const inner = new FakeInner();
    const wire = new LatencyTransport(inner, {
      oneWayMs: 75,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    const states: ConnectionState[] = [];
    wire.onStateChange((s) => states.push(s));

    inner.setState('reconnecting');
    expect(states).toEqual(['reconnecting']); // the state machine is real-time
    expect(wire.state).toBe('reconnecting');
  });

  it('drops queued messages and closes the inner transport on close', () => {
    const clock = new VirtualClock();
    const inner = new FakeInner();
    const wire = new LatencyTransport(inner, {
      oneWayMs: 75,
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    const got: ServerMessage[] = [];
    wire.onMessage((m) => got.push(m));

    wire.send(START);
    inner.emit(welcome());
    wire.close();
    clock.advance(1000);

    expect(inner.closed).toBe(true);
    expect(inner.sent).toHaveLength(0); // the queued send was dropped
    expect(got).toHaveLength(0); // the queued delivery was dropped
  });
});
