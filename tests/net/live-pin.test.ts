/**
 * tests/net/live-pin.test.ts — the machine-pin, dialled the way a player dials it.
 * OWNER: Netcode Engineer (GDD §4.2; M10 join-pin regression).
 *
 * **The test that was missing.** The pin had two tests and a hole between them.
 * `tests/server/upgrade-replay.test.ts` proves one Machine emits the right
 * `fly-replay` header; `tests/net/online-allocated.test.ts` proves a client can
 * reach a room through an allocator — but with a **DirectRouter and one Machine**,
 * which is not the live shape: on Fly the allocator hands back a *shared*
 * `connectUrl` for a fleet of two, and the routing decision happens on the socket
 * hop. Nothing exercised that end to end, so when the gameserver image stopped
 * building and the fleet silently reverted to a pre-pin server, 2,593 tests stayed
 * green while 1 join in 3 came back `{"type":"joinError","reason":"bad-ticket"}`.
 *
 * So this dials the **live shape**: `connectUrl` exactly as the allocator returns
 * it (`ResolvedConnection.url`, untouched), through a Fly-shaped edge, against a
 * fleet of two — and it asserts the outcome **for both Machines as the first hop**,
 * rather than sampling whichever one an anycast edge happened to pick:
 *
 *   • first hop == the room's host  → welcome, no replay;
 *   • first hop != the room's host  → welcome, **exactly one** replay.
 *
 * The second case is the one production was failing. Note what is NOT stubbed: a
 * real allocator with the real FlyReplayRouter, two real `MatchServer`s enforcing
 * real signed tickets with the shipped `armReplayGuard`, the shipped RFC 6455
 * endpoint, and clients that are `allocateRoom` → `createOnlineSession` — the
 * browser's own path (`src/main.ts` `startResolve` → `connectMatch`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { allocateRoom, joinRoom } from '../../src/net/allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from '../../src/net/allocator-client';
import { allocatorTransport, createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import { startLocalFleet } from './local-fleet';
import type { LocalFleet } from './local-fleet';
import { nodeWebSocket, until } from './node-websocket';

let fleet: LocalFleet | null = null;
const open: OnlineSession[] = [];

afterEach(async () => {
  for (const session of open.splice(0)) session.close();
  await fleet?.stop();
  fleet = null;
});

/** Unwrap an allocator answer, failing with its own reason rather than a null. */
function connectionOf(result: Awaited<ReturnType<typeof allocateRoom>>): ResolvedConnection {
  if (!result.ok) throw new Error(`allocator refused: ${result.reason}`);
  return result.connection;
}

/**
 * Dial a resolved connection *verbatim* — the URL the allocator returned, the room
 * it minted, the ticket it signed — and wait for the seat. This is the whole point
 * of the file: no test-local URL, no direct Machine address, nothing the browser
 * would not have. Returns the seat, or throws with whatever the server refused with.
 */
async function dial(
  connection: ResolvedConnection,
  client: AllocatorClientConfig,
  shipClass = ShipClass.Vanguard,
): Promise<{ seat: number; session: OnlineSession }> {
  const session = createOnlineSession({
    url: connection.url, // ← exactly as the allocator returned it
    room: connection.room,
    shipClass,
    transport: { connect: nodeWebSocket, ...allocatorTransport(connection, client) },
  });
  open.push(session);
  let seat: number | null = null;
  session.observe((message) => {
    if (message.type === 'welcome') seat = message.you;
  });
  await until(
    `a welcome for room ${connection.room}`,
    () => seat !== null || session.closeReason !== null,
    10_000,
  );
  if (seat === null) {
    throw new Error(`join refused: ${session.closeReason} — ${session.rejectReason ?? 'no reason'}`);
  }
  return { seat, session };
}

describe('the LIVE-shape dial: shared connectUrl, two Machines, the pin holding', () => {
  it('welcomes from BOTH machines as first hop — the wrong one replays to the room host', async () => {
    fleet = await startLocalFleet(11);
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };

    // The allocator answers with the FLEET's shared endpoint, not a Machine's own
    // address — the shape that makes the socket hop necessary in the first place.
    const connection = connectionOf(await allocateRoom(client, { size: 2 }));
    expect(connection.url).toBe(fleet.edge.url);
    expect(fleet.machines.map((m) => m.machine)).toContain(connection.machine);
    expect(connection.ticket.length).toBeGreaterThan(0);

    const host = connection.machine;
    const other = fleet.machines.find((m) => m.machine !== host);
    if (!other) throw new Error('the fleet has only one machine');

    // --- Hop 1: the edge lands the upgrade on the WRONG Machine. --------------
    // The production failure, made deterministic: before the fix this is the join
    // that came back `bad-ticket` and left the player on "connecting" forever.
    fleet.edge.landOn(other.machine);
    fleet.edge.resetCounts();
    const wrongFirst = await dial(connection, client);
    expect(wrongFirst.seat).toBeGreaterThanOrEqual(0);
    expect(fleet.edge.replays).toBe(1); // it really did take the replay, not luck
    // The room exists on the Machine the ticket named, and nowhere else.
    expect(fleet.machineOf(host)?.matches.room(connection.room)).toBeDefined();
    expect(other.matches.room(connection.room)).toBeUndefined();

    // --- Hop 2: the edge lands a second player on the RIGHT Machine. ----------
    const second = connectionOf(await joinRoom(client, connection.room));
    expect(second.machine).toBe(host);
    expect(second.url).toBe(fleet.edge.url);
    fleet.edge.landOn(host);
    fleet.edge.resetCounts();
    const rightFirst = await dial(second, client, ShipClass.Hauler);
    expect(rightFirst.seat).toBeGreaterThanOrEqual(0);
    expect(fleet.edge.replays).toBe(0); // served where it landed, no detour

    // Two humans, one room, reached through the shared endpoint from either hop.
    const room = fleet.machineOf(host)?.matches.room(connection.room);
    await until('both seats filled', () => (room?.humanCount ?? 0) === 2);
  }, 30_000);

  it('holds across repeated allocations — six rounds, alternating first hops', async () => {
    // The permanent form of the Director's 6/6 wire probe, run against the local
    // fleet so CI keeps it honest: six independent allocate→dial rounds, and the
    // edge is *told* to land on the wrong Machine for half of them rather than
    // being asked to be unlucky. Six lucky coins proved nothing; three deliberate
    // wrong hops prove the pin.
    fleet = await startLocalFleet(23);
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
    const outcomes: { room: string; host: string; landedOn: string; seat: number }[] = [];

    for (let round = 0; round < 6; round++) {
      const connection = connectionOf(await allocateRoom(client, { size: 2 }));
      const host = connection.machine;
      const other = fleet.machines.find((m) => m.machine !== host)!;
      // Alternate: land on the host, then on the other Machine, and so on.
      const landedOn = round % 2 === 0 ? host : other.machine;
      fleet.edge.landOn(landedOn);
      fleet.edge.resetCounts();
      const { seat } = await dial(connection, client);
      expect(fleet.edge.replays).toBe(landedOn === host ? 0 : 1);
      outcomes.push({ room: connection.room, host, landedOn, seat });
    }

    expect(outcomes).toHaveLength(6);
    // Every round welcomed — the 6/6 the probe reports, with the coin flip removed.
    expect(outcomes.every((o) => o.seat >= 0)).toBe(true);
    // And the wrong-machine path was genuinely taken, not merely available.
    expect(outcomes.filter((o) => o.landedOn !== o.host).length).toBe(3);
  }, 60_000);

  it('REPRODUCES the production failure with the pin disarmed — bad-ticket on the wrong hop', async () => {
    // The proof that this harness can see the bug at all. With `MATCH_ROUTER`
    // unset — the state the live fleet was in, because its image had not built
    // since the pin landed — the wrong-Machine upgrade completes locally and the
    // join gate refuses it. This is the exact frame the Director's probe caught,
    // and the exact reason the developer sat on "connecting":
    //   {"type":"joinError","reason":"bad-ticket"}
    fleet = await startLocalFleet(17, { pin: false });
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
    const connection = connectionOf(await allocateRoom(client, { size: 2 }));
    const other = fleet.machines.find((m) => m.machine !== connection.machine)!;

    fleet.edge.landOn(other.machine);
    fleet.edge.resetCounts();
    await expect(dial(connection, client)).rejects.toThrow(/bad-ticket/);
    expect(fleet.edge.replays).toBe(0); // no pin, so nothing was ever replayed

    // …and the *right* hop still works, which is why the live symptom was a
    // lottery rather than a total outage — and why it survived spot-checking.
    fleet.edge.landOn(connection.machine);
    const second = connectionOf(await joinRoom(client, connection.room));
    const { seat } = await dial(second, client);
    expect(seat).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('refuses honestly when a ticket names a machine the fleet cannot reach', async () => {
    // The pin must not paper over a genuinely bad ticket: an unverifiable one is
    // served where it lands and refused by the join gate with `bad-ticket`, never
    // bounced around the fleet on an unverified claim (`server/upgrade-router.ts`).
    fleet = await startLocalFleet(31);
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
    const connection = connectionOf(await allocateRoom(client, { size: 2 }));
    const forged: ResolvedConnection = { ...connection, ticket: `${connection.ticket}tamper` };

    await expect(dial(forged, client)).rejects.toThrow(/bad-ticket/);
  }, 30_000);
});
