/**
 * src/net/session-observe.test.ts — the session hands the protocol on to the
 * screens that watch it. OWNER: Netcode Engineer (GDD §4.6 M4/M7; M10).
 *
 * The game loop's contract is input-in / world-out, but the lobby, the reconnect
 * banner and — the reason this file exists — the ONLINE front door all need to
 * *see* the server's messages through `observe` without owning the transport's one
 * message handler. `main.ts`'s `connectMatch` observes here for exactly two frames:
 * `matchStart` (hand off to the render loop) and `joinError` (the join was refused
 * — surface it and stop, never the eternal "connecting" spinner, M10). If the
 * session ever swallowed one of those, the wiring above it would be dead. This pins
 * that a `joinError` reaches an observer verbatim.
 */

import { describe, expect, it } from 'vitest';
import { TransportSession } from './session';
import type {
  ClientMessage,
  ConnectionState,
  ServerMessage,
  Transport,
} from './transport';

/** A remote-looking transport (no `world`, so the session predicts, not authors) a
 *  test can push server frames into. */
class FakeRemoteTransport implements Transport {
  state: ConnectionState = 'open';
  private messageHandler: ((message: ServerMessage) => void) | null = null;
  readonly sent: ClientMessage[] = [];

  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }
  onStateChange(): void {}
  close(): void {
    this.state = 'closed';
  }

  /** Deliver a server frame as the socket would. */
  deliver(message: ServerMessage): void {
    this.messageHandler?.(message);
  }
}

describe('TransportSession.observe', () => {
  it('forwards a joinError to observers verbatim — the front door reads its reason (M10)', () => {
    const transport = new FakeRemoteTransport();
    const session = new TransportSession(transport);
    const seen: ServerMessage[] = [];
    session.observe((message) => seen.push(message));

    transport.deliver({ type: 'joinError', reason: 'bad-ticket' });

    // The session neither owns nor drops the refusal: it reaches the observer
    // `connectMatch` uses to leave "connecting" for the front door's error state.
    expect(seen).toEqual([{ type: 'joinError', reason: 'bad-ticket' }]);
  });
});
