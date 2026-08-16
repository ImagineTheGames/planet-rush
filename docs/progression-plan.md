# Meta-Progression — XP, Levels, Unlocks (Spike s4, amended a0-13)

**Owner:** Architect · **GDD:** §2.1, §2.5, §2.8, §2.11, §4.2 (m9/online), §4.6 · **Status:**
**RATIFIED, briefed, SHIPPED and re-baselined.** Every question s4 left open was answered by the
developer on 2026-08-07; the answers are folded into the sections they change, each marked
*(ratified 2026-08-07)*. The brief chain is `docs/briefs/pr-*.md` (§7) and is merged. **QA
re-measured the whole economy against the shipped code in p1-08
(`docs/progression-balance-p1-08.md`); the corrections that report raised against this document
are folded in here, marked *(corrected a1-02, 2026-08-09)*.** SIX questions — five raised by
what the ratifications turned out to cost, and Question F raised by the re-baseline — are at the
foot of this document.

> **Read this before quoting a number out of §1.** *(corrected a1-02, 2026-08-09)* Two things
> about this document's tables were measured wrong by it and right by p1-08, and both are
> corrections to published figures rather than wording:
>
> 1. **Every table in §1.2–§1.4 is a `standard`-abundance number, and the game ships `scarce`**
>    (`DEFAULT_ABUNDANCE`). The label is now on every table; the measured cost of the confusion
>    is at the head of §1.3a.
> 2. **"Level 2 lands inside a single match" is a claim about the MEDIAN player**, and this
>    document stated it as a claim about every player. A player knocked out first earns 68 XP
>    and needs 4.4 matches. Restated everywhere it appears; the fix is a **row**, not a
>    constant, and it is **Question F** — the developer's table, the developer's call.

This spike **decides**, in the mold of `docs/netcode-spike.md` and
`docs/variable-slots-plan.md`: measurements over intentions, every claim reproducible, and
the traps written down for the agents who implement. The developer's ask (2026-07-27):

> "I'd like to build an XP/LVL system… for now undecided what it does, but eventually
> players unlock things… perhaps a skill tree with powers for their ships."

and, 2026-08-07, the ask that turned this document from a plan into a build:

> *"we need a fun end of match screen, that shows total ore mined, damage dealt, distance
> travelled, ships used, ore used, etc. … some things with more weight for example ore mined
> (1x) and stations destroyed (10x), ships destroyed (5x), damage dealt (2x) would yield more
> XP"*

> *"it needs to feel like a video game end match screen with the score counting up, the
> progress bar filling up to show you current level, whats left till next level as it fills
> up, and gives a rewarding animation as it fills up and completes… plus a satisfying sound"*

> *"also bot difficulty needs to be taken into account for XP with real players counting as
> HARD possibly (or perhaps their LVL also is taken into account)"*

Reproduce the two things this spike measured rather than invented — what a real match *pays*
a player in accrual events at today's shipped constants, and what that becomes in XP:

```
npx vite-node spikes/progression/measure-xp.ts            # s4: nine candidate events, three weight sets
npx vite-node spikes/progression/measure-ratified-xp.ts   # a0-13: the RATIFIED weights, real bot cast, attributed
npx vite-node harness/cli.ts pay --seeds 12               # p1-08: the SHIPPED observer and pricer, swept
npx vitest run tests/harness/p1-08-pay.test.ts            # p1-08: the rig, and the abundance trap, pinned
npx tsc --noEmit                                          # the shipped tree still type-checks
```

The second run's full output is committed at `spikes/progression/measured-a0-13.txt`, so
every number in §1.3a–§1.3c is checkable without a four-minute run. **The third is QA's
re-measurement of the same economy against the shipped modules** — output at
`spikes/progression/measured-p1-08.txt`, report at `docs/progression-balance-p1-08.md` — and
where the two instruments disagree **the shipped one is right**: a0-13 reconstructed damage
attribution from projectile geometry and published its own residual, while p1-08 reads
`src/sim/combat-credit.ts`, the ledger pr-02 actually shipped.

The measurement code is throwaway (`spikes/progression/`, excluded from `tsconfig.json`'s
`include` and from the build). `measure-xp.ts` reuses the shipped QA harness
(`harness/match.ts`) **unmodified** — the harness hands every tick to an `onTick` hook and
hands back the finished `World`; the spike observes per-player accrual by **diffing world
state each tick**, because the sim keeps no per-player counters (only the match-wide ore
ledger, `src/sim/ore-ledger.ts`). Harness strategies (`miner/turtle/rusher/raider`) stand in
for the shipped bot trees, exactly as the netcode and variable-slots spikes stand in for the
real sim — so read the *shape*, not the third decimal.

**`measure-ratified-xp.ts` (a0-13) goes further where it had to.** Three of the four ratified
weights are on events the harness strategies cannot express and the sim cannot attribute, so
it runs the **real shipped bot cast** (`src/bots` `createBots`/`runHeadlessMatch`) by
difficulty tier — which is what makes "what does a HARD lobby pay versus an EASY one" a
measurement — and reconstructs kill/damage attribution with a **shadow attributor** that
patches nothing in `src/` (§1.3a). It is a reconstruction, and the doc says so everywhere it
is used.

> **Housekeeping, found by running it.** `measure-xp.ts` had not executed since `world.planets`
> became `world.stations` — the reproduce line above was broken for the whole life of this
> document. Repaired in a0-13. Its numbers re-reproduce within ~1% of the 2026-07-27 tables
> except the round-robin median, which moved 597 → 619 XP; the tables below are left at their
> original values with this note, because re-typing them would hide that the sim moved.

---

## DECISION (up front)

1. **Ship XP + levels + a local profile NOW; unlocks are a SEPARATE, gated decision.**
   Phase 1 (§5) is XP accrual, a level curve, the **end-of-match summary as a choreographed
   sequence** (§6) and the lobby level badge, with local persistence and **no unlocks at
   all**. It is fairness-neutral by construction. **The fairness question is now answered —
   COSMETIC (§3, ratified 2026-08-07) — so Phase 2 has a direction; it still has no
   content, and this document does not design any.**

2. **The kill/damage attribution hook is PHASE 1 now, not Phase 2** *(changed 2026-08-07 by
   a0-13; s4's Question 6 recommended the opposite)*. Ore gathered, ore deposited, structures
   built, ship upgrades bought, core repairs, waves survived, distance flown and match
   placement are all observable by watching world deltas — free. The sim tracks **no killer**
   (`main.ts:2147` says so outright; `killShip`/`damageShip` in `src/sim/damage.ts` take no
   attacker) **and no damage dealt at all**, so kills, stations destroyed *and damage dealt*
   need a new sim hook — a `by: PlayerId` credit on the damage/kill path. **Three of the
   developer's four ratified weights sit on that hook.** Deferring it ships a summary screen
   that pays only ore, which is not the screen that was asked for. Sized in §1.5.

3. **Persistence is LOCAL ONLY, and stays simple** *(ratified 2026-08-07: "we may need a
   backend at some future point, but for now lets just keep it simple, locally stored")*. A
   single JSON profile under a new `planet-rush:profile` key over `platform.storage`
   (`src/platform/platform.ts:35-39`), read defensively like every other setting. §2.2's
   signed-profile / HMAC-vouch work stays **sized, not built**. Two obligations follow and
   are not optional: **version the schema from the first write** (no reset path ships, so
   migration is the only repair tool this profile will ever have) and **keep the shape
   backend-portable** (§2.1).

4. **Fairness stance — COSMETIC** *(ratified 2026-08-07: "probably cosmetics as you gain
   levels you'll unlock new items things like that")*. Unlocks may not touch a sim constant.
   The option space s4 argued is preserved in §3 as the reasoning, not as a menu. Because the
   ruling is cosmetic-only, **§4's three skill-TREE shapes are the wrong structure** and are
   re-opened in that light (§4): cosmetics want a level→unlock list, not a graph with
   prerequisites.

5. **Level curve: `xpToNext(L) = base · L^exp`, `base=300` / `exp=1.6`, UNCHANGED**
   *(ratified 2026-08-07: "ok"; re-measured by a0-13 against the ratified weights and the
   difficulty multiplier — §1.4; re-measured again against the shipped code by p1-08, which
   recommends all three constants unchanged)*. Re-measurement matters because the pay per match
   moved: the curve still lands **level 2 inside a single match for the MEDIAN player**
   (0.8 matches at a0-13's cell; 0.6–1.0 in nineteen of p1-08's twenty cells), and level 10
   stretches from ~67 matches to ~101 (p1-08 measures 76–135 across every cell, 96.6 at this
   cell). No re-tune needed — but only if the participation rows are kept (§1.3c), which is
   Question A at the foot of this document.
   **What "median" excludes, and it is not a rounding detail** *(corrected a1-02)*: a player
   knocked out first earns **68 XP** and needs **4.4 matches** to reach level 2. The hook holds
   for the median seat and not for the worst one, the fix belongs in the participation floor
   rather than in `base` (§1.4), and it is **Question F**.

6. **Opponent strength scales the pay: DIFFICULTY yes, LEVEL no** *(a0-13, from the
   developer's 2026-08-07 ask)*. A kill is worth its weight **times what it cost to get**, and
   the tier is local, deterministic, unspoofable knowledge (`PERSONALITIES[id].difficulty`).
   Recommended table: **Easy ×0.75 · Medium ×1.0 · Hard ×1.25 · human ×1.25**. Scaling by the
   opponent's *level* is held until profiles are integrity-checked, and the reason is now the
   developer's own decision rather than the Director's caution (§1.3b).

---

## 1. THE XP ECONOMY — MEASURED, NOT INVENTED

### 1.1 The accrual events, and which are free

Nine candidate events, with a proposed opening weight. The **Source** column is the honest
one — it says whether an event costs a sim change to pay. **The four rows the developer
ratified on 2026-08-07 are marked ★; §1.3a re-prices the whole table against them.** Note
that `planet.*` in the Source column is now `station.*` — the lore pivot renamed the field
after this table was written.

| Event | Proposed weight (set A) | Source — how it's paid | Sim change? |
|---|---|---|---|
| ★ **Ore gathered** (mined + scavenged) | **1 / ore — RATIFIED** | Σ positive Δ`ship.cargo` | none |
| **Ore deposited** (banked) | 2 / ore | Σ positive Δ`ship.banked` | none |
| **Structure built** (turret/shield order) | 12 / each | new `BuildJob.id` in `station.builds` | none |
| **Ship upgrade bought** (one tier) | 20 / tier | Σ positive Δ Σ`ship.tiers` | none |
| **Core repair** (one discrete tap) | 3 / repair | Σ positive Δ`station.coreHp` ÷ 15 | none |
| **Wave survived** | 15 / wave | `match.wavesSpawned` at your death | none |
| **Match placement** | 20 / rung | `match.eliminated` order + `winner` | none |
| **Match won** | 200 flat | `match.winner === you` | none |
| ★ **Damage dealt** | **2 / unit — RATIFIED** | — **not recorded anywhere** — | **the hook** |
| ★ **Ship destroyed** | **5 / kill — RATIFIED** | — **no attacker recorded** — | **the hook** |
| ★ **Station destroyed** | **10 / kill — RATIFIED** | — **no attacker recorded** — | **the hook** |

**"Ore mined" is read as ore that entered your hold — mined *and* scavenged.** GDD §2.7 is
explicit that "ore is ore": mined, death-dropped and scavenged ore are one pool, read
identically by the deposit drain, and the sim does not tag a chunk with where it came from.
Paying scavenged ore differently would need chunk provenance the simulation does not carry,
and would make Vulture's whole design (the wreck scavenger) the worst-paid way to play. The
**summary screen** may still split the two rows if the developer wants them split — that is a
chunk-provenance task (a `source` tag on `Chunk`, ~half a day), and it is a display question,
not an XP one. §6.2 marks it CUT for Phase 1 with that reason.

Deposits are weighted **2× gathered** on purpose: gathering is the *effort*, banking is the
*result the design rewards* (held ore is not safe, GDD §2.3), so XP nudges toward the loop's
payoff the way the economy does. Structures and upgrades pay per-purchase (an ore sink you
chose over mining). Everything but the last row is free to pay in Phase 1.

**The kill gap, stated plainly.** `killShip(world, ship)` and `damageShip(world, target,
amount)` (`src/sim/damage.ts:25,37`) carry no source, and `destroyCore`
(`src/sim/match.ts:114`) carries none either — a core just reaches zero. So today there is
**nobody to credit a kill to**. The hook is small and localized: thread an optional
`by?: PlayerId` down `damageShip`/`damageStation` → `killShip`/`destroyCore`, and record the
last enemy to damage a hull/core (an "assist" is any *other* enemy who damaged it inside a
short window). It is a Gameplay-Engineer change, it must stay **write-only** like the ore
ledger so it never perturbs a determinism hash (GDD §4.8).

> **s4 recommended deferring this to Phase 2, and shipping Phase 1 with kills off. That
> recommendation is WITHDRAWN (a0-13, 2026-08-07).** Three of the developer's four ratified
> weights — damage dealt, ships destroyed, stations destroyed — are on this hook, and the
> fourth is ore. Phase 1 without it is a summary screen that pays only ore and prints three
> dashes, which is not a first version of the ask; it is a different ask. **The hook is
> Task PR-2, Phase 1, owned by the Gameplay Engineer**, and it is the first thing in the
> chain after the pure-function profile module. It is sized and trapped in §1.5.

**And "damage dealt" is a bigger gap than kills.** A kill at least leaves a mark in
`match.eliminated`. Damage leaves nothing at all: `damageShip` mutates `target.hull` and
returns a boolean, and no counter anywhere sums what a player has dealt. The measurement
below had to *reconstruct* it from consumed projectiles, which is exactly why the hook must
carry both — a `by` on the kill alone would leave the 2× weight unpayable.

### 1.2 What a match actually pays — measured

From `npx vite-node spikes/progression/measure-xp.ts`, seeds 1..24, N=8, octagon, **`standard`
abundance** *(labelled a1-02 — the harness omits `abundance`, and omitting it keeps
`createWorld`'s own `standard` default rather than the lobby's shipped `scarce`;
`harness/match.ts:71-75,402`)*, shipped §2.8 constants. Per-player, per match (one row = one
player's whole match):

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
- **N=8 is the stingy end** — ***half right, and the wrong half is the conclusion*** *(corrected
  a1-02 from p1-08 §5)*. Per-player ore density rises ~4× as N falls (the finite field is split
  across fewer homes — s1 §1, `homeFieldOre(n)`), so a 3-player match does pay *more*
  gathered/deposited XP per head — measured, **ore per head +126%** from N=8 to N=3. But **total
  XP FALLS 9%** (445 → 404), because at small N there is nobody to fight: damage collapses 82%
  and ship kills 81%, and the two effects very nearly cancel. So **N=8 is not the floor** this
  sentence tuned the weights against; the whole 3–8 band is 404–529 XP, and the smallest lobby
  is the *leanest* one. The finding, and what it does to the character of the pay, is §1.3e.

### 1.3 XP per match under three weight sets

Same run, same cell — N=8, octagon, **`standard` abundance** (§1.2's label) — three candidate
weight sets (full weights in `spikes/progression/measure-xp.ts`).
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

### 1.3a The RATIFIED weights, re-measured *(a0-13, 2026-08-07)*

> **⚠ EVERY TABLE FROM HERE TO §1.4 IS A `standard`-ABUNDANCE NUMBER. THE GAME SHIPS `scarce`.**
> *(corrected a1-02, 2026-08-09 — measured and flagged by p1-08 §2; this document published the
> figures without the label, which is the correction, and QA declined to edit another agent's
> file, which is why it took a second lane.)*
>
> `createWorld` keeps `standard` as its own default for backward compatibility
> (`src/sim/state.ts:1033`); the lobby ships **`DEFAULT_ABUNDANCE = 'scarce'`**
> (`src/sim/constants.ts:799`, `src/ui/lobby.ts:1046`, ratified p11 — *"by default more
> scarce"*). `measure-ratified-xp.ts:448` calls `createWorld({ seed, players })` with **no
> abundance**, so it measured `standard` — a real game, but not the one the lobby opens on.
> `tests/harness/p1-08-pay.test.ts` now pins the trap (*"omitting it is NOT the shipped
> default"*) so the next rig cannot fall into it silently.
>
> **What it cost, both columns measured on the same rig over the same twelve seeds** (median XP,
> octagon, N=8; `spikes/progression/measured-p1-08.txt`, and the tables in p1-08 §4 — so the
> difference between them is the abundance and nothing else):
>
> | lobby | `standard` — the abundance every table below is | `scarce` — what the game ships | Δ |
> |---|---|---|---|
> | EASY mirror | 327 | **296** | **−9.5%** |
> | MEDIUM mirror | 521 | **509** | −2.3% |
> | HARD mirror | 321 | **336** | +4.7% |
> | **MIXED cast** — the cell this document's headline is taken on | 416 | **445** | **+7.0%** |
>
> **So the headline figure moves +7% and the widest lobby moves −9.5%, and no conclusion in
> §1.3a–§1.4 turns on either.** The reason to correct it anyway is that a reader taking these
> tables as the shipped economy was off by that much *with no way to know*: nothing on the page
> said which economy it was. The direction is also the opposite of the obvious guess — the
> leanest field pays the **most** XP, because at `scarce` the median player both fights more and
> mines more (p1-08 §5). **Where a scarce number is known it is now printed beside the standard
> one below; where it is not, the table says `standard` and means it.**

The developer ratified four: **ore mined 1× · damage dealt 2× · ships destroyed 5× · stations
destroyed 10×.** They are not a bolt-on to §1.3's three sets; they *replace* the combat half of
them and pin the base unit (`ore = 1`) that all three sets already shared. So the pay was
re-measured from scratch rather than re-typed.

**How, and what changed about the method.** `spikes/progression/measure-ratified-xp.ts` runs
the **real shipped bot cast** — `createBots` + `runHeadlessMatch` from `src/bots` — in four
lobbies (Easy mirror, Medium mirror, Hard mirror, and the shipped mixed fill order), N=8,
octagon, **`standard` abundance** (the box above), seeds 1..12, all 48 matches ending inside the
timeout. Two things forced the change from s4's harness strategies: strategies have **no
difficulty tier**, so they cannot answer the developer's difficulty question at all; and s4's
"kills" were a match-wide ship-death count ÷ N, which cannot be multiplied by a per-opponent
tier.

**The shadow attributor, and why you may trust these numbers exactly as far as its residual.**
`Projectile` already carries `owner` (`src/sim/state.ts:524` — a shot must never hit its own
fleet). Each tick the spike diffs two snapshots: a projectile slot whose `id` changed or which
went active→inactive was **consumed**, and any entity that lost HP within reach of a consumed
shot credits that shot's owner, split across candidates in proportion to nominal damage. It is
a reconstruction, it lives entirely in the spike, and it patches nothing. Its honesty check is
printed with the results:

```
lobby                                 attributed  unattrib   ofWhich   recon  recon*   ended
EASY  mirror (Rusty/Bolt)                  24662     13836  90% clps     64%     95%   12/12
MEDIUM mirror (Foreman/Patch)             139575     18879  77% clps     88%     97%   12/12
HARD  mirror (Sable/Vulture/Warden)        85436      4310  64% clps     95%     98%   12/12
MIXED cast (shipped fill order)            94661      8209  68% clps     92%     97%   12/12
  recon* = attributed ÷ (total − collapse residual): the share of damage that HAD an attacker.
```

`recon*` is ≥95% everywhere: essentially all damage that *had* an attacker gets one. The gap
between `recon` and `recon*` is the collapse — the Crush eating cores with nobody to credit —
and it is 64–90% of the whole residual. **That is not attributor error; it is the finding in
§1.3c.**

**What a match pays, per player, in the units the weights are written in:**

```
PER-PLAYER ACCRUAL PER MATCH (median over all player-matches) — octagon, N=8, STANDARD abundance:
lobby                                     ore    dmgHP    shipK    statK    spent     dist   deaths     secs
EASY  mirror (Rusty/Bolt)                28.2      228      4.0      0.0     14.0    57705      4.0      850
MEDIUM mirror (Foreman/Patch)            23.1     1443     21.0      0.0     17.0    62208     24.0      835
HARD  mirror (Sable/Vulture/Warden)      12.8      689     11.0      0.0      8.0    33486     16.0      823
MIXED cast (shipped fill order)          28.9      768     12.5      0.0     17.0    63430     16.5      835
```

**The same four lobbies as the game actually seats them** *(added a1-02 — p1-08 §4, the shipped
observer and the shipped credit ledger, same twelve seeds, `scarce`)*. Print this one when
somebody asks what a match pays; print the one above only when comparing against a0-13:

```
PER-PLAYER ACCRUAL PER MATCH (median) — octagon, N=8, SCARCE (DEFAULT_ABUNDANCE):
lobby                                     ore    dmgHP    shipK    statK   struct     upgr   repair    medXP
EASY  mirror (Rusty/Bolt)                19.4      182      3.0      0.0      4.0      0.0      0.0      296
MEDIUM mirror (Foreman/Patch)            20.9     1606     23.0      0.0      3.0      1.0      0.0      509
HARD  mirror (Sable/Vulture/Warden)      16.7      756     14.0      0.0      2.0      1.0      1.0      336
MIXED cast (shipped fill order)          26.5      871     13.0      0.0      3.0      1.0      0.0      445
```

**Two of this document's own caveats die on that second table, and one survives.** §1.2 warned
that the harness *"under-builds and never repairs"* and that structure XP was **a floor, not a
typical** — measured with the shipped trees, structures are **2–4 per player per match in every
cell and 9–12% of all XP paid**, the third-largest row in the economy, so half that warning is
retired (Trap 10 is amended to match). Repairs really are ~0–1 and ~1% of pay, so the other half
stands. And the damage rows the shadow attributor reconstructed came in **1–6% low** against the
ledger that shipped — exactly the direction its published residual predicted, and not enough to
move a conclusion.

Three things to read off it before any weight is applied. **Damage is measured in HP and lands
in the hundreds-to-thousands** while a kill lands in the tens and a station kill in the units —
that is the unit problem, below. **Median station kills are 0.0 in every lobby**, Hard included:
a match has seven station deaths and eight players, so most players get none. And **Medium bots
are the churniest cast in the game** — 24 own-deaths and 1443 HP dealt per player against Hard's
16 and 689 — which is a measured property of the shipped trees, not a typo, and it is what makes
§1.3c's farm finding land where nobody expected it.

#### The unit question — "damage dealt 2×" per WHAT?

A weight is not an economy until its unit is chosen, and this is the one number the developer's
ask does not contain. Ore has an obvious unit (one ore). Damage does not: 1 HP occurs about a
thousand times more often per match than a kill does. Measured, pooling all four lobbies
(`standard`), here is what each candidate unit does to the *composition* of one match's XP —
**normalised over the ratified four only**, which is what makes the percentages below add to
100% without the participation rows in them:

| one unit of "damage dealt" = | ore % | damage % | ship kills % | station kills % | raw XP |
|---|---|---|---|---|---|
| **1 HP (the literal reading)** | 2% | **94%** | 4% | **0%** | 1518 |
| 10 HP | 11% | 63% | 25% | 1% | 224 |
| **25 HP — RECOMMENDED** | 17% | 41% | 40% | 2% | 145 |
| 50 HP (one base hull) | 22% | 25% | 50% | 3% | 118 |
| 100 HP (one core) | 25% | 15% | 58% | 3% | 105 |

**The literal reading defeats the developer's own ordering.** At 1 HP per unit, "damage dealt"
is 94% of all XP earned and "stations destroyed" — the row weighted highest, at 10× — rounds to
0%. A player would earn more from four seconds of chipping a rival's shield than from killing
their home. The weights say station ≫ ship ≫ damage ≫ ore; only a unit choice makes the economy
say it too.

**Recommended: one unit of damage dealt = 25 HP** (`DAMAGE_HP_PER_UNIT = 25`, `TUNABLE`). It is
the choice where all four rows are legible at once — combat (damage + kills) is 42% of the
four-row pay, ore is 17%, and §1.3c's participation rows carry the rest — and where a full 50-HP
hull melted pays 4 XP-points against the 5 the kill itself pays, so finishing a ship is worth
about as much as the work of getting it there. It is one constant, it is the tuning dial, and
**Question B** puts it in front of the developer as a number they may simply overrule.

**Measured against the shipped pricer, it does exactly what it was chosen to do** *(added a1-02
— p1-08 §6, mixed cast, `scarce`)*: under the full eleven rows, **damage is 19% of pay and ship
kills are 19%** — one point apart, which is the equality 25 HP was picked to produce — ore is
6%, and the seven participation rows take **55%** between them. The 17%-ore figure above is the
four-row normalisation, not a contradiction of it. `DAMAGE_HP_PER_UNIT = 25` **ships and stays**:
moving it to 50 halves damage's share and breaks the equality toward the kill; moving it to 10
restores the problem it was chosen to avoid.

### 1.3b Opponent strength scales the pay *(a0-13)*

> *"also bot difficulty needs to be taken into account for XP with real players counting as HARD
> possibly (or perhaps their LVL also is taken into account)"* — developer, 2026-08-07

A kill is not worth a flat 5×; it is worth 5× **times what it cost to get**. One table, beside
the weights, and nothing scattered anywhere else:

| Opponent | Multiplier | Where the tier comes from |
|---|---|---|
| **Easy** bot (Rusty, Bolt) | **×0.75** | `PERSONALITIES[id].difficulty` — local, deterministic, unspoofable |
| **Medium** bot (Foreman, Patch) | **×1.00** | same |
| **Hard** bot (Sable, Vulture, Warden) | **×1.25** | same |
| **Human** | **×1.25** | a decision, not a measurement — see below |
| *(the opponent's LEVEL)* | *(not shipped)* | untrusted, farmable, invisible — see below |

The multiplier applies to the **three opponent-facing rows only** — damage dealt, ships
destroyed, stations destroyed. Ore mined has no opponent, so it is never multiplied. Both
numbers are `TUNABLE`.

**Difficulty scaling is cheap and safe, and that is the whole argument for it.** The tier is
already in the client, already deterministic, and cannot be spoofed by anybody: nothing about a
bot's difficulty ever arrives over a wire. `a0-06` is moving the lobby to picking the
*character*, and a character carries its tier, so the multiplier reads straight off the seat
with no new data path and no new lobby field.

**"Real players count as HARD" is a decision, not a fallback — and this document says so rather
than shipping a bare constant.** A human is not reliably harder than Warden; a beginner is
reliably easier than Rusty. The honest framing is that a human is scored at the top tier because
**contesting a person is the point of the mode** — the multiplier pays for the *kind* of
opposition, not for a measured difficulty. Write that reasoning down beside the constant, or
somebody re-tunes it in six weeks on the argument that "humans lose more often than Warden
does," which is true and irrelevant.

**Scaling by the opponent's LEVEL is the risky half, and it is a different idea wearing the same
clothes.** Three reasons it is held rather than merely deferred:

1. **It is untrusted data.** §2.2 records that m9 has **no accounts** and that the profile is
   client-local; §2.1 is now ratified local-only, with the signed-profile shape *sketched* and
   explicitly not built. A level arriving from another client is a number that client authored.
   Paying XP on it is paying XP on a claim.
2. **It is farmable.** Two players who cooperate — one high-level, one grinding — turn a lobby
   into an XP faucet. Difficulty scaling has no equivalent: a bot's tier is not something a
   friend can inflate.
3. **It makes your pay depend on someone else's progression**, so the same match played twice
   pays differently for reasons the player cannot see — and cannot be shown, because the
   visibility ratification (§Q2) hides other players' levels everywhere but the lobby. That
   fights the readability the entire summary screen exists for.

**Recommendation: ship difficulty scaling with humans at the top tier; hold level-scaling until
profiles are integrity-checked.** That integrity work is *sized* in §2.2 — option (a), the
HMAC-vouched profile modeled on `src/net/ticket.ts`: a `profile?: string` field beside
`JoinMessage.ticket`, a signature check in `admitsJoin` (`match-server.ts:231`), and a wire test;
call it two days, no new dependency, no new storage — and it is **not built here**. If the
developer wants level-scaling sooner it is their call: **Question D** puts the trade in front of
them with these three points rather than a refusal.

**What the multiplier actually moves, measured** (at `DAMAGE_HP_PER_UNIT = 25`, `standard`
abundance, **combat rows only, no participation rows** — so these are *not* the XP/min the
shipped economy pays; see §1.3c(3), corrected):

```
multiplier: none (control)                  multiplier: 0.75 / 1.0 / 1.25 (recommended)
lobby                    medXP   XP/min     lobby                    medXP   XP/min
EASY   mirror               67        5     EASY   mirror               58        4
MEDIUM mirror              243       17     MEDIUM mirror              243       17
HARD   mirror              133       10     HARD   mirror              162       12
MIXED  cast                161       12     MIXED  cast                162       12
```

A wider 0.5/1.0/1.5 spread was measured too (Easy 46, Hard 192): the choice moves Hard's pay by
about ±20% and Easy's by ∓20%, and moves nothing else. It is a dial, not a design.

### 1.3c Three consequences the developer should decide about, not discover

**(1) The four ratified weights have no participation floor, and the floor was the design.**
s4's finding #1 was that winner:first-out came in at **1.1–1.7×** — "XP is a *hook* that rewards
showing up and playing the loop, so a player who loses their first eight matches still climbs."
The ratified four delete every row that produced that property. Measured, at
`DAMAGE_HP_PER_UNIT = 25` with the recommended multiplier, **`standard` abundance**:

| lobby | spread, ratified four ONLY | spread, + s4's participation rows | median, four only | median, + rows |
|---|---|---|---|---|
| EASY mirror | **0.3×** | 0.9× | 58 | 295 |
| MEDIUM mirror | 1.1× | 2.1× | 243 | 513 |
| HARD mirror | 6.7× | 12.1× | 162 | 321 |
| MIXED cast | 7.2× | 10.8× | 162 | 407 |

**A spread below 1.0× means the first player knocked out earns MORE than the winner**, and in an
Easy lobby that is exactly what the four weights alone produce: 0.3×. The reason is plain once
seen — a turtle who wins by outlasting everyone deals little damage and kills nobody, and under a
purely combat-and-ore economy that is a losing hand. Adding s4's non-combat rows back (deposited
2/ore, structure 12, upgrade 20, repair 3, wave survived 15, placement 20/rung, win 200 — all of
them already denominated in the same 1-XP-per-ore base the developer just ratified) restores the
floor and lifts the typical match from 149 XP to **399 XP**.

The developer ratified the *combat* weights and never ruled on the rest of the table, so keeping
them is the reading this plan recommends — but it is their table. **Question A.**

**Re-measured against the shipped pricer, and confirmed** *(a1-02, from p1-08 §6)*. Every
four-only figure above reproduces **inside 7%** (59 / 260 / 167 / 171 against 58 / 243 / 162 /
162; spreads 0.3× / 1.2× / 6.6× / 6.5×). In an Easy lobby the first player knocked out still
earns more than three times what the winner does. **One published number does move, and it is the
one an implementer would type:** this section's *"that would need either `base = 75`… or a global
×4"* (§1.4) was computed off a 149-XP typical; measured off the shipped pricer at the shipped
default lobby a four-only match pays **169 XP**, so the replacement value is **`base = 150`, not
75** — and even at 150 an Easy lobby (four-only median 47) does not reach level 2 in a match.

**(2) The station-kill weight pays almost nobody, because the Crush does the killing.** Measured
over the same 48 matches (`standard`) — who actually took a station's core to zero:

| lobby | killed by a player | killed by the Crush | Crush share |
|---|---|---|---|
| EASY mirror | **0** | 96 | **100%** |
| MEDIUM mirror | 2 | 82 | **98%** |
| HARD mirror | 75 | 9 | 11% |
| MIXED cast | 61 | 23 | 27% |

Against soft opposition, **every station death in this sample was the claim closing in** (GDD
§2.3 — "the contracting claim finishes whoever the players don't"). So the highest-weighted row
in the developer's list is unearnable in an Easy lobby and near-unearnable in a Medium one, and
the multiplier cannot help: ×0.75 of zero is zero. Three honest options — pay nobody
(**recommended**: entropy is not an attacker, GDD §2.2/§2.3, and the under-attack alarm already
refuses to ring for core decay on exactly that reasoning), pay the last player who damaged that
core inside a window, or replace the row with a "survived to the collapse" one. **Question C.**

*(Re-measured across every lobby, map, N and abundance in p1-08's sweep: the median player
destroys **zero** stations in **every single cell**, and the row is 0–2% of all XP paid. Whichever
way Question C goes, the 10× row is the smallest thing in the economy.)*

**(3) The XP farm is real, and it is not where it was expected.** Offline XP counts the same as
online (ratified, §Q5) and Hard bots pay a premium, so "farm Hard bots alone" is the obvious
worry. Measured, it is **wrong**: the fastest XP per minute in the game is a **Medium** bot lobby,
against Hard and Easy. Medium bots fight constantly and die constantly
(24 deaths per player per match) and so hand out damage and ship kills faster than Hard bots,
who are cagier and end matches sooner. The multiplier narrows that gap; it does not close it.

**The ordering survives; the numbers were the wrong economy's** *(corrected a1-02 from p1-08 §6
Question E)*. This section originally read *"a **Medium** bot lobby at **17 XP/min**, against
Hard's 12 and Easy's 4"* — those are §1.3b's **combat-rows-only** figures, an economy this
document does not recommend. Under the economy that shipped (all eleven rows, `scarce`):

| lobby | published here (combat rows only) | measured, shipped economy (`scarce`) | (`standard`) |
|---|---|---|---|
| EASY mirror | 4 | **20.9** | 23.1 |
| MEDIUM mirror | **17** | **36.6** | 37.4 |
| HARD mirror | 12 | 24.7 | 23.9 |
| MIXED cast | 12 | 32.4 | 29.9 |

Every rate roughly doubles-to-quintuples, and — the part that matters — **the gap collapses:
fastest-to-slowest is 1.8×, not the 4.3× this section published.** Farming the best tier over the
worst buys 75% more XP per minute, not 325% more. The finding is the same finding and it is much
weaker than *"a Medium lobby is the farm"*; the recommendation (leave it alone) is unchanged, and
is now made with more confidence rather than less.

So the statement to put in front of the developer is not "Hard bots are the cheapest XP" but:
**an uncontested solo bot lobby is the highest XP/minute in the game at every tier, and which
tier pays best is a property of the bot trees rather than of the multiplier — so it will move
the next time the Bot Engineer touches them.** For a cosmetic-only progression that may be
entirely fine. **Question E**, and it is a fact, not a bug.

### 1.3d The recommended economy, in one place

Everything above, as the numbers an implementer types. Every one is `TUNABLE` and QA owns them
from m10 (GDD §2.8's discipline).

| Row | XP | Multiplied by opponent tier? | Paid from |
|---|---|---|---|
| Ore mined (into the hold: mined + scavenged) | **1 / ore** | no | world delta — free |
| Damage dealt | **2 / 25 HP** | **yes** | **the hook (PR-2)** |
| Ship destroyed | **5 / kill** | **yes** | **the hook (PR-2)** |
| Station destroyed | **10 / kill** | **yes** | **the hook (PR-2)** |
| Ore banked | 2 / ore | no | world delta — free |
| Structure ordered | 12 / each | no | world delta — free |
| Ship upgrade bought | 20 / tier | no | world delta — free |
| Reactor patched | 3 / repair | no | world delta — free |
| Wave survived | 15 / wave | no | world delta — free |
| Placement | 20 / rung | no | world delta — free |
| Match won | 200 flat | no | world delta — free |

Rows 1–4 are the developer's, verbatim. Rows 5–11 are s4's, unchanged, and are **Question A**.
Median match pay: **399 XP** (mean 459) — *a `standard` number, from a0-13's reconstruction*.
**Re-measured against the shipped observer and pricer it is 416 at that same cell and 445 at the
one the lobby actually opens on** (`scarce`), and **296–529 across every cell in p1-08's sweep**
*(a1-02)*. The headline *"a typical match pays ~400 XP"* stands, and no global scale factor is
needed — see §1.4.

### 1.3e What the pay is a property of — the CAST, not the board *(added a1-02, from p1-08 §5)*

a0-13 measured one cell (octagon, N=8, `standard`) four ways and called the lobby the variable.
p1-08 swept the three axes this document never varied — 240 matches, all ended — and the result
is worth stating as a rule rather than as four more tables, because it tells the next lane which
knobs are worth measuring and which are noise:

Each row holds everything but its own axis at the shipped default (mixed cast · octagon · N=8 ·
`scarce`) and reports the median-XP band across that axis:

| axis | swept | median XP | spread |
|---|---|---|---|
| **cast (lobby)** | Easy · Medium · Hard · mixed | **296 → 509** | **1.7×** |
| lobby size N | 8 · 6 · 5 · 4 · 3 | 404 → 529 | 1.3× |
| map | octagon · compass · oval · diamond | 423 → 470 | ±5% |
| abundance | scarce · standard · rich | 401 → 445 | ±11% |

**The cast is a wider effect than the map, the lobby size and the abundance put together.** So
"what does a match pay?" is answered by *who is in it*, and a re-baseline that varies anything
else first is measuring the wrong thing. It is also the standing warning of §1.3c(3) restated
from the other end: the pay moves when the **Bot Engineer** moves a tree, not when a designer
moves a board.

**And the economy is flat across lobby size, for a reason that cancels itself.** The intuition —
per-player ore density rises as N falls (`homeFieldOre(n)`), so a small match should pay more —
is **half right and backwards on the conclusion** (§1.2, corrected):

| N | ore/head | damage HP | ship kills | **med XP** | combat share of pay |
|---|---|---|---|---|---|
| 8 | 26.5 | 871 | 13.0 | **445** | 39% |
| 6 | 34.5 | 1184 | 22.0 | **529** | 40% |
| 5 | 39.0 | 908 | 16.0 | **518** | 29% |
| 4 | 55.7 | 280 | 4.0 | **454** | 10% |
| 3 | 59.9 | 159 | 2.5 | **404** | 6% |

Ore per head climbs **+126%** from N=8 to N=3 — and XP **falls 9%**, because at small N there is
almost nobody to fight: damage collapses 82% and ship kills 81%. The two effects very nearly
cancel, so **a 3-player match does not pay more per head**; the whole band is 404–529 XP, a 1.3×
spread. What *does* change is the **character** of the pay: at N=3 a match is 6% combat and a
third ore-and-banking, at N=8 it is 39% combat. The curve is not broken at small N; it is barely
disturbed by it — which is the answer to a question this document had left open by only ever
measuring N=8.

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

**Level 2 lands inside a single match for the median player** *(corrected a1-02 — the qualifier
is load-bearing and this document used to omit it; see the re-proof below)* — the hook, you level
up your first game — levels 3–5 across a handful, and the curve then stretches so level 20 is a
long-tail goal (~430 matches). The two knobs do exactly what a designer wants: **`base` moves the whole
early game** (how fast level 2–5 arrive), **`exp` moves the tail's steepness** (how far
apart the high levels sit). Because the curve is measured against real match pay, "how many
matches to level 10?" is an answer, not a hope — and if the developer wants level 10 to feel
like a season's worth, that's `exp`; if they want it in a week, that's `base`.

#### Re-proved against the ratified weights *(a0-13, 2026-08-07 — "ok" ratifies `base=300`/`exp=1.6`)*

The developer accepted these two numbers, and the brief was right to insist they be re-proved
rather than re-asserted: the numbers were fitted when a match paid **634 XP** (s4 weight set A),
and the ratified weights changed what a match pays. Measured now, at `DAMAGE_HP_PER_UNIT = 25`
with the tier multiplier, **`standard` abundance** (§1.3a's box):

| economy | median match pay | level 2 | level 5 | level 10 | level 20 |
|---|---|---|---|---|---|
| s4 set A (the numbers the curve was fitted to) | 634 XP | 0.5 matches | 9.0 | 63 | 411 |
| **ratified four + participation rows (recommended)** | **399 XP** | **0.8 matches** | 14.3 | **101** | 654 |
| ratified four ONLY | 149 XP | 2.0 matches | 38.4 | 270 | 1754 |

**The ratification survives, unchanged, and needs no scale factor** — on the recommended
economy. "Level 2 in one match" is still true **of the median player** (0.8 of a match here;
0.6–1.0 in nineteen of p1-08's twenty cells, the twentieth an Easy `scarce` lobby at 1.01);
level 5 arrives across a fortnight of casual play instead of a week; level 10 stretches from ~67
matches to ~101, which is a long-tail goal getting longer, not a wall appearing. p1-08 re-measured
the tail against the shipped code and it holds: **level 10 at 76–135 matches** across every cell
(96.6 at this one), level 20 at 493–880. **`XP_CURVE_BASE = 300`, `XP_CURVE_EXP = 1.6` and
`DAMAGE_HP_PER_UNIT = 25` all stay where they are**, on QA's measurement as well as this one.

#### The half of that sentence that is FALSE, and what it costs *(corrected a1-02, from p1-08 §7)*

This document published the claim as *"level 2 lands inside a single match, **so a first match
levels you even if it goes badly**."* The first half is measured and true. **The second half is
false, and it is the half a designer would act on** — it promises a floor that no row in §1.3d
pays. Measured on the shipped default lobby (mixed · octagon · N=8 · `scarce`), the same twelve
matches:

| seat | XP | matches to level 2 |
|---|---|---|
| winner | 1123 | 0.3 |
| median seat | 445 | **0.7** ✅ the claim |
| 25th percentile | 255 | 1.2 |
| **first player knocked out** | **68** | **4.4** ❌ |
| worst seat in the sample | 38 | 7.9 |

**A new player's first match is not the median seat's match**, and the player this promise was
written for — the one whose first game goes badly — is exactly the one it does not reach. The
reason is structural rather than tuning: an eliminated player survives no further waves, clears
**zero** placement rungs (`rungs = slots − placement`, so the first one out clears none *by
construction*) and wins nothing, so three of the seven participation rows pay them zero.

**The fix does not belong in the curve.** Dropping `base` far enough to level a 68-XP match
(`base ≤ 68`) would put the median seat at level 2 in a sixth of a match and wreck the pacing the
developer ratified. It belongs in the participation floor — and a new row in the developer's own
weight table is theirs to add. Three options, priced by QA against the same twelve matches
(`docs/progression-balance-p1-08.md` §7), are **Question F** at the foot of this document.
**Until it is answered, this document states the claim as what it measurably is: level 2 lands
inside a single match for the MEDIAN player.**

**On the ratified four alone it does NOT survive:** level 2 takes two matches, so the hook — you
level up your first game — is gone, and level 10 sits at 270 matches. That would need either a
much smaller `base` (identical shape, a fraction of the numbers) or a global XP scale. Both were
measured and both work; neither is needed if Question A goes the recommended way. *(The value
this section originally published, `base = 75`, was computed off a 149-XP four-only typical.
Measured off the shipped pricer a four-only match pays **169 XP** at the default lobby, so **the
replacement is `base = 150`** — corrected a1-02 from p1-08 §6. Even at 150 an Easy lobby does not
reach level 2 in a match.)* **This is the concrete cost of dropping the participation rows, and
it is why Question A is first.**

**A note for whoever tunes this next.** The pay above is a *bot* number, and it still is after
the re-baseline: **there is no human in p1-08's 240-match sample and no way to get one from a
harness.** Real humans mine more and die less than Medium bots do, so the pay a person earns is
not this pay, and the right way to close that gap is telemetry off real play rather than a bigger
harness run. What p1-08 *did* settle is that the instrument is honest and the constants are
right; what it did not settle is the human half. If the developer wants a target instead of a
measurement, the two dials are unchanged: `base` moves the early game, `exp` moves the tail.

### 1.5 Sizing the attribution hook *(a0-13 — promoted to Phase 1)*

The change, in the smallest form that pays all three ratified combat rows. It is Task **PR-2**
(§7), owned by the **Gameplay Engineer**, and it is the only `src/sim/` change in this whole
plan.

**The shape.**

```ts
// src/sim/damage.ts:25, src/sim/buildings.ts:770,796,719 — an OPTIONAL attacker on the
// four existing damage entry points. Every current caller keeps compiling.
export function damageShip(world: World, target: Ship, amount: number, by?: PlayerId): boolean
export function damageStation(world: World, station: MiningStation, amount: number, by?: PlayerId): boolean
export function damageTurret(turret: Turret, amount: number, by?: PlayerId): boolean
export function damageSatellite(sat: RadarSatellite, amount: number, by?: PlayerId): boolean
```

and one write-only ledger beside the ore one, keyed by slot:

```ts
// src/sim/combat-credit.ts (new) — the same discipline as src/sim/ore-ledger.ts.
export interface CombatCredit {
  dealtToShips: number[];    // HP, by attacker slot
  dealtToStations: number[]; // HP, by attacker slot
  shipKills: number[];
  stationKills: number[];
  /** Last enemy to damage this hull/core, and when — the killing-blow answer. */
  lastHitBy: (PlayerId | null)[];
  lastHitAt: number[];
}
```

**Where `by` comes from.** Every damaging call site already knows: `projectiles.ts` holds
`p.owner` on the shot that struck (it must, to avoid friendly fire), and turret shots carry the
station owner. **Nothing new is inferred** — the value is passed down a call that already has
it, which is why this is a small change rather than a design.

**Five traps, and the answers this plan ratifies so a lane does not have to invent them:**

1. **Assists.** An assist is any *other* enemy who damaged the same hull inside `ASSIST_WINDOW_S`
   (`TUNABLE`, opening value 5 s) before it died. **Phase 1 pays no assist XP** — the damage they
   dealt already paid them, at 2× per 25 HP, which is the honest version of an assist. The
   window is still recorded, because the summary may want to name it later.
2. **Self-damage and allies.** A shot cannot hit its own fleet (`canDamage`, `allegiance.ts:90`),
   so friendly credit cannot arise from a projectile. It *can* arise from a collision or a future
   mechanic: the credit call must ask the same `canDamage` predicate and refuse to credit an ally
   or the victim themselves. Do not re-implement the question (GDD §2.9's rule).
3. **Collateral from turrets.** A turret's kill is credited to the **station owner**, not to
   nobody and not to the turret. A player who bought the deterrent gets the kill it makes — that
   is what they paid for (GDD §2.6).
4. **A kill after the attacker died.** A projectile outlives its owner's hull. Credit the
   **owner slot**, always, even if that ship is dead or the player is eliminated: the slot is the
   accounting key, not the hull. (A player eliminated from the match still earns the XP their
   last shots produce — they simply stop shooting.)
5. **A shared kill.** The killing blow — the `shipKills`/`stationKills` +1 — goes to the **last
   enemy to land damage**, one player, never split. The *damage* rows already split the work
   proportionally, so splitting the kill too would pay the same contribution twice, and a
   fractional kill on a summary screen ("0.5 SHIPS DESTROYED") is a number nobody can read.

**Two invariants that are not negotiable, and a test that pins each:**

- **Determinism.** The credit ledger is **write-only** and **outside `hashState`**, exactly like
  `src/sim/ore-ledger.ts`. Nothing in `step` may ever read it. *Test:* the CI replay test's final
  hash is byte-identical with the ledger present and absent.
- **Honesty.** A stat that cannot be credited to a real player is **not shown** rather than
  estimated. A core the Crush finished has no killer, and the summary prints nothing for it
  (§1.3c(2), §6.2). *Test:* a match run to full collapse with no player-dealt core damage credits
  zero station kills to everybody.

**Size:** one day for the threading and the ledger, one for the tests, assuming the ore-ledger
pattern is copied rather than re-argued.

---

## 2. PERSISTENCE ARCHITECTURE

> **RATIFIED 2026-08-07 — LOCAL ONLY, and keep it simple.** Verbatim: *"we may need a backend
> at some future point, but for now lets just keep it simple, locally stored."* So §2.1 ships as
> written, and §2.2's signed-profile / HMAC-vouch work stays **sized, not built** — it is the
> option that gets *chosen* the day integrity matters, not the option that gets built now.
>
> Two design obligations follow, and they are the whole reason to say this out loud today
> rather than discover it later:
>
> 1. **Version the schema from the first write.** No reset path ships (§Q4 below), so migration
>    is the *only* repair tool this profile will ever have. A stored profile with no version is
>    one nobody can fix — not the developer, not a support reply, not a future you.
> 2. **Keep the shape backend-portable.** No device-specific fields, no data that only makes
>    sense on this machine. A later backend should be a **sync** problem, not a rewrite; that is
>    what *"we may need a backend at some future point"* buys, and it costs nothing today.
>
> It also settles §1.3b's level-scaling question by itself: opponent-**level** XP scaling needs
> a profile somebody can trust, and a local-only profile is a claim.

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
  // phase 2 only, behind the COSMETIC ruling (§3):
  unlocked?: string[];      // cosmetic ids the player has earned
}
const PROFILE_KEY = 'planet-rush:profile';           // flat prefix, like every other key
```

*(`points?: number` — unspent skill points — is **dropped** from this shape by the 2026-08-07
cosmetic ratification: a level→unlock list has nothing to spend, §4.)*

**Two rules the shape above is obeying, added 2026-08-07 and load-bearing:**

- **`v` is written on the FIRST save and validated on every read.** The reader accepts `v: 1`,
  folds anything it does not recognise to a fresh profile, and — critically — **a future `v: 2`
  blob must not crash a `v: 1` reader** (Task PR-1's test says so in words). Because no reset
  ships, a migration function is the only way a bad profile ever gets fixed, so the version
  field is not bookkeeping; it is the repair seam.
- **Nothing in this blob may be device-specific.** No screen size, no input scheme, no install
  id, no "last map". Those belong to the flat `planet-rush:*` settings keys that already hold
  them. The test for whether a field belongs here is: *would this number still be true if the
  player picked up a different phone and signed in?* If not, it is a setting, not a profile.

**Boundaries, and the traps the seam sets:**

- **Inject the seam, don't reach for `localStorage`.** Copy `createBrowserHaptics(platform.storage)`
  (`main.ts:264`) — a progression module that takes `platform.storage` as a constructor
  dependency tests headless and never touches a browser global.
- **The store holds strings only.** The profile must `JSON.stringify` on write and
  `JSON.parse` + **validate every field** on read (fold a corrupt blob to a fresh profile,
  exactly like `readMapId`). This is the first payload that needs a `v` version field — none
  of the existing readers have one, so establish the convention here.
- **The seam has no `remove` and no `keys`** (`platform.ts:36-39`) — only `get`/`set`.
  *(Amended 2026-08-07: the "reset my progress" button that needed this is **cancelled** — the
  developer ruled progression is never wiped, §Q4. The seam extension is still worth doing for
  the migration path — a migration that must **replace** a profile can do it with `set`, but one
  that must **retire a key** cannot — so `remove(key)` stays in Task PR-6, without the button
  that motivated it. The sole implementation to touch is `platform.ts:104-119`.)*

- **Migration is the only repair tool, so it must exist before it is needed** *(2026-08-07)*.
  Since no profile can ever be cleared, "just delete it and start again" is not available to a
  player, to the developer, or to a support answer. `loadProfile` therefore owns three paths and
  a lane must implement all three or the fourth one happens by accident: **known version** →
  read; **older known version** → migrate forward, then read; **unknown / corrupt / newer** →
  fold to a fresh profile, and *keep the raw string under `planet-rush:profile.bak`* so a
  recoverable blob is not destroyed by a reader that could not parse it. That last clause is the
  one that gets skipped, and it is the only thing standing between a schema bug and a wiped
  career the player was promised would never be wiped.
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
it does. (Absent doc note: `docs/hosting-plan.md` was still referenced across the allocator
but not in the repo when this was written; it exists now, and the account-persistence sizing
above belongs there or in a new brief when accounts are ratified.)

> **RATIFIED 2026-08-07 — none of (a), (b) or (c) is built.** *"for now lets just keep it
> simple, locally stored."* Option **(a)** stays the chosen shape for the day integrity is
> needed, sized in §1.3b at about two days: a `profile?: string` beside `JoinMessage.ticket`,
> a signature check in `admitsJoin` (`match-server.ts:231`), a wire test, no new dependency and
> no new storage. Option (c) is post-launch and needs an identity the game does not have.
>
> **What that costs, named once so nobody re-discovers it as a surprise:** every XP number is
> as trustworthy as the machine it was earned on. For a **cosmetic** progression (§3, ratified)
> that is the correct trade — the thing a cheat buys is a hat. It is also precisely why
> opponent-**level** XP scaling does not ship (§1.3b): it would make one player's pay depend on
> another player's unverifiable claim.

---

## 3. THE FAIRNESS QUESTION — ANSWERED: COSMETIC *(ratified 2026-08-07)*

> **The ruling, verbatim:** *"i asked for XP before and it looks like that didn't make it into
> the list... not clear yet what it will be for, but probably cosmetics as you gain levels
> you'll unlock new items things like that"*
>
> **Decision: option (1), COSMETICS ONLY. An unlock may not touch a simulation constant.** That
> is this section's own recommendation, taken; what changes is that §3 is now a decision rather
> than an option space, and three things follow immediately:
>
> - **The per-player modifier seam of §4 is not built.** It was the architectural cost of
>   sidegrades, and sidegrades are not happening. The whole of Trap 7 (modifiers as static match
>   config, off the per-tick snapshot) becomes *unneeded* rather than *deferred* — which is a
>   real saving, and the reason this ruling makes Phase 2 small.
> - **No new balance sweep is opened.** §4's "every sidegrade node re-opens a balance sweep"
>   (Trap 9) does not apply to a livery. The ≤55% class ceiling (GDD §2.11) is untouched.
> - **The soft local profile is now good enough, permanently** (§2.2). The thing a tampered
>   profile buys is a hat.
>
> **The developer's own hedge is recorded here on purpose:** *"not clear yet what it will be
> for."* Cosmetic is ratified as the **direction**, not as a content list. If this is revisited,
> it is a **change** to a ratified decision — argued against §3's four options below, which are
> kept in full for exactly that reason — and not a contradiction of something nobody wrote down.
> **What the items are, how they are earned, and what a level grants are NOT decided, and this
> document deliberately does not design them.**

The reasoning that produced the ruling, kept in full:

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

## 4. THE TREE — RE-OPENED, AND ANSWERED: A LIST, NOT A TREE *(2026-08-07)*

> **The developer, on §4 as it stood:** *"whats this tree thing?"*

That question is a signal about this document, not about the developer. §4's three shapes were
written when *powers* and *bounded sidegrades* were live options — a tree exists to make you
**choose**, and a choice is only interesting when the branches are mutually exclusive and
mechanically different. **With cosmetic-only ratified (§3), there is nothing to choose between.**
A livery is not exclusive with a trail; nobody agonises over which hat to unlock first; and a
prerequisite graph over hats is a UI a player has to learn in order to receive presents.

**Decision: cosmetics ship as a LEVEL → UNLOCK LIST, not a tree.** One ordered table — *level 2
grants X, level 4 grants Y* — read top to bottom. Concretely, that is:

| | a tree | a list |
|---|---|---|
| data | nodes, edges, prerequisites, a spend | `Record<level, unlockId[]>` |
| player action | choose, spend, possibly regret | none — it arrives |
| new UI | a graph screen, pan/zoom, node states | one column on an existing screen |
| profile fields | `unlocked[]`, `points` | `unlocked[]`, derivable from `level` alone |
| Phase 1 cost | a screen | **zero** — the level readout already shows the level |

The last row is the argument. With a list, the **profile does not even need `unlocked[]` to be
authoritative** — it is derivable from `level`, so the stored array is a cache, and a corrupt
profile cannot lose a player their hats.

**What would earn a tree its place back, stated so the answer is falsifiable rather than a
preference:** a tree pays for itself the moment two unlocks are *mutually exclusive* (a choice)
or *gated on something other than level* (a challenge, a season, a purchase). If cosmetics ever
become "pick one of three at level 5," this section reverses — and the migration is cheap,
because a list is a degenerate tree and never the other way round.

**This document does not design the unlock content**, and the brief chain contains no task that
does. Phase 1 is fairness-neutral by construction and ships regardless; the list is empty until
the developer fills it.

### 4.1 The three tree shapes — KEPT AS REASONING, NOT AS A MENU

Everything below was written for a sidegrade world and is superseded by the ruling above. It is
kept for one reason: if §3 is ever revisited, this is the argued option space, and re-deriving
it would cost a week. **No lane may build from §4.1.**

**SKILL-TREE SHAPES — three sketches, grounded in real tunables** *(superseded 2026-08-07)*

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
| Ore Miser | `DEATH_ORE_DROP_FRACTION` 1→0.85 | keep more on death, −`BASE_SPEED` (slower haul). *Baseline restated 2026-08-16 (a0-59): the constant is 1, not the 0.5 this row was drafted against, so the perk now claws back from a total drop.* |
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
| Scavenger | loot-on-contact radius (`CHUNK` pickup) | +pickup, −`DEATH_ORE_DROP_FRACTION` gain: you drop more. *Dead as drafted since a0-59 — the fraction is 1 and cannot go up, so this downside needs a different cost.* |
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

## 5. PHASE 1 CUT — what ships FIRST *(re-cut 2026-08-07, a0-13)*

XP accrual + levels + **the end-of-match summary as a choreographed sequence (§6)** + the lobby
level badge, with local persistence and **NO unlocks**. It is fairness-neutral, and it is no
longer a zero-sim-change cut: **the attribution hook moved into it** (§1.5), because three of
the four ratified weights sit on it. Needs-ordered, TDD — each task names the test to write
**first**. The tasks are emitted as claimable brief files in `docs/briefs/` and indexed in §7;
the summaries below are the plan's view of the same work.

**Three things s4 put in this cut are now CANCELLED, and it matters that they are named rather
than quietly missing:**

- **The persistent in-match XP bar** (s4 Task P4's first UI moment). The visibility
  ratification (§Q2) is *"we can show the LEVEL but not XP (and show it only in the lobby)."*
  An XP bar on the HUD is exactly the thing that answer forbids: it is XP, and it is in the
  match. It does not ship, in any size, anywhere on the HUD.
- **The "reset progress" settings button** (s4 Task P5). Progression is never wiped (§Q4). The
  `platform.storage` `remove` extension survives without it, for migration (§2.1).
- **The per-player modifier seam and every tree task** (s4's Phase 2). Cosmetic-only (§3) means
  no unlock ever touches a sim constant, so the seam has nothing to carry.

### Task PR-1 — the profile module, versioned and migratable (Platform + UI) · *needs: nothing*
*Test first:* a round-trip — a fresh profile persists and reloads equal to itself; a
corrupt/absent blob folds to `{v:1, xp:0, level:1, matches:0}`; a **future `v:2` blob does not
crash a `v:1` reader**; an unparseable blob is preserved under `planet-rush:profile.bak` before
the fold. *Change:* `src/progression/profile.ts` — `loadProfile(storage)` / `saveProfile(storage,
p)` over `platform.storage`, **injected** (mirror `createBrowserHaptics(storage)`,
`main.ts:264`), JSON-encoded under `planet-rush:profile`. No sim import, no browser global.
**Trap:** no reset path ships, so migration is the only repair this profile will ever get
(§2.1) — write the migration seam now, empty, rather than the day it is needed.

### Task PR-2 — the attribution hook (Gameplay Engineer) · *needs: nothing*
*Test first:* a two-ship fixture where A kills B credits A with B's hull HP and exactly one ship
kill; a turret kill credits the **station owner**; a shot in flight when its owner dies still
credits that owner; a **full-collapse match with no player core damage credits zero station
kills to everybody**; and the **CI replay hash is byte-identical with the credit ledger present
and absent**. *Change:* an optional `by?: PlayerId` on `damageShip`/`damageStation`/
`damageTurret`/`damageSatellite`, plus `src/sim/combat-credit.ts` — **write-only, outside
`hashState`**, exactly like `src/sim/ore-ledger.ts`. Full shape, the five attribution traps and
the sizing are §1.5. **This is the only `src/sim/` change in the plan.**

### Task PR-3 — the curve (UI Engineer) · *needs: nothing*
*Test first:* `levelForXp(0) === 1`; boundary XP values map to the right levels;
`xpToNext(L) = round(base·L^exp)` reproduces §1.4's table. *Change:* `src/progression/curve.ts` —
pure functions, `base = 300` / `exp = 1.6` exported as `TUNABLE` constants (ratified §Q6).

### Task PR-4 — the accrual observer + the XP economy (UI Engineer) · *needs: PR-2, PR-3*
*Test first:* a scripted fixture match yields the expected ore/deposit/structure/upgrade/repair/
wave/placement counts **and** the expected damage/kill credits read off the ledger; the tier
multiplier applies to the three opponent-facing rows and to no other. *Change:*
`src/progression/accrual.ts` (per-tick world diff, promoted from the spike but driven off the
**live match's** world) and `src/progression/xp.ts` (the §1.3d table, every weight `TUNABLE`).
Read-only over the world. **Trap:** online, observe the **authoritative** world (the server's),
never the predicted local one, or a mispredicted tick double-counts.

### Task PR-5 — the summary as a choreographed sequence (UI Engineer) · *needs: PR-1, PR-4; builds on a0-09*
The whole of §6: the row list, the timeline, skip, reduced motion, the phone size, and the write
site. *Test first:* skipping produces **exactly** the same final numbers as watching; the
sequence's end state equals the reduced-motion state; the full row list fits 390 px wide with no
scroll; the profile is written **once**, at teardown. **Trap:** the animation must never compute
a number (§6.3 rule 2).

### Task PR-6 — the lobby level badge + the storage seam (UI + Platform) · *needs: PR-1*
*Test first:* a seat row renders its own level badge; **no other surface in the game renders a
level or any XP** — asserted as an absence, over nameplates, HUD and the end screen's opponent
rows; `remove` deletes a key. *Change:* the badge on the lobby seat row (§Q2), and
`remove(key: string): void` on the `platform.storage` interface (`platform.ts:35-39`) and its one
browser implementation (`platform.ts:104-119`).

### Task PR-7 — the four summary cues (Sound Agent) · *needs: a0-01's re-voice; feeds PR-5*
Four new bank slots, voiced against the **amended** §4.7 tone contract. Requirements in §6.5.
**Not** the existing `matchEnd`, `musicWin` or `musicLoss`: all forty slots are under `deny-all`
(a0-01), and a satisfying sound from the denied bank is one the developer has already rejected.

### Task PR-8 — re-baseline the economy (QA Agent) · *needs: PR-4, PR-5* · **DONE**
*Test first:* the pay table and the level curve are re-measured with the **shipped bot trees and
real play**, not the spike's numbers, and the result is filed as a balance report against §1.4's
table. §1.2's caveat applies to every number in §1.3a: the harness under-builds and under-repairs,
and a bot economy is not a human one.
**Landed 2026-08-09** — `docs/progression-balance-p1-08.md`, 240 matches, swept across cast × N ×
map × abundance. Verdict: all three constants stay; §1.2's *structure* caveat is retired and its
*repair* caveat stands; **two corrections to this document** (the missing abundance label, and the
level-2 claim's missing "median") are folded in above by a1-02; the human half is still unmeasured
and always will be from a harness.

*(Phase 2, and NOT in this cut: the cosmetic unlock **list** (§4) — which needs content the
developer has not written; the signed-profile join field (§2.2a) — which unblocks opponent-level
XP scaling (§1.3b) if Question D goes that way; and accounts (§2.2c), post-launch.)*

---

## 6. THE END-OF-MATCH SUMMARY — A BEAT, NOT A TABLE *(new 2026-08-07, a0-13)*

> *"we need a fun end of match screen, that shows total ore mined, damage dealt, distance
> travelled, ships used, ore used, etc. all of the stats you can think of"*
>
> *"it needs to feel like a video game end match screen with the score counting up, the progress
> bar filling up to show you current level, whats left till next level as it fills up, and gives
> a rewarding animation as it fills up and completes… plus a satisfying sound"*

This is a first-class ask, not one of s4's "three UI moments". It is specified here as a
**sequence with a timeline**, because a screen with animations sprinkled on it and a
choreographed beat are different products and only the second one was asked for.

**It builds on `a0-09`, it does not fork it.** That lane rewrote `src/ui/end-of-match.ts` to be
team-aware and merged on 2026-08-08 (#328); `MatchOutcome`, `onYourSide`, `endKind`, `endButtons`
and `endOfMatchLayout` are the shipped surface this sequence extends. The gate is met: PR-5 starts
from that file rather than beside it.

### 6.1 What the screen already is

Pure and DOM-free: `endOfMatchModel(outcome, pointer)` derives the words and buttons,
`endOfMatchLayout` places them, `./end-of-match-view` draws them, and the whole thing is
gantry/bone material with **REMATCH as the one bright plate** (GDD §4.7). The tone note in that
file's header is load-bearing and this section does not overturn it: *the station-death ache is
carried by the result*, and the XP sequence is a separate, brighter beat that happens **after**
the result has landed. A level-up does not make a defeat cheerful; it happens underneath it.

### 6.2 The rows — every stat, then marked

"All the stats you can think of" is the right instinct for a *list* and the wrong one for a
*screen*: thirty numbers communicate nothing. So: enumerate generously, then mark each one
**SHOW** (drawn, no XP), **XP** (pays, not drawn as its own row), **BOTH**, or **CUT**, with the
reason. The CUT column is the Architect's call and is cheap to reverse — say the word and a row
moves.

| Stat | Verdict | Reason |
|---|---|---|
| **Ore mined** (into the hold) | **BOTH** | The developer's own first row, and the ratified 1× base. |
| **Damage dealt** | **BOTH** | Ratified 2×. Shown in HP — the unit the player sees on every bar. |
| **Ships destroyed** | **BOTH** | Ratified 5×. |
| **Stations destroyed** | **BOTH** | Ratified 10×. Shows `—`, never `0`, when the Crush did the killing (§1.3c). |
| **Distance travelled** | **SHOW** | Explicitly asked for. It is a *flavour* number — pays no XP, because paying it would reward flying in circles. |
| **Ships used** (your own deaths + 1) | **SHOW** | Explicitly asked for. Never XP: paying for it rewards dying, and *charging* for it punishes the free-respawn design (GDD §2.7). |
| **Ore used** (spent on builds/upgrades/repairs) | **SHOW** | Explicitly asked for, and the honest counterpart to ore mined. |
| **Ore banked** | **XP** | Pays 2/ore (§1.3d). Not its own row — it is a *subset* of ore mined and two ore rows side by side read as double counting. |
| **Defences built** | **XP** | Pays 12. A turtle's whole match, but a weak number to look at (median 3–4). |
| **Ship upgrades bought** | **XP** | Pays 20/tier. |
| **Reactor patched** | **XP** | Pays 3. Median 0–1 per match: a row that is usually zero is a row that teaches nothing. |
| **Waves survived** | **XP** | Pays 15. Duplicated by "match time", below. |
| **Placement / match won** | **XP** | Pays 20/rung + 200. Already the *headline* of this screen (VICTORY / DEFEAT) — printing it again as a row is the same fact twice. |
| **Match time** | **SHOW** | One line under the headline, not a row. Free, and it frames every other number. |
| **Accuracy (shots hit ÷ fired)** | **CUT** | The sim counts neither. A new counter for a flavour row is not worth a `src/sim` change. |
| **Ore mined vs scavenged, split** | **CUT** | Needs chunk provenance the sim does not carry (§1.1). Half a day; offer it if the developer wants the Vulture fantasy on screen. |
| **Longest life / kill streak** | **CUT** | Both derivable from PR-2's ledger, neither asked for. Phase 2 if the screen ever feels thin. |
| **Per-opponent breakdown** | **CUT** | Another player's stats are not yours to read (§Q2), and this is the screen that answer most obviously binds. |

**Seven visible rows** — ore mined, damage dealt, ships destroyed, stations destroyed, distance
travelled, ships used, ore used — plus a match-time line, the XP total, and the level bar. That
is the list §6.4's phone constraint is sized against, and it is why the CUT column had to be
strict.

**One display rule the row list does not soften.** A stat that cannot be credited to a real
player is **not shown rather than estimated** (§1.5). "Stations destroyed" reads `—` when the
core in question decayed under the Crush, not `0` and never a guess.

### 6.3 The timeline — named beats, in order

Times are `TUNABLE` opening values; the *order* and the rules are not.

| # | Beat | Duration | What happens |
|---|---|---|---|
| 0 | **The result lands** | 0.0 – 1.2 s | a0-09's existing screen, alone. VICTORY / DEFEAT / DRAW / ELIMINATED, the subhead, the accent. **Nothing of the XP sequence exists yet** — the ache gets its beat first (GDD §4.7). |
| 1 | **Rows arrive, one at a time** | 1.2 s + 0.18 s per row | Each row lands (fade + short rise) and **its number counts up from 0 to its final value over 0.5 s**, easing out. Seven rows ⇒ the last one starts at ~2.5 s. The XP each row earned lands beside it as the count-up finishes. |
| 2 | **The XP total counts up** | +0.9 s | One number, from 0 to the match total, faster than the rows so it reads as a summation of them rather than an eighth row. |
| 3 | **The bar fills** | +1.4 s | The level bar starts **where the player started the match** — not at zero — and fills toward the next level. The level readout and "N XP to next" are live throughout. This is the beat the developer described, and it is the reason the bar must not be a static "after" picture. |
| 4 | **The level-up moment** *(conditional)* | +0.8 s each | The bar completes, flashes, resets to empty, the level readout ticks up, and the cue hits. Then the fill resumes with whatever XP is left. |
| 5 | **The settle** | +0.4 s | Everything holds at its final value; the buttons (REMATCH, and SPECTATE or MENU) take focus. |

**Total ≈ 5 s** for a typical match, ≈ 6 s with one level-up. That is a long time to sit through
twice, which is why beat 6 exists:

### 6.4 Four rules that hold the implementer, and are testable

1. **Skippable, always.** Any input — a tap anywhere, any key, any pad button — snaps **every**
   counter and the bar to their final values instantly and jumps to the settle. Players see this
   screen every match, and the second time it is a toll. **Skipping must land on exactly the same
   numbers**: never a different total because the animation was cut short. *Test:* run the
   sequence to completion, and run it with a skip at every 100 ms mark; assert byte-identical
   final models. **The skip must not also press a button** — the first input skips, the second
   can act, or a player who taps twice rematches by accident.
2. **The animation never computes the numbers.** Counters interpolate toward values the sim and
   the accrual observer already fixed at teardown. A tween that *produces* the score is a score
   nobody can reproduce and no test can pin. *Test:* the model is fully determined before the
   first frame; the view is a pure function of `(model, elapsed)`.
3. **`prefers-reduced-motion` is honoured** — the sequence collapses to its end state (every row
   at its final number, the bar at its final fill, the buttons live), **with the level-up still
   marked** as a static state rather than silently dropped. ⚠ **The brief that ordered this
   section said reduced motion is "already respected elsewhere in the client." It is not.**
   `grep -rn "reduced-motion\|reducedMotion" src/ index.html public/ style-guide.md` returns
   **nothing** — there is no media-query read, no setting and no seam anywhere in the client
   today. The nearest neighbour is **`reduceVfx`** (`src/render/index.ts:409`,
   `main.ts:1964`), and it is *not* this: it is a **performance** reducer driven by a sustained
   frame-rate drop plus a match setting, it sheds decorative VFX while keeping the load-bearing
   tells (GDD §4.3, risk 5), and it says nothing about what the player asked their operating
   system for. It is, however, exactly where a motion preference belongs *beside*. So PR-5 is
   where the seam gets built, not where an existing one is honoured: a
   `prefersReducedMotion(): boolean` read on the `platform.ts` abstraction (never a bare
   `window.matchMedia` in UI code — GDD §4.1's platform rule), with the same defensive-default
   discipline as every other setting. It is small, and it is the honest scope note.
4. **Landscape phone is the target size.** The seven rows, the XP total, the bar and the level
   readout must fit at **390 px** wide with **no scroll**, alongside the existing headline and
   buttons. If they do not, §6.2's SHOW column was too generous — cut a row, do not add a
   scrollbar. *Test:* the layout function at 390×844 and at 844×390 places every element inside
   the viewport, safe areas included.

**Two cases the spec must answer, because they are the common ones and both look like bugs:**

- **More than one level in a match.** A bar cannot fill twice in the same second and be readable.
  Beat 4 repeats — fill, flash, reset, tick, resume — with each subsequent fill **capped at 0.5 s**
  so three levels take 1.5 s rather than 4.2. Past **three** level-ups in one match, collapse the
  rest: the bar jumps straight to the final level and the readout shows `LEVEL 7 (+4)`. Nobody
  needs to watch a bar fill five times, and a first match after a long absence can do exactly that.
- **Almost no XP at all.** The common case for a short match, and a bar that visibly does nothing
  is the failure mode this whole section exists to avoid. The rule: **the bar always animates for
  its full beat-3 duration**, however small the delta, so the motion is constant and only the
  distance changes; and the readout underneath carries the number that *did* move
  (`+34 XP · 266 TO NEXT`). A player who earned little should see that they earned little — not
  see nothing and conclude the screen is broken.

### 6.5 The sound — four cues, and NOT the ones already in the bank

The sound is not free, and it is not this brief's to invent. `matchEnd` is already a bank slot,
and `candidates.ts` carries a *Victory Sting* (`musicWin`) and a *Defeat Sting* (`musicLoss`) —
but **all forty slots are under `deny-all` right now** (a0-01), being re-voiced to clean modern
sci-fi because the shipped set read as retro and toony (`docs/audio-revoice-spec.md`; GDD §4.7 as
amended 2026-08-06). So: **no lane may reach for the existing stings.** A satisfying sound drawn
from the denied bank is a satisfying sound the developer has already rejected.

Four cues, as **requirements handed to the Sound Agent** (Task PR-7), to be voiced against the
amended §4.7 tone — clean, modern, futura sci-fi; no `square`, no `saw`, none of the arcade
idioms §5 of the revoice spec retires:

| Cue | Beat | Requirement |
|---|---|---|
| `xpTick` | 1–2 | The count-up tick. Heard **dozens of times in five seconds**, so it is the `pressTick` problem, not the `matchEnd` one: tiny, dry, pitched *up* slightly as the count rises, and utterly non-fatiguing. It must survive being heard every match forever. |
| `xpBarFill` | 3 | A sustained, rising bed under the fill — a *filling* sound, not a repeated one. Ends when the bar does. Must duck cleanly under a level-up landing on top of it. |
| `levelUp` | 4 | **The one moment allowed to be a reward.** Short, bright, decisive, and it must read as *arrival* rather than fanfare — the amended tone contract's ceiling, not the old one's fireworks. This is the "satisfying sound" the developer asked for; the other three exist so this one lands. |
| `xpSettle` | 5 | The full stop. Quiet. Tells the player the screen is finished and their input now means something. |

**Two constraints on the set, not on the individual cues.** They mix **under** whatever the
result already sounded (a station death is still the ache), and the whole sequence must be
**silent under a skip** past the settle cue — a player who skipped is telling you they do not
want the beat, and firing seven queued ticks at them is the opposite of that.

---

## 7. THE BRIEF CHAIN

The Phase 1 cut, emitted as claimable brief files. Each carries its own Definition of Done and
its own evidence line; a lane claims one, reads its `needs:` edges, and does not improvise.

| Brief | Owner | Needs | What it is |
|---|---|---|---|
| [`pr-01-profile-store`](briefs/pr-01-profile-store.md) | Platform + UI | — | The versioned, migratable local profile |
| [`pr-02-attribution-hook`](briefs/pr-02-attribution-hook.md) | Gameplay | — | `by: PlayerId` on the damage path; the write-only credit ledger |
| [`pr-03-level-curve`](briefs/pr-03-level-curve.md) | UI | — | `xpToNext` / `levelForXp`, pure |
| [`pr-04-accrual-and-xp`](briefs/pr-04-accrual-and-xp.md) | UI | pr-02, pr-03 | The observer, the weight table, the tier multiplier |
| [`pr-05-summary-sequence`](briefs/pr-05-summary-sequence.md) | UI | pr-01, pr-04 (a0-09 landed) | §6 — the rows, the timeline, skip, reduced motion |
| [`pr-06-lobby-level-badge`](briefs/pr-06-lobby-level-badge.md) | UI + Platform | pr-01 | The badge, and only in the lobby; the storage seam |
| [`pr-07-summary-cues`](briefs/pr-07-summary-cues.md) | Sound | a0-01 | Four new slots, voiced to the amended §4.7 |
| [`pr-08-rebaseline`](briefs/pr-08-rebaseline.md) | QA | pr-04, pr-05 | Re-measure the pay and the curve with shipped bots and real play |

```
pr-01 ─┬─────────────► pr-05 ──┬──► pr-08
       └──► pr-06              │
pr-02 ─┬──► pr-04 ─────────────┘
pr-03 ─┘
pr-07 (a0-01) ────────► feeds pr-05
```

**pr-01, pr-02 and pr-03 had no dependencies and were claimable in parallel.** pr-02 was the long
pole: it is the only `src/sim/` change, and pr-04 and everything downstream of it waited on the
credit ledger existing.

**The whole chain has landed** *(recorded a1-02, 2026-08-09)* — `src/progression/{profile,curve,
accrual,xp}.ts`, `src/ui/summary-sequence.ts` and `src/sim/combat-credit.ts` are shipped, and
**pr-08 re-baselined the economy against them**: `harness/pay.ts`, `harness/cli.ts pay`,
`tests/harness/p1-08-pay.test.ts` and the report at `docs/progression-balance-p1-08.md`. Its
findings are folded into §1 above rather than left in a second document to drift; the corrections
it raised **against this document** are marked *(corrected a1-02)* and listed at the top. What is
left of Phase 1 is not a task — it is Question F.

---

## TRAPS (the ones that bite an implementer who skims)

1. **The sim tracks no killer, AND no damage dealt.** `killShip`/`damageShip`/`destroyCore` take
   no attacker (`damage.ts:25,37`, `match.ts:114`; `main.ts:2147` says it in words), and nothing
   anywhere sums the damage a player has dealt. **Three of the four ratified weights are on that
   gap**, so it is Phase 1 work (PR-2), not a thing to read off the world. (§1.1, §1.5)
2. **No per-player counters exist** — only the match-wide ore ledger (`ore-ledger.ts`), which
   is aggregate, not per-slot. Per-player accrual is *observed*, by diffing world deltas.
   (§1)
3. **`platform.storage` is strings-only and has no `remove`/`keys`** (`platform.ts:36-39`).
   The profile must JSON-encode; the migration path needs the interface extended (PR-6). The
   *reset button* that used to motivate that extension is cancelled — progression is never
   wiped (§Q4). (§2.1)
4. **The profile is the FIRST versioned payload** — no existing reader has a `v` field. Add
   one and validate every field on read, folding corrupt to default like `readMapId`. (§2.1)
5. **m9 has no accounts and no server storage** — the server is ephemeral, the registry is
   "a cache, not a database." Server-authoritative persistence has no home; a signed *local*
   profile is the account-less answer, and it is only **soft**-trusted. (§2.2)
6. **A soft profile cannot gate a competitive power** — and, since 2026-08-07, cannot be
   trusted to price one either. The owner edits their own `localStorage`; the signature stops
   wire-forgery, not offline self-editing. That is why unlocks are cosmetic (§3) *and* why XP
   does not scale by the opponent's level (§1.3b). (§2.2, §3)
7. ~~**Unlock modifiers are static match config**~~ — **RETIRED 2026-08-07.** Cosmetic-only
   means no unlock ever touches a sim constant, so the per-player modifier seam is not built and
   this trap has nothing to warn about. Kept struck-through rather than deleted: if §3 is ever
   revisited, this is the first thing that comes back. (§3, §4)
8. **XP is written once, at match-end, and the sim must never read the profile.** A profile
   read inside `step` would break determinism (GDD §4.8) and desync online. Observe the
   world; write the profile at teardown. (§5)
9. ~~**Every sidegrade node re-opens a balance sweep.**~~ — **RETIRED 2026-08-07** with Trap 7,
   and for the same reason: a livery does not move a win rate. (§3, §4)
10. **Harness build/repair numbers are a floor, not a typical** — ***half retired 2026-08-09***.
    The s4 probes under-build; real bot trees build **more**, and PR-8 measured how much:
    **structures are 2–4 per player per match in every cell and 9–12% of all XP paid**, the
    third-largest row in the economy, so the structure half of this warning is discharged and
    §1.2's median-0 rows must not be quoted as a typical. **Repairs really are ~0–1 (≈1% of
    pay)**, so the repair half stands. Humans are still unmeasured, in either row. (§1.2, §1.3a)
11. **A weight is not an economy until its unit is chosen.** "Damage dealt 2×" at a literal
    1 HP makes damage 94% of all XP and the highest-weighted row, stations destroyed, 0%. Pick
    `DAMAGE_HP_PER_UNIT` deliberately; do not let it default to 1 by omission. (§1.3a)
12. **The Crush kills most stations, and it is not an attacker.** 100% of station deaths in an
    Easy bot lobby and 98% in a Medium one were the collapse, not a player. A stat with no
    attacker is shown as `—`, never as `0` and never estimated — the same reasoning that stops
    the under-attack alarm ringing for core decay (GDD §2.2, §2.3). (§1.3c, §1.5, §6.2)
13. **The four ratified weights have no participation floor.** On their own they make the first
    player knocked out out-earn the winner in an Easy lobby (0.3×). If Question A drops s4's
    non-combat rows, the level curve must be re-tuned in the same change — `base=300` stops
    landing level 2 inside a first match for anyone, and the measured replacement is
    **`base = 150`**, not the 75 this document published before PR-8 re-priced it.
    (§1.3c, §1.4)
14. **XP is never shown in a match, and another player's level is never shown at all.** The
    ratified answer is *level yes, XP never, lobby only* (§Q2). That kills s4's persistent HUD
    XP bar outright, and it binds the summary screen: your own level and XP, nobody else's.
    Assert it as an **absence**, over nameplates, HUD and the end screen — an absence nobody
    tests for is an absence that comes back. (§Q2, PR-6)
15. **`prefers-reduced-motion` is NOT honoured anywhere in this client today.** A grep over
    `src/`, `index.html`, `public/` and the style guide returns nothing. `reduceVfx` is **not**
    it — that is a frame-rate reducer that sheds decorative VFX (GDD §4.3, risk 5), not a motion
    preference. PR-5 **builds** the seam (on `platform.ts`, never a bare `window.matchMedia` in
    UI code); it does not inherit one. (§6.4 rule 3)
16. **The end-of-match sound may not come from the existing bank.** All forty slots are under
    `deny-all` (a0-01), including `matchEnd`, `musicWin` (Victory Sting) and `musicLoss`
    (Defeat Sting). Reaching for them ships a sound the developer has already rejected. Four
    new slots, voiced to the amended §4.7 tone. (§6.5, PR-7)
17. **Skipping the sequence must not change a single number.** The animation interpolates
    toward values fixed at teardown; a tween that produces a score is a score nobody can
    reproduce. And the input that skips must not also press a button. (§6.4 rules 1–2)
18. **`createWorld` defaults to `standard` abundance; the LOBBY ships `scarce`** *(new
    2026-08-09, a1-02 — the trap this document fell into)*. `createWorld({ seed, players })`
    with no `abundance` measures a real game that nobody plays: the lobby opens on
    `DEFAULT_ABUNDANCE = 'scarce'` (`constants.ts:799`). Every rig **names the abundance in
    every cell**, and every table **prints which one it is** — the cost of the omission was up
    to ±10% per lobby and, worse, unknowable from the page. `harness/match.ts` omits it too, on
    purpose and documented, so an inherited default is not an excuse. Pinned by
    `tests/harness/p1-08-pay.test.ts`. (§1.3a)
19. **"Level 2 in one match" is a claim about the MEDIAN player, and only that** *(new
    2026-08-09, a1-02)*. Measured on the shipped default lobby: median 445 XP (0.7 matches),
    **first player knocked out 68 XP (4.4 matches)**. Anything that quotes the hook to a
    *player* rather than to *the median* — an onboarding line, a store page, a tuning argument —
    is quoting a number the economy does not pay them. The floor is a **row** question, open as
    **Question F**; it is not a `base` question and it is not QA's to invent. (§1.4, Question F)

---

## THE DEVELOPER'S RATIFICATIONS — s4's six questions, ANSWERED 2026-08-07

Folded into the sections they change (LESSONS §17: a ratification belongs in the body, not in an
appendix); repeated here as the dated record of who decided what. **`§Q<n>` anywhere in this
document means the numbered item below** — `§Q2` is the visibility ruling, `§Q4` the reset one,
and so on.

1. **The fairness stance → COSMETIC.** *"probably cosmetics as you gain levels you'll unlock new
   items things like that."* Folded into **§3**, with the developer's own hedge — *"not clear yet
   what it will be for"* — recorded there, so a later change reads as a change rather than a
   contradiction. Consequences: no modifier seam, no balance sweep, Traps 7 and 9 retired.
2. **Visibility → LEVEL yes, XP never, and LOBBY only.** *"we can show the LEVEL but not XP (and
   show it only in the lobby)."* This is a **stronger** answer than s4 recommended, and it
   resolves the fog objection cleanly: a level badge sits on a **lobby seat row and nowhere
   else** — not on an in-match nameplate, not in the HUD, and not on the end screen for anyone
   but yourself. The badge is gone before the match starts, so it can never be read as in-match
   information about a live opponent (GDD §2.2). **Raw XP is private to its owner, always.**
   Folded into **§5** (which cancels s4's persistent HUD XP bar), **§6.2** (no per-opponent
   breakdown), **PR-6**, and Trap 14.
3. **Skill-tree shape → the developer asked what it was.** *"whats this tree thing?"* Answered as
   a signal about the document, in **§4**: with cosmetic-only ratified, a tree is the wrong
   structure and a **level → unlock list** is the right one. The three shapes are kept as
   superseded reasoning. **No unlock content is designed here.**
4. **Reset policy → NEVER.** *"no."* The player-initiated reset is dropped from the cut; the
   storage-seam extension it needed survives for **migration**, which is now the profile's only
   repair tool. Folded into **§2.1**, **§5** and **PR-1**/**PR-6**.
5. **Offline XP → SAME as online.** *"yes."* Folded into **§1.3c(3)** together with the
   difficulty multiplier, and the consequence is written down rather than left to be discovered:
   an uncontested solo bot lobby is the highest XP/minute in the game. Measured — and the fastest
   tier is **Medium**, not Hard, which is the opposite of what was expected.
6. **Level curve → ACCEPTED.** *"ok."* `base=300` / `exp=1.6` kept, and **re-measured** against
   the ratified weights and the multiplier in **§1.4**: level 2 still lands inside one match
   **for the median player** (0.8), level 10 moves from ~67 matches to ~101. It survives *on the
   recommended economy*; on the ratified four alone it does not, which is Question A. **Re-proved
   a third time against the shipped code by PR-8 and unchanged** — `XP_CURVE_BASE`,
   `XP_CURVE_EXP` and `DAMAGE_HP_PER_UNIT` all stay — with one qualifier this document had been
   omitting: the hook is the **median** seat's, and a player knocked out first needs 4.4 matches
   (**Question F**, corrected a1-02).
7. *(s4's Q6, kill/assist XP — deferred or now?)* **NOW.** Reversed by a0-13: the ratified
   weights put three of four rows on the hook, so deferring it ships a screen that pays only ore.
   **§1.5**, Task **PR-2**.

Also ratified in the same pass and folded in: **persistence stays LOCAL ONLY and simple**
(*"we may need a backend at some future point, but for now lets just keep it simple, locally
stored"*) — **§2**, with the two obligations it creates (version from the first write; keep the
shape backend-portable).

---

## QUESTIONS FOR THE DEVELOPER *(A–E raised by what the ratifications cost; F by the re-baseline)*

**A. Keep the participation rows, or is XP purely combat + ore?** *(the big one)*
Your four weights are ratified and are not in question. What they do not say is whether the
*other* seven rows s4 measured — ore banked, defences built, upgrades bought, reactor patched,
waves survived, placement, match won — still pay anything. Measured, dropping them changes the
character of the whole system: in an Easy bot lobby **the first player knocked out earns more
XP than the winner (0.3×)**, because a turtle who wins by outlasting everyone deals little
damage and kills nobody. It also drops a typical match from ~400 XP to ~170, which means
`base=300` no longer lands level 2 inside a first match for anyone. *Recommendation:* **keep
them** — they are what makes XP "a hook that rewards showing up," and they cost nothing to pay
(they are all free world deltas). **Re-measured against the shipped pricer, every number in this
question reproduces inside 7% and the recommendation is confirmed unchanged** *(a1-02, from
PR-8)*; if you drop the rows anyway, the measured replacement for `XP_CURVE_BASE` is **150**, not
the 75 this document used to say. §1.3c(1), §1.4.

**B. What is one unit of "damage dealt"?** Your `2×` needs a denominator, and it is the single
number that decides what the whole economy feels like. At **1 HP** damage becomes 94% of all XP
and your highest-weighted row — stations destroyed — becomes 0% of it. *Recommendation:*
**one unit = 25 HP**, which makes a full 50-HP hull melted worth about as much as the kill that
ends it. It **shipped** at 25, and measured on the shipped pricer it does exactly that: damage is
**19%** of pay and ship kills **19%**, one point apart *(a1-02, from PR-8)*. §1.3a.

**C. A station the Crush killed — who gets the 10×?** Measured over 48 matches: **100% of station
deaths in an Easy bot lobby and 98% in a Medium one were the collapse phase, not a player.**
Against Hard bots it is 11%. So your highest weight is unearnable in a soft lobby. Options: pay
**nobody** *(recommended — entropy is not an attacker, and the under-attack alarm already refuses
to ring for core decay on exactly that reasoning)*; pay the **last player to damage that core**
inside a window; or replace the row with a **"survived to the collapse"** one that everybody can
earn. §1.3c(2).

**D. XP scaled by the opponent's LEVEL — hold, or ship it?** You raised it as a possibility
(*"or perhaps their LVL also is taken into account"*). *Recommendation:* **hold it** until
profiles are integrity-checked, for three reasons: a level arriving from another client is a
number that client authored (there are no accounts, §2.2); two cooperating players — one high
level, one grinding — turn a lobby into a faucet; and it makes your pay depend on someone else's
progression, invisibly, which fights the readability the summary screen exists for. The
integrity work is sized at ~2 days (§2.2a) and is not built. If you want it sooner, say so and
it becomes PR-9. §1.3b.

**E. The bot farm — fine, or worth capping?** Offline XP counts the same as online (your call,
and the right one for a first-class offline game), so the cheapest XP in the game is a private
lobby full of bots. Measured, the fastest is **a MEDIUM lobby at 36.6 XP/min** — not Hard (24.7)
and not Easy (20.9) — not because of the multiplier, but because Medium bots fight and die
constantly. Which tier pays best will move whenever the Bot Engineer touches the trees.
**The advantage is far smaller than this document first said** *(corrected a1-02: the published
"17 vs 4, a 4.3× gap" was §1.3b's combat-rows-only economy, which this plan does not recommend;
under the economy that shipped it is **1.8×** — farming the best tier over the worst buys 75%
more XP per minute, not 325% more)*. *Recommendation:* **leave it alone**
— for a cosmetic-only progression, a player grinding hats against bots is a player playing the
game. Say the word and it becomes a daily cap or a small offline multiplier, but both are new
systems to maintain and neither is free. §1.3c(3).

**F. Does a player who is knocked out first earn a floor?** *(NEW 2026-08-09 — raised by QA's
re-baseline, `docs/progression-balance-p1-08.md` §7/§9; folded in by a1-02, which is also where
this document stopped over-claiming)*
This plan promised that *"level 2 lands inside a single match, so a first match levels you even
if it goes badly."* Measured on the lobby the game actually opens on, **only the first half is
true**: the median seat earns 445 XP (0.7 matches to level 2) and **a player knocked out first
earns 68 XP and needs 4.4 matches.** They survive no further waves, clear **zero** placement rungs
(the first one out clears none *by construction*) and win nothing — so three of the seven
participation rows pay them nothing, and the promise reaches everyone except the player it was
written for. **This is a row in your weight table, so it is your call and not QA's or mine.**
Three options, priced against the same twelve matches:

| option | median | first out | **L2 @ first out** | winner:first-out spread |
|---|---|---|---|---|
| **accept it** — restate the claim as "for the median player" *(what this document now does)* | 445 | 68 | **4.4** | 16.6× |
| a flat `MATCH PLAYED` row, **+100** | 545 | 168 | 1.8 | 7.3× |
| **a flat `MATCH PLAYED` row, ≈230–250** — the one payment an eliminated player is guaranteed | ~675 | ~298 | **~1.0 — the promise, literally true** | **~4.5×** |
| a flat `MATCH PLAYED` row, **+200** | 645 | 268 | 1.1 | 4.9× |
| `XP_PER_WAVE` 15 → 40 — helps a little, and only a player who lived through a wave | 561 | 93 | 3.2 | 13.5× |
| `XP_PER_PLACEMENT_RUNG` 20 → 40 — the intuitive dial, and the wrong one | 537 | **68** | **4.4** | **18.7×** |

*(The +100 and +200 rows are priced directly; the ≈230–250 row interpolates them — a flat row
adds the same number to every seat, so `first out = 68 + f` and the arithmetic is exact. Every row
is the **same twelve matches re-priced**, never a second sweep taken on a different afternoon.)*

Two things the table is worth reading twice for. **The intuitive dial cannot work:** doubling
`XP_PER_PLACEMENT_RUNG` pays the first player out *exactly nothing* (they clear zero rungs) while
paying the winner twice, and it moves the spread the **wrong** way, 16.6× → 18.7×. And **a flat
row at +200 would collide with `XP_FOR_WIN = 200`**, which would say that showing up is worth what
winning is — a design statement, not a tuning one, which is why the recommended value sits just
above it at ~232 and why nobody has applied it for you. *Recommendation:* **accept it for now**
— the claim is restated, no constant moves, and nothing ships wrong; **and if you want the promise
kept, say "add the floor" and QA applies ≈230–250 and re-baselines.** The curve is *not* the place
to fix this: a `base` small enough to level a 68-XP match would put the median seat at level 2 in
a sixth of a match. §1.4, §1.3c(1).

*(Secondary defaults, safe if unanswered: `DAMAGE_HP_PER_UNIT = 25`; tier multiplier
0.75 / 1.0 / 1.25 with humans at 1.25; XP banked once at match-end; deposits weighted 2× gathered;
level curve `base=300`/`exp=1.6`. The §6.2 SHOW/CUT verdicts are the Architect's and are cheap to
reverse — say the word and a row moves.)*

---

## GDD SECTION DRAFT (lands in the GDD when ratified — currency policy §2)

> ### 2.12 Meta-progression: XP, levels, and the end-of-match summary *(Architect spike s4,
> amended a0-13, corrected a1-02 against QA's re-baseline; `docs/progression-plan.md`,
> `docs/progression-balance-p1-08.md`)*
>
> A player earns **XP** every match for playing the triangle — **ore mined (1×), damage dealt
> (2×), ships destroyed (5×), stations destroyed (10×)** *(developer-ratified 2026-08-07)*, plus
> the loop's non-combat work: ore banked, defences built, ship upgraded, reactor patched, waves
> survived, and how they placed. The three opponent-facing rows are **multiplied by the
> opponent's difficulty** — Easy ×0.75, Medium ×1.0, Hard ×1.25, and a **human counts as Hard**,
> because contesting a person is the point of the mode. A player levels up on an early-fast curve
> (`xpToNext = base · L^exp`, both `TUNABLE`; **level 2 lands inside a first match for the median
> player** — a player knocked out first earns far less, and whether that seat gets a floor is
> Question F). A stat that
> cannot be credited to a real player is **not shown rather than estimated** — a reactor the
> claim's collapse finished has no killer, and the summary says so.
>
> **Level is shown; XP never is; and neither is anyone else's** *(ratified 2026-08-07)*. A level
> badge sits on a **lobby seat row and nowhere else** — never on an in-match nameplate, never in
> the HUD, never on the end screen for anyone but yourself. The badge is gone before RUSH!, so it
> can never be read as live information about an opponent (§2.2). Raw XP is private to its owner.
>
> **The match ends on a beat, not a table.** The result lands alone first — the station-death
> ache keeps its three seconds (§4.7) — and then the summary plays as a choreographed sequence:
> the stat rows arrive one at a time, each counting up; the XP total counts up; the level bar
> fills **from where the player started the match** toward the next level; a level-up lands as its
> own moment; the screen settles. It is **skippable on any input, to exactly the same numbers**,
> it honours `prefers-reduced-motion` by collapsing to its end state with the level-up still
> marked, and it fits a landscape phone without scrolling.
>
> **Unlocks are cosmetic** *(ratified 2026-08-07)*. The game's core invariant is fairness at every
> N (§2.1, §2.11), and an unlock may not touch a simulation constant — a level grants liveries,
> trails, badges and the like, from a plain **level → unlock list**, never a stat. Progression
> persists **locally**, in the same `platform.storage` family as settings, as a single **versioned**
> profile; there is no account, and **progression is never wiped**, which makes schema migration
> the only repair path the profile will ever have.

*End of spike s4, amended by a0-13 (2026-08-07), corrected by a1-02 against QA's re-baseline
(2026-08-09). Every question s4 asked has been answered; the Phase 1 chain is §7 and has shipped.
Questions A–E are what the answers cost; **Question F is what the measurement cost** — the one
promise this document made that the shipped economy does not keep for every seat. None of the six
blocks anything that is built; F is the only one that would change a number, and it is a row in
the developer's own table.*
