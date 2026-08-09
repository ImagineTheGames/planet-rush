# a0-16 — the wave clock must read the real interval

Branch: `agent/gameplay/a0-16-wave-clock-reads-economy`
Owner: Gameplay Engineer. Ships **no balance change** — a0-17 does that next.

## BUILT

- **`1a7482d` fix(a0-16): the clock and the bots read the match's own wave interval**
  - `src/sim/constants.ts` — new `waveIntervalOf(world?)`: the ONE read of
    `world.economy.waveInterval`, falling back to `WAVE_INTERVAL_S` when the
    field is absent. Typed structurally (`{ economy?: { waveInterval: number } }`),
    not as `World`, so a caller outside the sim can pass a frame's worth of world
    without importing the state tree. `waveTime`'s doc rewritten: its baseline
    default now survives only for the bare arithmetic collapse anchor.
  - `src/sim/waves.ts`, `src/sim/match.ts` — the two callers that already read
    `world.economy?.waveInterval ?? WAVE_INTERVAL_S` inline now go through
    `waveIntervalOf`, so the defensive read exists once.
  - `src/bots/perception.ts` — `nextWaveIn` passes `waveIntervalOf(world)`.
  - `src/ui/wave-clock.ts` — `computeWaveClock(t, collapsed, waveInterval)`;
    the third arg defaults to `waveIntervalOf()` (baseline), so `WAVE_INTERVAL_S`
    is not named in the file at all.
  - `ABUNDANCE`'s doc no longer says the clock blocks a bigger spread; it says
    a0-17 is now free to make it.
  - Tests in `src/ui/wave-clock.test.ts` and `src/bots/perception.test.ts`.

- **`6fda633` wiring(a0-16): feed the match's wave interval to the HUD [CROSS-LANE]**
  - `src/ui/hud.ts` (UI Engineer) — optional `HudFrame.waveInterval`, passed
    straight through to `computeWaveClock`.
  - `src/main.ts` (Platform Engineer) — `feedHud` fills it from
    `waveIntervalOf(world)`, beside `collapsed`.
  - Three lines, both files outside this lane. Flagged in the commit subject and
    the PR body for their owners.

- **`<evidence commit>` — `evidence/a0-16-wave-clock/trace.txt`**, written by
  `tests/harness/a0-16-evidence.test.ts` (env-gated, a0-08's pattern).

## DECISIONS

- **One accessor, not a second copy of the expression.** The brief says "thread it
  the way the spawner already does rather than inventing a second path". The
  spawner's path was an inline `?? WAVE_INTERVAL_S`; copying that expression into
  two more files would have been three paths, not one. `waveIntervalOf` is the
  one path, and all four callers moved onto it. Rejected: exporting the raw
  `?? ` expression as a constant, and re-deriving the interval from
  `abundanceMultipliers(world.economy.abundance)` (a second route to the same
  number, which is exactly what the brief forbids).

- **The clock takes a number, not a `World`.** `computeWaveClock` is fed from a
  `HudFrame`, which is documented as all-primitives and reused in place so the
  feed allocates nothing (GDD §4.3). Handing the UI a world reference to reach
  into would break that and put a sim read in the render path. The frame carries
  the sim's *verdict* instead — the same shape `collapsed` already uses
  (`main.ts` calls `isCollapsed(world)` and feeds the boolean).

- **The cross-lane wiring is in scope, in its own commit.** The brief names two
  files, and only those two are DoD-grepped. But a clock that accepts an interval
  and is never handed one still counts the baseline down on a real screen — the
  player-facing half of the bug would have survived the fix, and a0-17 would then
  ship a big spread behind a lying HUD. Three additive lines, no behaviour change
  for any existing caller (an unset optional field reads exactly as before),
  isolated in `6fda633` so its owners can review or revert it alone.

- **The tests assert agreement, never a literal.** Test 1 reads the clock's
  countdown target one tick before the wave, then steps the real sim and brackets
  the landing tick: the wave lands on the first tick at or after the target, and
  not one tick sooner. Bracketing (rather than `toBeCloseTo`) is what makes RICH
  exact — its interval is 127.5 s, which is not a whole number of 1 s steps, and
  a straight equality against the landing tick fails by 0.5 s for arithmetic
  reasons that have nothing to do with the bug.

- **`formatClock` ceils, so the HUD shows `0:01` up to the arrival, not `0:00`.**
  That is existing intended behaviour ("never reads 0:00 while a wave is still
  pending") and is stated in the evidence rather than asserted away.

## NEXT

- Nothing outstanding. DoD is green: `tsc --noEmit`, `npm test -- --run`
  (242 files / 4108 tests), the `waveTime\([^,)]*\)` grep on both files, and
  `origin/main` is an ancestor of HEAD.
- **Not covered by a unit test:** that the HUD actually *passes* `frame.waveInterval`.
  `src/ui/hud.ts` needs Pixi and has no headless suite (nothing imports it in any
  `*.test.ts`). `tsc` covers the types and the `?debug=1` live-stage seam covers
  the pixels; a QA capture of a SCARCE match's HUD would close it properly.
- **Handoff to a0-17:** the multipliers in `ABUNDANCE` are untouched
  (scarce 1.1 / standard 1 / rich 0.85). The clock and bot tests are written
  against the table, so widening the spread should not need either of them edited.
  Watch `collapseDeadlineFor` — the re-anchor keeps match length at the baseline
  deadline, and a much longer SCARCE interval is what makes its `COLLAPSE_GRACE_FLOOR_S`
  floor start binding.
