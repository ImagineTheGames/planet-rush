# Bot aim error, p5 — teaching the bots to miss

**Author:** Bot Engineer · **Scope:** `src/bots/` · **Status:** report, not a contract

Landed on `agent/bots/p5-aim-error` (GDD §2.9; v0.2.2 field report *"enemies' aim
is too accurate"*).

## The problem

The v0.2 projectile pivot gave bots an intercept solve (`sim/leadAim`) and
nothing on top of it. A projectile that is aimed *perfectly* at where a mover
*will be* cannot be dodged — and dodging is the entire reason combat became a
projectile. Every bot, at every difficulty, was a frame-perfect aimbot. The
developer, a competent player, found even the intended-hardest bots oppressive.

## The model

Two named, per-difficulty tunables, both in `DifficultyTuning`
(`src/bots/personalities.ts`), both drawn from the **sim's seeded RNG** so a
match still replays identically:

1. **`aimJitter` — spread.** An angular error added to every aim bearing, redrawn
   each decision. The bot now *fires along the jittered line* it committed to
   (`steering.ts` `canHitDir`, used by `aimAndFire`), not along the clean
   bearing — so a wider spread is a wider miss, not merely a slower trigger.
2. **`aimLatency` — reaction latency.** The lag before a bot re-solves its lead
   on a target that changed course (`steering.ts` `trackAimVelocity`). The bot
   re-samples the target's velocity only this often; between samples it keeps
   leading with the stale one. A target that juked inside the window is led
   *where it was going* — the shot goes wide. This is the knob that rewards
   dodging: reverse faster than a tier's latency and you shake its shots.

`reactionInterval` (how often a bot re-aims at all) already existed; latency sits
on top of it as the specific lag on the *predictive lead*.

| Tier | `reactionInterval` | `aimJitter` (spread) | `aimLatency` (lead-lag) |
|---|---|---|---|
| Easy | 1/6 s | 0.32 rad | 0.60 s |
| Medium | 1/12 s | 0.13 rad | 0.32 s |
| Hard | 1/20 s | 0.05 rad | 0.20 s |

Hard was tuned **down** from v0.2.2's `aimJitter 0.02`, no latency.

Turrets are untouched — this is the ship-bot aim path only. Turret accuracy lives
in `src/sim` (`fireTurretProjectile`) and is QA/Gameplay's, deliberately.

## Measured — hit-rate vs a strafing probe

`tests/sim/aim-error.test.ts`. A lone bot gun of each tier fires at a probe held
at the ship engage range (`WEAPON_RANGE * 0.6` ≈ 156 u), driving the shipped
`aimAndFire` at the tier's cadence, counting shots and hits off real projectile
physics. The **juking** probe patrols a strafe band at full speed, reversing at
the edges (so it dodges *and* stays in range); pooled over four band widths so
the number is not a knife-edge on one juke rhythm. The **sitting** probe never
moves. The **aimbot** row is the old Hard: zero spread, zero latency.

| Tier | vs juking strafer | vs sitting duck |
|---|---|---|
| Easy | **16.2 %** | 54.4 % |
| Medium | **22.3 %** | 98.6 % |
| Hard | **34.2 %** | 98.7 % |
| _aimbot (old Hard)_ | _42.9 %_ | _98.7 %_ |

Reading the table against the field report's target bands:

- **Easy well under half** — 16 %. A strafing player evades five shots in six and
  feels clever, exactly as asked.
- **The ladder holds** — 16 % < 22 % < 34 %. Difficulty is visible competence and
  nothing else; all three tiers share one fog-honest perception path.
- **Hard strong but clearly under the aimbot** — 34 % vs the old 43 %, so a juking
  player now shakes ~two thirds of a Hard bot's shots (was impossible). Still a
  serious gun: sit still and it lands almost everything.
- **Dodging is a choice, not free** — every tier punishes a sitting duck (Medium
  and Hard essentially never miss one; even Easy lands over half). The drop to
  the juking column is the dodge working.

Note the aimbot itself only lands 43 % on a full-speed juker at knife-fight range:
the hull's turn rate can't quite track a reversing crosser even with a perfect
solve. That turn-rate/geometry floor is why the *within-Hard* headroom is small
(see personality note).

## Personality modulation (GDD §2.9 — "may modulate within the band")

`PersonalityWeights.aimScale` multiplies a character's spread and latency, clamped
to `[0.85, 1.4]` so it can never cross tiers. The clamp is asymmetric on purpose:
a Hard gun snaps back toward the aimbot once its lead-lag drops under ~0.16 s, so
the tight-end floor is held close to 1.

Only **Bolt** uses it — `1.25`, the wild-rusher end of Easy:

| | vs juking | vs sitting |
|---|---|---|
| Easy (neutral) | 16.2 % | 54.4 % |
| **Bolt** (×1.25) | ~12 % | ~43 % |

Bolt sprays measurably wider than a neutral Easy bot, on both probes, and still
never reaches Medium's competence.

The tight end is left **unused**, and that is a measured finding rather than an
oversight: the harness shows a Hard gun is already at its turn-rate/geometry floor
on a juker (34 % vs the aimbot's 43 %), and its 0.05-rad spread never misses a
target inside weapon range — so tightening a Hard character (e.g. Sable, who reads
as the cast's marksman) changes nothing a player could feel or a test could
measure. Sable is left neutral rather than shipping a knob that does nothing; its
raider threat is *timing* (`opportunism 0.9`), not an aim the model can't give it.

## Round-robin — did the meta hold?

Aim error shifts the meta (less accurate ships kill each other less, so more is
decided by the economy and by turrets fighting alongside a defender), so this was
re-measured, not assumed. 24 all-bot 8-planet matches, one per seed, shipped
constants:

| Character | Tier | Hull | Wins /24 |
|---|---|---|---|
| **Warden** | Hard | Excavator | **13 (54 %)** |
| Foreman | Medium | Excavator | 6 (25 %) |
| Rusty | Easy | Hauler | 2 (8 %) |
| Sable | Hard | Interceptor | 2 (8 %) |
| Bolt | Easy | Interceptor | 1 (4 %) |
| Patch | Medium | Hauler | 0 |
| Vulture | Hard | Vanguard | 0 |

- **Win-rate ceiling: 54 %** — under the 55 % threshold (GDD §2.8, §3.8), but only
  just. Warden is still the strongest character.
- **Every match ends: 24/24, no timeouts.** The ruleset's "cannot stalemate"
  promise holds under the new, less-lethal ship combat.
- **Length: median 13.8 min, range 12.0–14.2 min** — inside the 10–15 min target
  (GDD §1).

The headline is that the aim-error model, on its own, pulled Warden down from the
near-total dominance the day-4 report flagged (19/20) to right at the ceiling: a
Hard Excavator fighting next to its own turrets no longer *also* out-aims
everything it meets. It is still the residual within-Hard balance question day 4
raised (`docs/bot-balance-day4.md`) — 54 % is a pass with no margin — and it stays
QA's to close from M2 (the knobs there are `SHIP_STATS[excavator]` and Warden's
`homebody`/`defend` weights, both outside this brief). This change did not create
that item; it shrank it.


## Files

- `src/bots/personalities.ts` — the two tunables + the tier table; `aimScale`.
- `src/bots/steering.ts` — `trackAimVelocity` (latency), `canHitDir` (fire along
  the jittered line), `aimAndFire` (the one place a bot's shot is composed).
- `src/bots/behaviors.ts` — `combatSpread` / `combatLatency` (tier × character);
  `engage` threads the target id so the lead has an aim track to go stale on.
- `src/bots/tree.ts` — the per-bot `AimTrack` on the `Brain`.
- `tests/sim/aim-error.test.ts` — the measurement above, pinned as bands.
