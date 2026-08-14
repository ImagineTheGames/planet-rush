# a0-42 — in TEAMS, the fog lifts where your teammates are

Branch: `agent/gameplay/a0-42-team-shared-fog`. Working note for THIS brief,
across retries and resumes. Not evidence — "done" is the DoD, the PR and QA.

The developer, 2026-08-13: *"when playing on a team the fog of war should lift
where your team mates are it should be like as if you were there...."*

## BUILT

- (session 1) branch cut from `origin/main` @ `6f92b74`.
- **`50c82a8`** — `src/sim/sensing.ts`: `teamMembers`, `teamSensorSources`,
  `teamRememberedStationMask`, `teamRememberedOreIds`; `sensedState` reads the
  union (ships/satellites/projectiles/stations gate on `sameSide`, not `=== viewer`).
  `src/sim/team-sensing.test.ts`, 21 tests, incl. the FFA-identity oracle.
- **`29efc1f`** — `src/main.ts` `feedMinimapFog` takes all three team reads;
  installs `window.__teamFogStage` (?debug=1) for the evidence.
- **`12b5aae`** — GDD §2.2 Teams clause, GDD §2.1 "what a side buys you" list,
  `docs/design-amendments.md` entry.
- **`9014509`** — the three `*frozen-teams*` goldens re-shot.
- **`cc7cb93`** — `evidence/a0-42-team-shared-fog/` (4 frames + FFA control +
  `capture.mjs` + `pixel-diff.mjs` + README).
- **`26e48e2`** — stage fix: it must pin the ally by id (see DECISIONS).

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
- **A derelict is not a teammate, and `sensedState` says so explicitly.** Its
  `owner`/`team` is a board index `>= N`, so `sameSide` already reads it as a
  foe; the `!station.derelict &&` guard on the "own side" short-circuit makes
  that independent of how team numbers are ever assigned, at zero cost.
- **The teams goldens moved by less than the tolerance, and were re-shot
  anyway.** Through Playwright's comparator `desktop-frozen-teams` sat at
  10142/10240 px — 99% of the antialiasing budget — against 7363 for the
  *unchanged* FFA `desktop-frozen` on the same box. Left alone it would have gone
  red on a loaded runner for no new reason. The brief expected the re-baseline;
  what it did not expect is that the goldens PASS either way, so the FFA-did-not-
  move claim had to be made another way (below).
- **FFA proved by a same-box two-build capture, not by a passing golden.** A
  build of `origin/main` and a build of the branch, the same frozen scenes, the
  same container: **0 differing bytes** in both FFA frames. That is a stronger
  statement than "the golden passed", and it is what `evidence/…/pixel-diff.mjs`
  is for. (That script's exact-byte compare is only valid same-box; against a
  committed baseline it reports ~91% because Playwright applies a per-channel
  threshold first. Do not quote it cross-box.)
- **The evidence capture has to toggle the minimap.** Under `?freeze=1` the sim
  tick never advances and the minimap content is a cached texture rebuilt every
  `MINIMAP_REDRAW_TICKS` ticks **or on a state change** — so re-staging a scene
  moved every number and not one pixel. Pressing `M` twice forces the rebuild.
  Cost the first capture attempt: four byte-identical PNGs.
- **The stage must pin the staged ally by id.** `share(false)` moves that ship
  off your side, so re-resolving "my ally" afterwards picks a *different* ship —
  the first run flipped one teammate out and flipped another one in. Fixed in
  `26e48e2`; `state()` now reports which ally and which side it is on so a
  capture asserts the scene instead of assuming it.
- **Rejected: widening `sensorSources` itself.** Per the brief, and it earns its
  keep — the per-player function is what `updateSensory` needs (the write stays
  per-player) and what the identity test compares against.
- **Rejected: touching `src/bots/`.** The radio-latency vs instant-minimap
  asymmetry is real and named in the PR body; it is the Bot Engineer's file.

## NEXT

- PR open, DoD green. Nothing outstanding on this brief.
- Watch for: the Director's follow-up brief on the bot symmetry gap (GDD §2.9
  "symmetry, not blindness" — `docs/team-bots-plan.md` §2.2's unimplemented
  `sighting` callout). Not ours.
