# r6-01-unstick-l2-industrial-voice-sweep.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

Branch `agent/ui/l2-industrial-voice-sweep`, PR **#283** (no new PR opened).
r1-01 left it at `a39ec41`; the fix is four commits on top.

- `34cca20` — merge `origin/main` (29 commits behind). One source conflict
  (`lobby-view.ts`, two hunks) + 6 binary goldens.
- `dc39b61` — **the actual cause of the 43-hour red**: the fit spec measured a
  font the app stopped drawing in. Import the stack instead of retyping it.
- `e2993de` — the one label that genuinely overflowed, shortened.
- (session 2) second merge of `origin/main` — clean, no conflicts, art evidence
  only (a2-08 re-shot the rock on c2d401f). Ancestry line satisfied.

**Session 2 verified, in the merged tree:** `tsc --noEmit` clean; the fit spec
**green on all three projects, zero OVER rows**, solo hint 376/420px at 10%
headroom on desktop/pixel/iphone alike.

- (session 3) `289f56c` — third merge of `origin/main` (24 behind: u7-06/r5-01's
  upgrade wheel, q9-01's golden retry). **Clean, zero conflicts.** Touches
  `src/ui/{build-wheel-view,build-wheel,hud-geometry,index,upgrade-wheel,
  wheel-stack}.ts` — none of them a voice file, and neither `lobby-entry.ts`,
  `lobby-view.ts` nor the fit spec moved. Ancestry line satisfied.

**Session 3 verified, in the thrice-merged tree:** `tsc --noEmit` clean;
`npm test -- --run` **3830/3831**, the single failure the known-not-mine
capacity perf assertion below.

## DECISIONS

**READ FIRST — local and origin disagree EVERY session, and the direction
flips.** Session 1: local sat at the merge-base `03c7b88` with the real work
only on `origin/`. Session 2: the opposite — local held all three commits and
`origin/` was still back at r1-01's `a39ec41`, i.e. session 1 never pushed.
Always run `git rev-parse HEAD origin/<branch>` and read it BOTH ways before
touching anything; never assume which side is behind.

**The failure was NOT the copy alone — the spec was measuring the wrong font.**
This is why r1-01's unstick did not fix it and why the brief's "reproduce
locally" step produces a GREEN run on the unmodified branch. Do not conclude
from a green local run that the spec is flaky:

```
container  no DejaVu installed -> generic `monospace` -> WenQuanYi Zen Hei Mono
           5.500px/char @11px  -> solo hint 385/420, "8% headroom", GREEN
CI runner  has DejaVu          -> matches the named face
           6.626px/char        -> solo hint 464/420, OVER, RED
```

`voice-copy-fit.spec.ts` carried **its own copy** of the two font stacks, and
the body one said `"DejaVu Sans Mono"` — a value a1-01 had ALREADY retired on
main in `bb054ad`, whose title is literally *"name a body face both gating
machines have, and stop copying the stack"*. This spec forked before that landed
and auto-merged clean, so the stale copy survived with nothing to catch it. The
app draws in `Oxanium, "Liberation Mono", monospace`.

Importing the stack is a **strictness increase, not a relaxation** — Liberation
Mono is 20% wider than the WenQuanYi the container was silently substituting.
Boxes, thresholds and `toEqual([])` are all untouched. After the import the
failure reproduces in the container at **462/420px**, within 0.4% of the
runner's 464. `lobby-view.ts:118` already mandates exactly this in prose for
source files; the spec was the one place still retyping it.

**Then the copy really was too long, and the sweep is what broke it.** Measured
in the honest face the pre-sweep line (`'Set up the match. Bots fill the seats,
no connection needed.'`, 60 chars) fit at 6% headroom; the sweep's rewrite took
it to 70 chars / 462px into a 420px door. `drawDoor` centres and lets text
spill, so it spilled 44px in silence. Budget is **63 chars at 11px**
(420 / 6.601). Now 57 chars / 376px / 10% headroom.

`'No connection needed.'` -> `'Offline.'`. Not a shortening invented to fit:
§4.7's vocabulary table ratifies *held / lost / offline / refused*, and this
codebase already calls this door the offline one — `voice-door-labels.test.ts`
requires every "still works" refusal to name THE OFFLINE DOOR by its label.

**Rejected:** trimming the middle sentence and keeping "No connection needed."
The best variant (`'Bots hold the seats.'`) lands on 64 chars / 422px — ONE over
budget. It would only ever have gone green by rounding luck.

**The merge had the same shape r1-01 documented, including one silent trap.**
Main's side won both hunks; the ratified vocabulary re-applied on top.

- `drawRush`/`hintText`: main's side of the conflict is **empty** because main
  MOVED that logic into the draw path (~455) and hoisted `hintText` to module
  scope (1186). Taking HEAD would have compiled, passed, and parked the sweep's
  `WAITING FOR THE CLAIM HOLDER` in **dead code** while the live path still said
  `WAITING FOR THE HOST`. Always grep the merged file for the symbols in a
  conflict hunk before keeping your side of it.
- `LOBBY_EYEBROW`: u7-03 extracted this string out of the view and, forking from
  before the sweep, carried the pre-sweep `'ROOM'` up into the new constant
  (merge base confirms base said `ROOM`). Restored to `'CLAIM'` — that keeps
  u7-03's extraction AND the sweep. u7-03's own comment says it moved the string
  out so "the copy sweep reads the models", so this is the intended use.

**Known-not-mine (verified, do not patch around):**
- `tests/net/capacity/capacity-regression.test.ts` — wall-clock perf assertion
  (`maxLagMs < 33`). Server/netcode territory, touches nothing this branch
  changed. **Session 3 correction:** session 2's note said it "passes in
  isolation (4/4)". That is no longer true — on a 3-lane box it now fails
  isolated too, at **33.75 vs 33** (3 passed / 1 failed), i.e. 2% over. It is
  not a load-only artefact any more, it is a perf assertion with no headroom on
  shared hardware. Still provably not this branch's: the spec imports only
  `src/net/snapshot`, `src/net/wire`, `server/match-server` and `./core-speed`,
  and this branch's entire diff vs `origin/main` is `src/ui/`, `tests/mobile/`,
  goldens and evidence PNGs — zero overlap. Do not "fix" it here; it belongs to
  whoever owns `server/`.

**The mobile suite must NOT be run as bare `npm run test:mobile` on this box.**
`playwright.config.ts:143` sets `reuseExistingServer: !process.env.CI`, and `CI`
is unset in the container. Something was already serving on the pinned port
4173 — `curl localhost:4173/version.json` returned sha **`f26aae4`**, which is
not this lane's HEAD (`289f56c`). `/lanes/` holds lane-1/2/3, so a sibling lane's
bundle would have been screenshotted and diffed against MY goldens, silently.
That is a1-01's stale-bundle trap, and it invalidates a whole green run.

Ran `npx playwright test --config playwright.isolated.config.ts` instead —
r5-01's scratch config, private port 4193, `reuseExistingServer: false`, builds
and serves this lane's own bundle. It is **untracked and stays untracked** (its
own header says NOT FOR COMMIT). Verify `/version.json` matches HEAD every run.

## NEXT

**Session 3 closed every item on the previous NEXT list.** State as of `dd9267e`:

- Full mobile suite: **123 passed, 90 skipped, 0 failed** on the isolated port.
  No golden moved — the merged upgrade-wheel baselines passed as they arrived,
  and the copy change lands on the doors screen, which is not a golden. Nothing
  needed re-shooting and no tolerance was touched.
- **Pushed** fast-forward `a39ec41..dd9267e`. Local and origin now agree — the
  first session in three where they do. Verify anyway next time (see READ FIRST).
- #283 body updated with the before/after tables for all three projects. The
  "before" is lifted from the red job's own log via
  `gh run view 31170868030 --log-failed`, not reconstructed — worth reusing,
  it is much better evidence than a locally re-created failure.
- `dd9267e` — the three voiced screens re-shot on the merged tree.

**CI on #283 is GREEN.** The 43-hour red is closed:

```
Mobile emulation (Playwright)   pass   29m37s
Typecheck, test, build          pass    6m33s
```

`mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Nothing outstanding, nothing
blocked, no other brief's work reversed anywhere in this branch. The branch is
ready for review/merge; that call is not mine to make.

If CI is still red, do NOT assume the copy again — the local instrument now
agrees with the runner to 0.2% (`ENTRY_ERRORS.full` 454 here / 455 there), so a
fresh fit-spec failure would mean a genuinely new label, not this one. Check
first whether the failure is `capacity-regression` (not ours, see above) or a
golden from a lane that landed after `289f56c`.
