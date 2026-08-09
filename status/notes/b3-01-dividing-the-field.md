# b3-01-dividing-the-field.md — working notes (bots)

Branch: `agent/bots/b3-01-dividing-the-field` · Plan: `docs/team-bots-plan.md` Stage 3
Predecessors: `b1-01` (Stage 1), `a0-10` (Stage 2), `b2-03` (join-the-assault) — all merged.
Successor: Stage 4 (focus fire + role split) — **not started, deliberately.**

## BUILT

Three commits, all on the branch.

- **`cc4ccb8` — the behaviour.** Both of Stage 3's mechanisms, both inside
  mining-site selection, neither anywhere near the priority ladder.
  1. **Ally-proximity discount** — `allyCrowding` in `src/bots/targeting.ts`,
     multiplied into `bestRock`'s score beside `pathClearance`. Reach is
     `view.perception.visualRange` (derived, not a constant); `ALLY_CROWD_PENALTY
     = 4`; `greed` leans it via `crowdLean = 1.5 - greed`.
  2. **`claim` callout** — `'claim'` on `CalloutKind`, a `key` field on `Callout`
     (optional on the draft, normalised to `NO_KEY` on the record, so no existing
     caller changed and no foreign file was touched). `callClaim` in
     `behaviors.ts` sends from `mine()` **only on a change of site**;
     `foldAllyClaims` in `targeting.ts` folds heard claims into `Brain.tabu`.
     `CLAIM_TABU_SECONDS = 10`, anchored at the sender's `seenAt`.
  - Plumbing: `Brain.mineSiteAt` (when I committed to my site) — the dead-heat
    tie-break.
- **`986ca86` — four fixtures Stage 3 moved, and one that was never true.** See
  DECISIONS; each is recorded at length in the file it lives in.
- **`164832a` — `src/bots/field-division.test.ts` (20 cases) + the rig.**

DoD at `164832a`: `npx tsc --noEmit` clean; `npm test -- --run` — **269 files,
4712 tests, 0 failed.**

## THE MEASUREMENT (the brief's actual ask)

**§1.6's 434 does not reproduce, and that is finding zero.** The spike that
produced it (`spikes/team-bots/measure-team-gaps.ts`) still runs. Same
instrument, same seeds, three arms:

| 2v2, §1.6's own instrument | mean ally apart | within one visual range | foe control |
|---|---|---|---|
| §1.6 as published (2026-08-05) | **434** | 79.3% | 1042 |
| today's `origin/main` (branch absent) | **692** | 55.2% | 784 |
| this branch | **726** | 50.0% | 784 |

The gap closed on its own between the spike and now — p16-01 and Stages 1–2
stopped bots chasing, fleeing and besieging their own teammates, so they stopped
converging on each other. The spike also built its world with **no `abundance`
and no `mapId`**, so its numbers are `standard`-abundance ones while the lobby
ships `scarce`; under `scarce` at today's main the figure is 578–599.

**So separation was the wrong headline, and the surviving finding is the ratio.**
Allied pairs commit to the *same rock* about **twice as often** as enemy pairs do
on the same board in the same match — and that is what Stage 3 moves. From
`evidence/b3-01-dividing-the-field*.json`, two disjoint 8-seed sets, `scarce`
abundance on `octagon`, full matches, shipped cast:

| 2v2 | branch absent | this branch |
|---|---|---|
| ally pairs on the same rock | 12.5% / 12.0% | **8.0% / 8.4%** |
| foe pairs on the same rock (control) | 6.1% / 7.1% | 7.2% / 7.4% |
| **ally : foe ratio** | **2.0× / 1.7×** | **1.1× / 1.1×** |
| ore mined per side | 108.4 / 116.1 | **118.1 / 118.8** |
| ore per side-minute | 7.86 / 8.35 | **8.41 / 8.61** |
| mean ally separation | 577.9 / 599.1 | 588.0 / 610.1 |

4v4 same direction: same-rock 15.2% / 13.4% → 8.3% / 7.5%.

**Both FFA arms are byte-identical between the two builds** — every figure, both
sizes, both seed sets. That is the strongest form of plan §2.5's guard and it
came for free from the structure.

## DECISIONS

- **The crowd reach is `visualRange`, and it is not a constant.** Swept 450 /
  720 / 1000 × penalty 2 / 4 × claim-hold 10 / 20, on two disjoint 8-seed sets.
  Every arm divides the field; only **720/4** raises both ore per side and ore
  per side-minute on *both* sets — the others each win one set and lose the
  other, which is the signature of a number fitted to eight seeds. And 720 *is*
  `visualRange`, which is also the only reach the mechanism can honestly have
  (an ally further off is not in `view.ships`). **The sweep was run twice on
  disjoint seeds rather than once on sixteen** precisely so a held-out set could
  falsify an over-fit.
- **Deference is strictly ordered by distance** (`d >= rock.distance` skips).
  This is why plan §4.3's named risk — two allies each politely deferring until
  neither mines the good rock — is *unreachable* rather than unlikely.
- **A dead heat over one rock moves nobody.** Two bots committing on the same
  tick is common; if both deferred they would leave a good rock together and
  contest the next one together. Strictly-earlier-wins via `Brain.mineSiteAt`
  against the claim's `seenAt`, so an exact tie is today's behaviour and
  therefore never worse. No slot-order bias, so no `tiebreakKey` needed.
- **No `claimHonour` dial, and `chatter` still not added.** §4.5's tier row
  ("Easy often ignores a claim, Hard always") falls straight out of the Stage 2
  dials: Easy misses 35%, hears 1.2 s late, expires on a 6 s memory at a hearsay
  discount → honours for ~3 s if at all; Hard → 10 s. A probability knob would
  also have needed a per-claim RNG draw and therefore dedup state to stop it
  re-rolling every decision. `greed` leans both mechanisms, per §4.5's
  "reuse before invention". **Rejected**, same as a0-10 rejected `chatter`.
- **The claim fold is anchored at `seenAt`, not `now`.** That makes it
  idempotent (no "have I handled this one?" state) and it is plan Trap 3: stamp
  it the other way and a stale rumour becomes fresh intelligence every time it
  is re-read.
- **One call per *errand*, not per decision.** `Brain.lastCallAt` is one voice
  shared across kinds, so a claim sent every decision would sit on the mouth a
  teammate needs for `help`. Sending only on a change of site bounds it
  naturally and is also the honest semantics.
- **`Callout.key` is optional on the draft, required on the record.** A required
  draft field would have forced edits to `tests/server/room-radio.test.ts`,
  which is netcode's file, for no gain.
- **Stage 4 stayed out.** No focus fire, no role split, no `tiebreakKey`-derived
  roster assignment. a0-10's argument holds: that is different machinery.

### The four red fixtures — none of them a Stage 3 defect

- **`teams-hostility`: moved from the pick to the term, and sharpened.** It read
  "an ally on the corridor leaves the pick alone; a foe there costs the site the
  pick". With the crowd reach at one visual range, **any ship strictly on my
  approach to a rock I can see is necessarily nearer to that rock than I am and
  inside that reach** — "on my path to that rock" and "competing with me for
  that rock" are the same set of ships, so an outcome assertion cannot separate
  them. `pathClearance` and `allyCrowding` are now exported and read directly:
  an ally contributes *nothing* to clearance, a foe *nothing* to crowding. Same
  precedent as `TargetScore` carrying its three terms beside its total.
- **`ally-defence`'s economy A/B was single-seed.** Two builds do not make the
  same match with a small difference; they make different matches (the ratio
  spans 0.44–1.32 seed to seed on untouched code). Pooled over eight seeds it
  reads **87%** of the control's ore, against **71%** for the same pooling at
  `origin/main` — Stage 3 is an improvement here and seed 31 passed the old
  line by luck in the other direction. Sixteen 240 s runs cost ~1 s.
- **`ally-assault` asserted a duty-cycle bound that is not a bound** — see the
  handed-back defect below.
- **`team-winning`'s sampling window is seed-bimodal.** Seeds 1–16 were scanned
  rather than the next number tried: 1/3/14 give under 130 ticks, 5/8/11 give
  over 21 000. Seed 11 → 24 362 ticks, every asserted quantity two orders of
  magnitude clear. No assertion relaxed.

## HANDED BACK — a real defect, deliberately not fixed here

**`ASSAULT_JOIN_COOLDOWN`'s duty cycle has no floor when the joiner dies.**
`MAX / (MAX + COOLDOWN)` = 36% assumes a join always ends by *completing*, which
is what starts the cooldown (`ally.ts` `complete`). A join that ends because the
bot **died** does not: `context()` calls `releaseAllyResponse`, which drops the
target while keeping a `readyAt` that may be long expired — so a bot that keeps
dying at an enemy's doorstep re-commits immediately, every time.

Measured **at `origin/main`** (quoted from the other build on purpose — b3-01
changes nothing here), 8 seeds of `ally-assault`'s own fixture: forced join share
**mean 0.42, max 0.59**, above the "bound" on six of eight. Seed 31 reads 0.19
and is the only reason that line was ever green. Latch-committed share (read off
`Brain.allyAssault.target`) is worse: mean 0.49, max 0.69.

This is b2-03's latch, not Stage 3's, and the fix — charging a cooldown on a
death that interrupts a commitment — is a budget change that wants its own
measurement. Flagged in the PR; not fixed inside a mining-site PR.

## NEXT

- **Nothing outstanding in Stage 3.**
- **For the Director:** plan Q5 asked whether Stage 3 is the pause point. Stage 4
  is untouched and the chain is clean here.
- **For QA:** the ally:foe same-rock ratio (now ~1.1×) is the standing number;
  `src/bots/field-division.test.ts`'s last case guards it as a ratio against the
  in-match enemy control, so it survives a change to rock supply, map or cast.
- **For whoever picks up the assault latch:** the handed-back defect above.
- **A note for the plan's next reader:** §1.6's numbers are `standard`-abundance
  and pre-p16-01. Anything quoting 434 / 79.3% / 1042 should be re-run before it
  is used to justify work.
