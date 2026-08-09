# b4-01-focus-fire-and-roles.md — working notes (bots)

Branch: `agent/bots/b4-01-focus-fire-and-roles` · Plan: `docs/team-bots-plan.md`
Stage 4 (the **role split** half) · cut from `355ba09`.
Predecessors: `b1-01` (Stage 1), `a0-10` (Stage 2), `b2-03` (join-the-assault),
`b3-01` (Stage 3) — all merged.

## BUILT

<!-- what is actually finished, with the commit that did it -->

Nothing yet — design settled, implementation starting.

## DECISIONS

<!-- why you chose an approach, what you rejected, and the trap you hit -->

**Scope: the role split only. Focus fire is the other half of Stage 4 and is NOT
in this brief.** The brief's title, body, "why", and evidence are all the role
split; `b2-03`'s handover lists the two halves separately. Recorded in the PR so
Stage 4 is not marked done.

**The information problem, which is the whole design.** The plan says the
defender is *"nearest to the team's most-threatened home"*. **An ally's ship
position is not public** — `AllyView` deliberately carries no ship pos and no
`alive` (`perception.ts`, Stage 1's own doc comment), and `view.ships` holds an
ally only inside sensor range. So "nearest" by *ship* distance cannot be computed
identically on every bot, and a function two bots disagree about is the exact bug
this feature exists to prevent. What IS public, range-free and identical on every
member of the side: the roster ids, each home's **position**, its **alive**, and
its **`underAttack`** klaxon. The assignment is derived from those and nothing
else.

- **Rank by home-to-home distance**, ascending: the teammate whose *own* home is
  nearest the besieged one covers it. Static, public, and meaningful because
  `teamHomeSlots` seats teammates adjacent.
- **Ties break with `tiebreakKey`, keyed by the ALARM'S OWNER, not by
  `ctx.self.id`.** This is the one real adaptation of the ratified helper, and it
  is load-bearing: `tiebreakKey(observer, candidate)` is *observer-keyed* on
  purpose (p8, so no slot draws fire it did not earn), which means two teammates
  passing their own id would break the same tie **differently** — the disagreement
  this whole feature forbids. The alarm's owner is the same number on every bot of
  the side, so the key stays index-blind (no slot privileged) while becoming
  *agreed*. Trap 11 says to use `tiebreakKey`; it does not say to pass `self`.

**Per-alarm designation, NOT one side-wide role-holder — and this is the one
place I depart from the brief's literal sentence.** A single side-wide role
requires first picking *the* most-threatened home out of the set of burning ones,
so the answer depends on **which homes are burning at the instant you look**. Bots
think on different cadences (`thinkOnce`), so two teammates read that set one or
two ticks apart, and when it differs they pick different homes and both commit —
reintroducing two-defenders, latched for up to `ALLY_RESPONSE_MAX`. Designating
*per alarm* (`defenderFor(view, owner)` depends only on `owner` and the static
roster) has no such window: two bots that both see home X burning always agree
about X, whatever else is on fire. The invariant shipped is therefore **"at most
one ally answers any given alarm"**, which is the plan's stated risk verbatim
(*"two bots abandoning two economies to answer **one alarm**"*) and coincides with
the brief's sentence in the case the brief's evidence names (one besieged home).
With two homes burning it gives one defender each instead of leaving one home
unanswered, which is also the better game.

**Eligibility is public-only, and excludes three sets:**
1. the besieged owner itself — it defends its own home through `defend`, which
   strictly outranks; designating it would spend the role on a bot that was
   already going and guarantee **zero** teammates break off;
2. a slot whose own home is dead — §2.7 stands, so that slot is eliminated;
3. a slot whose own home is **itself under attack** — public via the klaxon, and
   it mirrors the selfish-first gate. Designating a bot that `ownHomeThreatened`
   structurally blocks would mean nobody answers. (Only the klaxon half is public;
   `homeIntruder` is not, so this is a proxy, not the full gate.)

**The gate is on the ALARM path only, never on an open-space `help`.** The role
split exists to stop N bots answering one *shared* signal — the klaxon is
range-free and every teammate gets it simultaneously and identically, which is
precisely what produces N simultaneous responders. A `help` call is heard by a
tier-and-luck-determined subset (`callMissChance`); gating it on a roster-derived
role would forbid the one bot that heard the scream from going while the
designated bot never heard it at all. `siege` calls ARE gated — they are about a
home, so they are the same signal arriving by the other layer, and leaving them
open would be a hole a klaxon flicker could walk through.

**No quiet-time defender ("the highest `homebody` if none is threatened").
Rejected, and it is an information argument, not a scope one.** `homebody` is a
private character weight; no teammate can read it. Assigning on it needs either a
view addition exposing ally personalities or a radio negotiation — and the plan's
own Trap 11 forbids the negotiation. Its companion clause, *"raises its own defend
weights and lowers its attack floor's appetite"*, then has no subject: the tree
already puts `defend-ally` above `join-assault`, so the holder's attack appetite
is suppressed structurally, with no weight to tune.

**2v2 and FFA are unchanged by construction.** In FFA `view.allies` is empty and
the branch never ran. In a 2v2 with one home burning the eligible set is a single
teammate, so it is always designated — identical to today. The role only bites at
three-or-more a side, which is where the plan's risk lives and where the brief's
evidence is (4v4).

## NEXT

<!-- what remains, in order, and anything blocking -->

1. `src/bots/roles.ts` — `defenderFor` / `holdsDefenderRole`, allocation-free.
2. `AllyDistress.atHome` + the gate in `nearestAllyDistress`.
3. `src/bots/defender-role.test.ts` — the truth table, the 4v4 count assertion,
   agreement across the whole side, FFA/2v2 no-ops.
4. `evidence/b4-01-defender-role.{ts,json}` — the A/B against the branch-absent
   baseline: simultaneous responders per alarm, and ore per side-minute.
5. DoD gates, push, PR.
</content>
</invoke>
