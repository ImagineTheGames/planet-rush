# a0-135 — a wounded bot runs away while its own home is being shot

**Branch** `agent/bots/a0-135-defend-at-all-costs` · **Owner** Bot Engineer ·
**Date** 2026-08-22

The developer, 2026-08-22, from a live match, with a screenshot of Rusty at
**25/70** hull, its own station ringed red and under attack, refusing to come and
meet the player:

> *"as I was attacking rusty base he was scared to come engage like he was low on
> health, but ships are cheap you get a free one, they shouldn't fear death just
> cause they are low on health... protection of their base is essential to the
> game a player would defend at all costs"*

**The ruling: a threatened home outranks self-preservation, at any hull
fraction.** It is a0-105's *respawn is free* (GDD §2.3, §2.7) applied to the one
situation where retreating is not merely passive but actively losing the match.

---

## Summary

| | |
|---|---|
| Cause | `wantsRetreat` never asked `ownHomeThreatened` — one missing call |
| Fix | `src/bots/behaviors.ts`, 5 lines of code inside `wantsRetreat` |
| Doorstep board, whole cast × 5 hull fractions | `retreat` ticks **310 → 0** in every cell; first leaf `retreat` → `defend` |
| The developer's frame (`field-siege`), Rusty @ 25/70 | 380 retreat ticks, closest **152u** → **0 ticks, 80u**, `defend` |
| Home NOT threatened (`field` board) | **byte-identical** before and after |
| a0-107's own `park@580` cell, QA's harness | **unchanged**, every character |
| `last-stand` control (core 0.2) | **unchanged** |
| Match length | means unmoved (809→812 s, 813→806 s); **0 timeouts**; 126/128 and 96/96 matches in band — the two that are not are §7.3 |
| Win rates | inside the band on both contests; the Hard **ordering** reshuffles (Sable 24.0→39.6%, Vulture 39.6→27.1%), attributed in §7.1 |
| Outside the bot lane | two seed-locked cases re-measured, a0-81's protocol, §5 |

---

## 1. The reading, before anything was changed

The brief's diagnosis is right and it is one missing call. `wantsRetreat`
(`src/bots/behaviors.ts`) consulted, in order: `collapsed`, `corneredCommitted`,
`standoffCommitted`, the tier's nerve against the hull fraction, and
`incomingThreat`. It never asked about its own doorstep.

`ownHomeThreatened(ctx)` existed, and its own doc comment says what it is for:

> *"Is this bot's **own** doorstep the one that needs it? The identical
> expression the trees' own `defend` test uses, so the two can never disagree
> about which alarm outranks which."*

It was read in exactly two places, both on the **ally**-defence paths
(`wantsAllyDefence` and `wantsJoinAssault`), where it serves the *my home
outranks yours* clause. So a bot would abandon a retreat to go and help a
**teammate's** home, and not its own.

And the branch that should have taken the tick was right there, below it. In all
three trees the order is `dead` → `last-stand` → `cornered-fight` → **`retreat`**
→ `turn-and-fight` → **`defend`**. `defend`'s test is `ownHomeThreatened` plus a
collapse gate. The flee latch simply won.

**The cleanest statement of the before-picture is a diff that is empty.** The
instrument (`evidence/a0-135-home-defence/home-defence.ts`) runs the whole cast
at five hull fractions on the bot's own doorstep, once with the station's alarm
held on and once with it off. On the old code the two tables are **byte-identical**:

```
$ diff before-doorstep.txt before-doorstep-silent.txt   # on 5df8ec05
(no output)
```

Nothing in the retreat read the home, so holding the home under attack changed
nothing about it.

### Why it survived a0-106's adversarial sweep

The sweep has a `siege-home` antagonist and a0-106 measured `last-stand` holding
the full 40 s under it at 48–94% trigger. It could not have found this, and the
reason is one constant: `siege-home` pins the subject's core at
`SIEGE_CORE_FRACTION` **0.2**, below `CORE_FINAL_ASSAULT` **0.3**, which switches
on `last-stand` — a branch that has outranked the retreat since v0.2.2 and
answers the whole board. `fleeing` reads **0 ticks** under it, before and after.

The gap is the entire span of core health **above** 0.3: the alarm ringing, the
core healthy, and nothing in the tree stopping the flee latch. Nothing in the
suite staged that. Every cell in this brief's instrument pins the core at 0.8,
and `A0135_CORE=0.2` re-runs the same board under the last stand as the control
that says the instrument can see the difference.

---

## 2. The fix

Five lines, in `wantsRetreat`, immediately after the death-and-collapse guard and
before the cornered one:

```ts
if (ownHomeThreatened(ctx)) {
  release(latch);
  resetStandoff(stand);
  return false;
}
```

Three choices in it are load-bearing, and the doc comment beside it carries the
argument in full:

- **The full predicate, not a narrower spelling.** Gating on `station.underAttack`
  alone would have kept every a0-105 and a0-107 cell green for free — and it puts
  the tree straight back into the reported state one notch down: doorstep
  occupied, `defend` live, flee latch still winning above it. `ownHomeThreatened`
  is the identical expression `defend` uses, and that is its whole contract.
- **Released, not shadowed.** Both the flee latch and the standoff are dropped,
  the same shape `corneredCommitted` uses. The latch, so an in-flight retreat is
  genuinely abandoned and the nerve is re-read from scratch when the siege lifts.
  The standoff, because leaving it committed would hand the tick to
  `turn-and-fight`, which sits **above** `defend` in all three trees, and the bot
  would fight whoever chased it home instead of the ship standing on its core.
- **The cornered commitment is left alone.** `cornered-fight` outranks `defend`
  and is a fight, not a flight: a bot cutting its way home through a blockade is
  already doing what this brief asks. Only `lastStandDefend` drops it.

It is not an order to charge. It removes a reason to leave; the bot then takes
`defend`, which is `engage` at a stand-off inside its own turret cover (GDD §2.6).

**One honest softness, and it is in the predicate rather than the fix.**
`station.underAttack` is this bot's own alarm and is legible from anywhere on the
map — the developer's frame is the hard half, and no distance switches it off.
The intruder half is `intruderNear`, which reads `ctx.view.ships`, so a bot that
has already run far enough to lose sight of a *silent* trespasser stops reading
its home as threatened. That is fog-honesty (GDD §2.9) and it is exactly what
`defend` does today, through the same eyes.

---

## 3. The measurement

`evidence/a0-135-home-defence/home-defence.ts`, three boards × 7 characters × 5
hull fractions, 12 s each, core pinned healthy at 0.8 throughout.

### 3.1 `doorstep` — the bot on its own doorstep, an attacker on the station

`retreat` leaf ticks out of 720, before → after:

| character | tier | 25/70 | 0.50 | 0.35 | 0.20 | 5/70 |
|---|---|---|---|---|---|---|
| rusty | easy | 310 → **0** | 310 → **0** | 310 → **0** | 310 → **0** | 310 → **0** |
| bolt | easy | 0 → 0 | 0 → 0 | 0 → 0 | 310 → **0** | 310 → **0** |
| foreman | medium | 305 → **0** | 0 → 0 | 305 → **0** | 305 → **0** | 305 → **0** |
| patch | medium | 305 → **0** | 0 → 0 | 305 → **0** | 305 → **0** | 305 → **0** |
| sable | hard | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 300 → **0** |
| vulture | hard | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 300 → **0** |
| warden | hard | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 300 → **0** |

Every cell that ran is now a cell that stands, and the first leaf is `defend` in
all 35. Mean distance from its own station across the run, which is the
developer's complaint as a number: **431u → 213u** (rusty), 432 → 291 (medium),
432 → 304 (hard). The zeroes above the nerve are the bots that were never
frightened in the first place — Sable's nerve is 0.18, so 25/70 does not scare
it — and they are the control inside the table.

### 3.2 `field-siege` — the developer's frame: out in the field, home burning

The bot caught 900u out with a chaser on its tail **and** a raider standing on its
station. *"He was scared to come engage."* The column that answers it is
**closest** — how near its own station the bot ever got:

| character | hull | retreat ticks | closest to home |
|---|---|---|---|
| rusty | 25/70 | 380 → **0** | 152u → **80u** |
| foreman / patch | 25/70 | 350 / 360 → **0** | **484u** → **84u** |
| vulture / warden | 5/70 | 195 → **0** | **585u** → **83u** |
| sable | 5/70 | 234 → **0** | 83u → **83u** |

Foreman, Patch, Vulture and Warden never came inside 480 units of a station that
was being shot. They come to the doorstep now, at every hull fraction in the
sweep, and they arrive on the `defend` leaf rather than on a retreat that
happened to end nearby.

### 3.3 The controls

| control | before → after |
|---|---|
| `field` — same chase, **nothing near the station** | **byte-identical** |
| `A0135_CORE=0.2` — the same board under `last-stand` | **byte-identical** |
| `A0135_SIEGE=0` — the alarm not pinned, trespasser still on the doorstep | moves, and see below |

The third is not a quiet-home control and the report says so rather than letting
it read as one. `HOME_ALARM_RANGE` (520) is **wider** than `THREAT_RANGE` (416),
so anything near enough to frighten a bot standing at its own station is inside
that station's alarm ring by construction. Lifting the alarm pin leaves a silent
trespasser on the doorstep, `ownHomeThreatened` still reads true down its
intruder half, and the ruling still applies. The two settings are the same ruling
reached down the two halves of one predicate.

**That arithmetic is the structural form of this brief's ruling: a bot standing
at its own station can no longer be frightened off it, at any hull, ever.**

---

## 4. a0-105 and a0-107 — what held, and the one thing that moved

### 4.1 QA's own cells: unchanged

`evidence/a0-135-home-defence/siege.ts` runs QA's antagonists through QA's own
harness and reader, 40 s ceiling, longest unbroken `fleeing` hold in ticks:

| antagonist | before | after |
|---|---|---|
| `siege-home` | 0 (`last-stand` 2400†) | **0 (`last-stand` 2400†)** — unchanged |
| **`park@580`** — a0-107's own cell | 630/340/200/415/240/141/183 → `turn-and-fight` | **identical, every character** |
| `park@840` | 150/150/145/145/141/141/141 → `mine` | **identical, every character** |
| `park@200` | 110 → `defend` | 0; `defend` hold 155 → 335–1220 |

The only antagonist that moved is the one parked 200 units off the station —
inside the alarm ring.

### 4.2 The unit cells: a0-105's staging was itself a home-threatened board

`src/bots/behaviors.test.ts`'s a0-105 and a0-107 blocks staged their bot **at its
own station** with the hostile `PARK` = **200** units away. That is inside
`HOME_ALARM_RANGE`, so `ownHomeThreatened` reads true and — per §3.3 — no board
with a bot on its own doorstep can carry a retreat any more. Measured rather than
argued, in `evidence/a0-135-home-defence/reading.ts`:

```
HOME_ALARM_RANGE = 520

park    | station.underAttack | homeIntruder | ownHomeThreatened | which brief staged it here
park@200| false               | #1 @200u     | true              | a0-105 PARK / adversarial park@200
park@580| false               | null         | false             | a0-107 park@580
park@840| false               | null         | false             | adversarial park@840
```

So the **properties** those briefs established are untouched — a retreat still
ends, and there is still no annulus an opponent can hold the patience clock at
zero from — but the **boards** they were asserted on had a retreat only because
nothing was reading the home. They are re-staged 900 units out in the field, same
hulls, same separations, same pins, same assertions.

The thing that says this is a re-staging rather than a deletion: **the re-staged
cells still pass on `5df8ec05`.** Run in a throwaway worktree on the pre-fix tree,
all fifteen a0-81/a0-105/a0-107 cells pass and all six a0-135 cells fail.

One a0-107 assertion is restated rather than re-staged. `flyHome`'s chaser follows
the bot onto its own doorstep, so `defend` outranks the turn there and takes the
tick. a0-107's claim was never about which leaf serves it — *never interrupts a
bot that is still eating the road home, and still ends the moment the road runs
out* — and measured on this branch every character still flies the whole road
(closest **201–211u**, inside `ARRIVE_RADIUS` 220), shows **nothing but `retreat`**
while inbound past 440u, and stops at t≈620 at **207–216u** from its own station.
Same flight, same ending, different leaf. The turn itself is still pinned by
name, in the a0-105 block, on the field board that block is now staged on.

---

## 5. What else moved, and why

| file | what | why |
|---|---|---|
| `src/bots/commitment.test.ts` | the v0.2.2 *"sieged at home with a whole core ⇒ break contact"* cell | **a0-135 overturns exactly this ruling.** What v0.2.2 established is untouched and still asserted — the pair does not flap, a committed retreat *goes somewhere* — on a board out in the field. The overturned half is now its own cell asserting the new ruling on the old staging. |
| `src/bots/commitment.test.ts` | `collapse cancels`, `the priority exception` | Both staged their bot on its spawn point, which is its own doorstep. Both are about something else entirely; both move to the arena centre. |
| `src/bots/ffa-parity.test.ts` | three golden hashes | Eighth move. Bite re-proved first (§6). |
| `src/bots/team-winning.test.ts` | `is not a fixed side that wins` | Tipped a null into a set of winning teams. Two of sixteen matches now end as a0-113 **draws**; the cell counts them separately and asserts no match **timed out**, which is the finding that would be a defect. |
| `src/bots/team-winning.test.ts` | Task 1.7's seed, 10 → 8 | The fixture's own prescribed remedy (§6). |
| `tests/net/online-radio.test.ts` | FFA control hash `9b587b0c` → `0c4ea31f` | **Outside the bot lane — flagged for the Netcode Engineer.** Fifth re-baseline of this literal (a0-58, a0-59, a0-81, a0-121). Answers that file's rule 3 in its own note: the call site this branch added (`behaviors.ts:1829`) reads `ctx.self.station` and the single `hostile` stamp; the ALLY-aware sites next door (`:1213`, `:1427`) are untouched. Everything the literal guards — three seats at `radio === null` at t0 and a minute in — still asserted and green. Measured twice, stable. |
| `tests/harness/p1-08-pay.test.ts` | fixture seed 8 → 95, one case | **Outside the bot lane — flagged for its owner.** The one case whose *premise* is a property of the match: `placement` reaches `slots` only once somebody is out inside the 120 s probe. a0-81 moved it 9 → 8 for the same reason and set the standard — the replacement must clear on BOTH builds. Over a0-81's seeds 1–24 the clearing sets are now **disjoint** (7/24 before, 3/24 after), so the range widened to 96 and the standard held: exactly one seed clears on both. §7.3. |

---

## 6. The two re-baselines, each done the way its own file prescribes

**The parity goldens.** The rule is *"a golden you re-baked without proving it
still bites is a deleted test"*. a0-120's protocol, re-run on this branch and
recorded in `evidence/a0-135-home-defence/bite.txt`: control on the clean tree
passes; `WORLD_SIZE` 2400 → 2401 fails all three new hashes; Rusty's `caution`
1.3 → 0.2 fails all three; the closing control passes with both perturbed files
byte-identical to the commit.

| Seed | Post-a0-81 | Post-a0-105 | Post-a0-107 | **Post-a0-135** |
|---|---|---|---|---|
| 20260806 | `de94b69e` | `42e213df` | `d839695f` | **`f01248a1`** |
| 7 | `ab03dcd3` | `51f2e171` | `df4873c3` | **`7b967ee1`** |
| 991 | `a37c4e2c` | `a096a954` | `b3055735` | **`11bfa3bd`** |

**Task 1.7's seed.** That fixture's own module note records five previous
re-seedings and states the remedy in terms: *"the prescribed answer is a re-scan
rather than the next number."* Its own scan script was run unmodified
(`evidence/a0-121-excavator-penalty/team-window-scan.ts`, output in
`evidence/a0-135-home-defence/team-window-scan.txt`). Seed 10's window collapsed
to 1,893 ticks with 0 orders. Five of sixteen seeds satisfy every assertion, and
seed **8** is the largest-margin replacement the fixture has ever carried:

| | seed 10 (a0-121's pick) | **seed 8 (this branch)** |
|---|---|---|
| window | 16,005 ticks | **38,054 ticks (10.6 min)** |
| travelled | 25,164 u | **68,707 u** |
| trigger ticks | 3,265 | **10,563** |
| orders | 8 | **12** |

---

## 7. Win rates and match length

**Instrument** `evidence/a0-135-home-defence/win-rates.ts` — `harness/abundance.ts`'s
`readContests` shape verbatim, every seed playing every rotation so a seat-order
advantage cancels inside each seed. 32 seeds per contest. Raw output in
`win-rates-before.txt` and `win-rates-after.txt`; the "before" run is the
merge-base `5df8ec05` in a separate worktree, with `win-rates.ts` byte-identical
to the branch copy and `harness/soak.ts` byte-identical to the merge base.

This branch makes every bot defend harder, so these numbers were expected to
move, and they did.

### 7.1 Strategy contest — bot mirrors (GDD §3.8)

One hull (Vanguard), the three equally-skilled Hard characters rotated across the
eight seats. Fair share 33.3%, ceiling 55%. 96 matches per build, **0 unfinished
on either**.

| contestant | before (`5df8ec05`) | after |
|---|---|---|
| sable | 23/96 — 24.0% | 38/96 — **39.6%** |
| warden | 35/96 — 36.5% | 32/96 — 33.3% |
| vulture | 38/96 — **39.6%** | 26/96 — 27.1% |

**Both builds are inside the band** — the top contestant is 39.6% on each, more
than fifteen points clear of the 55% ceiling, and no character falls to a share
that reads as broken. What did move is the *ordering*: Sable and Vulture swap
ends. At this sample size SE ≈ 4.8 points, so Sable's +15.6 is about 3.2 SE and
Vulture's −12.5 about 2.6 SE. That is too big to file as noise, so it is
attributed rather than shrugged at.

**The attribution**, measured in `evidence/a0-135-home-defence/who-stopped-running.ts`
(the same contest with a0-112 telemetry on, leaf ticks pooled by *character*
instead of by seat, 24 matches per build) — outputs in
`by-character-{before,after}.txt`, as a share of each character's own observed
ticks:

| character | `retreat` | `last-stand` | `defend` | `attack` | `mine` |
|---|---|---|---|---|---|
| sable | 3.03% → **1.89%** | 19.63% → 27.39% | 7.78% → 7.49% | 23.97% → **23.21%** | 10.28% → 10.23% |
| vulture | 2.19% → **1.11%** | 34.52% → **24.14%** | 6.26% → **9.35%** | 10.71% → **8.74%** | 4.05% → **3.33%** |
| warden | 2.72% → 2.35% | 23.35% → 22.45% | 7.87% → 7.22% | 20.72% → 20.74% | 10.37% → 9.97% |

`retreat` falls for all three, which is the branch working. The win column does
not follow it — Vulture sheds the largest *relative* share of retreat and loses
win rate — so the retreat column is not the driver, and the row that is, is
Vulture's. Vulture spent a **third of its match in `last-stand`** before this
branch and now spends a quarter: it is meeting attackers at its alarm ring
(`defend` 6.26% → 9.35%, the largest defend gain of the three) instead of at its
core. That is the ruling doing exactly what it says. It is also the character
that can least afford the time, because the time comes out of the two columns
Vulture converts into wins: it is the economy character (`greed` 0.9,
`scavenge` 1.0 — the highest of the three on both), and its `attack` and `mine`
both drop. Sable is the mirror image: `homebody` 0.2, the lowest on the board, so
it holds its offence flat (`attack` 23.97% → 23.21%) while its two rivals pay a
defensive tax. **This is a real re-weighting of the tuning table's characters
against each other, not a competence change** — every character is still inside
the band, and this is flagged for the Director in the PR as a tuning consequence
rather than presented as a neutral result.

### 7.2 Class contest (GDD §2.11)

One behaviour (Sable), the four hulls rotated. Fair share 25%, ceiling 55%. 128
matches per build, **0 unfinished on either**.

| contestant | before (`5df8ec05`) | after |
|---|---|---|
| excavator | 59/128 — **46.1%** | 57/128 — **44.5%** |
| vanguard | 27/128 — 21.1% | 33/128 — 25.8% |
| hauler | 34/128 — 26.6% | 30/128 — 23.4% |
| interceptor | 8/128 — 6.3% | 8/128 — 6.3% |

Inside the band on both builds and quieter than the strategy contest: SE ≈ 3.8
points, and the largest move is Vanguard's +4.7 (1.2 SE). The Excavator stays on
top at 44.5%; the Interceptor's 8/128 is **identical** on both builds, which is
worth saying out loud — the hull with the least hull to lose is the one a ruling
about not fleeing at low hull might have been expected to move most, and it did
not move at all.

### 7.3 Match length — the one number that leaves the band, and it is two matches

| contest | before | after |
|---|---|---|
| strategy, 96 matches | mean 809 s, min 768, max 837 | mean 812 s, min **766**, max 841 |
| class, 128 matches | mean 813 s, min 769, max 834 | mean 806 s, min **374**, max 843 |

The means are unmoved and inside the 10–15 minute target (GDD §1), and no match
on either build timed out. **The class contest's minimum is not**: 374 s is
6.2 minutes, well under the band's floor, and it is a number the summary line
alone cannot settle — a min is one match and a mean is 128. It is not papered
over here.

`evidence/a0-135-home-defence/length-distribution.ts` re-runs that contest —
same seeds, same rotations, same `runBotMatch` — printing one line per match:

| | before | after |
|---|---|---|
| below 600 s | **0 / 128** | **2 / 128** (seeds 20001 @ 374 s, 32003 @ 464 s) |
| above 900 s | 0 / 128 | 0 / 128 |
| 700–800 s | 22 | 26 |
| 800–900 s | 106 | 100 |
| timed out | 0 | 0 |

So the shape is intact — 126 of 128 in band, nothing at all between 600 s and
700 s — and the finding is two outliers, not a shift. `short-match.ts` re-runs
exactly those two with telemetry (`short-match-{before,after}.txt`) and the cause
is a single column:

| | seed 20001 | seed 32003 |
|---|---|---|
| length | 771 s → **374 s** | 822 s → **464 s** |
| ended at | collapse (750 s) → outright, **no collapse** | collapse (750 s) → outright, **no collapse** |
| pooled `retreat` ticks | 38,225 → **2,850** | 7,731 → **4,359** |
| winning class | excavator → **excavator** | vanguard → **vanguard** |

In seed 20001 a single seat — an Interceptor — held **31,334** of the before
build's 38,225 retreat ticks: four fifths of the match's retreating was one bot
orbiting the map while its home burned, alive and contesting nothing, until the
750 s collapse timer ended the match for it. After this branch it holds its
doorstep and dies there. **The winning class is identical on both builds in both
seeds** — in seed 20001 the identical seat survives — so what shortened is the
time to reach the same result, not the result. These are matches that were long
because of the defect.

The honest counter-reading, and it belongs here: on p1-08's board the sign is the
**opposite**. That is an 8-slot scarce match, and there the first core falls
*later* after this branch — the window at 120 s is cleared by 7 of a0-81's 24
seeds before and 3 after (§5, and the fixture move in
`tests/harness/p1-08-pay.test.ts`). Both readings are this branch's doing and
they do not contradict each other: bots that hold their own doorstep make a
station harder to finish, which lengthens a crowded board, and they stop
producing the one-bot-orbiting-forever match that only ends on the collapse
timer, which shortens the tail on a sparse one. The band is measured on the
contests above, and on those it holds for 126 of 128 and 96 of 96.

