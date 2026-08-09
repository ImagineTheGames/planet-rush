# b2-03-join-the-assault.md — working notes (bots)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT
<!-- what is actually finished, with the commit that did it -->

- Branch `agent/bots/b2-03-join-the-assault` cut from `876695f` (clean main).
- Nothing committed yet — orientation pass done, design settled (below).

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

**The read of the substrate (confirmed against the code, not the brief).**
`ally.ts`'s latch really is domain-free: `allyResponseCommit(latch, now,
candidate, held, arrived, quiet, max, cooldown)` carries no ranges and no view.
So the assault side is a **second instance of `AllyResponse` on the `Brain`**,
not a new primitive. `Callout` already has `about` + `pos`; `intruderNear(ctx,
pos)` is already point-parameterised; `ownHomeThreatened(ctx)` is already
factored out of the trees' own `defend` test.

**The new callout kind is `push`, NOT `claim`.** The plan (§2.2) reserves
`claim` for a generic "intent tag + target key" record that Stage 3 needs for
`Brain.tabu` mining claims and Stage 4 needs for focus fire. Spending `claim`
here would either force the tag field in early or make Stage 3 rename it.
`push` — *"I am going in on that home, there"* — fits `Callout`'s existing flat
shape with **zero new fields**: `about` = the slot whose home is being hit,
`pos` = where. Legality: the sender's own committed intent plus a position it
perceived through `bestTarget`, so it is a fact about yourself and always legal.

**`push` is sent for STATION targets only.** "Go on offensive" is a raid on a
home, which is also the only offence worth converging on ("two beats one",
GDD §2.6). Broadcasting every potshot at a passing ship would be Stage 4's focus
fire, which the brief explicitly parks. Consequence: **Easy never sends one** —
its tree has no station attack at all, only `potshot` — and that is correct, an
Easy bot does not open sieges. Easy can still *join*.

**The termination condition — the first thing that does not transfer.**
`defend-ally` ends on "arrived and nothing to fight". An assault that arrives to
plenty to fight has *succeeded*, so `arrived` cannot mean arrival here. The slot
gets **`objectiveGone`**: the target's home is dead. That read is fog-honest —
`PerceivedStation.alive` is public at any range, "smoke carries" (GDD §2.2) —
and it is the assault's actual happy ending. Everything else leans on the
ceiling and the cooldown, exactly as the brief says.

**The two numbers are measured, not inherited from 45/30.** Instrument:
`evidence/b2-03-assault-window.ts`. It measures, in real seeded TEAMS matches at
HEAD, how long an assault on an enemy home actually lasts — episodes of the
station's own `underAttack` tell, merged across the alarm window, split by
whether the core died. The ceiling is picked from that distribution; the
cooldown from a trace-replay budget sweep (record the per-decision readings once
from a real match, replay the pure latch at each candidate pair — the
"re-weight the measured rows, don't edit the constants table between runs"
discipline).

**Ladder position: directly above `attack`, below `haul`.** Below own `defend`
and below `defend-ally` — defence of any home on my side outranks a raid, and
**my home outranks your raid**. Below `spend`/`haul` because flying into a fight
with a full hold hands half of it to whoever kills you (GDD §2.7); a0-10 needed
an explicit `wantsToHaul` gate because it sits *above* `haul`, and sitting below
it makes that gate structural instead. Above `attack` because joining is a
refinement of *which* fight to pick, not of whether to fight.

**Rejected: putting the rig in `harness/`.** `harness/` is QA-owned, its README
enumerates its pieces, and adding a bot-tuning rig means editing QA's index and
README. It goes in `evidence/` beside the a0-10 precedent instead. The known
cost (evidence/ is outside `tsconfig.json`'s `include`, so `tsc` never sees it
and it can rot) is bought back by putting the standing guard on the shipped
numbers in `src/bots/ally-assault.test.ts`, which IS typechecked and IS in CI.

## NEXT
<!-- what remains, in order, and anything blocking -->

1. Build `evidence/b2-03-assault-window.ts`; take the ceiling reading at HEAD.
2. `push` kind + `callPush` in `radio.ts` / `behaviors.ts`.
3. `Brain.allyAssault` + assault durations in `ally.ts`.
4. `wantsJoinAssault` / `joinAssault` in `behaviors.ts`; wire into all 3 trees.
5. `src/bots/ally-assault.test.ts` — truth table, latch, budget, FFA parity.
6. Cooldown sweep, then `evidence/b2-03-join-the-assault.{ts,json}`.
7. DoD: tsc, `npm test -- --run`, ancestor check, PR.

No blockers.
