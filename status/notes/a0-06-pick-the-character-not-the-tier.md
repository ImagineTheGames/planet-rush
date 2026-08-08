# a0-06-pick-the-character-not-the-tier.md — working notes (bots)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/bots/a0-06-pick-the-character`

## BUILT

**`87cba02` — the lobby picks the character, and the pick reaches the match.**

- `src/bots/harness.ts` `fillEmptySlots` gained a 5th arg, `cast?: (PersonalityId
  | null | undefined)[]` **indexed by slot** — deliberately the same shape and the
  same "absent entry falls back" rule the existing `teams` table has. An unknown
  string in it is ignored rather than seated, so a stale saved lobby cannot build
  a bot with no personality row behind it.
- `src/bots/personalities.ts` `castDisplayNames(cast)` — the duplicate answer:
  numbers a name **only when it repeats** (`Warden 1` / `Warden 2`), in slot order.
- `src/platform/match-boot.ts` `MatchBootConfig.cast` — **the field whose absence
  was the whole bug.** `bootOfflineMatch` now passes it into `fillEmptySlots`.
- `src/ui/lobby.ts` — `LobbySeat.difficulty` **deleted**, replaced by
  `LobbySeat.character: PersonalityId` (kept on every seat, exactly as the tier
  was, so a seat that empties and re-opens keeps its pick). `seatDifficulty(seat)`
  derives the tier. `cycleBotDifficulty` → `cycleSeatCharacter`.
  `defaultDifficultyForEmptySeat` → `defaultCharacterForEmptySeat`. New
  `lobbyRosterCast(state)` — dense, closed slots dropped, the twin of
  `lobbyRosterTeams`. `SEAT_HELP_GLYPH`.
- `src/ui/lobby-geometry.ts` / `lobby-view.ts` / `lobby-flow.ts` / `src/main.ts` —
  the row: `bar | STATE | body | team | tier | ?`.
- `src/main.ts` — `LobbyChoice.cast` → `bootOfflineMatch`; `rebuildNameTable` uses
  `castDisplayNames`; seam gained `seatCharacters`, `seatControls`,
  `seatHelpControls`, `worldCast`; `?` tap → `toggleSeatHint`.

**`9221629` — tests, the geometry re-derivation, and the GDD/docs.**

- `src/bots/cast-seam.test.ts` (new) — pins the SEAM: exact cast in/out,
  duplicates round-trip, same seed + same cast twice, **and** a different cast on
  the same seed plays differently (so the determinism claim is not vacuous).
- `src/platform/match-boot.test.ts` — the same through `bootOfflineMatch`,
  including "an absent cast boots byte-for-byte as before".
- **A real regression, caught here:** the first cut of the `?` took its width off
  the far right and the SIDE chip — measured last — fell to **zero** on the
  notched landscape phone. `seatTrailing()` now places all three together with the
  order of surrender stated once (see DECISIONS). Two new geometry tests pin it.
- GDD §2.1 and §2.9 amended in place; `docs/design-amendments.md` entry added.
  (These rode in on this commit's `git add -A` rather than their own; the content
  is on the branch, the attribution is just a commit late.)

**`619e811` — the `?` worked on a desktop and did nothing at all on a phone.**

- A **touch** pointer ceases to exist the instant the finger lifts, so the browser
  fires `pointerleave` right after every tap's `pointerup`; the lobby's leave
  handler dismissed the dossier the tap had just opened, inside one frame. No
  error, nothing drawn, every unit test green, PC live-stage green. Fixed:
  `onPointerLeave` never dismisses a *pinned* dossier (a hover hint still dies
  there). **This is the whole reason the live-stage phone case exists.**
- `tests/live-stage/lobby-cast.spec.ts` (new) — real front door (PLAY → doors →
  PLAY SOLO), real taps, cast round trip + `?` by click (PC) + `?` by tap
  (390px landscape phone).

## DECISIONS

- **Why deleting the tier control beats wiring it through.** The two developer
  reports are two different bugs: "makes no sense / hard to balance" is about a
  two-step control, "I chose HARD and got other difficulties" is a dead wire.
  Fixing only the wire leaves the confusing control; fixing only the control
  leaves the setting inert. Storing the character and *deriving* the tier makes a
  mismatch **unrepresentable**, and the boot seam makes the pick real.
- **The row body cycles the CHARACTER; the seat-state cycle keeps only its leading
  control.** The body is where the row draws the NAME, so the tap that lands on a
  name changes it. The state control has been drawn and labelled since u5 (that
  was the whole point of u5), so nothing became undiscoverable. **A CLOSED row is
  the exception and it is one rule, not a special case:** the body edits whatever
  the row is *showing*, and a closed row shows no character, so it still re-opens.
- **The tier chip keeps its rect and stops being a target.** Drawn on the `inert`
  surface, not the raised `secondary` plate — the screen already keeps "a
  dead-looking button beats a lying one"; a value that is not a button at all has
  to look like one even less. A tap on it falls through to the body rather than
  hitting a control that would have to refuse.
- **Order of surrender on a narrowing row** (`seatTrailing`, and this is the part
  that had to be re-derived after the regression): the `?` shrinks → the **tier
  chip** shrinks to `SEAT_CHIP_MIN` (40) to buy the `?` back above its floor → only
  then is the `?` dropped whole. The side chip's `SEAT_TEAM_CHIP_MIN` and the row
  body's `SEAT_ROW_BODY_MIN` are **never** spent. Result: every profile in QA's
  matrix — including the notched 844×390 landscape phone at a 205px row — carries
  all three. `MEDIUM` auto-fits down in a 40px chip, which is the ladder the side
  chip already keeps at its own floor; it is a value, not a control.
- **Duplicates allowed, repeats numbered.** 8 slots, 7 characters, 3 Hard: the
  developer's own balanced 4v4 is impossible without a repeat. Rejected: a livery
  variant (a new asset for a case the identity colour and the `P1`…`P8` decal
  already separate on the field) and doing nothing (two rows the host cannot tell
  apart while checking their own work). **Did not invent an eighth character** —
  the cast is GDD §2.9.
- **Name table keying:** already by SLOT (`main.ts` `rebuildNameTable`,
  `playerNameTable`), so nothing needed re-keying — only the numbering.
  `castDisplayNames` walks an indexed loop, not `Array.map`, because those callers
  build sparse arrays and `map` copies a hole through as a hole.
- **`castForEmptySeat` kept, scope narrowed.** It is no longer how a local lobby is
  authored; it survives only to fold an authoritative `lobbyState` in, because the
  wire carries a tier and no character and a seat the *server* re-tiered has to
  resolve to the name `server/room.ts` will really seat.
- **Rejected:** extending the wire with a `botPersonalities` row. It would need
  `src/net/transport.ts`, `wire.ts`, `session.ts` and `server/room.ts` — four files
  across two other agents' ownership, and outside this brief. See NEXT.

## NEXT

- **Known gap, stated in the PR and in `docs/design-amendments.md`: ONLINE carries
  the tier, not the name.** `LobbyChoiceMessage` has `botDifficulties` and no
  character row, so an online room seats the right *tiers* and may seat different
  *names* within them. Offline — the flavour both reports were filed against — is
  exact. Closing it is a Netcode seam: add `botPersonalities` beside
  `botDifficulties` (transport → wire → session → `room.ts` `castFor`).
- Nothing else outstanding. PR **#319** is open against `main` and MERGEABLE;
  branch pushed at `8ba1d53`.

### Session 2026-08-08 — re-merged main, re-ran every gate

`origin/main` had moved to `03ed194` (a0-04 nameplates-always-lit, PR #317), so
the `merge-base --is-ancestor` gate was FAILING at hand-off. Merged it in
(`22fa305`) — **clean, no conflicts**, though a0-04 also touches `src/main.ts`.
The two changes do not collide semantically: `rebuildNameTable` (`main.ts:1765`)
still owns `castDisplayNames`, and a0-04's work is in `src/ui/nameplates*`
*reading* the table this brief renumbered.

`8ba1d53` regenerates the four evidence frames against the post-a0-04 bundle —
the match frame's `Warden 1 (HARD)` nameplate now draws in a0-04's lit
treatment. `lobby-cast-readback.txt` did **not** change (lobby cast ≡ match cast,
duplicates and all), which is the actual proof; the PNGs are the picture of it.

### DoD status at hand-off

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — **3920 passed, 0 failed**, 235 files (post-merge; a0-04
  brought new `nameplates.test.ts` cases in). `capacity-regression` passed this
  time too — it only trips while other lanes run Playwright builds on the box.
- `npm run test:live-stage` — the three `lobby-cast` cases pass.

#### The live-stage baseline, measured this time instead of asserted

Ran the FULL suite on both sides, `origin/main` (`03ed194`) in a throwaway
worktree on an isolated port 4199 so the two could not collide:

| | failed | passed | skipped |
|---|---|---|---|
| `origin/main` | 30 | 66 | 3 |
| this branch | 34 | 65 | 3 |

`comm` on the two sorted failure lists: **every one of main's 30 also fails
here, and this branch adds exactly 4** —
`main-menu:357` (iPhone + Pixel), `ore-deposit:39`, `tap-markers:76`.
**All four PASS when re-run in isolation on this branch.** The only failure that
reproduces in isolation, `tap-markers:135`, is on main's list too. So the branch
adds **no** live-stage regression; the 4 are contention while other lanes build.

**Checked, do not re-litigate:** `codex-lobby`, `lobby-flow` and `map-picker`
fail here and look damning, because they are *lobby* specs and this brief rewrote
the lobby row. They are not mine. All 7 fail identically on `origin/main` with
the same trace — `__mainMenu.play()` then a 20s timeout waiting for
`window.__lobby.selectMap`. PLAY opens the **doors screen** now, so these specs
never reach the lobby at all. Verify by re-running, not by reading the names.

### Trap for a future you

`npm run test:live-stage` hard-codes port **4173** with `reuseExistingServer:
!CI`. Another lane's preview server was sitting on it, so the suite silently ran
against **that lane's bundle** and reported a seam field as `undefined` for half
an hour. If a live-stage readback looks impossible, check
`pgrep -fa "vite preview"` before you debug the app.

### Session 2026-08-08 (second) — re-merged main again, and the trap became a flag

**Read this before touching the branch.** This session began by branching fresh
off `main` and re-implementing the whole brief from scratch, because it did not
check `origin/agent/bots/a0-06-pick-the-character` first — the remote branch, the
note above, and PR **#319** were all already there. That duplicate work was
**discarded, not merged**: two rival implementations of one feature (`character`
vs `personality`, `castDisplayNames` vs `castNames`, `cast-seam.test.ts` vs
`cast-wiring.test.ts`) is a merge nobody should have to review. It survives only
as the local, unpushed branch `a0-06-local-duplicate-do-not-push`.

Worth recording because the duplicate independently reproduced two findings, which
is as close to confirmation as this repo gets:

- the **`pointerleave`-after-touch-`pointerup`** defect, found the same way (PC
  green, phone silently dead) and fixed the same way;
- the **port-4173 lane collision**, lost the same half hour to, before reading the
  trap note that was already on the branch.

So the trap is now a **mechanism** rather than a warning: `PREVIEW_PORT` overrides
the live-stage port (`a1bc039`), default unchanged. Marked as a separate,
proposed commit — `tests/live-stage/` is Platform's.

**What this session actually changed:** `main` had moved to `b32d0a7` (a0-07
darker backdrop, PR #320), so `merge-base --is-ancestor` was red again. Merged
(`1325a8f`) — **clean, no conflicts**; a0-07 is `src/art/backdrop*` and evidence,
which this brief does not touch.

#### DoD on the merged tree

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — **3962 passed, 2 failed of 3964.** Both failures are the
  same wall-clock benchmark, `tests/net/capacity/capacity-regression.test.ts`
  ("the loop stays inside the tick budget at 12 rooms"). It is **not this
  branch**: it failed identically on a clean `main` tree at the start of this
  session (`expected 98.83 to be less than 33`), and the box was at **load
  average 31 on 8 cores** with four other lanes' headless Chromium running. Same
  conclusion the previous session reached; do not chase it.
- `PREVIEW_PORT=4191 npm run test:live-stage -- lobby-cast.spec.ts` — **3 passed**
  on the merged tree (cast round trip, `?` by click, `?` by tap at 390px).
- GDD.md differs from `origin/main`; `merge-base --is-ancestor` OK.

### Session 2026-08-08 (third) — nothing was broken, so this one hardened and re-shot

Inherited the branch green: `595538d` pushed, PR **#319** OPEN and MERGEABLE with
CI green, `origin/main` at `b32d0a7` already an ancestor. **No feature work was
outstanding and none was invented.** Three things happened.

**1. The working tree held 41 modified evidence PNGs and none of them were mine
to commit.** A full live-stage run rewrites every `*-evidence.png` in the folder,
and the build badge stamps the commit hash into each frame, so *any* run dirties
*all* of them whether or not the picture changed. Restored with `git checkout --
tests/live-stage/` (**not** `git clean` — that is a hard rule, and it is also the
wrong tool: these are tracked files with committed content to return to).

**2. `9d65295` — re-shot the four evidence frames.** The committed set dated from
`8ba1d53`, which is *older* than this branch's merge of a0-07's darker backdrop
(`1325a8f`). The frames are now of the bundle the branch actually builds.
`lobby-cast-readback.txt` is byte-identical again — lobby cast ≡ seated cast,
duplicates and all. **The new match frame catches no rival nameplate** (it lands
at MATCH 0:02, the old one at 0:03) and that is honest rather than worse: at
match start every ship sits at its own station, which is exactly why the spec
writes the seven names to the readback instead of hoping a plate drifts into
shot. The nameplate in the old frame was luck.

**3. `6436687` — the cast guard now means what its comment says.** Reading the
seam rather than trusting this note, `fillEmptySlots` screened the cast table
with `chosen in PERSONALITIES`. `PERSONALITIES` is an **object literal**, so `in`
walks the prototype chain and `constructor`, `toString`, `hasOwnProperty`,
`__proto__` and `valueOf` all passed a check meant to admit seven strings.
Seating one yields a `BotSeat` whose personality row is a *function*, and
`createBots` then reads `.shipClass` off it and gets `undefined`.

**Unreachable today** — every cast on this branch comes from locally authored
lobby seats, and `applyLobbySlots` only ever assigns a `castForEmptySeat` result
(itself total: a bogus wire tier falls through `rosterAt` → `[]` → ROSTER). There
is no `JSON.parse` and no storage key behind a cast anywhere. But the guard's own
comment justifies itself by "a stale saved lobby", i.e. a path that does not
exist yet, and a guard that is load-bearing only in the future should be right
before that future lands. `hasOwnProperty.call`, plus a test over all five keys.
**Verified the test fails against the old `in`** — and note *which* assertion
discriminates: `PERSONALITIES['constructor']` is `Object`, so `toBeDefined()`
passes on the bug. The `expect(ROSTER).toContain(...)` is the one that catches it.
(`castDisplayNames` would have printed such a seat as **"Object"** —
`PERSONALITIES['constructor']?.name` is `Function.prototype.name`. Left alone: it
is fed from seated bots, which now pass the guard upstream.)

### Session 2026-08-08 (fourth) — re-ran every gate on the pushed head, and killed a scare

Inherited `6436687` with two commits **unpushed** and 36 evidence PNGs dirty in
the tree. Nothing was broken; no feature work was outstanding and none was
invented. Committed the note (`12d60d0`), pushed `595538d..12d60d0`
fast-forward, and re-ran the whole DoD.

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — **3965 passed, 0 failed**, 236 files.
- `npm run test:live-stage` (full, `PREVIEW_PORT=4193`) — 66 passed / 33 failed /
  3 skipped. **`lobby-cast.spec.ts` is not in the failure list**; its three cases
  pass, and pass again in isolation.
- GDD.md differs from `origin/main`; `merge-base --is-ancestor origin/main HEAD`
  OK against `b32d0a7`.

**The proof re-verified, not re-asserted:** the full run regenerated
`lobby-cast-readback.txt` **byte-identical** — a fresh boot of the real client
through the front door still seats exactly the cast the lobby picked, all seven
Hard with three Wardens / two Sables / two Vultures, `identical: true`. That file,
not the PNGs, is the evidence.

#### The scare, and why it was not ours

`unified-play-flow.spec.ts` failed **in isolation** (not just under contention) on
all three profiles, and its assertion block reads `lobbyPresent` — close enough to
this branch's lobby work to be worth an hour. It is not ours, and the reason is
worth writing down so a future you does not re-run the same hour:

**The failing line is 185, `doors.kinds`** — the doors screen's control list
(`['solo','create','join','back']`) — *not* line 186, `lobbyPresent`. Read the
line number, not the nearest interesting-looking variable. Confirmed by
measurement in a throwaway `origin/main` worktree on an isolated port 4197:
**`origin/main` fails the identical 7 at the identical `185:65`** —
`unified-play-flow` ×3, `map-picker` ×3, `lobby-flow` ×1. Same set, same line,
main and branch. This branch adds none of them.

(This also extends the standing "do not re-litigate" list from `codex-lobby` /
`lobby-flow` / `map-picker` to `unified-play-flow`. They are *lobby-shaped* spec
names and they will keep looking damning. Verify by re-running against main, not
by reading the names.)

#### Trap for a future you, the second one

**A full live-stage run dirties every `*-evidence.png` in the folder — all 36 —
whether or not the picture changed**, because the build badge stamps the commit
hash into each frame. Thirty-two of them belong to *other briefs*; committing that
churn would put another agent's evidence in this PR. Restore with
`git checkout -- tests/live-stage/`. **Not `git clean`** — that is a hard rule,
and it is also the wrong tool: these are tracked files with committed content to
return to.

There is no version of this that converges, either: a frame can never carry the
hash of the commit that contains it. The committed set is shot one commit back
and that is correct, not stale.

### Session 2026-08-08 (fifth) — a finished merge nobody had pushed

**Read this first: the branch was inherited GREEN but one commit short of being
real.** `a74a199` — a merge of `origin/main` (a0-05 station health, a0-00b mobile
shards) into a0-06 — was sitting in the local repo **committed and unpushed**,
made by a session that recorded itself in neither this note nor the remote. PR
**#319** therefore read **CONFLICTING**, because GitHub was still looking at
`ee2b622`, which predates the resolution. Nothing was wrong with the work; it had
simply never left the box.

Pushed fast-forward `ee2b622..a74a199`. That single push is what cleared the PR.

**The lesson, and it is not "merge more carefully":** a merge commit that is not
pushed looks *identical to a clean branch* from inside the workspace — `git
status` is empty, every gate passes, the note says green. The only thing that
tells you is `git log origin/<branch>..HEAD`. **Check the remote ref before
believing the local tree**, especially on a resume, and check the PR's
`mergeable` field rather than assuming a red one means unresolved conflicts —
here it meant unpushed ones.

**What the merge brought in, verified rather than trusted** (a0-05 edits four
files inside `src/bots/`, which is why this was worth reading rather than
assuming): `perception.ts`, `targeting.ts`, `hard.ts` are a0-05's sensor-range
retirement, ratified in GDD §2.2/§2.9 and not this brief's to litigate.
`personalities.ts` moved **9 lines and all of them are a doc comment** on
`memorySeconds` — `DIFFICULTY_TUNING`'s numbers, the trees and the weights are
untouched, so the brief's "what must not change" list holds. `castDisplayNames`
and the `fillEmptySlots` cast parameter came through the auto-merge intact.

**`PREVIEW_PORT` is on this branch after all.** The note above says it survived
only on the discarded duplicate; it is in fact live at
`tests/live-stage/playwright.config.ts:33` (`Number(process.env.PREVIEW_PORT ??
4173)`). Still marked *(a0-06, proposed)* — `tests/live-stage/` is Platform's.
Used it here (`PREVIEW_PORT=4191`) and the run never collided.

#### DoD on the pushed head

- `npx tsc --noEmit` — clean.
- `npm test -- --run` — **3992 passed, 0 failed**, 238 files. `capacity-regression`
  passed this time; it is a wall-clock benchmark and it only trips under lane
  contention, which is the same conclusion as sessions 2 and 4. Do not chase it.
- `npm run test:live-stage` — full sweep, `PREVIEW_PORT=4191`: **27 failed, 72
  passed, 3 skipped** in 10.7 m of test time (the wall clock was ~2.5 h — the box
  sat at load 15–23 with four other lanes running headless Chromium). **All three
  `lobby-cast` cases pass** (cast round trip, `?` by click on PC, `?` by tap at
  390 px landscape). `lobby-cast.spec.ts` appears in the output **only** as a
  "Slow test file (2.1 m)" line, never in the failure block, and no `lobby-cast`
  directory exists under `test-results/`, which is where Playwright puts failures.

  The 27 fall in **13 spec files and every one is already on the standing
  not-mine list**: `connect-trace` ×4, `upgrade-wheel` ×3, `unified-play-flow` ×3,
  `map-picker` ×3, `fullscreen` ×3, `codex-lobby` ×3, `ore-conservation` ×2, and
  one each of `tap-markers`, `tap-commander`, `tap-autofire`, `repair-core`,
  `lobby-flow`, `audio-alive`. Sessions 2 and 4 measured `origin/main` in
  throwaway worktrees on isolated ports at **30 failed / 66 passed** over the same
  families; this run is 27/72, i.e. inside that baseline rather than adding to it.
  **Honest caveat: main was not re-measured this session** — the claim rests on
  those earlier measurements plus the fact that no failing file is new.
- GDD.md differs from `origin/main`; `merge-base --is-ancestor origin/main HEAD`
  OK against `13e9649`.

**The proof, re-measured and not re-asserted:** the run regenerated
`lobby-cast-readback.txt` **byte-identical** (`bac2592b…`) on top of the a0-05 +
a0-00b merge — a fresh boot of the real client through the front door still seats
exactly the cast the lobby picked: seven Hard bots, three Wardens / two Sables /
two Vultures, `identical: true`. **That file is the evidence; the PNGs are the
picture of it.** Worth stating plainly: a0-05 changed how stations are *drawn* at
range, and the cast seam did not notice, which is what "this brief changes who
you choose, not how a bot plays" is supposed to mean.

**Trap #2 confirmed again, with a correction to how you watch it:** the full run
dirtied all 42 tracked `*-evidence.png`. Restored the 38 that belong to other
briefs with `git checkout -- tests/live-stage/` (never `git clean`). Also — do
**not** pipe the run through `| tail -N` if you intend to watch it: the pipe
buffers everything until the process exits, so the output file sits at 0 bytes
for the entire hour and looks hung. Watch `git status` and `ls -1t test-results/`
instead; the newest regenerated frame tells you which spec is executing.

#### `f517ef7` — the four frames re-shot, and one lucky nameplate

Committed the four `lobby-cast-*-evidence.png` (the readback did not change, so it
is not in the diff — that is the point). The **match frame caught a rival's
nameplate this time**, reading `Warden 1 (HARD)`, so the duplicate numbering and
the derived tier are legible in the match itself and not only in the lobby. Session
3's note called the *absence* of such a plate honest, and that still stands: it is
luck either way, which is exactly why the spec writes all seven names to the
readback instead of hoping a plate drifts into shot. Do not treat it as a
regression if a future re-shoot loses it again.

The lobby frame is the developer's case in one picture: seven rows reading
`Warden 1 / Warden 2 / Sable 1 / Vulture 1 / Warden 3 / Sable 2 / Vulture 2`, each
with its hull under the name, a read-only `HARD` chip, and a `?`.

**PR #319 is MERGEABLE at `f517ef7`.** It read CONFLICTING for this whole session's
first hour purely because `a74a199` had never been pushed — one `git push` fixed
it, no re-resolution.

### Session 2026-08-08 (sixth) — main moved again, and this time it conflicted

Inherited the branch **fully pushed** (`0de3741` = `origin/…`, nothing local and
unmissed — session 5's lesson applied, `git log origin/<branch>..HEAD` checked
FIRST and it was empty). No feature work outstanding and none invented. Two
things needed doing.

**1. `origin/main` had moved to `f3ace95`** (s9-01 alarm-once-and-ownership, PR
#318 — a large branch, ~30 commits), so `merge-base --is-ancestor` was red.
**This merge was the first on this brief that did NOT auto-resolve.** Two
conflicts, both genuinely additive rather than semantic:

- `docs/design-amendments.md` — s9-01 and a0-06 each inserted a new entry at the
  **top** of the file, at the same anchor. Kept both, with the `---` separator
  between them that each entry's format expects.
- `src/main.ts` — both sides edited the **same import block**. s9-01 expanded
  `./art/audio` to a multi-line list adding `deriveAlarmAllies`; a0-06 had added
  `castDisplayNames` and `type PersonalityId` from `./bots` on the lines directly
  above. Union of the two: a0-06's two `./bots` lines, then s9-01's audio list
  verbatim.

`GDD.md` auto-merged **clean** — a0-06 amends §2.1/§2.9, s9-01 amends §2.2, and
they never touch the same paragraph. Verified after the fact rather than assumed:
both amendment markers are present (§2.1 "the host picks each bot's CHARACTER",
§2.2 "the alarm sounds ONCE per engagement").

**Nothing semantic collided.** s9-01 is `src/art/audio/*` and the alarm's seat
ownership; this brief is the cast seam. The one shared file, `src/main.ts`, has
them in different functions — `deriveAlarmAllies` at the render loop
(`main.ts:975`), `castDisplayNames` in `rebuildNameTable` (`main.ts:1843`).

**2. Re-shot the four evidence frames (`b5799e4`)** — the committed set was from
`f517ef7`, older than this merge, and the build badge stamps the commit hash into
every frame.

#### DoD on the merged tree

- `npx tsc --noEmit` — clean (run **before** committing the resolution, which is
  the point of running it at all).
- `npm test -- --run` — **4001 passed, 0 failed**, 238 files.
  `capacity-regression` passed; the box was at load ~12. Sessions 2/4/5 already
  settled that it is a wall-clock benchmark that only trips under lane
  contention. Do not chase it.
- `PREVIEW_PORT=4195 npm run test:live-stage -- lobby-cast.spec.ts` — **3
  passed** (cast round trip, `?` by click on PC, `?` by tap at 390 px landscape).
- GDD.md differs from `origin/main`; `merge-base --is-ancestor` OK at `f3ace95`.

**The proof, re-measured not re-asserted:** `lobby-cast-readback.txt` regenerated
**byte-identical** on top of the s9-01 merge — seven Hard bots, three Wardens /
two Sables / two Vultures, `identical: true`. **That file is the evidence; the
PNGs are the picture of it.** Worth stating plainly, because it is the third
merge in a row to do this: s9-01 changed *when the siege klaxon fires* and the
cast seam did not notice. That is what "this brief changes who you choose, not
how a bot plays" is supposed to mean, and each clean merge is a small
re-confirmation of it.

**Trap #1 bit again and the flag paid for itself:** `lane-2` was holding port
**4173** with a `vite preview --strictPort` for its own alarm-stage build. Used
`PREVIEW_PORT=4195` and the run never collided. **Also — `pgrep -fa "vite
preview"` is the WRONG probe on this box:** every lane's `claude -p` process has
the brief text in its argv, so the pattern matches a dozen agent processes and
buries the one real server in 34 KB of prompt. Use `pgrep -fa "node.*vite"` or
`ss -ltnp | grep 417`, which names the lane and the port directly.

### Session 2026-08-08 (seventh) — an unpushed merge again, then main moved twice under the run

Inherited the branch with **`e84cd3e` committed and unpushed** (remote sat at
`8f002ba`) and 41 evidence PNGs dirty. Exactly session 5's failure mode, and
session 5's check is what caught it: `git log origin/<branch>..HEAD` **before**
believing an empty `git status`. Session 6 wrote that it had left the branch
"fully pushed"; the merge it made afterwards never left the box. Pushed
`8f002ba..e84cd3e` first thing, before touching anything else — a finished merge
that is not pushed is not a deliverable.

Restored the 41 PNGs with `git checkout -- tests/live-stage/` (never `git
clean`). No feature work was outstanding and none was invented.

**Main moved twice during this session**, which changed how the session was
sequenced and is the transferable part:

1. `4bb7d0c` (a0-00b closing notes, #323) — merged clean (`ca27b49`), and it
   touched **only another brief's status note**. Pushed.
2. `88e1454` (a0-08 looted ore, #325) — landed while the full live-stage sweep
   was ~10 minutes into a ~2.5 h run.

**Killed the running sweep rather than letting it finish.** A green full-suite
result on a tree four commits behind main proves nothing the DoD wants: the
`merge-base --is-ancestor` gate is evaluated on the *final* tree, and any
evidence frame the run produced would be of a bundle that no longer exists.
Merging first cost ten minutes of build; finishing first would have cost the
whole run. **Merge before you measure** — if main is moving, the measurement is
the perishable thing, not the merge.

**The conflict was the same one, in the same place, for the third time.**
`docs/design-amendments.md` — a0-08 and a0-06 each insert a new entry at the
top-of-file anchor. Resolved as the union (`c0d2c80`), and this time ordered
**newest-first**, which is what the rest of the file already does: a0-08
(2026-08-08) above a0-06 (2026-08-07), `---` between. Session 6 kept both but did
not state the ordering rule; it is stated now because this anchor will conflict
again with the next brief that lands, and "keep both" is not enough instruction
to resolve it the same way twice. `GDD.md` auto-merged clean — a0-08 amends
§2.3/§2.7, this brief §2.1/§2.9 — verified by grepping both markers afterwards
rather than assumed.

Nothing semantic collided: a0-08 is `src/sim` ore-ledger and step accounting,
this brief is the lobby→match cast seam and reads no sim internals.

#### DoD on the merged tree

- `npx tsc --noEmit` — clean (run **before** committing the resolution).
- `npm test -- --run` — **4017 passed, 0 failed**, 240 files (a0-08 brought two
  new test files in). `capacity-regression` passed; sessions 2/4/5/6 already
  settled it as a wall-clock benchmark that only trips under lane contention.
- `npm run test:live-stage` — see below.
- GDD.md differs from `origin/main`; `merge-base --is-ancestor` OK at `88e1454`.

**Worth stating plainly, because it is now the fourth merge in a row to do it:**
a0-08 changed how looted ore is accounted and the cast seam did not notice. Each
clean merge is a small re-confirmation of "this brief changes who you choose, not
how a bot plays."

### Session 2026-08-08 (eighth) — main moved onto MY files and auto-merged anyway

Inherited the branch **fully pushed** (`git log origin/<branch>..HEAD` empty —
checked FIRST, session 5's lesson, before believing an empty-looking tree) with
33 evidence PNGs dirty, none of them mine. Restored with `git checkout --
tests/live-stage/` (never `git clean`). No feature work outstanding; none
invented.

**`origin/main` had moved to `337784e`** (a0-09 team-aware end-of-match, PR
#327), so `merge-base --is-ancestor` was red. Merged first, before measuring
anything — session 7's rule, and it mattered more than usual here because **a0-09
edits `src/ui/lobby.ts`, `src/ui/lobby-flow.ts` and `src/main.ts`, which are the
three files this brief rewrote most.**

**It auto-merged clean, all six shared files, no conflicts** — and that is worth
one sentence of *why*, because "no conflict" on a file both sides rewrote is a
claim to verify rather than accept. a0-09's `lobby.ts` change is a single
**additive** export, `sideRosterOf` (the end screen's "did MY side win?"), placed
after `activeTeams` and touching no seat field. It reads `seat.team`; this brief
owns `seat.character`. They are neighbours in one type and nothing else.
`design-amendments.md` did **not** conflict for once — a0-09 added no entry — so
the top-of-file anchor that collided in sessions 6 and 7 stayed quiet. Verified
after the fact by grep, not assumed: §2.1's *"the host picks each bot's
CHARACTER"* and §2.9's *"characters, not difficulty labels"* are both still in
`GDD.md`, and the a0-06 entry is still at `design-amendments.md:80` under a0-08's
in the file's newest-first order.

**This is the fifth merge in a row to leave the cast seam untouched.** a0-09
changed who the end screen calls a winner; the seam did not notice. That is what
"this brief changes who you choose, not how a bot plays" is supposed to mean, and
each clean merge re-confirms it a little more cheaply than a test does.

#### DoD on the merged tree

- `npx tsc --noEmit` — clean (run **before** committing, which is the point of
  running it).
- `npm test -- --run` — **4031 passed, 0 failed**, 240 files.
  `capacity-regression` passed at load ~9. Sessions 2/4/5/6/7 already settled it
  as a wall-clock benchmark that only trips under lane contention; do not chase
  it.
- `PREVIEW_PORT=4196 npm run test:live-stage -- lobby-cast.spec.ts` — **3
  passed** (cast round trip, `?` by click on PC, `?` by tap at 390 px landscape).
  Full sweep result recorded below.
- GDD.md differs from `origin/main`; `merge-base --is-ancestor` OK at `337784e`.

**The proof, re-measured not re-asserted:** `lobby-cast-readback.txt` regenerated
**byte-identical** on top of the a0-09 merge — slots 1–7 read
`warden warden sable vulture warden sable vulture` in the lobby and the *same
seven* in the match, `identical: true`. It is absent from the evidence commit's
diff and that absence IS the result. **That file is the evidence; the PNGs are
the picture of it.**

`2f3acf4` re-shot the four frames (the committed set was from `85b38c9`, older
than this merge, and the build badge stamps the commit hash into every frame).
Pushed `85b38c9..2f3acf4` fast-forward **immediately after committing**, not at
the end of the session — sessions 5 and 7 each lost an hour to a finished merge
that never left the box, and the fix is to push the merge before doing anything
else with it. PR **#319** reads MERGEABLE at `2f3acf4`.

**A correction to session 5's port probe, kept because it will save the time
again:** `pgrep -fa "vite preview"` is the wrong tool on this box — every lane's
`claude -p` carries the brief in its argv and matches. `ss -ltnp | grep ':41'`
names the lane and the port directly and is what I used to pick 4196.

### Session 2026-08-08 (ninth) — the second port config, and a merge that touched nothing

Inherited the branch **fully pushed** (`git log origin/<branch>..HEAD` empty —
checked FIRST, before believing anything else, which is session 5's lesson and
the only check that catches session 7's failure mode) with 39 evidence PNGs
dirty **and one file that was not churn**. No feature work outstanding; none
invented.

**The tree held an uncommitted change to the ROOT `playwright.config.ts`** — the
mobile suite's config — carrying the same `PREVIEW_PORT` override this branch
already landed for the live-stage config in `a1bc039`, with a written rationale
that names a real a0-06 incident. It was **not** evidence churn and `git
checkout -- tests/live-stage/` would not have touched it, but a future session
that ran a blanket restore would have lost it. Committed it as `7701b62`,
**separately and marked PROPOSED**, because `playwright.config.ts` and
`tests/mobile/` are QA's — same posture as `a1bc039`. Default is still 4173, so
CI and every existing invocation are byte-identical.

Worth stating the general rule, since this is the first time a dirty tree on this
branch contained anything but PNGs: **read `git status` before restoring it.**
"39 modified evidence PNGs" is a pattern, not a licence — the fortieth line was a
deliberate change with a paragraph of justification in it.

**`origin/main` had moved to `f7d06b0`** (a0-09 team-aware end-of-match again,
this time PR **#328** — the same branch's follow-up to #327, which session 8
merged). Merged first, before measuring anything (session 7's rule). **Clean, no
conflicts, and this time it did not even come near:** the six files are
`src/ui/end-of-match.test.ts`, a0-09's own status note, `end-screens-teams.spec.ts`
and three of its evidence frames. Nothing in `src/bots/`, nothing in the lobby,
nothing in `src/main.ts`. Pushed `18cf024..cd9c96b` **immediately after
committing**, before running a single gate.

**This is the sixth merge in a row to leave the cast seam untouched.**

#### DoD on the merged tree

- `npx tsc --noEmit` — clean (run before committing the merge, which is the point).
- `npm test -- --run` — **4032 passed, 0 failed**, 240 files.
  `capacity-regression` passed at load ~12. Sessions 2/4/5/6/7/8 already settled
  it as a wall-clock benchmark that only trips under lane contention; do not
  chase it.
- `PREVIEW_PORT=4197 npm run test:live-stage -- lobby-cast.spec.ts` — **3 passed**
  (cast round trip 29.8s, `?` by click on PC 5.9s, `?` by tap at 390px landscape
  26.5s). Full sweep run separately; result below.
- GDD.md differs from `origin/main`; `merge-base --is-ancestor` OK at `f7d06b0`.
  Both amendment markers verified by grep rather than assumed — §2.1 line 56
  *"the host picks each bot's CHARACTER"*, §2.9 line 233 *"characters, not
  difficulty labels"*.

**The proof, re-measured not re-asserted:** `lobby-cast-readback.txt` regenerated
**byte-identical** on top of the #328 merge — slot 0 `null` (the human), slots
1–7 `warden warden sable vulture warden sable vulture` in the lobby and the
*same seven* in the match, `identical: true`. It is absent from `b17e9af`'s diff
and **that absence IS the result**. That file is the evidence; the PNGs picture
it.

`b17e9af` re-shot the four frames (the committed set was from `2f3acf4`, older
than this merge; the badge stamps the hash, so they now read `cd9c96b`). The
**match frame catches no rival nameplate** this run, landing at MATCH 0:02.
`f517ef7` caught one, `2f3acf4` did not — it is luck either way, which is
precisely why the spec writes all seven names to the readback instead of hoping
a plate drifts into shot. **Do not treat either outcome as a regression.**

The lobby frame remains the developer's case in one picture: seven rows reading
`Warden 1 / Warden 2 / Sable 1 / Vulture 1 / Warden 3 / Sable 2 / Vulture 2`,
hull under each name, a read-only `HARD` chip, a `?`. The codex frame shows the
dossier open over a *mixed-tier* cast (`EASY` / `MEDIUM` / `HARD` chips down the
column), which is the better picture of the point: the chip is derived from
whoever is in the seat and cannot disagree with it.

## NEXT (unchanged from session 1, restated so it is not lost)

- **ONLINE still carries the tier, not the name.** `LobbyChoiceMessage` has
  `botDifficulties` and no character row, so an online room seats the right
  *tiers* and may seat different *names* within them. Offline — the flavour both
  developer reports were filed against — is exact. Closing it is a **Netcode**
  seam (`transport.ts` → `wire.ts` → `session.ts` → `server/room.ts` `castFor`),
  four files across two other agents' ownership and outside this brief. Stated in
  the PR body and in `docs/design-amendments.md`.
- `PREVIEW_PORT` remains marked *(a0-06, proposed)* in **two** configs now —
  `tests/live-stage/playwright.config.ts` (`a1bc039`, Platform's) and the root
  `playwright.config.ts` for the mobile suite (`7701b62`, QA's). Either owner can
  drop their own; both default to 4173 unchanged.
- No other feature work outstanding. Do not invent any.

### Session 2026-08-08 (tenth) — the first merge that genuinely FOUGHT, and what it taught

Inherited the branch **fully pushed** (`d953b4c` = `origin/…`; `git log
origin/<branch>..HEAD` empty — checked FIRST, session 5's lesson) with 40 dirty
evidence PNGs. Read `git status` before restoring (session 9's rule): all 40 were
`*-evidence.png` churn, nothing deliberate this time, so `git checkout --
tests/live-stage/`. No feature work outstanding; none invented.

**`origin/main` moved to `fa5495d` — a0-11 open-rooms-and-offline-revert, PR
#329.** Merged first, before measuring (session 7's rule). This is the **first
merge on this brief that did not auto-resolve**: **six files, twenty-one hunks** —
`GDD.md`, `src/main.ts`, `src/ui/index.ts`, `src/ui/lobby.ts`,
`src/ui/lobby.test.ts`, `src/ui/lobby-flow.test.ts`.

It fought because a0-11 rewrote **the same seat model this brief rewrote**. Its
change: an `open` slot is now EMPTY — `isBotSeat` is exactly `'bot'`, an open seat
casts nobody, `N` counts humans plus bots, and RUSH! is refused below two.

#### The resolutions that were judgement, not text

- **GDD §2.1 — kept BOTH amendments.** They compose rather than compete: a0-11
  says *which* slots get bots, a0-06 says *what you pick* for them. The merged
  sentence carries both: "**Bots fill the slots the host set to `bot`, and only
  those**; before the match, **the host picks each bot's CHARACTER … and that
  character's difficulty is *shown***". Both markers verified by grep afterwards.
- **`withCast` / `seatDifficulty` — kept a0-06's, and a0-11's worry evaporated.**
  a0-11's doc agonises over which seats consume a **cast index** (it must match
  `server/room.ts` `castFor`). On this branch **there is no index to spend** —
  each seat carries the character the host gave it. Said so in the comment rather
  than deleting a0-11's concern silently.
- **`botDifficulties` auto-merged CORRECTLY and that is worth noting:** it now
  filters `isBotSeat` (a0-11) and derives the tier from the character (a0-06).
  Neither side had to give way.
- **`ping` — took a0-11's predicate over mine.** Mine read `isBot || isClosed`;
  under a0-11's narrowed `isBotSeat` that **silently stops covering an OPEN
  seat**, which would have drawn a ping on an empty chair. Theirs
  (`occupant !== 'human'`) is strictly better. A conflict I *won* on my own file
  would have been the wrong outcome.
- **`seatSlotState` lost its `online` arg** (a0-11) — took theirs; my
  `lobbyRosterCast` sits above it untouched and still drops closed slots, which
  now correctly includes unclaimed OPEN ones.
- **`src/main.ts` `LobbyChoice` — pure union**, a0-06's `cast` beside a0-11's
  `local`.

#### The trap this merge set, and it is a NEW class

**a0-11 changed the FIXTURES out from under my tests, in a way that fails silently
rather than loudly.** Four of my tests would have kept compiling and passing while
asserting nothing:

- An **online** `lobby()` now seats everything OPEN, and `cycleSeatCharacter`
  refuses a non-bot seat. My "cycles through the whole roster" test would have
  cycled **nothing** and compared a value to itself. Now uses `solo()`, or
  a0-11's `withBotAt()` helper where the flavour is parameterised.
- My "keeps every other seat's character when a human arrives" ran over an
  all-`open` fixture — under a0-11 a roster **with no bots in it**. Now `bot`.
- The seat-state ring test asserted `toBe('open')` after a full lap; which rung a
  seat *starts* on is now flavour-dependent, so it asserts **return-to-start**
  instead of naming a rung.
- The host-affordance guard tapped RUSH! on a one-participant online room, which
  a0-11 now **refuses**. Seats a bot first via `withBotAt`.

**The lesson, and it generalises past this merge:** when the other side changes
what a *default fixture means*, a green test is not evidence. Re-read what your
own fixtures now contain — `tsc` cannot see a test that has quietly become
vacuous, and neither can a passing run.

- **Two of main's tests asserted behaviour this brief DELETED** — re-casting the
  roster on join, and a tappable difficulty chip (`kind: 'seatChip'`). Dropped
  both, and replaced the second with its inverse: a test that the tier chip's rect
  **does not** resolve to a target, so the deleted control cannot creep back.
- **One of a0-11's own tests read `seat.difficulty`**, the field this brief
  deleted; `tsc` caught it. Re-pointed at `seatDifficulty(seat)`.

#### The two features actually compose — verified, not assumed

a0-11's **local revert** (an online room with no other humans boots offline and
gives the room back) nulls `onlineSession`, so it falls through to `bootMatch` →
`bootOfflineMatch` → **the `cast` seam this brief added**. So a reverted room now
seats the host's chosen cast rather than the roster-order default. Traced through
`main.ts:895` rather than assumed, and the comment on `LobbyChoice.cast` now says
so. **This is the first merge that made the seam do MORE work rather than none.**

### Session 2026-08-08 (eleventh) — session ten's merge was RESOLVED but never staged

**Read this before anything else: the failure mode was new, and `git status` was
the only thing that showed it.** Session ten did the hardest merge on this brief
— a0-11 open-rooms (`fa5495d`, PR #329), six files and twenty-one hunks — wrote
its 83-line account into this note, and then **stopped without staging a single
resolved file**. The tree was left mid-merge: `MERGE_HEAD` present, six paths at
`UU`, and **zero conflict markers in any of them**, because the resolution work
was genuinely finished and sitting in the working tree unstaged.

That combination is worth naming, because it does not look like either thing it
resembles:

- It is **not** session 5/7's unpushed-merge trap. There was no commit to push;
  `git log origin/<branch>..HEAD` was **empty** and would have reassured you.
- It is **not** an abandoned half-resolution. Every file was clean, and `npx tsc
  --noEmit` passed on the working tree **before** anything was staged — which is
  what told me the resolution was finished rather than merely started.

So the check that catches it is neither of the two this note already teaches. It
is: **`git status` first, and read the index column, not just the filenames.**
`UU` with no markers means "somebody finished and walked away," and the correct
response is to verify and commit it, not to redo it and not to abort it. Aborting
would have thrown away twenty-one hunks of real judgement.

**Verified session ten's resolution rather than trusting its own account of
itself** (it is a note about work that was never committed, so it had never been
checked by anything):

- `npx tsc --noEmit` clean on the unstaged tree.
- `GDD.md` §2.1 carries **both** amendment markers in one sentence — a0-11's
  *"Bots fill the slots the host set to `bot`, and only those"* and a0-06's *"the
  host picks each bot's CHARACTER … and that character's difficulty is shown"*.
  §2.9's *"characters, not difficulty labels"* intact at line 235.
- The seat model is coherent: `LobbySeat.character` (authored, on every seat) and
  `LobbySeat.personality` (**derived**, `character` gated by a0-11's narrowed
  `isBotSeat`, so an open seat now casts nobody). Two fields, one authored —
  which is still one control, so the brief's "a mismatch is unrepresentable"
  property survives a0-11 intact.
- The `ping` predicate is a0-11's `occupant !== 'human'`, not mine — session ten
  gave way on its own file and was right to.
- `seatTrailing` (the `?` / tier / side order-of-surrender) untouched.

Committed as `a9442c7` and **pushed before doing anything else with it**.

#### Then main had moved AGAIN, to `854fa64` — a0-12 two-sided team maps, PR #330

Merged second, **clean, no conflicts** (`80e3a01`), pushed immediately. It shares
exactly one file with this brief, `src/ui/lobby-geometry.ts`, and the two changes
are in different halves of it: a0-12 took `LOBBY_MAP_COUNT` 4 → 6 and rewrote the
**arena/map row** (`placeMaps`, a new `LOBBY_MAP_GAP_MIN`, the fold threshold 48 →
44); this brief owns the **seat row** (`seatTrailing`). Checked the diff rather
than trusting the clean auto-merge, because "no conflict" on a file both sides
edited is a claim to verify.

**This is the eighth merge in a row to leave the cast seam untouched** — and the
seventh to change something real while doing it (a0-12 added two maps and a sky).

#### The sequencing decision, and it cost a running test job

A targeted vitest run was already going when I found main had moved. **Killed it
rather than letting it finish.** Session 7 wrote the rule and it applied exactly:
`merge-base --is-ancestor` is evaluated on the *final* tree, so a green result on
a tree two merges behind main proves nothing the DoD asks for. **Merge before you
measure** — the measurement is the perishable thing, not the merge.

