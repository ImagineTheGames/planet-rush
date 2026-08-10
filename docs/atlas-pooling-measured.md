# The atlas pooling, measured — a1-10

**Question.** `src/art/atlas.ts` carries a performance claim in its header: *"a
field of 200 rocks shares a couple of dozen textures (GDD §4.3: zero per-frame
allocation on the hot paths)"*. a1-09 found the file dark — **11 of its 12 value
exports uncalled.** `src/render/index.ts` imports one thing from it,
`asteroidArt`, and draws every entity as its own `Graphics`. Does the pooling pay
enough to wire, or is the honest fix to delete a claim nothing honours?

**Answer.** **It pays, decisively, and it is not a close call.** On the GDD §4.3
stress scene the 200-rock layer costs **26.1 ms and 200 draw calls a frame** as
it ships, and **3.9 ms and 1.8 draw calls** through `SpriteTextureCache`. The
same holds for turrets (8.3 → 3.7 ms, 32 → 1 draw call) and shots (11.7 → 3.5 ms,
300 baked looks → 4). `atlas.ts` should **not** be deleted; its keys are right and
its claim is true.

**But it was not wired under this brief**, and the reason is in §5: the pooled
path rasterises vector art, which moves the five frozen-scene goldens — and this
brief's own guard rail is *"if a golden moves you have changed appearance and
gone out of scope."* Wiring it is a Director-level call, costed below.

**And the measurement turned up something that outranks all of it** (§4): on the
reference capture `VfxAutoQuality` engages, and engaging it **buys back 2.1 ms of
a 96.9 ms frame — 2.2%.** The escape hatch GDD §4.3b names as the mitigation for
risk 5 sheds decoration, and the frame's cost is the entity layers it does not
touch. It degrades the picture and does not rescue the frame.

---

## 1. The box, and which numbers travel

```
GPU        : ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
Browser    : HeadlessChrome/131.0.6778.33 (Playwright 1.49.1), vsync and frame-rate cap disabled
Viewport   : 1280×800 @ dpr 1  — the `desktop` profile from tests/perf/playwright.perf.config.ts
Scene      : GDD §4.3, via harness/perf.ts `stressWorld()` —
             8 ships · 32 turrets · 16 shields · 200 asteroids · 300 projectiles · 120 chunks
Sampling   : 180 frames × 3 interleaved rounds, first round discarded;
             reported median is the median of the per-round medians
Raw        : evidence/a1-10-atlas-pooling/capture-swiftshader.json
Instrument : spikes/atlas-pooling/  (`node spikes/atlas-pooling/run.mjs`)
```

**This box has no GPU.** It rasterises WebGL in software through SwiftShader, so
its milliseconds are a software rasteriser's and **are not the integrated-graphics
gate**. That matters for how each number should be read:

- **Draw calls per frame are architecture and travel everywhere.** They are
  counted by patching `WebGL2RenderingContext.prototype.draw*` before any context
  exists, so they are the true submission count — the same on a workstation, on
  integrated graphics, and on a phone. Every load-bearing conclusion below rests
  on these.
- **Milliseconds are this box.** They are quoted as *ratios between paths
  measured back to back on the same box in the same run*, which is the part of a
  software-GL reading that does survive; they are not quoted as a verdict on the
  60 fps gate. QA's `tests/perf/frame-time.spec.ts` under `PERF_GATE=1` on real
  hardware is what settles that, and it should be re-run after any change here.
- **Entity counts are exact and hardware-free** — §4's on-screen numbers come
  from `src/render/draw-cost.test.ts`, which is arithmetic on the sim state.

Three method notes, each of which produced a wrong reading first:

1. **vsync off.** With it on, every path that fits inside 16.67 ms reports
   16.67 ms and the comparison says nothing.
2. **An empty-stage floor is measured and subtracted.** Every path pays the same
   clear+present at 1280×800 — 3.0 ms here. Raw medians flatter whichever path
   sits closest to that floor, so the column that decides anything is `layer ms`.
3. **Rounds are interleaved and the first is discarded**, so a warming machine
   cannot hand the win to whichever path happened to run last.

## 2. What is actually being compared

`src/render/index.ts` is **not** un-pooled, and the brief's framing of "the
pooling that never pooled" needs that correction to be read fairly. Every hot
path already key-guards its geometry — `asteroidKeys`, `turretKeys`,
`scaffoldKeys`, `shotKeys`, `stationDrawnDead`. A steady frame writes `x`, `y`,
`rotation` and `scale`, and rebuilds vector geometry only when a rock's crack
stage or a turret's telegraph actually moves. The zero-per-frame-allocation half
of GDD §4.3 is already honoured.

What is *not* honoured is the other half — §4.3's "**instanced sprites**". So the
question is not pooled-vs-unpooled. It is how the same pooled look reaches the
GPU:

| path | shape |
|---|---|
| `graphics` | one `Graphics` per entity, each with its own `GraphicsContext` — **what ships** |
| `sprites` | one `Sprite` per entity over a few `SpriteTextureCache` textures — **what `atlas.ts` keys** |
| `contexts` | one `Graphics` per entity, `GraphicsContext` pooled by look key |
| `+batch` | what ships, forced into the batcher with `batchMode: 'batch'` |
| `+cull` | what ships, with off-screen entities skipped |

`contexts` and `+batch` are not in the brief. They are here because they are the
two candidates that could have delivered the win **without rasterising anything**,
and ruling them out is what makes §5's conclusion binding rather than assumed.

## 3. The A/B

Empty-stage floor: **3.00 ms**. `layer ms` is the median with that floor removed.

| scenario | n | drawn | pooled | draws/frame | median ms | layer ms |
|---|---:|---:|---:|---:|---:|---:|
| `floor:empty` | 0 | 0 | 0 | 0.0 | 3.00 | 0.00 |
| `rocks:graphics` | 200 | 200 | 200 | **200.0** | 29.10 | **26.10** |
| `rocks:sprites` | 200 | 200 | 46 | **1.8** | 6.90 | **3.90** |
| `rocks:contexts` | 200 | 200 | 60 | 200.0 | 29.20 | 26.20 |
| `rocks:graphics+batch` | 200 | 200 | 200 | 200.0 | 29.00 | 26.00 |
| `rocks:graphics+cull` | 200 | 3 | 200 | 2.6 | 6.80 | 3.80 |
| `rocks:sprites+cull` | 200 | 3 | 7 | 1.0 | 6.50 | 3.50 |
| `turrets:graphics` | 32 | 32 | 32 | **32.0** | 11.30 | **8.30** |
| `turrets:sprites` | 32 | 32 | 24 | **1.0** | 6.70 | **3.70** |
| `shots:graphics` | 300 | 300 | 300 | 1.0 | 14.70 | **11.70** |
| `shots:sprites` | 300 | 300 | 4 | 1.0 | 6.50 | **3.50** |

### 3.1 Pooling pays

The rock layer is **6.7× cheaper** pooled and submits **111× fewer draw calls**.
Turrets are 2.2× cheaper and collapse 32 draw calls into 1. Shots already batch
into one draw call — their geometry is simple enough to clear Pixi's threshold —
and are still 3.3× cheaper pooled, because a batched `Graphics` re-uploads its
vertices every frame while a `Sprite` moves a quad.

`atlas.ts`'s own claim checks out too: **46 textures carried the 200-rock field**
at one bake size, and 24 carried all 32 turrets across their telegraph states.
"A couple of dozen textures" was the right order of magnitude.

### 3.2 Both pixel-free alternatives are dead

This is the finding that closes off the easy answer.

**Pooling the `GraphicsContext` instead of baking a texture does nothing.**
`rocks:contexts` folded 200 rocks onto 60 shared geometries and still cost
26.2 ms at 200 draw calls. Pixi shares the *geometry* but still issues a draw per
`Graphics`. Pooling geometry is not pooling submission.

**`batchMode: 'batch'` does nothing, and the reason is a bug-shaped gap in Pixi
8.6.6.** `GraphicsContextSystem.updateGpuContext` reads:

```js
if (context.customShader || batchMode === "no-batch") {
  gpuContext.isBatchable = false;
} else if (batchMode === "auto") {
  gpuContext.isBatchable = gpuContext.geometryData.vertices.length < 400;
}
```

There is no `batch` branch, and `GpuGraphicsContext`'s constructor never
initialises `isBatchable` — so asking for `'batch'` leaves the flag `undefined`,
which `GraphicsPipe` reads as false. **The mode that names the thing does not do
the thing.** The measurement agrees exactly: 200 draw calls, 26.0 ms, identical
to `'auto'`. It also explains the shipped behaviour: a rock's silhouette, veins
and cracks clear 400 vertices comfortably, so `'auto'` drops every rock out of
the batcher, and there is no supported way to put it back.

So there is **no way to collapse these draw calls that keeps the vectors.** The
win requires rasterising, and rasterising is what §5 is about.

## 4. The finding that outranks the A/B

The brief said to watch `VfxAutoQuality`, and that an engagement outranks the
micro-benchmark. It engages. What it buys is the problem.

| baseline (shipped `Renderer`, 668 entities) | median | fps | p95 | draws/frame | reducer |
|---|---:|---:|---:|---:|---|
| normal | 96.90 ms | 10.3 | 102.20 | 263.0 | **engages** |
| `setReduceVfx(true)` | 94.80 ms | 10.5 | 103.10 | 264.0 | engages |

**Engaging reduce-VFX buys back 2.10 ms of 96.90 — 2.2% of the frame.**

The 10.3 fps is this box's software rasteriser and is not a claim about
integrated graphics. **The 2.2% is not about the box at all.** It is structural:
`setReduceVfx` sheds impact glows, the backdrop's nebula, and the atmosphere
halo's gradient. It does not touch the 200 rocks, the 32 turrets or the 300
shots — and the draw-call column shows it, holding flat at 263→264. On any device
where the entity layers are the cost, the reducer removes picture and returns
almost nothing. GDD §4.3b lists "reduce VFX already in the settings menu as the
escape hatch" as the mitigation for risk 5; measured against the §4.3 scene, that
mitigation is not load-bearing.

*(Caveat, stated because it cuts against my own headline: this baseline renders
with `muzzles: []`, so no impact glows existed to shed and the 2.1 ms is the
backdrop and halo tiers alone. A frame with 32 turrets flashing would shed more.
The structural point stands regardless — the reducer's list contains no entity
layer, and the draw-call count is unmoved — but the 2.2% is a floor on what it
buys, not a ceiling.)*

### 4.1 And nothing culls

`grep -rn "cullable\|Culler\|cullArea" src/` is empty. The renderer submits the
whole arena every frame. From `src/render/draw-cost.test.ts`, on the §4.3 scene
with the camera on ship 0:

| | arena seen | rocks | chunks | turrets | shots | ships | **on screen / submitted** |
|---|---:|---:|---:|---:|---:|---:|---:|
| desktop 1280×800 | 17.8% | 75/200 | 22/120 | 4/32 | 62/300 | 1/8 | **164 / 660** |
| phone 844×390 | 5.7% | 6/200 | 0/120 | 4/32 | 0/300 | 1/8 | **11 / 660** |

A landscape phone submits **660 bodies to show 11**. That ratio is arithmetic on
the arena and the viewport — it holds on every device, and it is the *mobile*
gate, which GDD §4.3 makes the tighter of the two. The `+cull` rows in §3 show
what skipping them costs: nothing (3.80 ms, ~1 draw call).

Culling changes no pixel by construction — an entity outside the viewport
contributes none — so unlike the pooling it is not blocked by the goldens. It is
**not shipped here**: it is a different change from the one this brief
authorised, and widening a brief is how a neighbour gets cut. It is the
recommendation in §6.

## 5. Why the pooling was measured and not wired

The brief's decision rule was *"pooling pays → wire it"*. Its guard rail was
*"if a golden moves you have changed appearance and gone out of scope."* On this
codebase those two instructions cannot both be satisfied, and the conflict is not
a matter of care — it is arithmetic.

**A raster of a vector is not the vector.** The pooled path bakes each look once
and blits it; rock radii run 22–46 world units, so a bake resampled to 44–92 px
differs from directly-stroked geometry along every edge and every vein. There are
five frozen-scene goldens — `desktop-frozen`, `desktop-frozen-teams`,
`phone-landscape-frozen`, `phone-landscape-frozen-teams`,
`phone-portrait-frozen-teams` — at `maxDiffPixelRatio: 0.01`. Rocks, turrets and
ships cover far more than 1% of those frames. They would move, and they are
Art's and QA's baselines to re-cut, not Platform's.

**A second bill, found in the tests.** The render layer is headless today:
`src/render/*.test.ts`, `tests/sim-render-parity.test.ts` and
`tests/combat-visibility.test.ts` all build real Graphics geometry with no WebGL,
which is what lets CI assert the render tree on any runner. Baking a texture needs
a live `generateTexture`. Wiring the pooled path therefore means either injecting
a `TextureBaker` into `Renderer` **and keeping the Graphics path as a fallback for
when there isn't one** — two draw paths, where CI tests one and players see the
other, which is precisely the failure `8ae9121` ("prove the wire in the shipped
bundle, not in a stub") was written about — or those suites lose their
headlessness and the assertions with them.

Neither of those is a plumbing decision, so neither was taken here. **`atlas.ts`
is not deleted**: deletion was the honest fix only in the branch where the
pooling does not pay, and it pays.

## 6. Recommendation

Two follow-up briefs, in this order. The first is much larger than the second and
buys less on the gate that binds.

**A. Cull off-screen entities (`src/render/index.ts`).** Small, Platform-only,
provably pixel-free, and it attacks the *mobile* gate directly: 660 submissions
for 11 visible bodies. No golden can move, so it can be verified by running the
existing golden suite unchanged rather than re-baselining it. This is the one to
do first. The care needed is in the cull rectangle, not the idea: the canvas can
overhang the visual viewport (URL bar, notch — `camera.ts`), and the portrait
rotation path (`computeRootTransform`) puts the world under a rotated root, so
the margin has to be chosen against those two cases rather than against the
visible viewport alone.

**B. Wire the pooled path (`atlas.ts` → `src/render/index.ts`).** Bigger, and it
needs three decisions this brief could not take: a golden re-baseline (Art/QA), a
ruling on whether the render layer keeps its headless tests, and a bake
resolution for a dpr-3 phone. Worth it — pooling the three measured layers takes
the frame from 263 draw calls to about 34, and taking the stations and ships too
(the remaining ~30, which `atlas.ts` already keys with `stationTexture`,
`beaconTexture`, `damageRingTexture`, `shieldTexture` and `shipTexture`) would
land it near ten. But it is a milestone-sized change wearing a plumbing brief's
clothes.

**C. Raise `reduce-VFX` with the Director as a design question, not a bug.** The
auto-reducer works exactly as specified and its specification does not contain
anything that costs a frame. Whatever it should shed instead is a r9-01 question
(thinning, never vanishing mid-match), not a Platform one.

Whatever lands, re-run **both** instruments: `node spikes/atlas-pooling/run.mjs`
for the shape, and `PERF_GATE=1 npx playwright test --config
tests/perf/playwright.perf.config.ts` on real hardware for the gate. This document's
milliseconds came from a machine with no GPU and cannot answer the second one.

## 7. What was left pinned

`src/render/draw-cost.test.ts` asserts, headlessly and in CI, the two facts this
document rests on: that the renderer submits one display object per entity, and
that most of them are off screen. It fails the moment either changes — which is
the point. A deferred decision that lives only in a document is how `atlas.ts`
came to carry a pooling claim for a milestone with nothing calling it, and this
document would rot the same way without it (LESSONS §14).

The `tools/dark-matter-allowlist.json` reasons for `atlas.ts`'s eleven dark
exports have been updated from *"DARK — the texture pooling layer
src/render/index.ts bypasses"* to cite this measurement, so the next scan reads
"measured, pays, wiring deferred" rather than concluding that eleven uncalled
exports are eleven exports to delete.
