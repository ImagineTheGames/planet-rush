# Spike z2-01 — a second mining station at half health

**Status:** SPIKE — investigation only. Nothing in `src/` changed behaviour in this brief.
**Requested by the developer, 2026-08-06:**

> "i'd like to add an experimental feature to be able to also setup an additional
> mining station, it should have half the health of the original .. but lets add
> this as a spike task to investigate how we will implement it, it should go to
> the end of the backlog bottom"

**Author:** Gameplay Engineer · **Branch:** `agent/gameplay/z2-second-station-spike`

---

## 0. How this was answered — read, not built

**No prototype code was written, and none was needed.** Every question below was
answered by reading the shipped simulation and the lanes that consume it. That is
worth stating up front because the brief allows a flagged-off prototype and I did
not take it: the expensive half of this feature is not "does it work?", it is
"how many places assume a player has exactly one station?" — and that is a
grep, not an experiment.

Answered **by reading**: all of them — ownership, cost, the health constant, the
two rings, destruction/defeat, the netcode singular-assumption sweep, map
fairness.

Answered **by code**: none. The one thing I would have prototyped — whether a
second station's collection ring actually banks ore — turned out to be settled by
a four-line function (`stationOf`, §5.1), which answers it more definitively than
a running build would.

Numbers quoted below are the shipped constants at `4947169`, read out of
`src/sim/constants.ts` and `src/sim/maps.ts`.

---

## 1. The one-paragraph answer

The simulation's **combat** half is already plural-safe: damage, projectiles,
turrets, shields, satellites, sensing and the win condition all iterate
`world.stations` and key off `owner`/`team`, so two stations for one player would
be shot at, defended, and counted correctly with no change. The simulation's
**identity** half is not: one function — `stationOf(world, owner)` — encodes "a
player has exactly one home," and ~40 call sites across six lanes are built on it.
Worse, the two rules the developer's sentence collides with are not code at all:
**a core at zero eliminates its owner** (so a half-health second station is a
*cheaper way to kill you*, exactly inverting the intent), and **every non-derelict
station is stamped with a home ore field** (so a second station is a second ore
neighbourhood and the resource-fairness invariant fails). The verdict in §9 is
BUILD IT WITH CHANGES, and the changes are what turn a station into an *outpost*.

---

## 2. Ownership and cost

### 2.1 Who can place one

**Recommendation: one per PLAYER, cap 1, enforced like every other cap.**

Not per team, and not host-only:

- **Per team would carpet the map.** GDD §2.1 allows uneven sides — a 3v1 handicap
  is legal. A per-team allowance of one is worthless to the 3-player side and
  decisive for the solo player; a per-team allowance of N is four extra homes on
  one side of the board. Per-player is the only allocation that survives the
  variable-slot model.
- **Host-only is not a thing.** GDD §4.2 is explicit: *"'Host' is a lobby word,
  not a network role."* The player who created the room is a client like any
  other. There is no host authority in the sim to hang a permission off.
- **Any player, once.** This matches the shape of every other buildable: turret
  cap 4, shield cap 2, radar satellite cap 1 (`TURRET.capPerStation`,
  `SHIELD.capPerStation`, `SATELLITE.capPerStation` — `src/sim/constants.ts`).

### 2.2 What stops a team carpeting the map

Three gates, in order of how load-bearing they are:

1. **The cap, which is the real answer.** A hard per-player cap of 1, counted the
   way every other cap is counted — **including queued construction** (GDD §2.5:
   "queued construction counts against a cap, so a player cannot buy past one by
   ordering several on the same tick"). The shipped helpers to copy are
   `turretCount` / `shieldCount` / `satelliteCount` (`src/sim/buildings.ts:131`,
   `:138`, `:147`). A cap of 1 makes the worst case 8 extra bodies on an 8-player
   board, which is the same order as the derelicts the compass/diamond maps
   already place.
2. **A minimum separation.** From your own primary, and from every other station.
   Without it the cheapest play is to stack the outpost directly on your home, and
   its rings (§4) collapse into the primary's for free.
3. **Cost — which is the *weakest* gate, and this is worth saying plainly.**
   Per-player ore is not constant across match sizes: GDD §2.1 says *"per-player
   ore density rises as N falls."* Concretely, `FIELD_YIELD = 400` with
   `commonsShare = 0.6` gives 160 ore of home fields split across N and 240 in the
   commons. At N=8 a player's whole-match share is ~50 ore (20 home + ~30 of an
   evenly-contested commons). At N=2 it is ~200. **Any absolute price that bites
   at 8 players is pocket change at 2.** So the cap does the work; the cost only
   sets the opportunity cost.

### 2.3 The number, and where it comes from

**Opening hypothesis: 12 ore, `TUNABLE`, QA owns it from M2 (GDD §2.8).**

The derivation, against the shipped table:

| Thing | Cost | What it is |
|---|---|---|
| Repair reactor (one tap) | 1 | 15 HP back on your core |
| Turret Mk I | 3 | `TURRET.cost` |
| Shield generator | 5 | `SHIELD.cost` |
| Radar satellite | 6 | `SATELLITE.cost` |
| First DAMAGE upgrade tier | 4 | `[4, 8, 14]` |
| A full Mk III ring of four | 56 | 4 × (3+4+7) |
| **A player's whole share at N=8** | **~50** | 20 home + ~30 commons |

GDD §2.6 anchors the top of that scale: *"a fully-Mk III ring of four costs most
of a player's share of the field"* — 56 against ~50, which checks out. So the
scale is real and 12 sits at **~24% of an 8-player share**: dearer than any single
buildable, cheaper than the fortress ring, and roughly "a shield plus a satellite
plus a turret." A player who buys one has given up a quarter of their match to
it, which is the trade the feature should be asking for.

The honest caveat: at N=2 that 12 is 6% of a share, and there the cap is the only
thing holding the line.

---

## 3. Half health — what it actually means

### 3.1 What the original's health *is* today

**`CORE_HP = 100`** — `src/sim/constants.ts:44`, flagged `TUNABLE`, and it is GDD
§2.8's very first row: *"Core HP · Naked-core kill time = 100 ÷ 5 = ~20 s of
sustained fire · 100."* Half is **50**.

It reaches a station through `makeStation` (`src/sim/state.ts:785`), which sets
both `coreHp: CORE_HP` and `maxCoreHp: CORE_HP` at construction. Every consumer
downstream reads the **per-station `maxCoreHp` field**, never the constant:

- the damage-ring grammar and the HUD bar (`src/ui/station-hp.ts` —
  `coreFraction`);
- collapse decay (`src/sim/match.ts:266` — absolute HP/s against whatever the max
  was);
- a bot's own-home repair judgement (`src/bots/behaviors.ts:114`,
  `ctx.self.station?.maxCoreHp ?? CORE_HP`);
- the scouted health wire (`StationHealthData`, `src/net/entity-events.ts:113`).

### 3.2 Separate stat, multiplier, or station variant?

**Recommendation: a station VARIANT whose `maxCoreHp` is written once at
construction from its own named constant.** Not a multiplier.

The reasoning is entirely about §3.1's list. Because every consumer already reads
`station.maxCoreHp`, writing 50 into that field at construction costs **zero**
changes anywhere else — the damage ring, the HUD bar, the collapse decay, the
bot's clamp and the wire all just work, and "half" is true everywhere without any
of them being told about it. A **multiplier applied at read time** would have to
be threaded into every one of those five sites, and the first one that forgets
produces a station whose ring says 100% at 50 HP. A **separate stat** on top of
`maxCoreHp` is the same problem with an extra field.

So: cheapest to reason about later, by a wide margin, is the variant.

The constant itself should follow the `DEPOSIT_RANGE` precedent
(`src/sim/constants.ts:1453`, `STATION.radius * 4`) — a named `Tunable` **seeded
from the relationship**, so "half" is legible at the definition and independently
falsifiable afterward:

```ts
/** Core HP of a secondary outpost — half the primary's (developer, 2026-08-06).
 *  Seeded from CORE_HP so the halving is legible, but independently TUNABLE:
 *  QA owns the table from M2 and must be able to move one without the other. */
export const OUTPOST_CORE_HP: Tunable<number> = CORE_HP / 2;
```

**One consequence to state out loud:** at `WEAPON_DPS_CORE = 5`, a naked 50-HP
outpost is **~10 seconds of sustained fire**. GDD §2.8's whole siege balance is
built on the 20-second naked-core figure. A ten-second body is not a fortress that
happens to be weaker — it is a body a single Interceptor removes between waves.
Whatever it is worth, it must be worth ten seconds of one attacker's time.

---

## 4. What the rings do

`a4-01` settled the station on exactly two rings, and both are drawn only around
the **viewer's own living station** (`src/render/index.ts:577–620`,
`drawAtmosphere` — "both are affordances … so a rival's world gets neither"):

| Ring | Radius | Constant | What it means |
|---|---|---|---|
| Collection field (atmosphere) | **256** | `DEPOSIT_RANGE = STATION.radius * 4` (`constants.ts:1453`) | Hold drains into the bank; ore couriers fly ship→station |
| Build ring | **160** | `STATION.dockRange` (`constants.ts:504`) | BUILD lights; the wheel opens |

### 4.1 Do they overlap?

**On today's board, the primaries do not — but only just, and a second station
almost certainly would.**

The octagon (`src/sim/maps.ts:247`) puts stations on a ring of radius
`min(halfMin·2·0.32 + 96, marginRadius)` = **864** on the 2400-unit square arena.
At N=8 adjacent homes sit `2 · 864 · sin(π/8)` = **661** apart. Two collection
rings touch at `2 × 256 = 512`. So there is **149 units of clear space** between
adjacent atmospheres today — a real margin, but a thin one.

The space a second station could occupy without overlapping *anything* is
narrower still. Per spoke, the clear annulus runs from the commons outer edge
(`fieldRadius = 768 × 0.4` = **307** from centre) to the inner edge of the home's
own collection ring (`864 − 256` = **608**) — about **300 units of radial room**,
and that band is where a forward station is actually useful. Place it there and
its 256-unit collection ring will overlap the primary's on almost any bearing.

**So: yes, in practice they overlap. Design for overlap; do not design against
it.**

### 4.2 If a rock sits inside both collection rings, who gets the ore?

**Nobody — and that is not a dodge, it is how the mechanic actually works today.**
This is the question the brief flags as most likely to make the feature bad, so
here is the concrete mechanism rather than a principle.

The collection field is **not a resource claim**. It is a *banking halo for a
ship*. `updateDeposits` (`src/sim/step.ts:999`) drains `ship.cargo → ship.banked`
while the ship is inside its own living station's `DEPOSIT_RANGE`. Ore lives on
the **ship**, not the station; `MiningStation` has no ore field at all (see the
interface, `src/sim/state.ts:391`). A rock inside a collection ring is mined by
whoever shoots it, exactly like any other rock — asteroids are a free-for-all and
the `Asteroid.home` tag (`state.ts:191`) is *fairness accounting*, not ownership.

So overlapping collection rings cannot fight over ore. What they can do is worse
and much more boring:

**Today, a second station's collection ring would be dead.** `updateDeposits`
calls `stationOf(world, ship.id)` (`step.ts:1005`), which returns the **first**
station in the array with that owner (`buildings.ts:68`). A player standing in
their *second* station's atmosphere gets no drain, no couriers, and no
explanation. The same is true of the build ring: the wheel's dock check is
`isDocked(ship, stationOf(world, ship.id))` (`buildings.ts:308`), so the second
station's BUILD ring would light nothing.

That is the actual finding of §4: the two rings are precisely the *point* of a
forward station — a forward bank and a forward build point — and they are
precisely what the singular lookup blocks. **The ring work is not "resolve a
conflict"; it is "make the lookup plural."** Concretely, three predicates have to
take a station rather than find one:

- `updateDeposits` — drain at the **nearest own living station whose atmosphere
  contains the ship** (deterministic tiebreak: lowest `station.id`, so a ship at
  the exact midpoint of two overlapping rings always picks the same one and a
  replay cannot diverge).
- `isDocked` / the wheel — open at **whichever own station the ship is inside the
  build ring of**, same tiebreak.
- The renderer — draw the pair around **every** own living station, not one
  (`drawAtmosphere` already takes a station and an index; the caller is what
  assumes one).

Overlap is then harmless: two atmospheres that intersect just mean the drain
starts a little earlier, and since ore banks to the *player* either way, there is
nothing to arbitrate.

---

## 5. Destruction and defeat

### 5.1 Today, losing your station loses your match — and it is per-STATION, not per-player

This is the most important finding in the document.

`destroyCore` (`src/sim/match.ts:114`) fires on *any* core reaching zero, and
calls `eliminate` (`:136`), which:

- pushes the **owner** onto `match.eliminated`;
- kills the owner's ship and sets `ship.eliminated = true` — no respawn, no
  controls (GDD §2.7, reaffirmed for Teams by the developer 2026-08-05);
- zeroes the owner's banked ore into scavengeable debris.

There is a `if (world.match.eliminated.includes(station.owner)) return;` guard, so
a *second* death for the same owner is ignored — but the first one already ended
their match. **With a second station and no rule change, an enemy who kills your
50-HP outpost has eliminated you in ten seconds of fire.** The feature as
literally specified makes every player who uses it strictly easier to kill, which
is the exact opposite of what "an additional mining station" sounds like it should
do.

The win condition itself is *already fine*. `resolveWinner`
(`src/sim/match.ts:296`) counts **distinct surviving teams**, not surviving cores,
and its own comment says *"A team with two homes still standing is one surviving
team."* Two stations on one team already resolve correctly. It is `eliminate` —
the *player*-level rule — that is singular.

### 5.2 What defeat should be

**Recommendation: defeat is losing your PRIMARY. The outpost is a structure, not
a life.**

The rule then reads: your primary reactor at zero ends your match, exactly as
today; your outpost at zero costs you the outpost, its rings, and whatever was
built on it. Two reasons:

1. It is the only version that does not invert the feature. Anything else prices
   the outpost as "spend 12 ore to acquire a second, weaker place you can be
   killed from."
2. It requires **one** change in the sim rather than a rework: `eliminate` becomes
   conditional on the station being a primary. Everything else in
   `destroyCore` — zeroing turrets/shields/satellites, killing the owner's shots
   in flight, leaving the wreck — is already correct for an outpost and should
   stay.

One deliberate wrinkle: `destroyCore` currently deactivates **all** the owner's
projectiles in flight (`match.ts:125`). For an outpost that is wrong — the owner
is still alive and still shooting. That line needs the same primary/outpost gate.

### 5.3 Respawn

**No.** Nothing that has a core respawns — GDD §2.1 calls a station *"the only
thing in the match that does not respawn."* A respawning outpost would also make
the cap meaningless (build it, lose it, get it back) and would give the
half-health body an advantage the full-health one does not have.

Whether a *destroyed* outpost frees the cap slot for a **rebuild** is a different
question, and I would say **yes, it should** — that is exactly how the turret ring
behaves (GDD §2.5: "it is also the re-arm tell — when a turret is shot down the
count drops and the wedge lights again"), and paying full price again is a real
cost. But it is close enough to a balance decision that QA should own it from M2.

### 5.4 What the wave AI targets

**There is no wave AI, and that is worth stating because the brief asks.** Asteroid
waves are a metronome, not an opponent: `spawnWave` (`src/sim/waves.ts`) scatters
rocks into a shrinking commons disc each interval and targets nothing. The "AI
that targets" is the **bots**, and the collapse phase's `applyCollapseDecay`
(`match.ts:266`), which chews every surviving core at `COLLAPSE_CORE_DECAY` HP/s.

Two consequences:

- **Collapse decay is absolute HP/s, not a fraction.** A 50-HP outpost dies in
  *half* the collapse time of a primary, for free. That is probably the correct
  and desirable behaviour — the Crush takes the flimsy thing first — but it must
  be a decision, not an accident, and QA must re-baseline match length with it
  (GDD §4.6: 10–15 minutes).
- **The bots do need to know.** See §5.5.

### 5.5 Does `b1-01`'s team-bot strategy need to know? Yes — and here are the files

`b1-01` (Stage 1 of `docs/team-bots-plan.md`, notes at
`status/notes/b1-01-team-bots-stage1.md`) built a bot's model of *winning* around
one station per slot. Four named sites:

| File | Site | The assumption |
|---|---|---|
| `src/bots/perception.ts:406` | `stationIn(world, id)` | returns the **first** station owned by a slot |
| `src/bots/perception.ts:266` | `interface AllyView` | `stationPos: Vec2 \| null` and `stationAlive: boolean` — **singular**, and its own doc calls `stationAlive` *"the win condition, one slot at a time"* |
| `src/bots/perception.ts:526` | `allyRoster` | builds one `AllyView` per ally from `stationIn` |
| `src/bots/memory.ts:100` | `noteStation` → `Map<PlayerId, StationMemo>` keyed by `seen.owner` | **two stations for one owner collide**: the second silently overwrites the first's remembered `coreFraction`, which is what `leaderStation` (`src/bots/targeting.ts:577`) scores "who is winning" from |

Plus ~14 reads of `ctx.self.station` in `src/bots/behaviors.ts` (the repair, the
rebuild, the defend-post, the deposit approach) — a bot would defend and patch
its primary and be blind to its outpost.

The *good* news for the bot lane: `perceive` already loops **all** of
`world.stations` for the enemy list (`perception.ts:580`) and skips by `owner`, and
`nearestLivingRival` / `leaderStation` already filter on `isFoe(station) &&
station.alive` (`targeting.ts:547`, `:577`) — so an **enemy** outpost would appear
as a target automatically. It is only a bot's model of *its own* and *its ally's*
homes that is singular.

`docs/team-bots-plan.md` Stages 2–4 (defending an ally, dividing the field, focus
fire) are unwritten and would need the plural view from the start rather than a
retrofit — which is a reason to settle this **before** Stage 2 lands, or to accept
that Stage 2 will need reworking.

---

## 6. Netcode — the singular-assumption sweep

This is the cost estimate. A station is **already a replicated entity**: it rides
`StationEventData` (`src/net/entity-events.ts:40`) keyed by `data.id`, with HP on a
separate scouted `StationHealthData` (`:113`) also keyed by `data.id`. Stations are
**not** on the per-tick binary snapshot — GDD §4.2 sends static entities as events,
and only ships and projectiles stream. So the *wire shape* for a second station is
free.

What is not free is everything that assumes **one station per owner**. Full list,
non-test files, at `4947169`:

### 6.1 Sim — `src/sim/` (my ownership)

| Path | Site | Assumption |
|---|---|---|
| `src/sim/buildings.ts:68` | `stationOf(world, owner)` | **the root.** Returns the first station with that owner. Everything below is downstream of it |
| `src/sim/buildings.ts:308` | `placeOrder` | wheel orders resolve to `stationOf(world, ship.id)` — the outpost's build ring buys nothing |
| `src/sim/buildings.ts:477` | ship-upgrade order | same lookup |
| `src/sim/step.ts:1005` | `updateDeposits` | same lookup — the outpost's collection ring banks nothing (§4.2) |
| `src/sim/match.ts:136` | `eliminate` | any core death eliminates the owner (§5.1) |
| `src/sim/match.ts:125` | `destroyCore` | kills **all** the owner's shots in flight |
| `src/sim/match.ts:337` | `teamOfOwner` | first station by owner (tiebreak only — benign) |
| `src/sim/waves.ts:250` | `spawnHomeFields` | **every non-derelict station gets a home ore field** (§7) |
| `src/sim/maps.ts` (whole registry) | `MapDef.stations(seed, count, bounds)` | returns one placement per **board position**, max 8; no concept of a player-placed station |
| `src/sim/state.ts:966–975` | `createWorld` | live station ids are `0..N-1` **matching owner ids**, so `stations[owner]` is a valid lookup. A ninth station breaks the identity |
| `src/sim/state.ts:852` | `initialSensory` | `seenStations` bitmask over station board-ids; its doc says "0..7 — well under 32 bits". 16 stations still fits 32, so this **survives**, but the comment is now load-bearing |

Already plural-safe (verified, no change needed): `src/sim/projectiles.ts:276`
(loops all stations), `src/sim/step.ts:787` and `:894` (auto-aim target ladder,
loops), `src/sim/buildings.ts:509` `updateStations` (loops), `src/sim/sensing.ts:99`
`sensorSources` (loops **all** own stations and already unions their coverage —
a second station would extend the fog lift for free), `src/sim/match.ts:296`
`resolveWinner` (counts teams, §5.1).

### 6.2 Netcode — `src/net/`, `server/`

| Path | Site | Assumption |
|---|---|---|
| `src/net/entity-events.ts:296` | `applyTurret` | `stations.find(p => p.owner === data.owner)` — **a turret event names its OWNER, not its station.** With two stations this is ambiguous and the turret lands on the wrong one |
| `src/net/entity-events.ts:336` | `applyShield` | same |
| `src/net/entity-events.ts:363` | `applySatellite` | same |
| `src/net/entity-echo.ts:89` | `EntityEcho` | `stations.find(s => s.owner === owner)` — the predicted-vs-authoritative reconciliation for built entities |
| `src/net/prediction.ts:547`, `:573` | order prediction | `stationOf(this.world, this.local)` |
| `src/net/prediction.ts:1647`, `:1673`, `:1678` | build-clock reconciliation | `world.stations[s]` indexed by slot |
| `server/room.ts:1462` | `stations.find(s => s.owner === player)` | server-side per-player station lookup |
| `src/net/snapshot.ts:76` | budget comment | "4 per station × 8 stations = 32" turrets |

`entity-events.ts:296/:336/:363` is the sharpest one on this list: those three
payloads carry `owner` where they should carry a station id, and the fix is a
**wire-format change** (`TurretEventData.owner` → a station id), which is netcode's
call and a compatibility break. It is the single most expensive line in the sweep.

### 6.3 Client — `src/main.ts`, `src/render/`, `src/ui/`, `src/platform/`

| Path | Site | Assumption |
|---|---|---|
| `src/main.ts` — **18 sites** | `stationOf(world, LOCAL_PLAYER)` at `:2038, :2576, :2664, :2754, :3323, :3392, :3408, :3478, :3491, :3599, :3745, :3866, :4114, :4169, :4294, :4332` (+ `:997, :1001` for an arbitrary player) | the local player's one home: camera framing, the build-button proximity, the alarm's home arrow, the freeze/debug poses |
| `src/main.ts:3514`, `:3528` | end-of-match | `find(p => p.owner === LOCAL_PLAYER && p.alive)` / first surviving rival |
| `src/main.ts:5048` | debug pose | `find(p => p.owner !== LOCAL_PLAYER) ?? stations[0]` |
| `src/main.ts:3259` | bot wiring | `find(p => p.owner === bot.id)` |
| `src/render/index.ts:504`, `:313` | `stationGfx` | keyed by station index, pool doc says "≤ 8" — a pool-size assumption, cheap to widen |
| `src/render/index.ts:577` | `drawAtmosphere` | the two rings, drawn for the one own station (§4) |
| `src/ui/station-hp.ts` (module doc) | HUD bar | *"This module models one bar, for one station — the local player's — and there is deliberately no code path here that takes another player's station."* A deliberate design decision that now needs revisiting |
| `src/ui/alarm.ts:322` | `home: Vec2` | the screen-edge arrow points at **one** home. Two homes under attack is a genuinely new UI problem, not a plumbing one |
| `src/ui/minimap.ts:226` | `MinimapStation.id` | "0..7", indexes the fog bitmask |
| `src/platform/freeze.ts:98`, `:151` | golden poses | `find(p => p.owner === localOwner && p.alive)` |

### 6.4 The count

**~40 non-test call sites across 6 lanes**, of which:

- **1 is the root** (`stationOf`) and would be replaced by two plural helpers
  (`stationsOf(world, owner)` and `primaryOf(world, owner)`);
- **3 are a wire-format change** (`entity-events` turret/shield/satellite owner
  keying) — the expensive ones;
- **2 are genuine design problems, not plumbing** (the alarm arrow; the HUD's
  one-bar rule);
- **~34 are mechanical** — most of `main.ts`'s 18 want the *primary* and would be
  correct after a rename.

Test files add roughly as many again.

---

## 7. Map fairness — yes, it breaks, and here is exactly how

**`spawnHomeFields` stamps a home ore field around every non-derelict station:**

```ts
const stations = world.stations.filter((p) => !p.derelict);   // src/sim/waves.ts:250
const n = stations.length;
...
homeFieldOreFor(fieldYield, n)                                 // :302
```

The invariant is stated in `src/sim/maps.ts` (lines 22–28) and proved by
`tests/sim/resource-fairness.test.ts`: one seeded canonical pattern, rotated onto
each station, so *"every player's local ore is identical by construction"* — with
the module's own emphasis: **"the totals are equal EXACTLY."**

A second station taken naively is a second neighbourhood. Two failures at once:

1. `n` becomes the *station* count, not the player count, so `homeFieldOre` divides
   the same 160 ore across more fields — **every player's home field shrinks
   because one player built something.**
2. The player who built it holds two fields and everyone else holds one. Not
   "unfair to tolerance" — unfair exactly, and the test asserts exact equality.

**Recommendation: an outpost gets NO home field.** The predicate at `waves.ts:250`
becomes "live *primary* homes", one word. That keeps the invariant exactly true
with no re-derivation, and it is also the honest design: the ore is finite (GDD
§2.3) and a feature that *creates* ore would break the conservation guarantee of
§2.7 as well.

The consequence has to be stated: **an outpost that stamps no field is pure cost
with no economic return.** Its whole value is positional — a forward bank
(shorter round trips), a forward build point, and a forward sensor
(`STATION_SENSOR_RANGE = 300`, which `sensorSources` already unions for free,
§6.1). If the developer's mental model was "a second station means more ore," the
answer is no: the field is finite by design and this is the invariant that
enforces it.

Two smaller fairness notes:

- **The map registry has no room.** `compass` and `diamond` always lay out **all
  eight** board positions (`maps.ts` lines 40–48); at N=8 there is no ninth
  position to hand out. So an outpost cannot be a map placement — it *must* be
  player-placed, which is a new mechanic (§8.2).
- **The performance budget assumes eight.** GDD §4.3 constraint 3 sizes the frame
  budget at *"up to 32 turrets (design cap 4 × 8 facilities)"*. If an outpost
  carries a turret ring, that doubles to 64 and the named constraint moves. **An
  outpost carrying no turrets keeps the budget untouched** — a further argument
  for the depot framing in §9.

---

## 8. The two things this would actually cost

### 8.1 The `BuildItem` contract

`BuildItem` (`src/shared/types.ts:203`) is `'turret' | 'shield' | 'satellite' |
'repair' | 'bank'` — a **ratified interface**, changed only by proposal. Adding
`'outpost'` is a one-word addition and the radar satellite (feature f1) is the
precedent for exactly this: a new buildable with HP, a cap, a construction timer,
and a wheel wedge that "appears for free off this entry."

### 8.2 Placement — and the contract change hiding in it

`BuildOrderAction` carries `item` and nothing else. A player-placed station needs a
*position*, and there is nowhere to put one. That is a change to the ratified
action union, i.e. to the six-verb contract of GDD §2.4 — the most expensive
sentence in this document.

Three options, cheapest first:

| Option | Placement | Contract cost |
|---|---|---|
| **(c) Fixed offset on your own spoke** | The outpost lands at a deterministic point on the owner's spoke angle (`MiningStation.angle` already exists), e.g. inboard toward the commons, clamped by `clampAnchorOutside` (`src/sim/anchors.ts:62`) and `clampToMargin` | **None.** No new verb, no new field, no placement UI |
| **(b) Where the ship is standing** | The order deploys at the ship's current position, validated for margin, min separation, and no overlap with rocks or other stations | `BuildOrderAction` gains an optional position — or the sim reads the *ship's* position, which needs **no contract change at all** and is why this is nearly as cheap as (c) |
| **(a) Free placement with a cursor** | A drag/tap placement mode | New verb, new UI mode, input-parity table row on all three devices (GDD §2.4) |

**(b) is the recommendation** and it is worth noticing *why* it is cheap: the sim
already knows where your ship is, and "build it here" needs no new data on the
wire. `clampAnchorOutside` and `clampToMargin` give the placement geometry for
free. (a) is the one to avoid — it is a whole input-parity workstream for a
feature the developer called experimental.

---

## 9. Verdict

### **BUILD IT WITH CHANGES — as an OUTPOST, not a second home.**

And, plainly, because the brief asks for honesty rather than a sales pitch:
**the literal reading is a DON'T.** "A second mining station with half the health"
— a second *home*, with a core, a home ore field, and today's elimination rule —
makes the game worse in three specific ways:

1. It **inverts the loss condition** (§5.1): a 50-HP body is ten seconds of fire
   and it eliminates you. The feature would make every player who uses it easier
   to kill.
2. It **breaks the resource-fairness invariant** exactly, not approximately (§7),
   and the fix — no home field — is the same fix that turns it into an outpost.
3. It **doubles the turret budget** the GDD's named performance constraint is
   sized on (§7).

The version that survives all three is narrow and buildable, and it is the same
shape as the radar satellite the developer already ratified as feature f1:

> **An OUTPOST.** One per player, cost ~12 ore (`TUNABLE`), `OUTPOST_CORE_HP = 50`
> written into `maxCoreHp` at construction. Deployed at your ship's position with
> a minimum separation. It carries **the two rings and nothing else** — a forward
> collection field so you bank without flying home, a forward build ring so the
> wheel opens there, and the station sensor you get for free. **No home ore
> field. No turret ring. Not a life** — losing it costs you the outpost, not the
> match. Killable in ten seconds by anyone who finds it, which is the price of
> forward position.

That is recognisably what the developer asked for — an additional mining station
at half health — with the three things removed that would have made it bad.

### Size

**Roughly 7–9 briefs across five lanes**, sequenced:

| Lane | Work | Briefs |
|---|---|---|
| Gameplay (sim) | `OUTPOST_CORE_HP` + station variant; plural `stationsOf`/`primaryOf`; plural deposit + dock predicates with the id tiebreak; `eliminate` gated on primary; `spawnHomeFields` primary-only; placement validation + cap | 2–3 |
| Netcode | `entity-events` turret/shield/satellite keyed by station id (a wire change); `entity-echo`; prediction's build clocks | 1–2 |
| UI | Wheel wedge + `0 / 1 BUILT` cap count (GDD §2.5); the alarm arrow with two homes; the HUD's one-bar rule; minimap | 1–2 |
| Bots | Plural `AllyView`; `memory` keyed by station not owner; `self.station` → own stations | 1 |
| Render / Art | Outpost sprite (visibly *not* a home); two rings per own station; `stationGfx` pool | 1 |
| QA | Re-baseline resource fairness, match length under collapse decay, determinism replay | 1 |

**If instead it is built as a true second HOME**, add the win/loss rework, the map
registry's ninth board position, the fairness re-derivation, and the doubled
turret budget: **14+ briefs, touching every lane.** That difference — 8 briefs
versus 14+ — *is* the argument for the outpost framing.

### The single biggest risk

**Not the ~40 call sites. The alarm.**

GDD §2.2 names the under-attack alarm as *"a mechanic, not polish"*, and the whole
design turns on it: *"the moment you're deep in the asteroid field and this alarm
fires: the triangle decision, made audible."* The triangle works because there is
**one** home and **one** arrow, so the alarm asks a question with one answer —
go, or don't.

Two homes makes it a *two*-answer question, and the outpost is the one you are
told to abandon (10 seconds, and it is not your life). Every alarm from the
outpost is therefore a false alarm that costs the player the moment of decision
the game is built around — and an attacker who works this out will tap the
outpost purely to pull you off the field. The plumbing is a known, countable cost.
**The alarm is a design problem with no obviously right answer**, it lives in
`src/ui/alarm.ts` (not my lane), and it is what would make this feature feel bad
even after every one of the 40 sites is correct.

---

## 10. For the developer — the questions only you can settle

These go on the board's feedback queue. **Production does not wait on them**; this
brief is a spike and the backlog continues.

1. **What is defeat, with two stations?** This spike recommends: your **primary**
   at zero ends your match; the second one is a structure you can lose without
   losing. The alternative — either core ends your match — is buildable but makes
   the feature a liability (§5.1), and "you survive while either stands" makes the
   50-HP body a free extra life. **Everything else in this document keys off this
   answer.**

2. **Is it a home, or a forward depot?** The spike recommends a **depot**: the two
   rings, no ore field, no turrets. A full second home is buildable and roughly
   doubles the cost (§9), and it is the version that breaks the fairness
   invariant and the frame budget. Which did you picture when you wrote
   "additional mining station"?

3. **What did you want it to *do*?** If the answer is *"more ore"* — the field is
   finite by design (GDD §2.3, 400 ore a match, conserved exactly per §2.7), so a
   second station cannot mine more; it can only shorten the trip. If the answer is
   *"a forward position"*, the depot is the whole feature. Knowing which one you
   meant changes the cost, not just the tuning.

A fourth, smaller one, answerable later by QA: **can a destroyed outpost be
rebuilt?** The spike leans yes (the turret ring's re-arm precedent, §5.3), but it
is a balance dial, not a design ruling.

---

## Appendix — every constant this document quotes

| Constant | Value | Where |
|---|---|---|
| `CORE_HP` | 100 | `src/sim/constants.ts:44` |
| `WEAPON_DPS_CORE` | 5 | `src/sim/constants.ts:49` |
| `STATION.radius` | 64 | `src/sim/constants.ts:489` |
| `STATION.ringFraction` | 0.32 | `src/sim/constants.ts:496` |
| `STATION.orbitOffset` | 96 | `src/sim/constants.ts:500` |
| `STATION.dockRange` | 160 | `src/sim/constants.ts:504` |
| `DEPOSIT_RANGE` | 256 (`STATION.radius * 4`) | `src/sim/constants.ts:1453` |
| `STATION_SENSOR_RANGE` | 300 | `src/sim/constants.ts:960` |
| `WORLD_SIZE` | 2400 | `src/sim/constants.ts:449` |
| `WORLD_EDGE_MARGIN` | 220 | `src/sim/constants.ts:462` |
| `FIELD_YIELD` | 400 | `src/sim/constants.ts:509` |
| `RESOURCE_FIELD.commonsShare` | 0.6 | `src/sim/constants.ts:560` |
| `RESOURCE_FIELD.commonsRadiusFraction` | 0.4 | `src/sim/constants.ts:569` |
| `TURRET.cost` / `.capPerStation` | 3 / 4 | `src/sim/constants.ts:85`, `:89` |
| `SHIELD.cost` | 5 | `src/sim/constants.ts:383` |
| `SATELLITE.cost` | 6 | `src/sim/constants.ts:983` |
| Turret Mk II / Mk III upgrade cost | 4 / 7 | `TURRET_TIERS`, `src/sim/constants.ts:229` |
| DAMAGE ladder costs | `[4, 8, 14]` | `src/sim/constants.ts:1155` |
| `STARTING_ORE` | 3 | `src/sim/constants.ts:65` |
| `WRECK.baseDebrisOre` | 8 | `src/sim/constants.ts:914` |

Derived in this document: octagon station ring **864**; adjacent-home separation at
N=8 **661**; two collection rings touch at **512**; commons outer edge **307**;
clear radial band per spoke **~300**; a player's whole-match share at N=8
**~50 ore**; naked outpost kill time **~10 s**.
