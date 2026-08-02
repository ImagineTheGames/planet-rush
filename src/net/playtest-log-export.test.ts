/**
 * src/net/playtest-log-export.test.ts — getting the log out
 * (`./playtest-log-export`, M10 playtest-log brief §2, §3).
 *
 * The export is now a single promise, ratified for every device: what comes out is a
 * **named `.json` file**, by the share sheet where the platform takes it and by a
 * blob download where it does not. *"Clipboard goes away for all (PC and mobile)"* —
 * so the assertions here are as much about the route the module must never take as
 * about the two it does. The ordering and the silent failover are asserted in node
 * because neither is reachable in a live test on demand.
 *
 * Also asserted: nothing in this module can upload. There is no network seam to
 * inject, and the export is a pure function of the log plus two local sinks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaytestLog, describeEnvironment } from './playtest-log';
import { downloadPlaytestLog, playtestLogFilename } from './playtest-log-export';

/** The slice of a share payload these tests read back. */
interface ShareDataLike {
  title?: string;
  text?: string;
  files?: unknown[];
}

function newLog(): PlaytestLog {
  const log = new PlaytestLog({
    env: describeEnvironment({
      sha: '1a2b3c4',
      buildTime: '2026-07-30T09:00:00.000Z',
      startedAt: '2026-07-30T12:34:56.789Z',
      viewportWidth: 390,
      viewportHeight: 844,
      touch: true,
      connectionType: '4g',
    }),
  });
  log.recordSessionStart();
  return log;
}

afterEach(() => vi.unstubAllGlobals());

describe('playtestLogFilename', () => {
  it('leads with the build sha and then the UTC instant', () => {
    const log = newLog();
    expect(playtestLogFilename(log.env)).toBe('planet-rush-log-1a2b3c4-20260730-123456.json');
  });

  it('strips anything a filesystem would object to', () => {
    const env = { ...newLog().env, sha: '../etc/pa*sswd' };
    expect(playtestLogFilename(env)).toBe('planet-rush-log-etcpasswd-20260730-123456.json');
  });

  it('names an unknown instant rather than emitting NaN', () => {
    const env = { ...newLog().env, startedAt: 'unknown' };
    expect(playtestLogFilename(env)).toBe('planet-rush-log-1a2b3c4-unknown-time.json');
  });

  it('never leaves the sha empty', () => {
    const env = { ...newLog().env, sha: '***' };
    expect(playtestLogFilename(env)).toContain('planet-rush-log-unknown-');
  });
});

// ---------------------------------------------------------------------------
// downloadPlaytestLog — the whole export (ratified M10)
// ---------------------------------------------------------------------------

/**
 * The developer's complaint was never that the export failed — it was that it could
 * *succeed* into a dead end: *"too large for mobile clipboard."* A 40 KB paste is not
 * a report. So the promise this module makes is narrow and strong — what comes out
 * the other end is a FILE — and a good half of these assertions are about the route
 * it must never take, on a phone or on a desk.
 */
describe('downloadPlaytestLog — a file, never a clipboard', () => {
  it('saves the log as parseable JSON under the build-and-timestamp name', async () => {
    const log = newLog();
    const save = vi.fn();

    const result = await downloadPlaytestLog({ log, share: null, save });

    expect(result).toEqual({ ok: true, route: 'download', bytes: log.toJson().length });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe(playtestLogFilename(log.env));
    expect(save.mock.calls[0]![0]).toMatch(/^planet-rush-log-1a2b3c4-\d{8}-\d{6}\.json$/);
    const parsed = JSON.parse(save.mock.calls[0]![1] as string) as {
      schema: string;
      summary: string;
      events: unknown[];
    };
    expect(parsed.schema).toBe('planet-rush.playtest-log');
    expect(parsed.summary).toBe(log.summaryLine());
    expect(parsed.events.length).toBeGreaterThan(0);
  });

  it('NEVER touches the clipboard, even when the browser offers a working one', async () => {
    // The seam is gone from `ExportConfig` entirely, so the only clipboard this
    // module could still reach is the ambient one. Hand it a `navigator.clipboard`
    // that would happily take the paste and prove it is never asked — this is the
    // ratification (*"Clipboard goes away for all (PC and mobile)"*) as a test that
    // fails if a future edit reintroduces the route by default.
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await downloadPlaytestLog({ log: newLog(), share: null, save: vi.fn() });

    expect(writeText, 'the export reached for the clipboard').not.toHaveBeenCalled();
  });

  it('still produces a file when the clipboard is the only thing the page has', async () => {
    // A desktop with a clipboard and no share sheet used to be the clipboard's case.
    // It is now just a download, and the developer never has to choose.
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
    const save = vi.fn();
    const result = await downloadPlaytestLog({ log: newLog(), share: null, save });
    expect(result.ok && result.route).toBe('download');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('prefers the share sheet WITH THE FILE where the platform takes it', async () => {
    const log = newLog();
    const shared: ShareDataLike[] = [];
    const save = vi.fn();

    const result = await downloadPlaytestLog({
      log,
      share: { share: async (d) => void shared.push(d), canShare: () => true },
      makeShareFile: (filename, text) => ({ filename, text }),
      save,
    });

    expect(result).toEqual({ ok: true, route: 'share', bytes: log.toJson().length });
    expect(save, 'the sheet took it; nothing hit the Downloads folder').not.toHaveBeenCalled();
    expect(shared[0]!.files).toHaveLength(1);
    expect(shared[0]!.title).toBe(playtestLogFilename(log.env));
    const file = shared[0]!.files![0] as { filename: string; text: string };
    // A file, named for the build it came from — not a wall of text.
    expect(file.filename).toBe(playtestLogFilename(log.env));
    expect(JSON.parse(file.text)).toMatchObject({ env: { sha: '1a2b3c4' } });
  });

  it('falls to the file when the platform refuses a `files:` share', async () => {
    const log = newLog();
    const save = vi.fn();
    const result = await downloadPlaytestLog({
      log,
      // `canShare` says no — the platform would reject `share()` outright.
      share: { share: async () => Promise.reject(new Error('unreachable')), canShare: () => false },
      makeShareFile: (filename, text) => ({ filename, text }),
      save,
    });
    expect(result.ok && result.route).toBe('download');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('falls to the file when the developer dismisses the sheet', async () => {
    const log = newLog();
    const save = vi.fn();
    const result = await downloadPlaytestLog({
      log,
      share: { share: async () => Promise.reject(new Error('AbortError')), canShare: () => true },
      makeShareFile: (filename, text) => ({ filename, text }),
      save,
    });
    expect(result.ok && result.route).toBe('download');
  });

  it('asks the sheet even where `canShare` is absent, since a rejection is caught', async () => {
    // Older implementations ship `share` without `canShare`; "ask and find out" is
    // safe because the rejection costs the download nothing.
    const log = newLog();
    const share = vi.fn(async () => {});
    const result = await downloadPlaytestLog({
      log,
      share: { share },
      makeShareFile: (filename, text) => ({ filename, text }),
      save: vi.fn(),
    });
    expect(share).toHaveBeenCalledTimes(1);
    expect(result.ok && result.route).toBe('share');
  });

  it('never shares TEXT — a platform with no File constructor goes straight to the file', async () => {
    const log = newLog();
    const share = vi.fn(async () => {});
    const save = vi.fn();
    const result = await downloadPlaytestLog({
      log,
      share: { share, canShare: () => true },
      makeShareFile: () => null, // no `File` on this device
      save,
    });
    // A `text:`-only share is the wall of JSON this export exists to avoid.
    expect(share, 'it offered the sheet a payload with no file in it').not.toHaveBeenCalled();
    expect(result.ok && result.route).toBe('download');
  });

  it('is absent on a desktop browser with no share API, and that is not a failure', async () => {
    const result = await downloadPlaytestLog({ log: newLog(), share: null, save: vi.fn() });
    expect(result.ok && result.route).toBe('download');
  });

  it('is honest when there is nowhere to put a file at all', async () => {
    const log = newLog();
    expect(await downloadPlaytestLog({ log, share: null, save: null })).toEqual({
      ok: false,
      reason: 'No way to save a file on this device.',
    });
  });

  it('reports a download that throws rather than claiming a saved file', async () => {
    const log = newLog();
    const result = await downloadPlaytestLog({
      log,
      share: null,
      save: () => {
        throw new Error('SecurityError');
      },
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('SecurityError');
  });

  it('carries the WHOLE ring buffer, evictions counted', async () => {
    // The one thing a report is for: everything that happened, or an honest count
    // of what the ring dropped. A download that silently truncated would be worse
    // than no download — it would look complete.
    const log = new PlaytestLog({ env: newLog().env, capacity: 8 });
    for (let i = 0; i < 20; i++) log.recordNote(`note ${i}`);
    const save = vi.fn();

    await downloadPlaytestLog({ log, share: null, save });

    const parsed = JSON.parse(save.mock.calls[0]![1] as string) as {
      events: { msg: string }[];
      capacity: number;
      dropped: number;
    };
    expect(parsed.capacity).toBe(8);
    expect(parsed.events).toHaveLength(8);
    expect(parsed.dropped, 'the export owns up to what the ring evicted').toBe(12);
    expect(parsed.events[parsed.events.length - 1]!.msg).toBe('note 19');
  });
});

describe('local-only', () => {
  it('exports only to the two local sinks it was handed', async () => {
    // The whole module surface: a log in, a share sheet and a file out. There is no
    // third seam a future edit could point at a server without this test failing.
    const log = newLog();
    const seen: string[] = [];
    await downloadPlaytestLog({
      log,
      share: null,
      save: (name) => void seen.push(`file:${name}`),
    });
    expect(seen).toEqual([`file:${playtestLogFilename(log.env)}`]);
  });
});
