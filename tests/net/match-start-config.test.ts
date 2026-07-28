/**
 * tests/net/match-start-config.test.ts — the client rebuilds the server's world
 * from `matchStart`, at the variable match size and with the team layout the
 * server seated (variable-slots Task C4). OWNER: Netcode Engineer (GDD §4.2).
 *
 * `matchStart` is the client's world-constructor call: the size rides implicitly
 * in the roster length, and each seat's `team` rides explicitly so a predicted
 * world groups allies exactly as the authority does. This exercises that at the
 * `TransportSession` seam with a fake transport — no socket, no server — so the
 * one thing under test is that the roster on the wire becomes the world on screen.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { TransportSession } from '../../src/net/session';
import type {
  ClientMessage,
  ConnectionState,
  MatchStartSlot,
  ServerMessage,
  Transport,
} from '../../src/net/transport';

/** A `Transport` a test drives by hand: it records what the session sends and
 *  lets the test deliver server messages. It is NOT a local authority (no
 *  `world`), so the session predicts — building its own world from `matchStart`. */
class FakeTransport implements Transport {
  state: ConnectionState = 'open';
  readonly sent: ClientMessage[] = [];
  private handler: ((message: ServerMessage) => void) | null = null;

  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  onMessage(handler: (message: ServerMessage) => void): void {
    this.handler = handler;
  }
  onStateChange(): void {
    /* no state changes in this test */
  }
  close(): void {
    this.state = 'closed';
  }

  /** Push one server message into the session, as a socket would. */
  deliver(message: ServerMessage): void {
    this.handler?.(message);
  }
}

/** Start a predicting session that has been welcomed into slot 0. */
function seatedSession(): { session: TransportSession; transport: FakeTransport } {
  const transport = new FakeTransport();
  const session = new TransportSession(transport);
  transport.deliver({ type: 'welcome', you: 0, room: 'RUSH', tick: 0 });
  return { session, transport };
}

/** A roster of `slots` seats, each its own FFA team (teams-of-one). */
function ffaSlots(size: number): MatchStartSlot[] {
  return Array.from({ length: size }, (_, player) => ({
    player,
    shipClass: ShipClass.Vanguard,
    team: player,
  }));
}

describe('the client builds the match from matchStart (Task C4)', () => {
  it('rebuilds a 4-station world for a 4-player match', () => {
    const { session, transport } = seatedSession();
    transport.deliver({ type: 'matchStart', tick: 0, seed: 1, slots: ffaSlots(4) });

    // Size rode in the roster length: four seats → four stations, four ships.
    expect(session.world?.stations).toHaveLength(4);
    expect(session.world?.ships).toHaveLength(4);
    // A dense FFA roster, each its own team — byte-identical to the server's.
    expect(session.world?.ships.map((s) => s.id)).toEqual([0, 1, 2, 3]);
    expect(session.world?.ships.map((s) => s.team)).toEqual([0, 1, 2, 3]);
  });

  it('honours a TEAMS layout: allies share a team in the predicted world', () => {
    const { session, transport } = seatedSession();
    // A 2v2: slots 0&1 on team 0, slots 2&3 on team 1.
    const slots: MatchStartSlot[] = [
      { player: 0, shipClass: ShipClass.Vanguard, team: 0 },
      { player: 1, shipClass: ShipClass.Vanguard, team: 0 },
      { player: 2, shipClass: ShipClass.Vanguard, team: 1 },
      { player: 3, shipClass: ShipClass.Vanguard, team: 1 },
    ];
    transport.deliver({ type: 'matchStart', tick: 0, seed: 1, slots });

    expect(session.world?.ships.map((s) => s.team)).toEqual([0, 0, 1, 1]);
    // Stations carry the same allegiance as their owner's ship.
    expect(session.world?.stations.map((p) => p.team)).toEqual([0, 0, 1, 1]);
  });

  it('defaults an absent team to the seat\'s own id — a pre-teams roster is unchanged', () => {
    const { session, transport } = seatedSession();
    // Slots without a `team` field, as an older server would send.
    const slots = [
      { player: 0, shipClass: ShipClass.Vanguard },
      { player: 1, shipClass: ShipClass.Vanguard },
    ];
    transport.deliver({ type: 'matchStart', tick: 0, seed: 1, slots });

    expect(session.world?.ships.map((s) => s.team)).toEqual([0, 1]);
  });
});
