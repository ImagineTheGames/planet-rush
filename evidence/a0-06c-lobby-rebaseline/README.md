# a0-06c — the lobby re-baseline, audited

**Owner:** Bot Engineer. **Branch:** `agent/bots/a0-06-pick-the-character`.
**Tree audited:** `22bf4e7` — which is `origin/main`, i.e. main *after* PR #319 merged.

The brief for a0-06c was written while PR #319 was red on four lobby goldens.
It merged at **2026-08-09 06:30 UTC**, carrying its own re-baseline (`08754f2`),
and main's push run `31299052491` is green on all six mobile shards. So the
re-baseline this brief asked for had already landed by the time the brief ran.

What was **not** done, and is what this directory contains, is the brief's item 3:
*confirm that what moved is only the seat rows.* That is the check a re-baseline
is supposed to survive, and it had never been made as a measurement.

**It does not survive it.** One frame carries a real regression — see finding 4.

---

## How the three-way comparison was built

A re-baseline has to separate three different things that all land in the same
PNG, so three renders were produced rather than two:

| | what it is | how |
|---|---|---|
| **A** | the baseline CI was *comparing against* before #319 — shot at a0-07 (`7ffc837`) | the committed PNG at `2d3f29b` |
| **B** | what main **without the character picker** actually renders **today** | a throwaway `git worktree` at `2d3f29b`, the five lobby baselines deleted, forced fresh writes on an isolated port |
| **C** | the baseline that landed in main with #319 | the committed PNG at `22bf4e7` |

`B → C` is a0-06's own delta, with every other brief's contribution held still.
`A → B` is the drift that had accumulated on main **without** any re-baseline.
Splitting them is the only way to say which brief owns which pixel, and it is why
`--update-snapshots` cannot answer this question: it leaves a snapshot alone when
it passes within `maxDiffPixelRatio`, so it cannot distinguish *"matches"* from
*"drifted, but under budget."* Delete the file and force the write instead.

Every run was on a **private preview port** (`PREVIEW_PORT=4196` / `4197`).
The shared 4173 is `reuseExistingServer: !CI` and three lanes share this box, so a
run there can silently shoot another lane's bundle — a0-06 lost a session to
exactly that. The build badge in each frame's footer names the tree it was shot
from, which is how the bundle under test is verified rather than assumed.

**Control, before any of this was trusted:** the five lobby goldens plus the three
untouched SETTINGS goldens were run against the committed baselines on this box —
**8 passed**. This container reproduces CI.

---

## 1. The landed baselines are current. There is nothing to re-shoot.

`band-compare.txt` PART 1. Committed baseline vs a forced fresh write on today's
tree, all five frames. The **only** band that differs in any of them:

| frame | differing band | what it is |
|---|---|---|
| `desktop-lobby`, `desktop-lobby-teams` | y 782–789, x 8–50 | the build-sha stamp |
| `phone-landscape-lobby`, `…-teams` | y 371–378, x 9–49 | the build-sha stamp |
| `phone-portrait-lobby` | x 11–18, rows 9–49 | the same stamp, through the 90° lock |

`zoom/4-badge-baseline.png` vs `zoom/4-badge-freshwrite.png` shows it directly:
`5c7b991*` (when the baseline was shot) against `22bf4e7*` (today's HEAD). It is
`src/render/build-badge.ts`, it reads a different sha every run by design, and at
~180 px it sits far under the 1 % tolerance.

**So no lobby baseline in main is stale, and re-shooting one would write a new sha
stamp and nothing else.** This is the reason this branch changes no PNG: the
honest re-baseline count here is zero, and churning five baselines to make a
snapshot-diff gate go green would put a false claim in the history.

## 2. a0-06's own delta is confined to the roster panel

`band-compare.txt` PART 2 (**B → C**). Desktop: one band, `y 238–679, x 152–746`.
The roster panel spans x 44–751 and **the arena cards begin at x 765** — they show
zero differing pixels, as do the four hull tiles, the `CREW MUSTER` header, the
`MODE` and `YIELD` controls, `BACK`, `RUSH!` and the `1 PLAYING · 7 BOTS` footer.
The band starts at y 238, which is exactly the top of the **P2** row: the human's
`YOU` row does not move in FFA.

Inside the roster, three things change, and all three are the brief's:

- **the `?` affordance** — a new trailing cell on every bot row (GDD §2.1: *"Every
  bot row carries a `?`"*);
- **the tier moves left onto the inert surface** — 38 px on desktop, measured;
  it stopped being a control, so it stopped being a raised plate;
- **the three Hard characters rotate one seat** — `Vulture/Warden/Sable` in P6–P8
  becomes `Sable/Vulture/Warden`. Same cast, same seven characters, and the tier
  column per seat is unchanged (`EASY EASY MEDIUM MEDIUM HARD HARD HARD` before
  and after). This is the cast seam resolving the character directly instead of
  resolving it from a tier.

In TEAMS the band starts higher (y 175) for one reason: P1 carries a side chip in
TEAMS and none in FFA, so the human's row shifts left with the rest of the column.
The side wording, its colour and the A/B assignment are identical row for row, and
the `A 4 · B 4` footer is untouched.

## 3. The old baseline was hiding two other briefs' drift

`band-compare.txt` PART 3 (**A → B**) — *neither side of that pair contains the
character picker*, and they still differ by 22 214 px on desktop:

- **`OPEN` → `BOT`** in the state column (x 64–102; five clean 10-row bands at the
  P2–P6 rows, the P7/P8 pair merged into the band below) — that is **a0-11**;
- **four arena cards → six** (y 572–679, x out to 1227, adding `The Line` and
  `The Crescents`) — that is **a0-12**.

Both landed on main **without** re-baselining and both survived because their
drift sat under the 1 % budget. `frames/6-stale-baseline-*.png` is that stale
baseline: it says `OPEN` on every bot row and draws four arenas. a0-06's ~2 % is
what finally tipped an already-drifted baseline over the line, and the frames that
landed necessarily capture a0-11's and a0-12's changes too. **That content is in
the new baselines and it is not a0-06's** — it is the unavoidable shape of
re-shooting a frame three briefs have moved.

---

## 4. ⚠ REGRESSION — the side label is no longer a word at 390 px

**`phone-landscape-lobby-teams`, and it is in main.**

`zoom/2-teamchip-390-before.png` → `zoom/2-teamchip-390-after.png`, and
`measure-team-chip.txt` for the numbers. The P3 row's `FRIENDLY A` chip:

| | chip ink | the word's box |
|---|---|---|
| before (main without the picker) | 115 px | 56 × 6 px |
| after (the landed baseline) | **33 px** | **19 × 3 px** |
| desktop control, before → after | 239 px → **239 px** | 71 × 24 px, *translated 38 px left* |

The desktop chip is **bit-for-bit identical** — same ink, same box, same per-row
profile — it only moves. The 390 px chip loses 71 % of its ink and renders
`FRIENDLY` as eight glyphs in 19 px at a 3 px cap height: a blue smear, not a
word. `EASY` in the cell beside it stays perfectly legible, which is what makes
the contrast unarguable.

**Why this is a defect and not a trade-off.** GDD §2.1: *"Color reinforces the
word; it never replaces it … the readout survives with the hue removed."* §2.2
records why the label exists at all — a Teams match was played in which it was
*"impossible to know who is on your team,"* and colour alone could not answer it.
A side label that is legible only by its hue is precisely the failure the
amendment was ratified to prevent, and it fails on the platform the parity
principle (§2.4) exists to protect.

**And the screen already knows the right answer.** `src/ui/lobby-view.ts:657`
drops the hull sub-label **whole** rather than scaling it, with the reason stated
in the code: *"a landscape phone's 233px row leaves ~40px of body, and `EXCAVATOR`
fitted into 40px is a 5px smudge, not a word."* That is the row's ratified ladder.
The team chip does not follow it — it scales into exactly the smudge the ladder
forbids. The fix is to make the chip obey the screen's own grammar (drop to the
absolute letter `A`/`B`, which §2.1 says is the half that keeps sides apart, and
drop the relative word whole when it will not fit).

**Cause:** the `?` is a *sixth* column on a row that already carried five, and at
390 px the team chip is what gives up the width. Both the `?` and the side label
are ratified, so this is a real collision and the resolution is a design call.

**Not fixed here, deliberately.** `src/ui/lobby-view.ts` is the UI Engineer's file
and this lane does not touch `src/ui/`. Flagged for the Director in the PR body.

## 5. Not a defect: the hull sub-label at 390 px

`zoom/1-hullline-390-before.png` → `zoom/1-hullline-390-after.png`. The narrower
name cell drops the hull word from the longer classes — `Bolt` loses
`INTERCEPTOR`, `Foreman` loses `EXCAVATOR`, `Vulture` loses `VANGUARD` — while
`Rusty` and `Patch` keep `HAULER`. That is `twoLines` in `lobby-view.ts:657`
behaving exactly as specified: dropped **whole**, never clipped, never scaled.
Worth knowing, and worth stating that the ladder is doing its job rather than
failing; contrast finding 4, where the same row scales instead of dropping.

---

## Files

- `frames/1..5-*` — **before (B) / after (C)** for all five lobby goldens, desktop
  and 390 px landscape and portrait-held, FFA and TEAMS.
- `frames/6-stale-baseline-*` — **A**, the a0-07 baseline CI compared against:
  `OPEN` on every bot row, four arena cards.
- `zoom/1-hullline-390-*` — the hull line dropping (finding 5), 5×.
- `zoom/2-teamchip-390-*` — **the regression** (finding 4), 10×.
- `zoom/3-teamchip-desktop-*` — the desktop control for it, 5×.
- `zoom/4-badge-*` — the sha stamp: the only thing a fresh write changes.
- `band-compare.txt` — all three comparisons, every frame.
- `measure-team-chip.txt` — the chip-ink measurement behind finding 4.
- `crop.mjs`, `measure-team-chip.mjs` — the two tools, so every number re-runs.
  Band bands come from `evidence/a0-14b-menu-rebaseline/band-compare.mjs`.
