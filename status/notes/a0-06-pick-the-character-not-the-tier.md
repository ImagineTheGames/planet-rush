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

## NEXT (unchanged from session 1, restated so it is not lost)

- **ONLINE still carries the tier, not the name.** `LobbyChoiceMessage` has
  `botDifficulties` and no character row, so an online room seats the right
  *tiers* and may seat different *names* within them. Offline — the flavour both
  developer reports were filed against — is exact. Closing it is a **Netcode**
  seam (`transport.ts` → `wire.ts` → `session.ts` → `server/room.ts` `castFor`),
  four files across two other agents' ownership and outside this brief. Stated in
  the PR body and in `docs/design-amendments.md`.
- `PREVIEW_PORT` remains marked *(a0-06, proposed)* — `tests/live-stage/` is
  Platform's to accept or reject.
- No other feature work outstanding. Do not invent any.
