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
 * Five properties the brief fixes, and this file is where four of them live:
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
 *
 * The fifth — **local-only** — is a property of what this file *does not have*: no
 * `fetch`, no socket, no storage. Nothing here can send anything anywhere. Export
 * is a deliberate gesture the developer makes (`./playtest-log-export`), never an
 * upload (brief §3).
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
  return {
    sha: nonEmpty(probe.sha) ?? UNKNOWN,
    buildTime: nonEmpty(probe.buildTime) ?? UNKNOWN,
    dirty: probe.dirty ?? false,
    startedAt: nonEmpty(probe.startedAt) ?? UNKNOWN,
    formFactor: classifyFormFactor(width, height, touch),
    viewport: `${width}x${height}`,
    touch,
    connection: normalizeConnectionType(probe.connectionType, probe.online ?? true),
  };
}

// ---------------------------------------------------------------------------
// The export shape — brief §5's "stable, versioned" payload
// ---------------------------------------------------------------------------

/**
 * Exactly what a COPY LOG produces (as JSON). Field order is deliberate: `summary`
 * is first after the schema so the very top of a paste is the human-readable line.
 */
export interface PlaytestLogExport {
  readonly schema: typeof PLAYTEST_LOG_SCHEMA;
  readonly version: number;
  /** The self-describing first line (brief §4) — also readable on its own. */
  readonly summary: string;
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

  readonly env: PlaytestLogEnvironment;

  constructor(config: PlaytestLogConfig = {}) {
    this.clock = config.now ?? ((): number => Date.now());
    // A capacity of 0 would make the log a silent sink, which is worse than a small
    // one: it looks like "nothing happened". One event is the floor.
    this.cap = Math.max(1, Math.floor(config.capacity ?? PLAYTEST_LOG_CAPACITY));
    this.env = config.env ?? describeEnvironment();
    this.startMs = this.clock();
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
      return;
    }

    this.ring.push({
      at,
      kind,
      msg: text,
      ...(clean !== undefined ? { data: clean } : {}),
    });
    this.lastKey = key;
    while (this.ring.length > this.cap) {
      this.ring.shift();
      this.evicted++;
    }
  }

  /** The session's opening lines: which build, on what device, over what network.
   *  Recorded as events as well as living in the header, so the timeline itself
   *  starts with the answer to "which build was this?". */
  recordSessionStart(): void {
    this.record('session', 'session start', {
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
  adopt(event: PlaytestLogEvent): void {
    this.ring.push(event);
    // An adopted event is never the coalescing partner of the next recorded one:
    // clearing the key keeps a carried-over line from absorbing a fresh occurrence
    // and mis-stating when it happened.
    this.lastKey = '';
    while (this.ring.length > this.cap) {
      this.ring.shift();
      this.evicted++;
    }
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

  /**
   * The self-describing first line (brief §4). Build sha (with the dirty marker the
   * badge uses), the session's date, the form factor and viewport, and the
   * connection type — so a pasted log needs no follow-up question about the build.
   */
  summaryLine(): string {
    const sha = this.env.dirty ? `${this.env.sha}*` : this.env.sha;
    return (
      `Planet Rush playtest log — build ${sha} (${this.env.buildTime})` +
      ` · session ${this.env.startedAt}` +
      ` · ${this.env.formFactor} ${this.env.viewport}${this.env.touch ? ' touch' : ''}` +
      ` · net ${this.env.connection}` +
      ` · ${PLAYTEST_LOG_SCHEMA}/${PLAYTEST_LOG_VERSION}`
    );
  }

  /** The whole export payload — the stable, versioned shape a paste carries. */
  snapshot(): PlaytestLogExport {
    const newest = this.ring[this.ring.length - 1];
    return {
      schema: PLAYTEST_LOG_SCHEMA,
      version: PLAYTEST_LOG_VERSION,
      summary: this.summaryLine(),
      env: this.env,
      durationMs: newest ? (newest.lastAt ?? newest.at) : 0,
      capacity: this.cap,
      dropped: this.evicted,
      events: this.ring.slice(),
    };
  }

  /** The export as JSON text — what the clipboard and the download file carry.
   *  Indented by two: a human is the first reader of this. */
  toJson(): string {
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
  const log = new PlaytestLog(config);
  log.recordSessionStart();
  // Verbatim, not re-recorded: an adopted event keeps the instant it happened at,
  // so carrying the pre-boot log over does not rewrite its timeline to "now".
  if (previous) for (const event of previous.events) log.adopt(event);
  shared = log;
  return log;
}

/** Drop the shared instance — for tests, so one spec's events cannot leak into
 *  the next one's assertions. */
export function resetPlaytestLog(): void {
  shared = null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

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
