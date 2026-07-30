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
import { buildHeartbeat, buildRegistration } from '../../server/heartbeat';
import { FLEET_AUTH_HEADER, signFleetRequest } from '../../src/net/fleet-auth';
import { verifyTicket } from '../../src/net/ticket';
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
  /** Arm or disarm the socket-hop pin across the whole fleet at runtime — the
   *  fixture's stand-in for redeploying with `MATCH_ROUTER` set or unset. */
  setPin(on: boolean): void;
  stop(): Promise<void>;
}

/** How a fleet is stood up. */
export interface FleetOptions {
  /** Fixed allocator port, so a fixture that must be reachable at a known URL (the
   *  live-stage evidence run, whose bundle bakes `VITE_ALLOCATOR_URL` at build
   *  time) can be. 0 — the default — takes an ephemeral one. */
  readonly allocatorPort?: number;
  /** Fixed edge port, for the same reason: the allocator advertises this URL as
   *  `connectUrl`, and a built bundle cannot be told about an ephemeral one. */
  readonly edgePort?: number;
  /** Hold every upgrade this long at the edge — see {@link EdgeOptions.hopDelayMs}. */
  readonly hopDelayMs?: number;
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
): Promise<FleetMachine & { close(): Promise<void>; setPin(on: boolean): void }> {
  // The pin is a *runtime* flag in the fixture so a caller can put the fleet into
  // the shipped-dead state and back without restarting it. On a real Machine this
  // is `MATCH_ROUTER`, read once at boot and only changeable by a deploy — which
  // is precisely why production stayed broken for days.
  let pinned = pin;
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
    // `null` is "complete the upgrade here", which is exactly what an unarmed
    // Machine does — so a disarmed fixture behaves like the production one did.
    (request) => (pinned && beforeUpgrade ? beforeUpgrade(request) : null),
  );
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  const loop = setInterval(() => matches.update(Date.now()), 1000 / 60);
  return {
    machine: machineId,
    url: `ws://127.0.0.1:${port}/play`,
    matches,
    setPin: (on: boolean): void => {
      pinned = on && beforeUpgrade !== undefined;
    },
    close: async (): Promise<void> => {
      clearInterval(loop);
      for (const connection of connections) connection.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** POST an authenticated fleet message, exactly as `server/index.ts` does. */
async function postFleet(allocatorBase: string, path: string, body: unknown): Promise<Response> {
  const raw = JSON.stringify(body);
  return fetch(`${allocatorBase}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FLEET_AUTH_HEADER]: signFleetRequest(raw, FLEET_SECRET),
    },
    body: raw,
  });
}

/** Announce a Machine to the allocator the way `server/index.ts` does on boot. */
async function register(allocatorBase: string, machine: FleetMachine): Promise<void> {
  const response = await postFleet(
    allocatorBase,
    '/register',
    buildRegistration({
      identity: { machine: machine.machine, region: 'iad' },
      capacity: machine.matches.capacity,
      draining: false,
    }),
  );
  if (!response.ok) throw new Error(`registration refused: ${response.status}`);
}

/** How often each Machine beats. A registration alone goes stale in the registry's
 *  liveness window, and a fleet that stops beating stops being placeable — which
 *  showed up here as `503 no-capacity` fifteen seconds into a run. */
const HEARTBEAT_MS = 2_000;

/** Beat one Machine's rooms and load, the way `HeartbeatReporter` does in prod. */
function beat(allocatorBase: string, machine: FleetMachine): Promise<Response> {
  return postFleet(
    allocatorBase,
    '/fleet/heartbeat',
    buildHeartbeat({
      identity: { machine: machine.machine, region: 'iad' },
      capacity: machine.matches.capacity,
      draining: false,
      rooms: machine.matches.roomLoads(),
      lagP99Ms: 0,
    }),
  );
}

/**
 * Build the fleet: two Machines, an edge in front of them, an allocator that
 * advertises the edge as the shared `connectUrl` and signs each room to one
 * Machine. `seed` fixes the allocator's room-code stream so a run repeats.
 */
export async function startLocalFleet(seed = 7, options: FleetOptions = {}): Promise<LocalFleet> {
  const pin = options.pin ?? true;
  const machines = await Promise.all(MACHINE_IDS.map((id, i) => startMachine(id, seed + i, pin)));
  const edge = await startFlyEdge(
    machines.map((m) => ({ machine: m.machine, url: m.url })),
    {
      ...(options.edgePort !== undefined ? { port: options.edgePort } : {}),
      ...(options.hopDelayMs !== undefined ? { hopDelayMs: options.hopDelayMs } : {}),
      // `?pin=on|off` on the edge's control route, for an out-of-process caller.
      // The fixture may read the ticket the real edge cannot: it holds the fleet
      // secret, so `?wrong=1` can land every upgrade on a Machine that provably
      // does NOT host the room — the worst case, on demand.
      hostOf: (upgradeUrl): string | null => {
        const ticket = new URL(upgradeUrl, 'http://edge.internal').searchParams.get('ticket');
        if (ticket === null) return null;
        return verifyTicket(ticket, FLEET_SECRET, Date.now())?.machine ?? null;
      },
      onControl: (params): void => {
        const value = params.get('pin');
        if (value !== null) for (const machine of machines) machine.setPin(value !== 'off');
      },
    },
  );

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
  await new Promise<void>((resolve) => server.listen(options.allocatorPort ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const allocatorBase = `http://127.0.0.1:${port}`;
  for (const machine of machines) await register(allocatorBase, machine);
  // Keep beating, or the registry expires the fleet mid-run and every allocate
  // answers 503.
  const heartbeats = setInterval(() => {
    for (const machine of machines) void beat(allocatorBase, machine).catch(() => {});
  }, HEARTBEAT_MS);
  heartbeats.unref?.();

  return {
    allocatorBase,
    edge,
    machines,
    machineOf: (id) => machines.find((m) => m.machine === id),
    setPin: (on: boolean): void => {
      for (const machine of machines) machine.setPin(on);
    },
    stop: async (): Promise<void> => {
      clearInterval(heartbeats);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await edge.stop();
      for (const machine of machines) await machine.close();
    },
  };
}

/** `{key: value}` when the value is defined, `{}` when it is not — the shape
 *  `exactOptionalPropertyTypes` wants for an optional field built from an env var. */
function maybe<K extends string>(key: K, value: number | undefined): Record<K, number> | object {
  return value === undefined || Number.isNaN(value) ? {} : ({ [key]: value } as Record<K, number>);
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
    const num = (name: string): number | undefined => {
      const raw = process.env[name];
      return raw === undefined ? undefined : Number(raw);
    };
    const fleet = await startLocalFleet(7, {
      pin: process.env['LOCAL_FLEET_PIN'] !== 'off',
      ...maybe('allocatorPort', num('LOCAL_FLEET_PORT')),
      ...maybe('edgePort', num('LOCAL_FLEET_EDGE_PORT')),
      ...maybe('hopDelayMs', num('LOCAL_FLEET_HOP_DELAY_MS')),
    });
    // A fixed first hop, for the evidence run that has to produce a wrong-machine
    // refusal on demand rather than wait for the round-robin to oblige.
    const land = process.env['LOCAL_FLEET_LAND'];
    if (land !== undefined) fleet.edge.landOn(MACHINE_IDS[Number(land)] ?? land);
    console.log(`ALLOCATOR ${fleet.allocatorBase}`);
    console.log(`EDGE      ${fleet.edge.url}`);
    console.log(`CONTROL   ${fleet.edge.controlUrl}`);
    for (const machine of fleet.machines) console.log(`MACHINE   ${machine.machine} ${machine.url}`);
    const shutdown = (): void => void fleet.stop().then(() => process.exit(0));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })();
}
