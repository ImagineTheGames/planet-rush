# a0-119 — one owner, two nameplates, before and after

QA failed a0-118 on this, having confirmed all four of a0-111's fixes hold:

> **failed** — Not one of the four: two nameplates for the same owner are drawn
> on each other and neither can be read.

The developer had already seen it without reporting it as a bug — their
screenshot of 2026-08-19 shows `Rusty (EASY)` printed twice, overlapping, one
label sitting across the other, on a station and a ship belonging to the same
character.

This directory reproduces that frame deterministically and shoots it on both
sides of the fix, on both profiles.

## What is in the frames

Everything here comes off the **real `Hud`** — `new Hud(w, h)`, the shipped
class, on a real Pixi `Application` at dpr 2, with the two ratified faces loaded
through the game's own `awaitRatifiedFaces` gate. The nameplate layer, its row
layout and its keep-out are the shipped code; nothing is re-implemented here.

The one thing this bench decides is **where the hull is standing relative to its
own home**. It can, because the nameplate feed is already in SCREEN space by the
time the HUD sees it (`src/ui/nameplates.ts` — the caller projects world →
screen), so the ship can be parked at an exact offset above its station without
driving a match there. That is what makes a position defect shootable at all: it
is not visible from a golden frame taken somewhere else.

Same shape as a0-115's bench next door, deliberately — this brief is a0-115's
keep-out with the blocker swapped, and the two sets of specimens should be
readable side by side.

## The three stops, and why three

| stop | the hull | before | after |
|---|---|---|---|
| `on` | 24 px above its own home | both plates draw **on the same baseline** — the rows share **82.8 × 16 px**, which is all of both of them | one plate. The station's. The ship's stands down, `duplicate` |
| `across` | 26 px across, 30 px up | the developer's screenshot: one label lying **across** the other, sharing **56.8 × 10 px** | one plate, and it is legible |
| `clear` | out on patrol | both plates draw, clear of each other | **unchanged** — both plates draw |

Three stops because the fix has to be shown *not* firing as well as firing.
`clear` is the control: this is not "stop labelling ships", and a specimen set
without it would not be able to say so.

24 px is not an arbitrary offset. A station's row floats by `radius + 8` off a
40 px disc and a ship's by `radius + 5 + 4 + 3` off a 12 px hull
(`nameplateClusterClearance`), so at exactly 24 px the two rows land on the same
baseline. It is the worst case of a band roughly 11–43 px deep — the approach to
your own station, which is where a player spends the opening of every match.

## What the readbacks say

`shots/before-readback.json` and `shots/after-readback.json`, from the layer's own
`?debug=1` seam rather than from a screenshot:

```
before  desktop/on      drawn=2  overlap=82.8×16.0   withheld=[]
before  desktop/across  drawn=2  overlap=56.8×10.0   withheld=[]
before  desktop/clear   drawn=2  overlap=none        withheld=[]
after   desktop/on      drawn=1  overlap=none        withheld=[ship:duplicate]
after   desktop/across  drawn=1  overlap=none        withheld=[ship:duplicate]
after   desktop/clear   drawn=2  overlap=none        withheld=[]
```

The phone profile is identical row for row. Note the last column: the plate that
goes away leaves a **receipt**. `debugWithheldNameplates()` reports it as
`Rusty` / `ship` / `duplicate`, which is what keeps a label that yielded
distinguishable from a label that broke — the same discipline a0-115 established
for its `readout` reason.

## Which plate wins, and why

The **station's**. Both plates carry the same string — the name, the difficulty
tag and (in teams) the side tag are all resolved per-SLOT — so at the moment they
collide the frame loses nothing by dropping one, and stepping one aside would
leave `Rusty (EASY)` beside `Rusty (EASY)`, which is a rendering fault and not a
second reading. Given that, the question is only which one a player needs to be
able to read *there*: a station is a landmark whose name answers "whose home is
that", asked about a thing that does not move all match, and a hull is in motion
by definition and its plate is already the mark this HUD asks to yield. The
argument is in full on `NAMEPLATE_KIND_ORDER` in `src/ui/nameplates-view.ts`.

## The files

`shots/` holds the specimens: one PNG per frame at the canvas's own device
pixels, a 5× nearest-neighbour crop of the band both labels are in (pixel
replication — every pixel in a crop is a pixel from the frame above it,
repeated), and a JSON readback per side. The before and after crops of a stop are
cut at the same rect, so they can be laid side by side.

## How to re-run it

```
npx vite --port 4319 --strictPort &
node evidence/a0-119-one-nameplate-per-owner/shoot.mjs after
```

The `before` frames were taken by reverting the two files this brief touches —
`git checkout origin/main -- src/ui/nameplates-view.ts src/ui/layout-exclusions.ts`
— restarting the dev server so nothing was served from a warm module graph, and
running the same script with the `before` tag. `before` / `after` is only the
filename prefix: WHICH build is on the bench is whatever is in the working tree.
