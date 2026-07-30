/**
 * tests/server/economy-wire.test.ts — the wallet's own channel on the wire.
 * OWNER: Netcode Engineer (GDD §4.2, QA m10 "economy-not-on-wire").
 *
 * A ship's wallet — the ore in its hold, the ore it has banked, the upgrade tiers
 * it bought — is the one piece of match-lifetime ship state the 30 Hz snapshot
 * deliberately does not carry (`src/net/snapshot`: ships and projectiles, 510
 * measured bytes, no room and no need for state a client can predict). The client
 * keeps its own copy by running the same `step()` the server runs.
 *
 * That works while the player is flying and fails in two places, and QA found the
 * loud one: across a reconnect the substituting bot earns on the authoritative
 * ship while the reclaiming client rebuilds a *fresh* world, so the seat came back
 * naked. The quiet one is normal flight — reconciliation rewinds the clock and
 * replays unacknowledged input over authority, but a rewind cannot put the hold
 * back the way it puts the position back, so ore is re-earned once per reconcile
 * and the predicted bank drifts up with RTT until the buy button starts lying.
 *
 * So authority states the wallet: once in the reclaim `welcome` (before the client
 * has a world to predict in), and thereafter on the ticks it moves — to the owning
 * slot only, immediately ahead of that tick's snapshot. This file is the server
 * half of that contract: what is sent, when, and to whom.
 *
 * In-process, with a made-up clock and array-backed sockets (`server/room.ts`),
 * like every other test of this server.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { UpgradeTrack } from '@shared/types';
import type { EconomyMessage, ServerMessage } from '../../src/net/transport';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';

/** A socket that keeps its frames, in order — the ordering is half the contract. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {}

  messages(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const frame of this.frames) {
      const message = parseServerMessage(frame);
      if (message) out.push(message);
    }
    return out;
  }

  wallets(): EconomyMessage[] {
    return this.messages().filter((m): m is EconomyMessage => m.type === 'economy');
  }

  clear(): void {
    this.frames.length = 0;
  }
}

interface Client {
  socket: FakeSocket;
  connection: Connection;
}

describe('the economy channel', () => {
  let server: MatchServer;
  let now = 2_000_000;
  let code: string;
  let host: Client;
  let guest: Client;

  const advance = (ms: number): void => {
    now += ms;
    server.update(now);
  };

  const connect = (): Client => {
    const socket = new FakeSocket();
    return { socket, connection: server.connect(socket) };
  };

  const join = (client: Client, room: string): void => {
    client.connection.receive(encodeClientMessage({ type: 'join', room }));
  };

  beforeEach(() => {
    now = 2_000_000;
    server = new MatchServer({ seed: 0x5eed, graceMs: 60_000, asteroidCount: 12 });
    server.update(now);
    code = server.createCode();
    host = connect();
    join(host, code);
    guest = connect();
    join(guest, code);
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    advance(16);
    advance(200);
  });

  it('says nothing while a wallet sits still', () => {
    const ship = host.connection.room!.world!.ships[0]!;
    // A ship with an empty hold banks nothing: no mining, no deposit, no purchase,
    // so nothing about its wallet changes from tick to tick.
    ship.cargo = 0;
    host.socket.clear();

    advance(500); // ~30 ticks, ~15 snapshots

    // Snapshots kept flowing; the wallet channel stayed quiet. That is what makes
    // it affordable to state the whole wallet whenever it *does* move.
    expect(host.socket.messages().some((m) => m.type === 'snapshot')).toBe(true);
    expect(host.socket.wallets()).toHaveLength(0);
  });

  it('states the wallet on the tick it moves, ahead of that tick’s snapshot', () => {
    const room = host.connection.room!;
    const ship = room.world!.ships[0]!;
    host.socket.clear();

    // Authority moves the wallet — a mined ore banked, an upgrade bought. (Planted
    // rather than played: what is under test is the channel, not the economy.)
    ship.banked += 9;
    (ship.tiers as Record<string, number>)[UpgradeTrack.Power] = 2;
    advance(34); // two snapshots' worth of ticks

    const wallets = host.socket.wallets();
    expect(wallets).toHaveLength(1);
    expect(wallets[0]?.player).toBe(0);
    expect(wallets[0]?.economy.banked).toBe(ship.banked);
    expect(wallets[0]?.economy.tiers[UpgradeTrack.Power]).toBe(2);

    // Ordering is the load-bearing part: the client stages the wallet and writes it
    // during the reconcile the snapshot triggers, so it must arrive *first* and name
    // that same tick — otherwise the client's own unacked mining is replayed under
    // authority's figure instead of on top of it (`src/net/prediction`).
    const stream = host.socket.messages();
    const walletAt = stream.findIndex((m) => m.type === 'economy');
    const snapshot = stream.slice(walletAt).find((m) => m.type === 'snapshot');
    expect(snapshot).toBeDefined();
    if (snapshot?.type !== 'snapshot') throw new Error('unreachable');
    expect(wallets[0]?.tick).toBe(snapshot.tick);
  });

  it('tells each client its own wallet and nobody else’s', () => {
    const room = host.connection.room!;
    host.socket.clear();
    guest.socket.clear();

    room.world!.ships[0]!.banked += 5;
    advance(34);

    // A rival's hold and bank are information you do not get for free, the same
    // discipline as scouted station health (GDD §2.2): the frame goes to slot 0.
    expect(host.socket.wallets().map((w) => w.player)).toEqual([0]);
    expect(guest.socket.wallets()).toHaveLength(0);
  });

  it('does not repeat a wallet it has already sent', () => {
    const room = host.connection.room!;
    room.world!.ships[0]!.cargo = 0;
    host.socket.clear();

    room.world!.ships[0]!.banked += 3;
    advance(34);
    expect(host.socket.wallets()).toHaveLength(1);

    advance(500);

    // Full state, sent on change — not a heartbeat. Nothing moved, so nothing more
    // was said.
    expect(host.socket.wallets()).toHaveLength(1);
  });

  it('hands the wallet back in the reclaim welcome, then stays quiet', () => {
    const room = host.connection.room!;
    const token = guest.socket.messages().find((m) => m.type === 'welcome');
    if (token?.type !== 'welcome' || token.reclaimToken === undefined) {
      throw new Error('no reclaim token for the guest');
    }

    const ship = room.world!.ships[1]!;
    ship.cargo = 0;
    ship.banked = 26;
    (ship.tiers as Record<string, number>)[UpgradeTrack.Hull] = 1;

    guest.connection.close(now);
    advance(2_000); // a bot flies the seat for two seconds

    const back = connect();
    back.connection.receive(
      encodeClientMessage({ type: 'join', room: code, reclaim: 1, reclaimToken: token.reclaimToken }),
    );

    // The welcome is the one statement that has to come before the world exists:
    // the client builds a fresh, naked ship from `matchStart` and stamps this onto
    // it before predicting a tick (GDD §4.2).
    const welcome = back.socket.messages().find((m) => m.type === 'welcome');
    if (welcome?.type !== 'welcome') throw new Error('no welcome for the reclaim');
    expect(welcome.economy?.banked).toBeCloseTo(ship.banked, 9);
    expect(welcome.economy?.held).toBeCloseTo(ship.cargo, 9);
    expect(welcome.economy?.tiers[UpgradeTrack.Hull]).toBe(1);

    // And the channel does not immediately repeat what the welcome just said.
    expect(back.socket.wallets()).toHaveLength(0);
  });
});
