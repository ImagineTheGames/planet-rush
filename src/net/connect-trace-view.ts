/**
 * src/net/connect-trace-view.ts — the verbose connecting screen, on screen.
 * OWNER: Netcode Engineer (GDD §4.2; M10, the developer's twice-repeated ask).
 *
 * The drawing half of `./connect-trace`. **DOM, not PixiJS**, for exactly the
 * reason the COPY LOG button is (`./playtest-log-button`, `@platform/boot-error`):
 * the moments this panel exists for are the moments the game may not be drawing —
 * a socket that never opened, a join the server refused, a screen someone is
 * staring at because nothing else is happening. A DOM panel over the canvas cannot
 * be taken down by the renderer's troubles, and it is one `innerHTML` write.
 *
 * It is also deliberately *only* this: `src/ui/` owns the doors, the keypad and the
 * lobby, and none of that moves. This adds one panel over the existing connecting
 * screen, showing the steps the netcode layer is the only thing that knows about,
 * and takes itself off the instant a seat arrives or the player backs out.
 *
 * RETRY and COPY LOG sit inside the panel rather than somewhere else on the page,
 * because "with RETRY and COPY LOG right there" was the actual ask: a failure the
 * player has to go looking for an affordance to report is a failure that does not
 * get reported.
 *
 * Cold Vacuum palette (style-guide §1): chalk for the words, plasma for the live
 * step and the one action, hull steel for what is already done, threat red for a
 * refusal — the one thing on this panel that *is* a failure, which is the only
 * thing style-guide §2 spends red on.
 */

import { connectOfferHint, connectTraceModel } from './connect-trace';
import type { ConnectTrace, ConnectTraceModel } from './connect-trace';
import { escapeHtml } from './playtest-log-button';

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** Element ids — the handles the affordance, a test, and the live-stage seam use. */
export const CONNECT_TRACE_ROOT_ID = 'pr-connect-trace';
export const CONNECT_TRACE_STEPS_ID = 'pr-connect-trace-steps';
export const CONNECT_TRACE_RETRY_ID = 'pr-connect-trace-retry';
export const CONNECT_TRACE_COPY_ID = 'pr-connect-trace-copy';

const CSS_CHALK = '#DCE3EC';
const CSS_PLASMA = '#4DC3FF';
const CSS_HULL_STEEL = '#7E8894';
const CSS_THREAT = '#FF4D4D';
const CSS_PANEL = '#141922';

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "Segoe UI", system-ui, sans-serif';

/**
 * The panel's inner markup. Pure, so every word, every id and the 44-px touch
 * minimum are asserted in node with no browser.
 *
 * Steps already taken are dimmed and the live one is lit, so the eye lands on
 * *what is happening now* without losing what already succeeded — which is the
 * whole diagnostic value: "ROOM Q5RN · TICKET SIGNED" above a stuck
 * "DIALING MACHINE 0800d5b6…" says, on its own, that the allocator is fine and
 * the socket is not.
 */
export function renderConnectTraceHtml(model: ConnectTraceModel): string {
  const last = model.lines.length - 1;
  const steps = model.lines
    .map((line, i) => {
      const live = i === last && model.busy;
      const bad = i === last && model.error !== '';
      const cls = bad ? 'pr-ct-step pr-ct-bad' : live ? 'pr-ct-step pr-ct-live' : 'pr-ct-step pr-ct-done';
      const mark = bad ? '×' : live ? '›' : '·';
      return `<li class="${cls}"><span class="pr-ct-mark">${mark}</span>${escapeHtml(line)}</li>`;
    })
    .join('');

  // The waited tail only appears once a step has been sitting long enough to be
  // worth counting — a number that ticks from zero on a healthy connect is noise.
  const waited =
    model.busy && model.stalled ? `<p class="pr-ct-waited">${Math.round(model.waitedMs / 1000)}s</p>` : '';
  const hint = connectOfferHint(model);
  const hintHtml = hint ? `<p class="pr-ct-hint" role="status" aria-live="polite">${escapeHtml(hint)}</p>` : '';

  const buttons: string[] = [];
  if (model.canRetry) {
    buttons.push(
      `<button id="${CONNECT_TRACE_RETRY_ID}" type="button" class="pr-ct-button pr-ct-primary">RETRY</button>`,
    );
  }
  if (model.offerCopyLog) {
    buttons.push(`<button id="${CONNECT_TRACE_COPY_ID}" type="button" class="pr-ct-button">COPY LOG</button>`);
  }
  const actions = buttons.length > 0 ? `<div class="pr-ct-actions">${buttons.join('')}</div>` : '';

  return (
    `<style>${CONNECT_TRACE_CSS}</style>` +
    `<ol id="${CONNECT_TRACE_STEPS_ID}" class="pr-ct-steps">${steps}</ol>` +
    waited +
    hintHtml +
    actions
  );
}

const CONNECT_TRACE_CSS =
  // Centred low on the screen, under the doors' own wordmark and prompt, so it adds
  // to that screen rather than covering it. One z-index below the COPY LOG button's
  // maximum, so the two never fight over the same corner.
  `#${CONNECT_TRACE_ROOT_ID}{position:fixed;z-index:2147483646;` +
  `left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom));` +
  `display:flex;flex-direction:column;align-items:center;gap:.5rem;` +
  `width:min(30rem,92vw);padding:.75rem 1rem;box-sizing:border-box;` +
  `background:${CSS_PANEL};border:1px solid rgba(126,136,148,.35);border-radius:6px;` +
  `font-family:${FONT_BODY};-webkit-text-size-adjust:100%;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-steps{list-style:none;margin:0;padding:0;width:100%;` +
  `display:flex;flex-direction:column;gap:.2rem;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-step{font-size:clamp(11px,2.9vw,13px);letter-spacing:.06em;` +
  `line-height:1.45;display:flex;gap:.5rem;align-items:baseline;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-mark{flex:0 0 auto;width:.75rem;text-align:center;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-done{color:${CSS_HULL_STEEL};}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-live{color:${CSS_PLASMA};}` +
  // Red is damage and only damage (style-guide §2): a refused join is the one
  // thing on this panel that has actually gone wrong.
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-bad{color:${CSS_THREAT};}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-waited{margin:0;color:${CSS_HULL_STEEL};` +
  `font-size:clamp(10px,2.6vw,12px);letter-spacing:.1em;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-hint{margin:0;color:${CSS_CHALK};text-align:center;` +
  `font-size:clamp(11px,2.8vw,13px);line-height:1.4;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-actions{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;}` +
  `#${CONNECT_TRACE_ROOT_ID} .pr-ct-button{font-family:${FONT_HEADING};` +
  `font-size:clamp(12px,3vw,14px);letter-spacing:.1em;color:${CSS_CHALK};` +
  `background:transparent;border:1px solid ${CSS_HULL_STEEL};border-radius:4px;` +
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
  /** COPY LOG: export the session log (`./playtest-log-export`). */
  readonly onCopyLog: () => void;
}

/**
 * The mounted panel. `update` is safe to call every frame: it re-renders only when
 * the model's *rendered shape* actually changed, so a connect that sits for five
 * seconds costs one string comparison per frame and no DOM work.
 */
export class ConnectTraceView {
  private root: TraceElement | null = null;
  private lastHtml = '';
  private shown = false;

  constructor(private readonly config: ConnectTraceViewConfig) {}

  /** Whether the panel is currently on screen. */
  get visible(): boolean {
    return this.shown;
  }

  /** The markup last written — the handle a live-stage screenshot test reads. */
  get html(): string {
    return this.lastHtml;
  }

  /** Show (or refresh) the panel for `trace` as of `now`. */
  update(trace: ConnectTrace, now: number): void {
    this.render(connectTraceModel(trace, now));
  }

  /** Take the panel off screen — a seat arrived, or the player backed out. */
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
// The shared panel — what the game's screens actually call
// ---------------------------------------------------------------------------

let shared: ConnectTraceView | null = null;

/** Install the session's connect panel. Called once by `boot()` with the real
 *  `document`; a page with no DOM (node, the server) never calls it, and the
 *  helpers below then do nothing. */
export function installConnectTraceView(config: ConnectTraceViewConfig): ConnectTraceView {
  shared?.destroy();
  shared = new ConnectTraceView(config);
  return shared;
}

/** The installed panel, or null. */
export function connectTraceView(): ConnectTraceView | null {
  return shared;
}

/** Show the trace. Safe where no panel was installed (it does nothing), so a
 *  caller needs no null check. */
export function showConnectTrace(trace: ConnectTrace, now: number): void {
  shared?.update(trace, now);
}

/** Withdraw the panel. */
export function hideConnectTrace(): void {
  shared?.hide();
}

/** Drop the shared panel (tests, teardown). */
export function resetConnectTraceView(): void {
  shared?.destroy();
  shared = null;
}
