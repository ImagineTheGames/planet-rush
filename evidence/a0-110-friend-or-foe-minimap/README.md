# a0-110 — the minimap answers friend or foe, and the ships come down a quarter

The developer, 2026-08-20:

> *"i feel like on minimap friendlies should all be blue, and enemies all red…
> it would just make it easier to understand, also decrease the size of the ship
> icons on the minimap"*

**Read [`audit.txt`](audit.txt) first** — it is the report: what was captured, what
each frame shows, why the palette was a lookup rather than a choice, the defect the
capture caught that the unit tests could not, and the golden re-baseline.

Start with **[`shots/compare-phone-collapsed.png`](shots/compare-phone-collapsed.png)**
— the corner map on the developer's own phone, before | after at 4×. It is the
whole brief in one image: a rainbow of six identity colours on the left, blue and
red on the right.

## What is here

| path | what |
|---|---|
| `shots/compare-*.png` | before \| after pairs, 4× nearest-neighbour, one per device × state |
| `shots/{before,after}-*-map.png` | the minimap alone, clipped from the frame |
| `shots/{before,after}-*-full.png` | the whole frame the clip came from |
| `shots/{before,after}-readback.json` | what the layer actually drew, off `Hud.debugMinimap`, plus who `stageSides()` seated |
| `hue-census.txt` | the counted answer to "is it a rainbow or is it two colours" |
| `hues.mjs` | how that was counted, and the first method that was thrown away |
| `stack.mjs` | builds the compare sheets (ported from a0-88) |

## The frame

Both halves are the frozen, seeded scene **with sides** — `?debug=1&freeze=1&sides=2`,
the debug boot's TEAMS switch, which is the 4v4 split a host gets by tapping TEAMS
— shot on the developer's own phone (**798×384 dpr 3**) and on the golden suite's
**1280×800** desktop, COLLAPSED and EXPANDED.

`__minimapStage.stageSides()` parks one ally, two rivals and their homes inside the
viewer's own ship sensor, plus a rival's wreck. The readback confirms what it
seated in every frame: **viewer 0, ally 2, hostiles [1, 3], wreck 5.**

It is needed because the map renders only the player's SENSED state (feature f1),
and two seconds into the frozen scene a viewer senses their own home and nothing
else — a0-88's readback for the same scene records `ship 0`. Without it, a capture
of "friendlies blue, enemies red" would be a picture of one blue square.

## Re-running it

```bash
# AFTER — this branch, own build, private port 4290
npx playwright test --config evidence/a0-110-friend-or-foe-minimap/playwright.config.ts

# BEFORE — a worktree of origin/main, plus ONLY the staging sha
git worktree add --detach /tmp/a110-before origin/main
ln -sfn "$PWD/node_modules" /tmp/a110-before/node_modules
(cd /tmp/a110-before && git cherry-pick <the debug(a0-110) sha> \
  && npm run build && npm run preview -- --port 4291 --strictPort) &
A0_110_LABEL=before A0_110_REUSE=1 PREVIEW_PORT=4291 \
  npx playwright test --config evidence/a0-110-friend-or-foe-minimap/playwright.config.ts

node evidence/a0-110-friend-or-foe-minimap/stack.mjs phone-collapsed 4
node evidence/a0-110-friend-or-foe-minimap/hues.mjs evidence/a0-110-friend-or-foe-minimap/shots/*-map.png
```

**The one deviation from a0-88's rule, stated plainly.** That rule is that a
capture script must use only seams that exist on `origin/main`, because a script
needing the change cannot photograph the thing before the change. `stageSides()` is
new, so the `before` tree is `origin/main` **plus that one commit and nothing
else** — it is isolated in its own sha precisely so a reviewer can confirm it
touches one file, adds no colour and no radius, and only moves ships. Everything
that decides how a mark is coloured or sized is still the branch's difference
alone, and the fog, the allegiance and the painting are all still the shipped
pipeline's.
