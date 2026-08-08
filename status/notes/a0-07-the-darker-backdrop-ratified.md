# a0-07 — the darker backdrop, ratified

Branch: `agent/art/a0-07-darker-backdrop`. Working notes, kept current. **Not
evidence** — the DoD, the PR body and QA attestation are the evidence.

## BUILT

| commit | what |
|---|---|
| `8f8c1ab` | Floor is the ground; `sky` is a paint role with a ceiling; style-guide §1.1 + §2.2 |
| `a3c6268` | the six skies, the ground plane, bloom by seeded scatter, the renderer seam |
| `b9454b6` | these notes |
| `2307b74` | **a sky is authored per SCREENFUL, not per arena** (see DECISIONS) |
| `bb2d1e1` | evidence: side-by-side, the four assigned skies, the disqualifier frame |
| `7e79d24` | re-baseline all 35 goldens |
| `758f67b` | untrack three scratch playwright configs swept up by `git add -A` |
| `30c3a92` | the per-frame cost table, and the frame-time measurement that was thrown out |
| `7ffc837` | **merge `origin/main`** — a0-03 (wheel cost) and a0-04 (nameplates) landed under this branch |
| `78dc317` | re-baseline the 35 goldens **again**, on the merged tree |

### The pick, as implemented

- **Ground** — `FLOOR = #010204` in `src/art/tokens.ts`, drawn as a real opaque
  quad by `VoidBackdrop` (not left to the canvas clear colour, so the void owns
  its ground and the palette audit can reach it). **Vacuum `#0D1015` is
  unmoved** — still the ramp's dark endpoint, still the HUD panel fill.
- **Bloom** — seeded **scatter** at the **subtle** tier (`BLOOM`). Each star
  draws one number; that number, not its magnitude, decides whether it flares.
- **Nebula** — six; `MAP_NEBULA` assigns four, `UNASSIGNED_NEBULAE` names two.

### The measured table (`npx vitest run src/art/backdrop.test.ts` prints it)

```
sky           map      shapes  overdraw  build   peak Y′  tax   ΔE ring  reduced
None          octagon       0     0.000  0.00ms      1.9  0.0%       85  n/a
Coalsack      compass      28     0.691  0.08ms      1.9  0.0%       85  1     occludes
Iron Veil     —            14     0.208  0.15ms      9.3  4.3%       83  0.5
Deep Ember    —            20     0.746  0.07ms      9.7  4.6%       84  1
Patina Drift  diamond      88     0.863  0.80ms     15.8  8.4%       81  0.45
Plasma Reef   oval        156     1.121  0.24ms     17.4  9.7%       78  0     ADDITIVE
                                                 ink 43.4  ← no sky is ever brighter
```

`tax` = the fraction of contrast any bright signal loses to that sky's brightest
pixel (signal-independent by construction — see DECISIONS). ΔE is CIE76 against
a floor of 40; it is the *same-hue* check the tax cannot answer.

## DECISIONS

### The assignment

Rule: **the cheapest sky on the board that runs on the most devices, the
costliest on the board with the fewest entities.**

- `octagon` → **NONE** (0.000). The default board — what `?debug=1` boots, what a
  returning player finds pre-selected, the first thing a phone meets.
- `compass` → **Coalsack** (0.691, and the only sky that *adds no light*: it is
  the ground colour in front of the stars, peak Y′ 1.9, tax 0.0%). Derelict-fill,
  so it carries wrecks and debris below eight players — a busy board.
- `diamond` → **Patina Drift** (0.863). The other derelict-fill board, most
  contested centre.
- `oval` → **Plasma Reef** (1.121, costliest). Regenerates exactly `count` homes
  instead of filling to eight, so below eight players it has the fewest entities;
  and under `VfxAutoQuality` the reef drops entirely.

Unassigned, for `a0-12`: **Iron Veil**, **Deep Ember**.

### Why THOSE two are unassigned — the one Director question

They are the two **warm** skies, which is threat red's hue. §2 bars threat red
outside `danger`, so shipping them needed **§2.2**: threat red on the `sky` role
at alpha ≤ `0.06`, enforced numerically in `compliance.ts`; signal yellow never,
at any alpha. Leaving both unassigned means **no map that ships today depends on
§2.2** — the Director can veto commit `8f8c1ab` without touching a live board.

### Three things that were wrong and had to be fixed

1. **The disqualifier fired.** Plasma Reef's first build peaked at **Y′ 88** —
   brighter than the ink outline (43.4) — and ate **69%** of the clockwise threat
   fill's contrast. Cause: a nested disc stack *converges* under normal blending
   and *accumulates* under additive, so 4 stops × 5 overlapping nodes multiplied.
   Fix: `ADDITIVE_STOPS`, alpha fractions summing to one, plus looser clots and 4
   nodes not 5. Then tuned **down** once more (0.05 → 0.045) because at 0.05 it
   took 11.3% of the owner ring, over the 10% ceiling the test declared *before*
   the measurement. Still the brightest sky.
2. **The sky was invisible on a wide arena.** Caught by the brief's own evidence
   frame: the Plasma Reef shot came back **with no reef in it**. Features were
   sized to the parallax field, which is ~2.2 screens across, so nine clots
   spread over five screenfuls. Fix: feature size from the **viewport**, count
   from field-area ÷ screen-area. The developer's "14 sheets, 22 blobs" now means
   *per screenful*, which is how they were seen on the compositor. Bonus: overdraw
   became a genuine per-frame constant instead of a number that falls with arena
   size. New test samples the viewport window and fails a sky covering <15% of it.
3. **The "damaged station" evidence frame was a lie the first two times.**
   `damageStation` refuses while `station.spawnProtect > 0`, and a fresh station
   carries `SPAWN_PROTECTION_S = 10`. The shot fired at t≈0, was silently refused,
   and produced a frame captioned "damaged" showing **100/100**. The shooter now
   keeps asking until the core moves and throws if it never does.

### Rejected

- **A raw "signal must clear N:1 over the sky" test.** WCAG contrast saturates on
  a near-black ground — threat red's own luminance caps it at 3.56:1 against pure
  black — so the rule is unpassable and measures threat red's darkness, not the sky.
- **Contrast tax as the same-hue check.** It is signal-*independent* (the signal
  cancels), so it can only be one number per sky. The hue question needs ΔE.
- **A per-device frame-time A/B.** Run, and thrown out; the script is committed
  with the negative result in its header. Swapping the sky means swapping the map
  — that *is* the design — and the maps differ in what dominates a frame
  (derelict-fill boards carry +8 wrecks). Result had the costliest sky *fastest*
  (311 ms vs None's 565 ms) on a GPU-less box at 1.7 fps.
- **Any rock-legibility compensation.** Measured, withdrawn, asserted in a test:
  `rockBody` reads 2.27:1 on Vacuum and **2.47:1 on Floor** — 8.9% *more*.
- **Changing `PALETTE.vacuum` to `#010204`.** Would have moved every derived shade
  on the ramp and every HUD panel.
- **A hash or `index % 6` for the sky.** Repeats silently on the fifth map.

### The wiring, and why it touches two files outside src/art

`World` does not carry the map id it was built from (that is `WorldConfig`, and
`src/sim/` is not mine). So: `RenderView.mapId?` (optional, falls back to the
default map's sky) → `Renderer.draw` calls `backdrop.setMap(view.mapId)` → **one
line** in `src/main.ts` passes `chosenMapId`. `src/render/index.ts` is the
established art seam (a2-06 built the backdrop through it).

### Two things the goldens surfaced that are NOT this branch's doing

1. **A stale baseline on `main`.** The lobby's abundance button reads
   `ORE · SCARCE` in the old baseline and `YIELD · SCARCE` now.
   `src/ui/lobby-view.ts` **on origin/main** says `YIELD`. The copy changed, the
   diff was 0.11% — under `maxDiffPixelRatio` — so the golden passed and never
   re-shot. Deleting the baselines first is what surfaced it.
2. **`desktop-title`'s subtitle renders ~12% wider** than the old baseline (0.86%,
   under tolerance). Same words, different glyph metrics — a font-loading race.
   The verification re-run reproduced the new baseline exactly, so it is stable
   as committed.

### One consequence for the UI Agent (flagged, not fixed — `src/ui` is not mine)

HUD plates that used to vanish into Vacuum now read as plates. The minimap panel
is the clearest case: same fill, darker ground behind it, so its rounded edge is
now visible (see `frames/1-…` vs `frames/2-…`). Arguably on-direction for
Gantry/Bone ("machined plates, lit top edges"), but it is a real change and it is
UI's call, not art's.

### The merge, and why the goldens were shot twice

`main` moved mid-brief: **a0-03** (the wheel cost is one number) and **a0-04**
(nameplates always lit) both landed, and both move frames. Thirteen goldens
conflicted. Taking either side would have shipped a baseline that is half one
change and half the other, so the merge took **main's** for all thirteen and then
all 35 were regenerated from the merged tree. Same diff profile as before the
merge, so nothing in the explanation changed.

One incident worth remembering: a blanket `git add -A` in this shared workspace
swept three *other lanes'* untracked scratch configs into a commit
(`playwright.a003/a004/isolated.config.ts`, one headed "SCRATCH — NOT FOR
COMMIT"). Untracked again in `758f67b`, index-only, files left on disk. **Do not
`git add -A` at the repo root in a lane workspace.**

## DoD, as run

| check | result |
|---|---|
| `npx tsc --noEmit` | clean (post-merge) |
| `npm test -- --run` | **235 files, 3946 tests, 0 failed** (post-merge). One earlier run showed 1/3946 failing and did not reproduce — a perf-benchmark flake on a loaded box. |
| `MAP_NEBULA` in `src/art` | present in `src/art/backdrop.ts` |
| goldens differ from `origin/main` | **34 of 35** (`phone-portrait-eliminated` is byte-identical) |
| `origin/main` is an ancestor of HEAD | yes |
| goldens re-run clean (not in the DoD, done anyway) | **35/35 pass** against the committed baselines, twice — once before the merge and once after |

## NEXT

- [ ] Open the PR; flag §2.2 at the top as the one thing needing a decision.
- [ ] QA attestation on the re-baselined goldens.
- [ ] For **a0-12**: `MAP_NEBULA` needs two more lines and `UNASSIGNED_NEBULAE`
      needs to empty out — `backdrop.test.ts` fails until both happen, by design.
      Iron Veil and Deep Ember are the two skies waiting, and taking them means
      taking style-guide §2.2 with them.
- [ ] For the **UI Agent**: HUD plates no longer vanish into the ground. Flagged
      above; not touched, because `src/ui` is not mine.
