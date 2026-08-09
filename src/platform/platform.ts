/**
 * src/platform/platform.ts — the Capacitor seam. OWNER: Platform Engineer.
 *
 * All platform-specific calls — fullscreen, vibration, storage, orientation —
 * go through this one interface; game code never touches a bare browser global
 * directly (GDD §4.1; mobile amendment §1). Wrapping this for native store
 * packaging is a post-week task, not a rewrite: swap the implementation, keep
 * the interface.
 *
 * The day-1 browser implementation is here. Every call degrades gracefully where
 * a capability is missing (desktop has no vibration; some mobile browsers reject
 * orientation lock) so a missing feature never throws into game code.
 */

/** The platform abstraction every device-facing call routes through. */
export interface Platform {
  /** Request/exit fullscreen. */
  setFullscreen(on: boolean): Promise<void>;
  /** Enter fullscreen on `target` (default the document element), so the game
   *  can take the whole screen from a user gesture — PLAY on mobile (field
   *  request v0.1.1; GDD §4.1). Rejected requests (no user gesture, iOS Safari,
   *  odd embeds) degrade to a no-op, never throw. */
  requestFullscreen(target?: Element): Promise<void>;
  /** Whether an element is currently fullscreen — the live truth the re-enter
   *  affordance and the landscape lock read (a system gesture/ESC can drop it at
   *  any time, so it is never assumed to stick). */
  isFullscreen(): boolean;
  /** Whether this platform can enter fullscreen at all. False on iPhone Safari,
   *  where the Fullscreen API is absent — the caller then leans entirely on the
   *  CSS-rotation landscape fallback and never offers a re-enter affordance
   *  (field request v0.1.1). Feature-detected, no bare global in game code. */
  canFullscreen(): boolean;
  /** Haptic feedback (no-op where unsupported, e.g. desktop). */
  vibrate(ms: number): void;
  /** Persistent key/value storage (settings, chosen fire mode, etc.). */
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** Lock orientation where supported (landscape; cuttable per §4.9). */
  lockOrientation(orientation: 'landscape' | 'portrait'): Promise<void>;
  /** Whether this platform can actually lock orientation. Android Chrome can;
   *  iOS Safari cannot — the caller shows a ROTATE overlay there instead of
   *  locking (mobile amendment §2). Feature-detected, no bare global in game
   *  code (GDD §4.1). */
  canLockOrientation(): boolean;
  /**
   * Whether the player has asked their operating system for **less motion**
   * (`prefers-reduced-motion: reduce`).
   *
   * ── WHY THIS ARRIVES WITH pr-05, AND WHAT IT IS NOT ────────────────────────
   * Nothing in this client honoured the preference before the end-of-match
   * sequence: a grep over `src/`, `index.html`, `public/` and the style guide
   * returned nothing (plan `docs/progression-plan.md` Trap 15). The nearest
   * neighbour is **`reduceVfx`** (`src/render/index.ts`), and it is *not* this —
   * that is a performance reducer driven by a sustained frame-rate drop plus a
   * match setting, it sheds decorative VFX while keeping the load-bearing tells
   * (GDD §4.3 risk 5), and it says nothing about what the player asked their OS
   * for. The two answer different questions and are read separately.
   *
   * It lives on this seam rather than as a `window.matchMedia` call in the UI for
   * the reason every other capability does (GDD §4.1): game code never touches a
   * bare browser global, and a preference this screen reads must be answerable
   * headless, in a unit test, and by a native shell later.
   *
   * **Read it per use, never cached.** A player can change the setting while the
   * game is open, and the answer is one media-query lookup.
   *
   * Defaults to `false` where the query is unavailable — full motion is the
   * shipped experience, and a browser that cannot answer has not asked for less.
   */
  prefersReducedMotion(): boolean;
}

/** The non-standard-typed `screen.orientation.lock` surface, feature-detected
 *  behind the seam so no game code touches a bare browser global (GDD §4.1). */
type LockableOrientation = { lock?: (o: string) => Promise<void> };
function orientationLock(): LockableOrientation | undefined {
  const scr = screen as Screen & { orientation?: LockableOrientation };
  return scr.orientation;
}

/**
 * The browser implementation of the platform seam. Feature-detects everything so
 * an unsupported capability degrades to a no-op instead of throwing.
 */
export function createBrowserPlatform(): Platform {
  async function enterFullscreen(target?: Element): Promise<void> {
    try {
      const el = target ?? document.documentElement;
      if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen();
      }
    } catch {
      /* Fullscreen can be rejected (no user gesture, iOS Safari) — never fatal. */
    }
  }

  return {
    async setFullscreen(on: boolean): Promise<void> {
      if (on) {
        await enterFullscreen();
        return;
      }
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        /* Exiting fullscreen can also reject — never fatal. */
      }
    },

    requestFullscreen: enterFullscreen,

    isFullscreen(): boolean {
      return !!document.fullscreenElement;
    },

    canFullscreen(): boolean {
      // `fullscreenEnabled` is false where the API is blocked (iframes without
      // allowfullscreen) and absent on iPhone Safari; the element method is the
      // second half of the feature test (GDD §4.1 — no bare global in game code).
      return !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
    },

    vibrate(ms: number): void {
      // navigator.vibrate is absent on desktop and iOS Safari — feature-detect.
      if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    },

    storage: {
      get(key: string): string | null {
        try {
          return localStorage.getItem(key);
        } catch {
          return null; // private mode / disabled storage
        }
      },
      set(key: string, value: string): void {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* quota / private mode — settings just don't persist this session */
        }
      },
    },

    async lockOrientation(orientation: 'landscape' | 'portrait'): Promise<void> {
      // screen.orientation.lock is non-standard-typed and unsupported on iOS.
      const orient = orientationLock();
      try {
        if (orient && typeof orient.lock === 'function') {
          await orient.lock(orientation);
        }
      } catch {
        /* Orientation lock is cuttable (GDD §4.9); a rejection is never fatal. */
      }
    },

    canLockOrientation(): boolean {
      const orient = orientationLock();
      return !!orient && typeof orient.lock === 'function';
    },

    prefersReducedMotion(): boolean {
      // Feature-detected and wrapped: `matchMedia` is absent in a jsdom-less test
      // environment and in some embeds, and an unsupported query must read as "no
      // preference" rather than throw into a screen the player cannot leave.
      try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
      } catch {
        return false;
      }
    },
  };
}
