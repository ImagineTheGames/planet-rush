# a0-123 — too many blooms, and every one of them wears a cross

Evidence for `agent/art/a0-123-fewer-blooms-loose-crosses`. Everything here is
reproducible from the repo; nothing is a screenshot of something that no longer
exists.

The developer, from the menu backdrop:

> *"we have too many stars with bloom, can we reduce the number, and also make it
> so not all of them have that cross, that should also be a random thing so some
> of them with bloom have that others don't…."*

Two changes. The headline numbers:

| | before | after |
|---|---|---|
| bloom threshold | 0.86 — the design's own, measured | **0.92** |
| **bloomed share of the field** | **6.22%** | **3.49%** |
| crossed share of the field | 6.22% — every bloom, by construction | **1.75%** |
| a bloomed star's chance of a cross | 1, by construction | **0.5** |
| halo radius | 11.24 r | **11.24 r — untouched** |
| halo peak alpha | 0.2016, absolute | **0.2016 — untouched** |
| arm length / arm alpha | 6.9688 r / 0.1056 | **untouched** |

## `audit.txt` — the four numbers this brief is answerable for

```sh
git worktree add /tmp/a0123-main main
ln -s "$PWD/node_modules" /tmp/a0123-main/node_modules
mkdir -p /tmp/a0123-main/evidence/a0-123-fewer-blooms-loose-crosses
cp evidence/a0-123-fewer-blooms-loose-crosses/{dump-field,shoot}.ts \
   /tmp/a0123-main/evidence/a0-123-fewer-blooms-loose-crosses/
A0123_MAIN=/tmp/a0123-main npx vite-node evidence/a0-123-fewer-blooms-loose-crosses/audit.ts
```

### 1 · The rate, derived AND counted

The rate is a property of the curve, not a number typed anywhere: magnitude is
`u^2.35`, so the blooming population is `1 − threshold^(1/2.35)`. It is also
counted off the built sprite, because a rate that is only ever computed is a rate
nobody has checked. (The counted number runs a little above the derived one —
7.32% against 6.22% before, 3.93% against 3.49% after — because a screenful is
560 stars and the count is a draw.)

### 2 · The field is byte-identical — 9,333 stars, 0 differ

**This is the claim that earns the second stream**, and it is measured against a
`main` worktree rather than asserted:

```
deep  5693 stars here, 5693 on main — 0 differ
mid   2800 stars here, 2800 on main — 0 differ
near   840 stars here,  840 on main — 0 differ
TOTAL 9333 identical, 0 differ  <- the sky did not move
```

Every star's position, radius, alpha and colour is the same number in the same
order as before this brief. See **The determinism trap**, below.

### 3 · `peakP99` — the constraint the brief did not anticipate, and why 0.92

`MOCKUP_STARS.peakP99` (42–48) is the 99th percentile of panel luma the design's
own field reaches, and **it is set by the halos** — so cutting the bloom rate
walks the design's own panel out of its own band:

```
threshold  rate    design p99   game p99   apart    in 42–48?
0.86       6.22%    44.78        44.44     0.75%    yes
0.88       5.29%    44.04        43.43     1.39%    yes
0.90       4.38%    43.34        42.16     2.74%    yes
0.92       3.49%    42.04        41.24     1.89%    yes   <- a0-123
0.93       3.04%    41.28        40.37     2.20%    NO
0.95       2.16%    39.99        38.37     4.05%    NO
```

0.93 is the first candidate under the floor. **So 0.92 is very nearly the largest
reduction available that leaves the design's own luma gate standing, and this
brief therefore does not touch `peakP99` at all.** Anything dimmer is a second
ruling — on how bright the sky is, rather than on how many orbs are in it — and
it is the Director's, not Art's. It is raised in the PR body rather than settled
here.

### 4 · The cross really is its own draw

The rejected route was deriving the bit from a value already drawn. It costs no
draw but correlates the cross with brightness or with colour, so the evidence
measures the correlation this arrangement actually has rather than asserting
there is none — over 8 seeds, because a single field's `r` is itself a random
variable and one sample at 2σ is a coin landing heads twice:

```
mean r(cross, star radius)   -0.00562   (sd across seeds 0.00926)
mean r(cross, hot/cool)       0.00660   (sd across seeds 0.01570)
1/sqrt(n) per seed            0.01468   <- what sd should be if independent
```

Both means sit within one per-seed standard error of zero and the spread across
seeds is the spread independence predicts. A derived bit would pin `r` near a
fixed non-zero value that does not average away with the seed.

## `before/` and `after/` — the menu backdrop, same seed, same viewport

```sh
npx vite-node evidence/a0-123-fewer-blooms-loose-crosses/shoot.ts \
  "$PWD/evidence/a0-123-fewer-blooms-loose-crosses/after"
(cd /tmp/a0123-main && npx vite-node evidence/a0-123-fewer-blooms-loose-crosses/shoot.ts \
  /lanes/lane-3/evidence/a0-123-fewer-blooms-loose-crosses/before)
```

The developer reported this off the **menu** backdrop, so the plate is the menu
backdrop and not a review panel: `src/ui/menu-backdrop.ts` drives `VoidBackdrop`
with `bounds = viewport`, camera offset `(0, 0)` and the `patinaDrift` sky, and
`shoot.ts` reproduces that layer for layer, `coverSpan` for `coverSpan`, in
`configure`'s own composite order.

There is no browser on the plain-node side of this container, so the pixels go
through a0-40's `plate.ts` — a plain-TS rasterizer over `inkAlphaAt`, the one
definition of "how bright is this ink here" that `backdrop.test.ts` and
`sky-preview.ts` also use. **A plate cannot flatter the build**: if a number is
wrong the plate is wrong in the same way.

- `menu-1440x900.png` — the whole menu backdrop at the developer's desktop size.
- `detail-5x.png` — the same 288×180 crop of it, enlarged 5×, in both sets. A
  cross is a 0.7 px line and a halo is a soft 20 px wash, so at 1:1 *"some of
  these have a cross and some do not"* is a thing you have to take on trust. The
  shapes are scaled and re-painted by the same rasterizer, so this is a
  magnification of the **art** rather than a resample of the plate.

Read the detail pair left to right. Six bloomed stars in the crop before, every
one of them crossed. After:

- the **top pair** dropped out of the bloomed population altogether — their
  magnitude sits between 0.86 and 0.92 — and are now plain points;
- the **left pair** kept both the halo and the cross;
- the **centre and right stars kept their halo and lost their cross**. That is
  change 2, and it is the one that cannot be read off a count.

## The determinism trap, and the route taken

The field is byte-deterministic from a seeded stream (GDD §4.1) and every star
draws from it in order — x, y, magnitude, then two for temperature. **A fourth
draw on that stream shifts every subsequent star**, so the naive one-line
insertion re-rolls the whole sky's positions, magnitudes and colours in order to
loosen a cross.

That is not a theoretical cost here. The developer has twice reported the field
drifting from the mockups (a0-44: *"on the designs their bloom radius was
larger… why does this keep getting messed up"*; a0-45), and a re-roll would have
arrived as exactly that drift, for free, inside a brief about something else.

**So the cross draws from its own stream** — `mulberry32(seed ^ keySalt(key +
'/cross'))` — advanced **once per star** rather than once per bloom. Two
consequences, both wanted:

1. The field is byte-identical (§2 above). The only shapes that move are halos
   and arms, which is the whole of what was asked for.
2. A star's cross bit is a property of **that star at that index**, so it does
   not depend on how many stars before it happened to bloom. Moving the threshold
   therefore does not re-roll which of the survivors are crossed — which is what
   makes the two halves of this brief independent rather than entangled.

The alternatives, and why not:

| route | cost | why not |
|---|---|---|
| a 4th draw on the field's stream | re-rolls the entire sky | the drift the developer has reported twice, for free |
| derive from magnitude or temperature | free | correlates the cross with brightness or colour — a *third* tier of star, drawn by accident |
| **its own stream, per star** | one `mulberry32` per layer, one draw per star | — |

Determinism is unaffected: a second `mulberry32` from the same seed is as
deterministic as the first, and the sprite stays deep-equal in
(`spec`, `seed`, `width`, `height`).

## How the two numbers were picked

Both by eye, on the menu backdrop, through `shoot.ts` with its two env overrides
(`A0123_THRESHOLD`, `A0123_CROSS_CHANCE`) — so every candidate is the same code
path as the shipped one. A sweep that re-implemented the field would be choosing
a threshold against a picture the game does not draw.

- **Threshold**: 0.86 / 0.90 / 0.92 / 0.93. 0.92 is where the frame stops reading
  as a wash of orbs and starts reading as a star field with bright ones in it,
  and it is also the last candidate inside the `peakP99` band (§3).
- **Chance**: 0.35 / 0.50 / 0.65 / 1.0. At 0.65 *"some don't"* barely reads; at
  0.35 the crosses read as an oddity rather than a mix. The developer's sentence
  is about the **mix**, and a mix is loudest at 0.5 — any other value makes one
  of the two populations the exception.

## What is NOT in this brief

**Bloom radius and halo alpha are untouched**, and that is asserted rather than
claimed — `backdrop-bloom.test.ts`, `leaves the halo's radius and its alpha
exactly where a0-44 put them`, pins all four constants by value, next to the two
assertions that measure the same numbers at the frame. a0-44/a0-45 settled them
and this brief had no business anywhere near them.
