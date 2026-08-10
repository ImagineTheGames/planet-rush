# a1-10-the-pooling-that-never-pooled.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT
<!-- what is actually finished, with the commit that did it -->

Branch `agent/platform/a1-10-atlas-pooling-measured`, cut from `main` @ `0f84bf7`.

- `2e06ced` + `765a572` — **the A/B rig**, `spikes/atlas-pooling/`. Real WebGL in
  Chromium with vsync off, the GDD §4.3 stress scene from `harness/perf.ts`, draw
  calls counted by patching `WebGL2RenderingContext.prototype.draw*`. Carries its
  own `tsconfig.json` (root `include` has no `spikes`, and adding it breaks on
  three pre-existing spikes that belong to other agents). `README.md` says how to
  re-run it.
- `53535ad` — **the guard**, `src/render/draw-cost.test.ts`. Headless. Pins the
  two facts the report rests on so the deferral cannot rot in a document.
- `92be282` — **the deliverable**, `docs/atlas-pooling-measured.md`, plus the raw
  capture at `evidence/a1-10-atlas-pooling/capture-swiftshader.json`.
- `d71918c` — separate, shared-tooling: the eleven `atlas.ts` reason strings in
  `tools/dark-matter-allowlist.json` now read "dark by deferral, not deadness".

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

**The verdict: the pooling PAYS, and it was NOT wired.** Both halves matter.

Numbers (floor-subtracted, SwiftShader box, `docs/atlas-pooling-measured.md` §3):

    rocks    26.10 ms / 200 draws  →  3.90 ms / 1.8 draws   (46 textures for 200 rocks)
    turrets   8.30 ms /  32 draws  →  3.70 ms / 1.0 draw
    shots    11.70 ms              →  3.50 ms, 300 looks over 4 textures

**Why not wired.** The brief says "pooling pays → wire it" AND "if a golden moves
you have gone out of scope". A raster of a vector is never the vector, and there
are five frozen-scene goldens at `maxDiffPixelRatio: 0.01`. Those two
instructions cannot both be satisfied, and the goldens are Art's/QA's to re-cut.
Reported as a conflict in the doc's summary rather than resolved silently either
way. **`atlas.ts` is NOT deleted** — deletion was the honest fix only in the
branch where the pooling does not pay.

**Both pixel-free escape routes were measured and are dead.** This is what makes
the "not wired" conclusion binding rather than lazy:

- Pooling the `GraphicsContext` by look key: 200 rocks over 60 shared geometries,
  still **26.2 ms and 200 draw calls**. Pixi shares geometry, not submission.
- `batchMode: 'batch'`: **no-op in Pixi 8.6.6.** `updateGpuContext` has branches
  for `'no-batch'` and `'auto'` and none for `'batch'`, and `GpuGraphicsContext`'s
  constructor never initialises `isBatchable` — so asking for it leaves the flag
  `undefined`, which `GraphicsPipe` reads as false. Measured 200 draw calls,
  identical to `'auto'`. Read the source *after* the measurement agreed with it,
  not instead of measuring.

**Second bill on wiring, found in the tests, not guessed:** the render layer is
headless today (five suites build Graphics geometry with no WebGL). Baking needs
a live `generateTexture`, so wiring means either injecting a `TextureBaker` plus a
Graphics fallback — two paths, CI testing one and players seeing the other, the
exact failure `8ae9121` is about — or those suites lose their headlessness.

**The finding that outranks the A/B** (the brief said watch for it): the reducer
engages on the reference capture and buys back **2.1 ms of 96.9 — 2.2%**, draw
calls flat at 263→264. `setReduceVfx` sheds impact glows, the nebula and the halo
gradient; it touches no entity layer. Caveat stated in the doc because it cuts
against the headline: this baseline runs `muzzles: []`, so no glows existed to
shed and 2.2% is a floor on what it buys, not a ceiling.

**Rejected: shipping the culling.** Nothing culls (`grep cullable|Culler` empty)
and a landscape phone submits **660 bodies to show 11** — pixel-free by
construction, my file, huge, and aimed at the tighter (mobile) gate. It is still
a *different change from the one the brief authorised*, so it is §6's first
recommendation and not a commit. If a future session is told to widen: the care
is in the cull rectangle, not the idea — the canvas can overhang the visual
viewport (URL bar/notch, `camera.ts`), and `computeRootTransform`'s portrait path
puts the world under a rotated root.

**Rejected: measuring on `main` alone.** The brief's premise is that a2-07 wired
the VFX presenter. It has NOT merged (`git merge-base --is-ancestor 41ca60c HEAD`
→ not in main); it is six commits on `agent/art/a2-07-wire-the-vfx-presenter`.
The baseline here is therefore `main`'s frame, without particles, and the doc's
numbers are a floor for the post-a2-07 frame rather than a description of it.

**Traps hit, so a resume does not re-pay them.** `spikes/` is outside the root
tsconfig and three existing spikes fail to compile — hence the local project
file, never an edit to the root `include` (that would break the DoD's
`npx tsc --noEmit` on other agents' files). And the rig lost two capture runs to
a readiness poll using node's `fetch`, which refused a vite that was serving 200
to curl; it navigates with the browser now, and SIGKILLs vite so a survivor on
`--strictPort 5183` cannot break the next run.

## NEXT
<!-- what remains, in order, and anything blocking -->

Work is complete against the brief. **PR #372** is open and the branch is pushed.

DoD status:
- `npx tsc --noEmit` — **clean**.
- `npm test -- --run` — **276 files / 4798 tests passed**, 474 s.
- doc present on the remote branch — verified with the DoD's own
  `git cat-file -e FETCH_HEAD:docs/atlas-pooling-measured.md`.
- PR checks — running; nothing failing. The mobile-emulation shards carry the
  goldens, which is the real proof that "what renders" did not change, since this
  branch touches no render behaviour at all.

Nothing is blocked.

For whoever picks up the follow-up, `docs/atlas-pooling-measured.md` §6 ranks it:
**(A)** cull off-screen entities — small, pixel-free, verifiable by running the
goldens *unchanged*, and it hits the mobile gate hardest; **(B)** wire the pooled
path — worth it (263 draw calls → ~10) but it needs a golden re-baseline, a
ruling on the render layer's headless tests, and a dpr-3 bake resolution; **(C)**
`reduce-VFX` buying 2.2% is a design question for the Director under r9-01, not a
Platform bug.

Whatever lands, re-run both instruments — the rig for the shape, and
`PERF_GATE=1` `tests/perf/playwright.perf.config.ts` on real hardware for the
gate. This box has no GPU and cannot answer the second one.
