# a0-47 — the thruster trail dies about a second after you start moving

Branch: `agent/gameplay/a0-47-thrust-from-intent` · Gameplay Engineer

## BUILT

- **`3622517` test(a0-47): the gate — a ship at top speed must still trail.**
  Committed RED on purpose, and verified red before the fix (§24):

  ```
  × WorldObserver — deriving the moments > still thrusting at top speed
    → frame 1 at top speed: expected false to be true
  ```

  `still thrusting at top speed` drives the **real sim** rather than a fixture:
  one Vanguard, full stick toward the arena centre for 4 s in a 4000² arena
  (no asteroids, no wall to reach), asserts the speed has plateaued at
  `shipTopSpeed` and the per-tick velocity delta is under 1 u/s² — i.e. the ship
  really is at the equilibrium where thrust and drag cancel — and only then
  demands `TELL.thrust` on two consecutive frames.

  Paired with the negative, `a coasting ship at top speed with zero intent emits
  nothing`, which **passes on main** (the old trail is always-off there): that is
  the point of the pair, since either alone is satisfied by a constant.
  Third case: a part-open throttle (0.5) must arrive as 0.5, and 0.01 as nothing.

- **`1ca2e56` fix(a0-47): the throttle is an input, so the sim publishes it.**
  - `src/sim/state.ts` — `Ship.thrust?: number`, 0..1. Optional on the same
    back-compatible terms as `lootTake`/`weaponCooldown`, so foreign `Ship`
    literals keep compiling; `makeShip` always sets it, `respawn` clears it.
  - `src/sim/step.ts` — written once per tick in the movement step, for every
    ship, from `len(intent.thrust)` — the same intent `integrate` is about to
    spend, so the tell and the velocity it bought cannot disagree. 0 while dead.
  - `src/art/vfx/observer.ts` — `ShipView.thrust`; `observeThrust` reads it and
    fires every frame above `THRUST_DEADZONE` (0.05); the acceleration
    arithmetic and the old reference-acceleration constant are **deleted**.
    `observeShips` no longer takes `dt` — nothing in it derived a rate any more.

- **`8094386` test(a0-47): pin the tell in the sim, where it is written.**
  `src/sim/step.test.ts` — the sim half of the gate. Full stick for 600 ticks,
  velocity plateaued at the class top speed with per-tick acceleration under
  1 u/s², `thrust` still 1. Then the three things a boolean would have got
  wrong: half a stick publishes 0.5, the keyboard diagonal is clamped to the
  unit disc first, and letting go publishes 0 on the next tick rather than
  decaying. Plus a dead ship whose pilot is still leaning on the key.

- **The "rocket" and the "trail" are one tell.** Checked for a second, separate
  engine-flare path in the renderer before assuming: there is none.
  `TELL.thrust` is documented as *"at: the engine bell (behind the hull)"*
  (`src/art/tells.ts`), so the exhaust plume and the trail are the same emitter
  and both halves of the developer's sentence are covered by this one fix.

## DECISIONS

- **Published, not inferred better.** The sim integrates thrust minus linear drag;
  at top speed those cancel *by definition*, so acceleration along the nose is 0
  at the one moment the engine is at full stretch. No gate value and no smarter
  filter fixes that — it is wrong by construction. `firing` is the precedent for
  an input the renderer needs and cannot recover, one field along on the same view.

- **The constant is gone, not deprecated** (DoD asserts it, LESSONS §14). It is
  not even named in a comment in `observer.ts`, because the DoD greps the file.
  The "why" lives in the commit message, the PR body and here.

- **`thrust` is optional, not required.** Rejected making it required: it would
  break `Ship` literals in files I do not own, and the repo's ratified discipline
  for exactly this class of per-tick tell (`lootTake`, `lootBlocked`,
  `weaponCooldown`) is optional-with-an-absent-reading. Absent reads as **no
  throttle** — never as a fallback guess, which is the thing the brief forbids.

- **Not hashed.** `harness/hash.ts` is not mine, and `thrust` does not belong on
  the fingerprint on its own merits: it is a pure restatement of the tick's input
  that the sim never reads back, so it cannot perturb determinism (GDD §4.8), and
  a replay that thrusted differently already diverges in `vel` on the same tick,
  which *is* hashed. Same footing as the loot tells. (`firing` is hashed, but it
  is a *derived* fact — whether a shot actually loosed — not the raw input.)

- **No emitter change.** `thrusterTrail` already scales particle count, speed,
  lifetime, size and alpha off its `throttle` argument, and `field.ts` already
  passes the tell's magnitude straight in. Carrying the true 0..1 through is the
  whole of "density and length follow the throttle" — the file needed no edit,
  and it is Art's.

- **Audit of the other tells (brief item 4).** `observeThrust` was the only tell
  in `observer.ts` inferring a *continuous input* from a derivative. Written into
  the method's doc comment so it stays checked:
  - `repairTick` reads `station.repairing` — the held flag itself, pulsed on its
    own clock. Correct shape, and the model the thrust tell now follows.
  - `spawnPulse` reads `spawnProtect > 0` — a level, not a rate.
  - Everything else diffs a quantity for a **discrete** event (`oreCollect`,
    `holdFull`, `upgradeBought`, `rockCrack`, `coreHit`, `shieldHit`) or an
    entity/flag appearing or leaving (`shipSpawn`, `shipExplode`, `rockBurst`,
    `turretDown`, `shieldDown`, `buildPlaced`, `buildComplete`, `stationDeath`,
    `shotImpact`, `waveArrive`, `collapseBegin`, `matchEnd`). No equilibrium can
    cancel any of those diffs.
  - `bankOre` is the closest look-alike and is **not** the same bug: the deposit
    drain raises `banked` monotonically for as long as it runs, so the difference
    stays positive throughout the hold, not just at its start.
  - `turretFire` reads a cooldown *rising* from ~0 — the sawtooth edge only
    happens on a shot, so there is no steady state to hide in.

## FINDINGS TO REPORT (not fixed here — out of my ownership / out of scope)

1. **Online remote ships lose the trail** until the netcode carries the throttle.
   `src/net/snapshot.ts` has a `SHIP_FLAG` byte with `firing` and four spare bits
   and no thrust field. The client runs the real `step()` under prediction, so
   the **local** ship trails correctly online; a **remote** ship's `thrust` is
   only ever what the prediction replay put there (it coasts on no input), so it
   reads 0. Today those ships get a spin-up flicker from the velocity delta, so
   this is a small regression on the online path only, in exchange for the local
   ship being right at all times. The fix is one quantized byte or a few flag
   bits — `src/net/` is the Netcode Engineer's. Flagged, not touched.
2. **The audio engine note rides the same tell.** `TELL.thrust` is the only entry
   in `SUSTAINED_TELLS` (`src/art/audio/bank.ts`), so the engine loop was cutting
   out at top speed with the trail. It now sustains for the whole burn — which is
   correct, and also means the mix hears a continuous engine where it previously
   heard a one-second blip. If that now reads as too loud or too constant, that
   is a mix finding for Art & Audio, not a tuning knob to turn here.
3. **The trail may now read as too heavy** — it runs continuously for the first
   time. Per the brief that is a real finding to report, not to tune: colour,
   particle count and lifetime are Art's, in `./emitters`.

## NEXT

- Nothing outstanding. `npx tsc --noEmit` clean; `npm test -- --run` green
  (full suite); PR open on `agent/gameplay/a0-47-thrust-from-intent`.
- If QA wants the fingerprint to carry `thrust`, that is a one-line change in
  `harness/hash.ts` by its owner — see the DECISIONS note on why it is off it.
