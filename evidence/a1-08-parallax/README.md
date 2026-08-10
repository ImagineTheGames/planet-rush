# a1-08 — the sky's own drift, watched on an arena that has a sky

`a1-05-sky-parallax-not-camera-locked` had stood **inconclusive** since it was
filed, for a reason it stated itself: it proved the backdrop was not glued to the
camera, but the arena it flew had no sky, so it could only ever watch the
**stars**. a1-07 then established which arenas carry a sky, and — more usefully —
**how to watch a single layer**. This round points that instrument at the
question a1-05 left open.

**Answered. On The Line the sky drifts at `0.0850` of camera travel where the
deep star layer drifts at `0.1001`.** Per screen-width flown (844 u) that is
**71.7 px against 84.5 px**: the sky travels with the far star field at 85% of
its rate and trails it by **12.7 px**, rather than the 42 px the pre-a0-07b
`0.05` would have given, and rather than the **0 px** a camera-locked layer gives.

Served bundle **`f79aa61`** (`/version.json`, and the build badge is in frame on
the player's shot). Desktop 1440×900 at **deviceScaleFactor 1**.

| layer | measured px | live transform px | measured ÷ camera | declared |
|---|---|---|---|---|
| `void-ground` | **0** (frames byte-identical) | 0.00 | 0.0000 | 0 |
| `void-nebula-deepEmber` | **−119.61** | −119.56 | **0.0850** | 0.085 |
| `void-stars-deep` | −140.75 | −140.66 | 0.1001 | 0.10 |
| `void-stars-mid` | −365.80 | −365.72 | 0.2601 | 0.26 |
| `void-stars-near` | −703.22 | −703.30 | 0.4999 | 0.50 |

*(The Line, one straight flight east, 1406.6 u flown, camera offset −1406.61 px.
The same ratios come back at the 574 u and 966 u baselines.)*

## One image pixel is one world unit

The camera is 1:1 (`Renderer.centerCamera` writes `worldRoot.x` = the offset it
just computed, with no scale) and Pixi `autoDensity` puts the stage in CSS px, so
shooting at **dpr 1** makes image px = CSS px = world units and **no number in
this round needs converting**. a1-05 reported *"219 px"* against *"844 world
units"* without saying which unit the 219 was in; that ambiguity is not repeated.

## How a single layer was isolated — and why not the way a1-07 did it

a1-07 isolated a layer by **hiding it and differencing two `?freeze=1` frames**.
That cannot work here: freeze pins the ship, so the camera never moves and there
is no flight to watch.

Differencing whole *unfrozen* frames is what made the first attempt inconclusive.
A frame holds the ground, three star layers, the sky and a live world, all moving
at different rates (0, 0.085, 0.10, 0.26, 0.50, 1.0); cross-correlate two of them
and you get back whichever layer owns the most contrast. **a1-05's 0.259 of
camera travel is the MID star layer's 0.26**, not the sky's.

So this isolates by **subtracting everything else**: at each camera stop the
harness hides every sibling of the void container (world, HUD, badge) and every
void layer but one, and the screenshot **is** that single layer, alone, over
black. No differencing, nothing mixed in, nothing to attribute.

The live stage is reached read-only through **pixi.js 8.6.6's own devtools
hook** — `globalThis.__PIXI_APP_INIT__`, claimed from a Playwright init-script
before any page script runs, exactly as a1-07 did it. **Nothing in `src/` was
touched and no constant was retuned.**

## The controls

- **`void-ground` is parallax 0** — literally glued to the camera, so it is the
  alleged defect drawn out on purpose. Its isolated frames are **byte-identical**
  (`md5 6889bd38…`) across all four camera stops. That fixes the zero, and it is
  also the **leak test**: had anything live survived the hiding, two frames taken
  minutes apart could not repeat to the byte.
- **The camera did not move during any frame set.** The harness reads the camera
  offset before and after the six shots at each stop; the drift was `0.000 px` at
  every stop on both arenas.
- **Three baselines, not one.** a1-07's compass attempt showed a single short
  baseline is not enough to trust.
- **Two independent measurements.** The scene-graph readback (what the transform
  says) and the cross-correlation (where the ink landed) are computed by
  different scripts; the correlator never sees the transform. They agree to under
  a tenth of a pixel on every layer.
- **The Compass is the falsification guard.** Coalsack is the one sky
  deliberately *not* on `SKY_PARALLAX` — dust in **front** of the deep layer at
  `0.14`. If the instrument echoed whatever it was pointed at, the two arenas
  could not disagree. It measures **0.1401** there, *out-running* the deep stars
  by 33.8 px per screen-width instead of trailing them.

`oval` was avoided on the brief's instruction: Plasma Reef is `r9-01`'s subject,
and a1-07 watched its layer leave mid-match under throttling at t+8.3 s — which
would have produced a fake answer rather than a null.

## What went wrong on the way, and what it cost

**The Compass lost a camera stop to the match ending mid-sequence.** The player
ship was destroyed while the six frames were being taken, and the `ELIMINATED`
summary replaced the arena — so all five "isolated layers" at that stop are the
same screenshot of a menu. It happened twice: once *before* the readback (caught
by the liveness guard, which stops the run) and once in the gap *between* the
readback and the shutter (which the guard originally did not cover, and now
does). The measuring script refuses such a stop on an exact test rather than a
statistical one — **five frames that are supposed to be five different layers but
are byte-identical to each other cannot have been taken with the isolation in
force**. Without that check it reported a confident 910 px shift. The frames are
kept as `frames/compass-stop3-*.png`.

**The first eastward compass flight pinned the ship against the arena wall**
after ~600 u, turning three camera positions into two — a1-07's trap, hit again.
The re-fly went west, where there was room, and a `pinned` guard now flags it.

**The correlator's degeneracy had to be reported rather than its number.** A flat
fill scores the same at every candidate shift, so `void-ground`'s first "answer"
was −414 px — whichever shift the loop reached first. The ruler now requires the
winning shift to beat everything more than 25 px away by at least 5% before it
will report a figure. The first attempt at that guard used an *absolute* score
threshold and wrongly condemned all three star layers: a star field is mostly
empty, so its winning score is tiny in absolute terms while still being a sharp
lock. **Discrimination, not magnitude, is the test.**

## What this does not settle

It measures the **geometry**, not the **perception**. Nobody has matched the
developer's frame to an arena, a build or a moment, and a0-07b's own text says
the read that prompted it was about *grouping* rather than speed. A layer at
0.085 among stars at 0.10 is what the code intends and what the build does;
whether it now *reads* as part of the star field is a question for eyes on a
real device, not for this ruler.

## Rerunning it

Needs a preview of the build under test on a **private** port — several lanes
share this box and a suite that reuses somebody else's server shoots somebody
else's bundle and goes green doing it (a3-01). `--host 127.0.0.1` because Node's
`fetch` resolves `localhost` to a family Vite may not have bound.

```sh
npm run build
npx vite preview --port 4291 --strictPort --host 127.0.0.1

node evidence/a1-08-parallax/recon.mjs 4291 line                    # the stage, once
node evidence/a1-08-parallax/measure-flight.mjs 4291 line line east # 4 stops x 6 frames
node evidence/a1-08-parallax/measure-flight.mjs 4291 compass compass west
node evidence/a1-08-parallax/measure-drift.mjs line                 # the ruler
node evidence/a1-08-parallax/measure-drift.mjs compass
node evidence/a1-08-parallax/make-plates.mjs                        # the three plates
node evidence/a1-08-parallax/_entries.mjs                           # merge into ../manifest.json
```

`amplify.mjs` is a looking aid only — it stretches one frame so a human can see
a layer that paints at single-digit luma. **Every number in this round is
computed from the raw frames**, never from an amplified one.

Everything under `frames/` is the raw material — the isolated layers, the
player's frames, the two flight JSONs and the two measurement JSONs. `plates/`
holds the composed panels and each plate's HTML source. The three plates copied
into `evidence/images/` are what the manifest points at. `_entries.mjs` holds the
attestations, written by hand after looking at every plate — **the scripts
compute, they do not judge.**
