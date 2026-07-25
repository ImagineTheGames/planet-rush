/**
 * src/platform/boot-error.ts — NO BLACK SCREENS, EVER. OWNER: Platform Engineer.
 *
 * The rule this file enforces, written down so it cannot quietly lapse:
 *
 * > If Planet Rush cannot start, the player gets a screen that says what
 * > happened in plain words, what to try, which build it was, and a Retry
 * > button. Never a black page. Never a console stack as the only artefact.
 *
 * It exists because of a real failure: Chrome's GPU process wedged, WebGL went
 * away, and the game rendered nothing at all while the console held only
 * `autoDetectRenderer: CanvasRenderer is not yet implemented`. That is unreadable
 * to a player and useless on a phone, where there is no console to look at.
 *
 * **Deliberately DOM-only, and deliberately dependency-free.** This screen is what
 * you see when the renderer could not be created, so it cannot use the renderer —
 * no PixiJS, no WebGL, no fonts that must load, no network. Markup plus one inline
 * stylesheet in the Cold Vacuum palette (style-guide §1), assembled as a *string*:
 *
 *   - {@link describeBootFailure} — error → plain-words content. Pure.
 *   - {@link renderBootErrorHtml} — content → markup. Pure.
 *   - {@link showBootError}       — the only function that touches the DOM.
 *
 * The two pure halves carry the wording and the layout, so both are unit-tested
 * headless (there is no jsdom in this repo); the DOM half is one `innerHTML`
 * write plus one click listener, and is covered end-to-end by the
 * `--disable-webgl` scenario in `tests/live/boot.spec.ts`.
 */
import { formatBuildBadge } from './build-info';
import { isWebGlUnavailable } from './gl-probe';

/** Element id of the screen's root — the handle the live test asserts on. */
export const BOOT_ERROR_ID = 'boot-error';

/** Element id of the Retry button. */
export const BOOT_ERROR_RETRY_ID = 'boot-error-retry';

/** Element id of the line that answers a Retry click that changed nothing. */
export const BOOT_ERROR_STATUS_ID = 'boot-error-status';

/** Default host element: the app root, so the failed canvas (if one exists) is
 *  replaced rather than layered over. */
export const BOOT_ERROR_MOUNT_ID = 'app';

/**
 * Which failure we are explaining. Two kinds, because the useful advice differs:
 * `no-webgl` is a *browser configuration* problem the player can often fix, while
 * `init-failed` is a bug in the build and the error text is the payload.
 */
export type BootFailureKind = 'no-webgl' | 'init-failed';

/** Everything the screen says, with no markup in it. Pure data so the wording is
 *  assertable in a unit test and cannot rot silently. */
export interface BootErrorContent {
  readonly kind: BootFailureKind;
  /** Small all-caps label above the headline (the alarm tell). */
  readonly eyebrow: string;
  /** One line, plain words, no jargon — what happened. */
  readonly headline: string;
  /** A short paragraph: why it happened and whose problem it is. */
  readonly plain: string;
  /** Ordered "try this" list, most-likely-to-work first. Backtick-quoted spans
   *  (`` `chrome://gpu` ``) render as inline code — see {@link renderInlineCode}. */
  readonly fixes: readonly string[];
  /** The raw error text. Cryptic is fine *below* the plain words; absent is not. */
  readonly detail: string;
  /** The build badge string — same `<sha> · <HH:MM>Z` the in-game corner stamp
   *  shows, so a screenshot of this screen is a filable bug report. */
  readonly build: string;
}

/** Headline for the no-WebGL case — the sentence the brief asks for, verbatim. */
export const NO_WEBGL_HEADLINE = 'Your browser could not start WebGL — the game needs it';

/**
 * Turn whatever `boot()` threw into plain-words content.
 *
 * `build` is injected (defaulting to the live stamp) so the wording tests are not
 * a function of the checkout's git sha.
 */
export function describeBootFailure(err: unknown, build: string = formatBuildBadge()): BootErrorContent {
  const detail = describeError(err);

  if (isWebGlUnavailable(err)) {
    return {
      kind: 'no-webgl',
      eyebrow: 'WEBGL UNAVAILABLE',
      headline: NO_WEBGL_HEADLINE,
      plain:
        'Planet Rush draws everything on the graphics card, so it cannot run without WebGL. ' +
        'Your browser either has WebGL switched off or its graphics process has stopped ' +
        'answering. This is a browser problem — it happens on brand-new hardware too, and ' +
        'it is not a problem with your computer or with this build.',
      fixes: [
        'Quit the browser completely — every window, not just this tab — and open it again. A stuck graphics process is the usual cause, and a full restart clears it.',
        'Open `chrome://gpu` in a new tab and look at the WebGL and WebGL2 rows. If they do not say "Hardware accelerated", the reason why is listed on that page.',
        'Check that hardware acceleration is on: Chrome → Settings → System → "Use graphics acceleration when available", then restart the browser.',
        'Try a different browser (Firefox, Edge, Safari). If the game runs there, the fault is in the first browser, not on your machine.',
      ],
      detail,
      build,
    };
  }

  return {
    kind: 'init-failed',
    eyebrow: 'BOOT FAILED',
    headline: 'Planet Rush could not start',
    plain:
      'The game hit an error while starting up and stopped there, rather than leaving you ' +
      'on a black screen. The exact error is below — it is the useful half of a bug report, ' +
      'together with the build stamp.',
    fixes: [
      'Press Retry, or reload the page — a one-off failure during start-up often does not repeat.',
      'Quit the browser completely and open it again, which also clears a stuck graphics process.',
      'Open `chrome://gpu` in a new tab and check that the WebGL rows say "Hardware accelerated".',
      'Try a different browser to see whether the fault follows you.',
      'Still broken? Report it with the error text and the build stamp below.',
    ],
    detail,
    build,
  };
}

/** Best available text for something thrown at us (which need not be an `Error`).
 *  Keeps the stack when there is one: this is the line a bug report carries. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const head = err.message ? `${err.name}: ${err.message}` : err.name;
    return err.stack && err.stack.includes(err.message) ? err.stack : head;
  }
  if (err === undefined) return 'Unknown error (nothing was thrown to describe).';
  if (typeof err === 'string') return err;
  try {
    // `JSON.stringify` returns undefined for a function/symbol, and throws on a
    // cycle — both fall through to String(), because *some* text must reach the
    // screen. An empty detail box is the cryptic-only failure all over again.
    const json = JSON.stringify(err) as string | undefined;
    return json ?? String(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/**
 * The Cold Vacuum palette, as CSS (style-guide §1). Reproduced here rather than
 * imported from the render layer on purpose: this screen must render when the
 * render layer is exactly what failed.
 *
 * No signal yellow anywhere — yellow means ore or danger and nothing else
 * (style-guide §2, the RESERVED rule). Threat red is the correct colour for the
 * alarm eyebrow ("damage, alarms, the under-attack tell"), plasma blue carries
 * the one action on screen, and the body text is the same chalk the ROTATE
 * overlay uses (`orientation.ts`).
 */
const CSS_VACUUM = '#0D1015';
const CSS_HULL_STEEL = '#7E8894';
const CSS_PLASMA = '#4DC3FF';
const CSS_THREAT_RED = '#B23A3A';
const CSS_CHALK = '#DCE3EC';
/** Card fill: Vacuum lifted just enough to read as a panel, not a second colour. */
const CSS_PANEL = '#141922';

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "Segoe UI", system-ui, sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Render the whole screen as one HTML string: a fixed full-viewport overlay in
 * the Cold Vacuum palette, holding the eyebrow, headline, plain paragraph, the
 * numbered fixes, the raw error text, the Retry button + status line, and the
 * build stamp.
 *
 * Pure — so a unit test can assert the screen carries the sha, the fixes, and the
 * button without a browser. Every interpolated string is escaped
 * ({@link escapeHtml}); the only markup that survives is the backtick→`<code>`
 * convention, applied *after* escaping.
 *
 * Sizes use `clamp()` and the card scrolls, so the screen is readable on a
 * 390px-wide phone (the primary mobile test device) as well as on a desktop.
 */
export function renderBootErrorHtml(content: BootErrorContent): string {
  const fixes = content.fixes.map((f) => `<li>${renderInlineCode(escapeHtml(f))}</li>`).join('');
  return (
    `<div id="${BOOT_ERROR_ID}" data-kind="${escapeHtml(content.kind)}" role="alert">` +
    `<style>${BOOT_ERROR_CSS}</style>` +
    `<div class="pr-boot-card">` +
    `<p class="pr-boot-eyebrow">${escapeHtml(content.eyebrow)}</p>` +
    `<h1 class="pr-boot-headline">${escapeHtml(content.headline)}</h1>` +
    `<p class="pr-boot-plain">${escapeHtml(content.plain)}</p>` +
    `<h2 class="pr-boot-subhead">What usually fixes it</h2>` +
    `<ol class="pr-boot-fixes">${fixes}</ol>` +
    `<h2 class="pr-boot-subhead">The exact error</h2>` +
    `<pre class="pr-boot-detail">${escapeHtml(content.detail)}</pre>` +
    `<div class="pr-boot-actions">` +
    `<button id="${BOOT_ERROR_RETRY_ID}" type="button" class="pr-boot-retry">Retry</button>` +
    `<span id="${BOOT_ERROR_STATUS_ID}" class="pr-boot-status" role="status" aria-live="polite"></span>` +
    `</div>` +
    `<p class="pr-boot-build">build <code>${escapeHtml(content.build)}</code></p>` +
    `</div>` +
    `</div>`
  );
}

/** The inline stylesheet. Inline because a stylesheet request is one more thing
 *  that can fail on the exact code path where things are already failing. */
const BOOT_ERROR_CSS =
  `#${BOOT_ERROR_ID}{position:fixed;inset:0;z-index:2147483647;overflow:auto;` +
  `display:flex;align-items:center;justify-content:center;` +
  `padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) ` +
  `max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));` +
  `background:${CSS_VACUUM};font-family:${FONT_BODY};color:${CSS_CHALK};` +
  `-webkit-text-size-adjust:100%;text-align:left;}` +
  `#${BOOT_ERROR_ID} .pr-boot-card{width:100%;max-width:46rem;box-sizing:border-box;` +
  `background:${CSS_PANEL};border:1px solid rgba(126,136,148,.35);` +
  `border-top:3px solid ${CSS_THREAT_RED};border-radius:6px;padding:clamp(16px,4vw,32px);}` +
  `#${BOOT_ERROR_ID} .pr-boot-eyebrow{margin:0 0 .5rem;font-family:${FONT_HEADING};` +
  `font-size:clamp(11px,2.6vw,13px);letter-spacing:.18em;color:${CSS_THREAT_RED};}` +
  `#${BOOT_ERROR_ID} .pr-boot-headline{margin:0 0 .9rem;font-family:${FONT_HEADING};` +
  `font-weight:400;font-size:clamp(18px,4.4vw,26px);line-height:1.3;color:${CSS_CHALK};}` +
  `#${BOOT_ERROR_ID} .pr-boot-plain{margin:0 0 1.4rem;font-size:clamp(13px,3.2vw,15px);` +
  `line-height:1.55;color:${CSS_CHALK};}` +
  `#${BOOT_ERROR_ID} .pr-boot-subhead{margin:0 0 .5rem;font-family:${FONT_HEADING};` +
  `font-weight:400;font-size:clamp(11px,2.6vw,12px);letter-spacing:.14em;` +
  `text-transform:uppercase;color:${CSS_HULL_STEEL};}` +
  `#${BOOT_ERROR_ID} .pr-boot-fixes{margin:0 0 1.4rem;padding-left:1.4rem;` +
  `font-size:clamp(13px,3.2vw,15px);line-height:1.55;}` +
  `#${BOOT_ERROR_ID} .pr-boot-fixes li{margin-bottom:.6rem;}` +
  `#${BOOT_ERROR_ID} code{font-family:${FONT_MONO};font-size:.92em;` +
  `background:rgba(77,195,255,.10);color:${CSS_PLASMA};padding:.08em .35em;border-radius:3px;` +
  `user-select:all;-webkit-user-select:all;}` +
  `#${BOOT_ERROR_ID} .pr-boot-detail{margin:0 0 1.6rem;padding:.7rem .8rem;max-height:9rem;` +
  `overflow:auto;font-family:${FONT_MONO};font-size:clamp(11px,2.6vw,12px);line-height:1.45;` +
  `white-space:pre-wrap;word-break:break-word;color:${CSS_HULL_STEEL};` +
  `background:${CSS_VACUUM};border:1px solid rgba(126,136,148,.25);border-radius:4px;}` +
  `#${BOOT_ERROR_ID} .pr-boot-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.8rem;}` +
  `#${BOOT_ERROR_ID} .pr-boot-retry{font-family:${FONT_HEADING};font-size:clamp(13px,3.2vw,15px);` +
  `letter-spacing:.1em;color:${CSS_PLASMA};background:transparent;` +
  `border:1px solid ${CSS_PLASMA};border-radius:4px;padding:.6rem 1.5rem;cursor:pointer;` +
  // 44px minimum so it is a real touch target on the phone (mobile amendment §1).
  `min-height:44px;min-width:44px;}` +
  `#${BOOT_ERROR_ID} .pr-boot-retry:hover,#${BOOT_ERROR_ID} .pr-boot-retry:focus-visible` +
  `{background:rgba(77,195,255,.14);outline:none;}` +
  `#${BOOT_ERROR_ID} .pr-boot-status{font-size:clamp(12px,3vw,13px);line-height:1.45;` +
  `color:${CSS_THREAT_RED};}` +
  `#${BOOT_ERROR_ID} .pr-boot-build{margin:1.5rem 0 0;font-size:clamp(11px,2.6vw,12px);` +
  `color:${CSS_HULL_STEEL};}`;

/** HTML-escape a text span. Applied to *every* interpolated string, error text
 *  included — an error message can contain anything, and this screen renders in
 *  the page's own origin. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turn `` `like this` `` into `<code>like this</code>`. Runs on already-escaped
 *  text, so it is the only markup any authored string can introduce — which is
 *  why the fix strings can mention `chrome://gpu` and have it read as code (it
 *  cannot be a link: browsers block page-initiated navigation to `chrome://`). */
export function renderInlineCode(escaped: string): string {
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
}

// ---------------------------------------------------------------------------
// The DOM edge
// ---------------------------------------------------------------------------

/** The slice of an element this module writes to — kept minimal so `Document` and
 *  `HTMLElement` satisfy it structurally and a test can fake it. */
export interface BootErrorElement {
  innerHTML: string;
  textContent: string | null;
  addEventListener(type: string, handler: () => void): void;
}

/** The slice of `Document` this module reads. */
export interface BootErrorDom {
  getElementById(id: string): BootErrorElement | null;
  readonly body: BootErrorElement | null;
}

export interface ShowBootErrorOptions {
  readonly dom: BootErrorDom;
  readonly content: BootErrorContent;
  /**
   * Retry handler. Returns `true` when the retry worked and the caller is taking
   * over (reloading); `false` when nothing changed, in which case the status line
   * says so instead of leaving the player clicking a button that appears dead.
   */
  readonly onRetry: () => boolean;
  /** Host element id; defaults to {@link BOOT_ERROR_MOUNT_ID}, falling back to
   *  `document.body` when the app root is missing. */
  readonly mountId?: string;
}

/**
 * Put the screen on the page and wire Retry. The **only** DOM-touching function
 * here, and the only place `innerHTML` is written — replacing the host's contents
 * so a dead canvas cannot sit underneath a message about itself.
 *
 * Returns `false` only when there is no element to mount into at all (no `#app`,
 * no `body`), which is the one situation this module genuinely cannot rescue.
 */
export function showBootError(opts: ShowBootErrorOptions): boolean {
  const { dom, content, onRetry } = opts;
  const host = dom.getElementById(opts.mountId ?? BOOT_ERROR_MOUNT_ID) ?? dom.body;
  if (!host) return false;

  host.innerHTML = renderBootErrorHtml(content);

  const button = dom.getElementById(BOOT_ERROR_RETRY_ID);
  const status = dom.getElementById(BOOT_ERROR_STATUS_ID);
  let attempts = 0;
  button?.addEventListener('click', () => {
    attempts++;
    let recovered = false;
    try {
      recovered = onRetry();
    } catch {
      // A throwing retry is just another failed retry — never a dead button.
      recovered = false;
    }
    if (!recovered && status) status.textContent = retryStatusMessage(content.kind, attempts);
  });

  return true;
}

/**
 * What the status line says after a Retry that changed nothing. Names the number
 * of checks so the player can see the click did something, and points at the fix
 * that actually works for a wedged GPU process (a full browser restart) instead
 * of inviting them to keep tapping.
 */
export function retryStatusMessage(kind: BootFailureKind, attempts: number): string {
  const checks = attempts === 1 ? '1 check' : `${attempts} checks`;
  if (kind === 'no-webgl') {
    return `Still no WebGL after ${checks}. The browser has not given it back yet — quit the browser completely and open it again.`;
  }
  return `Still failing after ${checks}. Try quitting the browser completely, or another browser.`;
}
