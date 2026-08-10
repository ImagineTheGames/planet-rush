# a1-15 — did a1-12's viewport cull drop a rock the player could see?

**Verdict: no. The cull is innocent.** Across 35 viewport profiles, 213 rock
instances whose drawn silhouette reached the screen, and 86 of those straddling
a viewport edge, **not one was dropped by the served build**.

The developer's report — *"the bloom orbs are gone, but they are gone completely,
they were supposed to be there with subtle bloom on random stars"* — therefore
still has no cause. This round removes the leading remaining candidate rather
than finding one, which is what the evidence going in predicted.

## The pair

| | commit | what it is |
|---|---|---|
| before | `111db86` (`ecc1496^`) | pre-pooling, pre-cull. Draws every rock unconditionally. |
| after | `ebdae99` | **the served build** (`dist/version.json`), pooled and culled. |

The same pair a0-18 used. `ebdae99`'s renderer is byte-identical to `main`'s tip
`bb4f414` (`git diff ebdae99 bb4f414 -- src/render src/art src/sim src/platform`
is empty), so the served build is current for everything that draws.

Same arena, same seed, same tick (`?debug=1&freeze=1`, `FREEZE_TICK` 120), same
viewport, and `window.__planetRush.worldHash` **agrees on both builds on every
profile** — so the two frames are the same world, asserted rather than assumed.
`src/sim/` and `src/platform/freeze.ts` are byte-identical across the pair.

## What was counted, and why it does not trust the code

`src/render/cull.ts` claims `RENDER_EXTENT.rock = 1` — that a rock's art reaches
exactly its collision radius. An attestation resting on that claim would prove
nothing about the frame, so nothing here rests on it.

The ground truth is **`getBounds()` on the live display object** — the rectangle
PixiJS will actually rasterise, geometry and transform included. The pre-cull
build draws every rock, so its scene graph carries a correct drawn rectangle for
the entire field. That is the reference:

```
VISIBLE_TRUE = rocks whose real drawn rect intersects the viewport   (pre-cull)
DRAWN        = rocks the served build left visible                   (served)
MISSING      = VISIBLE_TRUE \ DRAWN     ← non-empty would be the bug
OVERDRAW     = DRAWN \ VISIBLE_TRUE     ← the pad erring outward; harmless
```

Matched **by world position, never by child index**: the pooled build creates a
display object only for a slot it has drawn at least once, so `children[k]` is not
slot `k` there.

The stage is reached through PixiJS's own devtools hook
(`globalThis.__PIXI_APP_INIT__`), installed from a Playwright init script before
any page script runs. **Nothing in `src/` is touched** — this is a read-only round.

## The numbers

| | rocks |
|---|---|
| profiles compared | 35 |
| visible-true rock instances | **213** |
| straddling a viewport edge | **86** |
| centre OFF SCREEN, only the drawn extent reaching back on | **53** |
| tightest case that still had to be drawn | **1 × 54 px sliver**, centre 24 px off the left edge |
| **MISSING** | **0** |
| overdraw | 10 |

And in pixels, at 844×390: 5,324 of 329,160 px differ at all, peak Δ79/255, and
the **largest connected blob above Δ24 is 13 px²**. A dropped rock would leave one
solid blob of thousands — a1-07 measured these discs at 16.8–74.2 CSS px across,
median 62.7. The differences are thin outlines on rock *edges*: the pooled bake
resampling the same rock, not a hole where a rock used to be. a0-18 saw the same
pixels ("the world's pixels differ by 56,143 at peak Δ65 — the perf chain changed
the ENTITY layers, which is what it was for"); this round puts a shape on them.

## The ore chunks

**The shipped game has no chunks to cull until somebody mines.** `?freeze=1` pins
the sim with empty inputs, and a chunk exists only once a mining beam has chipped
a rock (`sim/projectiles.ts` `spawnChunk`) or a rock has been destroyed
(`sim/damage.ts`). Frozen: 0 chunks on both builds, every profile. 40 s of live
boot with no input: still 0 — nothing in the arena mines on its own.

So a1-12's headline **"120 → 0 chunks on the phone" is a figure from
`spikes/atlas-pooling/bench.ts`**, which scatters 120 chunks across the whole
arena as synthetic load. That is the right number for a bench and it is not a
population the shipped game produces; it should not be read as a gameplay loss.

`mine-chunks.mjs` therefore tests the chunks the only way they exist — by flying
the ship into a rock and holding the mine button, on both builds, with input and
sampling issued against a **pinned clock** (`page.clock`) so both get identical
inputs at identical sim times. Verified rather than assumed: the HUD's own MATCH
clock advances exactly 5 s per `runFor(5000)`. Per-sample agreement is re-checked
against ship positions (ships move; rocks do not, so rocks are useless as a live
fingerprint). Result in `mine-chunks.json`.

## Files

| file | what it is |
|---|---|
| `census-drawn.mjs` | the per-rock/per-chunk census over 35 profiles, both builds |
| `census-pre-cull-111db86.json`, `census-served-ebdae99.json` | its read-backs |
| `compare-census.mjs` → `verdict.json` | the set comparison and the verdict |
| `capture-plates.mjs` → `plates.json` | whole-frame plates, amplified diff + connected-component analysis, straddlers outlined |
| `boundary-zoom.mjs` | the tightest boundary cases at 6× nearest neighbour |
| `mine-chunks.mjs` → `mine-chunks.json` | the ore chunks, on a played match |
| `frames/` | the raw frames every plate is cut from |

Reproduce: build `111db86` into a worktree (`git worktree add /tmp/pre-cull
111db86 && npx vite build`), then

```
node evidence/a1-15-cull-visible-rocks/census-drawn.mjs /tmp/pre-cull/dist pre-cull-111db86
node evidence/a1-15-cull-visible-rocks/census-drawn.mjs dist served-ebdae99
node evidence/a1-15-cull-visible-rocks/compare-census.mjs
node evidence/a1-15-cull-visible-rocks/capture-plates.mjs
node evidence/a1-15-cull-visible-rocks/boundary-zoom.mjs
node evidence/a1-15-cull-visible-rocks/mine-chunks.mjs
```

## What this round does NOT claim

- It does not re-open a0-18's three clearances or a1-12's win (263 → 10.9 draw
  calls). Both stand.
- It does not explain the developer's report. Five suspects are now cleared and
  the report is still unexplained.
- The one thing the frames *do* support: on a 844×390 landscape phone the arena
  puts **6 rocks** on screen, and at 380–660 px wide it puts **zero**. That is
  sparseness in the authored field, visible in the plates, and it is a density
  question for the Director — not a cull defect.
