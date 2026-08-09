# r5-01-unstick-u7-gantry-upgrade-wheel.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch `agent/ui/u7-gantry-upgrade-wheel`, PR **#300** (existing — no new PR).
Base before session 1: `e9e66c4`. Merge base with main was `3229b84`.

> **Sessions 1–4 ran without this file ever being committed** — it lived only in
> the brief hand-off text, which is exactly the failure mode it exists to prevent.
> Committed from session 5 on. Sibling lanes (`a3-01`, `b1-01`, `r3-01`) commit
> theirs; a note that is not on the branch does not survive anything.

## BUILT

- **`ef6f98b` — Merge main (`369d7a6`) into the branch.** One reported conflict,
  two silent ones. DoD ancestry line passes.
- **`1b8764e` — Merge main again (`4947169`).** main moved mid-run: `#306`
  (a2-08's art-evidence campaign). Clean, zero conflicts — delta is **evidence/
  only**, 74 new files, no `src/` or `tests/` change.
- **`7e791cd`** — the four upgrade-wheel goldens re-shot onto a1-01's font, with
  the measured numbers per baseline in the commit message.
- **`5a3f0a5`** — `evidence/images/r5-unstick-u7-upgrade-wheel/` (12 frames +
  README) and `evidence/measure-golden-diff.mjs`.
- **`fffb646` — Merge main a THIRD time (`c2d401f`).** a3-01's rock palette,
  PR #308. Zero conflicts, zero file overlap, single merge base.

*Lesson, earned three times over: re-fetch and re-check ancestry at the START of
every session. The DoD line is evaluated against origin/main at grading time, not
at merge time, so a merge that was correct an hour ago can be stale.*

## DECISIONS

### The dependency this branch was stacked on has LANDED

u7-06 was branched off u7-02 (`agent/ui/u7-gantry-build-wheel`, PR #291) rather
than main, and #291 "must merge first". It did — `29f2950` on main. The stack is
discharged and this is a plain merge, not a rebase-onto-a-moved-dependency.
**Not BLOCKED on any other branch**; every commit this branch sits on top of is
in main's history (`1fe7044`, `581ac1f`, `3d1807b`, `0830118` all test as
ancestors of origin/main).

### Session 1–2: two merge bases → recursive merge → look for SILENT conflicts

`git merge-base --all origin/main HEAD` returned **two** commits (`3229b84`,
`0830118`). git merges the bases first, so "no conflict reported" said less than
usual. Audited every file both sides touched, not just the reported one.

**1. `src/ui/build-wheel-view.ts` — auto-merged, and the repair won.**
This branch carried u7-02's hand-spelled
`const FONT_NUMERAL = 'Oxanium, "DejaVu Sans Mono", monospace'`; a1-01 (`bb054ad`)
had deleted that copy in favour of `./typography`, because the shared fallback
moved to `"Liberation Mono"` and files carrying their own copy would have been
left behind — one game, two body faces, on the CI runner only. The merge took the
repair. Verified rather than trusted: no hand-spelled font-STACK literal remains
anywhere in `src/ui/` outside `typography.ts`, and no `DejaVu` literal survives in
`src/` or `tests/` outside a comment explaining the history.
`build-wheel-view.ts:80` reads
`import { FONT_BODY as FONT_NUMERAL, FONT_HEADING } from './typography'`.

*Precision:* `const FONT_*` bindings DO still exist elsewhere —
`nameplates-view.ts` has `const FONT_NAME = FONT_BODY` and `const FONT_SIZE = 12`
— but they are an alias and a size, not stacks. **Grepping for `const FONT_` alone
gives a false positive; grep for the stack literal** (`monospace` / `sans-serif`).

Recorded as **not a genuine disagreement**: u7-02 never meant to pin a face, it
inherited literals it happened to be rewriting around. What u7-02 *decided* —
which field draws in which stack — is untouched.

**2. `tests/mobile/shot-budget.ts` — took main's verbatim.** The two sides
differed by comment only; `SHOT_FLOOR_MS = 30_000` on both. q8-01 owns that file
and main's is its corrected wording.

**3. The one REPORTED conflict, `tests/mobile/goldens.spec.ts`, was comment-only.**
Both sides already call `settleFrames(page)` in `bootFrozenBuildWheel` — this
branch converted it at `125d27b`, r2-01 converted it on main at `214a51a`,
independently to the same code. Took main's fuller explanation and grafted on the
one fact this branch's comment carried that main's did not: that
`tests/mobile-shot-budget-contract.test.ts` is what catches a relapse.

### Nothing of the repair reverted

No conflict required it, so the "the repair wins and you say so" clause never had
to fire on a genuine disagreement. a1-01, q8-01, b1-01, m11-01 all intact. The
campaign door, the seat-state control and the four-tap landscape journey are
untouched by this branch — it never edits those specs.

GDD §2.5 and `src/ui/index.ts`'s header merged **additively**: this branch's
upgrade-wheel amendment sits alongside u4-01's 2026-08-05 ship-select amendment
and u7-02's 2026-08-06 build-wheel one, none overwriting another.

### THE SHARED-PORT TRAP: lanes share 4173, so a lane can shoot goldens against ANOTHER LANE'S BUNDLE

Read this before running `npm run test:mobile` on a shared box. It fails
**silently** — a green suite proves nothing.

`playwright.config.ts` (QA's) pins `PREVIEW_PORT = 4173` with
`reuseExistingServer: !process.env.CI`. The lanes are separate checkouts
(`/lanes/lane-1`, `/lanes/lane-2`, …) on ONE machine running concurrently. So
whichever lane's `vite preview` claims 4173 first serves its bundle to **every
other lane's suite** — and the others never build at all, because
`reuseExistingServer` sees a live URL and skips `npm run build`.

This is a1-01's stale-bundle trap widened from stale-in-time to wrong-in-origin.
a1-01's own advice — kill the preview — is *not* enough: killing a preview
another lane is actively using would sabotage that lane, and the port is
`--strictPort`, so the two lanes cannot both be right.

**What to do instead.** An untracked `playwright.isolated.config.ts` at the repo
root: spreads QA's config, overrides only the port (4193) and sets
`reuseExistingServer: false`. Did NOT edit `playwright.config.ts` — QA owns it,
and the fix there is a Director/QA decision, not a UI lane's.
**It is scratch and must never be committed.** Delete before the final push and
check `git status`.

Full content, so a future session can recreate it verbatim — run it with
`npx playwright test --config=playwright.isolated.config.ts` (NOT
`npm run test:mobile`, which uses QA's shared-port config):

```ts
/**
 * SCRATCH — NOT FOR COMMIT. r5-01 only.
 *
 * Identical to playwright.config.ts except the preview port. The committed
 * config pins 4173 with `reuseExistingServer: !CI`, and several lanes share this
 * box: whichever lane starts `vite preview` on 4173 first has its bundle served
 * to every other lane's suite. That is a1-01's stale-bundle trap across lanes,
 * and it silently invalidates goldens.
 *
 * This config takes a private port so this lane builds and serves its OWN bundle
 * and poisons nobody else's. Verified per run against `/version.json`, which
 * carries the short HEAD sha of the build actually being served.
 */
import base from './playwright.config';
import { defineConfig } from '@playwright/test';

const PREVIEW_PORT = 4193;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: PREVIEW_URL },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
```

Pick a port no other lane is using — check with `curl -s localhost:<port>/version.json`
first. **Never kill another lane's `vite preview`**: only ever kill PIDs whose
`/proc/<pid>/cwd` is this lane's checkout.

**Verification, every run — do not skip.** `vite.config.ts` emits `version.json`
(`{sha, time}`) into the build output via `versionJsonPlugin`. So:

    $ curl -s http://localhost:4193/version.json   ->  {"sha": "fffb646", ...}
    $ git rev-parse --short HEAD                   ->  fffb646

That is the only positive proof the pixels came from *this* branch. A passing
suite is not proof; it passes just as happily against a sibling lane's bundle.

**Independently confirmed by another lane.** a3-01 hit this and reached the same
fix on its own: `evidence/a3-rock-palette/playwright.a3.config.ts` (now on this
branch via the third merge), same shape, port 4287, plus a
`verify-served-build.mjs` that reads the served bundle back and asserts the new
`rockBody` colour is in it *before* any shot is taken. Its header records a
build-wheel golden that "came back byte-identical to the old baseline because
lane-3's `vite preview` held 4173 at the time." That is two lanes, independently,
building the same workaround for a config neither owns.

### `--update-snapshots` DOES NOT re-shoot a stale-but-PASSING golden

The sharpest form of the stale-baseline trap, and it travels beyond this branch.

Session 3, full suite green including all four upgrade-wheel goldens at
`maxDiffPixelRatio: 0.01`. Then:

    $ npx playwright test ... -g "UPGRADE WHEEL" --update-snapshots
    4 passed
    $ git status --short tests/mobile/goldens.spec.ts-snapshots/
    (nothing)

**It rewrote zero bytes.** On Playwright **1.49.1** `--update-snapshots` only
rewrites a baseline whose comparison FAILS. A baseline that is stale but still
inside the 1% tolerance is, to that flag, correct — so the one command everybody
reaches for to refresh baselines is a no-op on precisely the class of staleness
that matters.

**The remedy: `rm` the baseline files first**, then run `--update-snapshots`, so
Playwright regenerates them as *missing* rather than diffing them as *matching*.
Only then is the committed PNG a fresh capture of the current code.

### Session 3: the goldens WERE stale, and the numbers

Measured with Playwright's own bundled pixelmatch at zero tolerance, before vs
after (`evidence/measure-golden-diff.mjs`, committed so it is reproducible):

| baseline                        | frame    | differing px | of total |
|---------------------------------|----------|--------------|----------|
| `desktop-upgrade-wheel`         | 1280×800 | 5,413        | 0.53 %   |
| `desktop-upgrade-wheel-short`   | 1280×800 | 4,584        | 0.45 %   |
| `phone-landscape-upgrade-wheel` | 844×390  | 2,156        | 0.66 %   |
| `phone-portrait-upgrade-wheel`  | 390×844  | 2,128        | 0.65 %   |

All four under the 1% gate — they passed while spending half to two-thirds of the
tolerance budget on a font the code no longer asks for. Eyes on all twelve
frames: every changed pixel is text and only text; no control moved, vanished or
appeared. The HUD numerals moved too, correctly (a1-01 put `hud.ts` on the same
constant). The onboarding banner's prose did NOT move — it is not drawn through
`FONT_BODY`.

**Stability:** deleted and re-shot a SECOND time from a fresh build, then compared
the two captures directly — **byte-for-byte identical** (sha256 match, 0 differing
pixels). A zero-tolerance re-run only shows the comparator is satisfied; a sha
match shows the capture is deterministic.

Left alone deliberately: `evidence/images/u7-gantry-upgrade-wheel/` (the 18-frame
deliverable set). Its *before* half came from `125d27b` in a throwaway worktree;
re-shooting only the *after* half would make the pair differ by the feature AND
the font, destroying the controlled comparison. Not gates.

## SESSION 5 (2026-08-07) — main moved a third time; a3-01's rock palette

Re-checked ancestry FIRST, per the lesson. main **had** moved: `4947169` →
`c2d401f`, PR #308, a3-01's rock family moving to the boards' dark half. The DoD
ancestry line was failing on arrival. Merged as `fffb646`.

**Clean merge, and genuinely clean — not merely unreported.** Single merge base
this time (`4947169`), so the recursive-merge silent-conflict risk that dominated
sessions 1–2 did not apply. Checked file-level overlap explicitly:
`comm -12` of the two deltas is **empty**. a3-01 touches
`src/art/{asteroids,palette}.ts`, seven shared goldens and `evidence/`; this
branch touches `src/ui/`, four goldens unique to it, and `evidence/`. Nothing of
a1-01's repair, q8-01's, or this branch's work was in play.

### The interesting part: a3-01 could not re-baseline MY goldens

a3-01 repainted the rock family and re-baselined the seven shared goldens its
change showed in — including `desktop-build-wheel` and
`desktop-build-wheel-short`, the frames analogous to mine. The **four
upgrade-wheel goldens exist only on this branch**, so a3-01's re-baseline pass
could not reach them. If the upgrade-wheel scene renders the rock field, my four
are stale again — for a completely different reason than session 3's font.

Re-measured rather than assumed. Results below.

### The shared-port trap was LIVE again — fourth session, fourth occurrence

On arrival 4173 was held by another lane serving `{"sha": "369d7a6"}` — not this
branch's HEAD. A default `npm run test:mobile` would have skipped its own build
and shot every golden against that bundle, silently and green. Ran on
`playwright.isolated.config.ts` (4193) instead; provenance proved positively:

    $ curl -s http://localhost:4193/version.json  ->  {"sha": "fffb646", ...}
    $ git rev-parse --short HEAD                  ->  fffb646

Did not touch the other lane's preview.

### One unit-test failure, and it is a load flake, not a regression

`tests/net/capacity/capacity-regression.test.ts` — "the loop stays inside the tick
budget at 12 rooms", 36.06 ms against a 33 ms budget. It is a wall-clock
measurement in `src/net/`, which this branch never touches and which the merge
never touched either (a3-01's delta is `src/art/`). Box load average was 13–21
with three lanes running suites.

**Re-ran it in isolation: 4 passed.** a3-01's notes record the same family of
load-sensitive flakes on this box (`tests/net/online-2p.test.ts`,
`tests/mobile/build-wheel-gantry.spec.ts:214,292`). Not a regression; not this
branch's to fix.

## NEXT

1. **Watch PR #300's checks.** The line not confirmable locally is the mobile
   suite on CI's hardware. The re-shot goldens encode Liberation Mono, the face
   a1-01 chose *because the GitHub runner has it too*, so they should match. If
   one fails on CI, that is the interesting case: it would mean the runner
   resolves the stack differently again, and the fix is a1-01's territory (the
   never-completed self-hosting of Oxanium / Audiowide), not another re-shoot.
   **Do NOT re-baseline against CI to make it green** — that re-creates the very
   drift these sessions removed.
2. Nothing else outstanding on this brief.

**If a future session resumes here:** re-fetch and re-check ancestry FIRST (main
has now moved mid-brief three times), and if you need the mobile suite, re-create
`playwright.isolated.config.ts` — deliberately not committed. Content above.

## Reviewer notes carried into the PR body

- **#291 is no longer a blocker** — it merged. The old PR body's line saying it
  must land first was removed.
- **style-guide §2.1 is still a scope clarification flagged for the Director**
  (`b0782c4`), unchanged by these merges. No pixel changed colour for it.
- Left for other lanes deliberately, unchanged: the onboarding prompt overlapping
  the wheel's bottom wedge (u7-07 has it), and the two growth ceilings recorded
  in `hud-geometry.test.ts` for whoever lands p2-03's weapon tracks.

## Flags to the Director

1. **Fork-point planning error (same finding as r2-01/r3-01).** The u7 Gantry
   chain was briefed as parallel branches all editing `src/ui` from different
   fork points, so they conflict with each other and with anything repairing
   main. This branch was additionally *stacked* on a sibling, which is why its
   fork point was `3229b84` and not main. A planning error, not a lane error.

2. **Shared-port infra defect — this one silently corrupts EVIDENCE, not just
   merges.** Four sessions, four live occurrences, and now a second lane (a3-01)
   independently building the same workaround. Either give each lane its own port
   (an env var in QA's config) or serialise the mobile suite across lanes. Anyone
   who shot goldens on this box while another lane held 4173 should re-verify them
   against `version.json`. The fix belongs in QA's config, not in per-lane scratch
   files that every lane has to reinvent.
