# a0-13 — amend the progression plan, and emit its brief chain

Branch: `agent/architect/a0-13-progression-amend-and-chain`
Working note. Not evidence — the DoD, the PR and QA attestation are the record.

---

## BUILT

| commit | what |
|---|---|
| `6badfd2` | `spikes/progression/measure-ratified-xp.ts` + `measured-a0-13.txt`; repaired `measure-xp.ts` |
| `5ad5102` | `docs/progression-plan.md` — six ratifications folded in, re-measured, re-cut, §6 and §7 new |
| `545c149` | `docs/briefs/pr-01 … pr-08` + `README.md` — the chain with `needs:` edges |

**The spike (`6badfd2`).** s4 could not price the ratified weights: its "kills" were a
match-wide ship-death count ÷ N, and harness strategies have no difficulty tier. So
`measure-ratified-xp.ts` runs the **real shipped bot cast** (`createBots` / `runHeadlessMatch`)
in four lobbies by tier, 12 seeds, 48 matches, all ended — and reconstructs damage/kill
attribution with a **shadow attributor** (consumed projectiles matched against entities that
lost HP; `Projectile.owner` already exists because a shot must not hit its own fleet). Nothing
in `src/` is patched. `recon*` ≥ 95% everywhere is the honesty check.

Also: `measure-xp.ts` had not run since `world.planets` became `world.stations`. The plan's own
reproduce line was broken for its whole life. Repaired; its numbers re-reproduce within ~1%
except the round-robin median (597 → 619), noted in the doc rather than silently re-typed.

**The amendment (`5ad5102`).** Every s4 question answered, dated, folded into the section it
changes (LESSONS §17 — not an appendix). New: §1.3a (the ratified weights re-measured), §1.3b
(the opponent multiplier), §1.3c (three consequences), §1.3d (the economy in one table), §1.5
(the hook, sized, with five attribution traps), §6 (the summary as a beat), §7 (the chain).

**The chain (`545c149`).** Eight briefs. Each has the test to write first, its traps, its own
DoD and evidence line, and names the open question it is exposed to plus the default it ships
under if nobody answers.

## DECISIONS

**The unit question is the finding the brief did not anticipate.** "Damage dealt 2×" has no
denominator, and the denominator decides everything. Measured: at a literal 1 HP, damage is
**94%** of all XP and stations destroyed — the 10× row — is **0%**. The developer's own ordering
is inverted by the reading nobody would have questioned. Recommended `DAMAGE_HP_PER_UNIT = 25`
(combat 42% / ore 17%), and it is Question B.

**The Crush kills the stations, not the players.** 100% of station deaths in an Easy bot lobby
and 98% in a Medium one were the collapse phase; Hard is 11%. So the highest-weighted row is
unearnable against soft opposition. Rejected: estimating it, or crediting "whoever was nearby."
A stat with no attacker shows `—`. Question C.

**The four weights alone delete s4's participation floor.** s4's headline was a 1.1–1.7×
winner:first-out spread — "a player who loses their first eight matches still climbs." Under the
ratified four alone that becomes **0.3× in an Easy lobby**: the first player knocked out
out-earns the winner, because a turtle who wins by outlasting deals no damage and kills nobody.
Recommended: keep s4's non-combat rows (they are already denominated in the same 1-XP-per-ore
base the developer ratified, and they are all free world deltas). Question A. **This is also
what saves the level curve** — `base=300` lands level 2 at 0.8 matches with them and 2.0
without, so "ok" to the curve and "drop the rows" are not jointly satisfiable.

**The farm is real but it is not the Hard-bot farm the brief expected.** Measured, the fastest
XP/min in the game is a **Medium** lobby (17), not Hard (12): Medium bots fight and die
constantly (24 deaths per player per match). Written up as a property of the bot trees that will
move whenever they are touched — not as a property of the multiplier. Question E.

**Rejected: writing the "reduced motion is already respected" line as given.** The brief says the
client already honours `prefers-reduced-motion`. It does not — grep over `src/`, `index.html`,
`public/` and the style guide returns nothing. `reduceVfx` is a frame-rate reducer, not a motion
preference. So pr-05 **builds** the seam (on `platform.ts`), and that is stated as scope nobody
costed rather than assumed away.

**Rejected: a tree.** *"whats this tree thing?"* is a signal about the document. With
cosmetic-only ratified there is nothing to choose between, so a **level → unlock list** is the
structure, and `points` drops out of the profile shape. The three tree shapes are kept as
superseded reasoning in case §3 is ever revisited. **No unlock content designed**, per the brief.

**Consequence nobody had written down: s4's persistent HUD XP bar is cancelled.** The visibility
ruling is *level yes, XP never, lobby only*. An XP bar on the HUD is both of the things that
forbids. Named as a cancellation in §5 rather than left quietly missing, and asserted as an
**absence** in pr-06.

**Kill hook promoted to Phase 1**, as briefed — but the sizing found the bigger half: kills at
least leave a mark in `match.eliminated`; **damage dealt leaves nothing at all**. So the hook has
to carry both or the 2× weight is unpayable.

## NEXT

Nothing outstanding for this branch. Open for the Director / developer:

- **Five questions** at the foot of `docs/progression-plan.md` (A: the participation rows ·
  B: the damage unit · C: the Crush-killed station · D: opponent-LEVEL scaling · E: the bot farm).
  **None blocks pr-01, pr-02 or pr-03**, which are claimable today.
- **pr-02 is the long pole** — the only `src/sim/` change in the chain, and pr-04, pr-05 and
  pr-08 all wait on it.
- **pr-07 is gated on a0-01** landing its bank re-voice.
- Nothing in `src/` changed in this PR, by design.
