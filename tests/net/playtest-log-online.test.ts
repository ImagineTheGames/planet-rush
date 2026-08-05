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
import type { PlaytestLogEvent } from '../../src/net/playtest-log';
import { PlaytestLog, describeEnvironment } from '../../src/net/playtest-log';
import { attachSessionLog } from '../../src/net/playtest-log-attach';
import { downloadPlaytestLog } from '../../src/net/playtest-log-export';
import { netBudget } from './budgets';
import { nodeWebSocket, startMatchServer, until } from './node-websocket';

/**
 * A telemetry sample the log has finished writing — i.e. one that measured a
 * round trip.
 *
 * This predicate is the whole n4-01 fix. `kind === 'net'` says a sample *exists*;
 * it does not say the sample is complete. `NetTelemetry` keys its buckets on
 * `floor(now / 1000)` (src/net/telemetry.ts), so the FIRST finalized second is a
 * fragment of a wall-clock second — however much of it was left when the match
 * started — and a fragment can easily contain one reconcile whose `ackSeq` matched
 * no outstanding send, which finalizes as `rtt: null`. Reproduced on this hardware
 * at 1 run in 20; on CI's ~6× slower runners, often enough to redden `main`.
 *
 * `rtt` is the one field here that can be absent from a real sample, and it is the
 * one to wait on: `matchRtt` is only ever reached from `recordReconcile`, which has
 * already counted `reconciles++` on the same bucket, so a measured round trip
 * implies `recon > 0` rather than assuming it — which is why that assertion below
 * is still worth making instead of being folded into this wait.
 */
const isCompleteSample = (e: PlaytestLogEvent): boolean =>
  e.kind === 'net' && e.data !== undefined && e.data['rtt'] !== null;

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

    // The whole thing is exportable as the versioned payload the saved file carries.
    const written: string[] = [];
    const result = await downloadPlaytestLog({
      log,
      share: null,
      save: (_name, text) => void written.push(text),
    });
    expect(result.ok && result.route).toBe('download');
    const saved = JSON.parse(written[0]!) as { schema: string; version: number; summary: string };
    expect(saved.schema).toBe('planet-rush.playtest-log');
    expect(saved.version).toBe(1);
    expect(saved.summary).toContain('build e2e0001');
  }, netBudget({
    work: 'boot a ticket-enforcing Machine → dial it with no ticket → wait out the refusal and the terminal close → export the versioned payload',
    measuredSeconds: 0.1,
  }));

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

    // Fly, filing input every 16 ms as the loop does, so the telemetry instrument has
    // reconciles to measure and the log has samples to copy across.
    const flying = setInterval(() => session.sendInput([{ type: 'thrust', dir: { x: 1, y: 0 } }]), 16);

    // ── THE WAIT THIS TEST IS ABOUT (n4-01) ─────────────────────────────────────
    // It used to wait for `kind === 'net'` — a net event *existing* — and then assert
    // `rtt` on it, which is a field that event may not have filled in. Those are two
    // different conditions, and on a slow host the assertion lost the race to the
    // sample's own population. Waiting for the sample the assertions are about makes
    // the wait honest: what arrives here is a finalized second WITH a measured round
    // trip in it, so what follows is a claim about correctness rather than timing.
    //
    // The bound is a liveness bound, not the budget. Telemetry buckets are keyed on
    // the wall-clock second, so a complete one is at most ~2 s away (the fragment the
    // match started inside, then a whole second) however fast the host is; 8 s is
    // several times that, and the journey's own ceiling is declared at the bottom.
    await until(
      'a finalized telemetry second WITH a measured round trip in it',
      () => log.events.some(isCompleteSample),
      8_000,
      () =>
        `${log.events.filter((e) => e.kind === 'net').length} net sample(s), rtt = ` +
        log.events
          .filter((e) => e.kind === 'net')
          .map((e) => String(e.data?.['rtt']))
          .join(', '),
    );
    clearInterval(flying);
    clearInterval(poll);

    const sample = log.events.find(isCompleteSample)!;
    // A measured round trip over loopback is small but real, and the correction is the
    // wire's quantization rather than drift — the same numbers a pasted log shows.
    //
    // `recon > 0` is NOT restating the wait: the round trip is matched inside
    // `recordReconcile` (src/net/telemetry.ts), so a sample with an `rtt` is a sample
    // that counted at least one reconcile — an implication of the instrument's shape,
    // and worth failing on if that shape ever changes.
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
  }, netBudget({
    work: 'boot a server → seat and welcome a client → RUSH! → fly under 60 Hz input until a COMPLETE telemetry second lands → assert the sample and the lifecycle',
    measuredSeconds: 1.6,
  }));
});
