# g6-01 — two knobs that turn nothing

Branch: `agent/gameplay/g6-01-dead-tunables` · Owner: Gameplay Engineer

A working note, not evidence. The evidence is `docs/dead-tunables-g6-01.md`,
`tests/sim/aim-arc.test.ts`, `evidence/g6-01-dead-tunables/`, and the PR.

---

## BUILT

| Commit | What |
|---|---|
| `1183085` | **G-13 — `AUTO_AIM_ARC` made live.** `withinAimArc` in `step.ts` gates every acquisition candidate; `tests/sim/aim-arc.test.ts` (11 cases) |
| `1257fc9` | **G-14 — `SHIP_HULL` retired.** Constant deleted, allowlist entry dropped (the guard), GDD §2.8 row struck through, `upgrades.test.ts` comment corrected |
| *(this session)* | `docs/dead-tunables-g6-01.md` — both decisions + the sweep; `evidence/g6-01-dead-tunables/` — the sweep script and its output; this note |

## DECISIONS (and what was rejected)

**G-13 — LIVE, because §2.4 asks for the knob by name.** The GDD does not merely
state the 360°, it flags *the arc itself* `TUNABLE`: *"checked across the full
360° around the ship, no front-arc restriction (`TUNABLE`)"*. Deleting it would
also delete the only executable record of the rule — a0-19 said so explicitly
("do not delete it silently").

- **The gate is on CANDIDATES, not on the acquired target.** Filtering the winner
  would mean a narrowed arc makes a ship *hold fire* whenever the nearest target
  is behind it; filtering candidates means it engages the nearest one **inside**
  the arc, which is what §2.4's "nearest valid target" says. Rejected the
  one-line version for that reason.
- **`2π` short-circuits the gate before any arithmetic.** A target dead astern is
  a bearing of exactly π against a `cos(π)` threshold — one rounding bit decides
  it. The shipped path never evaluates the comparison, so the wiring cannot have
  moved the default. This is the brief's named failure mode and it is closed by
  construction, not by argument.
- **Dot product + `Math.sqrt`, no `atan2`.** Determinism: `sqrt` is IEEE-754
  correctly rounded, `atan2` is not specified to the last bit. Moot on the
  shipped path (short-circuited), which is the point — a QA agent turning the
  knob gets a deterministic sim, not a maybe.
- **Rejected: exporting the predicate so a test could call it.** That trades a
  dead constant for a test-only export — the same smell, one row down in the
  sweep. The spec re-binds the constant by mocking `src/sim/constants` and
  re-imports the sim instead, so every case runs the real `step()`.

**G-14 — RETIRED, because there is no base hull left in the design.** Hull is
absolute per class (§2.11: 35/50/55/70); `shipMaxHull` reads that row and
multiplies by the §2.5 ladder. `SHIP_HULL = 50` was a fourth copy of one
`SHIP_STATS` cell that nothing read.

- **Rejected: wiring it as a floor** (the `CARGO_BASE` pattern that lives 18
  lines below it in the same file). It would raise the Interceptor's 35 to 50 —
  a balance change wearing a wiring fix's clothes, which is the thing the brief
  forbids.
- **Rejected: leaving the allowlist entry.** Removing it *is* the guard: a
  re-introduced dead `SHIP_HULL` now fails `dark-matter:check` instead of landing
  pre-blessed. `AUTO_AIM_ARC`'s entry went too — it is live now, and a stale
  entry would silently re-bless it if the wiring were ever removed.
- **GDD §2.8's row is struck through** with the reason written in, per the
  `Sensor range` precedent the brief pointed at. **This is the one edit outside
  `src/sim/` that needs the Director's eye** — flagged at the top of the PR.
  `docs/gdd-conformance.md` is deliberately NOT edited: it is a0-19's dated audit,
  and its G-13/G-14 rows are a record of what was true then.

**Both probed red before being trusted.** Default arc → `π` fails four pins in
`aim-arc.test.ts`; re-appending a dead `SHIP_HULL` exits 1 on the gate. Both
probes reverted, tree clean.

## The sweep — what nobody had looked at

Mechanical, not by eye: every `export const`/`function` in `constants.ts` joined
against the dark-matter scan's reference counts
(`evidence/g6-01-dead-tunables/sweep.mjs`). **87 exported values · 70 flagged
`TUNABLE` · 15 with zero production references.** Detail and the ranking in
`docs/dead-tunables-g6-01.md` §3. Headline:

- **9 are live** — the module derives a live constant from them (`g5-01`'s trap;
  `prod:0` is not `dead`). Spot-verified, not assumed.
- **5 are superseded derivations** — `MINING_YIELD_PER_HIT`, `miningRate()`,
  `WAVE_ORE`, `homeFieldOre()`, `classWeaponDps`/`classCoreDps`. Computed values,
  so nobody can "turn" them; the G-13 trap does not apply. Reported, not acted on.
  Note `MINING_YIELD_PER_HIT` is **not** a free no-op to wire: it reassociates the
  multiply, so making it live moves ore yields in the last bits. QA's call.
- **1 more genuine dead knob: `WEDGE_SLIDE_SPEED` ⚠** — flagged `TUNABLE`, a
  hand-typed 52, and **three comments** (`constants.ts`, `step.ts`,
  `wedge-escape.test.ts`) say it gates the wedge-escape pin. It does not: `step.ts`
  never imports it, the pin is detected by anchor displacement
  (`WEDGE_ESCAPE_PROGRESS`), and the kick clamps *up to* `WEDGE_SLIDE_KICK` rather
  than ramping to zero near anything. Its only reference is one spec's loose
  bound. Worse than G-13 — silent *and* documented as live. Not acted on: both
  forks touch protected ground (a new speed gate in ship physics, or rewriting the
  wedge prose in two files). **Wants its own brief.**

## NEXT

- Push the branch, open the PR, and flag the **GDD §2.8 amendment** for the
  Director in the PR body.
- Not blockers, other people's calls: `WEDGE_SLIDE_SPEED` (a brief of its own,
  §3.3 of the doc) and the five superseded derivations (§3.2). `a0-19`'s audit
  rows G-13/G-14 still read PARTIAL — updating that audit is its author's call,
  not mine.

## If you are resuming this branch

Re-run the sweep before believing any count in the doc; it is one command and it
is the point. Do **not** "fix" `withinAimArc` by moving the check onto the
acquired target, and do not remove the `2π` short-circuit in the name of tidiness
— both are load-bearing, and `aim-arc.test.ts` will tell you so.
