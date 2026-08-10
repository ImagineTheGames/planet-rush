# a1-10-the-pooling-that-never-pooled.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT
<!-- what is actually finished, with the commit that did it -->

- Branch `agent/platform/a1-10-atlas-pooling-measured` cut from `main` @ `0f84bf7`.
- `2e06ced` — the A/B rig: `spikes/atlas-pooling/{bench.html,bench.ts,run.mjs,tsconfig.json}`.
  Real WebGL in Chromium with vsync off, the GDD §4.3 stress scene from
  `harness/perf.ts`, draw calls counted by patching `WebGL2RenderingContext`.

### First numbers (box: ANGLE / SwiftShader — software GL, no GPU)

    baseline (SHIPPED renderer, 668 entities)
      median 97.10 ms · 10.3 fps · 263 draw calls/frame · VfxAutoQuality: ENGAGES

    scenario           n     pooled  draws/f   median ms
    rocks:graphics     200   200     200.0     31.20      <- what ships
    rocks:sprites      200    60       3.5      7.10      <- atlas.ts's path
    rocks:contexts     200    58     200.0     27.90
    turrets:graphics    32    32      32.0     11.30
    turrets:sprites     32    24       1.0      6.80
    shots:graphics     300   300       1.0     14.00
    shots:sprites      300     4       1.0      6.30

Read with care — there is a ~6 ms empty-stage floor in every row (clear+present
at 1280×800), which is why the rig now measures that floor explicitly. Marginal
rock-layer cost is therefore ~25 ms vector vs ~1 ms pooled.

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

**The premise needed checking before the measurement.** `a2-07` ("just wired the
VFX presenter") is **not on `main`** — `git merge-base --is-ancestor 41ca60c HEAD`
says NOT-in-main; it lives on `agent/art/a2-07-wire-the-vfx-presenter` with 6
commits. So the "particles are drawing for the first time" frame is not the
frame `main` renders today. Measurement plan therefore covers BOTH: `main`'s
scene, and `main` + `a2-07` merged locally, so the number the brief is worried
about actually exists.

**What "the direct-draw path" actually is.** `src/render/index.ts` is not
un-pooled. Every hot path already key-guards its geometry: `asteroidKeys`,
`turretKeys`, `scaffoldKeys`, `shotKeys`, `stationDrawnDead`. Geometry is
rebuilt only on a look change; a steady frame writes transforms only. So the
brief's A/B is **not** "pooled vs unpooled" — it is:

  - A: one `Graphics` (own `GraphicsContext`) per entity, geometry key-guarded
  - B: one `Sprite` per entity, all sharing ~N `Texture`s from
    `SpriteTextureCache` (what `atlas.ts` exists to key)

The difference that can actually move a frame is **batching**: N distinct
GraphicsContexts cannot batch with each other; N Sprites over a few textures
collapse into a handful of draw calls. That is the number to measure, and it is
hardware-independent, which matters because this box has no real GPU.

**The tension the numbers create, which the brief does not resolve.** Pooling
pays, hugely. But the brief also says *"if a golden moves you have changed
appearance and gone out of scope"* — and a raster of a vector is never
pixel-identical to the vector. There are five frozen-scene goldens
(`tests/mobile/goldens.spec.ts-snapshots/*frozen*`) at `maxDiffPixelRatio: 0.01`.
So "wire it" and "move no golden" cannot both be satisfied by the texture path,
and the goldens are not my files to re-baseline.

Two things follow, and both are being measured before anything is written:

1. **`batchMode: 'batch'`** — Pixi decides batchability per context on one line
   (`GraphicsContextSystem`: `isBatchable = vertices.length < 400`), and a rock
   clears 400 comfortably, which is *why* 200 rocks are 200 draw calls. Forcing
   the batch keeps the identical triangles and only changes the submission path,
   so it is the one candidate that cannot move a pixel by construction. Whether
   it is fast is the open question (a forced batch re-uploads vertices every
   frame instead of drawing a static geometry).
2. **Culling** — nothing in `src/render/` culls (`grep cullable|Culler` is
   empty). A 1280×800 window sees 18% of a 2400×2400 arena; a 844×390 phone sees
   under 6%. So ~5–17× of the rock draw calls are for rocks that are not on the
   screen. Also cannot move a pixel, by definition. Measured as a control here;
   **shipping it is a widening of this brief**, so it is a recommendation, not a
   commit, unless the Director says otherwise.

**A second cost of the texture path, found while reading the tests.** The render
layer is headless-testable today — `src/render/*.test.ts`,
`tests/sim-render-parity.test.ts` and `tests/combat-visibility.test.ts` all build
Graphics geometry with no WebGL. Baking textures needs a live
`generateTexture`, so wiring it means either a `TextureBaker` injected into
`Renderer` plus a Graphics fallback when there isn't one — two draw paths, one of
which is what CI tests and the other of which is what ships (the exact failure
`8ae9121` was written about) — or those five suites lose their headlessness.
That is a real architectural bill and it belongs in the decision.

## NEXT
<!-- what remains, in order, and anything blocking -->

1. Final capture with the floor, the culled control, `batchMode: 'batch'`, and
   the reduce-VFX baseline pair.
2. Decide and write `docs/atlas-pooling-measured.md`.
3. Whatever the decision permits inside this brief's scope, with the goldens run
   as proof that what renders did not change.
