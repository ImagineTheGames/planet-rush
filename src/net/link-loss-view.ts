/**
 * src/net/link-loss-view.ts — the CONNECTION LOST overlay. OWNER: Netcode
 * Engineer (GDD §4.2; the developer's zombie-match report, brief §2).
 *
 * *"I should get kicked out and presented reconnect / abandon buttons, and
 * verbosity of what happened."*
 *
 * All three of those, and in that order. The model is `./link-loss`; this file is
 * the surface it reaches a player through — one scrim over the whole screen (this
 * is a *kick-out*, not a notification: a match you are no longer in must not look
 * like one you can play), the loud line naming the actual cause, and the two
 * buttons. The grace countdown ticks on the RECONNECT button itself, because the
 * seconds are the decision.
 *
 * **DOM, not PixiJS**, for the same reason as `./connect-trace-view` and
 * `./playtest-log-button` — and here the reason is at its strongest. The moment
 * this overlay exists for is the moment the world stopped being real: prediction is
 * frozen (`./session` `sendInput`), the renderer is drawing a still frame, and
 * whatever is wrong with the tab may be wrong with the canvas too. A DOM overlay
 * cannot be taken down by the renderer's troubles, it draws over a frozen canvas
 * without needing the loop to cooperate, and it is one `innerHTML` write.
 *
 * It draws **nothing at all** while the link is live — the normal case, one string
 * comparison per frame.
 *
 * Cold Vacuum palette (style-guide §1): chalk for the words, plasma for the one
 * affirmative action, hull steel for the chrome, and threat red **only** on the
 * terminal screen — a seat that is gone is real damage, and that is the one moment
 * on this overlay red is earned (style-guide §2).
 */

import type { LinkAction, LinkNotice, LinkStatus } from './link-loss';
import { linkNotice } from './link-loss';
import type { TraceDom, TraceElement } from './connect-trace-view';
import { escapeHtml } from './playtest-log-button';

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** Element ids — the handles the wiring, a test, and the live-stage seam use. */
export const LINK_LOSS_ROOT_ID = 'pr-link-loss';
export const LINK_LOSS_TITLE_ID = 'pr-link-loss-title';
export const LINK_LOSS_DETAIL_ID = 'pr-link-loss-detail';

/** One id per action kind, so a test (and a live-stage tap) can name the button it
 *  wants without reading the label. */
export const LINK_LOSS_BUTTON_IDS: Readonly<Record<LinkAction['kind'], string>> = {
  reconnect: 'pr-link-loss-reconnect',
  abandon: 'pr-link-loss-abandon',
  menu: 'pr-link-loss-menu',
};

const CSS_CHALK = '#DCE3EC';
const CSS_PLASMA = '#4DC3FF';
const CSS_HULL_STEEL = '#7E8894';
const CSS_THREAT_RED = '#B23A3A';
const CSS_VACUUM = '#0D1015';

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "Segoe UI", system-ui, sans-serif';

/**
 * The overlay, as markup. Pure, so every word, every id and the 44-px touch
 * minimum are asserted in node with no browser.
 *
 * Returns `''` while the link is live — and that empty string is the *normal* case:
 * on a healthy match this module never draws.
 */
export function renderLinkLossHtml(notice: LinkNotice): string {
  if (!notice.visible) return '';
  const accent = notice.failed ? CSS_THREAT_RED : CSS_PLASMA;
  const buttons = notice.actions
    .map(
      (action) =>
        `<button id="${LINK_LOSS_BUTTON_IDS[action.kind]}" type="button" ` +
        `class="pr-ll-button${action.primary ? ' pr-ll-primary' : ''}">${escapeHtml(action.label)}</button>`,
    )
    .join('');

  return (
    `<style>${linkLossCss(accent)}</style>` +
    // `alert` rather than `status`: this interrupts. A screen reader should say it
    // now, not when it gets round to it — the player is being kicked out of a match.
    // `aria-busy` while a dial is in flight — the card is working, and a screen
    // reader should say so. Note what it is NOT: `disabled` on the RECONNECT button.
    // The card is busy; the button is not spent. A dial sleeping out the transport's
    // backoff is exactly when a player most wants to press "now", and n8-01 §2 is
    // explicit that the press must stay a real attempt rather than a label on a timer
    // the player cannot see (`./link-loss` `beginRedial`).
    `<div class="pr-ll-card" role="alertdialog" aria-live="assertive" aria-label="Connection lost"` +
    `${notice.busy ? ' aria-busy="true"' : ''}>` +
    `<h1 id="${LINK_LOSS_TITLE_ID}" class="pr-ll-title">${escapeHtml(notice.title)}</h1>` +
    `<p id="${LINK_LOSS_DETAIL_ID}" class="pr-ll-detail">${escapeHtml(notice.detail)}</p>` +
    `<div class="pr-ll-actions">${buttons}</div>` +
    `</div>`
  );
}

function linkLossCss(accent: string): string {
  return (
    // Full-screen scrim, and `pointer-events:auto` on the container — the opposite
    // of `./connect-trace-view`'s rule, and deliberately so. That surface sits over
    // a menu whose doors must stay pressable; this one sits over a match the player
    // is no longer in, and a stray tap reaching a frozen world's touch controls
    // would be the zombie match all over again in miniature.
    `#${LINK_LOSS_ROOT_ID}{position:fixed;inset:0;z-index:2147483646;pointer-events:auto;` +
    `display:flex;align-items:center;justify-content:center;` +
    `background:rgba(13,16,21,.86);backdrop-filter:blur(2px);` +
    `font-family:${FONT_BODY};-webkit-text-size-adjust:100%;` +
    `padding:calc(1rem + env(safe-area-inset-top)) 1rem calc(1rem + env(safe-area-inset-bottom));` +
    `box-sizing:border-box;}` +
    // …and {@link LinkLossView.hide} has to be able to undo all of that. The `hidden`
    // attribute is only the UA rule `[hidden]{display:none}`, which the `display:flex`
    // above outranks on specificity alone — so without this line `hide()` sets a flag
    // and nothing else happens: the scrim keeps its 100 % of the viewport, keeps
    // `pointer-events:auto`, and keeps a stale RECONNECTING… card over a match the
    // player has just been let back into. Found the first time this overlay was
    // installed for real (n6-01) and invisible to every fake-DOM test, which has no
    // stylesheet to lose the fight in.
    `#${LINK_LOSS_ROOT_ID}[hidden]{display:none;}` +
    `#${LINK_LOSS_ROOT_ID} .pr-ll-card{width:min(34rem,94vw);box-sizing:border-box;` +
    `background:${CSS_VACUUM};border:1px solid ${accent};border-radius:6px;` +
    `padding:1.1rem 1.2rem;text-align:center;box-shadow:0 8px 32px #000000aa;` +
    // The card scrolls rather than clipping: the title is a full sentence and the
    // shortest landscape phone is 320 px tall with the URL bar up.
    `max-height:100%;overflow-y:auto;}` +
    `#${LINK_LOSS_ROOT_ID} .pr-ll-title{margin:0 0 .5rem;font-family:${FONT_HEADING};` +
    `font-size:clamp(14px,3.6vw,20px);line-height:1.35;letter-spacing:.04em;color:${accent};}` +
    `#${LINK_LOSS_ROOT_ID} .pr-ll-detail{margin:0 0 1rem;color:${CSS_CHALK};` +
    `font-size:clamp(11px,2.9vw,14px);line-height:1.45;}` +
    `#${LINK_LOSS_ROOT_ID} .pr-ll-actions{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;}` +
    `#${LINK_LOSS_ROOT_ID} .pr-ll-button{font-family:${FONT_HEADING};` +
    `font-size:clamp(12px,3vw,14px);letter-spacing:.1em;color:${CSS_CHALK};` +
    `background:#141922;border:1px solid ${CSS_HULL_STEEL};border-radius:4px;` +
    // 44px minimum: a real touch target on the phone (mobile amendment §1).
    `padding:.6rem 1.1rem;min-height:44px;min-width:44px;cursor:pointer;}` +
    `#${LINK_LOSS_ROOT_ID} .pr-ll-primary{color:${accent};border-color:${accent};}` +
    `#${LINK_LOSS_ROOT_ID} .pr-ll-button:hover,#${LINK_LOSS_ROOT_ID} .pr-ll-button:focus-visible` +
    `{background:rgba(77,195,255,.14);outline:none;}`
  );
}

// ---------------------------------------------------------------------------
// The DOM edge
// ---------------------------------------------------------------------------

/**
 * A parent this overlay can be appended to. Deliberately narrower than
 * {@link TraceElement}, and for the same reason `./playtest-log-button`'s
 * `DownloadLogHost` is: `document.fullscreenElement` is typed `Element`, which has
 * no `hidden`, so demanding a full `TraceElement` here would refuse the one host
 * that matters. Appending is the whole of what a parent is asked to do.
 */
export interface LinkLossHost {
  appendChild(child: unknown): void;
}

/**
 * `TraceDom` plus the two members a0-28 needs, both optional so every existing
 * caller — and every fake DOM in a test — still satisfies it unchanged.
 */
export interface LinkLossDom extends TraceDom {
  /**
   * The element the browser is presenting fullscreen, or null/absent. **Where this
   * overlay has to live when there is one** (a0-28) — see {@link LinkLossView.desiredHost}.
   */
  readonly fullscreenElement?: LinkLossHost | null;
  /** Document-level events — `fullscreenchange`. Optional for the same reason. */
  addEventListener?(type: string, handler: () => void): void;
}

export interface LinkLossViewConfig {
  readonly dom: LinkLossDom;
  /** RECONNECT — redial now and reclaim the seat (`./session` `reconnect`). */
  readonly onReconnect: () => void;
  /** ABANDON MATCH — a stated leave, seat freed, back to the menu. */
  readonly onAbandon: () => void;
  /** BACK TO MENU — the terminal screen's single button. */
  readonly onMenu: () => void;
}

/**
 * The mounted overlay. {@link update} is safe to call every frame: it re-renders
 * only when the *rendered shape* actually changed, so the countdown costs one DOM
 * write per second and a live link costs one string comparison per frame.
 */
export class LinkLossView {
  private root: TraceElement | null = null;
  /** The parent the element is currently in, so a re-home costs one comparison
   *  rather than an `appendChild` every frame ({@link rehome}). */
  private host: LinkLossHost | null = null;
  private lastHtml = '';
  private shown = false;

  constructor(private readonly config: LinkLossViewConfig) {}

  /** Whether the overlay is currently on screen. */
  get visible(): boolean {
    return this.shown;
  }

  /** The markup last written — the handle a live-stage screenshot test reads. */
  get html(): string {
    return this.lastHtml;
  }

  /** Draw (or refresh) the overlay for `status`. */
  update(status: LinkStatus): void {
    this.render(linkNotice(status));
  }

  /** Take it off screen — the link came back, or the player left. */
  hide(): void {
    this.shown = false;
    this.lastHtml = '';
    if (this.root) this.root.hidden = true;
  }

  /** Remove the element entirely — teardown. */
  destroy(): void {
    this.shown = false;
    this.lastHtml = '';
    this.root?.remove();
    this.root = null;
    this.host = null;
  }

  // --- Internals ----------------------------------------------------------

  private render(notice: LinkNotice): void {
    const html = renderLinkLossHtml(notice);
    if (html === '') {
      this.hide();
      return;
    }
    const root = this.mount();
    if (!root) return;
    root.hidden = false;
    this.shown = true;
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    root.innerHTML = html;
    // Each `innerHTML` write replaces the buttons, so listeners are re-attached
    // here rather than once at mount — one listener per live element, never a
    // stale handler on a detached node (same rule as `./connect-trace-view`).
    const bind = (id: string, handler: () => void): void => {
      this.config.dom.getElementById(id)?.addEventListener('click', handler);
    };
    bind(LINK_LOSS_BUTTON_IDS.reconnect, () => this.config.onReconnect());
    bind(LINK_LOSS_BUTTON_IDS.abandon, () => this.config.onAbandon());
    bind(LINK_LOSS_BUTTON_IDS.menu, () => this.config.onMenu());
  }

  /**
   * Where this overlay has to live *right now*: the fullscreen element when the
   * browser is presenting one, else `body`.
   *
   * **This is a0-28, and this module never got it.** A fullscreen element is in the
   * browser's **top layer**, which paints above every normal-flow box *regardless of
   * z-index* and lays a `::backdrop` over the rest of the document. So a scrim left
   * in `body` while the game root is fullscreen is mounted, laid out at the full
   * viewport, `display:flex`, `visibility:visible`, `opacity:1`, carrying the
   * largest z-index the platform has — and painted underneath the canvas. Not
   * hidden: buried. `document.elementFromPoint` at the centre of the screen returns
   * the CANVAS, so the scrim does not even take the taps its `pointer-events:auto`
   * was written to intercept.
   *
   * On touch that is the **ordinary** state of a match — PLAY enters fullscreen on
   * `#app` (`@platform/fullscreen`) — which is why the phone player, the one the
   * reconnect grace exists for at all (GDD §4.2, "mobile play, where screen lock,
   * app backgrounding and cellular drops are routine"), was the one player who could
   * never see this card. a0-131 photographed the result and read it correctly: a
   * frame that is identical thirty seconds after the cut, because the only thing
   * that changed is a `<div>` nobody can see.
   *
   * `./playtest-log-button` solved this once for the DOWNLOAD LOG affordance. This
   * is the same rule, not the same surface — the brief is explicit that the log
   * offer is for *reporting* a problem and must not be used to *announce* one.
   */
  private desiredHost(): LinkLossHost | null {
    return this.config.dom.fullscreenElement ?? this.config.dom.body;
  }

  /**
   * Move the element to {@link desiredHost} if it is not already there. Creates
   * nothing, and costs one property read and one comparison on the frames where the
   * answer has not changed.
   *
   * No `fullscreenchange` listener, unlike `./playtest-log-button`: this view is
   * driven by `./link-loss-attach` `poll`, which `main.ts` calls **once per rendered
   * frame** and keeps calling while the sim is frozen. {@link render} therefore
   * re-homes on every frame the card is up, which catches entering fullscreen,
   * leaving it, and the vendor-prefixed cases that fire no standard event at all —
   * without a second source of truth to keep in step or tear down.
   */
  private rehome(): void {
    if (!this.root) return;
    const host = this.desiredHost();
    if (!host || host === this.host) return;
    // `appendChild` moves a node that already has a parent; no detach step needed.
    host.appendChild(this.root);
    this.host = host;
  }

  private mount(): TraceElement | null {
    if (this.root) {
      this.rehome();
      return this.root;
    }
    const host = this.desiredHost();
    if (!host) return null;
    const root = this.config.dom.createElement('div');
    root.id = LINK_LOSS_ROOT_ID;
    host.appendChild(root);
    this.root = root;
    this.host = host;
    return root;
  }
}

// ---------------------------------------------------------------------------
// The shared surface — what the game's screens actually call
// ---------------------------------------------------------------------------

let shared: LinkLossView | null = null;

/** Install the session's disconnect overlay. Called once by `boot()` with the real
 *  `document`; a page with no DOM (node, the server) never calls it, and the
 *  helpers below then do nothing. */
export function installLinkLossView(config: LinkLossViewConfig): LinkLossView {
  shared?.destroy();
  shared = new LinkLossView(config);
  return shared;
}

/** The installed surface, or null. */
export function linkLossView(): LinkLossView | null {
  return shared;
}

/** Draw the overlay for `status` (and take it down when the link is live). Safe
 *  where nothing was installed, so a caller needs no null check. */
export function showLinkLoss(status: LinkStatus): void {
  shared?.update(status);
}

/** Take the overlay down. */
export function hideLinkLoss(): void {
  shared?.hide();
}

/** Drop the shared surface (tests, teardown). */
export function resetLinkLossView(): void {
  shared?.destroy();
  shared = null;
}
