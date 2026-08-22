# a0-129 — the build stamp on MAP SELECT, before and after

a0-127 went to photograph three shipped visual changes and came back with a
defect nobody had asked it to look for:

> The build stamp is the element M10 ratified as *"shown on every single page"*,
> and the client reports drawing it at `{8,363 43.5x13}` on this screen. VISIBLE
> at 4x: the stamp reads `0910de2*`, and the BACK plate's angled lower-left corner
> is drawn across its right-hand half, with the plate's white accent bar landing
> on the final character. […] 55% of the stamp's registered rect sits over the
> plate's body.

This is that screen, on that handset, at that magnification, on two bundles.

## The ruler

The app's own production pipeline — `npx vite build` plus `vite preview` — on
this brief's own ports (**4329** after, **4330** before), because the lanes share
this box and a neighbouring preview may be serving another lane's pixels
(a0-06's trap). One profile, and it is a0-127's own so that a finding here and a
finding there are comparable rather than two different rulers: **phone landscape
798×384, dpr 2, touch**.

**No capture passes `?freeze=1`.** `src/main.ts` sets
`buildBadge.visible = !flags.freeze`, so a frozen frame is a frame with the build
stamp deliberately hidden, and this brief is about the stamp.

The screen is reached the way a player reaches it: real taps at the points the
client itself reports drawing its controls at — PLAY → PLAY SOLO → the lobby's
arena card. Nothing is stubbed and no seam sets the state.

## The two bundles

| | sha the frame wears | tree |
|---|---|---|
| **before** | `85c173d*` | `origin/main` at `85c173dd`, built from a detached worktree |
| **after** | `4bc7ee5*` | this branch at `4bc7ee51` |

Both wear the `*`: the container carries untracked build output (`dist/`,
`dist-a088/`) so `git status --porcelain` is non-empty and
`@platform/build-stamp` reports the tree dirty. No **tracked** file differed
from its commit in either tree.

## What is measured, and why some of it is measured off the pixels

The stamp's own rect comes off the client's registry (`__cornerStage`), which is
where a0-127's `{8,363 43.5x13}` came from — so the two reports are the same
measurement.

The **BACK plate** is not in that readback, and that is the brief's own subject:
there is no seam and (until this branch) no registration that reports a menu
screen's plates. So the plate is measured **off the frame**: `plateTop` scans
upward from the bottom edge inside the stamp's own column span and returns the
first row that is not a run of ≥20 pixels brighter than L=100. A `primary`
plate's face is the brightest large flat area in that corner by a wide margin,
and the beam behind it is dark metal.

And the question the brief actually asks — *is the stamp readable* — is answered
by the brightest pixel inside the stamp's own rect. The stamp is
`PALETTE.hullSteel` (#7E8894, luma ≈ 136) at alpha 0.55, so its own ink cannot
reach far past that on a dark ground. A max luma well above it is a plate behind
the tag.

### The numbers

| | before (`85c173d*`) | after (`4bc7ee5*`) |
|---|---|---|
| the stamp's rect, off `__buildBadge` | `{8, 363, 43.5×13}` | `{8, 363, 43.5×13}` — **unmoved** |
| `withinAnchor` | true | true |
| brightest pixel inside that rect | **255.0** | **81.9** |
| mean pixel inside that rect | 67.3 | 26.5 |
| top of the bright plate, in the stamp's columns | **335.5** | **315.0** |
| the stamp's row begins at | 363 | 363 |

Read it in one line: **the plate moved 20.5px up, off the stamp's row, and the
stamp did not move at all.** 255 is a saturated white pixel inside the tag's own
13px-tall rect — the plate's accent bar, which is what a0-127 saw landing on the
final character. 81.9 is the stamp's own ink on the beam: hull steel at 0.55
alpha, which is what the tag is supposed to look like and what it looks like on
every other page.

The stamp was **not shrunk and not dimmed** — the brief forbade both, and the
rect above is the proof: same origin, same size, same `BADGE_FONT_SIZE`, same
`BADGE_ALPHA`. What changed is what is drawn underneath it.

### And the sentence the whole brief turns on

`registryReadback` is `null` in both frames, and that is not a bug in this
bench. `window.__cornerStage` — the client's layout-registry read-back — is built
in the MATCH boot (`main.ts` `installCornerStage`), so on MAP SELECT it does not
exist. There is no registry to read here, exactly as a0-127 said, which is why
a0-122's overlap sweep could not have found this and could not find the next one.
The branch these frames come from is the half of the fix that closes that: every
menu screen's `describeLayout` now reports the stamp and its own footer plates.
Making the client CALL those seams on a menu frame is `main.ts`'s — Platform's —
and is proposed in the PR rather than done here.

## The frames

| file | what it is |
|---|---|
| `shots/map-select-before.png` | the whole screen, `main`, true size (1 image px per device px) |
| `shots/map-select-after.png` | the whole screen, this branch, true size |
| `crops/map-select-before-corner-4x.png` | the bottom-left 200×40 logical px at 4×, `main` |
| `crops/map-select-after-corner-4x.png` | the same rectangle at 4×, this branch |
| `shots/map-select-readback.json` | every number above, plus each frame's registry entries |

The crop rectangle is **fixed** — the same logical rect on both bundles — because
what is being compared is what is drawn in that corner. A crop that followed the
plate would move the frame out from under the comparison.

## Reproducing

```
npx vite build                                   # this branch
npx vite preview --port 4329 --strictPort &
git worktree add --detach /tmp/a0-129-before origin/main
ln -s "$PWD/node_modules" /tmp/a0-129-before/node_modules
(cd /tmp/a0-129-before && npx vite build && npx vite preview --port 4330 --strictPort &)
node evidence/a0-129-the-stamp-stays-readable/shoot-map-select.mjs
```
