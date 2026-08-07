# a3-01 — rock palette vs board · working notes

Branch: `agent/art/a3-rock-palette-vs-board` · from `369d7a6` (main).

Working note, not evidence. The DoD, the PR body and QA attestation are the record.

## The gate this exists to close

a2-08's third composite, `art-vs-board-scene`, FAILED on measured pixels:

| | live build | concept board |
|---|---|---|
| rock body | `#939BA5` luma 154 | `#454E59` luma 77 |
| rock outline | `#2D3239` | `#262C34` |

`art-vs-board-ships` and `art-vs-board-ui` passed on the same build, so this is one
family that never received the a2 campaign's levers — exactly what GAP-ANALYSIS §2
predicted would be left behind (Lever A, one crisp ink; Lever B, the dark value floor).

## BUILT

- `8ad47c1` — the palette move. Three ramp stops + the rim weight:

  | | before | after | board |
  |---|---|---|---|
  | `rockBody` | `tint(hullSteel,.16)` `#939BA5` L154 | `shade(hullSteel,.48)` `#484E57` L77 | `#454E59` L77 |
  | `rockShadow` | `shade(hullSteel,.32)` `#5A626B` L97 | `shade(hullSteel,.545)` `#40474F` L70 | `#3E4750` L69 |
  | `rockFissure` | `shade(hullSteel,.72)` `#2D3239` L49 | `shade(hullSteel,.77)` `#272C32` L43 | `#262C34` L43 |
  | rim weight | `0.05u` (magic number) | `LINE.rock / 35 ≈ 0.086u` | `stroke-width="3"` |

  Contact sheet regenerated in the same commit.

## DECISIONS

- **Nearest ramp stop, not the board hex.** None of the three board hexes is on the
  `hullSteel → vacuum` ramp — no single `t` reproduces any of them channel-for-channel
  (e.g. `#454E59` needs t = .504/.483/.465 on R/G/B). "No seventh hue" (style-guide §1)
  outranks the hex, so each stop is the nearest ramp value: within 3/255 per channel,
  BT.601 luminance matched to ±1. Rejected: hard-coding the board hexes.
- **All three stops move, not just `rockBody`.** With the body at L77 an unmoved
  `rockShadow` (L97) would be LIGHTER than the rock it shades and every crater would
  have inverted into a highlight. The board names both tones (`#454E59` body,
  `#3E4750` "asteroid satellite facets / shadow rock"), 8 luma apart; ours are 7.4.
- **Craters get subtle, and that is board-faithful.** The gallery's own rocks are flat
  `#454E59` fills. Considered and rejected: lifting crater alpha 0.8 → 1.0 to buy back
  1.8 luma of facet. Not asked for, and it would push past the board rather than to it.
- **`LINE.rock` adopted, first consumer in the repo.** The boards ink every rock at a
  flat `stroke-width="3"` (scene-gallery.html) on bodies of unit radius 25–42; against
  their ~35 mean that is 0.086u, and the generator drew 0.05. Measured on the frozen
  scene the rim goes ~1px → ~3px on a 77px rock. Rejected: leaving the weight alone —
  the brief and QA's verdict both name `LINE.rock`, and a dark body needs the line more
  than a pale one did.
- **`rockFissure` moved rather than forking a new `rockInk`.** It is the rock ink by
  name and by GAP-ANALYSIS §2's own table. It is *borrowed* by ship/satellite/wreck
  plating seams, which therefore darken ~6 luma — measured at 0.2% of the ships contact
  sheet, seam pixels only, no hull plate, no trim, no roster colour, and the move is
  TOWARD Lever A's `#262C34`. Rejected: a near-duplicate `rockInk` token, which would
  have left `rockFissure` named for rocks and used only on hulls.
- **The `chip` VFX particle darkens with the rock.** It derives from `rockBody` and is
  rock coming off a rock; a chip that no longer matched its asteroid would be wrong.
  If the VFX pass (a2-06) wants more pop it should brighten deliberately, not inherit.

## The shared-port trap (read this before re-shooting anything)

`playwright.config.ts` pins the preview to **4173** with `reuseExistingServer: !CI`,
and in this container that port is shared with the other lanes. A build-wheel golden
re-shot at 15:22 came back byte-identical to its old baseline because **lane-3's**
`vite preview` held 4173 and Playwright reused it — the frame was a different branch's
build. Caught only by reading the served bundle back.

Mitigation, both committed under `evidence/a3-rock-palette/`:

- `playwright.a3.config.ts` — the same suite, same `testDir`, same project names
  (therefore the same snapshot files), on port **4287** with `reuseExistingServer:
  false`.
- `verify-served-build.mjs` — reads the served bundle and asserts the new `rockBody`
  int is in it and the old one is not. Run it against the port before trusting a shot.

Second trap, same area: `--update-snapshots` only rewrites a baseline whose diff
EXCEEDS `maxDiffPixelRatio` (0.01 here). The two desktop BUILD WHEEL goldens show the
rock field at 0.71% of the frame, so they passed and kept a stale pale-rock baseline.
They have to be **deleted** and regenerated, not merely updated.

## NEXT

- Re-run the goldens on 4287, then delete + regenerate the two desktop build-wheel
  baselines the tolerance hides.
- QA probe (`evidence/probe-art-palette.mjs`) against a fresh live capture; output
  into the PR body.
- Full `npm test -- --run`, `npm run test:mobile`, then PR.
- `tests/net/online-2p.test.ts` flaked once under the full parallel run
  (41.6 vs a <40 bound) and passes in isolation; it is a net timing test that touches
  no renderer. Re-check on the final run.
