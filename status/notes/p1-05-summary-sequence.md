# p1-05-summary-sequence.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as you
work; a future you reads it first. This is a working note, not evidence — "done"
is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/p1-05-summary-sequence`, cut from `origin/main` @ `12c2e2e`.
Contract: `docs/progression-plan.md` §6 (and §5 Task PR-5). **The plan wins where
it and the brief disagree** — read line by line, **they do not disagree anywhere**;
the five decisions the brief left open are annotated in it under *AS BUILT*.

## THE GROUND THIS STARTS FROM (read before touching anything)

- `src/ui/end-of-match.ts` / `-view.ts` — a0-09's team-aware screen. **Extend, do
  not fork.** `endOfMatchModel` stays pure; the sequence's state is
  `(model, elapsed, skipped)` and lives in a second module beside it.
- pr-01 `src/progression/profile.ts` (`loadProfile`/`saveProfile`), pr-03
  `curve.ts` (`levelForXp`, `xpToReach`, `xpToNext`), pr-04 `accrual.ts`
  (`createAccrualObserver`) + `xp.ts` (`xpForMatch`) — all merged in `main`.
- pr-07 merged the four cues: `audio.cue('xpTick', i)`, `audio.xpFill(p)` /
  `stopXpFill()`, `audio.cue('levelUp')`, `audio.cue('xpSettle')`.

## BUILT

| commit | what |
|---|---|
| `27624d9` | **`src/ui/summary-sequence.ts` + its 31 tests.** `buildSummary(input)` fixes every number at teardown; `summaryFrame(seq, elapsed, opts)` is pure. The seven rows, the match-time line, the XP total, the fills, the level-up beats, the collapse past three, the tiny-XP case. |
| `d366497` | **The furniture and the seam.** `endOfMatchLayout` gains `summaryRows` (stacked / split, chosen by measured height); the view's animating sheet is its own container **outside** `ScreenCache`; `platform.prefersReducedMotion()` + `platform.test.ts`. |
| `de06c76` | **The wiring.** Observer per match, `observe()` per sim tick, `bankMatch()` once at teardown (compute → add → `saveProfile` → *then* animate), skip on tap/key/pad, pr-07's cues off the model's counters, the `__endScreenStage` additions. |
| `0322995` | **Evidence** — `evidence/p1-05-summary-sequence/`: `capture.mjs`, five PNGs at 844×390 dpr 3, `frames.json`, `README.md`. |
| `4f234f0` | **The golden re-baselined** (`desktop-end-of-match`), and staged boots pinned to the end state. |
| `8f407ca` | The brief's *AS BUILT* block, and this note. |
| `d2a64ed` | **The bed runs UNDER the level-up beat.** pr-07 built `levelUp` to duck it and expects it still sounding; the wiring was stopping it on `barMoving === false`, which is exactly that beat. |
| PR | **[#347](https://github.com/ImagineTheGames/planet-rush/pull/347)** against `main`. |

## DECISIONS (why, and what was rejected)

1. **Skip and reduced motion resolve to the SAME end state by construction.**
   `summaryFrame` resolves `elapsed` to `seq.duration` for both, so there is no
   second code path that has to agree with the first. The byte-identity test at
   every 100 ms mark is still written, because "by construction" is a claim a
   refactor can break. **Rejected:** a separate `finalModel()` builder — that is
   precisely the shape where a skipped screen drifts from a watched one.
2. **The sequence is a SECOND model, not a field on `EndOfMatchModel`.** The brief
   forbids smuggling a clock into the pure model, and the view now takes
   `update(model, summary | null)`. That null is what keeps the DEFEATED overlay
   byte-identical to a0-09's.
3. **The DEFEATED overlay carries no summary.** §Q2 + Trap 14: XP is never shown
   *in* a match, and an eliminated player is still in one. It also keeps the write
   site honest — the profile is written when the MATCH ends, not when a seat does.
4. **Two compositions, chosen by measured height, and no row cut.** At 844×390
   there are ~106px under the plates, which is not seven rows at any type size —
   so the band splits into result+actions | sheet. At 390×844 it stacks. Rule 4's
   "cut a row" fallback was not needed. **Rejected:** shrinking type to fit one
   column (unreadable), and a scrollbar (forbidden outright).
5. **The animating sheet sits OUTSIDE `ScreenCache`.** That class rasterises on a
   signature change; a five-second animation would re-rasterise ~300 times, which
   `screen-cache.ts` itself says is strictly worse than not caching. The chrome
   (plates, beams, result) still caches on the model.
6. **The cues are driven off monotonic counters read from the model**, never a
   queue — which is what makes a skip silent past the settle cue (§6.5), with no
   flush logic anywhere.
7. **A staged boot (`?debug=1` / `?freeze=1`) rests at the end state.** A golden
   captures two frames and compares them; a screen mid-count between them fails on
   its own animation. `summarySeek(t)` asks for a beat by name.
8. **Online feeds the observer the reconciled predicted world**, because the client
   is handed no authoritative one. Written at the wiring, and in the brief.
9. **Four mutations verified RED** before the suite was trusted: a skip landing
   50 ms early, the Crush case showing `0`, no collapse past three level-ups, and
   a first fill not paid in full. Each failed exactly the test that names it.

## VERIFIED

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — **259 files, 4521 tests, all passing** (496 s), taken at
  `8f407ca`; `d2a64ed` after it touches only the audio wiring in `src/main.ts`,
  which no unit test covers, and typechecks clean.
- Golden suite (`tests/mobile/goldens.spec.ts`, both projects): **38 passed**, on
  the re-baselined `desktop-end-of-match`; the `phone-portrait-eliminated` shot
  did not move. The end-of-match golden was re-run twice more and held.
- Evidence reproduces: `npm run build && node evidence/…/capture.mjs`.

## NEXT

- Nothing outstanding once CI is green on the PR.
- **For QA (pr-08):** the re-baselined end-of-match golden reads its numbers off a
  LIVE match (MATCH TIME, the XP total, the bar), so they move a little with how
  fast the runner boots. It held across three runs here, inside the spec's own
  tolerance. If it ever proves marginal, `__endScreenStage.summarySeek` +
  `career()` are the seams to pin it with — that spec is QA's file, not this
  lane's.
- **For the netcode lane, if it ever wants it:** an authoritative `World` exposed
  beside the predicted one would let the accrual observer meet the plan's rule
  online as exactly as it does offline.
- **Still the developer's call:** Question C (a station the Crush killed) — it
  ships as `—`, and `lastHitBy` is a one-line change if they want the last player
  to damage it credited instead.
