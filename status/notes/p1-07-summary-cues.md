# p1-07-summary-cues.md — working notes (sound)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/sound/p1-07-summary-cues`, cut from `origin/main` @ fa55346,
merged up to `be3c5dd` (p1-01 landed mid-lane).

## THE FIRST THING TO KNOW

**The gate is met.** The brief is *"gated on a0-01 landing its re-voice"*. It
landed: PR **#314** (`s8-01: bank re-voice round 2`) is **MERGED**, `synth.ts`
on main carries `decayCurve` / `resonance` / `lowPassEnd` / `bandPass`, and
`bank.ts`'s header documents round 2 as shipped. So this lane **voiced** rather
than holding the voicing.

## BUILT

| commit | what |
|---|---|
| `782cb44` | `bank.ts`: the four slots — `xpTick`, `xpBarFill`, `levelUp`, `xpSettle` — plus the seam (3 new `AudioCue`s, `XP_TICK_SEMITONES`, `AudioEngine.xpFill` / `stopXpFill`) |
| `c1fb32b` | `candidates.ts`: 4 slots × 3 offers, `CANDIDATE_SLOT_ORDER`, re-rendered previews + manifest (board 40 → 44) |
| `86e0df4` | `audio.test.ts` + `candidates.test.ts`: the envelope, the `pressTick` bound, repetition, under-the-result, cancellable, not-the-denied-three, and the seam |
| `d5afa4b` | `evidence/p1-07-summary-cues.ts` → `.txt` — the board, the tone-audit rows, the numbers |
| (this) | the brief annotated; these notes |

## DECISIONS

### `xpBarFill` is a LOOP. This is the one structural call in the brief.

The plan wants *"a sustained, rising bed… starts and ends with the bar"* and
*"silence under a skip"*. Those two together rule out a long one-shot: this mix
graph has **no handle on a one-shot in flight** (`graph.play` returns a boolean),
so a 1.4 s bed would keep sounding after a skip — the precise thing §6.5 forbids.
The bar's length is not knowable at its start either (§6.3 caps each subsequent
fill at 0.5 s and collapses past three).

So: a looping spec, started and stopped through `AudioEngine.xpFill(progress)` /
`stopXpFill()`. The **rise lives at the seam**, not in the body, because a filter
sweep inside a loop restarts every lap and is heard as a pulse — the one artefact
`synth.seamless` exists to kill. The seam rides gain (`XP_FILL_FLOOR`→1) and rate
(+`XP_FILL_RISE`, a major third at the top).

### Rejected: building any of the four out of `strike()`.

`strike()` is the ratified Gantry/Bone material and it is the sound of a
**confirmation** — a pick, a purchase, a refusal, a chunk banked. A level-up made
of it is a wheel press with more notes on it. The four are made of swept resonance
and band-passed material instead: same round-2 instrument, different gesture.

### Rejected: routing the summary cues through `CUE_UI` (the glass set).

The Gantry/Bone set is *the interface answering a finger*. The summary is the one
screen where the player is **not touching anything** — it plays itself, and the
first touch **skips** it. `xpTick` → `pick` would tell a player their taps were
registering while the screen counted itself up.

### Rejected: forty specs for the count-up's rise.

*"Pitched up slightly as the count rises"* is playback rate (`XP_TICK_SEMITONES`,
capped at `XP_TICK_STEPS_MAX`): one buffer and a number. And **capped** — a
count-up has no fixed length, so an uncapped rise ends somewhere different every
match and, on a long one, somewhere shrill. 4.2 semitones end to end.

### Rejected: the mix's pitch jitter on `xpTick`.

Every other cue gets `graph.jitter(0.04)`. Jitter around a climbing pitch is heard
as the climb wobbling; the plan asks for a line, not a cloud. `cueRate()` is where
the two are kept apart, with the reason written down.

### `levelUp` is a bare fifth, struck as one chord.

No third — the interface does not congratulate (§4.7 register 2), and this cue can
land on top of a **DEFEAT** headline. No rising phrase either: that is the retired
arcade idiom (§5.3) *and* what `upgradeBought` already is. Approach (a filter
opening, not a pitch chirp), landing, ring out.

### Every new assertion was verified RED before it was left green.

Eleven deliberate breakages: a `saw` in `levelUp`, a loud tick, a long tick, a
non-looping bed, the `levelUp` cue re-pointed at `musicWin`, the rise removed, the
duck removed, the hush ignored by `xpFill`, `reset()` leaking the bed, a
non-looping candidate, a `saw` candidate. Each failed exactly the test that names
it. A contract that cannot fail on the defect is the a0-01 lesson.

### One thing fixed that this brief did not cause.

Re-running `sound-review/render.ts` rewrote `previews/alarm/current.wav`: it was
1.4 MB of **16-second tiled LOOP**, which is what the alarm was before s9-01 made
it a once-per-engagement sting. The board was offering the developer a klaxon the
game no longer plays. It is now the 0.61 s one-shot the bank holds. Flagged in the
PR body, not buried.

### The brief, annotated (the plan wins, but nothing disagreed).

Read line by line against plan §6.5: **no contradiction**. The one imprecision —
test 2 says `measure-bank-tone.ts` *asserts* — is annotated in the brief: that
file is the Architect's measurement spike and asserts nothing, so the assertion
lives in `audio.test.ts` (where a0-01's own tone contract lives) and the spike's
table is the evidence. No file outside `src/art/audio/`, `sound-review/`,
`evidence/`, `docs/briefs/` and `status/notes/` was touched.

## VERIFIED

- `npx tsc --noEmit` clean.
- `npm test -- --run` — **4434 passed, 255 files** (pre-merge run); audio +
  progression re-run green after merging `origin/main` @ `be3c5dd`.
- The brief's own DoD greps: `candidates.ts` carries all four slot ids;
  `sound-review/previews/levelUp/` is non-empty; `origin/main` is an ancestor.
- Board renders 44 slots / 132 candidates, peak 0.897 across every preview.

## NEXT

- PR open; watch checks. Nothing outstanding in the lane.
- **For pr-05 (the sequence), the seam is:** `audio.cue('xpTick', i)` per tick
  (`i` = the tick's ordinal, it rides up), `audio.xpFill(p)` each frame the bar
  moves and `audio.stopXpFill()` when it stops or the player skips,
  `audio.cue('levelUp')` on beat 4 (it ducks the bed itself), and
  `audio.cue('xpSettle')` on beat 5. All four are no-ops with no audio context.
- **Still the developer's call, untouched here:** which of the three offers per
  slot ships. The board is generated; nobody has listened yet. Merged is not
  shipped and shipped is not heard.
