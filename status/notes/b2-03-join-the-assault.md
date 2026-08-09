# b2-03-join-the-assault.md — working notes (bots)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT
<!-- what is actually finished, with the commit that did it -->

Branch `agent/bots/b2-03-join-the-assault`, cut from `876695f`.

- **`5b3507c` feat** — the branch. `CalloutKind` gains `push`; `callPush` sends
  from `attack`/`suppressTurrets` on station targets only; `Brain.allyAssault` is
  a second `AllyResponse`; `assaultJoinRange`, `allyAssaultOn`,
  `nearestAllyAssault`, `wantsJoinAssault`, `joinAssault` in `behaviors.ts`;
  `join-assault` wired into all three trees. Plus
  `evidence/b2-03-assault-window.ts` + JSON, the measurement rig.
- **`57638b9` test** — `src/bots/ally-assault.test.ts`, 26 cases. Its end-to-end
  economy A/B falsified two of my first-pass constants; both were re-measured and
  moved (see DECISIONS).
- **`<evidence commit>`** — `evidence/b2-03-join-the-assault.{ts,json}`, the two
  frames the brief asks for.

Gates at that HEAD: `npx tsc --noEmit` clean; `npx vitest --run` **266 files,
4613 tests, all passing** (both known load-flaky specs green on this run).

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

**The substrate read holds up.** `ally.ts`'s latch really is domain-free, so the
assault side is a second instance of `AllyResponse` folded by the same
`allyResponseCommit`, not a new mechanism. `Callout` carries it with zero new
fields.

**`push`, not `claim`.** The plan reserves `claim` ("intent tag + target key")
for Stage 3 mining sites and Stage 4 focus fire. Spending it here would force its
tag field in early or make Stage 3 rename it.

**`push` is sent for STATION targets only.** "Going on the offensive" is a raid
on a core, which is also the only offence worth converging on (GDD §2.6 "two
beats one" is about sieges). Announcing potshots would be Stage 4 focus fire,
which the brief parks. Easy therefore never *opens* a raid — its tree has no
station attack — but still joins. That is the right character read.

**Termination.** `arrived` carries **"the objective is gone"**
(`PerceivedStation.alive`, public at any range). Arrival deliberately does NOT
end it: a raid that arrives to plenty to fight has succeeded. Pinned by a test
that puts the bot on the objective with an enemy on it and asserts it is *still*
committed.

**Collapse does not switch it off**, where it switches `defend-ally` off. One
argument, not two: guarding an unrepairable core cannot win a damage race, but a
rival's core is the only thing that still scores (GDD §2.3).

**Ladder: below `defend`, `defend-ally`, `spend`, `haul`; above `attack`.** No
`wantsToHaul` gate, unlike a0-10 — sitting below `haul` makes it structural, and
a condition that can never fire is a worse guarantee than the tree order. Pinned
by a tree-level test instead.

### The measurements, and the two that came back and bit me

Rig: `evidence/b2-03-assault-window.ts`, 12 seeds × {2v2, 4v4}, `octagon`,
`scarce` (both named — `createWorld` defaults to `standard`).

- **A raid is a SHORT event.** 610 raids: p50 2.6 s, p90 7.7 s, longest ever
  25.8 s. Kill-ending ones: p50 10.0 s, p75 13.7 s. So **45 s would never once
  have bound** — the brief was right that it does not transfer. Ceiling **25**,
  sized as trip (~8.4 s) + a p75 winning raid.
- **Reach: measured 1200, shipped 1000.** The coverage curve said 1200 (88% of
  raid-seconds). The *cost* curve overruled it: 8 seeds × 3 casts against the
  same matches with the branch absent, 1200 cost the keenest cast a third of its
  ore. 1000 keeps 82–92% with the branch firing 8–11%. 600 buys the ore back by
  switching the feature off. `ALLY_RESPONSE_RANGE`'s own doc already says reach
  is a cost; I had to be shown it. Offensive reach now sits strictly tighter than
  defensive, which is the ladder as a number.
- **Cooldown: 25 → 45.** It is the duty-cycle dial and nothing else
  (`MAX/(MAX+CD)`): 36% against defence's 60%. Swept 25/45/60 the realistic cost
  is flat while the pathological case tightens 44%→38%, so the larger value is
  near-free on real play.

**Two errors in my own first-pass reasoning, both now written into the constants'
docs so the next re-tune does not repeat them:**

1. `ASSAULT_JOIN_QUIET`'s derivation. The silence inside a *continuous* raid is
   `callCooldown − readableLife`, which is **3 s at Easy and never at Medium or
   Hard** — not the 6 s I first claimed by confusing the gap between calls with
   the duration of silence. 8 still stands, now for the right reason (margin for
   a raider whose next slot goes on `help`).
2. The trace-replay budget estimate was labelled an **upper** bound and was a
   **lower** one. It proxied "is there a raid" with "is a home taking fire"
   (flickers on 2 s) instead of "is a `push` still readable" (persists 10 s at
   Hard), so it predicted ~1% of ticks against an actual 8–11%. The cooldown
   sweep it inspired was therefore looking at the wrong lever; **reach** priced
   this feature.

**Rejected: putting the rig in `harness/`.** QA-owned, its README enumerates its
pieces. It went in `evidence/` beside the a0-10 precedent. The rot risk (outside
`tsconfig.json`'s `include`) is bought back by the standing CI guard in
`src/bots/ally-assault.test.ts`, which re-runs the economy A/B on every push.

**Unchanged and verified:** FFA pinned hashes (`callOut` returns before any RNG
draw when the radio is null), fog honesty, determinism, the selfish-first ladder.

## NEXT
<!-- what remains, in order, and anything blocking -->

Nothing outstanding. Push, open the PR, re-check the `origin/main` ancestor gate
immediately before claiming the DoD — `main` moved twice inside one session on a
previous brief.

Handover notes for whoever picks this up:

- **Stage 4's role split is still not done** and was explicitly out of scope: "at
  most one ally holds the defender role" is a deterministic derived assignment
  over the roster (`tiebreakKey`), different machinery.
- **Stage 4's focus fire is still not done** either — `push` is a *commitment*
  on a home, not a score bonus on a ship. The `claim` vocabulary slot is still
  free for it.
- QA re-tuning any of the four `ASSAULT_JOIN_*`: measure **reach** first, and
  re-run `evidence/b2-03-assault-window.ts` rather than trusting its committed
  JSON, which is a reading at `5b3507c`.
