/**
 * src/ui/shell-lifetime.test.ts — the one uncaught exception on every clean boot
 * (u12-01), reproduced without a browser, and the latch that stops it.
 *
 * QA found it on the live build at `7e175ac`: six of six clean-boot captures
 * logged exactly one uncaught exception from the served bundle, and the stack in
 * `evidence/a1-05-live-round/readback.json` resolves through the sourcemap to
 *
 *     TypeError: Cannot read properties of null (reading 'clear')
 *         at Graphics._callContextMethod
 *         at Graphics.clear
 *         at LobbyEntryView.update   src/ui/lobby-entry-view.ts:234
 *         at render                  src/main.ts, the menu shell's draw funnel
 *         at measureFleet            src/main.ts, the allocator fleet probe
 *
 * The mechanism is a lifetime, not a draw: PLAY opens THE DOORS and fires a
 * fire-and-forget probe of the allocator; SOLO tears the shell down and destroys
 * every Graphics on it; the probe answers late and calls `render()` into the
 * wreckage.
 *
 * ── What these tests are, exactly ─────────────────────────────────────────────
 *
 * `src/main.ts` ends in `void boot()`, so it cannot be imported — the house
 * pattern for anything inside it is to extract the seam and test that (see
 * `src/platform/match-boot.test.ts`). So this file holds the seam,
 * {@link createShellLifetime}, against a shell built the way the menu shell is
 * built: real Pixi children, a `render()` that draws them, a `teardown()` that
 * calls `destroy({ children: true })`, and one async continuation still in
 * flight across the teardown.
 *
 * The Graphics are real, and so is the failure — test 1 asserts the *identical*
 * TypeError, from the identical Pixi frame, that the shipped bundle threw. That
 * is what makes test 2 mean something: the latch is not decoration, it is the
 * only thing standing between the late continuation and a live crash.
 *
 * A full `LobbyEntryView` cannot be built here — it measures `Text`, and there is
 * no DOM in this suite (no jsdom; `src/render/stations.test.ts` is headless for
 * the same reason). `backdrop` is a plain `Graphics` and `clear()` is the first
 * thing `update()` calls, so the primitive at the bottom of the production stack
 * is exactly the primitive under test.
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { createShellLifetime } from './shell-lifetime';

/**
 * A screen shell with the menu shell's shape, in miniature: a view it owns and
 * destroys, a draw funnel every path goes through, and a teardown that is the
 * only thing that ever destroys anything.
 *
 * `guarded` is the fix under test, and nothing else differs between the two
 * builds — so a difference in behaviour is the latch and can be nothing else.
 */
function makeShell(guarded: boolean) {
  const life = createShellLifetime();
  const root = new Container();
  /** Stands in for `LobbyEntryView`, whose `backdrop` is the Graphics that threw. */
  const view = new Container();
  const backdrop = new Graphics();
  view.addChild(backdrop);
  root.addChild(view);

  let draws = 0;

  /** The menu shell's `render()`: the one funnel every caller reaches the views through. */
  function render(notice: string): void {
    if (guarded && !life.alive) return; // u12-01 — a torn-down shell does not draw
    draws++;
    backdrop.clear();
    backdrop.rect(0, 0, 960, 540).fill({ color: 0x05070c, alpha: 1 });
    // The doors' message slot is what the fleet probe actually writes; it is here
    // so the model genuinely changes across the teardown, exactly as it does in
    // production, where an unchanged model would have been swallowed by the
    // view's own `./screen-cache` before it ever reached `clear()`.
    backdrop.label = notice;
  }

  /** The menu shell's `teardown()` — `beginSolo` / `beginRoom` call this. */
  function teardown(): void {
    life.dispose(); // FIRST, before anything is destroyed
    root.removeChild(view);
    view.destroy({ children: true });
  }

  return { render, teardown, drawCount: () => draws, isAlive: () => life.alive };
}

/** What the live client threw, character for character, from `readback.json`. */
const LIVE_ERROR = "Cannot read properties of null (reading 'clear')";

describe('a shell torn down while an async continuation is in flight (u12-01)', () => {
  it('throws the live clean-boot TypeError when the draw funnel is unguarded', async () => {
    const shell = makeShell(false);
    shell.render('');

    // The allocator probe, still in flight when the player presses SOLO.
    const probe = Promise.resolve().then(() => shell.render('GRU 38ms'));
    shell.teardown();

    // This is the shipped behaviour at 7e175ac: one uncaught exception, once,
    // out of an update running past a teardown.
    await expect(probe).rejects.toThrow(TypeError);
    await expect(probe).rejects.toThrow(LIVE_ERROR);
  });

  it('is inert once the latch is disposed — nothing draws after teardown', async () => {
    const shell = makeShell(true);
    shell.render('');
    expect(shell.drawCount()).toBe(1);

    const probe = Promise.resolve().then(() => shell.render('GRU 38ms'));
    shell.teardown();

    await expect(probe).resolves.toBeUndefined();
    // Not "it survived the draw" — it never drew. The frame after a teardown
    // belongs to nobody, and the shell does not paint into it.
    expect(shell.drawCount()).toBe(1);
    expect(shell.isAlive()).toBe(false);
  });

  it('covers a late caller of any kind, not just the one QA caught', async () => {
    // The probe is the seam that threw, but it is not the only one that outlives
    // a shell: the lobby's `session.observe` hands back no unsubscribe, and a
    // long-press `setTimeout` can land after the screen is gone. They all reach
    // the views through `render()`, so one latch answers all of them.
    const shell = makeShell(true);
    shell.teardown();
    const late = [
      () => shell.render('a settled promise'),
      () => shell.render('a socket message'),
      () => shell.render('a fired timer'),
    ];
    for (const call of late) expect(call).not.toThrow();
    expect(shell.drawCount()).toBe(0);
  });
});

describe('the latch itself', () => {
  it('is alive until disposed, and disposing twice is a no-op', () => {
    const life = createShellLifetime();
    expect(life.alive).toBe(true);
    life.dispose();
    expect(life.alive).toBe(false);
    // The doors can be closed by a press and by an authority message on the same
    // frame; neither path knows about the other, so both must be safe.
    life.dispose();
    expect(life.alive).toBe(false);
  });

  it('gives each shell its own latch', () => {
    const menu = createShellLifetime();
    const lobby = createShellLifetime();
    menu.dispose();
    expect(menu.alive).toBe(false);
    expect(lobby.alive).toBe(true);
  });
});

describe('the views stay sharp on purpose', () => {
  it('a destroyed Graphics still throws — the fix is the shell, not a null-guard', () => {
    // If a future change makes views tolerate being drawn after destruction, the
    // NEXT lifetime bug stops being a log line and starts being invisible. This
    // assertion is here to fail loudly if that tolerance is ever added.
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    root.destroy({ children: true });
    expect(() => g.clear()).toThrow(LIVE_ERROR);
  });
});
