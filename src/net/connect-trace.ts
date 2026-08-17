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
 * as a story the player can follow while it happens, **in the connecting screen's
 * title** — the one big line at the top that used to read `CONNECTING…` and now
 * reads whatever is actually happening ({@link connectTitleLine}; the developer's
 * third pass: "show it at the top where it says CONNECTING… we don't need a
 * separate pop-up for it") —
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
 *   • **A stall is a state, not a silence.** {@link STALL_MS} in *one* state flips
 *     {@link ConnectTraceModel.stalled}, which is what auto-offers DOWNLOAD LOG — the
 *     report gets made while the developer is still looking at the failure.
 *
 * **What a stall is measured against** (m10-15, the developer: *"I joined a room but
 * it said to copy logs as if an error occurred — it showed up too early"*). The clock
 * is **time in the CURRENT state**, never time since the tap:
 *
 *   1. Every advance resets it — including the ones that add no line. The socket
 *      opening is the case that produced the bug report: it is real progress the
 *      story has nothing new to say about ({@link connectProgress}), and it used to
 *      be thrown away, so a healthy join whose Machine was cold spent one long
 *      `dialing` clock covering both the dial *and* the server's join handling, and
 *      crossed five seconds while it was still working. A slow-but-advancing connect
 *      is a slow connect, not a stall, however long it takes overall.
 *   2. A success cancels outright. `joined` withdraws a due offer — and one already
 *      on screen — in the same frame the seat arrives, because the one thing the
 *      offer must never do is ask a player who just got in to report a bug.
 *
 * Every step also lands in the session log through {@link connectTraceLogEntry}
 * (the m10-09b `connect` channel, `./playtest-log` `recordConnect`), so the screen
 * and the pasted log tell the same story in the same order.
 *
 * **Where it is drawn.** The title itself: `src/main.ts` feeds
 * {@link connectTitleLine} to the entry screen's title slot (`src/ui/lobby-entry`
 * `entryModel(state, narration)`), so there is exactly ONE text element and it is
 * the big one at the top. `./connect-trace-view` is no longer a panel of its own —
 * it is reduced to the two affordances a failure needs, RETRY and DOWNLOAD LOG, sitting
 * under that title. `src/main.ts` drives both from the real allocator round trip
 * and the real transport.
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

/** How long **one state** may sit without progress before the screen offers
 *  DOWNLOAD LOG. Five seconds is the brief's number, and it is about right *for a single
 *  state*: a healthy allocate is well under a second, so five in one of them is
 *  "something is wrong" and not "the network is being slow". It is emphatically not
 *  a budget for the whole join — see the module note on the m10-15 report. */
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
  /**
   * When the current state began — the clock, and the *only* clock, a stall is
   * measured from. Reset by every advance: the narrated ones that append a step,
   * and the silent ones that do not ({@link connectProgress}). Never the time of
   * the tap, so a connect that keeps moving never accumulates a stall.
   */
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

/**
 * The allocator answered: a room, a Machine, and a signed ticket.
 *
 * `placement` is the allocator's reason for choosing *that* Machine
 * (`./allocator-client` `ConnectionPlacement.detail` — `gru — your region`,
 * `iad — gru full`). It rides in the step's structured data, so a pasted session
 * log answers "why am I on a US server?" on its own; the *line* stays as it was,
 * because the screen has one title and a routing rationale is not what a player
 * waiting to connect needs it to say.
 */
export function connectTicketed(
  trace: ConnectTrace,
  info: {
    room: string;
    machine: string;
    region?: string;
    expiresInMs?: number | null;
    placement?: string;
  },
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
      ...(info.placement !== undefined ? { placement: info.placement } : {}),
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
 * The attempt moved forward with **nothing new to say**: the state clock starts
 * over, no line is appended, the story reads exactly as it did.
 *
 * This exists because the stall clock and the narration are not the same thing.
 * Some advances are worth a line ("TICKET SIGNED") and some are not — the socket
 * opening is progress the player can neither read nor act on, and giving it a step
 * of its own would put a line on screen that says less than the one above it. But
 * throwing it away entirely is what produced the m10-15 report: the `dialing` clock
 * then covered the dial *and* everything the server did afterwards, so a cold
 * Machine that took three seconds to answer and three more to seat the player
 * crossed {@link STALL_MS} on a join that was working the whole time, and the
 * screen asked a player who was about to get in to file a bug.
 *
 * No-op on a finished attempt — nothing advances past a seat or a refusal.
 */
export function connectProgress(trace: ConnectTrace, at: number): ConnectTrace {
  if (TERMINAL.has(trace.stage)) return trace;
  if (at <= trace.since) return trace; // a clock that only ever moves forward
  return { ...trace, since: at };
}

/**
 * A transport state change, mapped onto the trace. `open` before a seat is silent
 * progress (above); `reconnecting` before a seat is a hand-off; `closed` before a
 * seat is a failure that names its close reason. After a seat this is the lobby's
 * problem, not the connecting screen's, so the trace is returned untouched.
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
  // The socket is up and the join has gone out with it (`./websocket-transport`
  // sends `join` *before* announcing `open`). Still no seat, so still no line —
  // but the dial is over, and the clock that decides "stuck" belongs to what is
  // happening NOW, which is waiting on the server rather than reaching it.
  if (state === 'open') return connectProgress(trace, at);
  return trace;
}

// ---------------------------------------------------------------------------
// The frame model
// ---------------------------------------------------------------------------

/** What the view draws for one frame. Everything it needs, nothing it decides. */
export interface ConnectTraceModel {
  /** Every step so far, in order, oldest first — the story as it happened. Kept
   *  for the session log and the tests; the *screen* shows only the current one,
   *  because the screen has one title and the log has the history. */
  readonly lines: readonly string[];
  /** The line the player is waiting on (the last one), or `''` before the first.
   *  This is what the title says — see {@link connectTitleLine}. */
  readonly current: string;
  readonly stage: ConnectStage;
  /** True while the attempt is still moving — the view shows a live indicator. */
  readonly busy: boolean;
  /** The failure line, or `''` — refusals and failures only, drawn in threat red. */
  readonly error: string;
  /** {@link STALL_MS} in the CURRENT state with no advance of any kind. Auto-offers
   *  DOWNLOAD LOG (brief §2). Always false once the attempt has finished — a seat, a
   *  refusal and a failure are all endings, and an ending is not a stall. */
  readonly stalled: boolean;
  /** Milliseconds the current *state* has been sitting, for a "…12s" tail. Zero
   *  again after every advance, narrated or silent. */
  readonly waitedMs: number;
  /** Offer RETRY: a terminal failure that another attempt could plausibly fix. */
  readonly canRetry: boolean;
  /** Offer DOWNLOAD LOG: any failure, or any stall. */
  readonly offerDownloadLog: boolean;
}

/** Build the frame model. Pure — `now` is the caller's clock, so a five-second
 *  stall is a test that runs instantly. */
export function connectTraceModel(trace: ConnectTrace, now: number): ConnectTraceModel {
  const last = trace.steps[trace.steps.length - 1];
  const terminal = TERMINAL.has(trace.stage);
  // Time in the CURRENT state — `trace.since`, which every advance resets — and
  // never time since the attempt began. See the module note (m10-15).
  const waitedMs = Math.max(0, now - trace.since);
  const stalled = !terminal && waitedMs >= STALL_MS;
  const failed = trace.stage === 'refused' || trace.stage === 'failed';
  // A seat cancels the offer outright, and is written as its own rule rather than
  // left to fall out of `terminal`: whatever else this model ever learns to offer,
  // a player who just got in is never asked to report a bug.
  const seated = trace.stage === 'joined';
  return {
    lines: trace.steps.map((s) => s.line),
    current: last?.line ?? '',
    stage: trace.stage,
    busy: !terminal,
    error: failed ? (last?.line ?? '') : '',
    stalled: stalled && !seated,
    waitedMs,
    canRetry: failed,
    offerDownloadLog: !seated && (failed || stalled),
  };
}

/**
 * The **title**: the one line the connecting screen shows at the top, in place of
 * the static `CONNECTING…` it used to show from the first tap to the last
 * (`src/ui/lobby-entry` `entryModel(state, narration)`).
 *
 * It is the current step, plus one thing the removed panel used to carry on a line
 * of its own: once a step has sat past {@link STALL_MS}, the seconds are appended —
 *
 *     DIALING MACHINE 0800d5b6… 12s
 *
 * — because a title that never changes is exactly the screen this whole module
 * exists to replace, and a stalled dial with no clock on it reads as a frozen game
 * rather than a slow one. A healthy connect never shows the tail: a number ticking
 * up from zero on a connect that is working is noise.
 */
export function connectTitleLine(model: ConnectTraceModel): string {
  if (!model.stalled || model.current === '') return model.current;
  return `${model.current} ${Math.round(model.waitedMs / 1000)}s`;
}

/** Whether {@link connectTitleLine} is naming a *failure* — the title's one cue to
 *  draw in threat red rather than plasma (style-guide §2: red is damage, and a
 *  refused join is the one thing on this screen that has actually gone wrong). */
export function connectTitleFailed(model: ConnectTraceModel): boolean {
  return model.error !== '';
}

/**
 * The line the DOWNLOAD LOG affordance shows above itself, so the offer names what
 * it is offering to report rather than appearing out of nowhere
 * (`./playtest-log-button` `DownloadLogOffer.hint`).
 */
export function connectOfferHint(model: ConnectTraceModel): string {
  // The reason — and, on a stall, the seconds — are already the TITLE, one line
  // above (`connectTitleLine`). The hint names the offer and nothing else, or the
  // screen says the same sentence twice in two sizes.
  return model.error || model.stalled ? 'DOWNLOAD LOG to report this.' : '';
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
      // Machine that does not host this room and was not handed on. Since a0-72 it
      // is *only* that: a lapsed pass is no longer refused for a returning owner
      // (`server/match-server.ts` `admitsJoin`), so this gloss no longer stands in
      // front of an expiry it was never true of — which is exactly what it did on
      // the developer's phone.
      return 'machine mismatch';
    case 'match-over':
      return 'that match has finished';
    case 'bad-room-code':
      return 'that code is not a room code';
    case 'room-full':
      return 'every seat is taken';
    case 'match-live':
      return 'that match already started';
    case 'reclaim-unknown':
      return 'that match has ended';
    case 'reclaim-expired':
      // Since a0-72 a running match has no window to run out of, so what is left
      // here is the seat a player gave up themselves (`server/room.ts` `abandon`).
      return 'you left this match';
    case 'reclaim-denied':
      return 'that seat is not yours';
    default:
      return '';
  }
}
