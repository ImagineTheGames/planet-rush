# a0-103-the-phone-minimap-sits-short-of-its-corner.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-103-minimap-finds-its-corner`. PR: (pending).

## BUILT

- `601c348` — **the check, RED.**
  - `src/ui/anchor-reach.ts` (NEW) — `ANCHOR_EDGES`, `edgeGap`,
    `LAYOUT_RESERVATIONS`, `reachViolations`, `describeReachViolation`,
    `CONTENT_BOUND_IDS`. Registry vocabulary in and out, Pixi-free, written to
    lift into `@platform/layout-registry` verbatim — same argument as
    `layout-exclusions.ts` (that file is Platform's; extending it is not ours).
  - `src/ui/anchor-reach.test.ts` (NEW) — the check's own suite, incl. the
    mirror pins for the two badge lifts.
  - `src/ui/minimap.test.ts` — `a bottom-right element actually reaches the
    bottom-right` (the DoD test), the guard-on-the-guard, the audit list, and
    the ultrawide case. Driven from a catalogue of every corner/edge-anchored
    registrant at 12 profiles x 3 schemes.
  - `TOTAL_LABEL_H` moved `hud.ts` -> `hud-geometry.ts` (no behaviour change) so
    the `banked-total` reservation reads the drawing constant.
  - RED output kept at `evidence/a0-103-anchor-reach/red-before-the-fix.txt`:
    24 violations, all `minimap`/`right`, all 8 touch profiles, and at 798x384
    it reproduces QA's rect to the pixel — `{x:586, y:292, 80x80}`, 132 px short.
- `0fc6073` — **the minimap.** `collapsedRect(viewport, isTouch, insets,
  fireCorner = false)`; threaded (all defaulted) through `minimapRect`,
  `Minimap.hitTest`/`tap`, `MinimapView.update`, `Hud.updateMinimap` +
  `Hud.minimapTap`. `Hud` answers `fireCorner` from
  `liveOnGlassControls(...).fireButton`. `promptBand` deliberately asks for the
  map at its LEFTMOST (DECISIONS §6). Sixth reservation row `minimap`/`right`.
- `7d113b7` — **evidence.** `tools/a0-103-registry-dump.mjs` + before/after
  registry dumps at 798x384 / 844x390 / 1280x800 and the 844x390 frame pair.
  BEFORE reproduces a0-99's numbers exactly; AFTER moves the minimap's right gap
  132 -> 12 and moves nothing else on any profile.
- `6d82212` — **eleven phone goldens rebaked** (see DECISIONS §7 for the finding
  that came with them).
- `70dd6ec` — **dark-matter triage.** The module is nine test-only exports and
  the gate is CI-blocking; §4.13 in `docs/dark-matter-scan.md` is the verdict
  (SURFACE, the §4.7 shape) and the allowlist points at it.

Green: `npx tsc --noEmit`, `npm test -- --run` (315 files / 5870 tests),
`npm run dark-matter:check`, `goldens.spec.ts` iphone + desktop.

## DECISIONS

### 1. Reach is a SECOND question, not a replacement for containment

`withinAnchor` asks "no further OUT than the margin". This asks "no further IN
than the margin". Neither implies the other, and `anchor-reach.ts` deliberately
stays silent when an element hangs off the screen (a negative gap) — that is
containment's finding and it already has an owner.

### 2. Not every region promises an edge — and the exemptions are argued

`ANCHOR_EDGES` gives edges to the four corners and the two edge-named bands
only. Rejected: applying it to everything.

- `full` / `center` name a zone. The onboarding prompt chose `full` *precisely*
  because it makes no positional claim (hud.ts's `describeLayout` table). A
  reach rule there would break a deliberate design decision.
- `bottom-strip` is a band `stripHeight` deep; containment already pins it to
  the bottom, and its drawn content is centred text that does not span the
  width, so `left`/`right` would be wrong too.
- `left-half-bottom` / `right-half-bottom` are half-screen QUADRANTS. They name
  where a thumb reaches, not a bezel; the engaged stick is dynamic by design.
  (They are still swept — they just report nothing.)

### 3. The frame is not always the viewport

a0-74 bound the HUD chrome to a centred content box after the developer's
ultrawide report. On 32:9 `station-hp` is ~336 px off the glass ON PURPOSE. A
reach check measured against the viewport calls that fix a bug — so
`reachViolations` takes `frameFor`, `CONTENT_BOUND_IDS` names the five chrome
ids bound to the box, and the test asserts BOTH answers (green against the box,
red against the glass) so the trap is pinned rather than described.

### 4. A gap wider than the margin is legal only if a row declares it

`LAYOUT_RESERVATIONS`, same shape and motive as `LAYOUT_EXCLUSIONS`: id, edge,
px, and the argument. Six rows. Four read the drawing constant itself
(`MINIMAP_FIRE_COLUMN`, `MINIMAP_STRIP_CLEARANCE`, `stationChromeHeight` +
`ZOOM_CONTROL_GAP`, `TOTAL_LABEL_H`); the two badge lifts are mirrored, because
`@render/build-badge` and `@net/ping-badge` carry Pixi and this module is
deliberately free of it — and `anchor-reach.test.ts` pins each mirror against
its source constant.

Rejected: shipping the check with an empty table and letting five true
positives sit red. The audit test in `minimap.test.ts` runs the sweep with
`reservations: []` and asserts the raw list, so the "what did it catch" answer
is generated from the code rather than typed into a PR body and left to rot.

### 5. The gap WAS deliberate — and the fix is that it is now conditional

`MINIMAP_FIRE_COLUMN` (120) + `MINIMAP_MARGIN` (12) = the 132 px QA measured. It
was reserved for the hold-to-FIRE button, off `isTouch` alone. Since a0-30 the
default scheme on every platform is Tap Commander, which draws no sticks and no
FIRE (`live-controls.ts` `liveOnGlassControls`), and Manual mode trades the
button for an aim stick — so on the profile QA photographed the reserve was
being paid to an empty corner, which is exactly why the registry listed no
`touch-fire-button` there.

So: `collapsedRect(viewport, isTouch, insets, fireCorner = false)`. The caller
answers "is a FIRE button drawn in that corner THIS frame" from the same rule
that decides whether it is drawn at all, and the default is `false` — an
unreserved corner is the honest default. And the reservation is now a declared
row (`minimap`/`right`) that applies exactly when the button is there, which is
the brief's "make the reservation explicit in the registry".

Rejected: shifting FIRE so the map can always take the corner. That is the field
report's own preferred resolution and it is a `src/platform/` change — not this
lane's to make.

### 6. The prompt band takes the worst case, so it does not twitch

`hud-geometry.ts` `promptBand` reserves clear air to the left of the corner map.
That left edge now depends on the scheme, so the band would re-wrap the
onboarding sentence when a player toggles Auto-aim mid-match. It calls
`collapsedRect(..., isTouch)` — the map at its LEFTMOST — so the prompt clears
the map under every scheme and nothing about the prompt moves on either
platform. Deliberately not threaded through `promptBand`/`promptBounds`/
`promptWithdraws`/`promptWrapWidth`.

### 7. The goldens moved — and something else was already stale

11 of 26 iphone baselines regenerated. The 2 that came back byte-identical are
the check on the method: `phone-landscape-thumb-band` is the one scene whose
scheme DRAWS the FIRE button, and there the map correctly does not move.

The finding: every regenerated landscape shot also moves EXACTLY 280 px inside
the top HUD band, and `phone-landscape-hud-top` — a top-band clip the minimap
cannot appear in — moves by those 280 and nothing else. That is a0-101's shield
bar. Its rebake did not survive merge #478: `a2253a10` changed both HUD-top
baselines and main took its own side of both (blob SHAs in the commit message).
They pass only because 0.35% / 0.23% < the 1% tolerance — the same tolerance
that let a 120 px minimap move through unnoticed.

Regenerating from this tree picks the correction up, so the phone one is now
true. `desktop-hud-top` is STILL STALE and this PR does not touch it: it is
nothing to do with the minimap. Flagged for QA / a0-101 in the PR.

### 8. Dark matter: triaged, not wired

The gate is CI-blocking and the module is nine test-only exports. Wiring it into
`src/ui` production was considered and rejected three ways (§4.13 in
docs/dark-matter-scan.md): inside `collapsedRect` it asserts the arithmetic
against itself; `Hud.describeLayout` reports PHYSICAL bounds so a HUD-side check
would be wrong under the landscape lock; and the honest caller is
`installLayoutHook`'s `placement()`, upstairs in Platform's file.

## NEXT

- Nothing outstanding on the DoD. Open items handed on:
  - `desktop-hud-top-desktop-linux.png` is pre-a0-101 on main (see §7) — QA's
    call, deliberately not touched here.
  - `reachViolations` + the two tables lift into `@platform/layout-registry`
    verbatim whenever Platform wants them beside `placement()`.
  - The field report's preferred resolution — shift FIRE so the map always takes
    the corner — remains open and remains a platform-lane change.
