# Codex generation spec

Regenerates the four Planet Rush codex files from the current design contract
(GDD.md v0.7, `src/sim/constants.ts`, `style-guide.md`). Ports the Assignment-4
pipeline's structure; updates every fact to v0.7 (see `critic-rules.md`).

## Source of truth

| Content | Source |
|---|---|
| Fiction, terms, rules | `GDD.md` (v0.7) — sections cited per entry |
| Every tunable number | `src/sim/constants.ts` (imported by the validation test) |
| Voice / tone | `pipeline/tone.md` (pinned GDD §4.7) |
| Reject rules | `pipeline/critic-rules.md` |

## The four codex files

- **codex-bots.json** — the seven bots as characters: name, difficulty tier, the
  hull they fly (as the lobby names it), and how they play the triangle.
- **codex-ships.json** — the four hulls, by lobby name (class + hull name), roles,
  and the rock-paper-scissors around the triangle.
- **codex-systems.json** — how the game works: mining, banking, repair, turrets,
  shields, upgrades, waves/collapse, fog/radar, death/debris, the economy. **This
  is the only file whose numbers are machine-checked** (`facts[]`, below).
- **codex-strategy.json** — how to actually win: the triangle, siege, scouting,
  wrecks, the clock.

## Entry schema

```jsonc
{
  "id": "sys-repair-reactor",        // stable kebab id, prefix by codex
  "title": "The Repair Reactor",
  "category": "systems",             // bots | ships | systems | strategy
  "summary": "one-sentence hook",
  "body": "prose in v0.7 terms and the pinned tone",
  "tags": ["repair", "economy"],
  "see_also": ["sys-ore-economy"],
  "facts": [                          // systems + ships only; machine-checked
    { "label": "Restore per tap", "value": 15, "unit": "HP", "constant": "REPAIR_HP_PER_ORE" }
  ]
}
```

`constant` is a dotted path resolved against `src/sim/constants.ts` exports —
`REPAIR_HP_PER_ORE`, `TURRET.cost`, `SHIP_STATS.hauler.cargo`, `DEPOSIT.drainRate`.
The validation test fails the build if any `value` disagrees with its constant.

## File envelope

```jsonc
{
  "codex": "systems",
  "title": "…",
  "gddVersion": "0.7",
  "generated": { "against": "GDD.md v0.7", "critic_loops": 3, "tone_pinned": true },
  "entries": [ … ]
}
```
