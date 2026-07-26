/**
 * src/ui/wheel-toggle.ts — the shared open/close transition for BOTH wheels.
 * OWNER: UI Engineer.
 *
 * ── WHY THIS FILE EXISTS (the field bug) ────────────────────────────────────
 * A developer reported: *"I managed to break the menu by opening and closing it
 * a few times, then it wouldn't open anymore."* That is the signature of a
 * transition state machine that **latches**: a guard raised while the wheel is
 * animating shut, that a re-open request in the same window cannot clear, so the
 * close finishes into a state that no longer accepts an open. The wheel is up in
 * the data model (the player is pressing BUILD) but the presentation refuses.
 *
 * The Build wheel and the (now radial) Upgrade wheel are the same component
 * family, so they must not each carry their own hand-rolled pop animation with
 * its own chance of this bug. They share **one** transition, here, and the fix is
 * structural rather than a patched guard:
 *
 * > The transition is a pure function of the *target* (open or closed, decided
 * > upstream every frame) and a clamped 0→1 progress. There is no "busy" flag to
 * > leave stuck: a re-open mid-close simply flips the target, and progress climbs
 * > back from wherever it was. No sequence of opens and closes — however fast —
 * > can reach a state that ignores the target, because the target is the only
 * > thing that decides direction and it is re-read every tick.
 *
 * Because it is pure and PixiJS-free it unit-tests headless (`wheel-toggle.test.ts`
 * mashes it 15× and asserts it always re-opens), which is the exact field bug
 * turned into a red-if-it-regresses test. The view multiplies its `scale`/`alpha`
 * by {@link WheelToggle.progress} to get the pop; nothing else in the view holds
 * open/close state, so the view cannot reintroduce the latch either.
 */

/** Seconds the wheel takes to pop fully open or fully shut. Short — the wheel is
 *  opened *at* your planet, so it is a confirmation flourish, not a wait. */
export const WHEEL_TRANSITION_SECONDS = 0.12;

/** Where the transition is right now. Derived from {@link WheelToggle.progress}
 *  and the target — never stored independently, so the two cannot disagree. */
export type WheelPhase = 'closed' | 'opening' | 'open' | 'closing';

/**
 * The shared open/close transition. One instance per drawn wheel; fed a boolean
 * *target* each frame (the pure model's `open`) and the frame's `dt`.
 *
 * The invariant the field bug violated, stated as code: `progress` moves toward
 * `1` while the target is open and toward `0` while it is closed, at a fixed
 * rate, clamped to `[0, 1]`. Everything else — visibility, interactivity, the
 * phase label — is *read off* that, so there is no second piece of state to fall
 * out of sync.
 */
export class WheelToggle {
  /** 0 = fully shut, 1 = fully open. The only stored state. */
  private _progress = 0;
  /** The target the last {@link update} was asked to move toward. */
  private _target = false;

  /** How far open the wheel is drawn, 0→1 — the view scales/fades by this. */
  get progress(): number {
    return this._progress;
  }

  /**
   * Whether the wheel is on screen at all. True for the whole transition,
   * including the tail of a close, so the pop-shut animation is actually seen;
   * false only once it has fully collapsed AND the player is no longer asking
   * for it — which is the honest "nothing is drawn" the layout registry records.
   */
  get visible(): boolean {
    return this._progress > 0 || this._target;
  }

  /**
   * Whether the wheel accepts input this frame. It is interactive the instant
   * the player asks for it (`target` open), not only once the pop finishes — a
   * wheel you cannot press until an animation ends is exactly the unresponsive
   * feel the field report describes. This is deliberately **not** gated on
   * `progress`, so there is no window where the wheel is up but dead.
   */
  get interactive(): boolean {
    return this._target;
  }

  get phase(): WheelPhase {
    if (this._target) return this._progress >= 1 ? 'open' : 'opening';
    return this._progress <= 0 ? 'closed' : 'closing';
  }

  /**
   * Advance the transition one frame toward `target`.
   *
   * @param target the wheel's desired open state this frame (the model's `open`).
   * @param dt seconds since the last frame; clamped so a backgrounded tab that
   *           returns with a huge `dt` snaps rather than misbehaving.
   */
  update(target: boolean, dt: number): void {
    this._target = target;
    // A non-finite or negative dt must never move progress the wrong way; a huge
    // dt (tab was backgrounded) should snap, which the clamp+step below do.
    const step = Number.isFinite(dt) && dt > 0 ? dt / WHEEL_TRANSITION_SECONDS : 0;
    const dir = target ? step : -step;
    this._progress = clamp01(this._progress + dir);
  }

  /**
   * Force the wheel fully shut *now* — no animation. For a hard context change
   * (rematch, undock, ship death) where the wheel should just be gone, not seen
   * sliding away. Still leaves the machine in a clean, re-openable state, because
   * it only writes the same two fields `update` does.
   */
  reset(): void {
    this._progress = 0;
    this._target = false;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
