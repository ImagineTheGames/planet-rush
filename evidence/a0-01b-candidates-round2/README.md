# a0-01b — the board promises 3 new options on DENY. Here they are, all 40 slots.

The developer, three times, most recently looking at the board:

> *"what is going on with the sound redesign im looking on the board for the last
> few days and i still see the old sounds, none of the new ones with the theme i
> mentioned got generated..."*

Every slot on that page carries a button reading **"DENY ALL — generate 3 new
options."** They pressed it on all 40 and the queue never generated anything.
This is that generation: **120 new candidate `.wav`s, and 120 rewritten
`character` lines**, because a new sound behind an old description is
indistinguishable from no change — and those descriptions are most of what the
page actually prints.

`current.wav` on every slot is untouched. It is the shipped a0-01 re-voice and
it is the incumbent the developer is choosing against.

## What is here

| file | what |
|---|---|
| `board-three-slots.png` | **the ask** — three consecutive slots, three new descriptions each, `current` unchanged and labelled as such |
| `board-rockChip.png` | mine — the slot with ratified developer feedback on it (*"lower in tone"*, s4-01), which survives the reset |
| `board-shipExplode.png` | ship — and the context line that used to say *"firework: bang then sparkle"* |
| `board-musicTheme.png` | music — same riff, same key, three instruments |
| `board-alarm.png` | the clock — the sanctioned `saw` exception, kept in all three |
| `board-minimapPing.png` | interface — the fallback family, and the fossil name |
| `board.html` | the board itself, rendered from the committed manifest. Open it and play them |
| `spread-by-family.md` | the numbers: every slot, every family, the closest pair in each |
| `candidate-spread.json` | the raw measurement, 40 slots × 4 sounds × 6 pairs |
| `build-board.mjs` | regenerates all of the above from `sound-review/manifest.json` |

## The board screenshots are the board

The Director's review portal is not in this repo. What is in this repo is the
contract it reads — `sound-review/manifest.json` — so `build-board.mjs` renders
*that*, the way the portal renders it: the slot, its context, `current` with a
play button, and the three candidates each with their `character` line printed
next to their own play button. The words in the picture are the words on the
board by construction. If the picture is wrong, the board is wrong the same way.

## Are they a real choice?

The brief names two fake choices by name: three variations on one idea, and a
candidate that is the incumbent with a filter on it. That is a claim about
numbers, so `spikes/tone-audit/measure-candidates.ts` checks it per slot before
the board goes back in front of anyone.

Every pair — a·b, a·c, b·c, and each of the three against `current` — has to
clear a band-profile cosine distance of **0.06** *or* a spectral-centre ratio of
**×1.25**. Two floors rather than one, because a legitimate pair can be
separated by either axis.

> **240 pairs across 40 slots. 0 below the floor.**

That is a floor under an ear judgement, not a substitute for one — but it is the
floor that caught the sixteen offers listed in the commit messages, which were
designed to be different and measured as the same. The most instructive case is
`musicBed` and `musicDread` *before* this pass: every pair in both slots scored a
profile distance of **0.00**, against `current` and against each other. All four
sounds in each slot were the same sub-bass triad at four levels. "Three
variations on one idea" was not a risk there, it was the shipped state.

## What carries the register

`a0-01`'s own post-mortem is the map and it is not re-learnt here: round 1
retired `square`, replaced it with bare sine partials on a linear decay, and
produced *"a glockenspiel… an arcade blip swapped for a toy xylophone. Not less
toony, differently toony."* **The instrument carries the register, not the
oscillator.** So every offer is built from five builders made out of the round-2
synth — resonant noise bands, inharmonic struck plates, moving filter corners,
granular excitation, and late diffuse returns — and a bare waveform with an
envelope on it is not an offer this round makes.

Read down a column of `spread-by-family.md` and the axis is the same on all forty
slots — `a` is granular contact, `b` is pressure and mass, `c` is the one that
rings — while the metaphor is new in every family. A forty-slot board that has
already been walked away from once is swept in one pass if the question is the
same question each time.

`musicTheme` is the thesis in one slot: all three offers sound the shipped seven
notes at the shipped times, and the only thing being chosen is what plays them.

## Two things this does not change, on purpose

- **`src/art/audio/bank.ts`.** The shipped bank is a0-01's and it is live. This
  round only changes what the developer can audition it against; promoting a
  winner is a separate brief.
- **`sound-review/previews/alarm/current.wav`.** It is **stale** — s9-01 made the
  alarm sound once per engagement instead of looping, so the committed 16-second
  tiled preview is a fossil of a sound the game stopped making, and re-running
  the renderer regenerates it to the real 0.6 s one-shot every time. It is
  reverted in every commit here because the brief fences `current.wav` off by
  name. **It should be regenerated, and that is a Director call, not this
  brief's.** The three `alarm` *offers* were one-shots from the start of this
  round, so the slot is at least no longer A/B-ing three loops against it.
