# The performance gate: which half is automatic, which half is yours

*a1-16, closing `docs/gdd-conformance.md` **G-15**. Owner: Platform Engineer.*

GDD §4.3 states the browser performance budget as a scene and a frame rate, and
ends with a promise:

> 8 ships, up to 32 turrets (design cap 4 × 8 facilities), ~200 asteroids,
> hundreds of projectiles at 60 fps on integrated graphics … **Mobile gate:**
> 60 fps on the developer's own phone … with a 30 fps floor on a 3-year-old
> mid-range Android. … **Verified by the M5 performance gate, not assumed.**

The gate exists. Until this document, **part of it only ran when somebody
remembered to run it**, and nothing said so. `docs/gdd-conformance.md` G-15 filed
it as *"correct engineering; a standing manual obligation the GDD does not
describe as manual."* The night that finally forced the issue put four
render-path changes in one evening — a1-11's atlas pooling, a1-12's viewport
cull, a2-07's VFX layer, u14-01's typefaces — against a gate documented as
automatic that nobody had run.

This document is the missing half of that sentence. **Section 1 is the whole
answer**; everything after it is the working.

---

## 1. The three parts, and who runs each

| | What it asserts | Where it runs | Automatic? |
|---|---|---|---|
| **Sim** | Tick cost at §4.3 entity counts, against the sim's quarter of a 60 fps frame | `tests/harness/perf.test.ts`, in `npx vitest run` | **Yes** — every push |
| **Renderer, portable** | Draw calls per frame, entities submitted per frame, on the §4.3 scene, on both §4.3 screens | `tests/perf/draw-budget.spec.ts`, CI job *Perf gate — submission budget* | **Yes** — every push *(new: a1-16)* |
| **Renderer, milliseconds** | p95 / median frame time against 60 fps and the 30 fps floor | `tests/perf/frame-time.spec.ts` behind `PERF_GATE=1` | **NO. A HUMAN, ON REAL HARDWARE.** See §4 |

If you read nothing else: **CI cannot tell you the game runs at 60 fps, and it
never will.** It can tell you the renderer is still submitting a windowful
instead of an arena, which is what actually regresses. The frames-per-second
question belongs to a laptop and a phone, and §4 says when you owe it.

---

## 2. Why the split is where it is

This is not a compromise; it is the finding a1-10, a1-11 and a1-12 each rested
their conclusions on, stated once:

> *"this box is SwiftShader with no GPU. The draw-call column is counted off
> patched `WebGL2RenderingContext.prototype.draw*` and **travels** to integrated
> graphics and to a phone. The milliseconds **do not** — in either direction."*

**Draw calls and submissions are architecture.** N distinct `GraphicsContext`s
cannot batch with each other on any silicon. An entity the cull skipped is
submitted on no device. Change the renderer's submission shape and the number
moves identically everywhere; change the GPU and it does not move at all. A
GitHub runner can assert these honestly.

**Milliseconds are the box.** Here is this lane's machine — a container with no
GPU at all — running the frame-time suite in measure-only mode against the
shipped bundle, tonight, on the current tree:

```
[perf] desktop steady state:         median  50.00 ms (20.0 fps) · p95  66.60 ms
[perf] desktop thrust+fire:          median  50.00 ms (20.0 fps) · p95  50.10 ms
[perf] phone-landscape steady state: median 116.70 ms ( 8.6 fps) · p95 133.40 ms
[perf] phone-landscape thrust+fire:  median 100.00 ms (10.0 fps) · p95 116.70 ms
```

Those numbers say **nothing whatsoever** about a phone. The phone profile is dpr
3, so SwiftShader is filling 2532×1170 pixels in software; that is the reading of
a CPU rasteriser, not of a GPU that does this in hardware. Publishing a gate
against them would be one of two lies — a threshold loose enough to pass here
would pass anything, and a threshold that means 60 fps would fail every CI run
forever. **A green "60 fps" from a GPU-less runner is worse than no claim,
because it reads as verification.** So `draw-budget.rig.ts` does not measure a
frame time at all. Not "measures and ignores" — does not collect one. The surest
way never to publish that number is never to have it.

---

## 3. The automatic half — the submission budget

### Run it

```sh
npm run test:perf-budget                        # ~20 s, no GPU needed
PERF_BUDGET_SCALE=0.5 npm run test:perf-budget  # …and watch it go red
```

CI runs the first line on every push, in its own job, so it never lengthens the
merge gate. Its files:

| File | What it is |
|---|---|
| `tests/perf/budget.ts` | The thresholds, with the measurement each came from |
| `tests/perf/draw-budget.rig.ts` + `.html` | The shipped `Renderer` over the §4.3 stress scene, `draw*` counted off the patched WebGL2 prototype |
| `tests/perf/draw-budget.spec.ts` | The assertions |
| `tests/perf/playwright.draw-budget.config.ts` | Its config — the rig page is deliberately **not** in the production bundle, so this half runs against the dev server |

### What it measures

`harness/perf.ts`'s `stressWorld()` — the §4.3 scene at full entity counts, 660
entities — drawn by the **shipped** `src/render` `Renderer` (with the texture
baker `main.ts` injects, and `setReduceVfx(false)` so CI and a laptop measure the
same renderer). 40 warm-up frames, then 60 counted, per screen. One rock walks
down a crack band per frame, exactly as `spikes/atlas-pooling/bench.ts` does, so
the numbers are comparable with a1-12's and so a regression that rebuilds
geometry every frame cannot hide behind a frozen scene.

### The numbers, today

Measured on this lane's box (`ANGLE / SwiftShader`, no GPU), current `main` plus
this branch. The draw-call column should reproduce on any machine; the couple of
tenths' difference from a1-12 is the shorter counting window, not a change.

| screen | draw calls / frame | entities submitted | of | ceiling (draws / submitted) | floor |
|---|---|---|---|---|---|
| desktop 1280×800 | **10.8** | **173** | 660 | 16 / 260 | 3 / 40 |
| phone landscape 844×390 | **9.1** | **11** | 660 | 14 / 18 | 3 / 3 |

And the history that makes those ceilings mean something:

| | draw calls / frame | entities submitted |
|---|---|---|
| before pooling (a1-10) | ~263 | 660 |
| after pooling (a1-11) | 32.1 | 660 |
| after the viewport cull (a1-12) — desktop | 10.9 | 173 |
| after the viewport cull (a1-12) — phone | 9.0 | 11 |

**Ceilings are ~1.5× the measurement**, which puts the brief's requirement — *a
regression that doubles submissions fails the build* — comfortably in the red
with margin left over for an honest cross-machine difference. The margin is not
decoration: Pixi's batcher flushes on its own texture-unit budget, and
`MAX_TEXTURE_IMAGE_UNITS` is 16 on some drivers and 32 on others, so the same
scene can legitimately land a call or two apart on two GPUs. A gate with no
margin is a flake generator, and a flaky gate gets ignored — which is a worse
outcome than a slightly loose one.

**Every ceiling has a floor under it.** A renderer that threw on boot, a scene
that failed to build, or a cull with an inverted test all submit nothing and draw
nothing — and against a ceiling alone, every one of those reads as a spectacular
performance win. The floor is what makes zero a failure instead of a triumph.

There is a third assertion with no threshold at all: **the phone must submit
fewer entities than the desktop off the same field.** Before a1-12 those two
numbers were equal, and that equality *was* the bug — the same arena cost the
same submissions however little of it the device could show. That test goes red
the moment the cull stops being a function of the window.

### When it goes red

It is telling you the renderer's submission shape changed. In order:

1. Re-measure with the full instrument: `node spikes/atlas-pooling/run.mjs`.
   It prints the same columns plus the milliseconds and the A/B scenarios.
2. Decide whether the change is worth its cost. Sometimes it is — a new layer
   that draws something the game needs is not a regression.
3. If it is worth it, move the baseline **with the measurement**: update
   `measured` and the ceilings in `tests/perf/budget.ts` together, and update the
   table above. **Do not raise a ceiling to fit a run.** The number in that file
   is a claim about the renderer; editing it without a measurement behind it is
   how `src/art/atlas.ts` carried a pooling claim for a whole milestone with
   nothing calling it (a1-09).

### Proof it can fail

LESSONS §24: a gate nobody has seen fail is not known to be a gate. Two
demonstrations, both captured in `evidence/a1-16-perf-gate/`:

**A real regression** (`red-cull-disabled.txt`) — `touchesBox()` in
`src/render/cull.ts` forced to `return true`, i.e. the cull stops culling, then
reverted. All three tests red, and the failure reads as exactly the thing that
broke:

```
desktop:         Expected: <= 16   Received: 32.15   draw calls/frame
phone-landscape: Expected: <= 14   Received: 32.15   draw calls/frame
phone < desktop: Expected: < 660   Received: 660     entities submitted
```

32.15 is a1-11's post-pooling, pre-cull number to two decimal places, and 660 is
the whole arena on both screens. The gate did not merely notice a number moved —
it reproduced the exact pre-a1-12 shape.

**Without editing any source** (`red-threshold-tightened.txt`) —
`PERF_BUDGET_SCALE=0.5 npm run test:perf-budget`. That knob is permanent, so
"see the gate fail" is a command and not an edit-and-remember-to-revert. It is
`Math.min(1, …)` in the spec, so it is **incapable of loosening** a budget: no
workflow file, no local shell and no agent in a hurry can use it to turn a red
gate green.

---

## 4. The manual half — and it is genuinely manual

**Nothing in CI does this. Nothing in CI can.** §4.3 says "not assumed"; this
section is what stops that from being assumed.

### What to run

```sh
# the desktop gate, on the developer's own machine
PERF_GATE=1 npm run test:perf-frame-time

# the mobile gate, from that machine against a deployed build the phone loads
PERF_GATE=1 PERF_URL=https://…/dev npm run test:perf-frame-time
```

Without `PERF_GATE=1` the suite still runs and still prints every number — it
just asserts nothing. That mode is useful for a before/after on one box; it is
**not** the gate, and its output says `measure-only (PERF_GATE unset)` on every
line so a pasted log cannot be mistaken for one.

### On what hardware

`PERF_GATE=1` is a declaration by the person typing it that this host is the
hardware §4.3 is written about. It is true on:

- **the developer's own machine** — GDD §4.3's "integrated graphics";
- **the developer's own phone**, GDD §4.3's named primary mobile test device,
  loading a deployed build.

It is **false** on a CI runner, in this container, and in any lane on the build
box. None of those has a GPU. If you are tempted to set it there, re-read §2.

### What it asserts

- p95 frame time clears the 30 fps floor (33.3 ms) — the hard failure line;
- median frame time holds 60 fps (16.67 ms, +10%);
- both idle and under a held thrust+fire, which is the frame a match is actually
  spent in.

### When it is required

At minimum, and this is the standing obligation the GDD does not describe:

1. **Before any `v*` milestone tag.** A tag deploys to the classroom and fires
   the release ping; §4.6 makes every milestone phone-verified, and this is the
   §4.3 half of that verification. Record the numbers in the milestone's notes.
2. **After a change to the render path** — `src/render/`, `src/art/`, the
   atlas/pooling seam, the cull, the VFX layer, or the fonts. The submission
   budget in §3 catches the *architectural* half of such a change on the push;
   it cannot see a shader, a filter, a blend mode, an over-large texture, or a
   font that forces a re-raster. Those cost milliseconds and nothing else.
3. **Whenever `VfxAutoQuality` engages in real play.** That is the renderer
   telling you it is already over budget on somebody's hardware.

If you tag without running it, say so in the tag notes. An unrun gate that
everyone believes ran is the failure mode this whole document exists to end.

### What this half does NOT cover, stated so nobody assumes it does

- **A real Android.** §4.3's 30 fps floor names a 3-year-old mid-range Android;
  `PERF_URL` against the developer's phone answers the 60 fps line, not that one.
  Nobody has run the floor on the device it describes.
- **`VfxAutoQuality`'s effect.** a1-11 measured engaging reduce-VFX at 2.2% of a
  96.9 ms frame — a poor lever, ratified anyway. `r9-01` owns how it degrades.
  Neither half of this gate asserts anything about it.
- **The VFX particle layer's culling.** a1-12 culled every entity layer except
  `src/art/vfx/layer.ts`, which is Art's file and has no cull seam; the
  recommendation there is a `draw(pool, visible?: CullBox)` overload
  (`docs/viewport-cull-measured.md`).

---

## 5. The sim half, for completeness

Already automatic, already honest, and unchanged by this brief:
`tests/harness/perf.test.ts` builds the §4.3 scene at full entity counts and
times the tick against **the sim's quarter** of a 60 fps frame (`SIM_FRAME_SHARE`
in `harness/perf.ts`), so a passing sim can never quietly eat the renderer's
budget. Tonight, on this box:

```
[perf] sim @budget: mean 0.123 ms · p95 0.204 ms · p99 0.612 ms
                    8079 ticks/s (134.7× real time) · 4.9% of the 60 fps sim budget
[perf] 2× entities costs 1.88× the frame time — the spatial hash is doing its job
```

~20× of headroom. That gate is set to catch a regression *in kind* — an
allocation per frame, a lost spatial hash, an O(n²) pass — not to shave
microseconds, which is why a CI runner several times slower than a laptop still
clears it. The sim runs identically in the browser, on the match server and
headless (GDD §4.1), so unlike the renderer's milliseconds, this number does
travel.

---

## 6. What changed, and what did not

**Changed.** The portable half of the renderer's gate now runs on every push, and
the manual half is written down instead of remembered. `docs/gdd-conformance.md`
G-15's "PARTIAL" is answered on both counts: the automatable half is automated,
and the part that must stay manual now has a document that says so, says what to
run, says on what hardware, and says when. *(That row is the Architect's audit
output; this brief did not edit it.)*

**Not changed, deliberately — this brief measures, it does not tune.** a1-11's
pooling, a1-12's cull, a2-07's VFX layer, u14-01's typefaces, the sim's headless
perf test, and `VfxAutoQuality` are all exactly as they were. The one number
worth repeating from a1-12 and not softening: **the §4.3 scene is still not under
budget on the desktop profile on a box with no GPU**, and this gate does not
pretend otherwise. It asserts what travels. The rest is §4, and it is yours.
