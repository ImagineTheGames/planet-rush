# a1-07 — six arenas, six skies, checked against a running build

`MAP_NEBULA` (`src/art/backdrop.ts`) assigns one sky per arena **by hand**. The
code chose a hand-written map over a hash of the map id on purpose, which means a
wrong entry is a silent, permanent mismatch — nothing fails on it. The table had
never been verified against a running build.

**It is right. All six entries match what the shipped bundle loads.**

| arena | `MAP_NEBULA` | on the live stage (frozen, full VFX) | |
|---|---|---|---|
| octagon (**default**) | `none` | no `void-nebula-*` child at all | match |
| compass | `coalsack` | `void-nebula-coalsack`, drawn **last** | match |
| oval | `plasmaReef` | `void-nebula-plasmaReef`, blend `add` | match |
| diamond | `patinaDrift` | `void-nebula-patinaDrift` | match |
| line | `deepEmber` | `void-nebula-deepEmber` | match |
| crescents | `ironVeil` | `void-nebula-ironVeil` | match |

Served bundle **`dd1d3f5`** (`/version.json`, and the build badge is in frame on
every live shot). Desktop 1440×900 at dpr 2.

## How the sky was read rather than eyeballed

`Void.build()` labels every layer it makes — `void-ground`, `void-stars-<key>`,
and, only when the map's `NebulaSpec` is not `none`, `void-nebula-<id>`. That
label is the registry's answer *applied*: the same `this.nebula.id` names the
layer and feeds `nebulaSprite()`, so a label cannot disagree with the geometry.

The `?debug=1` handle publishes no scene graph, and this was a **read-only
round** — no seam could be added to `src/`. So the labels are read through
**Pixi's own devtools hook**: `pixi.js` 8.6.6 calls
`globalThis.__PIXI_APP_INIT__(app, version)` with the `Application` as `this`
(`node_modules/pixi.js/lib/utils/global/globalHooks.mjs`). A Playwright
init-script sets that global before any page script runs, so the harness holds
the real live `app.stage`. **Nothing in `src/` was touched.**

## How each sky was isolated

Four frames per arena on the `?debug=1&freeze=1` pinned world, differing by
exactly one hidden layer set:

| | |
|---|---|
| `A-frozen` | everything drawing |
| `B-no-nebula` | `void-nebula-*` hidden |
| `C-no-stars` | all three `void-stars-*` hidden |
| `D-ground-only` | every void layer but `void-ground` hidden |

`|A − B|` is then **the sky's own pixels and nothing else's** — not a claim about
the sky. Amplified ×14, because a0-07 chose *"subtle"* and these skies paint at
single-digit luma over Floor.

**Octagon is the method's null control.** Its entry is `none`, so hiding
`void-nebula-*` there hides nothing, and A and B are two screenshots of the same
unchanged scene. The difference came back **identically zero** — 0.0% of the
frame, peak delta 0 — so the freeze really does pin everything and the numbers
below have no noise floor to clear.

| arena | sky alone: frame touched | peak Δluma /255 | mean ink (r,g,b) | shape, at ×14 |
|---|---|---|---|---|
| octagon | **0.0%** | **0** | — | nothing |
| compass | 0.1% | 225.1 | 17.8, 18.4, 18.9 | *stars it covered* — it paints no light |
| oval | 30.1% | 15.0 | 0.52, 1.61, 2.76 | concentric cyan ringed discs |
| diamond | 25.9% | 14.2 | 1.66, 2.70, 2.48 | angular teal + ochre plates |
| line | 41.1% | 7.3 | 4.41, 1.13, 1.04 | red-orange coals — widest, faintest |
| crescents | 34.5% | 12.3 | 6.26, 4.34, 4.34 | laminated diagonal iron/rust bands |

Coalsack's row is the interesting one and it is not a small number by accident:
it is the ground colour, so it can never raise a pixel. The only difference
hiding it makes is **2,409 pixels of star that come back**, which is why its mean
ink is neutral grey — the colour of the stars, not of any ink of its own.

## What the round turned up on the way

**The Oval can end up with no sky at all, and it is the only arena that can.**
The live and frozen reads of `oval` disagreed. Watched, with a control:
`plasmaReef` is the only sky whose `reducedDensity` is **0** (coalsack 1,
deepEmber 1, ironVeil 0.5, patinaDrift 0.45), so when `VfxAutoQuality` engages
`drawSky` goes false and the layer is gone. Two live boots side by side for 40 s
on the same box: oval dropped its reef at **t+8.3 s** and never got it back; line
held `deepEmber` for all forty polls at the same frame rate. Designed (a0-07 says
so), not stated — filed for the Director.

**The soft grey discs are the asteroids.** With every void layer but the ground
hidden on the default arena — no sky, no stars, no bloom — the empty field still
holds **10 rocks**, median **62.7 px** across, **3.3×** the 18.9 px outer bloom
halo of the largest star, and opaque rather than a 6% wash. Filed
**inconclusive** on purpose: nobody has matched the developer's frame to a map, a
build or a moment.

## Rerunning it

Needs a preview of the build under test on a **private** port — several lanes
share this box and a suite that reuses somebody else's server shoots somebody
else's bundle and goes green doing it (a3-01). `--host 127.0.0.1` because Node's
`fetch` resolves `localhost` to a family Vite may not have bound.

```sh
npm run build
npx vite preview --port 4287 --strictPort --host 127.0.0.1

node evidence/a1-07-sky-registry/shoot-skies.mjs 4287            # 30 frames + readback.json
node evidence/a1-07-sky-registry/probe-throttle.mjs 4287         # the 40 s subject/control trace
node evidence/a1-07-sky-registry/make-figures.mjs                # isolations + the six plates
node evidence/a1-07-sky-registry/measure-compass-motion.mjs      # the cross-correlation
node evidence/a1-07-sky-registry/make-compass-plate.mjs
node evidence/a1-07-sky-registry/measure-grey-discs.mjs
node evidence/a1-07-sky-registry/make-throttle-plate.mjs
node evidence/a1-07-sky-registry/_entries.mjs                    # merge into ../manifest.json
```

Everything under `frames/` is the raw material; the eight plates copied into
`evidence/images/` are what the manifest points at. `_entries.mjs` holds the
attestations, written by hand after looking at every plate — the scripts compute,
they do not judge.
