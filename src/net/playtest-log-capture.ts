/**
 * src/net/playtest-log-capture.ts — console errors and warnings, into the log.
 * OWNER: Netcode Engineer (M10 playtest-log brief §1).
 *
 * The brief asks the session log to carry *"console errors/warnings from OUR
 * code"*. That qualifier is the whole design problem: a phone's console is
 * unreachable during a playtest, so the log is the only witness — but a log that
 * swallows every third-party warning (a browser deprecation notice, an extension
 * shouting into the page, a `favicon` 404) buries the one line that matters.
 *
 * So this module wraps `console.error` / `console.warn`, **always forwards to the
 * original** (nothing is hidden from a developer who *does* have devtools open),
 * and records only the calls whose stack points at same-origin script — our bundle.
 * {@link isOurFrame} is that judgement, and it is pure and tested, because "is this
 * ours?" is the kind of decision that rots silently.
 *
 * Two honest limits, written down rather than hidden:
 *
 *  - **Bundled dependencies are same-origin too.** A PixiJS warning is served from
 *    our own origin, so it reads as ours. That is the correct trade: the alternative
 *    is a module-path allowlist that goes stale every build, and a Pixi warning
 *    during a playtest is usually worth seeing anyway. What this *does* exclude is
 *    the loud stuff — browser extensions, cross-origin scripts, and frames we
 *    cannot attribute at all.
 *  - **A missing stack is treated as ours** (`origin: 'unknown'` on the event).
 *    Some engines omit stacks for a bare `console.warn`; dropping those would lose
 *    real errors to an implementation detail.
 *
 * Uncaught errors and unhandled promise rejections are captured too
 * ({@link installErrorCapture}) — same channel, same reader, and an uncaught error
 * is the one a report most needs.
 *
 * Everything ambient is injected: the console, the event target, and the origin.
 * The tests run in node with plain objects.
 */

import type { PlaytestLog } from './playtest-log';

// ---------------------------------------------------------------------------
// "Is this ours?"
// ---------------------------------------------------------------------------

/** Stack-frame markers that are never our code, whatever the origin says. */
const FOREIGN_MARKERS = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'safari-web-extension://',
  'extensions::',
  'about:blank',
  'node_modules/.vite/deps',
];

/**
 * Whether a stack trace belongs to our own script.
 *
 * `true` when some frame names a URL under `origin` (our bundle, our dev server) and
 * no frame is one of the {@link FOREIGN_MARKERS}. A stack with no recognizable frame
 * at all — including an empty or absent one — is also `true`: see the "missing
 * stack" note in the module header. A stack that names *only* other origins is
 * `false`, which is how an extension's noise stays out of the log.
 */
export function isOurFrame(stack: string | undefined, origin: string): boolean {
  if (typeof stack !== 'string' || stack.trim().length === 0) return true;
  for (const marker of FOREIGN_MARKERS) {
    if (stack.includes(marker)) return false;
  }
  // No origin to compare against (a file:// page, a test): nothing is provably
  // foreign, so keep the line rather than lose it.
  if (origin.length === 0) return true;
  if (stack.includes(origin)) return true;
  // Frames were named, none of them ours: only accept it if none of them looks like
  // a URL at all (a synthetic stack, a node frame) — otherwise it is someone else's.
  return !/\bhttps?:\/\//.test(stack);
}

// ---------------------------------------------------------------------------
// The console seam
// ---------------------------------------------------------------------------

/** The two console methods this module wraps. */
export type CapturedLevel = 'error' | 'warn';

/** The slice of `console` we touch — assignable, so the wrap can be undone. */
export interface ConsoleLike {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

export interface ConsoleCaptureConfig {
  readonly log: PlaytestLog;
  /** Defaults to the ambient `console`. */
  readonly console?: ConsoleLike;
  /** The page origin, e.g. `https://example.com`. Defaults to `''` (accept all). */
  readonly origin?: string;
  /** Produces a stack for the current call. Defaults to `new Error().stack`. */
  readonly stack?: () => string | undefined;
}

/** An installed capture, undoable — so a test (or a teardown) can put the console
 *  back exactly as it found it. */
export interface CaptureHandle {
  uninstall(): void;
}

/** Longest single console argument kept, before the log's own truncation. Keeps one
 *  enormous object from dominating a line. */
export const MAX_ARG_CHARS = 200;

/**
 * Wrap `console.error` and `console.warn` so each call from our code becomes an
 * `error`-kind event in the log. The original is always called first — capturing is
 * additive, never a filter on the developer's own console.
 *
 * A throwing formatter cannot break the wrapped console: the recording half is
 * wrapped in its own `try`, because a logger that can turn a warning into an
 * exception is a worse bug than the warning.
 */
export function installConsoleCapture(config: ConsoleCaptureConfig): CaptureHandle {
  const target = config.console ?? (globalThis.console as ConsoleLike | undefined);
  if (!target) return { uninstall: (): void => {} };

  const origin = config.origin ?? '';
  const readStack = config.stack ?? ((): string | undefined => new Error().stack);
  const originals: { error: ConsoleLike['error']; warn: ConsoleLike['warn'] } = {
    error: target.error.bind(target),
    warn: target.warn.bind(target),
  };

  const wrap = (level: CapturedLevel) =>
    function captured(...args: unknown[]): void {
      originals[level](...args);
      try {
        const stack = readStack();
        if (!isOurFrame(stack, origin)) return;
        config.log.recordError(level, formatArgs(args), {
          origin: stack === undefined ? 'unknown' : 'ours',
        });
      } catch {
        // Never let the log break the console it is listening to.
      }
    };

  target.error = wrap('error');
  target.warn = wrap('warn');

  return {
    uninstall(): void {
      target.error = originals.error;
      target.warn = originals.warn;
    },
  };
}

// ---------------------------------------------------------------------------
// Uncaught errors and rejections
// ---------------------------------------------------------------------------

/** The slice of `window` this module listens on. */
export interface ErrorEventTarget {
  addEventListener(type: string, handler: (event: unknown) => void): void;
  removeEventListener(type: string, handler: (event: unknown) => void): void;
}

export interface ErrorCaptureConfig {
  readonly log: PlaytestLog;
  /** Defaults to the ambient `globalThis` when it can listen. */
  readonly target?: ErrorEventTarget;
}

/**
 * Record uncaught errors (`error`) and unhandled promise rejections
 * (`unhandledrejection`). These never reach a wrapped `console.error`, and they are
 * the most useful lines a report can carry — a crash the player experienced as "it
 * froze" arrives here with a file and a line.
 */
export function installErrorCapture(config: ErrorCaptureConfig): CaptureHandle {
  // Validated rather than trusted: a host that cannot listen (node, a stub) must
  // make this inert, not throw — a logger may never break the boot it instruments.
  const target = asEventTarget(config.target ?? globalThis);
  if (!target) return { uninstall: (): void => {} };

  const onError = (event: unknown): void => {
    const e = event as { message?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown };
    config.log.recordError('error', `uncaught ${describe(e.message)}`, {
      file: shortenUrl(typeof e.filename === 'string' ? e.filename : ''),
      line: typeof e.lineno === 'number' ? e.lineno : null,
      col: typeof e.colno === 'number' ? e.colno : null,
    });
  };

  const onRejection = (event: unknown): void => {
    const e = event as { reason?: unknown };
    config.log.recordError('error', `unhandled rejection ${describe(e.reason)}`);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return {
    uninstall(): void {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Render console arguments as one line. `Error`s keep their name and message (and
 *  their first stack frame, which is the useful half); objects are shallow-described
 *  rather than expanded, so one log line stays one log line. */
export function formatArgs(args: readonly unknown[]): string {
  return args.map(describe).join(' ');
}

function describe(value: unknown): string {
  if (value instanceof Error) {
    const head = value.message ? `${value.name}: ${value.message}` : value.name;
    const frame = firstFrame(value.stack);
    return frame ? `${head} @ ${frame}` : head;
  }
  if (typeof value === 'string') return cap(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return cap(JSON.stringify(value) ?? String(value));
    } catch {
      return '[unserializable object]';
    }
  }
  return cap(String(value));
}

/** The first *code* frame of a stack — the line that says where, shortened to a
 *  file and position so a bundle URL does not eat the whole message. */
function firstFrame(stack: string | undefined): string | null {
  if (typeof stack !== 'string') return null;
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('Error')) continue;
    const url = /(https?:\/\/[^\s)]+)/.exec(line);
    return url ? shortenUrl(url[1]!) : cap(line.replace(/^at\s+/, ''));
  }
  return null;
}

/** Keep a URL's last path segment and its `:line:col`, dropping origin and query —
 *  `…/assets/index-a1b2.js:120:9`. Enough to locate, small enough to read. */
export function shortenUrl(url: string): string {
  if (url.length === 0) return '';
  const noQuery = url.split('?')[0] ?? url;
  const parts = noQuery.split('/');
  const tail = parts[parts.length - 1] ?? noQuery;
  return cap(tail);
}

function cap(s: string): string {
  return s.length <= MAX_ARG_CHARS ? s : `${s.slice(0, MAX_ARG_CHARS - 1)}…`;
}

/** `globalThis` as a listener target, or null where it cannot listen (node). */
function asEventTarget(g: unknown): ErrorEventTarget | null {
  const candidate = g as Partial<ErrorEventTarget> | null;
  return candidate && typeof candidate.addEventListener === 'function'
    ? (candidate as ErrorEventTarget)
    : null;
}
