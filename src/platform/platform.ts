/**
 * src/platform/platform.ts — the Capacitor seam. OWNER: Platform Engineer.
 *
 * All platform-specific calls — fullscreen, vibration, storage, orientation —
 * go through this one interface; game code never touches a bare browser global
 * directly (GDD §4.1; mobile amendment §1). Wrapping this for native store
 * packaging is a post-week task, not a rewrite.
 *
 * Placeholder only — the browser implementation lands in the day-1 milestone.
 * The interface shape is intentionally sketched here so consumers can depend on
 * it; method bodies are not yet implemented.
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

export const PLATFORM_PLACEHOLDER = true;
