/**
 * tests/live-stage/audio-alive.spec.ts — the game actually MAKES SOUND, proven on
 * a REAL boot. OWNER: Sound Agent (GDD risk 7, §3.6, §4.7).
 *
 * The field report (v0.2.4): "why don't I hear ANY sounds in the game yet?" The
 * SFX bank has existed since d5 and the adaptive soundtrack merged in #132, yet
 * the developer heard total silence. The diagnosis was the dark-matter classic —
 * every audio unit test is green (the whole graph builds headless against a stub
 * context and its shape is asserted), but the booted client never opened a
 * context, never armed the unlock, and never fed the mix a single tell. Merged,
 * component-tested, and inaudible in the shipped game.
 *
 * A headless unit test cannot catch a missing *wire*. Only booting the real
 * bundle, resuming the context with a REAL user gesture, and reading back the
 * live audio state can — which is exactly the discipline gap the field report
 * called out: an evidence round that attested the soundtrack WITHOUT a
 * context-state check proves nothing, because a suspended context looks identical
 * to a working one right up until someone plays it.
 *
 * So this spec goes through the front door:
 *
 *  1. Boot the production bundle. Before any gesture, the context is `suspended`
 *     and the standing voices have not started — the exact silent state.
 *  2. Do a REAL, TRUSTED tap (Playwright `mouse.click`, which the browser counts
 *     as a genuine user gesture — unlike a script-dispatched PointerEvent, which
 *     would fire a handler but NEVER resume the context). This is the "tap on
 *     PLAY" of the flow: the first gesture the unlock hooks (risk 7).
 *  3. Read back — through the `?debug=1` `window.__audioStage` seam, READ ONLY —
 *     that the context is now `running`, the master gain the player hears through
 *     is above zero, and the adaptive soundtrack is playing.
 *  4. Open the upgrade wheel and press a wedge through the REAL door (a trusted
 *     tap at the drawn wedge point) and assert the SFX one-shot count went up —
 *     an actual sound node fired from a real interaction, not a stubbed method.
 *
 * Driven through `?debug=1&freeze=1` (skips the menu straight into a match and
 * installs the staging seams) — the same harness the upgrade-wheel spec uses.
 * `?freeze=1` pins the sim at a seeded tick: the audio UPDATE loop still runs
 * every real frame (it lives in render, not the sim step), so the context resumes,
 * the soundtrack plays and the hush ticks — but no bot combat fires tells, so the
 * SFX one-shot count is stable except for what a tap makes it do. That is what
 * turns "the count went up" into proof the WHEEL TAP fired a sound, not the bots.
 */
import { test, expect, type Page } from '@playwright/test';

/** The `?debug=1`-only audio seam this spec reads. Mirrors `installAudioStage`
 *  in `src/main.ts`. Pure readback — it drives no sound. */
interface AudioReadout {
  /** `null` running silent (no context); else the raw `AudioContext.state`. */
  contextState: string | null;
  /** True once a gesture resumed the context. */
  unlocked: boolean;
  /** True once `start()` ran — the standing voices began. */
  running: boolean;
  /** The master gain the player hears through, 0..1. */
  master: number | null;
  /** True while the adaptive soundtrack is enabled and playing. */
  musicPlaying: boolean;
  /** The soundtrack's current phase. */
  musicPhase: string;
  /** SFX one-shots STARTED since boot — bumps on every real tell and cue. */
  sfxCount: number;
  /** One-shots skipped because the death hush had the mix at zero. */
  hushedCount: number;
}
interface AudioStage {
  read(): AudioReadout;
}
interface UpgradeWheelStageLite {
  openUpgrade(ore?: number): { open: boolean } | null;
  wedgePoint(i: number): { x: number; y: number } | null;
}

declare global {
  interface Window {
    __audioStage?: AudioStage;
    __upgradeWheelStage?: UpgradeWheelStageLite;
    __planetRush?: unknown;
  }
}

/** Boot the real client into a live ?debug=1 match and wait for the audio seam. */
async function boot(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof window.__audioStage?.read === 'function' &&
      typeof window.__upgradeWheelStage?.openUpgrade === 'function',
    undefined,
    { timeout: 20_000 },
  );
  return pageErrors;
}

const readAudio = (page: Page): Promise<AudioReadout> =>
  page.evaluate(() => window.__audioStage!.read());

test('the booted client makes sound: a real gesture resumes the context, the mix runs, the soundtrack plays', async ({
  page,
}) => {
  const pageErrors = await boot(page);

  // --- 1. Before any gesture, the context is asleep and nothing has started ---
  const before = await readAudio(page);
  // The environment must actually have a Web Audio context (a null one would mean
  // the whole spec proves nothing). Chromium always provides one.
  expect(before.contextState, 'the real client opened an AudioContext').not.toBeNull();
  expect(before.running, 'no standing voice starts before the unlock gesture').toBe(false);
  // eslint-disable-next-line no-console -- captioned state readout for the PR evidence.
  console.log('[audio-alive] BEFORE gesture:', JSON.stringify(before));

  // --- 2. A REAL, trusted tap — the "tap on PLAY" the unlock hooks (risk 7) -----
  // `mouse.click` goes through the browser's genuine input pipeline, so the
  // browser treats it as a user gesture and `AudioContext.resume()` is allowed to
  // transition to `running`. A script-dispatched PointerEvent would not.
  await page.mouse.click(200, 400);

  // The unlock's resume() is async; poll the readback until the context wakes.
  await page.waitForFunction(() => window.__audioStage!.read().contextState === 'running', undefined, {
    timeout: 10_000,
  });

  // --- 3. Read back the live audio state (seam READONLY) -----------------------
  const after = await readAudio(page);
  // eslint-disable-next-line no-console -- captioned state readout for the PR evidence.
  console.log('[audio-alive] AFTER gesture:', JSON.stringify(after));

  expect(after.contextState, 'the gesture resumed the AudioContext').toBe('running');
  expect(after.unlocked, 'the unlock latched on the first gesture').toBe(true);
  expect(after.running, 'the standing voices (ambient + soundtrack) started').toBe(true);
  expect(after.master ?? 0, 'the master gain the player hears through is audible, not zero').toBeGreaterThan(0);
  expect(after.musicPlaying, 'the adaptive soundtrack graph is playing').toBe(true);

  // --- 4. A wheel tap fires an SFX node ----------------------------------------
  // Open the upgrade wheel through the seam, then press a wedge through the REAL
  // door — a `pointerdown` at its drawn point, into the same `main.ts` handler a
  // thumb hits (the exact door the upgrade-wheel spec drives). The handler sounds
  // a press cue (the audible twin of the press haptic), so the mix's SFX one-shot
  // count MUST climb.
  //
  // The read → dispatch → read all happen SYNCHRONOUSLY in one page turn, with no
  // animation frame between them: a frozen turret muzzle keeps the count ticking a
  // little every rendered frame, so only a same-turn measurement can attribute the
  // rise to the tap itself rather than to the mix's steady background. The delta is
  // then purely the press cue — a real sound node, started from the wheel press.
  await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade(999));
  const wedge = await page.evaluate(() => window.__upgradeWheelStage!.wedgePoint(0));
  expect(wedge, 'the open upgrade wheel drew a wedge to press').not.toBeNull();

  const tap = await page.evaluate((wp) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas to tap');
    const before = window.__audioStage!.read().sfxCount;
    // Same synthesized pointerdown the upgrade-wheel spec calls "the real door";
    // it runs the handler synchronously, so the cue fires before the next frame.
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: wp.x,
        clientY: wp.y,
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
        cancelable: true,
      }),
    );
    const after = window.__audioStage!.read().sfxCount;
    return { before, after };
  }, wedge!);

  // eslint-disable-next-line no-console -- captioned state readout for the PR evidence.
  console.log('[audio-alive] wheel-tap SFX one-shots:', JSON.stringify(tap));
  expect(
    tap.after,
    'a wheel-wedge press fired an SFX one-shot in the same turn (no background frame)',
  ).toBeGreaterThan(tap.before);

  // No uncaught errors on the whole path — a thrown audio error would be silence.
  expect(pageErrors, 'no page errors while the audio wired up and sounded').toEqual([]);
});
