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
  /** Haptic feedback (no-op where unsupported, e.g. desktop). */
  vibrate(ms: number): void;
  /** Persistent key/value storage (settings, chosen fire mode, etc.). */
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** Lock orientation where supported (landscape; cuttable per §4.9). */
  lockOrientation(orientation: 'landscape' | 'portrait'): Promise<void>;
}

/**
 * The browser implementation of the platform seam. Feature-detects everything so
 * an unsupported capability degrades to a no-op instead of throwing.
 */
export function createBrowserPlatform(): Platform {
  return {
    async setFullscreen(on: boolean): Promise<void> {
      try {
        if (on) {
          if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        } else if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {
        /* Fullscreen can be rejected (no user gesture, iOS Safari) — never fatal. */
      }
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
      const scr = screen as Screen & {
        orientation?: { lock?: (o: string) => Promise<void> };
      };
      try {
        if (scr.orientation && typeof scr.orientation.lock === 'function') {
          await scr.orientation.lock(orientation);
        }
      } catch {
        /* Orientation lock is cuttable (GDD §4.9); a rejection is never fatal. */
      }
    },
  };
}
