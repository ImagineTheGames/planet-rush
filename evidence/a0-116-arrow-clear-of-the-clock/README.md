# a0-116 — the alarm arrow, before and after

QA, a0-111, verdict **failed**, phone 798×384:

> The alarm arrow rides the edge of the screen at the bearing of the off-screen
> station. At this bearing it lands on the top edge, in the middle — which is
> where the wave clock is. At 3x the red arrow is drawn on top of the clock's
> first line: it covers the A of WAVE and most of the V, leaving 'W' on one side
> and 'E 1/5 · Outer Drift' on the other.

Four frames per side: two profiles × two bearings. Each `*-crop4x.png` is the
same region of the frame above it at 4× nearest neighbour — every pixel in the
crop is a pixel from the specimen, repeated, with nothing drawn on top and
nothing annotated. **The crop window is computed from the READOUT's rect alone**,
never from the arrow's, so the before and the after crop the identical region and
the pair reads as one comparison.

## The numbers

`air` is the clear space between the arrow's drawn rect (`alarm-arrow`, off the
HUD's own registry seam) and the readout's, in CSS px. `0` means they share
pixels. Both rects are read off the same frame.

| profile | stop | bearing | air BEFORE | air AFTER |
|---|---|---|---|---|
| phone 798×384 | `clock` | −90.0° | **0.0** | **2.0** |
| phone 798×384 | `home` | −28.2° | **0.0** | **2.0** |
| desktop 1280×800 | `clock` | −90.0° | **0.0** | **2.0** |
| desktop 1280×800 | `home` | −34.3° | **0.0** | **2.0** |

2.0 is `ARROW_READOUT_PAD` exactly: the arrow yields the least it can and stops
on the pad. Full readback in `shots/before-readback.json` and
`shots/after-readback.json`, including each arrow rect and each readout rect.

On the phone's `clock` stop the arrow's anchor goes from y 28 to y 86 — same
column, same angle, 58px further down a 384px viewport. The triangle's top edge
lands at 69, which is the clock's bottom (67) plus the pad.

## What each stop shows

- **`clock`** — the station straight ahead, so the arrow lands top-centre. This is
  a0-111's frame. Before: the triangle stands in `WAVE 1/5 · Outer Drift`. After:
  the line is whole and the arrow sits under the strip's closing rule, still
  pointing straight up the screen.
  *One honest difference from QA's capture:* the bench aims at the clock's centre
  column, so the triangle lands over the `·` and the `O` of `Outer` rather than
  over the `AV` of `WAVE` a few characters left. Same rect, same defect, and the
  centre column is the worst case for the strip rather than a kind one.
- **`home`** — the station off the top-right, so the arrow lands on the HOME
  cluster instead. The same rule at a different readout, which is the point: the
  fix is not a special case for the clock, and a pair of frames that only showed
  the clock could not say so. Before: the triangle sits between `88/100` and
  `HOME` with a corner on the core bar. After: it is below the cluster's closing
  rule, still pointing up-right.

The desktop full frames also show the other half of a0-104 still holding — the
arrow is drawn, so `Your station is under attack — Follow the arrow` is up. The
sentence never names a mark that is not there.

## How to reproduce

The bench is the **real HUD**: `new Hud(...)`, the shipped class, on a Pixi
`Application` with the two ratified faces loaded, fed two `HudFrame`s — one to set
the alarm's damage baseline and one that takes 12 HP off the core and rings it.
Nothing about the arrow, the clock or the keep-out is re-implemented. The only
thing the bench decides is where the station is standing, and it decides that
from the readout's own drawn rect (`Hud.debugWaveClock()` /
`Hud.describeLayout()`), aimed at the point on the arrow's edge line that the
readout is standing over.

```sh
npx vite --port 4318 --strictPort &
PREVIEW_PORT=4318 node evidence/a0-116-arrow-clear-of-the-clock/shoot.mjs after
```

The **before** frames were taken from the same tree with one line added to
`arrowClearOfReadouts` in `src/ui/hud-geometry.ts`:

```ts
  if (arrow.onScreen || readouts.length === 0) return arrow;
  return arrow; // TEMP a0-116 BEFORE-SHOT: the shipped arrow, straight back out
```

— i.e. the arrow exactly as `homeArrow` clamps it, which is what shipped. Restart
the dev server after editing (its watcher does not see writes on this mount, and
a stale transform will silently shoot the wrong build — it did once here, and the
tell was `air` coming back identical on both sides).

`before` / `after` is only a filename prefix: which build is on the bench is
whatever is in the working tree.
