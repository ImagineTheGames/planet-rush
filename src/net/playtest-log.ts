/**
 * src/net/playtest-log.ts — THE PLAYTEST LOG THE DEVELOPER HANDS BACK.
 * OWNER: Netcode Engineer (developer ratification, M10 playtest-log brief).
 *
 * *"Should we add logging to the browser so that I can share back with you after a
 * playtest?"* Yes — because the developer's reports and the Director's probes have
 * been talking past each other. A report reads "it wouldn't connect"; the probe
 * reads "the fleet is healthy"; and nothing in between says which build was on the
 * phone, which machine it dialled, or what the socket actually said. This module is
 * that missing middle: one **bounded, local-only, structured** record of a session,
 * exported with a single tap and pasted into chat.
 *
 * Six properties this log promises, and this file is where five of them live — the
 * first four from the M10 brief, the last two from a0-56, the day a log answered a
 * mid-match question with a boot sequence and was believed:
 *
 *  1. **Bounded.** Memory is a budget, so the log is a ring: {@link PlaytestLog}
 *     keeps at most {@link PLAYTEST_LOG_CAPACITY} events and counts what it evicted
 *     ({@link PlaytestLog.dropped}) rather than growing until the tab dies. Long
 *     strings are truncated on the way in, and a repeated event coalesces into a
 *     `repeat` count — a `console.warn` in a 60 Hz loop costs one slot, not the ring.
 *  2. **Structured.** Every entry is a {@link PlaytestLogEvent}: ms since session
 *     start, a {@link PlaytestEventKind}, a short message, and flat scalar `data`.
 *     Flat and scalar so a pasted log is readable by a human *and* parseable by a
 *     tool without a schema negotiation.
 *  3. **Self-describing.** {@link PlaytestLog.summaryLine} is the export's first
 *     line: build sha, date, form factor, connection type — so a pasted log answers
 *     "which build were you on?" without a follow-up question (brief §4).
 *  4. **Versioned.** The export carries {@link PLAYTEST_LOG_SCHEMA} and
 *     {@link PLAYTEST_LOG_VERSION}, so a log pasted three weeks from now can still
 *     be read against the shape it was written in (brief §5).
 *  5. **Survives a reload.** The log used to live only in a module-level singleton,
 *     so the page reload behind BACK TO MENU killed it and a fresh one booted in
 *     its place — and the developer's report *"it said i never left the main menu
 *     but i was in the pause menu in the middle of a match"* was answered by a log
 *     that had been alive for eight seconds (a0-56). Events are now mirrored into
 *     an injected {@link PlaytestLogStore} (`./playtest-log-store` wraps
 *     `sessionStorage`: survives a reload, dies with the tab — a playtest session's
 *     exact lifetime) and adopted back on boot, **verbatim**, with the session's
 *     clock rebased onto the original start so a restored timeline reads as one
 *     continuous session rather than two overlapping ones.
 *  6. **Honest about what it does NOT contain.** A boot-only log used to be
 *     indistinguishable from a whole session's: same schema, `dropped: 0`, the same
 *     confident summary line. {@link PlaytestLogExport.coverage} is the field that
 *     tells them apart in one read — `'match'` only when a match-scoped event was
 *     actually recorded, `'boot-only'` otherwise — and the summary line says it too,
 *     because the summary is what a reader reads first (a0-56).
 *
 * **Local-only** is a property of what this file *does not have*: no `fetch`, no
 * socket, no endpoint. Nothing here can send anything anywhere — the one storage
 * seam is a *local* mirror of what is already in memory, injected like the clock, and
 * this module still touches no browser global. Export is a deliberate gesture the
 * developer makes (`./playtest-log-export`), never an upload (brief §3).
 *
 * **No ambient anything**, like the rest of `src/net`: the wall clock is injected,
 * the build identity and the device description are passed in (the browser probing
 * that produces them belongs to the caller, so this module stays DOM-free and its
 * tests run in node). A log is therefore fully reproducible in a test.
 */

// ---------------------------------------------------------------------------
// Schema — the versioned contract a pasted log is read against
// ---------------------------------------------------------------------------

/** The export's schema id. Present in every export so a log found in a chat log
 *  three weeks later identifies itself. */
export const PLAYTEST_LOG_SCHEMA = 'planet-rush.playtest-log';

/** The export's schema version. Bump when a field's meaning changes — never for an
 *  added field, which an older reader simply ignores. */
export const PLAYTEST_LOG_VERSION = 1;

// ---------------------------------------------------------------------------
// Budget — the ring's bounds, named so "bounded" is checkable
// ---------------------------------------------------------------------------

/**
 * Events retained. Sized to cover a whole playtest session's *interesting* moments
 * (connection lifecycle, one net sample per second, match events, errors) at a few
 * tens of KB of JSON — the paste has to fit in a chat message, and a phone's tab
 * has to survive an hour of it.
 */
export const PLAYTEST_LOG_CAPACITY = 600;

/** Longest message text kept; anything longer is truncated with an ellipsis. A
 *  stack trace is useful for two lines and unaffordable for forty. */
export const MAX_MESSAGE_CHARS = 240;

/** Longest string *value* kept in `data`. */
export const MAX_VALUE_CHARS = 160;

/** Most `data` keys kept per event, so one caller cannot spend the whole budget. */
export const MAX_DATA_KEYS = 12;

/**
 * Shortest gap between two writes to the {@link PlaytestLogStore}, ms.
 *
 * A synchronous `sessionStorage.setItem` of the whole ring is tens of KB of
 * serialization on the main thread, and the log is fed from inside a 60 Hz frame
 * (per-second telemetry, every ore movement, every console warn). Writing on every
 * event would put that cost in the frame budget this team is measured on, so writes
 * are throttled and the loser is at most a quarter second of tail — which
 * {@link PlaytestLog.flush} then buys back at the moments that actually matter (the
 * page going away, an export being taken).
 */
export const PLAYTEST_LOG_WRITE_INTERVAL_MS = 250;

/**
 * Oldest persisted log still adopted, ms. `sessionStorage` already dies with the
 * tab, so this is not a retention policy — it is a **sanity check on the clock**:
 * a restored origin that is in the future, or half a day back, means the wall clock
 * moved under us (a resumed laptop, a corrected NTP offset) and rebasing onto it
 * would stamp every new event with a nonsense `at`. A log that cannot be placed on
 * a timeline is dropped rather than believed.
 */
export const MAX_RESTORE_AGE_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * What an event is *about*, so a reader (or a `grep`) can pull one thread out of a
 * session:
 *
 *  - `session` — the session's own lifecycle: start, build identity, boot notes.
 *  - `connect` — the connection lifecycle end to end: allocate → ticket → dial →
 *    welcome / joinError, plus every transport state change and its reason.
 *  - `net`     — measured wire numbers: the per-second RTT and reconciliation
 *    telemetry (`./telemetry`, the #238 instrument).
 *  - `match`   — what happened in the game: spawn, death, substitution, reclaim, end.
 *  - `error`   — a console error or warning from our own code, or an uncaught one.
 *  - `note`    — anything else worth a line, including a developer-pressed marker.
 */
export type PlaytestEventKind = 'session' | 'connect' | 'net' | 'match' | 'error' | 'note';

/** What may appear as an event's `data` value: scalars only, so the export is flat,
 *  small, and readable — never a nested object graph that has to be unfolded. */
export type PlaytestLogValue = string | number | boolean | null;

/** One line of the session's record. */
export interface PlaytestLogEvent {
  /** Ms since session start (integer) — relative, so the log reads as a timeline
   *  and the absolute instant lives once in {@link PlaytestLogEnvironment.startedAt}. */
  readonly at: number;
  readonly kind: PlaytestEventKind;
  /** A short, human-first line: what happened. */
  readonly msg: string;
  /** Flat scalar detail, or absent when there is none. */
  readonly data?: Readonly<Record<string, PlaytestLogValue>>;
  /** How many identical consecutive occurrences this entry stands for. Absent (not
   *  `1`) in the common single case, so the export stays quiet. */
  readonly repeat?: number;
  /** The most recent occurrence's `at`, present only when `repeat` is. */
  readonly lastAt?: number;
}

// ---------------------------------------------------------------------------
// The environment — the answer to "which build, on what, over what?"
// ---------------------------------------------------------------------------

/** How the screen classifies. Coarse on purpose: the useful question is which
 *  layout and which thumb reach, not the model name. */
export type FormFactor = 'phone' | 'tablet' | 'desktop';

/**
 * The session's identity, resolved once at construction and reported as the
 * export's header. Everything here is something the game already knows and already
 * shows (the build badge, the viewport it laid out for, whether it has a touch
 * screen) — no device ids, no user agent string, no location (brief §5).
 */
export interface PlaytestLogEnvironment {
  /**
   * **The badge string, verbatim** — `'3d7cc6a'` offline, `'3d7cc6a · d891dd0a
   * (gru)'` once a session is on a server (`@platform/build-identity`
   * `formatBuildTag`).
   *
   * This is the same characters the corner badge is drawing at the moment of the
   * export, and that is the whole point (ratified, M10): a screenshot and a pasted
   * log must never disagree about which build was on which Machine in which
   * region. Kept current for the *whole* session by {@link PlaytestLog.setBuild},
   * so an export taken after a connect carries the server the earlier events were
   * heading for, not the bare sha the session started on.
   */
  readonly build: string;
  /** Short git sha of the build, or `'dev'`/`'unknown'` (`@platform/build-info`). */
  readonly sha: string;
  /** Build timestamp, ISO-8601 — the disambiguator between two builds of one sha. */
  readonly buildTime: string;
  /** True when the build came from a dirty working tree. */
  readonly dirty: boolean;
  /** When this session started, ISO-8601 — the log's one absolute instant. */
  readonly startedAt: string;
  readonly formFactor: FormFactor;
  /** Viewport at session start, `"390x844"` — CSS px, as the game laid out for. */
  readonly viewport: string;
  /** True when the device reports a touch screen. */
  readonly touch: boolean;
  /**
   * Connection type as the browser describes it — `'4g'`, `'wifi'`, `'offline'`,
   * `'unknown'`. A phone report that reads "it kept dropping" is a different bug on
   * cellular than on wifi, and this is the one line that tells them apart.
   */
  readonly connection: string;
}

/** The unclassifiable answer, used wherever a probe came back empty. */
export const UNKNOWN = 'unknown';

/**
 * Classify a viewport into a {@link FormFactor}. Touch is the first signal (a
 * desktop with a mouse is a desktop whatever its window size), and the phone/tablet
 * split is the short edge against {@link TABLET_MIN_SHORT_EDGE} — the same
 * "thumb-scale or not" question the HUD's mobile layout asks.
 */
export function classifyFormFactor(width: number, height: number, touch: boolean): FormFactor {
  if (!touch) return 'desktop';
  const shortEdge = Math.min(Math.abs(width), Math.abs(height));
  // A zero/absent viewport says nothing about size; with touch present, a phone is
  // the likelier and more constrained guess, so it is the safer default.
  if (shortEdge === 0) return 'phone';
  return shortEdge >= TABLET_MIN_SHORT_EDGE ? 'tablet' : 'phone';
}

/** Short-edge CSS px at or above which a touch device is called a tablet. */
export const TABLET_MIN_SHORT_EDGE = 600;

/**
 * Normalize whatever `navigator.connection?.effectiveType` handed us into one word.
 * `online: false` wins outright — a browser that says it is offline is the whole
 * answer, and it explains a failed dial better than the last-known radio type does.
 * An absent or non-string effective type reads {@link UNKNOWN} (desktop Safari and
 * Firefox report nothing), never an invented value.
 */
export function normalizeConnectionType(raw: unknown, online = true): string {
  if (!online) return 'offline';
  if (typeof raw !== 'string') return UNKNOWN;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed.slice(0, 16) : UNKNOWN;
}

/** What a caller measures off the page to describe the session. Every field is
 *  optional so a headless / node caller can describe what it has and no more. */
export interface EnvironmentProbe {
  /** The badge string (`@platform/build-identity`). Defaults to the sha with its
   *  dirty marker — which is exactly what the badge shows before a connect. */
  readonly build?: string;
  readonly sha?: string;
  readonly buildTime?: string;
  readonly dirty?: boolean;
  readonly startedAt?: string;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly touch?: boolean;
  /** Raw `effectiveType` (or similar); normalized by {@link normalizeConnectionType}. */
  readonly connectionType?: unknown;
  /** `navigator.onLine`. Defaults to `true` — an unknown network is not an offline one. */
  readonly online?: boolean;
}

/**
 * Turn a probe into the export header. Pure and total: every missing field has a
 * stated fallback, so a log is never *missing* its identity — at worst it says
 * `unknown`, which is itself an answer ("this build was not stamped").
 */
export function describeEnvironment(probe: EnvironmentProbe = {}): PlaytestLogEnvironment {
  const width = Math.round(probe.viewportWidth ?? 0);
  const height = Math.round(probe.viewportHeight ?? 0);
  const touch = probe.touch ?? false;
  const sha = nonEmpty(probe.sha) ?? UNKNOWN;
  const dirty = probe.dirty ?? false;
  return {
    // No probe build tag: reconstruct what the badge would be showing offline,
    // rather than leaving the field `unknown` next to a sha we plainly know.
    build: nonEmpty(probe.build) ?? (dirty ? `${sha}*` : sha),
    sha,
    buildTime: nonEmpty(probe.buildTime) ?? UNKNOWN,
    dirty,
    startedAt: nonEmpty(probe.startedAt) ?? UNKNOWN,
    formFactor: classifyFormFactor(width, height, touch),
    viewport: `${width}x${height}`,
    touch,
    connection: normalizeConnectionType(probe.connectionType, probe.online ?? true),
  };
}

// ---------------------------------------------------------------------------
// Persistence — the seam that carries a log across a page reload (a0-56)
// ---------------------------------------------------------------------------

/**
 * Somewhere a string survives a page reload.
 *
 * Deliberately the dumbest possible seam — two methods, strings in and out, no
 * knowledge of what a log is — for three reasons:
 *
 *  1. **Neither method may throw.** A log that crashes the client is strictly worse
 *     than a log that forgets: private mode denies `sessionStorage` on access, and a
 *     full quota throws on write. An implementation catches its own failures and
 *     reports the write one as `false`; nothing here propagates into the game.
 *  2. **The parsing stays in this module**, where it is pure, versioned and testable
 *     in node — so a corrupt or stale blob is rejected by the same code in every
 *     environment rather than by whatever the storage wrapper happened to do.
 *  3. **No browser global crosses this line.** `sessionStorage` lives in
 *     `./playtest-log-store`; this file still runs in node with nothing stubbed.
 */
export interface PlaytestLogStore {
  /** Whatever a previous page load left, or `null` when there is nothing (or when
   *  reading is not permitted). Never throws. */
  read(): string | null;
  /** Persist `text`. Returns `false` when it could not (quota, private mode), which
   *  is the log's cue to stop trying and say so on the timeline. Never throws. */
  write(text: string): boolean;
}

/**
 * The blob a {@link PlaytestLogStore} holds: the ring, its eviction count, and the
 * two numbers that let a later page load put the events back on **one** timeline —
 * the session's original start as an instant (`startedAt`, for the header) and as a
 * clock reading (`startMs`, the origin every `at` is measured from).
 *
 * Versioned by the same schema id as the export, so a blob written by an older build
 * that a browser tab kept alive across a deploy is discarded rather than
 * misinterpreted.
 */
export interface PersistedPlaytestLog {
  readonly schema: typeof PLAYTEST_LOG_SCHEMA;
  readonly version: number;
  /** ISO instant of the ORIGINAL session start — the one before any reload. */
  readonly startedAt: string;
  /** Clock reading of that same instant; every event's `at` is relative to it. */
  readonly startMs: number;
  /** Clock reading at the moment of the write, for the staleness check. */
  readonly savedAt: number;
  /** Events evicted by the ring across the whole session, reloads included. */
  readonly dropped: number;
  /**
   * Whether the session had seen a match by the time of the write.
   *
   * Persisted rather than re-derived from `events`, for the same reason
   * {@link PlaytestLog.coverage} is a flag rather than a scan: a long session can
   * evict the very match events that set it, and a reload must not be where a log
   * forgets it had a match. Absent in a blob written by an older build, which then
   * falls back to what the restored events themselves say.
   */
  readonly sawMatch: boolean;
  readonly events: readonly PlaytestLogEvent[];
}

/** Serialize the ring for a {@link PlaytestLogStore}. Pure. */
export function serializePersistedLog(log: PersistedPlaytestLog): string {
  return JSON.stringify(log);
}

/**
 * Read a persisted log back, or `null` when there is nothing usable. **Total**: a
 * blob that is absent, unparseable, from another schema or version, or anchored to a
 * clock this session cannot reconcile with (see {@link MAX_RESTORE_AGE_MS}) reads as
 * "no previous session", never as an exception and never as a half-restored timeline.
 * Individual malformed events are dropped and the rest kept — losing one line is
 * better than losing the match around it.
 */
export function parsePersistedLog(text: string | null, now: number): PersistedPlaytestLog | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const blob = raw as Partial<PersistedPlaytestLog>;
  if (blob.schema !== PLAYTEST_LOG_SCHEMA || blob.version !== PLAYTEST_LOG_VERSION) return null;
  const startMs = blob.startMs;
  if (typeof startMs !== 'number' || !Number.isFinite(startMs)) return null;
  // The clock must be able to place it: not in the future, not half a day back.
  const age = now - startMs;
  if (age < 0 || age > MAX_RESTORE_AGE_MS) return null;
  if (!Array.isArray(blob.events)) return null;
  const events: PlaytestLogEvent[] = [];
  for (const candidate of blob.events) {
    const event = validEvent(candidate);
    if (event) events.push(event);
  }
  return {
    schema: PLAYTEST_LOG_SCHEMA,
    version: PLAYTEST_LOG_VERSION,
    startedAt: typeof blob.startedAt === 'string' && blob.startedAt.length > 0 ? blob.startedAt : UNKNOWN,
    startMs,
    savedAt: typeof blob.savedAt === 'number' && Number.isFinite(blob.savedAt) ? blob.savedAt : startMs,
    dropped: typeof blob.dropped === 'number' && Number.isFinite(blob.dropped) ? Math.max(0, Math.floor(blob.dropped)) : 0,
    sawMatch: blob.sawMatch === true || events.some((e) => e.kind === 'match'),
    events,
  };
}

/** The event kinds, as a runtime set — a persisted blob is untrusted input, and a
 *  `kind` outside the union would break every `grep` and every reader downstream. */
const EVENT_KINDS: ReadonlySet<string> = new Set<PlaytestEventKind>([
  'session',
  'connect',
  'net',
  'match',
  'error',
  'note',
]);

/** One restored event, rebuilt field by field, or null if it is not one. Rebuilt
 *  rather than passed through so nothing a blob invented rides along into the ring. */
function validEvent(candidate: unknown): PlaytestLogEvent | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const e = candidate as Partial<PlaytestLogEvent>;
  if (typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at < 0) return null;
  if (typeof e.kind !== 'string' || !EVENT_KINDS.has(e.kind)) return null;
  if (typeof e.msg !== 'string') return null;
  const data = e.data !== undefined && typeof e.data === 'object' && e.data !== null ? cleanData(e.data) : undefined;
  const repeat = typeof e.repeat === 'number' && Number.isFinite(e.repeat) && e.repeat > 1 ? Math.floor(e.repeat) : undefined;
  const lastAt = repeat !== undefined && typeof e.lastAt === 'number' && Number.isFinite(e.lastAt) ? Math.max(0, Math.round(e.lastAt)) : undefined;
  return {
    at: Math.max(0, Math.round(e.at)),
    kind: e.kind,
    msg: truncate(e.msg, MAX_MESSAGE_CHARS),
    ...(data !== undefined ? { data } : {}),
    ...(repeat !== undefined ? { repeat } : {}),
    ...(lastAt !== undefined ? { lastAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// The export shape — brief §5's "stable, versioned" payload
// ---------------------------------------------------------------------------

/**
 * What a log can answer, in one field (a0-56).
 *
 * The failure this exists for: two exported logs, both schema-valid, both
 * `dropped: 0`, both carrying a confident summary line naming the build and the
 * viewport — and both containing five events of boot sequence and no match at all.
 * The Director read one of them and reported back that the session never left the
 * home screen, over the developer's own account of being in the pause menu mid-match.
 * Nothing in the file said "this log began after your match did".
 *
 *  - `'match'`     — at least one match-scoped event is in this log. It can be asked
 *    a gameplay question.
 *  - `'boot-only'` — it cannot. Whatever else is in here, the match is not.
 *
 * Derived from what was **recorded**, never from the duration: a nine-minute session
 * that spent all nine minutes on the front door is boot-only, and a match that
 * crashed four seconds in is not.
 */
export type PlaytestLogCoverage = 'boot-only' | 'match';

/** The stretch of session an export covers, in the same ms-since-start units its
 *  events carry — so `coverage` comes with the window it is a claim about. */
export interface PlaytestLogSpan {
  /** Oldest retained event's `at`. Non-zero when the ring has evicted its start. */
  readonly fromMs: number;
  /** Newest retained event's `at` (its `lastAt` where it coalesced). */
  readonly toMs: number;
}

/**
 * Exactly what a DOWNLOAD LOG produces (as JSON). Field order is deliberate: `summary`
 * is first after the schema so the very top of a paste is the human-readable line.
 */
export interface PlaytestLogExport {
  readonly schema: typeof PLAYTEST_LOG_SCHEMA;
  readonly version: number;
  /** The self-describing first line (brief §4) — also readable on its own. */
  readonly summary: string;
  /** Whether this file can answer a gameplay question at all (a0-56). */
  readonly coverage: PlaytestLogCoverage;
  /** The window {@link coverage} is a claim about. */
  readonly span: PlaytestLogSpan;
  /** How many of these events were carried across a page reload (a0-56). Zero on a
   *  session that never reloaded; non-zero is the proof the carry worked. */
  readonly restored: number;
  readonly env: PlaytestLogEnvironment;
  /** Ms of session covered by this export (the newest event's `at`). */
  readonly durationMs: number;
  /** The ring's size, so a reader knows whether truncation was possible. */
  readonly capacity: number;
  /** Events evicted by the ring before this export — honest about what is missing
   *  rather than silently presenting a partial session as a whole one. */
  readonly dropped: number;
  /** Oldest first. */
  readonly events: readonly PlaytestLogEvent[];
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/** Everything the log needs, all injectable — no ambient clock, no globals. */
export interface PlaytestLogConfig {
  readonly env?: PlaytestLogEnvironment;
  /** Wall clock, ms. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Ring size. Defaults to {@link PLAYTEST_LOG_CAPACITY}. */
  readonly capacity?: number;
  /**
   * Where the ring is mirrored so it survives a page reload (a0-56). Absent or
   * `null` — the default — is exactly today's behaviour: memory only, nothing
   * restored, nothing written. `boot()` passes the `sessionStorage` one
   * (`./playtest-log-store`); the pre-boot fallback log deliberately does not, since
   * {@link installPlaytestLog} adopts its events moments later anyway.
   */
  readonly store?: PlaytestLogStore | null;
}

/**
 * The session log: a bounded ring of structured events, plus the header that says
 * which session it is.
 *
 * Cheap enough to feed unconditionally — one object push per event, an integer
 * subtraction for the timestamp, and no formatting until export. So it runs in
 * every build, not only behind `?debug=1`: a playtest bug that only reproduces once
 * must not require the developer to have guessed beforehand that they should have
 * turned logging on.
 */
export class PlaytestLog {
  private readonly ring: PlaytestLogEvent[] = [];
  private readonly clock: () => number;
  private readonly cap: number;
  private readonly startMs: number;
  private evicted = 0;
  /** Coalescing key of the newest entry (`kind|msg|data`), for repeat detection. */
  private lastKey = '';
  private environment: PlaytestLogEnvironment;
  private readonly store: PlaytestLogStore | null;
  /** True once a match-scoped event has been seen — the whole basis of
   *  {@link PlaytestLogExport.coverage}, and it survives a reload with the events. */
  private sawMatch = false;
  /** How many events came back from storage — reported, so "it carried" is a number
   *  in the file and not an inference from the timestamps. */
  private restoredCount = 0;
  /** Clock reading of the last successful write, for the throttle. `-Infinity` so
   *  the first recorded event writes immediately rather than a quarter second late. */
  private lastWriteMs = Number.NEGATIVE_INFINITY;
  /** An event has been recorded since the last write. {@link flush} is what turns
   *  this back into a write when the page is about to go away. */
  private pendingWrite = false;
  /** Set when the store refused a write. Storage that failed once (private mode,
   *  a full quota) fails every time, and retrying it per event would spend the frame
   *  budget on a `try`/`catch` — so the log gives up, says so once on the timeline,
   *  and carries on doing everything else it does. */
  private storeFailed = false;

  constructor(config: PlaytestLogConfig = {}) {
    this.clock = config.now ?? ((): number => Date.now());
    // A capacity of 0 would make the log a silent sink, which is worse than a small
    // one: it looks like "nothing happened". One event is the floor.
    this.cap = Math.max(1, Math.floor(config.capacity ?? PLAYTEST_LOG_CAPACITY));
    this.environment = config.env ?? describeEnvironment();
    this.store = config.store ?? null;
    const now = this.clock();
    const restored = this.store ? parsePersistedLog(safeRead(this.store), now) : null;
    if (!restored) {
      this.startMs = now;
      return;
    }
    // ── A reload is not a new session (a0-56) ──────────────────────────────
    // The clock is rebased onto the ORIGINAL start, which is the only arrangement
    // where both halves of the promise hold at once: every restored event keeps the
    // exact `at` it was stamped with (verbatim, never rewritten to "now"), and
    // everything this page load records lands AFTER it on the same axis. Rebasing
    // instead of re-stamping is why a restored timeline reads as one continuous
    // session rather than two that both start at zero.
    this.startMs = restored.startMs;
    // …and the header says when the session — not this page load — began, so the
    // one absolute instant in the file still anchors `at: 0`.
    this.environment = { ...this.environment, startedAt: restored.startedAt };
    for (const event of restored.events) this.ring.push(event);
    // Carried as a FLAG, not re-derived: the previous page load may have evicted the
    // match events that set it, and a reload is not where a log forgets it had one.
    this.sawMatch = restored.sawMatch;
    // Evictions carry too: a session that has dropped 40 events across two page
    // loads has dropped 40, and the export must keep saying so.
    this.evicted = restored.dropped;
    this.trim();
    // Counted AFTER the trim, so the number is what actually came back and not what
    // was offered — a restore bigger than the ring is honest about being clipped.
    this.restoredCount = this.ring.length;
    this.record('session', 'restored after reload', {
      events: this.restoredCount,
      dropped: restored.dropped,
      // The gap the reload itself cost, so a reader can see the seam.
      gapMs: Math.max(0, Math.round(now - restored.savedAt)),
    });
  }

  /** The session's identity — the export header, and the one place a reader looks
   *  to answer "which build, on what, over what?". */
  get env(): PlaytestLogEnvironment {
    return this.environment;
  }

  /**
   * Adopt the badge string the screen is currently showing
   * (`@platform/build-identity`), so the export's `env.build` and the corner of
   * every screenshot are the same characters (ratified, M10).
   *
   * The env is rewritten rather than versioned per event: a session is on one
   * server, and a reader asking "which Machine was this?" wants one answer at the
   * top of the paste, not a field that changes value halfway down. The *moment* it
   * changed is not lost — the change is recorded as its own `session` event, on
   * the timeline, where a reconnect onto a different Machine shows up as the event
   * it is. A no-op when the tag has not moved.
   */
  setBuild(tag: string): void {
    const build = truncate(String(tag ?? ''), MAX_MESSAGE_CHARS);
    if (build === '' || build === this.environment.build) return;
    this.environment = { ...this.environment, build };
    this.record('session', 'build tag', { build });
  }

  // --- Recording ----------------------------------------------------------

  /**
   * Record one event. Truncates the message and the data on the way in, coalesces
   * an identical consecutive event into a `repeat` count, and evicts the oldest
   * entry when the ring is full (counting the eviction).
   *
   * Never throws: a logger that can break the game it is instrumenting is worse
   * than no logger, so an unserializable `data` value is dropped rather than
   * propagated.
   */
  record(kind: PlaytestEventKind, msg: string, data?: Readonly<Record<string, unknown>>): void {
    const at = Math.max(0, Math.round(this.clock() - this.startMs));
    const text = truncate(String(msg ?? ''), MAX_MESSAGE_CHARS);
    const clean = data === undefined ? undefined : cleanData(data);
    const key = `${kind}|${text}|${clean === undefined ? '' : stableKey(clean)}`;

    // Coalesce: the same line firing every frame (a warn in the render loop, a
    // reconnect attempt in a tight backoff) costs one slot and a counter.
    const last = this.ring[this.ring.length - 1];
    if (last !== undefined && key === this.lastKey) {
      this.ring[this.ring.length - 1] = {
        ...last,
        repeat: (last.repeat ?? 1) + 1,
        lastAt: at,
      };
      this.persist();
      return;
    }

    this.ring.push({
      at,
      kind,
      msg: text,
      ...(clean !== undefined ? { data: clean } : {}),
    });
    // The one bit `coverage` is made of. Set here rather than computed at export
    // time so it survives the ring evicting the match events that set it — a
    // twenty-minute session whose early match has scrolled out of a 600-slot ring
    // still knows it had one.
    if (kind === 'match') this.sawMatch = true;
    this.lastKey = key;
    this.trim();
    this.persist();
  }

  /** The session's opening lines: which build, on what device, over what network.
   *  Recorded as events as well as living in the header, so the timeline itself
   *  starts with the answer to "which build was this?". */
  recordSessionStart(): void {
    this.record('session', 'session start', {
      build: this.env.build,
      sha: this.env.sha,
      buildTime: this.env.buildTime,
      dirty: this.env.dirty,
      startedAt: this.env.startedAt,
      form: this.env.formFactor,
      viewport: this.env.viewport,
      touch: this.env.touch,
      connection: this.env.connection,
      schema: `${PLAYTEST_LOG_SCHEMA}/${PLAYTEST_LOG_VERSION}`,
    });
  }

  /** One step of the connection lifecycle — `allocate`, `ticket`, `dial`,
   *  `welcome`, `joinError`, a transport state change (brief §1). */
  recordConnect(step: string, data?: Readonly<Record<string, unknown>>): void {
    this.record('connect', step, data);
  }

  /** A match moment: spawn, death, substitution, reclaim, end (brief §1). */
  recordMatch(event: string, data?: Readonly<Record<string, unknown>>): void {
    this.record('match', event, data);
  }

  /** A console error/warning from our code, or an uncaught one
   *  (`./playtest-log-capture`). */
  recordError(level: 'error' | 'warn', msg: string, data?: Readonly<Record<string, unknown>>): void {
    this.record('error', `${level}: ${msg}`, data);
  }

  /** A free-form marker — a developer note, a boot detail. */
  recordNote(msg: string, data?: Readonly<Record<string, unknown>>): void {
    this.record('note', msg, data);
  }

  /**
   * Take an already-stamped event verbatim, keeping its original `at`. The one use
   * is {@link installPlaytestLog} carrying the pre-boot fallback log's events into
   * the described one — re-`record`ing them would re-stamp their timestamps to
   * "now" and quietly rewrite the timeline. Bounded by the same ring.
   */
  adopt(event: PlaytestLogEvent, offsetMs = 0): void {
    // `offsetMs` translates between two logs' origins; it does NOT re-stamp. The
    // event's absolute instant is preserved exactly — only the origin it is measured
    // from changes, which is what a restored log's rebased clock requires (a0-56).
    // Clamped at zero: an event that predates the destination log's origin is at its
    // very beginning, and a negative `at` is not a point on any timeline.
    const shifted =
      offsetMs === 0
        ? event
        : {
            ...event,
            at: Math.max(0, Math.round(event.at + offsetMs)),
            ...(event.lastAt !== undefined ? { lastAt: Math.max(0, Math.round(event.lastAt + offsetMs)) } : {}),
          };
    this.ring.push(shifted);
    if (shifted.kind === 'match') this.sawMatch = true;
    // An adopted event is never the coalescing partner of the next recorded one:
    // clearing the key keeps a carried-over line from absorbing a fresh occurrence
    // and mis-stating when it happened.
    this.lastKey = '';
    this.trim();
    this.persist();
  }

  /**
   * Write the ring to the {@link PlaytestLogStore} now, ignoring the throttle.
   *
   * Called at the two moments the tail of the log is about to become the only part
   * that matters: the page going away (`pagehide` — a reload, a navigation to the
   * menu, a tab closing) and an export being taken. Everywhere else the throttle is
   * the right trade; here, a quarter second of missing tail is the last quarter
   * second before the thing the developer is reporting.
   *
   * A no-op with no store, with nothing new since the last write, or once storage
   * has refused one. Never throws.
   */
  flush(): void {
    if (this.pendingWrite) this.persist(true);
  }

  /** Bring the ring back inside its budget, counting what that cost. */
  private trim(): void {
    while (this.ring.length > this.cap) {
      this.ring.shift();
      this.evicted++;
    }
  }

  /**
   * Mirror the ring into storage, at most once every
   * {@link PLAYTEST_LOG_WRITE_INTERVAL_MS} unless forced.
   *
   * Everything about this is defensive. The store cannot throw by contract, and is
   * wrapped anyway; a refused write disables persistence for the rest of the session
   * and files ONE line saying so — because the alternative is the a0-56 failure in a
   * new coat, a log that quietly lacks half a session and looks complete.
   */
  private persist(force = false): void {
    if (!this.store || this.storeFailed) return;
    const now = this.clock();
    if (!force && now - this.lastWriteMs < PLAYTEST_LOG_WRITE_INTERVAL_MS) {
      this.pendingWrite = true;
      return;
    }
    this.pendingWrite = false;
    this.lastWriteMs = now;
    let ok = false;
    try {
      ok = this.store.write(
        serializePersistedLog({
          schema: PLAYTEST_LOG_SCHEMA,
          version: PLAYTEST_LOG_VERSION,
          startedAt: this.environment.startedAt,
          startMs: this.startMs,
          savedAt: now,
          dropped: this.evicted,
          sawMatch: this.sawMatch,
          events: this.ring,
        }),
      );
    } catch {
      ok = false; // A store is contracted not to throw; a broken one still may not win.
    }
    if (ok) return;
    // Set BEFORE recording, or the note below re-enters this method forever.
    this.storeFailed = true;
    this.record('session', 'log persistence unavailable', { events: this.ring.length });
  }

  // --- Reading ------------------------------------------------------------

  /** Events currently held, oldest first. */
  get events(): readonly PlaytestLogEvent[] {
    return this.ring;
  }

  /** How many events the ring dropped to stay inside its budget. */
  get dropped(): number {
    return this.evicted;
  }

  /** The ring's size. */
  get capacity(): number {
    return this.cap;
  }

  /** The clock reading every event's `at` is measured from. On a restored log this
   *  is the ORIGINAL session's origin, not this page load's — which is what lets a
   *  caller translate another log's events onto this one's axis ({@link adopt}). */
  get startedAtMs(): number {
    return this.startMs;
  }

  /** Whether this log contains a match at all (a0-56). The one field that separates
   *  "the session did nothing" from "this file was opened after the fact". */
  get coverage(): PlaytestLogCoverage {
    return this.sawMatch ? 'match' : 'boot-only';
  }

  /** How many events were carried in from a previous page load. */
  get restored(): number {
    return this.restoredCount;
  }

  /** The window this log's events actually cover. */
  get span(): PlaytestLogSpan {
    const oldest = this.ring[0];
    const newest = this.ring[this.ring.length - 1];
    return {
      fromMs: oldest ? oldest.at : 0,
      toMs: newest ? (newest.lastAt ?? newest.at) : 0,
    };
  }

  /**
   * The self-describing first line (brief §4). Build sha (with the dirty marker the
   * badge uses), the session's date, the form factor and viewport, and the
   * connection type — so a pasted log needs no follow-up question about the build.
   */
  summaryLine(): string {
    // The badge string, so the first line of a paste names the build AND the
    // server exactly as the screenshot beside it does (M10). It already carries
    // the dirty marker (`displaySha`), which is why the sha is not re-formatted.
    return (
      `Planet Rush playtest log — build ${this.env.build} (${this.env.buildTime})` +
      ` · session ${this.env.startedAt}` +
      ` · ${this.env.formFactor} ${this.env.viewport}${this.env.touch ? ' touch' : ''}` +
      ` · net ${this.env.connection}` +
      // a0-56: the coverage marker rides in the summary, not only in the payload,
      // because the summary is the line a reader (and a Director) reads first — and
      // the last two logs read confidently while containing no match at all.
      ` · ${this.coverageLine()}` +
      ` · ${PLAYTEST_LOG_SCHEMA}/${PLAYTEST_LOG_VERSION}`
    );
  }

  /** The coverage clause of {@link summaryLine}, in words rather than in a field
   *  name: what this log covers, and — when it covers no match — what that means. */
  coverageLine(): string {
    const { fromMs, toMs } = this.span;
    const window = `covers ${formatSeconds(fromMs)}–${formatSeconds(toMs)}`;
    return this.sawMatch
      ? `coverage match · ${window}`
      : `coverage BOOT-ONLY (no match in this log — it cannot answer a gameplay question) · ${window}`;
  }

  /** The whole export payload — the stable, versioned shape a paste carries. */
  snapshot(): PlaytestLogExport {
    const newest = this.ring[this.ring.length - 1];
    return {
      schema: PLAYTEST_LOG_SCHEMA,
      version: PLAYTEST_LOG_VERSION,
      summary: this.summaryLine(),
      // Third and fourth, right under the summary: whether this file can answer a
      // gameplay question, and over what window (a0-56).
      coverage: this.coverage,
      span: this.span,
      restored: this.restoredCount,
      env: this.env,
      durationMs: newest ? (newest.lastAt ?? newest.at) : 0,
      capacity: this.cap,
      dropped: this.evicted,
      events: this.ring.slice(),
    };
  }

  /** The export as JSON text — what the downloaded file carries.
   *  Indented by two: a human is the first reader of this. */
  toJson(): string {
    // An export is one of the two moments the tail matters (see {@link flush}): the
    // developer is exporting BECAUSE something just happened, and a page that
    // reloads a second later must not lose the last quarter second of it.
    this.flush();
    return JSON.stringify(this.snapshot(), null, 2);
  }
}

// ---------------------------------------------------------------------------
// The shared instance
// ---------------------------------------------------------------------------

let shared: PlaytestLog | null = null;

/**
 * The session's log. Created on first use with an empty (all-`unknown`) header, so
 * a module that logs before boot has described the page still records — a lost line
 * is worse than an unlabelled one. `boot()` calls {@link installPlaytestLog} early
 * with the real build stamp and device description.
 */
export function playtestLog(): PlaytestLog {
  shared ??= new PlaytestLog();
  return shared;
}

/**
 * Install the session's log, described by a probe of the page, and record its
 * opening line. Any events the pre-boot fallback already collected are carried over
 * so nothing recorded before the page could be described is lost.
 *
 * Returns the installed log, so `boot()` can hold it directly.
 */
export function installPlaytestLog(config: PlaytestLogConfig = {}): PlaytestLog {
  const previous = shared;
  // The constructor is what restores a previous PAGE LOAD's events from
  // `config.store`, and it does so before this line returns — so they are already
  // under the session start below, oldest first, on the rebased clock (a0-56).
  const log = new PlaytestLog(config);
  log.recordSessionStart();
  // Verbatim, not re-recorded: an adopted event keeps the instant it happened at,
  // so carrying the pre-boot log over does not rewrite its timeline to "now". The
  // offset is a change of ORIGIN, not of instant: the fallback log measured its
  // events from its own construction, and a restored log's origin is an earlier
  // session's start, so without this the pre-boot lines would land at the very
  // beginning of a timeline they belong at the end of.
  if (previous) {
    // Two logs only share an axis if they share a clock. The fallback log uses the
    // ambient `Date.now`; a caller injecting its own (every test, and any harness
    // driving a fixed clock) does not — and a shift computed across two unrelated
    // timebases is an arbitrarily large number, not a translation. Anything outside
    // the window a restore is allowed to span means the two origins are not
    // comparable, so the events are adopted flat, exactly as they were before a0-56.
    const raw = previous.startedAtMs - log.startedAtMs;
    const offset = Number.isFinite(raw) && Math.abs(raw) <= MAX_RESTORE_AGE_MS ? raw : 0;
    for (const event of previous.events) log.adopt(event, offset);
  }
  shared = log;
  return log;
}

/**
 * Drop the shared instance.
 *
 * For tests, so one spec's events cannot leak into the next one's assertions — and,
 * with a {@link PlaytestLogStore} left intact around it, this is also **how a reload
 * is simulated**: the singleton dies exactly as it does when the page goes away, and
 * the next {@link installPlaytestLog} has nothing but storage to rebuild from
 * (a0-56, `playtest-log.test.ts` "survives a reload").
 */
export function resetPlaytestLog(): void {
  shared = null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Read a store without trusting it to honour its own contract. */
function safeRead(store: PlaytestLogStore): string | null {
  try {
    return store.read();
  } catch {
    return null;
  }
}

/** `312400` → `312.4s`. One decimal: a log's timeline is read in seconds, and the
 *  ms live in the events themselves. */
function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function nonEmpty(s: string | undefined): string | undefined {
  if (typeof s !== 'string') return undefined;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Truncate with a visible ellipsis, so a reader can tell "long" from "cut". */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Flatten arbitrary `data` into scalars, bounded in both keys and value length.
 * Anything that is not a scalar is described rather than serialized (`[object]`) —
 * this log is a timeline, not a heap dump, and a nested graph is how a "small"
 * logger becomes a memory leak. Returns `undefined` when nothing survived.
 */
function cleanData(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, PlaytestLogValue>> | undefined {
  const out: Record<string, PlaytestLogValue> = {};
  let kept = 0;
  for (const key of Object.keys(data)) {
    if (kept >= MAX_DATA_KEYS) break;
    const value = data[key];
    if (value === undefined) continue;
    out[key] = scalar(value);
    kept++;
  }
  return kept > 0 ? out : undefined;
}

function scalar(value: unknown): PlaytestLogValue {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return truncate(value, MAX_VALUE_CHARS);
    case 'number':
      // A NaN/Infinity would serialize to `null` and read as "absent"; name it.
      return Number.isFinite(value) ? round3(value) : String(value);
    case 'boolean':
      return value;
    default:
      return `[${typeof value}]`;
  }
}

/** Three decimals is plenty for anything a log reports (ms, world units, rates),
 *  and it keeps a float from spending 18 characters on precision nobody reads. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A stable string for the coalescing comparison — key order independent, so two
 *  identical events built in different key orders still coalesce. */
function stableKey(data: Readonly<Record<string, PlaytestLogValue>>): string {
  return Object.keys(data)
    .sort()
    .map((k) => `${k}=${String(data[k])}`)
    .join(',');
}
