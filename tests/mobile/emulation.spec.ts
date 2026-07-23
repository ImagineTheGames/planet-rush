/**
 * tests/mobile/emulation.spec.ts — QA mobile-emulation suite. OWNER: QA Agent.
 *
 * Developer-requested after M1 phone verification caught two ship-blocking
 * misses that desktop testing could not see (GDD §4.3b risk 7, §4.6 "phone
 * verified"): (1) the touch controls were *invisible* — input worked but nothing
 * was drawn under the thumb; (2) a phone held in portrait showed an unplayable
 * squashed field with no guidance. This suite makes that class of miss
 * impossible to ship again by emulating real phones (Chromium device matrix)
 * and asserting the affordances are actually **rendered** — pixel-level, not
 * DOM-presence — because Planet Rush draws its whole presentation into one
 * PixiJS/WebGL canvas (see ./pixels.ts for the rationale).
 *
 * Matrix (playwright.config.ts): iPhone-ish (390×844 dpr3 touch), Pixel-ish
 * (412×915 dpr2.6 touch), Desktop (1280×800 dpr1, control). Runs against the
 * Vite *preview* build — the real shipped artifact.
 *
 * Checks:
 *  - touch: FIRE button (Auto-aim default) + left ghost-stick zone render;
 *           the desktop controls strip is ABSENT;
 *  - portrait: ROTATE overlay covers the game; landscape: overlay gone;
 *  - touch drag on the left half moves the ship (field screenshot pixel diff);
 *  - desktop: no touch affordances; controls strip PRESENT.
 *
 * ORIENTATION CONTRACT: the phone projects declare *portrait* viewports
 * (390×844 / 412×915) — the orientation the ROTATE overlay guards (m1-05). Any
 * test that asserts something about *play* (controls rendered, ship moving)
 * must boot in LANDSCAPE via {@link useLandscape}, because portrait is a
 * blocked, non-play state — the guard the overlay-visibility test exists to
 * cover. Portrait is reserved EXCLUSIVELY for that overlay-visibility case; a
 * gameplay assertion booted in portrait races the very guard it shares a suite
 * with. Landscape dims: 844×390 / 915×412.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import {
  decode,
  count,
  diffRatio,
  isPlasma,
  isBlueGlow,
  isYellow,
  isNonVacuum,
  REGION_FIRE,
  REGION_STICK,
  REGION_STRIP_LEFT,
  REGION_STRIP_MID,
  REGION_ORE_HUD,
  REGION_FULL,
  REGION_FIELD,
  type Img,
} from './pixels';

// --- Which projects are touch phones vs the desktop control -----------------

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

// --- Detection thresholds (device pixels / ratios). Tuned against the real
//     preview build; generous margins so a genuine affordance always clears and
//     an absent one never does. QA owns these numbers. -----------------------

/** A rendered plasma ring/label lights up far more than this many pixels. */
const AFFORDANCE_MIN_PX = 200;
/** The faint idle ghost stick ring is a thin stroke — a lower bar, still ≫ noise. */
const GHOST_MIN_PX = 80;
/** Below this, a region is effectively empty of an affordance (anti-aliasing dust). */
const ABSENT_MAX_PX = 40;
/** The desktop controls strip is plasma+grey text at dpr1 — a lower px bar than
 *  the dpr2.6–3 mobile rings, still far above an empty band. */
const STRIP_PRESENT_MIN_PX = 100;
/** The overlay blacks out the field: almost nothing non-vacuum survives its
 *  opaque backdrop (only its own thin plasma glyph/label line-art). */
const OVERLAY_MAX_NONVACUUM_RATIO = 0.1;
/** Thrusting into the field pans the follow-camera so asteroids stream in — a
 *  large field diff versus the near-static idle frame. */
const MOVE_MIN_DIFF = 0.05;
/** Drag must beat the ambient (spawn-glow) idle diff by at least this factor,
 *  isolating camera motion from the pulsing spawn-protection glow. */
const MOVE_OVER_IDLE_FACTOR = 2.5;

// --- Fixtures / helpers -----------------------------------------------------

/** Load the game and let the Pixi app boot + render a few frames. */
async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  // Let the fixed-timestep loop run out a few frames and fonts settle so the
  // HUD/affordances are on-screen before we sample.
  await page.waitForTimeout(900);
}

/** Decode the current viewport screenshot into an {@link Img}. */
async function shoot(page: Page): Promise<Img> {
  return decode(await page.screenshot());
}

/**
 * Emulate iOS Safari — the *only* environment the ROTATE overlay is designed
 * for. Chromium exposes `screen.orientation.lock`, so the app takes the Android
 * "lock to landscape" path and the overlay never shows. Removing `lock` makes
 * `platform.canLockOrientation()` false, driving the iOS overlay branch
 * (orientation.ts `shouldShowRotateOverlay`). Must run before the app boots.
 */
async function emulateNoOrientationLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const o = window.screen?.orientation as { lock?: unknown } | undefined;
      if (o) Object.defineProperty(o, 'lock', { configurable: true, value: undefined });
    } catch {
      /* best-effort — if it throws we just skip the emulation */
    }
  });
}

/**
 * Synthetic touch drag via CDP (Chromium only), producing real `touchstart/
 * move/end` — which the browser surfaces as `pointerType:'touch'`, the exact
 * events `main.ts` binds the twin sticks to. `page.mouse` would report
 * `pointerType:'mouse'` and be ignored. Coordinates are CSS px. Holds at the end
 * point so the game loop integrates several ship-thrust frames.
 */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  holdMs: number,
): Promise<void> {
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }],
    });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    const holdSteps = Math.max(1, Math.ceil(holdMs / 50));
    for (let i = 0; i < holdSteps; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: to.x, y: to.y }],
      });
      await page.waitForTimeout(50);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

/**
 * Force a LANDSCAPE viewport before the app boots. The phone projects declare
 * portrait dimensions (390×844 / 412×915) — the orientation the ROTATE overlay
 * guards, i.e. a *non-play* state. Gameplay/affordance assertions need the
 * playable field, so swap the viewport to landscape (844×390 / 915×412) before
 * `boot()` runs `goto`, so the app lays out in landscape from the first frame
 * and `shouldShowRotateOverlay` is false (w ≥ h) regardless of lock capability.
 * No-op if already landscape (e.g. the desktop control). Must run before boot.
 */
async function useLandscape(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (vp && vp.height > vp.width) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
  }
}

// ===========================================================================
// Touch profiles — visible controls (the M1 gap #1: invisible touch UI)
// ===========================================================================

test('touch: FIRE button + ghost stick render, controls strip is ABSENT', async ({ page }, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'touch-profile only');

  // Play-mode affordance assertion → landscape (portrait is the blocked state).
  await useLandscape(page);
  await boot(page);
  const img = await shoot(page);

  // Auto-aim is the touch default (GDD §2.4): the right half is a hold-to-FIRE
  // button — a plasma ring in the bottom-right corner.
  const fire = count(img, REGION_FIRE, isPlasma);
  expect(fire.matched, 'FIRE button plasma pixels (bottom-right)').toBeGreaterThan(AFFORDANCE_MIN_PX);

  // The left half always shows the thrust-stick zone (faint plasma ghost ring).
  const stick = count(img, REGION_STICK, isBlueGlow);
  expect(stick.matched, 'left ghost stick-zone pixels (bottom-left)').toBeGreaterThan(GHOST_MIN_PX);

  // The desktop controls strip must NOT be drawn on touch — the visible sticks
  // are the binding legend (GDD §2.2/§2.4). A stray strip would light this band.
  const strip = count(img, REGION_STRIP_MID, isBlueGlow);
  expect(strip.matched, 'controls-strip pixels on touch (must be ~0)').toBeLessThan(ABSENT_MAX_PX);
});

// ===========================================================================
// Portrait handling (the M1 gap #2: unhandled portrait)
// ===========================================================================

test('portrait shows the ROTATE overlay; landscape hides it', async ({ page }, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'touch-profile only');

  await emulateNoOrientationLock(page);
  await boot(page); // device default viewport is portrait (h > w)

  // Overlay up: it covers the field almost entirely (opaque vacuum backdrop),
  // so the ore HUD's signal-yellow "ORE" total in the top-left is hidden…
  const portrait = await shoot(page);
  const oreCoveredPx = count(portrait, REGION_ORE_HUD, isYellow).matched;
  expect(oreCoveredPx, 'ore-HUD yellow behind the overlay (portrait)').toBeLessThan(ABSENT_MAX_PX);
  // …and almost nothing on screen is non-background (only the thin plasma glyph).
  const portraitBusy = count(portrait, REGION_FULL, isNonVacuum).ratio;
  expect(portraitBusy, 'non-vacuum fraction with overlay up (portrait)').toBeLessThan(
    OVERLAY_MAX_NONVACUUM_RATIO,
  );

  // Rotate to landscape (swap the viewport) — fires resize/orientationchange,
  // which re-runs relayout() and hides the overlay (orientation.ts).
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  await page.setViewportSize({ width: height, height: width });
  await page.waitForTimeout(900);

  // Overlay gone: the game HUD is visible again — the ore yellow returns.
  const landscape = await shoot(page);
  const oreVisiblePx = count(landscape, REGION_ORE_HUD, isYellow).matched;
  expect(oreVisiblePx, 'ore-HUD yellow visible again (landscape)').toBeGreaterThan(ABSENT_MAX_PX);
  const landscapeBusy = count(landscape, REGION_FULL, isNonVacuum).ratio;
  expect(landscapeBusy, 'landscape field busier than the blacked-out overlay').toBeGreaterThan(
    portraitBusy,
  );
});

// ===========================================================================
// Touch drag moves the ship (brief: screenshot pixel diff of the field)
// ===========================================================================

test('touch drag on the left half moves the ship (field pixel diff)', async ({ page }, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'touch-profile only');

  // Gameplay assertion → landscape. In portrait the field is the blocked,
  // squashed non-play state (the ROTATE-overlay guard), and the first-gesture
  // requestLandscape path perturbs layout mid-drag — either way the field diff
  // is meaningless. Landscape is the only orientation where "ship moved" holds.
  await useLandscape(page);
  await boot(page);
  const { width, height } = page.viewportSize() ?? { width: 844, height: 390 };

  // Ambient baseline: with no input the follow-camera is still and the field is
  // near-static (only the localised spawn-protection glow animates). Measure it
  // over a comparable duration so the comparison is fair.
  const idle0 = await shoot(page);
  await page.waitForTimeout(1000);
  const idle1 = await shoot(page);
  const idleDiff = diffRatio(idle0, idle1, REGION_FIELD);

  // Sustained thrust *toward the field*: the local ship spawns at the ring's
  // outer edge facing inward, with the asteroid field to screen-left. Drag
  // leftward within the LEFT half (both endpoints x < width/2, so one thrust
  // stick stays engaged) to pan the follow-camera into the rocks — the field
  // visibly streams in. A vertical/outward drag would only pan empty vacuum.
  const pre = await shoot(page);
  const midY = Math.round(height * 0.5);
  await touchDrag(page, { x: Math.round(width * 0.42), y: midY }, { x: Math.round(width * 0.04), y: midY }, 1400);
  const post = await shoot(page);
  const dragDiff = diffRatio(pre, post, REGION_FIELD);

  expect(dragDiff, 'field changed under a left-half drag').toBeGreaterThan(MOVE_MIN_DIFF);
  expect(
    dragDiff,
    `drag diff (${dragDiff.toFixed(3)}) must exceed idle diff (${idleDiff.toFixed(3)}) × ${MOVE_OVER_IDLE_FACTOR}`,
  ).toBeGreaterThan(idleDiff * MOVE_OVER_IDLE_FACTOR);
});

// ===========================================================================
// Desktop control — no touch affordances, controls strip PRESENT
// ===========================================================================

test('desktop: no touch affordances, controls strip PRESENT', async ({ page }, testInfo) => {
  test.skip(isTouchProject(testInfo.project.name), 'desktop control only');

  await boot(page);
  const img = await shoot(page);

  // No hold-to-FIRE button on desktop (mouse/keyboard).
  const fire = count(img, REGION_FIRE, isPlasma);
  expect(fire.matched, 'FIRE button must be absent on desktop').toBeLessThan(ABSENT_MAX_PX);

  // The controls strip IS drawn along the bottom edge (GDD §2.2), plasma keys +
  // grey labels.
  const strip = count(img, REGION_STRIP_LEFT, isBlueGlow);
  expect(strip.matched, 'controls-strip pixels (bottom edge)').toBeGreaterThan(STRIP_PRESENT_MIN_PX);
});
