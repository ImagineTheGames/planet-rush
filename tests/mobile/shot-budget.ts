/**
 * tests/mobile/shot-budget.ts — how long a GOLDEN COMPARISON may take. OWNER: QA Agent.
 *
 * ── THE LESSON THIS FILE ENCODES ───────────────────────────────────────────
 * `./budgets.ts` budgets a TEST from the work it does. This file does the same
 * one level down, for the single assertion that *is* the work in a golden spec:
 * `expect(page).toHaveScreenshot()`.
 *
 * Until q8-01 every screenshot comparison in the suite rode `expect.timeout`
 * (10 s, playwright.config.ts) — the budget sized for a two-line check like
 * `toHaveText`. A golden comparison is not that. Playwright will not compare a
 * frame it has not seen twice: it captures, captures again, and only when two
 * consecutive captures are byte-identical does it diff against the baseline. So
 * the floor on a passing golden is TWO full-frame captures plus a compare, and
 * the floor on a FAILING one is however many captures fit before the clock runs
 * out — after which it reports a *timeout*, with no actual/expected/diff, and
 * the reviewer learns nothing about the pixels.
 *
 * That is not a hypothetical. Measured in the studio container (hardware GL,
 * Ubuntu 24.04, Playwright 1.49.1 — six consecutive `page.screenshot()` captures
 * of the frozen scene per project, at `scale: 'css'`, which is what
 * `toHaveScreenshot` uses):
 *
 *   desktop  1280×800 dpr 1     1.02 MP   ~0.96 s per capture
 *   pixel     412×915 dpr 2.6   2.55 MP   ~1.57 s per capture
 *   iphone    390×844 dpr 3     2.96 MP   ~1.81 s per capture
 *
 * A dpr-3 phone frame rasterises ~2.9× the pixels of the dpr-1 desktop control,
 * so the *pair* the stabilisation loop needs costs ~3.6 s in the container before
 * the comparison itself starts. On a software-GL runner (./budget-model.ts
 * CI_SLOW_FACTOR) that pair does not come close to fitting inside 5 s — which is
 * exactly how PR #291 went red on its two `iphone` goldens, on a run that took
 * 31.8 min against a normal ~9, while the same baselines passed in-container at
 * the same commit. The frame was never wrong; the clock was.
 *
 * ── RE-MEASURED AT 369d7a6, ON THE HEAVIEST GOLDEN (q9-01) ─────────────────
 * Same container, same Playwright, four consecutive captures per row, of the
 * phone BUILD WHEEL frame (boot → open the wheel → settle) rather than the plain
 * frozen scene:
 *
 *                                 scale:'css'   scale:'device'   px in one capture
 *   iphone LANDSCAPE 844×390 dpr3   ~1.92 s        ~1.91 s          2.96 MP
 *   iphone PORTRAIT  390×844 dpr3   ~1.59 s        ~1.59 s          2.96 MP
 *   desktop         1280×800 dpr1   ~0.65 s        ~0.70 s          1.02 MP
 *
 * Two things in that table are worth keeping.
 *
 * FIRST: `scale: 'device'` is no longer cheaper — it is the same, to within
 * noise, on every profile. The older note above read the css resample as the
 * expensive step; it is not, the readback and encode are, and they are paid
 * either way. So the obvious lever for making the heaviest golden cheaper does
 * not exist: switching would force a re-shoot of every phone baseline at 4.5×
 * the PNG bytes and buy nothing. Do not try it again on the old reasoning.
 *
 * SECOND: at IDENTICAL pixel counts, the landscape capture costs ~20% more than
 * the portrait one — so a model keyed on megapixels alone slightly under-predicts
 * the orientation the heaviest golden actually shoots (the spec rotates before
 * booting). The intercept below is raised to cover it. Every rounding in this
 * file goes one way, and this is that rule applied to a new measurement rather
 * than a change of method.
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 *   capture(mp)  = CAPTURE_FIXED_MS + CAPTURE_PER_MEGAPIXEL_MS × mp
 *   budget(mp)   = max(SHOT_FLOOR_MS,
 *                      roundUpTo15s(capture(mp) × STABILISATION_CAPTURES × CI_SLOW_FACTOR))
 *
 * The two capture constants are a straight line fitted to the three measurements
 * above: a fixed per-capture cost (the CDP round-trip and PNG encode setup) plus
 * a per-megapixel cost (the readback). Re-fit them, here, if the numbers move —
 * do not nudge a spec.
 *
 * ── WHY A BIG CEILING IS SAFE (the same argument as ./budgets.ts) ───────────
 * A budget is a CEILING, not a target. It is only ever spent on work that is
 * genuinely running, because the ways this suite catches a WEDGE are separate
 * and unchanged: the boot fixtures' own `waitForSelector`/`waitForFunction` caps
 * (15–30 s) name what never arrived, ./render-settle.ts fails in 10 s when the
 * page stops drawing at all, and ./sim-clock.ts fails in 10 s when the sim stops
 * ticking. What this ceiling buys is the one case those bounds cannot help with:
 * a frame that IS being drawn, slowly, on a loaded runner.
 *
 * And it deliberately does NOT touch `maxDiffPixelRatio`. The tolerance exists
 * for font and GPU antialiasing; widening it to swallow a half-composited frame
 * would blind the gate to the real visual regressions it is the only guard
 * against. Time is the thing that was short, so time is the thing this fixes.
 */
import { CI_SLOW_FACTOR } from './budget-model';

/** A frame this suite shoots, in the terms the device matrix states it. */
export interface ShotFrame {
  /** CSS-pixel viewport width. */
  readonly width: number;
  /** CSS-pixel viewport height. */
  readonly height: number;
  /** Device pixel ratio — the multiplier on BOTH axes, so its square on area. */
  readonly deviceScaleFactor: number;
}

/**
 * Per-capture cost that does not depend on the frame's size: the CDP round-trip
 * to the browser, the screenshot command, and the fixed part of PNG encoding.
 * The intercept of the fit over the three measured projects (~0.50 s), rounded
 * up. Every rounding in this file goes the same way — a capture is never assumed
 * to be cheaper than it measured.
 *
 * Raised 550 → 600 at q9-01. The re-measurement above found the LANDSCAPE dpr-3
 * capture at ~1.92 s where the old fit projected 1.88 s — optimistic by 30-odd
 * ms, on exactly the frame the heaviest golden shoots. Orientation is not in the
 * model (megapixels are the same both ways) and does not need to be: lifting the
 * intercept covers it and keeps the invariant this file states — a projection
 * sits at or above what was measured — true rather than nearly true. Nothing
 * downstream moves: every budget in {@link DEVICE_MATRIX} rounds to the same
 * step it did before, which is asserted in tests/mobile-shot-budget-contract.test.ts.
 */
export const CAPTURE_FIXED_MS = 600;

/**
 * Per-megapixel cost: the GPU readback, the css-scale resample and the encode of
 * the pixels themselves. The slope of the fit
 * ((1.81 s − 0.96 s) / (2.96 MP − 1.02 MP) ≈ 442 ms/MP), rounded up.
 */
export const CAPTURE_PER_MEGAPIXEL_MS = 450;

/**
 * How many full-frame captures one passing comparison costs.
 *
 * Two — the pair `toHaveScreenshot` needs to call the frame stable before it
 * diffs. Two is the honest floor rather than a guess: the frozen scene is a pure
 * function of the world (goldens.spec.ts), and the measurement above found
 * captures 0 and 1 already byte-identical on all three projects, at both scales,
 * with no wait of any kind between them. So a golden that needs a THIRD capture
 * is not slow, it is unstable — and the budget should not quietly pay for it.
 */
export const STABILISATION_CAPTURES = 2;

/** Shot budgets round up to this, so the matrix reads in human steps. */
export const SHOT_ROUND_TO_MS = 15_000;

/**
 * The floor under every golden comparison, whatever the arithmetic says: 6× the
 * 5 s default it used to ride. Keeps the smallest frame in the matrix from
 * inheriting a budget that is technically sufficient and visibly fragile.
 */
export const SHOT_FLOOR_MS = 30_000;

/** Rasterised megapixels in one full-frame capture of `frame`. */
export function megapixelsOf(frame: ShotFrame): number {
  const scale = frame.deviceScaleFactor;
  return (frame.width * scale * frame.height * scale) / 1_000_000;
}

/** In-container cost of ONE full-frame capture at `megapixels` (ms). */
export function captureMsFor(megapixels: number): number {
  return CAPTURE_FIXED_MS + CAPTURE_PER_MEGAPIXEL_MS * megapixels;
}

/** The budget, in ms, one `toHaveScreenshot` of `frame` is entitled to. */
export function shotBudgetMsFor(frame: ShotFrame): number {
  const scaled = captureMsFor(megapixelsOf(frame)) * STABILISATION_CAPTURES * CI_SLOW_FACTOR;
  const rounded = Math.ceil(scaled / SHOT_ROUND_TO_MS) * SHOT_ROUND_TO_MS;
  return Math.max(SHOT_FLOOR_MS, rounded);
}

/**
 * The device matrix, stated once and read twice: by `playwright.config.ts` (what
 * Chromium emulates) and by {@link GOLDEN_SHOT_TIMEOUT_MS} (what a full-frame
 * capture of that emulation costs). One source, so a device's budget cannot
 * drift away from the pixel count it was derived from.
 */
export const DEVICE_MATRIX = {
  /** iPhone-ish. The expensive one: dpr 3 squares to 9× the pixels per CSS
   *  pixel, and 2.96 MP a capture — ~2.9× the desktop control's area. */
  iphone: { width: 390, height: 844, deviceScaleFactor: 3 },
  /** Pixel-ish. */
  pixel: { width: 412, height: 915, deviceScaleFactor: 2.6 },
  /** Desktop control, dpr 1. */
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
} as const satisfies Record<string, ShotFrame>;

/**
 * The budget every golden comparison in the suite takes — sized at the LARGEST
 * frame in {@link DEVICE_MATRIX}.
 *
 * ── WHY ONE NUMBER AND NOT THREE ───────────────────────────────────────────
 * The honest budget is per frame, and this file computes it per frame. It is
 * applied as a single constant for a mechanical reason: **Playwright 1.49.1 has
 * no project-level screenshot timeout.** `TestProject.expect.toHaveScreenshot`
 * accepts `threshold`, `maxDiffPixels`, `maxDiffPixelRatio`, `animations`,
 * `caret`, `scale` and `stylePath` — and no `timeout`. Setting one there is
 * accepted by the type checker (the object is not a fresh literal, so no excess-
 * property check fires) and then silently ignored; worse, the project block
 * REPLACES the config-level `expect`, so a project that sets it also loses the
 * suite's `expect.timeout` and drops to Playwright's own 5 s default. That was
 * tried, and the call log said `with timeout 5000ms`. It is a trap, and this
 * note is here so nobody walks back into it.
 *
 * So the timeout travels on the per-call options object every golden already
 * passes (`GOLDEN` in goldens.spec.ts) — which has the property that matters
 * most here: a golden written on ANOTHER branch, before any of this existed,
 * inherits the fix by passing the same constant it always passed, with no edit
 * to that branch (PR #291 — a re-run, not a rewrite).
 *
 * Sizing at the maximum is the safe direction: it over-budgets the dpr-1 desktop
 * control by 15 s and under-budgets nothing. Over-budgeting costs nothing real,
 * because a mismatching golden does NOT spin until the clock runs out — once
 * `toHaveScreenshot` has captured two identical frames it compares once and
 * fails, diff attached (verified: the deliberate-break run below fails in two
 * captures). The ceiling is spent only by a frame that will not hold still,
 * which is the case it exists for.
 */
export const GOLDEN_SHOT_TIMEOUT_MS = Math.max(
  ...Object.values(DEVICE_MATRIX).map((frame) => shotBudgetMsFor(frame)),
);

// ── THE RETRY, AND WHY IT IS THE RIGHT INSTRUMENT FOR THE TAIL ──────────────
//
// Everything above sizes a budget from measured work × a slowdown allowance. It
// answers "how slow is the runner?" with one number, and that number cannot be
// right for both the typical run and the tail. Measured on this project:
//
//   the suite, in the studio container            ~1.5 min
//   the suite, on a normal GitHub runner          ~8.9 min   →  5.9×  (11659df)
//   the suite, on the runner that reddened main   47.2 min   → ~31×   (369d7a6)
//
// `CI_SLOW_FACTOR` is already 10 — the TOP of the 3–10× band LESSONS §5 records
// — and the 31× run still blew through it: the phone BUILD WHEEL golden hit its
// 90 s test budget (9 s measured × 10) and failed its single retry, taking `main`
// red on a baseline nobody disputes. There was no diff image, because nothing was
// ever captured to compare.
//
// Raising the factor is the wrong fix, and the arithmetic says why. At 31× that
// 9 s golden needs a 4.5-minute budget — and every budget in the suite grows with
// it, so a genuine hang would sit undetected for minutes behind a ceiling sized
// for the worst runner anyone has ever drawn. That trades a rare, loud red for a
// slow, silent one. A budget should be sized for the runner we normally get.
//
// A RETRY is sized for the runner we rarely get, and it is the correct shape for
// this failure specifically:
//
//   · the failure is a TIMEOUT — a contended runner, not a wrong frame — and a
//     re-run on a quieter slot is exactly what fixes it;
//   · a real pixel mismatch is DETERMINISTIC. The frozen scene is a pure function
//     of the seeded world (goldens.spec.ts), so a frame that differs from its
//     baseline differs on every attempt, and Playwright only reports `flaky`
//     when an attempt actually PASSES. An extra attempt therefore cannot turn a
//     regression green — it can only turn a timeout that was never about pixels
//     green. That is the claim a reviewer has to be able to check, and it is
//     checkable: tests/mobile-shot-budget-contract.test.ts pins the scope, and
//     the deliberate-break run in tests/reports/golden-retry-and-the-31x-runner-q9.md
//     shows a mismatching baseline failing all three attempts with a diff.
//
// The cost is bounded and only paid on a run that is already red: a failing
// golden now costs three attempts instead of two. Nothing that passes pays
// anything at all.
//
/**
 * Retries a golden gets ON CI, over and above the first attempt — so three
 * attempts in total, against the suite-wide two (`retries: 1`,
 * playwright.config.ts).
 *
 * Deliberately NOT the global. The suite-wide 1 stays where it is: the rest of
 * tests/mobile/ asserts on BEHAVIOUR (a tap lands, a lock holds, a wheel opens),
 * where a second re-run really could paper over a genuine intermittent bug in the
 * product. The goldens are the one family in the suite where the assertion is a
 * pure function of a frozen world, and that is what makes the extra attempt safe
 * here and nowhere else.
 */
export const GOLDEN_CI_RETRIES = 2;

/**
 * The retry count the golden file takes, given whether this is CI. Zero locally
 * — a golden that fails on this hardware is telling you something, and re-running
 * it twice more just costs a minute before it says the same thing.
 */
export function goldenRetriesFor(ci: boolean): number {
  return ci ? GOLDEN_CI_RETRIES : 0;
}

/** Resolved for this process; what goldens.spec.ts hands to `test.describe.configure`. */
export const GOLDEN_RETRIES = goldenRetriesFor(!!process.env.CI);
