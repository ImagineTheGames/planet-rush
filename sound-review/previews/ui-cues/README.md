# The Gantry/Bone UI cue set — listen here

Nine WAVs, one per cue, plus `walk.wav` which plays the whole set in the
handoff's table order. Regenerate with:

```
npx vite-node sound-review/render-ui-cues.ts
```

**What these are for.** The developer chose this audio themselves, from the
interactive prototype in `docs/design/gantry-bone-handoff.html`. So the review
question for s6-01 is not *"is it good"* — that is settled — but **"is what
shipped the same sound?"** These files exist so that is an A/B you can run:
open the handoff, press SOUND ON, and play `walk.wav` beside it.

They are the real `src/art/audio/ui-cues` specs through the real renderer, with
the shared room convolved in at the same 25% and through the same 620 Hz
high-pass the mix applies live (see the header of `sound-review/render-ui-cues.ts`
for why the room has to be baked here and cannot be in the game).

| file | shape |
|---|---|
| `hover.wav` | one note, high, fixed pitch |
| `detent.wav` | one note, an octave above the click, fixed pitch |
| `pick.wav` | one note, A♭6 — the forward pick |
| `confirm.wav` | two notes **rising** a fifth |
| `back.wav` | two notes **falling** a fourth |
| `purchase.wav` | three notes rising — A♭6, the fifth, the octave |
| `refused.wav` | two notes a minor second apart, resolving nowhere |
| `join.wav` | one note, stepping up by slot index (rendered at seat 0) |
| `rush.wav` | five notes climbing, then the three confirm notes struck at once and held |

Two things the files cannot show, and that the game does:

- **The per-press detune** (±0.5 semitone, one factor per cue) is a playback rate
  applied at fire time, so every press in the game varies a little. These are
  rendered at nominal pitch. Hover and detent never detune at all.
- **`join` steps by slot index** — one semitone per seat — from this one buffer.
