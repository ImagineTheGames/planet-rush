# Codex critic rules — v0.7 truths

Ported from the Assignment-4 codex pipeline
(`X:/MultiAgentCourse_July2026/planet-rush-codex-pipeline`) and **re-based on the
current GDD.md (v0.7)**. The pipeline's 26 entries were written against GDD v0.4;
the game moved out from under them. These rules are what a critic pass rejects on.

## Binding process rules (both from the pipeline, both mandatory here)

1. **Revise until clean, capped at 3 critic loops.** The assignment shipped two
   unresolved *major* findings by scope choice. Game content does not: an entry
   is regenerated against critic notes up to three times; anything still carrying
   a major after loop 3 is *cut*, never shipped dirty. (Recorded per file in the
   `generated.critic_loops` field.)
2. **Pin the tone paragraph.** `pipeline/tone.md` (GDD §4.7) is injected verbatim
   into every generation and every critic prompt. Retrieval provably never finds
   it — do not rely on it being retrieved.

## Term contract (reject on any stale term)

The lore pivot (GDD §0) is fiction-only, but the codex is player-facing fiction,
so it uses the **new fiction terms**, while the mechanics/numbers are unchanged:

| Say this | Never say |
|---|---|
| mining **station** (a home) | planet |
| the station **core** / reactor | (core is fine; "planet core" is not) |
| the **collection field** (deposit radius) | atmosphere-as-lore *(term is fine mechanically; prefer "collection field")* |
| **projectile** / shot / weapon fire | beam, laser, mining laser, hitscan ray |
| **repair reactor** — a discrete tap | repair channel, repair beam |
| ore **surge** / asteroid wave | — |
| the collapse / **"the Crush"** | — |

## v0.7 fact rules (reject on any v0.4 survival)

- **REPAIR is discrete, not a channel.** 1 ore restores **15 core HP**, resolved
  in full instantly, then the station is on a **15-second cooldown** (per
  station, not per player). Repairs the station **core only**, never a ship hull.
  - REJECT the v0.4 facts: "2 HP per second", "1 ore per 5 HP", "channel you hold",
    "interruptible repair", "repair your ship."
- **Combat is projectiles, not beams.** Every shot travels and can be dodged; one
  weapon chips a rock or bites a hull, whichever the shot reaches first. No beam,
  no laser, no hitscan.
- **Homes are MINING STATIONS**, sited on a contested claim. Not planets.
- **No boost, no ping.** The action vocabulary is six verbs. Both were cut.
- **Fog of war is real.** Enemy station HP is scouted, not broadcast; a buildable
  **radar satellite** widens minimap coverage and can be attacked.
- **Ore is conserved exactly** and abundance is a per-match setting
  (scarce / standard / rich).

## Numeric-claim rule (enforced by test)

Every numeric claim in `codex-systems.json` that names a tunable **carries a
`facts[]` entry** with a `constant` pointer into `src/sim/constants.ts`. The test
`tests/codex/codex-constants.test.ts` parses both and fails the build on any
mismatch — so a codex number can never silently drift from the sim.
