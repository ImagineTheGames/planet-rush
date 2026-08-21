# a0-125 D1 — the corner two boxes share, before and after

a0-122's sweep, `tests/reports/a0-122-overlaps.md` §3a, defect **D1** — 462
frames, the phone, every one of the five match states, **31% of the readout**:

```
fullscreen-reenter {738,12 48×48} ∩ station-hp {642,16 140×30} = {738,16 44×30}
```

> a0-103 asserted that each one reaches its own corner; nobody asked whether they
> reach the same one.

Both declare `top-right`. The re-enter-fullscreen affordance hugs the top-right
of the **glass** at margin 12; the HOME readout hugs the top-right of the
**content box** at `HUD_PAD` 16. On a phone those are the same corner.

Three frames per stop, phone landscape 798×384 at dpr 2. Each `*-crop4x.png` is
the same region of the frame above it at 4× nearest neighbour — every pixel in
the crop is a pixel from the specimen, repeated, with nothing drawn on top and
nothing annotated. **The crop window is computed from the BUTTON's rect alone**,
never from the readout's, because the readout is the thing that moves: before and
after crop the identical region and the pair reads as one comparison.

## The numbers

Off the bench's own readback (`shots/*-readback.json`), all rects read from the
HUD's registry seam and the button's own `layoutBounds` on the same frame.
`covered` is how much of the HOME bar's **ink** rect is under the button; `air`
is the clear space between them, `0` when they share pixels.

| stop | build | `station-hp` (ink) | `fullscreen-reenter` | covered | air |
|---|---|---|---|---:|---:|
| `quiet` | **before** | `{642.5,16 140×30}` | `{738,12 48×48}` | **32%** | **0.0** |
| `quiet` | **after**  | `{596.5,16 140×30}` | `{738,12 48×48}` | **0%** | **1.5** |
| `alarm` | **before** | `{642.5,16 140×30}` | `{738,12 48×48}` | **32%** | **0.0** |
| `alarm` | **after**  | `{596.5,16 140×30}` | `{738,12 48×48}` | **0%** | **1.5** |

32% against a0-122's 31% is the same rect measured half a pixel apart: the sweep
computes the ink from `stationHpBounds`, and the bench reads the column's right
edge off the group Pixi actually drew, which ends 0.5 px past its own origin.

The column moves **46 px** and not one more: `glassCornerReserve`
(`src/ui/hud-geometry.ts`) is the button's glass rect intersected with the content
box's corner, plus `GLASS_CORNER_GAP`. It is **0** on every frame the button is
down, and **0** on both ultrawides by arithmetic — the content box there is
hundreds of px inside the glass, which is why those three profiles were already
correct and are untouched.

## What each stop shows

- **`quiet`** — D1's own frame. Before: the button's plasma stroke runs through
  `HOME` and its expand glyph sits in the core bar's right end, so the readout GDD
  §2.2 puts in that corner is a word with a box through it. After: `HOME` is
  whole, the bar ends clear, the glyph is whole — and `VIEW` has moved with the
  cluster, because the chip takes the same reserve and a column whose two rows are
  46 px out of line is not a column.

- **`alarm`** — the same corner with the station off-screen up and to the right,
  so the screen-edge arrow home is drawn into it too. **This is the D6 the a0-125
  brief warned about**, and it is why there is a third frame:

  - `after-without-the-arrow-rule-phone-alarm.png` is the fix for D1 with
    `fullscreen-reenter` struck from `ARROW_KEEPOUT_IDS` — one line. The arrow
    lands **entirely inside the button**: `arrow {750.8,21.5 24.8×19.1}`,
    `arrow ∩ button` the same rect, 100%. The arrow had been kept out of that
    corner all along by HOME's own rect, and the moment HOME stepped aside it rode
    straight under the button.
  - `after-phone-alarm.png` is the shipped build. The arrow gives up radius —
    never bearing — down to `{645.2,69.3 24.8×19.1}`, clear of the button, of the
    HOME cluster and of the VIEW chip, still pointing up-right at the station.

  The three frames are the argument for stating the arrow's rule once
  (`src/ui/layout-exclusions.ts` `ARROW_KEEPOUT_IDS`) instead of patching D2, D3
  and D4 one at a time: the fourth cover of that same mark arrived from a fourth
  direction inside the same change.

## How to reproduce

The bench is the **real HUD and the real button**: `new Hud(...)` and
`new FullscreenAffordance()`, both shipped classes, on a Pixi `Application` with
the two ratified faces loaded, added in `main.ts`'s own child order (`hud`, then
`fsAffordance`) so the button is over the HUD exactly as it is in the game.
Nothing about the corner, the reserve or the arrow's keep-out is re-implemented.
The only thing the bench decides is that the player has left fullscreen — which is
why no golden in this repo can see D1: a headless screenshot run never leaves
fullscreen, so the button is never drawn.

```sh
npx vite --port 4325 --strictPort &
PREVIEW_PORT=4325 node evidence/a0-125-the-corner-two-boxes-share/shoot.mjs after
```

The **before** frames were taken from the same tree with one line added to
`glassCornerReserve` in `src/ui/hud-geometry.ts`:

```ts
): number {
  return 0; // TEMP a0-125 BEFORE-SHOT: the column exactly where it shipped
  if (!affordanceUp) return 0;
```

and the third frame with `'fullscreen-reenter'` deleted from `ARROW_KEEPOUT_IDS`
in `src/ui/layout-exclusions.ts`. Restart the dev server after either edit — its
watcher does not see writes on this mount, and a stale transform will silently
shoot the wrong build (a0-116 lost a round to exactly that; the tell there was
`air` coming back identical on both sides, and here it is `covered`).

`before` / `after` is only a filename prefix: which build is on the bench is
whatever is in the working tree.
