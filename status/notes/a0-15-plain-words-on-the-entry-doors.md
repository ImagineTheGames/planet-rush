# a0-15-plain-words-on-the-entry-doors.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

## BUILT

Branch `agent/ui/a0-15-plain-entry-doors`, cut clean from `origin/main`
(`525440c`). Three commits, session 1:

- `f1c24c9` — the rename. Labels `CAMPAIGN` / `SOLO` / `HOST` / `JOIN`, three
  new plain hints, and every string that names a door moved with it. Plus the
  new guard in `voice-door-labels.test.ts`.
- `5d6d390` — the ratified exception written into both copy-sweep docs.
- `c3f0ba7` — the two doors goldens re-baselined, and the before/after figure.

Verified in this tree: `npx tsc --noEmit` clean; `npm test -- --run`
**4102 passed / 242 files, zero failures** (including
`tests/net/capacity/capacity-regression.test.ts`, which r6-01 logged as a
flaky-on-shared-hardware perf assertion — it passed here, do not be surprised
if it reds on a busier box); the fit spec green on all three projects with
every door hint inside budget (worst: HOST hint 343/420px, 18% headroom).

## DECISIONS

**The four labels are the developer's words, verbatim, and nothing else moved.**
`#283` (l2-02, the industrial voice sweep) merged about an hour before this
brief. This reverts the four entry doors, NOT the sweep — the build wheel, HUD,
pause menu, codex and every in-match string are untouched, because the developer
pointed at the front door and said new players cannot read it.

**The DoD grep is stricter than it looks — it greps `src/` for the three retired
phrases, including comments and test names.** Two drafts died on this:

1. A comment in `lobby-entry.test.ts` explaining the history ("l2-02 re-worded
   the solo door to `SOLO CONTRACT` and a0-15 put it back") reintroduces the
   phrase and reds the DoD. Say it without spelling it.
2. The obvious form of the new guard — a list of retired labels to assert
   against — cannot name them either. That constraint pushed the test to a
   better shape, below.

**The guard is a SHAPE rule, not a list of old words** (`voice-door-labels.test.ts`).
Every ALL-CAPS phrase in rendered copy must be a live door label or a declared
non-door (`NOT_A_DOOR`, with a reason per entry). Phrases are matched MAXIMALLY,
which is the whole trick: a stale `SOLO CONTRACT` in an error line is one phrase
that matches no door, where a substring test would find `SOLO` inside it and pass.
Works in both directions and for renames nobody has thought of yet.

*Rejected:* keeping the old `retired = ['PLAY SOLO', 'CREATE ROOM', 'JOIN ROOM']`
list. It only ever catches the LAST rename — it is a third list to remember, so
the rename after it walks straight past. LESSONS §20 pointed at copy.

Proof it bites, run before/after and quoted in the PR body: rename the solo label
to `SOLO RUN` and leave the messages alone → 3 of 6 tests red, the first printing
all five orphaned sentences with the door list beside them.

**A second guard pins the fit spec's quoted copy to the live labels and hints.**
`voice-copy-fit.spec.ts` is a Playwright spec and cannot import `lobby-entry.ts`
(the graph reaches Pixi through `./lobby`), so it QUOTES what it measures — and
r6-01 lost 43 hours to exactly that in exactly that file, measuring a font stack
the app had stopped drawing in. The unit test now reads the spec off disk and
asserts every label and hint appears in it verbatim. Same idiom as
`codex.test.ts` reading `content/codex/`.

**Hint copy: what happens when I press this, in the order it happens.** Budget is
63 chars at 11px in a 420px door (420 / 6.601). All four sit at 18–32% headroom.
SOLO says "No internet needed." rather than the register's "Offline." — a player
who has to infer that "offline" means "this still works on the school wifi" has
been told nothing, and the offline promise (GDD §4.8 risk 6) is the one fact this
line may never lose. HOST and JOIN are written as a pair because the room code is
the one mechanic on this screen a first-time player genuinely cannot guess: this
one MAKES the code, that one TYPES it.

**`ENTRY_ERRORS.full` changed too, and it is in scope.** It said "or take a solo
contract" — lower case, but it names the door in the retired voice. Now "or press
SOLO", which the new guard can actually see.

**`CAMPAIGN`'s hint was deliberately NOT touched** — the brief lists three hints
(167/174/181) and the CAMPAIGN label is unchanged. "A run of linked contracts,
one claim after another" is still lore-voice on a plain screen; flagged in the PR
body for the developer, not fixed here. Same for `GDD.md` §4.7's table rows 478–479,
which still ratify the retired door labels: the GDD is the Director's contract and
is not mine to amend.

**Goldens: `--update-snapshots` REPORTED BOTH AS PASSING.** The menu goldens carry
`maxDiffPixelRatio: 0.01` for antialiasing, and four re-worded labels plus four
re-written hints move fewer pixels than that on a 844×390 frame — so the baselines
would have kept the retired words and stayed green. Deleted both PNGs and
regenerated them ("A snapshot doesn't exist… writing actual"). **The golden is not
a copy test.** If a future brief changes entry copy, do this deliberately.

**Ran the mobile suite on `playwright.isolated.config.ts` (private port 4193,
`reuseExistingServer: false`), never bare `npm run test:mobile`.** The committed
config pins 4173 and reuses whatever is already serving it, and `/lanes/` holds
three lanes — that silently screenshots a sibling's bundle. The version watermark
in the regenerated goldens reads `5d6d390*`, this lane's own HEAD, which is the
check. The config stays untracked (its own header says NOT FOR COMMIT).

## NEXT

**Session 1 closed the whole DoD. PR [#335](https://github.com/ImagineTheGames/planet-rush/pull/335), branch at `7c7134f`.**

- Full mobile suite on the isolated port: **123 passed / 90 skipped / 0 failed**
  (20.2m) — the same shape r6-01 recorded, and no golden other than the two doors
  baselines moved.
- `origin/main` moved mid-session (a0-16, wave clock ↔ economy, merged as
  `aaf2733`). Merged in at `7c7134f` — **clean, zero conflicts**; it touches
  `hud.ts` / `wave-clock.ts` / `sim/`, none of them a doors file. Re-verified on
  the merged tree: `tsc` clean, `npm test -- --run` **4113 passed / 243 files**,
  the doors + frozen goldens green. Ancestry line satisfied.
- All five DoD lines pass locally. CI on #335 was still running when this was
  written — if it reds, check the shard log before assuming it is this branch:
  r6-01 logged `tests/net/capacity/capacity-regression.test.ts` as a wall-clock
  perf assertion with no headroom on shared hardware, and it belongs to whoever
  owns `server/`. This branch's whole diff is `src/ui/`, `tests/mobile/`, `docs/`,
  goldens and evidence PNGs.
- The PR body carries the five copy items flagged-not-fixed for the developer
  (the CAMPAIGN hint is the loudest) and the `GDD.md` §4.7 rows 478–479, which
  still ratify the retired labels and want a Director amendment.
- `dist-a0-14/` is untracked junk from another brief, present before this session
  started. Leave it. Never `git clean` here.
