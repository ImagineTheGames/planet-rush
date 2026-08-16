# a0-63 — the explosion lab

Branch: `agent/art/a0-63-explosion-lab`. Owner: Art Agent.

**This brief produces a page, not a shipped effect.** Nothing in `src/` changed —
not one byte. The developer picks by id; a follow-up brief ports the winners.

## BUILT

- `tools/make-explosion-lab.ts` — the generator. Deterministic, standalone,
  `npx vite-node tools/make-explosion-lab.ts`.
- `docs/art-direction/explosion-lab.html` — the board. **This is the path that
  matters**: the studio dashboard's ART page lists `docs/art-direction/*.html`
  and nothing else, so a board in `assets/preview/` would be invisible there.
- `assets/preview/explosion-lab.html` — a byte-identical second copy, because
  that is where every earlier lab lives and the brief's DoD names it. Both are
  written from the same string by the same run, so they cannot drift.

19 candidates, 3 families, 114 frames, 498 KB, no external fetches, opens from
the file system.

| Family | ids |
|---|---|
| Ships | **A** Today · **B** Hard snap · **C** Break-up · **D** Fuel burn · **E** Compact · **F** Cold vent |
| Stations | **G** Today · **H** Deadweight · **I** Long settle · **J** Implosion · **K** Ash · **L** Departure *(labelled)* |
| Asteroids | **M** Today · **N** Dust bloom · **O** Grit · **P** Hang · **Q** Shell · **R** No ring · **S** Compact dust |

## DECISIONS

- **The game's own particle system, not a mock.** Real `ParticlePool`, real
  `PARTICLE` kinds in their `particleKind` colours, real `pool.update`. Today's
  three rows are the shipped `explosion()`, `stationDeath()` and
  `asteroidBurst()` imported and called, not re-typed. Every candidate is
  `pool.emit` + `ring()` and nothing else, so a pick is a tuning and not a
  rewrite.
- **World space is the viewBox.** Each frame's `viewBox` is world units, so
  scale is true by construction rather than by a conversion someone has to get
  right. Ships 300 units across, stations 640, asteroids 200 — the station frames
  look emptier because a station shockwave is 288 units wide.
- **`budget` / `between` / `spread` are copied, not imported.** They are
  module-private in `emitters.ts`. Exporting them for a tool would add three
  `src/` exports with no production caller — exactly what
  `npm run dark-matter:check` gates on in CI — so they are reproduced verbatim in
  the tool with a comment saying so. The port will use the originals.
- **The ship reference is 16 units, not the 12 the brief quotes.** `SHIP_RADIUS`
  is 16 and `field.ts` unpacks the explosion magnitude against
  `SHIP_RADIUS_REF = 16`; the 12 is stale (`make-laser-lab.ts` carries the same
  stale copy). True scale beats a quoted number, so the constant is imported.
- **The rock is drawn at radius 24, and that is not a taste.** The observer packs
  `rockBurst` magnitude as `radius / 24` clamped to 1 and the field unpacks it as
  `magnitude × 24`, so **24 is the radius every burst is drawn at today however
  big the rock was**. Rocks themselves run 22–46. Stated on the page.
- **The reference body is a ruler at 35%** (asteroids 20%, because rock dust is
  the same grey as rock and a brighter ghost is indistinguishable from the effect
  being reviewed). It is not claiming the ship is still standing.
- **Half the station family keeps the ratified stance.** G/H/I/J/K add no
  sparkle and vary weight and duration only; **L is a single labelled
  departure**, present so declining a firework is a decision rather than an
  omission (GDD §4.7, `stationDeath`'s own "deliberately not a firework").
- **Rejected: staged / multi-shot candidates.** A two-stage explosion (small
  failure, then the main event) would need the field to schedule a second
  emission, which no shipped emitter does — so it is not portable as a tuning and
  is not on the page.
- **Rejected: `<img>`/PNG filmstrips.** Inline SVG keeps the board diffable and
  regenerable, matching `svg.ts`'s reason for existing.
- **Size.** Particle looks and the three reference bodies are defined once in a
  hidden `<defs>` and `<use>`d; that took the file from 2.3 MB to 498 KB.
- Additive kinds composite in a `mix-blend-mode: plus-lighter` group (with
  `screen` as the preceding fallback declaration), matching `layer.ts`'s two
  containers and their order.

## Gates

`npx tsc --noEmit` clean. `npm test -- --run` green (nothing in `src/` moved, so
no golden re-baseline — the board is a new file, not a render change).

## NEXT

- **Director, job 1: register the board in `status/art-review.json`** keyed
  `explosion-lab.html`, with the question and the 19 ids above, in the shape
  `facility-concepts-r2.html` uses. That file **does not exist in this lane** — it
  is not in `git ls-files` — so registering it is outside what this branch can
  verify and it is not attempted here. A board absent from that manifest reads as
  ratified reference rather than as an open question.
- **Director, job 2: port nothing until the developer names a candidate.**
- The answer wanted back is one letter per family, e.g. "B, J, N".
