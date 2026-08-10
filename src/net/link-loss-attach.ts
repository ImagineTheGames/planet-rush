/**
 * src/net/link-loss-attach.ts — the CONNECTION LOST overlay, wired to a live
 * session. OWNER: Netcode Engineer (GDD §4.2; the developer's zombie-match report).
 *
 * *"I should get kicked out and presented reconnect / abandon buttons, and
 * verbosity of what happened."*
 *
 * `./link-loss` decides when the link is gone and `./link-loss-view` draws it, and
 * both of those shipped complete — reviewed, merged, unit-green, and **called from
 * nowhere**. `installLinkLossView` appeared exactly once in the whole `src/` tree:
 * its own definition. So the fix for a reported bug existed as a module and never
 * as a behaviour, and the developer's zombie match stayed a zombie match (a1-09's
 * dark-matter scan, n6-01).
 *
 * This file is the missing wire, and it is deliberately a file rather than a dozen
 * lines inside `main.ts`: the same shape as `./playtest-log-attach`, which wires
 * the other consumer of the same watchdog to the same session. Three things join
 * here and nothing else does:
 *
 *  1. **The overlay is installed** — once, with the real `document` — and its two
 *     buttons are pointed at the session methods that already implement them:
 *     RECONNECT at `./session` `reconnect` (redial now, reclaim the seat) and
 *     ABANDON MATCH at `./session` `leave` (a stated leave, the seat freed now
 *     rather than held empty for a minute). BACK TO MENU is the caller's, because
 *     leaving the match is a screen decision this lane does not own.
 *  2. **The page's visibility is fed in** (`./link-loss` rule 2). This is the
 *     developer's own case: nothing else in the client listened for
 *     `visibilitychange` at all, so a tab that came back from the background was
 *     never judged and the one loss the report is actually about could not be
 *     detected.
 *  3. **The link is polled** ({@link LinkLossHandle.poll}), once per rendered
 *     frame. A dead connection is detected by *nothing happening*, so something has
 *     to keep looking at the clock or the silence is never noticed.
 *
 * **Match-scoped, on purpose.** The caller attaches this where the match is — not
 * at the front door and not in the lobby. A lobby is *legitimately* silent: the
 * room broadcasts a roster only when a seat or a ping actually changes
 * (`server/room.ts` `refreshLobbyPings` — "a lobby where nobody's round trip has
 * moved a whole millisecond sends nothing at all"), and the client's own ping probe
 * rides `sendInput`, which nothing is sending yet. Polling there would cross
 * `./link-loss` `SILENCE_FLOOR_MS` on a perfectly healthy room and throw CONNECTION
 * LOST over a lobby nobody had left. Silence is a signal only where a frame every
 * 33 ms is the promise.
 *
 * Structural types, not an import of `./session`: this module calls five methods on
 * a session and one on a page, and saying exactly that keeps it a leaf.
 */

import type { LinkStatus } from './link-loss';
import type { TraceDom } from './connect-trace-view';
import { installLinkLossView, resetLinkLossView, showLinkLoss } from './link-loss-view';

// ---------------------------------------------------------------------------
// What this module needs from the session (and nothing more)
// ---------------------------------------------------------------------------

/**
 * The slice of a session driven here. `OnlineSession` (`./session`) satisfies it
 * structurally — every method already exists and is already tested over the real
 * stack (`tests/net/disconnect-honesty.test.ts`); none of them had a caller in the
 * shipped client.
 */
export interface WatchedSession {
  /** Sample the link, spending the one automatic redial a fresh loss is owed. */
  pollLink(now?: number): LinkStatus;
  /** The page went away — detection suspends. */
  linkHidden(): void;
  /** The page came back — a stale last frame at this instant IS the diagnosis. */
  linkShown(now?: number): LinkStatus;
  /** RECONNECT: dial again now and reclaim the seat (GDD §4.2). */
  reconnect(now?: number): boolean;
  /** ABANDON MATCH: a stated leave, so the seat is freed rather than held. */
  leave(reason?: string): void;
}

/**
 * The slice of the page read here — `document` satisfies it. Optional at the call
 * site, so a node context (the server, a unit test with no DOM) attaches nothing
 * and the rest of the wire still works.
 */
export interface PageVisibility {
  readonly hidden: boolean;
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}

export interface LinkLossAttachConfig {
  readonly session: WatchedSession;
  /** The DOM the overlay mounts into — the real `document` at the call site. */
  readonly dom: TraceDom;
  /** The page whose `visibilitychange` is folded into the watchdog. */
  readonly page?: PageVisibility | null;
  /**
   * BACK TO MENU — the terminal screen's single button, and the one action this
   * lane cannot perform: the seat is already gone, so what is left is a screen
   * change the match's own wiring owns (`main.ts` `exitToMenu`).
   */
  readonly onMenu: () => void;
}

/** The attachment, as the caller holds it. */
export interface LinkLossHandle {
  /**
   * Sample the link and draw (or take down) the overlay. Call once per rendered
   * frame: while the link is live this costs one `Date.now()`, a handful of integer
   * compares and one string comparison, and draws nothing at all
   * (`./link-loss-view` `renderLinkLossHtml` returns `''`).
   */
  poll(now?: number): void;
  /** The link as of the last {@link poll} — what the overlay is currently saying. */
  status(): LinkStatus;
  /** Stop watching: drop the listener and remove the overlay from the page. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

const VISIBILITY_EVENT = 'visibilitychange';

/**
 * Install the overlay for `session` and return the per-frame poller.
 *
 * Every button is answered by the session method that already implements it, and
 * each press re-polls immediately rather than waiting for the next frame — a player
 * who presses ABANDON MATCH and sees the same card for another 16 ms has been told
 * their press did nothing (`./link-loss` `status`: "a caller that presses ABANDON
 * and then reads `status` gets the answer to the question it just asked").
 */
export function attachLinkLoss(config: LinkLossAttachConfig): LinkLossHandle {
  const { session, dom, page, onMenu } = config;
  let last: LinkStatus | null = null;

  const draw = (status: LinkStatus): LinkStatus => {
    last = status;
    showLinkLoss(status);
    return status;
  };
  const poll = (now?: number): void => {
    draw(now === undefined ? session.pollLink() : session.pollLink(now));
  };

  installLinkLossView({
    dom,
    // RECONNECT — the redial the transport would never have made on its own, because
    // a silently-killed socket fires no `onclose` to start one (`./websocket-transport`
    // `redial`). The seat, the ship, the cargo and the upgrades come back with it
    // (GDD §4.2; proven end to end in `tests/net/reconnect-resume.test.ts`).
    onReconnect: () => {
      session.reconnect();
      poll();
    },
    // ABANDON MATCH — say so on the wire, then hang up. The difference between this
    // and simply closing is one frame and a freed seat (`server/room.ts` `abandon`).
    // The overlay redraws itself into its terminal card on the poll below: the
    // player's own choice is the one ending a straggling server frame cannot undo
    // (`./link-loss` `frame`).
    onAbandon: () => {
      session.leave();
      poll();
    },
    onMenu,
  });

  // Rule 2, and the reason this wire matters most: a backgrounded tab is the one
  // loss with no event behind it. Nothing else in the client listened for this.
  const onVisibility = (): void => {
    if (page?.hidden) {
      session.linkHidden();
      return;
    }
    draw(session.linkShown());
  };
  page?.addEventListener(VISIBILITY_EVENT, onVisibility);

  return {
    poll,
    status: (): LinkStatus => last ?? session.pollLink(),
    dispose: (): void => {
      page?.removeEventListener(VISIBILITY_EVENT, onVisibility);
      resetLinkLossView();
    },
  };
}
