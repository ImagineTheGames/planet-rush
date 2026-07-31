/**
 * src/net/ping.ts — the round trip, as a player reads it. OWNER: Netcode
 * Engineer (GDD §4.2; ratified developer: "show ping next to each player in the
 * lobby").
 *
 * The wire has measured RTT since the telemetry era (`./telemetry` on the client,
 * `server/ws.ts`'s probe on the server), and until now every one of those numbers
 * went to an instrument: a per-second sample in the session log, a jitter buffer
 * width, a lead budget. **None of them was ever shown to the person whose
 * connection it was.** This module is that last step and nothing more: a rounded
 * number, a word for how good it is, and the rule that a bot has neither.
 *
 * Three rules, and they are the whole file:
 *
 *  1. **A number is a measurement or it is absent.** Null, negative, NaN and
 *     infinity all read as "not measured yet" and produce *no* readout — never a
 *     `0ms` that would claim a perfect connection where there is simply no
 *     sample. A lobby that has just opened has no ping for anyone, and says so by
 *     showing nothing.
 *  2. **A bot has no ping** (ratified). Bots are inside the simulation; their
 *     round trip is not small, it does not exist, and `0ms` next to Vulture would
 *     be a lie that makes every human's number look bad by comparison. The rule
 *     lives here, in the model, so no view can forget it.
 *  3. **The grade is a band, not a hue.** {@link gradePing} returns a *word*
 *     (`good`/`fair`/`poor`); the two views map that word onto the Cold Vacuum
 *     palette themselves (patina / signal yellow / threat red, style-guide §1).
 *     Keeping the colour out of the model is what lets this file be tested in
 *     node, and what keeps `src/net` free of the render layer.
 *
 * Deliberately dependency-free — no palette, no Pixi, no DOM — so the lobby row,
 * the in-match stamp and the server can all share one definition of "245ms is
 * amber".
 */

/**
 * Under this many ms the connection is **good**: below roughly six ticks of the
 * 60 Hz sim, prediction hides the wire almost completely (docs/netcode-spike.md,
 * and the M10 latency-feel harness runs its acceptance pass at 150 ms).
 */
export const PING_GOOD_MS = 100;

/**
 * Under this many ms it is **fair** — playable, visibly networked. Above it the
 * interpolation buffer is wide enough that other ships are a noticeable fraction
 * of a second in the past, which is the point at which a player deserves to be
 * told it is the connection and not the game.
 */
export const PING_FAIR_MS = 200;

/** How good a round trip is, as a word. Views map it to colour; nothing else
 *  in the codebase is allowed to invent a fourth band. */
export type PingGrade = 'good' | 'fair' | 'poor';

/** One seat's ping, ready to draw: the number, the words, and the band. */
export interface PingReadout {
  /** Rounded round-trip time, ms. */
  readonly ms: number;
  /** What the row shows — `245ms`. Rounded, unit attached, no space: it sits
   *  after a middle dot beside a name and must not read as two words. */
  readonly label: string;
  /** The colour band (rule 3). */
  readonly grade: PingGrade;
}

/**
 * The band a round trip falls in: green under {@link PING_GOOD_MS}, amber under
 * {@link PING_FAIR_MS}, red at or above it (ratified thresholds). Boundaries are
 * exclusive on the good side — exactly 100 ms is already `fair`, so a number the
 * player reads as "one hundred" never sits in the band below it.
 */
export function gradePing(rttMs: number): PingGrade {
  if (rttMs < PING_GOOD_MS) return 'good';
  if (rttMs < PING_FAIR_MS) return 'fair';
  return 'poor';
}

/** `245ms` — the one place the unit is spelled, so the lobby row and the in-match
 *  stamp can never drift apart. */
export function formatPing(rttMs: number): string {
  return `${Math.round(rttMs)}ms`;
}

/**
 * A measurement, or null. This is rule 1 in one function: everything that is not
 * a finite, non-negative number is "no sample yet", and callers draw nothing.
 * Rounds once, here, so the label and the grade are read off the *same* integer —
 * a 99.6 ms sample that displayed as `100ms` while grading `good` would be a
 * legible contradiction on a single row.
 */
export function pingReadout(rttMs: number | null | undefined): PingReadout | null {
  if (rttMs === null || rttMs === undefined) return null;
  if (!Number.isFinite(rttMs) || rttMs < 0) return null;
  const ms = Math.round(rttMs);
  return { ms, label: formatPing(ms), grade: gradePing(ms) };
}

/** The one shape {@link seatPing} needs from a lobby slot — narrow on purpose, so
 *  the wire type (`./transport` `LobbySlot`) and the UI's own seat model can both
 *  be passed without either importing the other. */
export interface PingSeat {
  readonly isBot: boolean;
  /** Rounded RTT the server published for this seat, absent on a bot seat and
   *  before the first probe answers (`server/room.ts` `lobbyState`). */
  readonly rtt?: number | null;
}

/**
 * One roster row's ping — **null on a bot seat, always** (rule 2), and null on a
 * human seat the server has not measured yet. The view draws a readout or it
 * draws nothing; it never decides who is allowed a number.
 */
export function seatPing(seat: PingSeat): PingReadout | null {
  if (seat.isBot) return null;
  return pingReadout(seat.rtt);
}
