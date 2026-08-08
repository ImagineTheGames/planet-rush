# a0-07 — the darker backdrop, ratified

Branch: `agent/art/a0-07-darker-backdrop`. Working notes, kept current. **Not
evidence** — the DoD, the PR body and QA attestation are the evidence.

## BUILT

| commit | what |
|---|---|
| `8f8c1ab` | Floor is the ground; `sky` is a paint role with a ceiling; style-guide §1.1 + §2.2 |
| `a3c6268` | the six skies, the ground plane, bloom by seeded scatter, the renderer seam |

### The pick, as implemented

- **Ground** — `FLOOR = #010204` in `src/art/tokens.ts`, re-exported from
  `palette.ts`, drawn as a real opaque quad by `VoidBackdrop` (not left to the
  canvas clear colour, so the void owns its own ground and the audit can reach
  it). **Vacuum `#0D1015` is unmoved** — still the ramp's dark endpoint, still
  the HUD panel fill.
- **Bloom** — seeded **scatter** at the **subtle** tier (`BLOOM` in
  `backdrop.ts`). Each star draws one number; that number, not its magnitude,
  decides whether it flares.
- **Nebula** — six, `MAP_NEBULA` assigns four, `UNASSIGNED_NEBULAE` names two.

### The measured table (`npx vitest run src/art/backdrop.test.ts` prints it)

```
None          | map octagon | shapes   0 | overdraw 0.000 | peak Y′  1.9 | tax 0.0% | reduced 0
Coalsack      | map compass | shapes  28 | overdraw 0.967 | peak Y′  1.9 | tax 0.0% | reduced 1   occludes
Iron Veil     | map —       | shapes  14 | overdraw 0.241 | peak Y′ 11.0 | tax 5.2% | reduced 0.5
Patina Drift  | map diamond | shapes  88 | overdraw 0.863 | peak Y′ 15.8 | tax 8.4% | reduced 0.45
Plasma Reef   | map oval    | shapes 156 | overdraw 1.121 | peak Y′ 17.4 | tax 9.7% | reduced 0    ADDITIVE
Deep Ember    | map —       | shapes  20 | overdraw 0.697 | peak Y′  9.7 | tax 4.6% | reduced 1
```

`tax` = the fraction of contrast any bright signal loses to that sky's brightest
pixel. ΔE (CIE76) between each signal and that pixel: ring 78–85, threat red
66–71, ore 106–109, against a floor of 40.

## DECISIONS

### The assignment, and why Plasma Reef went to The Oval

Ranked by measured overdraw, then placed:

- `octagon` → **NONE** (0.000). The default board — what `?debug=1` boots, what a
  returning player finds pre-selected, the first thing a phone meets. The map
  that runs on the most devices costs the least, and "darker, nothing else" is
  the purest statement of the pick.
- `compass` → **Coalsack** (0.967, but **adds no light at all**: it is the ground
  colour in front of the stars, so its peak is the ground's own 1.9 and its
  contrast tax is 0.0%). Derelict-fill, so it carries wrecks and debris below
  eight players — one of the two busiest boards.
- `diamond` → **Patina Drift** (0.863 — the cheaper of the two remaining). The
  other derelict-fill board, and the most contested centre in the set.
- `oval` → **Plasma Reef** (1.121, the costliest). The Oval *regenerates* exactly
  `count` homes instead of filling to eight, so below eight players it is the
  board with the fewest entities on it, and it is a wide arena with an empty
  middle. Under `VfxAutoQuality` the reef drops entirely, so a throttled phone
  stops paying for it.

Unassigned, for `a0-12`: **Iron Veil**, **Deep Ember**.

### Why THOSE two are the unassigned pair (this is the one Director question)

They are the two **warm** skies — rust and dying coals — which is threat red's
hue. Style-guide §2 bars threat red outside `danger`, so shipping them needed a
carve-out, and the carve-out is **§2.2**: threat red on the `sky` role at alpha
≤ `0.06`, enforced numerically in `compliance.ts`, never signal yellow at any
alpha. Leaving both unassigned means **no map that ships today depends on §2.2 at
all** — the Director can veto commit `8f8c1ab` without touching a live board.

### The disqualifier that actually fired

The first build of Plasma Reef **failed**, and it was the brief's own named
frame that caught it. A nested disc stack *converges* under normal blending and
*accumulates* under additive: four stops × five overlapping nodes peaked at
**Y′ 88** — brighter than the ink outline every sprite is drawn with (43.4) — and
ate **69%** of the clockwise threat fill's contrast. Fixed by `ADDITIVE_STOPS`,
whose alpha fractions sum to one, plus looser clot spread and 4 nodes not 5.
Re-measured: peak Y′ 17.4, tax 9.7%, ΔE-to-ring 78.

The reef was then tuned **down** once more (node alpha 0.05 → 0.045) because at
0.05 it took 11.3% of the owner ring's contrast, over the 10% ceiling the test
declared *before* the measurement. It is still the brightest sky in the set.

### Rejected

- **A raw "signal must clear N:1 over the sky" test.** Wrong instrument. WCAG
  contrast saturates on a near-black ground — threat red's own luminance caps it
  at 3.56:1 against pure black — so the rule would be unpassable and would be
  measuring threat red's darkness, not the sky.
- **Contrast tax as the same-hue check.** It is signal-*independent* by
  construction (the signal cancels), so it can only ever be one number per sky.
  The hue question is answered separately, by CIE76 ΔE.
- **Any rock-legibility compensation.** Measured, withdrawn, and asserted in a
  test so it is not re-opened: `rockBody` reads 2.27:1 on Vacuum and 2.47:1 on
  Floor — 8.9% *more* contrast. No rim light, no contrast floor.
- **Changing `PALETTE.vacuum` to `#010204`.** It would have moved every derived
  shade on the ramp and every HUD panel. Floor is a separate, backdrop-only
  token; Vacuum is untouched.
- **A hash or `index % 6` for the sky.** Repeats silently on the fifth map.

### The wiring, and why it touches two files outside src/art

`World` does not carry the map id it was built from (that is `WorldConfig`, and
`src/sim/` is not mine to change). So the seam is: `RenderView.mapId?` (optional,
falls back to the default map's sky) → `Renderer.draw` calls
`backdrop.setMap(view.mapId)` → one line in `src/main.ts` passes `chosenMapId`.
`src/render/index.ts` is the established art seam (a2-06 built the backdrop
through it); `src/main.ts` is one line and no logic.

## NEXT

- [ ] Evidence: phone side-by-side `#0d1015` vs Floor at gameplay zoom, and the
      disqualifier frame (Floor + Plasma Reef, damaged station, owner ring +
      threat fill).
- [ ] Re-baseline the goldens **on an isolated port** — 4173 is shared with the
      other lanes and `reuseExistingServer` will silently shoot their build
      (a3-01's trap). Delete the baselines first: `--update-snapshots` does not
      rewrite a baseline whose diff is under `maxDiffPixelRatio` (r5-01's trap).
- [ ] Eyes on every regenerated image; justify by group in the PR body, and call
      out any snapshot that moved in a way the backdrop cannot explain.
- [ ] PR, with §2.2 flagged at the top as the one thing needing a decision.
