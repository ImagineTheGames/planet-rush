# `docs/briefs/` — the progression chain (pr-01 … pr-08)

Emitted by **a0-13** from `docs/progression-plan.md` §5 and §7. Each file is one claimable
lane: what to build, the test to write **first**, the traps that bite a skimmer, a Definition
of Done, and an evidence line.

The plan is the contract; a brief is the plan's §5 task with everything a lane needs to start
without reading all 1,400 lines. **Where a brief and the plan disagree, the plan wins** — say so
in the PR and fix the brief.

```
pr-01 ─┬─────────────► pr-05 ──┬──► pr-08
       └──► pr-06              │
pr-02 ─┬──► pr-04 ─────────────┘
pr-03 ─┘
pr-07 (a0-01) ────────► feeds pr-05
```

| Brief | Owner | Needs | What it is |
|---|---|---|---|
| [pr-01](pr-01-profile-store.md) | Platform + UI | — | The versioned, migratable local profile |
| [pr-02](pr-02-attribution-hook.md) | Gameplay | — | `by: PlayerId` on the damage path; the write-only credit ledger |
| [pr-03](pr-03-level-curve.md) | UI | — | `xpToNext` / `levelForXp`, pure |
| [pr-04](pr-04-accrual-and-xp.md) | UI | pr-02, pr-03 | The observer, the weight table, the tier multiplier |
| [pr-05](pr-05-summary-sequence.md) | UI | pr-01, pr-04 | The summary as a choreographed sequence |
| [pr-06](pr-06-lobby-level-badge.md) | UI + Platform | pr-01 | The badge, lobby-only; the storage seam |
| [pr-07](pr-07-summary-cues.md) | Sound | a0-01 | Four new slots, voiced to the amended §4.7 |
| [pr-08](pr-08-rebaseline.md) | QA | pr-04, pr-05 | Re-measure the pay and the curve for real |

**pr-01, pr-02 and pr-03 have no dependencies and can be claimed in parallel today.**
pr-02 is the long pole — it is the only `src/sim/` change in the chain.

**Five questions are open** (`docs/progression-plan.md`, *QUESTIONS FOR THE DEVELOPER*). None of
them blocks pr-01, pr-02 or pr-03. Questions **A** and **B** change numbers inside pr-04, and
question **C** changes one display rule inside pr-05; each brief names the question it is
exposed to and the default it ships under if nobody answers.
