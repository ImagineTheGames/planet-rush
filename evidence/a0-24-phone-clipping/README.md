# a0-24 — two things clip on the phone

Evidence for `agent/ui/a0-24-phone-clipping`. Two clips from the developer's
captures of `68d8449`, both on a landscape phone.

## 1. The build wheel ate the match clock

`before-phone-landscape-build-wheel.png` is `origin/main`'s own baseline at
844×390 — the same frame the developer photographed. `MATCH 0:02` is drawn under
the wheel's top edge, half-occluded by the TURRET wedge.

The numbers behind it, all read off the shipped geometry:

| | |
|---|---|
| wheel radius at 844×390 | `clamp(min(844,390) × 0.36, 120, 230)` = **140.4 px** |
| wheel footprint | y **54.6** → 335.4 (72% of the screen's height) |
| HUD frame scale at 844×390 | `clamp(min(844/1280, 390/720), 0.75, 1)` = **0.75** |
| stacked clock strip | y 16 → **≈69** (three lines + rule + scrim bleed) |
| overlap | **≈14 px**, which is the bottom of the third line |

`after-phone-landscape-build-wheel.png` is the re-baselined golden. The strip has
re-flowed to a single row — the same three readouts, the same words, the same
colours, left-to-right — and clears the disc entirely:

| | |
|---|---|
| compact strip | y 16 → **≈35** |
| clearance to the wheel | **≈19 px** |

**Why the clock and not the wheel.** The wheel may not move: its geometry,
u13-01's hit-test and a0-21's arc all read off `wheelRadius`/`wheelBounds`, and a
wheel that shifts while open is a wheel whose wedges are no longer where the
thumb learned they were. But the wave countdown is the number the build choice is
being *made against*, so "the clock yields" cannot mean the clock is dropped.
Re-flowing spends the axis the screen has plenty of (844 px of width) instead of
the one it has none of, and keeps the element at the `top-center` placement
GDD §2.2 puts in writing.

**Desktop is unchanged.** At 1280×720 the wheel's footprint starts at y 130 and
the stacked strip ends at y ≈83, so the strip never re-flows and the two desktop
wheel goldens are byte-identical to `main`'s. That is asserted mechanically too —
see the third case below.

### The re-baseline had to be forced, and that is a finding

`--update-snapshots` over this spec rewrote **nothing** — every phone golden
passed against its pre-fix baseline, including the one whose clock strip visibly
moved from three stacked lines to one row.

`GOLDEN` is `maxDiffPixelRatio: 0.01`. The `iphone` project shoots at dpr 3, so a
frame is 2532×1170 = 2.96 MP and one per cent of it is **~29 600 pixels** of
slack. Re-flowing three lines of thin instrument type changes far less ink than
that, so the comparison passed and Playwright had nothing to rewrite. Playwright
1.49 has no `--update-snapshots=all`, so the four wheel goldens were **deleted
and regenerated** — a missing snapshot is always written.

Two things follow, and both are worth more than the pictures:

- **The tolerance is wide enough to hide a layout change on this surface.** The
  clip the developer photographed is ~14 px of one line at dpr 1; at 1 % of a
  2.96 MP frame no phone golden could ever have caught it. This is the second
  independent reason (after the zero-crop one below) that **the assertions, not
  the goldens, are the evidence for this brief.**
- Any phone golden whose scene opens a wheel was carrying a baseline that no
  longer matched what the app drew, silently, inside tolerance. All four are
  regenerated here: landscape and portrait-held, build and upgrade.

## 2. The onboarding prompt ran off the bottom

**This one has no golden, and the reason is the finding.** The arithmetic was
never the bug: `promptBounds` already hung the panel from
`H − HUD_PAD − insets.bottom`, and `before-phone-landscape-build-wheel.png` shows
the SPEND prompt — the **longest** authored string, 61 characters against the
next longest at 59 — ending at y 363 of 390, comfortably on screen.

What clips is that the HUD is laid out against the **canvas** while the camera is
given the **visual viewport**. `main.ts` `readViewport()` names the cause in its
own comment: *"the URL bar, a notch (`safe-area-inset`), and fullscreen
transitions crop and shift the visible region"*. Everything anchored to the top
survives that. The prompt is the one HUD element hung off the bottom, so it is
drawn into the strip of canvas the player cannot see.

Playwright has no URL bar and no home indicator, so **the crop is zero in every
baseline we shoot** — which is why no golden ever caught this and why a golden
cannot be the evidence for it. The assertion is.

And `HudFrame.minimapInsets`, the field that exists precisely to carry that crop,
was declared, read by the geometry, and written by nobody:

```
$ grep -rn "minimapInsets" src/ --include=*.ts | grep -v src/ui/hud.ts
$            # (no output — dead wiring)
```

Fixed at the wiring (`main.ts` `viewportInsets()`, the union per logical edge of
the visual-viewport crop and `env(safe-area-inset-*)`, rotated into logical space
under the landscape lock), at the clamp (`promptBounds` pinned `y` at the top
margin for an over-tall panel and pushed its **bottom** past the viewport — the
comment claimed the opposite), and at the draw (the scrim was sized from
`textWidth + pad` while the registered rect was clamped to the band).

## 3. The assertions — `src/ui/hud-geometry.test.ts`

Per the brief: *a layout test beats a golden here*. A golden proves one string at
one length; these prove the rules, across every profile in QA's matrix plus the
two narrow phones it does not cover.

| case | what it pins |
|---|---|
| `NEVER INTERSECTS THE OPEN WHEEL` | the strip's drawn rect and `wheelBounds()` do not overlap, on every profile, in both wheel states, sized from the longest string each readout can carry (`WAVE_NAMES` read from the clock's own module) |
| `re-flows ONLY where the stack cannot fit` | the exact SET of profiles that go compact — desktop is not one, and no profile re-flows with the wheel closed |
| `keeps all three readouts, in order` | the row is a re-flow, not a drop: three readouts, left to right, all inside their own chrome |
| `KEEPS ITS BOTTOM EDGE INSIDE THE SAFE AREA` | every string `resolvePromptText` can produce — 4 prompts × 3 devices × 2 fire modes = 24 — at bottom insets of 0 / 21 / 34 / 44 / 88 px |
| `CANNOT be pushed off the bottom by its own height` | the inverted clamp, fed a panel three screens tall |
| `never needs the height cap for authored copy` | the cap is a guardrail, not a working part — a capped panel is one the text overflows |

Each was checked against the old geometry before being trusted: reverting the two
fixes in place turns four of these red.

## Files

| file | what it is |
|---|---|
| `before-phone-landscape-build-wheel.png` | `origin/main` @ `68d8449`, 844×390 — `MATCH 0:02` under the TURRET wedge |
| `after-phone-landscape-build-wheel.png` | this branch, same scene — one-row strip, clear of the disc, longest prompt fully on screen |
| `before-phone-landscape-upgrade-wheel.png` / `after-…` | the same collision one wheel deeper (GDD §2.5) |
| `before-phone-portrait-build-wheel.png` / `after-…` | portrait-held, under the landscape lock |

Each `before-*` is byte-identical to `origin/main`'s own baseline for that scene,
and each `after-*` to this branch's regenerated one — they are the goldens, not
re-shot lookalikes, so the diff in the PR and the diff here are the same diff.

## 4. One thing this pass did NOT change, and QA should know

The wave clock is **not in the layout registry**. Booting the real bundle at
844×390 with the wheel open and reading `window.__planetRush.layout` back gives
eleven entries — `ore-hud`, `banked-total`, `station-hp`, `build-wheel`,
`wheel-hub-back`, `onboarding`, the minimap, the sticks — and no `wave-clock`.
`Hud.describeLayout` never pushed one.

So the intersection rule is asserted here against `waveClockLayout()`'s returned
bounds, which is the same object the view positions the text from and draws the
chrome to, rather than against a registered rect. Registering it was left alone
deliberately: the honest anchor for a strip GDD §2.2 puts at `top-center` is
`top-center`, and the compact row is ~450 px wide on an 844 px screen, so it
would not fit the centre third that `resolveAnchor` gives that region — a new
entry would land red in QA's placement suite on the geometry this brief just
ratified. The id, the region and whether the region's definition should widen are
QA's call, not this brief's.
