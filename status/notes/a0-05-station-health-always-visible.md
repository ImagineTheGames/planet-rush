# a0-05 — station health is always visible

Branch: `agent/gameplay/a0-05-station-health-always-visible` (cut from `origin/main` @ 4960540)

The developer, 2026-08-07, verbatim:

> "you can see other stations healths only when you are near, it should always
> show the health regardless of proximity or else it looks like a glitch
> approaching and getting far it looks like its full health even if its damaged"

## BUILT

- **`src/sim/sensing.ts`** — `stationHealthVisible(viewer, station)`, always true.
  The one place the rule lives; render, bots and the server all ask it.
- **`src/sim/constants.ts`** — `SENSOR_RANGE` **deleted** (was `2 * SHIELD.radius`
  = 180). Retirement note left in its place; note on `SATELLITE` recording that
  the amendment costs the satellite nothing.
- **`src/sim/station-health-visibility.test.ts`** — new. Range sweep (0 → arena
  diagonal, including the exact old cut), wrecks, every viewer × every station,
  and "a damaged station never reads like a healthy one".
- **`src/render/index.ts`** — `withinSensorRange` deleted; the ring is drawn for
  every station drawn. **Outside my ownership** — see DECISIONS.
- **`src/render/stations.test.ts`** — the "scouted, not broadcast" block
  re-pointed: wounded rival visible from across the map; near and far produce an
  identical instruction count; a healthy home at the same distance draws strictly
  less (so the two states are no longer the same picture).
- **`src/bots/perception.ts`** — `Perception.sensorRange` retired; the station-HP
  gate is now `visualRange` ("is it on my screen"), the same gate turret counts
  already used. `PerceivedStation.scouted` keeps its name, new meaning documented.
- **`src/bots/fog-honesty.test.ts`** — scrambler re-pointed from `SENSOR_RANGE` to
  `visualRange`. Not deleted (DoD requires the diff, and the invariant is
  symmetry, not blindness).
- **`src/bots/perception.test.ts`** — re-pointed + a new case reading a wounded
  home from 700 units (four times the old gate).
- **`server/static-events.ts`** — `FogTracker` no longer withholds; it asks the
  sim predicate. Constructor lost its `sensorRange` param.
- **`tests/server/fog.test.ts`**, **`tests/server/satellite-events.test.ts`** —
  re-pointed to the new rule; fog.test.ts keeps guarding that the payload carries
  no cargo/bank/tiers, and that a quiet station still sends nothing.
- **`GDD.md`** — §2.2 paragraph replaced in place *(amended 2026-08-07)*; §2.8
  sensor-range row struck and the three minimap radii listed so they cannot be
  confused with it; §2.9 fog-honesty sentence re-stated as symmetry; §5.4 and
  §5.7 lines corrected.
- **`docs/design-amendments.md`** — full entry with the verbatim quote, the
  measurements, the satellite finding, and what deliberately did not change.

## DECISIONS

**Bots read station HP at `visualRange`, not at infinity.** The brief says bots
must stay symmetric. A human cannot read the ring of a home that is not on their
screen — the camera is translate-only and the minimap draws no numbers — so an
unlimited bot read would be a cheat in the other direction, and `HUMAN_VISUAL_RANGE`
exists precisely to make that impossible. Rejected: leaving the bot gate at 180
(handicaps every bot, moves the difficulty ladder) and removing the gate entirely
(over-informs them).

**Files edited outside `src/sim/`.** The rule was enforced in three places, none
of them mine: `src/render/index.ts` (the ring gate), `src/bots/perception.ts` (the
bot gate), `server/static-events.ts` (the wire gate). Fixing only the sim would
have produced a PR that changes nothing a player can see. Each edit is minimal and
routes through the sim predicate so the rule has one home. Flagged in the PR body
for the owning agents. The brief explicitly authorised `src/bots/fog-honesty.test.ts`.

**`SENSOR_RANGE` deleted rather than zeroed.** A `0` still reads as a live knob;
restoring `180` would silently reinstate a withdrawn design. LESSONS §14.

**Radar satellite: measured, not redesigned.** It never fed the damage-ring gate
(that was measured from the viewer's ship). Its `sensorRange` feeds minimap
presence and ore memory, which are untouched. Stated as fact in the PR body; the
pricing question is the developer's.

**Readability at distance needed no work, and that is a measurement, not a
shrug.** The ring is stroked in world units at fixed width and there is no zoom
anywhere in the render layer, so the far ring is pixel-identical to the near one.
Asserted by instruction count in `src/render/stations.test.ts`.

## NEXT

- Full `npm test -- --run` sweep — several bot tests pin distances against the old
  180-unit gate and need re-pointing (`src/bots/hard.test.ts` uses 700 units as
  "out of range"; `src/bots/teams-hostility.test.ts` places a home at 600 units to
  be "unscouted"). Both cases stay valid, at bigger distances.
- Doc-comment sweep for stale "scouted" prose in `src/ui/`, `src/art/`,
  `src/bots/targeting.ts`, `harness/strategies.ts`.
- Four evidence frames (damaged near/far, healthy near/far).
- PR.
