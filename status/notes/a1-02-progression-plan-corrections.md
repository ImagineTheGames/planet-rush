# a1-02-progression-plan-corrections.md — working notes (architect)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

- **Branch `agent/architect/a1-02-progression-plan-corrections`, cut from `main`
  at `876695f`.** One file in scope: `docs/progression-plan.md` (the Architect's
  own file). p1-08's report `docs/progression-balance-p1-08.md` is QA's and is
  **not** edited — it is cited, section by section.
- **Correction 1 — the abundance label.** A boxed warning at the head of §1.3a
  (`createWorld` defaults `standard`, the lobby ships `DEFAULT_ABUNDANCE =
  'scarce'`, `measure-ratified-xp.ts:448` omitted it) carrying the measured cost
  per lobby, plus `standard` on every table caption in §1.2, §1.3, §1.3a, §1.3b,
  §1.3c, §1.3d and §1.4. Where p1-08 measured the `scarce` counterpart it is now
  printed beside the standard one (§1.3a's second accrual block).
- **Correction 2 — the level-2 claim.** Restated as a claim about the MEDIAN
  player in all six places it appeared: DECISION 5, §1.4's headline sentence,
  §1.4's re-proof, §Q6, Trap 13, and the GDD §2.12 draft. New §1.4 subsection
  prices the seats (winner 1123 / median 445 / p25 255 / first out 68 / worst
  38) and hands the fix to **Question F** — a new question at the foot, with
  p1-08's three priced options and the two traps in them (the placement-rung
  dial cannot reach the first player out; a flat +200 collides with
  `XP_FOR_WIN`). **No constant is touched.**
- **Folded in from p1-08** — new **§1.3e**: the pay is a property of the CAST
  (1.7×) not the board (map ±5%, N 1.3×, abundance ±11%), and the economy is
  flat across N=3..8 (404–529) because ore/head +126% and combat −82% cancel.
- **Two more published figures corrected** (same class, same source): the farm
  gap in §1.3c(3)/Question E (17-vs-4 XP/min → 36.6-vs-20.9, gap 4.3× → 1.8×;
  the old numbers were the combat-rows-only economy) and the four-only
  replacement curve base in §1.4/§1.3c/Trap 13 (`base = 75` → **150**).
- **Two new traps** (18 abundance, 19 the median-player claim); **Trap 10 half
  retired** (structures measure 2–4/player and 9–12% of pay, so they are not a
  floor; repairs really are ~0–1). §7's brief chain records that pr-01..pr-08
  have landed and PR-8 is marked DONE.

## DECISIONS

- **Kept p1-08's report untouched.** It is QA's file and its status line says
  "report, not a contract". The plan is where a reader looks for the economy, so
  the corrections belong in the plan and the report stays the evidence they cite.
- **Went slightly past the two named corrections, deliberately.** The brief names
  two; p1-08 §9 also measured the farm gap and the four-only `base` replacement
  wrong in this document. Both are published figures an implementer would type,
  both are corrections rather than decisions, and leaving a known-wrong number in
  the same file I was correcting would have been the same failure twice. Named in
  the PR body so the extra scope is visible, not smuggled.
- **Did NOT change a constant, a weight or a ratification.** The participation
  floor is Question F, priced and recommended ("accept it for now; say the word
  and QA applies ≈230–250"), because it is a row in the developer's own table.
  Same reason QA declined to apply it.
- **Rejected re-typing a0-13's tables to p1-08's numbers.** Two instruments (a
  shadow attributor vs the shipped ledger) measured the same cell; re-typing one
  into the other would hide that, exactly as the document's own 2026-08-07
  housekeeping note argues. The deltas are stated beside the originals instead.
- **Rejected a heading inside the §1.3a warning box** — a `###` inside a
  blockquote would land in the document's heading structure. Bold instead.

## NEXT

- `npx tsc --noEmit` green. `npm test -- --run` running; then commit, push, PR.
- Nothing is blocked. The only open item this lane creates is **Question F**, and
  it is the developer's.
