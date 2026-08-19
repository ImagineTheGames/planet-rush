# a0-88 — the minimap: shape is kind, colour is owner, coverage is one region

The developer, 2026-08-18, from a live match on a phone:

> *"the minimap shows two circles. ships should be a different icon though to
> differentiate. also it shows a circle around my ship and a circle around the
> station not sure what the station circle is but it's unneeded"*

**Read [`audit.txt`](audit.txt) first** — it is the report: what was captured,
what every frame shows, the DoD test failing on origin/main, what a player now
understands from the coverage outline that they did not before, and the golden
re-baseline frame by frame.

## What is here

| path | what |
|---|---|
| `shots/compare-*.png` | before \| after pairs, 4x nearest-neighbour. Start with `compare-collapsed-2x.png` (the reported frame) and `compare-underway-2x.png` (the one that settles the rings). |
| `shots/{before,after}-*-map.png` | the minimap alone, clipped from the frame |
| `shots/{before,after}-*-full.png` | the whole 798x384 phone frame the clip came from |
| `shots/{before,after}-readback.json` | what the layer actually drew in each frame, off `Hud.debugMinimap` — the two halves agree count for count |
| `goldens/*.png` | the re-baselined goldens' minimap corner, stored \| re-baselined, at 4x |

## Re-running it

Both halves are captured by the same spec, from the repo root:

```bash
# AFTER — this branch, own build, private port 4288
npx playwright test --config evidence/a0-88-minimap/playwright.config.ts

# BEFORE — a worktree of origin/main, built and served on its own port
git worktree add --detach /tmp/a088-before 506f26a
ln -s "$PWD/node_modules" /tmp/a088-before/node_modules
(cd /tmp/a088-before && npm run build && npm run preview -- --port 4289 --strictPort) &
A0_88_LABEL=before A0_88_REUSE=1 PREVIEW_PORT=4289 \
  npx playwright test --config evidence/a0-88-minimap/playwright.config.ts

# the pairs
node evidence/a0-88-minimap/stack.mjs collapsed-2x 4
```

The six frozen frames are deterministic and come back byte-identical. The two
`underway-*` frames are shot on a LIVE match — the ship flies out under a real
Tap Commander tap, because no seam moves it — so those two differ run to run;
the distance flown is re-read at the instant of each shot and written into the
readback (~956 units in both halves as captured).

`goldencrop.mjs` reads one re-baselined golden's map rect against the stored one;
`audit.txt` §5 lists the coordinates used for each device.
