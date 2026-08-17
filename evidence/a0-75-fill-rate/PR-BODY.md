# a0-75 — the bigger the window, the worse it runs

> *"for the host everything is super choppy"*
> *"only pc has this stuter, i think it gets worse the larger the playing area is
> on my screen"*
> *"yes it does, if i resize to a small window the game plays much better"*

The developer bisected this without a single instrument from us — host swap, then
window resize — and handed over a complete diagnosis of the class of bug. This
branch measures it, attributes it, fixes it at the layer the profile implicates,
and states the budget the fix holds at 3440×1440 and at 5120×1440.

**Full audit: `evidence/a0-75-fill-rate/audit.txt`.**

---

## The answer

It is **fill rate**, and the **sky** is three quarters of it. Counted off the
shipped geometry, a desktop frame over the wide arena blended **4.4 screenfuls**
of backdrop and **3.0 of them were the nebula** — nine alpha-blended gradient
clots each covering ~40% of the frame, stacked, every frame. The ground is 1.0
and the entire star field, bloomed halos and diffraction crosses included, is
0.33.

And a second thing nobody had looked for: **the sky's coverage grew with the
frame's ASPECT RATIO as well as its area.** 3.03× at 16:9, 4.07× at 21:9,
**6.06× at 32:9** — landing hardest on exactly the screen the report came from.

Backdrop fill is now **2.33 blended screenfuls per frame at every viewport in the
sweep and on every map**:

| viewport | Mpx | before | after | Mfrag/frame |
|---|---|---|---|---|
| phone 798×384 | 0.31 | 4.913 | **2.330** | 1.5 → 0.7 |
| desktop 1280×800 | 1.02 | 4.451 | **2.324** | 4.6 → 2.4 |
| 1920×1080 | 2.07 | 4.459 | **2.333** | 9.2 → 4.8 |
| 2560×1440 | 3.69 | 4.367 | **2.332** | 16.1 → 8.6 |
| **ultrawide 3440×1440** | 4.95 | **5.400** | **2.331** | 26.7 → 11.5 |
| **32:9 5120×1440** | 7.37 | **7.392** | **2.330** | 54.5 → 17.2 |

## The two fixes

**1. `featureSpan` — an ultrawide paid twice.** `mockupBlobs` sized every element
off the frame's *width* (`rx = screenW × radius`) while element *count* is per
screen *area*, so coverage was proportional to W/H with nothing bounding it. It
was also a **fidelity** drift: the design panel is 640×360 and those fractions
are measured against its width, so on a 32:9 frame a clot was twice the fraction
of the frame's *height* the design draws it at — coarser and emptier than the
compositor board that was approved. One error, two faces.

`featureSpan(W, H) = √(W · H · Wp/Hp)` is the unique rule that is the **identity
at the design's own aspect** (put W/H = 16/9 in and it returns exactly W, so no
measured number moves and no sky is re-art-directed to buy a millisecond — the
a0-40 rule) and holds a blob's share of the frame constant everywhere else.
Rejected: the short side, which is scale-invariant too but would shrink every
blob to 0.5625 of the design's on the very shape the design was measured on.

**2. The sky is baked once into a texture.** Not thinned — *nothing about what
the sky is changed.* Same shapes, counts, radii, alphas, colours, seed;
`compliance.ts` and `backdrop.test.ts` audit the `SpriteDef`, which is untouched.
What changed is where the pixels are rasterised. Two properties of this layer
make it free:

- **It only ever translates.** Geometry goes into a static `Graphics` at
  `configure()` and thereafter only `position` moves, and Pixi's cached render
  group re-renders only when its *contents* change. So the bake is once per (map,
  viewport, tier) — exactly where the geometry build already happens — and never
  in a frame.
- **Its smallest feature is enormous.** The smallest radius any sky declares is
  Patina Drift's 0.10 of `featureSpan` — 297 px at 3440×1440 — and the alpha
  across it is a radial ramp. Interpolation error on `(1−t²)²` sampled every
  third pixel is **0.007 of one 8-bit code value**.

Resolution is derived from a stated **memory** budget (2²¹ texels = 8 MB) rather
than set, in whole fractions because pow2 rounding makes the cost a staircase:
8 MB flat from phone to 32:9, at 1/3 to 1/6. Below 1/8 it declines to cache and
draws directly — correct and expensive, never absent, which is r9-01's rule in a
new place.

## End to end on the shipped bundle

`ab-sweep.mjs` builds **both** bundles (a git worktree at `f7ef828` for the
before, `dist/` for the after), serves them on two ports, and takes each
viewport's **pair back to back in the same minute**, alternating which goes first.

| scene | viewport | before | after | Δ |
|---|---|---|---|---|
| frozen | phone 798×384 | 133.3 ms | 116.7 | **−12%** |
| frozen | 1280×720 | 516.6 ms | 316.7 | **−39%** |
| frozen | 1920×1080 | 783.3 ms | 700.0 | **−11%** |
| frozen | 2560×1440 | 1333.3 ms | 733.3 | **−45%** |
| frozen | 3440×1440 | 1266.7 ms | 849.9 | **−33%** |
| live | 1280×720 | 300.0 ms | 216.7 | **−28%** |
| live | 3440×1440 | 1300.0 ms | 866.5 | **−33%** |

Read the pairs, not the column — 3440×1440's "before" reads *faster* than
2560×1440's, which is arithmetically impossible for one build on more pixels and
is the neighbouring lane's load showing through.

**And this table understates the fix, by a knowable amount.** On a CPU rasteriser
the star field's per-triangle setup dominates, and the star field is unchanged
here. From the layer rig at 1920×1080: stars cost 241.8 ms, the raw sky 130.4 ms,
the baked sky 25.9 ms → predicted whole-frame saving 104.5 ms against a measured
83.3 ms. Same order; the residual is load. On a GPU the ratio inverts — 0.33
blended screenfuls of star field is nothing and ~1 M static triangles is well
under a millisecond, while three blended screenfuls of full-frame gradient is the
whole problem. Which is why the load-bearing claim above is the **counted** fill.

The isolated-layer A/B, same page, same load:

| | 1280×720 | 1920×1080 | 2560×1440 |
|---|---|---|---|
| `ground+reef` raw → baked | 90.2 → 36.1 (−60%) | 166.6 → 62.1 (−63%) | 318.0 → 125.1 (−61%) |
| `ground+patina` raw → baked | 154.2 → 49.6 (−68%) | 199.8 → 62.3 (−69%) | 421.9 → 119.1 (−72%) |

The sky layer alone, minus the ground quad: Plasma Reef 63.3 → 9.2 ms (**−85%**),
Patina Drift 127.3 → 22.7 ms (**−82%**).

## Is it the same sky? Measured, and looked at

`evidence/a0-75-fill-rate/cache-diff.mjs` renders each sky twice into the same
canvas at the same camera offset and reads both back. 20 PNGs in `frames/`, all
looked at.

| viewport | sky | maxΔ/255 | meanΔ | maxΔE | luma step | **peak Y′** |
|---|---|---|---|---|---|---|
| 1280×800 | coalsack | 4 | 0.52 | 3.80 | 1.57→1.00 | 47.4 → **47.4** |
| 1280×800 | ironVeil | 6 | 0.50 | 4.42 | 1.86→1.00 | 45.6 → **46.0** |
| 1280×800 | patinaDrift | 5 | 0.45 | 5.94 | 1.64→0.93 | 35.2 → **35.3** |
| 1280×800 | plasmaReef | 4 | 0.17 | 4.10 | 1.50→0.93 | 59.8 → **59.8** |
| 1280×800 | deepEmber | 4 | 0.36 | 3.72 | 0.93→0.93 | 23.1 → **23.7** |
| 3440×1440 | all five | 3–5 | 0.12–0.50 | 2.85–5.57 | 1.43→0.93 | within 0.4 |

Six developer reports on this backdrop are about the brightness ladder. **It
holds to under half a code value on every sky, and its order is untouched.** The
residual few codes are the ramp's *dither* resampling, not gradient error — and
the banding measure moves the right way: the largest single-pixel luma step falls
from 1.50–1.86 to 0.93–1.00, because bilinear magnification interpolates between
quantised values. The worry that a downsample would average a0-39's anti-banding
noise into mush was backwards; caching makes the sky **smoother**.

The additive sky is the one that could have failed silently — a wrong blend
through a render target reads as a brighter or darker reef, or a rectangular seam
— and Plasma Reef direct and cached are indistinguishable at the same peak Y′
59.8, with no seam.

## The stated budget

> **The backdrop blends at most 2.5 screenfuls per frame, at any viewport, on any
> map.**

Enforced on every push by `src/art/backdrop-fill.test.ts`, over a six-viewport
sweep from the landscape phone to 32:9, on all six maps.

|  | 3440×1440 | 5120×1440 |
|---|---|---|
| backdrop blends | **11.5** Mfrag/frame (was 26.7) | **17.2** (was 54.5) |
| at 60 fps | 693 Mfrag/s (was 1.60 G) | 1.03 Gfrag/s (was 3.27 G) |
| at a nominal 5 Gfrag/s of integrated blended fill | **2.3 ms** of 16.7 (was 5.3) | **3.4 ms** of 16.7 (was 10.9) |

The 5 Gfrag/s is a stated assumption so the developer can substitute their own
hardware; the Mfrag/frame column is measured and portable. The shape is the
point: at 32:9 the backdrop alone wanted two thirds of a 60 fps frame for nothing
but the sky *behind* the game.

**It does not take the view away.** Same viewport, same arena on screen, same
sky. a0-74 is widening the mobile view toward parity at the same time and this
does not touch that trade; it was declined once and is not re-proposed.

---

## Questions and calls for the Director

**(a) Should the performance gate sweep viewport sizes? Yes.** And it is worth
being precise about why the three existing gates could not have caught this:
`tests/harness/perf.test.ts` profiles the sim, which has no viewport;
`tests/perf/draw-budget.spec.ts` counts draw calls and submitted entities, which
barely move with area; `tests/perf/frame-time.spec.ts` measures **one** fixed
viewport and gates only on hardware CI does not have. None of the three has an
axis called *area*, so a cost that is fine at 1280×720 and double at 32:9 was
invisible to all three at once — and the developer found it by dragging a window
corner. The art half of that axis is added here as a **unit test**, deliberately:
fragments are countable without a GPU, so the budget gates on every push instead
of on a machine somebody has to own. **Recommended to QA:** two more viewports in
`frame-time.spec.ts` (a 21:9 and a 32:9) would have turned this into a red gate;
the whole cost is `page.setViewportSize`.

**(b) `coverSpan` over-provisions every parallax field by a whole viewport —
4.9× the area. DIRECTOR'S CALL.** The requirement is
`max(view(1+f), view(1−f) + 2f·bound)`; the function returns that **plus a whole
view** and then the documented quarter-view of slack. It costs no fill (the
rasteriser clips what is off screen) and it costs 3.2× the star geometry baked
and re-submitted every frame — the deep layer holds **49,378 shapes at
3440×1440** where 15,560 would cover the screen — plus 4× the cache texture. The
correction was implemented and measured on this branch and then **reverted**,
because the field is not only a cover margin: a `lane` sky's `reach` and a `band`
sky's spread are fractions of it, so shrinking it makes Coalsack's dust lane
physically shorter and re-packs every structure that spans the field. Three
ratified declarations went out of tolerance at once (Coalsack peak luma 46.3 →
35.2, Patina Drift 32.3 → 35.4, and a0-07b's own build-cost claim). Buying
geometry by re-shaping three skies is the trade a0-40 exists to refuse. It wants
a brief that re-derives the sky measurements against a corrected field. The
arithmetic is now written on the function so the next reader does not re-derive
it.

**(c) `NebulaSpec.overdraw` under-reports a desktop frame by ~40%.** The declared
table (reef 2.175) and its 15% gate are both correct *as measured* —
`backdrop.test.ts` samples one screenful-sized field, where a blob of radius
0.18–0.38 of the width has most of itself outside the sampled box. Over a real
parallax field the same geometry integrates to 3.03. That is the a0-39 lesson
recurring ("it used to sample **one** screenful"); `backdrop-fill.test.ts` now
measures the field the frame is actually drawn from, and the two numbers should
probably be reconciled in whichever brief takes (b).

**(d) `VfxAutoQuality`: engaging? helping? should it read area?** Driven rather
than read (`evidence/a0-75-fill-rate/reducer.txt`).
- **Engaging:** only at ≤30 fps sustained. Everything from **31 to 54 fps** is a
  frame rate the player feels — a 40 fps frame judders every third refresh on a
  60 Hz panel — and it never fires.
- **Thrashing:** no, and the real failure is the opposite. A rate wandering ±8
  fps around 26 engages **0%** of 60 s, because any excursion above the floor
  resets the sustain timer. It fires on a steady slog, not on a stutter.
- **Should it read viewport area? No.** Every lever it has is per-*entity*
  (particle budget, impact glows, spawn shimmer) and r9-01 deliberately forbids it
  the sky mid-match. Wiring area in would have shed sparks on a big window while
  three screenfuls of sky went on being paid in full — the right signal reaching
  the wrong lever. And after this branch there is nothing to react to: fill is
  2.33 at every viewport. The honest fix for a cost that scaled with area was to
  stop it scaling, not to detect that it had.

**(e) Two things in `src/main.ts` (Platform Engineer's — raised, not changed).**
Both are per-pixel multipliers on everything above.
- `antialias: true` on the `Application` (main.ts:833) is 4× MSAA on the blended
  traffic of every pass. It buys nothing on this content: every backdrop edge is
  the zero rim of a falloff where alpha has already reached 0, and every entity is
  a `Sprite` off a texture the baker already antialiased. The one thing it helps is
  the arena wall's thin steel strokes.
- `resolution: window.devicePixelRatio` on the same call, **uncapped** — where the
  VFX texture cache caps at 2 for exactly this reason (main.ts:1477: *"a dpr-3
  phone would otherwise bake nine times the texels it can show"*). On a HiDPI
  ultrawide, or with Windows display scaling at 125%/150%, the drawing buffer is
  1.56×–4× the CSS pixels.

---

## Goldens

All **50 baselines in `tests/mobile/goldens.spec.ts-snapshots` pass unchanged**,
including the three the suite dedicates to skies and the one it names *"THE
CONTROL — this one was already correct"*. So no baseline is re-generated: doing
so would write 50 byte-different PNGs recording a difference the studio's own gate
calls immaterial, and would throw away the useful fact that it IS under the gate.

That is not by itself proof, and that spec says so about itself — its 1%
`maxDiffPixelRatio` over a frame that is mostly star-field exists to survive font
and GPU antialiasing, and *"a complete re-skin of the screen a player spends the
entire match on sat on the knife-edge of the one gate that is supposed to catch
it"*. So `evidence/a0-75-fill-rate/frames-ab.mjs` captures the same scenes from
**both bundles** and measures the whole shipped screen — entities, HUD and all.
12 frames in `frames-shipped/`, **every one looked at**:

| scene | size | maxΔ/255 | meanΔ | any | >2 codes |
|---|---|---|---|---|---|
| **`octagon` — sky NONE** | 1280×800 | **0** | 0.0000 | **0.0%** | 0.00% |
| `compass` — Coalsack | 1280×800 | 9 | 0.81 | 78.4% | 8.04% |
| `oval` — Plasma Reef | 1280×800 | 11 | 1.51 | 89.5% | 43.3% |
| `line` — Deep Ember | 1280×800 | 5 | 0.53 | 66.8% | 2.91% |
| `oval` — Plasma Reef | 3440×1440 | 25 | 5.25 | 94.0% | 89.3% |
| `line` — Deep Ember | 3440×1440 | 9 | 1.29 | 89.6% | 33.7% |

**`octagon` is byte-identical.** That is the control worth having: the default
board's sky is NONE, so its frame is ground + star field + entities and nothing
else — and it comes back bit for bit. Neither fix touched the star field, the
ground, the entities or the HUD, and this is the proof rather than the claim.

Justifying each change by eye:

- **Coalsack, Deep Ember, Plasma Reef at 1280×800** — indistinguishable. Same
  dust lane in the same place occluding the same stars; same rust band; same
  clots at the same brightness. The 5–11 code values are the ramp's dither
  resampling through the cache, spread thin (mean under 1.6 codes).
- **Plasma Reef at 3440×1440 (the largest change, maxΔ 25)** — this one is the
  **aspect fix doing its job**, and it is visible if you look for it: the cyan
  wash in the lower right reaches very slightly less far. That is the reef's
  clots at the design's own proportion of the frame instead of 34% oversized.
  Nothing else in the frame moves — stations, rocks, nameplates, minimap and HUD
  are pixel-for-pixel where they were.
- **Deep Ember at 3440×1440** — same story, quieter: the warm red along the left
  edge is a touch less spread. The middle of the screen, where the fight is,
  stays clean, which is the argument that put Deep Ember on The Line.

No seam anywhere, no banding, no rectangle where a cached texture ends — which
are the three ways this fix could have failed visibly, and the reason the sky
diff also measures banding directly (it improves).

## Instrument caveat, stated once

The studio image has **no GPU** — Chromium here draws through SwiftShader, a CPU
rasteriser — so **no millisecond in this branch is the developer's millisecond**,
and nothing claims to be. Two honest uses: SwiftShader is a pure function of work
done, and a before/after measured **back to back in one session** is a real
before/after. `ab-sweep.mjs` therefore builds *both* bundles (a git worktree at
the pre-branch SHA), serves them on two ports, and takes each viewport's pair in
the same minute, alternating order. That mattered: an early cross-time "after"
table read **+44%** purely because a `vite build` of mine was running beside it.

SwiftShader also **over-weights geometry** relative to a GPU (per-triangle setup
is CPU work), which is why the load-bearing evidence for *which layer* is
`overdraw.ts` — it counts the area every shipped shape asks the rasteriser to
shade, needs no GPU, and is therefore the same answer on the developer's
ultrawide as in CI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
