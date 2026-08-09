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

## NEXT

- Nothing outstanding at the time of writing. Local DoD green, evidence
  committed, PR #333 body carries the per-snapshot justification.
- The last DoD line gates on #333's OWN rollup (LESSONS §22 — a0-14 was called
  done while its PR was red because its DoD checked local commands only). If a
  future session picks this up, re-read that check before believing a green
  local run: `gh pr checks 333`.
