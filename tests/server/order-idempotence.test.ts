/**
 * tests/server/order-idempotence.test.ts — **two taps buy two turrets. Never three.**
 * OWNER: Netcode Engineer (GDD §2.5, §4.2; M10 action-echo).
 *
 * The developer's mobile playtest: *"turrets built instantly and I built 2 but 3
 * got built."* This file is the authoritative half of the answer, and it pins both
 * the mechanism and the reason the old code could not have had one.
 *
 * **Why an order could run twice.** `InputQueue` dedupes on `(player, tick)`, which
 * catches a retransmit only while the copy still names the tick the original named.
 * The server's own late-input softening — a message whose tick has already been
 * simulated is re-filed onto the next unsimulated tick, so a lost packet race does
 * not make a player's hands go dead — hands that copy a *different* tick. The queue
 * then sees a first arrival, `step()` sees a `buildOrder`, and the sim validates it
 * exactly as it validated the first one: same slot, same station, still affordable.
 * A second turret, bought and paid for, from one tap.
 *
 * **Two locks, because the failure costs the player ore.** The transport lock is the
 * sequence number: input at or below `ackSeq` has already been simulated and is
 * dropped whole rather than re-filed. The identity lock is the order id itself
 * (`@shared/types` `OrderId`), which holds where the first cannot — a redelivery
 * under a fresh seq, a client replaying a press, anything a future transport does.
 *
 * And the third thing an id buys, tested here too: the server can *answer* for an
 * order (`src/net/transport` OrderEchoMessage), so a client's prediction is either
 * adopted into authority's answer or taken back, instead of standing beside it
 * forever.
 *
 * In-process, injected clock, array-backed sockets — the same shape as every other
 * test of this server (`./economy-wire.test.ts`).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { UpgradeTrack } from '@shared/types';
import type { Action } from '@shared/types';
import { TURRET } from '../../src/sim';
import type { World } from '../../src/sim';
import type { OrderEchoMessage, ServerMessage } from '../../src/net/transport';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import { seatBots } from './seat-bots';

class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {}

  echoes(): OrderEchoMessage[] {
    const out: OrderEchoMessage[] = [];
    for (const frame of this.frames) {
      const message: ServerMessage | null = parseServerMessage(frame);
      if (message?.type === 'orderEcho') out.push(message);
    }
    return out;
  }

  clear(): void {
    this.frames.length = 0;
  }
}

interface Client {
  socket: FakeSocket;
  connection: Connection;
}

describe('an identified order is simulated exactly once', () => {
  let server: MatchServer;
  let now = 3_000_000;
  let host: Client;
  let seq = 0;

  const advance = (ms: number): void => {
    now += ms;
    server.update(now);
  };

  const world = (): World => {
    const w = host.connection.room?.world;
    if (!w) throw new Error('no authoritative world');
    return w;
  };

  /** The host's station — the thing every order here acts on. */
  const station = (): World['stations'][number] => {
    const s = world().stations.find((p) => p.owner === 0);
    if (!s) throw new Error('no station for seat 0');
    return s;
  };

  /** One input frame, exactly as the client's codec would put it on the socket.
   *  `tick` and `seq` are named so a test can *replay* a frame verbatim, which is
   *  the whole point — a retransmit is byte-identical to what it retransmits.
   *  `advance` moves the clock in 50 ms bites: one 60 Hz tick is 16.67 ms, so a
   *  16 ms step would leave the sim standing still on rounding alone. */
  const inputFrame = (tick: number, at: number, actions: readonly Action[]): string =>
    encodeClientMessage({ type: 'input', tick, seq: at, actions });

  /** Send an order for the next tick and return the frame, so the test can send it
   *  again. */
  const order = (orderId: number): string => {
    const frame = inputFrame(world().tick + 1, ++seq, [{ type: 'buildOrder', item: 'turret', orderId }]);
    host.connection.receive(frame);
    return frame;
  };

  beforeEach(() => {
    now = 3_000_000;
    seq = 0;
    server = new MatchServer({ seed: 0xbeef, graceMs: 60_000, asteroidCount: 8 });
    server.update(now);
    const code = server.createCode();
    const socket = new FakeSocket();
    host = { socket, connection: server.connect(socket) };
    host.connection.receive(encodeClientMessage({ type: 'join', room: code }));
    host.connection.receive(seatBots());
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    advance(50);

    // Park the ship on its own station with money in the bank: every order below is
    // about *how many times it runs*, never about whether it was legal.
    const ship = world().ships.find((s) => s.id === 0)!;
    const home = station();
    ship.pos.x = home.pos.x;
    ship.pos.y = home.pos.y;
    ship.vel.x = 0;
    ship.vel.y = 0;
    ship.banked = 200;
    host.socket.clear();
  });

  it('builds ONE turret from one tap, however many times the wire says it', () => {
    const frame = order(0xa1);
    advance(50); // the tick that carries it is simulated
    expect(station().builds.length).toBe(1);

    // The retransmit: the same frame, byte for byte, arriving after its tick ran.
    // Before the fix this was re-filed onto the next unsimulated tick and bought a
    // second turret. `ackSeq` now says those actions have already happened.
    host.connection.receive(frame);
    advance(50);
    expect(station().builds.length).toBe(1);
  });

  it('builds ONE turret when the same order arrives under a FRESH sequence number', () => {
    order(0xa2);
    advance(50);
    expect(station().builds.length).toBe(1);

    // A redelivery the transport lock cannot see: new seq, new tick, same order.
    // Only the id can refuse this, and it does — which is why the id exists.
    host.connection.receive(
      inputFrame(world().tick + 1, ++seq, [{ type: 'buildOrder', item: 'turret', orderId: 0xa2 }]),
    );
    advance(50);
    expect(station().builds.length).toBe(1);
  });

  it('builds TWO turrets from two taps — the lock refuses repeats, not presses', () => {
    order(0xb1);
    advance(50);
    order(0xb2);
    advance(50);
    expect(station().builds.length).toBe(2);

    // Both redelivered. Still two.
    host.connection.receive(
      inputFrame(world().tick + 1, ++seq, [
        { type: 'buildOrder', item: 'turret', orderId: 0xb1 },
        { type: 'buildOrder', item: 'turret', orderId: 0xb2 },
      ]),
    );
    advance(50);
    expect(station().builds.length).toBe(2);
  });

  it('still builds for a client that mints no ids at all (offline parity, bots)', () => {
    // The id is optional (`@shared/types` OrderId). A sender that omits it — a bot
    // through the same action interface a human uses (GDD §2.9), an older client —
    // is not silently disarmed by a rule aimed at the socket.
    host.connection.receive(inputFrame(world().tick + 1, ++seq, [{ type: 'buildOrder', item: 'turret' }]));
    advance(50);
    expect(station().builds.length).toBe(1);
  });

  it('drops only the repeat — the rest of that tick still flies', () => {
    const frame = inputFrame(world().tick + 1, ++seq, [
      { type: 'buildOrder', item: 'turret', orderId: 0xc1 },
      { type: 'thrust', dir: { x: 1, y: 0 } },
    ]);
    host.connection.receive(frame);
    advance(50);
    const afterFirst = world().ships.find((s) => s.id === 0)!.vel.x;
    expect(station().builds.length).toBe(1);

    // The same actions again under a fresh seq: the order is refused, the thrust is
    // not — a player holding the stick must not lose their hands to a dedupe.
    host.connection.receive(
      inputFrame(world().tick + 1, ++seq, [
        { type: 'buildOrder', item: 'turret', orderId: 0xc1 },
        { type: 'thrust', dir: { x: 1, y: 0 } },
      ]),
    );
    advance(50);
    expect(station().builds.length).toBe(1);
    expect(world().ships.find((s) => s.id === 0)!.vel.x).toBeGreaterThan(afterFirst);
  });
});

describe('the order echo — what authority says it did', () => {
  let server: MatchServer;
  let now = 4_000_000;
  let host: Client;
  let seq = 0;

  const advance = (ms: number): void => {
    now += ms;
    server.update(now);
  };
  const world = (): World => host.connection.room!.world!;
  /** Send one tick's actions and return the tick they were stamped for — the tick
   *  authority will run them on, and therefore the birth tick its echo must name. */
  const send = (actions: readonly Action[]): number => {
    const tick = world().tick + 1;
    host.connection.receive(encodeClientMessage({ type: 'input', tick, seq: ++seq, actions }));
    return tick;
  };

  beforeEach(() => {
    now = 4_000_000;
    seq = 0;
    server = new MatchServer({ seed: 0xf00d, graceMs: 60_000, asteroidCount: 8 });
    server.update(now);
    const code = server.createCode();
    const socket = new FakeSocket();
    host = { socket, connection: server.connect(socket) };
    host.connection.receive(encodeClientMessage({ type: 'join', room: code }));
    host.connection.receive(seatBots());
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    advance(50);
    const ship = world().ships.find((s) => s.id === 0)!;
    const home = world().stations.find((p) => p.owner === 0)!;
    ship.pos.x = home.pos.x;
    ship.pos.y = home.pos.y;
    ship.vel.x = 0;
    ship.vel.y = 0;
    host.socket.clear();
  });

  it('accepts a paid order and names the job it queued, with its birth tick', () => {
    world().ships.find((s) => s.id === 0)!.banked = 50;
    const at = send([{ type: 'buildOrder', item: 'turret', orderId: 7 }]);
    advance(50);

    const echoes = host.socket.echoes();
    expect(echoes.length).toBe(1);
    const echo = echoes[0]!;
    expect(echo.orderId).toBe(7);
    expect(echo.accepted).toBe(true);
    // The birth tick: the tick authority actually ran the order on, which is what a
    // predicted build re-bases its construction clock onto (GDD §2.5 — construction
    // takes time, online as well as off).
    expect(echo.tick).toBe(at);
    expect(echo.build?.id).toBe(world().stations.find((p) => p.owner === 0)!.builds[0]!.id);
    expect(echo.build?.total).toBeCloseTo(TURRET.buildTime, 5);
    expect(echo.build?.remaining).toBeGreaterThan(0);
  });

  it('REFUSES an order the sim would not honour, and says so', () => {
    // Nothing in the hold and nothing in the bank: the sim answers `cannot-afford`,
    // and the client must be told rather than left to time out — the ghost turret a
    // player watches assemble on a wallet they do not have is the *"turrets built
    // instantly"* half of the report.
    const ship = world().ships.find((s) => s.id === 0)!;
    ship.banked = 0;
    ship.cargo = 0;
    send([{ type: 'buildOrder', item: 'turret', orderId: 8 }]);
    advance(50);

    const echoes = host.socket.echoes();
    expect(echoes.length).toBe(1);
    expect(echoes[0]!.accepted).toBe(false);
    expect(echoes[0]!.build).toBeUndefined();
    expect(world().stations.find((p) => p.owner === 0)!.builds.length).toBe(0);
  });

  it('answers a ship upgrade too — the order that spawns nothing', () => {
    world().ships.find((s) => s.id === 0)!.banked = 50;
    send([{ type: 'upgradeOrder', track: UpgradeTrack.Power, orderId: 9 }]);
    advance(50);

    const echo = host.socket.echoes()[0]!;
    expect(echo.orderId).toBe(9);
    expect(echo.accepted).toBe(true);
    // No entity, so no job — the client's ledger simply closes the prediction
    // instead of adopting one (`src/net/order-ledger`).
    expect(echo.build).toBeUndefined();
    expect(world().ships.find((s) => s.id === 0)!.tiers[UpgradeTrack.Power]).toBe(1);
  });

  it('says nothing about an order that carried no id', () => {
    world().ships.find((s) => s.id === 0)!.banked = 50;
    send([{ type: 'buildOrder', item: 'turret' }]);
    advance(50);
    expect(host.socket.echoes().length).toBe(0);
  });
});
