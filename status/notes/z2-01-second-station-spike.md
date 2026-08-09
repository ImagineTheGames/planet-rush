# z2-01 — SPIKE: a second mining station at half health

Branch: `agent/gameplay/z2-second-station-spike` · Deliverable: `docs/design/second-station-spike.md`

**This is a SPIKE and it sits at the BOTTOM of the backlog.** Both instructions are
from the developer's own sentence and both are binding. The brief is named `z2-01`
so the supervisor's alphabetical pick order keeps it last — **do not rename it**,
and do not let it jump the queue. If a future session of mine picks this up
looking for something to build: there is nothing to build here. The deliverable is
a decision.

## BUILT

`docs/design/second-station-spike.md` — one document, no code.

Answers every question the brief asks: ownership and cost; what "half health"
means and which of (separate stat / multiplier / variant) is cheapest; what the
two rings do and who gets the ore when they overlap; destruction and defeat;
the netcode singular-assumption sweep with paths and line numbers; map fairness;
a verdict with a size and a risk; three questions for the developer.

DoD: `git ls-files` on the doc ✓ · `npx tsc --noEmit` clean ✓ · `npm test -- --run`
green ✓ — all three green for the boring reason that **nothing in `src/` was
touched**.

## DECISIONS

- **No prototype code, and I rejected writing any.** The brief allows a flagged-off
  prototype "only if you genuinely could not answer a question by reading." Every
  question was answerable by reading. The one I would have prototyped — does a
  second station's collection ring actually bank ore? — is settled definitively by
  four lines (`stationOf`, `src/sim/buildings.ts:68`): it returns the *first*
  station with that owner, so the second one's atmosphere is dead. A running build
  would have shown me that; the function proves it.

- **Verdict: BUILD IT WITH CHANGES — as an OUTPOST, not a second home.** And the
  doc says plainly that the *literal* reading is a DON'T. Three findings drive it,
  and they are the load-bearing part of the whole document:
  1. `eliminate` (`src/sim/match.ts:136`) fires on **any** core reaching zero for
     that owner. A 50-HP second station is ~10 s of fire at `WEAPON_DPS_CORE = 5`,
     so the feature as specified is a *cheaper way to be eliminated* — it inverts
     the loss condition.
  2. `spawnHomeFields` (`src/sim/waves.ts:250`) stamps a home ore field around
     **every non-derelict station**, and divides the 160-ore home budget by the
     station count. A second station both hands its owner two fields and shrinks
     everyone else's. `tests/sim/resource-fairness.test.ts` asserts EXACT equality,
     so this is a hard break, not a tolerance one.
  3. GDD §4.3 sizes the frame budget on "32 turrets (4 × 8 facilities)". A second
     turret ring doubles it and moves a named constraint.
  The outpost framing (two rings, no home field, no turret ring, not a life)
  removes all three, and it is the same shape as the ratified radar satellite (f1),
  which is the precedent to copy.

- **Rejected: "half" as a multiplier.** Every consumer already reads
  `station.maxCoreHp` — the damage ring, the HUD bar, collapse decay,
  `behaviors.ts:114`'s clamp, the scouted-health wire. Writing 50 into that field
  at construction costs zero changes anywhere else; a read-time multiplier has to
  be threaded into all five, and the first site that forgets shows 100% at 50 HP.
  Recommended the `DEPOSIT_RANGE` precedent — a named `Tunable` seeded from
  `CORE_HP / 2`, so "half" is legible at the definition but QA can still move one
  without the other from M2.

- **Rejected: free cursor placement.** It needs a position on `BuildOrderAction`,
  i.e. a change to the ratified six-verb action union (`src/shared/types.ts`) plus
  an input-parity row on all three devices (GDD §2.4). Recommended "deploys at your
  ship's current position" instead — the sim already knows where the ship is, so it
  needs **no contract change at all**, and `clampAnchorOutside`
  (`src/sim/anchors.ts:62`) + `clampToMargin` give the placement geometry for free.
  The only ratified-contract change I do recommend is one word: `'outpost'` on
  `BuildItem`.

- **Rejected: cost as the anti-carpeting gate.** Per-player ore rises as N falls
  (GDD §2.1), so any absolute price that bites at N=8 (~50 ore a share) is 6% of a
  share at N=2 (~200). The **cap** does the work; the price only sets opportunity
  cost. Opening hypothesis 12 ore, `TUNABLE`.

- **The good news I did not expect.** The sim's combat half is already plural-safe
  — `projectiles.ts:276`, `step.ts:787`/`:894` (auto-aim ladder),
  `buildings.ts:509` (`updateStations`), `sensing.ts:99` (`sensorSources` already
  unions **all** own stations) and `match.ts:296` (`resolveWinner` counts distinct
  surviving *teams*, and its own comment says a team with two homes is one
  surviving team). It is the **identity** half that is singular, not the combat
  half. That is what makes 8 briefs plausible instead of 20.

- **The sweep found ~40 non-test sites across 6 lanes.** Three of them are the
  expensive ones: `entity-events.ts:296/:336/:363` key turret/shield/satellite
  events by `data.owner` rather than a station id, which is a **wire-format
  change**, not a refactor. Two are design problems rather than plumbing: the
  alarm's single home arrow (`src/ui/alarm.ts:322`) and the HUD's deliberate
  one-bar rule (`src/ui/station-hp.ts` module doc).

- **Biggest risk named as the alarm, not the call sites.** GDD §2.2 calls the
  under-attack alarm a mechanic, not polish — the triangle decision works because
  one home means one arrow means one answer. Two homes makes every outpost alarm a
  decision the player is meant to *ignore*, and hands an attacker a free way to
  pull them off the field. Countable plumbing is not the thing that would make this
  feel bad.

## NEXT

Nothing on this branch. The spike is complete and the backlog continues without it.

Waiting on the developer (§10 of the doc, for the board's feedback queue —
**production does not wait on these**):

1. **What is defeat with two stations?** Recommended: your *primary* at zero ends
   your match; the outpost is a structure you can lose. Everything else keys off
   this answer.
2. **Home, or forward depot?** Recommended: depot. A full second home roughly
   doubles the cost (14+ briefs vs 7–9) and is the version that breaks fairness and
   the frame budget.
3. **What did you want it to *do*?** If the answer is "more ore" — the field is
   finite by design (400 a match, conserved exactly, GDD §2.3/§2.7), so a second
   station cannot mine more, only shorten the trip.

Not blocking: whether a destroyed outpost can be rebuilt. Leaning yes (the turret
ring's re-arm precedent), but it is a balance dial QA owns from M2.

If and when this is greenlit, the sim-lane work is 2–3 briefs and should start with
splitting `stationOf` into `stationsOf(world, owner)` and `primaryOf(world, owner)`
— every one of `main.ts`'s 18 call sites wants the *primary*, so most of the sweep
becomes a rename once that split exists.
