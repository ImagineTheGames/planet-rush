# a0-14b-rebaseline-the-menu-for-the-hangar.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-14-hangar` (the SAME branch as a0-14 — this brief fixes
a0-14's PR #333, it does not open a new one). See `a0-14-the-hangar.md` for the
feature work itself.

## The situation this brief inherited

PR #333 red on exactly two goldens, deterministic across all three attempts:

```
[iphone] goldens.spec.ts:671  golden: landscape phone title screen — Gantry/Bone
[iphone] goldens.spec.ts:698  golden: PORTRAIT-HELD phone title screen — the frame survives the lock
```

Correct behaviour by the gate: a0-14 appends HANGAR to `MAIN_MENU_ITEMS`, so the
menu renders four doors and the two baselines shot at three are stale. The brief
that produced a0-14 omitted the re-baseline line (LESSONS §5).

## BUILT

1. **`689087b` — merge `origin/main`** (12 commits: a0-15 plain entry doors,
   a0-16 wave clock, the industrial-voice sweep, bots/perception). One conflict,
   in `src/ui/menu-nav.ts`: main reworded the doors in the `NavScreen` doc
   comments (`SOLO CONTRACT`→`SOLO`, `OPEN A CLAIM`→`HOST`, `JOIN A CLAIM`→`JOIN`)
   in the same hunk where a0-14 added the `'hangar'` node. Resolved by keeping
   BOTH — the hangar node and main's new wording. `tsc` clean, 4198/4198 vitest
   green, `origin/main` is an ancestor of HEAD.
2. **the two menu goldens re-shot** — `phone-landscape-title-iphone-linux.png`
   and `phone-portrait-title-iphone-linux.png`. Nothing else in the snapshot
   directory is touched (`git status` shows exactly two modified PNGs).
3. **`evidence/a0-14b-menu-rebaseline/`** — before/after frames at 390 px for
   both orientations, the composed figures, and `band-compare.mjs` +
   `band-compare.txt`: the row-by-row measurement behind the "nothing else
   moved" claim.
   **CORRECTION (session 2): this was never committed.** The directory existed
   on disk and `git status` listed it as untracked; `git ls-files` on it was
   empty. Session 1 wrote the files and never `git add`ed them. Do not trust a
   BUILT line that has no commit sha next to it — that is why the template asks
   for one.

## DECISIONS

- **The container had to be proved a match BEFORE any baseline was written.**
  A re-baseline taken on a box whose font/GPU rendering differs from CI's writes
  a baseline that is wrong everywhere except this box. So the first run was a
  CONTROL: the two failing title goldens plus the two *settings* goldens, which
  the hangar does not touch. Result — the two settings goldens passed
  pixel-for-pixel against the committed baselines, and the two title goldens
  failed with exactly CI's line numbers. That is the container reproducing CI,
  and only then was `--update-snapshots` allowed to run.
- **"Only the HANGAR row changed" is a measurement here, not an impression.**
  Two things back it:
  - `band-compare.mjs` walks the frames row by row. In landscape the header band
    (rows 0–64: the eyebrow `DEEP FIELD MINING AUTHORITY / CONTRACT OPEN ·
    SECTOR 04`, the `PLANET RUSH` wordmark, the corner rivets, the header beam)
    is **byte-identical**. What differs is rows 65–324 (the door stack), rows
    340–341, and rows 371–378.
  - the decisive one: with the HANGAR entry — and ONLY that entry — removed from
    `MAIN_MENU_ITEMS`, today's post-merge code reproduces both committed
    baselines **exactly**, i.e. both goldens go green unmodified. So 100 % of the
    delta is attributable to the fourth row. Neither the merge of `origin/main`
    nor anything else on this branch contributes a pixel. Then restored the file
    and re-baselined for real.
- **The two bands that are not the stack, explained rather than waved past** —
  this is the part a re-baseline is supposed to be suspicious about:
  - **rows 371–378, x 9–45** is the build-identity stamp
    (`src/render/build-badge.ts`), which draws the short sha in the footer beam.
    It reads a different sha in every run and always has; at ~300 px it is far
    under the goldens' `maxDiffPixelRatio: 0.01`, which is why it has never
    failed one. Not caused by this change and not something this brief touches.
  - **rows 340–341** is the footer beam's lit top edge. Its GEOMETRY does not
    move — same two rows, same x-extent, same fade at both ends — only its peak
    luminance drops 150→139. `gantryFrame` derives the footer from the viewport
    and the insets alone, never from the item count, so the beam is drawn in the
    same place; the stack now fills its band down to row 324 where three plates
    stopped at 305, and that fourth plate is what shades the edge. The 3-item
    control above is what settles it: remove the row, the edge comes back to 150
    and the baseline matches.
- **A private preview port (4192), and a scratch config that INHERITS the real
  one.** The shared 4173 is `reuseExistingServer: !CI` and three lanes share this
  box, so a run there can shoot another lane's bundle — for a re-baseline that
  would write another lane's pixels into our baselines. The scratch config
  spreads `playwright.config.ts` and overrides only the port, so every setting
  that touches rendering (projects, viewport, dpr, isMobile, snapshot path) is
  inherited rather than restated. Deleted after use — lane memory: `git add -A`
  will otherwise commit the file that says NOT FOR COMMIT on it.
- **Rejected: widening `maxDiffPixelRatio` to make the goldens pass.** It is the
  one gate that catches a real visual regression, and the file says so at its
  definition. The render changed; the baseline moves.
- **Rejected: re-shooting every golden "while I am here".** The DoD wants the
  snapshot directory touched, not churned. Two frames changed; two frames were
  written.

## SESSION 2 — three of session 1's claims did not survive contact

Read this before the sections above; where they disagree, this wins.

1. **`origin/main` moved 17 commits, and one of them collided head-on.**
   `3dd9ebb` (a0-07b, sky parallax) re-shot **all 35 goldens**, including the
   two menu frames this brief owns. So session 1's re-baseline (`86503a5`) was
   shot against a pre-sky render and was stale the moment a0-07b merged.
   Merged in `7243a77`; both PNGs conflicted, binary, and were resolved by
   taking **main's** side deliberately — ours would have reverted a0-07b's sky
   out of two baselines and labelled it a hangar change. Main's side is the
   correct BEFORE; the fourth door is re-shot on top of it.
2. **The evidence was never committed** — see the correction under BUILT 3.
3. **PR #333's body has no re-baseline justification.** It is still a0-14's
   original body. Brief item 3 (one line per snapshot) was not done.

And the one that matters most for the DoD:

4. **The six mobile shards never ran.** `gh pr checks 333` reports
   `fail == 0` — but the mobile shards are `SKIPPED`, and the only CI run for
   head sha `71d0b8e` is a **`push`** run (`gh run list --commit`). ci.yml:163
   gates the shards on `github.event_name == 'pull_request' || ref == main`, so
   on a branch push they skip **by design**, and the rollup at ci.yml:243
   repeats the gate so it does not paint the branch red. That means the DoD's
   last line passes **vacuously**: zero failures because the golden job never
   executed. This is LESSONS §22 wearing a different hat — the check the brief
   added to close the hole can itself read green on a run that proved nothing.
   Do not accept `fail == 0` without confirming a `pull_request`-event run
   exists for the head sha and its shards are `SUCCESS`, not `SKIPPED`.

### What session 2 built

- **`7243a77`** — merge `origin/main` (17 commits). Both menu PNGs conflicted;
  took **main's** side of each on purpose.
- **`20a6469`** — the two goldens re-shot against the post-sky render, on port
  4192. Supersedes `86503a5`. Control: the two SETTINGS goldens passed
  pixel-for-pixel first (**2 passed**), so the container reproduces CI
  *including* the sky; 3-item control: hangar row removed → both goldens green
  **unmodified** (2 passed), so the whole delta is the fourth row.
- **`8014b3a`** — the evidence, actually committed this time.
- Local DoD: `npx tsc --noEmit` clean; `npm test -- --run` **4228 passed / 247
  files, 0 failed** (756 s — the box is shared and a0-00c now caps the worker
  pool to the cgroup quota, so a full run is ~12 min, not ~4). Both wall-clock
  flakes (`capacity-regression`, `harness/perf`) passed this time.
- Snapshot gate: exactly **2** files differ from `origin/main` under
  `tests/mobile/goldens.spec.ts-snapshots` — the two menu frames, nothing else.
- PR #333's body now carries the per-snapshot justification (one row per
  snapshot) plus the control/measurement write-up.

**Trap worth remembering:** `pgrep -f vitest` matches the *other lanes'* vitest
processes too, so "is my run done" cannot be answered that way — I twice read a
neighbour's run as my own. Match on the pid, or on the lane path in the esbuild
child's argv (`/lanes/lane-2/node_modules/...`).

### Two of session 1's own measurements were slightly wrong

Both were repeated from a pre-sky run and did not survive re-measurement:

- *"the header band (rows 0–64) is byte-identical"* — it is **not**. 1406 of
  54860 pixels differ, at a max per-channel delta of **2/255**. The honest
  claim is that nothing in the header is *redrawn* — it recomposites. It sits
  far below band-compare's threshold of 8, which is why the tool reports no
  band there and session 1 read that as "identical". A band-compare that finds
  no band is not a byte-for-byte match; check exactly if you want to say so.
- the footer beam's peak luminance drops **150→142**, not 150→139. Geometry is
  unchanged either way (x-extent 17–826 before and after).

And one suspicion that turned out to be **wrong**, recorded so a future session
does not re-open it: the identical `138313` differing-pixel count in both
orientations looks like a copy-paste artifact and is not. Under the landscape
lock the portrait frame is the landscape frame rotated 90°, so the two frames
differ by a transpose and necessarily share a pixel count (844×390 = 390×844).
Verify before "fixing" it.

### THE BRIEF NAMED TWO GOLDENS. THERE ARE THREE.

The single most important thing on this page. `194c2d5`.

`desktop-title-desktop-linux.png` (`goldens.spec.ts:648`, 1280×800) draws the
same main menu and therefore moves for the same reason. Nothing on this branch
had ever touched it. It is **20.04%** different against a 1% tolerance — not a
marginal case, not a flake.

Why nobody saw it: the brief was scoped from a failure list containing only
`[iphone]` failures. And the reason that list was incomplete is §4 above — the
mobile gate had **never run** on this branch. The instant the two phone frames
were pushed and the `pull_request` run fired for the first time, shard **4/6**
came back red on exactly this test, all three attempts.

So the two failures compounded: a gate that never ran produced a partial failure
list, and a brief scoped from that partial list looked complete. `fail == 0` and
`SKIPPED` are indistinguishable in `gh pr checks`.

**The rule to carry forward:** when a change touches a screen, derive the
goldens to re-shoot from *which frames draw that screen* — `grep` the spec for
the ones that reach it — never from which ones happened to be red. Here that is
three: `desktop-title`, `phone-landscape-title`, `phone-portrait-title`. The
other menu goldens (settings, doors, codex, lobby) navigate away from the main
menu and correctly did not move; that was checked, not assumed.

It got the full discipline anyway: desktop SETTINGS as pixel-for-pixel control,
the HANGAR-removed control reproducing the committed baseline exactly, eyes on
the frame, two bands (stack rows 229–570, sha stamp rows 782–789), no third.

## NEXT

Nothing outstanding. The DoD is green, and green on a gate that actually ran.

Run **`31295157868`** (`pull_request`, head `dc55efc`) — the first run carrying
all three re-baselined frames:

```
pass  Typecheck, test, build
pass  Mobile emulation (Playwright) — shard 1/6 .. 6/6   (all six)
pass  Mobile emulation (Playwright)                      (the rollup)
RUN COMPLETE: success
```

Shard 4/6 — the one that was red on the desktop golden — is green. Run
`31295127781` (head `194c2d5`, same tree minus this note) came back green
independently, so it is not a one-off. The DoD's last line was then run
verbatim: `fail == 0`, and this time that is a real zero rather than a skipped
job's, which is the whole point of the line.

Local, for the record: `tsc` clean; `npm test -- --run` 4228 passed / 247 files,
0 failed; exactly 3 files differ from `origin/main` under the snapshot
directory; `origin/main` is an ancestor of HEAD.

If a future session resumes this branch: the work is done and pushed. Do not
re-shoot anything without first re-reading "THE BRIEF NAMED TWO GOLDENS" above —
the three frames are `desktop-title`, `phone-landscape-title` and
`phone-portrait-title`, and that set is derived from which frames draw the main
menu, not from a failure list.
