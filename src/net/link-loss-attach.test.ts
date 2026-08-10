/**
 * src/net/link-loss-attach.test.ts — the wire, asserted without a browser.
 * OWNER: Netcode Engineer (n6-01).
 *
 * **This file cannot prove the thing the brief is about.** The overlay it covers
 * was already unit-green (`./link-loss-view.test.ts`) and the watchdog under it was
 * green over the real stack (`tests/net/disconnect-honesty.test.ts`) on the day the
 * feature shipped calling *none* of it. A dead wire is invisible to a test that
 * holds both ends itself, which is exactly how this got merged. The proof that the
 * shipped client installs it is `tests/live-stage/link-loss.spec.ts`, which boots
 * the real bundle, kills a real socket and clicks the real buttons.
 *
 * What this file is for is the mapping — which button reaches which session method,
 * and that a page coming back from the background is judged at all — asserted
 * against a REAL {@link LinkWatch}, so the cards under test are the cards the phase
 * machine actually produces, in the order it produces them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { LinkWatch, SILENCE_FLOOR_MS, VISIBILITY_STALE_MS } from './link-loss';
import type { LinkStatus } from './link-loss';
import { attachLinkLoss } from './link-loss-attach';
import type { LinkLossHandle, PageVisibility, WatchedSession } from './link-loss-attach';
import { LINK_LOSS_BUTTON_IDS, linkLossView, resetLinkLossView } from './link-loss-view';
import type { TraceDom, TraceElement } from './connect-trace-view';

const T0 = 1_700_000_000_000;

afterEach(() => resetLinkLossView());

// --- A fake DOM, the same shape `./link-loss-view.test.ts` uses ---------------

interface FakeElement extends TraceElement {
  listeners: Record<string, (() => void)[]>;
  children: unknown[];
  click(): void;
}

function fakeElement(id = ''): FakeElement {
  return {
    id,
    innerHTML: '',
    hidden: false,
    listeners: {},
    children: [],
    addEventListener(type, handler): void {
      (this.listeners[type] ??= []).push(handler);
    },
    appendChild(child): void {
      this.children.push(child);
    },
    remove(): void {
      this.children.length = 0;
    },
    click(): void {
      for (const handler of this.listeners['click'] ?? []) handler();
    },
  };
}

interface FakeDom extends TraceDom {
  root: FakeElement;
  /** The button with this id, or null when the overlay is not drawing it. */
  button(id: string): FakeElement | null;
  html(): string;
}

function fakeDom(): FakeDom {
  const body = fakeElement('body');
  const byId = new Map<string, FakeElement>();
  const dom: FakeDom = {
    body,
    root: body,
    createElement(): TraceElement {
      const el = fakeElement();
      dom.root = el;
      return el;
    },
    getElementById(id: string): TraceElement | null {
      // A button exists only once the overlay's markup names it — so "is RECONNECT
      // on screen?" is a real question rather than a stub's opinion.
      if (!dom.root.innerHTML.includes(`id="${id}"`)) return null;
      let el = byId.get(id);
      if (!el) {
        el = fakeElement(id);
        byId.set(id, el);
      }
      return el;
    },
    button: (id) => (dom.root.innerHTML.includes(`id="${id}"`) ? (dom.getElementById(id) as FakeElement) : null),
    html: () => dom.root.innerHTML,
  };
  return dom;
}

// --- A session that is a real watchdog behind a counted surface ---------------

interface FakeSession extends WatchedSession {
  readonly calls: { reconnect: number; leave: number; hidden: number };
  /** Make the next redial refuse to start, the way `./websocket-transport` `redial`
   *  does for a dead room or a spent window — the case that leaves the player on the
   *  CONNECTION LOST card with a RECONNECT button to press. */
  dialFails: boolean;
  /** The session's clock, moved by the test rather than by sleeping. */
  now: number;
  /** A server frame arrived — any frame is proof of life (`./link-loss`). */
  frame(): void;
}

function fakeSession(watch: LinkWatch): FakeSession {
  const session: FakeSession = {
    calls: { reconnect: 0, leave: 0, hidden: 0 },
    dialFails: false,
    now: T0,
    frame: (): void => watch.frame(session.now),
    // Faithful to `./session` `pollLink`, including the one automatic redial a fresh
    // loss is owed — which is why the first card a player usually meets is
    // RECONNECTING… rather than CONNECTION LOST.
    pollLink: (now = session.now): LinkStatus => {
      watch.poll(now);
      if (watch.takeAutoRedial(now)) session.reconnect(now);
      return watch.status;
    },
    linkHidden: (): void => {
      session.calls.hidden++;
      watch.hide();
    },
    linkShown: (now = session.now): LinkStatus => {
      watch.shown(now);
      return session.pollLink(now);
    },
    // The same two-branch shape as `./session` `reconnect`.
    reconnect: (now = session.now): boolean => {
      session.calls.reconnect++;
      if (session.dialFails) {
        watch.redialFailed(now);
        return false;
      }
      watch.beginRedial(now);
      return true;
    },
    leave: (): void => {
      session.calls.leave++;
      watch.abandon(session.now);
    },
  };
  return session;
}

interface FakePage extends PageVisibility {
  hidden: boolean;
  /** The page's own `visibilitychange`, dispatched to whoever subscribed. */
  fire(): void;
  readonly subscribers: number;
}

function fakePage(): FakePage {
  const handlers: (() => void)[] = [];
  return {
    hidden: false,
    addEventListener(_type, handler): void {
      handlers.push(handler);
    },
    removeEventListener(_type, handler): void {
      const at = handlers.indexOf(handler);
      if (at >= 0) handlers.splice(at, 1);
    },
    fire(): void {
      for (const handler of [...handlers]) handler();
    },
    get subscribers(): number {
      return handlers.length;
    },
  };
}

interface Harness {
  dom: FakeDom;
  page: FakePage;
  session: FakeSession;
  handle: LinkLossHandle;
  /** One rendered frame, as `main.ts` runs it. */
  frame(): void;
  menu: number;
}

function harness(): Harness {
  const dom = fakeDom();
  const page = fakePage();
  const session = fakeSession(new LinkWatch(T0, { graceWindowMs: 60_000 }));
  const state = { menu: 0 };
  const handle = attachLinkLoss({ session, dom, page, onMenu: () => state.menu++ });
  return {
    dom,
    page,
    session,
    handle,
    frame: () => handle.poll(),
    get menu(): number {
      return state.menu;
    },
  };
}

describe('attachLinkLoss', () => {
  it('draws nothing at all while the link is live', () => {
    const h = harness();
    for (let i = 0; i < 10; i++) {
      h.session.now += 16;
      h.session.frame();
      h.frame();
    }
    expect(h.dom.html()).toBe('');
    expect(h.session.calls.reconnect).toBe(0);
  });

  it('puts the overlay up when the link goes silent, naming what was detected', () => {
    const h = harness();
    h.session.now += SILENCE_FLOOR_MS;
    h.frame();

    expect(h.dom.html()).toContain('no server data for');
    // The one automatic attempt is spent inside the poll, so the card a player
    // actually meets is RECONNECTING… with ABANDON MATCH under it.
    expect(h.session.calls.reconnect).toBe(1);
    expect(h.dom.html()).toContain('RECONNECTING…');
    expect(h.dom.button(LINK_LOSS_BUTTON_IDS.abandon)).not.toBeNull();
  });

  it('ABANDON MATCH leaves the match, and the card says so in the same press', () => {
    const h = harness();
    h.session.now += SILENCE_FLOOR_MS;
    h.frame();

    const abandon = h.dom.button(LINK_LOSS_BUTTON_IDS.abandon);
    expect(abandon).not.toBeNull();
    abandon?.click();

    expect(h.session.calls.leave).toBe(1);
    // Redrawn by the press itself, not by the frame after it.
    expect(h.dom.html()).toContain('MATCH ABANDONED');
    expect(h.dom.button(LINK_LOSS_BUTTON_IDS.menu)).not.toBeNull();
  });

  it('BACK TO MENU calls the caller back — the one action this lane cannot take', () => {
    const h = harness();
    h.session.now += SILENCE_FLOOR_MS;
    h.frame();
    h.dom.button(LINK_LOSS_BUTTON_IDS.abandon)?.click();

    h.dom.button(LINK_LOSS_BUTTON_IDS.menu)?.click();
    expect(h.menu).toBe(1);
  });

  it('RECONNECT redials — the button the player gets when nothing is dialling', () => {
    const h = harness();
    // A dial that cannot be started leaves the CONNECTION LOST card up with
    // something to press, which is the whole reason that card carries a button.
    h.session.dialFails = true;
    h.session.now += SILENCE_FLOOR_MS;
    h.frame();
    expect(h.dom.html()).toContain('CONNECTION LOST');

    const reconnect = h.dom.button(LINK_LOSS_BUTTON_IDS.reconnect);
    expect(reconnect).not.toBeNull();
    h.session.dialFails = false;
    reconnect?.click();

    expect(h.session.calls.reconnect).toBe(2); // the automatic one, then the press
    expect(h.dom.html()).toContain('RECONNECTING…');
  });

  it('judges a tab that comes back — the developer’s own case, and the loss with no event', () => {
    const h = harness();
    h.session.frame();
    h.frame();
    expect(h.dom.html()).toBe('');

    // Away. Detection suspends: a throttled tab's timers barely run, and a silence
    // measured across a background measures the browser's scheduler.
    h.page.hidden = true;
    h.page.fire();
    expect(h.session.calls.hidden).toBe(1);

    // …and back, with a last frame older than one second. The return IS the
    // diagnosis, and nothing but this listener could have made it.
    h.session.now += VISIBILITY_STALE_MS;
    h.page.hidden = false;
    h.page.fire();

    expect(h.dom.html()).toContain('tab was backgrounded');
  });

  it('takes the overlay down the moment a frame proves the link is back', () => {
    const h = harness();
    h.session.now += SILENCE_FLOOR_MS;
    h.frame();
    expect(h.dom.html()).not.toBe('');

    h.session.now += 200;
    h.session.frame(); // a snapshot, a pong, a lobby state — any frame is proof of life
    h.frame();
    // Hidden, not emptied: the element stays mounted for the next loss, which is
    // `./link-loss-view` `hide`'s own contract.
    expect(h.dom.root.hidden).toBe(true);
    expect(linkLossView()?.visible).toBe(false);
    expect(h.handle.status().phase).toBe('live');
  });

  it('lets go of the page when it is disposed', () => {
    const h = harness();
    expect(h.page.subscribers).toBe(1);
    h.handle.dispose();
    expect(h.page.subscribers).toBe(0);
  });
});
