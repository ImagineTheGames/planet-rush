# a0-53 — the bloom is still narrower than the design

Fourth report on this one element, and the first whose cause is not a number.
The brief's real question was *"why does this keep getting messed up"*, so this
round measured the **lit pixel** instead of the model.

## The short answer

**Every link from the design's number to the authored shape is intact.** The
break is at the very last step — the composited frame of the shipped bundle —
and it is invisible to every instrument this repo had, because all of them
measure the model.

| surface | bloom radius drawn / design |
|---|---|
| one falloff alone, rx 40/80/120, production `drawSprite` | **0.975 / 0.988 / 0.992** |
| `VoidBackdrop` through its own API (dev server) | **median 0.908** |
| `VoidBackdrop` through its own API (production bundle) | **median 0.908** |
| the whole real `src/render` `Renderer` (production bundle) | **median 0.908** |
| the booted client with the void soloed | **median 0.908** |
| the SAME `index.html`, built by `vite.probe.config.ts` | **median 0.915** |
| **the shipped client (`dist/`, built by `vite.config.ts`)** | **median 0.690** |

A bloomed star declares `11.24 × r` with `r ∈ (2.163, 2.45]`, so **no bloom can
declare a halo under 24.3 px**. The shipped client draws them at 17–19 px.

The residual ~0.09 on the correct rows is the 8-bit frame, not slack: past
`t = 0.9` the design's own gradient carries under one code value over Floor, so
a correctly drawn halo always measures a few per cent short of its geometry.
`audit.txt` states that alongside the numbers.

## What this is NOT — each ruled out by measurement, not by argument

So that a fifth round does not re-derive them:

- **The constants.** `BLOOM.radius` is 11.24 and equals `haloRadiusOf(0.48)`;
  read back out of the *running* client (`const-inspect.ts`) it is still 11.24,
  so nothing mutates it on the boot path.
- **The transform (the brief's candidate 2).** `rampMatrix` maps the ramp's `t`
  to exactly `d / haloR`: `sx = 2·rx·scale·1.25/256` puts the shape's rim on ramp
  texel 230.4, which is precisely where `RAMP_OVERSCAN` puts `profile(1)`. The
  one-falloff control confirms it in pixels — rx 120 draws to 119.
- **A sprite cell or atlas clip (also candidate 2).** The live backdrop never
  goes through a texture: `drawSprite` plays it straight into a `Graphics`.
- **The gradient's outer stop (candidate 3).** Measured on the drawn frame, the
  falloff reaches zero at the declared rim, on the design's own three-stop curve.
- **Which sky is on screen (candidate 1).** The frozen boot is `octagon`, whose
  sky is NONE, confirmed from the running backdrop's own `nebulaId`.
- **The ramp texture.** Read out of the running client: 256², resolution 1, full
  frame, `uvs` 0..1 — byte-for-byte the same object in the broken and the correct
  surfaces (`ramp-inspect.ts`).
- **Renderer configuration** (`antialias`, background, `resolution`,
  `autoDensity`), **WebGL vs WebGPU** (both webgl), **the camera offset**, **a
  layer rebuild** (resize away and back is byte-identical), **fog** (ground reads
  `(7,9,16)` inside the fog hole and far outside it), and **any global dim or
  overlay** (the ratios are not constant, so no compositing law fits).

## What it IS

**A bundling / scene-composition fragility.** The sky submits thousands of
gradient fills that all sample one shared ramp texture, and in the shipped bundle
that geometry is drawn with its halos' outer band missing. It is exquisitely
sensitive to things that have nothing to do with the sky:

- hiding **any single sibling** of `void-backdrop` in the booted client — even
  `fullscreen-reenter`, which covers no sky — restores every halo;
- so does making the void a render group at runtime;
- and the *same* `index.html`, from the *same* source, built with a different
  Vite config draws it correctly.

That last one is the decisive control, and it is why nothing shipped from this
brief changes `src/art/`: **the art is correct, and no change inside Art's own
files fixes the shipped bundle.** Three were tried and measured against
`dist/`, and all three left it at 17–19 px:

1. `isRenderGroup: true` on `VoidBackdrop.view` — fixed the dev server, changed
   the production frame *byte for byte not at all*;
2. grouping every halo into one contiguous run of gradient fills, ahead of all
   the points and crosses — changed the frame, did not change the radius;
3. dropping the ramp's mipmaps — no change.

The fix therefore belongs with whoever owns the app shell and the build
(`src/main.ts`, `vite.config.ts`, `src/render/`), and the choice between
isolating the sky in the renderer and changing how the bundle is built is not
Art's to make unilaterally. It is carried to the Director in the PR.

## The instruments

- `capture.spec.ts` + `playwright.config.ts` — QA's own frozen boot against the
  real preview build; writes `frames/desktop-frozen-octagon.png` and, beside it,
  the camera offset the client drew at, so the frame can be registered.
- `audit.ts` → `audit.txt` — every measurement above, per identified star.
- `vite.probe.config.ts` — builds the probe pages with the app's own production
  pipeline, which is what exposed the dev-vs-bundle difference.

## The gate

`src/art/backdrop-bloom.test.ts` `measured off the shipped frame` measures these
committed frames in **pixels** and asserts against
`haloRadiusOf(BLOOM.intensity) × that star's own radius` — a rule against a
render, with `BLOOM.radius` never read, so it cannot be satisfied by a constant
agreeing with itself. Two assertions: the art's own frame passes; the shipped
bundle is recorded as `it.fails`, so the measurement runs in CI every time and
goes RED the day the bundle stops eating the outer band.
