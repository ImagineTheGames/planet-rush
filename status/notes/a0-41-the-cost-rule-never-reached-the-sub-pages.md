# a0-41-the-cost-rule-never-reached-the-sub-pages.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch `agent/ui/a0-41-cost-rule-every-page`, PR
[#415](https://github.com/ImagineTheGames/planet-rush/pull/415).

## BUILT

- **`bc8c591` — the cost is one number on every page.** `costLabelOf(cost)` drops
  the `ore` parameter entirely (an unused wallet argument is how a denominator
  grows back) and writes the price through the **new shared**
  `costNumeral(cost)` in `src/ui/affordability.ts`; `segmentCostLabel` on the
  build wheel writes through the same function. One caller (`trackWedge`,
  `upgrade-wheel.ts:724`) feeds **both** the main upgrade wheel and the WEAPON
  sub-wheel, so DAMAGE and SPEED lost the denominator with HULL/ENGINE/CARGO.
  Every stale rationale deleted **with** the code, a0-03's discipline:
  `upgrade-wheel.ts` (module header, section comment, `costLabelOf`'s own doc,
  the `statLabel`/`costLabel` field docs), `wheel-stack.ts` ×4,
  `build-wheel-view.ts` ×2, `src/art/materials.ts:1454`, `src/main.ts:4800`.
- **`bc8c591` — the guard that walks every page.** New
  `src/ui/wheel-cost-grammar.test.ts`: a `PAGES` table (build wheel / upgrade
  wheel / WEAPON sub-wheel) walked through `costWords` + `upgradeCostWords` — the
  two functions every view reads and nothing bypasses — over frames that between
  them hit ready / unaffordable / capped-or-maxed / inactive. Asserts no `/` in
  any cost slot on any page, **and** that the slot's whole vocabulary is a bare
  price / `FULL` / `MAX` / `OPEN ▸` (a slash test alone passes on `12 of 8`),
  **and** that a wedge's string is identical across wallets.
- **`f9b10a7` — the record.** GDD §2.5's upgrade-wheel bullet **rewritten** and
  the ⚠ OPEN **struck** (not appended to — LESSONS §17), section header marked
  *amended 2026-08-13*, closing paragraph fixed. `docs/design-amendments.md` new
  top entry with the quote verbatim + a0-03's open item 2 marked ANSWERED in
  place. `docs/gdd-conformance.md` Q-3 closed and the claim row re-pointed.
  `docs/design/gantry-bone-handoff.md:23` and `docs/theme-coverage.md` (×3,
  including Q4 = yes) superseded.
- **`9c52b1f` — goldens + evidence.** Four upgrade-wheel baselines re-shot in the
  container, eyes on every image at 4×, per-image justification in
  `evidence/a0-41-cost-every-page/goldens-rebaseline.md`. Three evidence frames:
  the developer's own 8 ore, the **WEAPON sub-wheel one level deeper**, and an
  unaffordable frame where the red numeral carries the message alone.
- **`2506a68` — the second pinned denominator**, found by *running*
  `upgrade-wheel-gantry.spec.ts` against the shipped bundle rather than grepping.

## DECISIONS

**1. `costNumeral` went in `affordability.ts`, not `wheel-stack.ts`.**
`wheel-stack` imports *from* both wheels, so hosting the grammar there is a
cycle. `affordability.ts` already sits next to `affordable()` — the other half of
the same decision — and is already imported by both wheels. Only the *numeral's*
shape is shared; each wheel keeps its own state noun (`FULL` / `MAX`), because
those are nouns for a state, not prices.

**2. The brief's second sentence is a deliverable, not a remark.** A PR that only
edits `costLabelOf` satisfies the screenshot and fails *"we need to make sure
changes to build menu affect all pages."* Hence the two structural pieces above —
one source for the grammar, one guard that walks every page. Rejected: adding a
second per-page assertion in `upgrade-wheel.test.ts`, which is exactly the shape
that failed (a0-03's guard was right, and only ever knew its own page).

**3. A text change cannot fail a golden, so the goldens had to be forced.** At
`maxDiffPixelRatio: 0.01` four numerals are ~0.1–0.4% of the frame: the suite was
green before *and* after while the PNGs still pictured `3/99`. Found by
re-running once at tolerance 0 and localizing each diff; `--update-snapshots` also
had to run at 0, because Playwright will not rewrite a snapshot whose test passed.
**The tolerance edit is not committed** — `goldens.spec.ts` is byte-identical to
the branch apart from the two assertion/comment re-points.

**4. Both desktop goldens carry a rider I could not separate**, and it is stated
in the PR rather than smuggled: the controls strip reads `Click anywhere Move or
attack` instead of `WASD Thrust · Left mouse Fire / Mine`. That is `1862e3b`
(a0-37) on top of a0-30, both already on `main` and both ancestors of this
branch; these two frames were simply never re-baselined for them. A golden is a
whole frame, so adopting the cost numerals adopts the strip. The two phone frames
have no rider (on touch the visible controls replace the strip).

**5. `style-guide.md` §2.1 left untouched, and flagged instead.** Line 133 still
reads *"and since u7-06 quoting its price in the same `cost/held` grammar."* The
file is FROZEN and Director-only, the brief's record list does not name it, and
its *argument* is not merely intact but stronger now — the two wheels really are
one grammar again, and only the grammar's **name** in that clause is stale.
Editing a frozen contract to fix a nickname is not this brief's call. Raised for
the Director in the PR body.

**6. Files outside `src/ui/` edited this time, unlike a0-03.**
`src/art/materials.ts:1454` and `src/main.ts:4800` carry stale `cost/held` doc
comments; a0-03 reverted its edits to them as Art's and Platform's. **This
brief enumerates both by path** under "delete the rationale with the code", so
they are in scope here. Doc comments only — one line each, no behaviour.

## NEXT

- [x] `npx tsc --noEmit` — clean
- [x] `npm test -- --run` — 294 files / 5330 tests passed
- [x] `origin/main` merged in (`6f92b74`), so the branch is a descendant — the
      last DoD clause. No conflicts; a0-40 touched only art/backdrop files.
- [x] PR #415 checks all green (typecheck/test/build, 6 Playwright shards, perf
      gate), `MERGEABLE` / `CLEAN`.
- [ ] Awaiting review + merge. Nothing is blocked.
- For the Director, in the PR body: `style-guide.md` §2.1's `cost/held` nickname
  (decision 5). One clause, frozen file, needs their hand not mine.
