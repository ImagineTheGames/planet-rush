# a0-41 — the golden re-baseline, image by image

Four frames re-baselined, out of the 35 in `tests/mobile/goldens.spec.ts`. Every
one was read at 4× before it was written, and each is listed below with the
clusters that moved and why.

## The method (a0-03's, because the trap is the same)

**A text change cannot fail a golden.** `GOLDEN` is `maxDiffPixelRatio: 0.01`;
the four cost numerals on this wheel are ~1–4 k px of a 1.02 MP desktop frame
(0.1–0.4%), well inside the gate. The suite was green before AND after this
change while the stored PNGs still pictured `3/99`. Two consequences:

1. The stale frames had to be **found** by re-running once at
   `maxDiffPixelRatio: 0`, then localizing each diff to a cluster
   (`evidence/a0-03-wheel-cost/localize-diffs.mjs`) and reading both halves at 4×
   (`evidence/a0-03-wheel-cost/crop.mjs`). Both tools reused as-is.
2. `--update-snapshots` had to run at tolerance 0 as well: at 0.01 the four tests
   PASS, and Playwright does not rewrite a passing snapshot. A re-baseline run at
   the shipped tolerance rewrites nothing and reports success — which is a green
   that changed no pixels.

The tolerance edit is **not committed**. It is the right number (it exists for
font/GPU antialiasing) and `tests/mobile/goldens.spec.ts` is byte-identical to
what is on the branch — `git status` on it is clean.

**Private port.** The run used
`evidence/a0-41-cost-every-page/playwright.a041.config.ts`: port 4211, own build,
`reuseExistingServer: false`. The committed config pins 4173 with
`reuseExistingServer: !CI` and the lanes share this box, so re-baselining against
whichever lane started `vite preview` first would bake another lane's pixels into
this branch.

**One trap worth writing down for the next lane.** Playwright resolves a config's
relative paths against the CONFIG's directory. This config does not sit at the
repo root, so `testDir` had to be re-anchored explicitly — left implicit it
resolved to `evidence/a0-41-cost-every-page/tests/mobile`, which exists nowhere,
and the run exited **0** with "No tests found". A green that ran nothing.

## The four frames

| golden | changed px | clusters | what moved |
|---|---|---|---|
| `desktop-upgrade-wheel-desktop-linux.png` | 4556 / 1.02 MP | 4 | HULL `3/99`→`3`, ENGINE `3/99`→`3`, CARGO `2/99`→`2` — plus the rider below |
| `desktop-upgrade-wheel-short-desktop-linux.png` | 4033 / 1.02 MP | 4 | the same three, in threat red: `3/1`→`3`, `3/1`→`3`, `2/1`→`2` — plus the rider |
| `phone-landscape-upgrade-wheel-iphone-linux.png` | 760 / 2.96 MP | 3 | the same three at the phone's 9 px cost size. **No rider** |
| `phone-portrait-upgrade-wheel-iphone-linux.png` | 760 / 2.96 MP | 3 | the same three, through the landscape lock. **No rider** |

Read at 4× on all four: the stat line (`50 → 60`, `100% → 115%`, `2 → 4`), the
ladder pips `○○○`, the hub's `99` / `1` and its `VANGUARD` / `BACK · ESC`, and
WEAPON's `OPEN ▸` with its DAMAGE/SPEED pip rows are **pixel-identical**. The
only thing that moved in the wheel is the cost numeral, and its COLOUR did not
move: yellow at 99 ore, red at 1.

## The rider on the two DESKTOP frames, stated rather than smuggled

Both desktop frames carry a **fourth cluster**, 3077 px at `[0,744]–[504,792]` —
the controls strip along the bottom edge:

- stored: `WASD Thrust · Left mouse Fire / Mine · E Build & Upgrade`
- now: `Click anywhere Move or attack · E Build & Upgrade`

**This is not mine.** It is `1862e3b feat(a0-37): the strip reads the scheme the
player is in, from the one map` (2026-08-13), landing on top of a0-30's Tap
Commander / auto-aim default — both already on `main`, both ancestors of this
branch, and these two upgrade goldens were never re-baselined for them.
`git merge-base --is-ancestor 1862e3b HEAD` is true.

A golden is a whole frame, so it cannot be separated: re-baselining the cost
numerals on these two frames necessarily adopts the strip a0-37 already shipped.
Adopting it is correct — it is what the build draws today — but it is another
lane's pixels in a cost-label PR, so it is named here and in the PR body rather
than left for a reviewer to notice. The two phone frames have no such rider: on
touch the visible controls replace the strip.

## What was NOT re-baselined

The 31 other frames, including every build-wheel golden. The build wheel's cost
label is textually unchanged by this branch (`segmentCostLabel` now calls the
shared `costNumeral`, which returns exactly what it returned before), so those
frames have no diff of mine in them. Some of them almost certainly carry the same
pre-existing `main` drift as the two desktop frames above — adopting it in a
cost-label PR would be pulling other lanes' work into this diff (LESSONS §14),
and it belongs to whoever owns those screens.
