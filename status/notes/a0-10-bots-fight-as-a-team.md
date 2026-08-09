# a0-10 — bots answer an ally's alarm (Stage 2)

Branch: `agent/bots/a0-10-defend-an-ally` · Plan: `docs/team-bots-plan.md` §5 (Stage 2)
Predecessor: `b1-01` (Stage 1, merged) · Successors: Stage 3, Stage 4 — **not started**

## BUILT

All eight Stage 2 tasks bar 2.8 (QA's). Three commits.

- **`fcf71a1` — the behaviour.**
  - **2.1** `AllyView.underAttack` (`src/bots/perception.ts`), range-free, computed
    exactly as `ownStationView` computes it. The doc comment carries the licence
    (the shipped human klaxon is team-scoped and map-wide) and the refusal (the HP
    does not come with it).
  - **2.2** `src/bots/radio.ts` — the channel. `help`/`siege` only. Time-ordered
    delivery, `readableAt = seenAt + latency`, reads sorted `(readableAt, from,
    seq)`, per-recipient miss roll from the **sender's** stream in ascending slot
    order, fixed-capacity ring, hearsay discount. **Imports nothing from `src/sim`.**
  - **2.4** `callLatency` / `callMissChance` / `callCooldown` on `DifficultyTuning`,
    at the plan's §2.3 numbers.
  - **2.5** `callSiege` from `defendHome`/`lastStandDefend`, `callHelp` from
    `retreat`. Cooldown-gated on `Brain.lastCallAt`.
  - **2.6** `wantsAllyDefence` / `defendAlly` (`src/bots/behaviors.ts`), and a
    `defend-ally` leaf in all three trees below own-`defend`, above `spend`.
  - **2.7** `src/bots/ally.ts` — the commitment latch, the ceiling and the cooldown.
    Released on death in `context()`.
  - Plumbing: `Brain.radio` / `Brain.allyResponse` / `Brain.lastCallAt`;
    `BotOptions.radio`; `createBots` opens one channel per side;
    `intruderNear(ctx, pos)` in `targeting.ts` with `homeIntruder` delegating to it.
- **`e3fd71a` — the tests.** `team-radio.test.ts` (19) and `ally-defence.test.ts` (25).
- **`<evidence>` — the two frames.** `evidence/a0-10-defend-an-ally.ts` + `.json`.

DoD: `npx tsc --noEmit` clean. `npm test -- --run` — **254 files, 4395 tests, 0 failed.**

## EVIDENCE (`evidence/a0-10-defend-an-ally.json`)

Same seed, same cast, same board, same tick. One number differs between the runs.

| | frame 1 — the answer | frame 2 — the ladder |
|---|---|---|
| slot 0's own home | quiet | **also under attack** |
| closest approach to the ally home | **190** (from 1150) | **1150** — it never moved toward it |
| `defend-ally` tick share | 19.9% | **0%** |
| what it did instead | attack 25.5 / haul 19.7 / mine 18.0 / defend 16.9 | defend 94.3 |

The trace closes monotonically — 1050 → 922 → 794 → 667 → 539 → 416 → 303 → 198 over
eight seconds — and in frame 2 the distance to the ally's home *grows* while the
distance to its own shrinks. Frame 2 is the one that matters: it is the proof the
ladder is still selfish-first.

## DECISIONS

- **The trigger is `alarm OR callout`, exactly as the plan writes it — and Layer A
  therefore dominates Layer B for the ally-home case.** Ally `underAttack` is
  range-free by licence, so a `siege` call about a home is largely redundant with it
  and the tier dials are *not* what gates answering a home siege. I did **not**
  "fix" this by routing the alarm through the radio: §2.2 says in terms that "Layer A
  already carries the own-station case for free", and inventing a notice-latency on a
  klaxon the human hears instantly would be exactly the parallel design LESSONS §8
  warns against. **Rejected**, and flagged to the Director instead. What the radio
  does carry that Layer A cannot is `help` — a teammate jumped in **open space**,
  where no home is burning and no klaxon rings. That path is fully tier-gated, and
  it is pinned by a test.
- **`ALLY_RESPONSE_RANGE` is the plan's 1200 and `homebody` is the multiplier
  `0.5 + homebody`.** So 1200 is the *midpoint of the dial*, not a cap: Bolt 720,
  Sable 840, Foreman/Vulture 1080, Warden 1260, Rusty 1560, Patch 1680, cast mean
  ~1175 — within 2% of the measured recommendation, so the character spread costs the
  team nothing on average. Same shape `errandRange` already uses for the same
  question. `ALLY_RESPONSE_RANGE_WIDE = 1800` is exported unused, as the plan's
  recorded second data point for QA's Task 2.8 re-tune.
- **A fourth cost bound the plan implies but does not name: `ALLY_RESPONSE_MAX`
  (45 s).** The plan's clear condition is "the alarm went quiet for N seconds OR I
  arrived and there is nothing to fight". Against a *sustained* attacker neither ever
  fires — the alarm never goes quiet and there is always something to fight — so the
  commitment would hold forever and the cooldown would never engage. The ceiling is
  what makes bound (iii) reachable, not a new idea.
- **The branch is off in collapse.** The plan does not say either way. All three
  trees switch their *own* `defend` off there and the reason given in `hard.ts` is
  general: nothing can be repaired, the endgame is a damage race, and a player who
  spends it guarding cannot win it. Shipping a rescue branch that fires in collapse
  would contradict that ratified reasoning in the same file. **Re-tunable in one
  line** if the Director disagrees.
- **`chatter` was NOT added.** §4.5 proposes it as the one new character dial, but
  Stage 2's task list does not ask for it and its job is modulating *claim* traffic
  (Stages 3–4). In the minimum vocabulary, a character that suppresses its own siege
  call is strictly worse with nothing gained. **Rejected** rather than shipped unused.
- **Own-home / fleeing / cornered gates HOLD the commitment; death and collapse
  RELEASE it.** A teammate may still be under siege when the emergency at this end
  passes, and the ceiling bounds how long a hold can last. A full hold blocks only
  the *start* of a run (the plan's `wantsToHaul` trap) — a run already under way is
  not abandoned over cargo.
- **A death drops the run and KEEPS the cooldown.** Clearing the budget on death
  would hand a bot that keeps dying at its teammate's doorstep an unlimited rescue
  allowance — the exact bot the budget exists to prevent.
- **`homeIntruder` was generalised, not duplicated.** `intruderNear(ctx, pos)` is the
  same predicate at the same radius with the same hostility read, and `homeIntruder`
  is now that function with the bot's own station passed in. Writing a second
  "is there something to fight here" is Trap 9.
- **The fog guard gained exactly one exemption, and it is one line.** `scrambleHidden`
  no longer lies about an **ally's** `sinceDamage`, because that is the klaxon and
  lying about it would assert a deafness no human has — the same argument the file's
  own a0-05 note makes about station health, in the same direction. An ally's
  `coreHp`, shields and barrels are still scrambled. A **stranger's** `sinceDamage`
  is still a lie at any range.
- **Two test fixtures moved, and neither assertion was relaxed.**
  `fog-honesty`'s guard-on-the-guard now picks its observer *by the property under
  test* (a slot with a teammate whose home it cannot see) instead of assuming slot 0
  qualifies — it stopped qualifying once bots fly to each other's homes.
  `team-winning`'s Task 1.7 fixture moved seed 1 → 3 because the sampling window
  collapsed below the length needed to observe a purchase; seed 3 gives ~33k ticks.
  Both are recorded in the files themselves, at length, because "the test went red so
  I changed the fixture" is the move those comments exist to distinguish themselves from.
- **`server/room.ts` was not touched** (not my file). It seats bots one at a time with
  no shared channel, so online team bots get **Layer A only** — `perceive` derives
  allies from the world, not from the seat, so the klaxon and the whole `defend-ally`
  branch work there; only `help` calls do not travel. Flagged as a seam for netcode.
  `src/platform/match-boot.ts` also untouched: it calls `createBots` with seats built
  by `fillEmptySlots(..., undefined, cast)` — no `teams` argument — so offline TEAMS
  currently gets Layer A only too. Wiring `config.teams` into that call is a
  one-argument change in a file I do not own.

## VERIFIED, NOT ASSERTED

- **The reversal guard can fail.** With `callLatency` forced to 0 at all three tiers,
  `team-radio.test.ts`'s reversed-array test goes red (`83da80e2` vs `ae84cfa2`).
  Restored immediately; the point was that the determinism floor is guarded by
  something that actually notices.
- **FFA is byte-identical.** `ffa-parity.test.ts`'s three pinned world hashes from
  `main@5d66213` are still green, and the reason is structural: `callOut` returns
  before touching `ctx.rng` when the radio is `null`, so an FFA bot draws no number
  it did not draw before. There is a test asserting exactly that (0 draws vs 1).
- **The economy holds.** A 2v2 with the ally's klaxon forced on for four minutes
  against the same match with it forced off: the responder still mines ~86% of the
  control's ore and spends under 40% of its ticks answering.

## NEXT

- Nothing outstanding in Stage 2 except **Task 2.8, which is QA's** — the standing
  2v2/4v4 sweep that sets `ALLY_RESPONSE_RANGE` from measurement rather than from
  §4.2's recommendation. 1800 is exported as `ALLY_RESPONSE_RANGE_WIDE` for it.
- **Not started, deliberately:** Stage 3 (field division) and Stage 4 (focus fire and
  role split). The PR body answers the Director's sequencing question — short version:
  a minimal *join-an-ally's-assault* branch is **symmetric with `defend-ally` and
  buildable on this substrate**; Stage 3 is about mining contention and its own text
  disclaims combat. Stage 4's **role split** is the half that is not symmetric.
- Two seams for other agents, both recorded above: `server/room.ts` and
  `src/platform/match-boot.ts` do not pass a `teams` table into the bot layer, so
  both currently run Layer A only.
