# p16-01 — bots attacked their own teammates in TEAMS

**Branch:** `agent/bots/p16-bots-shoot-allies` · **Owner:** Bot Engineer · **Date:** 2026-08-05

> "team B bots was attacking each other" — developer field report, 2026-08-05

---

## 1. What was wrong

`src/sim/allegiance.ts` is, by its own header, *"the ONE friend/foe predicate"*. It
was built for Teams so that "is that a foe?" could never be answered two different
ways: seven inlined `id === owner` checks across `projectiles`, `buildings` and
`step` became `areEnemies`, and FFA vs TEAMS became a difference in the `team`
table rather than a difference in any code path.

**`src/bots/` never imported it.** Not `targeting.ts`, not `perception.ts`, not any
of it. The functions were *named* for the right idea — `nearestEnemy`,
`homeIntruder`, "Score an enemy ship", "Score an enemy home", the hostile-corridor
scoring, `nearestThreat`, the blockade read — and not one of them asked whose side
the candidate was on. "Nearest enemy ship" meant "nearest other ship", which in
TEAMS is very often an ally.

## 2. Why every gate missed it

The dark-matter class in its purest form. The allegiance module merged green, the
sim was wired to it, the bots were not, and **no test could see the gap — because
FFA is teams-of-one.** With every slot on its own team, `teamOf(a) !== teamOf(b)`
reduces to `a !== b`, so "nearest other ship" and "nearest enemy" are literally the
same set. `src/sim/ffa-hostility.test.ts` therefore passed, and always would. The
defect is invisible until two slots share a `team`.

That is the durable lesson here, and it is why the new test is written the way it
is: **a guarantee that reduces to a tautology in the default mode is not tested by
the default mode.** Anything routed through `areEnemies` needs at least one fixture
where two slots share a side, or it is untested no matter how green the board is.

## 3. The repro — an unstaged TEAMS match

Not a staged setup: the offline boot's own roster path (`fillEmptySlots` →
`botLobby` → `createWorld`), eight bots, the full roster cast, slots 0–3 on side 0
and 4–7 on side 1 — the same table `src/platform/match-boot` stamps for a TEAMS
lobby. Nothing placed by hand. Instrumented at the three functions the three trees
actually pick targets with (`nearestEnemy` for Easy's potshot, `mediumTarget` for
Medium, `bestTarget` for Hard's attack) plus `homeIntruder`, read on each bot's own
view immediately after its own decision.

Two minutes of sim time, seed 9021 (`git show 9e86645` for the probe itself):

```
=== 17390 of 18830 target picks named an ALLY (1440 named a real foe)
=== 13459 allied picks had the trigger down
=== allied picks per bot: 0:1154 1:1042 2:1982 3:2642 4:2264 5:4198 6:4077 7:31
=== 33266 ship-ticks spent under ALLIED fire only, 0 hull lost in them
--- first eight decisions that fired on an ally, any bot:
t=10.33s bot 1 (team 0) behavior=potshot        potshot→slot 0 (team 0) ALLY firing=true
t=10.60s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.60s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
t=10.65s bot 4 (team 1) behavior=attack         attack→slot 5 (team 1) ALLY firing=true
t=10.65s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.65s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
t=10.70s bot 4 (team 1) behavior=attack         attack→slot 5 (team 1) ALLY firing=true
t=10.70s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
--- slot 5, twelve consecutive target picks from its first shot at an ally:
t=10.60s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.60s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
t=10.65s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.65s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
t=10.70s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.70s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
t=10.75s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.75s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
t=10.80s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.80s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
t=10.85s bot 5 (team 1) behavior=defend         intruder→slot 4 (team 1) ALLY firing=true
t=10.85s bot 5 (team 1) behavior=defend         attack→slot 4 (team 1) ALLY firing=true
```

Two details in that sequence are worth reading twice.

**First contact is at t=10.3s**, and that is spawn protection lifting (10s,
`SPAWN_PROTECTION_S`), not the bots waking up: `isEngageable` reads the protection
glow, so nothing is a candidate before then. The moment it clears, they turn on
each other.

**Slot 5 is answering its own alarm.** `behavior=defend`, `intruder→slot 4` — its
teammate flying home to dock read as an intruder in its home ring, and it held the
trigger down on it for as long as the teammate was there. That is the developer's
"team B bots was attacking each other" in one line.

### The damage behaviour, confirmed

`FRIENDLY_FIRE` is off (ratified 2026-07-26) and projectiles route through
`canDamage`, so **allied shots deal no damage at all**. Measured in the same run:
33 266 ship-ticks in which the only guns that could bear on a ship were its own
team's — no enemy ship inside `WEAPON_RANGE`, no enemy station inside turret reach
— and **0 hull lost across all of them**.

**That makes the defect worse, not milder.** The bots still acquired, chased and
fired: 13 459 decisions with the trigger down on a teammate, and nothing to show
for a single one. They burned their turns achieving literally nothing while looking
broken to the player. A bug that did damage would at least have been visible in the
HP bars.

## 4. The fix

One stamp, taken once, from the one predicate. `perceive` asks
`areEnemies(world, self, other)` per entity, and every `PerceivedShip` /
`PerceivedStation` carries `hostile`. Nothing downstream re-derives it — the bots
layer owns **no** second notion of hostility and must never grow one. `isFoe` reads
the stamp; `isTargetable` is `isFoe` plus the pre-existing engageable test.

| file | routed |
| --- | --- |
| `perception.ts` | the stamp itself, both entity kinds |
| `targeting.ts` | `homeIntruder`, `nearestEnemy`, `pathClearance`, `scoreShip`, `scoreStation`, `bestTarget`, `nearestLivingRival`, `leaderStation` |
| `behaviors.ts` | `nearestThreat` (so the flee band and the cornered read both inherit it), `blockaderInView` |

Three consequences beyond "stops shooting teammates":

- **A teammate flying home is not an intruder.** The `defend` branch is the one the
  repro caught in the act.
- **"Gangs up on the current leader" no longer means "besiege your own side."** The
  leader read prefers the *strongest-looking* home, and an unscouted core is assumed
  full — so a teammate's home, the one home a bot is rarely far enough away not to
  scout, was a routine winner of that comparison.
- **An ally on a mining run no longer spoils a field.** `pathClearance` divided a
  site's score by up to four for a "threat" that cannot shoot it. In TEAMS, where
  allies spawn adjacent and therefore mine the same fields, that was most fields —
  a pure economy loss nobody would have connected to allegiance.

**What is deliberately NOT changed: what a bot may know.** An ally's core and
shields still read through the same sensor-range gate an enemy's do. Sharing a side
is not a scouting report, and widening a teammate's knowledge is a design decision
(does TEAMS share intel?), not a bug fix. Flagged here for the Director rather than
decided in a repair branch.

**Self-immunity** is untouched and un-reimplemented: `areEnemies` short-circuits
`a === b`.

## 5. After

Same seed, same unstaged match, same instrument:

```
=== 0 of 9625 target picks named an ALLY (9625 named a real foe)
=== 0 allied picks had the trigger down
```

Allied picks 17 390 → **0**. Productive picks 1 440 → **9 625**, a 6.7× increase in
target selections that name something a bot can actually hurt: the turns it was
burning on teammates are now spent on the other team.

FFA is byte-identical by construction — teams-of-one makes every stamp `true`, so
`isFoe` filters nothing — and the whole suite agrees: `sim/ffa-hostility.test.ts`
and `sim/teams-identity.test.ts` both green, 3347 pre-existing tests unchanged.

## 6. The permanent gate — `src/bots/teams-hostility.test.ts`

Fourteen cases, built as **one geometry under three team tables** (`foe`, `ally`,
and `ffa` — a roster with no `team` field at all, the pre-teams shape the offline
client boots with). The board makes slot 1 the most tempting thing in the game:
nearest hull, most wounded, inside the alarm ring, with a scouted cracked core
beside it, and slot 2 — a real enemy — on the *opposite* bearing, so an aim vector
alone tells the two apart.

The matrix is all seven characters × all three trees. A sampled bot proves nothing
when the defect is in shared selection.

The anti-passivity clamp is deliberate and everywhere: every "never targets an
ally" assertion is paired with a "still targets the enemy" one *in the same
fixture*, all 21 character/tier pairs are flown through the real loop (decide →
`step` → decide) and must actually fire, and the unstaged match asserts **> 1440**
hostile picks — the pre-fix number — alongside its zero. A bot that stopped
shooting altogether fails every one of them.

## 7. GDD

§2.9 already promised the behaviour ("a bot never targets an ally, its shots pass
through allies, and its turrets ignore them") — the code simply did not keep it. So
the amendment is not a design change: it records *how* the promise is held (one
predicate, read not re-implemented) and the trap that let it silently rot for a
milestone, so the next agent to touch bot targeting knows FFA cannot prove it.
