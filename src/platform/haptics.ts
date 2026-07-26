/**
 * src/platform/haptics.ts — the vibration service. OWNER: Platform Engineer.
 *
 * Field request v0.2.2: "Are we able to add vibration effects to game?" — yes,
 * on Android (the Vibration API). iOS Safari has never shipped `navigator.vibrate`,
 * so this is an *enhancement, never a dependency*: everything degrades to a silent
 * no-op where the motor is absent, and no call ever throws into game code.
 *
 * One tiny service with a **ratified vocabulary** — {@link HapticKind}. Gameplay
 * and UI stay ignorant of the browser API: they call `haptic('tap')`, and the
 * platform decides whether a motor exists, whether the player left it on, whether
 * the tab is even visible, and what millisecond pattern each named event plays.
 * The patterns live in one table ({@link HAPTIC_PATTERNS}) so the *feel* of the
 * game is tuned in one place, not scattered across call sites (mirrors the seam
 * discipline in `platform.ts`, GDD §4.1 — no bare browser global in game code).
 *
 * Three gates silence the motor, checked on every `haptic()`:
 *   1. **Unsupported** — no `navigator.vibrate` (desktop, iOS). Feature-detected
 *      once at construction; `isSupported()` is what the settings screen reads to
 *      *hide* the toggle where a motor can't exist.
 *   2. **Disabled** — the player turned "Vibration" off. Persisted through the
 *      platform storage seam, default ON where supported (field request item 2).
 *   3. **Hidden / quiet** — the tab is backgrounded, or we are inside the
 *      post-death quiet window (see below). A buzz from a tab the player isn't
 *      looking at is noise.
 *
 * **Death is special.** Losing your core plays a heavy `death` thunk and then the
 * motor goes *silent for three seconds* — the same three seconds of audio quiet
 * the field request calls for, applied to the motor too. Firing the death pattern
 * also cancels any alarm already buzzing (a fresh `navigator.vibrate` replaces the
 * running pattern), so the base-under-attack rhythm doesn't stutter on past the
 * moment the base is gone.
 *
 * Pure-ish and injectable: the core ({@link createHaptics}) takes its capabilities
 * — the vibrate primitive, a visibility probe, storage, a clock — as dependencies,
 * so it unit-tests headless in the `node` test env without touching a real global.
 * {@link createBrowserHaptics} is the thin browser wiring that feature-detects the
 * real `navigator`/`document`.
 */

/**
 * The ratified haptic vocabulary. Game code names the *event*, never the pattern.
 *
 *  - `tap`     — a UI control was pressed (a menu button, a wheel wedge). Barely
 *                there; the lightest confirmation a finger landed on something.
 *  - `confirm` — a commitment landed (a purchase, a repair). A short double so it
 *                reads as "done", distinct from a plain `tap`.
 *  - `hit`     — *you* took damage (your ship was shot). A medium single knock.
 *  - `alarm`   — your base is under sustained attack. A strong, rhythmic pattern,
 *                the tactile half of the under-attack audio alarm (GDD §2.2).
 *  - `death`   — your core is lost. A heavy thunk, then the motor stops and stays
 *                quiet for {@link DEATH_QUIET_MS} (the three-second hush).
 */
export type HapticKind = 'tap' | 'confirm' | 'hit' | 'alarm' | 'death';

/**
 * Each event's vibration pattern, in **milliseconds**. A single number is one
 * buzz of that length; an array alternates buzz / pause / buzz / … (the shape
 * `navigator.vibrate` itself takes). Tuned here and nowhere else, so the whole
 * game's haptic *feel* moves together (TUNABLE — art & feel own the final values,
 * as they do the audio mix).
 */
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, number | readonly number[]>> = {
  // A whisper — just enough to register a press without buzzing through a rapid
  // menu walk.
  tap: 10,
  // Buzz–pause–buzz: reads as a deliberate two-beat "committed", not a stray tap.
  confirm: [12, 40, 12],
  // A single medium knock — you felt that one.
  hit: 30,
  // Strong and rhythmic: the tactile echo of the under-attack alarm's cadence
  // (GDD §2.2). Three rising pulses so it's unmistakable in the pocket.
  alarm: [120, 80, 120, 80, 200],
  // A heavy stutter into a long final thud — the core going down. Comfortably
  // under DEATH_QUIET_MS so the buzz finishes inside the hush it opens.
  death: [200, 100, 420],
};

/** Storage key for the persisted "Vibration" toggle (settings, field request
 *  item 2). Namespaced like the other client keys (`planet-rush:*`). */
export const HAPTICS_STORAGE_KEY = 'planet-rush:haptics';

/** Milliseconds of enforced motor silence after `death` — the three-second hush
 *  the field request applies to the motor as well as the audio. */
export const DEATH_QUIET_MS = 3000;

/** The persisted-value words we write, so a stored preference reads clearly in
 *  devtools and survives a schema that might grow. */
const ENABLED_ON = 'on';
const ENABLED_OFF = 'off';

/** The haptics service every device-facing haptic routes through. */
export interface Haptics {
  /** Play the named event's pattern — unless unsupported, disabled, the tab is
   *  hidden, or we're inside the post-death quiet window. Never throws. */
  haptic(kind: HapticKind): void;
  /** Whether this device has a motor at all. False on desktop and iOS Safari —
   *  what the settings screen reads to *hide* the toggle (field request item 2). */
  isSupported(): boolean;
  /** Whether the player has vibration switched on. Reflects the persisted
   *  preference; irrelevant (always effectively off) when unsupported. */
  isEnabled(): boolean;
  /** Turn vibration on/off and persist it. No-op churn is fine — writing the same
   *  value twice is cheap and idempotent. */
  setEnabled(on: boolean): void;
}

/** The capabilities the core needs, injected so it tests headless (no globals). */
export interface HapticsDeps {
  /** The raw pattern-firing primitive, or `null` when the platform has no motor.
   *  `null` is the single source of "unsupported" — the core never touches a bare
   *  `navigator`. */
  readonly vibrate: ((pattern: number | number[]) => void) | null;
  /** Whether the tab is currently hidden (backgrounded). A hidden tab gets no
   *  buzz — the player isn't looking. */
  readonly isHidden: () => boolean;
  /** Persistence for the enabled toggle — the platform storage seam. */
  readonly storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** A monotonic-enough clock in milliseconds, for the post-death quiet window.
   *  Injected so tests drive it deterministically. */
  readonly now: () => number;
}

/**
 * Build the haptics service over injected capabilities. The default entry point
 * for real devices is {@link createBrowserHaptics}; this core exists so the gating
 * logic is unit-testable without a DOM.
 */
export function createHaptics(deps: HapticsDeps): Haptics {
  const supported = deps.vibrate !== null;

  // The persisted preference. Default ON where a motor exists (field request:
  // "default ON where supported"); an explicit stored 'off' wins. On an
  // unsupported device the value is moot — every `haptic()` no-ops regardless —
  // but we still honour a stored preference so toggling it on a phone and later
  // opening the same profile on a desktop doesn't lose the choice.
  let enabled = readEnabled(deps.storage, supported);

  // Timestamp before which the motor stays silent — the post-death hush. 0 means
  // "no active quiet window".
  let quietUntil = 0;

  function fire(pattern: number | readonly number[]): void {
    // `navigator.vibrate` wants a mutable number[]; our table is readonly, so copy
    // an array pattern. A scalar passes straight through.
    deps.vibrate!(typeof pattern === 'number' ? pattern : pattern.slice());
  }

  return {
    haptic(kind: HapticKind): void {
      if (!supported || !enabled) return;
      if (deps.isHidden()) return;

      // Death is the one event allowed to break the quiet window — it *opens* it.
      if (kind === 'death') {
        fire(HAPTIC_PATTERNS.death);
        quietUntil = deps.now() + DEATH_QUIET_MS;
        return;
      }

      // Everything else stays silent through the post-death hush.
      if (deps.now() < quietUntil) return;

      fire(HAPTIC_PATTERNS[kind]);
    },

    isSupported(): boolean {
      return supported;
    },

    isEnabled(): boolean {
      return enabled;
    },

    setEnabled(on: boolean): void {
      enabled = on;
      deps.storage.set(HAPTICS_STORAGE_KEY, on ? ENABLED_ON : ENABLED_OFF);
    },
  };
}

/** Read the persisted toggle, falling back to "on where supported". */
function readEnabled(storage: HapticsDeps['storage'], supported: boolean): boolean {
  const stored = storage.get(HAPTICS_STORAGE_KEY);
  if (stored === ENABLED_ON) return true;
  if (stored === ENABLED_OFF) return false;
  return supported; // unset → default ON where a motor exists
}

/**
 * The browser haptics service. Feature-detects the real `navigator.vibrate` and
 * `document.hidden` behind the seam (this is the *one* platform-lane file allowed
 * to, exactly like `platform.ts`), and persists through the passed storage seam
 * so game code never sees `localStorage` either.
 *
 * Pass the platform's own `storage` so the toggle lands under the same keys and
 * the same private-mode-safe try/catch as every other setting.
 */
export function createBrowserHaptics(storage: HapticsDeps['storage']): Haptics {
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return createHaptics({
    // Bind through a wrapper so `this` stays `navigator` and a throwing call
    // (some embeds gate the API) degrades to a no-op instead of a fatal.
    vibrate: canVibrate
      ? (pattern) => {
          try {
            navigator.vibrate(pattern);
          } catch {
            /* A blocked or throwing motor is never fatal — silently drop it. */
          }
        }
      : null,
    isHidden: () => typeof document !== 'undefined' && document.hidden,
    storage,
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  });
}
