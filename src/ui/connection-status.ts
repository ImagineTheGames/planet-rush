/**
 * src/ui/connection-status.ts — the server-connection overlay. OWNER: UI Engineer.
 *
 * A match over a network can be *reaching* the server, *holding* through a drop,
 * or *lost* — and a player staring at a frozen ship deserves to be told which
 * (GDD §4.2 reconnect grace; §4.8 risk 7 mobile connections). The transport
 * already tracks this as a {@link ConnectionState} ("drives the reconnect-grace
 * UI", `src/net/transport.ts`); this module turns that one enum, plus the grace
 * countdown, into a plain overlay model, and `./connection-status-view` draws it.
 *
 * Three rules the frozen contract fixes here:
 *  1. **Solo never shows it.** LocalLoopback has no connection to lose (GDD §4.2),
 *     so an offline game is never interrupted by a network overlay — the offline
 *     promise (§4.8 risk 6) is kept by this screen refusing to appear.
 *  2. **A live connection is invisible.** `open` draws nothing; the overlay
 *     exists only when something is wrong or pending, so its mere presence is the
 *     signal.
 *  3. **A lost connection still names the door that works.** `closed` points the
 *     player back at SOLO, exactly as the entry screen's offline error does
 *     (`./lobby-entry` ENTRY_ERRORS.offline) — a dead server costs a session,
 *     never the game.
 *
 * Pure and DOM-free. It reads a state; it opens no socket and runs no clock — the
 * grace seconds are handed in from whoever owns the transport and its timers.
 */

import type { Viewport } from '@platform/layout-registry';
import type { Rect } from '@platform/layout-registry';
import type { ConnectionState } from '../net/transport';
import type { CloseReason } from '../net/websocket-transport';
import { reconnectEndedCopy } from './online-copy';
import { centeredPanel, hitRect } from './menu-geometry';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ConnectionStatusInput {
  /** The transport's lifecycle state (`src/net/transport.ts`). */
  readonly state: ConnectionState;
  /** `false` for solo / LocalLoopback — the overlay never appears (rule 1). */
  readonly online: boolean;
  /** Seconds left to rejoin before the stand-in bot keeps the slot, while
   *  reconnecting (GDD §4.2). `null` when not counting. */
  readonly graceSeconds?: number | null;
  /**
   * Why the transport closed, once it has (`src/net/websocket-transport`
   * `CloseReason`). A **lost server is not a lost connection** (M3 brief), so a
   * `closed` overlay says different things for different endings:
   *   • `room-gone`     — the match ended; the server is gone.
   *   • `grace-elapsed` — the room went on without us; we were away too long.
   *   • `left` / absent — a plain drop or a deliberate leave: the generic line.
   * Ignored until `state === 'closed'`.
   */
  readonly closeReason?: CloseReason | null;
}

/** How loud the overlay is — chrome for the view, and a testable summary. */
export type ConnectionSeverity = 'none' | 'info' | 'warning' | 'error';

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

export interface ConnectionStatusModel {
  /** `false` when the connection is live or offline — the view hides itself. */
  readonly visible: boolean;
  readonly severity: ConnectionSeverity;
  /** CONNECTING / RECONNECTING / DISCONNECTED. */
  readonly headline: string;
  /** One supporting line, in words the player can act on. */
  readonly detail: string;
  /** Whether to spin an activity indicator — true while there is still hope. */
  readonly spinner: boolean;
  /** Whole seconds left in the reconnect grace, or `null` when not counting. */
  readonly grace: number | null;
  /** A way back to the menu, offered only once the connection is truly gone. */
  readonly action: string | null;
}

/** What a tap on the overlay hit. Only present when the overlay offers an action. */
export type ConnectionTarget = { readonly kind: 'dismiss' };

/**
 * Map the transport state to an overlay. The only screen in the menus whose job
 * is to *disappear*: `open` and offline both return `visible: false`, so the
 * common case costs the view one boolean and no draw.
 */
export function connectionStatusModel(input: ConnectionStatusInput): ConnectionStatusModel {
  if (!input.online || input.state === 'open') return HIDDEN;

  switch (input.state) {
    case 'connecting':
      return {
        visible: true,
        severity: 'info',
        headline: 'CONNECTING',
        detail: 'Reaching the match server…',
        spinner: true,
        grace: null,
        action: null,
      };
    case 'reconnecting': {
      const grace = graceLeft(input.graceSeconds);
      return {
        visible: true,
        severity: 'warning',
        headline: 'RECONNECTING',
        detail:
          grace !== null
            ? `A stand-in is holding your ship — ${grace}s to rejoin.`
            : 'Holding your ship — trying to get back in.',
        spinner: true,
        grace,
        action: null,
      };
    }
    case 'closed': {
      // A lost server is not a lost connection: when the transport names *why* it
      // gave up (a dead room vs a spent grace window), say the right one — a
      // player told the wrong thing files the wrong bug (M3 brief). A plain drop
      // or a deliberate leave has no such reason and keeps the generic line.
      const ended = endedCopy(input.closeReason);
      return {
        visible: true,
        severity: 'error',
        headline: ended ? ended.headline : 'DISCONNECTED',
        detail: ended ? ended.detail : 'Lost the match server. SOLO still works offline.',
        spinner: false,
        grace: null,
        action: 'BACK TO MENU',
      };
    }
  }
}

/** The distinct headline/detail for a terminal reconnect verdict, or `null` for a
 *  plain drop / deliberate leave (`'left'`) where the generic closed line stands. */
function endedCopy(reason: CloseReason | null | undefined): { headline: string; detail: string } | null {
  if (reason === 'room-gone' || reason === 'grace-elapsed') {
    const copy = reconnectEndedCopy(reason);
    return { headline: copy.headline, detail: copy.detail };
  }
  return null;
}

const HIDDEN: ConnectionStatusModel = {
  visible: false,
  severity: 'none',
  headline: '',
  detail: '',
  spinner: false,
  grace: null,
  action: null,
};

/** Whole seconds of grace remaining, or `null` if there is no live countdown. */
function graceLeft(graceSeconds: number | null | undefined): number | null {
  if (graceSeconds === null || graceSeconds === undefined) return null;
  return Math.max(0, Math.ceil(graceSeconds));
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const CONNECTION_PANEL_WIDTH = 380;
export const CONNECTION_PANEL_HEIGHT = 180;
export const CONNECTION_ACTION_HEIGHT = 44;

export interface ConnectionStatusLayoutOptions {
  readonly insets?: Insets;
}

export interface ConnectionStatusLayout {
  /** The card, centred in the safe area. */
  readonly panel: Rect;
  /** The BACK TO MENU button, at the card's foot. Only live when the model has
   *  an `action`; laid out regardless so the two stay in step. */
  readonly action: Rect;
}

/** A single card in the middle of the screen, with a button at its foot. */
export function connectionStatusLayout(
  viewport: Viewport,
  options: ConnectionStatusLayoutOptions = {},
): ConnectionStatusLayout {
  const panel = centeredPanel(viewport, CONNECTION_PANEL_WIDTH, CONNECTION_PANEL_HEIGHT, options.insets);
  const actionHeight = Math.min(CONNECTION_ACTION_HEIGHT, panel.height);
  const actionWidth = Math.min(panel.width - 32, 240);
  const action: Rect = {
    x: panel.x + (panel.width - actionWidth) / 2,
    y: panel.y + panel.height - actionHeight - 14,
    width: Math.max(0, actionWidth),
    height: actionHeight,
  };
  return { panel, action };
}

/**
 * The target a tap hits. Only the BACK TO MENU button is live, and only when the
 * model actually offers it — an overlay that is merely *waiting* (connecting,
 * reconnecting) swallows taps rather than letting one leak to the game behind it,
 * so `model.action === null` returns `null` here for every point.
 */
export function connectionStatusHitTest(
  layout: ConnectionStatusLayout,
  x: number,
  y: number,
  model: ConnectionStatusModel,
): ConnectionTarget | null {
  if (!model.visible || model.action === null) return null;
  return hitRect(layout.action, x, y) ? { kind: 'dismiss' } : null;
}

/** The overlay's layout-registry id and anchor. */
export const CONNECTION_STATUS_ID = 'connection-status';
