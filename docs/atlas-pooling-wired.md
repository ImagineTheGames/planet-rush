# The atlas pooling, wired — a1-11

**The before is `docs/atlas-pooling-measured.md` (a1-10).** It measured the three
densest entity layers as one `Graphics` each, found the pooled path 6.7× cheaper
on the rocks, proved both pixel-free alternatives dead, and did **not** wire it —
because its own brief forbade moving a golden, and a raster of a vector is never
the vector. a1-11 lifted that constraint. This is the after.

Read that document for the box, the method, the two dead alternatives and the
`VfxAutoQuality` finding; none of it is repeated here except where the number
moved.

---

## 1. The headline

Rocks, turrets and shots draw from a shared texture pool. On the GDD §4.3 stress
scene, the **shipped** renderer went from

| | a1-10 (direct draw) | a1-11 (pooled) | |
|---|---:|---:|---|
| **draw calls / frame** | **263.0** | **32.1** | **8.2× fewer** |
| median frame (this box) | 96.90 ms | 53.10 ms | −45.2% |
| p95 frame (this box) | — | 59.20 ms | |
| fps (this box) | 10.3 | 18.8 | |

**And that is not under budget.** 53 ms is ~19 fps. Pooling the three layers the
brief names removes 231 of 263 draw calls and takes 43.8 ms out of the frame, and
the frame is still nowhere near 16.7 ms on this instrument. §3 names what is
still spending it, and the short answer is the one a1-10 already gave: **nothing
culls.** 668 bodies are submitted for a viewport that holds a couple of dozen.

The draw-call column is the one that travels (a1-10 §1): it is counted off
patched `WebGL2RenderingContext.prototype.draw*` calls, so 263 → 32 is the same
on a workstation, on integrated graphics and on a phone. **The milliseconds are
this box's**, and this box is a software rasteriser with no GPU. It cannot answer
the 60 fps gate and this document does not claim it does.

## 2. The measurement

Same rig, same box, same scene, same sampling as a1-10 — `spikes/atlas-pooling/`,
`node spikes/atlas-pooling/run.mjs`. The `shipped:whole-frame` scenario builds the
real `Renderer` and hands it `app.renderer` as the baker, which is exactly what
`src/main.ts` does in production; the only thing the rig supplies that a player
does not is the stress scene.

```
GPU     : ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
Viewport: 1280×800 @ dpr 1
Scene   : 8 ships · 32 turrets · 16 shields · 200 asteroids · 300 projectiles · 120 chunks
Sampling: 180 frames × 3 rounds, round 1 discarded
Raw     : evidence/a1-11-atlas-pooling/capture-after-final.json
```

**The whole frame, as shipped:**

| scenario | draws/frame | median ms | fps |
|---|---:|---:|---:|
| `shipped:whole-frame` — a1-10 | 263.0 | 96.90 | 10.3 |
| `shipped:whole-frame` — **a1-11** | **32.1** | **53.10** | **18.8** |
| `+reduceVfx` — a1-10 | 264.0 | 94.80 | 10.5 |
| `+reduceVfx` — **a1-11** | **33.1** | **50.20** | **19.9** |

**The A/B, re-run on the tip.** The rig measures both paths on every run whatever
the renderer ships, so these rows are a *control*: they should not have moved,
and they have not. That they reproduce a1-10's numbers to within 0.2 ms across
two sessions is what licenses the comparison above.

| scenario | draws/frame | layer ms — a1-10 | layer ms — a1-11 |
|---|---:|---:|---:|
| `rocks:graphics` | 200.0 | 26.10 | 26.10 |
| `rocks:sprites` | 1.8 | 3.90 | 4.00 |
| `turrets:graphics` | 32.0 | 8.30 | 8.40 |
| `turrets:sprites` | 1.0 | 3.70 | 3.70 |
| `shots:graphics` | 1.0 | 11.70 | 11.50 |
| `shots:sprites` | 1.0 | 3.50 | 3.40 |

*(`layer ms` is the median with the 3.1 ms empty-stage floor removed.)*

**46 textures carry the 200-rock field; 24 carry all 32 turrets; 4 carry 300
shots.** GDD §4.3's "a field of 200 rocks shares a couple of dozen textures" is
now a description of what production does, not of what an uncalled module could
have done.

### 2.1 The reducer, re-measured

a1-10's finding was that `VfxAutoQuality` buys back 2.1 ms of a 96.9 ms frame —
2.2%. On the wired build it buys back **2.90 ms of 53.10 ms — 5.5%**, and adds a
draw call doing it (the halo swaps a gradient for a ring).

The absolute number did not improve. The *ratio* did, and only because the
denominator shrank. The finding stands exactly as a1-10 wrote it: the escape
hatch GDD §4.3b names as the mitigation for risk 5 sheds decoration while the
frame's cost is the entity layers it does not touch. **This branch did not
re-tune it and must not** — it is ratified, and r9-01 has just fixed how it
degrades. It remains a finding for the developer.

## 3. What the frame costs now, and what it does not fix

The 32 draw calls that remain are, near enough, the layers this brief did not
name: 8 ships, 8 stations and 16 shields, each still one `Graphics` per body.
a1-10 §6B costs pooling those at about 22 more draw calls, landing the frame near
ten.

But **draw calls are no longer what the frame is made of.** 53.1 ms over a 3.1 ms
empty-stage floor is 50 ms of content behind 32 submissions, and the three layers
that were 231 of those submissions now cost 11.1 ms of it. What is left is
overdraw and geometry rebuild in the layers that still draw vectors every frame —
stations are redrawn per frame by construction — plus 120 ore chunks, plus the
VFX layer, and **all of it submitted whether or not it is on screen.**

So the ranking a1-10 gave is unchanged, and wiring the pooling has if anything
sharpened it:

1. **Cull off-screen entities.** a1-10 §4.1 measured the visible fraction exactly:
   **75 rocks of 200 on desktop, 6 of 200 on a landscape phone.** The rig's own
   `rocks:sprites+cull` row is 3.5 ms against `rocks:sprites`' 4.0 — but that is
   the rock layer *after* pooling has already flattened it. The prize is the
   layers pooling has not touched, and it is provably pixel-free: no golden can
   move, so it is verified by running the existing suite unchanged.
2. **Pool the remaining entity layers** (ships, stations, shields, chunks) — the
   `atlas.ts` keys already exist for most of them.

**Neither is this brief.** Reporting the frame as still-over-budget with those
named is worth more than claiming a win the measurement does not support.

## 4. The goldens

The brief expected the goldens to move and treated their movement as the proof
that something real changed. **They move, but far less than a1-10 predicted — and
the gate does not notice.**

The first fact, and it surprised me: a full `--update-snapshots` run of
`goldens.spec.ts` on the wired build **passed all 44 baselines and rewrote
nothing.** Playwright only rewrites a baseline when the comparison *fails*, and
the pooled raster lands inside `maxDiffPixelRatio: 0.01`. "The snapshots are
untouched" is this change's *default* outcome, not evidence that the wiring did
nothing.

So the re-baseline was taken deliberately, and measured rather than eyeballed.

### 4.1 How the delta was isolated

Diffing a fresh capture against the committed baseline answers the wrong
question, because it folds in every change that landed since that baseline was
shot. So the comparison is **fresh-capture vs fresh-capture**: the goldens were
re-shot from a worktree at `3d83e0b` (this branch immediately before the wiring)
and again at the tip, same container, same command, and the two sets diffed by
`evidence/a1-11-atlas-pooling/golden-delta.mjs`.

That third capture also settled which baselines could be trusted as a control.
**Nine baselines are byte-identical to a fresh pre-wiring capture** — including
all five frozen scenes and `desktop-hud-footer`. Those six are the frames this
change touches, and for every one of them the before-state is reproducible to the
byte, so **100% of what moved in them is this branch's.**

### 4.2 The six images re-cut, and what changed in each

`vis%` counts pixels whose worst channel moved by more than 12/255 — a much
stricter bar than the YIQ threshold `toHaveScreenshot` uses. `box` is where those
pixels lie.

| image | diff% | vis% | worst | box | what moved |
|---|---:|---:|---:|---|---|
| `desktop-frozen` | 1.600 | 0.158 | 79 | 0,16 838×764 | the rock field and the station's four turrets |
| `desktop-frozen-teams` | 1.544 | 0.141 | 79 | 1,20 837×752 | same frame, teams split |
| `phone-landscape-frozen` | 0.907 | 0.095 | 62 | 0,4 620×383 | same, at dpr 3 — fewer rocks on screen, so less of it |
| `phone-landscape-frozen-teams` | 0.861 | 0.083 | 60 | 1,4 619×381 | same, teams split |
| `phone-portrait-frozen-teams` | 0.864 | 0.084 | 60 | 5,1 381×619 | same, through the portrait rotation |
| `desktop-hud-footer` | 1.577 | 0.146 | 58 | 0,0 63×44 | one rock overlapping the top-left of the controls strip |

**Every box is the arena, and nothing else.** The in-match frames carry the
controls strip in the bottom-left rather than the build badge, so — unlike every
menu golden — these six contain no build-sha stamp, and there is no incidental
change mixed into them.

**What it looks like.** At display size the frames are indistinguishable; the
full-frame pair was compared side by side before anything was committed. Under
7–10× magnification the pooled bodies have **very slightly softer edges**, which
is the whole of the difference: silhouette, ore veins, crack stage, beacon ring,
turret trim segments and every colour are unchanged, and nothing moved position.
That is what the numbers say too — a mean delta of ~5/255 spread over edge
pixels, with the worst pixel at 79 and only 0.08–0.16% of the frame past the
strict threshold.

The softening is inherent to the technique GDD §4.3 asks for and is not a defect
in the wiring. A `Graphics` re-rasterises its vectors at the exact sub-pixel
position it lands on every frame; a `Sprite` samples a texture baked once, so a
non-integer scale and position resolve through bilinear filtering. It is bounded
deliberately: the bake density **is** the draw density (`ROCK_ART_SCALE` 64,
`TURRET_ART_SCALE` 48, `SHOT_ART_SCALE` 16), so every body minifies its texture
and none is ever magnified, and `autoGenerateMipmaps` keeps a 4× minified turret's
trim from crawling as the barrel turns. If it is ever judged too soft, the lever
is the bake density and the cost is texture memory — not a re-authoring.

### 4.3 What was deliberately NOT re-cut, and a finding for QA

The other 38 baselines were left alone, and the pre-wiring capture is why that is
defensible rather than lazy:

- **21 menu goldens** (title, settings, codex, doors, lobby, ship/map select…)
  differ from a fresh capture in **one 38×8 px region: the build-sha badge**
  (`src/platform/build-info.ts` draws it on every menu screen). 0.023% of a frame,
  and nothing to do with pooling. Re-cutting them would mean 21 images changed so
  that a corner could print a different seven characters.
- **The three pause frames** changed by a worst-case channel delta of **4/255** —
  the arena behind a dim scrim. Nothing is visible at any magnification.
- **`desktop-hud-top` and the eight wheel goldens were already stale before this
  branch existed**, and this is the finding. A fresh *pre-wiring* capture differs
  from the committed `desktop-hud-top` baseline across **87% of the band**: the
  baseline reads `TOTAL` where `src/ui/hud.ts` has rendered `ORE` since a0-03,
  over a lighter backdrop than a0-07 ratified. The wheel baselines are missing a
  shield ring and an ore-chunk cluster the current build draws.

  **They pass anyway.** `maxDiffPixelRatio: 0.01` counts only pixels past a
  per-pixel YIQ threshold, and a re-labelled 40×10 eyebrow plus a uniform backdrop
  shift clears neither bar at 1% of a 1280×96 band. So the gate has been green
  over a baseline that has not matched the shipped screen for some time.

  **Flagged, not fixed.** Re-cutting them here would smuggle another agent's
  un-baselined change into a Platform perf PR, and they are QA's and Art's
  baselines to re-cut. `golden-delta.mjs` is committed so the next owner can
  reproduce the list in one command.

## 5. What could not go through `src/art/atlas.ts`

`src/art/` is the Art agent's and was not edited. Two of the three layers
therefore could not use the atlas entry that appears to be for them, and both are
recommendations rather than complaints.

- **Rocks go through `atlas.asteroidTexture`** — it is exactly right, and its
  header has carried the "200 rocks share a couple of dozen textures" claim since
  M1 with nothing calling it. It is called now.
- **Turrets do not.** `turretTexture(cache, owner, state, size)` keys on
  `(owner, state)` and predates the Mk I–III ladder, so routing the renderer
  through it would draw every Mk II and Mk III barrel on the Mk I silhouette —
  a visible regression, which this brief forbids outright. `src/render/index.ts`
  carries the same key with `tier` restored.
  **Recommended to Art: add `tier` to `turretTexture`**, and the renderer switches
  back in a one-line change.
- **Shots do not.** `atlas.ts` has no shot entry at all; `shotSprite` lives in
  `src/art/vfx/shots.ts`. **Recommended to Art: `shotTexture(cache, family, tier,
  size)`.**

Two smaller things the wiring needed, both wrappers around Art's cache rather
than edits to it:

- **The bake must be framed on the art's ORIGIN.** `SpriteTextureCache` bakes with
  `generateTexture({ target })`, which crops to local bounds — centring a rock on
  its *bounding box*, so an asymmetric silhouette would draw offset from the point
  it collides at. `CenteredBaker` passes an explicit symmetric `frame`, plus an 8%
  margin so a stroke overhanging its declared extent is not clipped.
- **`autoGenerateMipmaps` on the bake.** Pixi warns off mipmapped render textures
  because they are usually re-rendered every frame; these are baked once each,
  ever, which is the case the warning is not about.

## 6. Recommendations

1. ~~**Cull off-screen entities**~~ — **DONE (a1-12,
   [`viewport-cull-measured.md`](./viewport-cull-measured.md)).** On the same rig
   and box, re-measuring this document's own baseline as the control: draw calls
   32.1 → 10.9 on the desktop window and 32.1 → **9.0** on the landscape phone,
   entities submitted 660 → 173 and 660 → **11**, median frame 53.2 → 38.0 ms and
   36.3 → **20.7 ms**. The 6-of-200 below is exactly what it now submits. Still
   not under budget on the desktop profile, and still on a box with no GPU.
   Original text, unchanged, for the record:

   **Cull off-screen entities** — a1-10 §6A, unchanged and now the top item by a
   wider margin. Platform-only, provably pixel-free, and it is the lever that
   attacks the mobile gate: 6 visible rocks of 200 on a landscape phone.
2. **Pool the remaining entity layers** — ships, stations, shields, chunks. The
   `atlas.ts` keys mostly exist; `tools/dark-matter-allowlist.json` now records
   which of them are dark-by-deferral with a wired precedent rather than dark by
   deadness.
3. **Art: `tier` on `turretTexture`, and a `shotTexture` entry** (§5).
4. **QA/Art: re-cut `desktop-hud-top` and the eight wheel goldens** (§4.3), and
   consider whether a full-frame `maxDiffPixelRatio` of 1% can catch a label
   change at all — it did not catch this one.
5. **Run the gate on real hardware.** `PERF_GATE=1 npx playwright test --config
   tests/perf/playwright.perf.config.ts`. Every millisecond in this document came
   from a box with no GPU. The 8.2× draw-call reduction travels; the 53.1 ms
   does not, in either direction.
