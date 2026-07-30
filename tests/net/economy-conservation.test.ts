/**
 * tests/net/economy-conservation.test.ts — the ore ledger balances across a
 * reconnect. OWNER: Netcode Engineer (GDD §4.2, §2.3).
 *
 * The reconnect-grace rule hands a ship back to the player who left it: "same
 * ship, same hull, same cargo, same banked ore, same upgrades" (GDD §4.2). Handing
 * a *wallet* back over a wire is the kind of operation that quietly mints or
 * destroys ore — restore the hold onto a ship that still has one and the match is
 * one ore richer; drop it on the floor and it is poorer. The sim already has the
 * law that catches both: `liveOre === seeded + injected + debrisFloor − spent −
 * deathLoss − capLoss` (`src/sim/ore-ledger`), sampled as a residual that a black
 * hole anywhere drives off zero.
 *
 * So this runs the whole grace cycle through the real server — a human seat drops,
 * a substitute bot mines and banks on the authoritative ship for as long as it
 * takes to *earn* a wallet nobody forged, then the seat is reclaimed by room code
 * and token — and samples that residual on **every tick** of it. Nothing is staged:
 * the ore in the reclaimed hold was mined out of a real asteroid by a real bot on
 * the same `step()` a player would have flown.
 *
 * Then it checks the other half, which conservation alone cannot see: that what the
 * reclaim `welcome` carries is *authority's* wallet to the last decimal, and that a
 * client rebuilding a fresh world from it lands on the same ship — including the
 * ceilings the upgrade tiers scale, which are stored rather than derived
 * (`src/net/prediction` `applyPlayerEconomy`).
 *
 * In-process against `MatchServer` with a made-up clock, so "45 seconds of bot
 * mining" costs a second of test and every tick is observable. The same cycle over
 * a real socket, with a real client predicting, is `./reconnect-resume.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { PlayerEconomy, ServerMessage } from '../../src/net/transport';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import { applyPlayerEconomy } from '../../src/net/prediction';
import { MatchServer } from '../../server/match-server';
import type { Connection, ServerSocket } from '../../server/match-server';
import { TICK_DT, createWorld, oreResidual } from '../../src/sim';
import type { Ship, World } from '../../src/sim';

/** A four-seat room in a cramped world: two humans, two lobby bots, and enough
 *  rock within reach that a substitute bot finds ore in tens of seconds rather
 *  than minutes (the QA harness runs cramped worlds for the same reason). */
const ROOM = {
  seed: 0x5eed,
  slots: 4,
  // Ten minutes of grace: the drop→reclaim gap below is as long as the bot needs
  // to earn something, and a window is a parameter here precisely so a test can
  // outlast it (GDD §4.2 ~60 s is the shipping value, TUNABLE).
  graceMs: 600_000,
  asteroidCount: 24,
  bounds: { width: 2200, height: 2200 },
} as const;

/** Ticks to give the substitute bot to mine. It first banked at ~2 700 on this
 *  seed; the loop stops the moment the wallet moves, so this is only a ceiling. */
const SUBSTITUTE_TICK_BUDGET = 4_000;

/**
 * Float slack for the ledger, the same order as the sim's own conservation soak:
 * thousands of sub-`1e-9` clamps over a match sum to far less than one ore, and a
 * real leak loses whole ore — a chunk, a hold, a bank.
 */
const CONSERVATION_TOL = 1e-6;

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

  find<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.messages().find((m) => m.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }
}

interface Client {
  socket: FakeSocket;
  connection: Connection;
}

/** The wallet as it sits on an authoritative ship. */
function walletOf(ship: Ship): PlayerEconomy {
  return { held: ship.cargo, banked: ship.banked, tiers: { ...ship.tiers } };
}

describe('the ore ledger across a reconnect', () => {
  it('balances every tick of drop → substitute → reclaim, and the wallet handed back is authority’s', () => {
    let now = 3_000_000;
    const server = new MatchServer(ROOM);
    server.update(now);

    const connect = (): Client => {
      const socket = new FakeSocket();
      return { socket, connection: server.connect(socket) };
    };

    const code = server.createCode();
    const host = connect();
    host.connection.receive(encodeClientMessage({ type: 'join', room: code }));
    const guest = connect();
    guest.connection.receive(encodeClientMessage({ type: 'join', room: code }));
    host.connection.receive(encodeClientMessage({ type: 'startMatch' }));
    now += 16;
    server.update(now);

    const room = host.connection.room;
    const world = room?.world;
    if (!room || !world) throw new Error('the match never started');
    const seat = guest.connection.player;
    if (seat === null) throw new Error('the guest was never seated');
    const ship = world.ships.find((s) => s.id === seat);
    if (!ship) throw new Error('no authoritative ship for the guest');

    // One tick at a time, so the ledger is sampled at the same resolution the sim
    // runs at — a leak that opens and closes inside one `update` would otherwise
    // hide between samples.
    let worstResidual = 0;
    let brokeAtTick = -1;
    const runTicks = (ticks: number, until?: () => boolean): void => {
      for (let i = 0; i < ticks; i++) {
        now += TICK_DT * 1000;
        server.update(now);
        const residual = Math.abs(oreResidual(world));
        if (residual > worstResidual) worstResidual = residual;
        if (brokeAtTick < 0 && residual > CONSERVATION_TOL) brokeAtTick = world.tick;
        if (until?.()) return;
      }
    };

    // --- Flying ------------------------------------------------------------
    runTicks(120);
    const token = guest.socket.find('welcome')?.reclaimToken;
    if (token === undefined) throw new Error('the guest was issued no reclaim token');

    // --- The drop: a bot takes the controls and starts earning --------------
    const walletAtDrop = ship.cargo + ship.banked;
    guest.connection.close(now);
    expect(room.lobbyState()[seat]?.isBot).toBe(true);

    runTicks(SUBSTITUTE_TICK_BUDGET, () => ship.cargo + ship.banked > walletAtDrop + 0.5);

    // Not a vacuous pass: the substitute really did mine and bank on this ship, so
    // the wallet about to be handed back is one no client could have predicted and
    // no test forged.
    const earned = ship.cargo + ship.banked - walletAtDrop;
    expect(earned, 'the substitute bot earned ore on the seat it was holding').toBeGreaterThan(0.5);
    expect(room.graceRemaining(seat, now)).toBeGreaterThan(0);

    // --- The return --------------------------------------------------------
    const authority = walletOf(ship);
    const back = connect();
    back.connection.receive(
      encodeClientMessage({ type: 'join', room: code, reclaim: seat, reclaimToken: token }),
    );
    expect(back.connection.player).toBe(seat);
    expect(room.lobbyState()[seat]?.isBot).toBe(false);

    // The ship was never rebuilt — the same object, with the bot's earnings on it.
    expect(world.ships.find((s) => s.id === seat)).toBe(ship);

    // --- The wallet on the wire (QA m10 "economy-not-on-wire") -------------
    const welcome = back.socket.find('welcome');
    const wired = welcome?.economy;
    expect(wired, 'the reclaim welcome carries the wallet').toBeDefined();
    if (!wired) throw new Error('unreachable');
    expect(wired.held).toBe(authority.held);
    expect(wired.banked).toBe(authority.banked);
    expect(wired.tiers).toEqual(authority.tiers);
    expect(wired.banked + wired.held).toBeGreaterThan(walletAtDrop);

    // And it is enough to rebuild the ship, not merely to describe it: a fresh
    // world, as the reclaiming client builds from `matchStart`, plus this wallet,
    // lands on authority's ship — hold, bank, tiers, and the ceilings those tiers
    // scale (`maxHull`, `cargoCap`), which are stored state a relabelled `tiers`
    // would leave at tier 0.
    const start = back.socket.find('matchStart');
    if (!start) throw new Error('the reclaiming client was never sent matchStart');
    const predicted: World = createWorld({
      seed: start.seed,
      players: start.slots.map((s) => ({ id: s.player, shipClass: s.shipClass })),
      ...(start.bounds ? { bounds: { ...start.bounds } } : {}),
      ...(start.asteroidCount !== undefined ? { asteroidCount: start.asteroidCount } : {}),
    });
    expect(applyPlayerEconomy(predicted, seat, wired)).toBe(true);
    const clientShip = predicted.ships.find((s) => s.id === seat);
    expect(clientShip?.cargo).toBe(ship.cargo);
    expect(clientShip?.banked).toBe(ship.banked);
    expect(clientShip?.tiers).toEqual(ship.tiers);
    expect(clientShip?.maxHull).toBe(ship.maxHull);
    expect(clientShip?.cargoCap).toBe(ship.cargoCap);

    // --- And on, with the seat flown by a human again -----------------------
    runTicks(120);

    // The law held at every single tick of the cycle: the reclaim moved a wallet
    // across a wire without minting or destroying a unit of ore.
    expect(brokeAtTick, 'the ore ledger never broke tolerance').toBe(-1);
    expect(worstResidual).toBeLessThan(CONSERVATION_TOL);
  }, 60_000);
});
