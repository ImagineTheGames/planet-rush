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
 *  - portrait: the game renders in LANDSCAPE (the ratified landscape lock —
 *    field report v0.1.1 — replaces the old ROTATE overlay: a portrait phone is
 *    rotated to landscape, never blacked out and asked to turn);
 *  - touch drag on the left half moves the ship (world-space truth, ?debug=1);
 *  - desktop: no touch affordances; controls strip PRESENT.
 *
 * ORIENTATION CONTRACT: the phone projects declare *portrait* viewports
 * (390×844 / 412×915). Under the landscape lock the game is playable in BOTH
 * orientations — a portrait phone is rotated to landscape, not blocked. Gameplay
 * assertions that key off physical screen REGIONS (a corner, a bottom strip) still
 * boot in LANDSCAPE via {@link useLandscape} so those regions map 1:1 to the
 * logical layout without going through the rotation; the landscape-lock behaviour
 * itself is covered by landscape-lock.spec.ts. Landscape dims: 844×390 / 915×412.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import {
  decode,
  count,
  columnCoverage,
  isPlasma,
  isBlueGlow,
  isBoneGhost,
  isBoneLit,
  isYellow,
  isNonVacuum,
  REGION_FIRE,
  REGION_STRIP_LEFT,
  REGION_FULL,
  type Img,
  type Pred,
  type Region,
} from './pixels';
import { budgetTest } from './budgets';
import { simSeconds, waitForSimClock, waitForSimTicks } from './sim-clock';

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
/**
 * Below this FRACTION of a band's columns, whatever is lit is not a CONTINUOUS
 * STROKE crossing it — see {@link columnCoverage}. Measured in the left stick's
 * own arc: the ring that is drawn there covers **101/101** columns, one bloomed
 * a0-45 star **11/101**. Half is the midpoint of that 9× gap.
 *
 * Only for continuous strokes — rings, not legends. A row of discrete glyphs
 * scores far lower (the desktop controls strip: 16/283 = 6% of REGION_STRIP_MID),
 * so a caller must know it is looking for a stroke before reaching for this.
 */
const STROKE_COLUMN_RATIO = 0.5;
/** The desktop controls strip is plasma+grey text at dpr1 — a lower px bar than
 *  the dpr2.6–3 mobile rings, still far above an empty band. */
const STRIP_PRESENT_MIN_PX = 100;
/** "The field is drawn, not blacked out." The old ROTATE overlay left only its
 *  thin plasma glyph (~1–2% non-vacuum); the ratified landscape lock renders the
 *  real frozen space scene (~8–9%, mostly-vacuum by nature). This floor sits
 *  between them — clear of a blackout, comfortably under real content. */
const PORTRAIT_RENDERED_MIN_RATIO = 0.04;
/** How much SIM time the drag is held for, in fixed ticks (60 Hz → 1.5 s of sim).
 *  Measured in *ticks*, never seconds: the window must be the same amount of
 *  simulation on every host (see {@link dragOverSimTicks}). Short enough that the
 *  ship is still in open space — a much longer hold runs it into the arena bound,
 *  where displacement saturates and the per-tick rate would sag for a reason that
 *  has nothing to do with input. */
const DRAG_SIM_TICKS = 90;

/** Minimum WORLD-space distance (sim units) the ship must cover PER ELAPSED SIM
 *  TICK under a sustained full-deflection thrust drag.
 *
 *  Per *tick*, not per second, is the whole point. Wall-clock time is not a fixed
 *  quantity of simulation: the loop clamps a slow frame's catch-up (loop.ts
 *  `MAX_FRAME_SECONDS` = 0.25 s), so on the CI runner's software-WebGL (~1 fps)
 *  the sim advances ~15 ticks per second of wall clock instead of 60. An absolute
 *  distance bar therefore silently asserts the host's frame rate. Dividing by the
 *  ticks the sim actually ran removes that term by construction.
 *
 *  The bar: at full thrust from rest the Vanguard accelerates at `BASE_ACCEL`
 *  900 u/s² against `DRAG` 3.0/s, so it approaches 300 u/s and is clamped to
 *  `BASE_SPEED` 260 u/s. Averaged over a from-rest window of `DRAG_SIM_TICKS`
 *  that is ~234 u/s → ~3.9 units per `TICK_DT` (1/60 s) tick. Measured on the
 *  real build it is ~3.3 (the stick ramps in over the first frames, and the ship
 *  slews to face the thrust vector). This floor sits at roughly a quarter of the
 *  ideal — 3× under measurement, and infinitely above the idle case, which reads
 *  exactly 0.000 because a ship with no input does not move at all. */
const DRAG_MIN_UNITS_PER_TICK = 1.0;

/** One second of simulation — enough for the HUD and the affordances to be drawn
 *  before a screenshot samples them. Ticks, not milliseconds: see {@link boot}. */
const SETTLE_TICKS = simSeconds(1);

// --- Fixtures / helpers -----------------------------------------------------

/** Load the game and let the Pixi app boot + render a few frames.
 *
 *  `?debug=1` boots STRAIGHT into a match (main.ts), skipping the main menu a
 *  clean boot now opens on (the P1 main-menu wiring — a clean boot lands on PLAY/
 *  SETTINGS, not the match). These affordance/overlay tests assert the IN-MATCH
 *  HUD, so they take the same immediate-match harness every other debug test
 *  uses; the flag adds only invisible instruments, so the pixels under assertion
 *  are unchanged. (Flagged by the UI Engineer for QA in the main-menu-wiring PR.) */
async function boot(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  // Let the fixed-timestep loop run out a second of SIMULATION so the HUD and the
  // affordances are on-screen before we sample. In ticks, not the old
  // `waitForTimeout(900)`: on the CI runner's ~1 fps software GL that bought ~13
  // ticks instead of ~54, so the screenshot assertions were sampling a frame that
  // had barely booted — a less-settled frame on exactly the host that gates merges
  // (q7-01; see ./sim-clock.ts).
  await waitForSimClock(page);
  await waitForSimTicks(page, SETTLE_TICKS, { what: 'boot settle before sampling pixels' });
}

/** Decode the current viewport screenshot into an {@link Img}. */
async function shoot(page: Page): Promise<Img> {
  return decode(await page.screenshot());
}

/**
 * `count()` over a region, skipping any pixel that falls inside one of
 * `exclude` — the "this corner, minus the elements that legitimately live in it"
 * count the desktop FIRE-absent check is built on.
 *
 * Per-pixel rather than `count(region) − Σ count(excluded)`, which is what the
 * check used while it had exactly one exemption to make. With two, subtracting
 * sub-counts discounts anything in BOTH twice and can drive the result negative —
 * i.e. it would hide pixels rather than attribute them, in a negative assertion
 * whose whole job is not to hide any.
 */
function countOutside(img: Img, region: Region, exclude: readonly Region[], pred: Pred): number {
  const px = (f: number, span: number, up: boolean): number =>
    Math.max(0, Math.min(span, up ? Math.ceil(f * span) : Math.floor(f * span)));
  const box = (r: Region) => ({
    x0: px(r.x0, img.width, false),
    y0: px(r.y0, img.height, false),
    x1: px(r.x1, img.width, true),
    y1: px(r.y1, img.height, true),
  });
  const b = box(region);
  const outs = exclude.map(box);
  let matched = 0;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (outs.some((o) => x >= o.x0 && x < o.x1 && y >= o.y0 && y < o.y1)) continue;
      const i = (y * img.width + x) * 4;
      if (pred(img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0)) {
        matched++;
      }
    }
  }
  return matched;
}

/** The overlap of two fractional {@link Region}s, or null when they don't meet. */
function intersectRegions(a: Region, b: Region): Region | null {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/**
 * A registered HUD element's own rect as a fractional {@link Region}, read from
 * the layout registry the app publishes under `?debug=1`
 * (`window.__planetRush.layout`) — authoritative, never a hardcoded corner. Null
 * if the entry is absent, which for these callers means "that element is not on
 * screen this frame".
 *
 * Two ids matter to the desktop FIRE-absent check below, and both for the same
 * reason: they are ratified HUD elements that legitimately paint inside
 * `REGION_FIRE`, so the check subtracts the rect the APP says they occupy rather
 * than widening its bar.
 *
 *  - `minimap`   — field report v0.2.4 moved the collapsed map into the
 *    bottom-right corner, where it paints team-plasma dots (own ship + own home
 *    station);
 *  - `onboarding`— the prompt panel. It is centred and hangs from the bottom of
 *    its band (`src/ui/hud-geometry.ts` `promptBand`), so on a wide desktop a
 *    long sentence's tail reaches past x 0.7 in chalk-bright Bone (r15-01).
 */
async function registryRegion(page: Page, id: string): Promise<Region | null> {
  return page.evaluate((wanted) => {
    const pr = (
      window as unknown as {
        __planetRush?: {
          viewport: { w: number; h: number };
          layout: { id: string; bounds: { x: number; y: number; width: number; height: number } }[];
        };
      }
    ).__planetRush;
    const e = pr?.layout.find((x) => x.id === wanted);
    if (!pr || !e || !(pr.viewport.w > 0) || !(pr.viewport.h > 0)) return null;
    const { x, y, width, height } = e.bounds;
    return {
      x0: x / pr.viewport.w,
      y0: y / pr.viewport.h,
      x1: (x + width) / pr.viewport.w,
      y1: (y + height) / pr.viewport.h,
    };
  }, id);
}

/** Every element id the layout registry carries this frame. */
async function registeredIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pr = (window as unknown as { __planetRush?: { layout: { id: string }[] } }).__planetRush;
    return pr ? pr.layout.map((e) => e.id) : [];
  });
}

/**
 * The top arc of a circular touch affordance, as a fractional {@link Region},
 * read from the layout registry (a0-23).
 *
 * Why an arc and not the corner it sits in. Until a0-23 the stick zone was the
 * only *blue* thing in the bottom-left, so counting blue over the whole corner
 * was a sound "is it drawn" probe. In Gantry/Bone the ring is neutral metal and
 * so is every asteroid behind it, so the same probe over the same corner would
 * pass on rock alone — it would stop being a test of the thing it names. A band
 * across the ring's own top arc is almost entirely ring, and the bounds come
 * from the app's own contract (`touch-left-stick`, registered from the very
 * `writeAffordanceRects` that draws it) rather than from a hardcoded corner.
 *
 * `null` when the entry is absent, which is itself the failure the M1 gap was
 * about — an affordance that is not registered is one that is not on screen.
 */
async function affordanceArcRegion(page: Page, id: string): Promise<Region | null> {
  return page.evaluate((wanted) => {
    const pr = (
      window as unknown as {
        __planetRush?: {
          viewport: { w: number; h: number };
          layout: { id: string; bounds: { x: number; y: number; width: number; height: number } }[];
        };
      }
    ).__planetRush;
    const e = pr?.layout.find((x) => x.id === wanted);
    if (!pr || !e || !(pr.viewport.w > 0) || !(pr.viewport.h > 0)) return null;
    const { x, y, width, height } = e.bounds;
    // The middle 30% of the width, and a few px either side of the top edge —
    // where a rim stroke centred on the circle actually lands. Deliberately
    // generous vertically (the stroke is 3 CSS px) and narrow horizontally, so
    // the band stays on the flattest part of the arc at every device scale.
    void height;
    return {
      x0: (x + width * 0.35) / pr.viewport.w,
      y0: (y - 4) / pr.viewport.h,
      x1: (x + width * 0.65) / pr.viewport.w,
      y1: (y + 6) / pr.viewport.h,
    };
  }, id);
}

/** What one tick-bounded drag measured: world distance covered and the number of
 *  fixed sim steps it was measured over. */
interface DragMeasurement {
  /** World-space distance (sim units) the local ship covered. */
  readonly moved: number;
  /** Fixed sim steps the sim actually ran during the hold. */
  readonly ticks: number;
}

/**
 * Synthetic touch drag via CDP (Chromium only), held for a fixed amount of SIM
 * time and reporting how far the ship travelled over exactly that window.
 *
 * CDP produces real `touchstart/move/end` — which the browser surfaces as
 * `pointerType:'touch'`, the exact events `main.ts` binds the twin sticks to.
 * `page.mouse` would report `pointerType:'mouse'` and be ignored. Coordinates
 * are CSS px.
 *
 * Two details make this dilation-proof, which a wall-clock hold is not:
 *
 *  - **The window is counted in sim ticks**, read from the `?debug=1` instrument.
 *    Holding "1.4 seconds" means 84 ticks at 60 fps but only ~20 on the CI
 *    runner's ~1 fps software-WebGL, because the loop clamps each slow frame's
 *    catch-up — the same gesture would be measured over wildly different amounts
 *    of simulation. Counting ticks pins the window instead.
 *  - **The sampling runs in-page on `requestAnimationFrame`**, so the window
 *    closes within one frame of hitting the target rather than one slow CDP
 *    round trip. Polling over the wire from the test overshot to 700+ ticks at
 *    ~1 fps; on rAF the window lands within a tick or two of the target.
 *
 * After the ramp-in we stop dispatching entirely: a virtual stick holds its last
 * position until `touchEnd` (touch.ts — `current` is only rewritten by a move),
 * so thrust stays at full deflection with no further events.
 */
async function dragOverSimTicks(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  ticks: number,
): Promise<DragMeasurement> {
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }],
    });
    // Ramp to full deflection in a few steps, as a thumb would.
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }

    const measured = await page.evaluate(
      (want) =>
        new Promise<{ moved: number; ticks: number }>((resolve) => {
          const d = (
            window as unknown as {
              __planetRush: { shipWorld: { x: number; y: number }; ticks: number };
            }
          ).__planetRush;
          const t0 = d.ticks;
          const x0 = d.shipWorld.x;
          const y0 = d.shipWorld.y;
          const poll = (): void => {
            const elapsed = d.ticks - t0;
            if (elapsed >= want) {
              resolve({ moved: Math.hypot(d.shipWorld.x - x0, d.shipWorld.y - y0), ticks: elapsed });
            } else {
              requestAnimationFrame(poll);
            }
          };
          requestAnimationFrame(poll);
        }),
      ticks,
    );

    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return measured;
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
  budgetTest({
    work: 'landscape boot → 1 s of sim settle → one full-viewport screenshot → three region scans + one registry read',
    measuredSeconds: 9,
  });

  // Play-mode affordance assertion → landscape (portrait is the blocked state).
  await useLandscape(page);
  await boot(page);
  const img = await shoot(page);

  // Auto-aim is the touch default (GDD §2.4): the right half is a hold-to-FIRE
  // button — since a0-23 a chalk-bright Bone rim and label in the bottom-right
  // corner, where it was a plasma ring. Brightness is the affordance now, so
  // brightness is what this counts (`isBoneLit`, the same predicate the menu
  // assertions use for "the primary action is the brightest thing on screen").
  const fire = count(img, REGION_FIRE, isBoneLit);
  expect(fire.matched, 'FIRE button Bone-lit pixels (bottom-right)').toBeGreaterThan(AFFORDANCE_MIN_PX);

  // The left half always shows the thrust-stick zone: a faint Bone ring. Sampled
  // across the ring's own top arc rather than over the whole corner — see
  // {@link affordanceArcRegion} for why the corner stopped being a valid probe
  // the moment the ring became the same neutral metal as the asteroids behind it.
  const arc = await affordanceArcRegion(page, 'touch-left-stick');
  expect(arc, 'the left stick zone is registered (i.e. on screen at all)').not.toBeNull();
  const stick = count(img, arc!, isBoneGhost);
  expect(stick.matched, 'left ghost stick-zone pixels (its own top arc)').toBeGreaterThan(GHOST_MIN_PX);
  // …and it is NOT the blue it used to be. `isBoneGhost` already excludes plasma
  // by construction (a `b - r` of 38 versus single digits on a value ramp), but
  // stating the negative is what makes this a test of a0-23 rather than a test
  // that something is drawn there.
  //
  // Counted by COLUMN COVERAGE rather than by pixels, because since a0-45 the
  // sky behind this arc is a two-temperature star field and the design's hot
  // star is blue-white: a bloomed one landing in the band measures a `b - r` of
  // 42 where the faint plasma ring `isBlueGlow` exists to catch measures 38.
  // A blue star and faint plasma are not separable by colour — that is the
  // finding, not a workaround — so the probe asks the question this band was
  // shaped for instead. A ring crosses it and lights every column; a star is a
  // point and lights a tenth of them. Measured here: the Bone ring that IS drawn
  // covers 101/101 columns, one bloomed star 11/101 (a0-45, blue-probe).
  const stickBlue = columnCoverage(img, arc!, isBlueGlow);
  expect(stickBlue.ratio, 'the stick zone no longer wears plasma (a0-23)').toBeLessThan(STROKE_COLUMN_RATIO);

  // The desktop controls strip must NOT be drawn on touch — the visible sticks
  // are the binding legend (GDD §2.2/§2.4).
  //
  // Asked of the layout REGISTRY, because since a0-45 `REGION_STRIP_MID` can no
  // longer carry the question. That band shows sky, and the sky is now a blue
  // star field; measured in it (a0-45 blue-probe, both touch profiles):
  //
  //                        isBlueGlow px   max b-r   max b
  //   sky alone, on touch        352          51      162
  //   a REAL strip, on desktop    32          28       69
  //
  // The stars are ten times the strip's pixels, bluer than it and brighter than
  // it, and `isPlasma` reads 0 over the real strip — so no threshold and no
  // predicate orders these two the right way round. The old `< 40` bar is not
  // merely noisy now, it is *inverted*: it fails on empty sky and would have
  // passed on the drawn strip it names.
  //
  // The registry is exact where the pixels are hopeless, and it is the same
  // instrument (and the same argument) the desktop test uses in the mirror
  // direction: main.ts registers `controls-strip` from the code that draws it,
  // so a strip that reached touch at all would announce itself. The usual caveat
  // — a registered element can be invisible, which is the M1 miss this suite
  // exists for — bites a PRESENCE check, not an absence one: for "it is not
  // there", not registered is the stronger half, and it is the half the sky
  // cannot touch. What is lost is the ability to catch a strip drawn WITHOUT
  // registering; that is recorded in a0-45's PR as QA's to weigh.
  expect(
    await registeredIds(page),
    'the desktop controls strip is not on touch (GDD §2.2/§2.4)',
  ).not.toContain('controls-strip');
});

// ===========================================================================
// Portrait handling — the ratified landscape lock (field report v0.1.1)
// ===========================================================================

test('portrait renders the landscape game (no ROTATE overlay, HUD visible)', async ({ page }, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'touch-profile only');
  budgetTest({
    work: 'portrait boot → settle → screenshot → rotate to landscape → re-layout settle → second screenshot',
    measuredSeconds: 16,
  });

  // Boot on the device default viewport, which is PORTRAIT (h > w). The ratified
  // landscape lock rotates the whole game to landscape rather than blacking out the
  // field behind a ROTATE overlay — so the game is fully rendered, not blocked.
  await boot(page);
  const portrait = await shoot(page);

  // The HUD renders — the strongest "game is drawn, not overlaid" signal. The ore
  // squares / banked total draw signal-yellow (which the old opaque ROTATE overlay
  // hid entirely); it rides the rotated logical corner, so scan the whole frame.
  const oreVisiblePx = count(portrait, REGION_FULL, isYellow).matched;
  expect(oreVisiblePx, 'ore-HUD signal-yellow present (portrait, rotated to landscape)').toBeGreaterThan(
    ABSENT_MAX_PX,
  );

  // The field is drawn, not blacked out. The frozen space scene is mostly vacuum
  // by nature, so this is a modest floor — well clear of the old overlay blackout
  // (only its thin plasma glyph survived) yet comfortably below the real content.
  const portraitBusy = count(portrait, REGION_FULL, isNonVacuum).ratio;
  expect(portraitBusy, 'portrait renders the landscape game, not a blackout').toBeGreaterThan(
    PORTRAIT_RENDERED_MIN_RATIO,
  );

  // Rotate to physical landscape — the game re-lays out and keeps rendering (no
  // overlay to dismiss). Still showing the HUD's yellow, still drawing the field.
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  await page.setViewportSize({ width: height, height: width });
  // A second of SIM, not of stopwatch, for the re-layout to land and draw — same
  // reason as {@link boot}.
  await waitForSimTicks(page, SETTLE_TICKS, { what: 'rotation re-layout settle' });

  const landscape = await shoot(page);
  const oreLandscapePx = count(landscape, REGION_FULL, isYellow).matched;
  expect(oreLandscapePx, 'ore-HUD yellow still present (landscape)').toBeGreaterThan(ABSENT_MAX_PX);
  const landscapeBusy = count(landscape, REGION_FULL, isNonVacuum).ratio;
  expect(landscapeBusy, 'landscape still renders the game').toBeGreaterThan(PORTRAIT_RENDERED_MIN_RATIO);
});

// ===========================================================================
// Touch drag moves the ship (world-space truth, per elapsed SIM tick)
// ===========================================================================

test('touch drag on the left half moves the ship (world units per sim tick)', async ({ page }, testInfo) => {
  test.skip(!isTouchProject(testInfo.project.name), 'touch-profile only');

  // This test buys a fixed amount of SIM time, so its WALL-CLOCK cost scales with
  // how slowly the host renders — that is the trade the tick-based window makes,
  // not a flaw in it. Measured end-to-end: 3.8 s at full speed, 33.4 s with the
  // CPU throttled 200x (~1 fps, the CI software-WebGL profile). It does not weaken
  // the assertion: a host too slow to run 90 ticks still fails, it just fails on
  // the tick target rather than on an arbitrary stopwatch. (Was a hand-written
  // 120_000; the number now comes from the suite's measured model — q7-01.)
  budgetTest({
    work: 'landscape boot → ramped touch drag → 90 sim ticks of sustained thrust → world-distance-per-tick assertion',
    measuredSeconds: 16,
  });

  // Gameplay assertion → landscape. In portrait the field is the blocked,
  // squashed non-play state (the ROTATE-overlay guard), and the first-gesture
  // requestLandscape path perturbs layout mid-drag. Landscape is the only
  // orientation where "ship moved" holds.
  await useLandscape(page);

  // Assert against SIM TRUTH on the SIM's OWN CLOCK — two separate corrections,
  // both needed, because rendering is the thing that breaks down under CI:
  //
  //  1. *What* is measured. The follow-camera keeps the ship centred, so a field
  //     screenshot diff can only observe the field panning — a render-side proxy.
  //     `shipWorld` (?debug=1) is the sim's own answer to "did the ship move?".
  //  2. *Over what* it is measured. Wall-clock seconds are not a fixed amount of
  //     simulation. The loop clamps each frame's catch-up to `MAX_FRAME_SECONDS`
  //     (0.25 s), so on the CI runner's software-WebGL at ~1 fps the sim advances
  //     ~15 ticks per wall-clock second instead of 60 — measured here at 14.7.
  //     A gesture "held 1.4 s" is then a *quarter* of the simulation it is on a
  //     real phone, and any absolute distance bar is really an assertion about
  //     the host's frame rate. Dividing by the ticks the sim actually ran removes
  //     that term by construction.
  //
  // Verified by CPU-throttling this same build from 1× to 200× (36 fps → 1.0 fps,
  // the CI profile): the per-tick rate moved 3.300 → 3.319 while the identical
  // gesture's wall-clock cost went 2.5 s → 31.4 s. The no-input control reads
  // exactly 0.000 at both rates, so the bar still fails a genuinely dead stick.
  // (Platform note m1-12.)
  //
  // Seat the STICKS scheme before boot (a0-30). Tap Commander is the first-run
  // default on every platform since 2026-08-12 (GDD §2.4, amended) and it replaces
  // the sticks: the left-half drag below writes no thrust at all, and the
  // no-input control this bar is calibrated against would become the only reading.
  // The measurement is of the LEFT VIRTUAL STICK, so it asks for the scheme that
  // has one — the gesture, the tick window and the per-tick bar are unchanged.
  await page.addInitScript(() => localStorage.setItem('planet-rush:controlScheme', 'sticks'));
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __planetRush?: { viewport: { w: number; h: number } } }).__planetRush;
      return !!d && d.viewport.w > 0 && d.viewport.h > 0;
    },
    undefined,
    { timeout: 15_000 },
  );

  const { width, height } = page.viewportSize() ?? { width: 844, height: 390 };
  const midY = Math.round(height * 0.5);

  // Left-half leftward drag: both endpoints x < width/2, so one thrust stick
  // stays engaged and drives sustained full-deflection thrust for the window.
  const { moved, ticks } = await dragOverSimTicks(
    page,
    { x: Math.round(width * 0.42), y: midY },
    { x: Math.round(width * 0.04), y: midY },
    DRAG_SIM_TICKS,
  );

  // Guard the denominator: a window that never ran can't be divided by, and
  // would otherwise read as a pass-by-vacuum.
  expect(ticks, 'sim ticks elapsed during the drag').toBeGreaterThanOrEqual(DRAG_SIM_TICKS);

  const perTick = moved / ticks;
  expect(
    perTick,
    `ship world-distance per sim tick under a left-half drag ` +
      `(${moved.toFixed(1)} units over ${ticks} ticks = ${perTick.toFixed(3)} u/tick)`,
  ).toBeGreaterThan(DRAG_MIN_UNITS_PER_TICK);
});

// ===========================================================================
// Desktop control — no touch affordances, controls strip PRESENT
// ===========================================================================

test('desktop: no touch affordances, controls strip PRESENT', async ({ page }, testInfo) => {
  test.skip(isTouchProject(testInfo.project.name), 'desktop control only');
  budgetTest({
    work: 'desktop boot → 1 s of sim settle → one screenshot → two registry reads → three region pixel counts',
    measuredSeconds: 5,
  });

  await boot(page);
  const img = await shoot(page);

  // ── Nothing touch-shaped is even REGISTERED (a0-23, the cheap half) ────────
  //
  // `writeAffordanceRects` returns three nulls on desktop, and main.ts registers
  // each rect only when it is non-null, so a FIRE button that reached desktop at
  // all would announce itself here — before any question of what colour it is or
  // whose corner it lands in. This is not a replacement for the pixel counts
  // below (a registered element can be invisible, which is the M1 miss this whole
  // suite exists for); it is the half of the invariant that no exemption can ever
  // blunt, and it says which of the two possible failures is happening.
  const ids = await registeredIds(page);
  expect(
    ids.filter((id) => id.startsWith('touch-')),
    'no touch affordance is registered on desktop (a0-23)',
  ).toEqual([]);

  // ── …and none is DRAWN in the corner one would land in ────────────────────
  //
  // No hold-to-FIRE button on desktop (mouse/keyboard). `REGION_FIRE` is a fixed
  // corner box rather than an affordance's own rect — on touch it is aimed at the
  // FIRE button, but on desktop there is no such button to aim at, so it is a
  // plain 30%×20% of the screen and it collects whatever the layout legitimately
  // puts there. Two ratified elements do, and both are subtracted at the rect the
  // app itself publishes (never a hardcoded corner):
  //
  //  - the collapsed `minimap`, which hugs the bottom-right corner since field
  //    report v0.2.4 and paints team-plasma dots (own ship + own home station);
  //  - the `onboarding` prompt panel — centred, hung from the bottom of its band
  //    (`src/ui/hud-geometry.ts` `promptBand`), and since a0-34 carrying a
  //    first-match objective sentence long enough that its tail reaches past
  //    x 0.7 in chalk-bright Bone. Measured at 1280×800 (r15-01): 308 Bone-lit
  //    pixels in this region, all 308 of them inside that rect.
  //
  // **This exempts no pixel a FIRE affordance can occupy**, which is what keeps it
  // an exemption rather than a relaxation: the prompt band stops short of the
  // minimap's square by `PROMPT_MINIMAP_GAP`, and the Auto-aim button's anchor is
  // hard against the screen's own corner (`@platform/touch-visuals`: `EDGE_MARGIN`
  // 28 + `R_FIRE` 42, i.e. x 1168→1252 at 1280×800) — 85 px to the RIGHT of where
  // the prompt panel ends. A real leaked FIRE ring lights that corner, well beyond
  // both tenants, and still trips both counts below.
  const tenants = (
    await Promise.all([registryRegion(page, 'minimap'), registryRegion(page, 'onboarding')])
  )
    .map((r) => (r ? intersectRegions(REGION_FIRE, r) : null))
    .filter((r): r is Region => r !== null);
  const fireOnly = (pred: Pred): number => countOutside(img, REGION_FIRE, tenants, pred);

  expect(fireOnly(isPlasma), 'FIRE button must be absent on desktop (minimap + prompt excluded)').toBeLessThan(
    ABSENT_MAX_PX,
  );

  // …and absent in the colour it is actually drawn in SINCE a0-23, which is the
  // point of this second count rather than a belt on a brace: the touch controls
  // came off plasma, so a FIRE button leaking onto desktop would now be a
  // chalk-bright Bone rim — invisible to the plasma count above, which would have
  // gone on passing while the invariant it names quietly stopped being checked.
  expect(fireOnly(isBoneLit), 'no Bone-lit FIRE rim on desktop either (a0-23)').toBeLessThan(ABSENT_MAX_PX);

  // The controls strip IS drawn along the bottom edge (GDD §2.2), plasma keys +
  // grey labels.
  const strip = count(img, REGION_STRIP_LEFT, isBlueGlow);
  expect(strip.matched, 'controls-strip pixels (bottom edge)').toBeGreaterThan(STRIP_PRESENT_MIN_PX);
});
