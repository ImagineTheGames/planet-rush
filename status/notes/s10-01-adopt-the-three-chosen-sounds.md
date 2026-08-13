# s10-01-adopt-the-three-chosen-sounds.md — working notes (sound)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/sound/s10-01-adopt-chosen-sounds`

## BUILT

Three verdicts from `/status/sound-choices.json` are in the shipped bank.

| slot | letter | resolved to | decided |
|---|---|---|---|
| `rockChip` | **b** | `sound-review/previews/rockChip/b.wav` ← `candidates.ts#rockChip.b` (`rockChip_b_pressureBite`, *"blunt pressure bite, sub weight"*) | 04:01:48Z |
| `hullHit` | **a** | `sound-review/previews/hullHit/a.wav` ← `candidates.ts#hullHit.a` (`hullHit_a_coilBite`, *"coil bite on plate, hard and dry"*) | 04:02:30Z |
| `rockCrack` | **c** | `sound-review/previews/rockCrack/c.wav` ← `candidates.ts#rockCrack.c` (`rockCrack_c_crystal`, *"crystalline shear, ringing shards"*) | 04:03:05Z |

Every letter resolved cleanly. Nothing substituted; no neighbour taken along.

Commits:

- `51c0b90` refactor — the builders (`place`/`band`/`plate`/`swept`/`grains`) move out
  of `candidates.ts` into `src/art/audio/instrument.ts` so `bank.ts` can call them.
  Verified render-neutral: all 176 committed previews reproduce byte-for-byte after
  the move.
- `56a65d7` feat — the three bank entries, built by calling `./instrument` with the
  candidate's own arguments and seeds. Baselines re-taken, `docs/sound-adoptions.md`
  written, `sound-review/previews/*/current.wav` re-rendered for the three.
- `263241e` evidence — `evidence/s10-01-adopted-sounds.ts` + `report.json` + the
  three shipped WAVs.
- `fec0f49` notes — this file, mirrored into the repo.
- `d46f238` fix — `returns` goes back to `candidates.ts` as a module-local. CI's
  dark-matter gate was red on `51c0b90`; see DECISIONS. Render-neutral, re-checked:
  176/176 previews byte-for-byte.

Gates, all four from CI's "Typecheck, test, build" job, run locally after `d46f238`:
`npx tsc --noEmit` clean; `npx vitest run` — **292 files, 5276 tests, all passing**
(569 s); `npm run dark-matter:check` green; `npx vite build` clean, with
`candidates.ts` confirmed absent from `dist/` (the 37 denied takes do not ship).

PR **#413**, open.

## DECISIONS

**`returns` stays on the review board (`d46f238`).** The lesson of this resume: I ran
tsc and the tests locally and called the gates green, but CI's "Typecheck, test, build"
job has **four** steps, and the one I never ran went red. `51c0b90` exported `returns`
along with the builders it moved; no adopted voice has a room, so nothing in the game
calls it, and the dark-matter gate (a1-09) exists precisely to catch an export that
ships uncalled. Un-exported and moved back beside the seven un-adopted offers that use
it. *Not* allowlisted — the gate offers that escape hatch for a deliberate seam or
public surface, and this is neither; buying a weaker gate to keep a speculative export
is a bad trade. It moves to `instrument.ts` the day a slot with a room is adopted, with
a caller. **A future me: run all four gates — `tsc --noEmit`, `vitest run`,
`dark-matter:check`, `vite build` — not just the two the DoD names.**

**Shared instrument module rather than transcription.** The bank cannot import
`./candidates` (a 2 500-line review artifact; importing it would pull the 37 denied
takes into the bundle — the evidence script confirms it stays out). Copying the
builders into `bank.ts` would make every adopted voice a *re-typing* of an approved
one, and one wrong digit is inaudible in review and permanent in the game. So the
builders moved to a third module both sides import, and `candidates.test.ts` renders
the bank entry and the board's offer and compares every sample. Verified RED first:
pointing `rockChip` at letter `c` fails it.

**A guard that the other slots stay un-adopted.** `leaves every un-adopted slot
alone` walks all 41 and asserts each plays none of its three offers. Verified RED by
splicing `oreCollect`'s candidate `a` into the bank. The counting was wrong at first
draft — it is 41, not 37: thirty-seven under the standing deny-all plus the four
p1-07 summary slots nobody has been shown. Fixed in `263241e`.

**Bank-convention layer names, not board names.** Ships as `rockChip.mass` rather
than `rockChip_b.mass`. Names never reach the renderer (`synth.renderVoice` reads
`seed` and nothing else), so the sample-identity guard still holds, and the
exemption tables in `audio.test.ts` read naturally.

**Rejected: shaving the phone floor.** See NEXT — the floor was removed on purpose
with its history written out, not lowered until candidate b slipped under it. A
number quietly bent to fit looks like it still means something.

**Rejected: taking the three slots off the review board.** They stay in
`candidates.ts` as the record of what was offered. Removing them would churn
`CANDIDATE_SLOT_ORDER` and the manifest for no gain.

**Not touched:** `main.ts` (the audio observer wiring a2-07 proved live), a2-08's
tone alignment and the codex mirrors, the alarm work, the revoice already banked,
and every other bank slot.

### Baselines re-taken, and why

1. `layers the sounds that are layered` — `rockCrack` and `rockChip` are stacks now,
   so `shotImpact` becomes the single-voice example.
2. §5.3's `repeat` ban — gains the exemption the clause itself leaves open
   (*"a legitimate non-arcade use (a rattle, a stutter) … may return with a written
   reason"*). Two voices, a reason each, a 20 ms bound (the same bound
   `candidates.test.ts` has held the offers to since p1-07), and a cap of two so the
   list cannot quietly become a policy.
3. The `rockChip` phone floor — retired. See NEXT.
4. `ui-cues.test.ts`'s rockChip pin — pinned `wave: 'noise'`; now pins the adopted
   two-layer stack. The point of that test (a UI pass may not touch the rock voices)
   is unchanged.

Measured, was → now:

| | centroid | windowed zcr | energy >500 Hz | peak |
|---|---|---|---|---|
| `rockChip` | 795 → **167 Hz** | 0.0337 → **0.0024** (ceiling 0.034) | 82.9% → **0.0%** | 0.490 → 0.709 |
| `hullHit` | 3968 → **2921 Hz** | 0.0762 → 0.0654 | 34.5% → **99.9%** | 0.367 → 0.520 |
| `rockCrack` | 1720 → **1933 Hz** | 0.0762 → 0.0493 | 90.2% → 98.6% | 0.444 → 0.341 |

`rockChip`/`hullHit` separation — the game's central inversion, §2.3 — goes ×5.30 →
**×17.5**. The pair got easier to tell apart, not harder.

## NEXT

Nothing is blocked. One thing the Director should see, flagged rather than fixed:

**`rockChip` b is entirely below what a phone speaker can emit.** s7-01 §4.1
Finding 3 measured the roll-off at 500 Hz, noted `TELL.mineHit` fires all match on a
device the mobile gate makes a first-class target, and predicted a voice with 89% of
its energy under that line would arrive as *"the mining sound is gone"*.
`audio.test.ts` held the shipped chip above 40% *above* 500 Hz on that basis.
Candidate **b** is at **0.0%** above it.

The developer was offered `a` (5.4% above the line) and `c` (0.6%) beside it and
picked the heaviest of the three. A prediction about a sound nobody had heard loses
to a decision about a sound they did — so the floor is retired, in writing, in the
test that used to hold it. **The risk is open.** If the mining voice reads thin on a
phone, the fix is a new offer on the board, not a quiet re-brightening of what was
chosen. Written up in `docs/sound-adoptions.md` § *Open risk carried by an adoption*
and in the PR body.

What survives of Finding 3 is now a live guard on the other half of the pair: §2.3's
inversion is only answerable on a small speaker if one of the two firing voices lives
above the roll-off, and after this brief that is `hullHit` at 99.9%. `audio.test.ts`
fails if someone darkens it too.

Worth a Director decision at some point, not this brief: the review board still
offers three candidates for all three adopted slots. Correct as a record, but a
future reviewer opening the page will be offered choices on settled slots.

Remaining for this brief: watch PR #413's checks settle after `d46f238`. Branch is
pushed, PR is open, the four gates pass locally.
