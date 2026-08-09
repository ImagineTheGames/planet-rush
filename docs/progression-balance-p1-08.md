# The XP economy, re-baselined — what a match actually pays

**Author:** QA Agent (p1-08) · **Scope:** measurement · **Status:** report, not a contract
**Against:** `docs/progression-plan.md` §1.2, §1.3a–d, §1.4 · **Brief:** `docs/briefs/pr-08-rebaseline.md`

Every number in the plan's §1.3 came from bots in a spike. This is the hand-off QA owes it
(GDD §3.8, plan Task PR-8): the pay and the curve re-measured with the shipped code, the
shipped trees, the shipped observer and the shipped pricer — and swept across the three axes
the spike never varied.

**The short version.** The plan's arithmetic survives almost untouched — three of its four
lobby spreads reproduce to the decimal, and the accrual table's free half reproduces
*exactly*. `XP_CURVE_BASE`, `XP_CURVE_EXP` and `DAMAGE_HP_PER_UNIT` should all stay where they
are. What does not survive is one sentence: **"level 2 lands inside a single match, so a first
match levels you even if it goes badly."** The first half is true (0.6–1.0 matches at the
median, in nineteen of twenty cells). The second half is false — a player knocked out first in
the lobby an offline match actually seats earns **68 XP**, and needs **4.4 such matches** to
reach level 2. That is a finding about the participation floor, not about the curve, and §7
prices six ways to fix it.

## Reproduce

```
npx vite-node harness/cli.ts pay --seeds 12 > spikes/progression/measured-p1-08.txt
npx vitest run tests/harness/p1-08-pay.test.ts
npx vite-node spikes/progression/measure-ratified-xp.ts     # a0-13's spike, as the control
```

The full output of the first command is committed at `spikes/progression/measured-p1-08.txt`,
so every number below is checkable without a twenty-minute run, and the next lane can diff two
runs rather than trust two prose summaries.

---

## 1. The sample, stated — because a hidden sample is a hidden result

**240 matches, all of them ended.** Real shipped bot cast (`createBots` / the shipped fill
order), seeds 1..12 per cell, 60 Hz, no perception narrowing, no constant changed anywhere.

| axis | levels swept | held at |
|---|---|---|
| lobby (cast) | Easy mirror · Medium mirror · Hard mirror · **mixed (shipped fill order)** | octagon, N=8 |
| abundance | **scarce (the shipped lobby default)** · standard · rich | octagon, N=8, mixed |
| lobby size N | 8 · 6 · 5 · 4 · 3 | octagon, mixed, scarce |
| map | **octagon** · compass · oval · diamond | N=8, mixed, scarce |

**What is deliberately NOT in it, named so nobody reads a gap as a result:**

- **Humans.** There is no human in this sample, and no way to get one from a harness. Every
  claim below is a claim about bots. Plan §1.4's note stands unchanged: real humans mine more
  and die less than Medium bots do, so the pay a person earns is not this pay. Question E
  (§6) is answered *for the bot half of the question only*.
- **The two team maps** (`line`, `crescents` — `TEAM_MAP_IDS`). A 4v4 changes placement rungs
  and the win row for reasons that have nothing to do with the board, so mixing them into an
  FFA pay sample would measure the mode, not the map.
- **Online.** The observer is fed the local authoritative world. Online it must be fed the
  *server's*, and that is pr-05's wiring rather than a number this report can take.

## 2. What changed about the method, and why every number moved a little

**The damage rows are read off the ledger now, not reconstructed.** a0-13 had to rebuild
attribution from projectile geometry (`spikes/progression/measure-ratified-xp.ts`), and it
published its own residual: `recon*` ≥ 95%, the gap being the Crush eating cores with nobody
to credit. pr-02 shipped the real thing (`src/sim/combat-credit.ts`), and
`src/progression/accrual.ts` reads it. **The brief's question was: by how much was the
reconstruction off?** Measured, at the identical cell (octagon, N=8, standard, seeds 1..12):

| lobby | ore, spike → ledger | damage HP | ship kills | station kills |
|---|---|---|---|---|
| Easy mirror | 28.2 → **28.2** | 228 → **234** (+2.6%) | 4.0 → **4.0** | 0.0 → **0.0** |
| Medium mirror | 23.1 → **23.1** | 1443 → **1524** (+5.6%) | 21.0 → **22.0** | 0.0 → **0.0** |
| Hard mirror | 12.8 → **12.8** | 689 → **696** (+1.0%) | 11.0 → **12.0** | 0.0 → **0.0** |
| mixed cast | 28.9 → **28.9** | 768 → **796** (+3.6%) | 12.5 → **14.0** | 0.0 → **0.0** |

The free half — the world deltas — reproduces to the last decimal in all four lobbies, which
is two independent instruments agreeing and is the best evidence either of them is right. The
credited half was **1–6% low** under the reconstruction, exactly the direction its residual
predicted. **Nothing in the plan's conclusions moves on a 6% damage correction.**

**The abundance is named now, and this is the one real hole in the plan's numbers.**
`createWorld` defaults to `standard` for backward compatibility; the lobby ships
`DEFAULT_ABUNDANCE = 'scarce'` (`src/sim/constants.ts`). a0-13's spike called
`createWorld({ seed, players })` with no abundance — so **every number in plan §1.3a–§1.4 is a
`standard` number, and the game ships `scarce`.** It turns out not to matter much (§5), but it
was not known not to matter. This report runs both and labels every cell;
`tests/harness/p1-08-pay.test.ts` pins the trap so the next rig cannot fall into it silently.

**The rig is QA-owned and imports the shipped modules.** `harness/pay.ts` runs the real cast
through the shipped observer and the shipped pricer — never a copy of the weights. When a
weight is re-tuned or the Bot Engineer moves a tree, the rig moves with it instead of going
stale, which is precisely how a0-13's `measure-xp.ts` had been broken for the whole life of
that document before somebody ran it.

**A hung match is a failed measurement.** Three ceilings (sim time, wall clock, a tick
backstop), and `payStats` counts only ended matches into the medians — pooling a timed-out
match's accrual would drag every median down invisibly. It never fired: 240/240 ended.

## 3. The control — the game has not moved since a0-13

Before reading any delta as "the game changed", re-run the a0-13 spike at today's HEAD:

```
npx vite-node spikes/progression/measure-ratified-xp.ts | diff - <(tail -n +4 spikes/progression/measured-a0-13.txt)
```

**Byte-identical**, 117 lines, at `6a644e4` against the `854fa64` the file was captured on.
So every difference between this report and the plan is the *instrument* or the *axis*, and
none of it is a moving sim. That also means the plan's §1.3c(3) warning — "which tier pays
best will move the next time the Bot Engineer touches the trees" — has not been triggered yet,
and this report is the baseline it will be measured against when it is.

---

## 4. The accrual and XP tables, beside §1.3a's

Per-player, per match, median over all player-matches. Full table in the evidence file.

**Octagon · N=8 · STANDARD — the cell §1.3a measured:**

| lobby | ore | dmg HP | shipK | statK | struct | upgr | repair | **med XP** | winner | first out | spread | XP/min | length |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Easy mirror | 28.2 | 234 | 4.0 | 0.0 | 4.0 | 0.0 | 0.0 | **327** | 495 | 327 | 1.5× | 23.1 | 14:10 |
| Medium mirror | 23.1 | 1524 | 22.0 | 0.0 | 3.0 | 2.0 | 0.0 | **521** | 760 | 369 | 2.1× | 37.4 | 13:55 |
| Hard mirror | 12.8 | 696 | 12.0 | 0.0 | 2.0 | 1.0 | 0.0 | **321** | 1208 | 100 | 12.1× | 23.9 | 13:43 |
| mixed cast | 28.9 | 796 | 14.0 | 0.0 | 4.0 | 1.0 | 0.0 | **416** | 1120 | 104 | 10.8× | 29.9 | 13:55 |

**Octagon · N=8 · SCARCE — the same lobbies as the game actually ships them:**

| lobby | ore | dmg HP | shipK | statK | struct | upgr | repair | **med XP** | winner | first out | spread | XP/min | length |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Easy mirror | 19.4 | 182 | 3.0 | 0.0 | 4.0 | 0.0 | 0.0 | **296** | 485 | 240 | 2.0× | 20.9 | 14:10 |
| Medium mirror | 20.9 | 1606 | 23.0 | 0.0 | 3.0 | 1.0 | 0.0 | **509** | 821 | 386 | 2.1× | 36.6 | 13:55 |
| Hard mirror | 16.7 | 756 | 14.0 | 0.0 | 2.0 | 1.0 | 1.0 | **336** | 1205 | 77 | 15.6× | 24.7 | 13:33 |
| mixed cast | 26.5 | 871 | 13.0 | 0.0 | 3.0 | 1.0 | 0.0 | **445** | 1123 | 68 | 16.6× | 32.4 | 13:52 |

### Delta against the plan's own table (§1.3c(1), "median, + rows" and "spread, + rows")

| lobby | plan median | measured (standard) | Δ | plan spread | measured spread |
|---|---|---|---|---|---|
| Easy mirror | 295 | **327** | +11% | 0.9× | **1.5×** |
| Medium mirror | 513 | **521** | +1.6% | 2.1× | **2.1×** |
| Hard mirror | 321 | **321** | **0%** | 12.1× | **12.1×** |
| mixed cast | 407 | **416** | +2.2% | 10.8× | **10.8×** |

**Three of the four spreads reproduce exactly and one median is identical to the unit.** The
plan's headline — *"a typical match pays ~399 XP"* — measures **416** at the cell it was taken
on, and **296–529** across every cell in this sweep. That claim stands.

The Easy lobby is the one that moved (spread 0.9× → 1.5×, median +11%), and the reason is the
attributor: an Easy lobby has the least combat, so the reconstruction's missing HP was the
largest share of a small number, and the first-out player was the one it under-paid.

### The plan's §1.2 caveat, resolved

§1.2 warned that the spike's probes *"under-build and never repair"*, that `struct` and
`repair` were `0` at the median, and that structures XP was **a floor, not a typical**.
Measured with the shipped trees: **structures are 2–4 per player per match in every single
cell, and 9–12% of all XP paid** — the third-largest row in the economy after damage and ship
kills. Repairs are still ~0–1 (1% of pay), so half the caveat was right and half of it was
worth four times what the floor suggested. §1.2's warning can be retired.

---

## 5. The three axes the plan never swept

### N — and the brief's own expectation is falsified

The brief predicted that because per-player ore density rises as N falls (`homeFieldOre(n)`),
*"a 3-player match should pay noticeably more, and the plan has never checked whether that
breaks the curve at small N."* Measured, octagon, mixed cast, scarce:

| N | ore | dmg HP | shipK | med XP | L2 | combat share of pay |
|---|---|---|---|---|---|---|
| 8 | 26.5 | 871 | 13.0 | **445** | 0.7 | 39% |
| 6 | 34.5 | 1184 | 22.0 | **529** | 0.6 | 40% |
| 5 | 39.0 | 908 | 16.0 | **518** | 0.6 | 29% |
| 4 | 55.7 | 280 | 4.0 | **454** | 0.7 | 10% |
| 3 | 59.9 | 159 | 2.5 | **404** | 0.7 | 6% |

**The ore prediction is right and the pay prediction is backwards.** Ore per head does climb —
+126% from N=8 to N=3 — but XP *falls* 9%, because at small N there is almost nobody to fight:
damage collapses 82% and ship kills 81%. The two effects very nearly cancel, and the economy
turns out to be **remarkably flat across lobby size: 404–529 XP, a 1.3× band.** The curve is
not broken at small N; it is barely disturbed by it. What *does* change is the character of
the pay — at N=3 the match is 6% combat and 34% ore-and-banking, at N=8 it is 39% combat.

### Map — flat

423 (diamond) to 470 (oval) median XP, a ±5% band, with the same composition in every board.
The map is not a variable in this economy.

### Abundance — flat, and *inverted* from the obvious guess

401 (rich) → 416 (standard) → **445 (scarce)**. The leanest field pays the *most* XP, and not
for the obvious reason: at scarce the median player both fights more (871 vs 654 HP dealt) and
mines more (26.5 vs 20.6 ore) than at rich. A richer field is not a richer player. This report
does not explain that — the wave schedule and the collapse deadline are identical at every
level by construction (a0-17 pinned exactly that), so the difference is in what the bots *do*,
which is the Bot Engineer's file. It is an 11% effect on a 12-seed median, it points the
opposite way from the intuition, and it is recorded so that nobody assumes a rich lobby is the
farm.

**Net: the pay is a property of the CAST, not of the board, the size or the field.** Easy 296
against Medium 509 is a 1.7× spread — larger than every map, N and abundance effect in this
report put together.

---

## 6. The plan's open questions, answered with numbers

### Question A — keep the participation rows, or is XP purely combat + ore? **Keep them. Confirmed.**

The plan recommended keeping s4's seven rows and priced the alternative from the spike. Priced
now off the shipped pricer's own itemised rows:

| lobby (standard) | full med XP | four-only med XP | full spread | four-only spread | four-only L2 |
|---|---|---|---|---|---|
| Easy mirror | 327 | **59** | 1.5× | **0.3×** | 5.1 matches |
| Medium mirror | 521 | **260** | 2.1× | 1.2× | 1.2 |
| Hard mirror | 321 | **167** | 12.1× | 6.6× | 1.8 |
| mixed cast | 416 | **171** | 10.8× | 6.5× | 1.8 |

The plan's four-only numbers were 58 / 243 / 162 / 162 with spreads 0.3× / 1.1× / 6.7× / 7.2×.
**Every one of them reproduces inside 7%.** In an Easy lobby the first player knocked out still earns
more than three times what the winner does (0.3×), and level 2 still takes five matches.

One correction for whoever acts on Question A: the plan says that if the rows are dropped,
`XP_CURVE_BASE` must fall to **75** (from a 149-XP typical). Measured, a four-only match pays
**169 XP** at the shipped default lobby, so the replacement value is **`base = 150`**, not 75 —
and even at 150 an Easy lobby (four-only median 47) does not reach level 2 in a match.

### Question E — the bot farm. **Leave it alone. And the gap is far smaller than the plan says.**

| lobby | plan §1.3b XP/min | measured XP/min (standard) | measured (scarce) |
|---|---|---|---|
| Easy mirror | 4 | **23.1** | 20.9 |
| Medium mirror | **17** | **37.4** | **36.6** |
| Hard mirror | 12 | 23.9 | 24.7 |
| mixed cast | 12 | 29.9 | 32.4 |

The plan's farm table was computed on **combat rows only** — an economy the plan does not
recommend. Under the economy that shipped, every rate roughly doubles-to-quintuples and the
*gap* collapses: the plan's fastest-to-slowest ratio of **4.3×** (17 vs 4) is really **1.8×**
(36.6 vs 20.9), because the participation rows pay everybody in every lobby.

The plan's ordering survives — **Medium is still the fastest XP in the game**, for the reason
it gave (Medium bots fight and die constantly: 23 kills and 1606 HP per player against Hard's
14 and 756) — but the *finding* is much weaker than "a Medium lobby is the farm". Farming the
fastest tier over the slowest buys 75% more XP per minute, not 325% more. For a cosmetic-only
progression that is comfortably inside "a player grinding hats against bots is a player playing
the game". **QA's recommendation is unchanged from the plan's: leave it alone**, and note that
this report is now the baseline the next bot-tree change gets measured against.

### Question B — one unit of damage = 25 HP. **Measured, it does exactly what it was chosen to do.**

The plan picked 25 HP so that a melted hull would pay about what the kill that ends it pays.
Composition of the shipped economy, measured (mixed cast, scarce): **damage 19%, ship kills
19%**, one point apart. Ore is 6% (the plan's §1.3a table said 17%, but that table normalised
over combat and ore only — under the full eleven rows the seven participation rows take 55%
between them). The design intent is achieved; see §7 for the recommendation.

### Question C — a station the Crush killed. **Station kills are still 0.0 at the median, everywhere.**

Every lobby, every map, every N, every abundance: the median player destroys **zero** stations,
and the row is 0–2% of all XP paid. Hard lobbies are the only ones where it registers at all.
This report adds no new argument to Question C — it confirms that whichever way it goes, the
10× row is currently the smallest thing in the economy.

---

## 7. The recommendation on the three constants

**`XP_CURVE_EXP = 1.6` — KEEP.** Nothing measured touches the tail. Level 10 lands at 76–135
matches across every cell in the sweep (the plan predicted ~101; the a0-13 cell measures 96.6),
and level 20 at 493–880. The long-tail shape the plan argued for is the shape the game has.

**`DAMAGE_HP_PER_UNIT = 25` — KEEP.** It was chosen so that finishing a ship pays about what
the work of getting it there pays, and measured it lands damage at 19% of pay against ship
kills at 19%. Moving it to 50 would halve damage's share and break that equality in the
direction of the kill; moving it to 10 restores the problem the plan chose it to avoid. It is
Question B and the developer may overrule it, but no measurement in this report argues for a
change.

**`XP_CURVE_BASE = 300` — KEEP, and restate what it buys.** The hook holds at the median in
nineteen of twenty cells (0.6–1.0 matches to level 2; the twentieth, an Easy scarce lobby, is
1.01). What does not hold is the plan's parenthetical — *"so a first match levels you even if
it goes badly"*:

| shipped default lobby (mixed · octagon · N=8 · scarce) | XP | matches to level 2 |
|---|---|---|
| winner | 1123 | 0.3 |
| median seat | 445 | 0.7 |
| 25th percentile | 255 | 1.2 |
| **first player knocked out** | **68** | **4.4** |
| worst seat in the sample | 38 | 7.9 |

A new player's first match is not the median seat's match. **The fix does not belong in the
curve** — dropping `base` far enough to level a 68-XP match (base ≤ 68) would put the median
seat at level 2 in a sixth of a match and wreck the pacing the developer ratified. It belongs
in the participation floor, which is the thing that pays an eliminated player nothing: they
survive no waves, clear no placement rungs, and win nothing.

Priced against **the same twelve matches**, so the candidates are comparable to each other and
to the control, and no reading is a different afternoon's matches
(`harness/abundance.ts`'s discipline, applied to XP):

| candidate | median | p25 | first out | L2 @ median | L2 @ p25 | **L2 @ first out** | spread |
|---|---|---|---|---|---|---|---|
| **shipped (control)** | 445 | 255 | 68 | 0.7 | 1.2 | **4.4** | 16.6× |
| `XP_PER_WAVE` 15 → 40 | 561 | 330 | 93 | 0.5 | 0.9 | 3.2 | 13.5× |
| `XP_PER_PLACEMENT_RUNG` 20 → 40 | 537 | 295 | 68 | 0.6 | 1.0 | **4.4** | 18.7× |
| flat MATCH PLAYED +100 | 545 | 355 | 168 | 0.6 | 0.8 | 1.8 | 7.3× |
| flat MATCH PLAYED +200 | 645 | 455 | 268 | 0.5 | 0.7 | **1.1** | 4.9× |
| flat +100 and `XP_PER_WAVE` 40 | 661 | 430 | 193 | 0.5 | 0.7 | 1.6 | 7.0× |

Three things fall straight out of it:

- **Raising `XP_PER_PLACEMENT_RUNG` cannot help, structurally.** The first player out clears
  *zero* rungs by definition (`rungs = slots − placement`), so doubling the row's value pays
  them nothing and pays the winner twice — it moves the spread the wrong way, 16.6× → 18.7×.
  It is the intuitive dial and it is the wrong one.
- **Only a flat row reaches the player in question.** A "match played" row is the one payment
  an eliminated player is guaranteed to earn, and at **+232** (interpolating the +100 and +200
  rows, which land first-out at 168 and 268) it makes *"a first match levels you even if it
  goes badly"* literally true. It also cuts the winner:first-out spread from 16.6× to ~4.5×,
  back toward the 1.1–1.7× s4 called the design.
- **A flat +200 collides with `XP_FOR_WIN = 200`**, which would say that showing up is worth
  exactly what winning is. That is a design statement, not a tuning one — which is precisely
  why the next paragraph does not just apply it.

**QA's recommendation: keep all three constants unchanged, and put the floor in front of the
developer as a new question** — it is a *row* question, and rows 5–11 are already Question A's
territory, which the developer has never ruled on. If the answer is "yes, add a floor", the
measured value is a flat **MATCH PLAYED ≈ 230–250 XP** and QA will apply and re-baseline it.
QA owns these values from m10 and will apply whichever answer comes back; it will not invent a
new row in the developer's table unilaterally.

---

## 8. Match length, with the summary sequence in the loop

The brief asks whether the 10–15 minute target still holds once a five-second beat runs after
every match. It does, and here is the whole of the arithmetic:

| | measured |
|---|---|
| Match length, median across cells | **13:29 – 14:10** |
| Match length, longest single match | **14:10** |
| Summary sequence, median (`buildSummary`, watched, not skipped) | **5.5 s** |
| Summary sequence, longest (a level-up beat) | **6.8 s** |
| Worst case: longest match + longest sequence | **14:17** |
| Sequence total across a 50-match career | **4:43** (5–8 of 50 carry a level-up) |

**Verdict: PASS, with 43 seconds of headroom and a caveat that is worth more than the pass.**
The summary costs 0.7% of the loop and is not the problem. The problem is that the *match* sits
at the top of its own target band in every single cell — 13:29 at the fastest, 14:10 at the
slowest, against a 15:00 ceiling — which is the same reading the Bot Engineer filed on day 4
(`docs/bot-balance-day4.md`: median 15.2 min, *"the top of that range rather than its
middle"*). It has improved since, but not moved off the top. **Anything that adds forty
seconds to a match puts the loop outside the target, and the summary sequence has already
spent seven of them.** That is a standing note for whoever tunes `COLLAPSE_GRACE_S` or the wave
schedule next, not a defect in pr-05.

One thing the model cannot see: the sequence is **always skippable** (plan §6.4 rule 1), so
5.5 s is the price of watching it, not of having it. A player who taps through pays ~0.

---

## 9. What goes back to the developer

Two of the plan's five open questions come back with numbers instead of arguments, and one new
one is opened by what the measurement found.

**Question A (participation rows) — the plan's recommendation is confirmed, unchanged.** Drop
them and an Easy lobby pays the first player out three times what it pays the winner (0.3×
spread), and level 2 takes five matches. Keep them. If they are dropped anyway, the measured
replacement for `XP_CURVE_BASE` is **150**, not the plan's 75.

**Question E (the bot farm) — the plan's recommendation is confirmed, its number is not.** A
Medium lobby is still the fastest XP in the game, but the advantage over the slowest tier is
**1.8×, not the 4.3× the plan states** — the plan's farm table was computed on combat rows
only, an economy it does not recommend. Leave it alone, with more confidence than before.

**NEW — Question F: does an eliminated player earn a floor?** *(raised by §7)* The plan
promises that "a first match levels you even if it goes badly". Measured, a player knocked out
first earns 68 XP and needs 4.4 matches to reach level 2, because they survive no waves, clear
no placement rungs and win nothing. Options, priced: a flat **MATCH PLAYED ≈ 230–250 XP** row
(makes the promise literally true, cuts the winner:first-out spread from 16.6× to ~4.5×);
raising `XP_PER_WAVE` 15 → 40 (helps a little — 4.4 → 3.2 matches — and only for a player who
lived through a wave); or accept it and **restate the plan's claim as "level 2 lands inside a
single match for the median player"**, which is what it measurably is. QA's recommendation is
the third for now and the first if the developer wants the promise kept, because a new row in
the developer's own weight table is theirs to add, not QA's.

## 10. What this report does not answer

- **What a human earns.** No human is in the sample and none can be. Plan §1.4's note stands:
  humans mine more and die less than Medium bots. Every number here is a bot number, and the
  right way to close this is telemetry off real play, not a bigger harness run.
- **Whether the first-out floor is a real problem or a real design.** Measured, it is real:
  4.4 matches to level 2 for a player who dies first. Whether that should be fixed is the
  developer's call (§7).
- **Online accrual.** The observer must be fed the server's authoritative world online; this
  report measures the offline path only.
- **Anything about unlocks.** Phase 1 has none, by ratification, and this report designs none.
