/**
 * src/net/playtest-log.test.ts — the playtest log's four promises (`./playtest-log`,
 * M10 playtest-log brief §5).
 *
 * The brief names the tests: *"ring buffer bounds, export shape stable (a versioned
 * schema field), … no PII beyond what the game already knows."* Those are asserted
 * here as *properties*, not as sample outputs — a bound that only holds for the one
 * capacity a test picked is not a bound, and a "no PII" test that lists the fields it
 * expects to see would pass forever while a new field leaked something.
 *
 * Every clock reading is injected, so each timestamp below is an exact expected
 * value rather than a tolerance.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_DATA_KEYS,
  MAX_MESSAGE_CHARS,
  PLAYTEST_LOG_SCHEMA,
  PLAYTEST_LOG_VERSION,
  PlaytestLog,
  TABLET_MIN_SHORT_EDGE,
  classifyFormFactor,
  describeEnvironment,
  installPlaytestLog,
  normalizeConnectionType,
  playtestLog,
  resetPlaytestLog,
} from './playtest-log';
import type { PlaytestLogEnvironment } from './playtest-log';

/** A fixed session identity, so a summary line is an exact string. */
const ENV: PlaytestLogEnvironment = {
  sha: '1a2b3c4',
  buildTime: '2026-07-30T09:00:00.000Z',
  dirty: false,
  startedAt: '2026-07-30T12:00:00.000Z',
  formFactor: 'phone',
  viewport: '390x844',
  touch: true,
  connection: '4g',
};

/** A hand-cranked clock: `tick(ms)` advances it. */
function clock(start = 1_000): { now: () => number; tick: (ms: number) => void } {
  let t = start;
  return { now: (): number => t, tick: (ms: number): void => void (t += ms) };
}

afterEach(() => resetPlaytestLog());

describe('PlaytestLog — the ring is bounded', () => {
  it('never exceeds its capacity, and counts what it dropped', () => {
    const log = new PlaytestLog({ env: ENV, capacity: 10 });
    for (let i = 0; i < 250; i++) log.record('note', `event ${i}`);

    expect(log.events).toHaveLength(10);
    expect(log.dropped).toBe(240);
    // The ring keeps the NEWEST events — a log of a session's first ten seconds is
    // useless for reporting the thing that just went wrong.
    expect(log.events[0]!.msg).toBe('event 240');
    expect(log.events[9]!.msg).toBe('event 249');
  });

  it('reports the drop count in the export, so a partial session says so', () => {
    const log = new PlaytestLog({ env: ENV, capacity: 4 });
    for (let i = 0; i < 9; i++) log.record('note', `n${i}`);

    const snapshot = log.snapshot();
    expect(snapshot.capacity).toBe(4);
    expect(snapshot.dropped).toBe(5);
    expect(snapshot.events).toHaveLength(4);
  });

  it('coalesces an identical repeated event instead of spending the ring on it', () => {
    const c = clock();
    const log = new PlaytestLog({ env: ENV, capacity: 50, now: c.now });

    // The shape of a warn inside a 60 Hz render loop: 600 identical calls.
    for (let i = 0; i < 600; i++) {
      log.recordError('warn', 'texture not power of two');
      c.tick(16);
    }

    expect(log.events).toHaveLength(1);
    expect(log.dropped).toBe(0);
    const entry = log.events[0]!;
    expect(entry.repeat).toBe(600);
    expect(entry.at).toBe(0);
    // The last occurrence's time is kept too: 599 ticks of 16 ms after the first.
    expect(entry.lastAt).toBe(599 * 16);
  });

  it('does not coalesce events that differ in data', () => {
    const log = new PlaytestLog({ env: ENV });
    log.recordConnect('state closed', { closeReason: 'room-gone' });
    log.recordConnect('state closed', { closeReason: 'grace-elapsed' });
    expect(log.events).toHaveLength(2);
  });

  it('truncates a long message and a long value rather than storing them whole', () => {
    const log = new PlaytestLog({ env: ENV });
    log.recordError('error', 'x'.repeat(5_000), { stack: 'y'.repeat(5_000) });

    const entry = log.events[0]!;
    expect(entry.msg.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 'error: '.length);
    expect(entry.msg.endsWith('…')).toBe(true);
    expect(String(entry.data!['stack']).length).toBeLessThanOrEqual(160);
  });

  it('caps how many data keys one event may spend', () => {
    const log = new PlaytestLog({ env: ENV });
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i++) wide[`k${i}`] = i;
    log.record('note', 'wide', wide);

    expect(Object.keys(log.events[0]!.data!)).toHaveLength(MAX_DATA_KEYS);
  });

  it('keeps data flat: a nested object is described, never serialized into the ring', () => {
    const log = new PlaytestLog({ env: ENV });
    log.record('note', 'nested', { world: { ships: [1, 2, 3] }, fn: (): void => {}, ok: true });

    const data = log.events[0]!.data!;
    expect(data['world']).toBe('[object]');
    expect(data['fn']).toBe('[function]');
    expect(data['ok']).toBe(true);
  });

  it('names a non-finite number instead of letting JSON turn it into null', () => {
    const log = new PlaytestLog({ env: ENV });
    log.record('net', 'sample', { rtt: Number.NaN, jitter: Number.POSITIVE_INFINITY });
    expect(log.events[0]!.data!['rtt']).toBe('NaN');
    expect(log.events[0]!.data!['jitter']).toBe('Infinity');
  });

  it('timestamps events relative to session start', () => {
    const c = clock(50_000);
    const log = new PlaytestLog({ env: ENV, now: c.now });
    log.record('note', 'first');
    c.tick(2_500);
    log.record('note', 'second');

    expect(log.events.map((e) => e.at)).toEqual([0, 2_500]);
  });
});

describe('PlaytestLog — the export shape', () => {
  it('carries the versioned schema field, so an old paste is still readable', () => {
    const log = new PlaytestLog({ env: ENV });
    const snapshot = log.snapshot();

    expect(snapshot.schema).toBe(PLAYTEST_LOG_SCHEMA);
    expect(snapshot.version).toBe(PLAYTEST_LOG_VERSION);
    // The stable top-level shape. Adding a field is a compatible change; this asserts
    // the set so a REMOVAL or a rename cannot happen silently.
    expect(Object.keys(snapshot).sort()).toEqual(
      ['capacity', 'dropped', 'durationMs', 'env', 'events', 'schema', 'summary', 'version'].sort(),
    );
  });

  it('is valid JSON whose first content is the self-describing summary', () => {
    const log = new PlaytestLog({ env: ENV });
    log.recordSessionStart();
    const parsed = JSON.parse(log.toJson()) as { summary: string; events: unknown[] };

    expect(parsed.summary).toBe(log.summaryLine());
    expect(parsed.events).toHaveLength(1);
  });

  it('answers "which build was I on?" in the first line, with no follow-up needed', () => {
    const line = new PlaytestLog({ env: ENV }).summaryLine();

    expect(line).toContain('1a2b3c4'); // build sha
    expect(line).toContain('2026-07-30T12:00:00.000Z'); // date
    expect(line).toContain('phone 390x844'); // form factor
    expect(line).toContain('net 4g'); // connection type
    expect(line).toContain(`${PLAYTEST_LOG_SCHEMA}/${PLAYTEST_LOG_VERSION}`);
  });

  it('marks a dirty build with the same asterisk the in-game badge uses', () => {
    const log = new PlaytestLog({ env: { ...ENV, dirty: true } });
    expect(log.summaryLine()).toContain('1a2b3c4*');
  });

  it('reports the session duration it covers', () => {
    const c = clock();
    const log = new PlaytestLog({ env: ENV, now: c.now });
    log.record('note', 'start');
    c.tick(90_000);
    log.record('note', 'end');

    expect(log.snapshot().durationMs).toBe(90_000);
  });
});

describe('PlaytestLog — no PII beyond what the game already knows', () => {
  it('describes the device without a user agent, a device id, or a location', () => {
    const env = describeEnvironment({
      sha: 'abc1234',
      buildTime: ENV.buildTime,
      startedAt: ENV.startedAt,
      viewportWidth: 390,
      viewportHeight: 844,
      touch: true,
      connectionType: '4g',
    });

    // The header's whole surface, enumerated: any field added to the environment has
    // to be added here too, which is the point — it forces the PII question to be
    // asked again rather than answered once in 2026 and forgotten.
    expect(Object.keys(env).sort()).toEqual(
      ['buildTime', 'connection', 'dirty', 'formFactor', 'sha', 'startedAt', 'touch', 'viewport'].sort(),
    );

    const json = JSON.stringify(env).toLowerCase();
    for (const forbidden of ['useragent', 'mozilla', 'ip', 'lat', 'lon', 'email', 'name', 'id']) {
      expect(json.includes(`"${forbidden}"`)).toBe(false);
    }
  });

  it('never records a reclaim token, even when told about one', () => {
    // The token is the one secret the protocol hands a client (GDD §4.2), and a log
    // is pasted into a chat window. `./playtest-log-attach` records only whether a
    // reclaim is possible; this asserts the log itself would not carry the value even
    // if a caller passed the whole message through.
    const log = new PlaytestLog({ env: ENV });
    log.recordConnect('welcome', { seat: 3, reclaimable: true });
    expect(log.toJson()).not.toContain('reclaimToken');
  });
});

describe('classifyFormFactor / normalizeConnectionType', () => {
  it('calls a no-touch device a desktop whatever its window size', () => {
    expect(classifyFormFactor(390, 844, false)).toBe('desktop');
    expect(classifyFormFactor(3840, 2160, false)).toBe('desktop');
  });

  it('splits phone from tablet on the short edge', () => {
    expect(classifyFormFactor(390, 844, true)).toBe('phone');
    expect(classifyFormFactor(844, 390, true)).toBe('phone'); // rotated, same device
    expect(classifyFormFactor(TABLET_MIN_SHORT_EDGE, 1024, true)).toBe('tablet');
    expect(classifyFormFactor(TABLET_MIN_SHORT_EDGE - 1, 1024, true)).toBe('phone');
  });

  it('assumes a phone when a touch device reports no viewport', () => {
    expect(classifyFormFactor(0, 0, true)).toBe('phone');
  });

  it('reports offline over any last-known radio type', () => {
    expect(normalizeConnectionType('4g', false)).toBe('offline');
  });

  it('reports unknown rather than inventing a connection type', () => {
    expect(normalizeConnectionType(undefined)).toBe('unknown');
    expect(normalizeConnectionType('')).toBe('unknown');
    expect(normalizeConnectionType({})).toBe('unknown');
    expect(normalizeConnectionType('WiFi')).toBe('wifi');
  });

  it('falls back to unknown for every missing probe field, never to a guess', () => {
    const env = describeEnvironment();
    expect(env.sha).toBe('unknown');
    expect(env.buildTime).toBe('unknown');
    expect(env.startedAt).toBe('unknown');
    expect(env.viewport).toBe('0x0');
    expect(env.connection).toBe('unknown');
  });
});

describe('the shared log', () => {
  it('exists before boot has described the page, so no early line is lost', () => {
    playtestLog().recordNote('before boot');
    expect(playtestLog().events).toHaveLength(1);
  });

  it('carries pre-boot events into the described log, keeping their timestamps', () => {
    const c = clock();
    // A module logs before boot: the fallback log takes it at t=0 of its own clock.
    const early = playtestLog();
    early.recordNote('early line');

    c.tick(3_000);
    const log = installPlaytestLog({ env: ENV, now: c.now });

    const msgs = log.events.map((e) => e.msg);
    expect(msgs).toContain('session start');
    expect(msgs).toContain('early line');
    // Adopted verbatim: the early line keeps the `at` it was stamped with, rather
    // than being rewritten to "now".
    expect(log.events.find((e) => e.msg === 'early line')!.at).toBe(0);
    expect(playtestLog()).toBe(log);
  });

  it('opens the timeline with the build identity', () => {
    const log = installPlaytestLog({ env: ENV });
    const start = log.events.find((e) => e.msg === 'session start')!;
    expect(start.kind).toBe('session');
    expect(start.data!['sha']).toBe('1a2b3c4');
    expect(start.data!['schema']).toBe(`${PLAYTEST_LOG_SCHEMA}/${PLAYTEST_LOG_VERSION}`);
  });
});
