/**
 * tests/mobile/centering.spec.ts — QA camera-centring suite. OWNER: QA Agent.
 *
 * Extends the mobile-emulation suite (see ./emulation.spec.ts) with the one check
 * the developer's M1 phone report demanded: the local ship must sit at the visual
 * centre of the screen, on every phone and in both orientations, at boot and while
 * the camera is following a thrusting ship. On a phone the URL bar, a notch, and
 * the fullscreen toggle all crop the canvas, so "centred on the raw canvas" is not
 * "centred on what the player sees" — the earlier build drifted the ship off to
 * one side on mobile even though it looked fine on a desktop canvas.
 *
 * Rather than pixel-hunt the ship sprite (fragile against art), this suite asserts
 * against the Platform Engineer's RATIFIED debug instrument (src/platform/
 * debug-hook.ts): with `?debug=1`, the app exposes read-only
 *
 *   window.__planetRush = {
 *     shipScreen: { x, y },  // local ship in VISUAL-VIEWPORT space (CSS px)
 *     viewport:   { w, h },  // visual-viewport size (CSS px); centre = {w/2, h/2}
 *     fps,
 *   }
 *
 * updated in place every rendered frame. Reporting in visual-viewport space is
 * what makes the assertion device-independent: a centred ship reads {w/2, h/2}
 * regardless of URL-bar / notch cropping. The centring gate (debug-hook.ts):
 *
 *   |shipScreen.x - viewport.w/2| < 0.05 * viewport.w   (and likewise y)
 *
 * The suite also pins the *other* half of the contract: without `?debug=1` the
 * instrument must be entirely absent — no `__planetRush` on `window`, so it can
 * never leak into a shipped, non-debug build.
 *
 * NOTE (cross-agent dependency): the `?debug=1` instrument ships in the Platform
 * Engineer's M1 camera-centring work. These assertions go green once that lands on
 * `main`; until then they are listable/typecheck-clean and encode the contract QA
 * holds the camera to. The DoD gate for this branch is `tsc`, unit tests, and
 * `playwright test --list`; the live run belongs in the qa container against a
 * build that carries the hook.
 *
 * TIME BASE (q7-01): the thrust hold is counted in the sim's OWN fixed steps, not
 * in wall-clock milliseconds. It used to be `waitForTimeout(THRUST_MS = 2000)`,
 * which is 120 ticks of travel on a 60 fps laptop but only ~30 on the CI runner's
 * software-GL rasterizer (the loop clamps each slow frame's catch-up — see
 * ./sim-clock.ts): the follow-camera was being asked to track a quarter of the
 * journey on the machine that gates merges. Counting ticks buys the same 2 seconds
 * of SIMULATION everywhere; the wall-clock price of that on a slow host is what
 * ./budgets.ts is for. This test is what took `main` red for two days on a flat
 * 60 s budget it could not finish inside (q7-01).
 *
 * It also got CHEAPER, which was not the goal but is worth recording: the old
 * hold re-dispatched a `touchMove` every 50 ms purely to pace itself, and paid a
 * CDP round-trip for each. The stick holds its own deflection until `touchEnd`
 * (touch.ts), so none of those events were input — 27.3 s → 15.4 s in-container
 * for a hold that now delivers strictly more simulation in CI.
 */
/*
 * ── a0-50: `?gate=0` on the clean boot below ────────────────────────────────
 * OWNED BY QA, EDITED BY THE UI ENGINEER — one line, and it drops cleanly.
 *
 * The title gate is a DOOR in front of the title screen: the wordmark is stamped
 * into the leaves of an airlock and it is opened by a press, over four beats.
 * This spec walks through the front door on its way somewhere else, so without
 * the flag its first click lands on the door instead of on the menu.
 *
 * `?gate=0` turns off that screen and NOTHING else — the menu, the doors and the
 * lobby below are the real ones, exactly as they were. It is deliberately much
 * narrower than `?debug=1`, which skips the whole front of the game. The read is
 * `src/ui/title-gate.ts` `gateEnabled`, and its doc carries the reasoning.
 */
import { test, expect, type Page, type CDPSession, type TestInfo } from '@playwright/test';
import { budgetTest } from './budgets';
import { simSeconds, waitForSimTicks } from './sim-clock';

// --- Contract shape (mirrors src/platform/debug-hook.ts `DebugState`). Declared
//     locally on purpose: the QA suite asserts the *runtime* contract and must not
//     compile-depend on a platform-owned module that may not be on this branch. --
interface DebugState {
  readonly shipScreen: { readonly x: number; readonly y: number };
  readonly viewport: { readonly w: number; readonly h: number };
  readonly fps: number;
}

/** The property the hook installs on `window` (debug-hook.ts DEBUG_GLOBAL_KEY). */
const DEBUG_GLOBAL_KEY = '__planetRush';

/** Centring tolerance: within 5% of the viewport dimension of centre (the gate the
 *  developer's M1 phone report set, encoded in the debug-hook.ts contract). */
const CENTER_TOL = 0.05;

/** How long to hold thrust before re-asserting centring (brief: "after 2 seconds
 *  of thrust") — long enough that the follow-camera has tracked real ship travel.
 *  Counted in SIM ticks, so "2 seconds" is 2 seconds of simulation on every host
 *  rather than 2 seconds of stopwatch that buys a quarter of the travel in CI. */
const THRUST_TICKS = simSeconds(2);

/** A few post-input steps so the camera has rendered the released-thrust frames
 *  before the second sample. Ticks only advance on rendered frames, so waiting on
 *  ticks here also guarantees the frames happened — which `waitForTimeout(200)`
 *  did not on a ~1 fps host. */
const SETTLE_TICKS = 12;

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

// --- Fixtures / helpers -----------------------------------------------------

/**
 * Load the game with the debug instrument armed and wait until it reports a live
 * frame (a populated viewport), so the first sample isn't the pre-first-frame
 * {0,0} seed. A hung boot trips the per-test timeout — a failed test, never a
 * hung suite (QA charter).
 */
async function bootDebug(page: Page): Promise<void> {
  // Seat the STICKS scheme before boot (a0-30). Tap Commander is the first-run
  // default on every platform since 2026-08-12 (GDD §2.4 amended) and it REPLACES
  // the sticks: the pilot writes thrust, and `W` / the left virtual stick write
  // nothing. This spec would still have passed — a camera holds a stationary ship
  // dead centre just fine — which is worse than failing, because "assert centred
  // after sustained thrust" would have been asserting nothing about thrust. So it
  // states the scheme its input belongs to.
  await page.addInitScript(() => localStorage.setItem('planet-rush:controlScheme', 'sticks'));
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    (key) => {
      const d = (window as unknown as Record<string, DebugState | undefined>)[key];
      return !!d && d.viewport.w > 0 && d.viewport.h > 0;
    },
    DEBUG_GLOBAL_KEY,
    { timeout: 15_000 },
  );
}

/** Snapshot `window.__planetRush` out of the page (structured-cloned, so the live
 *  in-place-updated object can't shift under the assertions). */
async function readDebug(page: Page): Promise<DebugState> {
  const d = await page.evaluate((key) => {
    const s = (window as unknown as Record<string, DebugState | undefined>)[key];
    if (!s) return null;
    return {
      shipScreen: { x: s.shipScreen.x, y: s.shipScreen.y },
      viewport: { w: s.viewport.w, h: s.viewport.h },
      fps: s.fps,
    };
  }, DEBUG_GLOBAL_KEY);
  expect(d, `${DEBUG_GLOBAL_KEY} present with ?debug=1`).not.toBeNull();
  return d as DebugState;
}

/** Assert the ship sits within CENTER_TOL of the visual-viewport centre on both
 *  axes. `tag` labels the moment (boot / post-thrust, orientation) in failures. */
function assertCentered(d: DebugState, tag: string): void {
  const cx = d.viewport.w / 2;
  const cy = d.viewport.h / 2;
  const dx = Math.abs(d.shipScreen.x - cx);
  const dy = Math.abs(d.shipScreen.y - cy);
  expect(
    dx,
    `${tag}: ship x off-centre by ${dx.toFixed(1)}px (viewport w=${d.viewport.w}, limit ${(CENTER_TOL * d.viewport.w).toFixed(1)})`,
  ).toBeLessThan(CENTER_TOL * d.viewport.w);
  expect(
    dy,
    `${tag}: ship y off-centre by ${dy.toFixed(1)}px (viewport h=${d.viewport.h}, limit ${(CENTER_TOL * d.viewport.h).toFixed(1)})`,
  ).toBeLessThan(CENTER_TOL * d.viewport.h);
}

/** Force the viewport to a given orientation, swapping the project's default dims
 *  if needed. Must run before {@link bootDebug} so the app lays out to it. */
async function orient(page: Page, mode: 'landscape' | 'portrait'): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) return;
  const isLandscape = vp.width >= vp.height;
  if (isLandscape !== (mode === 'landscape')) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
  }
}

/**
 * Hold thrust for `ticks` fixed sim steps. Touch profiles drive the left virtual
 * stick via a real CDP `touchstart`+held `touchmove` (surfaced as
 * `pointerType:'touch'`, the exact events `main.ts` binds the stick to —
 * `page.mouse` would report `'mouse'` and be ignored). Desktop holds `W` (WASD →
 * thrust, actions.ts). Direction is irrelevant to centring: whichever way the ship
 * travels, the follow-camera must keep it dead centre — that is the property under
 * test.
 */
async function holdThrust(page: Page, testInfo: TestInfo, ticks: number): Promise<void> {
  if (isTouchProject(testInfo.project.name)) {
    await touchThrust(page, ticks);
  } else {
    await page.keyboard.down('KeyW');
    await waitForSimTicks(page, ticks, { what: 'desktop W-key thrust hold' });
    await page.keyboard.up('KeyW');
  }
}

/** Engage the left thrust-stick under the thumb and hold it deflected for `ticks`
 *  fixed sim steps. Both points stay in the LEFT half (x < width/2) so the thrust
 *  stick — not the right-half aim/FIRE control — is the one engaged (GDD §2.4 twin
 *  sticks).
 *
 *  After the ramp-in nothing more is dispatched: a virtual stick holds its last
 *  position until `touchEnd` (touch.ts — `current` is only rewritten by a move),
 *  so thrust stays at full deflection for free. The old version re-dispatched a
 *  `touchMove` every 50 wall-clock ms purely to pace the hold, which made the
 *  amount of thrust the ship received a function of the host's frame rate. */
async function touchThrust(page: Page, ticks: number): Promise<void> {
  const vp = page.viewportSize() ?? { width: 390, height: 844 };
  const origin = { x: Math.round(vp.width * 0.25), y: Math.round(vp.height * 0.5) };
  const to = { x: Math.round(vp.width * 0.12), y: Math.round(vp.height * 0.34) };
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: origin.x, y: origin.y }],
    });
    // Deflect the stick off its origin to build a thrust vector, as a thumb would.
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const x = origin.x + ((to.x - origin.x) * i) / steps;
      const y = origin.y + ((to.y - origin.y) * i) / steps;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    // Hold: the stick stays deflected on its own, so just let the sim run.
    await waitForSimTicks(page, ticks, { what: 'touch thrust-stick hold at full deflection' });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

// ===========================================================================
// Centring — every profile, both orientations, at boot and after 2s of thrust
// ===========================================================================

for (const mode of ['landscape', 'portrait'] as const) {
  test(`camera keeps the ship centred at boot and after 2s thrust (${mode})`, async ({ page }, testInfo) => {
    budgetTest({
      work: 'orient → boot the debug build → assert centred → hold thrust for 2 s of SIM → settle → assert centred',
      measuredSeconds: 16,
    });

    // Landscape is the gameplay orientation on every profile. Portrait is asserted
    // too: on desktop it is just a tall aspect (no overlay); on touch the default
    // Android path renders gameplay in portrait (the ROTATE overlay only appears on
    // the iOS no-lock path, exercised in emulation.spec.ts) — so the frame renders
    // and centring is measurable. If a future build blanks the field under an
    // overlay, bootDebug's wait-for-live-frame gate trips first, surfacing that.
    await orient(page, mode);
    await bootDebug(page);

    // At boot: the ship spawns and the camera must already have it centred.
    assertCentered(await readDebug(page), `${mode} @ boot`);

    // After sustained thrust: the ship has travelled; the follow-camera must have
    // tracked it and still hold it dead centre.
    await holdThrust(page, testInfo, THRUST_TICKS);
    await waitForSimTicks(page, SETTLE_TICKS, { what: 'post-input camera settle' });
    assertCentered(await readDebug(page), `${mode} @ +${THRUST_TICKS} sim ticks of thrust`);
  });
}

// ===========================================================================
// The instrument must be ABSENT in a normal (non-debug) load
// ===========================================================================

test('debug hook is ABSENT without ?debug=1', async ({ page }) => {
  budgetTest({
    work: 'one clean boot → assert the instrument never installed',
    // Two assertions on a single boot: this one keeps the flat floor, which is the
    // point of budgeting per test rather than raising the global cap.
    measuredSeconds: 5,
  });

  await page.goto('/?gate=0');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  // Let the app fully boot and run frames — if the hook were going to install, it
  // would have by now, so a clean absence here is meaningful, not merely early.
  // Wall-clock on purpose, and the one place it is right: the thing under test is
  // that `__planetRush` does NOT exist, so there is no sim clock to wait on.
  await page.waitForTimeout(900);

  const present = await page.evaluate((key) => key in window, DEBUG_GLOBAL_KEY);
  expect(present, `window.${DEBUG_GLOBAL_KEY} must not exist without ?debug=1`).toBe(false);
});
