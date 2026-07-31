/**
 * tests/net/lobby-ping-model.test.ts — the ping the roster row actually draws.
 * OWNER: Netcode Engineer (ratified developer: "lobby renders it next to each
 * HUMAN player's name, colour-graded; bots show no ping").
 *
 * The wire half is next door (`tests/server/lobby-ping.test.ts`: which seats
 * authority publishes a number for). This is the client half — the path a
 * `lobbyState` broadcast takes from the socket to the pixels:
 *
 *     LobbySlot.rtt  →  applyLobbySlots  →  LobbySeat.rtt  →  lobbyModel  →  LobbySeatView.ping
 *
 * Every step of it can drop the number or keep a stale one, and the two failures
 * worth guarding are asymmetric: a *missing* ping is a cosmetic loss, while a
 * number on the wrong row — a bot's, or one left over from the human who used to
 * sit there — is the roster telling a lie about who is in the room.
 *
 * Lives under `tests/net/` because the seam being defended is the wire's, and the
 * Netcode Engineer does not edit `src/ui/`'s own suite.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { applyLobbySlots, createLobby, lobbyModel } from '../../src/ui/lobby';
import type { LobbyState } from '../../src/ui/lobby';
import type { LobbySlot } from '../../src/net/transport';
import { PING_FAIR_MS, PING_GOOD_MS } from '../../src/net/ping';

/** A four-seat lobby, this client in seat 0 — small enough to read in a failure
 *  message, and the seat count changes nothing about the rules under test. */
function lobby(): LobbyState {
  return createLobby({ room: 'PING', you: 0, host: 0, slots: 4 });
}

/** One wire slot. Humans are `ready` (that is how `applyLobbySlots` reads a seated
 *  human); a bot carries `isBot`, and — per the ratified rule — no `rtt` at all. */
function slot(player: number, over: Partial<LobbySlot> = {}): LobbySlot {
  return {
    player,
    isBot: false,
    shipClass: ShipClass.Vanguard,
    ready: true,
    team: player,
    ...over,
  };
}

/** The drawn row for a seat, straight out of the render model. */
function row(state: LobbyState, player: number) {
  return lobbyModel(state).seats[player]!;
}

describe('the roster row ping — the wire to the model', () => {
  it('carries a measured human seat through to the drawn row', () => {
    const state = applyLobbySlots(lobby(), [slot(0, { rtt: 245 }), slot(1, { rtt: 42 })]);
    expect(row(state, 0).ping).toEqual({ ms: 245, label: '245ms', grade: 'poor' });
    expect(row(state, 1).ping).toEqual({ ms: 42, label: '42ms', grade: 'good' });
  });

  it('grades the three bands the way the ratification wrote them (green <100,\n' +
    '     amber <200, red above)', () => {
    const state = applyLobbySlots(lobby(), [
      slot(0, { rtt: PING_GOOD_MS - 1 }),
      slot(1, { rtt: PING_GOOD_MS }),
      slot(2, { rtt: PING_FAIR_MS - 1 }),
      slot(3, { rtt: PING_FAIR_MS }),
    ]);
    expect(row(state, 0).ping?.grade).toBe('good');
    expect(row(state, 1).ping?.grade).toBe('fair');
    expect(row(state, 2).ping?.grade).toBe('fair');
    expect(row(state, 3).ping?.grade).toBe('poor');
  });

  it('NEVER draws a number on a bot row — not even one the wire mistakenly sent', () => {
    const state = applyLobbySlots(lobby(), [
      slot(0, { rtt: 30 }),
      // A bot seat, with a number on it: the model must refuse it anyway. Two
      // guards agree here (the wire's `isBot`, and the row's own occupancy), which
      // is deliberate — this is the rule the ratification called out by name.
      slot(1, { isBot: true, rtt: 5 }),
    ]);
    expect(row(state, 0).ping).not.toBeNull();
    expect(row(state, 1).ping).toBeNull();
  });

  it('draws nothing on an OPEN seat previewing a character, or a closed one', () => {
    const state = applyLobbySlots(lobby(), [slot(0, { rtt: 30 })]);
    const model = lobbyModel(state);
    for (const seat of model.seats.filter((s) => s.isBot || s.isClosed)) {
      expect(seat.ping).toBeNull();
    }
  });

  it('shows NOTHING before the server has measured anyone — a lobby that just\n' +
    '     opened is blank, not a room full of 0ms', () => {
    const fresh = lobby();
    expect(row(fresh, 0).ping).toBeNull();
    const seated = applyLobbySlots(fresh, [slot(0), slot(1)]);
    expect(row(seated, 0).ping).toBeNull();
    expect(row(seated, 1).ping).toBeNull();
  });

  it('is a MEASUREMENT, not a memory: a seat the server stopped publishing blanks\n' +
    '     on the next broadcast rather than keeping the number it had', () => {
    const measured = applyLobbySlots(lobby(), [slot(0, { rtt: 120 })]);
    expect(row(measured, 0).ping?.ms).toBe(120);

    const quiet = applyLobbySlots(measured, [slot(0)]);
    expect(row(quiet, 0).ping).toBeNull();
  });

  it('drops the number when a seat changes hands to a bot — a substituted player\n' +
    '     must not leave their round trip behind on the bot flying their ship', () => {
    const human = applyLobbySlots(lobby(), [slot(0, { rtt: 30 }), slot(1, { rtt: 210 })]);
    expect(row(human, 1).ping?.ms).toBe(210);

    // The player dropped; a bot took the controls (GDD §4.2).
    const substituted = applyLobbySlots(human, [slot(0, { rtt: 30 }), slot(1, { isBot: true })]);
    expect(row(substituted, 1).ping).toBeNull();
  });

  it('follows the number as it moves, and re-grades it on the way', () => {
    let state = applyLobbySlots(lobby(), [slot(0, { rtt: 40 })]);
    expect(row(state, 0).ping?.grade).toBe('good');
    state = applyLobbySlots(state, [slot(0, { rtt: 160 })]);
    expect(row(state, 0).ping).toEqual({ ms: 160, label: '160ms', grade: 'fair' });
    state = applyLobbySlots(state, [slot(0, { rtt: 640 })]);
    expect(row(state, 0).ping?.grade).toBe('poor');
  });

  it('leaves an OFFLINE lobby with no pings at all — there is no wire to time', () => {
    const solo = createLobby({ room: 'SOLO', you: 0, host: 0, slots: 4, online: false });
    for (const seat of lobbyModel(solo).seats) expect(seat.ping).toBeNull();
  });
});
