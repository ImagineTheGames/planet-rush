# a0-18 — the bloom is not gone, and here is the instrument that says so

> *"the bloom orbs are gone, but they are gone completely, they were supposed to be
> there with subtle bloom on random stars…"* — the developer, from live play, after
> tonight's renderer work landed.

**The bloom is present, correct, and byte-for-byte unchanged by tonight's work.
None of the three suspects did it. Nothing did it.**

Measured on two served bundles, same arena, same seed, same viewport, same pinned
tick, twelve minutes apart on one box:

| | |
|---|---|
| **after** | `ebdae99` — current `main`, the build under report |
| **before** | `111db86` — `ecc1496^`, the commit before a1-11's pooling and a1-12's cull |

| what was compared | result |
|---|---|
| bloomed stars submitted, all three layers, frozen octagon | **319 of 1,624 — identical on both builds** |
| bloom ratio against `BLOOM.scatter` = 0.18 | 0.196 desktop, 0.180 phone |
| the void's own pixels, before vs after | **68 differ, of 5,184,000** |
| …and where those 68 are | **all at one site, on one rock's rim**; 66 of 68 sit on top of a world object |
| the *world's* pixels, before vs after | 56,143 differ, peak Δ65 — the entity layers, which is what a1-11/a1-12 were for |
| the null control (same frame twice) | **0 pixels, peak Δ 0** — a calibrated zero, so none of the above has a noise floor to clear |

`plates/verdict-the-orb-did-not-move.png` is the whole round in one image: a 96 px
window on a bloomed `near` star, cut identically from both builds at 6× nearest
neighbour with no amplification. Left `111db86`, middle `ebdae99`, right the
difference at ×6. **The rock's rim lights up. The orb is black — it did not
change.** Every differing pixel in that window lies in the left 168 columns; the
nearest one to the star is 20.2 device px away.

## Which of the three suspects it was: none of them

| # | the suspicion | verdict | how |
|---|---|---|---|
| 1 | **pooling (a1-11)** bakes at a different scale or quantises alpha, so a 6% wash dies while the 1 px core survives | **cleared** | the star layers are not baked at all — `VoidBackdrop.configure` plays them into `Graphics` with `drawSprite(…, 1)` and never touches `SpriteTextureCache`. Read off the *running* build, the halo alphas arrive as 0.0169–0.1472, i.e. `BLOOM.intensity` applied and not rounded away |
| 2 | **the cull (a1-12)** reaching a backdrop layer it should never touch | **cleared** | all three `void-stars-*` layers are on the stage, `visible`, `renderable`, `alpha` 1, on both arenas and both viewports; the backdrop is a sibling of `worldRoot`, and the cull only ever writes `visible` on entity layers |
| 3 | **reduced-VFX** shedding more than it claims | **cleared, and on the path that can actually show it** | `?freeze=1` pins `reduceVfx` to false (`src/main.ts`), so the frozen probe cannot test this at all. `probe-live.mjs` runs the sim for 30 s at **4–5 fps** and the star field is unchanged from t+2 s to t+30 s, desktop and phone. The comment in `Renderer.setReduceVfx` is not a lie |

**One limit of that third row, stated rather than glossed.** The reducer's state was
**not read back — it was inferred from the frame rate.** `window.__planetRush`
exposes `shipScreen, shipWorld, viewport, fps, build, ticks, input, muzzles,
stageCombat, damageShip, damageCore, coreHp, layout, resolveAnchor, placement,
frozen, freezeTick, worldHash` and **no VFX-tier handle at all**, so the probe has
no way to ask. What it can say is that the run held **4.6–5.8 fps for 30 s**, and
`VfxAutoQuality` engages on a sustained drop below the fps floor — three seconds
under 30 fps, per r9-01. A run six times under the floor for ten times the trigger
window all but certainly had the reducer on, and the star field did not move
across it; but "all but certainly" is the honest strength of this row, and the
`backdrop-bloom.test.ts` tests that drive `setReduceVfx(true)` directly are what
close it properly. **A `reduceVfx` read-back on the debug handle would make this
row a measurement instead of an inference** — worth filing, and it is `src/main.ts`,
so not this round's to add.

The brief said to say so if the bloom turned out to be present and something else
had changed the look. **Something else did change the look, and it is the rocks.**
The 56,143 world pixels are a1-11 re-baking the entity looks as mipmapped sprites;
the change is concentrated on silhouette rims at up to Δ65. a1-07 had already
established that the soft grey discs the developer was describing *in that round*
were the asteroids — the same objects whose rims moved tonight. That is a lead for
the Director, not a finding of this round: nothing here measures perception.

## How the bloom was read rather than eyeballed

Two independent instruments, because "is it submitted" and "is it painted" have
different answers and only one of them was ever the bug.

**1. The geometry read-back — what the build submits.** `starFieldSprite` pushes,
per bloomed star and in this order, the outer halo (r×4.3, alpha×0.065), the inner
halo (r×2.4, alpha×0.16), then the star's own point. `drawSprite` plays each as
`circle()` + `fill()`, so on the live `Graphics` each is its own
`context.instructions` entry with its own path and alpha. **Grouping a layer's
fills by centre recovers the scatter exactly**: a group of 3 is a bloomed star, a
group of 1 is a plain one. Nothing is inferred from a pixel.

Frozen octagon, 1440×900 at dpr 2, identical on `111db86` and `ebdae99`:

| layer | stars | bloomed | ratio | widest halo (units) | halo alphas |
|---|---|---|---|---|---|
| `deep` | 795 | 163 | 0.205 | 4.08 | 0.0169 – 0.0608 |
| `mid` | 575 | 102 | 0.177 | 5.78 | 0.0273 – 0.1120 |
| `near` | 254 | 54 | 0.213 | 9.24 | 0.0416 – 0.1472 |

**2. The frame isolation — what the GPU paints.** a1-07's method: on
`?debug=1&freeze=1` the sim is pinned, so two screenshots differing by exactly one
hidden layer differ by that layer's own pixels. `|A − A-without-that-layer|` is the
layer, alone. The stage is reached through Pixi 8.6.6's own devtools hook
(`globalThis.__PIXI_APP_INIT__`) from a Playwright init script, so **nothing in
`src/` is touched** and the same file measures any commit's bundle.

The largest `near` orb, as a horizontal cut of raw luma through its centre
(ground → out):

```
ground 1.9 │ outer halo 15.9 │ inner halo 48.9 │ core 230.0
      Δ 0            Δ 14              Δ 47          Δ 228
```

Two flat rings and a point, at the ratified alphas, exactly as authored.

## What a screenful actually holds — the honest remainder

The bloom being *present* is not yet an answer to *"gone completely"*, because
what the developer is reporting is a perceptual quantity. So it is counted as
one. One screenful, 1440×900 CSS at dpr 2, `ebdae99`:

| arena | stars on screen | bloomed | orbs whose halo clears Δ10/255 | median orb |
|---|---|---|---|---|
| octagon (sky `none`, the goldens' arena) | 194 | 34 | **20** — 2 near, 11 mid, 7 deep | 6 – 12.5 CSS px |
| line (sky `deepEmber`) | 192 | 41 | **27** — 5 near, 11 mid, 11 deep | 6.5 – 12 CSS px |

Those counts come from pixels alone — components split by footprint against each
layer's authored radii, with no knowledge of `BLOOM.scatter` anywhere in the
script. **They land on 17.5% and 21.4%, recovering the ratified 0.18 from the
frame.** That agreement is the cross-check that the census measures what it says.

So: "gone completely" is not what the frame says. **"You can fly for a while
without noticing one" is.** The near layer — the only one whose orbs are
unambiguous at 12.5 CSS px — puts **two** on a desktop screen, because
`BLOOM.radii` multiply each star's own radius and `near` has a density of 13. The
21 deep-layer orbs are 6 px wide at Δ7 and are, honestly, not there to the eye.

**That is a design call on scatter and density, and it is the Director's.** It is
flagged, not acted on: `BLOOM` is ratified, a0-07 chose the lowest of the three
magnitudes shown on purpose, and the brief forbids both a brighter bloom and a
different mechanism. Nothing in this round changes a rendered pixel.

## Why nothing in the suite could have caught this — and what now does

- `src/art/backdrop.test.ts` asserts the halos are in the `SpriteDef`. It is
  DOM-free and stops there, so **the entire distance from generator to frame was
  untested** — every renderer change in the game's history could have dropped the
  halos on the way and it would still have passed.
- The goldens cannot help, and not only for the reason the brief gives. The frozen
  scene runs `octagon`, whose sky is `none` — but `octagon` *does* carry all three
  star layers, so the plates were never blind to the bloom for want of a sky. They
  are blind because **the widest halo ring is Δ14 of luma over Floor**: plates
  either side of a *total* bloom loss read as identical to a reviewer. A golden is
  the wrong instrument for a 6% wash and always was.

`src/art/backdrop-bloom.test.ts` (8 tests) closes the gap by asserting on
`context.instructions` — the identical read-back `probe-bloom.mjs` takes off the
running build. The unit test and this evidence therefore agree, to the
instruction, on what "the bloom is on the stage" means.

**A test that fails without the fix.** There is no fix, so the guard is
demonstrated the other way: `mutation-check.mjs` injects each suspected defect
into `backdrop.ts`, runs the guard, and restores the tree. **5 of 5 caught.**

| injected defect | guard |
|---|---|
| halo alpha quantised to 1 dp (suspect 1's exact prediction — floors every `deep` halo to 0) | 7 of 8 tests fail |
| bloom not submitted at all (the report taken at its word) | 6 fail |
| a cull leaves a star layer not visible (suspect 2) | 3 fail |
| the reducer sheds star layers (suspect 3) | 2 fail |
| the halo drawn *over* its star instead of behind — nobody's suspect, easiest to do by accident | 2 fail |

That harness paid for itself immediately: **suspect 3 initially passed.** r9-01's
density pin makes mid-match `configure` a no-op, so a reducer shedding layers
inside the build loop is never reached and the assertion sailed over the bug. The
two real ways into that loop at the reduced tier — a boot that is *already*
throttled, and a resize or rotate while throttled — are now tests of their own.

## Rerunning it

Needs a preview of each build under test on a **private** port; several lanes share
this box and a suite that reuses somebody else's server shoots somebody else's
bundle and goes green doing it (a3-01). `--host 127.0.0.1` because Node's `fetch`
resolves `localhost` to a family Vite may not have bound.

```sh
# after — current main
npm run build && npx vite preview --port 4931 --strictPort --host 127.0.0.1

# before — ecc1496^, in a worktree so main is never checked out over
git worktree add /tmp/pr-before ecc1496^ && ln -s "$PWD/node_modules" /tmp/pr-before/node_modules
(cd /tmp/pr-before && npm run build && npx vite preview --port 4932 --strictPort --host 127.0.0.1)

node evidence/a0-18-bloom-gone/probe-bloom.mjs 4931 after-ebdae99
node evidence/a0-18-bloom-gone/probe-bloom.mjs 4932 before-111db86
node evidence/a0-18-bloom-gone/probe-live.mjs  4931 live-after-ebdae99   # the reducer, on the live path
node evidence/a0-18-bloom-gone/diff-builds.mjs                          # void / world / background
node evidence/a0-18-bloom-gone/find-orbs.mjs                            # aim the crops at real orbs
node evidence/a0-18-bloom-gone/census-orbs.mjs                          # the perceptual census
node evidence/a0-18-bloom-gone/make-plates.mjs
node evidence/a0-18-bloom-gone/make-verdict-plate.mjs
node evidence/a0-18-bloom-gone/mutation-check.mjs                       # does the guard bite
```

`frames/` is the raw material; `plates/` is what was looked at with eyes.
`_entries.mjs` holds the attestations for the gallery and **has deliberately not
been run** — `evidence/manifest.json` and `evidence/images/` are the QA Manager's,
so merging is theirs to do.
