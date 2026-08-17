/**
 * src/net/session-freeze.test.ts — the world stops when the wire does. OWNER:
 * Netcode Engineer (m10 disconnect honesty, brief §1 and §5).
 *
 * The developer's report, as a property: *"bots frozen but I could still move."*
 * That is a predicted world running with no authority behind it — every local tick
 * after the last snapshot is fiction, and the longer it runs the further from the
 * real match it takes the player. So the session freezes: on a detected loss,
 * `sendInput` sends nothing, predicts nothing, and **advances no tick**.
 *
 * Driven through a stub `Transport` (no `world` property, so the session treats it
 * as online and predicts) with an injected clock, so the whole thing — a silence
 * limit, a grace window, a redial — runs in microseconds.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action, PlayerId } from '@shared/types';
import { TransportSession } from './session';
import { SILENCE_FLOOR_MS, linkNotice } from './link-loss';
import { encodeSnapshot } from './snapshot';
import type {
  ClientMessage,
  ConnectionState,
  ServerMessage,
  Transport,
} from './transport';

const LOCAL: PlayerId = 0;
const T0 = 1_700_000_000_000;
const THRUST: readonly Action[] = [{ type: 'thrust', dir: { x: 1, y: 0 } }];

/** A transport that is online (no `world`), whose state and inbox a test drives. */
class StubTransport implements Transport {
  state: ConnectionState = 'open';
  readonly sent: ClientMessage[] = [];
  /** What {@link redial} answers — false is a transport that has nothing left to
   *  dial for (a dead room, a spent window). */
  redialResult = true;
  redials = 0;
  leaves: (string | undefined)[] = [];
  private handler: ((message: ServerMessage) => void) | null = null;

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.handler = handler;
  }

  onStateChange(): void {}

  close(): void {
    this.state = 'closed';
  }

  /** The forced dial `./link-loss` asks for; read structurally by the session. */
  redial(): boolean {
    this.redials++;
    if (this.redialResult) this.state = 'open';
    return this.redialResult;
  }

  /** ABANDON MATCH (`./transport` LeaveMessage). */
  leave(reason?: string): void {
    this.leaves.push(reason);
    this.state = 'closed';
  }

  deliver(message: ServerMessage): void {
    this.handler?.(message);
  }
}

/** A session mid-match: welcomed, RUSH! sent, predicting. */
function running(graceWindowMs = 60_000): {
  transport: StubTransport;
  session: TransportSession;
  now: () => number;
  at: (ms: number) => void;
} {
  const transport = new StubTransport();
  let clock = T0;
  const session = new TransportSession(transport, {
    now: () => clock,
    link: { graceWindowMs },
  });
  transport.deliver({ type: 'welcome', you: LOCAL, room: 'QK7P', tick: 0 });
  transport.deliver({
    type: 'matchStart',
    tick: 0,
    seed: 4242,
    slots: [
      { player: 0, shipClass: ShipClass.Vanguard },
      { player: 1, shipClass: ShipClass.Hauler },
    ],
  });
  return { transport, session, now: () => clock, at: (ms) => (clock = T0 + ms) };
}

/** A snapshot frame, so the session has something to call proof of life. Content
 *  does not matter here: what is under test is the *arrival*. */
function snapshotFrame(tick: number): ServerMessage {
  return { type: 'snapshot', tick, ackSeq: 0, ackTick: 0, payload: encodeSnapshot(tick, [], []) };
}

describe('the freeze (brief §1)', () => {
  it('predicts normally while frames are arriving', () => {
    const { session, at, transport } = running();
    const world = session.world;
    expect(world).not.toBeNull();
    const before = world!.tick;

    for (let i = 1; i <= 5; i++) {
      at(i * 16);
      session.pollLink();
      session.sendInput(THRUST);
    }
    expect(world!.tick).toBe(before + 5);
    expect(transport.sent.filter((m) => m.type === 'input')).toHaveLength(5);
  });

  it('stops the world dead on a detected loss — no tick, no input, no lie', () => {
    const { session, at, transport } = running();
    const world = session.world!;
    at(16);
    session.sendInput(THRUST);
    const frozenAt = world.tick;
    const sentBefore = transport.sent.length;

    // The socket still says `open`; it has simply stopped delivering. The loss is
    // detected and the automatic dial goes out in the same poll — either way the
    // world is not this client's to advance any more.
    at(SILENCE_FLOOR_MS + 16);
    expect(session.pollLink().phase).toBe('redialing');
    expect(session.frozen).toBe(true);

    for (let i = 0; i < 30; i++) session.sendInput(THRUST);
    expect(world.tick).toBe(frozenAt);
    // And nothing went on the wire: a press stamped for a tick nobody will run is
    // not input, it is noise the reconcile would have to pay for later.
    expect(transport.sent).toHaveLength(sentBefore);
  });

  it('thaws in the same frame authority speaks again', () => {
    const { session, at, transport } = running();
    const world = session.world!;
    at(SILENCE_FLOOR_MS + 1);
    session.pollLink();
    expect(session.frozen).toBe(true);
    const frozenAt = world.tick;

    transport.deliver(snapshotFrame(4));
    expect(session.frozen).toBe(false);
    session.sendInput(THRUST);
    expect(world.tick).toBeGreaterThan(frozenAt);
    expect(session.link.phase).toBe('live');
  });

  it('never freezes offline — a LocalLoopback cannot drop', async () => {
    const { createLocalSession } = await import('./session');
    const session = createLocalSession({
      match: {
        seed: 7,
        players: [
          { id: 0, shipClass: ShipClass.Vanguard },
          { id: 1, shipClass: ShipClass.Hauler },
        ],
      },
    });
    const before = session.world.tick;
    session.sendInput(THRUST);
    expect(session.frozen).toBe(false);
    expect(session.link.phase).toBe('live');
    expect(session.world.tick).toBeGreaterThan(before);
  });
});

describe('the backgrounded tab, end to end (brief §1, §2)', () => {
  it('auto-attempts one reconnect on return, before asking anything', () => {
    const { session, transport, at } = running();
    session.linkHidden();
    at(8_000); // eight seconds away, well inside the window
    const status = session.linkShown();

    // One dial, unasked. The overlay is up while it runs, and it says why.
    expect(transport.redials).toBe(1);
    expect(status.phase).toBe('redialing');
    const notice = linkNotice(session.link);
    expect(notice.visible).toBe(true);
    expect(notice.busy).toBe(true);
    expect(notice.detail).toContain('tab was backgrounded');
    // …and only one. A client that redialled every poll would be a retry storm.
    session.pollLink();
    session.pollLink();
    expect(transport.redials).toBe(1);
  });

  it('asks — RECONNECT / ABANDON — once the automatic attempt has failed', () => {
    const { session, transport, at } = running();
    // The dial cannot even start (the transport is out of window / the room is
    // gone as far as it knows), so the automatic attempt buys nothing and the
    // overlay asks, with both doors and the seconds on the first one.
    transport.redialResult = false;
    at(SILENCE_FLOOR_MS);
    const status = session.pollLink();
    expect(transport.redials).toBe(1);
    expect(status.phase).toBe('lost');

    const notice = linkNotice(session.link);
    expect(notice.actions.map((a) => a.kind)).toEqual(['reconnect', 'abandon']);
    expect(notice.title).toContain('CONNECTION LOST — no server data for');
  });

  it('offers no countdown inside a live match, and never ends one on its own (a0-72)', () => {
    // **This test used to be the bug.** It asserted `8s` on the card and then
    // `expired`/`grace-elapsed` two seconds past a ten-second window — a client
    // deciding, from arithmetic it admits is an estimate, that a match it can no
    // longer see is over for it. The developer overruled exactly that:
    //
    //   *"i should be able to join back if the match is still on-going no matter
    //   what"*
    //
    // `matchStart` has arrived here (see `running`), so the seat is held for the
    // life of the match (`./link-loss` `holdForMatch`, `server/room.ts`
    // `HELD_FOR_MATCH`). There is no countdown to print, and no number of seconds
    // that ends anything.
    const { session, at } = running(10_000);
    at(SILENCE_FLOOR_MS);
    session.pollLink();
    const lost = linkNotice(session.link);
    expect(session.link.heldForMatch).toBe(true);
    expect(lost.grace).toBe('');
    // The button says the verb and no deadline — `RECONNECT · 0s` would be a
    // deadline invented by punctuation.
    expect(lost.actions[0]?.label).toMatch(/^RECONNECT( NOW)?$/);
    expect(lost.detail).toContain('for as long as the match runs');

    // A window's worth of time passes, and then five more of them. Still holding.
    at(11_000);
    expect(session.pollLink().phase).not.toBe('expired');
    at(60 * 1_000);
    const late = session.pollLink();
    expect(late.phase).not.toBe('expired');
    expect(linkNotice(late).actions.map((a) => a.kind)).toEqual(['reconnect', 'abandon']);
    // Frozen throughout — no authority means no world to advance, which is a
    // separate promise and is unchanged (brief §1).
    expect(session.frozen).toBe(true);
  });

  it('still counts a window down before the match starts', () => {
    // The hold is a property of a *running match*. In the lobby there is no ship,
    // no wallet and nothing being held for anybody, so the old rule stands: the
    // window is real, it is shown, and it ends the attempt when it runs out.
    const transport = new StubTransport();
    let clock = T0;
    const session = new TransportSession(transport, { now: () => clock, link: { graceWindowMs: 10_000 } });
    transport.deliver({ type: 'welcome', you: LOCAL, room: 'QK7P', tick: 0 });

    clock = T0 + SILENCE_FLOOR_MS;
    session.pollLink();
    expect(session.link.heldForMatch).toBe(false);
    expect(linkNotice(session.link).grace).toBe('8s');

    clock = T0 + 11_000;
    const gone = session.pollLink();
    expect(gone.phase).toBe('expired');
    expect(gone.ending).toBe('grace-elapsed');
    expect(linkNotice(gone).actions.map((a) => a.kind)).toEqual(['menu']);
  });
});

describe('the two buttons', () => {
  it('RECONNECT dials and says it is dialling', () => {
    const { session, transport, at } = running();
    at(SILENCE_FLOOR_MS);
    session.pollLink();
    const before = transport.redials;

    expect(session.reconnect()).toBe(true);
    expect(transport.redials).toBe(before + 1);
    expect(session.link.phase).toBe('redialing');
  });

  it('ABANDON MATCH states the leave rather than just hanging up', () => {
    const { session, transport, at } = running();
    at(SILENCE_FLOOR_MS);
    session.pollLink();

    session.leave();
    // The seat is freed on the server because the client said so, not because a
    // socket died and a bot inherited it for sixty seconds (`server/room.ts`).
    expect(transport.leaves).toEqual(['abandoned']);
    expect(session.link.ending).toBe('left');
    expect(linkNotice(session.link).actions.map((a) => a.kind)).toEqual(['menu']);
  });

  it('a straggling frame does not un-abandon a player who chose to leave', () => {
    const { session, transport, at } = running();
    at(SILENCE_FLOOR_MS);
    session.pollLink();
    session.leave();

    transport.deliver(snapshotFrame(9));
    expect(session.link.phase).toBe('expired');
    expect(session.frozen).toBe(true);
  });
});
