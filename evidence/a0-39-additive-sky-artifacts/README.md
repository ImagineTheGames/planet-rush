# a0-39 — the additive skies render as artifacts, not as nebulae

*Owner: Art Agent. Branch `agent/art/a0-39-additive-sky-artifacts`.*

> *"the maps have visual artifacts, its not the bloom, look at this other one as
> well its the nebulas that are fucked"* … *"i played on compass and the bloom
> was correct"* … *"yeah these look nothing like the nebula concepts we had
> drawn on the html previews"*

**It was the four-stop soft-disc stack — `SOFT_STOPS` (`src/art/backdrop.ts`).
The number that proved it: an isolated Deep Ember body's rings sit at
`r/r_outer` 0.198 / 0.460 / 0.718 / 1.000 against `SOFT_STOPS`' own
0.200 / 0.460 / 0.720 / 1.000 — a maximum error of 1%.**

---

## 1. The instrument

| file | what it is |
|---|---|
| `sky-rig.html` + `sky-rig.ts` | the shipped `VoidBackdrop`, **alone**, per map, at 1280×800 over that map's real arena bounds. No ships, no rocks, no HUD — the report is about the sky, and anything else in the frame is something for the eye to blame instead. A `starless` flag hides the three star layers, which is what makes a ring count possible at all (a star's core is white at alpha 0.88, so on a frame with stars in it the brightest pixel and every hard edge is a star). It also counts `WebGL2` `draw*` on a steady-state frame. |
| `shoot.mjs` | drives it: two PNGs per map (`<map>-<sky>.png`, `<map>-<sky>-skyonly.png`) and `rings-<label>.json` |
| `ring-profile.mjs` | the measurement the brief asks for — a 720-ray rotational radial profile of one blob, its flat plateaus, and the radii of its steps |
| `frame-diff.mjs` | before vs after, per map, as the fraction of pixels that moved |

```sh
node evidence/a0-39-additive-sky-artifacts/shoot.mjs after
node evidence/a0-39-additive-sky-artifacts/ring-profile.mjs \
  evidence/a0-39-additive-sky-artifacts/frames/after/line-deepEmber-skyonly.png 110 472 240
node evidence/a0-39-additive-sky-artifacts/frame-diff.mjs
```

## 2. Reproduced first, on the developer's own split

`frames/before/` — and the split holds exactly:

| map | sky | drawn with | the frame |
|---|---|---|---|
| `octagon` | none | — | clean |
| **`compass`** | **Coalsack** | `softDisc`, in **GROUND_COLOR** | **clean — the control** |
| `line` | Deep Ember | `softDisc` + `SOFT_STOPS` | **four concentric rings, maroon core** |
| `oval` | Plasma Reef | `softDisc` + `ADDITIVE_STOPS` | ringed orbs |
| `diamond` | Patina Drift | `softWisp` + `SOFT_STOPS` | nested contour polygons |
| `crescents` | Iron Veil | `sheet()` — flat quads, no falloff at all | **hard diagonal banding** |

Two corrections to the brief's framing, both from the pixels rather than from an
argument:

1. **It is not the additive/normal split.** Only Plasma Reef is `additive: true`;
   Deep Ember, Patina Drift and Iron Veil are all `additive: false` and all three
   are broken. Coalsack is clean because it is **the ground colour over the
   ground** — its four steps composite to the same near-black at every stop, so
   the stack is invisible. That *is* the brief's reasoning; only the label was
   wrong.
2. **Iron Veil is a second defect with the same shape.** It is the *"diagonal
   banding"* half of the report, and `sheet()` has no stops to blame — it had no
   falloff at all.

## 3. The measurement that closed it

`ring-profile.mjs`, isolated Deep Ember body on `line`, sky-only frame, centre
(110, 472), 720-ray rotational average:

```
                                     BEFORE                    AFTER
  flat plateaus inside the blob      4 × 38–53 px              7 × 9–16 px
  luma at each plateau               7.633 5.003 3.357 2.144   a continuous ramp
  distinct luma levels, r 0…rim      25 of 211                 115 of 186
  steepest 6 px drop                 2.629 Y′                  0.955 Y′
  what a smooth falloff could reach  0.143 Y′                  0.107 Y′
  ring radii, r/r_outer              0.198 0.460 0.718 1.000   —
  SOFT_STOPS radii                   0.200 0.460 0.720 1.000
```

Four dead-flat plateaus separated by jumps **18× steeper than any gradient over
the same blob could produce**, landing on the stop radii to within 1%. Full
output in `ring-profile-before.txt` / `ring-profile-after.txt`.

The residual after the fix is the 8-bit floor and nothing else: one output code
value in G *is* 0.715 Y′, and no amount of correctness removes it. What the fix
removes is staying flat in between — and a ±0.5-code dither on the ramp moves
where each code boundary falls, so the contour is noise instead of a circle.

## 4. What moved, and what did not

`frame-diff.txt` — the same 1280×800 frames, before against after:

```
octagon    none         moved   0.0% of pixels  max Δ   0 codes
compass    coalsack     moved   0.1% of pixels  max Δ  44 codes   ← THE CONTROL
oval       plasmaReef   moved  36.0% of pixels  max Δ   6 codes
diamond    patinaDrift  moved  53.5% of pixels  max Δ  16 codes
line       deepEmber    moved  30.2% of pixels  max Δ   7 codes
crescents  ironVeil     moved  38.9% of pixels  max Δ  18 codes
```

**The no-sky map is byte-identical and Coalsack is untouched to a tenth of a
percent** (its 0.1% is stars at the dust lane's own edge, occluded a hair
differently). The four reported skies moved on a third to a half of the frame.

## 5. The perf answer the a1-16 gate cannot give

The submission gate's stress scene runs on `octagon`, whose sky is NONE, so it
never draws a nebula. The rig counts the frame instead:

```
             sky shapes         draw calls / frame
             before   after     before   after
  none            0       0        4       4
  Coalsack      216      54        5       5
  Plasma Reef  1040     260        5       5
  Patina Drift  592     148        5       5
  Deep Ember    136      34        5       5
  Iron Veil      93      93        5       5
```

One gradient shape replaced four flat ones, so the four stacked skies are
**exactly quartered**; Iron Veil was already one shape per sheet. Draw calls do
not move, because every gradient in the void samples one shared ramp texture and
Pixi batches by texture. Measured overdraw falls 44% across the set and **the
cost ranking is unchanged**, so no `MAP_NEBULA` assignment is re-argued.

`npm run test:perf-budget` is green and unmoved: desktop 10.8 draw calls / 173
submitted, phone 9.1 / 11.

## 6. Two things the measurement forced out that were not in the brief

**Deep Ember was over its own ceiling, and had been since a0-07.** A four-stop
stack paints `1 − Π(1 − a·fᵢ)` = 2.26 a, not the `a` it declares. Deep Ember
declared 0.030–0.045 and painted **0.068–0.101** — up to **1.7× over
`SKY_RESERVED_ALPHA_MAX`** (0.06), the style-guide §2.2 carve-out. `compliance.ts`
never saw it because it audits one shape at a time and the stack was four. One
gradient shape declares what it paints, so the sky is now capped at the ceiling
and comes back dimmer. **Raising 0.06 is the Director's call and this brief did
not take it.**

**`skyBrightness` was measuring a sky nobody sees.** It sampled one screenful of
elements, and a peak is an extreme value — the extreme over nine clots is not the
extreme over the sixty a real arena carries. On the shipped build Plasma Reef
pinned at Y′ 17.4 there and rendered at **17.9** in a real 1280×800 frame, where
the owner beacon ring lost **10.6%** of its contrast against a 10% ceiling the
test could not see it breach. It now samples the window a camera can actually
reach across a crossing (`visibleSpan`), and the reef is tuned to a measured
**9.4%** — inside its own rule for the first time, at a cost of 5% of a
brightness nobody has been shown.

## 7. Frames

`frames/before/` and `frames/after/`, six maps each, with and without stars.
Three of them are now standing baselines: `tests/mobile/goldens.spec.ts-snapshots/`
gained `desktop-sky-plasma-reef`, `desktop-sky-deep-ember` and
`desktop-sky-coalsack` — the additive path, the photographed frame, and the
control that has to stay still. Before a0-39 **no golden in this repo contained a
nebula at all**, which is how a defect this visible was reported three times
before any committed picture showed it.
