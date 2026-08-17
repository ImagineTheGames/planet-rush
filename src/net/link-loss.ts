/**
 * src/net/link-loss.ts — the connection dying LOUDLY. OWNER: Netcode Engineer
 * (GDD §4.2; the developer's zombie-match report).
 *
 * *"Left browser, came back, disconnected — bots frozen but I could still move.
 * I should get kicked out and presented reconnect / abandon buttons."*
 *
 * The reconnect wire works, and has for fourteen verified runs
 * (`tests/net/reconnect-resume.test.ts`) — but **only when the client knows it
 * dropped**. A backgrounded tab is the case where it does not: the browser
 * throttles the page and the socket dies without an `onclose` ever running, so
 * `WebSocketTransport` still says `open`, no snapshot has arrived in ninety
 * seconds, and the client keeps predicting a world nobody is authoritative for.
 * The player flies. The bots stand still. Every frame of it is a lie, and the one
 * thing the client never does is *say so*.
 *
 * This module is the missing sense organ, and it is three rules:
 *
 *  1. **Silence is a signal.** A server frame — any frame — is proof of life. Past
 *     {@link silenceLimitMs} with none, the connection is LOST, whatever the socket
 *     claims about itself ({@link LinkWatch.poll}).
 *  2. **A returning tab is judged, not trusted.** `visibilitychange` back to
 *     visible with a stale last frame is a loss with its own name — the one the
 *     developer actually hit, and the one the overlay says out loud
 *     ({@link LinkWatch.shown}).
 *  3. **Lost means frozen.** {@link LinkWatch.frozen} is what `./session` reads
 *     before it predicts a tick, so the zombie world stops advancing the instant
 *     the loss is detected rather than when the player notices (GDD §4.2 — a
 *     predicted world with no authority behind it is not a game, it is a screensaver
 *     with controls).
 *
 * **Pure and clockless**, like `./reconnect` and `./connect-trace`: every method
 * takes the caller's `now`, this file reads no clock, opens no socket and imports
 * nothing but a type. A sixty-second grace window is a test that runs in
 * microseconds.
 *
 * The words it produces ({@link linkNotice}) follow the connect-title grammar
 * (`./connect-trace` `connectTitleLine`): one loud line that names the *actual
 * cause detected*, never a generic "connection problem". `./link-loss-view` draws
 * it; `./playtest-log-attach` writes every transition into the session log, so the
 * developer's next paste tells the whole story (brief §4).
 */

import type { ConnectionState } from './transport';

// ---------------------------------------------------------------------------
// How long silence has to last
// ---------------------------------------------------------------------------

/** The authoritative broadcast interval, ms — 30 Hz, the rate the day-0 spike
 *  decided (`server/room.ts` `DEFAULT_SNAPSHOT_INTERVAL_TICKS`, docs/netcode-spike.md).
 *  A healthy match delivers a frame every 33 ms. */
export const SNAPSHOT_INTERVAL_MS = 1000 / 30;

/** How many missed broadcasts start the count (brief §1: "2-3x snapshot interval"). */
export const SILENCE_SNAPSHOTS = 3;

/** How much measured round trip is added on top — two retransmit cycles' worth
 *  (a stalled TCP retransmit costs about two round trips, and we allow two before
 *  calling the link dead). This is the "+ rtt margin" half of the brief's rule, and
 *  it is what makes a satellite link get more patience than a LAN. */
export const SILENCE_RTT_MARGIN = 4;

/**
 * The floor under the whole calculation, and the one number here that is a
 * judgement rather than arithmetic.
 *
 * The brief's literal rule — 3 × 33 ms + margin — lands around 100–200 ms, which is
 * *inside ordinary jitter on this game's own measurements*: `server/room.ts`
 * `INTENT_HOLD_TICKS` exists because the harness's worst stall at 250 ms RTT is ~45
 * ticks (750 ms), and the M10 telemetry captured a 500 ms hiccup on a wire whose
 * jitter never moved (`./session` `networkPingMs`). A limit under a second would
 * therefore throw CONNECTION LOST across a healthy match several times an hour, and
 * a false kick-out mid-fight is a worse bug than the one this file fixes.
 *
 * Two and a half seconds clears every stall this build has measured with room to
 * spare, and is still fast enough that the developer's *"bots frozen but I could
 * still move"* is over before a human decides something is wrong.
 */
export const SILENCE_FLOOR_MS = 2_500;

/** And the ceiling, so a wildly-reported RTT cannot buy a dead link half a minute
 *  of silent zombie flight. */
export const SILENCE_CEIL_MS = 8_000;

/**
 * How stale the last frame may be at the moment a hidden tab comes *back* before
 * the return itself is the diagnosis (rule 2).
 *
 * Far tighter than {@link SILENCE_FLOOR_MS} because it is not the same
 * measurement. Mid-flight, a gap is ambiguous — a retransmit looks exactly like a
 * death. On return from hidden it is not: while the tab was away nothing was
 * consuming frames, so a socket that is still alive has its most recent broadcast
 * sitting in the receive buffer and delivers it in the same task the page wakes in.
 * One second of nothing, at that moment, means nothing is coming.
 */
export const VISIBILITY_STALE_MS = 1_000;

/**
 * The silence a live connection is allowed, ms: three missed broadcasts plus four
 * round trips of margin, floored and capped by the two constants above.
 *
 * `rttMs` is the *network* floor the ping probe measures (`./telemetry`
 * `networkFloorMs`) — never the composite send→ack figure, which contains this
 * client's own input lead and would inflate the budget from its own reading (the
 * plateau bug, `./session`). Null before the first probe answers: then the floor
 * decides alone, which is the right answer for a connection nobody has measured.
 */
export function silenceLimitMs(
  rttMs: number | null | undefined,
  snapshotIntervalMs: number = SNAPSHOT_INTERVAL_MS,
): number {
  const rtt = typeof rttMs === 'number' && Number.isFinite(rttMs) && rttMs > 0 ? rttMs : 0;
  const raw = SILENCE_SNAPSHOTS * snapshotIntervalMs + SILENCE_RTT_MARGIN * rtt;
  return Math.min(SILENCE_CEIL_MS, Math.max(SILENCE_FLOOR_MS, raw));
}

// ---------------------------------------------------------------------------
// What went wrong, and where that leaves us
// ---------------------------------------------------------------------------

/**
 * **The actual cause detected** — the whole point of the overlay is that it names
 * this rather than shrugging (brief §2).
 *
 *   • `'silence'`      — no server frame for {@link silenceLimitMs} while the tab was
 *                        in front of the player. The socket may still claim `open`.
 *   • `'backgrounded'` — the tab came back from hidden with a stale last frame. The
 *                        developer's own case, and the one no earlier build noticed.
 *   • `'socket'`       — the transport itself saw the socket go (close or error; this
 *                        transport folds an error into the close that always follows
 *                        it, `./websocket-transport` `onerror`), and is redialling.
 */
export type LossCause = 'silence' | 'backgrounded' | 'socket';

/** Why the match is over for good, when it is. Mirrors `./websocket-transport`
 *  `CloseReason` plus the one this module decides on its own, `'grace-elapsed'`. */
export type LinkEnding = 'grace-elapsed' | 'room-gone' | 'join-rejected' | 'left';

/**
 * Where the link stands.
 *
 *   • `'live'`      — frames are arriving; the world is real and the overlay is down.
 *   • `'lost'`      — detected loss, nothing being dialled: the overlay is asking.
 *   • `'redialing'` — a dial is in flight (the automatic one, or the player's
 *                     RECONNECT), and the seat is still ours to take back.
 *   • `'expired'`   — the grace window closed, the room ended, or the player
 *                     abandoned. Nothing to reconnect to; one button, to the menu.
 */
export type LinkPhase = 'live' | 'lost' | 'redialing' | 'expired';

/**
 * What the **player's own RECONNECT press** did, since the current loss began.
 *
 * Separate from {@link LinkStatus.attempts}, which counts every dial including the
 * automatic one, because the two answer different questions. `attempts` answers
 * "how hard is the client trying?"; this answers "did the thing I just pressed do
 * anything?" — and that second question is the one a player asks with their finger
 * still on the button.
 *
 *   • `'none'`    — not pressed since this loss. The card says nothing about it.
 *   • `'dialing'` — pressed, and a dial actually went out.
 *   • `'failed'`  — pressed, and no dial could be started. **This is the state the
 *                   overlay must never swallow**: a button that silently does
 *                   nothing when the server is gone is worse than no button, so the
 *                   detail line says so out loud (n8-01).
 */
export type ManualRedial = 'none' | 'dialing' | 'failed';

/** The link, as of the last {@link LinkWatch.poll}. Immutable, so a view compares
 *  rather than re-reads. */
export interface LinkStatus {
  readonly phase: LinkPhase;
  /** What was detected, or null while live. Kept across a redial so the overlay
   *  does not forget what it was recovering *from*. */
  readonly cause: LossCause | null;
  /** Milliseconds since the last server frame of any kind. */
  readonly silentMs: number;
  /**
   * Milliseconds of reclaim window left, **estimated from this client's side**.
   *
   * The authoritative clock starts when the *server* notices the socket is gone
   * (`server/room.ts` `disconnect`), which a client cannot observe. The last frame
   * we received is the last instant we can prove the link was alive, so it is the
   * earliest honest t₀ — the estimate therefore runs a little *ahead* of the
   * server's, and errs toward telling the player their seat is gone slightly early
   * rather than promising a reclaim that will be refused.
   */
  readonly graceRemainingMs: number;
  /** Redial attempts since this loss — the "attempt 2" in the overlay. */
  readonly attempts: number;
  /** What the player's last RECONNECT press did, if they have pressed it. */
  readonly manualRedial: ManualRedial;
  /** How it ended, when {@link phase} is `'expired'`. */
  readonly ending: LinkEnding | null;
  /**
   * **The seat is held for as long as the match runs** (a0-72), so
   * {@link graceRemainingMs} is not a countdown and nothing here expires on it.
   * True for every loss inside a live online match; false in the lobby, offline,
   * and on a transport whose server predates the rule.
   */
  readonly heldForMatch: boolean;
  /** The server's own word for a refusal (`server/match-server.ts`
   *  `JoinErrorMessage.reason`), when {@link ending} is `'join-rejected'`. Null
   *  otherwise — and it is what stops the terminal card saying `REFUSED` at a
   *  player instead of saying what happened. */
  readonly refusal: string | null;
}

const LIVE: LinkStatus = {
  phase: 'live',
  cause: null,
  silentMs: 0,
  graceRemainingMs: 0,
  attempts: 0,
  manualRedial: 'none',
  ending: null,
  heldForMatch: false,
  refusal: null,
};

export interface LinkWatchConfig {
  /** The reclaim window to count down (GDD §4.2, ~60 s TUNABLE). Defaults to the
   *  transport's own (`./websocket-transport` `RECONNECT_WINDOW_MS`), restated as a
   *  number so this file imports nothing. */
  readonly graceWindowMs?: number;
  /** Broadcast interval to size the silence limit from; defaults to 30 Hz. */
  readonly snapshotIntervalMs?: number;
}

/** The transport's default grace window, restated (`./websocket-transport`
 *  `RECONNECT_WINDOW_MS`, `server/room.ts` `DEFAULT_GRACE_MS`). */
export const DEFAULT_LINK_GRACE_MS = 60_000;

// ---------------------------------------------------------------------------
// The watchdog
// ---------------------------------------------------------------------------

/**
 * Watches one connection and decides, from three independent signals, whether it
 * is still there. Fed by `./session` (every server message, the transport's state)
 * and by the page (`visibilitychange`); read by `./session` (freeze),
 * `./link-loss-view` (the overlay) and `./playtest-log-attach` (the log).
 */
export class LinkWatch {
  private readonly graceWindowMs: number;
  private readonly snapshotIntervalMs: number;

  /** Wall clock of the last server frame — the only proof of life there is. */
  private lastFrameAt: number;
  /** Wall clock the loss was detected, or -1 while live. */
  private lostAt = -1;
  /** The last frame *before* the loss: t₀ of the grace estimate (see
   *  {@link LinkStatus.graceRemainingMs}). */
  private graceFrom = -1;
  private phase: LinkPhase = 'live';
  private cause: LossCause | null = null;
  private ending: LinkEnding | null = null;
  private attempts = 0;
  /** True while the page is hidden: detection is suspended, because a throttled
   *  tab is not evidence of anything and its own timers barely run. The verdict is
   *  taken on return ({@link shown}). */
  private isHidden = false;
  /** The measured network floor, ms, or null — sizes {@link silenceLimitMs}. */
  private rttMs: number | null = null;
  /** One automatic redial per loss, offered before the overlay asks (brief §2). */
  private autoRedialPending = false;
  /** What the player's own press did, this loss ({@link ManualRedial}). */
  private manual: ManualRedial = 'none';
  /** True once the match is over ({@link retire}): nothing is detected any more. */
  private retired = false;
  /** True from `matchStart` (a0-72): the seat is this player's until the match
   *  ends, so no amount of elapsed time takes it away ({@link holdForMatch}). */
  private held = false;
  /** The server's stated refusal, when one ended us ({@link LinkStatus.refusal}). */
  private refusal: string | null = null;
  private current: LinkStatus = LIVE;

  constructor(startedAt: number, config: LinkWatchConfig = {}) {
    this.graceWindowMs = config.graceWindowMs ?? DEFAULT_LINK_GRACE_MS;
    this.snapshotIntervalMs = config.snapshotIntervalMs ?? SNAPSHOT_INTERVAL_MS;
    this.lastFrameAt = startedAt;
  }

  /**
   * The current verdict. Refreshed by {@link poll} *and* by every method that
   * changes the phase, so a caller that presses ABANDON and then reads `status`
   * gets the answer to the question it just asked rather than the answer to the
   * previous frame's.
   */
  get status(): LinkStatus {
    return this.current;
  }

  /**
   * **The freeze** (brief §1). True from the instant a loss is detected until a
   * frame proves the link is back — `./session` checks it before predicting a tick,
   * so no local input advances a world with no authority behind it.
   */
  get frozen(): boolean {
    return this.phase !== 'live';
  }

  /** How long silence may last right now, given the measured wire. */
  get silenceLimitMs(): number {
    return silenceLimitMs(this.rttMs, this.snapshotIntervalMs);
  }

  /**
   * A server frame arrived — any frame: a snapshot, a pong, a lobby state. This is
   * the heartbeat, and it is deliberately not just snapshots: the pong is answered
   * off the socket handler rather than the tick loop (`server/room.ts` `receive`),
   * so it proves the *connection* is alive even in a room whose sim has stalled.
   *
   * A frame after a loss is the recovery: the phase goes back to `live` and the
   * overlay comes down in the same frame the data returns.
   */
  frame(now: number): void {
    this.lastFrameAt = now;
    // A player who pressed ABANDON is not un-abandoned by a straggling frame; every
    // other ending is only ever an *estimate* (see {@link LinkStatus.graceRemainingMs}),
    // and a server still sending us data is better evidence than our own arithmetic
    // about when it stopped. So data wins, except against the player's own choice.
    if (this.phase === 'expired' && this.ending === 'left') return;
    if (this.phase !== 'live') this.recover();
    this.sync(now);
  }

  /** The measured network round trip, ms (`./telemetry` `networkFloorMs`), which
   *  sizes the silence limit. Null/absent is fine — the floor decides alone. */
  setRtt(rttMs: number | null | undefined): void {
    this.rttMs = typeof rttMs === 'number' && Number.isFinite(rttMs) && rttMs >= 0 ? rttMs : null;
  }

  /**
   * The page went away. Detection suspends until it comes back (rule 2) — a
   * throttled tab whose timers barely run is not evidence of anything, and a
   * silence limit measured across a background is measuring the browser's
   * scheduler rather than the wire.
   *
   * Takes no clock: nothing is decided here. The verdict is {@link shown}'s.
   */
  hide(): void {
    this.isHidden = true;
  }

  /**
   * The page came back. **The developer's case, decided here**: if the newest
   * server frame is older than {@link VISIBILITY_STALE_MS}, the socket did not
   * survive the background and the loss is named for what actually happened.
   *
   * A tab that was away for two seconds and has a fresh frame is simply a tab that
   * was away for two seconds; nothing is claimed.
   */
  shown(now: number): void {
    this.isHidden = false;
    if (this.retired || this.phase !== 'live') return;
    if (now - this.lastFrameAt >= VISIBILITY_STALE_MS) this.lose('backgrounded', now);
    this.sync(now);
  }

  /** Whether the page is currently hidden (detection suspended). */
  get hidden(): boolean {
    return this.isHidden;
  }

  /**
   * **The match is live, so the seat is this player's until it ends** (a0-72).
   * Called by `./session` on `matchStart` — the same frame the server starts
   * holding the seat for the life of the match (`server/room.ts` `HELD_FOR_MATCH`).
   *
   * From here on this watch **never expires a loss on its own arithmetic**. That
   * arithmetic was always an *estimate* — the authoritative clock started when the
   * server noticed the socket was gone, which a client cannot observe — and an
   * estimate that ends a match is a client refusing a seat the server is still
   * holding. It errs early by construction ({@link LinkStatus.graceRemainingMs}),
   * which is the right way to err about a countdown and the wrong way to err about
   * a door that is open. Endings now come from where they can be true: the
   * transport closing with a reason, or the server refusing the join in words.
   *
   * The countdown itself is not thrown away — it is simply no longer a deadline,
   * and {@link linkNotice} stops printing it as one.
   */
  holdForMatch(): void {
    this.held = true;
  }

  /** True while the seat is held for the life of the match ({@link holdForMatch}). */
  get heldForMatch(): boolean {
    return this.held;
  }

  /**
   * The transport's own view, folded in (`Transport.state`). `reconnecting` is the
   * socket having genuinely closed — the case that always worked — and it is a loss
   * with a dial already in flight, so it goes straight to `redialing` rather than
   * asking a player to press RECONNECT at a transport that is already pressing it.
   * `closed` is terminal and carries its reason (`./websocket-transport`
   * `CloseReason`).
   */
  transportState(
    state: ConnectionState,
    now: number,
    closeReason?: string | null,
    refusal?: string | null,
  ): void {
    // A retired watch still ignores the socket: the match is over, and a client
    // hanging up on its way to the menu is not a disconnection to report.
    if (this.retired || this.phase === 'expired') return;
    // The server's own word for a refusal, kept whether or not it is what ends us,
    // so the terminal card can quote it rather than say `REFUSED` (a0-72).
    if (typeof refusal === 'string' && refusal.length > 0) this.refusal = refusal;
    if (state === 'closed') {
      this.expire(asEnding(closeReason), now);
      this.sync(now);
      return;
    }
    if (state === 'reconnecting') {
      if (this.phase === 'live') this.lose('socket', now);
      // The transport is dialling on its own backoff, so there is nothing for the
      // player to press and no automatic dial of ours to make.
      this.autoRedialPending = false;
      this.phase = 'redialing';
      this.sync(now);
      return;
    }
    // `open` is not proof of anything — a backgrounded socket reads `open` for as
    // long as the browser keeps the object alive, which is exactly the lie this
    // module exists to catch. Only a frame clears a loss.
  }

  /**
   * Sample the link. Called once per rendered frame (and once per tick of the
   * overlay's own clock, which is what makes a stall visible while nothing else is
   * running). Detects silence, counts the grace down, and closes the window when it
   * runs out.
   */
  poll(now: number): LinkStatus {
    if (this.retired) return this.sync(now);
    if (this.phase === 'live' && !this.isHidden && now - this.lastFrameAt >= this.silenceLimitMs) {
      this.lose('silence', now);
    }
    // The countdown ends a loss only while the seat is on a clock. Inside a live
    // match it is not ({@link holdForMatch}) — the seat is held until the match
    // ends, and this watch is in no position to decide it has.
    if (!this.held && (this.phase === 'lost' || this.phase === 'redialing')) {
      if (this.graceRemaining(now) <= 0) this.expire('grace-elapsed', now);
    }
    return this.sync(now);
  }

  /**
   * Claim the one automatic redial this loss is owed (brief §2: *"auto-attempt one
   * reconnect on tab-return inside grace before even asking"*). True at most once
   * per loss, and only while the seat is still reclaimable; the caller redials and
   * calls {@link beginRedial}.
   */
  takeAutoRedial(now: number): boolean {
    if (!this.autoRedialPending) return false;
    if (this.phase !== 'lost') return false;
    // A held seat has no window to have run out of, so the returning tab always
    // gets its automatic attempt — which is the one the developer's phone needed.
    if (!this.held && this.graceRemaining(now) <= 0) return false;
    this.autoRedialPending = false;
    return true;
  }

  /**
   * A dial is in flight — the automatic one or the player's RECONNECT.
   *
   * `manual` says which, and it is not bookkeeping: it is the difference between a
   * card that reports the client's own background effort and a card that answers the
   * press the player just made. Note there is no guard against beginning a redial
   * while one is already in flight — that is the point of n8-01's button. The
   * automatic attempt runs on the transport's exponential backoff, which a player
   * cannot see and has no way to hurry; pressing RECONNECT cancels that wait and
   * dials now (`./websocket-transport` `redial` — "this is a human saying *try
   * now*"). A button that went inert for the seconds the client happened to be
   * sleeping would be the same silence this whole feature exists to remove.
   */
  beginRedial(now: number, manual = false): void {
    if (this.phase !== 'lost' && this.phase !== 'redialing') return;
    if (!this.held && this.graceRemaining(now) <= 0) {
      // Pressed a hair too late. The seat is gone, and the terminal card says so —
      // but the press was still not nothing, so it is recorded as the failure it was.
      if (manual) this.manual = 'failed';
      this.expire('grace-elapsed', now);
      this.sync(now);
      return;
    }
    this.attempts++;
    this.autoRedialPending = false;
    this.phase = 'redialing';
    if (manual) this.manual = 'dialing';
    this.sync(now);
  }

  /**
   * The dial did not take and nothing is retrying it: back to asking, with the
   * attempt count kept so the next line reads `ATTEMPT 2`. Not used for a redial
   * the *transport* is driving — that one is still in flight on its own backoff
   * (`./websocket-transport` `onDrop`), and telling the player to press a button at
   * a client that is already pressing it would be the ask this file removes.
   */
  redialFailed(now: number, manual = false): void {
    // Recorded BEFORE the phase guard, and that ordering is the whole of n8-01 §3. A
    // press that fails while the phase is already `'lost'` — a transport with no
    // redial gesture at all, the case that used to fall straight through this early
    // return — would otherwise change nothing on screen and nothing in the model: the
    // player presses, the same card stares back, and the button is indistinguishable
    // from a picture of a button.
    if (manual) this.manual = 'failed';
    if (this.phase !== 'redialing') {
      if (manual) this.sync(now);
      return;
    }
    if (!this.held && this.graceRemaining(now) <= 0) this.expire('grace-elapsed', now);
    else this.phase = 'lost';
    this.sync(now);
  }

  /**
   * **Stop watching.** Called when the match ends (`./session`, on `matchEnd`).
   *
   * Not an optimization — a correctness rule. An ended room stops stepping and so
   * stops broadcasting (`server/room.ts` `update` returns early once the phase is
   * `'ended'`), so from this module's point of view the wire falls silent at exactly
   * the moment the summary screen goes up. Without this, every finished online match
   * would throw CONNECTION LOST over its own end screen a couple of seconds later —
   * a false alarm at the one moment the player is owed a clean ending, and the whole
   * feature discredited by the first match they play.
   *
   * There is also nothing left to protect: no seat to reclaim, and no prediction
   * worth freezing.
   */
  retire(now: number): void {
    this.retired = true;
    this.phase = 'live';
    this.cause = null;
    this.ending = null;
    this.autoRedialPending = false;
    this.manual = 'none';
    // The match is over, so the seat is not held for it any more (a0-72).
    this.held = false;
    this.refusal = null;
    this.sync(now);
  }

  /** ABANDON MATCH: the player is done, and the seat is theirs to give up. */
  abandon(now: number): void {
    this.expire('left', now);
    this.sync(now);
  }

  // --- Internals ------------------------------------------------------------

  private lose(cause: LossCause, now: number): void {
    this.phase = 'lost';
    this.cause = cause;
    this.lostAt = now;
    // t₀ of the grace estimate is the last proof of life, not the moment we
    // noticed: the seconds spent detecting the loss are seconds the server was
    // already counting (see {@link LinkStatus.graceRemainingMs}).
    this.graceFrom = this.lastFrameAt;
    this.attempts = 0;
    this.autoRedialPending = true;
    // A fresh loss is a fresh question: whatever the player pressed during the last
    // one has no bearing on this one.
    this.manual = 'none';
  }

  private recover(): void {
    this.phase = 'live';
    this.cause = null;
    this.ending = null;
    // A refusal we recovered from was not the end of anything (`held` survives:
    // the match is still running, and the seat is still ours).
    this.refusal = null;
    this.lostAt = -1;
    this.graceFrom = -1;
    this.attempts = 0;
    this.autoRedialPending = false;
    this.manual = 'none';
  }

  private expire(ending: LinkEnding, now: number): void {
    if (this.phase === 'expired') return;
    // An ending that arrives while the link still looks live (the player pressing
    // ABANDON, a `joinError`) still has to name a cause for the log; `'socket'` is
    // the honest one when nothing else was detected.
    if (this.cause === null && ending !== 'left') this.cause = 'socket';
    if (this.lostAt < 0) this.lostAt = now;
    this.phase = 'expired';
    this.ending = ending;
    this.autoRedialPending = false;
  }

  /** Rebuild the published verdict. The one place {@link LinkStatus} is minted, so
   *  a phase change and a poll can never disagree about what the link is doing. */
  private sync(now: number): LinkStatus {
    this.current = {
      phase: this.phase,
      cause: this.cause,
      silentMs: Math.max(0, now - this.lastFrameAt),
      graceRemainingMs: this.phase === 'expired' ? 0 : this.graceRemaining(now),
      attempts: this.attempts,
      manualRedial: this.manual,
      ending: this.ending,
      heldForMatch: this.held,
      refusal: this.refusal,
    };
    return this.current;
  }

  private graceRemaining(now: number): number {
    if (this.graceFrom < 0) return this.graceWindowMs;
    return Math.max(0, this.graceWindowMs - (now - this.graceFrom));
  }
}

/** Map a transport close reason onto an ending. Unknown reasons read as a spent
 *  grace window, which is the one that says the least and promises the least. */
function asEnding(reason: string | null | undefined): LinkEnding {
  switch (reason) {
    case 'room-gone':
    case 'join-rejected':
    case 'left':
    case 'grace-elapsed':
      return reason;
    default:
      return 'grace-elapsed';
  }
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** One thing the player can press. `kind` is what the wiring switches on; the
 *  view never invents a fourth. */
export interface LinkAction {
  readonly kind: 'reconnect' | 'abandon' | 'menu';
  readonly label: string;
  /** The one affirmative action, drawn in plasma (style-guide §1). */
  readonly primary: boolean;
}

/** What the overlay draws for one frame. Everything it needs, nothing it decides. */
export interface LinkNotice {
  /** False while the link is live — the overlay is not on screen at all. */
  readonly visible: boolean;
  /** The loud line, in the connect-title grammar (`./connect-trace`). */
  readonly title: string;
  /** The sentence under it: what the player's options actually mean. */
  readonly detail: string;
  /** The grace countdown, live — `38s`, or `''` when there is nothing to count. */
  readonly grace: string;
  readonly actions: readonly LinkAction[];
  /** A dial is in flight: the view shows it as busy rather than as a question. */
  readonly busy: boolean;
  /** Terminal: drawn in threat red, because a seat that is gone is real damage
   *  (style-guide §2 spends red exactly once, and this is the moment). */
  readonly failed: boolean;
}

const HIDDEN_NOTICE: LinkNotice = {
  visible: false,
  title: '',
  detail: '',
  grace: '',
  actions: [],
  busy: false,
  failed: false,
};

/** Whole seconds, rounded the way a player reads a stopwatch. */
function seconds(ms: number): number {
  return Math.max(0, Math.round(ms / 1000));
}

/**
 * **Name the actual cause detected** (brief §2). Never "connection problem" — the
 * developer asked for verbosity, and the difference between "the tab was
 * backgrounded" and "the socket closed" is the difference between a bug report
 * that can be acted on and one that cannot.
 */
export function lossPhrase(cause: LossCause | null, silentMs: number): string {
  const s = seconds(silentMs);
  switch (cause) {
    case 'backgrounded':
      return `no server data for ${s}s (tab was backgrounded)`;
    case 'socket':
      return `the socket closed — no server data for ${s}s`;
    case 'silence':
      return `no server data for ${s}s`;
    default:
      return `no server data for ${s}s`;
  }
}

/**
 * **What the player's own press did** — the second half of *"verbosity of what
 * happened"* (n8-01 §3), and the half a drawn-but-mute button leaves out.
 *
 * Appended to the detail line rather than replacing it: the sentence a1-13 verified
 * (the cause, and the seconds of grace left) is the answer to *"what happened to my
 * connection"*, and this is the answer to *"what happened when I pressed that"*. Both
 * are true at once, and a player who has just pressed a button needs both.
 *
 * Empty while `'none'`, which is every frame the player has not pressed anything —
 * so an untouched card reads exactly as it did before this function existed.
 */
export function manualRedialPhrase(manual: ManualRedial, attempts: number): string {
  switch (manual) {
    case 'dialing':
      // Names the attempt number so a second press is visibly a second press, rather
      // than the same sentence appearing to sit there unchanged. No "just now": this
      // card is redrawn once a second for up to a minute, and a sentence that is true
      // when it is written and false thirty seconds later is not verbosity.
      return ` You pressed RECONNECT — attempt ${attempts} went out.`;
    case 'failed':
      // No dial could even be started: the socket is gone and there is nothing on the
      // other end to dial at. Says the press was heard, and says it did not land.
      return ' You pressed RECONNECT and it could not go out — nothing is answering at the server.';
    default:
      return '';
  }
}

/**
 * The sentence a terminal ending gets. Each names what is true now, in the tone
 * the GDD asks for at a death: plain, and not a joke (§4.7).
 *
 * **`refusal` is the server's own word** (`server/match-server.ts`
 * `JoinErrorMessage.reason`), and passing it is the whole of a0-72's last clause.
 * `REFUSED — the server would not take you back` is what the developer read on
 * their phone, and it was true of nothing: their match was running, their seat was
 * held, and a thirty-second pass had lapsed while the screen was off. A refusal
 * that survives the fix is a refusal with a *cause*, and the card says the cause.
 */
export function endingTitle(ending: LinkEnding | null, refusal?: string | null): string {
  switch (ending) {
    case 'room-gone':
      return 'MATCH ENDED — the room is gone';
    case 'join-rejected':
      return refusalTitle(refusal);
    case 'left':
      return 'MATCH ABANDONED — your seat is a bot’s now';
    default:
      return 'SEAT EXPIRED — a bot flew your ship, match went on';
  }
}

/**
 * A refused rejoin, in the player's own terms — one line per reason the server can
 * give, each saying the thing that is actually true of their match.
 *
 * The bare `REFUSED` is kept for exactly one case: a reason this build has never
 * heard of. Inventing a sentence for an unknown token would be the same failure in
 * a new coat — but the token is printed, so a bug report still carries it.
 */
export function refusalTitle(refusal: string | null | undefined): string {
  switch (refusal) {
    case 'match-over':
      return 'MATCH OVER — it finished while you were away';
    case 'reclaim-unknown':
      return 'MATCH ENDED — that room is no longer running';
    case 'reclaim-expired':
      return 'SEAT RELEASED — you left this match, so it went on without you';
    case 'reclaim-denied':
      return 'SEAT TAKEN — somebody else is flying it';
    case 'match-live':
      return 'MATCH UNDER WAY — it started without you';
    case 'room-full':
      return 'ROOM FULL — every seat is taken';
    case 'room-gone':
      return 'MATCH ENDED — the room is gone';
    case 'bad-ticket':
      // Since a0-72 a lapsed pass is no longer this (`server/match-server.ts`
      // `admitsJoin` admits a returning owner's), so what is left is a pass for a
      // room or a Machine that is not the one on the other end of this socket.
      return 'WRONG SERVER — your pass is for a different machine';
    case 'bad-room-code':
      return 'NOT A ROOM CODE — check the letters';
    default:
      return refusal
        ? `REFUSED — the server said “${refusal}”`
        : 'REFUSED — the server would not take you back';
  }
}

/** The sentence under {@link refusalTitle}: what the player can do about it. */
export function refusalDetail(refusal: string | null | undefined): string {
  switch (refusal) {
    case 'match-over':
      return 'Your seat was held the whole time the match ran — the match is what ended, not your window.';
    case 'reclaim-unknown':
    case 'room-gone':
      return 'There is nothing left to rejoin. Start a new match, or take a room code from a friend.';
    case 'reclaim-expired':
      return 'You pressed ABANDON MATCH, which frees the seat at once. A bot took it and the match carried on.';
    case 'reclaim-denied':
      return 'That seat is not yours to take — the code alone is not the credential.';
    case 'match-live':
    case 'room-full':
      return 'Matches are entered from the lobby. Ask for the next one, or open a room of your own.';
    case 'bad-ticket':
      return 'The pass you presented names another machine. RETRY asks the allocator for a fresh one.';
    default:
      return 'The server would not take the rejoin, and this build has no better words for its reason.';
  }
}

/**
 * The overlay, in words. Pure: same status in, same frame out, so every line in
 * this file is asserted in node with no browser.
 */
export function linkNotice(status: LinkStatus): LinkNotice {
  if (status.phase === 'live') return HIDDEN_NOTICE;

  if (status.phase === 'expired') {
    return {
      visible: true,
      title: endingTitle(status.ending, status.refusal),
      detail: expiredDetail(status),
      grace: '',
      actions: [{ kind: 'menu', label: 'BACK TO MENU', primary: true }],
      busy: false,
      failed: true,
    };
  }

  // **What the countdown is** (a0-72). Held for the match, it is not a deadline
  // and must not be drawn as one: a phone that reads `12s` reads it as the time it
  // has left to get back, and the whole point of the ruling is that there is no
  // such time. Empty here, and the detail line says the true thing instead.
  const grace = status.heldForMatch ? '' : `${seconds(status.graceRemainingMs)}s`;
  const graceClause = status.heldForMatch
    ? 'your seat is held for as long as the match runs'
    : `${grace} of grace left`;
  const pressed = manualRedialPhrase(status.manualRedial, status.attempts);
  if (status.phase === 'redialing') {
    return {
      visible: true,
      title: `RECONNECTING…${status.attempts > 1 ? ` ATTEMPT ${status.attempts}` : ''}`,
      // The cause is kept through the redial: a player watching this needs to know
      // what it is recovering *from*, and it is the line they will screenshot.
      detail: `${lossPhrase(status.cause, status.silentMs)} — reclaiming your seat, ${graceClause}.${pressed}`,
      grace,
      // **RECONNECT belongs here, and for most of the grace window this is the only
      // card there is** (n8-01). The earlier reading — "nothing for the player to
      // press but ABANDON: the client is already dialling" — was right about the
      // client and wrong about the player. A fresh loss spends its automatic redial
      // inside the same poll that detected it (`./session` `pollLink`), the transport
      // then retries on its own backoff and never reports a failure, so the phase is
      // `'redialing'` from second 4 to second 62 and the `'lost'` card below is
      // almost never reached. Withholding the button here meant withholding it
      // altogether: measured on the served build, the whole 112-second window offered
      // ABANDON MATCH and BACK TO MENU and nothing else.
      //
      // A dial being in flight is not a reason to refuse the press. That dial is
      // sleeping out an exponential backoff the player cannot see; theirs cancels the
      // wait and goes now (`./websocket-transport` `redial`).
      actions: [
        { kind: 'reconnect', label: reconnectLabel('RECONNECT NOW', grace), primary: true },
        { kind: 'abandon', label: 'ABANDON MATCH', primary: false },
      ],
      busy: true,
      failed: false,
    };
  }

  return {
    visible: true,
    title: `CONNECTION LOST — ${lossPhrase(status.cause, status.silentMs)}`,
    detail: status.heldForMatch
      ? `A bot is flying your ship. RECONNECT and you get it back — same cargo, same upgrades — for as long as the match runs.${pressed}`
      : `A bot is flying your ship. RECONNECT inside ${grace} and you get it back — same cargo, same upgrades.${pressed}`,
    grace,
    actions: [
      // The countdown rides the button itself, because the seconds are the whole
      // decision: a player reading "RECONNECT · 6s" knows to press it NOW. A held
      // seat has no seconds, so the button is the bare verb — a suffix that read
      // `· 0s` would be a deadline invented by punctuation.
      { kind: 'reconnect', label: reconnectLabel('RECONNECT', grace), primary: true },
      { kind: 'abandon', label: 'ABANDON MATCH', primary: false },
    ],
    busy: false,
    failed: false,
  };
}

/** `RECONNECT · 6s` while a window is counting; the bare verb when the seat is
 *  held for the match and there is no number that would be true (a0-72). */
function reconnectLabel(verb: string, grace: string): string {
  return grace === '' ? verb : `${verb} · ${grace}`;
}

/** The sentence under a terminal card. A refusal quotes the server; the rest say
 *  what this client concluded on its own. */
function expiredDetail(status: LinkStatus): string {
  if (status.ending === 'left') {
    return 'You left the match. The seat is freed and the match went on without you.';
  }
  if (status.ending === 'join-rejected') return refusalDetail(status.refusal);
  if (status.ending === 'room-gone') {
    return 'The match server has no room under that code any more — the match is over.';
  }
  return 'Nothing left to reclaim — the reconnect window closed while you were away.';
}

// ---------------------------------------------------------------------------
// The session log
// ---------------------------------------------------------------------------

/**
 * One transition, in the shape `PlaytestLog.recordConnect(step, data)` takes — so
 * the developer's next paste carries the whole story: the loss and its cause, every
 * redial attempt, whether the reclaim took, and an abandon (brief §4).
 * `./playtest-log-attach` calls this on every phase change.
 */
export function linkLossLogEntry(status: LinkStatus): {
  step: string;
  data: Record<string, string | number | boolean | null>;
} {
  return {
    step: `link ${status.phase}`,
    data: {
      cause: status.cause,
      silentMs: Math.round(status.silentMs),
      graceMs: Math.round(status.graceRemainingMs),
      attempts: status.attempts,
      // Whether the human pressed the button, and whether their press got out — the
      // one part of this story a `attempts` count cannot tell apart from the client's
      // own background retries (n8-01).
      manualRedial: status.manualRedial,
      ending: status.ending,
      // a0-72. `graceMs` above is meaningless without this — a seat held for the
      // life of the match has a countdown that is not a deadline — and `refusal`
      // is the difference between a paste that says REFUSED and a paste that says
      // which door was shut.
      heldForMatch: status.heldForMatch,
      refusal: status.refusal,
    },
  };
}
