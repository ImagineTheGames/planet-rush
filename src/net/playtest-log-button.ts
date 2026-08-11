/**
 * src/net/playtest-log-button.ts — the DOWNLOAD LOG button.
 * OWNER: Netcode Engineer (M10 playtest-log brief §2, §3).
 *
 * *"A log button in the pause menu and on every error screen — the 'can't reach
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
 *   - {@link downloadLogModel}      — offer + phase → what the button and hint say. Pure.
 *   - {@link renderDownloadLogHtml} — model → markup. Pure.
 *   - {@link DownloadLogAffordance} — the only DOM-touching part; export itself is
 *     `./playtest-log-export`'s job, so this file cannot send anything anywhere.
 *
 * Cold Vacuum palette (style-guide §1): plasma for the one action, chalk for the
 * words, steel for the frame. **No signal yellow and no threat red** — this button is
 * neither ore nor danger, and the RESERVED rule (style-guide §2) is not spent on a
 * diagnostic affordance.
 *
 * ── ONE BUTTON, AND IT SAYS DOWNLOAD LOG (ratified M10) ─────────────────────
 * There were two here: a clipboard button, leading, with a DOWNLOAD sibling beside
 * it. The developer killed the first one outright — *"Clipboard goes away for all
 * (PC and mobile)"*, and the surviving label is to name the file it produces. The
 * reason is the one they gave from a phone: a 40 KB JSON blob on a clipboard is a
 * paste no chat app takes and no human scrolls, so the clipboard route could report
 * success while the log went nowhere. That failure mode is not smaller on a desktop,
 * it is just quieter, and a second button offering a worse version of the same
 * export is a choice the developer has to make every time instead of a thing that
 * works.
 *
 * So: one control, one promise. What comes out is a **named `.json` file** — by the
 * share sheet's file variant where the platform takes it, else a blob download
 * (`./playtest-log-export` `downloadPlaytestLog`). The share sheet is not a
 * different outcome from a download; it is a download with the phone's own chooser
 * in front of it, which is why one button covers both. Never text, never the
 * clipboard, on any device.
 *
 * ── IT MOUNTS INSIDE THE FULLSCREEN ELEMENT, NOT BESIDE IT (a0-28) ──────────
 * *"download logs used to live in match as well pretty sure it was in pause menu."*
 * … *"I was on mobile."* The capture showed PAUSED / RESUME / SETTINGS / EXIT TO
 * MENU and an empty footer, and the wiring above it was never the problem: `main.ts`
 * `syncDownloadLog` offers `reason: 'pause'` every frame the overlay is up, and it
 * did. Measured on a real 844×390 landscape touch boot driven through the real front
 * door (PLAY → PLAY SOLO → RUSH! → pause), the button had a full 189×44 box at
 * (643, 334) — wholly inside the viewport, `visibility: visible`, `opacity: 1` — and
 * `document.elementFromPoint` at its own centre returned the **canvas**.
 *
 * The reason is the landscape lock's other half. On touch, PLAY enters fullscreen on
 * the game root (`@platform/fullscreen` `FullscreenLifecycle.enter`), which promotes
 * `#app` into the browser's **top layer** and paints a `::backdrop` over the rest of
 * the document. The top layer is not a z-index — it sits above every normal-flow
 * box no matter what, so this affordance, appended to `body` as a *sibling* of the
 * fullscreen element, was painted under the backdrop with the largest z-index the
 * platform has. Laid out, hit-tested against, and never shown.
 *
 * That is also why nothing else caught it, and why each of those is consistent:
 * the desk never auto-fullscreens (the lifecycle gates on `isTouch`), the boot-error
 * screen is reached before any PLAY, the connect-trace panel's own DOWNLOAD LOG is
 * drawn *in canvas inside `#app`* and merely calls `download()` here, and the phone
 * live-stage run boots `?debug=1` straight into a match, which skips PLAY.
 *
 * The fix is to mount where the pixels are: **`document.fullscreenElement` when there
 * is one, else `body`**, re-homed on every `fullscreenchange` because the player can
 * back out of fullscreen and re-enter it at any moment (the game offers an affordance
 * for exactly that). Falling back to `body` is what keeps every non-fullscreen
 * path — the desk, iPhone Safari, the boot-error screen — character for character
 * unchanged. It stays DOM, and it stays this module's own business: `main.ts` still
 * hands it the bare `document`.
 *
 * Not the same bug as a0-24's bottom-edge clipping, and the measurement says so in
 * one number: the box's bottom edge was 378 of 390.
 */

import { downloadPlaytestLog } from './playtest-log-export';
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
 *    ("DOWNLOAD LOG to report this") — the auto-offer of brief §3.
 */
export type DownloadLogReason = 'pause' | 'error';

/** The offer currently being made. `hint` overrides the default line, so a screen
 *  can name its own failure ("Couldn't reach the servers."). */
export interface DownloadLogOffer {
  readonly reason: DownloadLogReason;
  readonly hint?: string;
}

/** Where a press has got to. `working` exists because building and handing off a
 *  40 KB file is async, and a button that looks inert for 200 ms gets pressed four
 *  times. `shared` and `saved` are the two routes `downloadPlaytestLog` can take —
 *  the same file, differing only in who chose where it landed. */
export type DownloadLogPhase = 'idle' | 'working' | 'shared' | 'saved' | 'failed';

export interface DownloadLogModel {
  readonly label: string;
  /** The line above the button, or `''` for none. */
  readonly hint: string;
  /** True while a press is in flight — the button is disabled, so a doubled thumb
   *  cannot start a second write of the same file. */
  readonly busy: boolean;
}

/**
 * The label the button carries in each phase. `DOWNLOAD LOG` is the resting state
 * and the words the ratification names, so it is what a screenshot shows — and it
 * names the *thing you get*, a file, rather than a place it was put.
 */
export function downloadLogLabel(phase: DownloadLogPhase): string {
  switch (phase) {
    case 'working':
      return 'SAVING…';
    case 'shared':
      // The share sheet took the file somewhere the developer chose; the button says
      // so rather than claiming a Downloads folder it never reached.
      return 'LOG SENT';
    case 'saved':
      return 'LOG SAVED';
    case 'failed':
      return 'SAVE FAILED';
    case 'idle':
      return 'DOWNLOAD LOG';
  }
}

/** The auto-offer line an error screen shows (brief §3). */
export const ERROR_OFFER_HINT = 'DOWNLOAD LOG to report this.';

/**
 * The line above the button. After a press it *answers* the press — where the file
 * went, and that it is now a file to attach. Before one, an error screen makes the
 * offer and the pause menu stays quiet: the button's own label is self-explanatory
 * there, and the pause menu is not a place for a paragraph.
 */
export function downloadLogHint(offer: DownloadLogOffer, phase: DownloadLogPhase): string {
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
 */
export function downloadLogModel(
  offer: DownloadLogOffer,
  phase: DownloadLogPhase,
): DownloadLogModel {
  return {
    label: downloadLogLabel(phase),
    hint: downloadLogHint(offer, phase),
    busy: phase === 'working',
  };
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** The phase each export route lands the button in — one place, so the words and
 *  the route can never drift apart (`./playtest-log-export` `ExportRoute`). */
const ROUTE_PHASE: Record<ExportRoute, DownloadLogPhase> = {
  share: 'shared',
  download: 'saved',
};

/** Element ids — the handles the affordance and any live test address. */
export const DOWNLOAD_LOG_ROOT_ID = 'playtest-download-log';
export const DOWNLOAD_LOG_BUTTON_ID = 'playtest-download-log-button';
export const DOWNLOAD_LOG_HINT_ID = 'playtest-download-log-hint';

const CSS_HULL_STEEL = '#7E8894';
const CSS_PLASMA = '#4DC3FF';
const CSS_CHALK = '#DCE3EC';
/** Card fill: Vacuum lifted just enough to read as a panel (same value the
 *  boot-error screen uses, so the two diagnostics look like one family). */
const CSS_PANEL = '#141922';

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "Segoe UI", system-ui, sans-serif';

/**
 * The affordance's inner markup: a hint line over one button. Pure — a test asserts
 * that the words, the ids and the 44-px touch minimum are all present without a
 * browser.
 *
 * Bottom-**right**, inset past the safe area: the pause overlay stacks its own
 * buttons down the centre (`src/ui/pause-menu` `pauseLayout`) and the corner pause
 * affordance owns the top band, so the bottom-right corner is the one place this can
 * sit without covering a control the player is reaching for.
 *
 * One button, in plasma — there is no second affordance to rank it against any
 * more (ratified M10). The row it sits in is kept because the button's own label
 * grows and shrinks with the phase, and a flex row keeps it pinned to the right edge
 * as it does.
 */
export function renderDownloadLogHtml(model: DownloadLogModel): string {
  const hint = model.hint.length > 0 ? `<p id="${DOWNLOAD_LOG_HINT_ID}" class="pr-log-hint" role="status" aria-live="polite">${escapeHtml(model.hint)}</p>` : '';
  return (
    `<style>${DOWNLOAD_LOG_CSS}</style>` +
    hint +
    `<div class="pr-log-actions">` +
    `<button id="${DOWNLOAD_LOG_BUTTON_ID}" type="button" class="pr-log-button"` +
    `${model.busy ? ' disabled' : ''}>${escapeHtml(model.label)}</button>` +
    `</div>`
  );
}

const DOWNLOAD_LOG_CSS =
  // The same maximum z-index the boot-error screen uses (`@platform/boot-error`), and
  // that is deliberate: this affordance is appended to `body` *after* the app root, so
  // at an equal z-index it paints above a full-viewport error overlay — which is the
  // one screen it most needs to be reachable on ("the 'can't reach servers' page
  // especially"). Anything lower would leave it buried under the message it reports.
  `#${DOWNLOAD_LOG_ROOT_ID}{position:fixed;z-index:2147483647;` +
  `right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));` +
  `display:flex;flex-direction:column;align-items:flex-end;gap:.4rem;` +
  `max-width:min(22rem,80vw);font-family:${FONT_BODY};text-align:right;` +
  `-webkit-text-size-adjust:100%;}` +
  // …and `hidden` has to beat that `display:flex`, or `hide()` is a no-op. The UA's
  // `[hidden]{display:none}` loses to an id rule, so the withdrawal the match relies
  // on ("the match owns the screen again") never happened once the element existed:
  // it simply stayed on the glass over live play. Invisible until a0-28 un-buried
  // the affordance, which is why one fix cannot ship without the other.
  `#${DOWNLOAD_LOG_ROOT_ID}[hidden]{display:none;}` +
  `#${DOWNLOAD_LOG_ROOT_ID} .pr-log-hint{margin:0;padding:.35rem .55rem;border-radius:4px;` +
  `font-size:clamp(11px,2.8vw,13px);line-height:1.4;color:${CSS_CHALK};` +
  `background:${CSS_PANEL};border:1px solid rgba(126,136,148,.35);}` +
  `#${DOWNLOAD_LOG_ROOT_ID} .pr-log-actions{display:flex;justify-content:flex-end;}` +
  `#${DOWNLOAD_LOG_ROOT_ID} .pr-log-button{font-family:${FONT_HEADING};` +
  `font-size:clamp(12px,3vw,14px);letter-spacing:.1em;color:${CSS_PLASMA};` +
  `background:${CSS_PANEL};border:1px solid ${CSS_PLASMA};border-radius:4px;` +
  // 44px minimum: a real touch target on the phone (mobile amendment §1).
  `padding:.55rem 1.1rem;min-height:44px;min-width:44px;cursor:pointer;}` +
  `#${DOWNLOAD_LOG_ROOT_ID} .pr-log-button[disabled]{color:${CSS_HULL_STEEL};` +
  `border-color:${CSS_HULL_STEEL};cursor:default;}` +
  `#${DOWNLOAD_LOG_ROOT_ID} .pr-log-button:hover,#${DOWNLOAD_LOG_ROOT_ID} .pr-log-button:focus-visible` +
  `{background:rgba(77,195,255,.14);outline:none;}` +
  // --- The landscape lock (@platform/orientation) -------------------------------
  // Planet Rush IS landscape on mobile, always: on a touch viewport held portrait the
  // game's root container is rotated +90° so the player sees a landscape game however
  // the phone is held. Everything drawn into that root rotates for free. This
  // affordance does not — it is DOM over the canvas, laid out in PHYSICAL space — so
  // without this block it is the one element on the screen reading sideways, in a
  // corner that is not the corner it means. The phone live-stage evidence is what
  // showed it (`tests/live-stage/log-download-touch.spec.ts`): a log the developer
  // has to tilt their head to find is most of the way back to having no way to send
  // one.
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
  `#${DOWNLOAD_LOG_ROOT_ID}{right:auto;` +
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
 * make `Document` unassignable to {@link DownloadLogDom}. `unknown` keeps the seam
 * narrow *and* structurally satisfiable by the real thing.
 */
export interface DownloadLogElement {
  id: string;
  innerHTML: string;
  hidden: boolean;
  addEventListener(type: string, handler: () => void): void;
  appendChild(child: unknown): void;
  remove(): void;
}

/**
 * The slice of a parent this module appends into. Narrower than
 * {@link DownloadLogElement} on purpose: the fullscreen element is typed `Element`
 * by the DOM, and `Element` has no `hidden`, so requiring the wider shape would make
 * a real `Document` unassignable to {@link DownloadLogDom}.
 */
export interface DownloadLogHost {
  appendChild(child: unknown): void;
}

/** The slice of `Document` this module uses. */
export interface DownloadLogDom {
  createElement(tag: string): DownloadLogElement;
  getElementById(id: string): DownloadLogElement | null;
  readonly body: DownloadLogHost | null;
  /**
   * The element the browser is presenting fullscreen, or null/absent. **Where this
   * affordance has to live when there is one** — a fullscreen element is in the top
   * layer, and a sibling of it in `body` is painted under its `::backdrop` at any
   * z-index (a0-28). Optional so a host with no fullscreen concept needs no stub.
   */
  readonly fullscreenElement?: DownloadLogHost | null;
  /** Document-level events — `fullscreenchange`, so the affordance follows the
   *  player in and out of fullscreen. Optional for the same reason. */
  addEventListener?(type: string, handler: () => void): void;
}

/** Schedules the "…and back to DOWNLOAD LOG" revert. `setTimeout`'s shape. */
export type ScheduleFn = (fn: () => void, ms: number) => unknown;

/** How long a finished press keeps its answer on screen before the button returns
 *  to DOWNLOAD LOG. Long enough to read, short enough not to become furniture. */
export const REVERT_MS = 4000;

export interface DownloadLogConfig {
  readonly dom: DownloadLogDom;
  /** The log to export. Defaults to the session's shared log. */
  readonly log?: PlaytestLog;
  /** Export seams, forwarded to {@link downloadPlaytestLog} (injected in tests). */
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
export class DownloadLogAffordance {
  private root: DownloadLogElement | null = null;
  private offer: DownloadLogOffer | null = null;
  private phase: DownloadLogPhase = 'idle';
  /** Guards a doubled press while an export is in flight. */
  private inFlight = false;
  /** Counts presses so a stale revert timer cannot clear a newer answer. */
  private press = 0;
  /** The parent the element is currently in, so a re-home costs one comparison
   *  rather than an `appendChild` every frame (a0-28). */
  private host: DownloadLogHost | null = null;

  constructor(private readonly config: DownloadLogConfig) {
    // Follow the player in and out of fullscreen. Entering it promotes the game root
    // into the top layer, which buries anything left in `body`; leaving it puts the
    // root back in the normal flow, and the affordance has to come back with it.
    // `webkitfullscreenchange` for the older WebKit that still only fires that one.
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      this.config.dom.addEventListener?.(type, () => this.rehome());
    }
  }

  /** Whether the affordance is currently offered. */
  get visible(): boolean {
    return this.offer !== null;
  }

  /** The phase, for a test (and for the live-stage seam). */
  get state(): DownloadLogPhase {
    return this.phase;
  }

  /** Offer the button for `offer`'s reason. Re-showing the same offer is a no-op, so
   *  a press's answer is not wiped by the next frame's identical call. */
  show(offer: DownloadLogOffer): void {
    if (this.offer && this.offer.reason === offer.reason && this.offer.hint === offer.hint) {
      // Still the right parent? A per-frame caller is also how a fullscreen change
      // that fired no event gets caught — one property read and a comparison.
      this.rehome();
      if (this.root) this.root.hidden = false;
      return;
    }
    this.offer = offer;
    // A new screen is a new offer: drop the previous press's answer rather than
    // showing "LOG SAVED" over an unrelated failure.
    this.phase = 'idle';
    this.render();
  }

  /** Take the button off screen (the match owns the display again). */
  hide(): void {
    this.offer = null;
    if (this.root) this.root.hidden = true;
  }

  /** Remove the element entirely — teardown. The `fullscreenchange` listener
   *  outlives this (the seam has no `removeEventListener`), which costs nothing:
   *  {@link rehome} is a no-op once there is no element to move. */
  destroy(): void {
    this.offer = null;
    this.root?.remove();
    this.root = null;
    this.host = null;
  }

  /**
   * Do what a DOWNLOAD LOG press does: get the log out **as a file**, never as text
   * (`./playtest-log-export` `downloadPlaytestLog`) — the share sheet with the file
   * attached where the platform takes it, else the blob download. Exposed so the
   * behaviour is testable (and drivable from a live-stage seam) without synthesizing
   * a DOM click. Concurrent presses collapse into the first.
   */
  async download(): Promise<ExportResult> {
    if (this.inFlight) return { ok: false, reason: 'already exporting' };
    this.inFlight = true;
    const ticket = ++this.press;
    this.phase = 'working';
    this.render();

    let result: ExportResult;
    try {
      result = await downloadPlaytestLog({
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

  /** Back to DOWNLOAD LOG once the answer has been read — unless another press has
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
    root.innerHTML = renderDownloadLogHtml(downloadLogModel(offer, this.phase));
    // The button element is replaced by each `innerHTML` write, so its listener is
    // re-attached here rather than once at mount — one listener per live element,
    // and no stale handler on a detached node.
    this.config.dom.getElementById(DOWNLOAD_LOG_BUTTON_ID)?.addEventListener('click', () => {
      void this.download();
    });
  }

  /**
   * Where the element has to live *right now*: the fullscreen element when the
   * browser is presenting one, else `body`.
   *
   * This is the whole of a0-28. A fullscreen element is in the **top layer**, which
   * paints above every normal-flow box regardless of z-index and lays a `::backdrop`
   * over the rest of the document — so an affordance left in `body` while the game
   * root is fullscreen is laid out, sized, `visibility: visible`, and invisible. On
   * touch that is the ordinary state of a match: PLAY enters fullscreen on `#app`.
   */
  private desiredHost(): DownloadLogHost | null {
    return this.config.dom.fullscreenElement ?? this.config.dom.body;
  }

  /** Move an existing element to {@link desiredHost} if it is no longer there.
   *  Creates nothing — an affordance that has never been offered stays unmounted. */
  private rehome(): void {
    if (!this.root) return;
    const host = this.desiredHost();
    if (!host || host === this.host) return;
    // `appendChild` moves a node that already has a parent; no detach step needed.
    host.appendChild(this.root);
    this.host = host;
  }

  /** The container, created and appended on first use — and re-parented on later
   *  ones, because the right parent changes with fullscreen ({@link desiredHost}).
   *  Null when the page has nothing to mount into (which is not a failure worth
   *  throwing over — it just means no button on a page that has no DOM). */
  private mount(): DownloadLogElement | null {
    if (this.root) {
      this.rehome();
      return this.root;
    }
    const host = this.desiredHost();
    if (!host) return null;
    const root = this.config.dom.createElement('div');
    root.id = DOWNLOAD_LOG_ROOT_ID;
    host.appendChild(root);
    this.root = root;
    this.host = host;
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

let sharedAffordance: DownloadLogAffordance | null = null;

/**
 * Install the session's DOWNLOAD LOG affordance. Called once by `boot()` with the
 * real `document`; a page with no DOM (node, the server) never calls it, and the two
 * helpers below then do nothing.
 */
export function installDownloadLogButton(config: DownloadLogConfig): DownloadLogAffordance {
  sharedAffordance?.destroy();
  sharedAffordance = new DownloadLogAffordance(config);
  return sharedAffordance;
}

/** The installed affordance, or null. */
export function downloadLogButton(): DownloadLogAffordance | null {
  return sharedAffordance;
}

/**
 * Offer DOWNLOAD LOG — from the pause menu, or from an error screen with the
 * failure's own words. Safe to call every frame, and safe to call where no
 * affordance was installed (it simply does nothing), so a caller needs no null check.
 */
export function showDownloadLog(offer: DownloadLogOffer): void {
  sharedAffordance?.show(offer);
}

/** Withdraw the offer — the match owns the screen again. */
export function hideDownloadLog(): void {
  sharedAffordance?.hide();
}

/** Drop the shared affordance (tests, teardown). */
export function resetDownloadLogButton(): void {
  sharedAffordance?.destroy();
  sharedAffordance = null;
}
