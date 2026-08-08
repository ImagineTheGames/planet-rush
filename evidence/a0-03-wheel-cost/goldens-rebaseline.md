# a0-03 — golden re-baseline: what moved in each frame, and why

Captured in the studio container against this branch's own bundle, on a private
preview port (`playwright.a003.config.ts`, scratch — several lanes share this box
and the committed config pins 4173 with `reuseExistingServer: !CI`, so
re-baselining against whichever lane booted first would bake another lane's
pixels into this branch).

## The thing that makes this re-baseline unusual

**The golden suite was GREEN before and after this change.** `GOLDEN` in
`tests/mobile/goldens.spec.ts` is `maxDiffPixelRatio: 0.01`, and a caption swap is
~169 px of a 1.02 MP desktop frame — 0.017%, about 1/60th of the tolerance. The
tolerance is correct (it exists for font/GPU antialiasing) and is untouched here;
the consequence is only that a text change cannot fail a golden, so the stored
PNGs stayed stale pictures showing `6/8` and `TOTAL` while every test passed.

So the frames below were found by re-running the suite once at
`maxDiffPixelRatio: 0` and localizing each diff to a cluster
(`localize-diffs.mjs`), then reading both halves at 4× (`crop.mjs`). That
temporary tolerance edit is **not** committed — `goldens.spec.ts` is byte-identical
to its committed state.

## Re-baselined: 13 frames, the ones this change is visible in

`[x0,y0,x1,y1]` is the changed-pixel bounding box; `ORE caption` is the top-left
readout at `[0,0,72,48]` (`[360,0,384,72]` once the portrait lock rotates it).

| golden | Δpx | why it moved |
|---|---|---|
| `desktop-build-wheel` | 659 | RADAR `6/8`→`6` in signal yellow @[720,528,768,576]; a second wedge cost @[504,552,576,576]; `TOTAL`→`ORE`. `4 / 4 BUILT` + `2 / 2 BUILT` + `FULL` + `OPEN ▸` all unchanged in-frame. |
| `desktop-build-wheel-short` | 599 | The same wedge, same bare `6`, in threat red at 4 ore; `TOTAL`→`ORE`. Its whole point is that it differs from the frame above **only in hue**, and it still does. |
| `desktop-frozen` | 169 | `TOTAL`→`ORE` only. No wheel in this scene. |
| `desktop-frozen-teams` | 169 | `TOTAL`→`ORE` only; side labels untouched. |
| `desktop-upgrade-wheel` | 169 | `TOTAL`→`ORE` only. The upgrade wheel still prices `3/99` — deliberately unchanged, see the OPEN question. |
| `desktop-upgrade-wheel-short` | 169 | `TOTAL`→`ORE` only; upgrade costs still `3/1` in red. |
| `phone-landscape-build-wheel` | 3829 | `TOTAL`→`ORE` (136) **+ 3693 px of hub planet/station art that is not mine** — see below. |
| `phone-landscape-frozen` | 136 | `TOTAL`→`ORE` only. |
| `phone-landscape-frozen-teams` | 136 | `TOTAL`→`ORE` only. |
| `phone-landscape-upgrade-wheel` | 3744 | `TOTAL`→`ORE` (136) + 3608 px of the same hub art. Upgrade costs still `3/99`, `2/99`. |
| `phone-portrait-build-wheel` | 3828 | `TOTAL`→`ORE` (136) + 3692 px of the same hub art, through the orientation lock. |
| `phone-portrait-frozen-teams` | 136 | `TOTAL`→`ORE` only, rotated. |
| `phone-portrait-upgrade-wheel` | 3743 | `TOTAL`→`ORE` (136) + 3607 px of the same hub art. |

Every one of the 13 was opened and read at full size before committing. The four
build-wheel frames were additionally read at 4× against their predecessors.

## The rider I could not separate, stated rather than absorbed silently

The four phone wheel frames also carry **~3.6 k px of new planet/station art in
the wheel hub** — the stored golden shows a flat teal planet, the fresh render a
detailed station sprite. That is `a2-03-planets-biomes`, already merged to `main`
and never re-baselined (0.35% of a phone frame, comfortably under the 1%
tolerance). This branch touches no art: `git diff origin/main -- src/` is ten
files, all `src/ui/`, none of them render or art. A golden is a whole frame, so
re-baselining these four necessarily adopts that art. Flagging it rather than
letting a reviewer discover an art change inside a cost-label PR.

## NOT re-baselined: 17 frames of pre-existing `main` drift

Left alone deliberately — adopting them would pull other lanes' unrelated visual
changes into this branch's diff (LESSONS §14). All of them are green at the real
tolerance; all should be re-baselined by whoever owns the change:

- **A build-sha stamp in the bottom-left of every menu** (`3538a51*` → `970a22f*`)
  — 169 px, changes on *every* commit by construction. Present only on menu
  screens; none of the 13 frames above carries it, so this re-baseline pins no sha.
- **`desktop-title`** — 8061 px (0.79%, just under the gate): the title/subtitle
  letter-spacing has drifted on `main`.
- **THE DOORS** (desktop + landscape) — copy reads "No connection needed." in the
  golden, "Offline." in the build: `l2-02`'s industrial-voice sweep, merged
  without a re-baseline.
- **Lobby** (desktop ×2, landscape ×2, portrait) — 466–894 px of the same sweep.
- **Codex, settings, end-of-match, title** (desktop + phone) — sha stamp only.

## Reproducing

```
npx playwright test --config playwright.a003.config.ts tests/mobile/goldens.spec.ts
node evidence/a0-03-wheel-cost/localize-diffs.mjs
node evidence/a0-03-wheel-cost/crop.mjs <test-results-dir> x0 y0 x1 y1 out.png
```
