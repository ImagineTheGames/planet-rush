/**
 * src/platform/install-prompt.ts — PWA "Add to Home Screen" plumbing.
 * OWNER: Platform Engineer.
 *
 * The manifest + service worker (GDD §4.1) make Planet Rush installable; this
 * controller manages the one browser event that gates a *custom* install offer.
 * Chromium fires `beforeinstallprompt` when the install criteria are met and
 * lets a page defer it, then trigger the native prompt later from a user gesture.
 * We capture and defer it (suppressing Chrome's own mini-infobar) so the game
 * decides when to surface install, and re-fire it on demand.
 *
 * Installability is cuttable (GDD §4.9) and every path degrades safely: no event
 * → `canInstall` stays false and {@link prompt} reports `unavailable`; the game
 * plays in the browser regardless. This module is the *plumbing* — capturing,
 * deferring, and firing the prompt; the visible affordance is the UI layer's to
 * wire onto {@link InstallPromptController.prompt}. Pure DOM-event wiring, no
 * Pixi, so it unit-tests headless with a fake event target.
 */

/** The non-standard `beforeinstallprompt` event (Chromium). Typed here because
 *  it is absent from the DOM lib; feature-detected at the edge, never assumed. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** Result of asking to install: the user's choice, or `unavailable` when there
 *  is no deferred prompt to fire (unsupported browser, already installed). */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** The event-target seam (window). Narrowed so a fake drives the tests. */
export interface InstallEventTarget {
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
}

/**
 * Captures and manages the deferred install prompt. Construct once at boot with
 * `window`; read {@link canInstall} to gate an install affordance and call
 * {@link prompt} from a user gesture to show the native dialog.
 */
export class InstallPromptController {
  private deferred: BeforeInstallPromptEvent | null = null;
  private installed = false;

  private readonly onBeforeInstallPrompt = (e: Event): void => {
    // Suppress Chrome's mini-infobar; we surface install on our own terms (§4.9).
    e.preventDefault();
    this.deferred = e as BeforeInstallPromptEvent;
    this.onChange();
  };

  private readonly onAppInstalled = (): void => {
    // Installed (from our prompt or the browser's own menu): retire the offer.
    this.deferred = null;
    this.installed = true;
    this.onChange();
  };

  /**
   * @param target  the event source — `window` in the browser, a fake in tests.
   * @param onChange fired whenever installability changes, so a UI affordance can
   *   show/hide itself. Optional; defaults to a no-op.
   */
  constructor(
    private readonly target: InstallEventTarget,
    private readonly onChange: () => void = () => {},
  ) {
    target.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    target.addEventListener('appinstalled', this.onAppInstalled);
  }

  /** Can an install be offered right now? True only once the browser has fired
   *  `beforeinstallprompt` and the app is not already installed. */
  get canInstall(): boolean {
    return this.deferred !== null && !this.installed;
  }

  /** Whether the app has been installed this session (via any path). */
  get isInstalled(): boolean {
    return this.installed;
  }

  /**
   * Fire the native install prompt. **Must be called from a user gesture** (a
   * click/tap handler) or the browser rejects it. The deferred event is
   * single-use, so `canInstall` goes false afterward regardless of the choice.
   * Never throws — a rejected or absent prompt resolves to `unavailable`.
   */
  async prompt(): Promise<InstallOutcome> {
    const evt = this.deferred;
    if (!evt) return 'unavailable';
    this.deferred = null; // a deferred prompt can only be used once
    this.onChange();
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      return outcome;
    } catch {
      return 'unavailable';
    }
  }

  /** Detach listeners. */
  dispose(): void {
    this.target.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    this.target.removeEventListener('appinstalled', this.onAppInstalled);
  }
}
