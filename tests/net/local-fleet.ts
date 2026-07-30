/**
 * tests/net/local-fleet.ts — the live fleet's shape, on localhost. OWNER: Netcode
 * Engineer (GDD §4.2; M10 machine-pin).
 *
 * Everything the production join path has, and nothing it does not:
 *
 *   • **two** match Machines, each enforcing tickets and knowing its own id, each
 *     with the socket-hop guard armed exactly the way `server/index.ts` arms it
 *     (`armReplayGuard({ router: 'fly', … })`);
 *   • a real allocator process (`createAllocatorServer`) with the **FlyReplayRouter**
 *     — so `POST /rooms` answers with the *shared* `connectUrl` and a ticket bound
 *     to one Machine, which is the live response shape, not the DirectRouter's
 *     per-Machine URL every earlier test used;
 *   • a Fly-shaped **edge** in front of both Machines (`./fly-edge`), which honours
 *     `fly-replay` the way Fly's proxy does.
 *
 * That combination is what nothing in the repo had. The pieces were each tested
 * alone and the whole was only ever exercised against the live fleet by hand — so
 * when the gameserver image stopped building and production quietly reverted to a
 * pre-pin server, every test still passed (M10 join-pin regression). This file is
 * the fixture that closes that gap; `./live-pin.test.ts` drives it in CI and
 * `./live-pin.probe.mjs --local` probes it the same way it probes production.
 *
 * Run it standalone to get a fleet you can point anything at:
 *
 *   LOCAL_FLEET=serve npx vite-node tests/net/local-fleet.ts
 *   # → prints  ALLOCATOR http://127.0.0.1:PORT  and stays up until Ctrl-C
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mulberry32 } from '@shared/types';
import { Allocator } from '../../allocator/allocator';
import { InMemoryRoomRegistry } from '../../allocator/registry';
import { FlyReplayRouter } from '../../allocator/router';
import { createAllocatorServer } from '../../allocator/index';
import { MatchServer } from '../../server/match-server';
import { attachWebSocketServer } from '../../server/ws';
import type { WsConnection } from '../../server/ws';
import { armReplayGuard } from '../../server/upgrade-router';
import { buildRegistration } from '../../server/heartbeat';
import { FLEET_AUTH_HEADER, signFleetRequest } from '../../src/net/fleet-auth';
import { startFlyEdge } from './fly-edge';
import type { FlyEdge } from './fly-edge';

/** The shared allocator↔Machine key. In production a Fly secret; here, a constant. */
export const FLEET_SECRET = 'allocator-and-machine-share-this';

/** The two Machine ids, shaped like Fly's (hex) so log lines read like the real ones. */
export const MACHINE_IDS = ['0800d5b6f1e208', '4d891e33b27a95'] as const;

/** One Machine in the local fleet. */
export interface FleetMachine {
  readonly machine: string;
  /** Its direct `ws://…/play` URL — what the edge forwards to. */
  readonly url: string;
  /** The authoritative server, so a test can read its rooms. */
  readonly matches: MatchServer;
}

/** A whole fleet, ready to be dialled exactly as production is. */
export interface LocalFleet {
  /** `http://127.0.0.1:PORT` — what a client's `VITE_ALLOCATOR_URL` would be. */
  readonly allocatorBase: string;
  /** The shared endpoint the allocator advertises as `connectUrl`. */
  readonly edge: FlyEdge;
  readonly machines: readonly FleetMachine[];
  /** Look up a Machine by the id a ticket names. */
  machineOf(id: string): FleetMachine | undefined;
  stop(): Promise<void>;
}

/** How a fleet is stood up. */
export interface FleetOptions {
  /**
   * Arm the socket-hop machine-pin on every Machine (default `true` — production's
   * intent, `MATCH_ROUTER = "fly"`). Pass `false` to reproduce the **shipped-dead**
   * state the live fleet was actually in: the pin code present, the guard never
   * built, so a wrong-Machine upgrade completes locally and the join gate refuses
   * it `bad-ticket`. A harness that cannot reproduce the bug cannot prove the fix,
   * so `./live-pin.test.ts` asserts both directions.
   */
  readonly pin?: boolean;
}

/** Stand up one match Machine on an ephemeral port, pin armed unless told otherwise. */
async function startMachine(
  machineId: string,
  seed: number,
  pin: boolean,
): Promise<FleetMachine & { close(): Promise<void> }> {
  const matches = new MatchServer({ seed, slots: 8, ticketSecret: FLEET_SECRET, machineId });
  const connections: WsConnection[] = [];
  const http: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', machine: machineId, rooms: matches.roomCount }));
  });
  // The guard `server/index.ts` builds from MATCH_ROUTER — the same call, not a
  // re-implementation, so a change to the arming rule is felt here immediately.
  const beforeUpgrade = armReplayGuard({
    // `MATCH_ROUTER`, straight from the deploy config. Unset (or anything but
    // 'fly') is precisely how the pin ships dead.
    router: pin ? 'fly' : undefined,
    machineId,
    secret: FLEET_SECRET,
    now: Date.now,
  });
  if (pin && !beforeUpgrade) throw new Error('the machine-pin guard refused to arm');
  attachWebSocketServer(
    http,
    (connection) => {
      connections.push(connection);
      const client = matches.connect(connection);
      connection.onMessage((frame) => client.receive(frame));
      connection.onClose(() => client.close(Date.now()));
    },
    beforeUpgrade,
  );
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  const loop = setInterval(() => matches.update(Date.now()), 1000 / 60);
  return {
    machine: machineId,
    url: `ws://127.0.0.1:${port}/play`,
    matches,
    close: async (): Promise<void> => {
      clearInterval(loop);
      for (const connection of connections) connection.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** Announce a Machine to the allocator the way `server/index.ts` does on boot. */
async function register(allocatorBase: string, machine: FleetMachine): Promise<void> {
  const body = JSON.stringify(
    buildRegistration({
      identity: { machine: machine.machine, region: 'iad' },
      capacity: machine.matches.capacity,
      draining: false,
    }),
  );
  const response = await fetch(`${allocatorBase}/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FLEET_AUTH_HEADER]: signFleetRequest(body, FLEET_SECRET),
    },
    body,
  });
  if (!response.ok) throw new Error(`registration refused: ${response.status}`);
}

/**
 * Build the fleet: two Machines, an edge in front of them, an allocator that
 * advertises the edge as the shared `connectUrl` and signs each room to one
 * Machine. `seed` fixes the allocator's room-code stream so a run repeats.
 */
export async function startLocalFleet(seed = 7, options: FleetOptions = {}): Promise<LocalFleet> {
  const pin = options.pin ?? true;
  const machines = await Promise.all(MACHINE_IDS.map((id, i) => startMachine(id, seed + i, pin)));
  const edge = await startFlyEdge(machines.map((m) => ({ machine: m.machine, url: m.url })));

  const registry = new InMemoryRoomRegistry();
  const allocator = new Allocator({ registry, rng: mulberry32(seed), secret: FLEET_SECRET });
  const server = createAllocatorServer({
    allocator,
    registry,
    // The LIVE router: one shared connectUrl for the whole fleet, and the routing
    // decision left to the socket hop (`allocator/index.ts` `decided`).
    router: new FlyReplayRouter({ selfRegion: 'iad', connectUrl: edge.url }),
    now: Date.now,
    secret: FLEET_SECRET,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const allocatorBase = `http://127.0.0.1:${port}`;
  for (const machine of machines) await register(allocatorBase, machine);

  return {
    allocatorBase,
    edge,
    machines,
    machineOf: (id) => machines.find((m) => m.machine === id),
    stop: async (): Promise<void> => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await edge.stop();
      for (const machine of machines) await machine.close();
    },
  };
}

// --- standalone -------------------------------------------------------------
// A fleet on localhost that anything can be pointed at, including the probe's
// `--local` mode, which reads the ALLOCATOR line below:
//
//   LOCAL_FLEET=serve npx vite-node tests/net/local-fleet.ts
//
// The switch is an env var rather than an `argv[1]` check because `vite-node`
// runs this module without putting its path on `process.argv` — importing the
// file from a test must never start a listener.
if (process.env['LOCAL_FLEET'] === 'serve') {
  void (async (): Promise<void> => {
    // `LOCAL_FLEET_PIN=off` reproduces the shipped-dead fleet on purpose, so the
    // probe can be shown failing the way production failed before it is trusted
    // to report a pass. It is the standalone twin of `FleetOptions.pin`.
    const fleet = await startLocalFleet(7, { pin: process.env['LOCAL_FLEET_PIN'] !== 'off' });
    console.log(`ALLOCATOR ${fleet.allocatorBase}`);
    console.log(`EDGE      ${fleet.edge.url}`);
    console.log(`CONTROL   ${fleet.edge.controlUrl}`);
    for (const machine of fleet.machines) console.log(`MACHINE   ${machine.machine} ${machine.url}`);
    const shutdown = (): void => void fleet.stop().then(() => process.exit(0));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })();
}
