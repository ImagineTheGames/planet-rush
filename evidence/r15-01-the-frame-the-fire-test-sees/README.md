# r15-01 — the frame `emulation.spec.ts:508` sees, and what lit up its corner

**There is no FIRE affordance on desktop. The objective prompt's last two words
are standing in the box the test samples.**

`before-desktop.png` is the whole frame the desktop project shoots, taken with
this branch's build at the suite's own profile (1280×800, dpr 1, no touch,
`?debug=1`, 60 sim ticks of settle — the same window `boot()` waits out).
`before-corner.png` is `REGION_FIRE` (x 0.7–1.0, y 0.8–1.0) at 2×, which is where
the argument is. `before.json` is the arithmetic.

## The attribution, from the app's own layout registry

| Bone-lit pixels in `REGION_FIRE` | count |
|---|---|
| all | **308** |
| inside the `minimap` square (the exemption the test already makes) | 0 |
| inside the `onboarding` prompt panel | **308** |
| **what the test computes** (`fireBone - mmBone`) | **308** — fails `< 40` |
| with the prompt panel excluded as well | **0** |

Every one of the 308 is inside the rect the app itself publishes for the
onboarding prompt. Take that rect out and the corner reads **zero** chalk-bright
Bone — not "under the bar", *zero*. The registry's element list for this frame is
`ship-local, build-badge, ore-hud, banked-total, controls-strip, station-hp,
onboarding, nameplates, minimap, healthbars`: no `touch-fire-button`, no
`touch-left-stick`, no `touch-aim-stick`. a0-23's rule is not being broken. This
is not a product bug.

## What is actually in the box

Read `before-corner.png`: the words **"…rade your ship,"** — the tail of a0-34's
objective sentence, wrapped across two lines and centred on a 1280 px screen —
and, to their right, the collapsed minimap. Nothing round, nothing rimmed,
nothing that says FIRE.

The geometry says the same thing without the picture. At 1280×800:

- the prompt panel (registry) is **x 196.8 → 1083.2, y 690 → 750**;
- `REGION_FIRE` starts at **x 896**, so 187 px of the sentence's tail is inside it;
- a leaked Auto-aim FIRE button would be at **x 1168 → 1252, y 688 → 772**
  (`@platform/touch-visuals`: `EDGE_MARGIN` 28, `R_FIRE` 42, mirrored by
  `writeAffordanceRects`) — **85 px to the right of where the prompt panel ends**.

That last line is why the fix subtracts the prompt's registered rect rather than
moving the prompt: the rect being excluded does not contain a single pixel a FIRE
affordance could ever be drawn in, so the assertion keeps every tooth it had.

## The negative control — the guard still has every tooth

An exemption is only honest if the thing it exempts is not hiding the thing the
test is for. So the same screen was shot again with touch emulated
(`leaked-desktop.png`, `leaked-corner.png`, `leaked.json`), which puts a real
Auto-aim FIRE button on that exact corner:

| Bone-lit pixels in `REGION_FIRE`, touch emulated at 1280×800 | count |
|---|---|
| all | 1122 |
| inside the `onboarding` prompt panel | 278 |
| **with BOTH tenants excluded — what the fixed check reads** | **844** |

844 against a bar of 40: **21× over**, from a single 84 px button. And the
registry names it outright — `touch-left-stick, touch-fire-button` — which is the
cheap half of the assertion the fix also adds. `leaked-corner.png` is the picture
of what this test is actually looking for; put it beside `before-corner.png` and
the difference between "a FIRE rim leaked onto desktop" and "a sentence is long"
is not subtle.

## Reproducing

```
npm run build
npx vite preview --port 4193 --strictPort &
PREVIEW_PORT=4193 node evidence/r15-01-the-frame-the-fire-test-sees/capture.mjs before
PREVIEW_PORT=4193 node evidence/r15-01-the-frame-the-fire-test-sees/capture.mjs leaked touch
```

There is no `after-*.png` here on purpose: **nothing the player sees changed.**
The fix is in what the test counts, so `before-desktop.png` is also the after
frame — the same pixels, now attributed.

`capture.mjs` copies `REGION_FIRE`, `ABSENT_MAX_PX` and `isBoneLit` from
`tests/mobile/` verbatim (they are QA's numbers, quoted, not re-derived) and reads
the rects from `window.__planetRush.layout`, so the attribution is the app's own
contract rather than a hand-drawn box.
