# p15-02 — "bots don't repair or rebuild", measured

**Owner:** Bot Engineer · **Branch:** `agent/bots/p15-bot-repair-rebuild` · **2026-08-05**

The developer's report is two claims. Driven through the bot harness on unstaged
matches, one reproduced and one did not, and neither had the cause the brief's
reconstruction expected. This file is the evidence; the fix is in `src/bots/`.

Everything below is a real match: eight bots, the shipped cast and constants,
`createWorld` → `botInputs` → `step` to the match's own ending. Nothing is placed
by hand.

---

## 1. Repair — reproduced

**Seed 1, eight bots, 791 seconds: nine repair orders in the whole match.** Six of
the eight reactors died with damage on them that was never patched. Two sat
visibly damaged for most of the match and never spent an ore on it — Rusty at
89/100 from t=90 to t=420, Foreman at 88/100 for over 600 seconds, both with ore
in the bank the entire time.

Every decision taken with a damaged reactor, by what stopped the repair:

| blocker | share | what it means |
|---|---:|---|
| the ration said no | 63.8% | reactor damaged but above the character's threshold — the ration doing its job |
| **not docked** | **21.8%** | **the bot wanted the patch and was somewhere else** |
| collapse | 5.2% | repair is off for good (GDD §2.3) |
| under fire | 4.5% | a siege cannot be out-repaired (GDD §2.6) |
| cooling down / tell held | 4.2% | the sim's 15-second lockout, or its pacing tell |
| cannot afford | 0.5% | |
| **bought one** | **0.03%** | |

The 21.8% row is the defect. The trees had **no verb for going home to spend** — a
bot only ever repaired when it happened to be docked for some other reason (a full
hold, an answered alarm). Warden alone spent ~286 seconds of that match carrying
the ore for a turret it never went home to build.

The brief asked whether repair orders were being *dropped* by the sim. At seed 1,
none were — but only because the bots so rarely got home to file one. See §3.

### Not the ration

The ration (`repairTargetFraction`) is the largest single blocker and it is
**deliberately untouched**. It exists because a discrete repair that tops a reactor
to exactly `maxCoreHp` puts every funded defender on one identical HP at collapse,
and the field then dies in lockstep with no survivor to crown (p5-repair-discrete,
`src/bots/trees.test.ts`). Widening it is a design change, not a fix — **raised to
the Director in the PR**, with the number: it is still 80.9% of damaged-reactor
decisions after this branch, i.e. reactors sitting at 88/100 for ten minutes
because no character's threshold reaches that high. That may be correct. It is not
this branch's call.

---

## 2. Rebuild — refuted for turrets and shields, confirmed for the satellite

Build and rebuild are one question in these trees: "I want two turrets and I have
one" reads the same whether the second was never built or was shot off ten seconds
ago, so the tier target gate *is* the rebuild path. Over the same seed-1 match:

| bot | turrets lost | turrets ordered |
|---|---:|---:|
| Warden | 7 | 7 |
| Rusty (slot 0) | 3 | 3 |
| Foreman | 3 | 3 |
| Vulture | 3 | 3 |
| Sable | 0 | 2 |

Turret and shield replacement was already working. **"Bots never rebuild" is
refuted, and the code wins.**

What was genuinely absent: **the radar satellite**. `satellite` appeared nowhere in
`src/bots` — zero satellite orders in any match, at any tier — so no bot had ever
built one, and a structure never built is a structure never replaced.

And under both: the trees counted queued construction with the kind-agnostic
`station.builds`, so a shield fifteen seconds from done read as a turret already on
order. A latent stall, now counted per kind, matching how `sim/buildings.ts` counts
its own caps.

---

## 3. The cooldown seam, and why it was invisible

Repair got a 15-second per-station lockout on 2026-07-28 (`station.repairGate`,
`placeOrder` → `'cooling-down'`). No tree read it. They paced off
`station.repairing` — the *tell*, which the sim releases at `REPAIR_TELL_HOLD`,
half the lockout.

At seed 1 pre-fix this cost nothing measurable, because bots repaired nine times in
791 seconds. Once the home errand puts them at the wheel it costs a great deal.
Measured over seeds 1–5, with the errand in and the cooldown read backed out:

| | landed repairs | **dropped orders** |
|---|---:|---:|
| errand + cooldown read (shipped) | **51** | **0** |
| errand, tell-only gate (pre-fix logic) | 43 | **728** |

Fewer landed, not just more wasted: repair sits at the head of the spend plan, so a
head that keeps returning a refused press never reaches the turret and shield buys
queued behind it.

---

## 4. What shipped, measured

Seeds 1–5, five whole eight-bot matches, before → after:

| | before | after |
|---|---:|---:|
| repair purchases the sim accepted | 21 | **51** |
| reactor HP bought back | 315 | **765** |
| turret orders | 124 | 123 |
| satellite orders | 0 | **4** |
| match length | 791–840 s | 810–838 s |
| station-time spent damaged | 85.9% | 83.1% |

Turret orders unchanged is the point, not a miss: that path was not broken.

Locked by `src/bots/repair-honesty.test.ts` and `src/bots/rebuild.test.ts`.

---

## 5. Two things the Director should look at

1. **The ration.** §1 above. Should a bot's reactor sit at 88/100 for ten minutes?
   The threshold that produces that is `EASY_REPAIR_AT` / `MEDIUM_REPAIR_AT` /
   `HARD_REPAIR_AT` leaned by `caution` and capped below the ceiling. Raising it is
   a one-line change and a balance question; this branch did not make it.

2. **The satellite buys a bot nothing.** A live radar satellite lifts the *minimap*
   fog (`sim/sensing.ts`), and `BotView` does not read the sensed set — so a bot
   that builds one gets no vision it did not already have. Warden buys one anyway
   (6 ore, after its guns and bubble) so that the structure exists on a board a
   human can hunt, which `sim/constants.ts` calls "a legitimate strategy", and so
   the rebuild path has something to rebuild. The honest fix is to feed a
   satellite's coverage into `BotView` — a human in that cockpit genuinely does see
   more, so it is fog-honest rather than a cheat — but that is a perception change
   with a real cheat surface and it belongs in its own brief, not smuggled into
   this one.

---

## Appendix — a note on `tests/harness/player-aggression.test.ts`

That file carries a standing A/B on the un-shipped HARD `aggression` raise. The
home errand moves it: placing `fix-base` above `attack` in the Hard tree, or giving
Hard the structural half of the errand at all, turns an all-Hard cast inward far
enough to flip the finding. Both narrowings in `./hard` are therefore load-bearing
and are commented as such. QA's gate passes as shipped; if a later tuning pass
wants Hard to run the full errand, §3 of `docs/bot-player-aggression-p15.md` needs
re-measuring first.
