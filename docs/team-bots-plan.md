# Team bots — how allied bots strategize together (Spike s5-01)

**Architect spike, 2026-08-05.** The developer asked whether bot behaviour accounts for
teams at all (it does not), and then ratified the direction:

> *"they need to strategize together if they are on teams, like humans would"*

That is the design; this document is not a debate about whether. It is **how**, in what
order, without breaking fog honesty, determinism, or FFA. **No behaviour ships in this
PR — the plan is the product.**

Everything numeric below comes from `spikes/team-bots/measure-team-gaps.ts`, which runs
the real shipped trees in a real team-aware world. Re-run it with:

```
npx vite-node spikes/team-bots/measure-team-gaps.ts
```

---

## DECISION (up front)

1. **Coordination is two layers, not one.**
   **Layer A — HUD parity (free, and not a comms channel).** In TEAMS a human *already*
   hears their teammate's under-attack klaxon, map-wide, with no scouting
   (`src/art/audio/engine.ts:263,273`; `src/art/presenter.ts:153,248`). A bot's view is
   defined as "what a human in that cockpit could perceive" (`src/bots/perception.ts:1-31`),
   so giving a bot the same ally alarm is **parity, not telepathy**, and denying it makes
   bots worse than a human for the wrong reason — the identical argument
   `src/bots/memory.ts:1-24` already makes about fog-*amnesia*.
   **Layer B — a bounded callout radio.** For everything the HUD does not carry
   (sightings, intent, calls for help), allied bots exchange **observations they
   legitimately made**, over an explicit channel with latency, a miss rate, a cooldown, a
   fixed capacity, and decay. Nobody learns what no teammate saw.

2. **The radio lives beside the simulation, never inside it** — same discipline as
   `Brain` (`src/bots/tree.ts:41-45`) — and delivery is **strictly time-ordered with a
   minimum delay of one full tick**, so no callout is ever readable in the tick it was
   sent and bot iteration order (`src/bots/harness.ts:123`) cannot affect any decision.

3. **FFA degrades to nothing structurally, not by a flag.** A team of one has no
   recipients, so `send` reaches nobody and `receive` returns nothing. The radio object
   is `null` for a solo team; every ally read is an empty list.

4. **Four stages, cheapest-and-most-foundational first**, each independently shippable
   and independently valuable: **win-condition model → ally defence → field division →
   focus fire and roles.** Cooperation quality is a **difficulty dial** — Easy bots
   coordinate badly on purpose.

5. **Two things are NOT in this plan and must not be re-planned into it.** Ally
   *targeting* (never lock, never siege, never "meet" a teammate) is **p16-01**, already
   briefed; it is the `variable-slots` Task A4 that never shipped
   (`docs/variable-slots-plan.md:352`). And whether a player whose own home dies keeps
   flying while their team lives is a **sim/design decision only the developer can make**
   — see Question 1. Stage 1 is written both ways.

---

## 1. CURRENT STATE, PRECISELY

### 1.1 There is no ally concept in the strategy layer

`grep -rn "team" src/bots/` returns **nothing** — not in `behaviors.ts`, `tree.ts`,
`targeting.ts`, `memory.ts`, `personalities.ts`, `perception.ts`, or any tier file.
Nothing in `src/bots/` imports `src/sim/allegiance.ts`, the sim's single friend/foe
predicate (`src/sim/allegiance.ts:49`).

Concretely, every "who is that?" read in the bot layer is **distance-only**:

| Read | Where | What it does in TEAMS |
|---|---|---|
| `isEngageable(ship)` | `targeting.ts:113` | alive ∧ not eliminated ∧ not spawn-protected. **A teammate passes.** |
| `homeIntruder(ctx)` | `targeting.ts:146` | nearest engageable ship inside `HOME_ALARM_RANGE`. **A teammate flying home is an "intruder".** |
| `nearestEnemy(ctx)` | `targeting.ts:163` | nearest engageable ship in view. **Named "enemy"; not one.** |
| `nearestThreat(ctx, r)` | `behaviors.ts:575` | drives the whole flee band. **A bot flees its own teammate.** |
| `bestTarget(ctx)` | `targeting.ts:440` | scores every ship and every non-own station. **Allies included.** |
| `leaderStation(ctx)` | `targeting.ts:502` | "who is winning". **An ally can be the leader Medium gangs up on.** |
| `nearestLivingRival(ctx)` | `targeting.ts:478` | the collapse-phase hunt target. **An ally's home counts as a rival.** |
| `pathClearance(ctx,to)` | `targeting.ts:209` | discounts a rock whose approach a ship sits on. **A teammate spoils your rock.** |

### 1.2 A bot cannot learn its own side even if it wanted to

`BotSeat` is `{id, personality}` (`src/bots/bot.ts:53-56`). `botLobby(seats)` maps a seat
to `{id, shipClass}` and drops everything else (`src/bots/harness.ts:78-80`). `SelfView`
and `PerceivedShip` carry no `team` (`src/bots/perception.ts:120-139,181-215`).

So **the shipped bot path cannot express a team match at all.** The offline client builds
one only because `src/platform/match-boot.ts:101-108` stamps `PlayerSpec.team` onto the
roster *after* the bot seating, and the QA harness only because `harness/match.ts:213-235`
has its own `teamsLineup` for the probe strategies. The spike had to do the same by hand
(`spikes/team-bots/measure-team-gaps.ts`, `build()`). **That is finding zero, and it is
Stage 1's first task.**

### 1.3 The sim is fully team-aware — so a bot's model of *winning* is wrong, not merely unsophisticated

`resolveWinner` counts distinct surviving **teams**, not cores (`src/sim/match.ts:296-324`):
a side plays on while any ally's core lives, a 2v2 ends when the opposing side loses its
last core even if the winners hold two homes, and a same-tick tie resolves through
`match.eliminated`. Meanwhile every bot read above is *me*-shaped.

**The measured consequence** (spike, 8 seeds per lineup, FFA at the same sizes as the
control — a control that reads 0.0% everywhere, which is what proves the instrument):

| lineup | mean length | ended | `hunt` → ally | `leader` → ally | `bestTarget` → ally | `homeIntruder` → ally |
|---|---|---|---|---|---|---|
| FFA 4 (control) | 845 s | 8/8 | 0.0% | 0.0% | 0.0% | 0.0% |
| **TEAMS 2v2** | 847 s | 8/8 | **62.7%** | **65.9%** | **85.6%** | **95.1%** |
| FFA 8 (control) | 826 s | 8/8 | 0.0% | 0.0% | 0.0% | 0.0% |
| **TEAMS 4v4** | 850 s | 8/8 | **85.8%** | **63.6%** | **87.1%** | **95.5%** |

Raw counts, 2v2 / 4v4: hunt 33718/53752 and 91973/107248; leader 35414/53752 and
68190/107248; target 40402/47191 and 91887/105454; intruder 14171/14899 and 57728/60418.

Read the last column out loud: **in a team match, 95% of the ships a defending bot turns
to "meet" at its own front door are its own teammates.** The defend branch
(`behaviors.ts:437-443`) fires, the bot flies to `engage`, friendly fire is off
(`allegiance.ts:90-94`) so the shots pass through, and the actual attacker is ignored.

**Attribution, stated so this plan is not credited with someone else's work:** the
`bestTarget` and `homeIntruder` columns are **p16-01's** to close, and the `hunt` and
`leader` columns are *win-condition* reads — mine, Stage 1. A per-entity ally filter fixes
the first pair; it does **not** fix `nearestLivingRival`/`leaderStation`, because those
are not asking "may I shoot this?" but "who am I trying to outlast?".

### 1.4 What a bot does when its OWN home is dead but its team lives

The brief asks whether it plays on coherently. **It does not play at all.** `destroyCore`
→ `eliminate` kills the owner's ship, sets `eliminated`, and zeroes the respawn timer
unconditionally — no team check (`src/sim/match.ts:136-152`). `step` never revives an
eliminated ship (`src/sim/step.ts:191-202`). The bot harness then emits `NO_ACTIONS`
(`src/bots/harness.ts:145`).

So the GDD is internally inconsistent and the sim picked a side: §1's loss condition says
*"in Teams, your whole side is eliminated when its last reactor dies"*, while §2.7 says
*"when a station's reactor is destroyed, its owner is eliminated"* — and the code
implements §2.7.

Measured, this state is real and not rare: a team spends **6 s/match (2v2)** and
**34 s/match (4v4)** holding a core with a dead member, and bots spend **~51 s/match
(4v4)** sitting eliminated while their own side is still fighting (407 s over 8 matches).
`match-endgame.test.ts` does not cover it: that suite is 8-slot FFA do-nothing bots.

**This is a developer question, not a bot question** (Question 1). Stage 1 ships the same
under either answer; only the last task differs.

### 1.5 The ally alarm: the human already has it, the bot does not

Shipped today, in TEAMS:

- **Audio klaxon — team-scoped, map-wide, range-free.** `deriveAlarmAllies` walks
  `world.stations` and adds every same-`team` owner (`src/art/presenter.ts:248-262`);
  `setAlarmScope` is called every frame (`:153-154`); `alarmRingsFor` gates the ring
  (`src/art/audio/engine.ts:273-277`). A human hears their teammate's siege from the far
  corner of the map, with no scouting.
- **HUD arrow — own station only.** `updateAlarm` reads `frame.coreHp` / `shieldHp` /
  `turretHp`, which are the *local* station's (`src/ui/hud.ts:1283-1327`). So the arrow
  does not point at a besieged teammate. *(Flagged for the UI agent; out of this spike's
  write scope, and it does not change the argument — the klaxon alone is a shipped,
  map-wide ally signal.)*
- **The bot — nothing.** `OwnStationView.underAttack` is own-station only
  (`src/bots/perception.ts:100-117`), and `PerceivedStation.underAttack` is **scouted**,
  i.e. `null` beyond `SENSOR_RANGE` = 180 units (`:143-160`, `:320-340`).

Measured, that gate is almost total. Of every ally-second in which a teammate's home was
taking damage, the fraction where the teammate was **out of sensor range and therefore
could not know**:

| lineup | ally-siege seconds | blind |
|---|---|---|
| TEAMS 2v2 | 74 s over 8 matches | **91.3%** |
| TEAMS 4v4 | 593 s over 8 matches | **96.6%** |

And how far away the teammate actually was, weighted by siege-seconds:

| lineup | ≤180 (sensor) | ≤720 (visual) | ≤1200 | ≤1800 | ≤2400 | >2400 |
|---|---|---|---|---|---|---|
| TEAMS 2v2 | 8.7% | 21.6% | 63.0% | 6.7% | 0.0% | 0.0% |
| TEAMS 4v4 | 3.4% | 26.1% | 41.2% | 28.3% | 1.0% | 0.0% |

A teammate is nearly always **reachable but blind**: 93% of 2v2 siege-seconds and 71% of
4v4 siege-seconds happen with the ally inside 1200 units of the burning home. That
distribution is the empirical answer to Stage 2's "how far is too far" — see §4.2.

### 1.6 Two allies race the same rocks — measured, with a control

`bestRock` is distance × estimated payout × path clearance (`targeting.ts:251-266`), with
no notion of who else is going there. And `teamHomeSlots` deliberately spawns teammates
adjacent (`src/sim/state.ts:872-906`, developer report p14), so their nearest fields are
the *same* fields.

Pair-ticks where two live ships hold the same committed `Brain.mineSite`, allied pairs
against the **enemy-pair control**:

| lineup | ally pairs same rock | foe pairs same rock | ratio | mean apart (ally / foe) | within one visual range (ally / foe) |
|---|---|---|---|---|---|
| TEAMS 2v2 | **4.9%** | 1.5% | 3.3× | **434** / 1042 | **79.3%** / 17.8% |
| TEAMS 4v4 | **7.1%** | 1.7% | 4.2× | **673** / 1184 | **50.7%** / 11.9% |
| FFA 4 (control) | n/a | 6.6% | — | n/a / 831 | n/a / 39.4% |
| FFA 8 (control) | n/a | 5.3% | — | n/a / 881 | n/a / 39.1% |

The headline is not the 4.9% — it is that in a 2v2 **two teammates spend 79% of the match
inside one visual range of each other, at a mean separation of 434 units against the
enemies' 1042.** They are not covering a board; they are flying formation by accident.

### 1.7 Balance today: TEAMS does not move match length

FFA 4 → 2v2: 845 → 847 s. FFA 8 → 4v4: 826 → 850 s. 8/8 matches ended in every lineup,
none timed out. All four land inside the 10–15 minute target (`harness/balance.ts:58-59`).
**That is the pre-change baseline every stage must be re-measured against** (§6).

---

## 2. THE COORDINATION MODEL, ARGUED

### 2.1 The three candidates

**(a) Shared internals.** Allied bots read each other's `Brain` (or the `World`). This is
the shortcut, and it is the thing the perception module exists to make impossible: a tree
receives a `BotView`, never a `World` (`src/bots/perception.ts:1-31`,
`src/bots/bot.ts:12-15`), and `fog-honesty.test.ts` proves it by scrambling every hidden
number and demanding byte-identical action streams. **Rejected**, and not narrowly:
`Brain` holds `memory` (facts this bot scouted), `tabu`, `aim`, and commitment latches.
Reading an ally's memory launders *their* scouting into *my* decision with none of the
staleness, none of the trip, and none of the risk — the exact free-ride GDD §2.2 forbids.
It would also make `fog-honesty.test.ts` unable to fail: scramble a bot's hidden state and
its ally's memory still tells it the truth.

**(b) Mutually observable state only.** No channel; allies coordinate by both looking at
the same board — "he is closer to that rock than I am, so I take the other one." This is a
real alternative and it is **not** enough, for one measured reason: §1.5's 91–97%. If a
bot may only act on what it can see, then a teammate's siege is invisible in 91–97% of the
seconds it is happening, and **ally defence — the developer's most obvious "like humans
would" behaviour — is unbuildable.** It also degrades exactly backwards: it works best
when allies are close (where they need each other least) and vanishes when they are apart
(where a call matters). It survives as a *component*: §4.3's field division uses it, and
that is why field division does not need the radio.

**(c) An explicit bounded callout channel.** **Chosen.** Humans coordinate by talking, and
what they say is *what they have actually seen*. Model that literally, and fog honesty is
preserved by construction: a bot can only transmit a fact it legitimately perceived, so
the union of what a team knows is exactly the union of what its members saw. **Nobody
learns what no teammate saw.** That is a strictly weaker guarantee than per-bot fog and a
strictly stronger one than shared internals, and it is the same guarantee a human team has.

### 2.2 What may be sent, and what may never be

A `Callout` is a small tagged record. The whole vocabulary, and nothing else:

| Kind | Payload | Legality gate |
|---|---|---|
| `sighting` | slot id, position, velocity, hull fraction *or* `null`, `seenAt` | Must be copied from a `PerceivedShip` in the sender's **current** `BotView`, or a `ShipMemo` in its own `BotMemory`. `hull` is `null` unless the sender was inside visual range — the same `null` the view already produces. |
| `siege` | station owner, position, `seenAt` | The sender's **own** station under attack (`OwnStationView.underAttack`) or an ally station it scouted. *Layer A already carries the own-station case for free; this exists for "their home is being hit and I saw it".* |
| `help` | sender slot, position, `seenAt` | Sender's own ship state. A call for help is a fact about yourself; it is always legal. |
| `claim` | intent tag + a target key (rock id, station owner, slot id) | The sender's own committed intent — `Brain.mineSite`, its current attack target. Intent is a fact about yourself. |

**Never sendable, at any tier:** an unscouted core's HP, an enemy's held or banked ore,
an enemy's upgrade tiers, an asteroid's true `ore`, anything read off `World`. Enforced
structurally: the send API takes only view/memory-derived values, and the fog test is
extended to cover it (Trap 2, and Stage 1 Task 1.5).

**The receiving rule is the one that carries the guarantee.** A received `sighting` folds
into the receiver's own `BotMemory` as a memo stamped with the **sender's `seenAt`**, not
the receipt time — so a shared sighting is exactly as stale as the sighting was, and it
expires on the receiver's own `memorySeconds` clock like anything else
(`src/bots/memory.ts:183-200`). A ten-second-old call is ten-second-old news, and acting
on it and being wrong is the price of the fog (`memory.ts:22-23`).

Second-hand memos additionally carry a **hearsay discount**: their effective age is
`(now - seenAt) * HEARSAY_STALENESS` with `HEARSAY_STALENESS > 1`, so first-hand knowledge
always beats a call about the same thing and a bot prefers to go and look. This is what
stops the radio quietly becoming a shared omniscient map.

### 2.3 The cost model — because instant perfect sharing is *superhuman*

A channel with no cost produces bots that feel inhuman in the other direction: eight
teammates with one mind, reacting in the same frame, never missing a call. Four dials,
all per-tier so cooperation is a **skill** (§4.5):

| Dial | What it models | Easy | Medium | Hard |
|---|---|---|---|---|
| `callLatency` s | time to speak and be understood | 1.2 | 0.6 | 0.25 |
| `callMissChance` | the call nobody heard | 0.35 | 0.15 | 0.05 |
| `callCooldown` s | one voice, one channel | 6 | 3 | 1.5 |
| `HEARSAY_STALENESS` | second-hand decays faster | ×2.0 (shared) | | |

`callLatency` **must be ≥ one tick** at every tier — that is the determinism rule (§2.4),
not a tuning choice. The floor is the constraint; the tier values above sit far above it.

**Bandwidth** is a fixed-capacity ring per team (`RADIO_CAPACITY`, ~16), oldest evicted.
Combined with `callCooldown` this bounds allocation: a team's radio is one preallocated
array that never grows, so an 8-bot match still allocates nothing per frame (GDD §4.3).

### 2.4 Determinism (GDD §4.8)

The hazard is concrete. `botInputs` iterates the bot array in order
(`src/bots/harness.ts:123`) and each bot decides on its own cadence
(`thinkOnce`, `:134-149`). If a callout sent by slot 2 at tick *T* were readable at tick
*T*, slot 5 would see it and slot 0 (already decided) would not — behaviour coupled to
seat order and to the harness's loop shape, and different again on the server, which
drives bots one at a time.

**The rule: a callout sent at time `t` becomes readable at `t + callLatency`, and
`callLatency ≥ TICK_DT` always.** No callout is ever readable in the tick it was sent, so
iteration order cannot affect any decision. Three supporting rules:

1. **Reads are sorted.** `receive` returns callouts in `(readableAt, senderId, seq)` order
   — a total order with no ties, independent of insertion.
2. **No wall clock, no `Math.random`.** Timestamps are `view.time`. The miss roll is drawn
   from the **sender's** seeded stream at send time (`ctx.rng`), once, per recipient, in
   ascending slot order — so who missed the call is a pure function of the seed.
3. **The radio is outside the `World`.** It is constructed beside the bots, exactly like
   `Brain` (`src/bots/tree.ts:41-45`), so the determinism replay — which hashes the world
   and replays recorded inputs — never sees it and can never desync on it.

A standing test asserts the invariant directly: run a team match, then re-run it with the
bot array **reversed**, and assert the world hash is identical.

### 2.5 FFA does not move

`fillEmptySlots` will assign every bot its own team in FFA (teams-of-one, exactly as
`configToPlayers` does — `src/sim/match-config.ts:120-129`). Therefore:

- The ally list of every bot is empty; `allies.length === 0` on every read.
- The radio is `null` for a one-member team: `send` is a no-op with no recipients,
  `receive` returns the shared empty array.
- Every Stage 2–4 branch is gated on `allies.length > 0` and cannot fire.

The guards are `src/sim/ffa-hostility.test.ts` (unchanged — it is a sim test) plus a new
bot-layer FFA parity test: **the same seed, the same FFA lineup, byte-identical world hash
before and after each stage.** That is stronger than "FFA still works" and it is cheap.

---

## 3. WHAT THE VIEW MUST CARRY (the seam with p16-01)

Every stage below needs allegiance *in the view*, because a tree may not import the sim's
world-reading predicate — it has no `World` to hand it. p16-01 is briefed to make bots
respect allegiance at the targeting level, so it must add something of this shape:

- `SelfView.team: number`
- `PerceivedShip.ally: boolean` (or `team`)
- `PerceivedStation.ally: boolean` (or `team`)

**If p16-01 lands these, reuse them and add nothing.** If it lands a different shape (say
a resolved `enemies` list), Stage 1 Task 1.2 adapts to it — the requirement is only that
*the view answers "is that one of mine?" without a `World`*. Do not build a second
allegiance path in `src/bots/`; two answers to one question is exactly the seven-call-site
mess `src/sim/allegiance.ts:1-18` was created to end.

Stage 1 additionally needs a **derived ally roster** that p16-01 has no reason to add:
`BotView.allies: readonly PlayerId[]` — the slots on my side, excluding me, in ascending
id order (deterministic), each with `alive` and a public `stationAlive`. Station position
and wreck state are public at any range (`perception.ts:20-24`, `:320-340`), so this
leaks nothing.

---

## 4. THE STAGED ROADMAP

Four stages, cheapest and most foundational first. Each is independently shippable and
independently valuable; the chain can be **paused between any two** without leaving bots
half-coherent, which is the property that makes it safe to stop after Stage 2 if the
developer wants to play it before going further.

### Stage 1 — The win-condition model *(foundation)*

**What it does.** Bots learn their side and learn what winning means: my team survives
while **any** ally holds a core; my own survival is neither necessary nor sufficient.
Concretely: `BotSeat` carries a team; `botLobby` carries it through; the view exposes
`allies`; `nearestLivingRival` and `leaderStation` exclude allies; `hunt` flies at the
last **enemy** home; the endgame reads "outlast the other side", not "outlast everyone".

**What it buys.** It ends the two failures §1.3 measured that p16-01 does not touch:
a collapse-phase bot flying at its teammate's front door 63–86% of the time, and Medium
"ganging up on the leader" where the leader is its own ally 64–66% of the time. It is also
the plumbing every later stage needs — without `allies` on the view there is no Stage 2.

**What it costs.** Small and mechanical: one field on a seat, one on the view, an ally
filter in three reads. No new subsystem.

**What it risks.** The anti-stalemate promise. `hunt` exists so two survivors do not turtle
at opposite ends of the ring (`behaviors.ts:905-919`); narrowing its candidate set to
enemies could, in principle, leave a bot with no hunt target. It cannot in practice — if
no enemy home stands, the match has already ended (`match.ts:296-324`) — but the soak must
assert it (`tests/harness/soak.test.ts` shape, and Trap 6).

**What it does NOT yet do.** Bots still do not help each other, still race the same rocks,
still pick targets independently. It is a *model* fix, not a *cooperation* feature. There
is no radio yet.

### Stage 2 — Defending an ally *(the first real cooperation)*

**What it does.** Layer A ships: the view gains the **ally alarm** the human already
hears, and a `defend-ally` branch answers it. Layer B ships in its minimum form: the
radio, carrying `help` and `siege` callouts only.

**Trigger.** An ally's home reads `underAttack` (Layer A) **or** a `help`/`siege` callout
arrives, **and** the bot is within `ALLY_RESPONSE_RANGE` of that home, **and** its own home
is not itself under attack, **and** it is not fleeing or cornered.

**How far is too far — from §1.5's distribution, not from taste.** A 1200-unit response
range covers **93%** of 2v2 and **71%** of 4v4 ally-siege seconds; 1800 covers
99% / 99%. But response range is a *cost* as well as a reach: at ~1200 units the round
trip is a meaningful slice of a mining errand. **Recommendation: `ALLY_RESPONSE_RANGE =
1200`, leaned by `homebody`** — Warden and Patch answer from further, Sable and Bolt
barely at all — with the 1800 number recorded so a re-tune has a second data point.

**Cost to its own economy, made explicit.** Answering costs the trip plus the fight, and
it must not become a bot that never mines. Three bounds:
(i) the branch sits **below** `last-stand` and the bot's own `defend`, so *my* home always
outranks *yours*; (ii) a per-response commitment latch (`src/bots/commitment.ts`) with a
`clear` condition of "the ally home stopped reading under attack for N seconds OR I
arrived and there is nothing to fight", so the response cannot flap and cannot become a
permanent posting; (iii) a cooldown after a completed response, so one besieged ally
cannot consume a teammate's whole match.

**Does "ownership" mean the team here?** For the **alarm**, yes — the sim already ratified
it and shipped it for the human (`allegiance.ts:54-70`, and `alarm-ownership.test.ts`
pins it). For the **response**, no: the alarm rings for the team, the *priority ladder*
stays selfish-first. That distinction is the whole design of the stage.

**What it buys.** The single most legible "they play as a team" behaviour a player can
feel, and the one the developer's own s5 report is about.

**What it risks.** Two bots abandoning two economies to answer one alarm (the ratio dial
in §4.5 is the fix, and Stage 4's roles are the real fix); and the response becoming a
free escort that makes a defended team uncrackable (a balance question — §6).

**What it does NOT yet do.** No field division, no focus fire, no role split. Bots answer
alarms; they still do not plan.

### Stage 3 — Dividing the field

**What it does.** Allies stop racing the same rock. Two mechanisms, in order of cost:

1. **Observable-state division (no radio).** Extend `bestRock`'s scoring with an
   *ally-proximity* discount: a rock another visible ally is nearer to, or is parked at,
   scores lower for me. This is candidate (b) from §2.1 and it needs no channel at all —
   which is exactly right, because §1.6 measured allies inside one visual range of each
   other **79.3% (2v2) / 50.7% (4v4)** of the time. Most contention is *visible*
   contention, so most of it is solvable without a word.
2. **`claim` callouts (radio).** For the contention that is not visible: a bot broadcasts
   the rock id it committed to, and a receiver treats a fresh ally claim like its own
   `tabu` entry (`Brain.tabu`, `tree.ts:137-152`) — a soft exclusion that expires.

**What it buys.** Straightforwardly more ore per team-minute, and the visual read of two
teammates working different fields instead of flying formation.

**What it costs.** `bestRock` runs every decision for every bot; the ally-proximity term
must be O(allies in view) and allocation-free. Claims add radio traffic — hence the
cooldown.

**What it risks.** Over-division: two allies each politely deferring until neither mines
the good rock. The discount must be a *multiplier*, never a veto, and must decay with
distance — the same discipline `pathClearance` already uses (`targeting.ts:209-220`), with
the same "worst single ally sets it" rule so three allies are not three penalties.

**What it does NOT yet do.** Nothing about combat. Two allies may still both chase the
same enemy while a second enemy mines undisturbed.

### Stage 4 — Focus fire and role split

**What it does.** Two behaviours, both cheap once the radio exists:

1. **Focus fire.** A fresh ally `claim` on an enemy ship or home adds a bonus to that
   target's score for me — never a veto, so a bot chasing a much better target still takes
   it. This is "two beats one" (GDD §2.6) executed deliberately instead of by coincidence.
   *The cheap version that buys most of the value:* the bonus is a single multiplier on the
   existing `TARGET_MIX` total (`targeting.ts:294`); no new scoring machinery.
2. **Role split.** At most one ally at a time holds the `defender` role (nearest to the
   team's most-threatened home, or the highest `homebody` if none is threatened); it
   raises its own defend weights and lowers its attack floor's appetite; everyone else
   mines and raids. Resolved **deterministically without negotiation**: every bot computes
   the same function over the same ally roster + radio state, and ties break with the
   existing index-blind key (`tiebreakKey`, `targeting.ts:65`) so no slot is privileged.
   A role is re-derived each decision but *latched* so it cannot flap.

**What it buys.** The last two things a human team does that bots still would not.

**What it risks.** This is the stage that makes coordinated bots genuinely harder. Focus
fire concentrates damage, which is the mechanic the whole siege balance turns on
(GDD §2.6 "two beats one"). **Expect the biggest balance movement here** and budget the
re-measure (§6).

**What it does NOT yet do.** No formations, no pathing coordination, no economy sharing
(there is none to share — banked ore is per-player). Those are not in scope and should not
be invented.

### 4.5 Personality and difficulty as the coordination dial

Cooperation is a **skill**, and it is the main lever that keeps team bots fun rather than
oppressive. Two layers, mirroring the shape already shipped (`personalities.ts:48-137`):

**Tier (`DifficultyTuning`)** — the four radio dials of §2.3, plus:

| | Easy | Medium | Hard |
|---|---|---|---|
| answers an ally alarm | rarely, late (long `callLatency`, high miss) | usually | almost always, fast |
| honours an ally's rock claim | often ignores it | usually | always |
| focus-fire bonus | small | medium | large |

An Easy team therefore **misses calls, arrives late, and both chases the same target** —
by construction, out of the same latency/miss model, with no separate "be bad at teamwork"
knob. That is the same discipline as `aimLatency`: one mechanism, visible competence, no
cheat in either direction (`personalities.ts:74-85`).

**Character (`PersonalityWeights`)** — the existing dials do most of the work and should
be reused before new ones are invented:
- `homebody` — Warden (0.55) and Patch (0.9) answer ally alarms from further; Sable (0.2)
  and Bolt (0.1) barely at all. This *is* the ally-response range multiplier.
- `opportunism` — Sable (0.9) and Vulture (0.8) honour focus-fire calls (a called target
  is a punishable target); Rusty (0.1) does not.
- `greed` — a greedy bot defers a rock claim less readily.

**One new character dial, and only one:** `chatter` (0..1) — how readily this character
*speaks*. Vulture calls out wrecks, Warden calls out sieges, Rusty says almost nothing.
It multiplies the send rate, never the listen rate, so a quiet character is a worse
teammate without being a worse player, which is a real human archetype.

---

## 5. TDD BRIEF CHAIN — STAGES 1 AND 2

Needs-ordered. Each task names its owner, **the test to write first**, then the change.
All bot-layer work is the **Bot Engineer** unless stated. Every task must leave
`npx tsc --noEmit` and `npm test -- --run` green.

### Stage 1 — the win-condition model

- **Task 1.1 — a seat carries a side.** *needs: nothing.*
  *Test first:* `fillEmptySlots` + `botLobby` round-trip — a lineup built with
  `teams: [0,0,1,1]` produces a `PlayerSpec[]` whose `team` matches, and an FFA lineup
  built with no teams produces specs with **no `team` key at all** (so the sim's
  teams-of-one default still applies and FFA is byte-identical).
  *Change:* add `readonly team?: number` to `BotSeat` (`src/bots/bot.ts:53-56`); carry it
  in `botLobby` (`src/bots/harness.ts:78-80`) with the `...(seat.team !== undefined ? {team} : {})`
  spread `harness/match.ts:243` already uses; add an optional `teams` argument to
  `fillEmptySlots`. **Trap:** `exactOptionalPropertyTypes` is on (`tsconfig.json`) — a bare
  `team: undefined` will not compile and would also change FFA behaviour if it did.

- **Task 1.2 — the view answers "is that one of mine?".** *needs: 1.1, and p16-01.*
  *Test first:* extend `perception.test.ts` — in a 2v2 world, `perceive(world, 0)` reports
  slot 1 as an ally and slots 2,3 as not, at every range; and `view.allies` is
  `[1]` for slot 0 and `[]` for every slot in an FFA world.
  *Change:* reuse whatever p16-01 put on `PerceivedShip`/`PerceivedStation` (§3). Add
  `SelfView.team` and `BotView.allies: readonly AllyView[]` — `{id, alive, stationAlive,
  stationPos}` — built by walking `world.ships`/`world.stations` in id order.
  **Trap:** `allies` must exclude self and must be sorted ascending; an unordered roster is
  a determinism bug that only shows up under a different engine's `Map` iteration.

- **Task 1.3 — "who am I trying to outlast?" excludes allies.** *needs: 1.2.*
  *Test first:* in a 2v2, `nearestLivingRival(ctx)` never returns the ally's station even
  when it is the nearest standing home; `leaderStation(ctx)` never returns an ally; both
  are unchanged in an FFA fixture.
  *Change:* ally filter in `targeting.ts:478-485` and `:502-520`.
  **Trap:** do **not** filter derelicts back in or out while you are here — a derelict is
  `alive === false` from birth (`src/sim/state.ts:817-827`) and both functions already skip
  it with their `if (!station.alive) continue` (`targeting.ts:480`, `:506`). And do
  not "helpfully" also filter `bestTarget`/`homeIntruder`: that is p16-01's, and doing it
  twice in two shapes is how the two answers drift apart.

- **Task 1.4 — the endgame hunts the other side.** *needs: 1.3.*
  *Test first:* a scripted 2v2 collapse fixture where the ally home is nearer than either
  enemy home — the bot's `hunt` flight plan heads at an enemy home. Plus the anti-stalemate
  regression: a 2v2 soak over ≥8 seeds ends every match inside the harness timeout, with
  `timedOut === false` (`tests/harness/soak.test.ts` is the model).
  *Change:* none beyond 1.3 if `hunt` is left reading `nearestLivingRival`
  (`behaviors.ts:916-919`, `hard.ts:256`, `medium.ts:224`) — this task is the **proof**,
  and it is a task because the risk is real (§4 Stage 1 risks).

- **Task 1.5 — the fog test learns about teams.** *needs: 1.2.*
  *Test first (this task is the test):* extend `fog-honesty.test.ts` to run its scramble
  over a **2v2** world as well as the FFA one, and add to `scrambleHidden` the facts an
  ally must not launder: an **ally's** unscouted core HP, an ally's cargo/bank/tiers, an
  ally's off-screen hull. Assert byte-identical action streams.
  *Why now, before any cooperation ships:* this is the assertion that will catch Stage 2's
  radio if it ever carries something it may not. Land the guard before the thing it guards.

- **Task 1.6 — FFA parity, hashed.** *needs: 1.1–1.5.*
  *Test first:* an FFA 8 bot match at a fixed seed produces the **same world hash** as
  `main` did before Stage 1. Take the literal from a pre-change run using
  `hashState` (`harness/hash.ts`, the same digest `tests/determinism.test.ts` runs on) and
  pin it as a golden value — a *literal*, not a two-run comparison, because a two-run
  comparison stays green while both runs drift together.
  *Change:* none — if this fails, something in 1.1–1.5 changed FFA and must be reverted,
  not re-baselined.

- **Task 1.7 — the eliminated-teammate question, once the developer answers.**
  *needs: 1.6, and Question 1.*
  *If the answer is "§2.7 stands — a dead home ends that player's match":* the only change
  is a **test** pinning it, in `src/bots/match-endgame.test.ts`, over a 2v2: the surviving
  ally plays on coherently (keeps mining, keeps defending, still wins) while its teammate
  sits eliminated, and the winner is the team.
  *If the answer is "a teammate keeps flying":* this becomes a **Gameplay Engineer** task
  first (`match.ts:136-152` must not eliminate the ship while the team holds a core;
  `step.ts:191-202` must respawn it — at which home?), and only then a bot task
  (a home-less bot has `self.station === null`, which `spendAtHome`, `haulHome`,
  `defendHome`, `retreat` and `coreUnderFinalAssault` all already null-check but none of
  them have a *plan* for). **Do not start the bot half before the sim half is ratified.**

### Stage 2 — defending an ally

- **Task 2.1 — the ally alarm reaches the view.** *needs: 1.2.*
  *Test first:* in a 2v2 with the ally's station taking damage from across the map,
  `perceive(world, me).allies[0].underAttack === true` regardless of distance; and in FFA
  `allies` is empty so nothing can read it.
  *Change:* add `underAttack: boolean` to the `AllyView` of Task 1.2, computed exactly as
  the own-station view computes it — `station.alive && station.sinceDamage < env.alarmWindow`
  (`perception.ts:290`).
  **Trap:** this is the ONE range-free addition in this whole plan, and its licence is that
  the shipped human klaxon is range-free (`src/art/presenter.ts:248-262`,
  `src/art/audio/engine.ts:273-277`). Do **not** also expose the ally's `coreHp`,
  `shieldHp`, or turret count range-free — the human does not get those for a teammate
  either (Question 2). Write that sentence into the doc comment, because the next person
  will want to add "just the HP too".

- **Task 2.2 — the radio, empty.** *needs: 1.1.*
  *Test first:* a `TeamRadio` unit test: send at `t=0` with `callLatency=0.5`; `receive`
  at `t=0.4` returns nothing, at `t=0.6` returns it; capacity eviction drops the oldest;
  a one-member team's radio is `null` and `send` is a no-op; `receive` returns callouts in
  `(readableAt, senderId, seq)` order given deliberately shuffled inserts.
  *Change:* new `src/bots/radio.ts`. Plain data, no imports from `src/sim`. Constructed
  per match beside the bots and handed to each `Brain` — **not** put in `World`
  (`tree.ts:41-45` is the precedent and the reason).

- **Task 2.3 — the radio is deterministic under reordering.** *needs: 2.2.*
  *Test first (this task is the test):* run a 2v2 bot match to completion, then run the
  identical match with the `bots` array **reversed**, and assert identical world hash,
  identical winner, identical tick count. Then repeat with a mixed reaction-cadence lineup
  (an Easy and a Hard on the same team) so the cadence interaction is covered.
  **This is the test that fails if anyone ever lowers `callLatency` below one tick.**

- **Task 2.4 — tier dials for the channel.** *needs: 2.2.*
  *Test first:* `DIFFICULTY_TUNING` gains `callLatency`, `callMissChance`, `callCooldown`;
  a table test asserts Easy ≥ Medium ≥ Hard on latency and miss, and that **every** tier's
  `callLatency >= TICK_DT`. Assert the miss roll comes from the sender's `ctx.rng` by
  running the same send twice from two brains with different seeds and getting different
  recipients.
  *Change:* the three fields, with the same doc-comment discipline the existing tuning
  fields have (`personalities.ts:53-137`) — say what the knob *models*, not just what it
  does.

- **Task 2.5 — `help` and `siege` callouts.** *needs: 2.1, 2.4.*
  *Test first:* a bot whose own home is under attack sends exactly one `help` per
  `callCooldown`, not one per decision; the payload's `seenAt` is the sender's `view.time`;
  an FFA bot sends nothing (no recipients).
  *Change:* the send site is a small step in the tree's `defend`/`last-stand` path.
  **Trap:** the send must be *idempotent per decision* and must not be re-emitted by the
  action-stream hold (`harness.ts:170-177` strips one-shot orders for exactly this class of
  bug — a radio call is a one-shot too, but it does not travel in the action stream, so the
  cooldown is the only thing protecting it).

- **Task 2.6 — the `defend-ally` branch.** *needs: 2.1, 2.5.*
  *Test first:* three cases, each a hand-built fixture, each asserted for all three tiers:
  (a) ally under attack within `ALLY_RESPONSE_RANGE` and my home quiet → the bot's flight
  plan heads at the ally's home; (b) **my** home also under attack → my own `defend` wins,
  every time, at every tier; (c) ally under attack at 2500 units → the bot keeps mining.
  Plus: the branch never fires in FFA (allies empty).
  *Change:* an `ally-defence` leaf in all three trees, placed **below** `last-stand`,
  `cornered-fight`, `retreat` and the bot's own `defend`, and **above** `spend`.
  **Trap:** it must sit above `spend`/`haul` but the response must not strand a full hold —
  reuse `wantsToHaul` in the trigger, or a bot answers a call, dies, and hands half a full
  hold to the attacker (GDD §2.7).

- **Task 2.7 — the response commits, and ends.** *needs: 2.6.*
  *Test first:* a latch test in the shape of `commitment.test.ts` — the response holds
  across decisions while the ally alarm flickers (the alarm is a 2-second window,
  `DEFAULT_PERCEPTION.alarmWindow`, so it *will* flicker); it releases on arrival with
  nothing to fight, on the alarm going quiet for N seconds, or on a higher-priority
  override; and after release the bot does not immediately re-commit (cooldown).
  *Change:* a `Latch` on `Brain` (`src/bots/commitment.ts`), plus an
  `allyResponseUntil`-style deadline for the cooldown. **Trap:** `context()` releases
  commitments on death (`tree.ts:242-245`) — the ally-response latch must be released
  there too, or a respawned bot resumes a rescue that ended two lives ago.

- **Task 2.8 — measure, then decide the range.** *needs: 2.7.* **Owner: QA Agent.**
  *Test first:* a standing harness test in the shape of `tests/harness/player-aggression.test.ts`
  — a 2v2 and a 4v4 sweep reporting: ally-siege seconds answered vs unanswered, ore mined
  per team-minute (the economy cost of answering), and match length. Assert only the things
  that must not regress (match length in band, no timeouts); *report* the rest.
  *Change:* set `ALLY_RESPONSE_RANGE` from the measurement, not from §4.2's recommendation
  — §4.2 is the hypothesis, this is the falsification.

---

## 6. BALANCE — WHICH TARGETS MOVE, AND HOW THEY GET RE-MEASURED

Coordinated bots are a difficulty change. Named now, not discovered in play.

**The three standing targets** (`harness/balance.ts:52-66`): match length 10–15 min; no
strategy >55% win rate; no ship class >55% win rate. **None of them is phrased in teams**,
and the harness's win-rate machinery tallies per-seat. `MatchResult` already carries
`winnerTeam` (`harness/match.ts:158-159`) and `teamsLineup` already exists (`:213-235`),
so the missing piece is a **team-mode sweep** whose unit is the team, not the seat.

| Stage | What moves | How it is re-measured |
|---|---|---|
| 1 | **Nothing measurable should move.** The reads it fixes are wasted trips, not wins. | The §1.7 baseline re-run: 2v2 847 s / 4v4 850 s, 8/8 ended. A length change here means Task 1.4's hunt narrowing did something unintended. |
| 2 | Match length **up** (bots spend time travelling to rescues); team-vs-team win rate unchanged in a mirror, since both sides gain it. | Task 2.8's sweep, plus the FFA hash parity of Task 1.6 re-run. |
| 3 | Ore per team-minute **up**; match length **down** slightly (a richer team fights sooner). | Ore/team-minute is a new metric — add it to the same sweep; the ore-conservation invariant (`tests/harness/ore-conservation.test.ts`) must stay exact. |
| 4 | **The big one.** Focus fire concentrates damage against the mechanic the siege balance turns on (GDD §2.6). Expect shorter matches and a real difficulty jump. | A full mirror sweep at 2v2 and 4v4 across ≥16 seeds and every rotation, against the 10–15 min band; plus a **human-facing** check in the shape of `tests/harness/player-aggression.test.ts` (a scripted human on a team of bots, and against one). |

**Two balance facts to carry into every stage:**

- **FFA must not move at all**, and the guard is a *hash*, not a win rate (Task 1.6).
  A win-rate check would hide a small behavioural drift; a hash cannot.
- **The bot cast is not the QA probe set.** `harness/balance.ts` measures the five probe
  strategies (`harness/strategies.ts:44-46`), not Rusty/Bolt/Foreman/…. Team coordination
  is a *personality-cast* property, so the team sweeps above must run the **real cast**
  (the way this spike does) or they will measure nothing that ships.

---

## 7. TRAPS (the ones that bite an implementer who skims)

1. **`botLobby` silently drops everything but id and ship class**
   (`src/bots/harness.ts:78-80`). Add a `team` to `BotSeat` and forget this line, and the
   world is FFA while the bots think they are on teams — the worst of both, and it will
   look like a bot bug for a day.
2. **A callout may only carry what the sender legitimately perceived.** The temptation is
   to send "their core is at 30%" because *you* have it in memory — that is legal (you
   scouted it) — and then, three PRs later, to send it because it is in `World`. The
   structural defence is that `src/bots/radio.ts` imports nothing from `src/sim`, and the
   behavioural defence is Task 1.5's extended `fog-honesty.test.ts`. Land both.
3. **A shared sighting is stamped with the sender's `seenAt`, never the receipt time.**
   Get this backwards and a stale rumour becomes fresh intelligence every time it is
   repeated — the team's picture of the map gets *better* the more it is passed around,
   which is precisely omniscience with extra steps.
4. **`callLatency` must be ≥ one tick, at every tier, forever.** Below that, decisions
   depend on bot iteration order (`harness.ts:123`) and the match no longer replays the
   same on the server, which drives bots one at a time. Task 2.3 is the guard; do not
   weaken it to make an "instant Hard" feel snappier.
5. **The radio does not go in `World`.** The determinism replay hashes the world and feeds
   recorded inputs (GDD §4.8); bot state lives outside it on purpose
   (`src/bots/tree.ts:41-45`, `src/bots/bot.ts:16-21`). A radio inside `World` also puts
   itself on the wire budget, which is 494 bytes and not yours.
6. **Narrowing `hunt` to enemy homes is the one change that can hang a match.** `hunt` is
   the anti-stalemate promise the bots keep (`behaviors.ts:905-919`). Task 1.4's soak is
   not optional, and `timedOut === true` in it is a **failure**, never a slow seed
   (`harness.ts:216-217`).
7. **The alarm window flickers.** `underAttack` is `sinceDamage < 2 s`
   (`perception.ts:290`), so an attacker pausing for two seconds switches it off. Any
   ally-response trigger read raw will flap; that is what Task 2.7's latch is for, and it
   is the same lesson `commitment.ts:1-27` records.
8. **Do not give bots an ally's core HP with the alarm.** The klaxon is a boolean and it
   is what the human gets; HP is scouted for *everyone*, ally included
   (`perception.ts:320-340`). Shipping "just the HP too" would be the first real
   fog-honesty regression in this codebase, and it would pass every existing test.
9. **`homeIntruder` and `bestTarget` are p16-01's.** If they are still ally-blind when you
   start Stage 1, do not fix them here — a second ally filter in a second shape is how the
   two answers drift. Escalate instead; Stage 1 does not depend on them.
10. **`exactOptionalPropertyTypes: true`** (`tsconfig.json`). Optional `team` fields must be
    spread conditionally, never assigned `undefined` — the pattern is at
    `harness/match.ts:243`, and the reason FFA stays byte-identical is that the key is
    *absent*, not undefined.
11. **Stage 4's role split must be derived, not negotiated.** Every bot computing the same
    function over the same roster is deterministic; a bot *claiming* the role and others
    yielding is a distributed-consensus problem with an iteration-order hazard. Use
    `tiebreakKey` (`targeting.ts:65`) for the ties — it is index-blind, so no slot is
    privileged, and it is already the ratified answer to exactly this question (p8).
12. **`match-endgame.test.ts` is FFA do-nothing bots.** It proves the ending is
    *structural*; it says nothing about teams and it is not the place to add team coverage
    without also mocking the constants it mocks (`match-endgame.test.ts:33-48`).

---

## 8. QUESTIONS FOR THE DEVELOPER

These are the ones only a human can ratify. Everything else in this document is settled
below, in §9.

**Q1 — When a player's own home dies but their team lives, do they keep flying?**
*Why it matters:* the GDD says both things — §1 ("in Teams, your whole side is eliminated
when its last reactor dies") and §2.7 ("its owner is eliminated"). The sim implements
§2.7 (`src/sim/match.ts:136-152`, `src/sim/step.ts:191-202`), so today a 2v2 can become a
2v1 of *ships* while both sides still hold a core, and the eliminated player watches.
Measured: 34 s/match of that state in 4v4, ~51 s/match per affected bot.
*The options:* **(a) keep §2.7** — a dead home ends your match; simple, shipped, and it
makes a home genuinely precious. **(b) a teammate keeps flying** — respawning at an ally's
home, with no station of their own to bank at, spend at, or repair; more "team", but it
opens real questions (where do they bank? can they build on an ally's station? does the
15-second per-station repair cooldown now serialise two players?) and it is a
**Gameplay Engineer** change before it is a bot change.
*Recommendation:* **(a)**, and fix the GDD's §1 sentence instead. (b) is a mode change
wearing a bug's clothing. Either way, Stage 1 ships; only Task 1.7 differs.

**Q2 — Should a teammate's home HP be visible to allies (human and bot)?**
Today the klaxon is team-scoped and range-free, the HUD arrow is own-station-only
(`src/ui/hud.ts:1283`), and HP is scouted for everyone including allies. This plan gives
bots exactly the klaxon and nothing more. If you want allies to see each other's HP, say
so — it is a **UI** decision first (the HUD would show it), and the bot view would then
mirror it under the same "the bot's view is the human HUD" rule. **Do not let this leak in
through the bot layer.**

**Q3 — How loud should the team be?** §2.3 proposes Easy 1.2 s latency / 35% miss,
Hard 0.25 s / 5%. Hard bots that never miss a call will read as one mind; Easy bots that
miss a third of them will read as endearingly bad. This is the main "fun vs oppressive"
dial and it is a taste call — the numbers above are a hypothesis for QA to falsify
(Task 2.8), not a commitment.

**Q4 — Does an ally-defence response have a hard budget?** §4.2 recommends a
1200-unit range with a per-response commitment and a cooldown. The alternative is
"answer everything, always", which is more heroic and measurably worse for the team's
economy. If you want a stated ceiling — "no bot spends more than X% of its match
answering" — say the number and QA will pin it.

**Q5 — Is Stage 4 in scope now, or is Stage 3 the pause point?** Stages 1–3 make bots
*coherent* teammates. Stage 4 makes them *good* ones, and it is the stage with a real
difficulty jump (§6). The chain is built to stop cleanly after any stage; where would you
like to play it before continuing?

---

## 9. SETTLED HERE (not questions — decisions this spike made)

- **Coordination is a bounded callout channel plus HUD parity**, not shared internals and
  not observable-state-only. §2.1, with the 91–97% blindness measurement as the reason
  observable-state-only cannot carry ally defence.
- **The ally alarm is parity, not a new information channel** — the human's klaxon is
  already team-scoped and range-free in shipped code. §1.5.
- **Delivery is time-ordered with a ≥1-tick floor**, the radio lives outside `World`, and
  the miss roll comes from the sender's seeded stream. §2.4. This is the entire determinism
  story and it is not negotiable.
- **FFA degrades structurally** (empty ally list, `null` radio), guarded by a world-hash
  parity test rather than a behavioural one. §2.5, Task 1.6.
- **Stage order is win-condition → ally defence → field division → focus fire/roles**,
  because that is cheapest-first, foundation-first, and each stage is independently
  valuable. §4.
- **Field division does not need the radio** for most of its value: 79% (2v2) of allied
  pair-time is already inside one visual range, so observable-state division carries it.
  §4.3.
- **Cooperation quality is the difficulty dial**, expressed as call latency and miss rate
  rather than as a separate "teamwork" knob — the same mechanism-not-a-knob discipline as
  `aimLatency`. §4.5.
- **`homebody` / `opportunism` / `greed` are reused** for character-level cooperation;
  exactly one new dial (`chatter`) is proposed. §4.5.
- **Ally targeting is p16-01's and is not re-planned here**; §1.3's `bestTarget` and
  `homeIntruder` columns are recorded so this plan is not credited with closing them. §1.3,
  Trap 9.

---

*Spike s5-01, Architect. Measurements: `spikes/team-bots/measure-team-gaps.ts`
(8 seeds × 4 lineups, deterministic, re-runnable). Nothing in `src/` was modified by this
spike.*
