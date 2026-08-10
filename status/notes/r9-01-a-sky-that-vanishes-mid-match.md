# r9-01 — a sky that leaves 8 seconds into the match

Branch: `agent/art/r9-01-sky-survives-the-reducer`

## BUILT

- **`d239a36` fix(r9-01): a sky may thin, and it may never leave the stage.**
  - `src/art/backdrop.ts`
    - New `SKY_REDUCED_FLOOR = 0.25` + `reducedSkyDensity(spec)`. A throttled sky
      is thinner, never absent.
    - `PLASMA_REEF.reducedDensity` **0 → 0.45**, measured (see DECISIONS).
    - `VoidBackdrop` gained a **density pin**: the VFX tier is read once, when the
      sky goes on the stage, and held until the sky itself changes
      (`setMap` to a different sky, or `destroy()`). `setReduceVfx` no longer
      rebuilds anything.
    - The rebuild key carries `builtDensity` instead of `builtReduced`, so the
      reducer flipping mid-match is not a rebuild trigger at all.
    - `drawSky` no longer consults the density — `none` is skipped on its **id**.
    - New read-back `get skyDensity()`.
  - `src/art/backdrop-reducer.test.ts` (new) — drives a real `VoidBackdrop`
    through real Pixi containers and asserts on **what is on the stage**.
    **9 of its 10 tests fail on the code as it stood**; the 10th is the full-VFX
    control that must pass either way (verified by re-introducing the defect).
  - `src/art/backdrop.test.ts` — the declared-shed test no longer has a
    "dropped entirely" branch; two new tests (`no sky with geometry can be
    declared out of existence`, `a thinned sky is a cheaper sky and never a
    brighter one`); the cost table now prints reduced overdraw beside the
    declared density.

Gates at that commit: `npx tsc --noEmit` clean; `npm test -- --run`
**273 files / 4769 tests passed**.

- **`6bba177` evidence(r9-01): the sky held for 45 s on the arena that lost it.**
  `evidence/r9-01-sky-survives-reducer/` — probe, figure script, README,
  `measurements.json`; six plates in `evidence/images/r9-01-*`, each attested
  one by one in `evidence/manifest.json`.

  | build | arena | t+1s | t+45s | dropped | reduce-VFX engaged |
  |---|---|---|---|---|---|
  | `dd1d3f5` | **oval** | `plasmaReef` | **— gone** | **t+6.1 s** | t+6.1 s |
  | `dd1d3f5` | line (control) | `deepEmber` | `deepEmber` | never | t+6.7 s |
  | `7a90b22` | **oval** | `plasmaReef` | **`plasmaReef`** | **never, 45/45 polls** | t+18 s |
  | `7a90b22` | line (control) | `deepEmber` | `deepEmber` | never | t+18.9 s |

  The reducer's own state is read off the live page with **no debug seam added**:
  `drawAtmosphere` rebuilds the owned station's halo as rings alone when
  `reduceVfx` is on, and `atmosphereHaloSprite` is 53 shapes full against 13
  reduced, so the live `atmosphere-*` Graphics' instruction count *is* the tier.
  That is what makes the after-run mean anything — before the fix, "the reef is
  gone" was itself the proof the reducer had engaged.

## DECISIONS

**Picked options 1 + 2 from the brief, as one rule with two halves.** Neither is
sufficient alone:

- *Floor alone* still steps a sky from 22 wisps to 10 in one frame, mid-match, in
  front of the player — and because a sky's element count seeds its own layout,
  several of the six do not merely thin at a lower density, they **re-scatter**.
  The whole sky would change at once.
- *Build-only alone* leaves `reducedDensity: 0` meaning "The Oval has no reef at
  all" for anyone who boots with the manual reduce-VFX setting on. Quieter, same
  loss.

Together: the discontinuity lands **before** the match instead of during it, and
what a throttled device gets is a sky rather than a hole.

**Rejected — option 3, fade.** A cross-fade needs the full layer and the thin
layer alive at once, so it *doubles* the fill for the length of the transition,
at the exact moment the reducer engaged because fill was already too dear. Fading
the single layer's alpha instead saves nothing at all (same geometry, same
rasterisation). Under the pin there is no mid-match transition left to smooth.

**Why 0.45 for the reef, measured not asserted.** The reef's fill is not in its
clots (r ≈ 0.045–0.095 of a screen half-height) but in the three broad base
washes under them (r ≈ 0.5–0.8). Canonical 1600×900 screenful, `overdrawOf`:

| density | overdraw | what is left |
|---|---|---|
| 1.00 | 1.121 | 3 washes, 9 clots |
| 0.50 | 0.701 | 2 washes, 5 clots |
| **0.45** | **0.463** | **1 wash, 4 clots — 59% of the fill gone** |
| 0.30 | 0.443 | 1 wash, 3 clots |
| 0.25 | 0.427 | 1 wash, 2 clots |
| 0.15 | 0.414 | 1 wash, 1 clot |

Below 0.45 the saving stops arriving (the last base wash is the floor of the
cost) and only clots are lost; at 0.50 the second wash rounds back in. The
throttled reef at 0.463 costs less than Coalsack (0.691) or Deep Ember (0.746).
The old comment's claim — "a fraction of it saves a fraction of nothing" — was
never measured and is wrong.

**Why 0.25 for the floor.** Patina Drift, the sky with the most parts, is 22
wisps per screenful; a quarter of it is five. Below that a sky rounds toward one
or two elements and is a shape, not a field. It is a **backstop**, not the
mechanism — every sky with geometry declares at or above it on its own merits and
a test asserts that, so the clamp should never bite. It exists so the exact edit
that cost The Oval its sky cannot be made again.

**All six checked, not just plasmaReef** (the brief asked): `none` 0 (honest — no
geometry at either tier, and the renderer skips it on the id), `coalsack` 1,
`ironVeil` 0.5, `patinaDrift` 0.45, `deepEmber` 1. Nobody else held the cliff.
`backdrop-reducer.test.ts` still asserts the engage on all six arenas, since
a1-07 only watched two over time.

**Not changed, on purpose:** `MAP_NEBULA` (all six verified live by a1-07),
seeded scatter, bloom, Floor ground, every alpha and blob count, and Coalsack's
`reducedDensity: 1` — whose comment is the precedent this whole brief rests on.

**No golden re-baseline.** At full VFX the pinned density is 1 and the geometry
is byte-identical to `dd1d3f5`; goldens ride `?freeze=1`, which `main.ts` holds
at full VFX by construction (`flags.freeze ? false : …`). Only the reduced tier
renders differently, and nothing frozen renders it.

**Flagged, not touched:** `src/render/index.ts:409-410`'s comment still says the
void "sheds its nebula … Rebuild happens lazily in draw". That is now stale — it
neither sheds nor rebuilds on the tier. `src/render/` is not art's file, so the
correction is raised in the PR body for its owner rather than made here.

**One consequence worth naming rather than discovering.** With the pin, the
*auto* path can only thin the **next** sky, never the current one — and the tier
is not knowable at frame 1 (the reducer is a 3-second measurement, not a device
probe), so a first-boot match on a slow device keeps its full sky and pays for it.
The paths that do reach a thin sky are: the manual reduce-VFX setting on before a
match's sky is built, and any new sky committed while the tier is engaged. That is
the trade the brief's option 2 asks for, stated plainly. If the Director wants a
slow device to *boot* thin, the lever is a persisted tier in platform's hands, not
the backdrop's.

Two seams named for their owners rather than reached into:

- `src/render/index.ts:409-410` — the comment about the void "shedding its
  nebula" is now stale.
- Within one page session `Renderer` is constructed once (`main.ts:1174`) and
  `backdrop.destroy()` is never called, so a **rematch on the same map** keeps the
  pin from the previous match. A missed saving, not an artefact; `destroy()` at
  match start would release it if Render wants that.

## NEXT

- [x] Live evidence: 45 s scene-graph poll on a served build, Oval + Line
      control, sky must survive. Shape borrowed from a1-07's `probe-throttle.mjs`
      (which lives on `agent/qa-manager/a1-07-sky-registry`, unmerged).
- [x] Push branch, open PR, DoD gates.

No blockers.
