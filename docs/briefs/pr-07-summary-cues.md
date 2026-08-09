# pr-07 — four new cues for the end-of-match beat, and NOT the bank's existing stings

**Owner:** Sound Agent · **needs:** `a0-01`'s re-voice (the bank's tone) · **feeds:** pr-05
**Plan:** `docs/progression-plan.md` §6.5 · **Contract:** GDD §4.7 *(amended 2026-08-06)*,
`style-guide.md` §8, `docs/audio-revoice-spec.md`

---

## The ask

The developer asked the end-of-match sequence for *"a satisfying sound."* This brief is the four
cues that sequence needs. It is **not** a request to re-use anything.

**All forty bank slots are under `deny-all` right now** (a0-01), being re-voiced to clean modern
sci-fi because the shipped set read as retro and toony. That includes `matchEnd`, and it includes
`musicWin` (*Victory Sting*) and `musicLoss` (*Defeat Sting*) in `src/art/audio/candidates.ts`.

> **A satisfying sound drawn from the denied bank is a satisfying sound the developer has already
> rejected.** No lane may reach for those three slots for this sequence.

## The four cues

| Slot | Beat (plan §6.3) | Requirement |
|---|---|---|
| `xpTick` | 1–2, the count-up | Heard **dozens of times in five seconds**, every match, forever. This is the `pressTick` problem, not the `matchEnd` one: tiny, dry, pitched *up* slightly as the count rises, and utterly non-fatiguing. If it is interesting, it is wrong. |
| `xpBarFill` | 3, the bar filling | A sustained, **rising bed** under the fill — a *filling* sound, not a repeated one. Starts and ends with the bar. Must duck cleanly under a `levelUp` landing on top of it. |
| `levelUp` | 4, the level-up | **The one moment allowed to be a reward.** Short, bright, decisive, reading as *arrival* rather than fanfare — the amended contract's ceiling, not the old one's fireworks. This is the "satisfying sound" the ask is about; the other three exist so this one lands. |
| `xpSettle` | 5, the settle | The full stop. Quiet. Tells the player the screen is finished and their input now means something. |

## Two constraints on the set, not on the individual cues

- **They mix UNDER whatever the result already sounded.** A station death is still the ache
  (GDD §4.7); the XP beat plays beneath it, never over it.
- **Silence under a skip.** A player who skipped the sequence is telling you they do not want the
  beat. Everything past `xpSettle` is cancelled — firing seven queued ticks at a player who just
  skipped is the precise opposite of what they asked for. pr-05 owns the cancel; this brief owns
  making each cue cancellable (short, no long tails that outlive the screen).

## The tone contract, since it moved

The amended §4.7 is **clean, modern, futura sci-fi**. From `docs/audio-revoice-spec.md`, binding
here: `square` and `saw` are retired from the bank (one sanctioned exception, `alarm`), and the
arcade *idioms* are retired independently of waveform — `arpMul`, `dutySweep`, `repeat`-as-a-trill,
a fast wobble, a wide glide inside a short voice. a0-01's round-2 finding is the sharper one and
applies directly to a bright cue like `levelUp`: **a stack of unfiltered sines with a linear
decay is a glockenspiel** — 83 of 116 round-1 voices carried no grain, no filter and no decay
curve, and that is what read as "cheap synthesized toy" whatever the oscillator. Use the four
capabilities `synth.ts` grew in a0-01: `decayCurve`, `resonance`, `lowPassEnd`, `bandPass`.

## Test first

1. Each cue exists as a bank slot with three review candidates in `candidates.ts`, in
   `CANDIDATE_SLOT_ORDER`, and renders to `sound-review/previews/<slot>/`.
2. `measure-bank-tone.ts` (`spikes/tone-audit/`) puts each new cue **inside** the amended tone
   envelope — no `square`, no `saw`, no retired idiom — asserted the same way a0-01 asserts the
   rest of the bank.
3. **`xpTick` survives repetition.** Assert its length and headroom against the `pressTick` bound,
   not the `matchEnd` one: it fires up to ~40 times in five seconds and must not accumulate into a
   buzz or clip the mix.
4. Nothing in the new set references `matchEnd`, `musicWin` or `musicLoss`.

## Definition of Done

```
npx tsc --noEmit
npm test -- --run
bash -c "grep -c \"'xpTick'\\|'xpBarFill'\\|'levelUp'\\|'xpSettle'\" src/art/audio/candidates.ts | grep -qv '^0$'"
bash -c "ls sound-review/previews/levelUp/ | grep -q ."
bash -c "git fetch origin main && git merge-base --is-ancestor origin/main HEAD"
```

## Evidence line

The four slots in the review page with their three candidates each, and the tone-audit table
row for each new cue beside the bank's, so "it is in the amended envelope" is a number rather
than an opinion.

## Open questions this brief is exposed to

**None of the five** — but this brief is **gated on a0-01 landing its re-voice**, because these
four cues must sit in the same room as the other forty. If a0-01 is still open, write the specs
and the tests and hold the voicing.
