/**
 * spikes/lobby-browser/measure-listing.ts — THROWAWAY measurement code for
 * docs/lobby-browser-plan.md (Architect spike a0-26). NOT production; not in the
 * build; excluded from tsconfig/vitest include. Run it with:
 *
 *   npx vite-node spikes/lobby-browser/measure-listing.ts
 *
 * The brief asks six questions and four of them are only answerable with a
 * number: how stale is a listing, what does a dead row do when you tap it, what
 * does an open browser cost the allocator, and what can a row honestly say. This
 * file answers all four against the SHIPPED objects — `InMemoryRoomRegistry`,
 * `Allocator`, `MatchServer`, `MatchRoom` — with an injected clock, so every
 * figure in the plan is reproducible by re-running this and reading stdout.
 *
 * Nothing here is a proposal. It measures what exists today; the plan decides
 * what to do about it.
 *
 *   §1  STALENESS      — how old is the newest fact a listing could carry?
 *   §2  DEAD ROWS      — what happens when a player taps a room that is gone?
 *   §3  PAYLOAD        — what does one listing weigh, and an idle browser cost?
 *   §4  WHAT A ROW KNOWS — which of the brief's six columns actually exist.
 */

import { mulberry32, ShipClass } from '../../src/shared/types';
import {
  DEFAULT_LIVENESS_MS,
  DEFAULT_RESERVATION_TTL_MS,
  InMemoryRoomRegistry,
  type Heartbeat,
} from '../../allocator/registry';
import { Allocator, AllocatorError, type RoomInfo } from '../../allocator/allocator';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '../../server/heartbeat';
import { MatchServer, type Connection, type ServerSocket } from '../../server/match-server';
import { DEFAULT_MAX_ROOMS } from '../../server/match-server';
import { encodeClientMessage, parseServerMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { LobbySeatState, ServerMessage } from '../../src/net/transport';

const SECRET = 'spike-shared-secret';
const T0 = 1_700_000_000_000;

const line = (s = ''): void => console.log(s);
const rule = (title: string): void => {
  line();
  line(`── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`);
  line();
};

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A heartbeat for one Machine hosting `rooms`. The shape `server/heartbeat.ts`
 *  builds and `allocator/registry.ts` ingests, field for field. */
function beat(
  machine: string,
  region: string,
  rooms: { code: string; players: number; size: number; mode: string; joinableSeats: number }[],
  capacity = DEFAULT_MAX_ROOMS,
): Heartbeat {
  return { machine, region, capacity, rooms };
}

/** A socket that keeps what it was sent — the whole network layer, for a spike.
 *  Copied from `tests/server/match-server.test.ts` so this file adds no test
 *  helper to the shipped tree. */
class FakeSocket implements ServerSocket {
  readonly frames: WireFrame[] = [];
  closed = false;
  send(frame: WireFrame): void {
    this.frames.push(frame);
  }
  close(): void {
    this.closed = true;
  }
  messages(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const frame of this.frames) {
      const message = parseServerMessage(frame);
      if (message) out.push(message);
    }
    return out;
  }
  first<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.messages().find((m) => m.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }
}

interface Client {
  socket: FakeSocket;
  connection: Connection;
}

/** The host's roster message: seats `humans`..`size-1` set to BOT (a0-11 — bots
 *  go where the host puts them, and nowhere else). */
function seatBots(humans: number, size: number, bots: number): WireFrame {
  const seats: LobbySeatState[] = Array.from({ length: size }, (_, i) =>
    i < humans ? 'open' : i < humans + bots ? 'bot' : 'open',
  );
  return encodeClientMessage({
    type: 'lobbyChoice',
    shipClass: ShipClass.Vanguard,
    fireMode: 'manual',
    seats,
  });
}

// ---------------------------------------------------------------------------
// §1 — STALENESS: how old is the newest fact a listing could carry?
// ---------------------------------------------------------------------------

function measureStaleness(): void {
  rule('§1  STALENESS — the age of a listed fact');

  line(`heartbeat interval          ${DEFAULT_HEARTBEAT_INTERVAL_MS} ms   (server/heartbeat.ts)`);
  line(`registry liveness window    ${DEFAULT_LIVENESS_MS} ms   (allocator/registry.ts)`);
  line(`reservation lease TTL       ${DEFAULT_RESERVATION_TTL_MS} ms   (allocator/registry.ts)`);
  line();

  // (a) A seat fills between beats. The Machine knows at once; the allocator
  //     does not hear until the next heartbeat.
  const registry = new InMemoryRoomRegistry();
  const allocator = new Allocator({ registry, rng: mulberry32(1), secret: SECRET });
  registry.observe(
    beat('m1', 'iad', [{ code: 'AAAA', players: 1, size: 8, mode: 'ffa', joinableSeats: 7 }]),
    T0,
  );
  const before = allocator.roomInfo('AAAA', T0 + 1);
  // …the room fills on the Machine at T0+100ms. No heartbeat yet.
  const during = allocator.roomInfo('AAAA', T0 + DEFAULT_HEARTBEAT_INTERVAL_MS - 1);
  registry.observe(
    beat('m1', 'iad', [{ code: 'AAAA', players: 8, size: 8, mode: 'ffa', joinableSeats: 0 }]),
    T0 + DEFAULT_HEARTBEAT_INTERVAL_MS,
  );
  const after = allocator.roomInfo('AAAA', T0 + DEFAULT_HEARTBEAT_INTERVAL_MS);
  line('(a) a seat fills between beats — the allocator keeps saying the old number');
  line(`    t+0ms      joinableSeats=${before?.joinableSeats} joinable=${before?.joinable}`);
  line(
    `    t+${DEFAULT_HEARTBEAT_INTERVAL_MS - 1}ms   joinableSeats=${during?.joinableSeats} joinable=${during?.joinable}   <- WRONG for up to one interval`,
  );
  line(
    `    t+${DEFAULT_HEARTBEAT_INTERVAL_MS}ms   joinableSeats=${after?.joinableSeats} joinable=${after?.joinable}`,
  );
  line();

  // (b) A Machine dies. Its rooms stay listed for the whole liveness window.
  const dead = new InMemoryRoomRegistry();
  const deadAlloc = new Allocator({ registry: dead, rng: mulberry32(2), secret: SECRET });
  dead.observe(
    beat('m2', 'iad', [{ code: 'BBBB', players: 3, size: 8, mode: 'teams', joinableSeats: 5 }]),
    T0,
  );
  line('(b) the Machine dies at t+0 — its rooms are listed until liveness lapses');
  for (const dt of [5_000, 10_000, DEFAULT_LIVENESS_MS, DEFAULT_LIVENESS_MS + 1]) {
    const info = deadAlloc.roomInfo('BBBB', T0 + dt);
    line(`    t+${String(dt).padStart(6)}ms   listed=${info !== null ? 'YES' : 'no '}`);
  }
  line();

  // (c) The boot gap: a room that exists only as a lease reads fully joinable
  //     with no occupancy at all, whether or not the Machine ever comes up.
  const gap = new InMemoryRoomRegistry();
  const gapAlloc = new Allocator({ registry: gap, rng: mulberry32(3), secret: SECRET });
  gap.observe(beat('m3', 'iad', []), T0);
  gap.reserve('CCCC', 'm3', T0, { size: 4, mode: 'ffa' });
  const booting = gapAlloc.roomInfo('CCCC', T0 + 1_000);
  const lapsed = gapAlloc.roomInfo('CCCC', T0 + DEFAULT_RESERVATION_TTL_MS + 1);
  line('(c) the boot gap — a reserved room advertises joinable with no occupancy');
  line(
    `    t+1000ms   ${JSON.stringify(booting)}   <- players/joinableSeats simply ABSENT`,
  );
  line(`    t+${DEFAULT_RESERVATION_TTL_MS + 1}ms  ${JSON.stringify(lapsed)}`);
  line();

  const poll = 5_000;
  line('WORST-CASE AGE OF A ROW, as the player reads it:');
  line(
    `    heartbeat ${DEFAULT_HEARTBEAT_INTERVAL_MS}ms + client poll ${poll}ms = ${DEFAULT_HEARTBEAT_INTERVAL_MS + poll}ms of drift on occupancy,`,
  );
  line(
    `    and up to ${DEFAULT_LIVENESS_MS}ms on EXISTENCE when the host Machine dies rather than the room.`,
  );
}

// ---------------------------------------------------------------------------
// §2 — DEAD ROWS: what a tap on a room that is gone actually does
// ---------------------------------------------------------------------------

function measureDeadRows(): void {
  rule('§2  DEAD ROWS — tapping a room that is already gone');

  // A real Machine, a real room, a real host who walks out of the lobby.
  let now = T0;
  const matches = new MatchServer({ seed: 0x5eed, graceMs: 60_000, asteroidCount: 12 });
  matches.update(now);

  const host: Client = (() => {
    const socket = new FakeSocket();
    return { socket, connection: matches.connect(socket) };
  })();
  const code = matches.createCode();
  host.connection.receive(encodeClientMessage({ type: 'join', room: code }));
  host.connection.receive(seatBots(1, 8, 0));
  line(`room ${code} opened by one host, no bots seated (a0-11: a new room is EMPTY)`);
  line(`    heartbeat says: ${JSON.stringify(matches.roomLoads()[0])}`);
  line();

  // The host closes the tab while still in the lobby.
  host.connection.close(now);
  now += 1;
  matches.update(now);
  line('the host closes the tab in the LOBBY (no grace — `room.vacate` frees the seat):');
  line(`    heartbeat says: ${JSON.stringify(matches.roomLoads())}   <- the room is swept at once`);
  line();

  // The allocator has not heard yet. Two windows keep the code alive.
  const registry = new InMemoryRoomRegistry();
  const allocator = new Allocator({ registry, rng: mulberry32(7), secret: SECRET });
  registry.observe(
    beat('m1', 'iad', [{ code, players: 1, size: 8, mode: 'ffa', joinableSeats: 7 }]),
    T0,
  );
  const stillListed = allocator.roomInfo(code, T0 + DEFAULT_HEARTBEAT_INTERVAL_MS - 1);
  line(
    `the allocator still lists it for one beat: ${JSON.stringify(stillListed)}`,
  );

  // The player taps it. `Allocator.join` locates it and signs a ticket…
  let signed = false;
  try {
    allocator.join(code, T0 + DEFAULT_HEARTBEAT_INTERVAL_MS - 1);
    signed = true;
  } catch (err) {
    signed = !(err instanceof AllocatorError);
  }
  line(`    allocator.join() → ticket signed: ${signed ? 'YES (no refusal)' : 'no'}`);

  // …and the Machine, asked for a code it no longer hosts, CREATES IT AGAIN.
  const second: Client = (() => {
    const socket = new FakeSocket();
    return { socket, connection: matches.connect(socket) };
  })();
  second.connection.receive(encodeClientMessage({ type: 'join', room: code }));
  matches.update(now);
  const welcome = second.socket.first('welcome');
  line(
    `    MatchServer join → welcome{you:${welcome?.you}, room:${welcome?.room}}, room now: ${JSON.stringify(matches.roomLoads()[0])}`,
  );
  line();
  line('  THE TRAP: the player tapped "1/8 · FFA" and landed ALONE in a brand-new');
  line('  room wearing the same four characters. Nothing refused them, nothing lied');
  line('  in a way any layer can detect — `MatchServer.openRoom` creates on join');
  line('  (server/match-server.ts) and that is what makes the CODE path work.');
  line();

  // Once both windows lapse, the honest 404 comes back.
  registry.observe(beat('m1', 'iad', []), T0 + DEFAULT_HEARTBEAT_INTERVAL_MS);
  let refused = '';
  try {
    allocator.join(code, T0 + DEFAULT_HEARTBEAT_INTERVAL_MS + 1);
  } catch (err) {
    refused = err instanceof AllocatorError ? err.reason : 'unknown';
  }
  line(`after the next beat drops it: allocator.join() → ${refused} (HTTP 404)`);
  line(`    window in which a dead row is silently re-created: 0..${DEFAULT_HEARTBEAT_INTERVAL_MS}ms`);
  line(`    (and 0..${DEFAULT_RESERVATION_TTL_MS}ms for a room that never booted at all)`);
}

// ---------------------------------------------------------------------------
// §3 — PAYLOAD: what a listing weighs, and what an idle browser costs
// ---------------------------------------------------------------------------

function measurePayload(): void {
  rule('§3  PAYLOAD — the weight of one listing, and of an idle browser');

  const shapes = [
    { machines: 1, perMachine: DEFAULT_MAX_ROOMS, label: 'one Machine, full' },
    { machines: 2, perMachine: DEFAULT_MAX_ROOMS, label: 'the DEPLOYED fleet, full' },
    { machines: 10, perMachine: DEFAULT_MAX_ROOMS, label: '10 Machines, full' },
    { machines: 20, perMachine: DEFAULT_MAX_ROOMS, label: '20 Machines, full' },
  ];

  line('| fleet                    | rooms | all rooms | joinable only | bytes/room |');
  line('|--------------------------|-------|-----------|---------------|------------|');
  const sizes: { rooms: number; all: number; joinable: number }[] = [];
  for (const shape of shapes) {
    const registry = new InMemoryRoomRegistry();
    const allocator = new Allocator({ registry, rng: mulberry32(11), secret: SECRET });
    const codes: string[] = [];
    for (let m = 0; m < shape.machines; m++) {
      const rooms = [];
      for (let r = 0; r < shape.perMachine; r++) {
        // Codes are 4 chars from the shipped alphabet; occupancy varies so the
        // JSON is not artificially compressible.
        const code = codeFor(m * shape.perMachine + r);
        codes.push(code);
        rooms.push({
          code,
          players: (r % 8) + 1,
          size: 8,
          mode: r % 3 === 0 ? 'teams' : 'ffa',
          joinableSeats: r % 4,
        });
      }
      registry.observe(beat(`machine-${m}`, 'iad', rooms), T0);
    }
    const all: RoomInfo[] = codes
      .map((c) => allocator.roomInfo(c, T0))
      .filter((i): i is RoomInfo => i !== null);
    const joinable = all.filter((i) => i.joinable);
    const allBytes = Buffer.byteLength(JSON.stringify({ rooms: all }), 'utf8');
    const joinBytes = Buffer.byteLength(JSON.stringify({ rooms: joinable }), 'utf8');
    sizes.push({ rooms: all.length, all: allBytes, joinable: joinBytes });
    line(
      `| ${shape.label.padEnd(24)} | ${String(all.length).padStart(5)} | ${String(allBytes).padStart(6)} B  | ${String(joinBytes).padStart(7)} B (${String(joinable.length).padStart(2)}) | ${String(Math.round(allBytes / Math.max(1, all.length))).padStart(6)} B   |`,
    );
  }
  line();

  const deployed = sizes[1];
  if (deployed === undefined) return;
  line(`THE DEPLOYED FLEET TODAY: 2 Machines × ${DEFAULT_MAX_ROOMS} rooms = ${deployed.rooms} rooms max.`);
  line(`A full listing is ${deployed.all} bytes of JSON — one MTU, uncompressed.`);
  line();
  line('ONE BROWSER SITTING OPEN, at three poll cadences:');
  line('| poll | requests/min | bytes/min (full fleet) | bytes/hour |');
  line('|------|--------------|------------------------|------------|');
  for (const poll of [2, 5, 10]) {
    const perMin = 60 / poll;
    const bytes = perMin * deployed.all;
    line(
      `| ${String(poll).padStart(3)}s | ${String(perMin).padStart(12)} | ${String(Math.round(bytes)).padStart(22)} | ${String(Math.round(bytes * 60)).padStart(10)} |`,
    );
  }
  line();
  // What it costs the allocator to BUILD one, from the state it already holds.
  line('WHAT BUILDING ONE COSTS THE ALLOCATOR (the state is already in memory):');
  for (const machines of [2, 20]) {
    const registry = new InMemoryRoomRegistry();
    for (let m = 0; m < machines; m++) {
      const rooms = [];
      for (let r = 0; r < DEFAULT_MAX_ROOMS; r++) {
        rooms.push({
          code: codeFor(m * DEFAULT_MAX_ROOMS + r),
          players: (r % 8) + 1,
          size: 8,
          mode: 'ffa',
          joinableSeats: r % 4,
        });
      }
      registry.observe(beat(`machine-${m}`, 'iad', rooms), T0);
    }
    const build = (): number => {
      // The shape a list route would take: walk the live fleet once, flatten.
      let n = 0;
      for (const view of registry.machines(T0)) n += view.rooms.length;
      return n;
    };
    build();
    const iters = 2_000;
    const started = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) build();
    const elapsed = Number(process.hrtime.bigint() - started) / 1e3 / iters;
    line(
      `    ${String(machines).padStart(2)} Machines × ${DEFAULT_MAX_ROOMS} rooms = ${String(machines * DEFAULT_MAX_ROOMS).padStart(3)} rooms → ${elapsed.toFixed(1)} µs per listing built`,
    );
  }
  line();
  line('THE ALTERNATIVE, for scale: no list route, and the client reads each row');
  line(`with the EXISTING GET /rooms/:code — ${deployed.rooms} requests per refresh instead of 1,`);
  line(`i.e. ${Math.round((60 / 5) * deployed.rooms)} allocator requests/min per open browser at a 5 s poll.`);
}

/** A 4-char code from the shipped alphabet, indexed — no RNG, no collisions. */
function codeFor(n: number): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  let v = n;
  for (let i = 0; i < 4; i++) {
    out = (A[v % A.length] ?? 'A') + out;
    v = Math.floor(v / A.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §4 — WHAT A ROW KNOWS: the brief's six columns, against what exists
// ---------------------------------------------------------------------------

function measureRowFacts(): void {
  rule('§4  WHAT A ROW CAN HONESTLY SAY TODAY');

  // Drive a real room to RUSH! and read every field that crosses the wire.
  let now = T0;
  const matches = new MatchServer({ seed: 0xbeef, graceMs: 60_000, asteroidCount: 12 });
  matches.update(now);
  const socket = new FakeSocket();
  const connection = matches.connect(socket);
  const code = matches.createCode();
  connection.receive(encodeClientMessage({ type: 'join', room: code }));
  connection.receive(seatBots(1, 8, 3));
  matches.update(now);

  const lobbyAd = matches.roomLoads()[0];
  line('what the HEARTBEAT carries about a lobby-phase room:');
  line(`    ${JSON.stringify(lobbyAd)}`);
  line();

  connection.receive(encodeClientMessage({ type: 'startMatch' }));
  now += 100;
  matches.update(now);
  const start = socket.first('matchStart');
  line('what MATCHSTART carries (the whole static match config, per GDD §4.2):');
  line(`    keys = ${start ? Object.keys(start).join(', ') : '(none)'}`);
  line(`    abundance = ${start ? String((start as { abundance?: string }).abundance) : '—'}`);
  line();
  line(`the live room's advert: ${JSON.stringify(matches.roomLoads()[0])}`);
  line();

  const columns = [
    ['players / slots', 'YES', 'Room.players + Room.size (heartbeat)'],
    ['joinable seats', 'YES', 'Room.joinableSeats (heartbeat, a0-11-aware)'],
    ['mode (FFA/TEAMS)', 'YES', 'Room.mode (heartbeat, set by lobbyChoice.mode)'],
    ['region', 'YES', 'RoomInfo.region, from the host Machine view'],
    ['measured ping', 'YES', 'src/net/region-probe.ts, per REGION not per room'],
    ['abundance / YIELD', 'NO ', 'lobbyChoice.abundance reaches the ROOM, not the ad'],
    ['map / arena', 'NO ', 'mapId never crosses the wire at all — see below'],
  ];
  line('| column            | on the ad? | where it comes from                          |');
  line('|-------------------|------------|----------------------------------------------|');
  for (const [name, has, where] of columns) {
    line(`| ${String(name).padEnd(17)} | ${has}        | ${String(where).padEnd(44)} |`);
  }
  line();
  line('THE MAP FINDING, stated exactly:');
  line('  `mapId` does not appear in server/ or src/net/ outside tests. `MatchRoom`');
  line('  calls `createWorld({seed, players, bounds?, asteroidCount?, abundance})`');
  line('  (server/room.ts) with NO mapId, and `MatchStartMessage` carries none, so');
  line('  `beginPredicting` (src/net/session.ts) omits it too. Both sides therefore');
  line('  build `getMap(undefined)` — the default — and AGREE, which is why nothing');
  line('  is broken. But MAP SELECT is client-local: online it moves the backdrop');
  line('  sky (main.ts `chosenMapId` → renderer) and nothing else. A browser row');
  line('  cannot print a map until the map is on the wire.');
}

// ---------------------------------------------------------------------------

measureStaleness();
measureDeadRows();
measurePayload();
measureRowFacts();
line();
line('done.');
