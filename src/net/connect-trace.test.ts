/**
 * src/net/connect-trace.test.ts — the connecting screen says what is happening.
 * OWNER: Netcode Engineer (M10, the developer's twice-repeated ask).
 *
 * The whole point of the module is *wording that appears at the right moment*, so
 * that is what these assert: the exact lines from the brief, in order, each one
 * appended only when its event actually happened — plus the two things the old
 * screen could not do at all, a refusal that names itself and a stall that offers
 * the log without being asked.
 */

import { describe, expect, it } from 'vitest';
import {
  STALL_MS,
  beginConnect,
  connectDialing,
  connectFailed,
  connectHandoff,
  connectJoined,
  connectOfferHint,
  connectProgress,
  connectRefused,
  connectTicketed,
  connectTitleFailed,
  connectTitleLine,
  connectTraceLogEntry,
  connectTraceModel,
  connectTransportState,
  refusalGloss,
  shortMachine,
} from './connect-trace';
import type { ConnectTrace } from './connect-trace';

const T0 = 1_700_000_000_000;
const MACHINE = '0800d5b6f1e208';

/** The happy path, start to seat, at one-second intervals. */
function happyPath(): ReturnType<typeof connectJoined> {
  let trace = beginConnect('create', T0, 'planet-rush-allocator.fly.dev');
  trace = connectTicketed(trace, { room: 'Q5RN', machine: MACHINE, region: 'iad' }, T0 + 300);
  trace = connectDialing(trace, { machine: MACHINE, room: 'Q5RN' }, T0 + 400);
  return connectJoined(trace, 1, T0 + 900);
}

describe('the verbose connecting screen', () => {
  it('tells the story in the brief’s own words, in order', () => {
    const model = connectTraceModel(happyPath(), T0 + 900);
    expect(model.lines).toEqual([
      'ALLOCATING ROOM…',
      'ROOM Q5RN · TICKET SIGNED',
      `DIALING MACHINE 0800d5b6…`,
      'JOINED · SEAT 2',
    ]);
    expect(model.stage).toBe('joined');
    expect(model.busy).toBe(false);
    expect(model.error).toBe('');
    expect(model.offerDownloadLog).toBe(false);
  });

  it('names the hand-off when the dial has to go round again', () => {
    let trace = beginConnect('create', T0);
    trace = connectTicketed(trace, { room: 'Q5RN', machine: MACHINE }, T0 + 1);
    trace = connectDialing(trace, { machine: MACHINE }, T0 + 2);
    trace = connectHandoff(trace, T0 + 3);
    expect(connectTraceModel(trace, T0 + 3).current).toBe('HANDING OFF (replay)…');
    // A second round is numbered, so "it keeps retrying" is visible rather than
    // being one line that never changes.
    trace = connectHandoff(trace, T0 + 4);
    expect(connectTraceModel(trace, T0 + 4).current).toBe('HANDING OFF (replay)… 2');
  });

  it('claims nothing before it happens — a stuck allocate shows only the allocate', () => {
    // The diagnostic value of the whole feature: what is on screen when it stops
    // IS the answer. A screen showing only "ALLOCATING ROOM…" says the allocator
    // never answered; one showing TICKET SIGNED above a stuck DIALING says the
    // allocator is fine and the socket is not.
    const model = connectTraceModel(beginConnect('create', T0), T0 + 100);
    expect(model.lines).toEqual(['ALLOCATING ROOM…']);
  });

  it('shows the JOIN door looking for a room, not creating one', () => {
    expect(connectTraceModel(beginConnect('join', T0), T0).current).toBe('FINDING ROOM…');
  });

  // --- The refusal ---------------------------------------------------------

  it('stops on the exact refusal, token first, plain words after', () => {
    // The frame the Director's live probe caught, turned into a sentence:
    //   {"type":"joinError","reason":"bad-ticket"}
    let trace = beginConnect('create', T0);
    trace = connectTicketed(trace, { room: 'Q5RN', machine: MACHINE }, T0 + 1);
    trace = connectDialing(trace, { machine: MACHINE }, T0 + 2);
    const model = connectTraceModel(connectRefused(trace, 'bad-ticket', T0 + 3), T0 + 3);

    expect(model.current).toBe('REFUSED: bad-ticket — machine mismatch');
    expect(model.error).toBe('REFUSED: bad-ticket — machine mismatch');
    expect(model.stage).toBe('refused');
    expect(model.busy).toBe(false);
    // Both affordances, on the panel, at the moment of failure.
    expect(model.canRetry).toBe(true);
    expect(model.offerDownloadLog).toBe(true);
    // The reason is already the last step, so the offer line does not repeat it.
    expect(connectOfferHint(model)).toBe('DOWNLOAD LOG to report this.');
  });

  it('glosses the reasons the server actually sends, and invents nothing for the rest', () => {
    expect(refusalGloss('bad-ticket')).toBe('machine mismatch');
    expect(refusalGloss('room-full')).toBe('every seat is taken');
    expect(refusalGloss('match-live')).toBe('that match already started');
    expect(refusalGloss('reclaim-expired')).toBe('your reconnect window ran out');
    // An unknown token is shown bare rather than explained by guesswork.
    expect(refusalGloss('something-new')).toBe('');
    const model = connectTraceModel(connectRefused(beginConnect('join', T0), 'something-new', T0), T0);
    expect(model.current).toBe('REFUSED: something-new');
  });

  it('reports an allocator failure as a failure, not a refusal', () => {
    const model = connectTraceModel(connectFailed(beginConnect('create', T0), 'no-capacity', T0), T0);
    expect(model.current).toBe('FAILED: no-capacity');
    expect(model.canRetry).toBe(true);
    expect(model.offerDownloadLog).toBe(true);
  });

  // --- The stall -----------------------------------------------------------

  it('auto-offers DOWNLOAD LOG after five seconds in any state', () => {
    const trace = connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0 + 10);
    const justBefore = connectTraceModel(trace, T0 + 10 + STALL_MS - 1);
    expect(justBefore.stalled).toBe(false);
    expect(justBefore.offerDownloadLog).toBe(false);

    const stalled = connectTraceModel(trace, T0 + 10 + STALL_MS);
    expect(stalled.stalled).toBe(true);
    expect(stalled.offerDownloadLog).toBe(true);
    // RETRY is NOT offered on a stall: the attempt is still live, and a second
    // allocate over the top of a socket that may yet open is how you get two rooms.
    expect(stalled.canRetry).toBe(false);
    // The step and the seconds are the TITLE's to say, so the offer names only the
    // offer — the screen never says the same sentence twice in two sizes.
    expect(connectOfferHint(stalled)).toBe('DOWNLOAD LOG to report this.');
    expect(connectTitleLine(stalled)).toBe('DIALING MACHINE 0800d5b6… 5s');
  });

  it('measures the stall from the LAST step, not from the start of the attempt', () => {
    let trace = beginConnect('create', T0);
    trace = connectTicketed(trace, { room: 'Q5RN', machine: MACHINE }, T0 + STALL_MS - 100);
    // Four-point-nine seconds have passed overall, but the current step is new.
    expect(connectTraceModel(trace, T0 + STALL_MS - 100).stalled).toBe(false);
  });

  it('never calls a finished attempt stalled', () => {
    // A seat that sat on screen for a minute is not a stall, and must not start
    // begging for the log.
    const model = connectTraceModel(happyPath(), T0 + 900 + 10 * STALL_MS);
    expect(model.stalled).toBe(false);
    expect(model.offerDownloadLog).toBe(false);
  });

  // --- The clock the stall is measured on (m10-15) --------------------------
  //
  // "I joined a room but it said to copy logs as if an error occurred — it showed
  // up too early." Three rules, one per test: the clock is time in the CURRENT
  // state and every advance resets it; a state that really does sit still is still
  // caught; and a seat cancels the offer on the spot.

  it('never offers the log on a slow connect that keeps advancing', () => {
    // The reported bug, simulated: a join on a cold Machine. Four seconds per
    // state, twenty overall — four times STALL_MS — and every one of them spent
    // making progress. The screen must not ask this player to report anything.
    const STEP = 4_000;
    const machine = { machine: MACHINE, room: 'Q5RN' };
    const advances: ConnectTrace[] = [];
    let trace = beginConnect('create', T0, 'planet-rush-allocator.fly.dev');
    advances.push(trace);
    trace = connectTicketed(trace, { room: 'Q5RN', machine: MACHINE }, T0 + STEP);
    advances.push(trace);
    trace = connectDialing(trace, machine, T0 + 2 * STEP);
    advances.push(trace);
    // The socket comes up — progress with no line of its own, and the advance the
    // bug was hiding in: without it the `dialing` clock would run from T0+2·STEP
    // straight through the server's join handling and trip at five seconds.
    trace = connectTransportState(trace, 'open', T0 + 3 * STEP);
    advances.push(trace);
    trace = connectJoined(trace, 1, T0 + 4 * STEP);
    advances.push(trace);

    // Sampled every quarter-second across the whole twenty, the way the live
    // ticker samples it — never a stall, never an offer, at any instant.
    for (let now = T0; now <= T0 + 4 * STEP; now += 250) {
      const at = advances.filter((t) => t.since <= now).pop()!;
      const model = connectTraceModel(at, now);
      expect({ now: now - T0, stalled: model.stalled, offer: model.offerDownloadLog }).toEqual({
        now: now - T0,
        stalled: false,
        offer: false,
      });
    }
    // …and the story it told is still the four lines of the happy path: a silent
    // advance moves the clock and says nothing.
    expect(connectTraceModel(trace, T0 + 4 * STEP).lines).toEqual([
      'ALLOCATING ROOM…',
      'ROOM Q5RN · TICKET SIGNED',
      'DIALING MACHINE 0800d5b6…',
      'JOINED · SEAT 2',
    ]);
  });

  it('still catches a single state that really does sit still', () => {
    // The other half of the contract: the fix must not buy its silence by going
    // deaf. One state, no advance of any kind, five seconds — the offer stands.
    let trace = connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0 + 400);
    trace = connectTransportState(trace, 'open', T0 + 900);
    // Nine seconds after the socket opened, with no welcome and no state change:
    // the server took the join and never answered it.
    const stalled = connectTraceModel(trace, T0 + 900 + 9_000);
    expect(stalled.stalled).toBe(true);
    expect(stalled.offerDownloadLog).toBe(true);
    // Measured from the open, not from the dial — 9s, not 9.5s.
    expect(connectTitleLine(stalled)).toBe('DIALING MACHINE 0800d5b6… 9s');
    // And a stall is not a failure: nothing is red and RETRY is not on offer.
    expect(connectTitleFailed(stalled)).toBe(false);
    expect(stalled.canRetry).toBe(false);
  });

  it('cancels a due offer the moment the seat arrives', () => {
    // The screen has been asking for the log for a full minute — and then the
    // welcome lands. The offer goes in the same frame, unconditionally.
    const dialing = connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0 + 100);
    const due = connectTraceModel(dialing, T0 + 100 + 12 * STALL_MS);
    expect(due.offerDownloadLog).toBe(true);

    const seated = connectJoined(dialing, 1, T0 + 100 + 12 * STALL_MS);
    const model = connectTraceModel(seated, T0 + 100 + 12 * STALL_MS);
    expect(model.stalled).toBe(false);
    expect(model.offerDownloadLog).toBe(false);
    expect(model.canRetry).toBe(false);
    // Nothing to say about it either — the title is the seat, with no clock on it.
    expect(connectOfferHint(model)).toBe('');
    expect(connectTitleLine(model)).toBe('JOINED · SEAT 2');
  });

  it('takes no advance from a finished attempt, and no clock backwards', () => {
    // `connectProgress` is a clock, and a clock that can be wound back is a way to
    // hide a stall: a late poll carrying an older `now` leaves it alone.
    const dialing = connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0 + 100);
    expect(connectProgress(dialing, T0 + 50)).toBe(dialing);
    expect(connectProgress(dialing, T0 + 100)).toBe(dialing);
    expect(connectProgress(dialing, T0 + 101).since).toBe(T0 + 101);
    // A seat has no "still going" to report, and a refusal must not be un-stuck by
    // a socket state arriving behind it.
    const seated = connectJoined(dialing, 1, T0 + 200);
    expect(connectProgress(seated, T0 + 9_000)).toBe(seated);
    expect(connectTransportState(seated, 'open', T0 + 9_000)).toBe(seated);
  });

  // --- The title -----------------------------------------------------------

  it('advances the TITLE through every state of a real connect', () => {
    // The developer's third pass, asserted as one list: the big line at the top of
    // the screen is never the same word twice in a row, and it is never
    // `CONNECTING…`. This is the whole ask, in one expectation.
    let trace = beginConnect('create', T0, 'planet-rush-allocator.fly.dev');
    const titles = [connectTitleLine(connectTraceModel(trace, T0))];
    trace = connectTicketed(trace, { room: 'Q5RN', machine: MACHINE, region: 'iad' }, T0 + 300);
    titles.push(connectTitleLine(connectTraceModel(trace, T0 + 300)));
    trace = connectDialing(trace, { machine: MACHINE, room: 'Q5RN' }, T0 + 400);
    titles.push(connectTitleLine(connectTraceModel(trace, T0 + 400)));
    trace = connectJoined(trace, 1, T0 + 900);
    titles.push(connectTitleLine(connectTraceModel(trace, T0 + 900)));

    expect(titles).toEqual([
      'ALLOCATING ROOM…',
      'ROOM Q5RN · TICKET SIGNED',
      'DIALING MACHINE 0800d5b6…',
      'JOINED · SEAT 2',
    ]);
    expect(titles).not.toContain('CONNECTING…');
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('stops the title on the exact refusal, and says so in red', () => {
    const dialing = connectDialing(beginConnect('join', T0), { machine: MACHINE }, T0 + 1);
    const model = connectTraceModel(connectRefused(dialing, 'bad-ticket', T0 + 2), T0 + 2);
    expect(connectTitleLine(model)).toBe('REFUSED: bad-ticket — machine mismatch');
    expect(connectTitleFailed(model)).toBe(true);
  });

  it('never hangs a clock on a title that is doing fine', () => {
    // The seconds are the removed panel's one line worth keeping — but only once a
    // step has sat long enough for the number to mean something.
    const trace = connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0);
    expect(connectTitleLine(connectTraceModel(trace, T0 + 900))).toBe('DIALING MACHINE 0800d5b6…');
    expect(connectTitleLine(connectTraceModel(trace, T0 + 12_000))).toBe('DIALING MACHINE 0800d5b6… 12s');
    expect(connectTitleFailed(connectTraceModel(trace, T0 + 12_000))).toBe(false);
  });

  // --- The transport's own states ------------------------------------------

  it('folds a pre-seat reconnect into a hand-off and a close into a failure', () => {
    const dialing = connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0 + 1);
    expect(connectTransportState(dialing, 'reconnecting', T0 + 2, 'dropped').stage).toBe('handoff');
    const closed = connectTransportState(dialing, 'closed', T0 + 2, 'join-rejected');
    expect(closed.stage).toBe('failed');
    expect(connectTraceModel(closed, T0 + 2).current).toBe('FAILED: join-rejected');
  });

  it('leaves a finished story alone — a later state change cannot rewrite the ending', () => {
    // `joinError` arrives first and the socket closes right after (M10). The close
    // must not overwrite "REFUSED: bad-ticket" with a vaguer "FAILED".
    const refused = connectRefused(connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0), 'bad-ticket', T0 + 1);
    const after = connectTransportState(refused, 'closed', T0 + 2, 'join-rejected');
    expect(after).toBe(refused);
    expect(connectTraceModel(after, T0 + 2).current).toBe('REFUSED: bad-ticket — machine mismatch');
  });

  it('an open socket is not a step, but it IS an advance', () => {
    // The join is what matters, so the socket coming up adds no line: the story is
    // the same three lines it was. What it does add is progress — the dial is over
    // and the wait that follows is a different wait — so the stall clock starts
    // again from the open (m10-15; without this a healthy join tripped the offer).
    const dialing = connectDialing(beginConnect('create', T0), { machine: MACHINE }, T0 + 1);
    const open = connectTransportState(dialing, 'open', T0 + 2_000);
    expect(open.steps).toEqual(dialing.steps);
    expect(open.stage).toBe('dialing');
    expect(connectTraceModel(open, T0 + 2_000).waitedMs).toBe(0);
    // Two seconds dialling plus four seconds waiting on the server is six seconds
    // and two states, so it is not a stall in either of them.
    expect(connectTraceModel(open, T0 + 6_000).stalled).toBe(false);
    // `connecting` is where every attempt starts, so it is not progress at all.
    expect(connectTransportState(dialing, 'connecting', T0 + 2_000)).toBe(dialing);
  });

  // --- The session log -----------------------------------------------------

  it('hands every step to the session log with its own line attached', () => {
    const trace = happyPath();
    const entries = trace.steps.map(connectTraceLogEntry);
    expect(entries.map((e) => e.step)).toEqual(['allocating', 'ticketed', 'dialing', 'joined']);
    // The structured detail the screen had no room for rides along — the machine id
    // above all, which is the line that tells "couldn't connect" from "connected to
    // the wrong Machine" (m10-09b `connect` channel).
    expect(entries[1]?.data).toMatchObject({ room: 'Q5RN', machine: MACHINE, region: 'iad' });
    expect(entries[1]?.data['line']).toBe('ROOM Q5RN · TICKET SIGNED');
    expect(entries[3]?.data).toMatchObject({ seat: 1 });
  });

  it('has no way to carry a ticket value onto the screen or into the log', () => {
    // The ticket is a signed credential and the whole trace gets pasted into chat
    // by a developer reporting a bug. So the ticketed step takes the room, the
    // machine, the region and an expiry — and the API has no parameter for the
    // ticket itself, which is the only way to be sure it never leaks.
    const trace = connectTicketed(
      beginConnect('create', T0),
      { room: 'Q5RN', machine: MACHINE, region: 'iad', expiresInMs: 60_000 },
      T0 + 1,
    );
    const step = trace.steps[1]!;
    expect(Object.keys(step.data).sort()).toEqual(['expiresInMs', 'machine', 'region', 'room']);
    expect(step.line).toBe('ROOM Q5RN · TICKET SIGNED'); // says it was signed, never what it is
  });

  it('carries the placement reason into the log without changing the title', () => {
    // "Why am I on a US server?" has to be answerable from the paste. It is NOT
    // answerable from the screen: the title is one line and a player waiting to
    // connect does not need a routing rationale in it.
    const trace = connectTicketed(
      beginConnect('create', T0),
      { room: 'Q5RN', machine: MACHINE, region: 'gru', placement: 'gru — your region' },
      T0 + 1,
    );
    const step = trace.steps[1]!;

    expect(step.line).toBe('ROOM Q5RN · TICKET SIGNED');
    expect(connectTraceLogEntry(step).data).toMatchObject({
      region: 'gru',
      placement: 'gru — your region',
    });
  });

  it('omits the placement entirely when the allocator gave no reason', () => {
    const trace = connectTicketed(
      beginConnect('join', T0),
      { room: 'Q5RN', machine: MACHINE, region: 'gru' },
      T0 + 1,
    );
    expect(Object.keys(trace.steps[1]!.data)).not.toContain('placement');
  });

  // --- Small things --------------------------------------------------------

  it('shortens a Fly machine id to something a person can compare', () => {
    expect(shortMachine(MACHINE)).toBe('0800d5b6');
    expect(shortMachine('short')).toBe('short');
    expect(shortMachine('')).toBe('?');
  });
});
