# a0-36 — every blob in the developer's frame, named

The developer, third report: *"bloom is still broken, and on the ones that have
stars (few) the bloom seems to move when i move the camera it has a weird
effect"*. Their frame: many large soft discs, **most with no star at the centre**,
a few with one, and those separating from their star as the camera pans.

Four guesses had already been checked and refuted (a0-18 the bloom is gone,
a1-15 the cull removed them, a1-07 they are rocks — *inconclusive*, and
"halo on a different layer from its star" — refuted from the source). So this
round does not test a hypothesis. **It names the objects.**

---

## The answer, in one line

**The large soft discs are the nebula.** On The Oval they are **Plasma Reef**
clot nodes — the sky the map is assigned. They have no star at their centre
because *nothing on that layer has a star*. The bloom the developer is looking
for is in the same frame, working, and **4–20× smaller**.

Served bundle **`75ec737`** — the developer's own build (`/version.json`, and
the badge is in frame on every live shot).

## The inventory — The Oval, desktop 1440×900 @dpr 2, frozen

|class|layer|count in frame|span, css px|what it is|
|---|---|---|---|---|
|**soft disc**|`void-nebula-plasmaReef`|**39 blobs, 31.7% of frame**|**4.5 – 563.5, median 54**|Plasma Reef: 4-node clots + 3 base washes|
|star + bloom|`void-stars-near`|8|3 – **18.5**|the only "orbs" in a frame|
|star + bloom|`void-stars-mid`|9|3 – 11||
|star + bloom|`void-stars-deep`|24|4.5 – 8.5||
|rock|`asteroids`|5|10 – 87.5|opaque grey polygons, hard rims|
|station air|`atmosphere`|1|512|one halo, the player's own station|
|station|`stations`|6|3.5 – 206||
|turret|`turrets`|4|21 – 29.5||
|VFX|`vfx-light` / `vfx-matter`|8 / 5|5 – 52.5 / 5 – 25.5|**staged by the freeze**, see below|
|ship|`ships`|1|30||

**The widest star + bloom in any frame this round shot, on any arena at either
viewport, is 18.5 css px.** The sky's discs run to several hundred. There is no
viewport, arena or VFX tier at which those two classes are the same size.

### The same census, every arena

|arena / viewport|sky|sky, % of frame|sky blobs|sky span, css px|
|---|---|---|---|---|
|oval / desktop|plasmaReef|31.7|39|4.5 – 563.5|
|oval / phone|plasmaReef|33.1|31|9 – 315.3|
|diamond / desktop|patinaDrift|27.6|74|4 – 499.5|
|diamond / phone|patinaDrift|26.3|51|4.3 – 342|
|line / desktop|deepEmber|43.4|29|4 – 1050.5|
|line / phone|deepEmber|26.2|13|4.3 – 373.3|
|crescents / desktop|ironVeil|34.7|33|5 – 1440|
|crescents / phone|ironVeil|13.4|20|6.3 – 383.3|
|compass / desktop|coalsack|0.1|39|3 – 12|
|compass / phone|coalsack|0.06|5|5.7 – 10.7|
|**octagon / desktop**|**none**|**0**|**0**|**—**|
|**octagon / phone**|**none**|**0**|**0**|**—**|

Coalsack's row is small for the reason a1-07 found: it is drawn in Floor's own
colour, in front of the star field, so it *removes* stars and adds no light —
hiding it only gives back the handful of stars it covered. **The Octagon is the
control**: its sky is `none`, so there is no `void-nebula-*` layer at all, and no
large soft discs in the frame.

## The ring — settled

The brief's central question: the discs read as **a brighter rim with a darker
centre**, and three concentric *filled* discs cannot composite to a donut. So
either they are not star blooms, or something is stroking rather than filling.

**Neither. Nothing is stroked, and the discs are not blooms.** Every blob was
profiled radially on its layer's own isolated luma, from two centres:

- **from the blob's peak** — *is one drawn element a donut?*
  **0 of 8** nebula blobs, **0 of 25** star blobs, **0 of 5** rocks, **0 of 7**
  vfx-light blobs. Every element's maximum is at r = 0 and falls outward.
  `starFieldSprite`'s three filled discs and `softDisc`'s four-stop stack both
  composite to a glow, exactly as written.
- **from the blob's centroid** — *does the GROUP read as one?*
  **5 of 8** nebula blobs are rings, interior dips of 1.2–4.1 luma at radii of
  12–90 device px. **0 of 25** star blobs are, by either test.

The donut is **`PLASMA_REEF.build`'s clot layout**: each clot places four nodes
at `(n/4)·2π + jitter`, `spread·(0.45…1)` from a common centre — *on a circle,
with nothing in the middle*. Four filled glows arranged on a ring read as a ring.
It is an arrangement, not an element, which is why reading the element's source
said it was impossible and the frame still shows it.

A ring threshold of one 8-bit code value is stated in `profile.mjs` on purpose:
an additive stack bands at 1–3 levels a stop, and a dip smaller than that is
quantisation wearing a shape's clothes.

## The motion — measured, and it is the design

`SKY_PARALLAX` and `STAR_LAYERS` are the code's claim. These are the running
build's numbers, read off live node positions across a real flight of
**1358.9 css px** of camera pan:

|layer|drift per camera px, measured|px per screen-width (1440 css)|
|---|---|---|
|`void-ground`|0|0|
|`void-nebula-plasmaReef`|**0.085**|122|
|`void-stars-deep`|**0.10**|144|
|`void-stars-mid`|**0.26**|374|
|`void-stars-near`|**0.50**|720|
|world container (rocks, stations, ships)|1|1440|
|`vfx` container|1|1440|

So a star that happens to sit on a clot node — **the only way a soft disc ever
has a star in it** — slides off it at **252 px per screen-width** for a mid star
and **598 px** for a near one. That is the developer's "weird effect", and
nothing is coming apart: the two were never one object.

**What is NOT happening is a halo separating from its own star.** Bloom and star
are pushed into the same shapes array at the same `x,y` inside one baked sprite,
so they are one layer and move as one — and every star layer's read and measured
ratios agree.

## Method, and what would have made it wrong

- **Enumerate, don't hypothesise.** Every labelled layer under `game-root` is
  isolated — the void's five, the world's ten, the two VFX pools — not the ones
  a theory nominates.
- **The scene graph is read through Pixi's own devtools hook**
  (`__PIXI_APP_INIT__`), as a1-07 established. `?debug=1` publishes no scene
  graph and this was a **read-only round**: nothing in `src/` was touched.
- **The zero control.** Every layer with no children in the frozen frame
  (`chunks`, `muzzles`, `impacts`, `shots`, and `asteroids` on the phone)
  differenced to **exactly 0 px** on all twelve runs, and the frame re-shot after
  all toggling differed from the first by **0 px, peak 0**. The freeze pins the
  scene; no number here has a noise floor to clear.
- **Both viewports.** A sky is authored *per screen* (`NebulaSpec.build` takes
  `screenW/screenH`), so desktop and phone are genuinely different skies, not one
  scaled. Shooting only one would have been a guess about which the developer had.
- **Two traps this round actually hit**, both recorded because a future run will
  hit them again:
  1. **WASD does nothing.** The ratified default scheme is Tap Commander
     (a0-33): the pilot replaces the sticks and the ship flies to a *click*. A
     first motion pass held `KeyD` for six seconds and the ship did not move a
     world unit — the build behaving correctly and the harness asking wrong.
  2. **`visible = false` prunes hit-testing.** Hiding the HUD to isolate a layer
     also killed the click the flight is driven by, and the pass measured a camera
     pan of zero. The UI is now taken out with `alpha = 0`, which draws nothing
     and still hit-tests.

### One caveat, stated rather than buried

`vfx-light` / `vfx-matter` have children in the **frozen** frame because
`?freeze=1` stamps a defence showcase (`main.ts` `stampDefenseShowcase`). Shot
**live** on the same arena and viewport, `vfx-light` drew **nothing at all** in
the visible frame — its 15 pooled slots were parked. So the VFX rows above are a
staged frame's, not a claim about normal play, and VFX is **not** a candidate for
what the developer is seeing. (`PARTICLE.ring` in `src/art/vfx/kinds.ts` *is* a
literal annulus — two rings, empty centre, additive plasma — which is why it was
worth ruling out by measurement rather than by argument.)

## Rerunning it

Needs a preview of the build under test on a **private** port — several lanes
share this box and a suite that reuses somebody else's server shoots somebody
else's bundle and goes green doing it (a3-01). `--host 127.0.0.1` because Node's
`fetch` resolves `localhost` to a family Vite may not have bound.

```sh
npm run build
npx vite preview --port 4336 --strictPort --host 127.0.0.1

node evidence/a0-36-name-the-blobs/walk-stage.mjs 4336            # the whole live scene graph
node evidence/a0-36-name-the-blobs/isolate.mjs   4336            # 6 arenas × 2 viewports, one layer at a time
node evidence/a0-36-name-the-blobs/analyse.mjs                   # → inventory.json (the census)
node evidence/a0-36-name-the-blobs/solo.mjs      4336 oval desktop        # each layer alone, live
node evidence/a0-36-name-the-blobs/solo.mjs      4336 oval desktop --freeze
node evidence/a0-36-name-the-blobs/profile.mjs   oval desktop     # → ring or glow
node evidence/a0-36-name-the-blobs/motion.mjs    4336 oval desktop # → drift per screen-width
node evidence/a0-36-name-the-blobs/make-plates.mjs               # the four plates
```

`frames/` holds the raw material for **The Oval and The Octagon** (the subject and
the control) plus every solo and motion frame. The per-arena B-frames for
diamond, line, crescents and compass are **not committed** — their numbers are in
`inventory.json` and `isolate.mjs` regenerates them; that is 60 MB of near-identical
PNG this repo does not need. Said out loud so their absence reads as a decision
rather than a gap.

The four plates copied into `evidence/images/` are what the manifest points at.
Attestations are written by hand after looking at every plate — **the scripts
compute, they do not judge.**
