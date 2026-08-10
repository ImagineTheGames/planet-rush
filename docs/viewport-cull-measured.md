# Submit what is on screen — the viewport cull, measured (a1-12)

**Owner:** Platform Engineer · **Branch:** `agent/platform/a1-12-viewport-cull`
**Predecessors:** [`atlas-pooling-measured.md`](./atlas-pooling-measured.md) (a1-10, the
characterisation) and [`atlas-pooling-wired.md`](./atlas-pooling-wired.md) (a1-11, the wiring).

---

## 1. Summary

a1-11 pooled the dense entity layers and reported the result honestly: **263 draw
calls → 32.1, median frame 96.9 ms → 53.1 ms, and still not under budget.** Its
closing analysis named what was left, and it was not pooling: *all of it is
submitted whether or not it is on screen.* a1-10 §4.1 had already measured the
gap exactly — a 1280×800 desktop window contains 75 of the 200 rocks, a 844×390
landscape phone contains **6**.

a1-12 culls to the viewport. On the same box, the same rig and the same GDD §4.3
scene, back to back:

| | draw calls / frame | entities submitted | median frame |
|---|---|---|---|
| **desktop** 1280×800 | 32.1 → **10.9** (−66%) | 660 → **173** (−74%) | 53.2 → **38.0 ms** (−29%) |
| **landscape phone** 844×390 | 32.1 → **9.0** (−72%) | 660 → **11** (−98.3%) | 36.3 → **20.7 ms** (−43%) |

**The conclusion rests on the draw-call and submission columns, not on the
milliseconds.** a1-11's caveat stands and is inherited: this box is SwiftShader
with no GPU, so the counts travel to real hardware and the timings do not.

Two further readings, stated because they cut in opposite directions:

- **On the phone, `VfxAutoQuality` no longer engages on the §4.3 stress scene.**
  It engaged before, on every capture. That is a behavioural change in the
  player's favour — the auto-reducer exists to shed VFX when the frame collapses,
  and on this profile the frame no longer collapses far enough to ask it to.
- **The desktop scene is still not under budget** — 38.0 ms is ~26 fps, against a
  16.67 ms frame. On a box with no GPU. What is still spending it is §5.

---

## 2. Method

The instrument is a1-10's rig (`spikes/atlas-pooling/`), extended by this brief
with a **landscape-phone profile** and a `submitted` column. Re-run it with:

```
node spikes/atlas-pooling/run.mjs --json evidence/a1-12-viewport-cull/capture-after-a1-12.json
```

`shipped:whole-frame@<profile>` drives the **real `Renderer`** with the real
baker, exactly as `main.ts` does, on the GDD §4.3 stress scene from
`harness/perf.ts` (8 ships, 32 turrets, 16 shields, 200 asteroids, 300
projectiles, 120 chunks). Draw calls are counted by patching
`WebGL2RenderingContext.prototype.draw*`; frame time is an uncapped
`requestAnimationFrame` delta with vsync off. 180 frames × 3 rounds, round 1
discarded, medians of per-round medians.

Both profiles resize the **canvas** as well as the camera viewport. Quoting a
844×390 viewport over a 1280×800 render target would charge the phone for pixels
it does not have.

**The before column is a fresh capture, not a quotation.** a1-11's numbers were
taken on a different day; a comparison across two boxes proves nothing. So the
pre-cull side was measured from a `git worktree` at a1-11's tip with **this
revision of `bench.ts` and `run.mjs` copied in** — same instrument, same box,
same session, only the renderer differs. The control it gives is the strongest
line in this document:

> re-measured a1-11, desktop: **53.2 ms · 32.1 draw calls**
> a1-11's own reported figure: **53.1 ms · 32.1 draw calls**

Raw captures: `evidence/a1-12-viewport-cull/capture-before-a1-11.json` and
`capture-after-a1-12.json`, with the console tables beside them.

---

## 3. The numbers

Box: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` — **no GPU.**

### 3.1 Draw calls per frame — the column that travels

| profile | a1-11 | a1-12 | change |
|---|---|---|---|
| desktop 1280×800 | 32.1 | **10.9** | −66% |
| desktop, reduce-VFX | 33.1 | **11.9** | −64% |
| phone 844×390 | 32.1 | **9.0** | −72% |
| phone, reduce-VFX | 33.1 | **10.0** | −70% |

Note that pre-cull the two profiles are *identical* at 32.1. That equality was
the finding: the same field cost the same submissions however little of it the
device could show.

### 3.2 Entities submitted

`submitted` counts display objects the renderer left **visible** in the five
entity layers (asteroids, chunks, ships, turrets, shots). The arena holds 660 of
them on this scene (668 including the eight stations, which are not in this
count).

| profile | a1-11 | a1-12 |
|---|---|---|
| desktop | 660 | **173** |
| phone | 660 | **11** |

Per layer, counted headlessly on the identical deterministic scene — the browser
rig and the headless count agree exactly, 173 and 11:

| layer | in the arena | desktop | phone |
|---|---|---|---|
| asteroids | 200 | 80 | **6** |
| ore chunks | 120 | 22 | 0 |
| ships | 8 | 1 | 1 |
| turrets | 32 | 4 | 4 |
| shots | 300 | 66 | 0 |
| **total** | **660** | **173** | **11** |

**Six of two hundred.** That is a1-10 §4.1's number, reproduced by the shipped
renderer, and it is now also the number it submits.

### 3.3 Median frame time — the column that does not travel

| profile | a1-11 | a1-12 | change |
|---|---|---|---|
| desktop | 53.2 ms (18.8 fps) | **38.0 ms** (26.3 fps) | −28.6% |
| desktop, reduce-VFX | 50.2 ms | **35.8 ms** | −28.7% |
| phone | 36.3 ms (27.5 fps) | **20.7 ms** (48.3 fps) | −43.0% |
| phone, reduce-VFX | 34.2 ms | **18.4 ms** | −46.2% |

### 3.4 Would `VfxAutoQuality` engage?

Replayed through the real state machine (`src/platform/vfx-quality.ts`), the same
one `main.ts` feeds:

| profile | a1-11 | a1-12 |
|---|---|---|
| desktop | YES | YES |
| phone | YES | **no** |

`VfxAutoQuality` is ratified and `r9-01` owns how it degrades; nothing here
changes it. This is a report that the phone profile stopped tripping it, not a
change to it.

---

## 4. What the cull actually does

`src/render/cull.ts` is pure, DOM-free and PixiJS-free, for the same reason
`camera.ts` is: the cull and the camera must agree exactly about where the screen
is, and the cheapest way to guarantee that is to make the cull a function of the
camera's own output. `writeVisibleWorld` inverts the offset `centerCamera` just
wrote onto the world root. There is no second notion of "on screen" in this
layer, and the debug seam (`?debug=1`) reports the same viewport.

Three properties, in the order they matter:

**Visibility, never existence.** A body is skipped only when it cannot contribute
a pixel. The test is against its *drawn* extent — its collision radius times the
widest look its layer wears (`RENDER_EXTENT`), times the bake margin — so an
entity straddling the edge still draws. `RENDER_EXTENT` holds an upper bound per
layer (rock 1, turret 2.2, shot 1.48, ship 1.16, shield 1.15, chunk 1), and
`cull.test.ts` enumerates every look each art generator can produce and fails if
one ever grows past its entry. A wider muzzle telegraph cannot silently start
clipping at the screen edge.

**Slots are indexed by identity, never by a count of survivors.** The obvious cull
— `if (!visible) continue` over a running counter — quietly destroys the pooling
a1-11 just built: slot *j* would hold a different rock every time the visible set
shifted by one, so a single rock leaving the left edge would miss the look key of
every rock behind it and re-swap ~75 textures in a frame. So the slot is the
rock's index in the field, the projectile's index in the sim's own recycled pool,
and `(station × mount slot)` for a gun.

**Nothing is destroyed.** Culled bodies keep their pooled slot and come back on a
`visible` flag when the camera pans. The frame stays allocation-free (GDD §4.3).

Layers culled: asteroids, ore chunks, ships, shots, station bodies, station
overlays, atmosphere halos, turrets, build scaffolds, muzzle flashes (as
segments — a flash fired from off screen at something on screen crosses the
window) and impact glows.

---

## 5. What is still spending the frame

The desktop scene is still ~26 fps on this box. The cull removed submissions; it
did not remove pixels, and the remaining cost is largely fill:

- **The void backdrop** is drawn in screen space and covers the whole canvas
  every frame whatever the world does. The cull cannot touch it by construction.
- **The atmosphere halo** is one baked quad, but a large translucent one at
  `DEPOSIT_RANGE` (256 world units across), and it is on screen whenever the
  player is near home — i.e. usually.
- **Overdraw among the survivors.** 80 rocks in a 1280×800 window is a dense
  field; they batch into a couple of draws but still blend their own texels.
- **This box has no GPU.** Fill is the thing SwiftShader is worst at, so the
  milliseconds here overstate what fill costs on real hardware — which is exactly
  why the conclusion rests on §3.1 and §3.2.

The honest next lever is a real-hardware reading, not another software-GL round:
`PERF_GATE=1 tests/perf/playwright.perf.config.ts`. This box cannot answer the
60 fps question and never could.

---

## 6. Found on the way, reported and NOT fixed: a station body does not follow its station

The frozen-scene goldens are the alarm on this brief, and they fired. Two phone
TEAMS baselines differed by ~9 250 px (3% of the frame), identically across three
retries. The isolation, using a1-11's own method:

1. A worktree at a1-11's tip **reproduces its committed baselines exactly**
   (`3 passed`), so the delta is this branch's.
2. Both scene graphs were then dumped off a real boot at the golden's own
   profile, with the golden's own staging.

The cull had not dropped anything. It had made something **appear**:

```
a1-11   station-1 body at (336, 1200)    station-overlay-1 at (2088, 1340)
a1-12   station-1 body at (2088, 1340)   station-overlay-1 at (2088, 1340)
```

`Renderer.stationBody` writes its transform only on the frame it (re)builds the
geometry — once per match — so **a station that moves afterwards leaves its body
behind**, while its overlay, repositioned every frame, follows. The `?debug=1`
nameplate seam (`window.__nameplateStage.stageBot()`) teleports a rival's home
beside the local ship to stage a label, so those two baselines had baked a
station drawn as a bare damage ring with no body under it. Delaying the body's
creation until it was on screen made it get built *after* the teleport, at the
right place.

**It is not fixed here.** Fixing it moves those two frozen goldens for real, and
re-cutting frozen scenes is not this brief's mandate — its guard rail is that the
goldens must not move. Instead the cull was scoped so it cannot interact with the
bug at all: the body is built on exactly the frames a1-11 built it on (it is
drawn once per match, so delaying it saved nothing), and its visibility test is
taken **at the position the body is actually drawn at**, read off the display
object rather than off the sim. The cull therefore cannot hide a body that is on
screen, wrongly placed or not. All 44 goldens pass unchanged.

For whoever picks it up: the fix is two assignments in `stationBody`, for ≤8
stations, and it needs `phone-landscape-frozen-teams` and
`phone-portrait-frozen-teams` re-cut with the justification that the station body
now sits under its own ring. In the sim proper, stations never move, so nothing
in a real match reads wrong today.

---

## 7. Not done, and why

- **The VFX particle layer is not culled.** `src/art/vfx/layer.ts` is Art's file
  and `VfxLayer.draw(pool)` has no cull seam; widening it is a cross-owner change
  to a ratified layer. Particles are also emitted at combat and mining events —
  overwhelmingly at the thing the camera is following — so the expected win is
  small. **Recommended to Art: `draw(pool, visible?: CullBox)`**, taking the box
  `Renderer.visibleWorld` already exposes.
- **A screen-space pad for the URL bar was considered and rejected.** The visual
  viewport can grow (URL bar hides) before `relayout` fires, revealing a band the
  cull had skipped. It is not padded for: a canvas that has not been resized yet
  already shows a backdrop gap in that band, so it is a pre-existing one-frame
  reflow artefact rather than something the cull introduces — and on the phone a
  96 px pad would cost most of the win it exists to protect (844×390 → 1036×582
  is 1.8× the area).
- **`VfxAutoQuality` is untouched** (ratified; `r9-01` owns its degradation), and
  so are a1-11's pooling and a2-07's VFX wiring. The cull sits in front of them.

---

## 8. Where the guard rails live

- `src/render/cull.test.ts` — the pair, layer by layer: an entity off screen is
  not submitted, one straddling the edge is. Plus the `RENDER_EXTENT` guard that
  enumerates the art generators.
- `src/render/draw-cost.test.ts` — the post-cull shape, as a sandwich: nothing
  visible may be missing, nothing beyond the reach of its own art may be present.
  It fails if the frame's shape changes, which is the point.
- `tests/mobile/goldens.spec.ts` — unchanged, and the alarm that caught §6.
