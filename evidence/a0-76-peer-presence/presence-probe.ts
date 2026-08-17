/**
 * evidence/a0-76-peer-presence/presence-probe.ts — *"we need something to
 * indicate that so other players know"*, captured from the other side of a real
 * drop. OWNER: UI Engineer (a0-76).
 *
 * a0-72's probe stands next to the player who dropped and asks whether the server
 * takes them back. **This one stands next to the player who stayed** and asks what
 * their screen says about it — which, before this branch, was nothing at all.
 *
 * Two real clients on one real room, over the production stack:
 *
 *   `tests/net/local-fleet.ts` — two ticket-enforcing Machines with the socket-hop
 *   pin armed, a Fly-shaped edge in front of them, and a real allocator process —
 *   plus the real `allocateRoom` / `joinRoom` → `allocatorTransport` →
 *   `WebSocketTransport` → `createOnlineSession` client path, wired exactly as
 *   `src/main.ts` wires it.
 *
 *   • **WATCHER** allocates the room, starts the match, and stays. Its session is
 *     fed to `applyPresenceMessage` — the SAME function `src/main.ts` hands every
 *     observed message to, so what this probe records is what the HUD draws, not a
 *     re-implementation of it.
 *   • **PHONE** joins the room and then backgrounds: a socket that stops calling
 *     the page back and then dies, which is what a suspended tab leaves behind
 *     (`transport.state` still reads `open`, no `onclose`, no frame). Real
 *     wall-clock seconds pass, because the windows under test are measured by the
 *     allocator and the server in real seconds.
 *
 *   npx vite-node evidence/a0-76-peer-presence/presence-probe.ts -- --label=drop-and-return
 *   npx vite-node evidence/a0-76-peer-presence/presence-probe.ts -- --abandon=1 --label=abandon
 *   npx vite-node evidence/a0-76-peer-presence/presence-probe.ts -- --end-match=1 --label=match-over
 *
 * Writes `<label>.json` beside this file: every presence frame the watcher's HUD
 * had at each moment, the seat state behind it, authority's own roster at the same
 * instant, and where the band lands on a phone, a desktop and an ultrawide.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass } from '@shared/types';
import { startLocalFleet } from '../../tests/net/local-fleet';
import { nodeWebSocket } from '../../tests/net/node-websocket';
import { allocateRoom, joinRoom } from '../../src/net/allocator-client';
import type { ResolvedConnection } from '../../src/net/allocator-client';
import { createOnlineSession, allocatorTransport } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import type { ServerMessage } from '../../src/net/transport';
import type { WebSocketLike } from '../../src/net/websocket-transport';
import { PeerPresenceLog, applyPresenceMessage } from '../../src/ui/peer-presence';
import { presenceBand, waveClockLayout, HUD_PAD } from '../../src/ui/hud-geometry';
import { contentBox } from '../../src/ui/viewport';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (match) args.set(match[1]!, match[2]!);
}
/** How long the phone is away, ms. 35 s clears a0-72's 30 s ticket TTL. */
const AWAY_MS = Number(args.get('away') ?? 35_000);
/** `--abandon=1` — the phone presses ABANDON MATCH instead of going dark. */
const ABANDON = args.get('abandon') === '1';
/** `--end-match=1` — the match ends while the phone is still away. */
const END_MATCH = args.get('end-match') === '1';
const LABEL = args.get('label') ?? (ABANDON ? 'abandon' : END_MATCH ? 'match-over' : 'drop-and-return');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

/**
 * A socket that can be **suspended** — a0-72's, verbatim, because it reproduces
 * the developer's actual report (a screen that went black) rather than a socket
 * somebody killed. From the page's side it simply stops existing; the server sees
 * an ordinary drop and substitutes a bot.
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

interface Frame {
  moment: string;
  /** Seconds on the watcher's own world clock — the clock the HUD reads. */
  at: number;
  /** The rows the HUD draws, top (newest) first, exactly as composed. */
  banner: string[];
  /** …with the parts the view tints separately. */
  rows: { seat: number; name: string; reason: string; clause: string; alpha: number }[];
  /** The standing state behind the rows, per seat the log knows about. */
  seats: { seat: number; state: string; bot: boolean }[];
  /** Authority's own roster at the same instant — the check that the HUD is not
   *  making anything up. */
  authority: { seat: number; isBot: boolean; heldForMatch: boolean; hasSocket: boolean }[];
}

async function main(): Promise<void> {
  const fleet = await startLocalFleet(0xa076);
  const client = { baseUrl: fleet.allocatorBase };
  const out: Record<string, unknown> = {
    probe: 'a0-76 peer presence, from the seat that stayed',
    label: LABEL,
    awayMs: ABANDON ? 0 : AWAY_MS,
    mode: ABANDON ? 'abandon' : END_MATCH ? 'match-over' : 'drop-and-return',
    capturedAt: new Date().toISOString(),
  };

  // --- 1. WATCHER allocates the room, exactly as the ONLINE menu does -------
  const allocated = await allocateRoom(client, { size: 2 });
  if (!allocated.ok) throw new Error(`allocate failed: ${allocated.reason}`);
  const hostConn: ResolvedConnection = allocated.connection;
  out['room'] = { code: hostConn.room, machine: hostConn.machine };

  const watcher: OnlineSession = createOnlineSession({
    url: hostConn.url,
    room: hostConn.room,
    shipClass: ShipClass.Vanguard,
    transport: {
      ...allocatorTransport(hostConn, client),
      connect: (url): WebSocketLike => nodeWebSocket(url),
      retryBaseMs: 250,
      retryMaxMs: 1_000,
    },
  });

  let watcherSeated = false;
  /** Every `welcome` the watcher gets. More than one means the WATCHER itself
   *  reconnected at some point, which would make its own seat's presence line a
   *  fact about this probe rather than about the phone — so it is counted and
   *  reported rather than assumed away. */
  let watcherWelcomes = 0;
  watcher.observe((m: ServerMessage) => {
    if (m.type === 'welcome') {
      watcherSeated = true;
      watcherWelcomes++;
    }
  });
  await until('the watcher to be seated', () => watcherSeated);
  const watcherSeat = watcher.you;

  // --- 2. PHONE joins the SAME room, through the allocator's join route -----
  const joined = await joinRoom(client, hostConn.room);
  if (!joined.ok) throw new Error(`join failed: ${joined.reason}`);
  const phoneConn: ResolvedConnection = joined.connection;

  let live: (WebSocketLike & { suspend(): void }) | null = null;
  const phone: OnlineSession = createOnlineSession({
    url: phoneConn.url,
    room: phoneConn.room,
    shipClass: ShipClass.Interceptor,
    transport: {
      ...allocatorTransport(phoneConn, client),
      connect: (url): WebSocketLike => {
        const socket = suspendableSocket(url);
        live = socket;
        return socket;
      },
      retryBaseMs: 250,
      retryMaxMs: 1_000,
    },
  });
  let phoneSeated = false;
  phone.observe((m: ServerMessage) => {
    if (m.type === 'welcome') phoneSeated = true;
  });
  await until('the phone to be seated', () => phoneSeated);
  const phoneSeat = phone.you;
  out['seats'] = { watcher: watcherSeat, phone: phoneSeat };

  // --- 3. THE WATCHER'S HUD, wired exactly as src/main.ts wires it ----------
  //
  // One log, fed by one function, from the session's own observer. Nothing here
  // reads the simulation: a client cannot know why another client went quiet.
  const presence = new PeerPresenceLog({ local: watcherSeat });
  const wire: { at: number; type: string; detail?: unknown }[] = [];
  const t0 = Date.now();
  const clock = (): number => watcher.world?.time ?? (Date.now() - t0) / 1000;
  watcher.observe((message: ServerMessage) => {
    const took = applyPresenceMessage(presence, message, clock());
    if (!took) return;
    const entry: { at: number; type: string; detail?: unknown } = {
      at: Math.round(Date.now() - t0),
      type: message.type,
    };
    if (message.type === 'playerSubstituted') {
      entry.detail = {
        player: message.player,
        graceSeconds: message.graceSeconds,
        heldForMatch: message.heldForMatch ?? false,
      };
    }
    if (message.type === 'playerReclaimed') entry.detail = { player: message.player };
    wire.push(entry);
  });

  // --- 4. RUSH! — two humans, no bots, so every bot below is a substitution --
  watcher.chooseInLobby({ shipClass: ShipClass.Vanguard, seats: ['open', 'open'] });
  await sleep(250);
  watcher.startMatch();

  const machine = fleet.machineOf(hostConn.machine);
  if (!machine) throw new Error('the allocator named a machine that is not in the fleet');
  const room = machine.matches.room(hostConn.room);
  if (!room) throw new Error('the room never reached the machine the ticket named');
  await until('the match to start', () => room.world !== null && watcher.world !== null);

  // The watcher is a player, not a spectator: a real client sends input every
  // rendered frame, and a socket that says nothing for twenty seconds is one the
  // server's keepalive is entitled to take down (`server/ws.ts` PING_INTERVAL_MS).
  // Without this loop the WATCHER dropped and reclaimed at ~35 s in every long
  // run — a fixture artifact that put its own seat in the capture. It flies.
  const flying = setInterval(() => {
    watcher.sendInput([{ type: 'thrust', dir: { x: 0.4, y: 0 } }]);
  }, 100);
  flying.unref?.();

  const frames: Frame[] = [];
  const capture = (moment: string): void => {
    const now = clock();
    const lines = presence.read(now);
    frames.push({
      moment,
      at: Number(now.toFixed(2)),
      banner: lines.map((l) => l.text),
      rows: lines.map((l) => ({
        seat: l.seat,
        name: l.name,
        reason: l.reason,
        clause: l.clause,
        alpha: Number(l.alpha.toFixed(2)),
      })),
      seats: presence.away().map((s) => ({ seat: s.seat, state: s.state, bot: s.bot })),
      authority: room.lobbyState().map((slot) => ({
        seat: slot.player,
        isBot: slot.isBot,
        heldForMatch: room.seatHeldForMatch(slot.player),
        hasSocket: room.graceRemaining(slot.player, Date.now()) === 0 && !slot.isBot,
      })),
    });
  };

  capture('match live — two humans flying, nothing to say');

  // --- 5. …and then the other player goes ----------------------------------
  if (ABANDON) {
    // ABANDON MATCH from the link-loss card: a stated leave, so the seat is freed
    // rather than held (`server/room.ts` `abandon`, `graceSeconds: 0`, no hold).
    phone.leave('abandoned');
  } else {
    // The screen goes black. No handler on the phone's socket is ever called again.
    phone.linkHidden();
    (live as unknown as { suspend(): void }).suspend();
  }

  await until(
    'authority to tell the watcher the seat changed hands',
    () => wire.some((w) => w.type === 'playerSubstituted'),
  );
  await sleep(120); // let the roster broadcast that rides with it land too
  capture(ABANDON ? 'they pressed ABANDON' : 'their screen went black');

  if (!ABANDON) {
    // The line is transient and the state is not: five seconds on, the banner is
    // clear and the seat is still theirs.
    await sleep(6_000);
    capture('six seconds later — the line has gone, the state has not');

    await sleep(Math.max(0, AWAY_MS - 6_000));

    if (END_MATCH) {
      room.world!.match.phase = 'ended';
      await until('the room to notice the match ended', () => room.state === 'ended', 8_000);
      await sleep(300);
      capture('the match ended while they were away');
    } else {
      // --- 6. …and the player comes back ------------------------------------
      capture('still away, still held — the moment before they return');
      phone.linkShown(Date.now());
      const settleUntil = Date.now() + 15_000;
      while (Date.now() < settleUntil && !wire.some((w) => w.type === 'playerReclaimed')) {
        phone.pollLink(Date.now());
        await sleep(100);
      }
      await sleep(150);
      capture('they are back');

      await sleep(6_000);
      capture('six seconds later — the seat is an ordinary seat again');
    }
  }

  out['wire'] = wire;
  out['frames'] = frames;
  out['watcherWelcomes'] = watcherWelcomes;

  // --- 7. WHERE IT LANDS, at three shapes ----------------------------------
  //
  // The banner hangs off the wave clock's own drawn footprint, so the placement
  // is captured at the clock's real measured widths on a phone, a desktop and an
  // ultrawide — the two ends the DoD names, and the reference in between.
  const clockLines = [
    { width: 168, height: 18 },
    { width: 96, height: 17 },
    { width: 91, height: 16 },
  ];
  const rows = [
    { width: 196, height: 14 },
    { width: 150, height: 14 },
  ];
  out['placement'] = [
    { name: 'phone (landscape)', width: 844, height: 390 },
    { name: 'phone (portrait)', width: 390, height: 844 },
    { name: 'desktop 16:9', width: 1280, height: 720 },
    { name: 'ultrawide 32:9', width: 3840, height: 1080 },
  ].map((vp) => {
    const box = contentBox({ width: vp.width, height: vp.height });
    const clockAt = waveClockLayout(box.width, box.height, clockLines, false);
    const open = waveClockLayout(box.width, box.height, clockLines, true);
    const band = presenceBand(box.width, box.height, clockAt, rows, false);
    const withWheel = presenceBand(box.width, box.height, open, rows, true);
    return {
      viewport: `${vp.width}x${vp.height} — ${vp.name}`,
      contentBox: { x: box.x, width: box.width },
      clockBottom: Number((clockAt.bounds.y + clockAt.bounds.height).toFixed(1)),
      bandTop: Number(band.y.toFixed(1)),
      bandCentreOnScreen: Number((box.x + band.x).toFixed(1)),
      rowsShownWheelClosed: band.shown,
      rowsShownWheelOpen: withWheel.shown,
      insideMargin:
        band.bounds.x >= HUD_PAD && band.bounds.x + band.bounds.width <= box.width - HUD_PAD,
    };
  });

  const file = join(HERE, `${LABEL}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\nwrote ${file}\n`);

  clearInterval(flying);
  watcher.close();
  phone.close();
  await fleet.stop();
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  },
);
