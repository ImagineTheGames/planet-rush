# a0-05b — unstick #316: the goldens it "never went near"

Branch: `agent/gameplay/a0-05-station-health-always-visible` · PR #316
Working note. Not evidence — the DoD run and the PR body are.

---

## BUILT

- **`2299cb7` — merge `origin/main`.** 23 commits behind, not 10. One conflict,
  in `docs/design-amendments.md`; both sides had prepended a new entry above
  "The CONTROLS row". Both kept, a0-05's on top, a0-03's beneath, main's
  relative order otherwise untouched.

---

## DECISIONS

### The brief's diagnosis was wrong in both directions. The prescription still held.

The brief named **#283** (l2-02 industrial voice sweep) and **#312** (the
Cutterhead) as the stale baselines, and said "do not go looking for what your
branch did to the codex — it did nothing."

Both halves are false, and it is worth writing down because the second one was
one instruction away from being followed off a cliff.

**#283 and #312 were already in this branch before I touched it:**

```
PR #283 (4960540): IN branch     <- brief says this is the gap
PR #312 (6a5373a): IN branch     <- brief says this is the gap
PR #314 (cf7edab): MISSING
```

They are commits `4960540` and `6a5373a`, both ancestors of the branch's own
first commit `d3b4e03`. l2-02's ratified copy was never absent, so it was never
at risk of being overwritten. The gap was actually **#315** (a0-03 — the build
wedge quotes ONE number, top-left says `ORE`, which re-baselined 13 wheel + HUD
goldens on main in `9e501c3`) and **#317** (a0-04, nameplates). #315 is the
BUILD WHEEL failure by name, and the HUD half of the CODEX frames.

**And the branch did go near the codex — deliberately, in `7bc2b1d`:**

| File | Entry | What a0-05 changed |
|---|---|---|
| `codex-systems.json` | `sys-fog-radar` | title kept, **summary + body rewritten**, `SENSOR_RANGE` fact deleted, two coverage-radius facts added |
| `codex-strategy.json` | `strat-scouting` | body rewritten ("health is fog" is no longer true) |
| `codex-bots.json` | bots overview | fog-honesty sentence re-pointed |

That is the amendment landing in player-facing copy, which is exactly what
a0-05 was supposed to do. So "a damage-ring visibility change cannot reach the
codex reader" is wrong about this branch specifically.

**Why this matters more than a footnote.** The brief's instruction was: if the
codex goldens fail, do NOT re-baseline them, because you'd be overwriting
l2-02's copy with a pre-l2-02 render. That reasoning is void — this branch is
*post*-l2-02. Had the codex goldens genuinely moved because of a0-05's own copy
rewrite, refusing to re-baseline would have left #316 red forever with no way
out. I resolved it by measurement instead of by either instruction: merge
first, run the suite, and let the failures name their own owner.

### Rejected

- **Re-baselining anything before the merge.** The whole failure class is
  "old baseline vs new render". Regenerating first bakes the stale render in.
- **Trusting the brief's "retry will not save it" as license to skip
  diagnosis.** True as far as it went, but it was reasoning from the wrong
  cause.
- **Editing `style-guide.md` §5.2.** See NEXT — it contradicts shipped
  behaviour, but it is Art's file and frozen to the Director. Flagged, not
  touched.

### The unit-suite failure that was not one

First full run: `1 failed | 3911 passed` —
`tests/net/capacity/capacity-regression.test.ts`, "the loop stays inside the
tick budget at 12 rooms", `expected 39.13 to be less than 33`.

Worth chasing rather than waving off, because a0-05 makes `FogTracker` stop
withholding — the server now sends station HP it used to suppress, so a
per-tick cost regression at 12 rooms was a plausible *consequence of the
design*, not just noise. Checked properly:

| Where | Result |
|---|---|
| branch, inside full suite | FAIL 39.13 ms |
| branch, standalone | FAIL 37.4 ms |
| `origin/main`, standalone (scratch worktree) | PASS |
| branch, standalone ×2 | PASS, PASS |
| branch, full suite re-run | PASS — 235/235 files, 3912/3912 |

Load-sensitive, not a regression: the printed marginal cost swings 1.2×–3.0×
of a sim step between runs on identical code, and the two failures coincided
with a 2165-file worktree checkout running alongside. Not mine, and not
introduced by the merge. Noted here because the next person to see it red
deserves the measurement rather than a second investigation.

---

## NEXT

- Mobile suite running; provenance split for the PR body pending its result.
- **For the Director — `style-guide.md` §5.2 still reads "Health = a damage
  ring, visible only within sensor range (GDD §2.2) — enemy facility HP is
  scouted, never broadcast."** GDD §2.2 was amended on 2026-08-07 and now says
  the opposite; the art contract's mirror of it is stale. The file is frozen to
  the Director and outside gameplay's ownership, so a0-05 did not touch it.
  It needs a one-line amendment to match, or the two contracts disagree in
  writing about shipped behaviour.
