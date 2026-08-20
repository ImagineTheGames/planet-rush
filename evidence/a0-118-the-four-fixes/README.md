# a0-118 — photograph the four things this camera found

a0-111 pointed a camera at eleven briefs that had all shipped on green CI, and
found four defects CI had passed. All four were briefed, fixed, and merged.

**A fix is a claim until something looks at it.** This directory is the same
camera, pointed at the same four screens, a day later.

## What was on `origin/main` when these frames were taken

Checked first, before anything was captured, because a verdict about a fix that
is not in the build is not a verdict:

| brief | what it fixed | on `origin/main`? |
|---|---|---|
| a0-113 | a same-tick wipe is a draw | **yes** — `6671a9de`, PR #491 |
| a0-114 | the refusal stands clear of the doors | **yes** — `cbca11c8`, PR #490 |
| a0-115 | a world label steps out of a HUD readout's rect | **yes** — `b48cf2cd`, PR #492 |
| a0-116 | the alarm arrow gives up radius to clear a readout | **yes** — `6c9963c2`, PR #493 |

All four are tests of shipped fixes. This needed saying twice: when this bench
was first built, PR #493 was still open, and item 4 was written up as a
photograph of the shipping build rather than a verdict on a0-116. #493 merged
before the frames were taken. The branch was re-baselined onto `e498b831`, the
bundle was rebuilt from it, and **every frame in this directory was re-taken
against that build** — so no frame here predates any of the four fixes, and the
build stamp in the corner of each one is the check on that claim.

## The ruler does not move

Everything here comes off the **production bundle** — `npm run build` plus
`npm run preview` on this directory's own port — on the same two profiles a0-111
used: phone landscape 798x384 dpr2 touch, and desktop 1280x800 dpr2. The build
stamp is in the corner of every frame: **no capture passes
`?freeze=1`**, because `src/main.ts` sets `buildBadge.visible = !flags.freeze`
and a frozen frame is one with the stamp deliberately hidden.

The four specs are a0-111's specs with the *measurement* untouched — same
fourteen headings in the same order, same rect intersection, same
`elementFromPoint` at the doors' own reported centres, same `mine(0)` staging
and the same held-siege pump. A re-measure taken on a different ruler is a new
opinion, not a verdict; the whole value of this run is that its numbers can be
put beside a0-111's numbers.

## How to re-run it

```
npx vite preview --port 4318 --strictPort          # or let the config build+serve
A0_118_REUSE=1 PREVIEW_PORT=4318 npx playwright test \
  --config evidence/a0-118-the-four-fixes/playwright.config.ts
node evidence/a0-118-the-four-fixes/crops.mjs
node evidence/a0-118-the-four-fixes/plates.mjs
```

`shots/` holds the specimens and a JSON readback beside each. `crops/` holds
nearest-neighbour magnifications of stated rectangles of stated frames — no
filtering, no annotation. `plates.json` composes them into the images the
manifest points at, with a caption under each frame written **after looking at
that frame**. Where a readback and an image ever disagreed, the image won and
the disagreement went in the attestation.
