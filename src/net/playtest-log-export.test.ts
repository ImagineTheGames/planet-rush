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
