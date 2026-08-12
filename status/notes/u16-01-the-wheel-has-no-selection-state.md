# u16-01 — the build wheel has no selection state

Branch: `agent/ui/u16-01-wheel-selection-state`

## The brief, in one line

`a0-20` measured the wheel clause by clause against screen 5a and found it
compliant on every geometric and typographic claim and missing **the interactive
half**: a highlighted wedge, a 140 ms sweep between wedges, a brighter/larger name
on the selection, a detent as the thumb crosses a boundary — and no hover at all
on desktop. Build those four.

Read first: `docs/theme-coverage.md` §1b and §6.4, and screen 5a itself via
`node spikes/a0-20/extract-handoff.mjs 5a` (the handoff HTML is one escaped line;
`grep -n` on it is useless).

## BUILT

Two commits.

**`60b1623` feat — the wheel knows which wedge you are pointing at**

| Deliverable | Where |
|---|---|
| The selection, as MODEL state | `BuildWheelSignals.selected` / `BuildWheelModel.selected` + `clampSelection` (`src/ui/build-wheel.ts`) |
| The 140 ms sweep | `src/ui/wheel-selection.ts` — `WheelSelection`, `sweepEase` |
| The highlighted wedge | `drawWheelSelection` (`src/ui/build-wheel-view.ts`) + `WHEEL_SELECTION` (`src/ui/instrument.ts`) |
| The brighter, larger name | `buildWedgeLines(seg, m, selected)` (`src/ui/wheel-stack.ts`), `nameColor` + `WHEEL_CHROME.nameReceded` / `secondaryLit` |
| The detent | `detentOnSelection` → `Hud.updateWheel` → the `UiSfx` seam (`'detent'` added to `UiCue`); `Hud.takeDetent()` → `haptics.haptic('tap')` in `main.ts` |
| Desktop hover (+ thumb, + stick) | `updateWheelSelection` on `pointermove` in `src/main.ts`, plus the pointerdown route and `WheelInput.selection` |

**`1613a39` test — the sweep measured, the highlight bounded, the detent heard**

`src/ui/wheel-selection.test.ts` (new, 24), additions to
`build-wheel-view.test.ts`, `build-wheel.test.ts`, `hud-geometry.test.ts`,
`instrument.test.ts`; a driven `u16-01` block in
`tests/mobile/build-wheel-gantry.spec.ts` (real cursor / real CDP touch); two new
goldens.

### The measured numbers (for the PR — do not re-round these)

- **Sweep: 140 ms exactly**, driven a millisecond at a time
  (`wheel-selection.test.ts` "takes 140 ms of clock…"). It is
  `PLATE_MOTION.wheelMs`, which had **no consumer in the repo at all** before this.
- **Visually arrived at 128 ms** — within 0.1° of the new wedge — and it spends
  the last 12 ms closing a gap nobody can see. That is the easing curve, not slop.
- **Name step: 19/17 = 1.1176×**, held to the arc-fit budget at every profile
  including 390 px, where the name is floored at 12 px.
- **Detent on a device with no haptics** (every desktop, and iOS Safari):
  `haptics.isSupported()` is false, `haptic('tap')` is a no-op, and the detent is
  the **note plus the 140 ms sweep**. The sweep is the primary tell and the one
  every device gets; the note is second; the 10 ms buzz is a third most players
  never had. Nothing is lost.

## DECISIONS

**No new sound.** `detent` was already in the ratified bank
(`src/art/audio/ui-cues.ts`: one note, A♭7, an octave above the click, fixed pitch
and deliberately undetuned because "a wobbling detent reads as a fault"). Three
other selections in the game already fire it. Adding a cue would have risked the
developer's standing "modern/sci-fi, not retro/toony" ruling for nothing.

**Nothing selected is a real resting state.** The design's prototype opens on
`sel: 0`; a live wheel does not. A pre-selected TURRET claims a choice the player
has not made, and on a gamepad the confirm button is then one press from acting on
it. Consequence, and it is a feature: **with nothing pointed at, every wedge draws
exactly as it did before this landed** — the four existing build-wheel goldens are
byte-identical and were re-verified green rather than re-baselined.

**The contrast is bought by the OTHER wedges receding.** `WHEEL_CHROME.nameReady`
was already `BONE.hi` (white), the top of the ramp, so "brighter" had nowhere to
go. The design's own pair is `#FFFFFF` selected against `#C6CDD6` unselected, so
unselected-ready names step down to `BONE.mid` — **only while a selection exists**.

**The cost numeral is the one thing the selection does not touch.** Its colour
answers "can I pay for this" (style-guide §2.1's carve-out); a numeral that also
brightened under the cursor would be saying two things in one channel.

**The sweep takes the short way round; the design does not.** Screen 5a
interpolates `rotate(sel * 90deg)`, so its 3 → 0 spins backwards through every
other wedge. On a five-wedge wheel that is 288° to say "you moved one notch". A
four-wedge prototype's rounding error, not a decision — rejected, and pinned by a
test.

**The name's `text-shadow: 0 0 18px` is drawn as a bloom in the highlight's
`Graphics`, not as a per-glyph shadow.** There is no text-shadow path anywhere in
`src/ui`, and a blurred glyph raster is the one thing in this feature that would
rasterise differently on a software-GL golden runner. Same light, cast by the
layer that is already casting light. Stated as a departure rather than hidden.

**The caption band (`selDesc`, `5a:100-103`) is NOT built.** It is a0-20's **Q3**
and it is a live contradiction: screen 5a puts a sentence under the wheel, GDD
§2.5 says "no rates, no HP-per-ore, no effect text". Both are ratified and they
disagree. The brief asks for four things and this is not one of them. **No agent
should add the copy until the developer rules.**

**Containers, not z-index.** Wedge faces and wedge words are now parented
separately (`buildBodies` / `buildSelection` / `buildClusters`) so the highlight
sits over the faces and under the type, which is 5a's own order and the only order
in which a 0.26 white tint lights a wedge instead of washing out its name. The
pooled nodes used to be added to the group as they were created, which made
z-order an accident of creation time. Verified: all 8 pre-existing wheel goldens
still pass.

**What was deliberately not touched:** `WheelInput` (Platform's — it holds the
stick selection for a *confirm*, which is a different question from "what is the
player looking at"), u13-01's `hubRadius` read, a0-21's `strokeArc`, the
one-number cost rule, the `ORE` caption, and every touch target.

## NEXT

Nothing outstanding on the four deliverables. Open items, none of them this brief's:

- **Q3, the caption band** — needs a developer ruling (above). Do not pre-empt it.
- `docs/theme-coverage.md` still reads "BUILD WHEEL: PARTIAL" and marks Q2 open.
  It is `a0-20`'s audit and its own header says *read-only*, so it was left alone;
  the PR body is where Q2 is answered. If the Architect re-runs the audit, §1b and
  the row for surface #5 are what move.
- The upgrade wheel deliberately has **no** selection state (`selection: 'none'` in
  `upgradeWedgeDraw`). Screen 5a is the build wheel; giving the other one a
  highlight by inheritance would be inventing design rather than implementing it.
