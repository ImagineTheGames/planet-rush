# harness/ — the headless QA harness

OWNER: QA Agent (GDD §3.8, §4.8). Imports `src/sim/` and `src/bots/` headless —
never PixiJS, never a DOM, never a wall clock inside the simulation.

Everything here answers one of QA's four measurable targets: match length lands
in 10–15 minutes, no strategy exceeds 55% win rate, no ship class exceeds 55%,
and the 60 fps / 30 fps-floor performance gates hold (GDD §3.8, §2.11, §4.3).

## The command line

Heavy runs are on-demand, not unit tests — a full balance sweep is a few hundred
eight-slot matches. CI runs the fast subset (see below); these run by hand.

```
npx vite-node harness/cli.ts smoke                 # one 8-slot match, enforced timeout
npx vite-node harness/cli.ts determinism [seconds] # record a match, replay it, compare hashes
npx vite-node harness/cli.ts perf [ticks]          # the GDD §4.3 stress scene, frame-time capture
npx vite-node harness/cli.ts balance [seeds] [--out FILE]   # the sweep + markdown report
npx vite-node harness/cli.ts soak [matches] [--rotations n] # the shipped trees: hangs, length, both 55% contests
npx vite-node harness/cli.ts mirrors <section> [--seeds n]  # one a0-112 section -> tests/reports/a0-112-data/
npx vite-node harness/cli.ts mirrors report [--out FILE]    # render tests/reports/a0-112-balance.md
```

`mirrors` sections are `mirror`, `roster`, `tier`, `class`, `cast`, `slice` and
`a0107`. They are separate commands because they are independent and a full set is
~1150 whole matches: five processes for ten minutes instead of one for an hour.

Every command exits non-zero when the thing it measured failed a target, so the
CLI is a gate as well as an instrument. `balance` writes its report to
`tests/reports/balance-01.md` by default.

## What CI runs (`.github/workflows/ci.yml`)

The merge gate runs the fast half of the harness on every push:

- **`tests/determinism.test.ts`** — the replay test proper (same inputs, same
  final state hash), also run as its own named CI step so a determinism failure
  is its own red line, not one row inside the unit suite.
- **`harness/cli.ts smoke`** — a headless bot-vs-bot smoke match with the
  enforced timeout: a commit that hangs the game fails in seconds.
- **`tests/harness/perf.test.ts`** — the simulation's half of the §4.3
  performance budget (the renderer's half needs a real GPU and runs under
  `PERF_GATE=1`, see `tests/perf/`).

## The pieces

| File | What it is |
|---|---|
| `match.ts` | the match loop and its three ceilings (sim-time, wall-clock, ticks); record & replay; lineups & sweeps |
| `hash.ts` | the **full**-state hash the determinism contract compares, plus a per-subsystem digest so a desync says *where* |
| `strategies.ts` | five QA probe strategies — measuring instruments, not game AI; the fixed reference the shipped trees are read against |
| `balance.ts` | sweeps, statistics, and the markdown report generator (every number generated, only the *reading* is hand-written) |
| `soak.ts` | the same three targets against the **shipped trees** rather than the probes, plus the release soak and the a0-112 per-match telemetry |
| `mirrors.ts` | the a0-112 sweep: full character mirrors (length, deaths, decision mix, per character and per tier) and the rotated contests that answer the win rates a mirror cannot |
| `perf.ts` | the GDD §4.3 entity-count stress scene and per-tick frame-time capture |
| `cli.ts` | the command line above |

## The probes are not the bots

The strategy probes here are the smallest honest expression of each corner of the
triangle (mine / defend / attack), written to *measure* the ruleset, not to be
good at the game.

**The Easy/Medium/Hard trees are merged**, and `soak.ts` and `mirrors.ts` measure
*those* — the shipped product. `balance.ts` still measures the probes, and that is
the division of labour rather than an oversight: the probes are a fixed reference
that does not move when a bot lane changes a tree, so a ruleset change and a tree
change can be told apart. Read a probe number as "what the rules do" and a
`soak`/`mirrors` number as "what the game does".
