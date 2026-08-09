# pr-08 — re-baseline the XP economy against the real game

**Owner:** QA Agent · **needs: pr-04** (the economy), **pr-05** (the screen)
**Plan:** `docs/progression-plan.md` §1.2, §1.3a–d, §1.4
**DONE (p1-08, 2026-08-09):** `docs/progression-balance-p1-08.md`, evidence at
`spikes/progression/measured-p1-08.txt`, instrument at `harness/pay.ts` +
`tests/harness/p1-08-pay.test.ts`.

> **Corrections to this brief, from the measurement it asked for.** The plan is the contract
> and nothing below contradicts it; what is corrected here is this brief's own expectations.
>
> 1. **"A 3-player match should pay noticeably more" — FALSIFIED.** The ore half is right
>    (ore per head +126% from N=8 to N=3) and the pay half is backwards: XP *falls* 9%,
>    because at small N there is nobody to fight (damage −82%, ship kills −81%). The economy
>    is flat across lobby size — 404–529 XP over N=3..8 — so the curve is not broken at small
>    N. Report §5.
> 2. **The sample the plan's §1.3a was taken on was never stated in full, and one axis of it
>    was wrong.** `createWorld` defaults to `standard` abundance while the lobby ships
>    `scarce` (`DEFAULT_ABUNDANCE`), and a0-13's spike omitted the field — so every number in
>    plan §1.3a–§1.4 is a `standard` number. It turns out to cost ±7%, but it was not known
>    to. Report §2.
> 3. **"The fastest XP in the game is a MEDIUM bot lobby at 17 XP/min" — the ordering holds,
>    the number does not.** 17 was priced on combat rows only, an economy the plan does not
>    recommend; under the shipped eleven rows it is 36.6 XP/min, and the gap to the slowest
>    tier is 1.8× rather than 4.3×. Report §6.
> 4. **"Level 2 lands inside a single match" — true for the median seat, false for the player
>    the sentence was written about.** A new player knocked out first earns 68 XP and needs
>    4.4 matches. `XP_CURVE_BASE` is *not* wrong (the fix belongs in the participation floor,
>    priced in report §7); the plan's parenthetical is. Report §7, §9.
> 5. **The deliverable landed in `docs/`, per this brief's own DoD gate**
>    (`git ls-files docs/ | grep -q 'progression-balance'`), rather than in `tests/reports/`
>    where QA's balance reports otherwise live. The gate wins; the divergence is noted so the
>    next QA lane knows where to look.

---

## The ask

Every number in the plan's §1.3 came from **bots in a spike**. QA owns the constants table from
m2 onward (GDD §3.8), and this is that hand-off: re-measure the pay and the curve with the
shipped code, the shipped trees, and — where it can be got — real play, then file the result as a
balance report against §1.4's table.

Three things specifically need falsifying, because the plan's own recommendations rest on them:

1. **"A typical match pays ~399 XP."** Measured across four bot lobbies at N=8 on octagon, seeds
   1–12. Re-measure across **map, N and abundance** — per-player ore density rises ~4× as N falls
   (`homeFieldOre(n)`), so a 3-player match should pay noticeably more, and the plan has never
   checked whether that breaks the curve at small N.
2. **"Level 2 lands inside a single match (0.8)."** The hook the whole curve is fitted to. If a
   real first match — a new player, probably losing, probably on a phone — does not level them up,
   `XP_CURVE_BASE` is wrong and this is the report that says so.
3. **"The fastest XP in the game is a MEDIUM bot lobby at 17 XP/min."** The plan's own farm
   finding, and the one most likely to be stale: it is a property of the bot trees, so it moves
   whenever the Bot Engineer touches them. Re-measure it, and re-measure it after any bot change.

## Method notes, so the numbers are readable rather than trusted

- **The spike's build and repair numbers are a floor, not a typical** (§1.2). The QA probes
  under-build and never repair; the shipped trees do both (`docs/bot-repair-rebuild-p15.md`), and
  humans do more. Do not size those weights off a median of zero.
- **The spike attributed damage with a shadow reconstruction.** You do not have to: pr-02's
  ledger is the real thing. Where your numbers and
  `spikes/progression/measured-a0-13.txt` disagree, **the ledger is right** and the interesting
  question is by how much the reconstruction was off.
- **State the sample.** Seeds, maps, N, abundance, and the lobby composition — a hidden sample is
  a hidden result (`harness/balance.ts`'s discipline).
- **A hung match is a failed measurement**, not a hung harness (GDD §3.8).

## Deliverable

A balance report in `docs/` in the shape of `docs/bot-balance-day4.md`:

- the re-measured accrual and XP tables, beside §1.3a's, with the deltas called out;
- the re-fitted level curve — matches-to-level 2, 5, 10, 20 — beside §1.4's;
- **a recommendation on `XP_CURVE_BASE`, `XP_CURVE_EXP` and `DAMAGE_HP_PER_UNIT`**: keep, or
  change to these numbers, for this measured reason;
- whether the two match-length targets still hold (10–15 minutes) with the summary sequence in
  the loop — a five-second beat every match is not free at the fiftieth match, and if QA thinks
  the timeline is too long, that is a finding, not a complaint.

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "git ls-files docs/ | grep -q 'progression-balance'"
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

## Evidence line

The full harness output committed beside the report, as
`spikes/progression/measured-a0-13.txt` was — so the next lane can diff two runs rather than
trust two prose summaries.

## Open questions this brief is exposed to

**All five**, and it is the brief best placed to *answer* two of them with numbers rather than
argument: **Question A** (does dropping the participation rows really invert winner and
first-out in real play?) and **Question E** (is the bot farm actually the fastest route, once
humans are in the sample?).
