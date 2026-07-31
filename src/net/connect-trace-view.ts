/**
 * src/net/connect-trace-view.ts — RETRY and COPY LOG, under the connecting
 * screen's title. OWNER: Netcode Engineer (GDD §4.2; M10, the developer's ask, now
 * on its third pass).
 *
 * **What this used to be, and why it is not that any more.** It was a panel at the
 * foot of the connecting screen listing every step of `./connect-trace` while the
 * title above it still said the one static word `CONNECTING…`. The developer read
 * it and said the quiet part: *"I see the verbosity (it's on the bottom) but I
 * meant show it at the top where it says CONNECTING… we don't need a separate
 * pop-up for it."* Two surfaces saying two different true things about the same
 * moment is one surface too many, and the useless one was the loud one.
 *
 * So the narration moved into the title itself — `./connect-trace`
 * `connectTitleLine` feeding `src/ui/lobby-entry` `entryModel(state, narration)`,
 * one text element at the top of the screen — and what is left here is the part a
 * title cannot be: the two things a *failure* has to offer.
 *
 * **DOM, not PixiJS**, for exactly the reason the COPY LOG button is
 * (`./playtest-log-button`, `@platform/boot-error`): the moments these buttons
 * exist for are the moments the game may not be drawing — a socket that never
 * opened, a join the server refused. A DOM button over the canvas cannot be taken
 * down by the renderer's troubles, and it is one `innerHTML` write. RETRY and COPY
 * LOG sit together, right under the line that just told the player what went wrong,
 * because "with RETRY and COPY LOG right there" was the original ask: a failure the
 * player has to go looking for an affordance to report is a failure that does not
 * get reported.
 *
 * COPY LOG carries a **DOWNLOAD** sibling here too (ratified M10 — "COPY LOG
 * buttons gain DOWNLOAD sibling"), because the developer's *"too large for mobile
 * clipboard"* bites hardest on exactly this screen: a join that never landed is
 * where a phone report starts, and a 40 KB paste is not how it travels.
 *
 * It shows **nothing at all** while a connect is merely in progress — the title is
 * saying everything there is to say, and an affordance offered before there is
 * anything to report is just the pop-up again.
 *
 * Cold Vacuum palette (style-guide §1): chalk for the words, plasma for the one
 * affirmative action, hull steel for the chrome. No red here — the refusal is the
 * title's to say, and style-guide §2 spends red once.
 */

import { connectOfferHint, connectTraceModel } from './connect-trace';
import type { ConnectTrace, ConnectTraceModel } from './connect-trace';
import { escapeHtml } from './playtest-log-button';

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** Element ids — the handles the affordance, a test, and the live-stage seam use. */
export const CONNECT_TRACE_ROOT_ID = 'pr-connect-trace';
export const CONNECT_TRACE_RETRY_ID = 'pr-connect-trace-retry';
export const CONNECT_TRACE_COPY_ID = 'pr-connect-trace-copy';
export const CONNECT_TRACE_DOWNLOAD_ID = 'pr-connect-trace-download';

const CSS_CHALK = '#DCE3EC';
const CSS_PLASMA = '#4DC3FF';
const CSS_HULL_STEEL = '#7E8894';

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "Segoe UI", system-ui, sans-serif';

/**
 * The affordances, as markup. Pure, so every word, every id and the 44-px touch
 * minimum are asserted in node with no browser.
 *
 * Returns `''` while the attempt is simply running — the title is already telling
 * the whole story and there is nothing yet to retry or report, so there is no
 * second surface on the screen at all. That empty string is the *normal* case: on
 * a healthy connect this module never draws.
 */
export function renderConnectTraceHtml(model: ConnectTraceModel): string {
  const buttons: string[] = [];
  if (model.canRetry) {
    buttons.push(
      `<button id="${CONNECT_TRACE_RETRY_ID}" type="button" class="pr-ct-button pr-ct-primary">RETRY</button>`,
    );
  }
  if (model.offerCopyLog) {
    buttons.push(`<button id="${CONNECT_TRACE_COPY_ID}" type="button" class="pr-ct-button">COPY LOG</button>`);
    // DOWNLOAD, beside it (ratified M10 — "COPY LOG buttons gain DOWNLOAD
    // sibling"). "Buttons" is plural in the ratification and this is the other
    // one: a join that never landed is the most likely place a phone report starts,
    // and a clipboard paste is the route the developer told us does not survive it.
    buttons.push(
      `<button id="${CONNECT_TRACE_DOWNLOAD_ID}" type="button" class="pr-ct-button">DOWNLOAD</button>`,
    );
  }
  if (buttons.length === 0) return '';

  // What the offer is offering — never the failure itself, which is the title.
  const hint = connectOfferHint(model);
  const hintHtml = hint ? `<p class="pr-ct-hint" role="status" aria-live="polite">${escapeHtml(hint)}</p>` : '';

  return (
    `<style>${CONNECT_TRACE_CSS}</style>` +
    hintHtml +
    `<div class="pr-ct-actions">${buttons.join('')}</div>`
  );
}

/**
 * How far below the top of the screen the affordances sit. Enough to clear the
 * wordmark and the title line under it — that is the whole point of the number: the
 * buttons belong *below* the title, not over it.
 */
export const CONNECT_TRACE_TOP_PX = 92;

const CONNECT_TRACE_CSS =
  // Centred at the TOP now, under the title that is doing the talking, rather than
  // at the foot of the screen where the developer found it and did not want it. One
  // z-index below the COPY LOG button's maximum, so the two never fight.
  //
  // `pointer-events:none` on the container with `auto` on the buttons: on the
  // shortest landscape phone the doors begin barely under the title band, and a
  // transparent container that swallowed taps there would take PLAY SOLO — the door
  // that always works (GDD §4.8 risk 6) — down with a failed online join. Only the
  // two button rects are ever live.
  `#${CONNECT_TRACE_ROOT_ID}{position:fixed;z-index:2147483646;pointer-events:none;` +
  `left:50%;transform:translateX(-50%);top:calc(${CONNECT_TRACE_TOP_PX}px + env(safe-area-inset-top));` +
  `display:flex;flex-direction:column;align-items:center;gap:.45rem;` +
  `width:min(30rem,92vw);box-sizing:border-box;` +
  `font-family:${FONT_BODY};-webkit-text-size-adjust:100%;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-hint{margin:0;color:${CSS_CHALK};text-align:center;` +
  `font-size:clamp(11px,2.8vw,13px);line-height:1.4;text-shadow:0 1px 3px #05070Bcc;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-actions{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-button{pointer-events:auto;font-family:${FONT_HEADING};` +
  `font-size:clamp(12px,3vw,14px);letter-spacing:.1em;color:${CSS_CHALK};` +
  // A chip of hull behind each button, since there is no panel behind them any
  // more and a bare word over the starfield is not a button.
  `background:#141922;border:1px solid ${CSS_HULL_STEEL};border-radius:4px;` +
  // 44px minimum: a real touch target on the phone (mobile amendment §1).
  `padding:.55rem 1.1rem;min-height:44px;min-width:44px;cursor:pointer;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-primary{color:${CSS_PLASMA};border-color:${CSS_PLASMA};}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-button:hover,#${CONNECT_TRACE_ROOT_ID} .pr-ct-button:focus-visible` +
  `{background:rgba(77,195,255,.14);outline:none;}`;

// ---------------------------------------------------------------------------
// The DOM edge
// ---------------------------------------------------------------------------

/** The slice of an element this module writes (same seam as `./playtest-log-button`). */
export interface TraceElement {
  id: string;
  innerHTML: string;
  hidden: boolean;
  addEventListener(type: string, handler: () => void): void;
  appendChild(child: unknown): void;
  remove(): void;
}

/** The slice of `Document` this module uses. */
export interface TraceDom {
  createElement(tag: string): TraceElement;
  getElementById(id: string): TraceElement | null;
  readonly body: TraceElement | null;
}

export interface ConnectTraceViewConfig {
  readonly dom: TraceDom;
  /** RETRY: start a *fresh* attempt (a new allocate), never a redial of a ticket
   *  that already lost. `src/main.ts` wires this to the door the player chose. */
  readonly onRetry: () => void;
  /** COPY LOG: export the session log by the best route this device has
   *  (`./playtest-log-export` `exportPlaytestLog`). */
  readonly onCopyLog: () => void;
  /** DOWNLOAD: get the log out as a FILE, never as text
   *  (`./playtest-log-export` `downloadPlaytestLog`). */
  readonly onDownloadLog: () => void;
}

/**
 * The mounted affordances. `update` is safe to call every frame: it re-renders only
 * when the model's *rendered shape* actually changed, so a connect that sits for
 * five seconds costs one string comparison per frame and no DOM work — and while
 * nothing has failed it is not on screen at all.
 */
export class ConnectTraceView {
  private root: TraceElement | null = null;
  private lastHtml = '';
  private shown = false;

  constructor(private readonly config: ConnectTraceViewConfig) {}

  /** Whether the affordances are currently on screen. */
  get visible(): boolean {
    return this.shown;
  }

  /** The markup last written — the handle a live-stage screenshot test reads. */
  get html(): string {
    return this.lastHtml;
  }

  /** Show (or refresh) the affordances for `trace` as of `now`. */
  update(trace: ConnectTrace, now: number): void {
    this.render(connectTraceModel(trace, now));
  }

  /** Take them off screen — a seat arrived, or the player backed out. */
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
  }

  // --- Internals ----------------------------------------------------------

  private render(model: ConnectTraceModel): void {
    const html = renderConnectTraceHtml(model);
    // Nothing to offer yet: the title has the floor and this surface is not on the
    // screen at all. The common case, and it costs one string comparison.
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
    // stale handler on a detached node.
    this.config.dom
      .getElementById(CONNECT_TRACE_RETRY_ID)
      ?.addEventListener('click', () => this.config.onRetry());
    this.config.dom
      .getElementById(CONNECT_TRACE_COPY_ID)
      ?.addEventListener('click', () => this.config.onCopyLog());
    this.config.dom
      .getElementById(CONNECT_TRACE_DOWNLOAD_ID)
      ?.addEventListener('click', () => this.config.onDownloadLog());
  }

  private mount(): TraceElement | null {
    if (this.root) return this.root;
    const host = this.config.dom.body;
    if (!host) return null;
    const root = this.config.dom.createElement('div');
    root.id = CONNECT_TRACE_ROOT_ID;
    host.appendChild(root);
    this.root = root;
    return root;
  }
}

// ---------------------------------------------------------------------------
// The shared surface — what the game's screens actually call
// ---------------------------------------------------------------------------

let shared: ConnectTraceView | null = null;

/** Install the session's connect affordances. Called once by `boot()` with the real
 *  `document`; a page with no DOM (node, the server) never calls it, and the
 *  helpers below then do nothing. */
export function installConnectTraceView(config: ConnectTraceViewConfig): ConnectTraceView {
  shared?.destroy();
  shared = new ConnectTraceView(config);
  return shared;
}

/** The installed surface, or null. */
export function connectTraceView(): ConnectTraceView | null {
  return shared;
}

/** Show the trace. Safe where nothing was installed (it does nothing), so a
 *  caller needs no null check. */
export function showConnectTrace(trace: ConnectTrace, now: number): void {
  shared?.update(trace, now);
}

/** Withdraw the affordances. */
export function hideConnectTrace(): void {
  shared?.hide();
}

/** Drop the shared surface (tests, teardown). */
export function resetConnectTraceView(): void {
  shared?.destroy();
  shared = null;
}
