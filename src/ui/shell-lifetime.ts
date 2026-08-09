/**
 * src/ui/shell-lifetime.ts — the latch that says a screen shell is GONE.
 * OWNER: UI Engineer.
 *
 * ---------------------------------------------------------------------------
 * Why this exists (u12-01)
 * ---------------------------------------------------------------------------
 * Every clean boot of the shipped client logged exactly one uncaught exception:
 *
 *     TypeError: Cannot read properties of null (reading 'clear')
 *         at Graphics._callContextMethod
 *         at Graphics.clear
 *         at LobbyEntryView.update   (src/ui/lobby-entry-view.ts:234)
 *         at render                  (src/main.ts, the menu shell)
 *         at measureFleet            (src/main.ts, the allocator probe)
 *
 * Read bottom-up, that stack is a whole bug in five frames. PLAY opens THE DOORS,
 * and opening them fires a fire-and-forget probe of the allocator fleet so CREATE
 * has a real ping behind its region by the time it is pressed. The player then
 * presses SOLO (or CREATE, or JOIN) before the network answers; the shell tears
 * down and `destroy({ children: true })` takes every Graphics with it. When the
 * probe finally lands, its continuation calls `render()` — and `render()` has no
 * idea the screen it draws no longer exists. `Graphics.destroy()` nulls the
 * context, so the first `clear()` of the next frame throws.
 *
 * The shell had no way to say "I am gone". It removed its DOM listeners and its
 * ticker callback in `teardown()`, which covers everything the *browser* calls —
 * but not the things already in flight that call *it*: a settled promise, a
 * `setTimeout`, a socket message. Those cannot be unsubscribed on the way out
 * (the session's `observe` hands back no unsubscribe, and a promise cannot be
 * un-awaited), so the only place the truth can live is a latch the shell owns and
 * its draw funnel reads.
 *
 * ---------------------------------------------------------------------------
 * The rule
 * ---------------------------------------------------------------------------
 * **A torn-down shell does not draw.** One latch per shell, flipped by
 * `teardown()` *before* it destroys anything, and read at the top of the shell's
 * single `render()`. Every late caller — however it got there — funnels through
 * that one line, so the next async seam somebody adds is covered by construction
 * rather than by remembering.
 *
 * This is deliberately NOT a null-guard inside the views. A view that quietly
 * tolerates being drawn after its own destruction hides the lifetime bug instead
 * of fixing it, and the next one — a stale ticker, a doubled shell — becomes
 * invisible rather than loud. The views stay sharp on purpose; the shells stop
 * calling them. See `./shell-lifetime.test.ts`, which holds both halves of that.
 */

/** A shell's own answer to "am I still on screen?". */
export interface ShellLifetime {
  /** True from construction until {@link ShellLifetime.dispose}. */
  readonly alive: boolean;
  /** Called by `teardown()` as its FIRST statement — before any `destroy()`. */
  dispose(): void;
}

/**
 * A fresh latch for one screen shell, alive until its `teardown()` disposes it.
 *
 * Idempotent: tearing a shell down twice is a no-op, which matters because the
 * doors can be closed by a press and by an authority message landing on the same
 * frame, and neither path knows about the other.
 */
export function createShellLifetime(): ShellLifetime {
  let alive = true;
  return {
    get alive(): boolean {
      return alive;
    },
    dispose(): void {
      alive = false;
    },
  };
}
