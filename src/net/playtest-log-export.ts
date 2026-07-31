/**
 * src/net/playtest-log-export.ts — ONE TAP, PASTE INTO CHAT.
 * OWNER: Netcode Engineer (M10 playtest-log brief §2, §3).
 *
 * The log is only worth keeping if getting it out is trivial: *"clipboard as JSON,
 * plus a DOWNLOAD fallback. One tap, paste into chat"*. This module is that gesture,
 * and it is deliberately the only place in the whole feature that can move the log
 * anywhere — by exactly three routes, tried in the order a **phone** wants them
 * (M10 action-echo §5: *"the developer had NO way to send them"*):
 *
 *   1. **The share sheet** (`navigator.share`), where the OS asks the developer
 *      where the log should go and it arrives there as a named file. On a phone
 *      this is the route that exists for precisely this, and the only one that
 *      reliably survives Safari's clipboard rules.
 *   2. **The clipboard** (`navigator.clipboard.writeText`) — the desktop's one-tap
 *      path, and the phone's when there is no sheet.
 *   3. **A downloaded file**, when both refuse — which happens more often than one
 *      would like: an insecure origin, a gesture-context rule, a denied permission.
 *      A COPY LOG button that silently fails on the phone the developer actually
 *      plays on would be worse than no button, so the fallbacks are not an
 *      afterthought: they are tried automatically and reported honestly.
 *
 * **It never uploads.** There is no `fetch` here and no endpoint anywhere in the
 * feature. The share sheet is not an exception to that: it hands the file to the
 * operating system's own chooser and the *developer* picks the destination — the
 * same "you decide what to send" property pasting has (brief §3), with the phone
 * doing the carrying instead of the person.
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

/**
 * The Web Share seam — `navigator.share`, satisfied structurally.
 *
 * **The developer had no way to send a log off the phone**, which is the whole
 * reason this feature exists, and on a phone the clipboard is the *worst* of the
 * three routes even when it works: a pasted 40 KB JSON blob is a wall of text in a
 * chat app, iOS Safari refuses `writeText` outside a narrow gesture window, and
 * "paste it somewhere" is a step a person has to invent for themselves. The share
 * sheet is the gesture a phone actually has — one tap opens the OS chooser and the
 * log goes to Messages, Mail, Drive, or whatever the developer already uses, as a
 * *file*, named after the build it came from.
 *
 * `canShare` is checked before `share` because Android and iOS disagree about which
 * payloads they will take (a `files:` share is refused outright by some browsers,
 * which then reject `share()` rather than degrade), and because a share the platform
 * will not accept must fall through to the clipboard instead of failing the export.
 */
export interface ShareLike {
  share(data: ShareData): Promise<void>;
  /** Optional in the spec and absent on older implementations — treated as "ask
   *  and find out" when missing, since the `share()` rejection is caught anyway. */
  canShare?(data: ShareData): boolean;
}

/** The subset of `ShareData` used: a titled, described file. */
export interface ShareData {
  title?: string;
  text?: string;
  files?: unknown[];
}

/** Build the one-file payload a share sheet is handed, or null on a platform with
 *  no `File` constructor. Injected so the ordering is testable in node. */
export type MakeShareFile = (filename: string, text: string) => unknown | null;

/** Save `text` as a file named `filename`. The browser default builds a Blob URL
 *  and clicks a synthetic anchor; a test passes a recorder. */
export type SaveFile = (filename: string, text: string) => void;

export interface ExportConfig {
  readonly log: PlaytestLog;
  /** Defaults to `navigator` when it can share — the phone's own route out. */
  readonly share?: ShareLike | null;
  /** Defaults to `navigator.clipboard` when the page has one. */
  readonly clipboard?: ClipboardLike | null;
  /** Defaults to the Blob + anchor download. */
  readonly save?: SaveFile | null;
  /** Defaults to the browser's `File`. */
  readonly makeShareFile?: MakeShareFile | null;
}

/** Which route the log actually took out. */
export type ExportRoute = 'share' | 'clipboard' | 'download';

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
 * Get the log off the device, by the best route the device actually has.
 *
 * **Share sheet → clipboard → download**, and the order is the phone's, because the
 * phone is where the log has to come from (*"MOBILE LOGS — the developer had NO way
 * to send them"*). Every step is one tap; what changes down the list is how much
 * the developer has to invent afterwards:
 *
 *  1. **The share sheet** (`navigator.share`) hands the OS a *named file* and lets
 *     the developer pick where it goes — Messages, Mail, Drive. On a phone this is
 *     the gesture that already exists for exactly this, and it is the only one of
 *     the three that reliably survives Safari's clipboard rules.
 *  2. **The clipboard** — one tap, paste into chat. Still the right answer on a
 *     desktop, where a share sheet mostly does not exist and pasting is native.
 *  3. **A downloaded file** — always available, one extra step to attach.
 *
 * A route that is absent, refuses, or rejects falls through to the next without
 * bothering the developer about why; only *all three* failing is worth a message.
 * A share the user dismisses is the one ambiguous case, and it is treated as a
 * failure of that route (the sheet reports a cancel as a rejection and does not
 * distinguish it) — so a cancelled share still leaves the log on the clipboard,
 * which is a strictly better outcome than a dead end.
 */
export async function exportPlaytestLog(config: ExportConfig): Promise<ExportResult> {
  const json = config.log.toJson();
  const bytes = json.length;
  const filename = playtestLogFilename(config.log.env);

  const share = config.share === undefined ? defaultShare() : config.share;
  const makeFile = config.makeShareFile === undefined ? defaultMakeShareFile() : config.makeShareFile;
  if (share && makeFile) {
    const file = makeFile(filename, json);
    if (file) {
      const payload: ShareData = { title: filename, text: SHARE_TEXT, files: [file] };
      // Ask first where the platform will say: a browser that refuses `files:`
      // rejects `share()` rather than degrading, and that must cost the clipboard
      // route nothing.
      if (!share.canShare || share.canShare(payload)) {
        try {
          await share.share(payload);
          return { ok: true, route: 'share', bytes };
        } catch {
          // Dismissed, unsupported, or outside a gesture. Next route.
        }
      }
    }
  }

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
      save(filename, json);
      return { ok: true, route: 'download', bytes };
    } catch {
      return { ok: false, reason: 'The clipboard was refused and the download failed.' };
    }
  }

  return { ok: false, reason: 'No clipboard and no download available on this device.' };
}

/** The line that rides along in the share sheet, so the log arrives with a name
 *  on it rather than as an unexplained attachment. */
export const SHARE_TEXT = 'Planet Rush playtest log';

/** `navigator` when it can share, else null (a desktop browser without the API,
 *  node, an old WebView). */
function defaultShare(): ShareLike | null {
  const nav = (globalThis as { navigator?: Partial<ShareLike> }).navigator;
  return nav && typeof nav.share === 'function' ? (nav as ShareLike) : null;
}

/** The browser's `File`, or null where there is none — a share without a file
 *  would put 40 KB of JSON into a text field, which is the clipboard route with
 *  extra steps. */
function defaultMakeShareFile(): MakeShareFile | null {
  const FileCtor = (
    globalThis as {
      File?: new (parts: string[], name: string, options: { type: string }) => unknown;
    }
  ).File;
  if (!FileCtor) return null;
  return (filename, text) => new FileCtor([text], filename, { type: 'application/json' });
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
