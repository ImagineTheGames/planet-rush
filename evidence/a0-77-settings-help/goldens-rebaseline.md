# a0-77 — golden re-baseline: what moved in each frame, and why

Captured in the studio container against this branch's own bundle, on a private
preview port (`PREVIEW_PORT=4277`), because several lanes share this box and the
committed config pins 4173 with `reuseExistingServer: !CI` — re-baselining
against whichever lane booted first would bake another lane's pixels into this
branch (a0-06's trap).

## Finding the real ones: the a0-03 method, and it was needed again

`GOLDEN` in `tests/mobile/goldens.spec.ts` is `maxDiffPixelRatio: 0.01`. At that
tolerance only **two** of the three settings frames failed:

| frame | at tol 0.01 | at tol 0 |
|---|---|---|
| `phone-landscape-settings` | **FAIL** — 4 827 px (0.02) | FAIL |
| `phone-portrait-settings` | **FAIL** — 4 779 px (0.02) | FAIL |
| `desktop-settings` | *passed* | **FAIL** — 6 426 px (0.01) |

The desktop frame is 1.02 MP, so six new controls and a shifted label column come
to 1.8 % of it by the localiser's own count and still land under the ratio at the
moment of comparison. That is the same blindness a0-03 and a0-74 both documented:
**a control appearing cannot fail a golden at that tolerance**, so the stale ones
have to be found deliberately. The suite was therefore re-run once at
`maxDiffPixelRatio: 0`, which named all three.

**That tolerance edit is not committed** — `goldens.spec.ts` is byte-identical to
its committed state (`git status` on the file is clean; only the three PNGs are
modified). The tolerance is correct and is untouched: it exists for font/GPU
antialiasing.

## Re-baselined: 3 frames, and the same two clusters in each

Localised with a0-03's method (changed pixels grouped into clusters, so position
separates signal from noise where a count cannot):

| golden | Δpx vs old | clusters |
|---|---|---|
| `desktop-settings` | 18 757 (1.83 %) | `18 602 px @ [288,192,840,624]` — the whole rows block; `155 px @ [0,768,48,792]` — the build stamp |
| `phone-landscape-settings` | 12 410 (3.77 %) | `7 624 px @ [408,96,720,288]` — the volume column; `4 656 px @ [24,96,192,288]` — the toggle column; `130 px` — the build stamp |
| `phone-portrait-settings` | 12 410 (3.77 %) | the same two, rotated by the landscape lock: `[96,408,288,720]` and `[96,24,288,192]`; `130 px` — the build stamp |

**What is inside those clusters, and it is the same three things in every frame:**

1. the **`?` chip**, new, on the leading edge of all six rows;
2. the **label**, moved right by one `?` plus one row pad — every row;
3. the **pips**, moved right with the label on the three volume rows (and, on the
   two phone frames only, shortened: the fixed 176-px label column gives way once
   it would leave the readout under `PIPS_MIN_WIDTH`).

The small corner cluster in each frame is the **build stamp** (the commit sha
drawn bottom-left), which changes on every build and is not this branch's UI.

**All three were opened and read at full size before committing.** What each has
to show, and does: a `?` on every one of the six rows, at the same size as the
−/+ steppers; the value chips (`AUTO-AIM`, `TAP COMMANDER`, `OFF`) unmoved on the
right; ten pips still ten legible pips; DONE still the one bright plate; and
nothing else on the screen changed.

## NOT re-baselined, and why

Every other frame in the suite. The change is confined to `SettingsView` and the
settings model, and the settings screen appears in exactly three baselines — the
pause-menu goldens (`desktop-pause`, `desktop-pause-confirm`,
`phone-landscape-pause`) are of the pause OVERLAY, not of its settings screen,
which has no baseline of its own.

## Re-verified after restoring the tolerance

`PREVIEW_PORT=4277 npm run test:mobile -- --grep "settings screen"` → 3 passed.
