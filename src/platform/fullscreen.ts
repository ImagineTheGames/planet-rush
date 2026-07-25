/**
 * src/platform/fullscreen.ts — the fullscreen lifecycle. OWNER: Platform Engineer.
 *
 * Field request (v0.1.1): "hide the browser's title bar — it takes up so much
 * game space." The answer is the Fullscreen API, entered on a user gesture (PLAY
 * on mobile), which also makes the NATIVE `screen.orientation.lock('landscape')`
 * legal. This module owns the *lifecycle* of that — everything the browser can do
 * to it behind our backs, handled so the game keeps running no matter what:
 *
 *  - **Enter on PLAY** ({@link FullscreenLifecycle.enter}) — request fullscreen on
 *    the game root, then attempt the native landscape lock. Fire-and-forget; a
 *    rejection (iPhone Safari, an odd embed, a boot without a real gesture) is
 *    swallowed and the game proceeds in exactly today's behaviour — no error
 *    screen over a working game (requirement 2).
 *  - **Never assume it sticks** — the user can back out with a system gesture or
 *    ESC at any moment. {@link FullscreenLifecycle.sync} reads the live truth from
 *    the seam each frame (and on `fullscreenchange`); once the game has *been*
 *    fullscreen ({@link FullscreenLifecycle.everEntered}) and is no longer, the
 *    re-enter affordance is offered ({@link FullscreenLifecycle.affordanceVisible}).
 *  - **Desktop is untouched** — keyboard/mouse never auto-fullscreens (it is
 *    hostile there, requirement 3); the whole module gates on `isTouch`.
 *
 * Pure over the platform seam — no bare browser global (GDD §4.1), so the whole
 * lifecycle unit-tests headless against a fake {@link Platform}.
 */

import type { Platform } from './platform';
import { requestLandscape } from './orientation';

/**
 * Tracks the fullscreen lifecycle for one boot and decides when to offer the
 * re-enter affordance. Construct once with the platform seam, the device kind and
 * the DOM element to make fullscreen (the game root); drive it with {@link sync}
 * each frame and {@link enter} on a user gesture.
 */
export class FullscreenLifecycle {
  /** True once the game has actually been fullscreen at least once — so the
   *  affordance is offered only after a real exit, never as an unsolicited nag
   *  on the rejection path (requirement 2) or on a platform that can't do it. */
  private entered = false;

  constructor(
    private readonly platform: Platform,
    private readonly isTouch: boolean,
    /** The game root to make fullscreen. `undefined` falls back to the document
     *  element inside the seam — never fatal, just less scoped. */
    private readonly root?: Element,
  ) {}

  /**
   * Enter fullscreen on the game root, then attempt the native landscape lock —
   * the PLAY / re-enter gesture (requirement 1). A no-op on desktop (requirement
   * 3) and where fullscreen is unavailable, and fire-and-forget everywhere: the
   * resulting state is read back through {@link sync}, never assumed here.
   */
  enter(): void {
    if (!this.isTouch || !this.platform.canFullscreen()) return;
    requestLandscape(this.platform, this.root);
  }

  /**
   * Fold the live environment into the lifecycle: if the game is fullscreen right
   * now, it has been fullscreen. Cheap (one seam read); safe to call every frame
   * and on every `fullscreenchange`.
   */
  sync(): void {
    if (this.platform.isFullscreen()) this.entered = true;
  }

  /** Whether the game has ever been fullscreen this boot (see {@link sync}). */
  get everEntered(): boolean {
    return this.entered;
  }

  /**
   * Whether the re-enter-fullscreen affordance should be on screen this frame:
   * only on a touch device that *can* go fullscreen, that *has* been fullscreen,
   * and that is *not* fullscreen now (the user backed out). On desktop, on iPhone
   * Safari, and before the first successful entry it is always false.
   */
  affordanceVisible(): boolean {
    return this.isTouch && this.platform.canFullscreen() && this.entered && !this.platform.isFullscreen();
  }

  /** Whether the game is fullscreen right now (live seam read). */
  get active(): boolean {
    return this.platform.isFullscreen();
  }

  /** Whether this platform can enter fullscreen at all (live seam read). */
  get supported(): boolean {
    return this.platform.canFullscreen();
  }
}
