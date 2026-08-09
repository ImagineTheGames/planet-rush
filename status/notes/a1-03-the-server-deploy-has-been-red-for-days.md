# a1-03 — the Fly server deploy has been red for days

Branch: `agent/platform/a1-03-allocator-typecheck`

## BUILT

- **`488ebe2` — allocator: exclude tests from the image typecheck.**
  `allocator/tsconfig.json` gains
  `"exclude": ["../src/**/*.test.ts", "../allocator/**/*.test.ts"]`, plus the
  comment explaining why it is load-bearing.
- **`e29840b` — gameserver: the same defect, one step behind.** New
  `server/tsconfig.json` (states the program: `../src`, `../server`,
  `../allocator`, tests excluded); `server/Dockerfile` line 51 changes from
  `RUN npx tsc --noEmit` to `RUN npx tsc --noEmit -p server/tsconfig.json`.

Nothing else. No workflow change, no `skipLibCheck`, no `any`, no deleted test.
Server behaviour, the `scale count 1` pin, the `::` bind and the token presence
check are all untouched.

- **THE EVIDENCE EXISTS: run [31331151684] is green.** `Deploy server (Fly.io)`,
  `workflow_dispatch` on this branch, 2026-08-09 19:15 UTC — **the first green
  run since 2026-08-07**, and all 13 steps passed:

  ```
  Deploy allocator (control plane first)   RUN npx tsc --noEmit -p allocator/tsconfig.json  →  ✓ 14 modules
  Deploy gameserver fleet                  RUN npx tsc --noEmit -p server/tsconfig.json     →  ✓ 58 modules
  Health checks   allocator  {"status":"ok","machines":3,...}   healthy
                  gameserver {"status":"ok","region":"iad",...} healthy
  ```

  Note **`Deploy gameserver fleet` ran and passed** — the step that had not
  executed at all since 2026-08-07. That is the second fix proving itself in CI,
  not just in the simulated context. Module counts (14 / 58) match the local
  reproduction exactly. Fleet is live: iad x2 + gru x1.

  Dispatched rather than waited-for-merge because the workflow's `on:` has
  `workflow_dispatch`, and the branch's diff vs `main` is **build config only**
  (`git diff origin/main...HEAD` touches two tsconfigs, one Dockerfile line, this
  note — zero runtime source). So the image this run built and shipped is
  byte-for-byte what merging produces; the evidence is not weakened by arriving
  before the merge. It also un-stalls production two days early.

## DECISIONS

**The diagnosis is shape 1 — the allocator should not be typechecking `*.test.ts`
at all — not shape 2.** Evidence:

- Every one of the 11 errors is in a `*.test.ts`. Every TS2307 is
  `../../harness/hash` or `../../harness/match`. The four TS7006 implicit-anys on
  `combat-credit.test.ts:432` are downstream of the unresolved import (`replay`
  becomes `any`, so `c` is `any`, so the two `reduce` callbacks' params are).
  One cause, eleven symptoms.
- **No non-test file imports `harness/`.** Sixteen files under `src/` contain the
  string; eight are `*.test.ts` with real imports, the other eight are *prose in
  comments* (`src/sim/state.ts:697`, `src/sim/combat-credit.ts:23`, etc.). Checked
  each one by hand.
- The allocator bundle is **14 modules**. `harness/` is determinism/soak/bench
  tooling (`hash.ts`, `soak.ts`, `perf.ts`, `pool-size.ts`, `cli.ts`). COPYing it
  into a runtime image so the image can compile tests the image never runs would
  be paying build weight for nothing — that is why shape 2 is the wrong fix here,
  even though shape 2 is the right fix for the M10 `allocator/router` case the
  same Dockerfile already documents.
- Coverage is not lost: the repo-wide `npx tsc --noEmit` in CI includes `src`,
  `server`, `tests`, `harness` with no `exclude`, so every test stays fully
  checked where `harness/` actually exists.

**Rejected:** `skipLibCheck` (already on, and irrelevant — these are our files);
blanket `any`; deleting/moving the tests; COPYing `harness/`; excluding tests from
the ROOT tsconfig (that would delete test typechecking repo-wide — the opposite of
the fix).

**The second bug the brief warned about is real, and it is not in the older runs
— it is in the step that never ran.** All six failures (not five: `0491127` on
2026-08-07 22:59 is the first, one run after the last green at 03:27 that day)
died at the *same* step, `Deploy allocator (control plane first)`, with the same
`harness/` cause; the earliest names `src/bots/ffa-parity.test.ts` and the newest
names five files, because more tests grew the import over the two days. So the
older runs hide nothing.

But because the allocator step is step 5 of 9, **`Deploy gameserver fleet` has not
executed since 2026-08-07** — and `server/Dockerfile`'s bare `npx tsc --noEmit`
has exactly the same defect. The root config's `include` names `tests` and
`harness`; the image copies neither; **tsc skips a missing `include` entry
silently**, so the program narrowed to `src/ + server/`, tests and all. Fixing
only the allocator would have greened step 5 and gone red at step 7. Verified, not
assumed — see below.

**Method — a simulated build context, since Docker is not available in the lane.**
A temp tree holding *only* what each Dockerfile COPYs (`package.json`,
`package-lock.json`, `tsconfig.json`, `src/`, `content/`, `allocator/`, and for
the server `server/`), with `node_modules` symlinked:

| | before | after |
|---|---|---|
| allocator typecheck | the 11 CI errors, byte-identical, exit 2 | exit 0 |
| allocator bundle | not reached | `allocator.mjs`, 14 modules |
| gameserver typecheck | **the same 11 errors**, exit 2 | exit 0 |
| gameserver bundle | not reached | `match-server.mjs`, 58 modules |

And the gate still bites — planted type errors in `allocator/registry.ts`,
`src/net/ticket.ts`, `server/room.ts` and `allocator/router.ts` each still fail
their build. Excluding tests did not turn the typecheck into a no-op.

**Cross-ownership, declared.** `server/` is the Netcode Engineer's; the Dockerfile
header says so. Kept as a separate commit so it reviews in isolation. The DoD is
one green `Deploy server (Fly.io)` run, and that run cannot exist while the
gameserver image is broken — leaving it would have been reporting a fix that
isn't one.

## The monitoring gap (PR body carries the recommendation)

Six failed runs over two days and nothing said a word: the notifier's "CI red"
ping and the Director's watchdog both watch the **CI** workflow and the live
Pages URL. `Deploy server (Fly.io)` is a different workflow with no watcher, and
its failure is invisible from the client — the client keeps loading, the fleet
just keeps serving the last image that built. Recommendation in the PR body; the
call is the Director's.

Second, narrower gap: `tests/server/docker-context.test.ts` walks `server/` and
`allocator/` sources and asserts every cross-directory import is COPYd — but it
never walks `src/`, which is where this came from. The exclusion closes the class
for *tests* by construction (neither image compiles one now), but a non-test
`src/` file growing an import into an uncopied top-level dir would still only be
caught by a deploy. Named in the PR body for its owner.

## NEXT

Work is complete. Both fixes are committed and pushed, PR #355 is open, and the
DoD's one green `Deploy server (Fly.io)` run exists (31331151684).

- Awaiting review/merge on #355. On merge the workflow fires again on `main`;
  it should be a no-op roll of the same image this run already shipped.
- The "expect the first green run to do a lot at once" worry **has already
  happened and was clean** — that dispatched run rolled two days of `server/`,
  `src/net/` and `src/shared/` change onto the fleet in one go, and the
  `scale count` and health-check steps all passed. No pair of eyes needed on
  the merge run beyond its exit code.
- Open for the Director, not blocking: whether `Deploy server (Fly.io)` joins the
  notifier's watch list (recommendation and the smallest-honest-signal proposal
  are in the PR body).
- Open for the Netcode Engineer, not blocking: widening
  `tests/server/docker-context.test.ts` to walk `src/` too.

No blockers.
