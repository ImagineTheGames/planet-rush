# content/codex

Player-facing lore/reference entries for Planet Rush, regenerated against the
current design contract (**GDD.md v0.7**, `src/sim/constants.ts`,
`style-guide.md`). Ported and re-based from the Assignment-4 codex pipeline,
whose 26 entries were written against GDD v0.4 and had gone stale (beams not
projectiles, planets not stations, a held repair channel, no fog/radar).

## Files

| File | What it covers |
|---|---|
| `codex-objective.json` | **What winning is** — the win condition and how a match ends. The codex's first section (a0-34). |
| `codex-bots.json` | The seven bots as characters — name, difficulty tier, hull, play style. |
| `codex-ships.json` | The four hulls by lobby name, roles, and the rock-paper-scissors. |
| `codex-systems.json` | How the game works. **Its numbers are machine-checked** (see below). |
| `codex-strategy.json` | How to actually win — triangle, siege, scouting, wrecks, the clock. |
| `pipeline/spec.md` | Generation spec: sources of truth, entry schema, file envelope. |
| `pipeline/critic-rules.md` | v0.7 reject rules; the 3-loop cap and the tone-pin, both binding. |
| `pipeline/tone.md` | The pinned GDD §4.7 tone paragraph, injected into every generation. |

## The anti-drift lock

Every numeric claim in `codex-systems.json` and `codex-ships.json` that names a
tunable carries a `facts[]` entry pointing at a constant in
`src/sim/constants.ts`:

```json
{ "label": "Core HP restored per tap", "value": 15, "unit": "HP", "constant": "REPAIR_HP_PER_ORE" }
```

`tests/codex/codex-constants.test.ts` imports the live constants module and fails
the build on any mismatch — so a codex number can never silently drift from the
sim it describes. The `constant` field is a dotted path
(`TURRET.cost`, `SHIP_STATS.hauler.cargo`, `DEPOSIT.drainRate`).

Regenerate by editing the JSONs against `pipeline/spec.md` + `pipeline/critic-rules.md`
and running `npm test -- --run`.
