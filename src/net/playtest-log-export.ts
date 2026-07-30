/**
 * src/net/playtest-log-export.ts — ONE TAP, PASTE INTO CHAT.
 * OWNER: Netcode Engineer (M10 playtest-log brief §2, §3).
 *
 * The log is only worth keeping if getting it out is trivial: *"clipboard as JSON,
 * plus a DOWNLOAD fallback. One tap, paste into chat"*. This module is that gesture,
 * and it is deliberately the only place in the whole feature that can move the log
 * anywhere — and it moves it exactly two places, both of them the developer's own
 * device:
 *
 *   1. **The clipboard** (`navigator.clipboard.writeText`), the one-tap path.
 *   2. **A downloaded file**, when the clipboard refuses — which it does more often
 *      than one would like: an insecure origin, a Safari gesture-context rule, a
 *      denied permission. A COPY LOG button that silently fails on the phone the
 *      developer actually plays on would be worse than no button, so the fallback is
 *      not an afterthought: it is tried automatically and reported honestly.
 *
 * **It never uploads.** There is no `fetch` here and no endpoint anywhere in the
 * feature; the developer chooses what to share, by pasting it (brief §3).
 *
 * Both seams are injected and default lazily to the browser's, so the whole export
 * path is exercised in node — including the fallback ordering, which is the part a
 * live test would find hardest to force.
 */

import type { PlaytestLog, PlaytestLogEnvironment } from './playtest-log';

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/** The one clipboard method used. `navigator.clipboard` satisfies it structurally. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/** Save `text` as a file named `filename`. The browser default builds a Blob URL
 *  and clicks a synthetic anchor; a test passes a recorder. */
export type SaveFile = (filename: string, text: string) => void;

export interface ExportConfig {
  readonly log: PlaytestLog;
  /** Defaults to `navigator.clipboard` when the page has one. */
  readonly clipboard?: ClipboardLike | null;
  /** Defaults to the Blob + anchor download. */
  readonly save?: SaveFile | null;
}

/** Which route the log actually took out. */
export type ExportRoute = 'clipboard' | 'download';

/** What an export attempt produced. On failure both routes were tried and both
 *  refused — the button says so rather than pretending it worked. */
export type ExportResult =
  | { readonly ok: true; readonly route: ExportRoute; readonly bytes: number }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// The filename
// ---------------------------------------------------------------------------

/**
 * The download's filename: `planet-rush-log-<sha>-<YYYYMMDD-HHMMSS>.json`, in UTC.
 * Sha first because the first question of any log is which build; the timestamp
 * second so a phone's Downloads folder sorts a session's exports in order. Pure, so
 * the shape is asserted without a clock.
 */
export function playtestLogFilename(env: PlaytestLogEnvironment): string {
  const sha = safeToken(env.sha) || 'unknown';
  return `planet-rush-log-${sha}-${compactUtc(env.startedAt)}.json`;
}

/** `2026-07-30T12:34:56.789Z` → `20260730-123456`. An unparseable instant becomes
 *  `unknown-time`, never `NaNNaN`. */
function compactUtc(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown-time';
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/** Keep a token filename-safe: letters, digits, dash. A dirty build's `*` and any
 *  path separator a stamped sha could carry are dropped. */
function safeToken(s: string): string {
  return s.replace(/[^A-Za-z0-9-]/g, '').slice(0, 24);
}

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

/**
 * Put the log on the clipboard, falling back to a download.
 *
 * Order matters and is the brief's: clipboard first (one tap, paste into chat), file
 * second (still one tap, one extra step to share). A clipboard that resolves is
 * success; a clipboard that throws, rejects, or is simply absent moves on to the
 * file without bothering the developer about why.
 */
export async function exportPlaytestLog(config: ExportConfig): Promise<ExportResult> {
  const json = config.log.toJson();
  const bytes = json.length;

  const clipboard = config.clipboard === undefined ? defaultClipboard() : config.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(json);
      return { ok: true, route: 'clipboard', bytes };
    } catch {
      // Insecure origin, denied permission, or outside a user-gesture context.
      // Not an error worth showing — it is exactly why the fallback exists.
    }
  }

  const save = config.save === undefined ? defaultSave() : config.save;
  if (save) {
    try {
      save(playtestLogFilename(config.log.env), json);
      return { ok: true, route: 'download', bytes };
    } catch {
      return { ok: false, reason: 'The clipboard was refused and the download failed.' };
    }
  }

  return { ok: false, reason: 'No clipboard and no download available on this device.' };
}

/** `navigator.clipboard`, or null where there is none (node, an old browser). */
function defaultClipboard(): ClipboardLike | null {
  const nav = (globalThis as { navigator?: { clipboard?: ClipboardLike } }).navigator;
  const clipboard = nav?.clipboard;
  return clipboard && typeof clipboard.writeText === 'function' ? clipboard : null;
}

/**
 * The browser download: a Blob URL clicked through a detached anchor, revoked
 * immediately after. Null where there is no DOM, which is what keeps this module
 * importable in node and on the server side of the repo.
 */
function defaultSave(): SaveFile | null {
  const scope = globalThis as {
    document?: {
      createElement(tag: string): {
        href: string;
        download: string;
        style: { display: string };
        click(): void;
      };
    };
    Blob?: new (parts: string[], options: { type: string }) => unknown;
    URL?: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
  };
  const { document, Blob, URL } = scope;
  if (!document || !Blob || !URL?.createObjectURL) return null;

  return (filename, text): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}
