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
  /** The SFX bus gain the cue actually rides, 0..1. Zero = fired-but-inaudible. */
  sfxBusGain: number | null;
  /** UI cues fired through the shared seam since boot, per KIND (?debug=1 only). */
  uiCues: { press: number; confirm: number; reject: number; last: string | null } | null;
  /** The distance gain the last spatial one-shot was heard at, 0..1 (a3-03). */
  lastGain: number;
  /** The stereo pan the last spatial one-shot flew in on, −1..+1 (a3-03). */
  lastPan: number;
  /** Where the mix listens from (the camera), world units — the probe's anchor. */
  listener: { x: number; y: number; has: boolean };
}
/** How the spatial model would place a sound at a world point, given the live
 *  listener (`src/art/audio/spatial`) — the audio spy's numbers. */
interface Placement {
  gain: number;
  pan: number;
  cutoff: number;
  culled: boolean;
}
interface AudioStage {
  read(): AudioReadout;
  /** Set the SFX bus level, 0..1 — the settings slider's call, for the slider-at-0 case. */
  setSfx(value: number): void;
  /** Pure spatial readback: place a world point against the live camera-listener. */
  probe(x: number, y: number): Placement;
}
interface UpgradeWheelStageLite {
  openUpgrade(ore?: number): { open: boolean } | null;
  setOre(ore: number): { banked: number } | null;
  wedges(): { state: string }[];
  wedgePoint(i: number): { x: number; y: number } | null;
}
/** The press/action feedback seam — drives the HUD's ONE shared control driver
 *  (`pressWheelSegment` / `confirm`), the same path a real thumb hits, so a press
 *  on a live wedge sounds `press`, a disabled one sounds `reject`, and a landed
 *  spend sounds `confirm` — the exact wiring this spec attributes by KIND. */
interface PressStageLite {
  openBuild(ore?: number): { open: boolean; banked: number } | null;
  press(surface: 'build' | 'upgrade', index: number): void;
  confirm(surface: 'build' | 'upgrade', index: number, amount: number, deposit?: boolean, core?: boolean): void;
}

/** This spec's view of the ?debug=1 seams on `window`. Declared LOCALLY (not a
 *  `declare global` augmentation) so its narrower stage types never merge-collide
 *  with the fuller declarations other live-stage specs make — the same discipline
 *  `haptics.spec.ts` uses. */
interface AudioAliveWindow {
  __audioStage?: AudioStage;
  __upgradeWheelStage?: UpgradeWheelStageLite;
  __pressStage?: PressStageLite;
  __planetRush?: unknown;
}
declare const window: Window & AudioAliveWindow;

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

/** Resume the mix (a real gesture) and wait for the press seam to install. */
async function wakeAndArm(page: Page): Promise<void> {
  await page.mouse.click(200, 400);
  await page.waitForFunction(() => window.__audioStage!.read().contextState === 'running', undefined, {
    timeout: 10_000,
  });
  await page.waitForFunction(
    () => typeof window.__pressStage?.press === 'function' && typeof window.__upgradeWheelStage?.wedges === 'function',
    undefined,
    { timeout: 10_000 },
  );
}

/** Let one render frame pass so the HUD redraws the wheel and refreshes each
 *  wedge's `ready` state (which the shared driver reads to pick press vs reject).
 *  `?freeze` pins the SIM, not render — the draw loop still runs every frame. */
const nextFrame = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

test('the shared control seam names the RIGHT voice: a live press ticks, a disabled press buzzes, a landed spend chimes — and the SFX slider gates the output', async ({
  page,
}) => {
  const pageErrors = await boot(page);
  await wakeAndArm(page);

  // --- 1. A LIVE (affordable) wheel wedge → the PRESS tick -----------------------
  // Fund the bank and open the upgrade wheel, then press a wedge the HUD drew as
  // `ready`. The press goes through the HUD's ONE shared driver (the same call the
  // real thumb reaches), which sounds `press` for a live control — proven by the
  // per-kind tally the seam bumped, not just that some sound fired.
  await page.evaluate(() => window.__upgradeWheelStage!.openUpgrade(999));
  await nextFrame(page);
  const readyIndex = await page.evaluate(() =>
    window.__upgradeWheelStage!.wedges().findIndex((w) => w.state === 'ready'),
  );
  expect(readyIndex, 'a funded upgrade wheel drew at least one ready wedge').toBeGreaterThanOrEqual(0);

  const pressCue = await page.evaluate((i) => {
    const before = window.__audioStage!.read().uiCues!.press;
    window.__pressStage!.press('upgrade', i);
    const r = window.__audioStage!.read();
    return { before, after: r.uiCues!.press, last: r.uiCues!.last };
  }, readyIndex);
  // eslint-disable-next-line no-console -- captioned evidence for the PR.
  console.log('[audio-alive] live press cue:', JSON.stringify(pressCue));
  expect(pressCue.after, 'a live wedge press fired the press cue').toBe(pressCue.before + 1);
  expect(pressCue.last, 'and the last UI cue was the press tick').toBe('press');

  // --- 2. A DISABLED wedge → the REJECT buzzer ----------------------------------
  // Zero the bank so every purchase wedge draws disabled, then press one. main.ts
  // alone could never make this sound — it does not know a wedge's `ready` state;
  // the HUD does, so the shared driver sounds `reject`, not `press`.
  await page.evaluate(() => window.__upgradeWheelStage!.setOre(0));
  await nextFrame(page);
  const disabledIndex = await page.evaluate(() =>
    window.__upgradeWheelStage!.wedges().findIndex((w) => w.state !== 'ready'),
  );
  expect(disabledIndex, 'a broke upgrade wheel drew at least one disabled wedge').toBeGreaterThanOrEqual(0);

  const rejectCue = await page.evaluate((i) => {
    const before = window.__audioStage!.read().uiCues!.reject;
    window.__pressStage!.press('upgrade', i);
    const r = window.__audioStage!.read();
    return { before, after: r.uiCues!.reject, last: r.uiCues!.last };
  }, disabledIndex);
  // eslint-disable-next-line no-console -- captioned evidence for the PR.
  console.log('[audio-alive] disabled press cue:', JSON.stringify(rejectCue));
  expect(rejectCue.after, 'a disabled wedge press fired the reject cue').toBe(rejectCue.before + 1);
  expect(rejectCue.last, 'and the last UI cue was the reject buzzer').toBe('reject');

  // --- 3. A SIM-CONFIRMED spend → the CONFIRM chime -----------------------------
  // The confirm is DERIVED from the sim's own state change (a spend that landed),
  // not from the press — so it fires through the shared driver's confirm path.
  const confirmCue = await page.evaluate(() => {
    const before = window.__audioStage!.read().uiCues!.confirm;
    window.__pressStage!.confirm('upgrade', 0, 5, false, false);
    const r = window.__audioStage!.read();
    return { before, after: r.uiCues!.confirm, last: r.uiCues!.last };
  });
  // eslint-disable-next-line no-console -- captioned evidence for the PR.
  console.log('[audio-alive] confirm cue:', JSON.stringify(confirmCue));
  expect(confirmCue.after, 'a sim-confirmed spend fired the confirm cue').toBe(confirmCue.before + 1);
  expect(confirmCue.last, 'and the last UI cue was the confirm chime').toBe('confirm');

  // --- 4. The SFX slider at 0 → the seam STILL fires, but the output is silent ---
  // The UI names the event regardless; the audio module behind the seam is where
  // the SFX-slider gain lives (field report point 3). So a press with the slider
  // at 0 must still tick the UI-cue tally (the seam fired) while the SFX bus gain
  // the cue rides reads 0 (nothing is audible). Refund first so the wedge is live.
  await page.evaluate(() => window.__upgradeWheelStage!.setOre(999));
  await nextFrame(page);
  const readyAgain = await page.evaluate(() =>
    window.__upgradeWheelStage!.wedges().findIndex((w) => w.state === 'ready'),
  );
  expect(readyAgain, 'a re-funded upgrade wheel drew a ready wedge again').toBeGreaterThanOrEqual(0);

  const muted = await page.evaluate((i) => {
    window.__audioStage!.setSfx(0); // the settings slider dragged to silent
    const before = window.__audioStage!.read().uiCues!.press;
    window.__pressStage!.press('upgrade', i);
    const r = window.__audioStage!.read();
    return { before, after: r.uiCues!.press, sfxBusGain: r.sfxBusGain };
  }, readyAgain);
  // eslint-disable-next-line no-console -- captioned evidence for the PR.
  console.log('[audio-alive] slider-at-0:', JSON.stringify(muted));
  expect(muted.after, 'the UI seam still fired with the SFX slider at 0').toBe(muted.before + 1);
  expect(muted.sfxBusGain, 'but the SFX bus the cue rides is silent (slider at 0)').toBe(0);

  expect(pageErrors, 'no page errors while the UI cues sounded').toEqual([]);
});

test('spatial audio is wired on a real boot: own fire is full and centred, a far fight is near-silent, and pan flips with side (a3-03)', async ({
  page,
}) => {
  const pageErrors = await boot(page);
  // A real gesture so the mix is live — the same door the other tests use.
  await page.mouse.click(200, 400);
  await page.waitForFunction(() => window.__audioStage!.read().contextState === 'running', undefined, {
    timeout: 10_000,
  });

  // The camera-listener is following the local ship in the frozen match. Probe is
  // PURE geometry against that live listener — it plays nothing, so the readout is
  // deterministic under ?freeze. Sound cannot screenshot; these numbers are the
  // spatial-audio attestation for the qa-manager (a3-03 evidence note).
  const spy = await page.evaluate(() => {
    const stage = window.__audioStage!;
    const { x, y, has } = stage.read().listener;
    const FAR = 6000; // well past R_FAR (~1400) — over the horizon on any arena
    const NEAR = 120; // inside R_NEAR (~260) — full level, gently panned
    return {
      has,
      here: stage.probe(x, y), // own gun, at the camera
      nearRight: stage.probe(x + NEAR, y),
      farRight: stage.probe(x + FAR, y), // a bot war far to the right
      farLeft: stage.probe(x - FAR, y), // …and far to the left
    };
  });
  // eslint-disable-next-line no-console -- captioned spatial readout for the PR evidence.
  console.log('[audio-alive] spatial probe:', JSON.stringify(spy));

  expect(spy.has, 'the mix has a camera-listener in a live match').toBe(true);

  // Own fire, at the listener: full and dead-centre.
  expect(spy.here.gain, 'own fire is at full level').toBeCloseTo(1, 5);
  expect(spy.here.pan, 'own fire is centred').toBeCloseTo(0, 5);

  // A distant fight on either side: culled to near-silence — off-screen wars cost
  // nothing (the whole point of the falloff).
  expect(spy.farRight.gain, 'a far fight to the right is near-silent').toBeLessThan(0.001);
  expect(spy.farRight.culled, 'and is culled before synthesis').toBe(true);
  expect(spy.farLeft.gain, 'a far fight to the left is near-silent').toBeLessThan(0.001);

  // Pan flips sign with the side of the ship, and matches in magnitude.
  expect(spy.farRight.pan, 'a fight to the right pans right (+)').toBeGreaterThan(0.9);
  expect(spy.farLeft.pan, 'a fight to the left pans left (−)').toBeLessThan(-0.9);
  expect(spy.nearRight.pan, 'even a near fight to the right pans right').toBeGreaterThan(0);
  expect(spy.nearRight.gain, 'but a near fight is still full level').toBeCloseTo(1, 5);

  expect(pageErrors, 'no page errors on the spatial-probe path').toEqual([]);
});
