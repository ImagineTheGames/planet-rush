/**
 * src/net/local-revert.test.ts — the decision, the release, and the line the
 * player reads. OWNER: Netcode Engineer (a0-11; GDD §4.2 *amended 2026-08-07*).
 *
 * The end-to-end proof — a real server, a real socket, a real room swept off it —
 * is `tests/net/local-revert.test.ts`. These are the pieces underneath it: the
 * rule itself, so it cannot quietly start keying off the door instead of the
 * roster; the seat arithmetic, because the lobby's numbering and the sim's stop
 * agreeing the moment a chair is left empty; and the tell, which has to be a line
 * and not a dialog.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_REVERT_TELL,
  ROOM_COST_NOTE,
  localSeat,
  playsLocally,
  releaseRoom,
} from './local-revert';
import { LOCAL_REVERT_TELL_ID, TELL_VISIBLE_MS, showLocalRevertTell } from './local-revert-view';
import type { TraceDom, TraceElement } from './connect-trace-view';

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

describe('whether a room needs a server at all', () => {
  it('plays locally when the host is the only human, whatever the bot count', () => {
    // The case the developer reported, at every size it comes in.
    expect(playsLocally({ humans: 1, bots: 0 })).toBe(true);
    expect(playsLocally({ humans: 1, bots: 1 })).toBe(true);
    expect(playsLocally({ humans: 1, bots: 7 })).toBe(true);
  });

  it('needs an authority the moment a second person is in the room', () => {
    // Two humans need an authority neither of them owns — there are no listen
    // servers and no peer-to-peer (GDD §4.2), so this is the whole of "online".
    expect(playsLocally({ humans: 2, bots: 0 })).toBe(false);
    expect(playsLocally({ humans: 2, bots: 6 })).toBe(false);
    expect(playsLocally({ humans: 8, bots: 0 })).toBe(false);
  });

  it('is a question about PEOPLE, not about bots or about which door was used', () => {
    // Bots never change the answer: they are simulated by authority either way,
    // and a room full of them for one player is the case that saves the most.
    for (let bots = 0; bots <= 7; bots++) {
      expect(playsLocally({ humans: 1, bots }), `1 human, ${bots} bots`).toBe(true);
      expect(playsLocally({ humans: 2, bots }), `2 humans, ${bots} bots`).toBe(false);
    }
  });
});

describe('which ship the local player flies once the match is local', () => {
  it('takes the DENSE index it is given — the lobby’s seat is not the sim’s', () => {
    expect(localSeat(0)).toBe(0);
    expect(localSeat(2)).toBe(2);
  });

  it('never leaves the player without a ship', () => {
    // A boot with no seat is a black screen, so every unusable answer folds to 0.
    expect(localSeat(null)).toBe(0);
    expect(localSeat(undefined)).toBe(0);
    expect(localSeat(-3)).toBe(0);
    expect(localSeat(Number.NaN)).toBe(0);
    expect(localSeat(1.9)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The release
// ---------------------------------------------------------------------------

describe('handing the room back', () => {
  it('closes the session and names the code it freed', () => {
    const close = vi.fn();
    const release = releaseRoom({ code: 'K7QM', close });
    expect(close, 'the socket is what frees the room').toHaveBeenCalledTimes(1);
    expect(release).toEqual({ room: 'K7QM', released: true });
  });

  it('is a no-op with no room to give back — the offline path reaches it too', () => {
    expect(releaseRoom(null)).toBeNull();
    expect(releaseRoom(undefined)).toBeNull();
  });

  it('states what a held room costs, so the saving is a number', () => {
    // The brief asks for the figure by name. It comes from the measured capacity
    // work (m11-01, docs/server-capacity.md) and the deployed guest
    // (fly.gameserver.toml): 6 rooms per $3.19/mo shared-cpu-1x.
    expect(ROOM_COST_NOTE).toContain('$3.19');
    expect(ROOM_COST_NOTE).toContain('4.7 ms');
    expect(ROOM_COST_NOTE).toContain('drained and stopped');
  });
});

// ---------------------------------------------------------------------------
// The tell
// ---------------------------------------------------------------------------

/** The smallest DOM the view writes through (`./connect-trace-view` TraceDom). */
function fakeDom(): { dom: TraceDom; children: TraceElement[] } {
  const children: TraceElement[] = [];
  const make = (): TraceElement => {
    const el = {
      id: '',
      innerHTML: '',
      hidden: false,
      addEventListener: (): void => {},
      appendChild: (): void => {},
      remove: (): void => {
        const at = children.indexOf(el);
        if (at >= 0) children.splice(at, 1);
      },
    };
    return el;
  };
  const body = make();
  const dom: TraceDom = {
    createElement: () => make(),
    getElementById: (id) => children.find((c) => c.id === id) ?? null,
    body: { ...body, appendChild: (child: unknown): void => void children.push(child as TraceElement) },
  };
  return { dom, children };
}

describe('the one line that says the match went local', () => {
  it('says what happened, in the player’s terms', () => {
    // Their question is about the room they opened, not about our hosting bill.
    expect(LOCAL_REVERT_TELL).toBe('NOBODY JOINED — PLAYING LOCALLY');
  });

  it('mounts one line and no buttons — a tell, never a dialog', () => {
    const { dom, children } = fakeDom();
    const el = showLocalRevertTell({ dom, setTimeout: () => 0 });
    expect(el?.id).toBe(LOCAL_REVERT_TELL_ID);
    expect(children).toHaveLength(1);
    expect(children[0]?.innerHTML).toBe(LOCAL_REVERT_TELL);
    // Nothing to press, and nothing that could swallow a tap meant for the match.
    expect(children[0]?.innerHTML).not.toContain('<button');
    expect((children[0] as unknown as { style?: string }).style).toContain('pointer-events:none');
  });

  it('shows once, however many times it is asked', () => {
    const { dom, children } = fakeDom();
    showLocalRevertTell({ dom, setTimeout: () => 0 });
    showLocalRevertTell({ dom, setTimeout: () => 0 });
    expect(children, 'a second call must not stack a second plate').toHaveLength(1);
  });

  it('takes itself away, so a match five minutes in carries no trace of it', () => {
    const { dom, children } = fakeDom();
    let fired: (() => void) | null = null;
    let delay = -1;
    showLocalRevertTell({
      dom,
      setTimeout: (fn, ms) => {
        fired = fn;
        delay = ms;
        return 0;
      },
    });
    expect(delay).toBe(TELL_VISIBLE_MS);
    expect(children).toHaveLength(1);
    fired!();
    expect(children, 'the tell removes itself').toHaveLength(0);
  });

  it('escapes what it is handed — the words come from a model, but the seam is HTML', () => {
    const { dom, children } = fakeDom();
    showLocalRevertTell({ dom, setTimeout: () => 0, message: '<img src=x onerror=1>' });
    expect(children[0]?.innerHTML).not.toContain('<img');
  });

  it('does nothing at all with no body to mount into (a headless boot)', () => {
    const dom: TraceDom = { createElement: () => ({}) as TraceElement, getElementById: () => null, body: null };
    expect(showLocalRevertTell({ dom, setTimeout: () => 0 })).toBeNull();
  });
});
