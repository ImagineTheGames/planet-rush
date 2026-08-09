# p1-07 — the four end-of-match summary cues

The brief's evidence line, in two halves:

> The four slots in the review page with their three candidates each, and the
> tone-audit table row for each new cue beside the bank's, so *"it is in the
> amended envelope"* is a number rather than an opinion.

| file | what |
|---|---|
| `board-four-slots.png` | **the first half** — all four slots in one frame, in the order the sequence plays them: `current`, then a/b/c with the `character` line the board prints |
| `board-levelUp.png` | the slot the developer's ask is actually about, on its own |
| `board.html` | the board itself, rendered from the committed manifest. Open it and play them |
| `build-board.mjs` | regenerates both from `sound-review/manifest.json` |
| `numbers.txt` | **the second half** — the tone-audit rows, the set-level constraints, the repetition number |
| `numbers.ts` | regenerates `numbers.txt` out of the shipped modules |

```
node evidence/p1-07-summary-cues/build-board.mjs
npx vite-node evidence/p1-07-summary-cues/numbers.ts > evidence/p1-07-summary-cues/numbers.txt
```

## The board is the manifest

The Director's review portal is not in this repo; the contract it reads is
(`sound-review/manifest.json`). `build-board.mjs` renders *that* — the same
layout a0-01b's board used, deliberately unchanged, because these four arrive on
the same page as the forty and a picture that styled them differently would be
evidence about a page that does not exist. The words in the picture are the words
on the board by construction.

One difference from a0-01b's generator: the WAV paths here are **relative**. That
board baked in absolute `file:///lanes/lane-2/...` URLs, which only play back in
the lane that wrote them.

## The claim, and where each number comes from

**In the amended envelope.** `numbers.txt` §2 prints the audit's own retro-tell
column — square/saw, duty sweep, arpeggio, `repeat`, an audible wobble, a chirp —
for each new cue, beside `pressTick`, `matchEnd`, `musicWin`, `musicLoss` and
`stationDeath`. All four come back empty. The census after the four is 44 sounds,
146 voices, **square 0, saw 2**, and the two saws are still `alarm.low` /
`alarm.high`, the sanctioned klaxon (§2.2).

**Under the result.** §3, as RMS *as played* — the bar bed at its seam ceiling,
because a held voice's level is a mix parameter. `matchEnd` is 0.0967 and the four
land at ×0.10 / ×0.33 / ×0.48 / ×0.26 of it. The level-up is the loudest of the
four by design and still under the result: the XP beat plays beneath the ache.

**Survives repetition.** §4. Forty ticks, each pitched by the rise the seam
applies, at 8, 20 and 40 per second: peak 0.0855 at every rate, which is *one*
tick's peak. They do not stack at all — each is gone before the next arrives. It
is also the quietest sound in the bank.

**Not the denied stings.** §5. 0 of 34 voices across the four shipped cues and
their twelve candidates appear in `matchEnd`, `musicWin` or `musicLoss` or in the
offers currently standing against them.

## What this is not

**Nobody has listened.** These are numbers and a page; the choice between a, b
and c is the developer's and has not been made. Merged is not shipped and shipped
is not heard.
