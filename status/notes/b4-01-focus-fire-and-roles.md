# b4-01-focus-fire-and-roles.md — working notes (bots)

Branch: `agent/bots/b4-01-focus-fire-and-roles` · Plan: `docs/team-bots-plan.md`
Stage 4 (the **role split** half) · cut from `355ba09`.
Predecessors: `b1-01` (Stage 1), `a0-10` (Stage 2), `b2-03` (join-the-assault),
`b3-01` (Stage 3) — all merged.

## BUILT

<!-- what is actually finished, with the commit that did it -->

Three commits.

- **`e1fc097` feat** — `src/bots/roles.ts`: `defenderFor(view, owner)` /
  `holdsDefenderRole`, `NO_DEFENDER`. `AllyDistress.atHome` and
  `assignedToAnswer` in `behaviors.ts`, with the gate in `nearestAllyDistress`.
  Exported from `index.ts`. No other file touched.
- **`afe9760` test** — `src/bots/defender-role.test.ts`, 20 cases.
- **`e697357` evidence** — `evidence/b4-01-defender-role.ts` + six JSONs (two
  disjoint 8-seed sets, their 16-seed pool, both arms, plus one rejected
  variant).

Gates at `e697357`: `npx tsc --noEmit` clean; `npm test -- --run` green.

## THE MEASUREMENT

`evidence/b4-01-defender-role.ts`, the same file on both arms (`origin/main` =
branch absent, and HEAD), `octagon` / `scarce`, shipped cast, full matches.

**TEAMS 4v4, 16 seeds pooled:**

| | baseline | b4-01 |
|---|---|---|
| alarm-ticks with **2+ teammates flying** to it | 2.9% | **0.7%** |
| alarm-ticks with 2+ teammates *latched* to it | 5.7% | **2.5%** |
| responders per answered alarm | 1.217 | **1.100** |
| alarms actively answered | 20.0% | 14.9% |
| mean match length | 762.7 s | 762.4 s (16/16 ended) |
| ore per side | 131.2 | 127.8 |
| ore rate besieged : quiet | 0.461 | 0.446 |

**2v2, FFA 8 and FFA 4 are identical on every field, both arms.** Stronger than
plan §2.5 asks and it came free from the structure.

**The count property replicates; the plan's economic prediction does not.**
Split into the two disjoint 8-seed halves, the double-flight rate goes
2.4%→0.4% and 3.5%→1.1% — same direction, same size. `besiegedOverQuiet` goes
**+19% on the first half and −23% on the second**, pooling to −3%. So the
brief's second evidence ask — *"the side's mining output no longer collapsing
when one home is attacked"* — **is not supported**, and the half-set that agreed
with the plan is not quotable. Two effects cancel: fewer teammates break off
(more miner-seconds) but the alarm is answered less often (20.0% → 14.9%), so
sieges go worse. Running two disjoint sets rather than one set of sixteen is
what caught it — b3-01's discipline, and it earned its keep here.

**The residual, diagnosed rather than assumed.** 0.7% of alarm-ticks still have
two teammates flying, worst case 3. Over **329** such moments in the sweep, the
side's members disagreed about the defender **zero times** — every one was a bot
still executing a commitment it took while it *was* the defender. That is
`./ally`'s latch holding through the flicker, which is its job, not the
assignment failing. Now a standing CI assertion (`defender-role.test.ts`, "a
real 4v4 match never splits the side"), so the distinction cannot silently rot
into a real disagreement.

## DECISIONS

<!-- why you chose an approach, what you rejected, and the trap you hit -->

**Scope: the role split only. Focus fire is the other half of Stage 4 and is NOT
in this brief.** Title, body, "why" and evidence are all the role split;
`b2-03`'s handover lists the two halves separately. Stage 4 is **not** done.

**The information problem, which is the whole design.** The plan says the
defender is *"nearest to the team's most-threatened home"*. **An ally's ship
position is not public** — `AllyView` deliberately carries no ship pos and no
`alive`, and `view.ships` holds an ally only inside sensor range. So "nearest" by
*ship* distance cannot be computed identically on every bot, and a function two
bots disagree about is the exact bug this feature exists to prevent. What IS
public, range-free and identical on every member: roster ids, each home's
position, its `alive`, its `underAttack`. The assignment uses those and nothing
else. Rank by **home-to-home distance** (static, public, meaningful because
`teamHomeSlots` seats teammates adjacent).

**`tiebreakKey` is keyed by the ALARM'S OWNER, not by `self.id`** — the one real
adaptation, and load-bearing. The helper is *observer*-keyed on purpose (p8, so
no slot draws fire it did not earn), so two teammates passing their own id would
break the same tie **differently**. The alarm's owner is one number every member
reads identically, so the key stays index-blind while becoming *agreed*. Trap 11
says use `tiebreakKey`; it does not say hand it `self`. **Pinned by a negative
control that asserts the self-keyed version splits the side.**

**Per-alarm designation, NOT one side-wide role holder — a deliberate departure
from the brief's literal sentence.** A side-wide role must first pick *the*
most-threatened home from the set of burning ones, so the answer depends on which
homes are burning **at the instant you look**. Bots think on different cadences,
so two teammates read that set a tick apart, disagree, and both commit — latched
for up to `ALLY_RESPONSE_MAX`. Designating per alarm has no such window. The
invariant shipped is **"at most one ally answers any given alarm"**, which is the
plan's risk verbatim (*"…to answer **one alarm**"*) and coincides with the
brief's sentence in the case the brief's evidence names. With two homes burning
it sends one defender each rather than leaving one unanswered.

**Eligibility is public-only:** not the besieged owner (already going via its own
`defend`; designating it would leave *zero* teammates breaking off), not a dead
home (§2.7), not a slot whose own home is burning. **Measured: the third rule
changes nothing on these seeds** (`.variant-no-rule3.json` is identical). Kept as
insurance for a case the seeds do not hit, and recorded as *not* a measured
constant so nobody re-derives it as one.

**The gate is on the SHARED signal only.** A klaxon is range-free — every
teammate gets it simultaneously and identically, which is what produces N
simultaneous responders — so it is divisible. An open-space `help` is heard by
whichever subset the miss roll allowed; dividing it would forbid the one bot that
heard the scream from going while the designated bot never heard it. A `siege`
call, and any `help` about a teammate **whose klaxon is currently ringing**, ARE
divided. That last clause moved every measured figure by **exactly zero** and is
kept anyway, because the alternative gates on the *kind* of message rather than
on whether the signal is shared. Written into the code as a null result, not as
a claim.

**The gate is on the START of a run, never on one in flight.** `./ally`'s latch
already holds a response across the klaxon's 2 s flicker. Re-testing the role on
the held path would release commitments every time a teammate's klaxon blinked —
Trap 7, one level up. This is the source of the 0.7% residual and it is the right
trade.

**No quiet-time defender ("the highest `homebody` if none is threatened").
Rejected on information, not scope.** `homebody` is a private character weight;
no teammate can read it. Assigning on it needs a view addition exposing ally
personalities, or a radio negotiation — and the negotiation is Trap 11. Its
companion clause (*"raises its own defend weights and lowers its attack floor's
appetite"*) then has no subject: the tree already puts `defend-ally` above
`join-assault`, so the holder's attack appetite is suppressed structurally.

**Rejected: a second latch for the role.** The plan asks for "re-derived each
decision but latched". The latch it needs exists; a second memory of the same
decision is how two answers to one question drift.

**Unchanged and verified:** FFA pinned hashes, fog honesty, the radio reversal
guard, `ally-defence`/`ally-assault`/`field-division` suites, and the
selfish-first ladder (asserted at all three tiers).

## NEXT

<!-- what remains, in order, and anything blocking -->

Nothing outstanding in the role split. Push, PR, re-check the `origin/main`
ancestor gate immediately before claiming the DoD.

Handover:

- **Stage 4's focus fire is still not done.** `push` is a commitment on a home
  (b2-03); `claim` was spent on rocks (b3-01). Focus fire needs a score bonus on
  a *ship* target and a vocabulary slot decision.
- **For the Director / QA: the plan's §6 economic prediction for this stage did
  not survive the measurement.** The feature costs coverage (alarms actively
  answered 20.0% → 14.9%) to buy the count. If that trade reads badly in play,
  the cheapest re-tune lever is admitting a *second* responder once an alarm has
  been live for N seconds — deterministic and agreed, since alarm age is public,
  but it needs its own measurement and it was not in this brief.
- **`ASSAULT_JOIN_COOLDOWN`'s duty-cycle defect** handed back by b3-01 is still
  open; untouched here.
</content>
