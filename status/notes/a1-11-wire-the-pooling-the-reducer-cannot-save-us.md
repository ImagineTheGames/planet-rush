# a1-11-wire-the-pooling-the-reducer-cannot-save-us.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

**Read `status/notes/a1-10-the-pooling-that-never-pooled.md` first.** a1-11 is
the follow-up it recommended (§6 B), with the golden constraint lifted.

## BUILT
<!-- what is actually finished, with the commit that did it -->

Branch `agent/platform/a1-11-wire-atlas-pooling`, cut from `main` @ `7465d70`,
with `origin/agent/platform/a1-10-atlas-pooling-measured` merged in for the
instrument. (PR #372 has since MERGED, so the rig is on `main` too; the branch
is one commit behind `origin/main` and its snapshot baselines are byte-identical
to main's.)

1. `0c1cfc1` — **the wiring.** Rocks, turrets and shots draw as pooled `Sprite`s
   over a shared `SpriteTextureCache`. `main.ts` injects `app.renderer` as the
   baker.
2. `162c92d` — cross-owner edit to `src/art/compliance.test.ts` (flagged): its
   `turretsOnScreen` helper asked "is this child a `Graphics` with instructions?"
   and a pooled `Sprite` has no `.context`, so four turrets counted as zero.
   Asks whether the layer is PAINTING now.
3. `8f75cd1` — `src/render/pooling.test.ts`, driving the real `Renderer` through
   the real baker seam. `draw-cost.test.ts` keeps its numbers, loses a wrong word.
4. `efe465a` — `autoGenerateMipmaps` on the bake, and `capture-after.json`.

**tsc clean. 4817 tests green across 278 files.**

**Measured, after the wiring, on a1-10's own rig and box** (`shipped:whole-frame`
drives the real `Renderer` with the real baker, exactly as `main.ts` does):

| | a1-10 (direct) | a1-11 (pooled) |
|---|---|---|
| GDD §4.3 whole frame | 96.9 ms · 263 draws | **52.5 ms · 32.1 draws** |
| …with `reduceVfx` | 94.8 ms · 264 draws | **50.3 ms · 33.1 draws** |

Raw: `evidence/a1-11-atlas-pooling/capture-after.json`. **8.2× fewer draw calls,
frame time down 46% — and still ~19 fps on this box, i.e. NOT under budget.**
Report that plainly; the doc names what is still spending the frame.

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

**The two decisions a1-10 said this brief had to take, taken:**

1. **The bake resolution.** Bake each look at exactly the pixels-per-unit the
   direct path already rasterised at (`ROCK_ART_SCALE` 64, `TURRET_ART_SCALE` 48,
   `SHOT_ART_SCALE` 16), i.e. `size = 2 · extent · ART_SCALE`, and set the
   sprite's scale to `radius / ART_SCALE` — *exactly* what the Graphics path used.
   Every entity is therefore **minified**, never magnified. DPR rides on the
   cache's `resolution`, capped at 2 (the VFX cache's own cap).
2. **The headless render tests keep their headlessness, and there is still only
   ONE draw path.** `Renderer` always draws pooled `Sprite`s. What is injected is
   the *baker*: production passes `app.renderer`, and with no baker the renderer
   bakes correctly-sized **blank** textures (`TextureSource` is pure JS — no
   WebGL). CI asserts the scene graph it ships; only the pixels are absent, which
   a headless suite never asserted anyway. Deliberately *not* the "two paths, CI
   tests one and players see the other" failure a1-10 refused (`8ae9121`).

**A third decision a1-10 did not see: the bake must be FRAMED.**
`SpriteTextureCache` bakes with `generateTexture({target})`, which crops to local
bounds — centring a rock on its *bounding box* rather than on its origin, so an
asymmetric silhouette would draw off where it collides. `CenteredBaker` passes an
explicit symmetric `frame` (+8% margin so an overhanging stroke is not clipped).
A wrapper around Art's cache, not an edit to it.

**A fourth: mipmaps (`efe465a`).** The bake density is well above the draw
density (a turret is 114 texture px shown across 24). Baking nearer the draw size
is NOT the fix — `drawSprite` floors a stroke at half a pixel, so a low-density
bake draws the thin trim THICKER than the vectors do, which is the appearance
change the brief forbids. So keep the density and fix the *filtering*.

**What could NOT be wired through `src/art/atlas.ts`.**

- **Rocks go through `atlas.asteroidTexture`** — exactly right.
- **Turrets do not.** `turretTexture(cache, owner, state, size)` has no `tier`,
  so it would draw every Mk II/III barrel on the Mk I silhouette — a *visible*
  regression. Key lives in `src/render/`. **Recommended to Art: add `tier`.**
- **Shots do not.** `atlas.ts` has no shot entry; `shotSprite` is in
  `src/art/vfx/shots.ts`. **Recommended to Art: `shotTexture(...)`.**
  `src/art/atlas.ts` is Art's file and was not edited.

**Not in scope, deliberately:** ships, stations, beacons, damage rings, shields,
ore chunks, the satellite. a1-10 §6B costs those separately. The VFX layer
(a2-07) and the reducer's behaviour (r9-01) are untouched.

### THE GOLDEN TRAP — read this before re-baselining, it cost an hour

**a1-10 predicted the goldens would move. They do not — not past the gate.** A
full `--update-snapshots` run of `goldens.spec.ts` on the wired build **passed
all 44** and rewrote nothing: Playwright only rewrites a baseline when the
comparison FAILS, and the pooled raster lands inside `maxDiffPixelRatio: 0.01`.
So "the snapshots are untouched" is the *default* outcome here, not a sign the
wiring did nothing. Forcing a real re-cut means deleting the PNGs first.

**Two traps sit on top of that:**

1. **`reuseExistingServer: !CI` will silently shoot ANOTHER LANE'S BUNDLE.**
   A delete-and-regenerate on `PREVIEW_PORT=4194` came back with `desktop-hud-top`
   98.8% changed, reading **ORE** where the baseline reads **TOTAL**, over a
   darker backdrop — none of it this branch's work. Restoring the baselines and
   re-running that golden **passed**, which proves the capture, not the baseline,
   was wrong: it had attached to a neighbouring lane's newer preview. The config
   documents this exact failure (a0-06) and I walked into it anyway.
   **Always re-baseline with `CI=1` set** — that turns reuse off, so the run
   builds its own bundle and fails loudly on a busy port instead of lying.
2. **Every golden carries the build's git SHA.** `src/platform/build-info.ts`
   draws a muted corner badge on *every screen* (`@render/build-badge`), so a
   38×8 px region changes on all 44 images at every commit, pooling or not. It is
   0.02% of a frame — far under tolerance — but it means a full re-cut produces
   44 "changed" files of which ~20 changed only in that badge. **Re-cut only the
   frames that actually contain the pooled entity layers**, or the per-image
   justification the brief asks for becomes 20 lines of "the sha stamp moved".

Measure, don't eyeball: `evidence/a1-11-atlas-pooling/golden-delta.mjs` reports
per-image differing %, visible % (per-channel delta > 12), worst/mean delta and
the bounding box the visible differences fall in. The box is the useful column —
it says *where* a change landed, and therefore whether it is the entity layer.

### HOW THE GOLDEN DELTA WAS FINALLY ISOLATED — reuse this method

Diffing a fresh capture against the *committed* baseline answers the wrong
question: it folds in every change that landed since that baseline was shot, and
on this repo that turned out to be a lot. The method that works:

1. `git worktree add /tmp/pre-wire <commit-before-the-change>`, symlink
   `node_modules`, delete its PNGs, `CI=1 PREVIEW_PORT=<free> … --update-snapshots`.
2. Same again on the tip, into a second directory.
3. Diff **fresh vs fresh** with `golden-delta.mjs`. That is the change, alone.
4. Diff **committed vs fresh-pre-change** as a control. Byte-identical means that
   baseline is reproducible and trustworthy; anything else was already stale.

Step 4 is what made the call defensible: **nine baselines are byte-identical to a
fresh pre-wiring capture**, including all five frozen scenes and
`desktop-hud-footer`. Those six are exactly the frames this change moves, so
100% of their delta is ours. Re-cut those six, left the other 38.

**Found on the way, and flagged to QA/Art rather than fixed here:**
`desktop-hud-top` and the eight wheel goldens were **already stale before this
branch existed**. hud-top's baseline reads `TOTAL` where `src/ui/hud.ts` has
rendered `ORE` since a0-03 — 87% of the band differs from a fresh pre-wiring
capture — and it **passes the gate anyway**, because `maxDiffPixelRatio: 0.01`
counts only pixels past a per-pixel YIQ threshold and a re-labelled 40×10 eyebrow
is not 1% of a 1280×96 band. Do NOT re-cut them in a Platform perf PR; that is
smuggling someone else's un-baselined change through. Doc §4.3, §6.4.

## NEXT
<!-- what remains, in order, and anything blocking -->

Everything the brief asked for is committed. Remaining: push and PR (in flight),
then the DoD's PR-checks-green line.

**Done:** wiring (`0c1cfc1`, `162c92d`, `8f75cd1`, `efe465a`), the six-image
re-baseline + `golden-delta.mjs` + `capture-after-final.json` (`a6eb857`), the
doc + allowlist (`cc3406b`). tsc clean; 4817 tests green; all 44 goldens green
with the six re-cut in place.

**The headline to defend in review, and do not soften it:** 263 → 32.1 draw calls
and 96.9 → 53.1 ms, and the §4.3 scene is **still not under budget** (~19 fps on a
box with no GPU). The draw-call number travels; the milliseconds do not. The next
lever is a1-10 §6A's cull, not more pooling.

Nothing is blocked.
