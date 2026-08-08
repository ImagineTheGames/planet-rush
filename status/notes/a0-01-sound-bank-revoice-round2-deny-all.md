# s8-01 — bank re-voice round 2 (all 40 slots denied)

Branch: `agent/sound/s8-bank-revoice-round2`. Started 2026-08-08.

## BUILT

_(nothing committed yet — diagnosis first, per the brief)_

## DECISIONS

### H1 is FALSIFIED. The developer heard round 1.

Measured against the LIVE deployment, not against `main`:

| check | result |
|---|---|
| `GET /planet-rush/version.json` | `{"sha":"0491127","time":"2026-08-07T23:03:53.892Z"}` |
| `git merge-base --is-ancestor ff64364 0491127` | **true** — PR #290 (the s7-02 re-voice) is in the deployed tree |
| live `assets/index-DRMbr3Yk.js`, `rockChip` spec | `wave:"noise",attack:8e-4,hold:.009,decay:.062,punch:.55,freq:92,freqEnd:82,lowPass:820,highPass:130,gain:.42,seed:40503` |
| local `dist` built from `main` today | **byte-identical string** |
| wave-literal census, live bundle vs local dist | identical (square 3 / saw 3 / triangle 44 / sine 20 / noise 21 — all synth `case` labels + `ui-cues`, not the bank) |
| `public/sw.js` navigation strategy | network-first since `fc192a9` (2026-07-23) — **every** shipped `CACHE_VERSION` (v1 excepted, never deployed with audio) serves a fresh index; `version.json` is explicitly never cached |

So there is no stale-build path to blame. The round-1 bank is what is being played.

### H2 is CONFIRMED — but the brief's census is stale, and the real number changes the fix.

The brief quotes `triangle 40 · sine 19 · noise 18 · saw 2 · square 0`. That is the
**pre-#290** sine count. Today, `npx vite-node spikes/tone-audit/measure-bank-tone.ts`:

```
=== WAVEFORM CENSUS — 40 sounds, 116 voices ===
  square      0  (0.0%)
  saw         2  (1.7%)
  triangle   40  (34.5%)
  sine       56  (48.3%)      <-- was 17 of 89 before round 1
  noise      18  (15.5%)
```

The weight did **not** land on triangle. It landed on **`sine`, 56 of 116 voices —
48.3% of the bank**, because round 1 replaced every `square` with `struck()`
(`bank.ts:254`): a stack of two or three **bare sine partials**, 2 ms attack, **linear**
decay, **no filter of any kind**, no transient, no space.

A stack of bare sines with a linear decay is a glockenspiel. Round 1 swapped an
arcade blip for a **toy xylophone** — which is not less toony, it is differently toony.
That is why the same sentence came back.

### The real finding: round 1 changed *which* oscillator, not *how a sound is made*.

Four structural properties survived round 1 completely intact, and they are what
reads as "cheap synthesized toy" independent of any waveform:

1. **Linear decay.** `synth.ts` had exactly one envelope: `env = 1 - d`. Nothing
   physical decays linearly; a straight ramp to zero is the most synthetic envelope
   there is, and every percussive voice in the bank had one.
2. **Bare, unfiltered tone generators.** Every one of the ~40 `struck()` partials
   carried no `lowPass`, no `highPass`, no `noiseMix`. A raw sine is a test tone.
3. **No filter movement anywhere.** Both filters were one-pole and static. There
   was not a single swept or resonant filter in the bank.
4. **Bone dry.** No reflections, no tail, no sense of a place.

### The fix: change the instrument, not the oscillator.

`synth.ts` gains four capabilities (all optional, all back-compatible), which are
the register the brief names — *"filtered noise, granular and metallic transients,
resonant sweeps, short bright attacks with real decay tails"*:

- `decayCurve` — exponential decay tails.
- `resonance` — promotes the low-pass to a state-variable filter with a peak.
- `lowPassEnd` — a swept cutoff. `resonance` + `lowPassEnd` = the resonant sweep.
- `bandPass` — the SVF's band output: narrow, pitched, metallic noise.

### Rejected: a synth-level reverb / `space` parameter.

`synth.ts:296` states the file's own rule — layered sounds are built by stacking
rendered parts *"rather than by growing the voice model into a small modular synth
nobody can tune."* Space belongs on a handful of large events (an explosion, a
station dying, the collapse), not on a 28 ms UI tick where it only smears the mix
on a phone speaker. So reflections are expressed **as layers**, where they stay
diffable and reviewable, and the synth stays a voice model.

### Rejected: touching `ui-cues.ts`.

The Gantry/Bone cue set was chosen **by ear by the developer** (s6-01) and is not
among the 40 denied slots. `GLASS_PARTIALS = [1, 2.76, 5.4]` is inharmonic and
correct — the ratios were never the problem, the bare-sine *rendering* of them in
the bank was. Round 2 keeps the ratified ratios and re-renders them as struck
metal, so the bank and the menu stay one game.

## NEXT

- [ ] synth: `decayCurve`, `resonance`, `lowPassEnd`, `bandPass`
- [ ] re-voice all 40 slots
- [ ] regenerate `sound-review/previews/*`
- [ ] evolve `audio.test.ts`: oscillator-mix budget + bare-tone budget + decay-tail clause
- [ ] `npx tsc --noEmit`, `npm test -- --run`, census
- [ ] PR + QA handoff for a LIVE-deployment evidence item
