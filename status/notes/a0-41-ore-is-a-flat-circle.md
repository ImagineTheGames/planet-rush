# a0-41 — ore is a flat circle, and the good one has been sitting unwired

Branch: `agent/art/a0-41-crystalline-ore`. Working note — not evidence. It never
substitutes for the DoD, the PR, or QA attestation.

## BUILT

| commit | what |
|---|---|
| `e0e7ac5` | `feat` — `oreChunkSprite` is the crystalline pick; `tools/make-ore-preview.ts` + `assets/preview/ore-in-scene.html` written back; contact sheet re-baked |
| `37958cc` | `fix` — `drawChunks` pooled through `oreChunkTexture`; `makeUnitChunk` deleted; `RENDER_EXTENT.chunk` 1 → 1.05 |
| `12199f3` | `docs` — `oreChunkTexture` + `filledStroke` out of the allowlist, verdict in `docs/dark-matter-scan.md` §4.1 |
| `a194f68` | `test` — `evidence/a0-41-crystalline-ore/`, before/after through the shipped renderer |
| `25f94b7` | `test` — the ratified numbers asserted off the sprite (`generators.test.ts`, DoD line 5) |

## DECISIONS

**`tools/make-ore-preview.ts` was not in the repository, at any ref.** The brief
says to port `crystalBody()` from it rather than re-derive. Checked:
`git log --all -- tools/make-ore-preview.ts` is empty, no `a0-41` art branch
exists on `origin`, `grep -r crystalBody` over the whole worktree finds only the
geode's unrelated `crystal()` helper, and the other two lanes' checkouts do not
have it. `assets/preview/` held one file, `sprite-sheet.svg`.

So there was nothing to port, and the brief's own parameter table is the
specification that was implemented verbatim — 7 facets, unit radius 0.62,
three-tone `oreDeep`/`coreHot` at α .9, `filledStroke(signalYellow, oreDeep,
0.09, 'ore')`, halo α 0.21/0.336 at r 0.98/0.72. The tool is written *back* on
this branch, and every variant on its page is derived from the shipped
`oreChunkSprite` by adding/removing shapes in the sprite IR, so the review page
cannot show a chunk the game does not draw.

**Rejected: re-deriving a "nicer" shape.** The angle jitter (±0.18 rad) and the
radius jitter (0.86–1.14) are the only free parameters the ruling did not fix,
and they exist because equal-angle vertices read as a turned heptagon rather
than a cleaved crystal. Everything the ruling named is exact.

**Rejected: keeping `RENDER_EXTENT.chunk` at 1.** It was 1 "by construction"
because a unit `Graphics` circle scaled by the radius reaches exactly the
collider. The sprite has declared 1.05 the whole time (the halo overhangs), so
the pooled path made the old number wrong rather than tight.

**Rejected: asserting the drawn QUAD against `CULL_SLOP`.** The bake frames to
whole texture pixels, and on a chunk's small (67 px) bake the round-up is worth
~1% on top of `BAKE_MARGIN`'s 8% — so the quad's corner does sit outside
`reachOf`. Those texels are transparent by construction, so the cull test now
asserts the PAINTED mass, which is the only thing that can pop.

**Rejected: also dropping `src/art/materials.ts#PLATE_MOTION` from the
allowlist.** The scanner reports it as no longer dark, but that is already true
on `main`, predates this branch and has nothing to do with ore. Flagged in the
PR instead.

**Style-guide §2, stated rather than assumed — and it holds.** The halo is a
*ring*, not a fill: everything it raises sits outside the body, and the body was
flat `signalYellow` at α 1 before this brief and still is. So the brightest ore
pixel on screen has not moved. Over Floor, Y′: halo outer 50.6 (was 29.1), halo
inner 103.2 (was ~55), body **207.0 — unchanged, and the same number the HUD's
hold pips and banked numeral are drawn at**. Pinned by
`generators.test.ts` ("makes no ore pixel brighter than the HUD yellow it shares
a screen with"). The developer chose Strong having seen it in scene; nothing
here needed to quietly pick "subtle", and nothing did.

## THE DRAW-CALL NUMBER

`node spikes/atlas-pooling/run.mjs`, whole-frame baseline, same box
(SwiftShader), GDD §4.3 stress scene, 22 of the 120 chunks inside a 1280×800
window since a1-12:

| path | desktop draws/frame | phone-landscape |
|---|---|---|
| flat circle (`main` 6f92b74) | 10.93 | 9.03 |
| **crystalline, pooled (this branch)** | **10.97** | **9.03** |
| crystalline, unpooled `Graphics` (measured, not shipped) | 32.90 | 9.00 |

Steady-state cost of the ore layer: **zero extra draw calls** — 120 chunks batch
into the frame's existing submission from four textures. The +0.04 is seven
draw calls spread over 180 frames: the one-off bake of those four textures.

Unpooled it is **+21.9, one per visible chunk** — which is the brief's "unpooled
it costs 120" measured against the count the cull actually leaves on screen. The
old flat disc was cheap not because it was unpooled-but-fine but because a
single-circle `Graphics` batches; a five-shape crystal does not. **The pooling is
not an optimisation of the old art — it is what makes the new art free.**

Frame-time medians are not quoted: this box is a software rasteriser and its
`main` desktop median moved 145 → 129 → 213 ms across three runs of the same
code (`spikes/atlas-pooling/README.md` says the millisecond column is this box's
and the draw-call column is architecture).

## GOLDENS

All 50 pass, unmoved, and that is a fact about the goldens rather than about the
ore: `?freeze=1` pins a world whose `chunks.length` is **0** (measured), so no
baseline has ever contained an ore chunk. Nothing to re-baseline; the change is
photographed in `evidence/a0-41-crystalline-ore/` instead, eight images, all
looked at.

## NEXT

- push, open the PR, watch checks
