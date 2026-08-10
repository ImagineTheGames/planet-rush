# a1-10-the-pooling-that-never-pooled.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT
<!-- what is actually finished, with the commit that did it -->

- Branch `agent/platform/a1-10-atlas-pooling-measured` cut from `main` @ `0f84bf7`.

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

## NEXT
<!-- what remains, in order, and anything blocking -->

1. Build the A/B rig (`spikes/atlas-pooling/`): real Pixi WebGL in a real
   browser, the GDD §4.3 stress scene from `harness/perf.ts` (`stressWorld`),
   both paths, same frame.
2. Instrument draw calls (hook `WebGL2RenderingContext.prototype.draw*`) and CPU
   ms in `renderer.render()`.
3. Run `VfxAutoQuality` over the captured frame deltas — does it engage?
4. Write `docs/atlas-pooling-measured.md`; decide wire-vs-delete on the numbers.
