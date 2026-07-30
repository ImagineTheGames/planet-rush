/**
 * tests/net/playtest-log-online.test.ts — the playtest log against a REAL socket
 * (M10 playtest-log brief §1, §5). OWNER: Netcode Engineer.
 *
 * The unit tests prove the log's shape and that a fake session populates it. That is
 * not the claim the brief makes. The claim is that when the developer's phone cannot
 * get into a match, the log they paste back carries *the server's own reason* — and
 * that is a property of the whole stack: a real `MatchServer` refusing a real join
 * over a real WebSocket, a real `WebSocketTransport` treating the refusal as terminal,
 * and the log attachment recording both the reason and the close.
 *
 * So nothing here is mocked that ships. Two runs, the two halves of a report:
 *
 *  1. **The refusal.** A ticket-enforcing Machine (a fleet member) and a client that
 *     dials with no ticket — the exact shape of the M10 bug where a lost edge lottery
 *     left the front door stuck on "connecting". The log must name it.
 *  2. **The healthy match.** Welcome, matchStart and per-second net telemetry land in
 *     the log while a real 60 Hz sim runs behind a real socket, and the export stays
 *     inside its bounds and its versioned schema.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createOnlineSession } from '../../src/net/session';
import type { OnlineSession } from '../../src/net/session';
import { PlaytestLog, describeEnvironment } from '../../src/net/playtest-log';
import { attachSessionLog } from '../../src/net/playtest-log-attach';
import { exportPlaytestLog } from '../../src/net/playtest-log-export';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A log with a fixed identity, so an assertion reads the session rather than the
 *  checkout's git sha. */
function newLog(): PlaytestLog {
  const log = new PlaytestLog({
    env: describeEnvironment({
      sha: 'e2e0001',
      buildTime: '2026-07-30T09:00:00.000Z',
      startedAt: '2026-07-30T12:00:00.000Z',
      viewportWidth: 390,
      viewportHeight: 844,
      touch: true,
      connectionType: '4g',
    }),
  });
  log.recordSessionStart();
  return log;
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('the playtest log over a real socket', () => {
  it('records a REAL refused join — the server’s own reason, and the terminal close', async () => {
    // A Machine that enforces tickets: it is a fleet member, so a join it was never
    // sent is refused (`server/match-server.ts`).
    const harness = await startMatchServer({
      seed: 404,
      slots: 2,
      ticketSecret: 'machine-and-allocator-share-this',
      machineId: 'm-e2e',
    });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const log = newLog();
    // No ticket: the shape of the M10 bug — a client that reached the wrong Machine,
    // or reached the right one without the allocator's signature.
    const session = createOnlineSession({
      url: harness.url,
      room: 'RUSH',
      shipClass: ShipClass.Interceptor,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(session);
    const attached = attachSessionLog({ log, session });

    // Poll like the client does (`src/main.ts` startSessionLog) while the refusal
    // travels back over the wire.
    await until(
      'the log to carry the server’s refusal',
      () => {
        attached.poll();
        return log.events.some((e) => e.msg === 'joinError');
      },
      5_000,
    );
    attached.poll();

    const refusal = log.events.find((e) => e.msg === 'joinError')!;
    // The server's own reason, verbatim — this is the line the Director's probes
    // cannot see and the player's report cannot supply.
    expect(refusal.data!['reason']).toBe('bad-ticket');

    // And the transport treated it as terminal rather than redialling for sixty
    // seconds, which the log says in its own words.
    await until(
      'the transport to report the terminal close',
      () => {
        attached.poll();
        return log.events.some((e) => e.msg === 'state closed');
      },
      5_000,
    );
    const closed = log.events.find((e) => e.msg === 'state closed')!;
    expect(closed.data!['closeReason']).toBe('join-rejected');
    expect(closed.data!['rejectReason']).toBe('bad-ticket');

    // The whole thing is exportable as the versioned payload a paste carries.
    const written: string[] = [];
    const result = await exportPlaytestLog({
      log,
      clipboard: { writeText: async (text) => void written.push(text) },
      save: null,
    });
    expect(result.ok && result.route).toBe('clipboard');
    const pasted = JSON.parse(written[0]!) as { schema: string; version: number; summary: string };
    expect(pasted.schema).toBe('planet-rush.playtest-log');
    expect(pasted.version).toBe(1);
    expect(pasted.summary).toContain('build e2e0001');
  }, 30_000);

  it('records a healthy match: welcome, RUSH!, and per-second net telemetry', async () => {
    const harness = await startMatchServer({ seed: 77, slots: 2, asteroidCount: 10 });
    const sessions: OnlineSession[] = [];
    cleanup = async (): Promise<void> => {
      for (const session of sessions) session.close();
      await harness.stop();
    };

    const log = newLog();
    const session = createOnlineSession({
      url: harness.url,
      room: 'LOGS',
      shipClass: ShipClass.Vanguard,
      transport: { connect: nodeWebSocket },
    });
    sessions.push(session);
    const attached = attachSessionLog({ log, session });
    const poll = setInterval(() => attached.poll(), 50);

    await until('the seat to be welcomed', () => log.events.some((e) => e.msg === 'welcome'), 5_000);
    session.startMatch();
    await until('the match to start', () => log.events.some((e) => e.msg === 'matchStart'), 5_000);

    // Fly for over a second of wall clock, filing input every 16 ms as the loop does,
    // so the telemetry instrument finalizes at least one one-second sample and the log
    // copies it across.
    const flying = setInterval(() => session.sendInput([{ type: 'thrust', dir: { x: 1, y: 0 } }]), 16);
    await until(
      'a finalized telemetry second to reach the log',
      () => log.events.some((e) => e.kind === 'net'),
      8_000,
    );
    clearInterval(flying);
    clearInterval(poll);
    await sleep(20);

    const sample = log.events.find((e) => e.kind === 'net')!;
    // A measured round trip over loopback is small but real, and the correction is the
    // wire's quantization rather than drift — the same numbers the netgraph shows.
    expect(sample.data!['recon']).toBeGreaterThan(0);
    expect(sample.data!['rtt']).not.toBeNull();
    expect(Number(sample.data!['corrMax'])).toBeLessThan(5);

    // The lifecycle reads as a lifecycle: connecting → open → welcome → RUSH!.
    const order = log.events.map((e) => e.msg);
    expect(order.indexOf('state open')).toBeGreaterThan(-1);
    expect(order.indexOf('welcome')).toBeLessThan(order.indexOf('matchStart'));

    // And a session's worth of events is still nowhere near the ring's budget, so a
    // real match does not silently truncate its own beginning.
    expect(log.dropped).toBe(0);
    expect(log.events.length).toBeLessThan(log.capacity);
  }, 30_000);
});
