/**
 * src/ui/lobby-browser.ts — the BROWSE half of JOIN. OWNER: UI Engineer
 * (u17-01; `docs/lobby-browser-plan.md` §3–§5, Milestone D).
 *
 * JOIN has two modes and this is the second one. The developer:
 *
 *   *"join gives you both options BROWSE and ENTER ROOM CODE, easy, solved"*
 *   *"there should be a join button to join it"*
 *   *"a browse shouldn't show the room code, just the room owner id and location
 *    / ping"* — and private rooms *"can only be joined by using the join code"*.
 *
 * The read and the tap are the netcode's (`src/net/lobby-list.ts`
 * {@link readLobbyList} / `joinListing`, n10-01). This file is what the player
 * touches: which rows are on screen, what each one says, how old the whole
 * picture is, what an empty list reads as, and which taps are answered.
 *
 * Pure and DOM-free like every model in this directory. It decides; the geometry
 * ({@link ./lobby-geometry} `entryLayout`) holds the rects and the view
 * ({@link ./lobby-browser-view}) only draws what the two of them return.
 *
 * ---------------------------------------------------------------------------
 * A LISTING IS A PHOTOGRAPH WITH A TIMESTAMP ON IT (plan §3)
 * ---------------------------------------------------------------------------
 * Measured (`spikes/lobby-browser/measured-a0-26.txt`): a seat that fills between
 * heartbeats is wrong on the allocator for up to 5 s, and wrong on this screen for
 * up to 5 s more. So the screen never pretends to be live. It keeps five rules,
 * all of them here:
 *
 *  1. **The list never blanks.** A refresh replaces rows in place; a failed one
 *     changes nothing at all ({@link readLobbyList} answers `null` for every
 *     failure precisely so a caller can hold what it had). `a1-13` watched a
 *     connect card for 112 seconds — a screen that goes blank while it thinks is
 *     the failure that report is made of.
 *  2. **The card stamps its own age**, from LOCAL receipt time and never from the
 *     `asOf` the allocator sent: two clocks differ by however much they differ,
 *     and a device with a wrong clock would read a fresh list as minutes stale
 *     (n10-01 says this in as many words). Past two poll intervals the stamp
 *     turns into the failure register — {@link BrowseStamp.stale}.
 *  3. **A row that has gone reads `CLOSED` for one cycle, in its own place, and
 *     then leaves.** A row that vanishes from under a thumb is a mis-tap
 *     generator, so the merge below splices a departed row back at the index it
 *     had rather than letting the sort reshuffle it away.
 *  4. **An empty list is a sentence, not a void** (LESSONS §20) — and it is not
 *     the same sentence as *we have not looked yet*, which is why
 *     {@link BrowseState.everReceived} exists. `NO OPEN CLAIMS` before the first
 *     answer has landed would be a screen lying about a question it never asked.
 *  5. **A tap on a row the list no longer offers is refused with a sentence**,
 *     and refusing it asks for an immediate refresh — so a room that came back is
 *     back on screen within one cycle rather than being argued with.
 *
 * **What this never does is decide a join.** Trap 5: the allocate/join round trip
 * is the only authority on whether a player gets in, and a browser that refused
 * an OPEN row locally would be a second, weaker gate — up to ten seconds stale —
 * saying the same thing worse. The only taps refused here are the ones the
 * listing itself has already stopped offering, and each of those refusals
 * triggers the refresh that can overturn it.
 *
 * ---------------------------------------------------------------------------
 * WHAT A ROW MAY SAY, AND WHAT IT MAY NOT
 * ---------------------------------------------------------------------------
 * `players` counts HUMANS and `joinableSeats` is *free and open* — a seat the host
 * shut or filled with a bot is not one. Neither is ever recomputed from `size`
 * (Traps 2, 3, 4): `size` compacts from 8 to 4 the moment a match starts, so a row
 * printing "2 of 8" is quoting a lobby number that is about to stop being true.
 *
 * **No code, anywhere, ever.** A row names its room by the owner tag the allocator
 * derives (`allocator/listing.ts`) and joins it by a handle the player never sees.
 * That is a courtesy rather than secrecy — anyone who can read the list can join
 * every room in it — and the honest version of the courtesy is that a screenshot
 * of this screen hands nobody a code.
 *
 * The ping beside a region is the round trip THIS client measured
 * (`src/net/region-probe.ts`, handed in as {@link RegionInfo}), never a number a
 * server claimed. An unmeasured region prints {@link BROWSE_NO_PING} and **never
 * `0ms`** (region-probe rule 1, Trap 6) — and sorts *below* every measured one,
 * because "we don't know" must never present as "nearest".
 */

import type { LobbyListing } from '../net/lobby-list';
import type { ListingJoinFailure } from '../net/lobby-list';
import type { RegionInfo } from './online-copy';
import { listingFailureMessage } from './online-copy';

// ---------------------------------------------------------------------------
// The two modes under JOIN
// ---------------------------------------------------------------------------

/**
 * Which half of the JOIN screen is up. **The doors do not become five** (a0-15
 * was a rollback; Trap 8): CAMPAIGN / SOLO / HOST / JOIN is untouched, there is no
 * BROWSE button on the home screen and no quick-join. JOIN grows a mode switch
 * and nothing else does.
 */
export type JoinMode = 'browse' | 'code';

/** The switch's segments, in the order they are drawn. BROWSE leads because the
 *  player this feature is for is the one with NO code — landing them on a keypad
 *  they cannot use is the failure the developer asked to fix (plan D2). */
export const JOIN_MODES: readonly JoinMode[] = ['browse', 'code'];

/**
 * The words on the two segments — the developer's own, verbatim: *"join gives you
 * both options BROWSE and ENTER ROOM CODE"*.
 *
 * `ROOM` rather than the fiction's `CLAIM` is deliberate and is the same
 * exception the four door labels take (a0-15, recorded in
 * `docs/copy-sweep-industrial-voice.md` §0): the entry screen says what the button
 * does, in the words the person who asked for it used. The keypad's own heading
 * (`./lobby-entry` `ENTRY_STATUS.join`) is untouched — the plan pins the CODE
 * segment as *today's join screen, unchanged*.
 */
export const JOIN_MODE_LABELS: Readonly<Record<JoinMode, string>> = {
  browse: 'BROWSE',
  code: 'ENTER ROOM CODE',
};

/**
 * How often the list is re-read while the BROWSE segment is on screen and the tab
 * is visible (plan D4, measured in §6 and re-measured on the shipped route by
 * n10-01: **12 requests/min, ~21 kB/min**, and zero when either condition fails).
 *
 * Faster buys nothing: **the list cannot be fresher than the 5 s heartbeat that
 * feeds it**, so a 2 s poll is 2.5× the requests for the same staleness.
 */
export const BROWSE_POLL_MS = 5000;

/** How often the age stamp is re-drawn. It ticks in seconds, so it is redrawn in
 *  seconds — this is a repaint cadence, not a network one. */
export const BROWSE_TICK_MS = 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * What the listing last said about a row.
 *
 *  - `open`   — seats, and the allocator was offering it as of the last answer.
 *  - `full`   — the ad carried no open seat. Not tappable; pressing it says so.
 *  - `closed` — it was in the last listing and is not in this one: ended, filled,
 *    started, or gone private. One cycle of an inert row, then it leaves (§3
 *    rule 3). The four are indistinguishable from a listing and the word says the
 *    only thing that is certainly true — **it is not on offer any more**.
 */
export type BrowseRowState = 'open' | 'full' | 'closed';

/** One room as this screen holds it: the listing's own fields, plus what the last
 *  merge concluded about it. Never a room code (see the file header). */
export interface BrowseRow {
  /** The join handle. Opaque here; it is `joinListing`'s argument and nothing
   *  else, and it is never drawn. */
  readonly id: string;
  /** The claim owner's tag — what the row shows in a code's place. */
  readonly owner: string;
  readonly region: string;
  /** Humans in the room. */
  readonly players: number;
  /** Seats a new human can still take — free AND open (never `size − players`). */
  readonly joinableSeats: number;
  /** `'ffa'` / `'teams'` when the ad carried it. */
  readonly mode?: string;
  readonly state: BrowseRowState;
}

/** The browse screen, as one immutable value. */
export interface BrowseState {
  readonly rows: readonly BrowseRow[];
  /**
   * **This client's** clock when the last good listing landed, or `0` before the
   * first one. Local receipt time on purpose — see rule 2 in the file header.
   */
  readonly receivedAt: number;
  /** False until a listing has actually been read. An empty list and a list we
   *  have not asked for yet are different states and read differently. */
  readonly everReceived: boolean;
  /** `joining` while a row's join is in flight: every control is dead, exactly as
   *  {@link ./lobby-entry} `entryLive` kills the doors mid-attempt, so a
   *  double-tap cannot open two sockets. */
  readonly status: 'idle' | 'joining';
  /** The handle being joined, or `null`. */
  readonly joining: string | null;
  /** Why the last tap did not land, in words a player can act on. `''` if none. */
  readonly error: string;
}

/** A fresh browse screen: nothing read yet, nothing wrong. */
export function createBrowse(): BrowseState {
  return { rows: [], receivedAt: 0, everReceived: false, status: 'idle', joining: null, error: '' };
}

/** Whether the screen is taking input (the browse half of `entryLive`). */
export function browseLive(state: BrowseState): boolean {
  return state.status !== 'joining';
}

// ---------------------------------------------------------------------------
// A listing lands
// ---------------------------------------------------------------------------

/** What the sort needs to know about the fleet: the label a region is drawn under
 *  and the round trip this client measured to it. {@link RegionInfo} verbatim —
 *  the lobby's own region model, so the browse row and the region picker cannot
 *  disagree about what a region is called or how fast it is. */
export type BrowseRegions = readonly RegionInfo[];

/**
 * Fold a fresh listing into the screen (§3 rules 1 and 3).
 *
 * Rows the listing carries are rebuilt from it — it is the newer fact — and
 * ordered by {@link compareRows}. Rows the screen had and the listing no longer
 * carries are marked `closed` and **spliced back at the index they held**, so a
 * room that ends does not yank the row under a descending thumb sideways; on the
 * next listing they are dropped. A row that was already `closed` has had its
 * cycle and leaves now.
 *
 * `now` is this client's clock and becomes the stamp's zero.
 */
export function browseReceived(
  state: BrowseState,
  listing: readonly LobbyListing[],
  now: number,
  regions: BrowseRegions = [],
): BrowseState {
  const fresh = listing.map(toRow);
  const live = new Set(fresh.map((row) => row.id));
  fresh.sort((a, b) => compareRows(a, b, regions));

  // Everything the screen had that this listing does not — one cycle of CLOSED,
  // at the index it is already occupying under the player's eye.
  const departed = state.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !live.has(row.id) && row.state !== 'closed');
  const rows: BrowseRow[] = [...fresh];
  for (const { row, index } of departed) {
    rows.splice(Math.min(index, rows.length), 0, { ...row, state: 'closed' });
  }

  return { ...state, rows, receivedAt: now, everReceived: true };
}

/**
 * A refresh that did not land (`readLobbyList` answered `null`: 404, a thrown
 * fetch, a body that was not a listing).
 *
 * **It changes nothing** — that is the whole rule (§3 rule 5). The rows stay, the
 * stamp keeps ageing off the last good receipt, and past two intervals it says so
 * on its own. Kept as a named function rather than a comment at the call site so
 * the intent is greppable and testable: a failed refresh is not an event this
 * screen reports, it is one it *survives*.
 */
export function browseRefreshFailed(state: BrowseState): BrowseState {
  return state;
}

// ---------------------------------------------------------------------------
// Pressing a row
// ---------------------------------------------------------------------------

/** What a press on a row asks the caller to do. `join` is the handle to hand to
 *  `joinListing`; `refresh` asks for an immediate re-read (a refusal here is
 *  always a claim about a stale picture, so the picture is re-taken at once). */
export interface BrowseResult {
  readonly state: BrowseState;
  readonly join: string | null;
  readonly refresh: boolean;
}

/**
 * Press a row — the JOIN button on it, or the row itself (they are one action;
 * see {@link ./lobby-geometry} `entryHitTest`).
 *
 * An `open` row hands the caller its handle and the screen goes dead until the
 * attempt resolves. A row the listing is no longer offering is refused **here**,
 * with the sentence for what the last answer said about it, and a refresh is
 * asked for in the same breath — the refusal is about a photograph, so the
 * remedy is a newer photograph rather than an argument.
 */
export function pressBrowseRow(state: BrowseState, id: string, now: number): BrowseResult {
  if (!browseLive(state)) return { state, join: null, refresh: false };
  const row = state.rows.find((r) => r.id === id);
  if (!row) return { state, join: null, refresh: false };
  if (row.state !== 'open') {
    return {
      state: { ...state, error: refusalFor(row.state) },
      join: null,
      refresh: true,
    };
  }
  void now;
  return {
    state: { ...state, status: 'joining', joining: id, error: '' },
    join: id,
    refresh: false,
  };
}

/**
 * The join came back refused (`joinListing`'s {@link ListingJoinFailure}).
 *
 * The screen comes back to life with the reason on it, and — only for the two
 * refusals that are actually ABOUT THE ROOM — the row is marked with what was
 * learned: 409 means the seat went to somebody else (`full`), 404 means the claim
 * is gone or has gone private (`closed`).
 *
 * A `network` failure marks nothing. `fetch` never reached the allocator, which
 * says exactly nothing about the room — reporting that as a dead row would be the
 * screen inventing a fact (the same rule `joinListing` keeps on its own side).
 */
export function browseJoinFailed(state: BrowseState, reason: ListingJoinFailure): BrowseState {
  const id = state.joining;
  const marked: BrowseRowState | null =
    reason === 'room-full' ? 'full' : reason === 'not-found' ? 'closed' : null;
  const rows =
    marked === null || id === null
      ? state.rows
      : state.rows.map((row) => (row.id === id ? { ...row, state: marked } : row));
  return {
    ...state,
    rows,
    status: 'idle',
    joining: null,
    error: listingFailureMessage(reason),
  };
}

/** The join landed and the lobby is taking the screen. Back to rest, so leaving a
 *  match lands on a clean browse rather than on a stale one. */
export function browseJoined(): BrowseState {
  return createBrowse();
}

/** Clear a standing refusal — what any other press does on the way past, so a
 *  line about one room can never sit over a screen that has moved on. */
export function browseCleared(state: BrowseState): BrowseState {
  return state.error === '' ? state : { ...state, error: '' };
}

// ---------------------------------------------------------------------------
// The age stamp
// ---------------------------------------------------------------------------

/** The stamp over the list: how old the whole picture is, and whether that is now
 *  a failure rather than a fact. */
export interface BrowseStamp {
  readonly text: string;
  /** Past two poll intervals. The view draws it in the failure register
   *  (style-guide §2) — the same discipline `region-probe` rule 1 sets: absent,
   *  never flattering. */
  readonly stale: boolean;
}

/**
 * `UPDATED 3s AGO`, ticking — or `LAST SEEN 24s AGO` once the picture is older
 * than two polls, which is exactly the state a refresh loop that has stopped
 * answering produces.
 *
 * Empty before the first listing lands: there is no age to stamp on a photograph
 * nobody has taken, and a `0s` there would be the flattering lie in its other
 * costume. Clamped at zero so a clock that steps backwards mid-session cannot
 * print a negative age.
 */
export function browseStamp(
  state: BrowseState,
  now: number,
  intervalMs: number = BROWSE_POLL_MS,
): BrowseStamp {
  if (!state.everReceived) return { text: '', stale: false };
  const ageMs = Math.max(0, now - state.receivedAt);
  const seconds = Math.floor(ageMs / 1000);
  const stale = ageMs > 2 * intervalMs;
  return { text: `${stale ? 'LAST SEEN' : 'UPDATED'} ${seconds}s AGO`, stale };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** What an unmeasured region prints where its number would be. An em dash, never
 *  a zero (Trap 6). The sibling of `src/net/region-probe` `NO_PING`, restated
 *  rather than imported because a screen's punctuation is the screen's. */
export const BROWSE_NO_PING = '—';

/**
 * Every standing line this screen can say.
 *
 * `empty` is two lines because it is answering two different questions — *what
 * happened* and *what to do now* — and the second one names controls that are on
 * this very screen (the ENTER ROOM CODE segment, BACK) plus the door one tap
 * behind it. An empty list is a STATE, not a broken screen (LESSONS §20), and the
 * player must never be able to reach a blank rectangle.
 */
export const BROWSE_COPY = {
  /** Before the first answer: we are looking, and we have not concluded anything. */
  looking: 'Looking for open claims…',
  /** …and after one that came back with nothing in it. */
  emptyHeadline: 'NO OPEN CLAIMS RIGHT NOW',
  emptyDetail: 'Press ENTER ROOM CODE, or go BACK to HOST one.',
  /**
   * The row filled up while the player was looking at it (409 from
   * `POST /listings/:id/join`, or a row whose own last ad carried no seat).
   * Duplicated verbatim in {@link ./online-copy} `listingFailureMessage` — the two
   * must agree, and `lobby-browser.test.ts` pins that they do.
   */
  full: 'That claim filled up while you were looking. Pick another.',
  /** …and the room that is simply gone (404, or a row that left the listing). */
  closed: 'That claim has closed. Pick another, or press SOLO.',
} as const;

/** The sentence a row that is no longer on offer says when it is pressed. */
function refusalFor(state: BrowseRowState): string {
  return state === 'full' ? BROWSE_COPY.full : BROWSE_COPY.closed;
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** One row as the view draws it. Three text blocks and a button word — nothing
 *  here needs a rect, and nothing here is a code. */
export interface BrowseRowModel {
  readonly id: string;
  /** The claim owner's tag: what this row is called. */
  readonly owner: string;
  /** `2 PLAYERS · 4 SEATS OPEN · TEAMS` — humans, then seats, then the mode when
   *  the ad carried one. Never a denominator (Trap 2). */
  readonly meta: string;
  /** `VIRGINIA 38ms`, or `VIRGINIA —` for a region this client could not measure. */
  readonly where: string;
  readonly state: BrowseRowState;
  /** False for a row the listing is no longer offering: the button is dim and the
   *  press is answered with a sentence instead of a socket. */
  readonly enabled: boolean;
  /** The word on the button: `JOIN`, or what happened to the room instead. */
  readonly action: string;
}

/** The browse screen for one frame. */
export interface BrowseModel {
  /** The rows that FIT, in order. Never more than the layout asked for. */
  readonly rows: readonly BrowseRowModel[];
  /** How many rooms the list holds that this screen did not have room to draw.
   *  Declared rather than dropped: a silent cap reads as "that is all of them". */
  readonly hidden: number;
  readonly stamp: string;
  readonly stale: boolean;
  /** The two-line answer for a list with nothing in it, or `[]` when there are
   *  rows. Line one is the state, line two is what to do about it. */
  readonly empty: readonly string[];
  /** Why the last tap did not land, or `''`. Drawn in threat red. */
  readonly error: string;
  /** True while a join is in flight — every row is dead. */
  readonly busy: boolean;
}

/** What the model needs from outside itself: the clock, the fleet this client
 *  measured, and how many rows the layout can actually draw. */
export interface BrowseModelOptions {
  readonly now: number;
  readonly regions?: BrowseRegions;
  /** Rows the geometry has rects for. Everything past it is counted, not drawn. */
  readonly capacity: number;
  readonly pollMs?: number;
}

/**
 * Build the frame model. Pure: the view draws exactly this and decides nothing.
 *
 * The cap is the layout's, not a product choice — {@link BrowseModel.hidden}
 * carries whatever did not fit so the screen can admit to it. The rows are
 * already in listing order (they were sorted when the listing landed), so the cap
 * keeps the fastest rooms rather than an arbitrary slice.
 */
export function browseModel(state: BrowseState, options: BrowseModelOptions): BrowseModel {
  const { now, capacity } = options;
  const regions = options.regions ?? [];
  const shown = state.rows.slice(0, Math.max(0, Math.floor(capacity)));
  const stamp = browseStamp(state, now, options.pollMs ?? BROWSE_POLL_MS);
  const live = browseLive(state);
  return {
    rows: shown.map((row) => ({
      id: row.id,
      owner: row.owner,
      meta: rowMeta(row),
      where: rowWhere(row, regions),
      state: row.state,
      enabled: live && row.state === 'open',
      action: row.state === 'open' ? 'JOIN' : row.state === 'full' ? 'FULL' : 'CLOSED',
    })),
    hidden: Math.max(0, state.rows.length - shown.length),
    stamp: stamp.text,
    stale: stamp.stale,
    empty: emptyLines(state),
    error: state.error,
    busy: !live,
  };
}

/** The line a list with no rows in it shows — and the different line for a list
 *  nobody has read yet. */
function emptyLines(state: BrowseState): readonly string[] {
  if (state.rows.length > 0) return [];
  if (!state.everReceived) return [BROWSE_COPY.looking];
  return [BROWSE_COPY.emptyHeadline, BROWSE_COPY.emptyDetail];
}

/** `2 PLAYERS · 4 SEATS OPEN · TEAMS`. Singulars are spelled — a row that says
 *  "1 PLAYERS" is a row nobody proofread. */
function rowMeta(row: BrowseRow): string {
  const parts = [
    `${row.players} ${row.players === 1 ? 'PLAYER' : 'PLAYERS'}`,
    `${row.joinableSeats} ${row.joinableSeats === 1 ? 'SEAT' : 'SEATS'} OPEN`,
  ];
  const mode = modeWord(row.mode);
  if (mode !== '') parts.push(mode);
  return parts.join(' · ');
}

/** The ad's mode token as the lobby already says it. An unknown token is shown
 *  upper-cased rather than dropped: a room whose server knows a mode this build
 *  does not is still a room, and inventing a word for it would be worse. */
function modeWord(mode: string | undefined): string {
  if (mode === undefined || mode.trim() === '') return '';
  return mode.trim().toUpperCase();
}

/** `VIRGINIA 38ms` — the place name (the developer asked for *location*), and the
 *  round trip THIS client timed to it. A region the fleet has not been measured
 *  in prints the em dash. A region this build has never heard of prints its code,
 *  which is what `regionLabel` does one layer down and is legible on day one. */
function rowWhere(row: BrowseRow, regions: BrowseRegions): string {
  const info = regions.find((r) => r.id === row.region);
  const label = (info?.label ?? row.region).toUpperCase();
  const ping = info?.pingMs;
  const number = ping === null || ping === undefined ? BROWSE_NO_PING : `${Math.round(ping)}ms`;
  return `${label} ${number}`;
}

/** A row's measured ping, or `null` — the sort key, and the reason `a0-29` had to
 *  land first: before it, the probe reported the regions in the order they
 *  answered rather than the order they are fast, so this comparison would have
 *  put São Paulo above Virginia for a player in Virginia. */
function pingOf(row: BrowseRow, regions: BrowseRegions): number | null {
  const info = regions.find((r) => r.id === row.region);
  return info?.pingMs ?? null;
}

/**
 * Row order: **nearest first, then the most room, then a stable tie-break.**
 *
 * An unmeasured region sorts *after* every measured one rather than at zero — the
 * same refusal `region-probe` rule 1 makes in the picker, because an unprobed
 * region reading as the best server in the fleet is the flattering lie this repo
 * already declined once.
 */
function compareRows(a: BrowseRow, b: BrowseRow, regions: BrowseRegions): number {
  const pa = pingOf(a, regions);
  const pb = pingOf(b, regions);
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    if (pa !== pb) return pa - pb;
  }
  if (a.joinableSeats !== b.joinableSeats) return b.joinableSeats - a.joinableSeats;
  return a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0;
}

/** One listing row as this screen holds it. A listing only ever carries rooms the
 *  allocator is offering, so `full` here is the defensive case — an ad that
 *  reached us with no seat on it is drawn as what it says, not as an invitation. */
function toRow(listing: LobbyListing): BrowseRow {
  return {
    id: listing.id,
    owner: listing.owner,
    region: listing.region,
    players: listing.players,
    joinableSeats: listing.joinableSeats,
    ...(listing.mode !== undefined ? { mode: listing.mode } : {}),
    state: listing.joinableSeats > 0 ? 'open' : 'full',
  };
}

// ---------------------------------------------------------------------------
// The poll lifecycle (plan §6, rules 2 and 3)
// ---------------------------------------------------------------------------

/**
 * Everything the decision to send a request depends on. All four are facts the
 * caller holds; none of them is a timer, which is what makes the rule testable
 * on an injected clock instead of on `setTimeout`.
 */
export interface BrowsePoll {
  /** The BROWSE segment is the one on screen. Leaving JOIN stops the loop — a
   *  lifecycle, not a heuristic. */
  readonly active: boolean;
  /** `document.visibilityState === 'visible'`. A backgrounded browser is what an
   *  "idle browser" overwhelmingly is, and its steady cost here is **zero**. */
  readonly visible: boolean;
  /** When the last request was STARTED, or `null` if none has been. */
  readonly startedAt: number | null;
  readonly now: number;
}

/**
 * Whether to send a listing request right now.
 *
 * The first read on entering BROWSE is immediate (`startedAt === null`), and so
 * is the first read after a hidden tab comes back — the caller drops
 * `startedAt` on the way out, so a resume asks at once rather than serving a
 * picture from however long the phone was in a pocket. Off-screen or hidden, the
 * answer is always no: nothing about this screen may cost the allocator a request
 * the player cannot see the answer to.
 */
export function browseShouldRefresh(poll: BrowsePoll, intervalMs: number = BROWSE_POLL_MS): boolean {
  if (!poll.active || !poll.visible) return false;
  if (poll.startedAt === null) return true;
  return poll.now - poll.startedAt >= intervalMs;
}
