# a0-55 — the station-death sting is no longer cut off by its own hush

> *"when stations die all audio cuts off you dont hear like an explosion effect"*
> — the developer, 2026-08-16.

The fall (`SOUND.stationDeath`) is **1.32 s** long. The three-second quiet
(`src/art/vfx/death-moment.ts`) took the whole mix to zero over **0.12 s** —
including the bus the fall was playing on. So the sting was audible for
**0.133 s, 10.1 % of its own length**, delivering **12.2 %** of its energy, and
then the game went silent mid-sound. **70.1 %** of the fall lived past the cut
and was never heard.

The fix is routing, not sound design: the fall now sums into `master` past the
duck node (`AudioGraph.sting`), so the quiet lands *on top of* it exactly as
GDD §4.7 orders the beat. The sound itself, the three seconds, the 0.12 s cut
and the 0.9 s return are all unchanged.

## What is here

| File | What it is |
| --- | --- |
| `envelope.txt` | The measurement: per-50 ms table of the fall on both routings, the headline ratios, and a drawn envelope. **Read this one.** |
| `envelope.ts` | The program that produced everything here. |
| `fall-before.wav` / `fall-after.wav` | The sting alone, on each routing. |
| `room-before.wav` / `room-after.wav` | The moment in context: half a second of match, a home dying, the quiet, the match coming back. The bed is *identical and ducked* in both files — the only difference is whether the fall is ducked with it. |

Regenerate (both the table and the WAVs):

```
npx vite-node evidence/a0-55-death-sting/envelope.ts > evidence/a0-55-death-sting/envelope.txt
```

## Why it can be trusted

Nothing here re-implements the game. The fall is rendered by `graph.renderSound`
— the exact call the mix makes — and the envelope is `DeathMoment.gain` advanced
by the same 1/60 s frames `AudioEngine.update` hands it, held between frames
because that is what the duck node actually receives. Change the sound or change
the quiet and re-running moves these numbers.

The bus trims and the master volume are left out of both columns on purpose:
they are identical on the two paths (the sting rides the SFX level either way),
so including them would scale every column by one constant and tempt a reader to
take an absolute number off a table whose point is a ratio.

The WAVs are evidence, not assets — they sit outside the bundle and outside
`src/`, where the project's zero-binary-audio rule applies (every sound in the
game is synthesized at runtime).

## The other half of the claim

The exemption is **one voice wide**. `envelope.txt`'s `mix` column is the
multiplier every *other* voice gets, and it is `0.000` from 0.12 s onward — the
alarm, the ambience, the soundtrack and the UI cues all still die into the
quiet. That is asserted structurally, not just measured here:

- `src/art/audio/engine.test.ts` — *the death sting outlives the hush*: the
  sting's path gain to the destination is unchanged through the cut while all
  four buses measure exactly zero at the same instant; and nothing else starts
  for the rest of the three seconds.
- `src/art/vfx/death-moment.test.ts` — *cut does not begin before the death it
  holds*: the timings the fix rests on, pinned so a later pass cannot restore
  the old behaviour by moving the cut earlier or trimming the quiet.
