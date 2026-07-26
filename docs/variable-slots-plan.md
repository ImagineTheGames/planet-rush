# Variable Match Sizes — FFA 2-8 first, Teams as a layer (Spike s1)

**Owner:** Architect · **GDD:** §2.1, §2.9, §2.11, §4.2, §4.6 (M4) · **Status:** decided,
task-broken, awaiting developer ratification on three questions (bottom of doc)

This spike **decides**, in the mold of `docs/netcode-spike.md`: measurements over
intentions, every claim reproducible, and the traps written down for the agents who
implement. The developer's ratified scope (2026-07-26):

> "I want 2 modes — FFA and Teams — and to be able to assign bots to slots or
> unassign slots. Networking and lobbies need to be aware of this and publish it so
> players don't join a lobby that doesn't allow it."

Reproduce the one thing this spike measured rather than assumed — does a match still
land in 10–15 min at small N with today's constants:

```
npx vite-node spikes/variable-slots/measure-match-length.ts   # prints the sweep below
npx tsc --noEmit                                               # whole tree type-checks
```

The measurement code is throwaway (`spikes/variable-slots/`, excluded from
`tsconfig.json`'s `include` and from the build); it reuses the shipped QA harness
(`harness/match.ts`) unmodified, because that harness already accepts a
variable-length lineup — which is itself the headline finding.

---

## DECISION (up front)

1. **The sim is already N-parametric; almost nothing in the simulation or the wire
   blocks variable size.** `createWorld` sizes `world.ships`/`world.planets` off
   `config.players.length` (`src/sim/state.ts:530-545`); the binary snapshot already
   carries a dynamic `shipCount u8` and a 2-ship world already encodes to 32 B
   (`src/net/snapshot.test.ts:59-64`). Variable N is a **config, lobby, and
   advertisement** problem, not a sim-rewrite problem.

2. **One `MatchConfig` model is the source of truth**: `mode ∈ {ffa, teams}` + eight
   `SlotConfig` records each `state ∈ {open, bot, closed}` with a `team` number.
   `N = count(state ≠ closed)`, 2..8. **FFA is teams-of-one** (`team = slot index`),
   so the sim asks "same team?" through exactly one new predicate and TEAMS changes a
   table, not a code path.

3. **Match pacing does not need per-N re-tuning.** Measured: with *fixed bot
   composition*, match length is stable at 12–14 min across N=2..8 (table below),
   because the finite field + collapse metronome (750 s + 100 s core-decay = a
   14.17-min ceiling) is the real governor and it is N-independent by construction
   (`src/sim/match.ts:69-72`, `src/sim/constants.ts:343,524,553`). What changes ~4×
   with N is **per-player ore density**, not wall-clock length — that is an economy-feel
   re-baseline for QA, not a clock change.

4. **The hosting seam does NOT yet advertise match config.** Heartbeats carry a
   machine's *room* capacity and each room's *human count* only — no size, no mode, no
   joinable-seat count (`server/heartbeat.ts:184-214`). The allocator counts every room
   as weight 1 regardless of its size (`allocator/allocator.ts:251-258`). Advertisement
   and size-aware fleet density are **net-new work**, itemised below. The hosting plan's
   claim that "capacity seams were built for advertisement" is true only of
   machine-level *room* capacity; it does not carry a per-room config payload.

5. **Sequencing:** ship **FFA-at-N** first (Milestones A–C), then **Teams** as a pure
   layer over the same `MatchConfig` (Milestones D–E). Both are fully task-broken here;
   Teams is not a deferral.

---

## MEASUREMENTS

### 1. Match length across N — measured, not assumed

From `npx vite-node spikes/variable-slots/measure-match-length.ts`, seeds 1..16 each,
default `octagon` map (the only map that is N-parametric today — see §S1). The QA
harness strategies (`miner/turtle/rusher/raider`) stand in for the shipped bot trees,
exactly as the netcode spike stands in for the real sim — so read the *shape*, not the
third decimal.

**Fixed-composition mirror sweeps (only N varies — the clean signal):**

```
mirror raider (aggressive)          mirror miner (passive)
  N | meanMin | in[10,15] | collapse    N | meanMin | in[10,15] | collapse
  2 |  12.51  |   13/16   |   75%        2 |  12.88  |   16/16   |  100%
  3 |  14.16  |   16/16   |  100%        3 |  12.38  |   16/16   |  100%
  4 |  14.13  |   16/16   |  100%        4 |  12.20  |   16/16   |  100%
  6 |  14.07  |   16/16   |  100%        6 |  12.10  |   16/16   |  100%
  8 |  14.09  |   16/16   |  100%        8 |  12.05  |   16/16   |  100%
```

Match length is **stable across N** with today's constants. The 14.17-min figure that
recurs is the structural ceiling: collapse begins at `collapseDeadline()` = 750 s
(`src/sim/match.ts:69-72`), then `COLLAPSE_CORE_DECAY = 1` HP/s kills a 100-HP naked
core in 100 s → 850 s = 14.17 min (`src/sim/constants.ts:537-553`). The only sub-window
outlier is N=2 raider, where a fast duel occasionally ends at ~3.9 min before collapse.

**Round-robin mix sweep (composition CHANGES with N — the confound, kept for honesty):**

```
  N | meanMin |  minMin |  maxMin | in[10,15] | collapseMin
  2 |  14.14  |  13.93  |  14.17  |   16/16   |   12.48
  3 |   8.90  |   5.87  |  14.17  |    5/16   |   12.50
  4 |   9.09  |   5.65  |  14.17  |    4/16   |   12.50
  6 |  14.17  |  14.17  |  14.17  |   16/16   |   12.50
  8 |   5.95  |   4.90  |   7.39  |    0/16   |   -1.00 (collapse never reached)
```

The wild variance here is an artefact of the sweep, not of N: round-robining four
strategies onto N seats *changes who is in the match* (N=2 = miner+turtle only, passive;
N=8 = two rushers + two raiders in a shrinking field, who crack cores before collapse).
The lesson for the implementers is the reverse of the naive read: **do not conclude
"8-player matches end too fast" — that row is an aggressive composition, and the same
composition ends just as fast at N=8 today.** Hold composition constant (the mirror
sweeps) and N barely moves the clock.

**Conclusion:** variable N needs **no change to wave count, wave ore, wave interval,
collapse grace, or core-decay** to keep the 10–15 min target. The finite-field guarantee
generalises. (Caveat, stated like the netcode spike's: harness strategies, not the real
M4 bot trees; the honest place to re-confirm is QA's balance pass at M4 with the shipped
trees and real lobby compositions.)

### 2. What the wire and sim already do — measured facts

| Claim | Verified at | Verdict for variable N |
|---|---|---|
| `world.ships`/`world.planets` sized off `config.players.length` | `src/sim/state.ts:530-545` | **N-ready** |
| Snapshot carries dynamic `shipCount u8`, not a fixed 8 | `src/net/snapshot.ts:251-266,302-314` | **N-ready** |
| A 2-ship world encodes to `HEADER + 2·SHIP_BYTES` = 32 B (test-pinned) | `src/net/snapshot.test.ts:59-64` | **N-ready** |
| Worst case still 494 B (8 ships + 64 proj) — a *cap*, not per-frame size | `src/net/snapshot.ts:86-87` | small N is strictly cheaper |
| Prediction/reconciliation index ships by `PlayerId` via `.find`, never `[slot]` | `src/net/prediction.ts:263,370-397` | **N-ready** |
| Win/last-to-die guards on `planets.length < 2`, not `== 8` | `src/sim/match.ts:232-248` | **N-ready** (N=2 is a valid duel) |
| Harness runs any N via a length-N `lineup` | `harness/match.ts:58-66,334-341` | **N-ready** (used for §1) |

The only genuine hard-8 walls are **max-player** caps, irrelevant to shrinking to N<8:
`MAX_PLAYERS = 8` and the player-id validator `< MAX_PLAYERS` (`src/net/wire.ts:84,254`),
and the **3-bit projectile owner** `meta & 0x7` (`src/net/snapshot.ts:106-117`,
`prediction.ts:424`). These bind the *ceiling* at 8; they do not block 2..8. Raising the
ceiling above 8 is out of scope and would require widening the owner field and
re-deriving the worst case.

### 3. The friend/foe test today — where TEAMS must consolidate

There is **no team concept and no single friend/foe predicate**. "Is this mine?" is
inlined as `id === owner` / `owner === owner` equality in **seven** sites across three
files (all currently correct for FFA, all needing to become "different team?"):

| Site | File:line | What it gates |
|---|---|---|
| ship-shot vs ship hull | `src/sim/projectiles.ts:237` | a shot skips its owner's own ship |
| ship-shot vs planet/turret/core | `src/sim/projectiles.ts:260` | a shot never sieges its own home |
| turret target acquire | `src/sim/buildings.ts:651` | a turret never fires on its owner |
| turret sticky-target validity | `src/sim/buildings.ts:667` | " |
| turret threat-split scan | `src/sim/buildings.ts:705` | " |
| auto-aim target select (ship) | `src/sim/step.ts:578` | auto-aim never locks the local ship |
| auto-aim target select (planet) | `src/sim/step.ts:587` | auto-aim never locks own home |

`src/sim/damage.ts` is correctly *not* on this list — it applies HP and checks only
`alive`/`spawnProtect` (`damage.ts:24-29`); allegiance belongs one layer up, at
collision/targeting. Bot target selection (`src/bots/*`) adds more foe-reads that must
route through the same predicate so bots respect alliances.

### 4. The server/allocator seam — what it advertises today

- **Heartbeat body** = `{machine, region, capacity, draining, rooms:[{code, players}],
  load}` (`server/heartbeat.ts:203-214`). `capacity` is a *room ceiling*; each room
  reports only its **human count**. There is **no** size, mode, occupancy-by-seat, or
  joinable-seat field anywhere on the wire.
- **Fleet density is room-flat**: `loadOf` = (room codes + pending reservations); the
  `players` field is never read for placement (`allocator/allocator.ts:251-258`), and
  `freeSlots` counts one unit per room (`allocator/fleet-controller.ts:311-323`). A host
  of 64 two-player rooms and a host of 64 eight-player rooms look identical to every
  placement decision — the "1 room = 8 players" assumption is a comment
  (`server/match-server.ts:131-133`), not data.
- **Room-code resolution checks existence/liveness only** — never capacity, size, or
  mode (`allocator/registry.ts:168-179`); `Allocator.join` explicitly succeeds on a full
  room (`tests/allocator/allocator.test.ts:175-180`). The **first and only** fullness
  check is `room.join → 'room-full'`, *after* the client has been routed there
  (`server/room.ts:289-309`).
- **Room slots already support a variable count** via `RoomConfig.slots`
  (`server/room.ts:221-235`), but it is a **process-global** default baked at server
  boot (`server/match-server.ts:266-279`), never per-room, never negotiated at
  allocate/join time.

So "networking and lobbies publish the config so players don't join a lobby that doesn't
allow it" is **net-new**: the config must be added to the heartbeat/registry, exposed at
resolution, and (for honest fleet density) weighted by seat count.

---

## STUDY FINDINGS (per the brief's six axes)

### S1 — Sim / world generation: three of four maps silently truncate at N<8

`MapDef.planets(seed, count, bounds)` already takes a count (`src/sim/maps.ts:80`), and
`createWorld` asks for `config.players.length` placements (`state.ts:530`). But only
**`octagon`** actually regenerates on `count` (`maps.ts:211-226`: `for i<count`,
`theta = 2π·i/count` — equal gaps at any N). **`compass`, `oval`, `diamond` build all 8
homes then `.slice(0, count)`** (`maps.ts:254,283,319`); `oval` even hardcodes
`ellipseEqualChord(a, b, 8)` (`maps.ts:275`). Slicing takes contiguous slots 0..N-1, so
at N<8 those three yield **clustered, non-opposite** planets (e.g. N=2 diamond = outer-N
+ inner-NE, adjacent), breaking spacing symmetry — and returning **fewer than N**
placements for N>8, which would throw at `placements[i]!` (`state.ts:533`).

**Resource fairness survives the slice; spatial fairness does not.** Home fields are
stamped as one canonical pattern rotated onto each planet in its own frame
(`src/sim/waves.ts:230-306`), and the commons is stamped at `N` even rotations
(`waves.ts:322-372`, `sectors = max(1, planets.length)`), so per-player *ore* stays
exactly equal at any N (`tests/sim/resource-fairness.test.ts` asserts
`totals[i] === totals[0]` strictly, swept N=2..8 — **but on octagon only**). What breaks
under a naive slice is the *board geometry*: equal neighbour gaps (compass), the
equal-chord ellipse (oval), the 4-fold symmetry and "slot 0 = outer" guarantee
(diamond). `tests/sim/maps.test.ts` only proves the four maps at N=8, so N<8 on
compass/oval/diamond is currently **unproven**.

The per-N economy already self-scales: `homeFieldOre(n)` divides the 40% home share by
N (`constants.ts:487-493`); commons is 60% split across N sectors. Total field yield is
a flat 400 for any N — hence the ~4× per-player ore swing between N=8 and N=2.

**This is the developer's #1 ratification (empty derelicts vs regenerate vs per-N
variants) — see Questions.** Engineering reality per layout: octagon is done; oval is a
one-line generalisation (`ellipseEqualChord(a, b, count)` + drop the slice — the solver
is already parametric and memoised by count); **compass and diamond have no natural
2..7 truncation** and need either a genuine geometric redesign or the derelict-fill
fallback.

### S2 — Wire / netcode: nothing to change for N<8; teams cost zero snapshot bytes

Covered in Measurements §2/§3. The wire is dynamic; the caps are max-player only.
Crucially, **allegiance is static match config** (fixed at match start, never changes),
so it rides `matchStart` / entity-events like `shipClass` does — it must **not** enter
the per-tick snapshot. Teams therefore add **zero bytes** to the 494-B budget.

One trap to pin with a test: `createWorld` builds ships/planets *positionally* from
`config.players` with `Planet.id = arrayIndex` while identity is `spec.id`
(`state.ts:533-545`). A **dense** roster (ids 0..N-1) is safe; a **sparse** roster (ids
{0,2,5} after closes) is a latent trap for any code that treats `PlayerId` as an array
index. **Recommendation: compact to a dense 0..N-1 roster at world-build** (closed slots
produce no `PlayerSpec`), which also keeps `PLAYER_COLORS[playerId]` contiguous.

### S3 — Server / allocator: advertisement + size-aware density are the real work

Covered in §4. Task list in Milestone C.

### S4 — Balance / waves / collapse: re-baseline economy feel, not the clock

Covered in Measurements §1. No pacing constant needs an N term. QA should re-baseline
the **economy** (per-player ore density, turtle-viability, defense saturation) at small
N, since 80 ore/home at N=2 vs 20 ore/home at N=8 is a different game texture even at the
same match length. Note also two stale docs to ignore: `docs/bot-balance-day4.md` and
`harness/balance.ts`'s `BALANCE_01_FINDINGS` still describe `COLLAPSE_CORE_DECAY = 0`;
the shipped constant is 1 (`constants.ts:553`).

### S5 — Teams mode, scoped for real

- **Model:** `mode: 'teams'` + `team: number` on each non-closed slot. Sim stores
  `team` on `Ship` and `Planet` (plain serializable ints, hash/snapshot-safe). One
  predicate `areEnemies(world, aId, bId)` = `teamOf(a) !== teamOf(b)`; FFA sets
  `team = playerId` so `areEnemies ⇔ a !== b` — byte-identical to today.
- **Friendly fire:** recommended **OFF** (allies pass through each other's shots,
  turrets and auto-aim ignore allies) — this is the natural consequence of routing all
  seven §3 sites through `areEnemies`, and matches the "alliance" intent. *Developer Q.*
- **Shared victory:** `resolveWinner` (`match.ts:232-248`) ends when **one team** has a
  core standing, not one player. Change: count *distinct surviving teams*, not surviving
  planets; last-to-die tiebreak becomes last-*team*-to-die. This is the one win-condition
  edit; everything else is the predicate.
- **Colours/nameplates:** `PLAYER_COLORS` is a fixed 8-roster indexed by `PlayerId`
  (`src/render/index.ts:49-59`); identity is per-slot, never per-person. Recommended:
  **keep the 8 identity colours** (so ships stay individually legible) and add a team
  indicator (nameplate underline / beacon-ring grouping). Re-keying colour by team loses
  per-player identity and fights the style guide. *Developer Q (colour treatment).*
- **Collapse & waves vs teams:** unchanged — collapse decays *cores*, and a team simply
  has more than one core to lose; the metronome is mode-agnostic.
- **Balance harness:** `harness/match.ts` needs a `team` on `SlotSpec` and a
  team-composition lineup builder (e.g. `teamsLineup([[a,b],[c,d]])`); the win-rate
  target becomes per-team.

### S6 — Lobby / UI: extend the model that already exists

The lobby already has a per-slot occupant `SeatOccupant = 'human' | 'bot' | 'open'` and
`LobbySeat` (`src/ui/lobby.ts:286-299`), and the host can already cycle bot difficulty
(`cycleBotDifficulty`, `lobby.ts:555-565`). Missing, all net-new: a **`closed`** occupant
state, a **`mode`** toggle, a per-slot **`team`**, and a real **2..8 size** (today
`LOBBY_SLOTS = MATCH_SLOTS = 8` is fixed; `slots?` is a test fixture only,
`lobby.ts:73,352`). Config handoff already funnels through `lobbyChoice → startMatch →
createWorld` online and `bootOfflineMatch → createWorld` offline; `PlayerSpec` is
`{id, shipClass}` (`state.ts:413-416`) — the struct to extend with `team`. Persistence
follows the existing `planet-rush:` storage-key pattern in `main.ts`.

---

## RECOMMENDED ARCHITECTURE

**One config object, authored in the lobby, carried on the wire, consumed by the sim.**

```ts
// New shared type (src/shared/types or a small src/sim/match-config.ts).
export type MatchMode  = 'ffa' | 'teams';
export type SlotState  = 'open' | 'bot' | 'closed';   // extends SeatOccupant with 'closed'

export interface SlotConfig {
  readonly index: number;            // 0..7 — stable slot id, the colour/decal key
  state: SlotState;
  shipClass: ShipClass;              // human: own pick; bot: from personality
  botPersonality?: PersonalityId;    // when state === 'bot'
  botDifficulty?: BotDifficulty;
  team: number;                      // FFA: team === index (teams-of-one)
}

export interface MatchConfig {
  mode: MatchMode;
  slots: SlotConfig[];               // always length 8 in the lobby view
  // N (world size) = slots.filter(s => s.state !== 'closed').length, validated 2..8
}
```

**Boundaries:**
- **Lobby** owns `MatchConfig` and is the only place it mutates. It renders 8 physical
  slots (colour identity is per-slot) and derives N from non-closed count.
- **World build** compacts non-closed slots into a **dense** `PlayerSpec[]` of length N
  (`{id: 0..N-1, shipClass, team}`), so `PLAYER_COLORS`, planet ids, and the wire stay
  contiguous (avoids the sparse-roster trap, §S2).
- **Sim** stores `team` on `Ship`/`Planet` and exposes **one** `areEnemies(world,a,b)`;
  all seven §3 sites call it. FFA and Teams differ only in the team table.
- **Wire** adds `team` (static) to `MatchStartSlot`/`LobbySlot` and `mode`+`size` to the
  room advertisement (heartbeat/registry) — **never** to the per-tick snapshot.
- **Allocator** weights fleet density by seat count, and refuses or advertises based on
  the published config.

---

## TASK LIST (needs-ordered, TDD — FFA-at-N first, Teams behind)

Each Task names its owner, the test to write **first**, then the change. Milestones A–C
ship FFA-at-N; D–E add Teams as a layer; F is fleet-density hardening.

### Milestone A — Sim & config foundation (Gameplay Engineer)

- **Task A1 — `MatchConfig` type + dense compaction.** *Test first:* a
  `compactConfig(cfg)` unit test that a config with two `closed` slots yields a length-6
  dense `PlayerSpec[]` with ids `0..5`. *Change:* add the types above; add
  `configToPlayers(cfg): PlayerSpec[]`. No sim behaviour change yet.
- **Task A2 — `team` on `PlayerSpec`/`Ship`/`Planet`, FFA default.** *Test first:*
  `createWorld` with N players and no explicit teams gives `ship.team === ship.id` and
  `planet.team === planet.owner`. *Change:* thread `team` through `makeShip`/`makePlanet`
  (`state.ts:443-490`); default `team = id`. Determinism hash unaffected (ints in the
  tree).
- **Task A3 — the one predicate.** *Test first:* `areEnemies(world, a, b)` returns
  `a !== b` in FFA, and `false` for same-team / `true` for cross-team in a hand-built
  2-team world. *Change:* add `src/sim/allegiance.ts` exporting `teamOf` + `areEnemies`;
  route **all seven** §3 sites through it (`projectiles.ts:237,260`;
  `buildings.ts:651,667,705`; `step.ts:578,587`). Regression: every existing sim test
  stays green (FFA behaviour is byte-identical). **Trap:** leave
  `isAttackingPlanet`'s `p.owner !== ship.id` (`buildings.ts:599`) alone — that is
  shot-identity, not allegiance.
- **Task A4 — bots respect allegiance.** *Test first:* a Medium bot in a 2-team world
  never selects an ally as a target. *Change:* route `src/bots/*` foe-reads through
  `areEnemies`.

### Milestone B — Maps at N (Gameplay Engineer)

- **Task B1 — generalise the parametric maps.** *Test first:* extend
  `resource-fairness.test.ts` / `world-margin.test.ts` to sweep **all four maps** at
  N=2..8 for the fairness + margin invariants (today only octagon is swept <8). *Change:*
  `oval` → `ellipseEqualChord(a, b, count)`, drop `.slice`. octagon already passes.
- **Task B2 — resolve compass/diamond per the developer's ratification** (Question 1).
  *If "regenerate":* redesign their `planets(count,…)` to place `count` equal-gap homes
  (compass loses its corner/edge two-radius trick below 8; diamond loses strict 4-fold
  symmetry — document the degraded-but-fair spacing). *If "derelict-fill":* place all 8,
  mark `8-N` as unowned derelict planets (see B3). *Test first per branch:* the swept
  fairness/margin invariants above. **Trap:** `.slice(0, count)` returns <N for N>8 and
  throws at `state.ts:533` — guard N ≤ 8 at config validation regardless.
- **Task B3 — (only if derelict-fill is chosen)** a `Planet` `derelict` flag: no owner,
  no home field stamped, lootable wreck debris if Question 1b says lootable. *Test:*
  derelicts take no core damage from `areEnemies` (nobody's enemy), and `homeFieldOre`
  divides by *active* N, not 8. `maps.test.ts` N=8 assertions must be generalised either
  way (they currently pin `toHaveLength(8)` and diamond's 4×4).

### Milestone C — Advertisement, refusal, per-room size (Netcode Engineer)

- **Task C1 — per-room size, not process-global.** *Test first:* two rooms on one
  `MatchServer` open at sizes 4 and 8 simultaneously. *Change:* resolve size per
  `openRoom(code)` (`match-server.ts:245-252`) instead of `MatchServerConfig.slots`;
  carry the requested size from `POST /rooms` body (`allocator/index.ts:185-198` parses
  only `region` today) into the reservation and into `roomConfig`.
- **Task C2 — `closed` slots on the server.** *Test first:* a room with a closed slot
  refuses the (size)+1-th join with `'room-full'`, and `startMatch` seats **no** bot in
  a closed slot. *Change:* add `closed` to the `Slot` record; `join` skips closed slots
  (`room.ts:289-309`); `startMatch` bot-fill skips closed (`room.ts:446-479`); world
  build excludes closed. **Trap:** today `startMatch` seats a bot in *every*
  `socket === null` slot — a closed slot would be filled unless explicitly skipped.
- **Task C3 — publish config in the heartbeat.** *Test first:* `isHeartbeat` accepts and
  the registry ingests a per-room `{code, players, size, mode, joinableSeats}`; a client
  querying a room sees its config *before* dialing. *Change:* extend `HeartbeatRoom`
  (`heartbeat.ts:190-194`), the registry `Room` (`registry.ts:52-57`), the `isHeartbeat`
  guard (`allocator/index.ts:252-264`), and add a room-info read path (extend
  `POST /rooms/:code/join` response or a `GET /rooms/:code`) so the lobby can show/refuse
  incompatible rooms. Refusal reasons already exist as `JoinRejection`
  (`room.ts:112-117`) — add any new reason (e.g. `'closed'`) there.
- **Task C4 — wire the config through matchStart.** *Test first:* an online 4-player
  match rebuilds a 4-planet world client-side. *Change:* `MatchStartSlot` +
  `LobbySlot` gain `team` (`transport.ts:148-189`); size rides implicitly in the roster
  length (already honoured, `session.ts:291-297`). Offline: extend `OfflineMatchConfig` /
  `bootOfflineMatch` (`match-boot.ts:74-89`) to thread size + mode + per-slot team.

### Milestone D — Teams win/economy (Gameplay Engineer)

- **Task D1 — shared victory.** *Test first:* a 2v2 world ends when one team's last core
  dies, winner = surviving team; last-*team*-to-die tiebreak when the final two cores
  fall together. *Change:* `resolveWinner` counts distinct surviving teams
  (`match.ts:232-248`); `MatchState.eliminated` / `winner` become team-aware (or add a
  `winningTeam`).
- **Task D2 — friendly fire per ratification** (Question 3). Default OFF falls out of A3
  for free; if the developer wants FF *on* for allies' ships only, add a `friendlyFire`
  flag consulted at the two `projectiles.ts` ship/planet sites only (turrets/auto-aim
  still ignore allies).

### Milestone E — Lobby & UI (UI Engineer)

- **Task E1 — mode toggle + slot cycle.** *Test first:* host taps cycle a slot
  `open → bot → closed → open`; a mode toggle flips `ffa ⇄ teams`; N is derived and
  clamped to 2..8 (a config with <2 non-closed slots cannot RUSH). *Change:* extend
  `SeatOccupant` with `closed` (`lobby.ts:286`), add `mode` + per-seat `team` to
  `LobbyState`/`LobbySeat`, add the tap targets (today only `class|seat|map|rush|
  roomCode`, `lobby-flow.ts:384-415`). Make `LOBBY_SLOTS` a real 2..8 axis.
- **Task E2 — team assignment + colour/nameplate treatment** per Question 4. *Test:*
  in TEAMS, each slot shows its team; identity colour preserved, team shown as the agreed
  indicator. Bot personality picker per bot slot (optional; today personality is derived
  from difficulty + empty-seat index, `lobby.ts:433-438`).
- **Task E3 — persistence.** Persist `mode`, last size, and (optionally) the slot layout
  under new `planet-rush:` keys, normalised on read (mirror `readMapId`, `main.ts:2363`).

### Milestone F — Size-aware fleet density (Netcode Engineer, hardening)

- **Task F1 — weight rooms by seats.** *Test first:* the allocator prefers a host with
  free *seat* capacity over one with fewer rooms-but-full-seats. *Change:* `loadOf` /
  `freeSlots` sum a per-room seat weight (from C3's published `size`) instead of counting
  rooms flat (`allocator.ts:251-258`, `fleet-controller.ts:311-323`). **Trap:** until
  this ships, event-loop lag (`heartbeat.ts:184-188`) is the *only* backstop against
  over-packing many large rooms onto one host — safe for FFA-at-N launch (small rooms
  only *reduce* load), needed before variable size is common.

---

## TRAPS (the ones that bite an implementer who skims)

1. **"3 of 4 maps are N-ready" is false — only octagon is.** compass/oval/diamond
   `.slice(0, count)` (`maps.ts:254,283,319`) gives clustered planets at N<8 and throws
   at N>8. oval also hardcodes `…(a,b,8)` (`maps.ts:275`). (§S1, Task B.)
2. **The friend/foe check is in seven places, not one.** Miss `step.ts:578,587`
   (auto-aim) or the three `buildings.ts` turret sites and allies will be shootable or
   auto-targeted in Teams. (§3, Task A3.)
3. **`startMatch` bot-fill seats a bot in every empty slot** — it will fill a `closed`
   slot unless explicitly skipped (`room.ts:446-479`). (Task C2.)
4. **`room-full` is checked *after* routing, and the code carries no size/mode.** A
   client can be sent to a room it didn't want; advertisement (C3) is what prevents the
   surprise, not the join check. (§4.)
5. **Fleet density counts rooms, not seats** (`allocator.ts:251-258`). Advertising
   variable sizes without F1 lets the allocator over-pack big rooms; only reactive
   event-loop lag catches it. (Task F1.)
6. **Sparse rosters break `PlayerId`-as-index assumptions.** Compact to dense 0..N-1 at
   world-build (§S2, Task A1); do not carry lobby slot ids {0,2,5} into the sim.
7. **Teams must NOT touch the snapshot.** Allegiance is static config; put `team` on
   `matchStart`/entity-events, never the per-tick wire, or you inflate the 494-B budget
   for nothing. (§S2.)
8. **Max-player caps (`MAX_PLAYERS`, 3-bit owner) are fine for 2..8 but hard-block >8.**
   Do not "helpfully" raise the ceiling; N ≤ 8 is the ratified range. (§2.)
9. **`maps.test.ts` pins `toHaveLength(8)` and diamond 4×4** at N=8 (`maps.test.ts:139,
   306`); generalising any map breaks these until the tests are swept over N. (Task B.)
10. **Stale balance docs:** `docs/bot-balance-day4.md` and `harness/balance.ts` say
    `COLLAPSE_CORE_DECAY = 0`; the shipped value is 1 (`constants.ts:553`) and it is why
    matches cap at 14.17 min. Do not "restore" 0. (§S4.)
11. **Odd N and unequal teams are already reachable** the moment `closed` exists (close 1
    of 8 → N=7). The sim handles odd N (win guard is `< 2`); the open design decision is
    whether the *lobby* lets a host make a 3v1 (Question 2), not whether the sim can run
    one.

---

## QUESTIONS FOR THE DEVELOPER

Only a human can ratify these; the Director takes the doc from here.

1. **Per-layout: empty derelicts, regenerate, or per-N variants?** octagon regenerates
   cleanly (equal gaps at any N) and oval is a one-line generalisation. compass and
   diamond have no natural 2..7 truncation — their whole character (corner/edge cover,
   outer/inner asymmetry) is an 8-point construction. Three options:
   (a) **regenerate** — accept that compass/diamond become "degraded but fair" equal-gap
   rings below 8 (loses their signature geometry at small N);
   (b) **derelict-fill** — always place 8, activate N, leave `8-N` as unowned derelict
   planets, preserving every layout's shape at any N;
   (c) **per-N variants** — hand-authored small-N boards per layout (most work).
   *Recommendation:* (a) for octagon/oval, (b) for compass/diamond — you keep all four
   maps at every N with the least new geometry. **1b — if derelict-fill: are derelicts
   lootable** (do they carry a home field of ore anyone can scavenge, matching the GDD's
   wreck-as-loot theme, §2.7), or inert scenery?

2. **Unequal team sizes allowed?** The moment slots can be closed and assigned to teams,
   a host can build 3v1 or 3v2. *Recommendation:* **allow it** — forbidding it means
   enforcing equal splits in the lobby (extra rules, and it blocks legitimate
   handicap/co-op-vs-bots play), and the sim already handles any split. Surface the
   imbalance in the lobby (team counts shown), don't prevent it. Confirm, or specify a
   "teams must be within ±1" rule.

3. **Friendly fire — on or off in Teams?** *Recommendation:* **off** (allies' shots pass
   through, turrets/auto-aim ignore allies) — it is the zero-cost default of the single
   `areEnemies` predicate and matches the "alliance" intent. Confirm, or ask for
   ship-only friendly fire (allies can hit each other's hulls but not homes).

4. **Team colour/nameplate treatment.** `PLAYER_COLORS` is 8 fixed identity colours by
   slot. *Recommendation:* **keep the 8 identity colours** and add a team indicator
   (nameplate underline + shared beacon-ring motif), so individual ships stay legible on
   a chaotic screen (the style guide's whole point). Confirm, or ask to re-key colour by
   team (2–4 team colours, losing per-player identity). This is a `style-guide.md` touch,
   so it routes through the Director/Art agent.

*(Secondary, safe to default if unanswered: minimum size to start = 2, minimum 1 player
per team in Teams, host may set a bot's team.)*
