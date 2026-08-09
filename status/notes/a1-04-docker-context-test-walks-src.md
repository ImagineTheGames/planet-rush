# a1-04 — the build-context test now walks the directory the last break came from

Branch: `agent/platform/a1-04-docker-context-walks-src`

## BUILT

- **`7897fe4` — `tests/server/docker-context.test.ts` walks `src/` too.** The
  walk is driven by each image's **tsconfig** (`include` minus `exclude`,
  resolved from the tsconfig's own directory) instead of the hand-kept
  `{ dir: 'server' } / { dir: 'allocator' }` list it used before. The program an
  image typechecks *is* the set of files whose imports must resolve inside that
  image, so that is the set to sweep — and `include: ["../src", …]` in both
  image configs means `src/` was always in it; only the test disagreed.

  The rule generalises from "every **cross-directory** import is COPYd" to
  "every imported **top-level directory** is COPYd". Identical where it used to
  apply (a stage always copies the directories it compiles, so those resolve
  trivially), and there is no notion of "own directory" left to get wrong now
  that a program spans three of them.

  Also in the commit:
  - aliases read from the root tsconfig's `paths`, so `@platform/*` and
    `@render/*` now count as `src/` the way the hard-coded `@shared/*` did;
  - each image asserts its Dockerfile really runs `-p <its tsconfig>` — with a
    bare `npx tsc --noEmit` (the pre-a1-03 shape) the scope this test reads
    would not be the program the image builds;
  - a JSONC comment-stripper, because those two tsconfigs carry the most
    load-bearing prose in the build and banning comments to make a test's
    parser simpler is the wrong trade;
  - `compiledFiles` / `importedRootsOf` memoised — both programs span all of
    `src/`, which is the difference between a 2.6s test and a 7.6s one.

  Two new guards: the compiled set **must reach `src/`**, and it **must contain
  no `*.test.ts`**. A test that scopes itself from config can scope itself to
  nothing and stay green; these two say out loud what the scope is supposed to
  be. The second one also pins a1-03's exclusions in place.

- **Nothing else moved.** Both Dockerfiles' COPY sets, both tsconfigs, the
  `Deploy server (Fly.io)` workflow: untouched. `git diff origin/main --stat`
  is this note plus the one test file.

## The break, reintroduced and watched (LESSONS §23)

The exact bug, in the exact shape a1-03 said was still open — a **non-test**,
**compiled** `src/` file growing an import into a top-level directory neither
image COPYs. `src/platform/freeze.ts` (mine, and a plausible caller) grew

```ts
import { hashState } from '../../harness/hash';
export function freezeDigest(world: World): string { return hashState(world); }
```

The import is *used*, deliberately: an unused one would trip `noUnusedLocals`
on the host and the host typecheck would go red for the wrong reason, hiding
the thing being demonstrated.

| | with the break | break removed |
|---|---|---|
| `npx tsc --noEmit` (host, root config — `harness/` present) | **exit 0, GREEN** | exit 0 |
| simulated allocator image (`package.json`, lock, `tsconfig.json`, `src/`, `content/`, `allocator/`) | `src/platform/freeze.ts(27,27): error TS2307: Cannot find module '../../harness/hash'` — exit 2 | exit 0 |
| simulated gameserver image (the same plus `server/`) | the same TS2307 — exit 2 | exit 0 |
| **`tests/server/docker-context.test.ts`** | **2 failed** | 6 passed |

The test's failure names the fix:

```
server/Dockerfile is missing COPY lines for:
  harness/ (imported by src/platform/freeze.ts → ../../harness/hash)
allocator/Dockerfile is missing COPY lines for:
  harness/ (imported by src/platform/freeze.ts → ../../harness/hash)
```

Row 1 against rows 2–3 is LESSONS §12 in one table: the host typecheck is
green while both images fail to build. Row 4 is the point of the lane — the
break is now caught by `npm test`, seconds after it is written, instead of by a
deploy nobody watches. The break was reverted with `git checkout --` (`git
status` clean, `harness` no longer appears in `freeze.ts`); the simulated
contexts are temp trees under `/tmp`, deleted after each run. Method is
a1-03's, because Docker is not available in the lane.

## DECISIONS

**Scope from the tsconfig, not from a directory list.** The brief's constraint
is "only the files the images actually compile — over-broad means a test that
fails for irrelevant reasons and gets weakened later". A literal
`{ dir: 'src', except: [...] }` table in the test would have satisfied that
today and drifted tomorrow, in the exact way the original test drifted: it
named the directories that *are* the services and never noticed that the
program had grown a third. Reading `include`/`exclude` makes the scope a
consequence of the build rather than a copy of it — widen an image's `include`
and the test widens with it; narrow it and the test narrows, so it can never go
red over a file the image does not compile.

**As it happens, "what the images compile" is all of non-test `src/`** — both
configs say `include: ["../src", …]`, so the sweep is 229 non-test `src/` files
per image (plus 8 in `server/`, 10 in `allocator/`), not the narrower "only what
`server/` transitively imports" one might expect.
That is correct, not over-broad: the image runs `tsc -p` over exactly those
files, so an unresolvable import in any of them fails `docker build`, whether
or not the server would ever call the module. Verified in the simulation above
— `freeze.ts` is client code the match server never loads, and it still killed
both image builds.

**Rejected:**
- *Walking `src/` with a hard-coded `.test.ts` exclusion of its own.* It would
  duplicate a1-03's exclusion in a second place, and the two would diverge the
  first time anyone touched either.
- *Following imports transitively from each service's entrypoint* (the "only
  what is really reachable" reading). Truer to what the bundler needs, wrong for
  what the typecheck gate needs — and the typecheck is the step that fails.
  It would have declared `src/platform/freeze.ts` out of scope and missed the
  reproduction above.
- *Shelling out to `tsc --listFilesOnly`* for a perfectly authoritative file
  set. Correct, and it puts a multi-second compiler run inside a unit test that
  presently takes 2.6s. The `include`/`exclude` reading is exact for the two
  configs that exist and fails loudly (a missing path throws) rather than
  silently if that stops being true.
- *Asserting on `harness/` by name.* The class is "any top-level directory not
  COPYd", and naming today's instance is how a test ends up only ever catching
  the bug that has already happened.
- *Touching the Dockerfiles' COPY sets.* Nothing is missing; `harness/` has no
  business in a runtime image (a1-03), and the brief says these must not change.

## NEXT

- Deploy evidence: one green `Deploy server (Fly.io)` run on this branch —
  see the PR body for the run id.
- Open, not blocking, and not mine to decide: `Deploy server (Fly.io)` still has
  no watcher (a1-03 raised it; the call is the Director's). This lane shortens
  the window in which that matters for one class of break, it does not close it.

No blockers.
