# LESSONS

Things this studio learned the expensive way, written down so the next lane does
not have to learn them the same way. One entry per lesson. Each one names the
shape of the mistake, the evidence, and what to do instead — a lesson without a
reproduction is an opinion.

Add an entry when a defect turns out to be an *instance of something*, not when
it is merely a bug. The test for that: could a lane that has never seen this
code make the same mistake tomorrow, in a different file?

---

## An exit condition an opponent alone can satisfy is not an exit

**Twice now, one level apart.** (a0-105, a0-107; QA's instrument a0-106.)

A latch, a commitment, a branch that keeps winning — anything a bot can be *in*
— needs a way out. Write that way out in terms of something the **opponent**
does and you have not written one, because an opponent who is content to do
nothing can hold it shut for as long as they like. This is not a rare
adversarial edge; it is the first thing a player tries when a bot does something
they can exploit, and both times it reached us it reached us as a screenshot.

**a0-105 — the retreat with no end.** The flee latch released on
`recovered || escaped`. Nothing in the game repairs a hull, so `recovered` is
the opponent's to withhold by keeping the pressure on; `escaped` is the
opponent's to withhold by standing inside `RETREAT_CLEAR_RANGE`. A player who
parked next to a wounded bot turned it off: 7 200 held ticks of 7 200, at every
tier. The fix was a third exit the *bot* controls — is the running working? —
measured as ground opened on the thing being run from.

**a0-107 — the same property, one level down.** That third exit was correct and
it fired. But it was gated behind two preconditions — a `THREAT_RANGE` contact
read and a positional "have I run out of road" test — and a read that failed
either one did not merely skip the fold, it **reset the patience clock**. Both
gates were things an opponent controls, so an opponent who kept either false on
any tick held the clock at zero forever. Park in the 260-unit annulus between
`THREAT_RANGE` (416) and `RETREAT_CLEAR_RANGE` (676) — too far to be measured,
too near to be escaped — and the retreat was unbounded again: 17 860 held ticks
of 18 000, against a hostile that never moved and never fired. The fix that
lands measures the two things a retreat can be doing (opening ground on the
threat; closing the road to its refuge), both of them the bot's own doing, with
no gate in front of either.

### What to take from it

1. **Audit the fix, not just the bug.** a0-105 was a correct fix that reinstated
   its own defect one level down, because the *guard* on the new exit was made
   of the same material as the old exits. When you add a way out, read every
   condition on the path to it and ask of each one: *can my opponent hold this
   false?* If yes, it is part of the latch, not part of the exit.
2. **A read that cannot be evaluated is not evidence that things are fine.**
   `resetStandoff` on the un-evaluable paths said "no measurement, therefore
   working". Holding — or better, *measuring something else* — is the honest
   reading. This is the single line that turns a bounded latch into an unbounded
   one, and it is easy to write by accident because resetting looks tidy.
3. **Widening a range does not close a band; it moves it.** Any exit gated on a
   *distance* has an annulus on the far side of that distance and inside
   whatever range the latch's own release uses. Gate on the **same predicate**
   the release uses, and no band can exist between them. (QA's a0-106 §5 argued
   this before the fix was written, and it was right.)
4. **Prefer a monotone measurement to a positional gate.** "Am I inside
   `ARRIVE_RADIUS`?" flaps, and every flap was a free clock reset. "What is the
   closest I have got?" cannot flap, because a best is only ever beaten — which
   also gives you the termination argument for free: there is only so much
   ground to open and only so much road to close.
5. **Bots cannot find this class of defect by playing each other.** Both
   instances arrived as a screenshot from a live match, because the match
   harness plays bot-vs-bot and bots play the game the way it is meant to be
   played. The instrument that *can* find them is
   `tests/adversarial/` (a0-106): one hostile that does a single deliberately
   unhelpful thing and holds it, crossed against every latch in the source, with
   a bound asserted on each. It found a0-107 on its first run, on the fix that
   had shipped the week before.

### The reproductions

| | |
|---|---|
| a0-105 | `evidence/a0-105-standoff/`, `tests/reports/a0-105-standoff.md` |
| a0-106 (the instrument, and the finding) | `tests/adversarial/`, `tests/reports/a0-106-adversarial.md` §5 |
| a0-107 | `evidence/a0-107-dead-band/`, `tests/reports/a0-107-dead-band.md` |

The standing gate is `tests/adversarial/latch-bounds.test.ts`. It fails on a
latch that runs forever and on a latch that runs long with the trigger up and
the ship parked, and its `KNOWN_UNBOUNDED` list is empty — which is the state it
should be found in.
