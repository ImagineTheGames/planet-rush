# Mobile journey budgets — q7-01

**Branch `agent/qa/q7-mobile-journey-budgets` · owner: QA Agent · verified
in-container against the real preview build (`npm run test:mobile`, Playwright
1.49.1, Chromium 1148).**

`main` was red for two days at `11659df` on one test — `[iphone]
centering.spec.ts:185`, "camera keeps the ship centred at boot and after 2s
thrust (portrait)" — which timed out at 60 s on the runner and again on the CI
retry, while passing in 20.7 s in a container matching the runner's environment.
Nothing was broken. The test was being cut off mid-journey by a budget sized for
a different kind of test.

---

## A. What was actually wrong

Two independent defects, both of them the same mistake in different clothes: a
**wall-clock number standing in for an amount of work**.

**1. The budget was flat.** `playwright.config.ts` gave every test 60 s. That is
correct for a two-assertion check and wrong for a journey — orient, boot the
debug build, assert centring, hold thrust, settle, assert again — on a host where
WebGL is rasterized in software. Measured whole-suite ratio at `11659df`: **8.9
min on the runner vs 1.5 min in-container = 5.9×**, inside the 3–10× band
LESSONS §5 records. 20.7 s × 5.9 ≈ 122 s against a 60 s cap.

**2. The thrust hold was in milliseconds.** `THRUST_MS = 2000` with a
`waitForTimeout`-paced touch hold. The game loop clamps how much simulation a
slow frame may catch up on (`loop.ts` `MAX_FRAME_SECONDS` = 0.25 s ⇒ ≤ 15 fixed
steps per rendered frame), so at the runner's ~1 fps those 2 wall seconds bought
roughly **30 ticks of ship travel where a laptop got 120**. The follow-camera was
being asked to track a quarter of the journey on precisely the machine that gates
merges — the test was not only slower in CI, it was *proving less* there.

Defect 2 is why this class of flake keeps coming back, and it is the half that a
bigger timeout would have hidden rather than fixed.

---

## B. What changed

### B.1 Every test declares its work; the budget follows

`tests/mobile/budgets.ts` + `budget-model.ts`:

```
budget = max(60 s floor, roundUpTo30s(measured in-container seconds × 10))
```

`measuredSeconds` is the test's own cost on its slowest project, measured by the
run in §C. The ×10 allowance is the top of the LESSONS §5 software-GL band (the
observed figure was 5.9×); the floor is what keeps this from becoming the blanket
`timeout` bump it exists to avoid. Call sites read:

```ts
budgetTest({
  work: 'orient → boot the debug build → assert centred → hold thrust for 2 s of SIM → settle → assert centred',
  measuredSeconds: 16,
});
```

The `work` line is the reviewable part: a reader can judge whether the number
matches the journey without running it. Each budget is also pushed as a Playwright
annotation, so a CI report shows the budget beside the duration it bounded.

### B.2 Time bases moved onto the sim clock

`tests/mobile/sim-clock.ts` waits on `window.__planetRush.ticks` (the ratified
`?debug=1` instrument) instead of milliseconds. Converted here:

| where | was | now |
|---|---|---|
| `centering` thrust hold | `waitForTimeout(2000)` + a 50 ms-paced touchmove loop | 120 sim ticks, stick held to `touchEnd` |
| `centering` post-input settle | `waitForTimeout(200)` | 12 sim ticks |
| `emulation` boot settle | `waitForTimeout(900)` | 60 sim ticks |
| `emulation` rotation settle | `waitForTimeout(900)` | 60 sim ticks |
| `build-flow` construction wait | local rAF tick poll | shared waiter (adds the watchdog below) |

Two wall-clock waits stay and say why in place: the **debug-hook-ABSENT** test
(the thing under test is that no instrument exists, so there is no clock to wait
on) and the **frozen goldens** (`?freeze=1` pins the sim; the frame is
time-invariant, so an "early" wait screenshots the same deterministic frame).

### B.3 A stall watchdog, so the bigger budgets stay honest

Waiting on sim progress instead of a stopwatch would, alone, mean a sim that
stopped ticking hangs until the journey budget expires — a hung match dressed as
a slow one, which the QA charter forbids. So the waiter carries its own liveness
bound: **10 s with no tick at all fails immediately**, naming how far it got.

That separation is the point of the whole change. **Budgets bound the slow; the
watchdog, the per-wait `waitForFunction` caps (15–30 s) and `expect.timeout`
(10 s) bound the stuck.** A hang still fails in seconds; the journey budget is
only ever spent on work that is genuinely running.

### B.4 The rule is mechanical now

LESSONS §5 already said to budget journeys rather than raise the global timeout.
It was written down and never encoded, so it recurred. `tests/mobile-budget-
contract.test.ts` (vitest — no browser time, fails on the cheapest CI job) now
enforces:

1. every `test()` in `tests/mobile/` declares a budget via `budgetTest()`;
2. no spec hand-rolls `test.setTimeout()` or `test.slow()`;
3. the arithmetic holds, **including that a cheap test still gets the floor**.

---

## C. The numbers

Full suite, this lane's container, against the built preview bundle. Before =
`main` at `11659df`; after = this branch. Slowest project shown; `—` = skipped
for that profile.

| spec › test | before (iphone / pixel / desktop) | after (iphone / pixel / desktop) | budget |
|---|---|---|---|
| `centering` › centred, landscape | 26.3 / 22.6 / 5.3 | **12.4 / 10.7 / 6.3** | 180 s |
| `centering` › centred, portrait | 27.3 / 23.9 / 4.6 | **14.9 / 15.4 / 5.7** | 180 s |
| `centering` › hook ABSENT | 2.2 / 2.1 / 1.7 | 3.8 / 4.1 / 1.8 | 60 s (floor) |
| `build-flow` › full build cycle | 28.0 / 24.0 / — | 28.4 / 25.6 / — | 300 s |
| `build-flow` › wheel BACK cycle | 23.4 / 21.0 / — | 20.6 / 22.5 / — | 240 s |
| `landscape-lock` › portrait boot | 3.0 / 3.3 / 1.1 | 3.6 / 3.1 / 1.3 | 60 s (floor) |
| `landscape-lock` › rotate ×2 | 6.6 / 5.9 / — | 7.5 / 6.5 / — | 90 s |
| `landscape-lock` › three taps → match | 27.2 / 22.5 / — | 23.4 / 26.8 / — | 270 s |
| `landscape-lock` › in-match centred | 3.8 / 2.2 / 1.5 | 3.8 / 2.2 / 1.9 | 60 s (floor) |
| `emulation` › FIRE + ghost stick | — / 5.6 / — | 7.0 / 8.2 / — | 90 s |
| `emulation` › portrait renders | 11.4 / 10.2 / — | 13.4 / 13.8 / — | 150 s |
| `emulation` › drag moves the ship | 14.4 / 11.7 / — | 13.8 / 13.8 / — | 150 s |
| `emulation` › desktop control | — / — / 3.1 | — / — / 4.8 | 60 s (floor) |
| `layout` › portrait-locked | 5.7 / 5.5 / — | 5.0 / 5.6 / — | 60 s (floor) |
| `layout` › landscape | 5.3 / 5.6 / — | 5.1 / 5.0 / — | 60 s (floor) |
| `layout` › desktop | — / — / 1.6 | — / — / 2.8 | 60 s (floor) |
| `goldens` › desktop frozen | — / — / 2.9 | — / — / 4.5 | 60 s (floor) |
| `goldens` › phone frozen | (not captured) | 8.0 / — / — | 90 s |
| **suite** | **2.5 min** | **2.6 min** | — |

Each column is a single run. Repeat runs of the same tree move a test by a
couple of seconds either way (`build-flow` read 28.4 s and 30.3 s on two
consecutive green runs), which is one more reason the allowance is ×10 rather
than the ×5.9 that was observed.

**Seven of the eighteen tests are back on the flat floor.** That is the check
that this is a sweep and not a blanket bump.

**Centring got cheaper while proving more.** 27.3 s → 15.4 s. The old hold paid a
CDP round-trip every 50 ms to re-dispatch a `touchMove` that changed nothing — a
virtual stick holds its deflection until `touchEnd` (`touch.ts`), so those events
were pacing, not input. The hold now delivers a full 120 ticks on any host.

**Estimated runner cost.** At the observed 5.9×, the worst journey
(`build-flow`, 28.4 s in-container, with ~650 of its ticks re-priced at the
runner's ~15 ticks/s) lands near ~150 s against a 300 s budget. The formerly
red `centering` portrait journey lands near ~70 s against 180 s. Both have room
for a runner having a bad day, which is what the ×10 rather than ×5.9 buys.

---

## D. What is not claimed

- **The runner itself is not measured here.** Every figure above is in-container.
  The 5.9× ratio comes from the QA Manager's reproduction at `11659df`; the
  budgets are sized from it, and the first CI run on this branch is the check.
- **Nothing about what renders changed.** `goldens.spec.ts-snapshots/` is
  untouched and both golden tests pass on this branch — the only edits to
  `goldens.spec.ts` are a budget declaration and a comment.
- **No assertion was weakened.** Every threshold, tolerance and expectation in the
  suite is unchanged. The one semantic change is in the other direction: the
  thrust hold and the two settles now deliver *more* simulation in CI than they
  did, not less.

---

## E. Reproduce

```
npx tsc --noEmit
npm test -- --run           # includes tests/mobile-budget-contract.test.ts
npm run test:mobile         # 37 passed, 17 skipped, 2.6 min
```
