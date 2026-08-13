# a0-40 — the backdrop matches the mockup

Evidence for `agent/art/a0-40-backdrop-matches-mockup`. Everything here is
reproducible from the repo; nothing is a screenshot of something that no longer
exists.

There is **no browser and no SVG rasterizer in this container** (no playwright
browsers, no `rsvg-convert`), so the plates are rendered by `plate.ts` — a plain
TypeScript PNG rasterizer that composites the game's own `SpriteDef`s through
`inkAlphaAt`, the single definition of "how bright is this ink here" that
`backdrop.test.ts` and `sky-preview.ts` also use. A plate therefore cannot
flatter the build: if a number is wrong, the plate is wrong in the same way.

## `before/` and `after/` — one 640×360 panel per sky

The design preview's own panel size, the whole stack in composite order (ground,
sky, three star layers — dust in front of the stars, light behind them).

```sh
npx vite-node evidence/a0-40-backdrop-matches-mockup/shoot-panels.ts after
```

`before/` is the **same two files** run inside a `main` worktree, which is what
makes the pair comparable rather than two renderers arguing:

```sh
git worktree add /tmp/pr-main main
ln -s "$PWD/node_modules" /tmp/pr-main/node_modules
mkdir -p /tmp/pr-main/evidence/a0-40-backdrop-matches-mockup
cp evidence/a0-40-backdrop-matches-mockup/{plate,shoot-panels}.ts \
   /tmp/pr-main/evidence/a0-40-backdrop-matches-mockup/
(cd /tmp/pr-main && npx vite-node evidence/a0-40-backdrop-matches-mockup/shoot-panels.ts before)
```

| | before (`main`) | after |
|---|---|---|
| ground | `#010204`, Y′ 1.9 | `#070910`, Y′ 9.1 |
| star shapes in the panel | 49 | 656 (560 points + 32 halos + 64 spike arms) |
| Coalsack | 7 shapes | 9 |
| Iron Veil | 14 | 14 |
| Patina Drift | 22 | 22 |
| Plasma Reef | 39 | 9 |
| Deep Ember | 5 | 22 |

## `tiles/` — the nine golden tiles that changed

`assets/preview/sprite-sheet.svg` is re-baked by this brief. **Nine of its 178
tiles change and no others** — the three star layers and the six skies — which
was checked by hashing every `<g>` group in the old and new sheets. Those nine
are rendered here at the catalogue's own `VOID_TILE` (480×300), from the
catalogue's own `SpriteDef`s, so the re-baseline could be looked at:

```sh
npx vite-node evidence/a0-40-backdrop-matches-mockup/shoot-tiles.ts tiles
```

## `gate-against-main.txt` — the gate, tested the other way

The DoD requires that the new assertions **fail on `main` today** (LESSONS §24).
This is `backdrop.test.ts`'s own predicate — count, radius, alpha, hue pair,
ground, star count, star p99, per-sky lift — extracted to a standalone spec and
run inside the `main` worktree against `main`'s backdrop. **8 of 8 fail.**

```
Coalsack      count 7, design 9; radius 67–85, design 115–244;
              alpha 0.676–0.982, design 0.099–0.392; colours #010204 not the pair
Iron Veil     radius 100–177, design 102–167; colours #383e45 not the pair
Patina Drift  radius 37–89, design 64–167; colours #515861 not the pair
Plasma Reef   count 39, design 9; radius 8–129, design 115–244;
              alpha 0.013–0.039, design 0.053–0.115
Deep Ember    count 5, design 22
ground        #010204, design #070910
stars         49 a screenful, design 560; p99 9.08, design 46–53
lift          Coalsack −0.81 against the design's 4.55  (and four more)
```

Iron Veil is the control, and the result is more useful than a pass: its **count
and its alpha are already the design's** — which is why it is the one sky the
developer has never complained about — and it is still refused, on radii 6% wide
of the design and on a third ink the pair does not carry. The gate is
fine-grained enough to say *which axis*, which is what six rounds of "the nebula
is wrong" needed and never had.

## The measured table

`sky-preview.ts`'s instrument: a 320×180 point-sample grid over the panel, `lift`
= mean luma above that panel's own ground, `p99` = 99th percentile of the same
samples. `formatTable()` prints it; `backdrop.test.ts` asserts it.

```
ground  #070910  Y′ 9.08

sky             design   mockup   ported
Coalsack          4.55     4.57     4.57
Iron Veil         5.03     5.04     5.04
Patina Drift      6.94     6.93     6.93
Plasma Reef       9.97     9.98     9.98
Deep Ember        3.80     3.80     3.80

stars p99        46–53     49.4     49.8
```

`mockup` is the design's numbers on their own CPU path (canvas gradients on the
page, longhand compositing headless). `ported` is the game's own `Shape`s through
the game's own falloff. They agree to 0.02, which is the finding this brief was
written on: **the renderer was always fine.**

## Cost

Authoring the star field, once per (map, viewport, VFX tier) — never per frame:

```
                    shapes            authored in
desktop 1440×900    2477 → 31725      1.7 ms → 20.3 ms
phone    844×390    1078 → 13818      0.4 ms →  6.4 ms
```

Per-frame fill is the nebula's, and it is on `NebulaSpec.overdraw`: 2.175–3.174
per screenful (0.755–1.524 thinned), against 0.249–0.627 before. `NONE` — the map
every device boots into — is still 0.000.
