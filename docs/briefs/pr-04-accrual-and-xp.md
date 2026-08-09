# pr-04 — what a match earned: the observer and the weight table

**Owner:** UI Engineer · **needs: pr-02** (the credit ledger), **pr-03** (the curve)
**Plan:** `docs/progression-plan.md` §1.1, §1.3a–d · **Blocks:** pr-05, pr-08

---

## The ask

Turn one finished match into one number, plus the rows that explain it.

```ts
// src/progression/accrual.ts (new) — read-only over the world, per tick.
export interface MatchAccrual {
  oreMined: number;      // Σ +Δ ship.cargo   — mined AND scavenged (GDD §2.7, "ore is ore")
  oreBanked: number;     // Σ +Δ ship.banked
  oreUsed: number;       // Σ −Δ (cargo+banked) while alive — a purchase, not a death drop
  distance: number;      // Σ |Δ pos|, respawn teleports filtered
  shipsUsed: number;     // own deaths + 1
  structures: number;    // distinct BuildJob ids ordered
  upgrades: number;      // Σ +Δ Σ ship.tiers
  repairs: number;       // Σ +Δ station.coreHp ÷ REPAIR_HP_PER_ORE
  wavesSurvived: number;
  placement: number;     // 1 = winner … n = first out
  slots: number;         // ADDED by the build — see (1) below
  won: boolean;
  seconds: number;
  // from pr-02's ledger, bucketed by the OPPONENT's difficulty tier:  — see (2)
  damageDealt: Record<Difficulty, number>;   // HP
  shipKills: Record<Difficulty, number>;
  stationKills: Record<Difficulty, number>;
}

// src/progression/xp.ts (new) — the §1.3d table, every number TUNABLE.
export function xpForMatch(a: MatchAccrual): { total: number; rows: XpRow[] };
```

### The economy, from §1.3d — type these numbers, do not re-derive them

| Row | XP | × opponent tier? |
|---|---|---|
| Ore mined | **1 / ore** | no |
| Damage dealt | **2 / 25 HP** (`DAMAGE_HP_PER_UNIT = 25`) | **yes** |
| Ship destroyed | **5** | **yes** |
| Station destroyed | **10** | **yes** |
| Ore banked | 2 / ore | no |
| Structure ordered | 12 | no |
| Ship upgrade bought | 20 / tier | no |
| Reactor patched | 3 | no |
| Wave survived | 15 | no |
| Placement | 20 / rung | no |
| Match won | 200 | no |

Tier multiplier: **Easy ×0.75 · Medium ×1.0 · Hard ×1.25 · human ×1.25**, from
`PERSONALITIES[id].difficulty` — local, deterministic, and impossible to spoof because nothing
about a bot's difficulty arrives over a wire. Rows 1–4 are the developer's, verbatim; rows 5–11
are s4's and are **Question A**.

**A human counts as Hard by decision, not by measurement** — a human is not reliably harder than
Warden. They are scored at the top tier because *contesting a person is the point of the mode*.
Put that sentence in the code comment beside the constant, or it gets "corrected" in six weeks.

## Test first

1. **A scripted fixture match** — mine, bank, build, upgrade, repair, die once, place 3rd —
   yields exactly the expected counts in every free field.
2. **The ledger fields are read, not recomputed.** Damage and kills come from pr-02's
   `CombatCredit`; the observer must not attempt its own attribution. (A spike did that once,
   at 60 Hz over a full world diff — see `spikes/progression/measure-ratified-xp.ts` — and it is
   exactly what does not belong in the client.)
3. **The multiplier applies to three rows and to no others.** A lobby of Easy bots and a lobby of
   Hard bots with identical accrual differ **only** in the damage/ship/station rows. Ore mined is
   never multiplied — it has no opponent.
4. **Respawns are not travel.** A death-and-respawn does not add the distance from the wreck to
   the home station.
5. **Death is not a purchase.** The half-hold sink at a ship death does not appear in `oreUsed`.
6. **Determinism of the total.** The same finished world produces the same XP total on every
   run — no `Date.now()`, no iteration-order dependence.
7. **Online, the authoritative world is observed.** A fixture with a mispredicted-then-reconciled
   tick counts each unit of ore exactly once.

## Traps

- **Observe the SERVER's world online, never the predicted local one.** A mispredicted tick that
  is later corrected double-counts everything positive. This is the single most likely bug in
  this brief.
- **"Ore mined" includes scavenged**, and that is deliberate: the sim does not tag a chunk with
  where it came from, and paying scavenged ore less would make Vulture — the wreck scavenger —
  the worst-paid character in the game. §1.1 says so; do not "fix" it.
- **`station.*`, not `planet.*`.** The lore pivot renamed the field; s4's tables still say
  `planet`.
- **Read-only over the world.** This module may not mutate a single field, and the sim may never
  read it back (GDD §4.8).
- **Do not write the profile here.** pr-05 owns the one write site, at teardown.

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "git ls-files src/progression/accrual.ts src/progression/xp.ts | wc -l | grep -q '^2$'"
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

## Evidence line

One real headless match's `MatchAccrual` and its XP rows, printed in the PR body, beside the
same match's numbers from `spikes/progression/measured-a0-13.txt` — they should be the same
shape and the same order of magnitude. Where they differ, say why.

## Amended by the build *(p1-04, 2026-08-09 — the plan wins where the two disagree)*

Three places where this brief and the shipped tree disagreed. All three are recorded in the PR.

1. **`MatchAccrual` gained `slots` (and `slot`).** The sketch above carries `placement` but not
   the lobby size, and the placement row is priced at **20 / rung** (§1.3d) — a rung is a player
   you outlasted, so the row cannot be priced without `n`. `slot` comes free with it: the observer
   tallies every seat, because QA's re-baseline (pr-08) wants the whole lobby, not one player.

2. **"from pr-02's ledger, bucketed by the OPPONENT's difficulty tier" is not something pr-02's
   ledger can hand over.** As shipped, `CombatCredit.dealtToShips` / `dealtToStations` /
   `shipKills` / `stationKills` are **one number per ATTACKER slot** — there is no victim
   dimension anywhere in them, so a per-tier bucket cannot be read out directly. What the ledger
   *does* carry is `lastDamageAt[victim][attacker]` (the per-pair clock) and `lastHitBy[victim]`
   (the killing blow), and the observer buckets by reading those: an attacker's damage in an
   observation window is charged to exactly the victims the ledger says they hit in that window.
   Fed every tick — or every authoritative snapshot — that is exact. It is still a **read of the
   ledger**, never the shadow attributor this brief rightly forbids (test 2); the fallbacks for a
   coarse window are named in the module header. **A victim-bucketed damage row on the ledger
   itself would make this exact in every case; that is a `src/sim/` change for the Gameplay lane
   to weigh, and this lane may not make it.**

3. **Test 7 is met in the half a module can meet it.** "Observe the authoritative world" is a
   *wiring* rule, and the wiring is pr-05's. What ships here is what the observer can enforce
   alone: `observe()` is idempotent for the newest tick and **revisable** for it — a tick
   re-delivered with corrected content has its window rolled back before the correction is
   applied, and a world older than that is ignored rather than silently rewound. Pinned by the
   fixture in `accrual.test.ts`.

## Open questions this brief is exposed to

- **Question A — keep rows 5–11?** *Ships under the recommendation: keep them.* If the answer is
  no, delete those rows **and** re-tune `XP_CURVE_BASE` to 75 in the same PR, because `300` stops
  landing level 2 inside a first match (§1.4).
- **Question B — what is one unit of damage?** *Ships at 25 HP.* It is one constant; if the
  developer picks another, it is a one-line change and a re-run of pr-08.
