# b1-01 — team bots, Stage 1: a bot's model of WINNING

Branch: `agent/bots/b1-team-bots-stage1` · Plan: `docs/team-bots-plan.md` §5 (Stage 1)

## BUILT

_(in progress — see NEXT)_

## DECISIONS

- **Task 1.3's *change* was already shipped by p16-01.** The plan says "ally filter in
  `targeting.ts:478-485` and `:502-520`", but `nearestLivingRival` and `leaderStation`
  on `main` already open with `if (!isFoe(station) || !station.alive) continue`
  (`src/bots/targeting.ts:547-595`), and `docs/bot-teams-allegiance-p16.md` §4 lists both
  by name. The plan was written before p16-01 merged. **The code wins**: 1.3 ships as the
  *test* the plan asked for and no second ally filter is added — a second answer in a
  second shape is exactly Trap 9.
- **`AllyView` carries no ship `alive` flag**, though the plan's §3 sketch listed one.
  Nothing in Stage 1 needs it and a teammate dying off-screen is not drawn on anyone's
  screen, so it would be the first real fog-honesty regression in the layer (Trap 8's
  shape). The roster carries `{id, stationPos, stationAlive}` — all three public at any
  range — and an ally close enough to see is already in `view.ships` with everything else.
- **`allies` is filled even for a dead bot.** It is lobby + map-wide public state, not a
  sighting; the `looking` gate exists for sightings.
- FFA returns one frozen shared empty array from `allyRoster`, so a teams-of-one match
  allocates nothing per view (GDD §4.3) and `allies.length === 0` is the structural FFA
  degradation, not a mode flag.

## NEXT

- 1.4 proof, 1.5 fog test, 1.6 FFA hash parity, 1.7 GDD amendment + 2v2 endgame test.
</content>
</invoke>
