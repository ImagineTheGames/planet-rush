# a0-21 — a stray rule cuts the UPGRADE SHIP segment in half

Branch: `agent/ui/a0-21-stray-wheel-rule`

## BUILT

- **`913d3c8` fix(a0-21): the line across UPGRADE SHIP is a Pixi arc connector,
  not a rule** — `src/ui/build-wheel-view.ts` + `src/ui/build-wheel-view.test.ts`.
  - New `strokeArc()` helper; the disc's four arcs (outer rim lit/deep, hub rim
    lit/deep) go through it.
  - `drawRings`/`drawSpokes` moved from private methods to module-level
    `drawWheelRings`/`drawWheelSpokes`. They read nothing off the view, and a
    bare `Graphics` needs no DOM, so the drawn geometry is now unit-testable.
    Both call sites updated; nothing else about what they draw moved.
  - `src/ui/build-wheel-view.test.ts` — 3 cases, 2 of which fail on a revert.
- Goldens re-baselined (8 wheel snapshots) + `evidence/a0-21-stray-wheel-rule/`.

## DECISIONS

**It is not a label rule, so it is not narrowed — it is removed.** The brief
allowed for it being a separator that belongs under `OPEN ▸` at label width. It
is not one. It is the chord Pixi emits in front of `arc()` when a path point is
already open (`ShapePath.arc` → `_ensurePoly(false)`), and a point is always open
because `GraphicsContext._initNextPathLocation` re-opens the path at the last
point after every `fill()`/`stroke()`. A `circle`'s last point reads back as its
**centre**, so `circle(0,0,r).fill()` then `arc(0,0,r, π, 2π)` drew `(0,0)`→
`(−r,0)` before any rim. The hub's rim arc drew the same chord at hub radius over
the hub disc — which is why the visible line reached the middle instead of
stopping at the hub's edge. Two chords, collinear, abutting: one line.

**Rejected: the brief's own first suspect.** `build-wheel-view.ts:755-761` is the
hub's `CLOSE · ESC` rule and `w` there is `m.hubRule`, a hub-scale constant, on a
function only ever called for the hub. It was never the source and is untouched.

**Rejected: hiding it / clipping the rim arc to the wedge.** Nothing to keep.

**Rejected: leaving the routines as private methods and testing through the
view.** `BuildWheelView` measures `Text`, and this suite has no DOM (same reason
`shell-lifetime.test.ts` cannot build a `LobbyEntryView`). Module-level functions
over a bare `Graphics` is the only way to assert the drawn geometry headlessly.

**The test asserts an absence, deliberately.** A golden proves a frame is the
frame we last approved; it cannot prove the frame contains nothing nobody meant
to draw. The invariant asserted is u11-01's own prose — the spokes are the only
things dividing one wedge from the next — read back off the built Pixi path.

**Deleting the goldens before `--update-snapshots` was required, not sloppiness.**
The change is 463 px of 1 024 000 on the desktop frame, 4.5 % of the golden's 1 %
`maxDiffPixelRatio`. A plain `--update-snapshots` run rewrote nothing; the stray
line would have survived another re-baseline exactly as it survived every
previous one. Only the 8 `*wheel*` snapshots were deleted; all 8 regenerated.

**Untouched, per the brief:** the hub rule, u13-01's hit test (still `r * m.hub`
off the drawn geometry — no hand-written constant reintroduced), the five-segment
layout, u11-01's hueless chrome, the one-number cost rule.

## NEXT

Nothing outstanding. DoD: `tsc --noEmit` clean; `npm test -- --run`; goldens moved
on the branch; PR checks green.

Note for a future session: `src/ui/build-wheel-view.ts:816-818` (the wedge body
trace) uses `arc()` after a `moveTo` **on purpose** — that connector is the
wedge's radial edge. It is the only other `arc()` in `src/ui/` and it is correct.
