# a0-53 — the bloom is still narrower than the design

Branch `agent/art/a0-53-bloom-radius-measured`. Working note; not evidence.

## THE FINDING — this is the brief's real question, answered

**Every link from the design's number to the authored shape is intact. The break
is the last step — the composited frame of the SHIPPED BUNDLE — and it is
invisible to every instrument this repo had, because all of them measure the
model.** That is why four measured, correct fixes coexisted with a developer who
kept seeing the wrong thing.

Measured off real frames, per identified star, drawn ÷ design:

| surface | ratio |
|---|---|
| one falloff alone (rx 40/80/120), production `drawSprite` | 0.975 / 0.988 / 0.992 |
| `VoidBackdrop` via its own API — dev server AND production bundle | median 0.908 |
| the whole real `src/render` `Renderer` — production bundle | median 0.908 |
| the booted client with the void soloed | median 0.908 |
| the SAME `index.html`, built by `vite.probe.config.ts` | median 0.915 |
| **the shipped client (`dist/`, built by `vite.config.ts`)** | **median 0.690** |

No bloomed star can declare a halo under 24.3 px (`11.24 × r`, `r > 2.163`); the
shipped client draws them at 17–19. The residual ~0.09 on the correct rows is the
8-bit floor, stated in `audit.txt`.

## BUILT (committed)

- `src/art/backdrop-bloom.test.ts` — `measured off the shipped frame`. Registers
  the committed frames against the model by the recorded camera offset and
  asserts **pixels** against `haloRadiusOf(BLOOM.intensity) × that star's own
  radius`; `BLOOM.radius` is never read, so it cannot be satisfied by a constant
  agreeing with itself. Two `it`s: the art's own frame passes; the shipped
  bundle is `it.fails`, so the measurement runs in CI and goes RED the day the
  bundle is fixed. Bars 0.80 per star / 0.85 median — correct surfaces measure
  0.879–0.925, the defect 0.666–0.695.
- `evidence/a0-53-bloom-radius/` — `README.md` (method + everything ruled out),
  `audit.txt` + `audit.ts`, `capture.spec.ts` + `playwright.config.ts`,
  `field-probe`, `renderer-probe`, `vite.probe.config.ts`, `const-inspect.ts`,
  `ramp-inspect.ts`, and 13 committed frames (3.1 MB).

## NO SOURCE CHANGE SHIPPED, AND THAT IS THE POINT

`src/art/` is correct. Three candidate fixes were written and **measured against
`dist/`**; all three left it at 17–19 px, so all three were reverted:

1. `isRenderGroup: true` on `VoidBackdrop.view` (commit `e5b21d9`, reverted in
   `1b11579`) — fixed the DEV server, left the production frame byte-identical.
2. Grouping every halo into one contiguous run of gradient fills ahead of all
   points/crosses — changed the frame, did not change the radius.
3. Dropping the ramp's mipmaps — no change.

Because nothing renders differently, **no golden re-baseline is due**.

## DECISIONS

- **`BLOOM.radius` was NOT inflated.** The brief forbids it and it would put the
  constant at odds with the design it is named after.
- **Ruled out by measurement, so a future session does not re-run them:** the
  constants (read back out of the *running* client — still 11.24); the transform
  (`t` is exactly `d/haloR`; the rim lands on ramp texel 230.4, where
  `RAMP_OVERSCAN` puts `profile(1)`); a sprite-cell/atlas clip (the live path
  never goes through a texture); the gradient's outer stop; which sky is on
  screen; the ramp texture's live state (256², resolution 1, identical in both);
  renderer config; WebGL vs WebGPU; camera offset; a layer rebuild; fog; any
  global dim or overlay.
- **My first hypothesis — a factor of two in `rampMatrix` — was wrong**, killed
  by the single-falloff probe. Recorded so it is not re-derived.
- **The decisive control is the build config**: the same `index.html`, same
  source, built by a different Vite config draws the design radius. That is what
  moves this out of Art's files.

## NEXT / FOR THE DIRECTOR

The fix belongs with the app shell and the build (`src/main.ts`,
`vite.config.ts`, `src/render/`) — none of them Art's. The choice between
isolating the sky in the renderer and changing how the bundle is built is not
Art's to make unilaterally, and it is carried in the PR body as the open
question. The gate is in place either way, and it will notice.
