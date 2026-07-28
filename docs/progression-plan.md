# Meta-Progression — XP, Levels, Unlocks (Spike s4)

**Owner:** Architect · **GDD:** §2.1, §2.5, §2.8, §2.11, §4.2 (m9/online), §4.6 · **Status:**
decided, task-broken, **awaiting developer ratification on the fairness stance and five
other questions** (bottom of doc).

This spike **decides**, in the mold of `docs/netcode-spike.md` and
`docs/variable-slots-plan.md`: measurements over intentions, every claim reproducible, and
the traps written down for the agents who implement. The developer's ask (2026-07-27):

> "I'd like to build an XP/LVL system… for now undecided what it does, but eventually
> players unlock things… perhaps a skill tree with powers for their ships."

Reproduce the one thing this spike measured rather than invented — what a real headless
match *pays* a player in accrual events at today's shipped constants, and what that becomes
in XP:

```
npx vite-node spikes/progression/measure-xp.ts   # prints the accrual + XP + level-curve tables
npx tsc --noEmit                                  # the shipped tree still type-checks
```

The measurement code is throwaway (`spikes/progression/`, excluded from `tsconfig.json`'s
`include` and from the build). It reuses the shipped QA harness (`harness/match.ts`)
**unmodified** — the harness hands every tick to an `onTick` hook and hands back the finished
`World`; the spike observes per-player accrual by **diffing world state each tick**, because
the sim keeps no per-player counters (only the match-wide ore ledger,
`src/sim/ore-ledger.ts`). Harness strategies (`miner/turtle/rusher/raider`) stand in for the
shipped bot trees, exactly as the netcode and variable-slots spikes stand in for the real
sim — so read the *shape*, not the third decimal.

---

## DECISION (up front)

1. **Ship XP + levels + a local profile NOW; unlocks are a SEPARATE, gated decision.**
   Phase 1 (§5) is XP accrual, a level curve, and the three UI moments (XP bar, level-up,
   end-screen summary) with local persistence and **no unlocks at all**. It is fairness-neutral
   by construction, so it ships regardless of how the developer rules on powers. Unlocks are
   phase 2 and hang entirely on the fairness question (§3).

2. **Almost the whole XP economy is derivable from state the sim already produces — with
   exactly one exception: kills.** Ore gathered, ore deposited, structures built, ship
   upgrades bought, core repairs, waves survived, and match placement are all observable by
   watching world deltas — Phase 1 needs **zero sim changes** to pay them. The sim tracks
   **no killer** (`main.ts:1390` says so outright; `killShip`/`damageShip` in
   `src/sim/damage.ts` take no attacker), so **kill/assist XP is the one accrual event that
   needs a new sim hook** — a `by: PlayerId` credit on the damage/kill path. Sized in §1, not
   built here.

3. **Persistence rides the seam settings already use.** A single JSON profile under a new
   `planet-rush:profile` key over `platform.storage` (`src/platform/platform.ts:35-39`),
   read defensively like every other setting. For **m9 online, which has NO ACCOUNTS**, the
   server-ready shape is a **signed local profile** — the client is the store of record and
   the server HMAC-*vouches* for integrity — modeled directly on the existing signed ticket
   (`src/net/ticket.ts`). Account-grade, tamper-proof persistence is **post-launch** and is
   sized, not built (§2).

4. **Fairness stance (the big one) — recommend COSMETIC + bounded SIDEGRADES, gated by the
   balance harness.** Unlocking *powers* breaks the game's core invariant (fairness at every
   N), so this is the developer's call, not the Architect's. The honest option space and a
   reasoned recommendation are §3; the ≤55% win-rate gate (`harness/balance.ts`) is the
   instrument that keeps a sidegrade honest.

5. **Level curve: `xpToNext(L) = base · L^exp`** — early levels come in under a match each,
   the pace is one `base` and one `exp`, both `TUNABLE`. Measured against real match pay in
   §1.

---

## 1. THE XP ECONOMY — MEASURED, NOT INVENTED

### 1.1 The accrual events, and which are free

Nine candidate events, with a proposed opening weight. The **Source** column is the honest
one — it says whether an event costs a sim change to pay:

| Event | Proposed weight (set A) | Source — how it's paid | Sim change? |
|---|---|---|---|
| **Ore gathered** (mined + scavenged) | 1 / ore | Σ positive Δ`ship.cargo` | none |
| **Ore deposited** (banked) | 2 / ore | Σ positive Δ`ship.banked` | none |
| **Structure built** (turret/shield order) | 12 / each | new `BuildJob.id` in `planet.builds` | none |
| **Ship upgrade bought** (one tier) | 20 / tier | Σ positive Δ Σ`ship.tiers` | none |
| **Core repair** (one discrete tap) | 3 / repair | Σ positive Δ`planet.coreHp` ÷ 15 | none |
| **Wave survived** | 15 / wave | `match.wavesSpawned` at your death | none |
| **Match placement** | 20 / rung | `match.eliminated` order + `winner` | none |
| **Match won** | 200 flat | `match.winner === you` | none |
| **Kill** (ship or core) | 25 / kill | — **no attacker recorded** — | **one hook** |

Deposits are weighted **2× gathered** on purpose: gathering is the *effort*, banking is the
*result the design rewards* (held ore is not safe, GDD §2.3), so XP nudges toward the loop's
payoff the way the economy does. Structures and upgrades pay per-purchase (an ore sink you
chose over mining). Everything but the last row is free to pay in Phase 1.

**The kill gap, stated plainly.** `killShip(world, ship)` and `damageShip(world, target,
amount)` (`src/sim/damage.ts:25,37`) carry no source, and `destroyCore`
(`src/sim/match.ts:92`) carries none either — a core just reaches zero. So today there is
**nobody to credit a kill to**. The hook is small and localized: thread an optional
`by?: PlayerId` down `damageShip`/`damagePlanet` → `killShip`/`destroyCore`, and record the
last enemy to damage a hull/core (an "assist" is any *other* enemy who damaged it inside a
short window). It is a Gameplay-Engineer change, it must stay **write-only** like the ore
ledger so it never perturbs a determinism hash (GDD §4.8), and until it lands, kill-XP cannot
be per-player real. **Recommendation: ship Phase 1 with kills OFF, and add the attribution
hook as the first task of the unlock phase** — so the economy a player sees is honest from
day one rather than crediting kills to nobody.

### 1.2 What a match actually pays — measured

From `npx vite-node spikes/progression/measure-xp.ts`, seeds 1..24, N=8, octagon, shipped
§2.8 constants. Per-player, per match (one row = one player's whole match):

```
                             gathered  deposit  struct   upgr  repair  waves  estKill  secs
  mirror miner  (passive)  med  58.8    24.4     0.0     7.0    0.0     5.0    10.2     734
  mirror turtle (builder)  med  36.6    28.7     6.0     0.0    0.0     5.0     4.4     850
  mirror raider (aggro)    med  17.7     0.9     0.0     1.0    0.0     5.0    36.9     850
  round-robin mix (lobby)  med  11.0     4.1     0.0     0.5    0.0     2.0    15.9     347
```

Read the caveats with the numbers — they are the honest half:

- **The harness probes under-build and never repair.** `struct` and `repair` are `0` at the
  median in every lobby *except* the turtle mirror (`struct` 6). That is the *probe*, not the
  design: miner/raider strategies pour ore into mining and aggression, not defenses, and no
  probe taps repair in a mirror it is winning. The turtle mirror proves structures pay (6
  builds, 28.7 deposited); the round-robin *mean* shows building and repair do happen in a
  mixed lobby (`struct` 1.1, `repair` 0.3) — just rarely. **QA re-baselines this at m10 with
  the shipped bot trees and real human play**, exactly as the balance constants are
  re-baselined. Structures/repair XP is measured here as a *floor*, not a typical.
- **`estKill` is aggregate, not attributed.** It is total ship-deaths in the match ÷ N — a
  measurable proxy for "how much killing happened," not a per-player credit. An aggressive
  raider lobby sees ~37 ship-deaths per player-share; a passive miner lobby ~10. The real
  per-player number arrives only with the attribution hook (§1.1).
- **N=8 is the stingy end.** Per-player ore density rises ~4× as N falls (the finite field is
  split across fewer homes — s1 §1, `homeFieldOre(n)`), so a 3-player match pays *more*
  gathered/deposited XP per head. Weights are tuned against the N=8 floor so no size feels
  starved.

### 1.3 XP per match under three weight sets

Same run, three candidate weight sets (full weights in `spikes/progression/measure-xp.ts`).
Median player / winner-median / first-out-median, and the winner:loser spread:

```
weight set A "economy-forward"        median  winner  firstOut  spread
  mirror miner  (passive)               639     716     584      1.2x
  mirror turtle (builder)               421     491     353      1.4x
  mirror raider (aggressive)           1116    1186    1051      1.1x
  round-robin mix (lobby-like)          597     789     471      1.7x
  → typical match pays median 634 XP, mean 713 XP (all player-matches)

weight set C "participation-flat"     median  winner  firstOut  spread
  round-robin mix (lobby-like)          524     619     416      1.5x
  → typical match pays median 578 XP, mean 638 XP (all player-matches)
```

(Set B "combat-forward" — kills ×60 — pays ~1050 median but is the least honest today: it
leans hardest on the un-attributed kill estimate, so it is the weight set that *most* needs
the hook before it means anything. It is in the spike output for completeness.)

**Two findings that matter more than the exact weights:**

1. **The floor is high and the spread is small** — winner:first-out is **1.1–1.7×**, never
   the 5–10× a kill-only economy would produce. That is the design intent: XP is a *hook*
   that rewards *showing up and playing the loop*, so a player who loses their first eight
   matches still climbs. The spread is entirely tunable through the `win`/`placeStep` weights
   — raise them and winning matters more; the measurement is what lets that be a dial rather
   than a guess.
2. **A "typical" match pays ~600 XP** (set A/C median), an aggressive one ~1000+. That is the
   anchor the level curve is sized against.

### 1.4 The level curve — early-fast, pace on one dial

`xpToNext(L) = base · L^exp`, sampled at `base = 300`, `exp = 1.6` (both `TUNABLE`):

```
level   toNext   cumTotal   matches @600XP
  2       300       300        0.5
  3       909      1209        2.0
  4      1740      2949        4.9
  5      2757      5706        9.5
  6      3940      9646       16.1
  8      6750     21670       36.1
 10     10090     40117       66.9
 15     20461    120594      201.0
 20     33352    260633      434.4
```

**Level 2 lands inside a single match** (the hook — you level up your first game), levels
3–5 across a handful, and the curve then stretches so level 20 is a long-tail goal
(~430 matches). The two knobs do exactly what a designer wants: **`base` moves the whole
early game** (how fast level 2–5 arrive), **`exp` moves the tail's steepness** (how far
apart the high levels sit). Because the curve is measured against real match pay, "how many
matches to level 10?" is an answer, not a hope — and if the developer wants level 10 to feel
like a season's worth, that's `exp`; if they want it in a week, that's `base`.

---

## 2. PERSISTENCE ARCHITECTURE

### 2.1 Local-first, shipping NOW — the seam settings already use

The game has exactly one persistence seam: **`platform.storage`**, a synchronous string
key/value wrapper over `localStorage` (`src/platform/platform.ts:35-39`). Every persisted
value today is a bare string under a flat `planet-rush:*` key (fire mode, control scheme,
hull, name, map, haptics) — read *defensively*, folding any missing/corrupt value to a safe
default (`readFireMode`/`readControlScheme`/`readMapId`, `main.ts:4061-4103`). There is **no
profile, no career, no stored identity** today — a progression record is the first
structured, post-match-mutated thing the game persists.

**The recommended shape — one JSON blob, one key, one versioned reader:**

```ts
// src/progression/profile.ts (new; takes platform.storage by injection, like haptics).
export interface Profile {
  v: 1;                     // schema version — the FIRST versioned payload in the store
  xp: number;               // lifetime XP
  level: number;            // derived from xp, cached for the UI
  matches: number;          // lifetime matches played
  // phase 2 only, behind the fairness ruling:
  unlocked?: string[];      // node ids the player has bought
  points?: number;          // unspent skill points
}
const PROFILE_KEY = 'planet-rush:profile';           // flat prefix, like every other key
```

**Boundaries, and the traps the seam sets:**

- **Inject the seam, don't reach for `localStorage`.** Copy `createBrowserHaptics(platform.storage)`
  (`main.ts:264`) — a progression module that takes `platform.storage` as a constructor
  dependency tests headless and never touches a browser global.
- **The store holds strings only.** The profile must `JSON.stringify` on write and
  `JSON.parse` + **validate every field** on read (fold a corrupt blob to a fresh profile,
  exactly like `readMapId`). This is the first payload that needs a `v` version field — none
  of the existing readers have one, so establish the convention here.
- **The seam has no `remove` and no `keys`** (`platform.ts:36-39`) — only `get`/`set`. A
  "reset my progress" button and any future migration/enumeration **need an interface
  extension** (add `remove(key)`; the sole implementation to touch is `platform.ts:104-119`).
  Size that into the reset task, don't discover it.
- **XP is banked at match-end, once.** The end-of-match summary (§5) is the single write
  site — compute the match's accrual, add to the profile, persist. Never write mid-match (a
  crash mid-match should cost at most the current match, and the sim must never depend on the
  profile — determinism, GDD §4.8).

### 2.2 Server-ready, and the wall it hits: m9 has NO ACCOUNTS

The online stack has **no accounts, no login, no usernames, no persistent identity**. A
player online is a **WebSocket connection + a slot index** (`PlayerId`); the only per-player
secret is an **ephemeral reclaim token** that dies with the match's ~60 s grace window
(`server/room.ts:342`). The server and allocator hold **zero durable storage** — every
stateful structure is an in-memory `Map`, and the registry is documented as "**a cache, not
a database**" (`allocator/registry.ts:5`). So "server persistence" collides head-on with
"there is no server-side per-player record to persist, and no identity to key one on."

Three honestly-scoped options, in ascending cost:

| Option | What it is | Trust / tamper | Where it sits in the m9 chain | Verdict |
|---|---|---|---|---|
| **(a) Signed local profile** | Client stores the profile; on `join` it presents it and the server HMAC-*vouches* it hasn't been edited *this session* — modeled on `src/net/ticket.ts` (`TicketClaims`/`signTicket`/`verifyTicket`, HMAC-SHA256, `node:crypto`, no new dep). | **Soft.** The owner still owns their `localStorage` — they can reset or clone their own profile. The signature stops *mid-session forgery over the wire*, not offline self-editing. Fine for XP/level/**cosmetic** unlocks; **not** safe to gate a *power* on (§3). | Adds a `profile?: string` field beside `JoinMessage.ticket`; the server checks the signature in `admitsJoin` (`match-server.ts:231`). **No new storage, no accounts.** | **Recommended for m10** if unlocks are cosmetic/sidegrade. |
| **(b) Room-scoped, server-minted** | XP earned in a match is minted *by the server* for that match only and handed back signed at match-end; the client banks it locally. | **Medium.** The server authors the XP, so in-match earning can't be inflated — but there's still no durable identity, so the *bank* is the client's, same soft floor as (a). | The match server already computes the end state; it signs an "earned XP" claim at teardown, like a reverse ticket. | **Recommended pairing with (a)**: server mints, client banks — earning is trustworthy, storage stays account-less. |
| **(c) Real accounts** | A durable identity (device id at minimum, login at most) keying a server-side KV/Redis profile. | **Hard.** The only option that survives a wiped `localStorage` and resists offline editing — required if a *power* unlock must be un-cheatable in ranked play. | **Net-new subsystem.** The allocator's registry already anticipates a Redis seam (`registry.ts:26-28`) — that is the insertion point — but it needs an identity to key on, which **does not exist today**. Explicitly post-launch (`docs/mobile-cross-platform-amendment.md:106`: "accounts… are a post-week item"). | **Do NOT build in this spike or at m10.** Size it; gate it behind a real "ranked" need. |

**The load-bearing conclusion for §3:** with only (a)/(b) available before accounts, the
persistence layer *can* be trusted to store a cosmetic or a bounded sidegrade, but it
**cannot be trusted to gate a competitive power** — a determined player edits their own
profile. That is not a bug to fix; it is the reason the fairness recommendation lands where
it does. (Absent doc note: `docs/hosting-plan.md` is still referenced across the allocator
but not in the repo — the account-persistence sizing above belongs there or in a new brief
when accounts are ratified.)

---

## 3. THE FAIRNESS QUESTION — stated plainly for the developer

Planet Rush's core invariant is fairness: the field is rotationally symmetric so per-player
ore is *exactly* equal at any N (§2.1), classes are capped at a 55% win rate (§2.11), and QA
falsifies imbalance every build. **Unlocking a power that a new player does not have breaks
that invariant** — the match is no longer decided only by skill and the clock. This is a
design decision only the developer can make. The honest option space:

1. **Cosmetics only — fairness fully intact.** Unlocks are liveries, trails, nameplate
   flair, an end-screen badge. Two maxed and two fresh players are still mechanically
   identical. *Cost:* trivial, no sim change, works with the soft signed profile (§2.2a).
   *Risk:* none to balance; the progression carrot is pure vanity.

2. **Powers as bounded SIDEGRADES — fairness *verified*, not assumed.** Each unlock is a
   *lateral* nudge to an existing tunable, not a straight buff: `+X here, −Y there`, and
   **every unlock must pass the balance harness** — an unlock loadout may not exceed a 55%
   win rate against the stock loadout (a new sweep dimension, `harness/balance.ts`). A player
   trades reach for a slower deposit, say — different, not stronger. *Cost:* a per-player
   modifier seam in the sim (see the trap below) + a gating sweep per node. *Risk:* bounded
   and measured, but "truly lateral" is hard to tune and QA owns proving it every build.

3. **Powers in unranked / vs-bots only — fairness quarantined.** Full power progression, but
   only in offline and casual lobbies; ranked/online runs stock loadouts for everyone. *Cost:*
   a "ranked" flag on the match config and a mode-scoped tree (§4 shape 3). *Risk:* splits the
   population and the content; ranked becomes the "real" game with no progression in it.

4. **Full power progression — fairness becomes matchmaking's problem.** Maxed players are
   simply stronger; the game leans on level-based matchmaking to pair similar players. *Cost:*
   matchmaking by level — which needs **accounts** (§2.2c) to even measure level reliably, and
   a much larger balance surface. *Risk:* highest; it is a different game, and it contradicts
   the account-less m9 design and the "fair at every N" invariant.

**Recommendation: (1) cosmetics for sure, plus (2) bounded sidegrades gated by the balance
harness — with (3) mode-scoping held in reserve as the escape hatch for anything that fails
the sidegrade gate.** Reasoning: it keeps the core invariant honest (every sidegrade is
*proven* ≤55%, not hoped), it works with the account-less soft profile (a sidegrade that is
genuinely lateral is not worth cheating for — the whole point of bounding it), and it gives
the developer a graceful fallback: any node that QA cannot get under the ceiling as a
sidegrade either becomes a cosmetic or moves to an unranked-only tree, rather than shipping
imbalanced. **Option 4 is not recommended** — it fights the account-less design, the fairness
invariant, and the matchmaking the game does not have. **The developer rules; this is the one
question the rest of the plan branches on.**

---

## 4. SKILL-TREE SHAPES — three sketches, grounded in real tunables

Every node below is a nudge to a constant that **already exists and is already `TUNABLE`** in
`src/sim/constants.ts` — so these are buildable, not fiction. The architecture note that
falls out of all three: **unlocks-as-stat-mods need a per-player modifier seam in the sim.**
Today every constant is global; a node that gives *one player* `+tractor reach` means the
derived-stat functions (`miningRate`, `shipCargoCap`, `shipMaxHull` in `src/sim/upgrades.ts`,
and the turret/tractor/deposit reads) must consult a per-player modifier set. That set is
**static match config** — it must ride `matchStart`/entity-events like `team` and `shipClass`
do, **never the per-tick snapshot** (the same Trap 7 the variable-slots spike calls out), and
it must fold into the determinism hash as plain ints.

### Shape 1 — Per-ship-class trees (four trees, one per hull)

One tree per class, nodes reinforcing the class fantasy. Example (Excavator, the mining
engine):

| Node | Touches (`constants.ts`) | Sidegrade framing |
|---|---|---|
| Deep Reach | `TRACTOR.range` 120→140 | +reach, −`TRACTOR.accel` (chunks drift in slower) |
| Fast Unload | `DEPOSIT.drainRate` 2→3 | +deposit speed, −`DEPOSIT_RANGE` (must hug the planet) |
| Rich Veins | `MINING_YIELD_PER_HIT` +10% | +mine, −`SHIP_WEAPON` range (shorter gun) |
| Ore Miser | `DEATH_ORE_DROP_FRACTION` 0.5→0.4 | keep more on death, −`BASE_SPEED` (slower haul) |
| Reinforced Hold | `CARGO_CAP_MAX` 8→9 | +1 slot, −`BASE_ACCEL` (heavier) |
| Excavator's Grit | `SHIP_STATS.excavator.hull` +10% | +hull, −turn rate |

*Interceptor* tree would touch `SENSOR_RANGE`, `BASE_TURN_RATE`, spawn-shield; *Hauler*
`DEPOSIT.drainRate`, hull, `RESPAWN_S`; *Vanguard* a flexible spread. **Pro:** class identity
gets deeper — a maxed Excavator *feels* like the mining engine. **Con:** 4× the content, and
a maxed class tree is the case most likely to break the ≤55% class ceiling (§2.11), so QA
must re-sweep classes *with* trees. **What the harness must gate:** the per-class win-rate
sweep, re-run with each class at max tree vs stock field.

### Shape 2 — One pilot tree (shared across every hull) — RECOMMENDED

A single class-agnostic tree; the hull stays the identity, the pilot is the progression.
Eight nodes, each a lateral nudge:

| Node | Touches (`constants.ts`) | Sidegrade framing |
|---|---|---|
| Tractor Reach | `TRACTOR.range` 120→145 | +reach, −`TRACTOR.accel` |
| Quick Deposit | `DEPOSIT.drainRate` 2→2.6 | +drain, −`DEPOSIT_RANGE` 256→224 |
| Scavenger | loot-on-contact radius (`CHUNK` pickup) | +pickup, −`DEATH_ORE_DROP_FRACTION` gain: you drop more |
| Fast Respawn | `RESPAWN_S` 5→4 | −respawn, −`SPAWN_PROTECTION_S` 10→8 (up sooner, exposed sooner) |
| Long Shield | `SPAWN_PROTECTION_S` 10→13 | +invuln window, +`RESPAWN_S` 5→6 (slower back) |
| Scout Sensors | `SENSOR_RANGE` 180→220 | see enemy HP sooner, −own damage-ring range (they see you sooner too) |
| Muzzle Tune | `SHIP_WEAPON.projectileSpeed` +5% | harder-to-dodge shot, −`SHIP_WEAPON.range` (dies sooner) |
| Field Engineer | `TURRET.buildTime` −20% | faster turrets, +`TURRET` cost by 1 (pay for the hurry) |

**Pro:** least content (one tree), and class identity stays in the hull, so the ≤55% *class*
ceiling is untouched by construction — only the pilot-vs-pilot sweep is new. **Con:** less
per-class fantasy than Shape 1. **What the harness must gate:** one new sweep — max-tree
pilot vs stock-tree field, ≤55%.

### Shape 3 — Mode-scoped trees (the fairness escape hatch)

Two trees selected by match config: a **ranked/online** tree of proven sidegrades (Shape 2's
gated list) and an **unranked/vs-bots** tree that may hold bigger *powers* that would never
pass the sidegrade gate — e.g. `+15% CORE_HP`, `REPAIR_HP_PER_ORE` 15→20, a tighter turret
`aimLatency`. Ranked runs the gated tree (or stock); casual runs the fun one.

| Node (unranked only) | Touches | Why it can't be ranked |
|---|---|---|
| Bastion Core | `CORE_HP` 100→115 | straight defensive buff — fails ≤55% as a sidegrade |
| Field Medic | `REPAIR_HP_PER_ORE` 15→20 | straight economy-of-defense buff |
| Sharpshooter | turret `aimLatency` −1 notch | straight turret accuracy buff |

**Pro:** lets the "powers for their ships" fantasy exist *somewhere* without touching ranked
fairness — the developer gets to say yes to powers and yes to fairness. **Con:** fragments
progression and needs a `ranked` flag on the match config (net-new). **What the harness must
gate:** nothing new for the unranked tree (it is *allowed* to be imbalanced vs bots); the
ranked tree is Shape 2's gate.

**Recommendation:** **Shape 2 (one pilot tree of gated sidegrades)** as the spine, with
**Shape 3's mode-scoping reserved** as the home for any node QA can't get under the ceiling.
Shape 1 is the most content and the most balance risk for the least architectural gain — its
class fantasy is better served by the *existing* per-class upgrade ladder (§2.5), which is
already balance-proven.

---

## 5. PHASE 1 CUT — what ships FIRST, regardless of the unlock decision

XP accrual + levels + the three UI moments with local persistence and **NO unlocks**. It is
fairness-neutral, needs **no sim change** (kills off until the attribution hook, §1.1), and
de-risks everything after it. Needs-ordered, TDD — each task names the test to write **first**.

### Task P1 — the profile module + defensive reader (UI Engineer)
*Test first:* a round-trip test — a fresh profile persists and reloads to equal itself; a
corrupt/absent blob folds to `{v:1, xp:0, level:1, matches:0}`; a future `v:2` blob does not
crash a `v:1` reader. *Change:* `src/progression/profile.ts` — `loadProfile(storage)` /
`saveProfile(storage, p)` over `platform.storage`, injected (mirror
`createBrowserHaptics(storage)`, `main.ts:264`), JSON-encoded under `planet-rush:profile`.
No sim import. **Trap:** the seam has no `remove` — the reset button (P5) needs the interface
extended first.

### Task P2 — the accrual observer (UI Engineer, reusing the spike's logic)
*Test first:* a fixed harness match with a scripted mining/depositing/building sequence
yields the expected gathered/deposited/structures/upgrades/repairs/waves/placement counts.
*Change:* promote `spikes/progression/measure-xp.ts`'s per-tick diff into
`src/progression/accrual.ts` — but drive it off the **live match's** per-tick world (the
render loop already holds it), not the harness. It stays **read-only over the world**, so it
cannot perturb the sim or its hash. Kills excluded (no source yet). **Trap:** observe on the
authoritative world online (the server's), not the predicted local one, or a mispredicted
tick double-counts.

### Task P3 — XP-to-level + the curve (UI Engineer)
*Test first:* `levelForXp(0) === 1`; the boundary xp values map to the right levels;
`xpToNext(L) = round(base·L^exp)` matches the table in §1.4. *Change:* `src/progression/curve.ts`
— pure functions, `base`/`exp` as exported `TUNABLE` constants.

### Task P4 — the three UI moments (UI Engineer)
*Test first:* the XP bar renders the correct fill for a given profile; a level-up fires
exactly once when a match's XP crosses a boundary; the end-screen summary lists each accrual
line with its XP. *Change:* an **XP bar** (persistent, small, near the existing HUD chrome),
a **level-up moment** (the GDD's "nobody jokes for three seconds" tone is for planet death —
a level-up is a bright Saturday-morning beat, §4.7), and the **end-of-match summary**
extended with an XP breakdown (it already exists for Rematch — GDD §3.7, cut-list item 3).
This is the single XP **write site**: compute → add → `saveProfile` → animate. **Trap:** write
once, at teardown; never mid-match.

### Task P5 — reset + the seam extension (Platform + UI)
*Test first:* `remove` deletes a key; "reset progress" restores a fresh profile. *Change:*
add `remove(key: string): void` to the `platform.storage` interface (`platform.ts:35-39`) and
its one browser impl (`platform.ts:104-119`); a settings-screen "reset progress" (behind a
confirm, like EXIT).

*(Phase 2, gated on §3 and NOT in this cut: the kill-attribution sim hook (§1.1), the
per-player modifier seam (§4), the chosen tree, the per-node balance sweeps, and — only if
powers go ranked — the signed-profile join field (§2.2) and eventually accounts.)*

---

## TRAPS (the ones that bite an implementer who skims)

1. **The sim tracks no killer.** `killShip`/`damageShip`/`destroyCore` take no attacker
   (`damage.ts:25,37`, `match.ts:92`; `main.ts:1390` says it in words). Kill/assist XP is the
   ONE accrual event that needs a sim change — do not assume you can read it off the world.
   (§1.1)
2. **No per-player counters exist** — only the match-wide ore ledger (`ore-ledger.ts`), which
   is aggregate, not per-slot. Per-player accrual is *observed*, by diffing world deltas.
   (§1)
3. **`platform.storage` is strings-only and has no `remove`/`keys`** (`platform.ts:36-39`).
   The profile must JSON-encode; a reset button needs the interface extended. (§2.1, Task P5)
4. **The profile is the FIRST versioned payload** — no existing reader has a `v` field. Add
   one and validate every field on read, folding corrupt to default like `readMapId`. (§2.1)
5. **m9 has no accounts and no server storage** — the server is ephemeral, the registry is
   "a cache, not a database." Server-authoritative persistence has no home; a signed *local*
   profile is the account-less answer, and it is only **soft**-trusted. (§2.2)
6. **A soft profile cannot gate a competitive power.** The owner edits their own
   `localStorage`; the signature stops wire-forgery, not offline self-editing. This is *why*
   powers must be sidegrades or unranked, not because of effort. (§2.2, §3)
7. **Unlock modifiers are static match config — keep them OFF the per-tick snapshot.** Like
   `team`/`shipClass`, a per-player modifier set rides `matchStart`, folds into the
   determinism hash as ints, and never inflates the snapshot budget. (§4, and s1 Trap 7)
8. **XP is written once, at match-end, and the sim must never read the profile.** A profile
   read inside `step` would break determinism (GDD §4.8) and desync online. Observe the
   world; write the profile at teardown. (§5)
9. **Every sidegrade node re-opens a balance sweep.** A per-class tree (Shape 1) re-opens the
   §2.11 class ceiling; any tree re-opens a new pilot-vs-field sweep. Budget QA time per node,
   not per tree. (§3, §4)
10. **Harness build/repair numbers are a floor, not a typical.** The QA probes under-build;
    real bot trees and humans build more. Do not size structure/repair XP off the median-0
    rows — re-baseline at m10. (§1.2)

---

## QUESTIONS FOR THE DEVELOPER

1. **The fairness stance (the one everything branches on).** Cosmetics only, bounded
   sidegrades (balance-harness-gated ≤55%), powers in unranked/vs-bots only, or full power
   progression? *Recommendation:* **cosmetics + bounded sidegrades, with mode-scoping held in
   reserve** (§3). Phase 1 ships regardless; this decides Phase 2.
2. **Is XP / level visible to *other* players?** A level badge on a nameplate is identity;
   it is also information a rival reads. *Recommendation:* **show your own level in the HUD
   and end-screen; show others' only as an optional cosmetic badge, never as a stat** — the
   game already fogs enemy *HP* on purpose (§2.2), and a broadcast power-level would fight
   that. Confirm.
3. **Per-pilot or per-class progression?** One shared pilot tree, or a tree per hull?
   *Recommendation:* **one pilot tree** (§4 Shape 2) — the per-class fantasy is already served
   by the balance-proven upgrade ladder (§2.5), and one tree is the least content and least
   balance risk. Confirm, or ask for per-class.
4. **Reset policy.** Is progression ever wiped — never, per-season, or player-initiated only?
   *Recommendation:* **player-initiated reset only** for launch (a settings button behind a
   confirm, Task P5); seasons need accounts (§2.2c) and are post-launch. Confirm.
5. **Does XP earn OFFLINE / vs bots count the same as online?** *Recommendation:* **yes, same
   XP** — the offline game is a first-class product (GDD §4.3, risk 6), and the account-less
   design means there is no ranked/casual XP distinction to enforce anyway *until* powers go
   ranked. If powers ever go ranked-only (§3 option 3), revisit. Confirm.
6. **Kill/assist XP — worth the sim hook now, or defer?** It is the only accrual event that
   needs a Gameplay-Engineer change (§1.1). *Recommendation:* **defer to Phase 2, ship Phase 1
   with kills off** — so the XP a player sees is honest (credited to a real player) from day
   one rather than estimated. Confirm.

*(Secondary defaults, safe if unanswered: level curve `base=300`/`exp=1.6` (level 2 in one
match, level 10 at ~67); XP banked once at match-end; deposits weighted 2× gathered.)*

---

## GDD SECTION DRAFT (lands in the GDD when ratified — currency policy §2)

> ### 2.12 Meta-progression: XP, levels, and unlocks *(pending ratification — Architect spike
> s4, `docs/progression-plan.md`)*
>
> A player earns **XP** every match for playing the triangle — ore gathered and banked,
> defenses built, ship upgraded, core repaired, waves survived, and how they placed — and
> levels up on an early-fast curve (`xpToNext = base · L^exp`, both `TUNABLE`; level 2 lands
> inside a first match). XP is **cosmetic-neutral by default**: it is a hook that rewards
> showing up and playing the loop, and a losing player still climbs, so it never bends the
> match's fairness. Progression persists **locally**, in the same `platform.storage` family as
> settings, as a single versioned profile; online, where the game has **no accounts** (§4.2),
> the profile is **client-owned and server-vouched** (an HMAC signature modeled on the room
> ticket), never a server-side account — so persistence costs the account-less design nothing.
>
> **Unlocks are bounded, or they are cosmetic.** The game's core invariant is fairness at
> every N (§2.1, §2.11), so an unlock may be a **cosmetic** (livery, trail, badge — fairness
> untouched) or a **bounded sidegrade** (a lateral trade to an existing tunable — `+reach` for
> `−deposit range`, say) that **must pass the balance harness at ≤55% win rate** against the
> stock loadout before it ships. Anything that cannot be made lateral lives in **unranked /
> vs-bots** play only, never in a fair match. Skill points buy nodes on a single **pilot
> tree**; the hull remains the identity (§2.11). *(The exact node list and the ranked-power
> stance are the developer's ratifications — see the spike.)*

*End of spike s4. Phase 1 is fairness-neutral and shippable today; Phase 2 branches on
Question 1.*
