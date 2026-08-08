# a0-05b — unstick #316: the goldens it "never went near"

Branch: `agent/gameplay/a0-05-station-health-always-visible` · PR #316
Working note. Not evidence — the DoD run and the PR body are.

---

## BUILT

- **`2299cb7` — merge `origin/main`.** 23 commits behind, not 10. One conflict,
  in `docs/design-amendments.md`; both sides had prepended a new entry above
  "The CONTROLS row". Both kept, a0-05's on top, a0-03's beneath, main's
  relative order otherwise untouched.

### Session 2 — diagnosed the missing push, but did not make it

The branch was **25 commits ahead of its own remote**. `origin/main` was already
an ancestor of local `HEAD`, so the DoD's merge-base gate passed *locally* while
the PR's CI was still judging `981c78a` — the last pre-merge commit. That is the
whole reason #316 stayed red after session 1 did the work: the fix existed only
on disk.

**Session 2's note ended "Re-ran the DoD and pushed." It had not.** Session 3
found the branch still `[ahead 25]` of its own remote and `origin/...` still at
`981c78a`. The diagnosis was right and the push never happened — session 2 died
between writing the line and doing the thing. Reading it as done would have cost
a fourth session, so it is corrected here rather than left to flatter the record.

### Session 3 — the push, and the DoD on the pushed tree

- **Pushed `981c78a..80cb243`**, fast-forward, own branch only. This is the
  commit that actually unsticks #316; everything before it was a local no-op as
  far as CI was concerned.

DoD re-run on the merged tree (session 3, after the push):

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npm test -- --run` | **235 files, 3912/3912 passed** |
| `git merge-base --is-ancestor origin/main HEAD` | passes (`origin/main` = `03ed194`, = `HEAD~2`) |
| `npm run test:mobile` | see below |

### Session 4 — main moved again; second merge

Fresh lane, so the local branch did not exist and was checked out from
`origin/...`. That checkout **confirmed session 3's push was real**: the remote
branch stands at `80cb243`, exactly what session 3 claimed. Session 2's phantom
push has not repeated.

What had changed underneath: **`origin/main` advanced 13 more commits** while
#316 sat open — **#320 (a0-07, the darker backdrop)**, which re-baselined **34**
goldens on main. The backdrop is behind every frame, so it moves essentially the
whole snapshot set. The DoD's merge-base gate therefore failed again on arrival,
for the same structural reason and a different cause. Nothing session 1–3 did
came undone; the branch simply went stale a second time.

- **`66cbf94` — merge `origin/main` (13 commits).** No conflicts this time.

**The one file that could have gone wrong.** a0-07 and a0-05 both touch
`src/render/index.ts`, the only overlap in the merge. Git merged it textually
without a conflict, which is exactly the situation where a silent semantic revert
hides, so I read the two diffs rather than trusting the clean exit: a0-07 adds
`RenderView.mapId` and a `backdrop.setMap()` call; a0-05's change is the removal
of `withinSensorRange` and the unconditional damage ring. Disjoint hunks,
different concerns. a0-05's ring code is intact. Every other a0-05 file
(`sim/sensing.ts`, `sim/constants.ts`, `ui/station-hp.ts`, `art/stations.ts`,
`bots/perception.ts`, and both new tests) was untouched by the merge.

Session-4 DoD on the twice-merged tree:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npm test -- --run` | **236 files, 3956/3956 passed** |
| `git merge-base --is-ancestor origin/main HEAD` | passes |
| `npm run test:mobile` | see below |

`capacity-regression` passed this round, on an unloaded box — consistent with
session 3's load-sensitivity finding, and further reason not to have chased it.

### Session 5 — the push session 4 also never made

Session 4's merge `66cbf94` was **still unpushed**. The branch was `[ahead 14]`
of its own remote, `origin/...` still at `80cb243` — session 3's commit. So the
same failure that cost session 2 repeated one session later: the work existed on
disk, the DoD's merge-base gate passed *locally*, and CI went on judging a tree
without the a0-07 merge in it.

**This is now the dominant failure mode on this brief — twice out of four
sessions.** The lesson, written down so a sixth session does not learn it a third
time: on this brief, **push before running the gates**, not after. The tree
session 4 pushed nothing for had already passed tsc and the unit suite; holding
the push until the mobile suite finished is what lost it, because the session
ended inside that run. A pushed branch that later needs another commit costs
nothing; an unpushed branch costs a whole session.

Session 5 therefore pushed `80cb243..66cbf94` **first** (fast-forward, own branch
only, remote and local now `0 0`), then re-ran the gates on the pushed tree.

`origin/main` was still `b32d0a7` on arrival and already an ancestor of HEAD —
main did not move a third time, so no third merge was needed. The merge work of
sessions 1–4 stands exactly as recorded.

Session-5 DoD, re-run on the **pushed** tree:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npm test -- --run` | **236 files, 3956/3956 passed** |
| `git merge-base --is-ancestor origin/main HEAD` | passes (`origin/main` = `b32d0a7`) |
| `npm run test:mobile` | see below |

`capacity-regression` passed again — third consecutive pass on an unloaded box.
The load-sensitivity reading holds; it needs no further investigation.

**The golden proof re-measured against the *current* `origin/main`** (`b32d0a7`,
which now includes a0-07's 34 re-baselines), not the one sessions 1–3 saw:

```
diff <(git ls-tree -r origin/main --format='%(objectname) %(path)' -- tests/mobile/goldens.spec.ts-snapshots/) \
     <(git ls-tree -r HEAD        --format='%(objectname) %(path)' -- tests/mobile/goldens.spec.ts-snapshots/)
# no output — every blob hash still matches
```

Still byte-identical. The only `.png`s in a0-05's own commits remain the four
`evidence/images/a0-05-*` frames, which are PR illustrations, not baselines.

### The mobile suite: every golden passed. The one failure is not a golden.

First session-5 mobile run: **all four goldens named in the brief passed** —
`landscape phone BUILD WHEEL`, and the codex frames. The merge cured them, as
sessions 1–4 predicted but never got to prove.

One test failed, and it is not a snapshot:

```
✘ 31 [iphone] › menu-frame-cost.spec.ts:164:1
     the static title screen costs no more per frame than the live match (2.5m)
```

**A methodology error worth writing down.** That run was invoked as
`npm run test:mobile 2>&1 | tail -60`, which reported **exit 0** — that is
`tail`'s exit code, not npm's. The pipeline masked a red suite. Had I trusted the
exit code and not read the tail, I would have reported a green suite that was not
green. On this repo, always capture the run to a file and read `$?` from the
unpiped command, or use `PIPESTATUS`.

**Whose failure is it.** Not a0-05's, on two independent grounds:

- `git log --no-merges origin/main..HEAD -- tests/mobile/menu-frame-cost.spec.ts`
  is **empty** — a0-05 never touched it.
- The test compares the *title screen*'s median frame cost against the *live
  match*'s (`menuMs / matchMs < 4`). a0-05's change draws a damage ring on
  stations. **There are no stations on the title screen**, so a0-05 cannot move
  the numerator; it could only make the denominator *larger*, which moves the
  ratio away from the failure.

The plausible suspect is the merge's other half: **a0-07's darker backdrop**
renders behind every frame *including the menu*, and the test's own failure
message points at `src/ui/screen-cache.ts` — "~170 translucent polygons and
something has stopped caching them". A backdrop that invalidates the menu's
ScreenCache would raise the numerator exactly as measured. That is a hypothesis,
not a finding, until the re-run and CI agree.

The instrument is also load-sensitive by construction: it medians wall-clock
`requestAnimationFrame` deltas, the same class as `capacity-regression`, which
flaked twice on this box across sessions 3–4. Being re-measured clean and against
CI's dedicated runner before any conclusion is drawn.

**The deliverable re-proved, not just assumed.** The brief asks that the merge
not quietly revert a0-05, and that the tests proving it be re-run — not only the
goldens. Run as a named set: **45/45 passed** across
`sim/station-health-visibility` (4 — rings read true at every distance, the fill
is the core fraction so distance cannot enter it, a damaged station never reads
healthy), `render/stations` (12 — the ring grammar: owner colour whole, red
filling clockwise from twelve), `bots/fog-honesty` (6 — the symmetry a0-05
re-pointed, both FFA and Teams), `bots/perception` (18), and `server/fog`
(5 — ship HP still fogged).

### Session 6 — the push held; the provenance claim corrected

Arrived with local, `origin/...` and `HEAD` all at **`66cbf94`**, `0 0` — session
5's push was real, and the "unpushed session" failure did **not** repeat a third
time. `origin/main` was still `b32d0a7` and already an ancestor, so main did not
move again and **no third merge was needed**. Nothing to re-do.

CI on #316 is judging `66cbf94` — the right tree at last. `Typecheck, test, build`
already **SUCCESS** there; the Playwright job was still in progress on arrival.

**A correction to session 5's provenance claim.** Session 5 wrote that the three
codex goldens "appear in neither list — untouched by the merge and untouched by
me". The first half is wrong. It was measured against merge 1 (`2299cb7`) only,
and merge 2 (`66cbf94`, a0-07's darker backdrop) re-baselined **all 34** goldens
including the codex three — a backdrop behind every frame necessarily moves them.
Measured per file this session:

```
merge1=0 merge2=1  desktop-codex-desktop-linux.png
merge1=0 merge2=1  phone-landscape-codex-iphone-linux.png
merge1=0 merge2=1  phone-portrait-codex-iphone-linux.png
merge1=1 merge2=1  desktop-build-wheel-desktop-linux.png        (a0-03, then a0-07)
merge1=1 merge2=1  phone-landscape-build-wheel-iphone-linux.png
merge1=1 merge2=1  phone-portrait-build-wheel-iphone-linux.png
```

The conclusion the brief actually cares about is **unchanged and stronger**: they
came from *main's side of a merge*, not from a regeneration here. The
whole-directory blob comparison still returns no output, so every golden on `HEAD`
is byte-identical to `origin/main` and a0-05 re-baselined **zero**. Corrected
because the split is a claim a reviewer checks by command, and one half of it did
not survive the check.

Note also that main's own CI for `b32d0a7` was **still in progress** this session —
so main has not itself been proven green on the mobile suite at that commit. That
matters for `menu-frame-cost` below: "does it fail on main too" could not be
answered from CI on arrival.

---

## SNAPSHOT PROVENANCE — measured, not asserted

The brief asks for a split a reviewer can check. It is checkable by command,
which is better than a claim:

```
git diff --name-status 2299cb7^1 2299cb7 -- 'tests/mobile/**'   # 13 goldens, all from main
git log --no-merges --name-status origin/main..HEAD -- '*.png'  # 0 goldens, mine
```

- **From the merge: 13** golden `.png`s under
  `tests/mobile/goldens.spec.ts-snapshots/` — the build-wheel, upgrade-wheel and
  frozen-scene frames re-baselined on `main` by **#315 (a0-03)**. Taken wholesale
  from main's side. I regenerated none of them.
- **Mine: 0 goldens.** a0-05's own commits touch `.png` files only under
  `evidence/images/` (its four `a0-05-*` evidence frames, which are PR
  illustrations, not baselines).
- **The three codex goldens** — `desktop-codex`, `phone-landscape-codex`,
  `phone-portrait-codex` — do not appear in merge 1. ~~Untouched by the merge~~ —
  **corrected in session 6:** they *were* re-baselined, by **merge 2**
  (`66cbf94`, a0-07's darker backdrop, 34 goldens), taken wholesale from main's
  side. Untouched **by me** either way. See session 6 above for the per-file
  measurement.

**The whole-directory proof, which is stronger than any per-file argument:**

```
diff <(git ls-tree -r origin/main --format='%(objectname) %(path)' -- tests/mobile/goldens.spec.ts-snapshots/) \
     <(git ls-tree -r HEAD        --format='%(objectname) %(path)' -- tests/mobile/goldens.spec.ts-snapshots/)
# no output — every blob hash matches
```

Every golden snapshot on `HEAD` is **byte-identical to `origin/main`**. Not "the
codex ones are untouched" — *none* of them were re-baselined by this branch. The
brief's fear (a pre-l2-02 render overwriting ratified copy) cannot have happened,
and a reviewer can confirm it in one command without trusting the split above.

### The corollary worth stating: a0-05's codex copy edits did NOT move the codex goldens

`7bc2b1d` rewrote `sys-fog-radar`'s summary and body. It would have been
reasonable to expect the codex goldens to move — session 2's note flagged exactly
that risk. They did not: `openCodex()` lands on the codex's default view, and the
rewritten entry's body is not in that frame. So the codex failures in the brief
were **pure staleness**, cured by the merge alone. The brief reached the right
instruction ("don't re-baseline the codex") from the wrong reason, and the
measurement lands on the same action — which is why it was worth measuring rather
than obeying or overriding.

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
