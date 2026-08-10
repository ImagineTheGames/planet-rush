/**
 * src/net/link-loss.test.ts — the connection dying loudly. OWNER: Netcode Engineer.
 *
 * The developer's report is one sentence and it names three separate bugs: *"left
 * browser, came back, disconnected — bots frozen but I could still move."* The
 * client did not notice; it did not stop; it did not say. Each `describe` below is
 * one of those three, plus the words the overlay puts on screen.
 *
 * No clock, no socket, no DOM: `LinkWatch` takes `now` as a parameter, so a
 * sixty-second grace window elapses here in microseconds and nothing in this file
 * can be flaky.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LINK_GRACE_MS,
  LinkWatch,
  SILENCE_CEIL_MS,
  SILENCE_FLOOR_MS,
  VISIBILITY_STALE_MS,
  endingTitle,
  linkLossLogEntry,
  linkNotice,
  lossPhrase,
  silenceLimitMs,
} from './link-loss';

/** A watch on a short grace window, so the countdown is readable in the assertions. */
function watching(startedAt = 1_000, graceWindowMs = 10_000): LinkWatch {
  return new LinkWatch(startedAt, { graceWindowMs });
}

describe('silenceLimitMs', () => {
  it('never drops below the measured-stall floor, whatever the arithmetic says', () => {
    // The brief's literal rule — 3 x 33 ms — is ~100 ms, which is inside this
    // game's own measured jitter (`server/room.ts` INTENT_HOLD_TICKS covers a
    // 750 ms stall). A limit that short would throw CONNECTION LOST across a
    // healthy match, so the floor is the ratified-by-measurement part.
    expect(silenceLimitMs(null)).toBe(SILENCE_FLOOR_MS);
    expect(silenceLimitMs(0)).toBe(SILENCE_FLOOR_MS);
    expect(silenceLimitMs(20)).toBe(SILENCE_FLOOR_MS);
  });

  it('buys a slow wire more patience, up to a cap', () => {
    // 3 x 33.3 + 4 x 800 = 3300 — a phone on a bad cell deserves the margin.
    expect(silenceLimitMs(800)).toBeGreaterThan(SILENCE_FLOOR_MS);
    expect(silenceLimitMs(800)).toBeCloseTo(SILENCE_SNAPSHOTS_MS + 3200, 0);
    // …but a wildly-reported RTT cannot buy half a minute of zombie flight.
    expect(silenceLimitMs(60_000)).toBe(SILENCE_CEIL_MS);
  });

  it('ignores a nonsense measurement rather than trusting it', () => {
    expect(silenceLimitMs(Number.NaN)).toBe(SILENCE_FLOOR_MS);
    expect(silenceLimitMs(-5)).toBe(SILENCE_FLOOR_MS);
    expect(silenceLimitMs(Number.POSITIVE_INFINITY)).toBe(SILENCE_FLOOR_MS);
  });
});

/** 3 snapshots at 30 Hz, the arithmetic half of the limit. */
const SILENCE_SNAPSHOTS_MS = 3 * (1000 / 30);

describe('detection: silence', () => {
  it('a socket that stops delivering is LOST, however open it claims to be', () => {
    const watch = watching();
    // The transport says `open` the whole way through — this is the lie.
    watch.transportState('open', 1_000);
    expect(watch.poll(1_000).phase).toBe('live');
    expect(watch.poll(1_000 + SILENCE_FLOOR_MS - 1).phase).toBe('live');

    watch.transportState('open', 1_000 + SILENCE_FLOOR_MS);
    const lost = watch.poll(1_000 + SILENCE_FLOOR_MS);
    expect(lost.phase).toBe('lost');
    expect(lost.cause).toBe('silence');
    expect(lost.silentMs).toBe(SILENCE_FLOOR_MS);
  });

  it('a pong is proof of life even when no snapshot is (the probe answers off the tick loop)', () => {
    const watch = watching();
    // Half the limit goes by, then a pong lands: the clock restarts from the pong,
    // so the same wall-clock instant that would have been a loss is not one.
    watch.poll(1_000 + SILENCE_FLOOR_MS / 2);
    watch.frame(1_000 + SILENCE_FLOOR_MS / 2);
    expect(watch.poll(1_000 + SILENCE_FLOOR_MS).phase).toBe('live');
    expect(watch.poll(1_000 + SILENCE_FLOOR_MS * 1.5).phase).toBe('lost');
  });

  it('a frame arriving after the loss un-freezes in the same call', () => {
    const watch = watching();
    watch.poll(1_000 + SILENCE_FLOOR_MS);
    expect(watch.frozen).toBe(true);

    watch.frame(1_000 + SILENCE_FLOOR_MS + 100);
    expect(watch.frozen).toBe(false);
    const back = watch.poll(1_000 + SILENCE_FLOOR_MS + 100);
    expect(back.phase).toBe('live');
    expect(back.cause).toBeNull();
  });
});

describe('detection: the backgrounded tab (the developer’s case)', () => {
  it('suspends while hidden — a throttled tab is not evidence', () => {
    const watch = watching(1_000, 60_000);
    watch.hide();
    // Half a minute away. Nothing is claimed while the page is not being scheduled:
    // a limit measured across a background is measuring the browser's scheduler.
    expect(watch.poll(31_000).phase).toBe('live');
  });

  it('judges the return: a stale last frame IS the diagnosis', () => {
    const watch = watching(1_000, 60_000);
    watch.hide();
    watch.poll(9_000);
    watch.shown(9_000);

    const status = watch.poll(9_000);
    expect(status.phase).toBe('lost');
    // Named for what actually happened — never a generic "connection problem".
    expect(status.cause).toBe('backgrounded');
    expect(linkNotice(status).title).toContain('tab was backgrounded');
  });

  it('a quick alt-tab with fresh data claims nothing', () => {
    const watch = watching();
    watch.hide();
    // The socket kept delivering while the tab was away (a desktop tab often does).
    watch.frame(3_000);
    watch.shown(3_000 + VISIBILITY_STALE_MS - 1);
    expect(watch.poll(3_000 + VISIBILITY_STALE_MS - 1).phase).toBe('live');
  });
});

describe('detection: the socket saying so', () => {
  it('a transport that is already redialling still offers the player the button', () => {
    const watch = watching();
    watch.transportState('reconnecting', 2_000);
    const status = watch.poll(2_000);
    expect(status.phase).toBe('redialing');
    expect(status.cause).toBe('socket');
    // This assertion used to read the other way — "nothing for the player to press
    // but ABANDON: the client is already dialling" — and that reading is what put a
    // one-button card in front of the developer for the whole grace window (n8-01).
    // The client dialling on a backoff nobody can see is not an answer to a player
    // who wants to try NOW, and `./websocket-transport` `redial` cancels that wait.
    expect(linkNotice(status).actions.map((a) => a.kind)).toEqual(['reconnect', 'abandon']);
  });

  it('a closed transport is terminal and carries its reason', () => {
    const watch = watching();
    watch.transportState('closed', 2_000, 'room-gone');
    const status = watch.poll(2_000);
    expect(status.phase).toBe('expired');
    expect(status.ending).toBe('room-gone');
    expect(linkNotice(status).title).toBe('MATCH ENDED — the room is gone');
  });
});

describe('the grace window', () => {
  it('counts down from the last proof of life, not from the moment we noticed', () => {
    const watch = watching(1_000, 10_000);
    // Last frame at t=1000; silence detected at t=3500 (the floor). The server has
    // been counting since ~1000, so 2500 ms of the window is already spent.
    const lost = watch.poll(1_000 + SILENCE_FLOOR_MS);
    expect(lost.graceRemainingMs).toBe(10_000 - SILENCE_FLOOR_MS);
  });

  it('expires when it runs out, and says the seat is gone', () => {
    const watch = watching(1_000, 10_000);
    watch.poll(5_000);
    const gone = watch.poll(11_001);
    expect(gone.phase).toBe('expired');
    expect(gone.ending).toBe('grace-elapsed');
    expect(gone.graceRemainingMs).toBe(0);

    const notice = linkNotice(gone);
    expect(notice.title).toBe('SEAT EXPIRED — a bot flew your ship, match went on');
    // One button, and it is not a retry: there is nothing to retry into.
    expect(notice.actions).toHaveLength(1);
    expect(notice.actions[0]?.kind).toBe('menu');
  });

  it('defaults to the ratified ~60 s window (GDD §4.2)', () => {
    const watch = new LinkWatch(0);
    expect(watch.poll(0).graceRemainingMs).toBe(DEFAULT_LINK_GRACE_MS);
  });
});

describe('the one automatic redial', () => {
  it('is offered once per loss, and spent by the caller', () => {
    const watch = watching();
    watch.hide();
    watch.shown(6_000);
    watch.poll(6_000);

    expect(watch.takeAutoRedial(6_000)).toBe(true);
    // Once. The overlay asks from here on rather than dialling in a loop.
    expect(watch.takeAutoRedial(6_000)).toBe(false);

    watch.beginRedial(6_000);
    const status = watch.poll(6_000);
    expect(status.phase).toBe('redialing');
    expect(status.attempts).toBe(1);
    expect(linkNotice(status).busy).toBe(true);
  });

  it('is not offered once the seat is gone', () => {
    const watch = watching(1_000, 10_000);
    watch.poll(5_000);
    watch.poll(12_000); // window spent
    expect(watch.takeAutoRedial(12_000)).toBe(false);
  });

  it('a failed dial goes back to asking, with the attempt count kept', () => {
    const watch = watching();
    watch.poll(5_000);
    watch.beginRedial(5_000);
    watch.redialFailed(5_200);
    const status = watch.poll(5_200);
    expect(status.phase).toBe('lost');
    expect(status.attempts).toBe(1);

    watch.beginRedial(5_300);
    expect(linkNotice(watch.poll(5_300)).title).toBe('RECONNECTING… ATTEMPT 2');
  });

  it('a fresh loss after a recovery gets its own automatic attempt', () => {
    const watch = watching();
    watch.poll(5_000);
    watch.takeAutoRedial(5_000);
    watch.frame(5_100); // back
    watch.poll(5_100);
    watch.poll(9_000); // and gone again
    expect(watch.takeAutoRedial(9_000)).toBe(true);
  });
});

describe('the end of the match', () => {
  it('stops watching, because an ended room stops broadcasting', () => {
    // `server/room.ts` `update` returns early once the phase is 'ended', so the
    // wire falls silent at the exact moment the summary screen goes up. Without
    // `retire` every finished online match would cry CONNECTION LOST over it.
    const watch = watching(1_000, 60_000);
    watch.retire(1_000);
    expect(watch.poll(120_000).phase).toBe('live');
    expect(watch.frozen).toBe(false);
    // And nothing re-arms it: not the tab, not the socket hanging up on the way
    // out to the menu.
    watch.hide();
    watch.shown(180_000);
    watch.transportState('closed', 180_000, 'left');
    expect(watch.poll(180_000).phase).toBe('live');
  });
});

describe('abandon', () => {
  it('is terminal, and says so in the player’s own words', () => {
    const watch = watching();
    watch.abandon(4_000);
    const status = watch.poll(4_000);
    expect(status.phase).toBe('expired');
    expect(status.ending).toBe('left');
    expect(watch.frozen).toBe(true);
    expect(linkNotice(status).title).toContain('ABANDONED');
  });
});

describe('the words on screen', () => {
  it('draws nothing at all while the link is live', () => {
    const watch = watching();
    expect(linkNotice(watch.poll(1_000)).visible).toBe(false);
  });

  it('names the cause and puts the countdown on the button', () => {
    const watch = watching(1_000, 60_000);
    watch.hide();
    watch.shown(21_000);
    const status = watch.poll(21_000);

    const notice = linkNotice(status);
    expect(notice.visible).toBe(true);
    expect(notice.title).toBe('CONNECTION LOST — no server data for 20s (tab was backgrounded)');
    // 60 s window, 20 s of it already spent while the tab was away.
    expect(notice.grace).toBe('40s');
    expect(notice.actions.map((a) => a.kind)).toEqual(['reconnect', 'abandon']);
    expect(notice.actions[0]?.label).toBe('RECONNECT · 40s');
    expect(notice.actions[0]?.primary).toBe(true);
    expect(notice.failed).toBe(false);
  });

  /**
   * n8-01: *"the ask was two buttons; the build draws one"*.
   *
   * The RECONNECTING… card is not a corner case — measured on the served build it is
   * what the player looks at for essentially the whole grace window, because a fresh
   * loss spends its automatic redial in the same poll that detected it and the
   * transport then retries on a backoff that never reports failure. So the button
   * that is missing here is the button that is missing, full stop.
   */
  describe('RECONNECT during the grace window', () => {
    /** The card the developer actually met: 4 s of silence, auto-redial spent. */
    function reconnectingCard(): ReturnType<typeof linkNotice> {
      const watch = watching(1_000, 60_000);
      watch.poll(5_000); // silence detected
      expect(watch.takeAutoRedial(5_000)).toBe(true);
      watch.beginRedial(5_000); // …and spent, by the client, on its own
      const status = watch.poll(5_000);
      expect(status.phase).toBe('redialing');
      return linkNotice(status);
    }

    it('is drawn on the card the player is actually looking at', () => {
      const notice = reconnectingCard();
      expect(notice.actions.map((a) => a.kind)).toEqual(['reconnect', 'abandon']);
      expect(notice.actions[0]?.label).toContain('RECONNECT');
      // The seconds ride the button here too: they are the decision.
      expect(notice.actions[0]?.label).toContain(notice.grace);
      expect(notice.actions[0]?.primary).toBe(true);
    });

    it('leaves the verified title and detail exactly as a1-13 read them', () => {
      // The words are not this brief's to change — only the buttons under them.
      const notice = reconnectingCard();
      expect(notice.title).toBe('RECONNECTING…');
      expect(notice.detail).toBe('no server data for 4s — reclaiming your seat, 56s of grace left.');
    });

    it('is NOT offered once the seat is gone — there is nothing to reconnect to', () => {
      const watch = watching(1_000, 10_000);
      watch.poll(5_000);
      const notice = linkNotice(watch.poll(12_000));
      expect(notice.title).toContain('SEAT EXPIRED');
      expect(notice.actions.map((a) => a.kind)).toEqual(['menu']);
    });

    it('is still a real attempt while the automatic dial is in flight', () => {
      // The press must not be a label on a timer: it counts as its own attempt, and
      // the card says so in the same breath.
      const watch = watching(1_000, 60_000);
      watch.poll(5_000);
      watch.beginRedial(5_000); // the automatic one
      watch.beginRedial(5_100, true); // …and the player presses anyway
      const status = watch.poll(5_100);
      expect(status.attempts).toBe(2);
      expect(status.manualRedial).toBe('dialing');
      expect(linkNotice(status).detail).toContain('You pressed RECONNECT — attempt 2 went out just now.');
    });

    it('says so when the press cannot get out, instead of doing nothing visible', () => {
      // The transport has no dial to give (a dead room, a spent window, a transport
      // with no redial gesture). Silence here is the failure a1-13 would catch.
      const watch = watching(1_000, 60_000);
      watch.poll(5_000);
      watch.beginRedial(5_000);
      watch.redialFailed(5_100, true);
      const status = watch.poll(5_100);
      expect(status.manualRedial).toBe('failed');
      expect(linkNotice(status).detail).toContain('could not go out');
    });

    it('reports a failed press even from the card that is not dialling', () => {
      // `redialFailed` used to return early whenever the phase was already `'lost'`,
      // so a press on the CONNECTION LOST card changed nothing anywhere.
      const watch = watching(1_000, 60_000);
      watch.poll(5_000);
      expect(watch.status.phase).toBe('lost');
      watch.redialFailed(5_100, true);
      expect(watch.status.manualRedial).toBe('failed');
      expect(linkNotice(watch.status).detail).toContain('could not go out');
    });

    it('forgets the press when the link comes back, and again on the next loss', () => {
      const watch = watching(1_000, 60_000);
      watch.poll(5_000);
      watch.redialFailed(5_000, true);
      expect(watch.status.manualRedial).toBe('failed');

      watch.frame(5_200); // a frame — any frame — is proof of life
      expect(watch.poll(5_200).manualRedial).toBe('none');
      expect(watch.poll(9_000).manualRedial).toBe('none'); // and gone again, fresh
    });

    it('the client’s own automatic dial is never reported as the player’s press', () => {
      const watch = watching(1_000, 60_000);
      watch.poll(5_000);
      watch.beginRedial(5_000); // automatic: no `manual` flag
      expect(watch.poll(5_000).manualRedial).toBe('none');
      expect(linkNotice(watch.status).detail).not.toContain('You pressed');
    });
  });

  it('spells each detected cause differently — that is the whole point', () => {
    expect(lossPhrase('silence', 8_000)).toBe('no server data for 8s');
    expect(lossPhrase('backgrounded', 8_000)).toBe('no server data for 8s (tab was backgrounded)');
    expect(lossPhrase('socket', 8_000)).toBe('the socket closed — no server data for 8s');
  });

  it('reserves threat red for the endings, where it is earned (style-guide §2)', () => {
    const watch = watching(1_000, 10_000);
    watch.poll(5_000);
    expect(linkNotice(watch.poll(5_000)).failed).toBe(false);
    expect(linkNotice(watch.poll(12_000)).failed).toBe(true);
    expect(endingTitle('join-rejected')).toContain('REFUSED');
  });
});

describe('the session log line', () => {
  it('carries the cause, the silence, the window and the attempt count', () => {
    const watch = watching(1_000, 10_000);
    watch.hide();
    watch.shown(6_000);
    watch.beginRedial(6_000);
    const entry = linkLossLogEntry(watch.poll(6_000));
    expect(entry.step).toBe('link redialing');
    expect(entry.data).toMatchObject({
      cause: 'backgrounded',
      silentMs: 5_000,
      graceMs: 5_000,
      attempts: 1,
      ending: null,
    });
  });
});
