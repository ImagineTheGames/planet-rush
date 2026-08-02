/**
 * src/net/playtest-log-export.ts — ONE TAP, AND A FILE COMES OUT.
 * OWNER: Netcode Engineer (M10 playtest-log brief §2, §3).
 *
 * The log is only worth keeping if getting it out is trivial. This module is that
 * gesture, and it is deliberately the only place in the whole feature that can move
 * the log anywhere — by exactly two routes, tried in the order a **phone** wants
 * them (M10 action-echo §5: *"the developer had NO way to send them"*):
 *
 *   1. **The share sheet with the file attached** (`navigator.share` + `files:`),
 *      where the OS asks the developer where the log should go and it arrives there
 *      as a named `.json`. On a phone this is the route that exists for precisely
 *      this, and it is a download with the phone's own chooser in front of it.
 *   2. **A downloaded file**, where there is no sheet or the platform refuses the
 *      payload — always available in a browser, and it lands in Downloads under
 *      {@link playtestLogFilename}.
 *
 * ── WHY THERE IS NO THIRD ROUTE (ratified M10) ──────────────────────────────
 * There used to be one, in the middle: the clipboard. The developer, from a phone:
 * *"too large for mobile clipboard."* That was never a bug in the chain — the chain
 * worked — it was a rung that could **succeed and still strand the log**. A 40 KB
 * JSON blob on a phone's clipboard is a paste no chat app takes and no human
 * scrolls, and the export reported success while nothing travelled. The developer
 * then ratified it for every device, desktop included: *"Clipboard goes away for all
 * (PC and mobile)"*, with the one surviving control named for the file it saves. So
 * the clipboard is not a fallback here, not a desktop special case, and not reachable
 * at all: there is no `navigator.clipboard` seam in this file and no route that
 * produces text. What comes out the other end is always a named file a thumb can
 * attach.
 *
 * **It never uploads.** There is no `fetch` here and no endpoint anywhere in the
 * feature. The share sheet is not an exception to that: it hands the file to the
 * operating system's own chooser and the *developer* picks the destination — the
 * same "you decide what to send" property a download has, with the phone doing the
 * carrying instead of the person.
 *
 * Both seams are injected and default lazily to the browser's, so the whole export
 * path is exercised in node — including the fallback ordering, which is the part a
 * live test would find hardest to force.
 */

import type { PlaytestLog, PlaytestLogEnvironment } from './playtest-log';

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/**
 * The Web Share seam — `navigator.share`, satisfied structurally.
 *
 * **The developer had no way to send a log off the phone**, which is the whole
 * reason this feature exists. The share sheet is the gesture a phone actually has —
 * one tap opens the OS chooser and the log goes to Messages, Mail, Drive, or
 * whatever the developer already uses, as a *file*, named after the build it came
 * from.
 *
 * `canShare` is checked before `share` because Android and iOS disagree about which
 * payloads they will take (a `files:` share is refused outright by some browsers,
 * which then reject `share()` rather than degrade), and because a share the platform
 * will not accept must fall through to the download instead of failing the export.
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
  /** Defaults to the Blob + anchor download. */
  readonly save?: SaveFile | null;
  /** Defaults to the browser's `File`. */
  readonly makeShareFile?: MakeShareFile | null;
}

/** Which route the log actually took out. Both produce a file; they differ only in
 *  who chooses where it lands. There is no clipboard route (ratified M10). */
export type ExportRoute = 'share' | 'download';

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
 * Get the log off the device **as a FILE**, and never as text.
 *
 * This is the whole export. The developer's words, ratified for every device:
 * *"Clipboard goes away for all (PC and mobile)"*. What comes out the other end is a
 * named `.json` a thumb can attach — on a phone, on a desk, on either.
 *
 * Two routes, and **the clipboard is not one of them**:
 *
 *  1. **The share sheet with the file** (`navigator.share` + `files:`) — where the
 *     platform takes it, this is strictly the better version of a download on a
 *     phone: the OS chooser puts the same named file straight into Messages, Mail
 *     or Drive with no trip through a Downloads folder. Never the `text:`
 *     variant — a share that degrades to text is the wall of JSON this route
 *     exists to avoid, so a platform that refuses `files:` falls through instead.
 *  2. **The blob download** — always available in a browser, works on mobile
 *     Safari and Chrome, and lands in Downloads under
 *     {@link playtestLogFilename}: `planet-rush-log-<sha>-<timestamp>.json`.
 *
 * Every seam is injected, so both routes and the ordering are exercised in node
 * with no browser.
 */
export async function downloadPlaytestLog(config: ExportConfig): Promise<ExportResult> {
  const json = config.log.toJson();
  const bytes = json.length;
  const filename = playtestLogFilename(config.log.env);

  const share = config.share === undefined ? defaultShare() : config.share;
  const makeFile = config.makeShareFile === undefined ? defaultMakeShareFile() : config.makeShareFile;
  if (share && makeFile) {
    const file = makeFile(filename, json);
    if (file) {
      const payload: ShareData = { title: filename, text: SHARE_TEXT, files: [file] };
      // `canShare` first: a browser that refuses `files:` rejects `share()` rather
      // than degrading, and that refusal must cost the download nothing.
      if (!share.canShare || share.canShare(payload)) {
        try {
          await share.share(payload);
          return { ok: true, route: 'share', bytes };
        } catch {
          // Dismissed, unsupported, or outside a gesture. Down to the file.
        }
      }
    }
  }

  const save = config.save === undefined ? defaultSave() : config.save;
  if (save) {
    try {
      save(filename, json);
      return { ok: true, route: 'download', bytes };
    } catch (err) {
      return { ok: false, reason: `The download failed (${String(err)}).` };
    }
  }

  return { ok: false, reason: 'No way to save a file on this device.' };
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
 *  would put 40 KB of JSON into a text field, which is the wall of text this
 *  export exists to avoid. Without a `File` the share route is skipped entirely. */
function defaultMakeShareFile(): MakeShareFile | null {
  const FileCtor = (
    globalThis as {
      File?: new (parts: string[], name: string, options: { type: string }) => unknown;
    }
  ).File;
  if (!FileCtor) return null;
  return (filename, text) => new FileCtor([text], filename, { type: 'application/json' });
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
