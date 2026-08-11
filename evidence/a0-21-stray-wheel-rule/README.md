# a0-21 — the stray rule across UPGRADE SHIP

*"what is this line in the build wheel, what happened here..."* — the developer,
pointing at the build wheel.

## What it was

**Not a label separator.** Not a segment boundary either: five segments put
UPGRADE SHIP's real boundaries on the two diagonals visible above and below it,
so a horizontal line at nine o'clock bisects the segment it should never touch.

It is the chord **Pixi inserts in front of an `arc()`** when a path point is
already open.

- `ShapePath.arc` calls `_ensurePoly(false)` — the arc's first point is appended
  to whatever sub-path is current rather than starting a new one, exactly as
  Canvas2D's `arc` does.
- `GraphicsContext._initNextPathLocation` re-opens the path at the last point
  after **every** `fill()`/`stroke()`, so a point is always open on a Graphics
  that has drawn anything at all.
- A `circle`'s last point reads back as its **centre**. So
  `circle(0,0,r).fill()` followed by `arc(0,0,r, π, 2π)` drew a hairline from
  `(0, 0)` to `(−r, 0)` before it drew one pixel of rim — a full radius, in the
  rim's own lit tone at the rim's own weight, which is why it read as
  deliberate.
- The **hub's** rim arc drew the same chord at hub radius, on top of the hub
  disc, which is why the line reached the middle instead of stopping where the
  hub covered it.

Read back off the built path at the shipped geometry (r ≈ 232, hub ≈ 74):

    4 stroke poly n=38 start(0.0,0.0)  next(-232.0,0.0) end(232.0,-0.0)   ← the rim arc, and its chord
    8 stroke poly n=26 start(0.0,0.0)  next(-70.0,0.0)  end(70.0,-0.0)    ← the hub arc, and its chord

The two chords are collinear and abut, which is the single line the developer
saw.

## The fix

`strokeArc()` in `src/ui/build-wheel-view.ts` moves to the arc's own start point
before drawing it, so the connector Pixi insists on emitting is zero-length.
Nothing is hidden and nothing is clipped — the line was never a rule, so there
is nothing here to keep at label width.

The hub's `CLOSE · ESC` rule is a different thing entirely: drawn on purpose by
`drawHubBack` to `WheelProfile.hubRule` width. It is untouched, and it is in
both halves of the plate below.

## The pictures

`before-after.png` — the same window of the desktop BUILD WHEEL golden, before
on top, after underneath, 3×. `before.png` / `after.png` are the full frames.

`diff.json` is the whole of the visual change on the desktop frame:

    463 px of 1 024 000, bounded by (409, 391)–(639, 400)

— 0.045 % of the frame, or **4.5 % of the golden's 1 % `maxDiffPixelRatio`
budget**. Which is exactly why the goldens had to be *deleted* to re-baseline:
`--update-snapshots` leaves an in-tolerance baseline alone, so the stray line
would have survived another re-baseline as it survived every previous one.

## Why a test, and not just the new golden

A golden proves a frame is the frame we last approved. It cannot prove the frame
does not contain something nobody meant to draw — a reviewer approves an image
without knowing what it should *not* contain, and this line passed every review
for as long as the disc has existed.

`src/ui/build-wheel-view.test.ts` asserts the invariant u11-01 stated in prose
and nothing enforced: **the spokes are the only things dividing one wedge from
the next.** It draws the real disc onto a bare `Graphics` (no DOM needed), reads
back every straight line Pixi actually built, and fails if any of them crosses a
wedge face away from a segment boundary. Reverting `strokeArc` to a bare `arc()`
fails two of its three cases:

    ✗ puts no line on the face except the five segment boundaries
        expected [ 'r=99.0 at 180.0°', 'r=100.0 at 180.0°', … ] to deeply equal []
    ✗ leaves the UPGRADE SHIP wedge unbisected at nine o'clock
        expected 1.4e-14 to be greater than 2
