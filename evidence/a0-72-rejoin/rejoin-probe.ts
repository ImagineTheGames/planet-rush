/**
 * evidence/a0-72-rejoin/rejoin-probe.ts — *"the server would not take you back"*,
 * reproduced. OWNER: Netcode Engineer (a0-72).
 *
 * The developer's report is a **phone that backgrounded**, not a socket somebody
 * killed, and the two are different code paths:
 *
 *   • a killed socket fires `onclose`, the transport redials inside a second, and
 *     the reclaim lands long before anything has had time to lapse. That is
 *     `tests/net/reconnect-resume.test.ts`, and it has always been green.
 *   • a backgrounded page runs **no handlers at all**. The screen blanks, the OS
 *     suspends the tab, the radio drops the TCP connection, and the client learns
 *     none of it. What it does next happens *N seconds later*, on its return —
 *     and N is the whole bug.
 *
 * So this probe reproduces the second one, over the production stack:
 *
 *   `tests/net/local-fleet.ts` — two ticket-enforcing Machines with the socket-hop
 *   pin armed, a Fly-shaped edge in front of them, and a real allocator process —
 *   plus the real `allocateRoom` → `allocatorTransport` → `WebSocketTransport` →
 *   `createOnlineSession` client path, wired exactly as `src/main.ts` wires it, and
 *   the same `ConnectTrace` the developer can download off the DOWNLOAD LOG button.
 *
 * The suspension is a socket that stops calling the page back **and then dies**,
 * which is what a suspended tab leaves behind: `transport.state` still reads
 * `open`, no `onclose`, no error, no frame. Real wall-clock seconds pass — nothing
 * here moves a clock, because the two windows under test (the allocator's 30 s
 * ticket TTL and the room's 60 s reconnect grace) are measured by the allocator and
 * the server in real seconds and this probe does not get to lie to either.
 *
 *   npx vite-node evidence/a0-72-rejoin/rejoin-probe.ts -- --away=35000 --label=away-35s
 *
 * Writes `<label>.json` beside this file: every frame the return dial got, the
 * connect trace verbatim, the words the overlay would put on screen, and the
 * wallet the reclaim did or did not hand back.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass } from '@shared/types';
import { startLocalFleet } from '../../tests/net/local-fleet';
import { nodeWebSocket } from '../../tests/net/node-websocket';
import { allocateRoom } from '../../src/net/allocator-client';
import type { ResolvedConnection } from '../../src/net/allocator-client';
import { createOnlineSession, allocatorTransport } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import type { ServerMessage } from '../../src/net/transport';
import type { WebSocketLike } from '../../src/net/websocket-transport';
import {
  beginConnect,
  connectTicketed,
  connectDialing,
  connectJoined,
  connectRefused,
  connectTransportState,
  connectTraceModel,
  connectTitleLine,
  shortMachine,
} from '../../src/net/connect-trace';
import type { ConnectTrace } from '../../src/net/connect-trace';
import { linkNotice } from '../../src/net/link-loss';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (match) args.set(match[1]!, match[2]!);
}
/** How long the phone is away, ms. 35 s clears the 30 s ticket TTL and nothing else. */
const AWAY_MS = Number(args.get('away') ?? 35_000);
const LABEL = args.get('label') ?? `away-${Math.round(AWAY_MS / 1000)}s`;
/**
 * `--end-match=1` finishes the match on authority while the page is away — the one
 * refusal the a0-72 ruling leaves standing, and the one that has to say something
 * true instead of REFUSED.
 */
const END_MATCH = args.get('end-match') === '1';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A socket that can be **suspended**: from the page's point of view it simply
 * stops existing — no message, no `onclose`, no `onerror` — and the TCP connection
 * under it is destroyed a moment later, which is what the phone's radio does when
 * the screen goes off. The server sees an ordinary drop and substitutes a bot; the
 * client sees nothing at all, which is the half no killed-socket test reproduces.
 */
function suspendableSocket(url: string): WebSocketLike & { suspend(): void } {
  const inner = nodeWebSocket(url);
  let suspended = false;
  const outer: WebSocketLike & { suspend(): void } = {
    binaryType: 'arraybuffer',
    send: (data) => {
      if (!suspended) inner.send(data);
    },
    close: () => inner.close(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    suspend: () => {
      suspended = true;
      // The page is frozen first, and only then does the connection die — so not
      // one handler on this object is ever called again.
      setTimeout(() => inner.close(), 50);
    },
  };
  inner.onopen = (e): void => {
    if (!suspended) outer.onopen?.(e);
  };
  inner.onmessage = (e): void => {
    if (!suspended) outer.onmessage?.(e);
  };
  inner.onerror = (e): void => {
    if (!suspended) outer.onerror?.(e);
  };
  inner.onclose = (e): void => {
    if (!suspended) outer.onclose?.(e);
  };
  return outer;
}

async function until(what: string, ok: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

async function main(): Promise<void> {
  const fleet = await startLocalFleet(0xa072);
  const client = { baseUrl: fleet.allocatorBase };
  const out: Record<string, unknown> = {
    probe: 'a0-72 background-and-return',
    label: LABEL,
    awayMs: AWAY_MS,
    capturedAt: new Date().toISOString(),
  };

  // --- 1. Allocate, exactly as the ONLINE menu does -------------------------
  const resolved = await allocateRoom(client, { size: 2 });
  if (!resolved.ok) throw new Error(`allocate failed: ${resolved.reason}`);
  const connection: ResolvedConnection = resolved.connection;
  out['allocate'] = {
    room: connection.room,
    machine: connection.machine,
    expiresAt: connection.expiresAt,
    // The number in the developer's own log: how long this pass is good for.
    expiresInMs: connection.expiresAt - Date.now(),
  };

  let trace: ConnectTrace = beginConnect('create', Date.now(), fleet.allocatorBase);
  trace = connectTicketed(
    trace,
    {
      room: connection.room,
      machine: connection.machine,
      region: connection.region,
      expiresInMs: connection.expiresAt - Date.now(),
    },
    Date.now(),
  );
  trace = connectDialing(
    trace,
    { machine: connection.machine, host: connection.url, room: connection.room },
    Date.now(),
  );

  // --- 2. Join, seat a bot beside us, RUSH! ---------------------------------
  let live: (WebSocketLike & { suspend(): void }) | null = null;
  const session: OnlineSession = createOnlineSession({
    url: connection.url,
    room: connection.room,
    shipClass: ShipClass.Interceptor,
    transport: {
      ...allocatorTransport(connection, client),
      connect: (url): WebSocketLike => {
        const socket = suspendableSocket(url);
        live = socket;
        return socket;
      },
      retryBaseMs: 250,
      retryMaxMs: 1_000,
    },
  });

  const frames: { at: number; type: string; detail?: unknown }[] = [];
  const t0 = Date.now();
  let welcomes = 0;
  session.observe((message: ServerMessage) => {
    frames.push({ at: Date.now() - t0, type: message.type });
    if (message.type === 'welcome') {
      welcomes++;
      trace = connectJoined(trace, message.you, Date.now());
    }
    if (message.type === 'joinError') {
      frames[frames.length - 1]!.detail = { reason: message.reason };
      trace = connectRefused(trace, message.reason, Date.now());
    }
  });

  await until('the welcome', () => welcomes > 0);
  const seat = session.you;
  session.chooseInLobby({ shipClass: ShipClass.Interceptor, seats: ['open', 'bot'] });
  await sleep(200);
  session.startMatch();

  const machine = fleet.machineOf(connection.machine);
  if (!machine) throw new Error('the allocator named a machine that is not in the fleet');
  const room = machine.matches.room(connection.room);
  if (!room) throw new Error('the room never reached the machine the ticket named');
  await until('the match to start', () => room.world !== null && session.world !== null);

  // Plant a wallet and a tier on authority, so "did the ship come back?" has an
  // answer a fresh spawn could not fake (the same stamp reconnect-resume uses).
  const ship = room.world!.ships.find((s) => s.id === seat);
  if (!ship) throw new Error('no authoritative ship for our seat');
  ship.banked = 42;
  const track = Object.keys(ship.tiers)[0]!;
  (ship.tiers as Record<string, number>)[track] = 3;
  out['stamped'] = { seat, banked: ship.banked, track, tier: 3 };

  // --- 3. The screen goes black ---------------------------------------------
  session.linkHidden();
  (live as unknown as { suspend(): void }).suspend();
  const awayFrom = Date.now();
  out['suspendedAt'] = awayFrom - t0;

  await sleep(AWAY_MS);

  if (END_MATCH) {
    // The match finishes while they are away. Their seat was held for the whole of
    // it — what ended is the match, and the card must say so.
    room.world!.match.phase = 'ended';
    await until('the room to notice the match ended', () => room.state === 'ended', 5_000);
    out['endedWhileAway'] = true;
  }

  // --- 4. …and the player comes back ----------------------------------------
  const backAt = Date.now();
  out['returnedAfterMs'] = backAt - awayFrom;
  out['ticketAgeAtReturnMs'] = backAt - (connection.expiresAt - 30_000);
  out['ticketExpiredOnReturn'] = backAt >= connection.expiresAt;
  session.linkShown(backAt);

  // Poll the way a rendered frame does, and let the transport's own backoff run.
  const settleUntil = Date.now() + 12_000;
  let settled = false;
  while (Date.now() < settleUntil && !settled) {
    const status = session.pollLink(Date.now());
    trace = connectTransportState(trace, session.state, Date.now(), session.closeReason);
    settled = status.phase === 'live' || status.phase === 'expired';
    await sleep(100);
  }

  const status = session.pollLink(Date.now());
  const notice = linkNotice(status);
  const model = connectTraceModel(trace, Date.now());

  out['frames'] = frames;
  out['refusal'] = {
    closeReason: session.closeReason,
    rejectReason: session.rejectReason,
    transportState: session.state,
  };
  out['link'] = {
    phase: status.phase,
    cause: status.cause,
    ending: status.ending,
    attempts: status.attempts,
  };
  out['overlay'] = { title: notice.title, detail: notice.detail, failed: notice.failed };
  out['trace'] = {
    title: connectTitleLine(model),
    machine: shortMachine(connection.machine),
    lines: trace.steps.map((step) => `${step.stage.padEnd(10)} ${step.line}`),
  };
  const seatAfter = room.lobbyState()[seat];
  out['seat'] = {
    roomStillHosted: machine.matches.room(connection.room) !== undefined,
    matchPhase: room.state,
    botFlyingIt: seatAfter?.isBot ?? null,
    pendingReclaim: room.hasPendingReclaim,
  };
  out['wallet'] = {
    // The ship is authority's; if the reclaim landed, this is the same object.
    banked: ship.banked,
    tier: (ship.tiers as Record<string, number>)[track],
    // And what the CLIENT believes it is flying, which is the half a player sees.
    clientBanked: session.world?.ships.find((s) => s.id === session.you)?.banked ?? null,
    clientTier:
      (session.world?.ships.find((s) => s.id === session.you)?.tiers as
        | Record<string, number>
        | undefined)?.[track] ?? null,
    welcomes,
  };

  const file = join(HERE, `${LABEL}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\nwrote ${file}\n`);

  session.close();
  await fleet.stop();
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  },
);
