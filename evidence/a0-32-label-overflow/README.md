# a0-32 — two labels run past the shapes that hold them

Captured at **844×390 logical, dpr 3** — the landscape phone the developer
photographed — with `tools/a0-32-label-shots.mjs`, against a `vite preview` of
each side:

* `before-*` — a build of `origin/main` at the merge base (the code the report
  was filed against);
* `after-*` — the same script against this branch.

Everything else about the two runs is identical: same seeded frozen scene
(`?debug=1&freeze=1`), same 8 banked ore, same wedge.

| file | what to look at |
|---|---|
| `*-2-build-button.png` | **`& UPGRADE`**. Before, the `&` and the final `E` sit ON the ring and break the circle's silhouette on both sides. After, the word is inside the ring with clear air on each side. |
| `*-3-upgrade-wedge.png` | **`UPGRADE SHIP`**, resting. Before, `UPGRADE` starts to the LEFT of the wheel's rim and is drawn over the station behind it. After, it is inside the disc. |
| `*-5-upgrade-wedge-selected.png` | the same wedge **selected** (u16-01) — the state the design draws the name larger in, and the one that fits at no radius on this profile until the growth is capped to what the wedge can hold. |
| `*-1-wheel-open.png`, `*-4-wheel-selected.png` | the whole frame each crop comes from. |
| `*-0-hud.png` | the live HUD the BUILD button crop comes from (`?debug=1`, unfrozen — the ship spawns docked). |

The selected frames are driven with a real `pointermove` rather than a real
touch: on the UPGRADE SHIP wedge a press is the gesture that OPENS the upgrade
panel, so a `touchStart` there photographs the next screen instead of this one.
Same shipped handler, same selection, same profile.

**The durable check is not these pictures.** They show one string at one size;
`src/ui/hud-geometry.test.ts` asserts the rule — every line of every wedge inside
its own annular sector, at every profile in the matrix, in both selection states,
on both wheels — and `src/ui/build-button.test.ts` +
`src/platform/touch-visuals.test.ts` do the same for the circle. Reverting the
placement turns those red at every profile, desktop included.
