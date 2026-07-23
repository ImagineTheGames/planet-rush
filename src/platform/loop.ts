/**
 * src/platform/loop.ts — the deterministic fixed-timestep game loop.
 * OWNER: Platform Engineer.
 *
 * 60 Hz simulation, fully decoupled from rendering (GDD §4.1): accumulate real
 * elapsed time, step the sim in fixed `FIXED_DT` increments, and render once per
 * animation frame with an interpolation factor. Fixing the sim step is what
 * makes the determinism replay test meaningful (GDD §4.8) — the sim advances the
 * same way regardless of the display's refresh rate.
 *
 * The core is {@link GameLoop.advance}, a pure accumulator that takes a real
 * frame's elapsed seconds and drives the callbacks. `start`/`stop` wrap it in
 * `requestAnimationFrame`; `advance` is DOM-free so the loop unit-tests headless.
 */

/** The fixed simulation timestep. 60 Hz — the one true tick (GDD §4.1). */
export const FIXED_DT = 1 / 60;

/**
 * Cap on the real time consumed by one frame. Without it, a long stall (a tab
 * backgrounded on mobile, a GC pause) would queue a burst of catch-up steps —
 * the "spiral of death." We drop that excess time instead (GDD §4.3 mobile).
 */
const MAX_FRAME_SECONDS = 0.25;

/** The two things the loop drives each real frame. */
export interface LoopCallbacks {
  /** Advance the sim exactly one fixed step. Called 0..n times per frame. */
  update(dt: number): void;
  /** Draw. `alpha` in [0, 1) is the fraction of a step past the last update,
   *  for interpolating render state between fixed ticks (GDD §4.1). */
  render(alpha: number): void;
}

/** Injected clock/scheduler seam so the loop is testable without a browser. */
export interface LoopHost {
  now(): number; // milliseconds
  requestFrame(cb: () => void): number;
  cancelFrame(handle: number): void;
}

/** The default host: `performance.now` + `requestAnimationFrame`. */
function browserHost(): LoopHost {
  return {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (h) => cancelAnimationFrame(h),
  };
}

export class GameLoop {
  private accumulator = 0;
  private lastMs = 0;
  private frameHandle = 0;
  private running = false;

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly step: number = FIXED_DT,
    private readonly host: LoopHost = browserHost(),
  ) {}

  /** Begin driving the loop off animation frames. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = this.host.now();
    this.accumulator = 0;
    const tick = (): void => {
      if (!this.running) return;
      const nowMs = this.host.now();
      const elapsed = (nowMs - this.lastMs) / 1000;
      this.lastMs = nowMs;
      this.advance(elapsed);
      this.frameHandle = this.host.requestFrame(tick);
    };
    this.frameHandle = this.host.requestFrame(tick);
  }

  /** Stop driving frames. The sim state is left where it is. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.host.cancelFrame(this.frameHandle);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Consume `frameSeconds` of real time: run as many fixed sim steps as have
   * accumulated, then render with the leftover fraction as the interpolation
   * alpha. Returns the number of sim steps taken (handy for tests). Pure w.r.t.
   * wall-clock — pass the elapsed time in, so a test can drive it deterministically.
   */
  advance(frameSeconds: number): number {
    // Clamp to avoid a catch-up spiral after a long stall.
    this.accumulator += Math.min(Math.max(frameSeconds, 0), MAX_FRAME_SECONDS);

    let steps = 0;
    while (this.accumulator >= this.step) {
      this.callbacks.update(this.step);
      this.accumulator -= this.step;
      steps++;
    }

    this.callbacks.render(this.accumulator / this.step);
    return steps;
  }
}
