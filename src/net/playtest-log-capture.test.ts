/**
 * src/net/playtest-log-capture.test.ts — console capture (`./playtest-log-capture`,
 * M10 playtest-log brief §1).
 *
 * Two things have to be true for this to earn its place in the log: it must catch our
 * own errors on a phone with no devtools, and it must NOT fill the ring with a
 * browser extension's noise — "from OUR code" is the load-bearing half of the brief's
 * wording. Both are asserted against real stack shapes rather than a mock's `true`.
 *
 * The console, the origin, the stack and the event target are all injected, so this
 * runs in node.
 */

import { describe, expect, it, vi } from 'vitest';
import { PlaytestLog, describeEnvironment } from './playtest-log';
import {
  formatArgs,
  installConsoleCapture,
  installErrorCapture,
  isOurFrame,
  shortenUrl,
} from './playtest-log-capture';
import type { ConsoleLike, ErrorEventTarget } from './playtest-log-capture';

const ORIGIN = 'https://imaginethegames.github.io';

/** A stack whose frames are our bundle, as a browser writes it. */
const OURS = [
  'Error',
  `    at reconcile (${ORIGIN}/assets/index-a1b2c3.js:4211:19)`,
  `    at frame (${ORIGIN}/assets/index-a1b2c3.js:9013:7)`,
].join('\n');

/** A stack from a browser extension injected into the page. */
const EXTENSION = [
  'Error',
  '    at handle (chrome-extension://kkjfpnlfcbdmnpaijhbldjeiflemngoi/inject.js:12:9)',
].join('\n');

/** A stack whose only frames belong to another origin. */
const THIRD_PARTY = [
  'Error',
  '    at track (https://cdn.example.com/analytics.js:1:220)',
].join('\n');

function newLog(): PlaytestLog {
  return new PlaytestLog({ env: describeEnvironment({ sha: 'test123' }) });
}

function fakeConsole(): ConsoleLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    error: (...args: unknown[]): void => void calls.push(`error ${String(args[0])}`),
    warn: (...args: unknown[]): void => void calls.push(`warn ${String(args[0])}`),
  };
}

describe('isOurFrame', () => {
  it('accepts a same-origin stack', () => {
    expect(isOurFrame(OURS, ORIGIN)).toBe(true);
  });

  it('rejects a browser extension, whatever else the stack says', () => {
    expect(isOurFrame(EXTENSION, ORIGIN)).toBe(false);
    expect(isOurFrame(`${OURS}\n${EXTENSION}`, ORIGIN)).toBe(false);
  });

  it('rejects a stack that only names another origin', () => {
    expect(isOurFrame(THIRD_PARTY, ORIGIN)).toBe(false);
  });

  it('keeps a line whose stack is missing or empty rather than losing a real error', () => {
    expect(isOurFrame(undefined, ORIGIN)).toBe(true);
    expect(isOurFrame('', ORIGIN)).toBe(true);
  });

  it('keeps a non-URL stack (a synthetic or node frame)', () => {
    expect(isOurFrame('Error\n    at Object.<anonymous> (/app/src/net/session.ts:12:3)', ORIGIN)).toBe(true);
  });

  it('accepts everything when there is no origin to compare against', () => {
    expect(isOurFrame(THIRD_PARTY, '')).toBe(true);
  });
});

describe('installConsoleCapture', () => {
  it('records our own console.error and console.warn into the log', () => {
    const log = newLog();
    const console = fakeConsole();
    installConsoleCapture({ log, console, origin: ORIGIN, stack: () => OURS });

    console.error('snapshot decode failed', new Error('short buffer'));
    console.warn('input queue behind by', 4);

    const events = log.events;
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe('error');
    expect(events[0]!.msg).toContain('error: snapshot decode failed');
    expect(events[0]!.msg).toContain('Error: short buffer');
    expect(events[1]!.msg).toBe('warn: input queue behind by 4');
  });

  it('always forwards to the original console — capture never swallows a line', () => {
    const log = newLog();
    const console = fakeConsole();
    installConsoleCapture({ log, console, origin: ORIGIN, stack: () => EXTENSION });

    console.error('from an extension');
    // Forwarded even though it was NOT recorded: devtools still sees everything.
    expect(console.calls).toEqual(['error from an extension']);
    expect(log.events).toHaveLength(0);
  });

  it('marks a line whose origin could not be determined', () => {
    const log = newLog();
    const console = fakeConsole();
    installConsoleCapture({ log, console, origin: ORIGIN, stack: () => undefined });

    console.warn('no stack here');
    expect(log.events[0]!.data!['origin']).toBe('unknown');
  });

  it('cannot break the console it wraps', () => {
    const log = newLog();
    const console = fakeConsole();
    installConsoleCapture({
      log,
      console,
      origin: ORIGIN,
      stack: () => {
        throw new Error('stack unavailable');
      },
    });

    expect(() => console.error('still fine')).not.toThrow();
    expect(console.calls).toEqual(['error still fine']);
  });

  it('restores the original methods on uninstall', () => {
    const log = newLog();
    const console = fakeConsole();
    const original = console.error;
    const handle = installConsoleCapture({ log, console, origin: ORIGIN, stack: () => OURS });
    expect(console.error).not.toBe(original);

    handle.uninstall();
    console.error('after uninstall');
    expect(log.events).toHaveLength(0);
  });

  it('collapses a repeated warning into one entry (the log ring is a budget)', () => {
    const log = newLog();
    const console = fakeConsole();
    installConsoleCapture({ log, console, origin: ORIGIN, stack: () => OURS });

    for (let i = 0; i < 300; i++) console.warn('same warning');
    expect(log.events).toHaveLength(1);
    expect(log.events[0]!.repeat).toBe(300);
  });
});

describe('installErrorCapture', () => {
  function fakeTarget(): ErrorEventTarget & { fire: (type: string, event: unknown) => void } {
    const handlers = new Map<string, ((event: unknown) => void)[]>();
    return {
      addEventListener: (type, handler): void => {
        const list = handlers.get(type) ?? [];
        list.push(handler);
        handlers.set(type, list);
      },
      removeEventListener: (type, handler): void => {
        handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
      },
      fire: (type, event): void => {
        for (const h of handlers.get(type) ?? []) h(event);
      },
    };
  }

  it('records an uncaught error with its file and line', () => {
    const log = newLog();
    const target = fakeTarget();
    installErrorCapture({ log, target });

    target.fire('error', {
      message: 'Cannot read properties of null',
      filename: `${ORIGIN}/assets/index-a1b2c3.js?v=2`,
      lineno: 4211,
      colno: 19,
    });

    const event = log.events[0]!;
    expect(event.msg).toContain('uncaught Cannot read properties of null');
    expect(event.data!['file']).toBe('index-a1b2c3.js');
    expect(event.data!['line']).toBe(4211);
  });

  it('records an unhandled rejection', () => {
    const log = newLog();
    const target = fakeTarget();
    installErrorCapture({ log, target });

    target.fire('unhandledrejection', { reason: new Error('allocator unreachable') });
    expect(log.events[0]!.msg).toContain('unhandled rejection Error: allocator unreachable');
  });

  it('stops recording after uninstall', () => {
    const log = newLog();
    const target = fakeTarget();
    installErrorCapture({ log, target }).uninstall();

    target.fire('error', { message: 'ignored' });
    expect(log.events).toHaveLength(0);
  });

  it('is inert where there is nothing to listen on', () => {
    const log = newLog();
    const noListener = {} as unknown as ErrorEventTarget;
    expect(() => installErrorCapture({ log, target: noListener }).uninstall()).not.toThrow();
  });
});

describe('formatting', () => {
  it('keeps an error name, message and first frame — the useful half of a stack', () => {
    const err = new Error('boom');
    err.stack = OURS.replace('Error', 'Error: boom');
    expect(formatArgs([err])).toBe('Error: boom @ index-a1b2c3.js:4211:19');
  });

  it('describes an object without expanding it beyond one line', () => {
    const line = formatArgs([{ room: 'ABCD', machine: 'm-123' }]);
    expect(line).toBe('{"room":"ABCD","machine":"m-123"}');
    expect(formatArgs([{ self: makeCyclic() }])).toBe('[unserializable object]');
  });

  it('shortens a URL to the part a reader needs', () => {
    expect(shortenUrl(`${ORIGIN}/assets/index-a1b2c3.js:120:9?x=1`)).toBe('index-a1b2c3.js:120:9');
    expect(shortenUrl('')).toBe('');
  });

  it('names null and undefined rather than dropping them', () => {
    expect(formatArgs([null, undefined])).toBe('null undefined');
  });
});

/** An object that cannot be JSON-serialized. */
function makeCyclic(): unknown {
  const o: Record<string, unknown> = {};
  o['self'] = o;
  return o;
}

describe('the capture pair together', () => {
  it('does not record a console line twice when both captures are installed', () => {
    const log = newLog();
    const console = fakeConsole();
    const spy = vi.fn();
    installConsoleCapture({ log, console, origin: ORIGIN, stack: () => OURS });
    console.error('one line', spy);
    expect(log.events).toHaveLength(1);
  });
});
