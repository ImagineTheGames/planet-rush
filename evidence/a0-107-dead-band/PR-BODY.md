Closes QA defect **`a0-106-01`** — the flee latch, unbounded again, 260 units
further out than a0-105 was looking.

## What was wrong

a0-105's standoff is correct and it fires. **What stood in front of it was not.**

```ts
if (threat.distance > THREAT_RANGE || !retreatOutOfRoad(ctx, threat)) {
  resetStandoff(stand);   // ← a read that could not be evaluated
  return true;            //   threw the patience clock away
}
```

Both gates are things an **opponent** controls, and a read that failed either one
did not merely skip the fold — it reset the clock. So an opponent who kept either
false on any tick held the clock at zero forever. Park in the 260-unit annulus
between `THREAT_RANGE` (416) and `RETREAT_CLEAR_RANGE` (676) — too far to be
measured, too near to read *escaped* — and a hostile that **never moves and never
fires** held a wounded bot in `retreat` for 17 860 ticks of 18 000, at 0% trigger,
121 units of drift, 90 units off its own station. a0-105 added a third exit to a
latch whose two exits were opponent-controlled, and put it behind a fourth and a
fifth that are too.

## What landed

The gates are gone. The standoff measures the two things a retreat can be doing:

- **`gap`** — the widest separation opened on the threat. *Am I getting away?*
- **`road`** — the shortest distance to the refuge. *Am I getting home?*

Improve on either and the retreat is working and keeps its patience. Improve on
neither for the character's own patience and the bot turns and fights.

- **No annulus can exist.** The contact range is now the *same predicate* the flee
  latch's own `escaped` exit uses, so "still fleeing this" and "measuring this"
  cannot come apart. That is why no range was widened.
- **Nothing on the path is opponent-controlled.** An opponent can stop the clock
  only by letting the bot open ground or letting it get home — both are the
  retreat succeeding. Line-by-line audit in the report §6.
- **It terminates.** Both anchors are monotone, so herding a bot back and forth
  cannot be paid for twice: finitely many legitimate resets, and every retreat
  ends.

`retreatOutOfRoad` (a boolean gate an opponent could flap) becomes `retreatRoad`
(a distance the bot's own flying improves).

### On QA's constraint (2), which the brief asked me to answer either way

**Taken, with one amendment, and the amendment is load-bearing.** *"Holding the
clock rather than resetting it, when the fold cannot be evaluated"* is the right
diagnosis of the reset and it is **not sufficient on its own**: in the
reproduction the fold is never **evaluated at all**. Under `park@580` the
separation is in the band on 17 954 ticks of 18 000, so the `THREAT_RANGE` gate
fails on essentially every tick and a held clock that never *starts* stays at
`-1` — no character turns. `block-home` is the same story in the other gate: the
subject never gets inside `ARRIVE_RADIUS` of a station somebody is standing on.
So the measurement itself had to become unconditional, which is the same instinct
one step further: stop asking permission to measure, and measure what the gate
was standing in for. Constraint (1) is dead right and is why nothing moved a
range; constraint (3) is checked below and in the standing gate.

## Evidence

| | before (`3de74a4`) | after |
|---|---|---|
| `park@580` × rusty, 300 s ceiling | **17 830 / 18 000, still open** | **630**, turns into `turn-and-fight` |
| `never-die` × rusty, 300 s (no opponent-controlled exit exists) | **18 000 / 18 000, still open** | **360** |
| worst hold anywhere in the sweep | unbounded | 680 ticks (11.3 s) vs a 30 s bound |
| `KNOWN_UNBOUNDED` | 25 cells | **0** |
| retreat episodes, 5 whole matches | 311, median 1.25 s, **longest 99.00 s** | 300, median **1.40 s**, longest **14.17 s** |
| match length | 811 s, 0 unfinished / 96 | **809 s**, 0 unfinished / 96 |
| strategy contest, top contestant | 43.8% | **39.6%** (band is 55%) |

**Did it delete the retreat?** No — and the episode distribution is how you can
tell rather than take my word for it. Bots retreat just as often (311 → 300) and
the ordinary retreat is a touch *longer* (1.25 s → 1.40 s). What halved the share
is the 99-second one: two thirds of all retreat time before this branch was spent
in episodes over ten seconds. Deleting the retreat moves the median; ending it
moves the maximum. (a0-105's rejected first cut pushed `dead` from 14% to 24%;
this moves it 16.1% → 18.6%.)

`tests/reports/a0-107-dead-band.md` has the full per-character, per-antagonist,
three-ceiling tables and the win-rate contests. Instruments and raw output in
`evidence/a0-107-dead-band/`, all four of them measured on both builds.

## The general lesson

`docs/LESSONS.md` (new): **an exit condition an opponent alone can satisfy is not
an exit.** Twice now, one level apart — which is what earns it a page rather than
a paragraph in a report nobody reads twice. It carries the audit rule that would
have caught this one (*read every condition on the path to your new exit, and ask
of each: can my opponent hold this false?*), why widening a range moves a band
rather than closing it, and why bots cannot find this class of defect by playing
each other.

I ran that audit on this fix before opening the PR. Report §6 is the table.

## Re-baselines, all measured

- **FFA goldens** move a seventh time (module note carries the reason and size).
- **`defender-role`'s** match-scale case measured a residual on **one** seed
  against a 5% cap where it read 0.0% — a measurement of seed 11, not of the
  behaviour. Now three seeds, aggregate under 5%, each match under 8%, with a
  six-seed before/after (0.00% → 0.88%, **zero** defender disagreements in all
  twelve matches, which is the property that case exists to protect).
- **`cornered`'s** off-road negative case runs a frozen staging; nothing in it
  moves, so the standoff correctly turns after Rusty's patience. It now asserts
  the retreat at one second and names the turn at six — `turn-and-fight`, not
  `cornered-fight`, which is the claim it was making.

## Not this branch's, flagged again

The class contest reads **excavator OVER the 55% ceiling on both builds**, and
this is the honest bad news in the branch. Re-run at 256 matches to tighten it:
**72.7% → 78.5%**, +5.8 points ≈ 2 SE, so the move is real and not noise. Three
things about it:

- it is **17.7 points over the ceiling before this branch touches it** — a
  pre-existing ship-class result on the shipped trees, and nothing in `src/bots/`
  closes that with the retreat branch working correctly;
- the mechanism is legible — a wounded bot that turns and fights is a bot in a
  fight, and the hull with the most of everything wins more of those (the loser
  is the hauler, 10.9% → 5.5%);
- **taken with a0-105 it is a round trip**: pre-a0-105 the same contest read
  78.1%, a0-105 took it to 68.8%, and this returns it to 78.5%. The two branches
  together leave the metric within noise of where they found it.

The §2.11 multipliers are gameplay's lane, not the bot lane's, so this is
**flagged rather than absorbed** — with the sample size to act on. Report §4 has
both sample sizes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
