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
  /** Enter fullscreen — a named convenience over {@link setFullscreen}(true),
   *  called on the first touch gesture on mobile (mobile amendment §2). Rejected
   *  requests (no user gesture, iOS Safari) degrade to a no-op, never throw. */
  requestFullscreen(): Promise<void>;
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
  async function enterFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
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
  };
}
