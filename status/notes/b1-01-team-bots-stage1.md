# b1-01 — team bots, Stage 1: a bot's model of WINNING

Branch: `agent/bots/b1-team-bots-stage1` · Plan: `docs/team-bots-plan.md` §5 (Stage 1)

## BUILT

All seven Stage 1 tasks. Four commits, in the plan's needs order.

- **`9113f14` — Tasks 1.1 + 1.2, the plumbing.**
  - `BotSeat.team?: number` (`src/bots/bot.ts`); `fillEmptySlots(humans, slots, roster, teams?)`
    takes a per-slot side table; `botLobby` carries it through with a conditional spread
    (`src/bots/harness.ts`). FFA produces specs with **no `team` key**, so `createWorld`
    applies teams-of-one — Trap 1 and Trap 10 both closed.
  - `SelfView.team` and `BotView.allies: readonly AllyView[]` (`src/bots/perception.ts`) —
    ascending by id, self excluded, one frozen shared empty array in FFA (no per-view
    allocation). `AllyView = {id, stationPos, stationAlive}`.
  - Tests: `harness.test.ts` "a seat carries a side (TEAMS)" ×4; `perception.test.ts`
    "my own side" ×5.
- **`35ac18d` — Tasks 1.3 + 1.4 + 1.7's behaviour half.** New `src/bots/team-winning.test.ts`
  (12 cases): the collapse board where the ally home is the nearest standing home and the
  nearest enemy home is on the opposite bearing; every character at both hunting tiers
  thrusts at the enemy; the same board under an FFA roster as the live-fixture control; the
  eight-seed 2v2 anti-stalemate soak under two cast rotations; and the unstaged
  eliminated-teammate case. **Also a real fix:** `thinkOnce` now checks elimination *before*
  the reaction-cadence gate.
- **`9d031b8` — Tasks 1.5 + 1.6, the guards.** `fog-honesty.test.ts` runs every case over a
  4v4 as well as FFA, scrambles an off-screen ship's `alive`, and asserts the lie landed on
  an actual ally. New `src/bots/ffa-parity.test.ts` pins three golden world hashes measured
  on `main` at 5d66213.
- **`ff13b44` — Task 1.7's doc half.** GDD §1 loss condition amended (dated marker, old
  wording recorded); §2.7 gains one clause saying the rule holds in Teams.

DoD: `npx tsc --noEmit` clean; `npm test -- --run` green (3692 → 3728 tests).

## DECISIONS

- **Task 1.3's *change* was already shipped by p16-01 — the code wins.** The plan says
  "ally filter in `targeting.ts:478-485` and `:502-520`", but `nearestLivingRival` and
  `leaderStation` on `main` already open with `if (!isFoe(station) || !station.alive)`
  (`targeting.ts:547-595`), and `docs/bot-teams-allegiance-p16.md` §4 lists both by name.
  The plan predates p16-01's merge. **Rejected:** adding a second ally filter — that is
  Trap 9 (two answers to one question, drifting apart). 1.3 ships as the *guarantee* the
  plan asked for and nothing else. Same for 1.4, which the plan already calls "the proof".
  Net: Stage 1's behavioural delta over `main` is the elimination-cadence fix; everything
  else is plumbing Stage 2 needs, plus the tests that make the model non-regressable.
- **`AllyView` carries no ship `alive` flag**, though the plan's §3 sketch listed one.
  Nothing in Stage 1 needs it, and a teammate dying off-screen is drawn on nobody's screen —
  it would be a genuine fog leak, dressed as plumbing. The three fields it does carry are
  each public at any range (beacon ring, station position, wreck smoke). An ally close
  enough to see is already in `view.ships` with its hull bar. **Verified, not asserted:**
  adding a `shipAlive` field to `AllyView` fails the new teams fog guard and only that one.
- **`allies` is filled even for a dead bot.** It is lobby + map-wide public state, not a
  sighting; `perceive`'s `looking` gate exists for sightings.
- **`thinkOnce` checks elimination before the cadence gate.** Writing 1.7's test measured 4
  ticks per match in which an eliminated bot re-emitted its held thrust/fire stream — against
  `harness.ts`'s own stated contract ("eliminated bots emit nothing at all"). The sim skips
  a dead ship's intent (`step.ts:250,263`), so no world state moves: FFA hashes identical at
  three seeds before and after. In scope because Task 1.7 *is* the eliminated-player question.
- **Task 1.6 pins literals, not a two-run comparison**, because two runs of one build drift
  together and stay green. Goldens: seed 20260806 → `6d78b590`, 7 → `f358341a`,
  991 → `210f7504`, at 180 sim-seconds, eight bots, default roster. **If these fail, revert —
  do not re-baseline.**
- **Did not touch** `src/platform/match-boot.ts` (it stamps teams onto the roster after bot
  seating and still works; rewiring it to `BotSeat.team` is not Stage 1's and not my file),
  `bestTarget`/`homeIntruder` (p16-01's, Trap 9), or anything in `src/sim/`.

## OBSERVATION FOR QA (not a Stage 1 defect)

In a 2v2 of the shipped cast the winner is **cast-driven**: with the roster unrotated
(rusty, bolt vs foreman, patch) side 1 wins 8/8 seeds; rotated by two (foreman, patch vs
sable, vulture) it splits 3/5. That is a character-balance property, not a side asymmetry —
`team-winning.test.ts` asserts both sides can win across rotations rather than pinning a
winner. Worth a real sweep when Stage 2 lands (plan §6 wants a team-mode sweep whose unit is
the team, not the seat).

## NEXT

- Stage 1 is complete; PR open on `agent/bots/b1-team-bots-stage1`.
- **Not started, deliberately:** Stage 2 (ally alarm + radio + `defend-ally`), Stage 3
  (field division), Stage 4 (focus fire, roles). Each is separately shippable by design.
- Stage 2's first task (2.1) adds `underAttack` to `AllyView` — the one range-free addition
  the plan licenses, and only because the shipped human klaxon is already team-scoped and
  range-free. The doc comment on `AllyView` already says so, and says not to bring the HP
  along with it (Trap 8).
</content>
