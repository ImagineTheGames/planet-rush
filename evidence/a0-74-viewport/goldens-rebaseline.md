# a0-74 — golden re-baseline: what moved in each frame, and why

Captured in the studio container against this branch's own bundle, on a private
preview port (`PREVIEW_PORT=4278`), because several lanes share this box and the
committed config pins 4173 with `reuseExistingServer: !CI` — re-baselining against
whichever lane booted first would bake another lane's pixels into this branch
(a0-06's trap).

## Finding the real ones: the a0-03 method, and it was needed again

`GOLDEN` in `tests/mobile/goldens.spec.ts` is `maxDiffPixelRatio: 0.01`. At that
tolerance **exactly one** frame failed: `phone-landscape-thumb-band`. Every other
in-match phone frame passed while its stored PNG still showed a FIRE button this
branch no longer draws — 7.7 k changed pixels in a 2532×1170 dpr-3 frame is 0.26 %,
a quarter of the tolerance. The tolerance is correct (it is there for font/GPU
antialiasing) and is **untouched**; the consequence is that a control appearing or
vanishing cannot fail a golden, so the stale ones have to be found deliberately.

So the suite was re-run once at `maxDiffPixelRatio: 0` and every failing pair was
localised with a0-03's own tool (`evidence/a0-03-wheel-cost/localize-diffs.mjs`),
which reports the bounding box and the clusters of changed pixels rather than a
count — position separates signal from noise where a count cannot. **That
tolerance edit is not committed**; `goldens.spec.ts` line 75 is byte-identical to
its committed state.

30 of 50 frames "differ" at tolerance 0. Nine of them are this branch's.

## Re-baselined: 9 frames, and the same three clusters in every one

Every one is an **in-match phone frame**. The clusters are the same three things
each time (coordinates from the landscape frames; the portrait ones are these
rotated by the landscape lock):

| cluster | what it is |
|---|---|
| `~6100 px @ [720,264,840,384]` | the **hold-to-FIRE button, gone** — bottom-right |
| `~1290 px @ [24,216,168,384]` | the **left thrust-stick ghost, gone** — bottom-left |
| `~360 px @ [744,48,840,120]` | the **VIEW 1× control, new** — top-right, under HOME |

| golden | Δpx @ tol 0 | why it moved |
|---|---|---|
| `phone-landscape-frozen` | 7 734 | the three clusters above, exactly |
| `phone-landscape-frozen-teams` | 7 734 | the same three; the side labels are untouched |
| `phone-landscape-hud-top` | 3 181 | VIEW 1× enters the clipped top band (2 209 px of it); the rest is AA on the clock and the HP numerals |
| `phone-landscape-build-wheel` | 18 476 | the three clusters + AA around the wheel's own rings |
| `phone-landscape-build-wheel-touch` | 18 476 | ditto, with the RADAR wedge still lit under the thumb |
| `phone-landscape-upgrade-wheel` | 18 476 | ditto; every cost is still one number (a0-41) |
| `phone-portrait-build-wheel` | 7 563 | the three clusters through the landscape lock |
| `phone-portrait-upgrade-wheel` | 7 563 | ditto |
| `phone-portrait-frozen-teams` | 7 734 | ditto |

**All nine were opened and read at full size before committing.** What each one
has to show, and does: no FIRE ring in the bottom-right, no ghost ring in the
bottom-left, `VIEW` over `1×` in the top-right immediately under the HOME cluster
— and *nothing else moved*. The wheels still read `FULL` / `4/4 BUILT` / `OPEN ▸`
and price in one number; the teams frames still carry `FRIENDLY A` / `ENEMY B`;
the clock still reads `WAVE 1/5 · Outer Drift`.

## NOT re-baselined, and why

**`phone-landscape-thumb-band`** — the one frame that failed at the shipped
tolerance, and the one frame that is *not* re-baselined. It exists to film the
four touch controls in Gantry/Bone (a0-23), and left alone it would re-baseline to
an **empty band**: a re-baseline that deletes the subject is not a re-baseline.
Instead the test now seats the sticks scheme before boot — the same
`addInitScript` line three other specs in `tests/mobile/` already carry — so it
goes on filming the rings it was written for. Its stored PNG is unchanged, and it
passes. Marked in the file as a UI-lane edit to a QA-owned test; it drops cleanly.

**21 frames of pre-existing `main` drift.** Every remaining tolerance-0 failure is
a single tight cluster of 112–163 px in one corner: `[0,360,48,384]` on a landscape
phone, `[0,768,48,792]` on desktop, `[0,0,24,48]` through the portrait lock. That
is the **build stamp**, which carries the commit hash and therefore differs on
every commit ever made. It appears on the title, settings, doors, codex, lobby,
ship-select, map-select and end-of-match frames — screens with **no HUD and no
touch controls on them at all**, so this branch cannot be what moved them. Not
mine, not re-baselined.

## What did NOT move, and it is the load-bearing negative

**Every desktop in-match frame passes at `maxDiffPixelRatio: 0`** — byte-identical:
`desktop-frozen`, `desktop-frozen-teams`, `desktop-hud-top`, `desktop-hud-footer`,
`desktop-build-wheel` (both), `desktop-build-wheel-hover`, `desktop-upgrade-wheel`
(both), and all three `desktop-sky-*`.

That is the evidence for two claims this branch makes in prose:

1. **The content box is a no-op below the reference width.** At 1280×800 the box
   *is* the viewport, so not one HUD pixel moves — asserted in
   `src/ui/hud.test.ts`, and here it is, in pixels.
2. **`cameraScale(1)` is the camera that shipped.** The zoom is a defaulted
   argument through `camera.ts`, `cull.ts` and the renderer; a desktop frame is
   drawn through all three and comes out identical to the byte.
