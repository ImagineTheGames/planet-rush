/**
 * src/net/playtest-log-attach.ts — the session, wired into the log.
 * OWNER: Netcode Engineer (M10 playtest-log brief §1).
 *
 * The log's value is entirely in what gets written to it, and the brief names the
 * list: *"connection lifecycle (allocate → ticket → dial → welcome/joinError with
 * reasons and machine ids), RTT samples, the #238 telemetry (misprediction rate,
 * correction magnitudes, snap events), … match events (spawn, death, reconnect)"*.
 * This module owns the half of that list that only the live session can answer.
 *
 * Three sources, one seam:
 *
 *  1. **The protocol**, through `observe` (`./session`): welcome, joinError,
 *     substitution, reclaim, match end. The high-frequency messages — snapshots and
 *     entity events — are deliberately *not* logged; 30 per second would spend the
 *     whole ring in twenty seconds and tell the reader nothing a per-second sample
 *     does not.
 *  2. **The telemetry ring** (`./telemetry`, the #238 instrument): each finalized
 *     one-second sample is copied across once, so the log carries the same RTT,
 *     correction magnitude, misprediction rate and resync ("snap") counts the
 *     instrument holds — off the phone and into a paste. (This is the *only*
 *     route those numbers take to a human: there is no on-screen netgraph, whatever
 *     #238's comments said — docs/netcode-audit.md §6.)
 *  3. **The predicted world**, for the two match events no message announces to the
 *     player who lived them: the local ship dying, and the local ship respawning.
 *
 * {@link SessionLogHandle.poll} is called once per rendered frame and is cheap by
 * construction: one integer compare against the telemetry ring's newest sample, one
 * enum compare on the connection state, one boolean compare on the local ship. It
 * allocates nothing when nothing changed.
 *
 * Structural types, not imports of the concrete classes: this module reads four
 * fields off a session and two off a world, and saying so keeps it independent of
 * `./prediction` and `../sim`.
 */

import type { ActionEvent } from './action-journal';
import { linkLossLogEntry } from './link-loss';
import type { LinkStatus } from './link-loss';
import type { PlaytestLog } from './playtest-log';
import type { PlayerId } from '@shared/types';
import type { ConnectionState, ServerMessage } from './transport';
import type { TelemetrySample } from './telemetry';

// ---------------------------------------------------------------------------
// What this module needs from the session (and nothing more)
// ---------------------------------------------------------------------------

/** The slice of the telemetry instrument read here: its finalized samples. */
export interface TelemetrySource {
  readonly samples: readonly TelemetrySample[];
}

/** The slice of the predictor read here: the action journal, drained once per poll
 *  (`./action-journal`). `PredictedMatch` satisfies it structurally. */
export interface ActionSource {
  readonly actions: { drain(): readonly ActionEvent[] };
}

/** The slice of a ship read here. `Ship` (`src/sim`) satisfies it. */
export interface LoggedShip {
  readonly id: PlayerId;
  readonly alive: boolean;
  readonly eliminated?: boolean;
}

/**
 * The slice of an ore-journal event read here (`src/sim/ore-journal` `OreEvent`
 * satisfies it). Flat scalars already — the log's own `data` shape, which is why
 * one becomes a line without a translation table (a0-52).
 */
export interface LoggedOreEvent {
  readonly tick: number;
  readonly player: PlayerId;
  readonly flow: string;
  readonly item: string;
  readonly amount: number;
  readonly hold: number;
  readonly bank: number;
  readonly holdAfter: number;
  readonly bankAfter: number;
}

/** The slice of the world read here. `World` (`src/sim`) satisfies it. */
export interface LoggedWorld {
  readonly tick: number;
  readonly ships: readonly LoggedShip[];
  /**
   * The sim's per-movement ore journal (`src/sim/ore-journal`), drained here into
   * the log. Optional: an offline world built by another lane may keep none, and a
   * session with no journal simply logs no economy lines.
   *
   * Mutable on purpose — this module SPLICES it, which is the drain. A structural
   * type rather than an import of `drainOreJournal`, for the same reason every
   * other type in this file is structural: `./playtest-log-attach` stays a leaf
   * that knows nothing about `../sim`.
   */
  readonly oreJournal?: { events: LoggedOreEvent[] };
}

/**
 * The slice of a session read here. `OnlineSession` (`./session`) satisfies it
 * structurally — no import of the concrete class, so this module stays a leaf.
 */
export interface LoggedSession {
  readonly you: PlayerId;
  readonly state: ConnectionState;
  readonly telemetry: TelemetrySource;
  readonly world: LoggedWorld | null;
  /** The predictor, online — the source of the action events (`./action-journal`).
   *  Null or absent offline, where there is nothing to predict and no echo to
   *  match. */
  readonly prediction?: ActionSource | null;
  /** Why the transport closed, when it has said (`./websocket-transport`
   *  `CloseReason`). Optional: a `LocalLoopback`-backed session has none. */
  readonly closeReason?: string | null;
  /** The server's reason for refusing a join, when there is one. */
  readonly rejectReason?: string | null;
  /** Where the link stands (`./link-loss`). Absent on a session with no watchdog
   *  (offline, and any older structural stand-in), which simply logs nothing. */
  readonly link?: LinkStatus;
  observe(handler: (message: ServerMessage) => void): void;
}

// ---------------------------------------------------------------------------
// The handle
// ---------------------------------------------------------------------------

export interface SessionLogHandle {
  /** Sample the session. Call once per rendered frame; it does nothing unless
   *  something actually changed. */
  poll(): void;
  /** Stop sampling. The `observe` handler cannot be unregistered (the session's
   *  observer list is append-only by design), so it is muted instead. */
  dispose(): void;
}

export interface AttachConfig {
  readonly log: PlaytestLog;
  readonly session: LoggedSession;
}

/**
 * Wire a live session into the log and return the per-frame poller.
 *
 * The connection state is logged on every transition, with the reason when the
 * transport supplies one — `reconnecting` and `closed` are the two lines a "it kept
 * dropping" report needs, and the reason is what separates *"the room ended"* from
 * *"my grace ran out"* from *"the server refused me"* (`./reconnect`,
 * `./websocket-transport`).
 */
export function attachSessionLog(config: AttachConfig): SessionLogHandle {
  const { log, session } = config;
  let live = true;

  let lastState: ConnectionState | null = null;
  /** `atMs` of the newest telemetry sample already copied into the log. */
  let lastSampleAt = -1;
  /** The link phase + attempt already logged, so a transition writes one line and a
   *  ticking countdown writes none. Starts at the live phase's key: a session that
   *  never drops never mentions the link at all. */
  let lastLinkKey = 'live/0/';
  /** Local ship liveness, so a death and a respawn are each logged once. */
  let wasAlive: boolean | null = null;
  let wasEliminated = false;

  session.observe((message) => {
    if (!live) return;
    switch (message.type) {
      case 'welcome':
        log.recordConnect('welcome', {
          seat: message.you,
          room: message.room,
          tick: message.tick,
          // Never the token itself — only that a reclaim is possible from here.
          reclaimable: message.reclaimToken !== undefined,
        });
        break;
      case 'joinError':
        // The reason verbatim: this is the line a refused player reports, and the
        // one the Director's probe cannot see (M10).
        log.recordConnect('joinError', { reason: message.reason });
        break;
      case 'matchStart':
        log.recordMatch('matchStart', {
          tick: message.tick,
          seed: message.seed,
          slots: message.slots.length,
          // A matchStart past tick 0 is a reclaim replay, not a fresh RUSH!.
          reclaim: message.tick > 0,
        });
        break;
      case 'playerSubstituted':
        log.recordMatch('playerSubstituted', {
          player: message.player,
          // Both, because they answer different questions and the log is read
          // after the fact: `heldForMatch` is whether the seat had a deadline at
          // all (a0-72 — a mid-match drop does not), `graceSeconds` is the number
          // when there was one. A paste that carried only the number would say
          // `0` for a seat held for ten more minutes.
          heldForMatch: message.heldForMatch === true,
          graceSeconds: message.graceSeconds,
          isLocal: message.player === session.you,
        });
        break;
      case 'playerReclaimed':
        log.recordMatch('playerReclaimed', {
          player: message.player,
          isLocal: message.player === session.you,
        });
        break;
      case 'matchEnd':
        log.recordMatch('matchEnd', { winner: message.winner, tick: message.tick });
        break;
      case 'lobbyState':
        log.recordConnect('lobbyState', {
          slots: message.slots.length,
          bots: message.slots.filter((s) => s.isBot).length,
        });
        break;
      case 'snapshot':
      case 'entityEvent':
        // Per-tick traffic: summarized by the telemetry samples below, never logged
        // message by message — that is how a bounded ring stays useful.
        break;
    }
  });

  return {
    poll(): void {
      if (!live) return;

      // 1. Connection lifecycle.
      if (session.state !== lastState) {
        lastState = session.state;
        log.recordConnect(`state ${session.state}`, {
          ...(session.closeReason ? { closeReason: session.closeReason } : {}),
          ...(session.rejectReason ? { rejectReason: session.rejectReason } : {}),
        });
      }

      // 1b. **The link, every time it moves** (m10 disconnect-honesty brief §4:
      //     "session log gets every transition — lost/cause, redial attempts,
      //     reclaim result, abandon"). `ConnectionState` cannot say any of that: a
      //     silently-killed socket never leaves `open`, so the lifecycle line above
      //     stays silent through the exact failure the developer reported. This is
      //     the line that says `link lost cause=backgrounded silentMs=8140`.
      //
      //     Keyed on the phase *and* the attempt count, so each redial is its own
      //     line while a countdown ticking inside one phase is not.
      const link = session.link;
      if (link) {
        const key = `${link.phase}/${link.attempts}/${link.ending ?? ''}`;
        if (key !== lastLinkKey) {
          lastLinkKey = key;
          const entry = linkLossLogEntry(link);
          log.recordConnect(entry.step, entry.data);
        }
      }

      // 2. Every finalized one-second telemetry sample, copied across once.
      const samples = session.telemetry.samples;
      const newest = samples[samples.length - 1];
      if (newest && newest.atMs !== lastSampleAt) {
        // Catch up in order if several seconds rolled between polls (a slept tab, a
        // stalled frame) — the log should not have a hole the instrument does not.
        for (const sample of samples) {
          if (sample.atMs <= lastSampleAt) continue;
          log.record('net', 'sample', describeSample(sample));
        }
        lastSampleAt = newest.atMs;
      }

      // 3. What the player did, and what authority said about it — the echo
      //    machinery in discrete lines rather than in a per-second average
      //    (`./action-journal`, M10 tick-alignment). Drained, so each event is
      //    logged exactly once.
      const journal = session.prediction?.actions;
      if (journal) {
        for (const event of journal.drain()) log.record('net', event.kind, describeAction(event));
      }

      // 4. The economy, movement by movement (a0-52). The report this exists for
      //    — "i had 2 ore and was able to build a turret" — arrived with a log
      //    that carried no economy events at all, so it had to be answered from
      //    screenshots and inference. These are the lines that answer it in one
      //    read: what was bought, at what price, against what balance, at which
      //    tick, plus every refusal and the overdraft that must never appear.
      const economy = session.world?.oreJournal;
      if (economy && economy.events.length > 0) {
        for (const line of coalesceOre(economy.events.splice(0, economy.events.length))) {
          log.record('match', line.msg, line.data);
        }
      }

      // 5. Local spawn / death, off the predicted world.
      const world = session.world;
      if (world) {
        const ship = world.ships.find((s) => s.id === session.you);
        if (ship) {
          if (wasAlive !== null && ship.alive !== wasAlive) {
            log.recordMatch(ship.alive ? 'spawn' : 'death', { tick: world.tick });
          }
          wasAlive = ship.alive;
          const eliminated = ship.eliminated === true;
          if (eliminated && !wasEliminated) log.recordMatch('eliminated', { tick: world.tick });
          wasEliminated = eliminated;
        }
      }
    },
    dispose(): void {
      live = false;
    },
  };
}

/**
 * Longest run of identical-flow ore movements folded into one log line. A player
 * flying a full hold home banks one ore at a time; eight of those are one sentence,
 * not eight, and the ring is 600 events for a whole session.
 */
export const MAX_ORE_RUN = 8;

/** One log line ready to record. */
interface OreLine {
  readonly msg: string;
  readonly data: Record<string, string | number>;
}

/**
 * Fold a drained batch of ore events into log lines (a0-52).
 *
 * **Every purchase gets its own line, always.** `spent`, `refused` and `overdraft`
 * are what a report about a purchase is made of, and folding two of them together
 * would destroy the one thing they are logged for — so they never merge, whatever
 * they sit next to.
 *
 * **The two high-frequency flows fold.** `mined` and `banked` arrive one per chunk
 * and one per whole ore drained, and a run of them says one thing: the player
 * mined, then flew home and banked it. A folded line keeps the *first* balance and
 * the *last* — which is exactly the before/after a reader wants — and carries `n`,
 * so nothing is hidden: the arithmetic still checks out across the fold.
 */
export function coalesceOre(events: readonly LoggedOreEvent[]): readonly OreLine[] {
  const out: OreLine[] = [];
  let run: (LoggedOreEvent & { n: number; holdEnd: number; bankEnd: number; total: number }) | null = null;
  const flush = (): void => {
    if (!run) return;
    out.push({
      msg: run.flow,
      data: {
        tick: run.tick,
        player: run.player,
        item: run.item,
        amount: round2(run.total),
        hold: round2(run.hold),
        holdAfter: round2(run.holdEnd),
        bank: round2(run.bank),
        bankAfter: round2(run.bankEnd),
        ...(run.n > 1 ? { n: run.n } : {}),
      },
    });
    run = null;
  };
  for (const e of events) {
    const foldable = e.flow === 'mined' || e.flow === 'banked';
    if (run && foldable && run.flow === e.flow && run.item === e.item && run.player === e.player && run.n < MAX_ORE_RUN) {
      run.n++;
      run.total += e.amount;
      run.holdEnd = e.holdAfter;
      run.bankEnd = e.bankAfter;
      continue;
    }
    flush();
    run = { ...e, n: 1, holdEnd: e.holdAfter, bankEnd: e.bankAfter, total: e.amount };
    if (!foldable) flush();
  }
  flush();
  return out;
}

/** Ore is whole on the wheel but mining lands fractional; eight decimal places of
 *  float is noise in a pasted log, not evidence. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * One action event as flat log data — the discrete half of what a pasted log says.
 * Deliberately one shape per kind rather than a union of nulls: a log reader scans
 * these, and `order id=524292 turret` is readable in a way that `order
 * id=524292 what=turret outcome=null waited=null inFlight=null` is not.
 */
export function describeAction(event: ActionEvent): Record<string, string | number | null> {
  switch (event.kind) {
    case 'volley':
      return { tick: event.tick, inFlight: event.inFlight };
    case 'order':
      return { tick: event.tick, id: event.orderId, verb: event.verb, what: event.what };
    case 'echo':
      // `adopt` is the happy path; `refused` and `unknown` are the two mismatches,
      // and they are what a "my turret disappeared" report is actually about.
      return { tick: event.tick, id: event.orderId, outcome: event.outcome, waited: event.waited };
    case 'expiry':
      return { tick: event.tick, id: event.orderId, what: event.what, waited: event.waited };
  }
}

/**
 * One telemetry sample as flat log data. Field names are short because they are read
 * a hundred times in a pasted log: `rtt`/`rttMax` in ms, `corr`/`corrMax` in world
 * units, `mispred` as a rate in [0, 1], `recon` the reconciles the second covered,
 * and `resync` the wholesale authority takeovers — the "snap events" the brief names.
 *
 * `rtt` is the **composite** send→ack figure and always has been; `net`, `srvq`,
 * `srvlag` and `cli` are the three stages it is made of, logged separately since the
 * M10 RTT audit (item 6). A pasted log where `rtt 215` sits beside `net 26` says the
 * wire was never the problem — the tick queue was — and that is a sentence no single
 * number could say (`./telemetry`).
 */
export function describeSample(sample: TelemetrySample): Record<string, number | null> {
  return {
    rtt: sample.rttMeanMs === null ? null : Math.round(sample.rttMeanMs),
    rttMax: sample.rttMaxMs === null ? null : Math.round(sample.rttMaxMs),
    // The wire's *variance*, not just its length — the number the jitter buffer is
    // sized from, so a pasted log says why the buffer was the size it was
    // (`./interpolation` `jitterDelayMs`, M10 audit item 2d).
    jitter: sample.rttJitterMs === null ? null : Math.round(sample.rttJitterMs),
    corr: sample.correctionMeanUnits,
    corrMax: sample.correctionMaxUnits,
    mispred: sample.mispredictionRate,
    recon: sample.reconciles,
    resync: sample.resyncs,
    // Visible teleports, counted apart from magnitude: a blended correction is not
    // felt, and this is the one a player calls "server rollback" (M10 audit).
    snap: sample.visualSnaps,
    // How far ahead of authority the client ran, in ticks — the input latency the
    // player pays on their own trigger, over and above the wire (M10 audit).
    lead: Math.round(sample.leadMeanTicks),
    // **Input-tick alignment**, in ticks: how much later the server ran this
    // client's input than the tick it was predicted at (M10 tick-alignment;
    // `./telemetry` `appliedDeltaMean`). A pasted log showing `align 0` says the
    // two clocks agree and a correction beside it is not a misalignment; a log
    // showing `align 6/31` says the presses are landing late and everything
    // predicted on them is standing at the wrong instant.
    align: sample.appliedDeltaMean,
    alignMax: sample.appliedDeltaMax,
    alignN: sample.appliedDeltaSamples,
    // ── THE ROUND TRIP, TAKEN APART (M10 item 6) ────────────────────────────────
    // NETWORK: the ping frame's own round trip, answered off the server's tick loop
    // — the number a speedtest agrees with, and the only one shown to a player.
    net: sample.networkMeanMs === null ? null : Math.round(sample.networkMeanMs),
    netMin: sample.networkMinMs === null ? null : Math.round(sample.networkMinMs),
    // SERVER: how long this client's input waited in the authoritative tick queue,
    // and how far past its deadline the room's loop ran. The first tracks this
    // client's lead; the second is the host's CPU.
    srvq: sample.serverQueueMeanMs === null ? null : Math.round(sample.serverQueueMeanMs),
    srvlag: sample.serverLoopLagMaxMs === null ? null : Math.round(sample.serverLoopLagMaxMs),
    // CLIENT: this device's own frame scheduling delay, which the wire gets blamed for.
    cli: Math.round(sample.clientLagMeanMs),
    cliMax: Math.round(sample.clientLagMaxMs),
  };
}
