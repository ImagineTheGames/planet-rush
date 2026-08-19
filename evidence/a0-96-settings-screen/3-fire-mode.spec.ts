/**
 * evidence/a0-96-settings-screen/3-fire-mode.spec.ts — FIRE MODE's chip under Tap
 * Commander: a control that responds and changes nothing. OWNER: QA Manager (a0-96).
 *
 * `docs/settings.md` mismatch 1 says the row is inert on the default control
 * scheme. This capture does not repeat that claim; it photographs the screen and
 * lets the frames say what they say.
 *
 * The trick is to make "the match looks the same" MEASURABLE, and `?debug=1&freeze=1`
 * is what makes it so: the sim is advanced to a fixed seeded tick and pinned
 * there, so the match frame is byte-deterministic and the ONLY thing that can
 * differ between two shots of it is something the capture did in between.
 *
 * Four frames and two numbers, per profile:
 *
 *   A  the match, at the frozen tick, CONTROLS = TAP COMMANDER, chip = AUTO-AIM
 *   A' the same frame again with NOTHING touched in between — the null. Without
 *      it, "0 pixels differ" is a claim about the renderer, not about the toggle.
 *   B  the chip after one press: MANUAL
 *   C  the match again, same frozen tick, chip now MANUAL
 *
 * Then A vs A' (must be 0 for the measurement to mean anything) and A vs C.
 *
 * AND A CONTROL FOR THE MEASUREMENT ITSELF: the same toggle is then pressed with
 * CONTROLS on the sticks scheme, where the row is supposed to be live. If that
 * pair also differs by 0 px, the method is blind and the whole plate is worthless.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { settleFrames } from '../../tests/mobile/render-settle';
import { PROFILES } from './profiles';
import { openPauseSettings, park, pressPause } from './drive';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');

/** Pixels that differ between two frames, and the largest channel gap among them.
 *  Plain and unweighted: a claim of "nothing moved" should not be resting on a
 *  tolerance somebody chose. */
function diff(a: Buffer, b: Buffer): { pixels: number; peak: number; total: number } {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    throw new Error(`frame sizes differ: ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`);
  }
  let pixels = 0;
  let peak = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(pa.data[i + c]! - pb.data[i + c]!));
    if (d > 0) {
      pixels++;
      peak = Math.max(peak, d);
    }
  }
  return { pixels, peak, total: pa.width * pa.height };
}

/**
 * Back out of the pause SETTINGS screen to the running match, with two real ESC
 * presses (settings → menu → closed; `src/main.ts` `handlePauseKey`).
 *
 * This capture originally pressed DONE and then RESUME at the points the client
 * reports drawing them, the way every other press in this directory is made. It
 * could not: the press at DONE's own centre never reached DONE, on either
 * profile, and the screen stayed up until the run timed out. That is not a
 * detail of this harness — it is the finding
 * `a0-96-pause-done-is-covered-and-unreachable` in the manifest, photographed and
 * probed separately in `4-done-reach.spec.ts`. ESC is used here so that the FIRE
 * MODE frames are about FIRE MODE and not about the exit.
 */
async function leavePause(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__pauseStage!.read().screen === 'menu', undefined, { timeout: 20_000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__pauseStage!.read().open === false, undefined, { timeout: 20_000 });
}

for (const profile of PROFILES) {
  test(`a0-96 fire mode inertness — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    mkdirSync(SHOTS, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    const shot = (name: string): Promise<Buffer> =>
      page.screenshot({ path: join(SHOTS, `${profile.id}-${name}.png`) });

    await page.goto('/?debug=1&freeze=1');
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, { timeout: 30_000 });
    await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
    await settleFrames(page, 12);
    await park(page);

    const frameA = await shot('fire-match-tap-autoaim');
    await settleFrames(page, 12);
    const frameNull = await shot('fire-match-tap-autoaim-again');

    // One press on FIRE MODE, photographed either side of itself.
    await openPauseSettings(page, profile.touch);
    await shot('fire-chip-tap-autoaim');
    await pressPause(page, 'fireMode', profile.touch);
    await shot('fire-chip-tap-manual');
    await leavePause(page);
    await settleFrames(page, 12);
    await park(page);
    const frameC = await shot('fire-match-tap-manual');

    // The control: the same row, on the scheme where it is meant to be live.
    await openPauseSettings(page, profile.touch);
    await pressPause(page, 'controls', profile.touch); // TAP COMMANDER → sticks
    await shot('fire-chip-sticks-manual');
    await leavePause(page);
    await settleFrames(page, 12);
    await park(page);
    const sticksManual = await shot('fire-match-sticks-manual');

    await openPauseSettings(page, profile.touch);
    await pressPause(page, 'fireMode', profile.touch); // MANUAL → AUTO-AIM
    await shot('fire-chip-sticks-autoaim');
    await leavePause(page);
    await settleFrames(page, 12);
    await park(page);
    const sticksAuto = await shot('fire-match-sticks-autoaim');

    const readback = {
      profile,
      note: 'All frames at the same pinned freeze tick. "null" is two shots with nothing touched between them.',
      diffs: {
        null: diff(frameA, frameNull),
        'tap: AUTO-AIM vs MANUAL': diff(frameA, frameC),
        'sticks: MANUAL vs AUTO-AIM': diff(sticksManual, sticksAuto),
      },
    };
    writeFileSync(join(SHOTS, `${profile.id}-fire-mode-diffs.json`), `${JSON.stringify(readback, null, 2)}\n`);
    await context.close();
  });
}
