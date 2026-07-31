/**
 * src/net/playtest-log-export.test.ts — getting the log out
 * (`./playtest-log-export`, M10 playtest-log brief §2, §3).
 *
 * The brief's export is "clipboard as JSON, plus a DOWNLOAD fallback", and the
 * fallback is the part that matters most in practice: the phone the developer plays
 * on is exactly where `navigator.clipboard` is most likely to refuse (an insecure
 * origin, a gesture-context rule, a denied permission). So the ordering, the silent
 * failover, and the honest final failure are each asserted here — none of them is
 * reachable in a live test on demand.
 *
 * Also asserted: nothing in this module can upload. There is no network seam to
 * inject, and the export is a pure function of the log plus two local sinks.
 */

import { describe, expect, it, vi } from 'vitest';
import { PlaytestLog, describeEnvironment } from './playtest-log';
import { exportPlaytestLog, playtestLogFilename } from './playtest-log-export';

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

describe('exportPlaytestLog', () => {
  it('puts the log on the clipboard as parseable JSON', async () => {
    const log = newLog();
    const writeText = vi.fn(async (_text: string) => {});

    const result = await exportPlaytestLog({ log, clipboard: { writeText }, save: null });

    expect(result).toEqual({ ok: true, route: 'clipboard', bytes: log.toJson().length });
    const pasted = JSON.parse(writeText.mock.calls[0]![0]) as { schema: string; summary: string };
    expect(pasted.schema).toBe('planet-rush.playtest-log');
    expect(pasted.summary).toBe(log.summaryLine());
  });

  it('falls back to a download when the clipboard rejects', async () => {
    const log = newLog();
    const save = vi.fn();

    const result = await exportPlaytestLog({
      log,
      clipboard: { writeText: async () => Promise.reject(new Error('NotAllowedError')) },
      save,
    });

    expect(result).toEqual({ ok: true, route: 'download', bytes: log.toJson().length });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe(playtestLogFilename(log.env));
    expect(JSON.parse(save.mock.calls[0]![1] as string)).toBeTruthy();
  });

  it('falls back to a download when there is no clipboard at all', async () => {
    const log = newLog();
    const save = vi.fn();
    const result = await exportPlaytestLog({ log, clipboard: null, save });
    expect(result.ok && result.route).toBe('download');
  });

  it('tries the clipboard FIRST — one tap, paste into chat', async () => {
    const log = newLog();
    const order: string[] = [];
    await exportPlaytestLog({
      log,
      clipboard: { writeText: async () => void order.push('clipboard') },
      save: () => void order.push('download'),
    });
    expect(order).toEqual(['clipboard']);
  });

  it('says so plainly when both routes refuse', async () => {
    const log = newLog();
    const result = await exportPlaytestLog({
      log,
      clipboard: { writeText: async () => Promise.reject(new Error('no')) },
      save: () => {
        throw new Error('no download either');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('download failed');
  });

  it('reports the honest failure when the device offers neither sink', async () => {
    const result = await exportPlaytestLog({ log: newLog(), clipboard: null, save: null });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('No clipboard');
  });
});

describe('the share sheet — the phone’s own route out (M10 action-echo §5)', () => {
  /** A `navigator.share` stand-in that records what it was handed. */
  function shareSpy(options: { canShare?: boolean; reject?: boolean } = {}): {
    share: ReturnType<typeof vi.fn>;
    canShare: ReturnType<typeof vi.fn>;
  } {
    return {
      share: vi.fn(async () => {
        if (options.reject) throw new Error('dismissed');
      }),
      canShare: vi.fn(() => options.canShare !== false),
    };
  }

  /** A `File` stand-in: the payload's identity is its name and its contents. */
  const makeShareFile = (filename: string, text: string): unknown => ({ filename, text });

  it('shares a NAMED FILE first, ahead of the clipboard', async () => {
    const log = newLog();
    const sheet = shareSpy();
    const writeText = vi.fn(async (_t: string) => {});

    const result = await exportPlaytestLog({
      log,
      share: sheet,
      makeShareFile,
      clipboard: { writeText },
      save: null,
    });

    expect(result).toEqual({ ok: true, route: 'share', bytes: log.toJson().length });
    // The clipboard was never touched: on a phone, a share sheet is the gesture
    // that exists, and pasting 40 KB of JSON into a chat app is not.
    expect(writeText).not.toHaveBeenCalled();
    const payload = sheet.share.mock.calls[0]![0] as { title: string; files: { filename: string; text: string }[] };
    expect(payload.title).toBe(playtestLogFilename(log.env));
    // A file, named for the build it came from — not a wall of text.
    expect(payload.files[0]!.filename).toBe(playtestLogFilename(log.env));
    expect(JSON.parse(payload.files[0]!.text)).toMatchObject({ env: { sha: '1a2b3c4' } });
  });

  it('falls through to the clipboard when the share is dismissed', async () => {
    const log = newLog();
    const writeText = vi.fn(async (_t: string) => {});
    const result = await exportPlaytestLog({
      log,
      share: shareSpy({ reject: true }),
      makeShareFile,
      clipboard: { writeText },
      save: null,
    });
    // A cancelled sheet reports as a rejection and says nothing about *why*, so it
    // costs the developer the next route rather than the whole export.
    expect(result.ok && result.route).toBe('clipboard');
    expect(writeText).toHaveBeenCalledOnce();
  });

  it('does not even try when the platform says it cannot share files', async () => {
    const log = newLog();
    const sheet = shareSpy({ canShare: false });
    const writeText = vi.fn(async (_t: string) => {});
    const result = await exportPlaytestLog({
      log,
      share: sheet,
      makeShareFile,
      clipboard: { writeText },
      save: null,
    });
    expect(sheet.share).not.toHaveBeenCalled();
    expect(result.ok && result.route).toBe('clipboard');
  });

  it('skips the sheet on a device with no File constructor', async () => {
    const log = newLog();
    const sheet = shareSpy();
    const writeText = vi.fn(async (_t: string) => {});
    const result = await exportPlaytestLog({
      log,
      share: sheet,
      makeShareFile: () => null,
      clipboard: { writeText },
      save: null,
    });
    expect(sheet.share).not.toHaveBeenCalled();
    expect(result.ok && result.route).toBe('clipboard');
  });

  it('still reaches the download when the sheet AND the clipboard refuse', async () => {
    const log = newLog();
    const saved: string[] = [];
    const result = await exportPlaytestLog({
      log,
      share: shareSpy({ reject: true }),
      makeShareFile,
      clipboard: { writeText: async () => Promise.reject(new Error('insecure origin')) },
      save: (filename) => saved.push(filename),
    });
    expect(result.ok && result.route).toBe('download');
    expect(saved).toEqual([playtestLogFilename(log.env)]);
  });

  it('is absent on a desktop browser with no share API, and that is not a failure', async () => {
    const log = newLog();
    const writeText = vi.fn(async (_t: string) => {});
    const result = await exportPlaytestLog({ log, share: null, clipboard: { writeText }, save: null });
    expect(result.ok && result.route).toBe('clipboard');
  });
});

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

describe('local-only', () => {
  it('exports only to the two local sinks it was handed', async () => {
    // The whole module surface: a log in, a clipboard and a file out. There is no
    // third seam a future edit could point at a server without this test failing.
    const log = newLog();
    const seen: string[] = [];
    await exportPlaytestLog({
      log,
      clipboard: { writeText: async (text) => void seen.push(`clipboard:${text.length}`) },
      save: (name) => void seen.push(`file:${name}`),
    });
    expect(seen).toEqual([`clipboard:${log.toJson().length}`]);
  });
});
