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
  MAX_RESTORE_AGE_MS,
  PLAYTEST_LOG_SCHEMA,
  PLAYTEST_LOG_VERSION,
  PLAYTEST_LOG_WRITE_INTERVAL_MS,
  PlaytestLog,
  TABLET_MIN_SHORT_EDGE,
  classifyFormFactor,
  describeEnvironment,
  installPlaytestLog,
  normalizeConnectionType,
  parsePersistedLog,
  playtestLog,
  resetPlaytestLog,
} from './playtest-log';
import type { PlaytestLogEnvironment, PlaytestLogStore } from './playtest-log';
import { memoryPlaytestLogStore, playtestLogStore } from './playtest-log-store';

/** A fixed session identity, so a summary line is an exact string. */
const ENV: PlaytestLogEnvironment = {
  build: '1a2b3c4',
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
    // the set so a REMOVAL or a rename cannot happen silently. `coverage`, `span` and
    // `restored` joined it in a0-56 — the three fields that separate "this session
    // did nothing" from "this file was opened after the match it was meant to hold".
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'capacity',
        'coverage',
        'dropped',
        'durationMs',
        'env',
        'events',
        'restored',
        'schema',
        'span',
        'summary',
        'version',
      ].sort(),
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
    const env = describeEnvironment({ sha: '1a2b3c4', dirty: true });
    expect(env.build).toBe('1a2b3c4*');
    expect(new PlaytestLog({ env }).summaryLine()).toContain('1a2b3c4*');
  });

  it('leads with the BADGE string, so a paste and a screenshot agree (M10 §3)', () => {
    const log = new PlaytestLog({ env: { ...ENV, build: '1a2b3c4 · d891dd0a (gru)' } });
    // Not just the sha: the Machine and the region the session was on, in the very
    // first line — the question every "it wouldn't connect" report has hinged on.
    expect(log.summaryLine()).toContain('build 1a2b3c4 · d891dd0a (gru)');
  });

  describe('setBuild — the tag follows the badge for the whole session', () => {
    it('rewrites env.build and lands the change on the timeline', () => {
      const log = new PlaytestLog({ env: ENV });
      log.record('note', 'before');
      log.setBuild('1a2b3c4 · d891dd0a (gru)');

      // ONE answer at the top of the paste, covering every event in it…
      expect(log.env.build).toBe('1a2b3c4 · d891dd0a (gru)');
      expect(log.snapshot().env.build).toBe('1a2b3c4 · d891dd0a (gru)');
      // …and the moment it changed, on the timeline, where a reconnect onto a
      // different Machine reads as the event it is.
      const change = log.events.find((e) => e.msg === 'build tag');
      expect(change?.kind).toBe('session');
      expect(change?.data!['build']).toBe('1a2b3c4 · d891dd0a (gru)');
    });

    it('is a no-op for the same tag or an empty one', () => {
      const log = new PlaytestLog({ env: ENV });
      log.setBuild('1a2b3c4'); // unchanged
      log.setBuild(''); // nothing to say
      expect(log.env.build).toBe('1a2b3c4');
      expect(log.events).toHaveLength(0);
    });

    it('collapses back to build-only when the tag does (a disconnect)', () => {
      const log = new PlaytestLog({ env: ENV });
      log.setBuild('1a2b3c4 · d891dd0a (gru)');
      log.setBuild('1a2b3c4');
      expect(log.env.build).toBe('1a2b3c4');
      expect(log.events.filter((e) => e.msg === 'build tag')).toHaveLength(2);
    });
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
    // (`build` joined the header at M10: the badge string, which is our own build
    // sha plus the SERVER's machine id and region — nothing about the player.)
    expect(Object.keys(env).sort()).toEqual(
      ['build', 'buildTime', 'connection', 'dirty', 'formFactor', 'sha', 'startedAt', 'touch', 'viewport'].sort(),
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
    expect(env.build).toBe('unknown'); // reconstructed from the sha, which is also unknown
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
    expect(start.data!['build']).toBe('1a2b3c4');
    expect(start.data!['schema']).toBe(`${PLAYTEST_LOG_SCHEMA}/${PLAYTEST_LOG_VERSION}`);
  });
});

// ---------------------------------------------------------------------------
// a0-56 — the log has to survive the reload that BACK TO MENU performs
// ---------------------------------------------------------------------------

describe('PlaytestLog — persistence across a page reload (a0-56)', () => {
  /**
   * THE TEST THIS BRIEF EXISTS FOR.
   *
   * The developer exported a log to explain a bug they hit in a match and the file
   * said the session never left the main menu — *"because it said i never left the
   * main menu but i was in the pause menu in the middle of a match"*. It said that
   * because returning to the menu reloads the page, the log was a module-level
   * singleton, and the singleton died with the page: what got exported was the boot
   * sequence of the page that came AFTER the match.
   *
   * A reload, reproduced exactly: `resetPlaytestLog()` drops the singleton the way
   * the page going away does, the store survives it the way `sessionStorage` does,
   * and the next boot has nothing but that store to rebuild from.
   */
  it('survives a reload', () => {
    const store = memoryPlaytestLogStore();
    const c = clock(500_000);

    // --- Page load 1: a session that got into a match. ---------------------
    const first = installPlaytestLog({ env: ENV, now: c.now, store });
    c.tick(4_000);
    first.recordNote('front door idle');
    c.tick(20_000);
    first.recordMatch('matchStart', { tick: 0 });
    c.tick(90_000);
    first.recordMatch('death', { tick: 5_400 });
    first.flush();

    const before = first.events.map((e) => ({ at: e.at, msg: e.msg }));
    expect(before.map((e) => e.msg)).toEqual(['session start', 'front door idle', 'matchStart', 'death']);
    expect(before.map((e) => e.at)).toEqual([0, 4_000, 24_000, 114_000]);

    // --- BACK TO MENU: `window.location.reload()`. -------------------------
    // The singleton dies with the page; the store does not.
    c.tick(1_200);
    resetPlaytestLog();

    // --- Page load 2: boot again, same tab. --------------------------------
    const second = installPlaytestLog({ env: ENV, now: c.now, store });
    c.tick(3_000);
    second.recordNote('back on the menu');

    const msgs = second.events.map((e) => e.msg);
    // 1. The match is still in the log. This is the whole brief.
    expect(msgs).toContain('matchStart');
    expect(msgs).toContain('death');
    expect(second.restored).toBe(4);
    expect(second.coverage).toBe('match');

    // 2. Verbatim: every carried event keeps the instant it happened at, so the
    //    restored timeline is not rewritten to "now".
    for (const { at, msg } of before) {
      expect(second.events.find((e) => e.msg === msg)!.at).toBe(at);
    }

    // 3. And this session's events FOLLOW them — later on the same axis, and later
    //    in the array, because a reload is a seam in a session and not a new one.
    const carried = second.events.slice(0, before.length).map((e) => e.msg);
    expect(carried).toEqual(before.map((e) => e.msg));
    const restoreNote = second.events[before.length]!;
    expect(restoreNote.msg).toBe('restored after reload');
    expect(restoreNote.at).toBe(115_200);
    expect(restoreNote.data!['events']).toBe(4);
    const fresh = second.events.slice(before.length);
    expect(fresh.map((e) => e.msg)).toEqual(['restored after reload', 'session start', 'back on the menu']);
    for (const event of fresh) expect(event.at).toBeGreaterThan(114_000);
    expect(second.events.find((e) => e.msg === 'back on the menu')!.at).toBe(118_200);

    // 4. The header still anchors `at: 0` — it names the session's start, not the
    //    reload's, or every restored timestamp above would be measured from nothing.
    expect(second.env.startedAt).toBe(ENV.startedAt);
  });

  it('respects the ring across the reload, and counts what it dropped', () => {
    const store = memoryPlaytestLogStore();
    const c = clock();
    const first = new PlaytestLog({ env: ENV, capacity: 10, now: c.now, store });
    for (let i = 0; i < 25; i++) {
      c.tick(10);
      first.record('note', `n${i}`);
    }
    first.flush();
    expect(first.dropped).toBe(15);

    // The restore is bounded by the SAME ring: a long session degrades honestly
    // rather than restoring a heap it then has to evict silently.
    const second = new PlaytestLog({ env: ENV, capacity: 4, now: c.now, store });
    expect(second.events).toHaveLength(4);
    // Four of the ten came back into a ring of four; the restore note then evicted
    // the oldest of them, like any other recorded event would.
    expect(second.restored).toBe(4);
    expect(second.events.filter((e) => e.msg.startsWith('n'))).toHaveLength(3);
    // 15 already dropped, plus the 6 the smaller ring could not take, plus the one
    // the restore note itself pushed out.
    expect(second.dropped).toBe(15 + 6 + 1);
    expect(second.snapshot().dropped).toBe(second.dropped);
  });

  it('leaves a reloaded log able to say it never saw a match', () => {
    const store = memoryPlaytestLogStore();
    const c = clock();
    const first = new PlaytestLog({ env: ENV, now: c.now, store });
    first.recordNote('front door idle');
    first.flush();

    const second = new PlaytestLog({ env: ENV, now: c.now, store });
    expect(second.restored).toBe(1);
    expect(second.coverage).toBe('boot-only');
  });

  it('remembers a match that the ring has since evicted', () => {
    // Coverage is a fact about what was RECORDED, not about what is still held: a
    // long session must not lose the answer to "was there a match?" to its own
    // budget, or the a0-56 failure returns for sessions that are too long instead
    // of too short.
    const log = new PlaytestLog({ env: ENV, capacity: 3 });
    log.recordMatch('matchStart');
    for (let i = 0; i < 10; i++) log.record('note', `n${i}`);

    expect(log.events.some((e) => e.kind === 'match')).toBe(false);
    expect(log.coverage).toBe('match');
  });

  it('writes at most once per interval, and flush buys back the tail', () => {
    // The log is fed from inside a 60 Hz frame; a synchronous storage write per
    // event is a frame-budget cost this team is measured on.
    const writes: string[] = [];
    const store: PlaytestLogStore = {
      read: () => null,
      write: (text) => {
        writes.push(text);
        return true;
      },
    };
    const c = clock();
    const log = new PlaytestLog({ env: ENV, now: c.now, store });

    log.record('note', 'first'); // immediate — nothing has been written yet
    expect(writes).toHaveLength(1);
    for (let i = 0; i < 50; i++) log.record('note', `burst ${i}`);
    expect(writes).toHaveLength(1); // …and the burst rides inside the interval

    c.tick(PLAYTEST_LOG_WRITE_INTERVAL_MS);
    log.record('note', 'after the interval');
    expect(writes).toHaveLength(2);

    // The tail: recorded inside the interval, so unwritten — until the page is
    // about to go away and `flush()` spends the write.
    log.record('note', 'the last thing before the reload');
    expect(writes).toHaveLength(2);
    log.flush();
    expect(writes).toHaveLength(3);
    expect(writes[2]).toContain('the last thing before the reload');
    log.flush(); // nothing new to say
    expect(writes).toHaveLength(3);
  });

  it('degrades to memory-only when storage refuses, and says so on the timeline', () => {
    // Private mode and a full quota both throw out of `setItem`. A log that crashes
    // the client is worse than a log that forgets.
    let attempts = 0;
    const storage = {
      getItem: (): string | null => null,
      setItem: (): void => {
        attempts++;
        throw new Error('QuotaExceededError');
      },
      removeItem: (): void => {},
    };
    const log = new PlaytestLog({ env: ENV, store: playtestLogStore(storage) });

    expect(() => log.record('note', 'a line')).not.toThrow();
    expect(log.events.map((e) => e.msg)).toEqual(['a line', 'log persistence unavailable']);
    // Storage that failed once fails every time: it is not retried per event, and
    // the failure note does not recurse into another attempt.
    for (let i = 0; i < 20; i++) log.record('note', `n${i}`);
    expect(attempts).toBe(1);
    expect(log.events.filter((e) => e.msg === 'log persistence unavailable')).toHaveLength(1);
  });

  it('never throws out of a store that breaks its own contract', () => {
    const hostile: PlaytestLogStore = {
      read: (): string | null => {
        throw new Error('SecurityError');
      },
      write: (): boolean => {
        throw new Error('SecurityError');
      },
    };
    const log = new PlaytestLog({ env: ENV, store: hostile });
    expect(() => log.record('note', 'a line')).not.toThrow();
    expect(() => log.flush()).not.toThrow();
    expect(log.events[0]!.msg).toBe('a line');
  });

  it('is memory-only by default, exactly as it was before a0-56', () => {
    const log = new PlaytestLog({ env: ENV });
    log.record('note', 'a line');
    expect(log.restored).toBe(0);
    expect(() => log.flush()).not.toThrow();
  });
});

describe('parsePersistedLog — a stored log is untrusted input', () => {
  const NOW = 10_000;
  function stored(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      schema: PLAYTEST_LOG_SCHEMA,
      version: PLAYTEST_LOG_VERSION,
      startedAt: ENV.startedAt,
      startMs: 1_000,
      savedAt: 9_000,
      dropped: 2,
      events: [{ at: 5, kind: 'match', msg: 'matchStart' }],
      ...overrides,
    });
  }

  it('reads back what it wrote', () => {
    const parsed = parsePersistedLog(stored(), NOW)!;
    expect(parsed.events).toHaveLength(1);
    expect(parsed.dropped).toBe(2);
    expect(parsed.startMs).toBe(1_000);
  });

  it('is null for nothing, for garbage, and for another schema or version', () => {
    expect(parsePersistedLog(null, NOW)).toBeNull();
    expect(parsePersistedLog('', NOW)).toBeNull();
    expect(parsePersistedLog('{not json', NOW)).toBeNull();
    expect(parsePersistedLog('"a string"', NOW)).toBeNull();
    expect(parsePersistedLog(stored({ schema: 'something.else' }), NOW)).toBeNull();
    expect(parsePersistedLog(stored({ version: PLAYTEST_LOG_VERSION + 1 }), NOW)).toBeNull();
    expect(parsePersistedLog(stored({ events: 'not an array' }), NOW)).toBeNull();
  });

  it('refuses an origin this clock cannot place, rather than rebasing onto it', () => {
    // A resumed laptop, a corrected NTP offset: every new event would be stamped
    // from a nonsense origin, and a timeline nobody can read is worse than none.
    expect(parsePersistedLog(stored({ startMs: NOW + 60_000 }), NOW)).toBeNull();
    expect(parsePersistedLog(stored({ startMs: NOW - MAX_RESTORE_AGE_MS - 1 }), NOW)).toBeNull();
    expect(parsePersistedLog(stored({ startMs: 'yesterday' }), NOW)).toBeNull();
    expect(parsePersistedLog(stored({ startMs: NOW - MAX_RESTORE_AGE_MS + 1 }), NOW)).not.toBeNull();
  });

  it('drops a malformed event and keeps the session around it', () => {
    const parsed = parsePersistedLog(
      stored({
        events: [
          { at: 1, kind: 'match', msg: 'matchStart' },
          { at: 'soon', kind: 'match', msg: 'bad at' },
          { at: 2, kind: 'invented', msg: 'bad kind' },
          null,
          { at: 3, kind: 'note', msg: 'kept' },
        ],
      }),
      NOW,
    )!;
    expect(parsed.events.map((e) => e.msg)).toEqual(['matchStart', 'kept']);
  });

  it('rebuilds an event field by field, so nothing a blob invented rides along', () => {
    const parsed = parsePersistedLog(
      stored({ events: [{ at: 1.6, kind: 'note', msg: 'n', data: { a: 1, deep: { b: 2 } }, evil: 'x' }] }),
      NOW,
    )!;
    const event = parsed.events[0]! as unknown as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(['at', 'data', 'kind', 'msg']);
    expect(event['at']).toBe(2); // rounded onto the integer grid every `at` uses
    expect((event['data'] as Record<string, unknown>)['deep']).toBe('[object]');
  });
});
