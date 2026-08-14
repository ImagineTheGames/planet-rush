# a0-42 — in TEAMS, the fog lifts where your teammates are

Branch: `agent/gameplay/a0-42-team-shared-fog`. Working note for THIS brief,
across retries and resumes. Not evidence — "done" is the DoD, the PR and QA.

The developer, 2026-08-13: *"when playing on a team the fog of war should lift
where your team mates are it should be like as if you were there...."*

## BUILT

- (session 1) branch cut from `origin/main` @ `6f92b74`.

## DECISIONS

- Read-side union only. `updateSensory` keeps writing per-player, so
  `world.sensory` stays "who actually saw it" and the determinism hash does not
  move.
- New `team*` functions rather than widening `sensorSources` /
  `rememberedStationMask` / `rememberedOreIds`: the per-player ones stay the
  honest answer to "what does THIS player project/remember", they are pinned by
  `sensing.test.ts` + `radar-fog.test.ts`, and the FFA-identity test is then a
  one-liner comparison against them.
- Allegiance through `sameSide` only. No `team` number read anywhere, no mode
  check — FFA is teams-of-one by construction, so the union collapses to self.

## NEXT

- everything.
