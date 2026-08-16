# Planet Rush — Design Amendments

Ratified changes to the GDD, recorded here so the GDD's affected sections are
**amended by reference** rather than silently drifting. Each entry names the
date, the ratifying quote, and the exact scope of the change. The interfaces in
`src/shared/` and the constants in `src/sim/constants.ts` are the machine-readable
half of these amendments; this file is the human-readable why.

---

## A destroyed ship drops EVERYTHING: the half-burn ore sink is withdrawn

**Date:** 2026-08-16 · branch `agent/gameplay/a0-59-full-death-drop`
**Ratified by:** Developer (Reinaldo) — the rule is his and this overrules the GDD
**Amends:** GDD §2.3, §2.7 and §2.8 — `DEATH_ORE_DROP_FRACTION` **0.5 → 1**. A
destroyed ship leaves its entire hold on the field; the half that used to be
destroyed with the hull is no longer destroyed at all. **Nothing else moves:**
banked ore is still never lost to a ship death, `CHUNK.ore` is still 1, the drop is
still minted in whole chunks (a0-58), and `deathLoss` is still a live ledger sink.

### The ratification, verbatim

> "destroyed ships should drop all their ore, no more 1/2 the ore stuff"

### This overturns ratified design, deliberately

GDD §2.3 has carried the half-burn since M1, and it was not decoration: it was one
of the economy's **three ore sinks** (`spent`, `deathLoss`, `capLoss`, plus `dust`
since a0-58), and the one that made a loaded hold a genuine risk rather than a
transfer. That is real ratified design being overruled by the person it belongs to,
which is his call and needs no defending here.

What it does need is **recording**, which is what this entry is for. A constant that
silently contradicts the design document is how the next agent "restores" it in
good faith six weeks from now — and the half-drop is written into §2.3's numbered
loop, §2.7's opening sentence and §2.8's table, so three separate readers would
have found three separate reasons to put the 0.5 back. All three are amended in the
same commit as the constant.

### What this does to the economy — MEASURED, not estimated

> **The headline number in this section used to read "every kill now returns twice
> the ore to the field." That was asserted, never measured, and it is too low by
> about 2.4×. Measured against the shipped build, a kill returns 4.8× more ore.
> See "The 2× was against design intent, not against the build" below for why both
> numbers are true and which one the balance crew needs.**

**Method.** 24 seeds (1–24), full natural eight-slot matches run to their own
ending on *both real builds* — this branch, and a detached `git worktree` at
`origin/main` (`221a2b1`), so neither arm is a constant flipped by hand. The ore
ledger is read at the final tick; the hold each ship carried is sampled the tick
it dies; loose-on-field ore is summed over `world.chunks` every tick and split by
`world.match.phase`. Both probes were scratch files under `tests/harness/`, run
and deleted — `git status -- src/ tests/` verified empty afterwards.

| quantity, summed over 24 matches | `main` (0.5) | a0-59 (1) | change |
|---|---|---|---|
| **death-drop ore that reached the field** | **448** | **2156** | **4.81×** |
| effective share of a dead hold that returns | **30.3 %** | 100 % | 3.30× |
| ore at risk (Σ hold carried at the instant of death) | 1479 | 2156 | 1.46× |
| deaths | 2977 | 3368 | 1.13× |
| `deathLoss` (burned with the hull) | 1031 | **0** | −100 % |
| `spent` (construction — the surviving sink) | 3835 | 4805 | +25 % |
| `looted` | 5165 | 6917 | +34 % |
| `deposited` (banked) | 3306 | 4200 | +27 % |
| `mined` (ore cut out of rock) | 4100 | 4267 | +4 % |
| wreck debris — fraction-independent, the control | 1661 | 1763 | +6 % |
| mean total live ore (rock + loose + holds + banks) | 230.45 | 228.64 | **−0.8 %** |
| mean loose ore on the field | 8.23 | 9.38 | +14 % |
| mean loose ore **during the collapse phase** | 19.93 | 23.13 | +16 % |
| mean ore riding in hulls | 2.78 | 3.33 | +20 % |

#### The 2× was against design intent, not against the build

Both framings are honest and they differ by 1.65×, so the distinction matters to
anyone budgeting for this:

- **Against the GDD's ratified rule, a0-59 is exactly 2×.** Before a0-58, `killShip`
  laid down `held × 0.5` with no rounding at all, so a dead hold returned exactly
  half. That is the number §2.3 was written against.
- **Against the build that is on `main` today, it is 3.3× on a fixed population of
  deaths, and 4.8× once the economy responds.** a0-58 made the drop mint whole
  `CHUNK.ore` pieces, and that floor lands on a hold-at-death distribution that is
  overwhelmingly small: of 2977 deaths on `main`, **2128 carried nothing at all and
  470 carried exactly 1 ore** — and `floor(1 × 0.5 / 1)` is **zero chunks**. A ship
  dying with one ore on `main` today drops *nothing*. So the shipped half-drop was
  never a half: it returned **30.3 %** of the ore that died. a0-59 takes that to
  100 %, and the richer field then puts 1.46× more ore at risk per death, which is
  where the last factor comes from.

The hold-at-death distribution, which is the load-bearing evidence and had never
been looked at (deaths, by the whole ore the ship was carrying, 24 seeds):

| hold at death | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| `main` (0.5) | 2128 | 470 | 218 | 101 | 39 | 12 | 9 | 0 | 0 |
| a0-59 (1) | 2195 | 608 | 297 | 155 | 86 | 19 | 7 | 0 | 1 |
| chunks dropped under 0.5 | 0 | **0** | 1 | 1 | 2 | 2 | 3 | 3 | 4 |
| chunks dropped under 1 | 0 | **1** | 2 | 3 | 4 | 5 | 6 | 7 | 8 |

**Internal cross-check.** Applying `floor(hold × 0.5 / CHUNK.ore)` to `main`'s own
histogram row predicts **448** ore dropped — exactly the 448 the ledger reported,
from a completely separate code path. The hold sampling and the drop model agree to
the unit, so neither is a mis-read instrument (the failure mode that produced five
wrong numbers in `docs/wave-commons-entombment.md`'s history).

**Ships die nearly empty.** 71 % of deaths on `main` carry no ore at all and a
further 16 % carry a single unit — the hold is a thing you fill and then run home
with, so it is empty most of the time a fight can find it. Any rule keyed to the
hold at the moment of death is therefore decided by the 0-and-1 buckets, not by the
full-hold case everyone reasons about.

This is not a criticism of a0-58 — the floor is correct and is deliberately kept
(see below). It is the reason the "twice" figure understates the shipped delta, and
nobody would find it without running both builds.

#### What actually moved, and what did not

- **Total ore in the economy did NOT rise.** Mean live ore is flat within 1 %
  (230.45 → 228.64). The 1031 ore that used to burn at deaths did not become 1031
  extra ore in play — it was absorbed almost exactly by a **+970 rise in `spent`**.
  The sink did not disappear; **it migrated from an invisible sink to a
  player-facing one.** Ore now leaves the economy because somebody chose to buy
  something, instead of because somebody died.
- **The field's standing puddle of loose ore is up only ~14 %**, and ~16 % during
  collapse — not double, and nowhere near 4.8×. The 4.8× is *throughput*: chunks
  are dropped far more often and picked up nearly as fast. Anyone budgeting for
  "the map will be carpeted at collapse" should budget +16 %, not +100 %.
- **Mining barely moved (+4 %).** The extra ore in circulation is recycled, not
  newly cut, so `FIELD_YIELD` and the abundance table are doing the same job they
  were tuned to do. This is the most reassuring number in the table.
- **Ore now moves faster through every stage:** looted +34 %, banked +27 %, built
  +25 %, deaths +13 %. The economy runs hotter without holding more.

Concretely, and stated for the balance crew rather than buried:

- **Contested space is worth more — but not the space this sentence used to
  name.** A fight used to burn most of whatever the loser was carrying — 69.7 % of
  it, once a0-58's floor is counted; now every ore either pilot held survives the
  exchange and lies there for whoever holds the ground afterwards. That much is
  confirmed and now measured (**79.4 % of a death's ore reaches a pilot who is not
  the one who lost it**, up from 70.9 %). What is *not* true, on either build, is
  the "fight in the asteroid field" this bullet used to open with: **92.5 % of
  death-drop ore lands outside the field entirely.** See *Where the ore actually
  lands* below.
- **Killing a *lightly* loaded miner is what changed most, not the fat hauler.**
  This is the opposite of the intuition and it falls straight out of the floor. A
  hold of 8 dropped 4 chunks before and drops 8 now: a clean 2×. A hold of 1
  dropped **nothing** before and drops 1 now: an infinite ratio. Because 470 of
  `main`'s 2977 deaths carried exactly 1 ore, while a full hold of 8 was carried
  into death **zero** times on `main` and once on this branch across all 24 seeds,
  the aggregate is dominated by the small holds. **The fat
  hauler's death was always the one that paid; a0-59 is mostly a buff to killing
  everyone else.** Interception is up across the board, but the *marginal* value of
  hunting a full hold specifically rose the least of any hold size.
- **Collapse: circulation is up sharply, standing stock is not.** The field-yield
  figure (~400, times the abundance multiplier) is a *mint* budget and it is
  untouched — and measured, mining moved only +4 %, so `FIELD_YIELD` and the
  abundance table are still doing the job they were tuned for. What rose is the
  rate ore changes hands (+34 % looted), not the amount lying about: loose ore
  during collapse is **+16 %**. §2.8's passive-match and mined-out bounds are worth
  a re-measure, but the expected movement is small.
- **The sink did not thin out — it moved.** `deathLoss` is now **0** for an
  ordinary death, and `spent` rose by +970 against the 1031 that used to burn:
  within 6 % of a straight swap. The brake on the ore supply is now almost entirely
  *what players choose to buy*, which is a **visible, player-controlled** sink
  where the old one was invisible and involuntary. That is arguably the most
  interesting consequence of the ruling and it was not predicted anywhere.

That is the intended consequence — the developer asked for it — and it is a
balance change, not a bug fix.

#### Where the ore actually lands — MEASURED (a0-59, eighteenth session)

The paragraph above says *contested space is worth more* and GDD §2.3's amendment
adds *interception beats hauling*. Both are claims about **place** — they assume
the ore lands where the fight was and falls to whoever holds that ground — and
neither had been measured. The aggregate (4.8×) says how much ore a death returns;
it says nothing about where it goes or who ends up with it.

Measured on 12 seeds, full natural eight-slot matches run to their own ending, on
**both real builds** (this branch, and a detached worktree at `origin/main`
`221a2b1` — neither arm is a hand-flipped constant). Every chunk a death lays down
is tagged at spawn and followed until a ship takes it; the taker is the ship whose
`lootTake` fired nearest the chunk that tick.

| | `main` (0.5) | a0-59 (1) |
|---|---|---|
| deaths carrying ore | 401 | 639 |
| death-drop ore tracked | 199 | 1153 |
| **share landing INSIDE the asteroid field** | **10.6 %** | **7.5 %** |
| median death distance from map centre | 621.6 u | 639.0 u |
| — against a field radius of | ~307 u | ~307 u |
| **recovered by someone OTHER than the dead pilot** | **70.9 %** | **79.4 %** |
| recovered by the dead pilot themself | 19.6 % | 15.4 % |
| never recovered at all | 9.5 % | 5.3 % |
| of the "by other" share, taken by the **nearest station's owner** | 36.2 % | 45.2 % |

**1. The ore does not land in the asteroid field, and never did.** On both builds
roughly nine tenths of it falls *outside* the field radius, on the station ring —
median 639 u from centre against a ~307 u field. The "a fight in the asteroid
field" framing was inherited, not measured, and it is wrong about place on `main`
too. This is a description error a0-59 did not introduce and does not fix; it is
corrected here because the balance crew will otherwise budget the extra ore into
the wrong part of the map.

**2. "Contested space is worth more" survives, in its strongest form.** The ore
genuinely changes hands and does so more than before: the share reaching a pilot
other than the one who lost it rises 70.9 % → **79.4 %**, the dead pilot recovers
less of their own (19.6 % → 15.4 %), and far less is left lying (9.5 % → **5.3 %**).
This is the one claim in that paragraph that is both true and now evidenced.

**3. "Interception beats hauling" is the weakest of the four claims, and reads
closer to a defender's buff.** Of the ore that changes hands, the share taken by
the owner of the *nearest home station* rises 36.2 % → **45.2 %** — dying on
somebody's approach hands them your hold on their doorstep. Combined with the
hold-at-death histogram above (a full hold of 8 was carried into death **zero**
times on `main` across 24 seeds), what a0-59 pays out is **combat attrition near
stations, not intercepted cargo**. The ore a0-59 adds that did not exist before —
the holds of 1 that `main`'s floor minted as nothing — is the most extreme case of
all: **1.9 %** of it lands in the field.

**Caveats, stated rather than buried.**
- The tagger caught **97.2 %** (a0-59) and **97.1 %** (`main`) of the exact drop
  predicted by `floor(hold × fraction / CHUNK.ore)` per death. The ~3 % missed is
  chunks tractored in the same tick they spawn — which are disproportionately the
  *killer's*, so the "recovered by other" share above is a **floor**, not a
  ceiling.
- Self-calibrating control: on `main`, 227 deaths carried exactly 1 ore and must
  drop nothing (`floor(1 × 0.5) = 0`). The tagger attributed **1** ore to them — a
  false-positive rate of ~0.4 % of deaths, which is the noise floor on every figure
  in the table.
- **"Near an enemy home" is partly geometric and is NOT claimed as a finding.**
  Eight stations on a 768 u ring sit ~588 u apart, so any point on that ring is
  within ~294 u of some station before anyone dies there. The two robust numbers —
  the in-field share and the recovery split — have no such confound; the
  raw "305 u from the nearest enemy home" figure does, and is not load-bearing
  anywhere above. (LESSONS: do not read an instrument's verdict as the thing
  itself — the failure mode behind five wrong numbers in
  `docs/wave-commons-entombment.md`'s history.)

### `deathLoss` is kept, at zero, on purpose

The bucket is **not** deleted. It remains the sink for anything undropped: the
sub-`CHUNK.ore` quantisation leftover (a0-58), and any future ore that leaves a
hold without reaching the field. A ledger with no sink for a flow cannot stay
conserved the day that flow reappears, and `expectedLiveOre` subtracts it either
way — a zero term costs nothing and an absent term costs the invariant.

### a0-58's whole-ore invariant is kept, and this is the point

This brief mostly *dissolves* the case that motivated a0-58: at a fraction of 1 the
drop equals the hold, and a whole hold divides into whole chunks with nothing over,
so no remainder piece is ever minted. The rounding still runs; it subtracts zero.

It stays anyway. `DEATH_ORE_DROP_FRACTION` and `CHUNK.ore` are **both** TUNABLE,
and the fraction returning to anything but 1 — or `CHUNK.ore` moving off 1 —
re-creates the remainder in a single edit. The invariant is what makes that edit
safe instead of a silent leak, and deleting a guard because today's value happens
to make it a no-op is precisely the failure four star-bloom rounds paid to learn
(LESSONS §26: assert the relationship, not today's value). `src/sim/damage.test.ts`
gates both rules in one file for the same reason.

### Determinism goldens re-measured

The same three fixtures a0-58 moved move again — they pin absolute state hashes of
a simulation, and this is a simulation rule change. Each says re-baselining
requires a ratified amendment recorded in this file; this entry is that. They are
flagged to their owners in the PR and moved in their own commits, old values kept:

| Fixture | Owner | Was (a0-58) | Is (a0-59) |
|---|---|---|---|
| `src/bots/ffa-parity.test.ts` seed 20260806 | Bot | `f31d2c3b` | `f290517f` |
| `src/bots/ffa-parity.test.ts` seed 7 | Bot | `2400ba7e` | `b8c73690` |
| `src/bots/ffa-parity.test.ts` seed 991 | Bot | `b891918a` | `84fd2ef2` |
| `tests/net/online-radio.test.ts` `FFA_GOLDEN` | Netcode | `c5ad2324` | `53aa6f97` |

This is the **second** move in a day for all four — a0-58 moved them hours earlier
and this branch is stacked on it. That is two ratified amendments, not a loosening
of the bar: each fixture's own rule is "a ratified developer amendment recorded in
this file", and both entries are in this file. The move is larger than a0-58's, not
smaller: every ship death in an eight-bot match now lays down twice the chunks, so
the field diverges from the first kill onward.

What those fixtures actually guard — that no team-aware path is reachable in FFA —
is untouched and still asserted by their own non-hash cases.

### Two the sweep missed, in this lane's own scope — found late, fixed

The paragraph below used to open *"the sweep is clean in `src/sim/` and `docs/`"*.
It was not, and the two it missed are worth naming rather than quietly correcting,
because both survived a `DEATH_ORE_DROP_FRACTION` grep for the same reason: **they
say "half" without naming the constant**, so only a prose sweep finds them.

| Site | Said | Why it survived |
|---|---|---|
| `docs/gdd-conformance.md`, the **§2.7** table | *"Half the held ore drops where you exploded"* — verdict **SHIPPED**, evidence `constants.ts:981` | The **§2.3** row two tables up *was* corrected, and §2.7's GDD prose was amended too; only this conformance row was left. Its line reference was stale as well — the constant is at `:1032`. |
| `content/codex/codex-systems.json`, `sys-collection-field` | *"…risk hauling a fat hold through contested space where a death spills **half** of it"* | The sweep corrected `sys-death-debris`, the entry *about* death, and its pinned numeric fact. This sentence is in the entry about **banking**, and no test pins body prose. |

The conformance one is the more serious of the two by some way. It is not a stale
comment — it is a **conformance table certifying, as SHIPPED, a behaviour the
shipped code does not have**, in the exact document a future agent consults to ask
"what does this build actually do?" A row like that does not merely fail to record
the ruling; it is affirmative in-repo evidence for reverting it. The codex one is
smaller but is **player-facing**: it told the player, in the game, that they lose
half a hold on death, which is now simply untrue.

Both are fixed. Neither moves code, a constant, or a golden.

### Stale half-drop prose in four other lanes' files — flagged here, not edited

Outside `src/sim/`, `docs/` and `content/`, four comments in files this lane does
not own still tell the reader a dead ship burns half its hold:

| Site | Says | Owner |
|---|---|---|
| `src/bots/hard.ts:214` | *"a dead ship drops half its hold to the player who just earned it (GDD §2.7)"* | Bot |
| `src/net/transport.ts:661` | *"a ship can die on authority (half its hold lost, GDD §2.3)"* | Netcode |
| `src/net/ore-authority.test.ts:452, :469` | *"half the hold bursts as debris"*; *"Half the hold to the field, half destroyed with the ship"* | Netcode |
| `src/main.ts:4555` | *"…respawnTimer set, half the hold dropped"* | App shell |

**None of them is a failing test and none is a behaviour bug** — that is exactly
why they are easy to miss and worth writing down. The `ore-authority` case is a
test whose *comments* are false while its assertions (`loose > 0`, residual
conserved) still hold and still earn their keep. The others are doc-comments.
They are left untouched because `src/bots/`, `src/net/` and the app shell are not
this lane's to edit, and a stale comment is not the kind of red that justifies
reaching across a boundary — the determinism goldens above were, and that is the
line between the two.

Two notes for whoever picks them up, so the fix is a one-liner and not a session:

- **`hard.ts`'s retreat rationale survives the amendment and gets stronger.** It
  breaks off at 20% hull *because dying costs the hold*; at a fraction of 1 the
  whole hold now lands in front of whoever earned the kill, so the incentive it
  encodes is larger than when it was written. The comment needs the word "half"
  changed. The behaviour does not need review. (Its *other* clause — "to the
  player who just earned it" — is loose in both builds: the drop goes to the
  **field**, and `ore-authority.test.ts` asserts in so many words that the killer
  is handed nothing. Pre-existing, not a0-59's doing.)
- **`transport.ts`'s "half its hold lost" was already wrong before a0-59**, in a
  way the amendment does not so much change as expose. `killShip` sets
  `ship.cargo = 0` unconditionally (`src/sim/damage.ts`), so a death has always
  cost the pilot the *entire* hold; the fraction only ever governed how much of it
  came back as field chunks. The divergent-death drift that passage is actually
  documenting is therefore about the whole hold, not half of it, and always was —
  it is a slightly *bigger* accounting hole than the comment claims, on both
  builds.

### A fifth lane nobody had swept: `src/progression/`

The sweep above widened from `src/sim/` to `docs/`, `content/`, then to `src/bots/`,
`src/net/` and the app shell. It never reached **`src/progression/`**, which is
neither this lane's nor in the flagged set above, and which carries three more
half-drop sites — plus two of its own briefs in `docs/`, which *are* in this
brief's stated sweep scope and are therefore fixed here.

| Site | Says | Owner | Action |
|---|---|---|---|
| `src/progression/accrual.test.ts:287` | test **named** *"does not read the half-hold sink at a death as ore spent"*, with an inline *"half dropped, half destroyed with the hull"* | UI (p1-04) | flagged |
| `src/progression/accrual.ts:109` | `oreUsed` doc-comment — *"The half-hold sink at a ship death …"* | UI | flagged |
| `src/progression/accrual.ts:454` | *"Across a ship death it is the half-hold sink (GDD §2.3)"* | UI | flagged |
| `spikes/progression/measure-ratified-xp.ts:303` | *"a drop across a death is the half-hold sink, which is not \"ore used\""* — the spike `accrual.ts` was derived from | UI / spike | flagged |
| `evidence/images/boards/index.json`, scene 9 caption | *"But **half your hold** is now loose in space for anyone."* — an art review board describing the mechanic | Art (a2-08) | flagged |
| `docs/briefs/pr-04-accrual-and-xp.md:76` | brief test 5 — *"The half-hold sink at a ship death does not appear in `oreUsed`"* | — | **fixed** |
| `docs/briefs/pr-02-attribution-hook.md:93` | *"…spawn protection, the half-hold drop and the respawn clock"* | — | **fixed** |

`src/progression/accrual.test.ts` is owned by the UI Engineer (its own header says
so), so those code sites are flagged, not edited — the same line drawn for the
four above. **The sweep is now closed on both axes and is recorded here as such:**
identifier (`DEATH_ORE_DROP_FRACTION`), English prose (`half`, `half-hold`,
`ore sink`, `half-burn`), and numeric forms (`50%`, `one-half`, `halved`,
`0.5 of the hold` — all clean), run over the **whole repo** rather than the
directories the brief names. Nine stale sites exist in total, across six lanes;
all nine are tabled here or above, and every one of them is a comment, a test
name, a spike or a caption — **none is a failing test and none is a behaviour
bug.** **All 15 of its tests pass**, verified on this branch: the rule they
pin (`oreUsed` counts a drop in hold+bank only while hull *and* home live, so a
death is excluded) is independent of the fraction and is correct on both builds.
Only the naming is stale — and a *test name* asserting the half-hold sink is the
strongest form of the hazard this document exists to prevent, because it reads as
a specification.

### The consequence nobody had named: ore-mined XP no longer converges

`oreMined` is Σ positive Δ`ship.cargo`, and `accrual.ts:100` is explicit that this
counts **mined and scavenged alike** ("ore is ore", GDD §2.7, plan §1.1) —
deliberate, and not something a0-59 changes. What a0-59 changes is the *magnitude*,
and it changes it in kind rather than degree.

Measured end-to-end on this branch (mint 2 ore into a hold, kill the ship, fly a
second ship onto the drop and let the real tractor collect):

| | minted | dropped | scavenged | total `oreMined` credited |
|---|---|---|---|---|
| one death→scavenge cycle at fraction **1** | 2 | 2 | 2 | **4 — a 2.0× credit ratio** |

One mined unit is credited once to the miner, then again in full to each scavenger
after each death. At fraction `f` the credit for one minted unit is the geometric
series `1/(1−f)`: at **0.5** it converged to a hard ceiling of **2.0×** however many
times the ore changed hands. At **1** there is no decay — each death→scavenge cycle
adds a **full** `1.0×`, so the total is `1 + k` in cycles `k` and is bounded only by
match length and hold size, not by the ore actually minted.

This is not a sim bug and the ore ledger is untouched: the *field* conserves ore
exactly, tick by tick, on both builds. It is the **progression metric** built on top
of it that loses its bound. Nobody has to act on it today — p1-04's XP weights are
not shipped balance — but the balance crew should have it before they tune ore-mined
XP against a contested board, because a kill-and-rescavenge loop is now a
repeatable, lossless XP source and at `f = 0.5` it provably was not.

### What did NOT change

- **Banked ore.** Still never lost to a ship death (GDD §2.7). The cost of dying is
  time and position; a0-59 makes it *less* than that, not more.
- **The wreck.** A dead **station**'s debris field is funded by the owner's bank
  and capped by `WRECK.maxDebrisChunks` (`capLoss`); that is a different rule and
  is untouched.
- **Whole-ore minting, the hold cap, the full-hold refusal, the drain rate, the
  chunk size.** All as a0-58 left them.
- **The wire, the hash schema, and `Ship`.** Nothing added to any of them.

---

## Ore is a countable thing: every mint is WHOLE, and a hold can never hold half of one

**Date:** 2026-08-16 · branch `agent/gameplay/a0-58-whole-ore-only`
**Ratified by:** Developer (Reinaldo), reporting the bug; Director, ruling on it
**Amends:** GDD §2.3 and §2.7 — the half-drop is *rounded down to whole ore*, the
atmosphere drain banks *a whole ore at a time* at the same `2 ore/s`, and the
conservation list gains one named sink (`dust`). **No rate, cost, cap, fraction or
capacity changes**: `DEATH_ORE_DROP_FRACTION` is still 0.5, `DEPOSIT.drainRate` is
still 2, `CHUNK.ore` is still 1 and still TUNABLE.

> **Superseded in part, same day — see a0-59 above.** `DEATH_ORE_DROP_FRACTION` is
> **1** as of 2026-08-16: the developer withdrew the half-drop hours after this
> entry landed. Everything else here stands, and the whole-ore invariant this entry
> exists for is deliberately kept — it is what makes the fraction safe to tune.

### The ratification, verbatim

> "its super easy to reproduce this ore bug, its usually from blown up ships,
> their ore's don't always count when picked up"

That one detail is the diagnosis, and the ruling that followed is the amendment:

> **Ore is a countable thing.** The hold shows pips, costs are whole numbers, the
> wheel prints integers. A currency that can hold a half-unit it cannot display is
> a currency with an invisible remainder, and no amount of UI can honestly render
> 0.5 of a pip. Fix it at the mint, not at the display.

### The reasoning

Half of an odd hold is a half. A ship dying on 3 ore shed `1.5`, laid down as one
`CHUNK.ore` piece plus one of `0.5` — an exact split, and the ore ledger balanced
on it perfectly. It is the **readout** that cannot: `src/ui/ore-hud.ts`,
`build-wheel.ts` and `upgrade-wheel.ts` each floor, so collecting that half moved a
hold from 1 to 1.5 and showed **1**. The ore was genuinely owned, genuinely
spendable-toward, and genuinely unmentioned — and it "doesn't always" count because
whether it ever becomes visible depends on a *second* half happening to arrive.

This is the fifth report in the same family and the first that is a **rule** bug
rather than a legibility one. a0-08 (2026-08-08) proved conservation held and
fixed the tells; a0-54 added the partial-take tell. Both were right about what they
saw. What none of them could see is that the economy was minting a denomination the
interface has no way to print.

### What changed

Whole `CHUNK.ore` at every mint, and the remainder to a **named sink** — never
destroyed off the books, never rounded up into ore nobody paid for:

| Mint | Was | Is | Remainder goes to |
|---|---|---|---|
| `damage.ts` `killShip` — death drop | whole pieces **+ one remainder** | whole only | `deathLoss` — the sink half this hold already went to (GDD §2.3) |
| `match.ts` `scatterWreckDebris` — wreck ring | whole pieces **+ one remainder** | whole only | `capLoss` — already "the fortune the wreck could not lay down" |
| `projectiles.ts` `chipAsteroid` — mined ore | whole chunks **+ the rock's tail** | whole only | `dust` — a new ledger sink |
| `step.ts` `spawnDepositFlight` — courier | cosmetic `CHUNK.ore`, never collectable | unchanged | — |

…and the two places a hold is written:

- **`updateChunks`** — room is measured in whole `CHUNK.ore`, and `full` means "no
  room for a whole ore". On the shipped numbers both are the predicate they always
  were; they differ only on a hold carrying a sliver, which now refuses the chunk
  (and says so through the a0-08 tell) instead of slicing it.
- **`updateDeposits`** — the drain paid `drainRate * dt`, a thirtieth of an ore per
  tick, so clipping your own atmosphere for a third of a second left you holding
  **1.6 of a 2 slot**. It now pays whole ore on a world-clock metronome:
  `drainRate` boundaries a second, world-wide. Derived from `world.time` rather
  than a per-ship accumulator **because of the wire** — a client that rewinds to
  authority and replays restores the clock, and a per-ship counter would have to be
  added to the snapshot to survive it.

### Mined ore was never whole — the correction to the brief's own diagnosis

The brief said "mined ore is always whole; only death drops are fractional". It is
not, and this is the more common path. A rock's ore is **scaled** at world build to
hit an exact field yield (`waves.ts` `drawCanon`: `rock.ore *= scale`), so a rock
almost never holds a whole number, and its last scrap was spawned as a fractional
chunk of its own — *every mined-out rock, every match*. Collect one and the hold is
a fraction off a whole, so the **next** pickup finds no full slot and is refused
with nothing said.

### The cost, measured

Three full natural matches (eight bots, real `createWorld`, to the ending):

| seed | all ore | `dust` | share | max residual |
|---|---|---|---|---|
| 1 | 480 | 22.698 | 4.7% | 1.4e-13 |
| 7 | 480 | 15.525 | 3.2% | 5.1e-13 |
| 42 | 480 | 18.490 | 3.9% | 8.5e-14 |

`capLoss` was **0.00** in all three — with banks whole, a wreck's ring divides —
and every other flow lands on a whole number (`mined 185`, `dropped 87`,
`looted 229`, `deposited 155`, `spent 168`, `deathLoss 48`). The economy is
countable end to end.

### Flagged, not fixed: where the 3–4% should go (Director)

The alternative that keeps every unit **usable** is rounding *rock ore itself*
whole at world build. It costs a ratified invariant: a field of whole rocks can no
longer total `FIELD_YIELD` **exactly** at every N, because the budget is fractional
(`400·(1−commonsShare)/3`), and that total is pinned to four decimals in
`tests/sim/maps.test.ts` and `tests/sim/resource-fairness.test.ts`. Whole rocks or
an exact field yield — not both. The lane took the option that breaks no ratified
invariant and named the other one here.

### What did NOT change

- **The half-drop.** `DEATH_ORE_DROP_FRACTION` is untouched; half a hold still
  drops, now rounded down to what the ring can mint whole. *(**Overturned the same
  day by a0-59** — the fraction is 1 and the whole hold drops. The rounding this
  bullet describes is unchanged and still runs; it simply has nothing to round on
  the shipped numbers.)*
- **The drain rate.** `DEPOSIT.drainRate` is untouched, and the metronome cannot
  outrun it — the boundaries belong to the world, so no dwell pattern banks faster
  than `drainRate`. What phase costs is at most one boundary's wait on arrival.
- **The couriers.** Already one per whole unit banked, so the cadence the player
  watches is unchanged — the hold, the bank and the courier now simply step
  together instead of the hold smearing between them.
- **Conservation.** `oreResidual` still reads zero, to 1e-13, over full matches.
  `expectedLiveOre` gains `− dust`; nothing else in the law moved.
- **a0-54's partial-take tell (#429).** Intact and still correct for a chunk that
  is larger than the room available. Worth knowing: the sim mints every chunk at
  exactly `CHUNK.ore`, so the only thing that ever produced a partial take in
  shipped play was a *fractional hold* — which is what this amendment removes. The
  tell is dormant, not wrong; the full-hold tell speaks there now.
- **The wire, the hash, and `Ship`.** Nothing added to any of them.

### Determinism goldens re-measured (the bar this entry exists to meet)

Three fixtures pin absolute state hashes of a *simulation*, so a sim rule change
moves them by construction. Each says re-baselining requires exactly this: a
ratified amendment recorded in this file. They are flagged to their owners in the
PR and moved in their own commits, with old values kept for traceability:

| Fixture | Owner | Was | Is |
|---|---|---|---|
| `src/bots/ffa-parity.test.ts` seed 20260806 | Bot | `ed228be2` | `f31d2c3b` |
| `src/bots/ffa-parity.test.ts` seed 7 | Bot | `c28d0f6b` | `2400ba7e` |
| `src/bots/ffa-parity.test.ts` seed 991 | Bot | `1c0cdaa3` | `b891918a` |
| `tests/net/online-radio.test.ts` `FFA_GOLDEN` | Netcode | `c37926e2` | `c5ad2324` |

What those fixtures actually guard — that no team-aware path is reachable in FFA —
is untouched and still asserted by their own non-hash cases. Separately,
`src/bots/team-winning.test.ts` moved its Task 1.7 **seed** 11 → 13 by the 1–16
scan its own comment prescribes (seed 11's sampling window collapsed 24,362 → 2,884
ticks); no assertion in it was relaxed.

---

## In TEAMS, the fog lifts where your teammates are

**Date:** 2026-08-13 · branch `agent/gameplay/a0-42-team-shared-fog`
**Ratified by:** Developer (Reinaldo)
**Amends:** GDD §2.2 (the minimap sentence gains a Teams clause) and §2.1 (shared
vision joins the list of what allegiance buys). **FFA is unchanged.**

### The ratification, verbatim

> "when playing on a team the fog of war should lift where your team mates are it
> should be like as if you were there...."

### The reasoning

**Sides that cannot see for each other cannot coordinate.** Everything else
allegiance buys is already shared — friendly fire is off, turrets and auto-aim
ignore allies, teammates spawn adjacent, and the under-attack alarm rings for a
teammate's home on exactly this predicate (`src/sim/allegiance.ts` `sameSide`,
the paragraph at :59–69). A team whose members each carried a private map was the
one place the model stopped short: you could hear your ally's siege and not see
the attacker your ally was looking straight at.

**"As if you were there" is the whole standard, and it sets the scope.** A
teammate's coverage gives you what your own coverage would give you in the same
spot — the **live dots** under it *and* the **remembered geography** it uncovers.
Sharing the discs alone would have half-shipped it: the teammate's radar would
reveal ships and forget the ore field it flew over, which is not being there, it
is watching a camera. So all three reads union — coverage, the remembered-station
mask, and the scouted-ore ids.

### What changed

- `src/sim/sensing.ts` gains `teamMembers`, `teamSensorSources`,
  `teamRememberedStationMask` and `teamRememberedOreIds`, and `sensedState` reads
  the union. `src/main.ts` `feedMinimapFog` feeds the minimap all three.
- An ally's coverage disc is now one of the discs the minimap draws, which is what
  makes the reveal legible: you see what your team's radar buys you.

### What did NOT change — and how that is proved rather than promised

- **FFA, in any respect.** `createWorld` defaults every player's `team` to their
  own id, so **FFA is teams-of-one** and a union over `sameSide` collapses to
  "self" with **no mode check anywhere** — there is no `mode === 'teams'` branch
  in the sensing module, by design. `src/sim/team-sensing.test.ts` reimplements
  the pre-change per-player read model as an oracle and asserts `sensedState` is
  field-for-field identical to it over a real FFA match, every viewer, every tick;
  the FFA `frozen` goldens are untouched.
- **The write side.** `updateSensory` still folds each player's own coverage into
  that player's own record. The union is **read-time only**, so `world.sensory`
  stays the honest log of who actually saw what, no player's memory depends on
  another player's tick, and the determinism hash does not move.
- **The live/remembered split.** A teammate's coverage is never *remembered* as
  live dots: the tick their ship dies, their disc is gone and everything only
  under it drops — the same collapse a killed radar satellite has always had.
- **The wire.** Snapshots already stream every ship and projectile to every
  client; fog is a client-side read over the replicated world. Widening a read
  costs no bytes and no hash — and it follows that **fog is not an anti-cheat
  boundary today**, which is worth writing down so nobody defends it as one.
- **Friendly fire, targeting, and the alarm.** `sameSide` is a read here; nothing
  about who may shoot whom moved.

### Flagged, not fixed: the bot symmetry gap

GDD §2.9's invariant is *"symmetry, not blindness"* — a bot must perceive what a
human in its cockpit could. After this ships, a human team shares vision
**instantly** through the minimap, while allied bots trade what they saw over
`src/bots/radio.ts` at a per-tier latency with a miss roll, and the `sighting`
callout that would carry "enemy here" is **not implemented yet**
(`docs/team-bots-plan.md` §2.2). The gap is real and it is the Bot Engineer's
file; the Director briefs it separately.

---

## The cost is ONE number on EVERY page of the build menu

**Date:** 2026-08-13 · branch `agent/ui/a0-41-cost-rule-every-page`
**Ratified by:** Developer (Reinaldo), with a screenshot of the live upgrade
wheel at 8 ore — `HULL 3/8`, `ENGINE 7/8`, `CARGO 6/8`, `WEAPON OPEN ▸`
**Amends:** GDD §2.5's upgrade-wheel bullet (folded in directly, *amended
2026-08-13*; the **⚠ OPEN** flag raised there on 2026-08-07 is STRUCK, not
appended to). **This CLOSES the question a0-03 left open** — item 2 of that
entry's "Two things this amendment deliberately leaves OPEN", and Q-3 in
`docs/gdd-conformance.md`. No mechanic, number, cost, cap, rule or type changes,
and **not one pixel changed colour**: this is a denominator removed from a label
on the two pages that still carried one.

### The ratification, verbatim

> "I had said I didn't want stuff like 5/6 only the cost . it got done on the
> page before this one but none of the sub pages. we need to make sure changes to
> build menu affect all pages"

Two sentences, two deliverables. The first answers the open question. The second
is a standing instruction about how this menu is maintained.

### Sentence one — the denominator goes, on every level

The 2026-08-07 retraction ("*just need the needed amount in yellow, and red if
insufficient*") came with a build-wheel screenshot, so a0-03 scoped itself to
that screen and flagged the rest. The developer has now named the rest. The
build wheel was not the exception; it was the **first page to be fixed**.

| upgrade wedge, at 8 ore | before | after |
|---|---|---|
| HULL | `3/8` | `3`, signal yellow (payable) |
| ENGINE | `7/8` | `7`, signal yellow |
| CARGO | `6/8` | `6`, signal yellow |
| ENGINE at tier 2 | `12/8` | `12`, threat red (cannot pay) |
| WEAPON | `OPEN ▸` | `OPEN ▸` — unchanged, it opens a screen |

And **one level deeper**, on the WEAPON sub-wheel, which is the page the report
actually names: DAMAGE and SPEED price themselves through the same
`costLabelOf`, so they lost the denominator with it. One function fed both
levels, which is why one edit fixed both — and why nobody noticed for six days
that it had only ever been checked on one.

**The colour was already carrying the whole message,** exactly as on the build
wheel. `upgradeCostPaint` has resolved `ready` → ore-yellow, `unaffordable` →
threat red and `maxed` → steel since u7-06, driven by the same `affordable()`
the build wheel uses (`src/ui/affordability.ts`, the one boundary both wheels
obey). `style-guide.md` §2.1's ore-yellow carve-out is untouched.

**What did NOT change,** because the developer's arrow points at the cost
numeral and nothing beside it: `2 / 4 BUILT` on the build wheel and the ladder
pips `●●○` on the upgrade wheel (both separately ratified, 2026-08-06); `MAX` on
a finished ladder and `FULL` on a capped wedge (state words, not prices); the
stat line `103% → 117%` and REPAIR REACTOR's `+15 HP`; and the hub's live ore
total, which is where "how much you have" belongs and is why the second number
was redundant on every page that printed it.

### Sentence two — "changes to build menu affect all pages"

A fix that only edits the label satisfies the screenshot and not the sentence, so
the rule is structural now, in two pieces:

1. **One source for the grammar.** `costNumeral(cost)` lives in
   `src/ui/affordability.ts`, next to `affordable()`, and both wheels write a
   price through it. The two wheels are **one control** (`style-guide.md` §2.1);
   a rule stated once in the module they share is a rule that cannot reach one
   page and not the next. Each wheel keeps its own word for a wedge with no price
   left to quote — the build wheel's `FULL`, the upgrade wheel's `MAX` — because
   those are nouns for a state, not prices. Only the numeral's shape is shared.
2. **One guard that walks every page.** `src/ui/wheel-cost-grammar.test.ts` walks
   **every wedge on every level** — build wheel, upgrade wheel, WEAPON sub-wheel
   — through `costWords`/`upgradeCostWords`, over frames that between them hit
   ready / unaffordable / capped-or-maxed / inactive, and asserts no cost slot on
   any page contains a `/`, and that a cost slot's whole vocabulary is a bare
   price, `FULL`/`MAX`, or `OPEN ▸`. It fails the day a fourth page is added that
   quotes a denominator. a0-03's build-wheel guard was the right idea checked on
   one page; this is the same idea checked on all of them.

The precise thing this would have caught: **the denominator surviving on a page
nobody screenshotted.**

---

## Tap Commander and Auto-aim are the DEFAULT — on every platform

**Date:** 2026-08-12 · branch `agent/platform/a0-30-defaults-everywhere`
**Ratified by:** Developer (Reinaldo)
**Amends:** GDD §2.4 (folded in directly, two sentences retired) and §5.7's
settings-row note. **Supersedes both per-platform splits §2.4 carried** — the fire
mode's ("Manual on desktop and gamepad, Auto-aim on touch") and the scheme's ("the
default scheme is the twin sticks").

### The ratification, verbatim

> "is tap commander and auto aim default on all platforms it should be"

and, when the answer came back asking which of the two:

> "I already said BOTH"

Both defaults, every platform. Recorded here so it is not re-litigated (LESSONS
§17: the developer's word is the design).

### What changed — exactly two lines of behaviour

| | before | after |
|---|---|---|
| fire mode, fresh profile | Manual on desktop/gamepad, Auto-aim on touch | **Auto-aim everywhere** |
| control scheme, fresh profile | Sticks everywhere | **Tap Commander everywhere** |

`src/platform/actions.ts` `defaultFireMode()` lost its `isTouch` argument — the
answer no longer depends on the device, and a parameter that invites the split
back in is worse than no parameter. `src/ui/lobby-flow.ts` `createFlow()` seats the
same pair, so the flow seam and the boot path cannot disagree about what a player
with nothing stored starts in.

### What did NOT change, deliberately

- **Manual and Sticks are untouched as choices.** Both settings routes (the main
  menu's settings screen and the in-match pause menu) work exactly as §2.4
  requires; toggling either still persists to `planet-rush:fireMode` /
  `planet-rush:controlScheme`, and the stored strings did not move.
- **The parity principle.** Auto-aim *everywhere* must not become auto-aim *only*.
  `input-parity.test.ts` now proves the pad reaches `aim` through Manual **and**
  thrust/fire/build through the new default, from the same pad frame — the aim
  cell is filled by a mode a player can pick, not by the mode they happen to
  start in.
- **`AUTO_AIM_ARC`** — 360°, no front arc (live since `g6-01`).
- **Anyone's saved preference.** See below; it is the regression this change could
  most easily have caused.
- **The CONTROLS row's wording rule** (2026-08-06). The row still names the
  *device* for the sticks — `STICKS` / `TWIN STICKS` / `KEYBOARD + MOUSE` — and
  `TAP COMMANDER` on every device for the tap scheme. Since the tap scheme is now
  what a fresh profile seats, `TAP COMMANDER` is simply what the row reads first,
  on all three devices. **That is truthful and needed no change** — a tap is a tap
  whether it lands from a finger or a mouse, so unlike `STICKS` on a PC it names
  nothing the player does not have. It is now asserted rather than reasoned about:
  the menu's read-only seam reports what each settings row *says*
  (`window.__mainMenu.settingsRows`), and `tests/live-stage/a0-30-defaults.spec.ts`
  reads it back on a desktop profile, a touch profile and with a pad connected.

### A saved preference always wins — read before you default

This moves the default **for a player with nothing stored**, not everyone's
setting. Both reads consult storage first:

- `readStoredFireMode()` (`src/platform/actions.ts`) seats a stored `manual` /
  `auto-aim` and falls to the default only for an absent or stale key. Unit-tested
  both ways.
- `readControlScheme()` (`src/main.ts`) decodes a **saved** value through the UI's
  own round trip (`parseControlScheme` / `storedControlScheme`, whose two strings
  `settings.test.ts` pins literally) and reaches the default only when the key is
  absent or unrecognised. It can no longer be a bare `parseControlScheme(...)`:
  that function folds everything unrecognised to `'sticks'`, which was the default
  when it was written and is not one now.

### The one conflict — ✔ RESOLVED as **resolution 2**, 2026-08-13 (a0-37)

> **Resolution, ratified by the developer in the a0-37 brief** (their frame, on
> PC, in Tap Commander + Auto-aim): *"these need to change to instead display the
> presses needed to play for example now its just Click anywhere to move or
> attack, someting like that"*.
>
> **The strip reads the scheme.** `describeBindings` takes the seated
> `ControlScheme` (branch `agent/ui/a0-37-scheme-aware-controls-strip`), and in Tap
> Commander the desktop rows become that scheme's own — `Click anywhere · Move or
> attack`, then `E · Build & Upgrade`. The device supplies the *verb* (click on a
> PC and with a pad, tap on glass), on §2.4's 2026-08-06 principle that a control
> row names what is in front of the player. The `{fire}`/`{build}` rider below is
> resolved with it: one map, extended once, feeding both §2.2's strip and §2.10's
> prompts (a0-33 had already branched the prompts' *lesson* on the scheme).
>
> **Resolution 1 was NOT adopted and no input behaviour changed**: `W` still does
> nothing in Tap Commander, and the strip now says so by not naming it. Whether
> thrust should take the wheel back is still the Director's to call — it is a
> design change to the scheme, not a labelling one, and nothing here forecloses it.

The conflict as a0-30 flagged it, kept for the record:

**On desktop, Tap Commander and the `WASD` thrust binding do not both work, and
Tap Commander is now what a first-run desktop player gets.** In the tap scheme the
pilot *replaces* the sticks: `src/main.ts` `sampleInput` zeroes the devices'
thrust/aim/fire and writes the pilot's instead (that is Tap Commander's ratified
design — a local pilot flying the standing order, developer §1–2). So on a fresh
desktop profile, `W` does nothing, while the controls strip along the bottom still
reads `Thrust · WASD`, because `describeBindings` takes a device and a fire mode
and has never taken a scheme.

Not in the conflict: **Build**. `merged.build` is deliberately left as the devices
wrote it, so `E` really does open the Build & Upgrade wheel in either scheme, and
the wheel's own confirm is unchanged. Not in the conflict either: the parity table,
which is about the *sticks* scheme's device mapping and is untouched.

**One thing rides along with it.** Onboarding's `{fire}` token resolves through the
same `describeBindings` (`src/ui/onboarding.ts` `bindingPhrase`), so a first-run
desktop prompt reads *"Hold Left mouse on the asteroid"* where Tap Commander wants
*"tap the asteroid"*. Same root cause — the strip and the prompts are generated from
a map that takes a device and a fire mode and has never taken a scheme — and it is
resolved by resolution 2 below, or by leaving both alone under resolution 1. It is
UI's file either way; flagged, not touched.

**Nothing has been dropped or quietly re-bound here** — this brief's mandate was to
move two defaults, and inventing a third rule for what `W` means in Tap Commander
is a design call. The two candidate resolutions, for the Director:

1. **Thrust takes the wheel back.** A real thrust input in the tap scheme drops the
   standing order and hands the ship to the sticks for as long as the player is
   flying it (tap again to resume). The binding table stays true on every device,
   and a desktop player who reaches for `WASD` is never ignored. Costs: a second
   authority over the ship, and a rule about which one wins.
2. **The strip reads the scheme.** `describeBindings` takes the seated scheme and
   the desktop rows become the tap scheme's own — thrust/aim/fire read `Click to
   move`, `Click a target`, and `E` stays. Honest and small, but it means a
   first-run desktop player's `WASD` genuinely does nothing, and the keyboard's
   thrust binding exists only in the other scheme.

Until one is ratified the build behaves exactly as Tap Commander always has; only
how many players meet it first has changed.

---

## Looted ore that "doesn't count" — the ledger says it always counted

**Date:** 2026-08-08 · branch `agent/gameplay/a0-08-looted-ore-that-does-not-count`
**Reported by:** Developer (Reinaldo), from real play
**Amends:** GDD §2.3 and §2.7 (folded in directly). **No rule, constant, or ore
flow changed** — `CARGO_BASE`, `DEATH_ORE_DROP_FRACTION` and the full-hold refusal
are untouched. This entry is here because the *finding* is the deliverable.

### The report, verbatim

> "sometimes picked up ore from dead ships dont count"

### The verdict: nothing was ever lost

This is the **fourth** report of this shape, and the ore ledger
(`src/sim/ore-ledger.ts`) was built after the third precisely to settle the next
one. Ran the reproduction it was built for — kill a loaded ship, fly the wreck
drop, once with an empty hold and once with a full one — and

> `liveOre === seeded + injected + debrisFloor − spent − deathLoss − capLoss`

held **exactly**, residual `0.0e+0`, at every frame of every run, and holds every
tick of six full natural matches. **No ore is leaking.** The previous three
reports were leaks; this one is not, and the difference is the whole point of
having the instrument. The trace is `evidence/a0-08-loot-tell/trace.txt`.

### "Sometimes" was three outcomes of the same kill, told apart by nothing

Same wreck, same 2 ore on the field, three holds:

| looter's hold | ore taken | left floating | what the player sees |
|---|---|---|---|
| **0 / 2** empty | 2 | 0 | hold fills — but the big readout is the **bank**, which correctly does not move |
| **2 / 2** full | **0** | 2 | *nothing whatsoever*: a full hold exerts no tractor pull and refuses the chunk in silence |
| **1 / 2** partial | 1 | 1 | takes one of the two — a partial take that looks exactly like a whole one |

The base hold is **2** (GDD §2.8), so the middle row is the *normal* state, not an
edge case. And a fourth thing stacks on top: looted ore lands in `cargo`, while
the prominent top-left readout is `banked`, which only moves in your own
atmosphere. So a *correct, complete* pickup moves no number the player is
watching. **`a0-03` is renaming that readout `BANKED` → `ORE`** on the same day —
which makes this worse, not better, if it lands alone: a number labelled `ORE`
that does not move when you pick up ore. The two reports are one problem.

### The fix is a tell, and only a tell

Two per-tick, write-only fields on `Ship`, decided in the chunk step and read by
nothing in the simulation:

- **`lootTake`** — ore that arrived in this hold on this tick. The ore that
  *moved*, not the chunk that was offered, so a partial take reads as partial.
- **`lootBlocked`** — this hold is full and loose ore sits inside tractor range:
  the wreck it is floating over that is never coming.

Both are pure derivations of already-hashed state, stay out of `hashState`, and
cannot perturb determinism (GDD §4.8). Drawing them is the render/UI lanes' call;
the hold pips are the obvious home, since they already drain visibly on deposit.

### Explicitly NOT done — three balance questions left for the developer

Raising `cargoCap`, lowering `DEATH_ORE_DROP_FRACTION`, or letting a pickup
ignore the cap would each make the complaint go away, and each is a §2.8 balance
decision with no ratification. They are listed in the PR body as questions, not
taken. In particular **a kill never gives you what the victim was holding** — half
their hold is destroyed with the hull (GDD §2.3, working as designed) — and if the
expectation is otherwise, that is a rules change and needs saying out loud.

> **Answered 2026-08-16 (a0-59).** It was said out loud: *"destroyed ships should
> drop all their ore, no more 1/2 the ore stuff"*. The second of the three balance
> questions this entry left open is now settled the other way —
> `DEATH_ORE_DROP_FRACTION` is **1**, and a kill does give you what the victim was
> holding. The other two (`cargoCap`, ignoring the cap on pickup) are still open.

---

## The lobby picks the CHARACTER. Difficulty is shown, not chosen.

**Date:** 2026-08-07 · branch `agent/bots/a0-06-pick-the-character`
**Ratified by:** Developer (Reinaldo)
**Amends:** GDD §2.1 (folded in directly) and §2.9 (folded in directly). **This
supersedes the earlier plan to carry a per-slot difficulty into the match.** No
behaviour tree, tuning knob, personality weight, hull assignment, fog rule, Teams
side assignment or seed-determinism property changes — this amendment is about
*who you choose and what you are told about them*, not about how a bot plays.

### The ratification, verbatim

> "how about for bots we are able to select their personality instead of
> EASY/MEDIUM/HARD and it shows the difficulty next to their personality (and
> there is a ? question mark icon that you can press to show a tooltip with the
> codex entry about that bot)..."

Preceded by the two reports it answers:

> "i chose HARD for all enemies but they were at other difficulties than i
> selected"

> "this bot personality thing makes no sense... its difficult to understand and
> difficult to balance a team with it"

### Why picking the character is not the same fix as carrying the tier through

The two reports look like one bug and are not. The second is a *comprehension*
complaint about a two-step control — set a tier, get a name you did not choose.
The first is a *wiring* bug: `bootOfflineMatch` called `fillEmptySlots` with no
cast at all, `MatchBootConfig` had no cast field, and the round-robin ran over the
whole mixed roster — so whatever the lobby resolved was discarded and every
offline match seated Rusty, Bolt, Foreman, Patch, Sable, Vulture, Warden in seat
order regardless of the setting.

Fixing only the wiring would have left the confusing control. Fixing only the
control would have left the setting inert. **Selecting the character directly does
neither: it deletes the possibility of a mismatch**, because there is no longer a
second control that can disagree with the cast — the seat stores a character and
the tier is read off it. The wiring is fixed too, and it had to be: the cast now
travels lobby → `lobbyRosterCast` → `MatchBootConfig.cast` → `fillEmptySlots` →
`createBots`.

### The one decision that was surfaced rather than made quietly

There are **8 slots and 7 characters**, and only **3 are Hard**. So a full house
needs at least one repeat, and the developer's own stated goal — a balanced 4v4 —
needs *four* Hard bots, which is more Hard characters than exist.

**Duplicates are allowed**, because forbidding them makes the developer's use case
impossible. A repeat is told apart by **numbering the name** — `Warden 1`,
`Warden 2` — and only when the character actually repeats, so every lobby anyone
has played so far reads exactly as it did. The numeral was chosen over a livery
variant and over doing nothing: a livery variant would be a new asset for a case
the field already distinguishes (the slot's identity colour and its `P1`…`P8`
decal), and doing nothing leaves two rows on the roster the host cannot tell
apart while they are checking their own work. **A new character was not invented
to dodge the arithmetic** — the cast is GDD §2.9 and not the Bot Engineer's to
extend.

The name table this exposed was already keyed by **slot** rather than by
character (`main.ts` `rebuildNameTable`, `src/ui/lobby` `playerNameTable`), so no
re-keying was needed — only the numbering.

### The row

`bar | STATE | body | team chip | tier chip | ?`

- **The body cycles the character.** The row draws the name in its body, so the
  tap that lands on a name is the tap that changes it. The seat-state cycle lost
  nothing: it has had its own drawn, labelled, leading control since u5, which is
  the discoverable one the developer asked for. A **closed** row still re-opens on
  a body tap — one rule, stated once: *the body edits whatever the row is
  showing*, and a closed row shows no character.
- **The tier chip is read-only**, in the same rect the difficulty cycle used to
  occupy, drawn on the `inert` surface rather than the raised `secondary` plate,
  and not registered with the hit test at all. This screen already keeps *a
  dead-looking button beats a lying one*; a value that is not a button has to look
  like one even less.
- **The `?` is a tap, on every device.** The dossier itself is not new — the lobby
  has shown a codex hint on a bot row since c1, on a desktop hover and a touch
  long-press, with nothing on the row saying so. A hover is not an affordance, and
  a hover-only feature is a desktop-only feature, which the ratified input-parity
  principle (GDD §2.4) does not allow. Dismissal is a tap anywhere else — the same
  grammar the minimap overlay keeps — and the hover and long-press survive as
  shortcuts.
- **The hull already earns its place** and keeps it: the row's second line names
  it (`EXCAVATOR`), dropped whole on a row too short for two lines, and the `?`
  dossier badges it too. GDD §2.11's *"a silhouette on the minimap is
  information"* is unaffected — the hull still follows the character.

### What deliberately did NOT change

`DIFFICULTY_TUNING`, the Easy/Medium/Hard trees, the characters' `weights`, the
hull assignments (§2.11), fog honesty, Teams side assignment, and determinism from
the seed. `DIFFICULTY_LABELS` is unchanged and still spells the three tiers; it is
now the vocabulary of a read-out rather than of a control.

### ~~Known remaining gap — ONLINE carries the tier, not the name~~ — CLOSED by a0-06b

*Recorded as open by a0-06; closed 2026-08-09 on
`agent/netcode/a0-06b-wire-botPersonalities`. Left in place rather than deleted,
because the gap is the reason the seam exists and the note is how it was found.*

The ratified wire (`src/net/transport.ts` `LobbyChoiceMessage`) had a
`botDifficulties` row and no character row, and `server/room.ts` cast from the
tier with its own `castFor`. So an **online** room seated the right *tiers* and
could seat different *names* within them — three characters share the Hard tier —
while the **offline** game, the flavour both reports were filed against, carried
the full cast and was exact.

**a0-06b carries the character.** `LobbyChoiceMessage.botPersonalities` rides
beside `botDifficulties`, one entry per bot seat in the same order; `castFor`
reads the character first and *derives* the tier from it, so the two rows cannot
disagree about a seat — one of them is not consulted. `botDifficulties` stays,
because the tier is still shown and a client that sends only tiers still gets the
tier-derived cast it always got. `matchStart.slots[].personality` carries the
result back, so a client can name the cast authority built rather than its own
guess at it. Duplicates travel: two Wardens in, two Wardens out.

Rationale, alternatives rejected, and the hostile-input rules are in
`docs/netcode-cast-wire.md`.

---

## The under-attack alarm SOUNDS ONCE, and only for YOUR station

**Date:** 2026-08-07 · branch `agent/sound/s9-alarm-once-and-ownership`
**Ratified by:** Developer (Reinaldo), field report from real play
**Amends:** GDD §2.2 (folded in directly). **No constant, threshold, or state
machine changes** — the alarm's own numbers (`ENGAGE`, `RELEASE`, `LEAK`,
`MIN_HOLD_S`, `PRESSURE_CAP`) are untouched, and it stays on the not-cuttable
list (§4.9) and stays the loudest thing in the bank.

### The ratification, verbatim

> "also for the alarm, it should only play once, and not keep playing (and should
> only play for your station not others)..."

### What changed — one sentence, two defects

**It played forever, because it was a loop.** `AudioEngine.syncAlarm` started a
continuous loop the moment the state machine went `active` and stopped it on
release. `UnderAttackAlarm` holds `active` for at least `MIN_HOLD_S` and keeps
holding while the pressure stays over `RELEASE`, so under sustained fire the
klaxon ran for as long as the siege did — working exactly as built, and not what
was wanted. It is now **one one-shot per engagement**: `alarm.count` bumps when
the pressure crosses `ENGAGE`, and nothing sounds again until the alarm has
released and re-engaged.

**It rang for the wrong station, and that one was a wire.** `src/main.ts` built
the audio engine before the menu (it must — the audio unlock has to be armed
before the first user gesture, GDD risk 7) and handed it `LOCAL_PLAYER` as a
constructor argument. A joiner's real slot is not assigned until the server
welcomes them, two hundred lines later; the `let` was reassigned there, but the
engine had captured the value, and `audio.setLocal()` — which existed the whole
time — was never called from that file. **So in every online match the mix
believed it was slot 0**: on slot 3, damage to *slot 0's* station rang your alarm
and damage to your own was silent. `setAlarmScope()` was likewise never called
from the real client, so the engine fell back to "you alone" — FFA-correct and
TEAMS-wrong, since an ally's station under siege never rang.

### The hysteresis keeps its numbers and changes job

`MIN_HOLD_S` (2.5 s) and the separate, lower `RELEASE` (0.35) were written as
hysteresis so a *looping* alarm would not stutter on and off while an attacker
dodged a turret. With a one-shot they do a strictly better job under the same
numbers: they are the **re-trigger guard**, the thing that stops an attacker's
dodge-and-return machine-gunning the klaxon. They were not deleted, and deleting
them would reintroduce a defect the one-shot cannot survive.

### What carries "unmistakable" now — the arrow

§2.2 has always specified *"an unmistakable alarm **plus** a screen-edge arrow
pointing home."* A one-shot moves which half carries what: **the sound announces,
the arrow sustains.** That is the whole design content of this amendment, and it
is why the change is safe — the arrow (`src/ui/alarm.ts` `homeArrow`, drawn by
the HUD off its own sustained-damage trigger with its own 5-second hold) remains
for the duration of the attack, so a player who is deep in the asteroid field and
looks up still has a live tell pointing home. Had the arrow not been on the live
build, this amendment would have removed the only tell and the lane would have
handed the decision back.

The ducking follows the same rule: the mix ducks for the **sting**, not the
siege. Leaving music and ambience pinned down for two minutes under an alarm that
is no longer sounding would be the whole game quiet with nothing to show for it.

### Where it lives

`src/art/audio/engine.ts` (`syncAlarm`, `ALARM_DUCK_S`, `alarmSounds`),
`src/art/audio/bank.ts` (`SOUND.alarm` is a one-shot spec now, same bar and same
two tones), `src/art/audio/scope.ts` (the side roster, moved out of
`src/art/presenter.ts` so the shipped client and the presenter read one copy of
the rule), and the wiring in `src/main.ts` at the seat assignment.

### The test class this needed

Every audio unit test passed straight through the ownership bug, because the
defect was in *who the engine was told it was*, not in what it does with that —
the merged-tested-and-dead-wired class. So the guard is a **live-stage** spec
(`tests/live-stage/alarm-ownership-online.spec.ts`) that stands up a real
allocator, a real match server and an online client bundle, joins a real room
with two real browsers, and asserts the audio engine's local id equals the seat
the server gave it — **on a non-zero slot, failing outright if the joiner is
seated at 0**, because on slot 0 a dead wire and a live one read identically.

---

## Station health is ALWAYS VISIBLE — sensor range retired

**Date:** 2026-08-07 · branch `agent/gameplay/a0-05-station-health-always-visible`
**Ratified by:** Developer (Reinaldo), field report a0-05
**Amends:** GDD §2.2 (folded in directly, replacing the "scouted, not broadcast"
paragraph), the §2.8 sensor-range row (retired), §2.9's fog-honesty sentence,
§5.4's ring line and §5.7's HUD line. **Retires one constant**
(`SENSOR_RANGE`) and one perception field (`Perception.sensorRange`). The ring
grammar, ship HP, and the minimap fog-of-war are untouched.

### The ratification, verbatim

> "you can see other stations healths only when you are near, it should always
> show the health regardless of proximity or else it looks like a glitch
> approaching and getting far it looks like its full health even if its damaged"

### There were two things in that sentence, and the bug is the worse half

**A straight bug.** Outside `SENSOR_RANGE` no damage ring was drawn at all. But
the *ownership beacon ring* under it is always drawn, in the owner's colour — so
what the player actually read from a distance was a ring in a player colour with
no red in it, which is precisely what full health looks like. A station at 25%
core and a station at 100% were **the same picture**. The unknown state was
indistinguishable from the healthy state, and a display like that does not
withhold information, it asserts a false one — and it fails in the direction the
player is least able to check, because there is no tell that says "this reading
is unavailable". The developer called it a glitch because it behaves like one.

**A design retraction.** GDD §2.2's *"enemy station health is scouted, not
broadcast … fog makes third-party awareness a skill"* is withdrawn. Rings read
true at any range. Third-party awareness is still a skill — you still have to be
*looking*, and the minimap is still fog-of-war until someone builds a radar
satellite — but it is no longer bought with a 180-unit flyby.

### The measurements behind the call

| Thing | Value | Note |
|---|---|---|
| Old `SENSOR_RANGE` | 180 units (2× the 90-unit shield radius) | the ring gate |
| Station radius | 64 units | gate measured to the surface |
| Half a 1080p screen | ~960 units | camera is translate-only, no zoom |
| Bot visual range | 720 units (clamped to 900) | what a bot has on screen |

So the ring appeared at roughly **one fifth** of the distance at which the station
itself was plainly on screen. Four fifths of every approach was spent looking at a
home whose health the game was actively misrepresenting.

### What the sensor-range constant gated, after the change: nothing

It had exactly one consumer per layer, all three of them the same rule — the
renderer's ring gate, the bot perception layer's station-HP gate, and the server's
per-client health broadcast. With the rule withdrawn it gates nothing, so it is
**deleted, not zeroed**: a `0` still reads as a live knob for the next person
tuning the table, and putting `180` back would silently reinstate a retracted
design. `Perception.sensorRange` went with it for the same reason. What replaced
it is a predicate with no number in it — `stationHealthVisible` in
`src/sim/sensing.ts` — so there is one place that says the rule and nothing to
tune back down.

The three **minimap coverage** radii (ship 520, station 300, satellite 900) are a
different mechanic (feature f1) and are untouched. They were always distinct from
`SENSOR_RANGE`; the §2.8 table now lists them explicitly so the retired row cannot
be confused with them.

### The radar satellite: still useful, and this pass did not touch it

Measured in `src/sim/buildings.ts` / `src/sim/sensing.ts` rather than assumed. The
satellite's `sensorRange` feeds `sensorSources`, which decides **minimap
presence** — which stations, rocks, ships and shots are on your map — and it
permanently maps every rock inside its disc. It never fed the damage-ring gate:
that gate was measured from the viewer's **ship**, at a different, much smaller
radius, and a satellite contributed nothing to it. So the amendment costs the
satellite **nothing**. The four things it buys are all still there: a 900-unit
live-entity window, permanent ore-field mapping inside it, coverage that survives
your ship dying, and a target the enemy has to come and kill.

That is a statement of fact, not a design proposal. Whether the satellite is
priced right at 6 ore now that health is free is a **developer decision**, and it
was deliberately not made here.

### Bots: symmetry, not blindness

`src/bots/fog-honesty.test.ts` pins that a bot perceives only what a human in its
cockpit could (GDD §2.9). It was **re-pointed, not deleted**. Left alone, its
scrambler would have kept lying to bots about health that humans can now read —
silently handicapping every bot and moving the whole difficulty ladder.

The gate moved from `SENSOR_RANGE` to `visualRange`, i.e. **"is the home on my
screen"** — the same test that already governed hull bars and turret counts. It
was *not* made unlimited: a human cannot read the ring of a home behind them
either (the minimap draws dots and colours, never numbers), so a map-wide read
would have been a cheat in the other direction. Symmetry is the invariant; the
`HUMAN_VISUAL_RANGE` clamp is what keeps it enforceable.

### The server was the sharper edge of the bug

`FogTracker` withheld a rival's health on the wire until your ship was inside 180
units. A client cannot draw what it was not told, so online the ring would have
stayed **stale** even after the renderer was fixed. It now sends every station's
health to every client: the server does not know a client's viewport and guessing
one would put netplay back out of step with the local picture. The per-station
signature check makes that cheap — a quiet station still costs one string compare
per sample, not a frame. Note the payload's turret and shield HP were *already*
drawn locally at any range (a turret's alpha tracks its HP, a shield bubble
carries its own gauge), so the wire had been under-reporting even against the
pre-amendment renderer.

### Readability at distance

Nothing was needed. The ring is stroked in **world units** at a fixed width, and
the camera is translate-only — there is no zoom anywhere in the render layer — so
a ring 900 units away is drawn at exactly the pixel size it is drawn at 90 units
away. The long-range frame and the close-range frame are the same ring, which is
what the evidence shows and what `src/render/stations.test.ts` asserts by
instruction count.

### What deliberately did NOT change

- **Ship** HP and enemy ship hidden state. The report was about stations. Hull
  bars are still an on-screen read; cargo, bank and upgrade tiers are still drawn
  for nobody at any range.
- **The ring grammar** (§2.2, §5.4): owner colour whole is health remaining,
  threat red fills clockwise from twelve, red is only ever the damage. This
  changes *when* the ring is drawn, never *what* it means.
- **The ownership beacon ring**, always visible before and after.
- **No HUD bar for enemy stations.** The top-right panel is still your own
  station's, and `src/ui/station-hp.ts` still has no code path that takes another
  player's station. The ring on the station is the whole grammar.
- **The minimap** still draws dots and colours, no numbers, and is still
  fog-of-war gated by the coverage discs.

---

## A build wedge's cost is ONE number — and the top-left readout says `ORE`

**Date:** 2026-08-07 · branch `agent/ui/a0-03-wheel-cost-one-number`
**Ratified by:** Developer (Reinaldo), two field reports, each with a screenshot
**Amends:** GDD §2.5 (folded in directly, *amended 2026-08-07*) and §2.2 (the
top-left caption). **This is the developer RETRACTING their own amendment of
2026-08-06.** No mechanic, number, cost, cap, rule or type changes — both halves
are player-facing strings, and the affordability rule they used to restate is
the one that was already there.

### The ratifications, verbatim

On a screenshot of the live build wheel at 2 ore held — `SHIELD 5/2`,
`RADAR 6/2`, `REPAIR REACTOR 1/2`:

> "i was wrong about this we don't need to show ore need as 5/2 .. just need the
> needed amount in yellow, and red if insufficient..."

On a screenshot of the top-left ore readout:

> "should not say total, it should say ORE"

### What changed — the wedge

The cost line lost its denominator. `5/2` → `5`. Nothing else on the wedge moved:

| wedge, at 2 ore held | before | after |
|---|---|---|
| SHIELD | `5/2` | `5`, threat red (cannot pay) |
| RADAR | `6/2` | `6`, threat red |
| REPAIR REACTOR | `1/2` | `1`, signal yellow (payable) |

**The colour was already carrying the whole message.** `SegmentState` has been
`ready | unaffordable | capped | inactive` since u7-02, `affordable()` mirrors
the sim's `spendableOre` (hold + bank) exactly, and `CostPaint` already resolved
`ready` → signal yellow and `unaffordable` → threat red (`style-guide.md` §2.1,
**unchanged by this amendment — not one pixel changed colour**). So this was the
removal of a denominator from a label, not a new affordability rule: the
one-line diff is in `segmentCostLabel`, and every state machine around it is
untouched.

**Why the denominator lost.** `build-wheel.ts` used to argue in its own source
that a player reading `5/4` *"knows they are one ore short without the wheel
having to say so"* — but the numeral was **already red**, saying exactly that, and
the wheel's hub prints the live spendable total two inches away. It was a second,
dimmer copy of two things the screen said better elsewhere. That argument has been
deleted along with the code it defended, rather than left as a comment describing
behaviour that no longer exists.

### What deliberately did NOT change

- **`4 / 4 BUILT` — the count over its cap — stays.** It is the *other* half of
  the 2026-08-06 amendment, a separate ratification, and the developer's arrow
  points only at the cost numeral. It is what makes a capped wedge legible and
  the re-arm tell readable.
- **REPAIR REACTOR still shows the HP a tap restores** (`+15 HP`, or the real
  partial) — the one ratified exception to "the only number on a segment is its
  cost" (p5-08).
- `FULL`, `MAX`, `OPEN ▸`, `NEED n ORE`, the live `REPAIR IN Ns` countdown, and
  the refusal-reason precedence (collapse → reactor full → cooling down →
  affordability) are all character-for-character as they were.
- **The hub's live ore total.** That is where "how much you have" belongs, and it
  is why the denominator was redundant.
- **`style-guide.md` §2.1's carve-out**, in both colours and all four limits.

### What changed — the top-left caption

`TOTAL` → `ORE`. (It had become `BANKED` in the interim: l2-02's industrial-voice
sweep changed it as an `[OPT]` row on 2026-08-05 and that PR merged hours after
this report. **This supersedes that row**; `docs/copy-sweep-industrial-voice.md`
§3.5 is annotated accordingly.) GDD §2.2 already called it *"your banked ORE
total"*, so the caption now matches the document.

### ⚠ Two things this amendment deliberately leaves OPEN for the developer

Neither is a defect introduced here; both are questions the two renames expose,
and inventing an answer for either would be a UI agent overruling a ratification.

**1. `ORE` now sits on two different numbers.** The top-left is the **bank
alone** (`ship.banked`). The build wheel's hub is **`spendableOre` = hold +
bank** (`src/sim/buildings.ts`, mirrored deliberately in
`src/ui/build-wheel.ts`) — and its caption also reads `ORE`. Hold 3 with 5 banked
reads **5** top-left and **8** in the hub, both correct, one word. `TOTAL` was
chosen precisely to keep them apart (`hud.ts`: *"the two ore numbers can never be
confused"*), so the rename spends that separation. The developer's word is the
design and the rename shipped as asked; what is left open is whether the **hub**
should now read something other than `ORE`. Both readouts are shown side by side,
at a non-empty hold, in a0-03's PR body so the choice can be made on the pixels.

**2. The upgrade wheel still prices in `cost/held` (`12/8`).** The retraction
came with a build-wheel screenshot and names that screen's numerals, so a0-03
changed that screen only. But `style-guide.md` §2.1 rules the two wheels **one
control** — "a player crosses between them in one press; a rule that changed
colour across that press would be the drift this section exists to prevent" — and
the same is now true of the grammar. Flagged in GDD §2.5's own upgrade-wheel
bullet rather than fixed unilaterally.

> **ANSWERED 2026-08-13 — the denominator goes, on every page.** See *"The cost
> is ONE number on EVERY page of the build menu"* at the top of this file (a0-41).
> This file runs newest-first, so the entry that closes this one sits above it.

**Related, and being tracked with a0-08.** a0-08 is investigating *"sometimes
picked up ore from dead ships dont count."* Looting raises `cargo`, not `banked`,
so the top-left figure correctly does not move on a pickup — very likely the same
root as that report. A number captioned `ORE` that does not move when you pick up
ore is a worse lie than one captioned `TOTAL` that does not, which raises the
priority of a0-08 rather than changing anything here.

---

## The CONTROLS row names the DEVICE, not the scheme's internal name

**Date:** 2026-08-06 · branch `agent/ui/u8-controls-label-per-device`
**Ratified by:** Developer (Reinaldo), field report with a screenshot
**Amends:** GDD §2.4 (folded in directly) and §5.7's fixed-string list, superseding
the p6-01 wording *"CONTROLS: STICKS / TAP COMMANDER"*. **No mechanic, number,
rule, type, or persisted value changes** — this is a player-facing string change.

### The ratification, verbatim

A screenshot of the settings row reading `CONTROLS · STICKS`, on a PC:

> "this is wrong for pc, it should be KEYBOARD + MOUSE or MOUSE ONLY and not
> sticks (there are no sticks, unless someone is playing with gamepad... then wen
> can call it TWIN STICKS (but only if gamepad detected)"

### What changed

The row printed `'sticks'` — the **internal** name of the scheme
(`ControlScheme = 'sticks' | 'tap'`) — verbatim on every device. It now says what
is true of the hardware in front of the player:

| Situation | Label |
|---|---|
| touch | `STICKS` (unchanged — the virtual sticks are real, and on screen) |
| gamepad connected | `TWIN STICKS` |
| desktop, no gamepad | `KEYBOARD + MOUSE` |
| scheme is `tap` | `TAP COMMANDER` (unchanged, any device) |

**`KEYBOARD + MOUSE`, not `MOUSE ONLY`.** The developer offered either; the
bindings settle it. On `keyboard`, `describeBindings()` gives thrust `WASD`, aim
`Mouse`, fire `Left mouse` — a player cannot move without the keyboard, so "mouse
only" would replace one false label with another. A test reads those two bindings
out of the action map so a future re-binding cannot leave the label quietly wrong.

**A pad beats the keyboard on CONNECTION, not on use.** The row is a standing
description of the hardware, not a readout of whatever was touched last — so it
does not ride `activeDevice`. `gamepaddisconnected` reverts it (re-scanning, since
a second pad may still be plugged in): a stale `TWIN STICKS` after a pad's battery
dies is the same class of lie this amendment removes. **Touch beats everything**,
because on a phone the sticks are drawn on the glass whatever else is attached.

### What deliberately did NOT change

The **internal name stays `'sticks'`** — the `ControlScheme` type, every
identifier, and above all the persisted `planet-rush:controlScheme` value. A
lift-and-shift exactly like the lore pivot, where the fiction moved and the code
kept saying `planet`: renaming the stored value would seat an unknown scheme for
every player who has already saved a preference. `settings.test.ts` asserts the
storage strings literally, in both directions, so a future rename of the union
cannot break saved preferences silently.

### Where it lives

The words and the precedence rule are pure and headless-testable in
`src/ui/settings.ts` (`STICKS_LABELS`, `controlsValue`, `controlsDevice`); the one
`navigator.getGamepads()` read and the two window listeners are in the wiring
layer (`src/main.ts`), which passes the device kind in the same way it already
passes the fire mode and the control scheme. `src/ui/` sniffs nothing.

---

## The INTERFACE VOICE — the game talks like paperwork

**Date:** 2026-08-05 · branch `agent/architect/l2-industrial-voice`
**Ratified by:** Developer (Reinaldo)
**Amends:** GDD §4.7, folded in directly (not by reference) — the section is now
titled *"Tone and voice"* and names **two registers** where it previously held one
paragraph doing two jobs. **No mechanic, number, or rule changes.**

### The ratification, verbatim

The UI design handoff proposed that the interface speak as a mining authority —
contracts, rigs, operators, seals — rather than as a game menu, and flagged it as a
lore call rather than a design one. Asked to decide:

> "doesn't sound like a question to me"

Read as: it is a given. Adopt it.

### Why it landed in the GDD before any copy moved

The GDD's tone paragraph is **pinned verbatim into every player-facing-copy prompt**
— a standing content rule learned in the Assignment-4 codex pipeline, where lexical
retrieval provably never surfaced a tone section on its own (0/4 query types), so
tone is injected by hand or not at all. A copy sweep run against a tone nobody wrote
down produces four agents' four opinions. So the tone paragraph *is* the artifact:
amend it first, and the sweep that follows has something exact to obey.

### What changed

- **§4.7 now names two registers.** Register 1, **the emotional tone** — the
  Saturday-morning paragraph, judging art/VFX/audio and the shape of a moment — is
  **unchanged**. Register 2, **the interface voice**, is new: the claim's operating
  authority addressing a contracted operator. Procedural, unglamorous, faintly
  bureaucratic; it does not sell, congratulate, or wink.
- They are not in tension, and the reconciliation is the point: the game *looks* like
  a toy and *talks* like paperwork. Where they genuinely compete, register 1 wins on
  **moments**, register 2 wins on **words**.
- The voice block is written to be **pinned** — who speaks and to whom, five things
  the voice IS, six it is NOT, a vocabulary table (in *and* out), and worked examples
  of the same string in both registers. Vague adjectives ("gritty", "industrial") are
  exactly what fails the two-agents-one-game test, so there are none.
- **One rule outranks the voice: clarity always wins over flavour.** A refusal names
  its reason in the first three words; where the flavour word and the plain word
  compete on comprehension the plain word ships; and **length is part of clarity** —
  an in-register word that ellipsizes at 11px has traded information for flavour.
- **The match/machine scope line.** The authority speaks about the claim; it does not
  speak about the machine. Boot failures, WebGL, connection status, the connect
  trace, the build badge, the playtest log, numbers and clocks stay **plain** — when
  the machine has failed there is no claim for an authority to have jurisdiction over.
- **An accessibility clause.** An in-register headline may replace a plain one *only*
  when the line beneath states the outcome plainly (`CLAIM HELD` is permitted because
  `You took the claim.` sits under it). State is never carried by flavour alone.
- **A fixed-strings list** the voice does not get to revisit: `teamName()`'s
  `FRIENDLY A` / `ENEMY B` (ratified the same day, u3-01), every §2.5 wheel label and
  upgrade track, every settings row, `RUSH!`, the §2.1 slot states, bot and ship-class
  names, **the navigation verbs** (`BACK`, `CLOSE`, `DONE`, `JOIN`, `ERASE` — the
  clarity rule's floor, added once the sweep surfaced them), and **`HOME`** — the one
  deliberately warm word in the interface, load-bearing on register 1 ("the pitch is
  a clock, and a home", §1).

### Execution

`docs/copy-sweep-industrial-voice.md` is the string-by-string work order for l2-02:
every player-facing string by file with its current text and proposed replacement,
an explicit not-in-scope list, the five test assertions that move, the collisions,
and eight questions for the developer. **Roughly 19 strings move** — two end-screen
headlines, three door labels, two hints, four error lines, three lobby labels, four
machine-copy door references — concentrated on the main menu, the doors, and the
lobby.

The measured surprise, and the reason the sweep is small: most player-facing copy is
**already in this register**. All four onboarding prompts, every build-wheel refusal,
the ship-class blurbs, and the pause-menu confirm line were written this way before
anybody named it. The GDD specifies most of its own UI words, and the lore pivot
(v0.7) already moved the nouns. The ratification is less a change of direction than
a decision to stop making the exception for menus.

The strongest evidence for that: sweeping the renderer layer as well as the model
layer turned up exactly **one** winking string in the entire interface — `BY THE
NUMBERS`, a magazine sub-head on the codex screen, and it sits on the boundary of
the codex scope-out rather than cleanly inside it (Q9). Everything else the renderers
hold is navigation chrome that must not move.

### Reconciled on merge with the same day's other two ratifications

Three ratifications landed on 2026-08-05; the other two reached `main` first and this
one merged on top of them. Nothing was dropped, and neither of the others is amended
here — the GDD's own sections are the truth, this is the record of the reconciliation:

- **Sides read `FRIENDLY A` / `ENEMY B`** (u3-01, the entry directly below). Already
  named in §4.7's fixed-strings list; the wording there now says **shipped** rather
  than "being implemented," and points at the four sections that carry the folded text.
- **Ship stats on ship-select, as pips AND numbers** (u4-01, GDD §2.5 and §2.11 — that
  one folded straight into the GDD and left no entry in this file). It puts a block of
  figures on a screen the voice speaks on, so §4.7 now says where the line falls: the
  hull tile's **prose** (nickname, role blurb — already in register, per the sweep) is
  the voice's; its **figures, units and pip bars** are numbers, and numbers sit on the
  plain side of the match/machine line and are never re-fictioned. The **stat row
  labels** are decided by the clarity rule, which means the plain word ships — a player
  comparing four hulls is doing arithmetic. No stat label is an opportunity.

### Still open (flagged, not fixed)

The tone paragraph is mirrored outside the GDD in two places that both claim to quote
§4.7 verbatim and are now stale: **`style-guide.md` §8** (register 1 only, and still
pre-pivot — "when a *planet* dies"; frozen, Director-only by its own last line) and
**`content/codex/pipeline/tone.md`** (pins register 1 into every codex generation, so
the next run would reproduce the old voice). Neither is in the architect's write
scope. Questions 3 and 4 of the sweep doc.

---

## Sides read FRIENDLY / ENEMY, not TEAM A / TEAM B

**Date:** 2026-08-05 · branch `agent/ui/u3-friendly-enemy-sides`
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.1 (the Teams side indicator), §2.2 (what the HUD
shows), §5.2 (player colour and identity) and §5.7 — all four now carry the
folded text with a dated *(amended)* marker, so this entry is the *why*, not the
spec. **Refines, does not reverse, the m10 ratification** below it in spirit
(`docs/netcode-teams-wire.md` §3, "colour alone is insufficient").

### The ratification, verbatim

> "I don't think we should show teams like Team A Team B in the match (perhaps
> just Friendly, and Enemy, with colors like Blue for Friendly, Red for Enemy)"

and, asked what should happen when a host makes more than two sides:

> "Friendly/Enemy plus Letters — Friendly A, Enemy B, Enemy C, Enemy D etc..."

### Why this is a refinement and not a reversal

m10's ratification came out of a Teams match the developer could not read:
*"impossible to know who is on your team."* Its conclusion was that **colour
alone is insufficient** — a side owns no hue, because the eight identity colours
are per-*slot* (style-guide §3.1) — so the side had to be said in **words**, over
every nameplate, in both form factors. That produced `TEAM A`.

`TEAM A` obeys the letter of that and misses its point: it only ever helps a
player who remembers which team *they* are. `FRIENDLY A` answers the question
that was actually asked. The word still carries the whole meaning; colour comes
back only as reinforcement, which is what keeps the readout usable with the hue
removed (and therefore colour-blind-safe, the same path the hull decal takes).

### What changed

- **`teamName(team, viewerTeam)` is viewer-aware** (`src/ui/lobby.ts`) and stays
  the SINGLE place the wording lives. Every call site passes the viewer's side
  rather than inventing its own wording, which is what makes the lobby roster
  string and the in-match nameplate string identical for the same seat and the
  same viewer — asserted in `src/ui/lobby.test.ts`, not assumed.
- **The grammar is `WORD + LETTER`, and the halves differ.** The **letter is
  absolute** (team 1 is `B` to everyone, on every screen, so two enemies are never
  both just "the enemy"); the **word is relative** to who is looking.
- **The viewer-less case is decided and documented:** a spectator, a replay, or
  any view with no local player has no "friendly," so it reads the bare
  `TEAM <letter>`. It must never answer by declaring everyone an enemy.
- **Colour lands on the team motif only** — the nameplate's side tag, the roster
  row's underline and side chip. Blue is plasma `#4DC3FF`; red is threat red
  lifted one *declared* rung toward white (`shotEnemy2`, `src/art/palette.ts`),
  because raw threat red is 3.2:1 against Vacuum — right for a filling damage
  ring, too dim for an 11px word on a phone. Both are pinned to the art tokens and
  to a 4.5:1 contrast floor by test. **The eight identity colours do not move.**
- **FFA is untouched.** Teams-of-one has no side worth naming; no label is drawn,
  and the free-for-all HUD is unchanged character for character.
- **The lobby's side chip grew 64 → 88px** and its clamp moved from "strictly
  right of the row's centre" to the row's leading 36%: a 221px landscape-phone row
  has only 48px right of centre, and a word drawn wider than the chip around it
  reads as a bug. The row body keeps a full-height 80px target there; every wider
  form factor is bound by the chip width and never reaches the clamp.
- **Evidence.** Three new golden baselines (desktop, landscape phone, and
  **portrait-held** phone through the landscape lock) of a frozen TEAMS scene
  carrying `YOU FRIENDLY A` and `Rusty ENEMY B` at once — the FFA baselines cannot
  show a side label by design, which is why the teams scene had to exist. The
  debug boot gained `?sides=N` (debug-only, like `?freeze=1`) because `?debug=1`
  skips the lobby and there was otherwise no way to boot a sided world.

### Known-open

- **A nameplate crossing the station's own ring strokes loses contrast — the side
  tag inherits this, it does not introduce it.** Both hues clear the 4.5:1 floor
  against Vacuum, which is the backdrop this amendment declares and pins by test
  (measured 9.4:1 for friendly in dark space). But the nameplate layer draws no
  backing plate, so where a plate happens to cross the bright blue shield/beacon
  rings, the *whole* plate — the name as much as the side tag — drops to ~2.1:1
  (p90 of the backdrop under the glyphs) and ~1.6:1 at the brightest stroke. This
  is visible in all three new baselines on `YOU FRIENDLY A`, because a ship spawns
  orbiting its own station and the frozen scene is t≈0. It is **pre-existing, not
  a regression**: `desktop-frozen` on `main` shows the bare name `YOU` washing out
  identically in the same place, in a different colour, before this change. The
  fix is a backing plate or outline on the nameplate layer, which would move the
  FFA baselines too and is deliberately out of this brief's scope.
- `docs/netcode-teams-wire.md` §3/§5 still quotes the superseded `TEAM A` wording
  and the 64px chip; it is the Netcode lane's record of the m10 round and was left
  for its owner rather than rewritten from this lane. The GDD (§2.1, §2.2, §5.2)
  and `teamName`'s own doc comment are the current truth.

---

## REPAIR has a 15-second COOLDOWN (per station)

**Date:** 2026-07-28 · branch `agent/gameplay/p12-repair-cooldown`
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.5, the *Repair reactor* bullet — specifically the
claim that "N taps are N independent purchases … resolving in full the instant
they're bought." A tap still resolves in full, but the *next* tap on that station
is now gated.

### The ratification, verbatim

> "Planet repair should have a cooldown of 15 seconds."

### What changed

- **`REPAIR_COOLDOWN_SECONDS = 15`** (new tunable in `src/sim/constants.ts`,
  held as seconds on `MiningStation.repairGate` and dt-decremented each tick like
  every other clock — the sim table is dt-parametric, so "stored in ticks" is
  honoured as "remaining sim-time on station state").
- After a **successful** repair purchase, `placeOrder` arms the station's
  `repairGate`. While it is `> 0`, further repair orders on THAT station are
  refused with a new `OrderResult`, **`'cooling-down'`**, spending nothing. The
  gate ticks down every tick in `updateStations`, independent of docking, damage,
  or the pre-existing repair *tell* — it is a pure time lockout.
- **Per station, not per player** (encoded now for the N>1-station future): one
  cooling reactor never blocks another; an ally at a shared reactor waits on the
  same clock.
- **Distinct from `repairCooldown`** (the 7.5 s `REPAIR_TELL_HOLD` that only paces
  bots and glows the renderer and never gated a press). The new `repairGate`
  genuinely refuses `placeOrder`, so a human can no longer tap 15 HP back every
  frame — repair is now a *rationed emergency patch*.
- **Bots inherit it** through the same order path; their p5-07b repair rationing
  composes on top. Turtle survivability drops slightly, by design; a harness
  sanity test (`buildings.test.ts`) shows a repair-spamming defender is rationed to
  ~one heal per 15 s window and resolution never stalls.
- **The wedge tells the truth (p4-17):** the Build wheel reads the remaining
  seconds straight off `station.repairGate` for a live "REPAIR in 12s" countdown,
  then re-arms to "+15 HP / 1 ORE" — no UI-side timer. *(Cross-lane follow-up: the
  UI wheel model / live-stage spec wire this readout; the sim seam is shipped.)*

---

## BOOST and PING are CUT

**Date:** 2026-07-27 · branch `agent/gameplay/p7-remove-boost-ping`
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.4, the controls table rows *"Boost | Space /
Shift | Left trigger | Button above left stick"* and *"Ping minimap | Middle
click | D-pad | Tap minimap"*, and the §2.2/§2.4 touch-controls prose *"a boost
button sits above the left stick; ping is a tap on the minimap"*. Both mechanics
are removed from the game entirely; the controls table drops to six verbs.

### The ratification, verbatim

> "Let's get rid of boost and ping. Just clutters UI and isn't needed."

### What was removed

- **BOOST** — the held speed/acceleration multiplier. `BOOST_MULTIPLIER` (was
  1.6×) and its use in `integrate` are gone; the `Intent.boost` field, the
  `'boost'` case in `resolveIntent`, and the `BoostAction` type are gone. A ship's
  top speed and acceleration are now class-base × engine tier, full stop (GDD
  §2.11/§2.5) — there is no longer a transient way to exceed the class ceiling.
- **PING** — the minimap ping action. `PingAction` and the sim's no-op `'ping'`
  case are gone. The abstract `Action` union drops from eight verbs to six:
  thrust, aim, fire, build, buildOrder, upgradeOrder.

### Ripple across the agent boundary

The `Action` union is the cross-lane contract (`@shared/types`), so the cut
reaches every layer that produced or consumed those two verbs — all removed on
this branch:

- **shared:** `BoostAction` / `PingAction` deleted from the `Action` union.
- **sim:** the movement multiplier, the intent field, the ping no-op.
- **net:** the `'boost'` / `'ping'` cases in `parseActions` (`wire.ts`); the
  wire / input-queue / loopback test fixtures re-pointed at surviving verbs.
- **bots:** the `boost()` steering factory and its two call sites (chase, flee),
  plus the now-dead `BOOST_CHASE_DISTANCE`.
- **platform:** the BOOST/PING keyboard/pad/touch bindings, the `TouchButtons`
  class (BOOST-hold + PING-gesture — deleted whole), the on-screen BOOST/PING
  buttons, `ControlState.boost`/`.ping`, and the two controls-strip rows.

**No snapshot layout changed.** BOOST and PING were *input actions*, never
encoded in the `World` snapshot, so the measured 510-byte projectile/snapshot
layout and its byte-pin tests (`src/net/snapshot.ts`, `snapshot.test.ts`) are
untouched. Client actions ride the JSON client-message frame, which simply
carries two fewer optional verbs — it has no fixed byte layout to pin.

### Bots — the escape retune the cut forced

Two behaviors leaned on boost: a bold chaser boosted to close a gap, and any bot
fleeing a threat boosted away. Dropping those is mostly free — but a chasing bot
*inherited* its chase-boost during the wedge-escape run (the escape thrust rode
the same tick's `boost(true)`), and that 1.6× burst turned out to be quietly
load-bearing for the standing "no bot stays wedged" invariant
(`tests/harness/unstuck.test.ts`, PR #146): it punched a hard-pinned hull out of
a late-wave asteroid pocket in a single escape cycle. At base speed the same hull
re-rolled a fresh random escape heading every 1.5 s and never built enough
tangential slide to leave the pocket — seed 19 wedged **16.5 s**, past the 12 s
ceiling.

Fix, in the bots' own tuning (the brief's point 2): **`ESCAPE_SECONDS` 1.5 →
2.0 s**. A longer committed run lets a pinned hull slide out at cruise instead of
re-rolling into another blocked lane — the same escape boost used to buy with raw
speed. Verified worst-wedge **16.5 s → 3.5 s across seeds 1–48** (the invariant
soaks 24), an order of magnitude under the ceiling.

### Balance (harness re-run on the final code)

Removing boost and retuning the escape is **balance-neutral** — the round-robin is
unchanged from the pre-cut baseline. Boost was never a rusher's tool (it parks at
range and holds the trigger), so cutting it moves nothing in the strategy sweep.

`balance` — 6 seeds × every rotation:

| Target | Verdict |
|---|---|
| Every match reaches an ending | **PASS** (72/72) |
| No ship class > 55% | **PASS** (top `hauler` 43.8%) |
| No strategy > 55% | **FAIL** — `rusher` 100% |
| Match length 10–15 min | **FAIL** — rusher mirrors end < 1 min |

The two FAILs are **pre-existing and orthogonal to this cut** — the undefended-core
/ rusher problem the shipped balance report already names (`tests/reports/balance-01.md`,
Finding 2: *"`rusher` wins ~97%, because nobody defends… Blocked on the bot trees"*).

`soak` — 30 real-roster (shipped-cast) matches, the honest experience:

| matches | ended | hangs | match length (median) | inside 10–15 min |
|---|---|---|---|---|
| 30 | 30 | 0 | 13:51 | 100.0% |

No wedge hangs at soak scale, and match length lands squarely in target with boost
gone.

### Constants removed / changed (`src/sim/constants.ts`, `src/bots/behaviors.ts`)

- `BOOST_MULTIPLIER` — removed (was 1.6×).
- `BOOST_CHASE_DISTANCE` (bots) — removed.
- `ESCAPE_SECONDS` (bots) — 1.5 → 2.0 s (see the escape retune above).

### Tests retired (deliberately)

- `src/platform/touch-buttons.test.ts` — deleted whole; it tested only the
  BOOST/PING button class, which is gone.
- BOOST/PING assertions and fixtures trimmed from `actions.test.ts`,
  `input.test.ts`, `touch.test.ts`, `touch-visuals.test.ts`,
  `input-parity.test.ts` (platform); `wire.test.ts`, `input-queue.test.ts`,
  `loopback.test.ts` (net); the abstract-verb-set assertions in
  `src/bots/harness.test.ts` and `tests/harness/match.test.ts`; and the BOOST/PING
  parity subtests in `tests/live-stage/input-parity.spec.ts`.

---

## Repair is a DISCRETE purchase, not a channel

**Date:** 2026-07-26 · branch `agent/gameplay/p5-repair-discrete`
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.5 ("Repair core… a *channel*, not a purchase.
Your ship must sit at your planet while core HP ticks back at a slow rate,
consuming ore as it goes… Any damage to your core or shield interrupts the
channel"), and the §2.8 baseline row ("Repair core | 2 HP/s channel · 1 ore =
5 HP · interrupted by damage"). Supersedes the channel line entirely. Everything
else in §2.5 — repair is the planet's *core* only, never the ship; ship hull is
never repairable; collapse (§2.3) shuts repair off for good — is unchanged.

### The ratification, verbatim

> "Repair shows how many hit points it's going to restore… each 1 ore repairs
> 15… but it's not on a loop."

### The model

One tap = one purchase. A press of the REPAIR CORE wedge spends
`REPAIR_ORE_COST` = **1 ore** (hold-first, then bank, like every other buy) and
restores `REPAIR_HP_PER_ORE` = **15 core HP**, clamped at the core max. No
channel, no continuous drain, no stacking: **N taps = N distinct purchases**,
each individually affordable-checked. There is no per-tick repair work left in
the sim — a purchase resolves in full inside `placeOrder`.

- **Near-full edge:** if the core is missing less than 15 HP, the tap still costs
  a whole ore and heals to full — the wheel SHOWS the real number, so the player
  chooses informed (developer, p5-08). Never overshoots the cap.
- **The developer's loop bug, killed:** the channel opened by one press used to
  drain ore every tick until the core filled or the bank emptied — one click,
  repeated spend. That path (`runRepairChannel`) is gone. A tap now maps to
  exactly one ore-spend, ever.
- **The heal is never interrupted.** With no channel to drop, a hit that lands
  after a repair does not undo the HP already banked into the core. "Pressure
  beats regeneration" (§2.6) still holds — for shields via `planet.sinceDamage`,
  and for repair through the *finite ore pool* (every HP bought back is a turret,
  shield, or upgrade not bought) **and** through the AI-pacing tell below (a bot
  cannot resume repairing while its core is under fire).
- **Refusals stay loud:** full core → `core-full`; empty/short bank →
  `cannot-afford`; collapse → `collapsed`. Each spends nothing.

### The repair tell, and how it PACES bots (not humans)

`Planet.repairing` stays a boolean tell, but its meaning changes from "a channel
is open" to "a repair was just bought and is still settling." A purchase lights it
and arms `Planet.repairCooldown` (a new *optional* `Planet` field, defaulting to
`0`); `maintainRepairTell` in `updatePlanets` ticks the cooldown down and releases
the tell when it hits zero **and** the core has been quiet that long — or clears it
early on a full core, the ship leaving, or collapse.

Why held rather than pulsed: it is a **ratified cross-lane signal**. The
renderer/observer glows the healed core from it, and the **bots read `!repairing`
to decide when to buy their next repair**. Under the retired channel the flag
stayed lit for the whole heal, so a bot filed *one* repair order and waited; a
naïve one-tick pulse would instead let a bot re-buy every tick (15 HP/tick). The
cooldown restores the old cadence: `REPAIR_TELL_HOLD = REPAIR_HP_PER_ORE / 2`, so
a bot files one 15-HP purchase per hold — the channel's old **~2 HP/s** rate — and
the "quiet core" release makes pressure beat repair for AI defenders too. **A
human is never gated by the tell**: `placeOrder` ignores it, so five rapid taps
are still five purchases (per the ratification). `src/shared/` is untouched; the
new `Planet.repairCooldown` is optional and server-internal (the net layer
reconstructs `repairing` from its own event shapes and does not carry it).

### Balance note (bot economy) — the reconciliation

Discrete repair is **3× more HP-per-ore** than the channel (1 ore ⁄ 15 HP vs the
old 1 ore ⁄ 5 HP) and no longer drains ore per tick, so the finite pool now buys
more core HP, and — crucially — a tap **snaps** the core up by a whole chunk
instead of trickling at 2 HP/s. Two suites caught the fallout of that, and the
ratified `1 ore ⁄ 15 HP` number **stays**; the reconciliation is elsewhere.

**1. Collapse lockstep → ration bot repair (`trees.test.ts`).** The bots repaired
"whenever the core is below full" (Easy's gate was `maxCoreHp − 1`). Under the
slow channel a core rarely reached exactly full at collapse; under cheap discrete
repair every well-off defender snaps its core to *exactly* `maxCoreHp` and pins on
the clamp. A field of such bots then reaches collapse at one identical HP and dies
in **entropy lockstep** — no survivor to crown, the match resolved only by the
last-to-die tiebreak (seed 1: `0` and `1`, both Easy Rusty/Bolt, at 100.0 HP,
dying together at t=850 → 8 eliminated). The measured resolution rate over 24
shipped-cast seeds was **22/24** (2 mutual-extinctions), vs the channel's 24/24.

The fix is the brief's point 1: repair is now a **ration**, not a top-up
(`repairTargetFraction`, `src/bots/behaviors.ts`). It is (a) **personality-
modulated** by `caution` — timid Rusty patches early, reckless Bolt lets its core
ride — and (b) **capped strictly below the ceiling**, so a repaired core settles
*below* `maxCoreHp` at a value that varies with its own damage history. There is
no longer a single HP the funded turtles all converge on, so they enter collapse
spread out and the match resolves. Resolution is back to **24/24**, and the
mutual-extinction path stays legal for genuinely identical cores
(`match-endgame.test.ts`, the do-nothing baseline, still 8-eliminated). The
`1 ore ⁄ 15 HP` price is untouched.

**2. Centre cage → a bigger commons eye (`harness/unstuck.test.ts`).** The cheaper
economy also shifts trajectories, and on one seed a bot was drawn into the very
centre and **sealed** there by the five shrinking commons rings (66 rocks within
200 u; zero escape corridor ≥ 8 u) — wedged >100 s, tripping the standing no-wedge
invariant. This is a latent geometry trap, not a repair bug: at
`commonsHoleFraction = 0.75` the innermost wave's eye (≈58 u) is small enough that
a full ring of body-radius rocks admits no ship-wide gap. Raising the eye to
**0.85** pushes that ring out to a radius whose circumference does admit a gap, so
the centre still draws players in (GDD §2.3) but never traps them. The 50-seed
soak's worst wedge fell from ~13 s (and, pre-ration, ~103 s) to **~4 s**, back in
the honest detect-and-escape band and on par with the channel branch (~3.9 s).

The round-robin is essentially unchanged by the reconciliation — Hard-dominant
per GDD §2.9 (warden top), match length median ~828 s vs the channel's ~819 s —
so this restores the ratified balance rather than reshaping it.

### Constants (`src/sim/constants.ts`, all TUNABLE)

- `REPAIR_HP_PER_ORE` = **15** — core HP restored per purchase (was the channel's
  `REPAIR.hpPerSecond` 2 / `orePerHp` 1⁄5 → 5 HP per ore).
- `REPAIR_ORE_COST` = **1** — ore spent per purchase (the "bare 1 under REPAIR
  CORE", now the whole price of a tap rather than a channel's opening unit).
- `REPAIR_TELL_HOLD` = **`REPAIR_HP_PER_ORE / 2`** (7.5 s) — how long the
  `repairing` tell holds, pacing AI repair to the retired channel's ~2 HP/s. Does
  not gate humans.

The old `REPAIR` object (`hpPerSecond`, `orePerHp`, `interruptedByDamage`) is
removed; only `src/sim` (and its tests) imported it.

### Tests updated to the ratified model (deliberately)

- `src/sim/buildings.test.ts` — the whole "repair channel" describe block was
  rewritten to the discrete model: 1 tap → +15 / −1 ore; hold-first funding;
  clamp math; the 5-tap case (5 taps = 5 ore, +75 HP, then zero drain); refuse
  cases (full core, empty/short bank, collapse, undocked); damage-does-not-cancel;
  a shield still standing in front of the core; the tell holding for its pacing
  window and under fire, releasing when quiet, and clearing on a full core;
  determinism.
- `tests/sim/repair-channel.test.ts` — the end-to-end field-report suite, updated
  from "the order opens a held channel" to "the order is one purchase that heals
  on the order tick." The loud-refusal and wheel-model pins are unchanged.
- `tests/sim/turret-parity.test.ts` — comment only (a repair still needs a wound).

---

## v0.3 — The mining laser goes away: PROJECTILES for everything

**Date:** 2026-07-26
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.3 (core loop / "hold fire on an asteroid… the same
beam that damages ships chips asteroids"), §4.1 (collision — "Beam: a
segment-vs-circle raycast … not a projectile"). Supersedes the v0.2 scope split's
"mining stays a beam." The GDD's mining description is amended by this entry; the
§2.3 **tractor rules are unchanged and sacred** — chunks fly to a ship with hold
space and stay put when the hold is full.

### The ratification, verbatim

> "I think mining laser should go away, it should be a projectile as well… that
> way we don't have laser + projectile, just projectile."

### Addendum (v0.3.1) — the funeral is total: the VISUAL and the WORD retire

**Date:** 2026-07-26 · branch `agent/gameplay/p2-beam-funeral`

The original v0.3 entry below retired the beam *as a mechanism* but deliberately
kept `Ship.beam` alive as a cross-agent seam (a "mining indicator tell"), so the
beam VFX line and the "your beam mines it" coach copy still shipped. Evidence
round p2-07 flagged that surviving tell. This addendum finishes the retirement —
the word "beam" no longer appears anywhere in the living `src/` code:

- **`Ship.beam` is deleted.** It is replaced by a bare boolean **`Ship.firing`**
  (true on any tick the trigger is engaged, mining or fighting). There is no shot
  geometry on a ship any more — its shots are drawn from the projectile pool.
  `miningTell()` in `src/sim/step.ts` is gone.
- **The `Beam` geometry type → `Muzzle`.** It is now used only by `Turret.muzzle`
  (a turret's muzzle flash is its tell; a turret's damage still rides a
  projectile). `combat-view.ts`'s `combatBeams()`/`CombatBeam` → `muzzleFlashes()`
  /`MuzzleFlash`, now turret-only.
- **The upgrade track `UpgradeTrack.Beam='beam'` → `UpgradeTrack.Power='power'`;**
  the ship stat `SHIP_STATS[c].beam` → `.power`; `BEAM_RANGE` → `WEAPON_RANGE`;
  `BEAM_DPS_CORE/SHIP` → `WEAPON_DPS_CORE/SHIP`; `VANGUARD_BEAM` → `VANGUARD_POWER`.
  The wheel row relabels **BEAM → POWER**; the coach copy becomes "Hold {fire} on
  the asteroid — your shots chip the rock."
- **Wire: the ship `aim` field is retired.** `aim` was the beam direction on the
  wire, read only to reconstruct remote beams; with the beam gone it was a dead
  field, so it is dropped. Ship record 15 B → 13 B, worst case **510 B → 494 B**
  (`docs/netcode-spike.md` re-derived; `snapshot.test.ts` re-pinned; the spike
  measurement artifact updated to match). The `firing` **flag** stays — sourced
  from `Ship.firing` and reconstructed for remote ships by `paintRemoteFiring`.
- **Goldens re-baselined.** The frozen scene loses the ship beam line the old
  draw produced; turret muzzle flashes remain.

### What changed

- **Mining is shooting.** There is now ONE weapon system. Holding fire looses a
  pooled projectile on the weapon cadence (`SHIP_WEAPON.fireInterval`); a shot
  that strikes an **asteroid** chips ore chunks (`Projectile.mineYield`), and a
  shot that strikes an enemy **ship / turret / shield / core** deals `damage`
  (GDD §2.4). One projectile carries both payloads; whatever it reaches first
  decides which applies. Auto-fire / hold-to-FIRE now mines *and* fights with the
  same verb.
- **The beam is deleted as a mechanism.** The segment-vs-circle raycast, the
  clamp-to-hit, `mineBeam`/`raycastBeam`/`segCircle`, and the continuous
  `mineAsteroid` are gone — no ray does any mining or damage; the projectile does.
  `Ship.beam` survives only as a **mining indicator tell**: non-null on a tick a
  ship is mining a rock, `null` while it shoots an enemy — exactly the v0.2
  contract. It carries no mechanical weight, but it is the signal the netcode
  "firing" bit (`src/net/snapshot.ts`) and the renderer read across the
  agent-ownership boundary, so the sim cannot drop it without breaking ratified
  consumers it does not own. **Follow-up (cross-agent, render + netcode):** retire
  the beam VFX draw and the `Ship.beam` field once render/net stop keying the
  "firing"/mining tell off it — the sim half is done; the field is kept as the
  seam. This is why the frozen-scene goldens still show a mining beam and have not
  been re-baselined here (item 5): the draw is render-owned.
- **"You cannot shoot through things" is now free.** A rock between you and an
  enemy eats the shot (and is mined) — projectile collision covers the guarantee
  the retired clamp-to-hit test used to pin, so those beam-geometry tests retire
  with the beam (see the PR body for each retired test and its replacement).
- **One beam, one stat survives.** The per-hit chip is the ship's continuous
  mining rate over one fire interval (`shipMineYield = shipMiningRate ×
  fireInterval`), so mining speed still rides the one beam stat exactly as weapon
  damage and projectile speed do (GDD §2.5). `MINING_YIELD_PER_HIT` is the
  Vanguard baseline, derived from `MINING_RATE × SHIP_WEAPON.fireInterval`.
- **Turrets are untouched** — a turret shot still hits only enemy ships, never
  rock or structures (p1-14 coverage intact).

### Mining feel — ore per minute (harness-measured, Vanguard at the face)

| | ore/min | note |
|---|---|---|
| Old (continuous beam) | 30.0 | `shipMiningRate` × 60, by construction |
| New (projectile) | ~28.7 | flat across mining standoffs; ~96% of old — a field takes ~4% longer |

Shots land one fire interval apart (the weapon is a pipeline; shot-travel time is
a one-off latency, not a rate cap), so ore/second at the mining face is
`mineYield ⁄ fireInterval = MINING_RATE`, a hair under in a finite window by the
last in-flight shot. "About as long as it does today," as the brief asks.

### Constants added (`src/sim/constants.ts`, all TUNABLE)

- `MINING_YIELD_PER_HIT` — Vanguard ore chipped per shot on a rock, `= MINING_RATE
  × SHIP_WEAPON.fireInterval` (0.175). `shipMineYield` (`src/sim/upgrades.ts`)
  scales it by the beam stat.
- `Projectile.mineYield` — per-shot chip carried on the pooled projectile (0 on
  turret and wire-decoded shots — the server is authoritative for ore).
- `BEAM_RANGE` kept (name unchanged for the bot/net/harness consumers that size
  standoffs from it) — now documented as the auto-aim engagement radius.

### Balance (harness round-robin, seeds 1–6, 8 seats)

See the PR body for the pasted table. The switch is mining-delivery only — the
targeting logic (`acquireNearest`) is identical for rock and hull, and combat was
already a projectile (v0.2) — so the round-robin is materially unchanged: the
ship-class ceiling stays under 55%, and the pre-existing undefended-core `rusher`
result (bot-defence work, `tests/reports/balance-01.md` Finding 2) is orthogonal
to the mining model, exactly as it was under v0.2.

---

## v0.2 — Combat becomes PROJECTILES (ship-vs-ship and ship-vs-structure)

**Date:** 2026-07-26
**Ratified by:** Developer (Reinaldo)
**Amends by reference:** GDD §2.3 (core loop / "one beam, one stat"), §2.6 (siege
balance), §4.1 (collision — "Beam: a segment-vs-circle raycast … not a
projectile"). The GDD's combat description is amended by this entry.

### The ratification, verbatim

> "It's too easy right now to kill each other and there's no way to dodge. If we
> switch to a projectile there's a chance to dodge and it becomes a lot funner…
> and then we can also add upgrades to make them faster, stronger."

### Scope split — what changed and what did NOT

- **Mining stays a beam.** The mining laser vs asteroids/ore is *untouched*: the
  whole mining loop, the segment-vs-circle raycast, clamp-to-hit, and the
  tractoring rules are exactly as they were (GDD §4.1). `Ship.beam` is now a pure
  **mining** tell — it is non-null only on a tick a ship is actually cutting rock.
- **Ship-vs-ship and ship-vs-structure combat is a projectile.** Firing at
  anything that is not a rock looses a pooled projectile on the weapon cadence
  (`SHIP_WEAPON.fireInterval`) instead of an instant hitscan beam. The projectile
  has a finite muzzle speed and lifetime, so **a target at combat range strafing
  at full speed can evade it** — that dodge is the entire point, and it is pinned
  by a test (`src/sim/projectiles.test.ts`, "the dodge").
- **One beam, one stat survives.** Per-shot weapon damage is still the beam stat
  (`shipWeaponDamage = shipBeamShipDps × fireInterval`), and mining rate still
  scales off the same beam, so mining speed and weapon damage move together
  exactly as GDD §2.5 requires. What changed is only that the damage is
  *delivered* by a shot that can miss, not a ray that cannot.
- **Turrets fire projectiles too.** They already did (GDD §2.6); the firing,
  flight, collision and pool were unified into `src/sim/projectiles.ts`, shared by
  both shooters. A turret shot still hits only ships (p1-14 coverage rules
  intact); a ship shot is siege-capable (ships, turrets, shields, cores). Neither
  hits an asteroid — shots fly over rock; mining is the beam's job.

### Upgrade hooks (base tier now, tiers later)

Projectile **speed** and **damage** read from the ship's upgrade state, on the
same beam ladder as mining and weapon damage — "faster, stronger" rides the beam
track (`shipProjectileSpeed`, `shipWeaponDamage` in `src/sim/upgrades.ts`). This
brief wires the plumbing at the base tier; balancing new tiers is a follow-up the
harness will measure.

### Bots lead

Combat now has travel time, so a shot aimed where a strafing enemy *is* misses.
Bots aim on an **intercept course** (`leadAim`, threaded through
`aimAt`/`canHit`/`engage`) using the target's last-seen velocity and the hull's
own muzzle speed; a still target (a turret, a core) has zero velocity and the lead
collapses to a straight shot. The per-tier `aimJitter` still rides on top, so an
Easy bot leads *badly* and a Hard bot leads well — the difficulty ladder is intact.

### Wire / snapshot

Ship weapon shots ride the same `world.projectiles` pool the turret guns always
did, so they stream through the existing 6-byte projectile record with no format
change. The worst case was **re-derived** for two shooters (≤ 32 turret shots +
≤ 16 ship shots ≈ 48, under the 64-slot budget), so the measured 510-byte layout
is deliberately unchanged (`src/net/snapshot.ts`, `MAX_PROJECTILES`). The one
addition, at zero byte cost: a **shot-kind bit** in a previously-reserved `meta`
bit, so the renderer can size/tint a ship shot apart from a turret shot
(`SHOT_META`, pinned in `snapshot.test.ts`).

### Balance (harness re-run, seeds 1–6, 8 seats)

The projectile switch **improves termination** — every mirror now reaches an
ending (was 65.6% at the pre-existing baseline), and economic/combat mirrors land
in target: `miner` 12:18, `raider` 12:22, `turtle` 14:10, `idle` 14:10.

| Contestant | decided | win rate | mirror median |
|---|---|---|---|
| `rusher` | 24 | 100.0% ⚠ | 0:35 |
| `miner` | 24 | 0.0% | 12:18 |
| `raider` | 24 | 0.0% | 12:22 |
| `turtle` | 24 | 0.0% | 14:10 |

| Target | Verdict |
|---|---|
| Termination — every match ends | **PASS** (improved from FAIL) |
| No ship class > 55% | **PASS** (top `hauler` 43.8%) |
| No strategy > 55% | **FAIL** — `rusher` 100% |
| Match length 10–15 min | **FAIL** — rusher mirrors end < 1 min |

The two remaining failures are **pre-existing and orthogonal to the combat model**:
they are the undefended-core problem the shipped balance report already names
(`tests/reports/balance-01.md`, Finding 2: "`rusher` wins ~97%, because nobody
defends… **Blocked on the bot trees**"). The strategy sweep pits QA probes that do
exactly one thing against each other, and the shipped difficulty tiers still run
the do-nothing baseline, so a pure rusher sieging a core nobody defends still
wins — a shot at a *stationary* core does not benefit from the dodge. Fixing it is
bot-defence work, not a combat-model or constants change. The switch did not
collapse the round-robin further (rusher was already ~100%; ship-class balance
still passes), and it made the dodge real, which is what it set out to do.

### Constants added (`src/sim/constants.ts`, all TUNABLE)

- `SHIP_WEAPON` — `fireInterval` 0.35 s, base `projectileSpeed` 520 u/s, `range`
  300 u, `radius` 5.
- `PROJECTILE_CORE_FACTOR` — the 5:10 core:ship ratio a shot on a shield/core
  takes, so §2.8 balance is unchanged by the delivery mechanism.
