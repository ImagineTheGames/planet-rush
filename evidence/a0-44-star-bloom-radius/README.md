# a0-44 — the star bloom is smaller than its own spikes

Evidence for `agent/art/a0-44-star-bloom-radius`. Everything here is reproducible
from the repo; nothing is a screenshot of something that no longer exists.

The developer, in a live match: *"the stars look super WEIRD, none of them have
the bloom effect, and some of these with the lil crosshair looking things were
not in the mockup"* — and, on the same frame, *"the nebulas look good though"*.

## `audit.txt` — the arithmetic, and the number that settles the falloff

```sh
npx vite-node evidence/a0-44-star-bloom-radius/audit.ts
npx vite-node evidence/a0-44-star-bloom-radius/panels.ts
```

`audit.ts` prices every candidate rule on the design's own instrument (a 320×180
point-sample grid over a 640×360 panel, `sky-preview.ts` `measure`). `panels.ts`
puts the design's panel and the game's own next to each other and subtracts the
a0-22 bloom tint, which is where the last two points of p99 go.

The four rows that matter, and the reason the falloff curve is part of this
brief at all:

| rule | p99 | the design says |
|---|---|---|
| shipped — 4.3 r, α×0.48, `falloffProfile` | 49.41 | 46–53 |
| **radius only** — 11.24 r, α×0.48, `falloffProfile` | 70.26 | ✗ |
| radius + absolute alpha, `falloffProfile` | 66.88 | ✗ |
| **the design** — 11.24 r, absolute 0.2016, its own three stops | **47.88** | ✓ |

The shipped row is *in band* with both numbers wrong, which is exactly why a
value assertion never caught this: two compensating errors (a halo a sixth of the
intended area, at 1.2× the intended peak) land near the right total light while
drawing entirely the wrong thing.

## `before/` and `after/` — plates, at the design's own panel size

```sh
npx vite-node evidence/a0-44-star-bloom-radius/shoot.ts after
```

There is no browser on the plain-node side of this container, so the plates go
through a0-40's `plate.ts` — a plain-TS PNG rasterizer over `inkAlphaAt`, the one
definition of "how bright is this ink here" that `backdrop.test.ts` and
`sky-preview.ts` also use. A plate cannot flatter the build.

`before/` is the **same file** run inside a `main` worktree:

```sh
git worktree add /tmp/a044-main main
ln -s "$PWD/node_modules" /tmp/a044-main/node_modules
mkdir -p /tmp/a044-main/evidence/a0-44-star-bloom-radius
cp evidence/a0-44-star-bloom-radius/shoot.ts /tmp/a044-main/evidence/a0-44-star-bloom-radius/
(cd /tmp/a044-main && npx vite-node evidence/a0-44-star-bloom-radius/shoot.ts before)
```

- `<sky>.png` — six full panels, the whole stack in composite order. The skies
  are byte-for-byte the same art in both sets; only the stars over them move.
- `detail-1..3.png` — **5× enlargements of the three widest-haloed stars in the
  panel**, the same three stars in both sets. This is the report, visible:
  *before*, a small tight glow with the diffraction cross sticking out well past
  it — a crosshair with a dot in it. *After*, a wide soft glow with the cross
  contained inside it, which is what the design draws.

| | before (`main`) | after |
|---|---|---|
| halo radius, `detail-1`'s star (r 2.43) | 10.45 px | 27.32 px |
| spike arm | 12.64 px | 16.94 px |
| halo vs spike | **0.83×** — the cross is outside | **1.61×** — inside |
| halo peak alpha | 0.2118–0.24 (per star) | 0.2016 (every star) |
| halo falloff | `(1 − t²)²` | the design's three stops |
| star p99, design panel | 49.41 | 47.88 |

## What is NOT in these plates

The skies. a0-40's numbers are untouched — *"the nebulas look good though"* — and
the plate pairs are the check on that: the nebula structure in each `before` /
`after` pair is identical.
