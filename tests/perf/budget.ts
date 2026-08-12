/**
 * tests/perf/budget.ts — the submission budget the CI half of the performance
 * gate asserts. OWNER: Platform Engineer (a1-16, closing `docs/gdd-conformance.md`
 * G-15).
 *
 * ## Why there is a table here at all
 *
 * GDD §4.3 states the performance budget as a scene and a frame rate, and closes
 * with *"Verified by the M5 performance gate, not assumed."* The gate has two
 * halves and they are not equally portable — this is the finding a1-10, a1-11 and
 * a1-12 all rested their conclusions on, and it is what this file encodes:
 *
 *  - **Draw calls per frame and entities submitted per frame are architecture.**
 *    N distinct `GraphicsContext`s cannot batch with each other whatever silicon
 *    they land on; a culled entity is not submitted on any device. These numbers
 *    travel from this box to integrated graphics and to a phone.
 *  - **Milliseconds are the box.** A GitHub runner draws WebGL through
 *    SwiftShader on a shared vCPU. Its frame time says nothing about a phone, in
 *    either direction.
 *
 * So the portable columns are gated here, in CI, on every push; the milliseconds
 * stay behind `PERF_GATE=1` on real hardware and stay **manual**. Which half is
 * which, what to run, and when the manual half is required: `docs/perf-gate.md`.
 *
 * ## Where the numbers come from
 *
 * Measured with `node spikes/atlas-pooling/run.mjs` (a1-10's rig, driving the
 * SHIPPED `Renderer` over the §4.3 stress scene from `harness/perf.ts`), and
 * re-measured by this brief on the current `main`. The history is the argument
 * for the ceilings:
 *
 * | | draw calls/frame | entities submitted |
 * |---|---|---|
 * | before pooling (a1-10) | ~263 | 660 |
 * | after pooling (a1-11) | 32.1 | 660 |
 * | after the viewport cull (a1-12), desktop | **10.9** | **173** |
 * | after the viewport cull (a1-12), phone landscape | **9.0** | **11** |
 *
 * ## How the ceilings are chosen, and what they are for
 *
 * The brief's requirement is the design: *"a regression that doubles submissions
 * should fail the build."* So each ceiling sits above the measured number by
 * enough margin to absorb an honest difference between GPUs, and far enough
 * below **twice** the measured number that a doubling is red. Concretely the
 * ceilings are ~1.5× the baseline, which puts the failure line at 1.5× and the
 * brief's doubling comfortably past it.
 *
 * The margin is not decoration. Draw calls travel far better than milliseconds
 * but they are not a constant of nature: Pixi's batcher flushes on its own
 * texture-unit budget, and `MAX_TEXTURE_IMAGE_UNITS` is 16 on some drivers and
 * 32 on others, so the same scene can legitimately land a call or two apart on
 * two machines. A gate with no margin at all would be a flake generator, and a
 * flaky gate gets deleted or ignored, which is a worse outcome than a slightly
 * loose one.
 *
 * ## And a FLOOR, which is the half people forget
 *
 * Every ceiling here has a floor under it. A renderer that crashed on boot, a
 * scene that failed to build, a cull with an inverted test — each of those
 * submits nothing and draws nothing, and against a ceiling alone every one of
 * them reads as a spectacular performance win. The floor is what makes "0 draw
 * calls" a failure instead of a triumph.
 */

/** One screen the gate is asserted on, and the numbers it is asserted against. */
export interface ProfileBudget {
  /** Matches the project names in `playwright.perf.config.ts`. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** What the rig measured on this profile when the budget was last set. */
  readonly measured: { readonly drawCalls: number; readonly submitted: number };
  /** Fail above this. ~1.5× `measured`, so the brief's doubling is red. */
  readonly maxDrawCalls: number;
  readonly maxSubmitted: number;
  /** Fail below this. A renderer drawing nothing must not read as a win. */
  readonly minDrawCalls: number;
  readonly minSubmitted: number;
}

/**
 * The two screens GDD §4.3 names, in the exact viewports
 * `tests/perf/playwright.perf.config.ts` uses — so the CI half and the manual
 * half are talking about the same two screens and the numbers stay comparable.
 *
 * The phone is the tighter gate ("60 fps on the developer's own phone … with a
 * 30 fps floor on a 3-year-old mid-range Android") and it is also where the cull
 * pays most: an 844×390 window sees under 6% of a 2400×2400 arena.
 */
export const PROFILE_BUDGETS: readonly ProfileBudget[] = [
  {
    name: 'desktop',
    width: 1280,
    height: 800,
    measured: { drawCalls: 10.9, submitted: 173 },
    maxDrawCalls: 16,
    maxSubmitted: 260,
    // The backdrop, the boundary and the atmosphere draw whatever the entity
    // layers do, so a live frame cannot be below a handful of calls.
    minDrawCalls: 3,
    // The camera is locked to ship 0, which sits in a field of 200 rocks: a
    // window that submits fewer than this is not showing the §4.3 scene.
    minSubmitted: 40,
  },
  {
    name: 'phone-landscape',
    width: 844,
    height: 390,
    measured: { drawCalls: 9.0, submitted: 11 },
    maxDrawCalls: 14,
    // 11 measured. The absolute number is small enough that one extra rock
    // drifting into a 844×390 window is a large percentage, so this ceiling is
    // set on the arithmetic (~1.5×, rounded up to a whole entity) rather than
    // shaved to the measurement.
    maxSubmitted: 18,
    minDrawCalls: 3,
    // The local ship and the rocks around it. Below this the phone window is
    // submitting essentially nothing, which is the inverted-cull failure.
    minSubmitted: 3,
  },
] as const;

/** Frames rendered before counting: shader compiles, the first texture bakes,
 *  and every look key's first build land here rather than in the count. */
export const WARMUP_FRAMES = 40;

/** Frames counted. Draw calls per frame are an average over these — the count is
 *  near-constant frame to frame, so this is about smoothing the one frame a look
 *  key rebuilds on, not about a distribution. */
export const COUNTED_FRAMES = 60;
