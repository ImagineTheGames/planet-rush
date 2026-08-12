# a0-32-labels-overflow-their-shapes.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-32-label-overflow`. PR
[#403](https://github.com/ImagineTheGames/planet-rush/pull/403).

## BUILT

- `a48a21a` — **the measurement, and the wedge.**
  - `tools/font-metrics-scan.mjs` → `src/ui/font-metrics.data.ts` (GENERATED):
    the real per-glyph advance of every codepoint the UI draws, measured out of
    `public/fonts/*.woff2` in Chromium. `--check` fails if the file is stale.
  - `src/ui/font-metrics.ts` — Pixi's own width/height arithmetic on top of it,
    headless. `textWidth`, `textHeight`, `textBox`.
  - `src/ui/hud-geometry.ts` — `sectorOverflow(box, AnnularSector)`.
    `wedgeChordWidth` DELETED (see DECISIONS §2).
  - `src/ui/wheel-stack.ts` — `wedgeStackBoxes` (a mirror of the view's own
    placement) and `fitWedgeStack` (the fix).
  - `src/ui/build-wheel-view.ts` — applies the fit, memoised per wedge node.
  - `src/ui/hud-geometry.test.ts` — the two wedge-fit suites rewritten against
    the shape. Verified RED against the old placement at every profile.
- `c50186c` — **the circle.** `roundLabelHalfWidth` / `fitRoundLabelSize` /
  `BUILD_BUTTON_LABEL` in `src/ui/build-button.ts`; `BUILD_SUB_SIZE` 10 → 9 in
  `src/platform/touch-visuals.ts`, pinned to the UI module by
  `touch-visuals.test.ts` (verified red at 10).
- `4ceee20` — before/after evidence at 844×390 dpr 3, `evidence/a0-32-label-overflow/`,
  both sides shot by one script (`tools/a0-32-label-shots.mjs`) against a preview
  build of the merge base and of this branch.
- `0c94170` — ten wheel goldens deleted and regenerated; eight moved. Plus the
  `pullIn` refactor (DECISIONS §4) and the evidence refresh off that build.
- `2478ed9` — dropped a scratch spec that rode in with the golden commit.
- `92b88f3` — **the dark-matter gate** (DECISIONS §7). CI was red on this and
  nothing else; no product behaviour changes.

Green: `npx tsc --noEmit`, `npx vitest run` (292 files / 5239 tests),
`npm run dark-matter:check`, `goldens.spec.ts` iphone+desktop.

## DECISIONS

### 1. The metric was a guess, so the first thing built was a measurement

`hud-geometry.test.ts` modelled text as "at most .82em of Audiowide, .60em of
Oxanium", written *before* u14-01 self-hosted the faces. Audiowide's `W` is
1.002em. Rather than pick a bigger guess — which would fail labels that are fine
— the advances are now measured per glyph out of the repo's own woff2 files.

Only the subsetted `unicode-range` is tabled. Outside it the browser picks a
system face and the studio container and the CI runner need not agree: `●` is
.6001em through the body stack and .604em through the heading stack **on this
box**. That is the a1-01 trap. Untabled glyphs are charged a full `em` instead,
which is wider than anything in either ratified face.

Two things about the arithmetic that cost real pixels and are easy to get wrong:

- **Pixi's letter spacing lands BETWEEN glyphs**, `n − 1` gaps, because
  `experimentalLetterSpacing` is `false` by default and this project never sets
  it. Assuming `n` over-reports a nine-glyph line by 1.6px.
- **The engine quantises every advance to a whole pixel and then adds.** Sum the
  `em`s and round once at the end and a 28-glyph line comes out 171 where the
  page draws 174 — three pixels LIGHT, the direction a fit budget may not be
  wrong in. `textWidth` rounds per glyph. Measured against the real page over 20
  live UI strings: **18 exact, one +1px, one −1px** (the residual is the engine's
  second quantisation, of the type *size*, which the model deliberately does not
  reproduce because it only ever makes the model read wide).

`tests/mobile/voice-copy-fit.spec.ts` re-measures the whole table and the
string arithmetic against the booted page, so the generated file cannot rot.

### 2. The wedge budget was the wrong AXIS, not the wrong number

This is the actual defect and it is worth being precise about, because the fit
test was green the whole time. The old budget was `wedgeChordWidth` — how wide
the wedge is at the line's radius. Wedge labels are **not rotated with the
wheel**, so on the wedge at nine o'clock a line of upright text runs along the
RADIUS and the rim is what stops it. `UPGRADE` measured 81px against a 127px
chord budget and hung 10px past the edge of a 140px disc.

`wedgeChordWidth` is **deleted** rather than kept beside the new shape: a budget
that is right for one wedge and silent about another is worse than no budget.

The replacement is `sectorOverflow` — a box against an annular sector, reporting
how far it escapes past the rim, into the hub, and past each spoke. Reverting the
placement turns it red at **every** profile including desktop (UPGRADE SHIP was
2.2px past the rim there too, and had been since u14-01).

Also found by the same sweep, and fixed by the same change: `SHIELD` and
`1/1 BUILT` on the RADAR wedge were 2–8px past the rim at every phone profile.

### 3. What was allowed to move, and why it is these two things

The brief protects the wheel geometry, the hit-test, the arc fix and the sweep;
the profile's type sizes are the handoff's. Two numbers in the picture were never
anybody's ratified number, and between them they are enough:

1. **How far down the radius the stack hangs.** `fitWedgeStack` hangs it at the
   outermost radius that keeps every line inside the wedge. Inward only, on the
   wedges that need it: 2–10px, and the twelve-o'clock wedge never moves.
2. **How much bigger u16-01's SELECTED name gets.** At 390px the wedge cannot
   hold `UPGRADE` at 19/17 at *any* radius — the resting name fits with 1.5px to
   spare and the enlarged one is 8.7px wider. So the name grows by as much as the
   wedge can hold, up to the design's 19/17: full growth on desktop and tablet,
   capped to ×0.937 on the phone. It still draws bigger than resting, so the tell
   survives; the floor is `MIN_NAME_FIT_SCALE` (0.8) and a wedge that needs more
   fails the fit test naming the string, because that would be a copy problem.

**Rejected:**
- *Rotate the labels with the wedge.* Fixes the axis, changes the whole control.
- *Shrink the profile's type.* Below the ratified scale, on every wedge, to fix
  three of them.
- *Shorten `UPGRADE SHIP`.* GDD §2.5 makes the wedge name the thing that names
  what it spends on, and the copy is the last resort the brief ranks last.
- *Grow the wheel.* a0-20/u13-01 geometry, and the brief forbids it.

### 4. The fit is applied as a DELTA, and that is not a style choice

First cut handed the view an absolute radius. The view measures its stack with
PixiJS and this module measures it with `font-metrics`; they agree to about a
pixel, so **every** wedge moved by that pixel — the first golden diff had TURRET
and REPAIR REACTOR in it, two wedges with nothing wrong with them. `WedgeFit`
now carries `pullIn`, the view subtracts it from its own measurement, and a wedge
that needs no fitting is byte-identical to before. `hud-geometry.test.ts` asserts
`pullIn === 0` on the top wedge at every profile.

### 5. `& UPGRADE`: one pixel of type, said out loud

The button's budget was *"the chord of a 38px-radius circle at this baseline is
~68px"* — generous in the same direction twice. A chord at the BASELINE is not
the room a line of type has (its widest point is the corner of its box), and the
5px rim is stroked *centred* on the radius, so the interior ends 2.5px inside the
circle. Real room: 64px. Real word, in the real Oxanium: 67.8px.

Fitted rather than guessed: `fitRoundLabelSize` takes the largest half-pixel size
that fits with `ROUND_LABEL_PAD` (1px) to spare, and at the shipped geometry that
is **9px, down from 10**. Copy unchanged, tracking unchanged (`TRACKING.label`,
.16em), button unchanged. `BUILD` is untouched at 15px — it fitted all along with
5% to spare, and that is now asserted.

Rejected: dropping tracking to `TRACKING.name` (.1em) — 64.0px against 63.0px of
room, still over, and `& UPGRADE` is not a name; shortening the copy — not needed
and GDD §2.5 puts the second word there on purpose; growing the circle — the rect
is a layout contract and GDD §2.4 makes a touch target a floor.

`src/platform/` may not import `src/ui/` at runtime, so the size is spelled out
in `touch-visuals.ts` and pinned to `BUILD_BUTTON_LABEL` by its test — the same
discipline the two font stacks already take.

### 6. The goldens went green before they went right

Once §4 stopped moving the innocent wedges, the three RED phone baselines came
back **under** the 1% `maxDiffPixelRatio` — green, and stale, still showing the
clipped `UPGRADE`. `--update-snapshots` does not rewrite a baseline that passes.
All ten wheel shots were therefore DELETED first and regenerated; eight differ,
and the two that came back byte-identical are the phone UPGRADE wheels (four
wedges of 90°, nothing to pull in — which the unit suite reports from the other
side).

### 7. The gate that was actually red — and why not three allowlist rows

The local suite was green from the first session on, so the branch *looked* done;
CI's "Typecheck, test, build" was red the whole time on
`tools/dark-matter-scan.mjs --check`, which the local runs never invoke. **Check
`gh pr checks` before believing a green `npx vitest run`** — this is the same
trap as the Playwright shards, one gate further out.

Three new exports no production code called. Allowlisting all three is the move
the gate exists to prevent (`matchAbundance` shipped tested, covered, green and
uncalled), so each got the answer it deserved and only one was allowed:

- **`textBox` — WIRED.** `wedgeStackBoxes` was building the same box inline out
  of `textWidth`/`textHeight`. That is the failure mode this module was written
  to stop — the model and the view keeping separate arithmetic — so the export
  replaced the inline copy. Identical numbers: 5239 tests and every golden
  unmoved, which is the proof it was a duplicate and not a change.
- **`untabledGlyphs` — DELETED.** No caller in production or in a spec. What its
  doc carried is a property of `UNTABLED_ADVANCE_EM` (an untabled glyph is
  charged a full em, so the measurement reads WIDE), and that note now lives on
  the constant instead of pointing at a function nobody called.
- **`BUILD_BUTTON_LABEL` — ALLOWLISTED**, individually verified, written up in
  `docs/dark-matter-scan.md` §4.4b rather than pattern-triaged. It is the §5 seam
  itself: `src/platform` may not import `src/ui` at runtime, so the spec is the
  only place the two layers can meet. Same shape as
  `build-wheel.ts#segmentAtDirection`.

Also dropped the stale `hud-geometry.ts#wedgeChordWidth` row — §2 deleted that
export, so its allowlist entry named nothing. `materials.ts#PLATE_MOTION` is
reported no-longer-dark by the same run and was **left alone**: `src/art/` is not
this lane's file to triage, and the scan says it is not a failure.

## THE SWEEP (brief item 4)

Everything measured against the real faces, headless, with the new metrics.

**Broken, and fixed here:**

| where | at | was |
|---|---|---|
| build wheel `UPGRADE SHIP` name | every profile | 2.2–13.1px past the rim (worst: phone, selected) |
| build wheel `SHIELD` name + `YOUR STATION` | every phone profile | 1.8–7.9px past the rim |
| build wheel RADAR `1/1 BUILT` | every phone profile | 4.7–5.5px past the rim |
| build wheel `TURRET` / `REPAIR REACTOR`, selected | 375×667 and smaller | 0.1–0.7px past the rim |
| BUILD button `& UPGRADE` | every touch profile | 3.8px wider than the circle's interior |

**Checked and clean:**

- The **upgrade** wheel, both levels, every profile, including the GROWN ladder
  the fit suite already runs: four wedges of 90° gives the words a wider arc and
  nothing escapes. Its two phone goldens regenerated byte-identical.
- The 20 fixed-width chrome labels in `voice-copy-fit.spec.ts` (doors, chips,
  headlines, hints, refusals) — all still fit against the self-hosted faces;
  tightest is 36% headroom. That spec now also proves the headless model agrees
  with the page, which is what makes the unit assertions worth anything.
- The lobby's two tightest controls, the STATE word and the TEAM chip, already
  auto-fit their words to their plate (`STATE_LABEL_PAD` / `TEAM_CHIP_LABEL_PAD`,
  `lobby-view.ts`). Nothing to do — and it is the pattern the wheel and the
  button were missing.

**Not swept:** the ~170 remaining `Text` sites whose container is the content box
rather than a fixed shape. They cannot clip a shape because there is no shape;
the ones that can are the two above plus the plates already covered.

## NEXT

- Waiting on CI for `92b88f3`: the six Playwright shards and the
  "Typecheck, test, build" job that §7 fixes. PR #403 is open with the
  before/after crops in the body.
- If a reviewer wants the selection tell louder on a phone than ×0.937, the lever
  is `wheelMetrics().name` at the compact profile, not `SELECTION_NAME_SCALE` —
  the cap is a consequence of the resting size, and lowering the resting size is
  the only thing that buys the full 19/17 back. That is a Director call, not a
  layout fix.
