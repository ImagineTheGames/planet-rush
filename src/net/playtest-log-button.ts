/**
 * src/net/playtest-log-button.ts — the COPY LOG button, and its DOWNLOAD sibling.
 * OWNER: Netcode Engineer (M10 playtest-log brief §2, §3).
 *
 * *"A COPY LOG button in the pause menu and on every error screen — the 'can't reach
 * servers' page especially."* This is that button, and it is **DOM, not PixiJS**, for
 * the same reason the boot-error screen is (`@platform/boot-error`): the moments it
 * has to work in are exactly the moments the game may not be drawing — a dead
 * socket, a refused join, a screen the developer is staring at because nothing else
 * is happening. A DOM button over the canvas cannot be taken down by the renderer's
 * troubles, works with the browser's own touch handling, and is one `innerHTML`
 * write plus one listener.
 *
 * It is also, deliberately, the **whole** of the feature's UI. `src/ui/` owns the
 * game's screens and its palette-side chrome; this module owns one 44-px affordance
 * that appears only when a screen is already claiming the display (pause, or an
 * error) and hides the instant the match owns the screen again. Nothing here draws
 * during play.
 *
 * Structure follows the boot-error discipline exactly, so the wording and the
 * behaviour are testable in node with no browser:
 *
 *   - {@link copyLogModel}      — offer + phase → what the button and hint say. Pure.
 *   - {@link renderCopyLogHtml} — model → markup. Pure.
 *   - {@link CopyLogAffordance} — the only DOM-touching part; export itself is
 *     `./playtest-log-export`'s job, so this file cannot send anything anywhere.
 *
 * Cold Vacuum palette (style-guide §1): plasma for the one action, chalk for the
 * words, steel for the frame. **No signal yellow and no threat red** — this button is
 * neither ore nor danger, and the RESERVED rule (style-guide §2) is not spent on a
 * diagnostic affordance.
 *
 * ── THE DOWNLOAD SIBLING (ratified M10) ─────────────────────────────────────
 * The developer, from a phone: *"too large for mobile clipboard."* COPY LOG's
 * chain can *succeed* into exactly that dead end — a 40 KB JSON blob on a phone's
 * clipboard is a paste no chat app takes and no human scrolls, and the export
 * reported success while the log went nowhere. So DOWNLOAD stands beside it with a
 * different promise: what comes out is a **named `.json` file**, by the share
 * sheet's file variant where the platform takes it and by a blob download where it
 * does not (`./playtest-log-export` `downloadPlaytestLog`) — never text, never the
 * clipboard. COPY LOG is unchanged and still leads, because on a desktop the
 * clipboard remains the right first answer.
 */

import { downloadPlaytestLog, exportPlaytestLog } from './playtest-log-export';
import type { ExportConfig, ExportResult, ExportRoute } from './playtest-log-export';
import { playtestLog } from './playtest-log';
import type { PlaytestLog } from './playtest-log';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * Why the button is on screen:
 *  - `pause` — the pause menu is up; the log is simply available (brief §2).
 *  - `error` — something failed, and the screen actively invites the report
 *    ("COPY LOG to report this") — the auto-offer of brief §3.
 */
export type CopyLogReason = 'pause' | 'error';

/** The offer currently being made. `hint` overrides the default line, so a screen
 *  can name its own failure ("Couldn't reach the servers."). */
export interface CopyLogOffer {
  readonly reason: CopyLogReason;
  readonly hint?: string;
}

/** Where a press has got to. `working` exists because a clipboard write is async and
 *  a button that looks inert for 200 ms gets pressed four times. */
export type CopyLogPhase = 'idle' | 'working' | 'shared' | 'copied' | 'saved' | 'failed';

/**
 * Which of the two siblings a phase belongs to.
 *
 * The affordance offers **COPY LOG** and **DOWNLOAD** (ratified M10 — the
 * developer: *"too large for mobile clipboard"*), and only one of them is ever
 * reporting: a phase is a press's answer, so it must be attributed to the button
 * that was pressed. Without this the download's "LOG SAVED" would appear on the
 * clipboard button, which is the sort of wrong the screenshot then carries.
 */
export type CopyLogActor = 'copy' | 'download';

export interface CopyLogModel {
  readonly label: string;
  /** The DOWNLOAD sibling's label. */
  readonly downloadLabel: string;
  /** The line above the buttons, or `''` for none. */
  readonly hint: string;
  /** True while a COPY LOG press is in flight — that button is disabled. */
  readonly busy: boolean;
  /** True while a DOWNLOAD press is in flight. Both go busy together: one export
   *  at a time, so a doubled thumb cannot start a second write of a 40 KB file. */
  readonly downloadBusy: boolean;
}

/** The label the button carries in each phase. `COPY LOG` is the resting state and
 *  the words the brief names, so it is what a screenshot shows. */
export function copyLogLabel(phase: CopyLogPhase): string {
  switch (phase) {
    case 'working':
      return 'COPYING…';
    case 'shared':
      // The share sheet took it somewhere the developer chose; the button says so
      // rather than claiming a clipboard it never touched.
      return 'LOG SENT';
    case 'copied':
      return 'LOG COPIED';
    case 'saved':
      return 'LOG SAVED';
    case 'failed':
      return 'COPY FAILED';
    case 'idle':
      return 'COPY LOG';
  }
}

/**
 * The DOWNLOAD sibling's label in each phase (ratified M10). `DOWNLOAD` is the
 * resting word — it names the *thing you get*, a file, which is the whole reason
 * it stands next to COPY LOG rather than behind it.
 *
 * `shared` is a real outcome here and not a lie about a download: this button's
 * first route is the share sheet **with the file attached**, which is a download
 * with the phone's own chooser in front of it (`./playtest-log-export`
 * `downloadPlaytestLog`). The button says which one happened.
 */
export function downloadLogLabel(phase: CopyLogPhase): string {
  switch (phase) {
    case 'working':
      return 'SAVING…';
    case 'shared':
      return 'LOG SENT';
    case 'copied':
      // Not a route this button takes; kept total so no phase can render blank.
      return 'LOG COPIED';
    case 'saved':
      return 'LOG SAVED';
    case 'failed':
      return 'SAVE FAILED';
    case 'idle':
      return 'DOWNLOAD';
  }
}

/** The auto-offer line an error screen shows, verbatim from the brief (§3). */
export const ERROR_OFFER_HINT = 'COPY LOG to report this.';

/**
 * The line above the button. After a press it *answers* the press — where the log
 * went, and (for the download) that it is now a file to attach. Before one, an error
 * screen makes the offer and the pause menu stays quiet: the button's own label is
 * self-explanatory there, and the pause menu is not a place for a paragraph.
 */
export function copyLogHint(
  offer: CopyLogOffer,
  phase: CopyLogPhase,
  actor: CopyLogActor = 'copy',
): string {
  if (actor === 'download') {
    switch (phase) {
      case 'shared':
        return 'Log sent as a file — pick where it went from the share sheet.';
      case 'saved':
        return 'Log saved to your downloads — attach that file.';
      case 'failed':
        return 'Could not save the log on this device.';
      default:
        return offer.reason === 'error' ? (offer.hint ?? ERROR_OFFER_HINT) : '';
    }
  }
  switch (phase) {
    case 'shared':
      return 'Log sent — pick where it went from the share sheet.';
    case 'copied':
      return 'Log copied — paste it into chat.';
    case 'saved':
      return 'Clipboard blocked, so the log was downloaded as a file — attach that.';
    case 'failed':
      return 'Could not copy or download the log on this device.';
    default:
      return offer.reason === 'error' ? (offer.hint ?? ERROR_OFFER_HINT) : '';
  }
}

/**
 * The auto-offer line for a *dropped* connection (brief §3), naming what happened
 * before it asks for the log. The transport's own reason rides along when it has one,
 * because "the room ended" and "your grace ran out" are different bugs and a report
 * that conflates them costs a round trip (`./websocket-transport` `CloseReason`).
 *
 * Pure, so the wording is asserted without a socket.
 */
export function disconnectOfferHint(state: string, closeReason?: string | null): string {
  if (state === 'reconnecting') return `Reconnecting — ${ERROR_OFFER_HINT}`;
  const reason = closeReason ? ` (${closeReason})` : '';
  return `Disconnected${reason} — ${ERROR_OFFER_HINT}`;
}

/**
 * The whole frame model. Pure, so both the wording and the disabled state are
 * asserted without a DOM.
 *
 * `actor` says which sibling the phase belongs to — the other one stays at rest,
 * so a finished download leaves COPY LOG reading `COPY LOG` rather than claiming
 * an answer it had nothing to do with. Defaults to `copy`, which is what every
 * caller predating the DOWNLOAD sibling meant.
 */
export function copyLogModel(
  offer: CopyLogOffer,
  phase: CopyLogPhase,
  actor: CopyLogActor = 'copy',
): CopyLogModel {
  const busy = phase === 'working';
  return {
    label: copyLogLabel(actor === 'copy' ? phase : 'idle'),
    downloadLabel: downloadLogLabel(actor === 'download' ? phase : 'idle'),
    hint: copyLogHint(offer, phase, actor),
    // One export at a time: whichever button is working, both refuse a press.
    busy,
    downloadBusy: busy,
  };
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** The phase each export route lands the button in — one place, so the words and
 *  the route can never drift apart (`./playtest-log-export` `ExportRoute`). */
const ROUTE_PHASE: Record<ExportRoute, CopyLogPhase> = {
  share: 'shared',
  clipboard: 'copied',
  download: 'saved',
};

/** Element ids — the handles the affordance and any live test address. */
export const COPY_LOG_ROOT_ID = 'playtest-copy-log';
export const COPY_LOG_BUTTON_ID = 'playtest-copy-log-button';
export const COPY_LOG_DOWNLOAD_ID = 'playtest-copy-log-download';
export const COPY_LOG_HINT_ID = 'playtest-copy-log-hint';

const CSS_HULL_STEEL = '#7E8894';
const CSS_PLASMA = '#4DC3FF';
const CSS_CHALK = '#DCE3EC';
/** Card fill: Vacuum lifted just enough to read as a panel (same value the
 *  boot-error screen uses, so the two diagnostics look like one family). */
const CSS_PANEL = '#141922';

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "Segoe UI", system-ui, sans-serif';

/**
 * The affordance's inner markup: a hint line over a row of two buttons. Pure — a
 * test asserts that the words, the ids and the 44-px touch minimum are all present
 * without a browser.
 *
 * Bottom-**right**, inset past the safe area: the pause overlay stacks its own
 * buttons down the centre (`src/ui/pause-menu` `pauseLayout`) and the corner pause
 * affordance owns the top band, so the bottom-right corner is the one place this can
 * sit without covering a control the player is reaching for.
 *
 * **DOWNLOAD sits second, and reads as the quieter of the two** (chalk on steel,
 * against COPY LOG's plasma). Both are one tap; the order is the desktop's, where
 * the clipboard is still the right first answer (ratified: *"clipboard stays for
 * desktop"*). The row wraps, so on the narrowest phone the second button drops
 * under the first instead of off the screen.
 */
export function renderCopyLogHtml(model: CopyLogModel): string {
  const hint = model.hint.length > 0 ? `<p id="${COPY_LOG_HINT_ID}" class="pr-log-hint" role="status" aria-live="polite">${escapeHtml(model.hint)}</p>` : '';
  return (
    `<style>${COPY_LOG_CSS}</style>` +
    hint +
    `<div class="pr-log-actions">` +
    `<button id="${COPY_LOG_BUTTON_ID}" type="button" class="pr-log-button"` +
    `${model.busy ? ' disabled' : ''}>${escapeHtml(model.label)}</button>` +
    `<button id="${COPY_LOG_DOWNLOAD_ID}" type="button" class="pr-log-button pr-log-secondary"` +
    `${model.downloadBusy ? ' disabled' : ''}>${escapeHtml(model.downloadLabel)}</button>` +
    `</div>`
  );
}

const COPY_LOG_CSS =
  // The same maximum z-index the boot-error screen uses (`@platform/boot-error`), and
  // that is deliberate: this affordance is appended to `body` *after* the app root, so
  // at an equal z-index it paints above a full-viewport error overlay — which is the
  // one screen it most needs to be reachable on ("the 'can't reach servers' page
  // especially"). Anything lower would leave it buried under the message it reports.
  `#${COPY_LOG_ROOT_ID}{position:fixed;z-index:2147483647;` +
  `right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));` +
  `display:flex;flex-direction:column;align-items:flex-end;gap:.4rem;` +
  `max-width:min(22rem,80vw);font-family:${FONT_BODY};text-align:right;` +
  `-webkit-text-size-adjust:100%;}` +
  `#${COPY_LOG_ROOT_ID} .pr-log-hint{margin:0;padding:.35rem .55rem;border-radius:4px;` +
  `font-size:clamp(11px,2.8vw,13px);line-height:1.4;color:${CSS_CHALK};` +
  `background:${CSS_PANEL};border:1px solid rgba(126,136,148,.35);}` +
  // The two siblings sit on one row, wrapping to two on a narrow phone rather than
  // pushing the second one off the edge. Right-aligned with the rest of the card.
  `#${COPY_LOG_ROOT_ID} .pr-log-actions{display:flex;gap:.5rem;flex-wrap:wrap;` +
  `justify-content:flex-end;}` +
  `#${COPY_LOG_ROOT_ID} .pr-log-button{font-family:${FONT_HEADING};` +
  `font-size:clamp(12px,3vw,14px);letter-spacing:.1em;color:${CSS_PLASMA};` +
  `background:${CSS_PANEL};border:1px solid ${CSS_PLASMA};border-radius:4px;` +
  // 44px minimum: a real touch target on the phone (mobile amendment §1).
  `padding:.55rem 1.1rem;min-height:44px;min-width:44px;cursor:pointer;}` +
  // DOWNLOAD is the quieter sibling: chalk on steel, so one plasma affordance
  // leads (style-guide §1 — the emphasis colour is spent once per surface).
  `#${COPY_LOG_ROOT_ID} .pr-log-secondary{color:${CSS_CHALK};border-color:${CSS_HULL_STEEL};}` +
  `#${COPY_LOG_ROOT_ID} .pr-log-button[disabled]{color:${CSS_HULL_STEEL};` +
  `border-color:${CSS_HULL_STEEL};cursor:default;}` +
  `#${COPY_LOG_ROOT_ID} .pr-log-button:hover,#${COPY_LOG_ROOT_ID} .pr-log-button:focus-visible` +
  `{background:rgba(77,195,255,.14);outline:none;}` +
  // --- The landscape lock (@platform/orientation) -------------------------------
  // Planet Rush IS landscape on mobile, always: on a touch viewport held portrait the
  // game's root container is rotated +90° so the player sees a landscape game however
  // the phone is held. Everything drawn into that root rotates for free. This
  // affordance does not — it is DOM over the canvas, laid out in PHYSICAL space — so
  // without this block it is the one element on the screen reading sideways, in a
  // corner that is not the corner it means. The phone live-stage evidence is what
  // showed it (`tests/live-stage/copy-log-touch.spec.ts`): a log the developer has to
  // tilt their head to find is most of the way back to having no way to send one.
  //
  // The media query is `computeRootTransform`'s condition in CSS: `pointer:coarse` is
  // the `isTouch` main.ts passes it, `orientation:portrait` is its `physH > physW`.
  // Stated here rather than wired in from `main.ts` because that is another lane's
  // file, and because a pure media query cannot fall out of step with a JS resize
  // handler this module does not own.
  //
  // The geometry: the root rotates +π/2 about the origin and translates x by physW,
  // so logical (landscape) bottom-right — where this sits unrotated — lands on the
  // PHYSICAL bottom-left. `rotate(90deg)` matches the root's direction (baseline runs
  // down the physical screen, glyph-up points right, exactly as the game's own text
  // does); `translateX(-100%)` applies first, putting the element's right edge on the
  // origin so it grows back up-screen into the logical viewport instead of off its
  // right edge. `vh` for the width cap because under rotation the element's width is
  // measured along the physical HEIGHT.
  `@media (pointer:coarse) and (orientation:portrait){` +
  `#${COPY_LOG_ROOT_ID}{right:auto;` +
  `left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));` +
  `max-width:min(22rem,80vh);` +
  `transform-origin:left bottom;transform:rotate(90deg) translateX(-100%);}}`;

/** HTML-escape every interpolated string. A hint can carry a server's own words. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// The DOM edge
// ---------------------------------------------------------------------------

/**
 * The slice of an element this module writes. `HTMLElement` satisfies it — which is
 * why `appendChild` takes `unknown`: the DOM's own signature is generic over `Node`
 * (`<T extends Node>(node: T) => T`), and a parameter typed as our own element would
 * make `Document` unassignable to {@link CopyLogDom}. `unknown` keeps the seam narrow
 * *and* structurally satisfiable by the real thing.
 */
export interface CopyLogElement {
  id: string;
  innerHTML: string;
  hidden: boolean;
  addEventListener(type: string, handler: () => void): void;
  appendChild(child: unknown): void;
  remove(): void;
}

/** The slice of `Document` this module uses. */
export interface CopyLogDom {
  createElement(tag: string): CopyLogElement;
  getElementById(id: string): CopyLogElement | null;
  readonly body: CopyLogElement | null;
}

/** Schedules the "…and back to COPY LOG" revert. `setTimeout`'s shape. */
export type ScheduleFn = (fn: () => void, ms: number) => unknown;

/** How long a finished press keeps its answer on screen before the button returns
 *  to COPY LOG. Long enough to read, short enough not to become furniture. */
export const REVERT_MS = 4000;

export interface CopyLogConfig {
  readonly dom: CopyLogDom;
  /** The log to export. Defaults to the session's shared log. */
  readonly log?: PlaytestLog;
  /** Export seams, forwarded to {@link exportPlaytestLog} (injected in tests). */
  readonly exportOptions?: Omit<ExportConfig, 'log'>;
  /** Defaults to `setTimeout` where there is one; without it the button simply
   *  keeps its last answer until the next press. */
  readonly schedule?: ScheduleFn | null;
}

/**
 * The mounted button. `show` is idempotent per offer, so a per-frame caller (the
 * match loop asking "is the pause menu up?") costs one comparison and no DOM work.
 *
 * The element is created on the first `show` and kept — hidden, not destroyed —
 * afterwards, because the screens it serves come and go repeatedly in one session.
 */
export class CopyLogAffordance {
  private root: CopyLogElement | null = null;
  private offer: CopyLogOffer | null = null;
  private phase: CopyLogPhase = 'idle';
  /** Which sibling the current phase belongs to (see {@link CopyLogActor}). */
  private actor: CopyLogActor = 'copy';
  /** Guards a doubled press while an export is in flight. */
  private inFlight = false;
  /** Counts presses so a stale revert timer cannot clear a newer answer. */
  private press = 0;

  constructor(private readonly config: CopyLogConfig) {}

  /** Whether the affordance is currently offered. */
  get visible(): boolean {
    return this.offer !== null;
  }

  /** The phase, for a test (and for the live-stage seam). */
  get state(): CopyLogPhase {
    return this.phase;
  }

  /** Which button that phase belongs to — `copy` at rest. */
  get actingOn(): CopyLogActor {
    return this.actor;
  }

  /** Offer the button for `offer`'s reason. Re-showing the same offer is a no-op, so
   *  a press's answer is not wiped by the next frame's identical call. */
  show(offer: CopyLogOffer): void {
    if (this.offer && this.offer.reason === offer.reason && this.offer.hint === offer.hint) {
      if (this.root) this.root.hidden = false;
      return;
    }
    this.offer = offer;
    // A new screen is a new offer: drop the previous press's answer rather than
    // showing "LOG COPIED" over an unrelated failure.
    this.phase = 'idle';
    this.actor = 'copy';
    this.render();
  }

  /** Take the button off screen (the match owns the display again). */
  hide(): void {
    this.offer = null;
    if (this.root) this.root.hidden = true;
  }

  /** Remove the element entirely — teardown. */
  destroy(): void {
    this.offer = null;
    this.root?.remove();
    this.root = null;
  }

  /**
   * Do what a COPY LOG press does: export the log by the best route this device
   * has (share → clipboard → download) and report where it went. Exposed so the
   * behaviour is testable (and drivable from a live-stage seam) without
   * synthesizing a DOM click. Concurrent presses collapse into the first.
   */
  async copy(): Promise<ExportResult> {
    return this.run('copy', exportPlaytestLog);
  }

  /**
   * Do what a DOWNLOAD press does: get the log out **as a file**, never as text
   * (`./playtest-log-export` `downloadPlaytestLog`) — the share sheet with the
   * file attached where the platform takes it, else the blob download. The
   * developer's *"too large for mobile clipboard"* is exactly the case
   * {@link copy} can satisfy and still leave stranded, so this is a separate
   * promise rather than a fallback of that one.
   */
  async download(): Promise<ExportResult> {
    return this.run('download', downloadPlaytestLog);
  }

  /** One press, whichever button made it: go busy, run the route, wear the answer,
   *  and schedule the revert. The two siblings share this so they cannot drift in
   *  their disabling, their ticketing, or their error handling. */
  private async run(
    actor: CopyLogActor,
    route: (config: ExportConfig) => Promise<ExportResult>,
  ): Promise<ExportResult> {
    if (this.inFlight) return { ok: false, reason: 'already exporting' };
    this.inFlight = true;
    const ticket = ++this.press;
    this.actor = actor;
    this.phase = 'working';
    this.render();

    let result: ExportResult;
    try {
      result = await route({
        log: this.config.log ?? playtestLog(),
        ...(this.config.exportOptions ?? {}),
      });
    } catch (err) {
      result = { ok: false, reason: String(err) };
    }
    this.inFlight = false;
    this.phase = result.ok ? ROUTE_PHASE[result.route] : 'failed';
    this.render();
    this.scheduleRevert(ticket);
    return result;
  }

  // --- Internals ----------------------------------------------------------

  /** Back to COPY LOG once the answer has been read — unless another press has
   *  happened since (`ticket`), whose answer must not be cleared by this timer. */
  private scheduleRevert(ticket: number): void {
    const schedule =
      this.config.schedule === undefined ? defaultSchedule() : this.config.schedule;
    if (!schedule) return;
    schedule(() => {
      if (ticket !== this.press || this.phase === 'working') return;
      this.phase = 'idle';
      this.render();
    }, REVERT_MS);
  }

  /** Write the current model into the DOM, mounting the element on first use. */
  private render(): void {
    const offer = this.offer;
    if (!offer) {
      if (this.root) this.root.hidden = true;
      return;
    }
    const root = this.mount();
    if (!root) return;
    root.hidden = false;
    root.innerHTML = renderCopyLogHtml(copyLogModel(offer, this.phase, this.actor));
    // Both button elements are replaced by each `innerHTML` write, so their
    // listeners are re-attached here rather than once at mount — one listener per
    // live element, and no stale handler on a detached node.
    this.config.dom.getElementById(COPY_LOG_BUTTON_ID)?.addEventListener('click', () => {
      void this.copy();
    });
    this.config.dom.getElementById(COPY_LOG_DOWNLOAD_ID)?.addEventListener('click', () => {
      void this.download();
    });
  }

  /** The container, created and appended on first use. Null when the page has no
   *  body to mount into (which is not a failure worth throwing over — it just means
   *  no button on a page that has no DOM). */
  private mount(): CopyLogElement | null {
    if (this.root) return this.root;
    const host = this.config.dom.body;
    if (!host) return null;
    const root = this.config.dom.createElement('div');
    root.id = COPY_LOG_ROOT_ID;
    host.appendChild(root);
    this.root = root;
    return root;
  }
}

/** `setTimeout` where there is one, else null (node without timers, a stub host). */
function defaultSchedule(): ScheduleFn | null {
  const fn = (globalThis as { setTimeout?: ScheduleFn }).setTimeout;
  return typeof fn === 'function' ? fn : null;
}

// ---------------------------------------------------------------------------
// The shared affordance — what the game's screens actually call
// ---------------------------------------------------------------------------

let sharedAffordance: CopyLogAffordance | null = null;

/**
 * Install the session's COPY LOG affordance. Called once by `boot()` with the real
 * `document`; a page with no DOM (node, the server) never calls it, and the two
 * helpers below then do nothing.
 */
export function installCopyLogButton(config: CopyLogConfig): CopyLogAffordance {
  sharedAffordance?.destroy();
  sharedAffordance = new CopyLogAffordance(config);
  return sharedAffordance;
}

/** The installed affordance, or null. */
export function copyLogButton(): CopyLogAffordance | null {
  return sharedAffordance;
}

/**
 * Offer COPY LOG — from the pause menu, or from an error screen with the failure's
 * own words. Safe to call every frame, and safe to call where no affordance was
 * installed (it simply does nothing), so a caller needs no null check.
 */
export function showCopyLog(offer: CopyLogOffer): void {
  sharedAffordance?.show(offer);
}

/** Withdraw the offer — the match owns the screen again. */
export function hideCopyLog(): void {
  sharedAffordance?.hide();
}

/** Drop the shared affordance (tests, teardown). */
export function resetCopyLogButton(): void {
  sharedAffordance?.destroy();
  sharedAffordance = null;
}
