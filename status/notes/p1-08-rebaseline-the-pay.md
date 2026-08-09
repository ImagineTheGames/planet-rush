# p1-08-rebaseline-the-pay.md — working notes (qa)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

- **Branch `agent/qa/p1-08-rebaseline-the-pay`, cut from `6a644e4` (main).** The
  branch did NOT exist on origin — this is a fresh lane, and p1-01..p1-07 are all
  merged to main already (`src/progression/{profile,curve,accrual,xp}.ts`,
  `src/ui/summary-sequence.ts`, `src/sim/combat-credit.ts` all shipped).
- **`9264ba2` — `harness/pay.ts` + `cli.ts pay` + `tests/harness/p1-08-pay.test.ts`
  (21 tests, ~8 s).** The re-measurement rig: real shipped bot cast, the SHIPPED
  observer (`src/progression/accrual.ts`) and the SHIPPED pricer
  (`src/progression/xp.ts`), swept across map × N × abundance × lobby, under the
  same three ceilings `harness/match.ts` carries.

## DECISIONS

- **The rig lives in `harness/`, not `spikes/`.** a0-13's measurement was a spike
  (excluded from `tsconfig.include`, so `tsc --noEmit` never saw it) with its own
  copy of the weights and its own shadow attributor. This one is QA-owned, type
  checked, and imports the shipped modules — so when the Bot Engineer moves a
  tree or a weight is re-tuned, the rig moves with it instead of going stale. The
  raw output still lands in `spikes/progression/measured-p1-08.txt`, beside
  `measured-a0-13.txt`, so the next lane can diff two runs.
- **It does NOT reuse `runMatch`.** `harness/match.ts` seats probe strategies,
  and a probe has no difficulty tier — which is exactly what the XP multiplier
  reads (plan §1.3b). Rejected extending `SlotSpec` with an optional
  `personality`: `SlotResult.strategy` is required and feeds `balance.ts`'s
  sweeps, so making it optional would ripple through the win-rate reports for no
  gain here. `harness/match.ts` is untouched.
- **THE TRAP, and it is the report's headline: a0-13 measured the wrong
  abundance.** `createWorld` defaults to `standard` for backward compatibility;
  the lobby ships `DEFAULT_ABUNDANCE = 'scarce'`. a0-13's spike called
  `createWorld({seed, players})` with no abundance, so **every number in plan
  §1.3a–§1.4 is a STANDARD number and the game ships SCARCE.** The rig names the
  abundance in every cell and runs both; `tests/harness/p1-08-pay.test.ts` pins
  the trap so nobody re-falls into it.
- **A hung match is a failed MEASUREMENT.** `payStats` counts only ended matches
  into the medians and reports the shortfall beside them — pooling a timed-out
  match's accrual would drag every median down silently. Both ceilings are tested
  to come back flagged rather than hang.
- **The tests pin the instrument, not the pay.** The pay is a property of the bot
  trees and moves whenever the Bot Engineer touches them (plan §1.3c(3)); a test
  that pinned it would be edited by every bot change, which is the report's own
  finding about who owns these numbers. The one exception is the level-2 hook,
  pinned at a floor, because that is the claim the whole curve is fitted to.

- **`7a9c495` — `docs/progression-balance-p1-08.md` + the 240-match evidence at
  `spikes/progression/measured-p1-08.txt`** (all 240 ended; two runs of the
  command diff to zero). Plus the floor-candidate pricer and the percentile
  columns that made the first-out finding visible.
- **`0e6c5d4`** — tests for the floor pricer, and the four corrections to the
  brief's own expectations.

### The findings, so a resume does not have to re-read the report

- The plan's arithmetic **survives**: 3 of 4 lobby spreads reproduce to the
  decimal, Hard's median is identical (321), the free half of the accrual table
  reproduces exactly, and the shadow attributor was only 1–6% low on damage.
- **The a0-13 spike re-run at today's HEAD is byte-identical to its committed
  capture** — so every delta is the instrument or the axis, never a moved sim.
  That is the control, and it is worth re-taking before believing any future
  delta.
- **KEEP all three constants** (`XP_CURVE_BASE` 300, `XP_CURVE_EXP` 1.6,
  `DAMAGE_HP_PER_UNIT` 25). 25 HP measurably does what it was picked for:
  damage 19% of pay against ship kills 19%.
- **The sentence that fails** is "a first match levels you even if it goes
  badly" — the first player out earns 68 XP, 4.4 matches to level 2. Fix belongs
  in the participation floor, not the curve; six candidates priced; a flat MATCH
  PLAYED ≈ 230–250 XP is the only one that reaches that player (a bigger
  placement rung *cannot*, by construction). Filed as new Question F.
- Pay is a property of the **cast**, not the board: Easy 296 vs Medium 509 beats
  every map/N/abundance effect combined.

## NEXT

1. Push `agent/qa/p1-08-rebaseline-the-pay`, open the PR. **Full suite green at
   `0e6c5d4`: 260 files / 4545 tests, 550 s** — including both load-flaky specs
   (`tests/net/capacity/capacity-regression.test.ts`,
   `tests/harness/perf.test.ts`), which passed on this run.
2. Re-check `git merge-base --is-ancestor origin/main HEAD` immediately before
   claiming the DoD — `origin/main` moves under long-lived branches (it was at
   `6a644e4` when this was written).
3. Nothing else outstanding. If a reviewer asks for the plan itself to be
   amended (§1.3a's tables want an "abundance: standard" label, and §1.4's
   parenthetical wants restating as a median claim), that is the Architect's
   file — raise it, do not edit it.
