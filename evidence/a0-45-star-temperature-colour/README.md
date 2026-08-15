# a0-45 — the spike is too bright, and the colour comes from the wrong property

Evidence for `agent/art/a0-45-star-temperature-colour`. Everything here is
reproducible from the repo; nothing is a screenshot of something that no longer
exists.

Two defects, one brief. The developer, after a0-44 landed: *"stars have no
noticeable bloom, i dont know what you are measuring but its wrong"* — and the
Director's own report, third on the star field: the geometry is now right and
**colour** is what is left.

## 1. The cross — `spike-main.txt` vs `spike-a0-45.txt`

```sh
npx vite-node evidence/a0-45-star-temperature-colour/spike-on-main.ts a0-45
```

a0-44 made the **halo's** alpha absolute (`starHaloAlpha()`) and left the
**spike** one line below it on the old fraction-of-the-star formula. Read off
`starFieldSprite`'s own output on both trees, over one 640×360 panel:

| | `main` | this branch | the design |
|---|---|---|---|
| spike alpha | 0.2427–0.2728 | **0.1056** | `0.22 × 0.48` = 0.1056 |
| halo alpha | 0.2016 | 0.2016 | `0.42 × 0.48` = 0.2016 |
| **spike : halo** | **1.20–1.35** — inverted | **0.52** | 0.52 |
| stroke width | 0.5 px | **0.7 px** | `ctx.lineWidth = 0.7` |
| × the design | 2.30–2.58 | 1.00 | — |

**The bloom was being drawn correctly and then buried under its own spikes.**

One correction to the brief, in the direction of less: it prices this at α 0.55,
5.2× too bright, spike : halo 2.72. That is the same arithmetic with the star at
α 1.0, and no star reaches it — `MOCKUP_STARS.alpha.max` is 0.5 — so the numbers
above are the field's own. The defect, its direction and its fix are unchanged.

## 2. `audit.txt` — the colour, and the two tensions as numbers

```sh
npx vite-node evidence/a0-45-star-temperature-colour/audit.ts
```

The design gives every star a **temperature** and colours it from that; the build
ramped colour by **magnitude**, and because magnitude is `u^2.35` that put 71% of
the sky in the bottom band at Y′ 135.

```
  hot  temp  0.55  #b2d1e9  Y′ 204.1     ramp mag ≥0.00  #7e8894  Y′ 134.7
  hot  temp  1.00  #a0cdff  Y′ 199.0     ramp mag ≥0.45  #a5acb4  Y′ 171.1
  cool temp -0.40  #ebc995  Y′ 204.5     ramp mag ≥0.80  #ffffff  Y′ 255.0
  cool temp -1.00  #ebb45f  Y′ 185.6
  117 distinct colours, Y′ 185.6–204.5   3 distinct colours, Y′ 134.7–255.0
```

The shipping generator draws **436 hot / 124 cool = 77.9 / 22.1** over one
screenful against the design's 78 / 22, and 99 distinct star colours in it.

## 3. `p99-over-seeds.txt` and `p99-sensitivity.txt` — `peakP99`, re-derived

```sh
npx vite-node evidence/a0-45-star-temperature-colour/p99-over-seeds.ts
npx vite-node evidence/a0-45-star-temperature-colour/p99-sensitivity.ts
```

Over 24 seeds, the design's own panel: **44.97 ± 3.80** coloured, **49.62 ± 2.90**
on the deleted white-topped ramp. The old band's midpoint is 49.5. `peakP99`
moves 46–53 → **42–48**, and the gate becomes a mean over seeds rather than one
panel (σ 3.80 is 8% of the value; one panel was always a noisy instrument, and
`main`'s two panels agreeing to 0.04% was luck — over seeds they are 5.51%
apart, where a0-45's agree to 2.29%).

**The spike change moves this by nothing**, and that is the instrument, not a
coincidence: `sampleMockup` and `sampleShapes` composite fills only, and a
diffraction cross is a **stroke**. The p99 that guards this field has never drawn
one — which is part of why a cross 2.5× too bright survived a0-44's re-audit of
every other star value, and why a0-45's gate for it is a relationship assertion
rather than a luma measurement.

## 4. `before/` and `after/` — plates, at the design's own panel size

```sh
npx vite-node evidence/a0-45-star-temperature-colour/shoot.ts after
```

There is no browser on the plain-node side of this container, so the plates go
through a0-40's `plate.ts` — a plain-TS PNG rasterizer over `inkAlphaAt`, the one
definition of "how bright is this ink here" that `backdrop.test.ts` and
`sky-preview.ts` also use. It is also **the only thing in the repo that draws the
cross at all**, per §3. A plate cannot flatter the build.

`before/` is the **same file** run inside a `main` worktree:

```sh
git worktree add /tmp/a045-main main
ln -s "$PWD/node_modules" /tmp/a045-main/node_modules
mkdir -p /tmp/a045-main/evidence/a0-45-star-temperature-colour
cp evidence/a0-45-star-temperature-colour/shoot.ts /tmp/a045-main/evidence/a0-45-star-temperature-colour/
(cd /tmp/a045-main && npx vite-node evidence/a0-45-star-temperature-colour/shoot.ts before)
```

- `<sky>.png` — six full panels, the whole stack in composite order. The skies
  are byte-for-byte the same art in both sets; only the stars over them move.
- `star-1..3.png` — **one bloomed star at 8×, and it is the SAME star in both
  sets.** a0-44 could crop the same three stars out of both trees because it
  changed no random draw; a0-45 gives every star a temperature from the same
  seeded stream, so from the second star onward the two fields are different
  fields. What survives is the *first* star of a seed — its x, y and magnitude are
  the first three draws — so the lens box is sized to draw exactly one.

| | before (`main`) | after |
|---|---|---|
| `star-1` seed `0xe054aae6`, halo r | 26.2106 | 26.2106 — unchanged |
| its point | `#ffffff` α 0.4758 | `#ebb766` α 0.4758 — **amber** |
| its cross | α 0.2617, w 0.5 | α 0.1056, w 0.7 |
| `star-2` point | `#ffffff` | `#a8cff5` — blue-white |
| `star-3` point | `#ffffff` | `#a5cef9` — blue-white |

Look at `star-1` first. *Before*: a hard bright cross with a faint teal wash
behind it — a crosshair with a dot in it, which is the shape of the report.
*After*: a warm glow with a faint flare inside it, which is what the design
draws. The teal in the *before* set is `BLOOM_TINTS.patina` (a0-22) on a white
star — two colour sources on one star, which is the thing a0-45 removes.

## What is NOT in these plates

The skies. a0-40's and a0-44's numbers are untouched, and the nebula structure in
each `before`/`after` pair is identical — that is the check on it.

## The goldens — `goldens-rebaseline.md`, `golden-delta.txt`

The plates above are the *generator's* output. The golden baselines are the real
build's, and 43 of the 50 were rewritten for this change:
`goldens-rebaseline.md` carries the method (a0-41's — at the shipped
`maxDiffPixelRatio: 0.01` this change can neither fail a golden nor re-baseline
one, so the run is at 0 and the tolerance edit is not committed), every rewritten
frame accounted for, and the three inherited moves that ride along with them.
`golden-delta.txt` prices all 50 by Playwright's own rule; nothing is over the
gate. `playwright.a045.config.ts` is the private-port config the run used.
