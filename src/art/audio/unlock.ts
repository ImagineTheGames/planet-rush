/**
 * src/art/audio/unlock.ts — the first gesture. OWNER: Art & Audio Agent.
 *
 * GDD risk 7, named in the document before a line of it was written:
 *
 * > **Mobile browser quirks.** *"Audio unlock requires a user gesture,
 * > fullscreen API behaves differently across mobile browsers, and Safari
 * > enforces tight WebGL memory limits — any of which can **silently break a
 * > build that only tested on desktop**."*
 *
 * Silently is the word that matters. A game with no sound looks exactly like a
 * game whose sound is working, right up until someone plays it on a phone. So
 * the unlock is a small class with a test rather than three lines in a bootstrap
 * file, and it does the two things that are actually required — not one:
 *
 *  1. **Resume the context.** Every browser starts it `suspended` until a
 *     gesture. `resume()` is necessary.
 *  2. **Start a source inside the gesture.** On iOS Safari, `resume()` alone is
 *     not sufficient: the context stays effectively muted until a buffer source
 *     has been started from within a real user-gesture task. So a one-sample
 *     silent buffer is played, which costs nothing and is the difference between
 *     working and not on a large fraction of the devices this ships to.
 *
 * It also **re-arms**. Phones lock, browsers background tabs, and iOS suspends
 * the context when it does — the same reality that earns mobile a reconnect
 * grace in the netcode (GDD §4.2). A one-shot unlock leaves a player who
 * answered a phone call with a silent game for the rest of the match, so
 * {@link AudioUnlock} re-attaches its listeners whenever the context is found
 * suspended again.
 *
 * Nothing here names `window` or `document`: the listener target is injected
 * (`../audio/context` takes the same approach to `AudioContext`), which is what
 * lets the whole thing test headless.
 */

import type { AudioContextLike } from './context';

/** The slice of `EventTarget` the unlock uses. `window` and `document` fit. */
export interface UnlockTarget {
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  removeEventListener(type: string, listener: () => void, options?: unknown): void;
}

/**
 * Gestures that count. Deliberately broad: touch, mouse, pen, keyboard and
 * gamepad-adjacent all reach the game (GDD §2.4), and the *first* one a player
 * makes is the only one that matters.
 */
export const UNLOCK_EVENTS: readonly string[] = [
  'pointerdown',
  'touchend',
  'mousedown',
  'keydown',
  'click',
];

/** Options for {@link AudioUnlock}. */
export interface UnlockOptions {
  /** Events to listen for. Defaults to {@link UNLOCK_EVENTS}. */
  readonly events?: readonly string[];
  /** Called once, after the first successful unlock. Preload the bank here. */
  readonly onUnlock?: () => void;
}

/**
 * Waits for a user gesture, then wakes the audio context.
 *
 * ```ts
 * const unlock = new AudioUnlock(ctx, globalThis as unknown as UnlockTarget, {
 *   onUnlock: () => graph.preload(),
 * });
 * unlock.arm();
 * ```
 */
export class AudioUnlock {
  private readonly events: readonly string[];
  private readonly onUnlock: (() => void) | undefined;
  private readonly listener: () => void;
  private armed = false;
  private done = false;
  private attempts = 0;

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly target: UnlockTarget,
    options: UnlockOptions = {},
  ) {
    this.events = options.events ?? UNLOCK_EVENTS;
    this.onUnlock = options.onUnlock;
    // One bound listener for every event type, so detaching is exact.
    this.listener = () => {
      void this.unlockNow();
    };
  }

  /** True once the context has been resumed by a gesture at least once. */
  get unlocked(): boolean {
    return this.done;
  }

  /** True while listeners are attached. */
  get listening(): boolean {
    return this.armed;
  }

  /** Gestures that have tried to unlock. Debug, and the test's eye. */
  get gestures(): number {
    return this.attempts;
  }

  /** Attach the gesture listeners. Idempotent. */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    for (const event of this.events) {
      this.target.addEventListener(event, this.listener, { passive: true });
    }
  }

  /** Detach them. Idempotent. */
  disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    for (const event of this.events) {
      this.target.removeEventListener(event, this.listener);
    }
  }

  /**
   * Unlock right now. Safe to call from inside a gesture handler the game owns
   * (a Start button, the pause menu's resume) as well as from the listeners.
   *
   * Never throws: a browser that refuses costs the player sound and nothing
   * else — every audible tell has a visible twin by construction (GDD §3.6).
   */
  async unlockNow(): Promise<boolean> {
    this.attempts++;
    this.poke();
    try {
      await this.ctx.resume();
    } catch {
      return false;
    }
    if (this.ctx.state === 'suspended') return false;
    this.disarm();
    if (!this.done) {
      this.done = true;
      this.onUnlock?.();
    }
    return true;
  }

  /**
   * Re-arm if the context has gone back to sleep — call on visibility change,
   * or once a second from the frame loop; both are cheap.
   */
  recheck(): void {
    if (this.ctx.state === 'suspended') this.arm();
  }

  /**
   * Start and immediately stop a one-sample silent buffer.
   *
   * This is the iOS Safari half of the unlock (see the module doc). It has to
   * happen *inside* the gesture task, which is why it runs before the `await` on
   * `resume()` rather than after it — an await would put it in a later task and
   * the browser would no longer count it as user-initiated.
   */
  private poke(): void {
    try {
      const buffer = this.ctx.createBuffer(1, 1, Math.max(3000, this.ctx.sampleRate));
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);
      source.stop(this.ctx.currentTime + 0.001);
    } catch {
      // Some engines refuse a 1-frame buffer. The resume() below still helps.
    }
  }
}

/**
 * `globalThis` as an {@link UnlockTarget}, or `null` where there is no event
 * target at all — Node, the match server, the QA harness (GDD §4.1).
 */
export function defaultUnlockTarget(): UnlockTarget | null {
  const g = globalThis as Partial<UnlockTarget>;
  return typeof g.addEventListener === 'function' && typeof g.removeEventListener === 'function'
    ? (g as UnlockTarget)
    : null;
}
