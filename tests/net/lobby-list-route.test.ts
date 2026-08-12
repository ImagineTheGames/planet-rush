/**
 * tests/net/lobby-list-route.test.ts — **the list route against a live
 * allocator**, with real Machines beating into it. OWNER: Netcode Engineer
 * (a0-26; `docs/lobby-browser-plan.md` §1 and §3; brief n10-01).
 *
 * Nothing here is stubbed. `./local-fleet` stands up the production shape — two
 * `MatchServer`s enforcing real signed tickets, a Fly-shaped edge in front of
 * them, a real allocator process on a real socket learning the fleet from real
 * HMAC-authenticated heartbeats — and the client is the shipped one
 * (`readLobbyList`, `joinListing`, `createOnlineSession`). The only thing the
 * fixture adds is a way to say **beat now**, because the whole subject of this
 * file is what the list says between beats.
 *
 * Four claims, in the order they matter:
 *
 *   1. **A lobby-phase room appears, and its fields are the room's own.** Humans,
 *      open seats, mode, region — each read off the ad, none recomputed.
 *   2. **No room code is on the wire.** Asserted against the raw response text,
 *      not against the fields this file happens to name.
 *   3. **A row is joinable anyway** — the developer's JOIN button, end to end:
 *      handle → ticket → socket → welcome, without the player ever holding a code.
 *   4. **A stale row fails honestly.** This is the one the plan calls *worse than
 *      no list* if it is got wrong: a room that ended inside the last heartbeat is
 *      still listed, still hands out a ticket — and is then **refused at the
 *      Machine** instead of being silently re-created as an empty lobby.
 *
 * The fourth claim is also the code path's regression (Milestone A5): typing the
 * code of a room that ended a beat ago now refuses too, and creates nothing.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { allocateRoom, joinRoom } from '../../src/net/allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from '../../src/net/allocator-client';
import { joinListing, readLobbyList } from '../../src/net/lobby-list';
import type { LobbyListing } from '../../src/net/lobby-list';
import { allocatorTransport, createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import { FLEET_AUTH_HEADER, signFleetRequest } from '../../src/net/fleet-auth';
import { FLEET_SECRET, startLocalFleet } from './local-fleet';
import type { LocalFleet } from './local-fleet';
import { nodeWebSocket, until } from './node-websocket';
import { netBudget } from './budgets';

let fleet: LocalFleet | null = null;
const open: OnlineSession[] = [];

afterEach(async () => {
  for (const session of open.splice(0)) session.close();
  await fleet?.stop();
  fleet = null;
});

/** Unwrap an allocator answer, failing with its own reason rather than a null. */
function connectionOf(
  result: Awaited<ReturnType<typeof allocateRoom>> | Awaited<ReturnType<typeof joinListing>>,
): ResolvedConnection {
  if (!result.ok) throw new Error(`allocator refused: ${result.reason}`);
  return result.connection;
}

/** Dial a resolved connection verbatim and wait for the seat, exactly as the
 *  browser does (`src/main.ts` `startResolve` → `connectMatch`). */
async function dial(
  connection: ResolvedConnection,
  client: AllocatorClientConfig,
  shipClass = ShipClass.Vanguard,
): Promise<{ seat: number; session: OnlineSession }> {
  const session = createOnlineSession({
    url: connection.url,
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

/** Stand up the fleet, open a room the way HOST does, and beat it into the
 *  allocator's registry. Returns the room's code and the host's session. */
async function hostedRoom(
  client: AllocatorClientConfig,
  size = 4,
): Promise<{ code: string; session: OnlineSession }> {
  const connection = connectionOf(await allocateRoom(client, { size }));
  const { session } = await dial(connection, client);
  await fleet!.beat();
  return { code: connection.room, session };
}

/** The current listing, or a failure the test can read. */
async function list(client: AllocatorClientConfig): Promise<readonly LobbyListing[]> {
  const listing = await readLobbyList(client);
  if (listing === null) throw new Error('the allocator did not answer a usable listing');
  return listing.rooms;
}

describe('the lobby list, against a live allocator', () => {
  it('shows a lobby-phase room, with its own numbers and no code', async () => {
    fleet = await startLocalFleet(31);
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };

    const { code } = await hostedRoom(client, 4);

    const raw = await fetch(`${fleet.allocatorBase}/rooms`);
    const text = await raw.text();
    // The claim the developer's refinement rests on, checked against the whole
    // payload rather than the fields this test names.
    expect(text).not.toContain(code);

    const body = JSON.parse(text);
    expect(body.asOf).toBeGreaterThan(0);
    expect(body.rooms).toHaveLength(1);
    const [row] = body.rooms;
    expect(row).toMatchObject({
      region: 'iad',
      size: 4,
      mode: 'ffa',
      players: 1, // the host, a human — never "participants" (Trap 4)
      joinableSeats: 3, // free AND open, straight off the ad (Trap 3)
    });
    expect(row.owner).toHaveLength(6);
    expect(row.id.length).toBeGreaterThan(8);
  }, netBudget({
    work: 'boot a two-Machine fleet and an allocator → allocate → dial through the shared edge → beat → read GET /rooms',
    measuredSeconds: 1.0,
  }));

  it('joins from the row — a handle, a ticket, a socket, a seat, and no code typed', async () => {
    fleet = await startLocalFleet(37);
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
    const { code } = await hostedRoom(client, 4);

    // Everything the browsing player has is the row.
    const [row] = await list(client);
    expect(JSON.stringify(row)).not.toContain(code);

    const connection = connectionOf(await joinListing(client, row!.id));
    const { seat } = await dial(connection, client, ShipClass.Hauler);

    expect(seat).toBeGreaterThanOrEqual(0);
    // The code arrives with the join, as it must — a `join` names it on the socket.
    expect(connection.room).toBe(code);

    const host = fleet.machineOf(connection.machine);
    await until('both seats filled', () => (host?.matches.room(code)?.humanCount ?? 0) === 2);

    // …and the next beat says so, without anybody recomputing anything.
    await fleet.beat();
    expect((await list(client))[0]).toMatchObject({ players: 2, joinableSeats: 2 });
  }, netBudget({
    work: 'boot the fleet → host a room → read the list → join from the row through the shared edge → assert both seats and the refreshed listing',
    measuredSeconds: 1.2,
  }));

  it('drops a room the host makes PRIVATE, and keeps its code working', async () => {
    fleet = await startLocalFleet(41);
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
    const { code, session } = await hostedRoom(client, 4);
    expect(await list(client)).toHaveLength(1);

    // The lobby's PRIVATE toggle, on the wire it will actually ride (a0-26 D1).
    const room = fleet.machines.find((m) => m.matches.room(code) !== undefined)!.matches.room(code)!;
    session.chooseInLobby({ shipClass: ShipClass.Vanguard, listed: false });
    // The message crosses a real socket; beat once the room has actually heard it,
    // or the beat races the wire and states the truth from a moment ago.
    await until('the room hears PRIVATE', () => !room.listed, 5_000);
    await fleet.beat();

    expect(await list(client)).toEqual([]);
    // Unlisted is not unreachable: a friend with the code still gets in.
    expect(connectionOf(await joinRoom(client, code)).room).toBe(code);
  }, netBudget({
    work: 'boot the fleet → host a room → flip PRIVATE over the real wire → beat → assert the row is gone and the code still resolves',
    measuredSeconds: 1.0,
  }));

  it('drops a room that has started — a row never offers a seat in a live match', async () => {
    fleet = await startLocalFleet(43);
    const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
    const { code, session } = await hostedRoom(client, 4);

    // A room that cannot field two participants does not start (GDD §2.1), so the
    // host authors one bot seat — seated only at RUSH! (a0-11).
    session.chooseInLobby({
      shipClass: ShipClass.Vanguard,
      seats: ['open', 'bot', 'closed', 'closed'],
    });
    const room = fleet.machines.find((m) => m.matches.room(code) !== undefined)!.matches.room(code)!;
    session.startMatch();
    await until('the match starts', () => room.state === 'live', 5_000);
    await fleet.beat();

    expect(await list(client)).toEqual([]);
  }, netBudget({
    work: 'boot the fleet → host a room → RUSH! over the real wire → beat → assert the room has left the list',
    measuredSeconds: 1.0,
  }));

  // -------------------------------------------------------------------------
  // The stale row — the failure the plan calls worse than no list
  // -------------------------------------------------------------------------

  describe('a row for a room that has ended', () => {
    it('is still listed until the next beat, and refuses honestly when tapped', async () => {
      fleet = await startLocalFleet(47);
      const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
      const { code, session } = await hostedRoom(client, 4);
      const [row] = await list(client);

      // The host leaves the LOBBY. `vacate` treats a lobby-phase departure the
      // same however it arrives — the seat is freed and its token cleared, with no
      // grace either way — so the room is garbage on the very next sweep, exactly
      // as it is for the closed tab the plan measured (`server/room.ts` `vacate`).
      const host = fleet.machines.find((m) => m.matches.room(code) !== undefined)!;
      session.leave();
      await until('the room is swept', () => host.matches.room(code) === undefined, 5_000);

      // The allocator has NOT heard yet — this is the window the plan measured at
      // 0..5000 ms, and the list is allowed to be wrong inside it.
      expect((await list(client)).map((r) => r.id)).toContain(row!.id);

      // …but acting on the stale row must not be quiet. The allocator still signs
      // a ticket (it cannot know), and the Machine refuses it — because the ticket
      // says `join` and there is no room to join (Milestone A).
      const connection = connectionOf(await joinListing(client, row!.id));
      await expect(dial(connection, client)).rejects.toThrow(/room-gone/);

      // The half that matters most: nothing was created. Before the intent claim
      // this join opened an empty room the player then sat alone in.
      expect(host.matches.room(code)).toBeUndefined();
      expect(host.matches.roomLoads().some((r) => r.code === code)).toBe(false);

      // And once the beat lands, the row is simply gone.
      await fleet.beat();
      expect((await list(client)).map((r) => r.id)).not.toContain(row!.id);
    }, netBudget({
      work: 'boot the fleet → host a room → drop the host in the lobby → tap the stale row → assert the refusal and that no room was created',
      measuredSeconds: 1.5,
    }));

    it('refuses the same way on the CODE path — the bug this closes was always there (A5)', async () => {
      fleet = await startLocalFleet(53);
      const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
      const { code, session } = await hostedRoom(client, 4);

      const host = fleet.machines.find((m) => m.matches.room(code) !== undefined)!;
      session.leave();
      await until('the room is swept', () => host.matches.room(code) === undefined, 5_000);

      // Type a code whose match ended four seconds ago. This used to open an empty
      // room wearing that code; a browse list would only have multiplied it.
      const connection = connectionOf(await joinRoom(client, code));
      await expect(dial(connection, client)).rejects.toThrow(/room-gone/);
      expect(host.matches.room(code)).toBeUndefined();
    }, netBudget({
      work: 'boot the fleet → host a room → drop the host in the lobby → join by CODE inside the heartbeat window → assert the refusal and that no room was created',
      measuredSeconds: 1.5,
    }));

    it('refuses a handle whose Machine has gone, without inventing a room for it', async () => {
      fleet = await startLocalFleet(59);
      const client: AllocatorClientConfig = { baseUrl: fleet.allocatorBase, fetch };
      const { code } = await hostedRoom(client, 4);
      const [row] = await list(client);

      // A Machine that dies without deregistering keeps its rooms in the registry
      // for the liveness window (plan §1's named failure mode). Its rooms are
      // reachable-looking and unreachable; the tap has to say so.
      const host = fleet.machines.find((m) => m.matches.room(code) !== undefined)!;
      const body = JSON.stringify({ machine: host.machine });
      const dereg = await fetch(`${fleet.allocatorBase}/deregister`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // A fleet write is authenticated, exactly as a draining Machine's is.
          [FLEET_AUTH_HEADER]: signFleetRequest(body, FLEET_SECRET),
        },
        body,
      });
      expect(dereg.status).toBe(204);

      // Deregistration is the graceful case and it is instant: the row goes at
      // once rather than lingering for 15 s, which is what makes a rolled deploy
      // invisible to a browsing player.
      const rows = await list(client);
      expect(rows.map((r) => r.id)).not.toContain(row!.id);
      const refused = await joinListing(client, row!.id);
      expect(refused).toEqual({ ok: false, reason: 'not-found' });
    }, netBudget({
      work: 'boot the fleet → host a room → deregister its Machine → assert the row leaves the list at once and its handle refuses',
      measuredSeconds: 1.0,
    }));
  });
});
