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

## NEXT

1. Full 12-seed run → `spikes/progression/measured-p1-08.txt` (~240 matches,
   ~10 min). Commit as evidence.
2. `docs/progression-balance-p1-08.md` — the report: re-measured accrual/XP
   tables beside §1.3a's with deltas, the re-fitted curve beside §1.4's, the
   recommendation on `XP_CURVE_BASE` / `XP_CURVE_EXP` / `DAMAGE_HP_PER_UNIT`,
   the match-length verdict with the summary sequence in the loop, and numbers
   for plan Questions A and E.
3. Fix the brief where the plan wins over it (a0-13 says the plan is the
   contract) — the brief's `docs/bot-balance-day4.md` shape and its DoD line
   `git ls-files docs/ | grep -q 'progression-balance'`.
4. Push, open PR, re-check `git merge-base --is-ancestor origin/main HEAD`
   (main moves under long-lived branches).
