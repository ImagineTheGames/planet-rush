/**
 * src/net/connect-trace.ts — the connecting screen, out loud. OWNER: Netcode
 * Engineer (GDD §4.2; M10, the developer's twice-repeated ask).
 *
 * The old connecting screen said `CONNECTING…` and nothing else, from the first
 * tap until either a lobby appeared or it did not. That single word covers five
 * distinct things that can each fail on their own — reaching the allocator,
 * getting a room and a signed ticket, opening a socket to the Machine the ticket
 * names, being seated, and the redial when the first dial does not take — so when
 * one of them broke (the machine-pin, M10) the screen had exactly one thing to
 * say about it, and the developer sat watching a word that was true and useless.
 *
 * This module is the fix, and it is deliberately *pure*: a state machine plus the
 * lines it produces, with no DOM, no clock of its own and no transport. It reads
 * as a story the player can follow while it happens —
 *
 *     ALLOCATING ROOM…
 *     ROOM Q5RN · TICKET SIGNED
 *     DIALING MACHINE 0800d5b6…
 *     HANDING OFF (replay)…
 *     JOINED · SEAT 2
 *
 * — or stops on the exact failure, in the server's own words:
 *
 *     REFUSED: bad-ticket — machine mismatch
 *
 * Two rules the shape enforces:
 *
 *   • **Nothing is claimed before it happens.** Each step is appended when the
 *     event actually occurs, so a screen showing "TICKET SIGNED" means a ticket
 *     was signed. A screen stuck on "ALLOCATING ROOM…" is itself the diagnosis.
 *   • **A stall is a state, not a silence.** {@link STALL_MS} without progress
 *     flips {@link ConnectTraceModel.stalled}, which is what auto-offers COPY LOG
 *     — the report gets made while the developer is still looking at the failure.
 *
 * Every step also lands in the session log through {@link connectTraceLogEntry}
 * (the m10-09b `connect` channel, `./playtest-log` `recordConnect`), so the screen
 * and the pasted log tell the same story in the same order.
 *
 * The view that draws this is `./connect-trace-view`; `src/main.ts` drives it from
 * the real allocator round trip and the real transport.
 */

import type { ConnectionState } from './transport';

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * Where a connection attempt has got to. The order is the happy path; `handoff`
 * is the one that may repeat, and the last three are terminal.
 */
export type ConnectStage =
  /** Asking the allocator for a room (`POST /rooms` or `/rooms/:code/join`). */
  | 'allocating'
  /** The allocator answered: a room code and a signed ticket are in hand. */
  | 'ticketed'
  /** A socket is being opened to the endpoint the allocator named. */
  | 'dialing'
  /** The first dial did not take and we are going round again (see below). */
  | 'handoff'
  /** Seated: the server's `welcome` arrived with a slot. */
  | 'joined'
  /** The server refused the join outright — terminal, and it says why. */
  | 'refused'
  /** The attempt failed before a join was even offered (allocator, network). */
  | 'failed';

/** Terminal stages — nothing further will happen without another tap. */
const TERMINAL: ReadonlySet<ConnectStage> = new Set(['joined', 'refused', 'failed']);

/** How long a stage may sit without progress before the screen offers COPY LOG.
 *  Five seconds is the brief's number, and it is about right: a healthy allocate
 *  plus dial is well under a second, so five is "something is wrong" and not
 *  "the network is being slow". */
export const STALL_MS = 5_000;

/** How many characters of a Machine id the screen shows. A Fly id is long, and the
 *  first eight are enough to tell one Machine from another in a bug report. */
export const MACHINE_ID_CHARS = 8;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** One line of the story, as it was appended. */
export interface ConnectStep {
  readonly stage: ConnectStage;
  /** The line the screen shows, already in its final wording. */
  readonly line: string;
  /** Epoch-ms the step was appended — the caller's clock, never ours. */
  readonly at: number;
  /** Structured detail for the session log; never rendered. */
  readonly data: Readonly<Record<string, unknown>>;
}

/** The whole attempt so far. Immutable: every transition returns a new value, so a
 *  render is a comparison and a stale trace cannot be mutated under a screen. */
export interface ConnectTrace {
  readonly steps: readonly ConnectStep[];
  readonly stage: ConnectStage;
  /** When the current stage began — the clock a stall is measured from. */
  readonly since: number;
  /** How many times the dial has gone round (0 on the first). */
  readonly dials: number;
}

/** A fresh attempt, beginning at the allocator. `door` is CREATE or JOIN. */
export function beginConnect(door: 'create' | 'join', at: number, allocator?: string): ConnectTrace {
  return advance(
    { steps: [], stage: 'allocating', since: at, dials: 0 },
    {
      stage: 'allocating',
      line: door === 'create' ? 'ALLOCATING ROOM…' : 'FINDING ROOM…',
      at,
      data: { door, ...(allocator !== undefined ? { allocator } : {}) },
    },
  );
}

/** The allocator answered: a room, a Machine, and a signed ticket. */
export function connectTicketed(
  trace: ConnectTrace,
  info: { room: string; machine: string; region?: string; expiresInMs?: number | null },
  at: number,
): ConnectTrace {
  return advance(trace, {
    stage: 'ticketed',
    line: `ROOM ${info.room} · TICKET SIGNED`,
    at,
    data: {
      room: info.room,
      machine: info.machine,
      ...(info.region !== undefined ? { region: info.region } : {}),
      ...(info.expiresInMs != null ? { expiresInMs: info.expiresInMs } : {}),
    },
  });
}

/** The socket is being opened. Names the Machine, because "which Machine?" is the
 *  first question every join bug in this game has turned out to hinge on. */
export function connectDialing(
  trace: ConnectTrace,
  info: { machine: string; host?: string; room?: string },
  at: number,
): ConnectTrace {
  return advance(trace, {
    stage: 'dialing',
    line: `DIALING MACHINE ${shortMachine(info.machine)}…`,
    at,
    data: {
      machine: info.machine,
      ...(info.host !== undefined ? { host: info.host } : {}),
      ...(info.room !== undefined ? { room: info.room } : {}),
    },
  });
}

/**
 * The dial did not take on the first try and the transport is going round again.
 *
 * **What this does and does not mean.** Fly's own `fly-replay` hand-off is settled
 * *before* the 101 (`server/upgrade-router.ts`), so a browser never sees it — one
 * `WebSocket`, one `open`. What this step names is the hand-off the *client* can
 * actually witness: a socket that closed before a `welcome` and a redial inside the
 * grace window (`./websocket-transport`). That is the client-side shape of the same
 * problem, and it is the one that used to be invisible — the state in which the old
 * screen kept saying `CONNECTING…` while the transport quietly burned sixty seconds.
 */
export function connectHandoff(trace: ConnectTrace, at: number, why?: string): ConnectTrace {
  const dials = trace.dials + 1;
  return {
    ...advance(trace, {
      stage: 'handoff',
      line: `HANDING OFF (replay)…${dials > 1 ? ` ${dials}` : ''}`,
      at,
      data: { attempt: dials, ...(why !== undefined ? { why } : {}) },
    }),
    dials,
  };
}

/** Seated. The end of the happy path, and the line a screenshot should show. */
export function connectJoined(trace: ConnectTrace, seat: number, at: number): ConnectTrace {
  return advance(trace, {
    stage: 'joined',
    line: `JOINED · SEAT ${seat + 1}`,
    at,
    data: { seat },
  });
}

/**
 * The server refused the join, verbatim plus a plain-words gloss:
 *
 *     REFUSED: bad-ticket — machine mismatch
 *
 * The raw reason is kept first because that is the token a bug report needs to be
 * greppable; the gloss follows because `bad-ticket` tells a player nothing.
 */
export function connectRefused(trace: ConnectTrace, reason: string, at: number): ConnectTrace {
  const gloss = refusalGloss(reason);
  return advance(trace, {
    stage: 'refused',
    line: `REFUSED: ${reason}${gloss ? ` — ${gloss}` : ''}`,
    at,
    data: { reason },
  });
}

/** The attempt died before the server ever got a chance to refuse it — the
 *  allocator was unreachable, full, or answered with nonsense. */
export function connectFailed(trace: ConnectTrace, reason: string, at: number): ConnectTrace {
  return advance(trace, {
    stage: 'failed',
    line: `FAILED: ${reason}`,
    at,
    data: { reason },
  });
}

/**
 * A transport state change, mapped onto the trace. `reconnecting` before a seat is
 * a hand-off; `closed` before a seat is a failure that names its close reason.
 * After a seat this is the lobby's problem, not the connecting screen's, so the
 * trace is returned untouched.
 */
export function connectTransportState(
  trace: ConnectTrace,
  state: ConnectionState,
  at: number,
  closeReason?: string | null,
): ConnectTrace {
  if (TERMINAL.has(trace.stage)) return trace;
  if (state === 'reconnecting') return connectHandoff(trace, at, closeReason ?? 'socket dropped');
  if (state === 'closed') return connectFailed(trace, closeReason ?? 'connection closed', at);
  return trace;
}

// ---------------------------------------------------------------------------
// The frame model
// ---------------------------------------------------------------------------

/** What the view draws for one frame. Everything it needs, nothing it decides. */
export interface ConnectTraceModel {
  /** Every step so far, in order, oldest first — the story as it happened. */
  readonly lines: readonly string[];
  /** The line the player is waiting on (the last one), or `''` before the first. */
  readonly current: string;
  readonly stage: ConnectStage;
  /** True while the attempt is still moving — the view shows a live indicator. */
  readonly busy: boolean;
  /** The failure line, or `''` — refusals and failures only, drawn in threat red. */
  readonly error: string;
  /** No progress for {@link STALL_MS}. Auto-offers COPY LOG (brief §2). */
  readonly stalled: boolean;
  /** Milliseconds the current stage has been sitting, for a "…12s" tail. */
  readonly waitedMs: number;
  /** Offer RETRY: a terminal failure that another attempt could plausibly fix. */
  readonly canRetry: boolean;
  /** Offer COPY LOG: any failure, or any stall. */
  readonly offerCopyLog: boolean;
}

/** Build the frame model. Pure — `now` is the caller's clock, so a five-second
 *  stall is a test that runs instantly. */
export function connectTraceModel(trace: ConnectTrace, now: number): ConnectTraceModel {
  const last = trace.steps[trace.steps.length - 1];
  const terminal = TERMINAL.has(trace.stage);
  const waitedMs = Math.max(0, now - trace.since);
  const stalled = !terminal && waitedMs >= STALL_MS;
  const failed = trace.stage === 'refused' || trace.stage === 'failed';
  return {
    lines: trace.steps.map((s) => s.line),
    current: last?.line ?? '',
    stage: trace.stage,
    busy: !terminal,
    error: failed ? (last?.line ?? '') : '',
    stalled,
    waitedMs,
    canRetry: failed,
    offerCopyLog: failed || stalled,
  };
}

/**
 * The line the COPY LOG affordance shows above itself, so the offer names what it
 * is offering to report rather than appearing out of nowhere
 * (`./playtest-log-button` `CopyLogOffer.hint`).
 */
export function connectOfferHint(model: ConnectTraceModel): string {
  if (model.error) return `${model.error} — COPY LOG to report this.`;
  if (model.stalled) {
    return `Stuck on "${model.current}" for ${Math.round(model.waitedMs / 1000)}s — COPY LOG to report this.`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// The session log
// ---------------------------------------------------------------------------

/** One step, in the shape `PlaytestLog.recordConnect(step, data)` takes — so every
 *  line the player read is also a line in the pasted log, in the same order and
 *  with the structured detail the screen had no room for (m10-09b `connect`). */
export function connectTraceLogEntry(step: ConnectStep): {
  step: string;
  data: Readonly<Record<string, unknown>>;
} {
  return { step: step.stage, data: { ...step.data, line: step.line } };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Append a step and move the stage clock. */
function advance(trace: ConnectTrace, step: ConnectStep): ConnectTrace {
  return { ...trace, steps: [...trace.steps, step], stage: step.stage, since: step.at };
}

/** The first {@link MACHINE_ID_CHARS} of a Machine id, or `?` when there is none
 *  (a direct-connect server the allocator never named). */
export function shortMachine(machine: string): string {
  if (machine.length === 0) return '?';
  return machine.length <= MACHINE_ID_CHARS ? machine : machine.slice(0, MACHINE_ID_CHARS);
}

/**
 * Plain words for the server's refusal token (`server/match-server.ts`
 * `JoinErrorMessage.reason`). Unknown reasons get no gloss rather than a guess —
 * the token is still shown, and inventing an explanation for a reason this build
 * does not know is worse than saying nothing.
 */
export function refusalGloss(reason: string): string {
  switch (reason) {
    case 'bad-ticket':
      // The M10 failure, named the way the fix is named: the upgrade landed on a
      // Machine that does not host this room and was not handed on.
      return 'machine mismatch';
    case 'bad-room-code':
      return 'that code is not a room code';
    case 'room-full':
      return 'every seat is taken';
    case 'match-live':
      return 'that match already started';
    case 'reclaim-unknown':
      return 'that match has ended';
    case 'reclaim-expired':
      return 'your reconnect window ran out';
    case 'reclaim-denied':
      return 'that seat is not yours';
    default:
      return '';
  }
}
