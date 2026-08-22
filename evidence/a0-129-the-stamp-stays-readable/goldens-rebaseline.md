# a0-129 — golden re-baseline: what moved in each frame, and why

Captured in the studio container against this branch's own bundle, on a private
preview port (`PREVIEW_PORT=4331`), because several lanes share this box and the
committed config pins 4173 with `reuseExistingServer: !CI` — re-baselining
against whichever lane booted first would bake another lane's pixels into this
branch (a0-06's trap).

## What this branch moves, exactly

Five screens bolt a plate to the **leading** end of their footer beam, which is
the corner the build stamp is drawn in: the two pickers (MAP SELECT, SHIP
SELECT), the CODEX, the lobby (BACK) and the doors/keypad (BACK). Those plates
rise clear of the stamp's row — **3px on a desktop, 20px on a phone** — and the
band below them gives up the difference, which on a phone is 4px and on a desktop
is nothing.

Two screens that also carry a footer plate are **untouched**: the settings screen
and the hangar bolt a 300px plate to the TRAILING end, which on every viewport
wider than a portrait handset is hundreds of pixels clear of the stamp's zone.
That is not an accident of this capture — it is `stampRowLift`'s intersection
test, and the first cut of the fix (which clamped on the bottom edge alone) moved
both of them and cost four goldens for nothing.

## Finding the real ones: the a0-03/a0-74 method, needed again

`GOLDEN` in `tests/mobile/goldens.spec.ts` is `maxDiffPixelRatio: 0.01`. At that
tolerance a 3px plate move on a desktop is 0.5% of the frame and **passes** — the
golden stays green while the stored PNG shows the plate where it used to be. The
first full `--update-snapshots` run over the whole file proved it: it rewrote
eight phone frames and **not one desktop frame**, while every desktop menu had
moved.

The tolerance is correct (it is there for font/GPU antialiasing) and is
**untouched**: `goldens.spec.ts` is byte-identical to its committed state, and
`git diff` says so. To find the stale ones the suite was re-run once at
`maxDiffPixelRatio: 0`, restricted by `-g` to the twelve titles belonging to the
five screens above, and then every re-baselined frame was localised with
`golden-clusters.mjs` in this directory — bounding box and grid clusters of the
changed pixels, because a pixel COUNT cannot tell a moved plate from
antialiasing and a POSITION can.

## Re-baselined: 15 frames

Diffs are against the same file on `origin/main`, at zero tolerance.

| golden | Δpx | ratio | where the change is |
|---|---|---|---|
| `desktop-codex-desktop` | 5965 | 0.583% | bbox {x:8,y:39,w:1063,h:751}, 10px clear of the bottom edge |
| `desktop-doors-desktop` | 6044 | 0.590% | bbox {x:8,y:32,w:1003,h:758}, 10px clear of the bottom edge |
| `desktop-lobby-desktop` | 13339 | 1.303% | bbox {x:8,y:314,w:1228,h:476}, 10px clear of the bottom edge |
| `desktop-lobby-teams-desktop` | 12986 | 1.268% | bbox {x:8,y:314,w:1228,h:476}, 10px clear of the bottom edge |
| `desktop-map-select-desktop` | 27862 | 2.721% | bbox {x:8,y:302,w:1220,h:488}, 10px clear of the bottom edge |
| `desktop-ship-select-desktop` | 4804 | 0.469% | bbox {x:8,y:337,w:864,h:453}, 10px clear of the bottom edge |
| `phone-landscape-codex-iphone` | 8988 | 2.731% | bbox {x:9,y:22,w:494,h:367}, 1px clear of the bottom edge |
| `phone-landscape-doors-iphone` | 9284 | 2.821% | bbox {x:9,y:309,w:155,h:80}, 1px clear of the bottom edge |
| `phone-landscape-lobby-iphone` | 75136 | 22.827% | bbox {x:9,y:85,w:823,h:304}, 1px clear of the bottom edge |
| `phone-landscape-lobby-level-badge-iphone` | — | — | size 54x52 vs 54x51 |
| `phone-landscape-lobby-teams-iphone` | 74082 | 22.506% | bbox {x:9,y:85,w:823,h:304}, 1px clear of the bottom edge |
| `phone-landscape-map-select-iphone` | 70717 | 21.484% | bbox {x:9,y:92,w:783,h:297}, 1px clear of the bottom edge |
| `phone-landscape-ship-select-iphone` | 47720 | 14.498% | bbox {x:9,y:97,w:811,h:292}, 1px clear of the bottom edge |
| `phone-portrait-codex-iphone` | 8988 | 2.731% | bbox {x:1,y:9,w:367,h:494}, 341px clear of the bottom edge |
| `phone-portrait-lobby-iphone` | 75136 | 22.827% | bbox {x:1,y:9,w:304,h:823}, 12px clear of the bottom edge |

**Every one was opened and read at full size before committing.** What each has
to show, and does: the BACK plate lifted clear of the bottom-left corner, the
build stamp fully legible under it on the beam, and the screen's own content
otherwise where it was.

Two of those numbers deserve their own sentence:

- **The phone frames at 21–23%.** That is not a 20px plate. The band gives up the
  4px the lift costs it, so every card, tile, row and glyph in the band moves up
  ~2px — and at dpr-1 CSS-pixel capture a 2px shift of dense type repaints most
  of its own pixels. The bounding boxes confirm it: the change is the band and
  the footer, and it stops 1px short of the bottom edge (the stamp's own row,
  which did not move). `phone-landscape-doors` is the control for this reading —
  its doors are a centred stack that did NOT move, so its bbox is a tight
  155×80 around the BACK plate alone, and its ratio is 2.8%.
- **`phone-landscape-lobby-level-badge` changed SIZE**, 54×52 → 54×51. It is not
  a full frame: it is a `clip` read back from the client
  (`levelBadgeRegion`), so the 4px the band gave up moved the badge's own rect and
  rounded its height down by one. The badge itself is unchanged.

## NOT re-baselined, and why

- **`desktop-settings`, `phone-landscape-settings`, `phone-portrait-settings`** —
  DONE is a trailing plate and never met the stamp. Verified rather than assumed:
  `settingsLayout`'s `back.y` is identical before and after on both profiles.
- **`desktop-lobby-level-badge`** — its clip is the roster row, not the footer.
  Re-shot at tolerance 0 and byte-identical.
- **Every match-HUD, title, pause and end-of-match frame** — no footer plate, no
  change. Re-shot at tolerance 0.01 in the first full pass and green.

## One thing this run could not do, said out loud

Five goldens **timed out** in the first full pass, all of them on scenes this
branch does not touch (`PORTRAIT-HELD phone BUILD WHEEL`, two desktop BUILD
WHEEL frames, `desktop UPGRADE WHEEL — tiers that cannot be paid for`,
`desktop PAUSE MENU`). Each failed as `Test timeout of 60000ms exceeded` while
*capturing*, with no actual/expected pair produced — the loaded-software-GL
failure mode `tests/mobile/shot-budget.ts` documents and adds a retry for. None
of them was re-baselined and none of their PNGs changed. They are the CI shards'
to confirm on a quieter runner.
