# a0-23 — the thumb controls stop wearing plasma

> *"look at blue buttons, not matching theme"* — the developer, from two phone
> captures of the live build `68d8449`.

The ruling on a0-20's Q1. **BUILD & UPGRADE and FIRE are off plasma.** Everything
below is measured on the `iphone` profile at **844×390 landscape, dpr 3** — the
one the developer photographed — with `main` on the left and this branch on the
right in every plate.

---

## 1. The two frames the brief asks for

| | |
|---|---|
| **FIRE** | `fire-before-after.png` — cropped from the frozen landscape golden at the merge base and at this branch, same scene, same pixel window, 3×. |
| **BUILD & UPGRADE** | `build-before-after.png` — cropped from `before-live.png` / `after-live.png`, the live `?debug=1` boot at the same profile. |
| the left stick's zone hint | `stick-before-after.png` |
| the whole thumb band | the new golden `phone-landscape-thumb-band-iphone-linux.png` |

**Why BUILD is a live capture and not a golden.** It draws on `buildVisible`,
which is written in `updateBuildWheel()` — and `?freeze=1` returns from the
loop's update *before* that runs, so no frozen scene can ever carry it.
`__pressStage.openBuild()` docks the ship but also opens the wheel, which covers
the slot. Baselining BUILD needs a dock-without-opening seam in `src/main.ts`;
that is somebody's call to make, not something to sneak in here, so the button
is shown live and said so.

---

## 2. Does the primary still read as pressable? **Yes — it reads better.**

The honest worry, and a0-20 was right to raise it: Bone's answer ("the brightest
thing is the actionable thing") is easy to state on a menu of plates and hard to
state on a translucent ring over a firefight. So this is measured rather than
asserted. Rec.601 luma over the same window in the same frozen frame:

| window | peak | px ≥ 128 (what a glance catches) | mean |
|---|---|---|---|
| the word `FIRE` | **167 → 255** | 354 → **377** | 70.7 → **96.5** |
| the whole FIRE button | 167 → **255** | 1354 → 903 | 24.5 → **27.7** |
| the left stick's zone hint | 203 → 203 *(an asteroid, not the ring)* | 66 → 66 | 8.5 → **9.5** |

`diff.json` carries all of it.

The word is the thing a thumb aims at, and it gained on every measure: pure white
instead of mid-blue, +36% mean luma, and *more* lit pixels rather than fewer. The
**whole-button** count falls because the rim's bottom half is now deliberately
shadowed — that is the machined lip, and it is what makes the ring read as a
*rim* instead of as a hoop. Peak and mean both rise.

Two things the frames changed my mind about, both fixed before this was written:

- **The zone hint's shadow was `rulePlate` for one draft** — materially the
  "correct" step for an inert edge, and wrong on glass. At a hint's alpha a tone
  that dark over vacuum resolves to nothing, so the ring's bottom half vanished
  and what was left read as a *broken arc*. It is `BONE.lo` now: a plate can
  spend a dark step on its underside because there is a plate under it; over the
  void there is nothing for a shadow to fall on.
- **Dropping Audiowide's synthesised bold cost the word `FIRE` 22% of its lit
  pixels** (354 → 277) for nothing. The menus are right not to ask for a fake
  weight; a word on glass under a thumb is not a menu, and `src/ui/hud.ts` makes
  the same call for the respawn line. Both pressed words keep the weight they
  shipped with.

---

## 3. The gate could not see any of this, and now it can

The first run of the whole `iphone` golden project against the finished re-skin:
**24 passed, 0 failed, no `--update-snapshots`.** Every touch control in the game
had been rebuilt and not one baseline noticed.

| | pixels moved | vs the 1% gate |
|---|---|---|
| the full 844×390 frame | 7,464 / 329,160 = **2.27%** | passed anyway — Playwright's comparator is perceptual, and most of that 2.27% is a faint ring changing hue by a few levels |
| the clipped **thumb band** | 7,464 / 141,792 = **5.26%** | fails loudly |

This is the same arithmetic u7-07 measured for the HUD (0.93–1.41% for a complete
in-match re-skin, against a 1% gate) and the same fix: point the gate at the
thing being gated. `tests/mobile/goldens.spec.ts` gains one clipped baseline,
`phone-landscape-thumb-band`, in a commit of its own — that file is QA's, the
change is additive, and it drops cleanly if the owner declines it.

Nine existing phone baselines were re-based for the intended change. **Desktop is
untouched: all 20 desktop goldens pass unchanged**, because the layer hides
itself entirely off touch.

---

## 4. What is in here

| file | what it is |
|---|---|
| `fire-before-after.png`, `build-before-after.png`, `stick-before-after.png` | the plates, `main` left / branch right |
| `before-frozen.png`, `after-frozen.png` | the frozen landscape golden at each end |
| `before-live.png`, `after-live.png`, `before-build.png`, `after-build.png` | the live `?debug=1` capture, whole frame and BUILD crop |
| `diff.json` | the ratios and the luma readouts above |
| `capture.mjs` | the live capture (needs a preview server on `PREVIEW_PORT`) |
| `plate.mjs` | the crops, the ratios and the luma table |

Reproduce:

```sh
npm run build && npx vite preview --port 4194 --strictPort &   # a PRIVATE port
PREVIEW_PORT=4194 node evidence/a0-23-touch-controls-theme/capture.mjs after
git show $(git merge-base origin/main HEAD):tests/mobile/goldens.spec.ts-snapshots/phone-landscape-frozen-iphone-linux.png \
  > evidence/a0-23-touch-controls-theme/before-frozen.png
cp tests/mobile/goldens.spec.ts-snapshots/phone-landscape-frozen-iphone-linux.png \
  evidence/a0-23-touch-controls-theme/after-frozen.png
node evidence/a0-23-touch-controls-theme/plate.mjs
```

**Use a private `PREVIEW_PORT`, and check it is actually free first.** A leftover
`vite preview` of mine on 4173's neighbour silently served a *stale bundle* to
one regeneration pass here — `reuseExistingServer` attached to it instead of
building — and the goldens came back plasma. That is the a0-06 failure mode
written down in `playwright.config.ts`, and it costs a re-run to notice.
