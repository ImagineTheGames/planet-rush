# s8-01 — bank re-voice round 2 (all 40 slots denied)

Branch: `agent/sound/s8-bank-revoice-round2`. Started 2026-08-08.

## BUILT

| commit | what |
|---|---|
| `c649c7d` | `synth.ts`: `decayCurve`, `resonance`, `lowPassEnd`, `bandPass` |
| `37b1abb` | `strike()` replaces `struck()`; rockChip/hullHit/rockCrack/rockBurst/turretFire/shotImpact |
| `abf1daa` | the remaining 27 slots — fight, spend, clock, stationDeath, alarm, the soundtrack |
| `8582f92` | `audio.test.ts`: the four round-2 clauses + a real headroom ceiling |
| `3477122` | all 40 `sound-review/previews/*/current.wav` regenerated; `render.ts` no longer deletes `ui-cues/` |
| `4b6506c` | the comments that still described round 1 as the answer |
| `842982a` | `spikes/tone-audit/probe-live-audio.mjs` — the live-bytes probe for QA |

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
| `public/sw.js` navigations | network-first since `fc192a9` (2026-07-23); `version.json` explicitly never cached |

No stale-build path to blame. The round-1 bank is what is being played.

### H2 is CONFIRMED — but the brief's census was stale, and the real number changed the fix.

The brief quotes `triangle 40 · sine 19 · noise 18`. That is the **pre-#290** sine
count. Round 1 replaced every `square` with `struck()` — a stack of **bare sine
partials** — and `sine` went from 17 of 89 voices to **56 of 116, 48.3%**.

The weight landed on **sine**, not triangle. And the deeper number:

> **83 of 116 voices — 71.6% of the rejected bank — carried no grain, no filter
> of either kind and no decay curve.** Tone generators sounding, not bodies
> being struck.

A stack of unfiltered sines with a linear decay is a glockenspiel. Round 1
swapped an arcade blip for a toy xylophone — not less toony, differently toony.

### The fix: change the instrument, not the oscillator.

Four structural properties survived round 1 completely intact, and all four read
as "cheap synthesized toy" whatever waveform is underneath: a **linear decay**
(`synth.ts` had exactly one envelope, `1 - d`), **bare unfiltered tone
generators**, **no filter movement anywhere in the bank**, and **no transient
material**. So `synth.ts` grew four capabilities — `decayCurve`, `resonance`,
`lowPassEnd`, `bandPass` — all optional, all defaulting to the previous
behaviour exactly, and the bank spends them.

### Rejected: a synth-level reverb / `space` parameter.

`synth.ts:296` states the file's own rule — layered sounds stack rendered parts
*"rather than by growing the voice model into a small modular synth nobody can
tune."* Space belongs on large events, not on a 28 ms UI tick where it only
smears the mix on the speaker the mobile gate makes a first-class device. So
`shipExplode` alone gets two late returns, written as ordinary layers.

### Rejected: touching `ui-cues.ts`.

The Gantry/Bone set was chosen **by ear by the developer** (s6-01) and is not
among the 40 denied slots. `GLASS_PARTIALS = [1, 2.76, 5.4]` is inharmonic and
correct — the ratios were never the problem, the bare-sine *rendering* of them
was. Round 2 keeps the ratios and re-renders them as struck metal. Independently
attested: re-running `render-ui-cues.ts` reproduced all ten cue WAVs
byte-identical.

### Rejected: contorting the bank to hit a rounder sine percentage.

Round 2 sits at 41.5% sine and the monoculture backstop is 45%. Those are the
ratified partials, and every one now carries grain and a real tail. **Bare-ness
was the defect, not sine-ness** — optimising the census number instead of the
sound is the exact mistake s7-01 §4.1 proved these metrics invite.

### The alarm holds its saw, and gains a horn.

§2.2 legibility outranks register and the brief names it under "what must not
change". Both voices, both pitches, the minor third and the loop are untouched.
What it gains is a resonance at the corner — a horn body, so it reads as a
station siren rather than a synth buzzing. Still the loudest thing in the bank.

### `stationDeath` is re-voiced with its shape held to the millisecond.

Denied like every other slot, so it moved — but same pitches, same fall, same
1.32 s, same refusal to resolve, still the longest tail. Only the material
changed, and its decay curves are the gentlest in the bank (1.4–2.2) because
this beat must **run out**, not snap shut. The three-second hush is a `graph.ts`
mixer node and nothing here goes near it.

### The contract test was verified RED before it went green.

| bank | contract | result |
|---|---|---|
| round 1 (`origin/main`) | round 2 | **RED** at `rockBurst.ore.p0` |
| round 2 | round 2 | GREEN |
| round 2 | round 1 (s7-01 §5, still in the file) | GREEN |

A contract that only forbids `square` cannot fail on the sound the developer is
complaining about. That is why it did not.

## Numbers

```
                        round 1 (rejected)    round 2
voices                        116               135
sine                     56 (48.3%)        56 (41.5%)
triangle                 40 (34.5%)        40 (29.6%)
noise                    18 (15.5%)        37 (27.4%)
saw                       2 (alarm)         2 (alarm)
square                        0                 0
BARE tone generators     83 (71.6%)         6 (4.4%)
filter sweeps                 0                24
resonant voices               0                84
band-pass transients          0                21
peak headroom          up to 1.000 (clamp)  max 0.897
```

## The probe (read this before diagnosing round 3, if there is one)

`node spikes/tone-audit/probe-live-audio.mjs [url] [--dist dist/assets/index-*.js]`

Answers *"is the developer hearing this build?"* in two seconds. Verified to
discriminate in both directions before it was committed:

| target | result |
|---|---|
| live deployment, sha `4960540` (= `main`) | 6 checks FAIL, exit 1 |
| a local build of this branch | all PASS, exit 0 |

`main`'s HEAD is deployed **right now** and is still serving the rejected bank —
H1 falsified a second time, after `main` moved mid-session.

## NEXT

- [x] push, open PR — **#314**
- [ ] QA: after merge + deploy, run the probe against the live site, **then
      listen**, and file the evidence item naming the served sha. The probe
      proves the bytes and says so; it does not prove anyone listened.
      Merged is not shipped and shipped is not heard (LESSONS §2, §11).
- Open, not acted on: `docs/audio-revoice-spec.md` §11 Q1 (VFX), Q2 (bot names),
  Q7 (`minimapPing` is a fossil name on a live sound), Q8 (identifier renames).
  All still developer calls; round 2 renamed nothing.
