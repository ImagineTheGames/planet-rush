/**
 * src/net/local-revert-view.ts — the one line that says the match went local.
 * OWNER: Netcode Engineer (a0-11; GDD §4.2 *amended 2026-08-07*).
 *
 * The brief: *"Tell the player, quietly and once. They pressed a button that said
 * online and got a local match; a one-line tell … is the difference between a
 * considerate optimisation and a confusing one. Do not make it a dialog."*
 *
 * So: one line, near the top of the screen, over the match that is already
 * starting. No buttons, no scrim, no pointer events — there is nothing here for
 * the player to decide, and anything they had to dismiss would be a dialog by
 * another name. It fades itself out after {@link TELL_VISIBLE_MS} and removes
 * itself, so a match five minutes in carries no trace of it.
 *
 * **DOM, not PixiJS**, for the same reason as `./link-loss-view` and
 * `./connect-trace-view`: the netcode layer owns the moments the *transport*
 * produces, and it must be able to say them without a renderer's cooperation or a
 * Pixi import in a module the match server's own bundle graph touches. It is one
 * `innerHTML` write and one timer.
 *
 * Cold Vacuum palette (style-guide §1): chalk on a hull-steel plate. **No hue** —
 * this is chrome reporting a fact, not a signal (§2 reserves the palette's colours
 * for meaning during a match), and a plasma-blue banner would read as something
 * the player is meant to act on.
 */

import { LOCAL_REVERT_TELL } from './local-revert';
import type { TraceDom, TraceElement } from './connect-trace-view';
import { escapeHtml } from './playtest-log-button';

/** The element id — the handle a test and the live-stage seam name it by. */
export const LOCAL_REVERT_TELL_ID = 'pr-local-revert';

/**
 * How long the line stays up.
 *
 * Long enough to be read once by somebody whose eyes are on the countdown that
 * just finished, short enough that it is gone before the first fight. It is not a
 * notification the player has to acknowledge, so it does not wait for them.
 */
export const TELL_VISIBLE_MS = 6_000;

const CSS_CHALK = '#DCE3EC';
const CSS_HULL_STEEL = '#7E8894';
const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';

/** The plate, styled inline so the module needs no stylesheet of its own. */
const STYLE =
  'position:fixed;left:50%;top:2.5rem;transform:translateX(-50%);z-index:40;' +
  // Never a control: taps go through to the match underneath it.
  'pointer-events:none;' +
  `font-family:${FONT_HEADING};font-size:clamp(11px,2.8vw,13px);letter-spacing:.1em;` +
  `color:${CSS_CHALK};background:#141922e6;border:1px solid ${CSS_HULL_STEEL};border-radius:4px;` +
  'padding:.5rem .9rem;max-width:92vw;text-align:center;' +
  'transition:opacity .5s ease-out;opacity:1;';

/** The clock and the DOM, injected — so a test can watch six seconds pass in a
 *  microsecond, and so this file holds no ambient state (the same discipline
 *  `server/match-server.ts` keeps). */
export interface LocalRevertTellConfig {
  readonly dom: TraceDom;
  /** Defaults to the platform timer; a test passes its own and never waits. */
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  /** The words. Defaults to {@link LOCAL_REVERT_TELL}. */
  readonly message?: string;
}

/**
 * Show the tell. Idempotent by id: a second call while one is up replaces its
 * words rather than stacking a second plate — "once" is a property of the screen,
 * not of the caller's discipline.
 *
 * Returns the element, so a caller (or a test) can read it back without going
 * through the document.
 */
export function showLocalRevertTell(config: LocalRevertTellConfig): TraceElement | null {
  const { dom } = config;
  const body = dom.body;
  if (!body) return null;
  const timer = config.setTimeout ?? ((fn, ms): unknown => setTimeout(fn, ms));
  const text = config.message ?? LOCAL_REVERT_TELL;

  let root = dom.getElementById(LOCAL_REVERT_TELL_ID);
  if (!root) {
    root = dom.createElement('div');
    root.id = LOCAL_REVERT_TELL_ID;
    // `setAttribute` is not on the tiny element seam this layer writes through,
    // so the style rides the one property it does have. It is a fixed plate with
    // no states, so there is nothing a class would buy.
    (root as unknown as { style?: string }).style = STYLE;
    body.appendChild(root);
  }
  root.hidden = false;
  root.innerHTML = escapeHtml(text);

  timer(() => {
    // Fade, then go. Checked against the live element rather than the captured
    // one: a match that ended and re-booted may have replaced it, and this timer
    // must not remove somebody else's plate.
    const live = dom.getElementById(LOCAL_REVERT_TELL_ID);
    live?.remove();
  }, TELL_VISIBLE_MS);

  return root;
}
