# a0-115 — the ore counter with a rival's nameplate on it, before and after

a0-111 failed the top-left corner:

> the grey word ORE and the teal nameplate 'Rusty (EASY)' occupy the same pixels
> — the R of Rusty is drawn across the E of ORE, and both are legible only
> because they are different colours. […] something other than the counter itself
> was drawn into the counter's rect on 3 of 14 desktop stops and 1 of 14 phone
> stops.

This directory reproduces that frame, deterministically, and shoots it on both
sides of the fix.

## What is in the frames

Everything here comes off the **real `Hud`** — `new Hud(w, h)`, the shipped class,
on a real Pixi `Application` at dpr 2, with the two ratified faces loaded through
the game's own `awaitRatifiedFaces` gate. The ore counter, the wave clock, the
HOME cluster, the VIEW chip and the nameplate layer are all the shipped code;
nothing about them is re-implemented here.

The one thing this bench decides is **where the rival is standing**. It can,
because the nameplate feed is already in SCREEN space by the time the HUD sees it
(`src/ui/nameplates.ts` — the caller projects world → screen), so a rival can be
parked exactly where a camera position would have put it. That is what makes a
camera-position defect shootable at all: QA reached theirs with real taps and
found 4 stops in 28, and a golden frame taken at one position cannot see it.

Both stops are computed from the counter's OWN registered rect
(`Hud.describeLayout` → `ore-hud`) and the plate's own row geometry, never from a
hardcoded corner — the same discipline the fix is held to.

**The counter's rect came back 16,16 by 52.9 × 60 logical on the phone and
52.9 × 75 on desktop.** QA measured 16,16 by 52.9 × 75. The width matches to the
tenth of a pixel, which is the number the collision is about.

## The two stops, and why two

| stop | the rival | before | after |
|---|---|---|---|
| `beside` | just clear of the counter's right edge | its plate is drawn **21 logical px into the counter's rect** — QA measured 20.3 | the plate **steps aside** 23 px and clears the counter by the 2 px keep-out pad. It is still there, and still over its ship |
| `under` | hull behind the counter | its plate is drawn straight across the banked numeral | the plate **stands down** for the frame. `debugWithheldNameplates()` reports `Rusty` / `readout` |

Two stops because "the label yields" has two outcomes and only showing the first
would be a half-answer. A plate that can step aside does; a plate whose own ship
is behind the readout has no position that clears it while still standing over
the hull it names, and it is withheld — which is the same answer this layer has
always given a label that would spill off the canvas, and it is recorded on the
?debug=1 seam rather than silent.

## The files

`shots/` holds the specimens: one PNG per frame at the canvas's own device
pixels, a 5× nearest-neighbour crop of the counter's rect and the air past it
(pixel replication — every pixel in a crop is a pixel from the frame above it,
repeated), and a JSON readback per side with the counter rect, the ship position,
and the drawn/withheld plate.

## How to re-run it

```
npx vite --port 4315 --strictPort &
node evidence/a0-115-nothing-lands-in-the-counter/shoot.mjs after
```

`before` / `after` is only a filename prefix — **which build is on the bench is
whatever is in the working tree.** The before-frames in this directory were taken
with the two changed view files reverted to `origin/main` and nothing else
touched:

```
git checkout origin/main -- src/ui/hud.ts src/ui/nameplates-view.ts
# restart vite: on this filesystem the dev server does not always invalidate a
# module changed from outside it, and a stale module is a frame that lies
node evidence/a0-115-nothing-lands-in-the-counter/shoot.mjs before
git checkout <this branch> -- src/ui/hud.ts src/ui/nameplates-view.ts
```

## A trap this run hit, written down so the next one does not

**A crop taken in the page is a black rectangle.** The first cut cropped with
`drawImage(canvas, …)` inside the browser. The WebGL drawing buffer is gone by
the time script runs after a render, so every crop came out solid black — which
looks exactly like a finding about a HUD that failed to draw. The crops are cut
out of the saved PNG in node instead, with `pngjs`, which is also what makes them
honest nearest-neighbour enlargements rather than a browser's resample.
