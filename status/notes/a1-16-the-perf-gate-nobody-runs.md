# a1-16-the-perf-gate-nobody-runs.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

**THE NOTE LIVES IN TWO PLACES.** `/status/notes/…` (absolute, the cross-agent
scratch area) and `<repo>/status/notes/…` (committed, if the repo carries one).
a1-10 lost a session to updating only one. Trust the branch over either.

Read `status/notes/a1-11-wire-the-pooling-the-reducer-cannot-save-us.md` and
`status/notes/a1-12-submit-what-is-on-screen.md` first — this brief measures
what those two built and does not touch either.

## BUILT

Branch `agent/platform/a1-16-perf-gate-in-ci`, cut from `main` at `d99e9cc`.
Four commits, tsc clean, 5008 tests green across 286 files, dark-matter clean.

1. `d8534f0` — **CROSS-OWNER, flagged**: `testMatch: 'frame-time.spec.ts'` on
   QA's `tests/perf/playwright.perf.config.ts`. `testDir: '.'` with the default
   testMatch claims every spec in `tests/perf/`, and my new one drives a rig page
   that is deliberately not in the production bundle that config previews. One
   line, default-preserving, drops cleanly if QA declines.
2. `5b65b24` — **the CI gate**. `tests/perf/budget.ts` (thresholds + provenance),
   `draw-budget.rig.ts` + `.html` (shipped `Renderer` over `stressWorld()`,
   `draw*` counted off the patched WebGL2 prototype), `draw-budget.spec.ts`
   (assertions), `playwright.draw-budget.config.ts`, and two npm scripts
   (`test:perf-budget`, `test:perf-frame-time`).
3. `db48127` — the CI job `perf-budget`, on every push, its own job.
4. `2780bea` — `docs/perf-gate.md` + `evidence/a1-16-perf-gate/`.

**Measured on this box** (SwiftShader, no GPU), reproducing a1-12's rig to a
tenth of a draw call:

| screen | draw calls/frame | submitted | ceiling (draws/submitted) | floor |
|---|---|---|---|---|
| desktop 1280×800 | **10.8** | **173** of 660 | 16 / 260 | 3 / 40 |
| phone 844×390 | **9.1** | **11** of 660 | 14 / 18 | 3 / 3 |

18.7 s wall clock for the whole gate.

## DECISIONS

**Only the portable columns are gated, and the rig does not even MEASURE a frame
time.** Not "measures and ignores" — never collects one. a1-11's finding is the
whole key to G-15: draw calls travel to integrated graphics and to a phone,
milliseconds travel nowhere. The brief is explicit that a green 60 fps from a
GPU-less runner is worse than no claim, and the only structural guarantee that
one never leaks out of CI is that the number does not exist in the rig.

For the record, this box's frame-time capture (measure-only, in the evidence
dir): **20.0 fps desktop, 8.6 fps landscape phone.** The phone profile is dpr 3,
so SwiftShader fills 2532×1170 px in software. That is why it stays manual.

**Ceilings at ~1.5× measured, not at 2×.** The brief says a doubling must fail;
1.5× makes a doubling fail *with room to spare*, and leaves margin for an honest
cross-GPU difference — Pixi flushes on `MAX_TEXTURE_IMAGE_UNITS`, 16 on some
drivers and 32 on others, so the same scene can land a call or two apart on two
machines. A gate with zero margin is a flake generator, and a flaky gate gets
ignored, which is worse than a slightly loose one.

**Every ceiling has a FLOOR under it.** A renderer that threw on boot submits
nothing and draws nothing, and against a ceiling alone that reads as a
spectacular win. Plus a threshold-free third assertion — the phone must submit
*fewer* than the desktop off the same field — because before a1-12 those two
numbers were equal and that equality was the bug.

**`PERF_BUDGET_SCALE` is `Math.min(1, …)`.** A permanent knob so "see the gate
fail" is a command rather than an edit-and-remember-to-revert (LESSONS §24) — but
clamped, so it is *incapable* of loosening a budget. A knob that can widen a
threshold from a workflow file or a shell is a hole, not a feature.

**Rejected: a project inside QA's `playwright.perf.config.ts`.** The two halves
need different servers. Frame time must be measured on the shipped `vite preview`
bundle; the submission rig must NOT be in that bundle (`vite build` takes
`index.html` alone), so it needs the dev server. One config cannot do both, and
adding the rig to the production bundle to unify them would be a real cost paid
for filing tidiness.

**Rejected: gating the submission count only in vitest.** `src/render/draw-cost.test.ts`
already pins submissions headlessly and it is good — but it is a geometric
*sandwich* recomputed from the world, and the draw-call column is the one the
brief says a1-12 rested its conclusion on. Draw calls need a real WebGL context
and cannot be counted headless at all. So the browser gate covers both columns,
and draw-cost.test.ts is untouched.

**Rejected: editing `docs/gdd-conformance.md`'s G-15 row.** That table is the
Architect's audit output (a0-19). `docs/perf-gate.md` §6 answers it; the row is
theirs to move.

**Every push, not PR-and-main.** Unlike the mobile suite (~60 min sharded six
ways), this is ~20 s behind the usual ~2 min fixed cost, in its own job so the
merge gate does not get longer. A renderer regression is cheapest to see on the
push that caused it.

### THE TRAP: `webServer.cwd` DEFAULTS TO THE CONFIG'S DIRECTORY

The first run died with `@platform/camera … Are they installed?` — which reads
like a broken checkout and is really a working directory. Playwright starts
`webServer.command` in the **config file's** directory, not the invoking shell's,
so `npx vite` booted in `tests/perf/`, found no `vite.config.ts`, and served the
tree with none of the aliases. Fixed with an explicit
`cwd: fileURLToPath(new URL('../..', import.meta.url))` and named in the config
so it cannot cost anybody a second run.

Second, smaller: `const URL = …` in a Playwright config shadows the global `URL`
that `new URL(import.meta.url)` needs, and fails at config load with
`Cannot access 'URL' before initialization`. It is `BASE_URL` now.

### PROVING IT FAILS — the real regression, not just the knob

`touchesBox()` in `src/render/cull.ts` forced to `return true` (the cull stops
culling), gate run, then `git checkout --` reverted it. All three tests red:

```
desktop:         Expected: <= 16   Received: 32.15   draw calls/frame
phone-landscape: Expected: <= 14   Received: 32.15   draw calls/frame
phone < desktop: Expected: < 660   Received: 660     entities submitted
```

32.15 is a1-11's post-pooling, pre-cull number to two decimals; 660 is the whole
arena on both screens. **The gate reproduced the exact pre-a1-12 shape, not
merely "a number moved."** That is the evidence worth defending in review —
`PERF_BUDGET_SCALE=0.5` is the reproducible-forever version, but it only proves
the arithmetic bites.

Both captures, plus the measure-only frame-time run and the sim half, are in
`evidence/a1-16-perf-gate/` with a README.

## NEXT

Everything the brief asked for is committed. Remaining: the DoD's PR-checks-green
line, which is the new job's first run on the branch.

**The headline to defend in review, and do not soften it:** CI now asserts the
half of §4.3 a runner can honestly assert, and asserts *nothing* about frames per
second — because the §4.3 scene is **still not under budget** on a box with no
GPU (a1-12 said so; it is still true), and the only honest 60 fps check is a
human on real hardware. `docs/perf-gate.md` §4 is that obligation, written down
for the first time.

**For whoever comes next:**

- The **first `PERF_GATE=1` run** is still owed, by the developer, on the laptop
  and on the phone. Nothing on this branch substitutes for it, and §4 of the doc
  says when it is required (before a `v*` tag, at minimum).
- **A real 3-year-old mid-range Android** has never run the 30 fps floor that
  §4.3 states about it. Named in §4 as uncovered.
- If QA declines the `testMatch` line in `d8534f0`, the replacement is to move
  `draw-budget.spec.ts` into a directory of its own; nothing else depends on it.

Nothing is blocked.
