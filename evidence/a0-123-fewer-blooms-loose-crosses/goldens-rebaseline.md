# a0-123 — the golden re-baseline, and who actually moved each frame

**41 of the 50 baselines** in `tests/mobile/goldens.spec.ts` were rewritten. Every
one was looked at, and every one is accounted for below.

The headline, because it is not the obvious answer:

> **A clean `main` build rewrites 39 of the same 50 baselines on its own.** The
> committed baselines were already stale before this branch existed. a0-123's own
> contribution to any single frame is **at most 37 gate pixels — 0.004% of a
> 1280×800 frame** — and on the match scenes it is **zero**.

## The method (a0-41's and a0-45's, because the trap is the same)

**A change under the tolerance cannot fail a golden, and therefore cannot
re-baseline one either.** `GOLDEN` is `maxDiffPixelRatio: 0.01`, and Playwright
counts a pixel as different only when its YIQ delta exceeds `35215 × threshold²`
— at the default `threshold: 0.2`, a per-pixel luma difference of **52.8 of 255**.
A star field is a wash of small, faint marks; a0-44 measured its own halo
correction at **0.000%** by that rule, and a0-123 measures much the same.

So:

1. `--update-snapshots` ran at **`maxDiffPixelRatio: 0`**, so every frame that
   differs by a single pixel is rewritten and `git status` is the complete list.
2. **The tolerance edit is not committed.** `tests/mobile/goldens.spec.ts` is QA's
   file and is byte-identical to `main` on this branch.
3. **Private port** (`playwright.a0123.config.ts`, port 4123, own build,
   `reuseExistingServer: false`). The committed config pins 4173 with
   `reuseExistingServer: !CI` and the lanes share this box, so re-baselining
   against whichever lane booted first would bake another lane's pixels in here.
4. **Test timeout 900 s**, not 60 — this box runs other lanes' suites, and under
   that load `browserContext.newPage` alone has been measured over 60 s.
5. `origin/main` is this branch's base and was not behind at any point.

## Fresh-capture vs fresh-capture — the control this brief needed

One frame did not fit the pattern. `desktop-pause-confirm` differed on **649,193
raw pixels** where comparable frames differed on ~90,000, and `golden-where.mjs`
showed **95.3% of them differing by exactly one code value** — a scrim
re-quantising, which is not something a bloom count does. Enlarged
(`golden-crop.mjs`), the committed baseline turned out to carry a plasma-blue
**DOWNLOAD LOG** button that the current build does not draw.

That is correct current behaviour, not a regression: the offer withdraws for
anything layered over the pause menu (`src/ui/pause-menu` `pauseAllowsDownloadLog`,
a0-97/a0-98), and the confirm screen is layered over it. The baseline predates the
rule and never re-baselined because 798 pixels is 0.08% of a 1% gate.

So the whole suite was re-captured from a **`main` worktree**, and every frame
priced twice — `golden-attribution.txt`:

```
committed baseline  ->  main fresh     = INHERITED (already stale on main)
main fresh          ->  this branch    = a0-123's own contribution
```

`desktop-pause-confirm`: **798 inherited, 0 from a0-123.**

## What a0-123 actually did to the goldens

| | frames | a0-123's own gate pixels |
|---|---|---|
| match scenes (frozen, skies, wheels, thumb band) | 19 | **0** on every one |
| menu screens (title, codex, settings, doors, lobby, selects…) | 22 | 1–37, of which ~1–6 is the build-hash watermark |

The star field genuinely changed on 31 of the 41 — `desktop-frozen` differs from
fresh `main` on **103,075 raw pixels across the whole frame** — but essentially
none of it clears Playwright's perceptual threshold. **a0-123 would not have
failed the 1% gate on a single frame.** The frames move here because the rebake
ran at zero tolerance, which is the point of running it that way.

## What this PR inherits, stated rather than smuggled

A golden is a whole frame, so re-baselining necessarily adopts everything that has
moved since each frame was last written — and these baselines were last written at
several different builds (`d9121ab*`, `85e54f2*`, `297ebcb*`, `b6ae852*`… all now
`2b6d4f3*`). Three things ride along:

1. **The frozen scene's whole layout** — station scale and position, rock
   placement, ring radii, the ORE counter's position. This is by far the largest
   inherited change (600–900 gate pixels on every match frame) and it is the
   world-size move that landed in `main` immediately before this branch
   (`a0-120`, merged as #497). It was never re-baselined because it sat under 1%.
2. **The TEAMS minimap markers** — white/pink/green squares become blue ones on
   every TEAMS frame.
3. **`desktop-pause-confirm`'s DOWNLOAD LOG button**, above.

None of the three is Art's, none is a regression, and all three are now in the
baselines because a re-baseline cannot take only its own change.

## The 41, by class

**10 carry no art change at all.** Their entire difference is a **38×8 box at the
build-hash watermark** — verified by bounding box on each, and read at 10×
(`d9121ab*` → `2b6d4f3*`). Nothing else on these frames moved:

`desktop-end-of-match`, `desktop-lobby`, `desktop-lobby-teams`,
`desktop-map-select`, `desktop-ship-select`, `phone-landscape-lobby`,
`phone-landscape-lobby-teams`, `phone-landscape-map-select`,
`phone-landscape-ship-select`, `phone-portrait-lobby`.

**31 carry the star field** — fewer halos, and a cross on about half the
survivors. Star points, rocks, ships, station, HUD and type are untouched in every
one; checked against fresh `main` rather than against the stale baseline, so the
a0-120 relayout is not mistaken for this brief's work:

the three `desktop-sky-*`, `desktop-frozen`, `desktop-frozen-teams`,
`desktop-title`, `desktop-codex`, `desktop-settings`, `desktop-doors`, the five
`desktop-*-wheel-*`, `desktop-pause-confirm`, and the phone landscape/portrait
counterparts of each.

**9 were not rewritten**, and all 9 are cropped shots that carry neither the
watermark nor a visible backdrop: `desktop-hud-top`, `desktop-hud-footer`,
`desktop-pause`, `desktop-lobby-level-badge`, `phone-landscape-hud-top`,
`phone-landscape-pause`, `phone-landscape-lobby-level-badge`,
`phone-portrait-pause`, `phone-portrait-eliminated`.

## Reproducing

```sh
# this branch
NODE_OPTIONS="--no-experimental-strip-types" npx playwright test \
  --config evidence/a0-123-fewer-blooms-loose-crosses/playwright.a0123.config.ts \
  tests/mobile/goldens.spec.ts --update-snapshots     # with GOLDEN's ratio set to 0

# the control, in a main worktree on its own port
node evidence/a0-123-fewer-blooms-loose-crosses/golden-where.mjs <a.png> <b.png>
node evidence/a0-123-fewer-blooms-loose-crosses/golden-crop.mjs <a.png> <b.png> out.png <x> <y> <w> <h> <zoom>
```
