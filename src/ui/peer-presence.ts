/**
 * src/ui/peer-presence.ts — WHO IS STILL FLYING. OWNER: UI Engineer.
 *
 * ── a0-76 ───────────────────────────────────────────────────────────────────
 * The developer, 2026-08-17:
 *
 * > *"do we have any indication when a player loses connection (like for the
 * > other players that remained in match…) and when they join back as well…
 * > we need something to indicate that so other players know"*
 *
 * We did not. `./connection-status` and `src/net/link-loss` are entirely about
 * **your own** socket; from the other side of a drop a disconnected player was
 * simply a ship that stopped making good decisions, and rage-quit, lag, a
 * reconnect in flight and a bot substitution all looked identical from the
 * cockpit. Each of those calls for a different response — press the advantage,
 * wait, or stop counting on an ally — so which one it is, is match information
 * the player is entitled to.
 *
 * ── WHERE THE STATE COMES FROM ──────────────────────────────────────────────
 * **Authority, and only authority.** A client cannot know why another client
 * went quiet — a peer whose ship stops turning may be lagging, may be dead, may
 * be reading their phone — so nothing here is inferred from the simulation. Every
 * transition below is fed from a message the server broadcast about a seat, on
 * the channel that already carries the roster (the brief: *"extend that rather
 * than inventing a second channel"*):
 *
 * | state       | authority's own words                                          |
 * |-------------|----------------------------------------------------------------|
 * | `dropped`   | `playerSubstituted` with `heldForMatch` (`src/net/transport`) — the socket went away mid-match, a bot has the controls, and since a0-72 the seat is that operator's **for as long as the match runs**. |
 * | `gone`      | `playerSubstituted` with no hold (`graceSeconds: 0`) — the operator pressed ABANDON (`server/room.ts` `abandon`), or the hold ended with the match. |
 * | `back`      | `playerReclaimed` — they rejoined and took their ship back. |
 * | `returning` | announced only. See {@link noteReturning}. |
 *
 * and the **bot flag** on each of those is `lobbyState`'s own `isBot`, which the
 * room re-broadcasts on every drop and every reclaim ({@link noteBots}). An ally
 * who is suddenly an AI, or an enemy who just got easier, is the same class of
 * fact as the drop itself.
 *
 * ── WHAT THIS MODULE IS, AND IS NOT ─────────────────────────────────────────
 * Two things, kept apart on purpose:
 *
 *  - **A level** — {@link PeerPresenceLog.presence}, one {@link PeerPresence}
 *    per seat, true until authority says otherwise. This is the part a future
 *    consumer (a nameplate, the minimap, the end-of-match roster) can read.
 *  - **A transition tell** — {@link PeerPresenceLog.read}, the short lines the
 *    HUD draws when a seat's level *changes*. The brief asks for a tell per
 *    transition, not a standing panel: a permanent readout of a match's healthy
 *    seats is a region of screen spent saying "nothing happened", and a phone has
 *    none to spare (a0-74).
 *
 * Pure and headless — no Pixi, no clock of its own, no wire access. The view is
 * {@link ./peer-presence-view} and the wiring is `main.ts`; `hud.test.ts` drives
 * this module directly.
 *
 * Voice: **plain and diagnostic**, not the mining authority (GDD §4.7, the
 * match/machine line — *"a dropped socket is a machine fact"*). `CONNECTION LOST`
 * is the same word `./connection-status` already uses for the local socket, and
 * `RECONNECTING` likewise, so one vocabulary covers your own drop and everyone
 * else's.
 */

import type { PlayerId } from '@shared/types';
import type { ServerMessage } from '../net/transport';
import { resolveName } from './nameplates';
import type { NameTable } from './nameplates';

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/**
 * One seat's presence, as **authority** last stated it (GDD §4.2).
 *
 * - `here` — a human is flying it, or it never had one (a bot seat the host set,
 *   a closed slot). The quiet default: no tell, nothing drawn.
 * - `dropped` — the socket went away mid-match. A bot has the controls and the
 *   seat is held for its operator (a0-72); they may be back at any moment.
 * - `returning` — a reclaim is in flight. See {@link PeerPresenceLog.noteReturning}
 *   for what does and does not reach a peer today.
 * - `back` — they are flying again. A *transient*: it settles to `here` once its
 *   tell has been read, because "back" is a thing that happened, not a condition.
 * - `gone` — nobody is coming back to this seat. They abandoned, or the match
 *   ended their claim.
 */
export type PeerPresence = 'here' | 'dropped' | 'returning' | 'back' | 'gone';

/** One seat's standing presence — the level, not the tell. */
export interface SeatPresence {
  readonly seat: PlayerId;
  readonly state: PeerPresence;
  /** A bot has the controls of this seat right now (`lobbyState.isBot`). */
  readonly bot: boolean;
  /** The time (seconds, the HUD's own clock) the seat entered {@link state}. */
  readonly since: number;
}

/** A line the HUD draws about one transition. */
export interface PresenceTell {
  readonly seat: PlayerId;
  readonly state: PeerPresence;
  /** The seat's name **exactly as the nameplate over its hull spells it** —
   *  `resolveName`, so `P3` on the banner is the `P3` on the ship. */
  readonly name: string;
  /** The fact, without the name: `CONNECTION LOST`, `BACK`, … */
  readonly reason: string;
  /** The **second** fact about the same seat — `BOT FLYING` / `BOT OUT` — or `''`
   *  when there is none. Kept apart from {@link reason} rather than pre-joined so
   *  the view can drop it, and only it, on a viewport too narrow for the whole
   *  row: who dropped outranks who is flying their ship. */
  readonly clause: string;
  /** `name — reason · clause`, the whole line as one string (what a test
   *  asserts, and what the view draws when it fits). */
  readonly text: string;
  /** A bot has the controls of this seat as of this transition. */
  readonly bot: boolean;
  /** 1 while the line holds, ramping to 0 over the last {@link PRESENCE_FADE}. */
  readonly alpha: number;
}

// ---------------------------------------------------------------------------
// Copy (GDD §4.7 — the machine register: plain, diagnostic, no fiction)
// ---------------------------------------------------------------------------

/** The fact each state states. `here` has none — a seat flying normally is not
 *  news, and a line that fires for every seat is a line nobody reads. */
export const PRESENCE_REASON: Readonly<Record<PeerPresence, string>> = {
  here: '',
  dropped: 'CONNECTION LOST',
  returning: 'RECONNECTING',
  back: 'BACK',
  gone: 'LEFT THE MATCH',
};

/** The second clause on a seat a bot has taken over. Kept separate from the
 *  reason above because it is a different fact about the same seat, and because
 *  a reclaimed seat states the reverse of it. */
export const BOT_CLAUSE = 'BOT FLYING';
/** …and what a seat says when the bot hands the controls back. */
export const BOT_CLAUSE_CLEARED = 'BOT OUT';

/** Seconds a line stays up. Long enough to read mid-fight without looking away
 *  from the ship, short enough that it is gone before the next engagement — the
 *  same reasoning as the loot tell's second, scaled to a longer sentence that
 *  the player did not cause and is not expecting. */
export const PRESENCE_TELL_SECONDS = 5;
/** The tail of that window spent fading out. */
export const PRESENCE_FADE = 0.6;
/** At most this many lines at once. Eight seats can in principle drop together
 *  (a server restart, a router reboot in a LAN party); a stack that tall would
 *  reach the build wheel on a phone, so the newest win and the rest are dropped
 *  rather than queued — a tell nobody sees until four seconds from now is not a
 *  tell about now. */
export const PRESENCE_MAX_LINES = 3;

/**
 * The **second** clause on a line, or `''` — who has the controls of the seat.
 *
 * A hand-back is only announced for a seat a bot really was flying: otherwise
 * every `BACK` would claim a substitution that never happened.
 */
export function presenceClause(state: PeerPresence, bot: boolean, wasBot = false): string {
  if (!PRESENCE_REASON[state]) return '';
  if (bot) return BOT_CLAUSE;
  if (wasBot && (state === 'back' || state === 'here')) return BOT_CLAUSE_CLEARED;
  return '';
}

/** The whole line: `P3 — CONNECTION LOST · BOT FLYING`. An em dash between the
 *  seat and its fact (GDD §4.7 — `—` separates a fact from its reason), and a
 *  middot between the two facts, the same punctuation the loot tell uses. */
export function presenceText(name: string, reason: string, clause = ''): string {
  const tail = clause ? `${reason} · ${clause}` : reason;
  return `${name} — ${tail}`;
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

interface Entry {
  state: PeerPresence;
  bot: boolean;
  since: number;
}

interface Line {
  seat: PlayerId;
  state: PeerPresence;
  reason: string;
  clause: string;
  bot: boolean;
  at: number;
}

/**
 * Per-seat presence, and the transition lines it produces.
 *
 * Fed by `main.ts` from the session's own observer — one call per authority
 * message, never a poll — and read once per frame by the HUD.
 */
export class PeerPresenceLog {
  private readonly seats = new Map<PlayerId, Entry>();
  private lines: Line[] = [];
  private names: NameTable = [];
  /** The seat this client is flying, which is deliberately *silent* here: the
   *  local player's own drop is `src/net/link-loss`'s full-screen overlay with
   *  RECONNECT and ABANDON on it, and a banner repeating it under the wave clock
   *  would be a second, quieter copy of a card they cannot miss. */
  private local: PlayerId | null = null;
  /** Memoised {@link read} output, so a frame that changed nothing allocates
   *  nothing (GDD §4.3 — the render loop is a hot path). */
  private cache: readonly PresenceTell[] = EMPTY;
  private cacheKey = '';

  constructor(opts: { readonly local?: PlayerId | null; readonly names?: NameTable } = {}) {
    this.local = opts.local ?? null;
    if (opts.names) this.names = opts.names;
  }

  /** The seat this client flies — excluded from every tell. Re-settable because
   *  a room compacts its roster at RUSH! and tells each client the seat it came
   *  out on (`matchStart.you`), which is not the seat its `welcome` named. */
  setLocal(seat: PlayerId | null): void {
    this.local = seat;
  }

  /** The live name table (`HudFrame.names`), so a line spells a seat the way its
   *  nameplate does. Held by reference: `main.ts` rebuilds the table on boot and
   *  on every rematch, and the banner should follow it. */
  setNames(names: NameTable): void {
    this.names = names;
    this.cacheKey = ''; // a rename re-spells any line still on screen
  }

  /** **A seat dropped.** `playerSubstituted` — the socket went away and a bot
   *  took the controls. `held` is the message's `heldForMatch`: true means the
   *  seat waits for its operator for the rest of the match (a0-72), false means
   *  there is no window at all and they are not coming back. */
  noteDropped(seat: PlayerId, now: number, opts: { readonly held?: boolean; readonly bot?: boolean } = {}): void {
    const held = opts.held ?? true;
    this.enter(seat, held ? 'dropped' : 'gone', now, opts.bot ?? true);
  }

  /**
   * **A reclaim is in flight.**
   *
   * Modelled because the brief names it, and reachable the moment authority
   * announces one. **It does not reach a peer today, and no client-side guess is
   * offered in its place.** The server learns a returning player exists at the
   * instant their reclaim succeeds (`server/room.ts` `reclaim` →
   * `playerReclaimed`), so between "dialing" and "back" there is nothing on the
   * wire for a peer to observe, and a client that inferred one would be inventing
   * the very fact this module exists to stop inventing. `src/net/` and `server/`
   * are the Netcode Engineer's files; the PR carries the one additive broadcast
   * that would light this up.
   */
  noteReturning(seat: PlayerId, now: number): void {
    const bot = this.seats.get(seat)?.bot ?? true;
    this.enter(seat, 'returning', now, bot);
  }

  /** **They are flying again.** `playerReclaimed` — the bot hands the controls
   *  back and the ship, its hold and its upgrades are theirs again. */
  noteBack(seat: PlayerId, now: number): void {
    this.enter(seat, 'back', now, false);
  }

  /** **Gone for good.** They abandoned, or the match ended their claim. */
  noteGone(seat: PlayerId, now: number, opts: { readonly bot?: boolean } = {}): void {
    this.enter(seat, 'gone', now, opts.bot ?? this.seats.get(seat)?.bot ?? true);
  }

  /**
   * **Who is a bot right now**, straight off a `lobbyState` broadcast's `isBot`
   * column — the room re-broadcasts the roster on every drop and every reclaim,
   * so this is authority's own answer rather than the substitution message's
   * implication.
   *
   * Only *corrects* the flag on seats the log already knows about; it never
   * invents a transition. A seat the host set to BOT in the lobby has been an AI
   * since RUSH! and nothing happened to it, and announcing `BOT FLYING` for all of
   * them at the first broadcast is the false-positive that would make the whole
   * banner untrustworthy.
   */
  noteBots(isBot: readonly boolean[], now: number): void {
    for (const [seat, entry] of this.seats) {
      const bot = isBot[seat];
      if (bot === undefined || bot === entry.bot) continue;
      const wasBot = entry.bot;
      entry.bot = bot;
      // The flag flipping on its own — a bot seated or unseated with no drop and
      // no reclaim to explain it — is still worth a line: an enemy who just got
      // easier is match information. It rides the seat's CURRENT state, so a
      // dropped seat that gains a bot re-states its drop with the substitution on
      // it, and a `here` seat that loses one reads `BACK · BOT OUT`.
      this.push(seat, entry.state === 'here' && !bot ? 'back' : entry.state, bot, now, wasBot);
    }
    this.cacheKey = '';
  }

  /**
   * **The match ended.** Every seat still away is now gone for good — the hold
   * a0-72 grants runs for the length of the match and no longer, so a player who
   * was still on their way back has nothing left to come back to. Silent: the
   * end-of-match screen is up, and a banner under it announcing four departures
   * would be noise over a summary.
   */
  noteMatchEnd(now: number): void {
    for (const [, entry] of this.seats) {
      if (entry.state === 'dropped' || entry.state === 'returning') {
        entry.state = 'gone';
        entry.since = now;
      }
    }
    this.lines = [];
    this.cacheKey = '';
  }

  /** Forget everything — a rematch is a new match, and last match's drops are
   *  not this one's (the same rule `LootTellLatch.clear` keeps). */
  reset(): void {
    this.seats.clear();
    this.lines = [];
    this.cacheKey = '';
  }

  /** One seat's standing presence. Unknown seats read `here`: the quiet default
   *  is the truth for every seat nothing has happened to. */
  presence(seat: PlayerId): SeatPresence {
    const entry = this.seats.get(seat);
    if (!entry) return { seat, state: 'here', bot: false, since: 0 };
    return { seat, state: entry.state, bot: entry.bot, since: entry.since };
  }

  /** Every seat the log holds a non-default state for, in seat order. */
  away(): readonly SeatPresence[] {
    const out: SeatPresence[] = [];
    for (const [seat, entry] of this.seats) {
      if (entry.state === 'here' && !entry.bot) continue;
      out.push({ seat, state: entry.state, bot: entry.bot, since: entry.since });
    }
    return out.sort((a, b) => a.seat - b.seat);
  }

  /**
   * The lines to draw at `now` — newest first, at most {@link PRESENCE_MAX_LINES},
   * each fading over its last {@link PRESENCE_FADE} seconds.
   *
   * Also the place `back` settles to `here`: the transient has been on screen for
   * its whole window by the time it expires, so it has been told and the seat is
   * an ordinary flying seat again.
   */
  read(now: number): readonly PresenceTell[] {
    // A clock that went backwards is a rematch or a reclaim's rebuilt world; drop
    // anything standing rather than drawing a line stamped in the future.
    if (this.lines.some((l) => l.at > now)) this.lines = [];

    for (const line of this.lines) {
      if (line.state !== 'back' || now - line.at < PRESENCE_TELL_SECONDS) continue;
      const entry = this.seats.get(line.seat);
      if (entry?.state === 'back') {
        entry.state = 'here';
        entry.since = now;
      }
    }
    this.lines = this.lines.filter((l) => now - l.at < PRESENCE_TELL_SECONDS);

    const shown = this.lines.slice(0, PRESENCE_MAX_LINES);
    const key = shown
      .map((l) => `${l.seat}:${l.state}:${l.reason}:${l.clause}:${l.at.toFixed(2)}`)
      .join('|');
    // The alpha moves every frame, so the key carries the elapsed tenth rather
    // than the raw time — a fading line re-derives ten times, not sixty.
    const fadeKey = `${key}#${Math.floor(now * 10)}`;
    if (fadeKey === this.cacheKey) return this.cache;

    this.cacheKey = fadeKey;
    this.cache = shown.map((l) => {
      const name = resolveName(this.names, l.seat);
      return {
        seat: l.seat,
        state: l.state,
        name,
        reason: l.reason,
        clause: l.clause,
        text: presenceText(name, l.reason, l.clause),
        bot: l.bot,
        alpha: fadeAlpha(now - l.at),
      };
    });
    return this.cache;
  }

  // --- internals ----------------------------------------------------------

  private enter(seat: PlayerId, state: PeerPresence, now: number, bot: boolean): void {
    if (!Number.isFinite(seat) || seat < 0) return;
    const prev = this.seats.get(seat);
    const wasBot = prev?.bot ?? false;
    // Authority repeating itself is not a second event. A `lobbyState` that
    // re-states a drop, or a reconnect that re-sends the same substitution, must
    // not stack a second identical line on the banner.
    if (prev && prev.state === state && prev.bot === bot) return;
    this.seats.set(seat, { state, bot, since: now });
    this.push(seat, state, bot, now, wasBot);
    this.cacheKey = '';
  }

  private push(seat: PlayerId, state: PeerPresence, bot: boolean, now: number, wasBot: boolean): void {
    if (seat === this.local) return; // your own drop is the overlay's, not the banner's
    const reason = PRESENCE_REASON[state];
    if (!reason) return;
    const clause = presenceClause(state, bot, wasBot);
    // One line per seat: a seat that drops and returns inside the window replaces
    // its own stale line rather than contradicting it two rows further down.
    this.lines = this.lines.filter((l) => l.seat !== seat);
    this.lines.unshift({ seat, state, reason, clause, bot, at: now });
    this.cacheKey = '';
  }
}

/**
 * **The whole feed, in one place.** Route one server message into the log.
 *
 * This function is the wiring: `main.ts` hands it every message the session
 * observes, and `hud.test.ts` hands it real {@link ServerMessage} values. Keeping
 * it here rather than as a `switch` in `main.ts` is what makes the test honest —
 * a test that re-implemented the routing would still pass on the day the routing
 * stopped matching the wire. It takes the union by type, so a message shape that
 * moves in `src/net/transport.ts` fails compilation here.
 *
 * Returns true when the message was one this log cares about — used by nothing in
 * production, and by the test to assert the ones it deliberately ignores.
 */
export function applyPresenceMessage(
  log: PeerPresenceLog,
  message: ServerMessage,
  now: number,
): boolean {
  switch (message.type) {
    case 'playerSubstituted':
      // The socket went away mid-match and a bot took the controls. Since a0-72
      // the seat is then held for its operator for as long as the match runs
      // (`heldForMatch`); WITHOUT that flag there is no window at all, which is
      // authority saying they pressed ABANDON and are not coming back
      // (`server/room.ts` `abandon`). One message, two different things for a peer
      // to do about it, so the banner says which.
      log.noteDropped(message.player, now, { held: message.heldForMatch === true });
      return true;
    case 'playerReclaimed':
      // They rejoined and took their ship, hold and upgrades back. A return that
      // is silent is as confusing as a drop that is.
      log.noteBack(message.player, now);
      return true;
    case 'lobbyState':
      // The roster, which the room re-broadcasts on every drop and every reclaim:
      // authority's own answer to "is a bot flying that seat", as against the
      // substitution message's implication. Corrects the flag; it never invents a
      // transition ({@link PeerPresenceLog.noteBots}).
      log.noteBots(
        message.slots.map((slot) => slot.isBot),
        now,
      );
      return true;
    case 'matchEnd':
      // The hold a0-72 grants runs for the length of the match and no longer, so
      // anyone still away is now gone for good. Silent — the summary is up.
      log.noteMatchEnd(now);
      return true;
    default:
      return false;
  }
}

/** Shared empty result, so a quiet frame allocates nothing. */
const EMPTY: readonly PresenceTell[] = [];

/** Full opacity until the fade, then a linear ramp to zero at the window's end. */
function fadeAlpha(elapsed: number): number {
  if (elapsed <= PRESENCE_TELL_SECONDS - PRESENCE_FADE) return 1;
  const left = PRESENCE_TELL_SECONDS - elapsed;
  return Math.max(0, Math.min(1, left / PRESENCE_FADE));
}
