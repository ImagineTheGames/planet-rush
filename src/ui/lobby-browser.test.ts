/**
 * src/ui/lobby-browser.test.ts — the browse screen's model, and the mode switch
 * that reaches it (u17-01).
 *
 * What these assertions defend, in the order a player would meet them:
 *
 *  1. **The list is honest about its age.** The stamp is measured from LOCAL
 *     receipt, ticks in seconds, and crosses into the failure register past two
 *     polls — and there is no stamp at all before the first answer, because a
 *     photograph nobody has taken has no age.
 *  2. **The list never blanks and never lies about being empty.** A failed
 *     refresh changes nothing; a room that leaves the listing reads CLOSED for one
 *     cycle *in its own place*; an empty list is a sentence, and "we have not
 *     looked yet" is a different sentence.
 *  3. **A stale row refuses honestly.** Pressing a FULL or CLOSED row is answered
 *     with a line and an immediate refresh, never with a socket — and pressing an
 *     OPEN one is never refused locally, because the round trip is the only
 *     authority (plan Trap 5).
 *  4. **No code, anywhere.** Nothing the model produces for the screen carries a
 *     room code, and nothing derives one.
 *  5. **The poll costs nothing when nobody is looking.** Off-segment or hidden
 *     tab: no request, on an injected clock with no timers in sight.
 */
import { describe, it, expect } from 'vitest';
import {
  BROWSE_COPY,
  BROWSE_NO_PING,
  BROWSE_POLL_MS,
  JOIN_MODES,
  JOIN_MODE_LABELS,
  browseCleared,
  browseJoinFailed,
  browseJoined,
  browseLive,
  browseModel,
  browseReceived,
  browseRefreshFailed,
  browseShouldRefresh,
  browseStamp,
  createBrowse,
  pressBrowseRow,
} from './lobby-browser';
import type { BrowseState } from './lobby-browser';
import { listingFailureMessage } from './online-copy';
import type { RegionInfo } from './online-copy';
import type { LobbyListing } from '../net/lobby-list';

const IAD: RegionInfo = { id: 'iad', label: 'Virginia', pingMs: 38 };
const GRU: RegionInfo = { id: 'gru', label: 'São Paulo', pingMs: 224 };
const UNPROBED: RegionInfo = { id: 'lhr', label: 'London', pingMs: null };
const FLEET = [IAD, GRU, UNPROBED];

/** One listing row. The shape `readLobbyList` hands over — never a code. */
function listing(over: Partial<LobbyListing> = {}): LobbyListing {
  return {
    id: 'h-aaaa',
    owner: 'K7M2QP',
    region: 'iad',
    players: 2,
    joinableSeats: 4,
    mode: 'ffa',
    ...over,
  };
}

const MODEL = { now: 0, capacity: 8, regions: FLEET };

/** A screen holding one listing, received at `t`. */
function withRows(rows: readonly LobbyListing[], t = 1_000): BrowseState {
  return browseReceived(createBrowse(), rows, t);
}

/** The rows a frame would DRAW, in the order it would draw them. */
const drawn = (state: BrowseState, regions = FLEET): readonly string[] =>
  browseModel(state, { ...MODEL, regions }).rows.map((r) => r.owner);

// ---------------------------------------------------------------------------
// 1. The mode switch
// ---------------------------------------------------------------------------

describe('the two modes under JOIN', () => {
  it('offers BROWSE and ENTER ROOM CODE, in that order, and nothing else', () => {
    // The developer, verbatim: "join gives you both options BROWSE and ENTER ROOM
    // CODE, easy, solved". Two modes — and BROWSE leads, because the player with
    // no code is the one this whole feature is for (plan D2).
    expect(JOIN_MODES).toEqual(['browse', 'code']);
    expect(JOIN_MODES.map((m) => JOIN_MODE_LABELS[m])).toEqual(['BROWSE', 'ENTER ROOM CODE']);
  });
});

// ---------------------------------------------------------------------------
// 2. A listing lands
// ---------------------------------------------------------------------------

describe('a listing lands (§3 rules 1 and 3)', () => {
  it('builds a row per room and stamps the LOCAL receipt time', () => {
    const state = withRows([listing(), listing({ id: 'h-bbbb', owner: 'ZZ44RT' })], 5_000);
    expect(state.rows).toHaveLength(2);
    expect(state.receivedAt).toBe(5_000);
    expect(state.everReceived).toBe(true);
    for (const row of state.rows) expect(row.state).toBe('open');
  });

  it('never lets a row carry — or imply — a room code', () => {
    // The developer: "a browse shouldn't show the room code, just the room owner
    // id and location / ping". The handle is not a code and is never drawn; the
    // owner tag is 6 characters against a code's 4, from the same legible deck, so
    // it cannot be mistaken for one and cannot be typed into the keypad as one.
    const state = withRows([listing({ id: 'h-deadbeef', owner: 'K7M2QP' })]);
    const model = browseModel(state, MODEL);
    const row = model.rows[0]!;
    const drawn = [row.owner, row.meta, row.where, row.action].join(' ');
    expect(drawn).not.toContain('h-deadbeef');
    expect(row.owner).toHaveLength(6);
  });

  it('counts humans and open seats, and never a denominator (Traps 2, 3, 4)', () => {
    const model = browseModel(withRows([listing({ players: 1, joinableSeats: 1 })]), MODEL);
    // Singulars are spelled, because "1 PLAYERS" is a row nobody proofread.
    expect(model.rows[0]?.meta).toBe('1 PLAYER · 1 SEAT OPEN · FFA');
    // `size` compacts from 8 to 4 the moment a match starts, so it is never a
    // denominator on a row.
    expect(model.rows[0]?.meta).not.toMatch(/\/|of \d/);
  });

  it('shows the place and the ping THIS client measured — and an em dash, never 0ms', () => {
    const rows = [listing({ region: 'iad' }), listing({ id: 'b', region: 'lhr', owner: 'B00000' })];
    const model = browseModel(withRows(rows), MODEL);
    const where = model.rows.map((r) => r.where);
    expect(where).toContain('VIRGINIA 38ms');
    expect(where).toContain(`LONDON ${BROWSE_NO_PING}`);
    for (const line of where) expect(line).not.toMatch(/\b0ms\b/);
  });

  it('sorts by the MEASURED ping, with the unmeasured last (a0-29)', () => {
    // a0-29 fixed the probe so Virginia sorts above São Paulo from the US; this is
    // the row order that depends on it. An unprobed region sorts LAST — reading it
    // as the fastest is the flattering lie region-probe rule 1 already refuses.
    const state = withRows([
      listing({ id: 'gru', owner: 'AAAAAA', region: 'gru' }),
      listing({ id: 'lhr', owner: 'BBBBBB', region: 'lhr' }),
      listing({ id: 'iad', owner: 'CCCCCC', region: 'iad' }),
    ]);
    expect(drawn(state)).toEqual(['CCCCCC', 'AAAAAA', 'BBBBBB']);
  });

  it('RE-RANKS a listing that landed before the pings did', () => {
    // The first listing routinely lands before the region probes answer — the
    // request goes out the moment the segment opens and a probe is three samples
    // deep. Sorting when the listing lands would freeze that arrival order
    // forever; the phone caught exactly that (tests/browse/lobby-browse.spec.ts).
    const state = withRows([
      listing({ id: 'gru', owner: 'AAAAAA', region: 'gru' }),
      listing({ id: 'iad', owner: 'BBBBBB', region: 'iad' }),
    ]);
    // Nothing measured yet: the fleet's own order stands, by seats then owner.
    expect(drawn(state, [])).toEqual(['AAAAAA', 'BBBBBB']);
    // …and the moment the probes land, the same rows re-rank under the player.
    expect(drawn(state)).toEqual(['BBBBBB', 'AAAAAA']);
  });

  it('breaks a ping tie by the most room, then stably', () => {
    const state = withRows([
      listing({ id: 'a', owner: 'BBBBBB', joinableSeats: 2 }),
      listing({ id: 'b', owner: 'AAAAAA', joinableSeats: 6 }),
      listing({ id: 'c', owner: 'AAAAA0', joinableSeats: 2 }),
    ]);
    expect(drawn(state)).toEqual(['AAAAAA', 'AAAAA0', 'BBBBBB']);
  });

  it('marks a departed room CLOSED for one cycle, in the place it already had', () => {
    // A row that vanishes from under a descending thumb is a mis-tap generator, so
    // it keeps its index for one cycle rather than being re-sorted away.
    const first = withRows([
      listing({ id: 'a', owner: 'AAAAAA', region: 'iad' }),
      listing({ id: 'b', owner: 'BBBBBB', region: 'iad' }),
      listing({ id: 'c', owner: 'CCCCCC', region: 'iad' }),
    ]);
    expect(first.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);

    const second = browseReceived(
      first,
      [listing({ id: 'a', owner: 'AAAAAA' }), listing({ id: 'c', owner: 'CCCCCC' })],
      6_000,
    );
    expect(second.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(second.rows[1]?.state).toBe('closed');

    // …and it is gone on the next one. One cycle, not two — `c`, which left on
    // THIS listing, is now the one taking its single cycle.
    const third = browseReceived(second, [listing({ id: 'a', owner: 'AAAAAA' })], 11_000);
    expect(third.rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(third.rows[1]?.state).toBe('closed');
    const fourth = browseReceived(third, [listing({ id: 'a', owner: 'AAAAAA' })], 16_000);
    expect(fourth.rows.map((r) => r.id)).toEqual(['a']);
  });

  it('draws a seat-less ad as FULL rather than as an invitation', () => {
    const model = browseModel(withRows([listing({ joinableSeats: 0 })]), MODEL);
    expect(model.rows[0]?.state).toBe('full');
    expect(model.rows[0]?.enabled).toBe(false);
    expect(model.rows[0]?.action).toBe('FULL');
    // …and it says the seat count its own ad carried, rather than a bare zero.
    expect(model.rows[0]?.meta).toContain('NO SEATS OPEN');
  });

  it('stops a CLOSED row advertising seats it no longer knows about', () => {
    // A row reading `4 SEATS OPEN` beside a button reading `CLOSED` is the screen
    // arguing with itself. The seat clause goes; the player count — what the room
    // WAS — stays, because it claims nothing about what to do next.
    const first = withRows([listing({ id: 'a', players: 2, joinableSeats: 4 })]);
    const gone = browseReceived(first, [], 6_000);
    const row = browseModel(gone, MODEL).rows[0]!;
    expect(row.action).toBe('CLOSED');
    expect(row.meta).toContain('2 PLAYERS');
    expect(row.meta).not.toMatch(/SEAT/);
  });

  it('keeps the rows through a failed refresh, and lets the stamp say so', () => {
    const state = withRows([listing()], 1_000);
    const after = browseRefreshFailed(state);
    expect(after.rows).toHaveLength(1);
    expect(after.receivedAt).toBe(1_000);
    // 12 s later — past two polls — the stamp has turned, on its own, with no
    // second event needed.
    expect(browseStamp(after, 13_000).stale).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. The age stamp
// ---------------------------------------------------------------------------

describe('the age stamp (§3 rule 2)', () => {
  it('says nothing before the first listing lands', () => {
    expect(browseStamp(createBrowse(), 9_999)).toEqual({ text: '', stale: false });
  });

  it('ticks in whole seconds from LOCAL receipt', () => {
    const state = withRows([listing()], 1_000);
    expect(browseStamp(state, 1_000).text).toBe('UPDATED 0s AGO');
    expect(browseStamp(state, 4_600).text).toBe('UPDATED 3s AGO');
  });

  it('turns into the failure register past two poll intervals', () => {
    const state = withRows([listing()], 0);
    expect(browseStamp(state, 2 * BROWSE_POLL_MS).stale).toBe(false);
    const late = browseStamp(state, 24_000);
    expect(late.stale).toBe(true);
    expect(late.text).toBe('LAST SEEN 24s AGO');
  });

  it('never prints a negative age when the clock steps backwards', () => {
    const state = withRows([listing()], 5_000);
    expect(browseStamp(state, 1_000).text).toBe('UPDATED 0s AGO');
  });
});

// ---------------------------------------------------------------------------
// 4. Empty is a state, not a bug (LESSONS §20)
// ---------------------------------------------------------------------------

describe('an empty list', () => {
  it('says we are LOOKING before the first answer, not that there is nothing', () => {
    const model = browseModel(createBrowse(), MODEL);
    expect(model.rows).toEqual([]);
    expect(model.empty).toEqual([BROWSE_COPY.looking]);
    expect(model.stamp).toBe('');
  });

  it('says NO OPEN ROOMS — and what to do instead — once one has landed', () => {
    const model = browseModel(browseReceived(createBrowse(), [], 1_000), MODEL);
    expect(model.empty).toEqual([BROWSE_COPY.emptyHeadline, BROWSE_COPY.emptyDetail]);
    // The way out is named, and it is on this very screen: the other segment.
    expect(BROWSE_COPY.emptyDetail).toContain(JOIN_MODE_LABELS.code);
    // …and it fits the door-hint budget the one overflowing label in this game
    // established (63 chars at 11px — `tests/mobile/voice-copy-fit.spec.ts`).
    expect(BROWSE_COPY.emptyDetail.length).toBeLessThanOrEqual(63);
    expect(BROWSE_COPY.emptyHeadline.length).toBeLessThanOrEqual(63);
  });

  it('is never a blank rectangle: something is always said', () => {
    for (const state of [createBrowse(), browseReceived(createBrowse(), [], 1)]) {
      expect(browseModel(state, MODEL).empty.join('')).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Pressing a row
// ---------------------------------------------------------------------------

describe('pressing a row', () => {
  it('hands the caller the HANDLE and goes dead until it resolves', () => {
    const state = withRows([listing({ id: 'h-open' })]);
    const result = pressBrowseRow(state, 'h-open', 2_000);
    expect(result.join).toBe('h-open');
    expect(result.refresh).toBe(false);
    expect(browseLive(result.state)).toBe(false);
    // A second press while the first is in flight is a no-op — the same rule that
    // stops a double-tap on HOST opening two rooms.
    expect(pressBrowseRow(result.state, 'h-open', 2_100).join).toBeNull();
  });

  it('never refuses an OPEN row locally, however stale the picture is', () => {
    // Trap 5: the allocate/join round trip is the only authority. A browser that
    // refused an open row would be a second, weaker gate — up to ten seconds
    // stale — saying the same thing worse.
    const state = withRows([listing({ id: 'h-open' })], 0);
    expect(pressBrowseRow(state, 'h-open', 600_000).join).toBe('h-open');
  });

  it('refuses a FULL row with the sentence, and asks for a refresh', () => {
    const state = withRows([listing({ id: 'h-full', joinableSeats: 0 })]);
    const result = pressBrowseRow(state, 'h-full', 2_000);
    expect(result.join).toBeNull();
    expect(result.refresh).toBe(true);
    expect(result.state.error).toBe(BROWSE_COPY.full);
    expect(browseLive(result.state)).toBe(true);
  });

  it('refuses a CLOSED row the same way', () => {
    const first = withRows([listing({ id: 'a' }), listing({ id: 'b', owner: 'BBBBBB' })]);
    const second = browseReceived(first, [listing({ id: 'a' })], 6_000);
    const result = pressBrowseRow(second, 'b', 6_100);
    expect(result.join).toBeNull();
    expect(result.refresh).toBe(true);
    expect(result.state.error).toBe(BROWSE_COPY.closed);
  });

  it('ignores a handle it does not have a row for', () => {
    const state = withRows([listing()]);
    expect(pressBrowseRow(state, 'nope', 1).state).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// 6. …and what the player sees when the room filled up while they looked
// ---------------------------------------------------------------------------

describe('a join that comes back refused', () => {
  const inFlight = (): BrowseState => pressBrowseRow(withRows([listing({ id: 'h1' })]), 'h1', 1).state;

  it('says the seat went to somebody else, and marks that row FULL', () => {
    const after = browseJoinFailed(inFlight(), 'room-full');
    expect(after.error).toBe(BROWSE_COPY.full);
    expect(after.error).toBe(listingFailureMessage('room-full'));
    expect(after.rows[0]?.state).toBe('full');
    expect(browseLive(after)).toBe(true);
    // The screen is still the list: a refusal is not a dead end and never bounces
    // the player back to the doors (§3).
    expect(after.rows).toHaveLength(1);
  });

  it('says the claim has closed for a 404, and marks that row CLOSED', () => {
    const after = browseJoinFailed(inFlight(), 'not-found');
    expect(after.error).toBe(BROWSE_COPY.closed);
    expect(after.rows[0]?.state).toBe('closed');
  });

  it('marks NOTHING when the allocator was never reached', () => {
    // `fetch` threw: offline, DNS, TLS. That says exactly nothing about the room,
    // and reporting it as a dead row would be the screen inventing a fact.
    const after = browseJoinFailed(inFlight(), 'network');
    expect(after.rows[0]?.state).toBe('open');
    expect(after.error).toBe(listingFailureMessage('network'));
  });

  it('keeps the two 404 sentences apart — a row is not something you typed', () => {
    // The code path's 404 means "check what you typed"; a row's means "that claim
    // is gone". Same status, two different things to tell a player.
    expect(listingFailureMessage('not-found')).not.toMatch(/check it/i);
    expect(listingFailureMessage('room-full')).not.toBe(listingFailureMessage('not-found'));
  });

  it('clears on the next thing the player asks for, and on a join that lands', () => {
    const after = browseJoinFailed(inFlight(), 'room-full');
    expect(browseCleared(after).error).toBe('');
    expect(browseJoined()).toEqual(createBrowse());
  });
});

// ---------------------------------------------------------------------------
// 7. What did not fit
// ---------------------------------------------------------------------------

describe('more rooms than rects', () => {
  it('draws what fits and DECLARES the rest', () => {
    // No silent caps: a list that quietly stopped at three would read as "that is
    // all of them", which is a lie the screen has no way of taking back.
    const rooms = Array.from({ length: 7 }, (_, i) =>
      listing({ id: `h${i}`, owner: `OWNER${i}`, joinableSeats: 7 - i }),
    );
    const model = browseModel(withRows(rooms), { ...MODEL, capacity: 3 });
    expect(model.rows).toHaveLength(3);
    expect(model.hidden).toBe(4);
    expect(model.hiddenLine).toBe('4 NOT SHOWN');
    // …and what it kept is the top of the sort, not an arbitrary slice.
    expect(model.rows[0]?.owner).toBe('OWNER0');
  });

  it('hides nothing when everything fits', () => {
    expect(browseModel(withRows([listing()]), MODEL).hidden).toBe(0);
    expect(browseModel(withRows([listing()]), MODEL).hiddenLine).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 8. The poll lifecycle (plan §6 rules 2 and 3)
// ---------------------------------------------------------------------------

describe('the poll', () => {
  const poll = (over: Partial<Parameters<typeof browseShouldRefresh>[0]>) =>
    browseShouldRefresh({ active: true, visible: true, startedAt: null, now: 0, ...over });

  it('reads once immediately on entering BROWSE', () => {
    expect(poll({})).toBe(true);
  });

  it('costs nothing at all off the segment, or on a hidden tab', () => {
    expect(poll({ active: false })).toBe(false);
    expect(poll({ visible: false })).toBe(false);
    // Not even once the interval is long past: the request would answer a screen
    // nobody is looking at.
    expect(poll({ visible: false, startedAt: 0, now: 60_000 })).toBe(false);
  });

  it('waits out the interval, and no longer', () => {
    expect(poll({ startedAt: 1_000, now: 1_000 + BROWSE_POLL_MS - 1 })).toBe(false);
    expect(poll({ startedAt: 1_000, now: 1_000 + BROWSE_POLL_MS })).toBe(true);
  });

  it('polls no faster than the heartbeat that feeds it', () => {
    // The list cannot be fresher than the 5 s heartbeat behind it, so a faster
    // poll is requests spent on nothing (plan D4).
    expect(BROWSE_POLL_MS).toBeGreaterThanOrEqual(5_000);
  });
});
