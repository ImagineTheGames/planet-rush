# The audio re-voice — from Saturday-morning to clean sci-fi

**Brief:** s7-01 · **Author:** Architect Agent · **Date:** 2026-08-06
**Status:** the contract amendment is RATIFIED and merged (GDD §4.7, `style-guide.md` §8).
**The per-sound plan below is a SPEC, not a change** — s7-02 implements it.
**Implements:** GDD §4.7 (amended 2026-08-06) · **Constrained by:** §2.2, §3.6, §4.3, §4.9, §5.8

---

## 0. The decision, in one page

The developer's report was about sound:

> *"they all sound toony, and not sci-fi, they should have a clean sci-fi sound
> not this cartoony retro sound.. it needs to be modern/futura"* — 2026-08-05

**The sounds are not the defect. The contract they were built against is.** GDD
§4.7 ordered *"Ships are toys, explosions are fireworks, bots are cartoon rivals
with names… Arcade on the surface"*, `style-guide.md` §8 quoted it as the
paragraph *"every asset, every VFX, every sound is judged against"*, and the
audio implemented it faithfully and says so in its own source:

```
src/art/audio/synth.ts:46
  /** Hollow and arcade — the default voice of a toy (tone contract, §8). */
  | 'square'
```

So the fix is the paragraph, and it has landed: §4.7's tone paragraph is now
**clean, modern, futura sci-fi**, with the station-death ache carried over
verbatim and the visible-**and**-audible-tell mandate untouched and explicitly
promoted above the register. This document is the other half — the per-sound
plan that brings the bank into line with the amended contract.

Three decisions carry the whole spec:

1. **`square` and `saw` are retired from the bank**, with exactly one sanctioned
   exception (`alarm` — legibility outranks register, §2.2). They are 28 of the
   bank's 89 voices, and they are the two shapes the ratified Gantry/Bone handoff
   independently names as *"what made earlier passes sound retro or cartoonish."*
2. **The oscillator is not where most of the toy lives.** Measured: removing
   `rockChip`'s downward chirp moves its spectral centroid by 154 Hz and its
   zero-crossing rate by 14%; removing its vibrato moves *nothing* measurable.
   The arcade idioms — `arpMul`, `dutySweep`, `repeat`-as-a-trill, a fast wobble,
   a wide glide inside a short voice — are wave-independent, and they are retired
   by their own clauses (§5).
3. **`rockChip` is in scope and is the worked example (§6).** It is the sound the
   developer has now judged twice, and the second report is explained by a fact
   this spike turned up: **s4-01's lowering never reached the game.** The shipped
   `rockChip` spec is byte-identical to its a3-02 form (`6cb84d8`, 2026-07-27);
   s4-01 (`bfbc3b3`) changed `candidates.ts` and the review WAVs only, and
   `candidates.ts` is imported by nothing in the game. The developer heard no
   change because there was none.

**What does NOT move in this pass, and why it is written down rather than done:**
§4.7 also governs VFX (*"explosions are fireworks"*) and bot naming (*"cartoon
rivals with names"*). The report was about **sound**. Restyling every explosion
and renaming seven bots off one sentence about audio would be over-reach, so both
are **open, unratified developer questions** (§11) and no agent may act on them
until they are ruled. The amendment says so in the GDD itself.

---

## 1. What this document is, and is not

| It is | It is not |
|---|---|
| The per-sound execution list for s7-02 | A change to any sound. Nothing in `src/` moved in this PR |
| A needs-ordered task breakdown with TDD steps (§9) | A licence to restyle VFX or rename bots (§11 Q1, Q2) |
| A set of measured invariants a re-voice may not break (§8) | A tuning pass. Levels stay where `bank.ts` sets them unless §7 says otherwise |
| Reproducible: every number has a command (§2) | A taste document. Where taste is required, it is a question (§11) |

**Ownership.** The Sound Agent owns `src/art/audio/`. This document does not
write there; it tells that agent exactly what to write, in what order, and what
to prove. Where a measurement wanted a hook in production code, the hook is
described here rather than added (there was only one, and it was avoidable: the
spikes render the real bank through the real synth).

---

## 2. Reproducing every number in this document

Two throwaway programs under `spikes/tone-audit/`. Neither is in the bundle,
neither is in the tsconfig `include`, and nothing in `src/` imports either.

```bash
# The whole-bank census: waveforms, spectral centroid, level, duration,
# per-sound retro tells, and the measured margin on every at-risk pair.
npx vite-node spikes/tone-audit/measure-bank-tone.ts
npx vite-node spikes/tone-audit/measure-bank-tone.ts --csv   # for §7's table

# What each rockChip parameter is worth, one removed at a time.
npx vite-node spikes/tone-audit/rockchip-ablation.ts
npx vite-node spikes/tone-audit/rockchip-ablation.ts --wav   # writes previews/
```

**The columns, and why each one is there.**

| Column | What it is | Why it is here |
|---|---|---|
| **centroid** | Spectral centroid in Hz, by Hann-windowed 8192-point FFT of the loudest window | The single closest number to "how bright". The word *"lower"* is usually about this |
| **zcr** | Zero crossings per sample | The cheap brightness proxy `audio.test.ts` and `candidates.test.ts` already assert against. Reported so a proposal can be checked against those ceilings directly |
| **phone** | Share of energy above 500 Hz | A phone speaker rolls off hard below that. This is the number that makes "lower" dangerous — the mobile gate (§4.3) is a first-class target |
| **sub** | Share of energy below 200 Hz | Costs headroom, stacks on retrigger, and a phone cannot emit it |
| **@rate** | RMS overlap-added at the mix's retrigger ceiling (`graph.ts` `repeatGap` = 0.035 s → 28.6 Hz) | Mining is a held trigger. This, not the single hit, is what a player hears |
| **mod pk** | Where the frame-to-frame grain-rate variation peaks, measured on a 1-second sustain probe with the glide flattened | Isolates the vibrato. A coherent peak at the vibrato rate means the wobble is audible; no peak means it is buried |

**One honest limit, stated up front.** `mod cv` (the magnitude of that variation)
is **not** diagnostic on a noise oscillator — the grain's own randomness sits at
0.21–0.29 whatever the spec says. Only the *location* of the peak carries
information, and it only resolves when the modulation is large relative to the
grain rate. That limitation is itself a finding (§4.2).

---

## 3. The evidence: the waveform census

```
=== WAVEFORM CENSUS — 40 sounds, 89 voices ===

  square      21  (23.6%)
  saw          7  (7.9%)
  triangle    29  (32.6%)
  sine        17  (19.1%)
  noise       15  (16.9%)
```

**The 21 `square` voices.** `rockBurst.ore`, `oreCollect`, `holdFull.a`,
`holdFull.b`, `turretFire`, `shipExplode.crack`, `shipExplode.sparkle`,
`shipSpawn.land`, `buildPlaced.clunk`, `bankOre.drop`, `bankOre.settle`,
`upgradeBought.arp`, `musicTheme.n0`–`n4`, `musicWin.n3`, `pressTick`,
`depositTick`, `respawnGo.top`.

**The 7 `saw` voices.** `hullHit.bite`, `shieldDown.fall`, `waveArrive.horn`,
`waveArrive.fifth`, `alarm.low`, `alarm.high`, `rejectBuzz`.

Both lists concentrate exactly where the developer said the problem is: the
things a player hears constantly in a match (mining, firing, collecting, banking,
buying) and the two UI fallbacks. The `triangle`/`sine`/`noise` two-thirds of the
bank is already largely in the new register — the thruster, the ambient bed, the
collapse, `coreHit` and `stationDeath` need nothing.

---

## 4. The evidence: what "toony" actually measures as

### 4.1 The ablation

`npx vite-node spikes/tone-audit/rockchip-ablation.ts`:

```
  variant        centroid  zcr(2k)  phone    sub  peak    rms  @rate  vs hull  mod pk
  shipped         2281 Hz   0.0483    69%    11%  0.45 0.1040 0.1797    ×3.92    39Hz
  −wobble         2294 Hz   0.0474    69%    12%  0.46 0.1050 0.1850    ×3.92    86Hz
  −chirp          2435 Hz   0.0532    65%    10%  0.45 0.1014 0.1752    ×3.42    39Hz
  −both           2429 Hz   0.0552    66%    10%  0.46 0.1016 0.1718    ×3.33    86Hz
  s4-01 "a"        918 Hz   0.0166    11%    57%  0.31 0.0866 0.1114   ×11.00    83Hz
  octave-only     1357 Hz   0.0244    39%    26%  0.44 0.1010 0.1588    ×7.76    22Hz
  octave −wob     1366 Hz   0.0244    39%    26%  0.44 0.1011 0.1702    ×7.91    86Hz
  PROPOSED        1815 Hz   0.0327    56%    12%  0.46 0.1056 0.1467    ×5.30    12Hz
```

**Finding 1 — the brightness metrics are blind to the character.** Removing the
vibrato moves the centroid from 2281 to 2294 Hz: 0.6%, which is noise. Removing
the chirp moves it 154 Hz and the zero-crossing rate 14%. A pass that optimises
"lower" as a number can therefore hit its target and leave the toy in place —
which is exactly what a re-voice must not repeat. **The waveform policy (§5) is
not enough on its own; the modulation and glide clauses are what carry it.**

**Finding 2 — transposing down makes a wobble MORE audible, not less.** At the
shipped 150 Hz grain the 22 Hz vibrato produces no coherent peak (39 Hz, noise).
Transposed to a 75 Hz grain with the vibrato untouched, the peak lands **exactly
on 22 Hz** — and its control, the same transposition with the vibrato removed,
goes back to noise (86 Hz). A ±6% modulation is ±9 Hz at 150 Hz and ±4.5 Hz at
75 Hz, but the *grain rate itself* fell by an octave, so the modulation is a far
larger share of it. **You cannot lower this voice while keeping the wobble.**
Any pass that lowers first and shapes second will make the complaint worse.

**Finding 3 — "lower" has a floor, and it is the phone.** s4-01's candidate "a"
puts **89% of its energy below 500 Hz** (`phone` 11%, `sub` 57%). A phone speaker
cannot emit most of that. `rockChip` is `TELL.mineHit`, it fires all match, and
the mobile gate (§4.3) makes the developer's own phone a first-class target — so
that candidate would have arrived as *"the mining sound is gone"*. The proposal
in §6 lands at 56% above 500 Hz against the shipped 69%: audibly lower, still a
sound a phone can make.

### 4.2 Why the developer heard the same sound twice

```bash
$ for c in $(git log --format=%h --all -- src/art/audio/bank.ts); do
    git show $c:src/art/audio/bank.ts | grep -A16 '\[SOUND.rockChip\]:' \
      | grep -E 'freq:|freqEnd:|vibrato|lowPass|gain:'; done
```

Every revision of `bank.ts` back to a3-02 returns the same six numbers:
`freq: 150, freqEnd: 100, vibratoDepth: 0.06, vibratoRate: 22, lowPass: 1150,
gain: 0.4`. s4-01 (`bfbc3b3`, *"the rockChip trio, transposed down an
octave-plus"*) touched `candidates.ts`, `candidates.test.ts`,
`sound-review/previews/rockChip/*.wav` and `sound-review/manifest.json` — and
said so plainly in its own commit message: *"The bank is untouched this brief
(candidates are parallel)."*

That is correct process (candidates await a Director approval file) and it is
also why the second report exists. **Nothing guards the shipped bank against the
ratified direction.** `candidates.test.ts` locks the *candidates* under a
zero-crossing ceiling of 0.034; the shipped voice measures 0.0483 and no test
looks at it. §9 T2 closes that hole.

---

## 5. The policy

Four clauses. Each is enforceable as a test (§9 T8), and each names its exceptions
so nobody has to guess.

### 5.1 Oscillators

> **`square` and `saw` do not appear in `src/art/audio/bank.ts`.**
> Sanctioned exception: **`alarm.low` and `alarm.high`.**

- **What replaces `square`.** By job, not by rule of thumb:
  - *A confirmation, a pick-up, a UI blip* → a **struck note**: a sine
    fundamental with a short strike and a fast-decaying upper partial or two. The
    ratified Gantry/Bone instrument (`ui-cues.ts`, `GLASS_PARTIALS = [1, 2.76,
    5.4]`) is the reference, and where a world tell wants that exact material it
    should say so and reuse the ratios rather than re-invent a spacing.
  - *A musical note* → `triangle`, or `sine` where the line must sit under
    something else. `musicTheme`'s five square notes are the only melodic ones.
  - *A body/impact layer* → **filtered `noise`** with a `lowPass`, or a `triangle`
    with a small `noiseMix`. A square with a low `duty` was doing an impact's job
    with a tone generator.
- **What replaces `saw`.** Saw is documented as *"Bright and rude: firing voices,
  alarms."* Rudeness is not the register; **cut** is. A `triangle` with
  `noiseMix` 0.1–0.25 and a `highPass` gives the bite without the buzz. The one
  place rudeness is the mechanic is the alarm, which is why the alarm keeps it.
- **Why the alarm is exempt.** §2.2 specifies *"an unmistakable alarm"* and §4.9
  puts it on the not-cuttable list. A saw's dense harmonic stack is what makes a
  klaxon refuse to sound like music; softening it trades a mechanic for a
  register, which §4.7's own precedence rule forbids. Offered to the developer as
  a question anyway (§11 Q3), because it is the one exception in the spec.

### 5.2 Where `noise` keeps its place

`noise` is **not** a retro tell and is not touched by clause 5.1. It stays
wherever the thing making the sound is genuinely broadband:

- **Rock** — `rockChip`, `rockCrack`, `rockBurst.crumble`
- **Explosions and structural failure** — `shipExplode.boom`, `turretDown.crumple`,
  `stationDeath.crust`, `shieldDown.pop`, `coreHit.tear`
- **Grinding and air** — `thruster.roar`, `ambient.wash`, `musicDread.air`,
  `collapseBegin.rumble`
- **Transients** — `hullHit.spit`, `shotImpact`, `buildPlaced.latch`

That is all 15 current uses, and every one of them survives. The clean-sci-fi
register is *more* dependent on filtered noise than the arcade one was, not less:
a cutting tool, a pressure failure and a servo are noise problems, and a struck
tone is what a toy uses to imitate them.

### 5.3 The arcade idioms — retired outright

> **`arpMul` / `arpTime`, `dutySweep`, and `repeat`-as-a-trill do not appear in
> `bank.ts`.** No exceptions.

These are jsfxr's own arcade vocabulary and they have no non-arcade use:

| Idiom | Where it is now | What it is |
|---|---|---|
| `arpMul: 1.5, arpTime: 0.07` | `upgradeBought.arp` | The "blip up" — `VoiceSpec` calls it *"the arcade 'blip up'"* in its own doc comment |
| `dutySweep: 1.6` | `turretFire` | *"the classic sweeping buzz"*, per the synth's own comment |
| `repeat: 0.07 / 0.14` | `shipExplode.sparkle`, `upgradeBought.arp` | A pitch envelope restarted several times inside one sound — a trill |

The parameters stay in `VoiceSpec`: this is a policy about the bank, not a
deletion from the synth. `repeat` in particular has a legitimate non-arcade use
(a rattle, a stutter) and may return with a written reason.

### 5.4 Modulation and glide — the clauses that actually carry the register

> **A voice shorter than 250 ms carries no vibrato.**
> **A pitch glide wider than ×1.2 inside a voice shorter than 250 ms needs a
> written reason in the spec comment.** Longer voices are exempt from both.

This is the clause §4.1 proves is doing the work. The 250 ms threshold is where a
glide stops reading as a *chirp* and starts reading as a *fall*, and where a few
cycles of vibrato stop reading as a *wobble* and start reading as *drift*.

**Exempt by construction, and deliberately so:**

- `ambient.bed` (0.125 Hz), `musicBed.root` (0.1 Hz), `musicTheme.pad` (0.2 Hz) —
  slow drift over multi-second loops. This is the opposite of a wobble.
- `stationDeath.fall` (×6.18 over 1.32 s), `collapseBegin` (×2.40 over 2.30 s),
  `shieldDown.fall` (×6.92 over 0.54 s) — long falls. **These are the ache and
  the failure**, they read as collapse rather than as a slide, and §7 holds them.
- `shieldHit` (14 Hz × 0.02 over 0.31 s) — a struck body's shimmer, over the
  threshold and under a very small depth.

---

## 6. The worked example: `rockChip`

Treated at length because the developer has judged it twice and will judge the
whole pass by it.

### 6.1 The current spec, annotated

```ts
[SOUND.rockChip]: {
  name: 'rockChip',
  wave: 'noise',        // ✓ correct — rock is broadband (§5.2)
  attack: 0.001,
  hold: 0.012,
  decay: 0.09,          // ~103 ms total
  punch: 0.4,
  freq: 150,
  freqEnd: 100,         // ✗ a chirp: ×1.50 down inside 103 ms (§5.4)
  vibratoDepth: 0.06,
  vibratoRate: 22,      // ✗ a wobble: ±1 semitone, 2.3 cycles inside 103 ms (§5.4)
  lowPass: 1150,
  highPass: 60,         // ✗ passes sub a phone cannot emit and the mix pays for
  gain: 0.4,
  seed: 0x9e37,
},
```

**A wobble and a chirp are the character.** Everything else about the voice is
right: it is noise, it is short, it has a transient, it is band-limited. It is
not a bad sound — it is a *cartoon* sound, because two parameters make it move
the way a cartoon moves.

### 6.2 The proposal

```ts
[SOUND.rockChip]: {
  name: 'rockChip',
  wave: 'noise',
  attack: 0.0008,       // tighter strike: the transient IS the character now
  hold: 0.009,
  decay: 0.062,         // ~72 ms total, from 103 — a bite, not a grind
  punch: 0.55,          // what the wobble and the chirp used to carry, moved
  freq: 92,             //   into the envelope, where a machine keeps it
  freqEnd: 82,          // ×1.12 — under the §5.4 chirp threshold: a body settling
  lowPass: 820,         // was 1150 — lower, per the ratified s4-01 direction
  highPass: 130,        // was 60 — trims sub the phone cannot emit anyway
  gain: 0.42,
  seed: 0x9e37,         // unchanged: the replay hears the match (GDD §4.1)
},
```

*No vibrato at all. No `freqEnd` glide worth hearing as pitch.*

### 6.3 Why this and not "an octave down"

| | shipped | s4-01 "a" (never shipped) | **proposed** | reading |
|---|---|---|---|---|
| centroid | 2281 Hz | 918 Hz | **1815 Hz** | −20%: audibly lower, still present |
| zcr(2k) | 0.0483 | 0.0166 | **0.0327** | under `candidates.test.ts`'s ratified 0.034 ceiling |
| above 500 Hz | 69% | **11%** | **56%** | s4-01 would have been inaudible on a phone |
| below 200 Hz | 11% | 57% | **12%** | no new sub for the mix to carry |
| peak / rms | 0.45 / 0.104 | 0.31 / 0.087 | **0.46 / 0.106** | level is held, not traded |
| RMS at 28.6 Hz | 0.180 | 0.111 | **0.147** | *quieter* held-fire, which is the point |
| vs `hullHit` | ×3.92 | ×11.00 | **×5.30** | `audio.test.ts` needs > ×1.8 — margin grows |
| vibrato peak | 39 Hz (buried) | 83 Hz | **none** | the wobble is gone rather than moved |

**It keeps the earlier ratified direction and removes the toy.** *Lower* was
right and is honoured — the grain pitch drops 8 semitones, the filter corner
drops a third of an octave, the measured centroid drops 20%, and the voice sits
below the `candidates.test.ts` ceiling that locks that direction. What changes is
that the octave is no longer expected to do the work on its own.

### 6.4 A/B by ear — because that is how it was judged

`npx vite-node spikes/tone-audit/rockchip-ablation.ts --wav` writes 16 WAVs to
`spikes/tone-audit/previews/` (committed, so no run is needed to listen):

| File | What it is |
|---|---|
| `shipped.wav` | The sound in the game today |
| `-wobble.wav` / `-chirp.wav` / `-both.wav` | The ablations — one parameter at a time |
| `s4-01-a-.wav` | The transposition the developer never actually heard |
| `octave-only.wav` / `octave-wob.wav` | Down an octave with and without the wobble — finding 2, by ear |
| `proposed.wav` | The §6.2 spec |
| `*-burst.wav` | Each of the above, **eight hits at the mix's 28.6 Hz retrigger rate** — how mining actually sounds. Judge on these, not on the single hits |

---

## 7. The per-sound plan — all 40 ids

**Action classes.** **RE-VOICE** = the character changes. **DE-TELL** = only the
retro parameter goes, the character stays. **HOLD** = unchanged, with a reason.
Measurements are today's, from §2's census.

### 7.1 Mine

| id | today | measured | action | target character |
|---|---|---|---|---|
| `rockChip` | `noise`, wobble 22 Hz, chirp ×1.50 | 2281 Hz · 0.103 s | **RE-VOICE** | §6. A cutting tool taking a bite out of stone: one flat percussive hit, no pitch movement, no wobble |
| `hullHit` | `saw` bite + `noise` spit, chirp ×1.69 | 7723 Hz · 0.071 s | **RE-VOICE** | The saw goes (§5.1): a `triangle` with `noiseMix` ≈ 0.2 and the existing `highPass`, keeping the spit. A round on plate, not a buzz. **Its centroid must stay far above `rockChip`** — the guarded pair |
| `rockCrack` | `noise`, chirp ×2.17 in 0.114 s | 3108 Hz | **DE-TELL** | Glide to ≤ ×1.4 (§5.4). One stage of stone failing — a step, not a slide |
| `rockBurst` | `noise` crumble + **`square`** ore glint | 4721 Hz · 0.393 s | **RE-VOICE** (ore layer) | Crumble HOLDS (×3.78 over 0.39 s is a fall, exempt). The ore glint becomes a **struck note**, still rising, still the one thing in the sound that goes up — signal yellow means ore |
| `oreCollect` | `square` duty 0.3, chirp up ×1.50 | 6583 Hz · 0.086 s | **RE-VOICE** | One clean struck note, fixed pitch. *Getting something* now reads as a machine registering it, not as a coin blip. **Watch `depositTick` (§8)** |
| `holdFull` | `square` ×2, two notes | 7290 Hz · 0.263 s | **RE-VOICE** | Keep the two-note insistence and the interval — that is the tell. Struck notes replace the squares |

### 7.2 Fight

| id | today | measured | action | target character |
|---|---|---|---|---|
| `turretFire` | `square` duty 0.22 + `dutySweep` 1.6 + chirp ×4.00 | 4589 Hz · 0.086 s | **RE-VOICE** | The single most arcade voice in the bank — a duty-swept square with a four-to-one downward sweep is a 1980s laser. Target: a **coil discharge** — a short filtered-noise transient over a low tonal body, no sweep, no slide |
| `shotImpact` | `noise`, chirp ×3.00 in 0.057 s | 7837 Hz | **DE-TELL** | Glide to ≤ ×1.5. A projectile arriving is a tick, not a "pew" |
| `shieldHit` | `sine` ×2, shimmer 14 Hz × 0.02 | 1187 Hz · 0.312 s | **HOLD** | Already the register: a struck body ringing and fading. Exempt from §5.4 (over 250 ms, depth 0.02). Lowest priority in the pass |
| `shieldDown` | **`saw`** fall + `noise` pop | 4905 Hz · 0.544 s | **RE-VOICE** (wave only) | The ×6.92 fall **stays** — the bubble failing *is* a collapse (§5.4 exempt). Only the saw goes: `triangle` + `noiseMix`, same envelope, same glide |
| `coreHit` | `sine` thud + `noise` tear | 1906 Hz · 0.332 s | **HOLD** | One of the two sounds homes get. The ache depends on it. Doc comment only |
| `turretDown` | `noise` crumple + `triangle` clang | 3051 Hz · 0.332 s | **HOLD** | Structural failure, already in register. Check by ear that the clang does not read as a boing; if it does, shorten its decay rather than move its pitch |
| `shipExplode` | `noise` boom + **`square`** crack + **`square`** sparkle (`repeat` 0.07) | 5442 Hz · 0.562 s | **RE-VOICE** | The `sparkle` layer is literally *"explosions are fireworks"* implemented — **delete it** and put a **metallic shear** in its place (a short filtered-noise band with a fast decay). `crack` becomes filtered noise. `boom` HOLDS |
| `shipSpawn` | `triangle` rise ×4.00 + **`square`** land | 2212 Hz · 0.342 s | **RE-VOICE** | The ×4.00 rise over 0.34 s is a power-up sweep. Target: *arriving*, not *powering up* — a short rise into a struck arrival note. Keep the two-part shape |
| `spawnPulse` | `sine`, chirp up ×1.26 | 1177 Hz · 0.146 s | **DE-TELL** | Flatten the glide (×1.26 is just over the §5.4 line on a 0.146 s voice). Otherwise correct: quiet, because it repeats |
| `thruster` | `noise` roar + `triangle` hum | 2453 Hz · loop | **HOLD** | **The model for the whole pass.** No tells at all, and it already sounds like an engine. Quote it in review |

### 7.3 Spend

| id | today | measured | action | target character |
|---|---|---|---|---|
| `buildPlaced` | **`square`** clunk + `noise` latch | 5820 Hz · 0.123 s | **RE-VOICE** (clunk) | *"A latch, not a fanfare"* is already the right idea in the right register — only the oscillator is wrong. Filtered `triangle`/noise body, latch untouched |
| `buildComplete` | `triangle` ×2, rising fifth | 1463 Hz · 0.334 s | **HOLD** | No tells. **But see §8** — it sits ×1.23 from `purchaseConfirm`, and they can fire seconds apart off one wheel press |
| `repairTick` | `sine`, chirp up ×1.33 | 451 Hz · 0.158 s | **DE-TELL** + comment | Flatten the glide. **Its doc comment is stale**: *"a soft tick you notice mostly when it stops, because a hit interrupted it"* describes the retired repair channel — repair is a discrete purchase with no interrupt (§2.5, amended 2026-07-27) |
| `bankOre` | **`square`** ×2, falling | 5670 Hz · 0.262 s | **RE-VOICE** | Struck notes; keep the falling interval — ore coming to rest |
| `upgradeBought` | **`square`** + `arpMul` 1.5 + `repeat` 0.14 | 6293 Hz · 0.414 s | **RE-VOICE** | *"The brightest confirmation in the bank"* is currently a jsfxr arpeggio. Target: **three struck notes rising**, borrowing the shape of the ratified `purchase` cue without becoming it — this is a world tell and the UI already has its own (§8) |

### 7.4 The clock, and the one serious thing

| id | today | measured | action | target character |
|---|---|---|---|---|
| `waveArrive` | **`saw`** ×2 foghorn | 2239 Hz · 0.810 s | **RE-VOICE** (wave only) | Keep the two low notes and the pitch — the foghorn is the mechanic (§2.3's metronome). Replace saw with filtered `triangle` plus low noise air. **Must stay clear of `alarm` (§8)** |
| `collapseBegin` | `noise` rumble + `sine` drone | 1033 Hz · 2.300 s | **HOLD** | Entropy arriving. Already exactly the register |
| `stationDeath` | `sine` fall + `noise` crust + `triangle` toll | 1617 Hz · 1.320 s | **HOLD — protected** | The ache. A long fall, no resolution, and then the mix goes to zero under it. **Any change here is a developer question, not a re-voice** (§11 Q6). It also holds the longest-tail invariant (§8) |
| `matchEnd` | `triangle` ×3 rising | 1255 Hz · 1.250 s | **HOLD** | No tells |
| `alarm` | **`saw`** ×2, minor third | 5009 Hz · loop | **HOLD — sanctioned exception** | §5.1. *"An unmistakable alarm"* is a mechanic (§2.2) and not cuttable (§4.9). Offered as a question (§11 Q3) but the recommendation is: do not touch it |
| `ambient` | `sine` ×2 + `triangle` + `noise` | 309 Hz · loop | **HOLD** | Cold Vacuum as a sound already |

### 7.5 The soundtrack

| id | today | measured | action | target character |
|---|---|---|---|---|
| `musicBed` | `triangle` + `sine` ×2 | 86 Hz · loop | **HOLD** | |
| `musicPulse` | `triangle` ×2 + `sine` | 128 Hz · loop | **HOLD** | |
| `musicTheme` | `triangle` ×3 + **`square` ×5** | 5759 Hz · 3.920 s | **RE-VOICE** | Five square melody notes. Its own comment says *"Arcade but restrained"* — the first half of which is now the wrong target. `triangle`/`sine` notes over the same pad, same riff, same key. **See §11 Q5** — music is item 1 on the cut list and this may not be worth the tokens |
| `musicDread` | `triangle` + `sine` ×2 + `noise` | 238 Hz · loop | **HOLD** | |
| `musicWin` | `triangle` ×4 + **`square`** | 6924 Hz · 1.066 s | **RE-VOICE** (one note) | Swap `musicWin.n3`. Its comment calls it *"a firework for the surface (GDD §4.7)"* — a direct quote of the retired paragraph; rewrite it |
| `musicLoss` | `triangle` ×2 + `sine` ×2 | 129 Hz · 1.190 s | **HOLD** | *"The one thing in the soundtrack allowed to be sad"* — this is the ache in the music. Untouched |

### 7.6 The device cues (fallbacks)

**Read this before touching any of the six.** Since s6-01, `CUE_UI` routes
`press`, `confirm`, `reject`, `hover`, `detent`, `back`, `accept`, `join` and
`rush` to the ratified Gantry/Bone set in `ui-cues.ts`. **`CUE_SOUND` is the
fallback for when there is no cue player at all.** Re-voicing these changes what
a fallback sounds like, not what the developer hears in the running game — so
they are the *lowest* priority in the pass, and a reviewer who expects to hear a
difference in the build will be confused unless this is said in the PR body.

| id | today | measured | action | target character |
|---|---|---|---|---|
| `pressTick` | **`square`** duty 0.3 | 7263 Hz · 0.028 s | **RE-VOICE** | One struck note at the ratified family root (A♭6, 1661 Hz) so the fallback and the real `pick` cue agree instead of diverging |
| `purchaseConfirm` | `triangle` ×2, rising fourth | 1803 Hz · 0.215 s | **HOLD** | No tells |
| `rejectBuzz` | **`saw`**, "the nope" | 2138 Hz · 0.132 s | **RE-VOICE** | Two notes a minor second apart resolving nowhere — the ratified `refused` shape, so the fallback carries the same meaning. **Watch `coreHit` (§8)** |
| `depositTick` | **`square`**, falling ×1.33 | 5827 Hz · 0.067 s | **RE-VOICE** | Struck note, still falling, still soft. **Watch `oreCollect` — the tightest pair in the bank (§8)** |
| `respawnBeep` | `triangle`, fixed | 1417 Hz · 0.119 s | **HOLD** | No tells. It is a clock; plain is the design |
| `respawnGo` | `triangle` rise + **`square`** top | 4714 Hz · 0.243 s | **RE-VOICE** (top) | Struck top note over the same rise |
| `minimapPing` | `sine` + `triangle`, wobble 12 Hz, chirp up ×1.50 | 1294 Hz · 0.293 s | **DE-TELL** + comment | A rising sonar blip is defensible in the register; the ×1.50 rise on a 0.29 s voice is not far over the line and may stay with a written reason. **Its name and comment are wrong**: the minimap *ping mechanic was cut* (§2.4, §4.9). `main.ts:1529` raises this cue for the **minimap toggle**, so the sound is live and the label is a fossil (§11 Q7) |

---

## 8. What must NOT drift

**Every sound in this bank is a mechanic's audible tell (GDD §3.6), and §4.7 as
amended says that mandate outranks the register.** The specific failure mode of a
re-voice is convergence: nine voices all becoming "a clean struck note" and two
mechanics that used to be obvious becoming a coin-flip. These are the pairs at
risk, with today's measured margin — run `measure-bank-tone.ts` after the pass
and none of them may have narrowed.

| Pair | today | Why they must not collide | Guarded? |
|---|---|---|---|
| **`oreCollect` / `depositTick`** | centroid **×1.13** | **The tightest pair in the bank.** *Picked a chunk up* vs *banked a chunk* — §2.3's whole held-ore-vs-banked-ore economy. Both are being re-voiced, both toward "a struck note". If nothing else in this section is respected, respect this | **No — add it** |
| **`rejectBuzz` / `coreHit`** | centroid ×1.12, zcr ×1.26 | *Your buy was refused* vs *your reactor is taking damage*. Both low, both bad news, and the second one is what the alarm is built on. Re-voicing `rejectBuzz` to two struck notes moves it **up**, which helps — verify that it did | **No — add it** |
| **`shieldHit` / `coreHit`** | centroid ×1.61, zcr ×9.02 | The most important pair mechanically: §2.2's grammar is *shields redden and die before the reactor begins to fill*, and a besieged player has to hear which layer is being eaten. `coreHit` HOLDS, `shieldHit` HOLDS — so this pair should be safe **provided both hold**. The zcr margin, not the centroid one, is what carries it | **No — add it** |
| **`buildComplete` / `purchaseConfirm`** | centroid ×1.23 | *The defence you bought has finished building* vs *the purchase registered* — seconds apart, off one wheel press. Both HOLD, so this is a watch, not a task | **No — add it** |
| **`respawnBeep` / `spawnPulse`** | centroid ×1.20 | The respawn countdown vs spawn protection ticking. Both nearly HOLD | **No — add it** |
| **`alarm` / `waveArrive`** | centroid ×2.24 | Both low, both two-note, both loud, and one of them is a mechanic on the not-cuttable list. `waveArrive` is losing its saw — the thing that currently separates them most | **No — add it** |
| **`rockChip` / `hullHit`** | zcr ×3.92 | *Am I mining or shooting a ship* — the game's central inversion (§2.3). Both are being re-voiced | **Yes** — `audio.test.ts` "makes rock and hull genuinely distinct", needs hull > rock × 1.8 |
| **`turretFire` / `shotImpact`** | zcr ×16.78 | *A turret fired at me* vs *something landed*. Huge margin; `turretFire` is the biggest re-voice in the pass, so re-check rather than assume | **No — add it** |

**The invariants `audio.test.ts` already asserts, which a re-voice can trip
without touching the pair in question:**

1. **`peak ≤ 1` and `peak > 0.01` and `rms < 0.5`, for every sound.** A voice
   made "cleaner" by taking gain out can fall through the silence floor.
2. **The alarm's RMS is above `oreCollect`, `repairTick`, `spawnPulse` and
   `shotImpact`.** It is a mechanic, not a notification (§2.2).
3. **`stationDeath` has the longest tail of every non-looping sound** (1.320 s).
   Lengthening any other sound past that breaks the test — and the test is
   protecting the beat, so the fix is always to shorten the new sound.
4. **`TELL_SOUND` is total** over `TellKind`, with exactly one documented `null`
   (`thrust`). A re-voice may not remove a name.
5. **Determinism** (§4.1): noise is drawn from `mulberry32` off `spec.seed`.
   Keep seeds unless the character genuinely requires a new one — a seed change
   makes the replay's explosion a different explosion.

---

## 9. The task breakdown for s7-02

Needs-ordered. **T1 before anything, T8 last** — that ordering is the point: the
net goes up before the work, and the policy test goes green only when the work is
finished.

### T1 — the separation guard, GREEN on today's bank

*Why first:* it is a **regression net**, not a goal. Written after the re-voice it
would only encode whatever came out.

1. Add to `src/art/audio/audio.test.ts`, in the bank describe block:
   `it('keeps every pair of tells a player must not confuse apart', …)`.
2. Use the existing whole-buffer zero-crossing helper for the zcr margins and add
   a small spectral-centroid helper for the centroid ones (the working
   implementation is `spikes/tone-audit/measure-bank-tone.ts` — copy it in, do
   not import a spike from a test).
3. Assert each pair from §8's table at **90% of today's measured margin**, so the
   test has tolerance for a legitimate re-voice but fails on a collapse. Put
   today's number in a comment beside each, with the mechanic it protects.
4. **Run it. It must pass before a single spec changes.** If it does not, the
   helper is wrong, not the bank.

### T2 — `rockChip`, and the hole s4-01 left

*Why second:* it is the sound the developer will judge the pass by, and it is
cheap to ratify on its own before the other 39 move under it.

1. **Red first.** Add
   `it('keeps the shipped mining voice under the tone the developer ratified (s4-01, s7-01)', …)`
   to `audio.test.ts`, using the **exact** windowed zero-crossing helper from
   `candidates.test.ts` (2048 samples from t = 3 ms) and its ceiling of `0.034`.
   Run it: **it fails at 0.0483.** That failure is the bug report, reproduced —
   the ratified direction was never applied to the bank.
2. Apply §6.2's spec to `SOUND.rockChip` in `bank.ts`. Run: **0.0327, green.**
3. Add to the same test a **phone-band floor** — at least 40% of the voice's
   energy above 500 Hz — and a comment naming why (§4.1 finding 3, the mobile
   gate in §4.3). The proposal measures 56%; s4-01's candidate would have failed
   at 11%, which is the whole reason the floor exists.
4. Re-run T1 and the existing rock-vs-hull test. Margin should have **grown**
   (×3.92 → ×5.30).
5. Rewrite the spec's comment block in the new register. Delete *"Dark on
   purpose"* — it was not dark; it measured 2281 Hz — and say what the voice is
   now: a cutting tool taking a bite out of stone.
6. **Stop here and ship it for a listen** if the developer wants the worked
   example ratified before the rest (§11 Q4). `spikes/tone-audit/previews/` has
   the A/B already rendered, including the eight-hit bursts.

### T3 — the loud arcade voices

The three the player hears most and which carry the most retro parameters:
`turretFire` (square + `dutySweep` + ×4.00 chirp), `upgradeBought` (square +
`arpMul` + `repeat`), `shipExplode` (the `sparkle` layer).

1. One sound per commit. Each commit body: the old numbers, the new numbers, and
   the sentence from §7 that the change is executing.
2. After each: `npx vitest run src/art/audio` — T1 must stay green.
3. `shipExplode`: **delete the `sparkle` layer entirely** rather than re-voicing
   it. It exists because §4.7 said "explosions are fireworks" and §4.7 no longer
   does. Replace with the metallic shear (§7.2). Do not touch `boom`.

### T4 — the rest of the `square` voices

`oreCollect`, `holdFull`, `rockBurst.ore`, `bankOre`, `buildPlaced.clunk`,
`shipSpawn.land`, `respawnGo.top`, `pressTick`, `depositTick`, `musicTheme.n0–n4`,
`musicWin.n3`.

1. Do `oreCollect` and `depositTick` **in the same commit**, and re-run T1's pair
   assertion between the two edits — they are the ×1.13 pair and the risk is that
   the first edit alone hides the collision.
2. `musicTheme` and `musicWin` last, and only if §11 Q5 comes back yes.

### T5 — the `saw` voices

`hullHit.bite`, `shieldDown.fall`, `waveArrive.horn`, `waveArrive.fifth`,
`rejectBuzz`. **`alarm.low` and `alarm.high` are NOT in this list** — they are
§5.1's sanctioned exception.

1. `hullHit` first, then immediately re-run the rock-vs-hull test.
2. `shieldDown`: **the ×6.92 glide stays.** Wave only. A reviewer who "fixes" the
   glide has removed the bubble failing.
3. `waveArrive`: after it, re-run T1's `alarm`/`waveArrive` pair — saw was doing
   the separating.

### T6 — the DE-TELLs

`rockCrack`, `shotImpact`, `spawnPulse`, `repairTick`, `minimapPing`. One commit
for the lot is fine: each is a single number, and none changes a character.

### T7 — the comments

Every spec comment in `bank.ts` that quotes or paraphrases the retired paragraph.
Known ones, all verified present today:

- The file header quotes the retired tone paragraph in a block quote and then
  says *"the arcade half is deliberately synthetic and unembarrassed — square
  waves, blips that arpeggio upward, a firework rather than a war film."*
- `SOUND.shipExplode`: *"Explosions are fireworks (GDD §4.7)"* and *"a bang, then
  a sparkle over the top of it."*
- `SOUND.musicWin`: *"a firework for the surface (GDD §4.7)."*
- `SOUND.musicTheme`: *"Arcade but restrained."*
- `SOUND.repairTick`: *"you notice mostly when it stops, because a hit
  interrupted it"* — **stale mechanically**, not just tonally (§2.5: repair is a
  discrete purchase, no channel, no interrupt).
- `synth.ts:46`: `square` is *"Hollow and arcade — the default voice of a toy
  (tone contract, §8)."* The type stays; the sentence is now a description of
  what the bank no longer uses, and should say so.

### T8 — the policy, as a test. LAST.

*Why last:* it is red until the pass is finished, and that is exactly what makes
it the definition of done.

1. Add
   `it('holds the amended tone contract: no arcade oscillators or idioms in the bank (GDD §4.7)', …)`.
2. Walk every voice of every sound (`SOUND_NAMES` → `soundSpec` → layers) and
   assert:
   - `wave` is never `'square'` or `'saw'`, **except** `alarm.low` / `alarm.high`,
     named explicitly with §5.1's reason in a comment;
   - `arpMul`, `arpTime`, `dutySweep` are absent everywhere;
   - `repeat` is absent everywhere;
   - a voice whose `attack + hold + decay < 0.25` has no `vibratoDepth`, and its
     `freqEnd`/`freq` ratio is within ×1.2 — with the §5.4 exemption list named
     in the test rather than in a reviewer's head.
3. Green = the pass is complete.

### T9 — the propagation

`content/codex/pipeline/tone.md` still quotes the retired paragraph. It is the
Director's/Art's file, so the replacement text is written out ready to paste in
§10 rather than applied here. Raise it as a one-line PR against that file.

### Definition of done for s7-02

```
npx tsc --noEmit
npm test -- --run
npx vite-node spikes/tone-audit/measure-bank-tone.ts   # census shows 0 square, 2 saw (alarm)
```

…plus T8 green, T1 still green, and a PR body that states plainly which of the
six device cues are **fallbacks only** (§7.6) so nobody reviews them by ear in
the running build and reports them as unchanged.

---

## 10. Ready-to-paste: `content/codex/pipeline/tone.md`

The third mirror of the tone paragraph. Pinned by hand because lexical retrieval
provably never surfaces a tone section on its own (0/4 query types in the
Assignment-4 codex pipeline), which is also why a stale copy is dangerous rather
than merely untidy — it is injected verbatim into every generation.

```markdown
# Pinned tone paragraph (GDD §4.7, amended 2026-08-06)

> **BINDING.** This paragraph is PINNED verbatim into every codex generation and
> every critic pass. The Assignment-4 pipeline proved retrieval never surfaces it
> on its own (it lives in §4.7, far from any entry's source rows), so it is
> injected by hand, not retrieved. Every entry's voice is judged against it.

> *Planet Rush is a clean, modern science-fiction brawl: fast, precise, and cold.
> Ships are machines, explosions are pressure failures, bots are operators with
> names and habits. But homes are the one serious thing in it — when a station
> dies, the game goes briefly quiet, the wreck stays on the map all match, and
> nobody jokes for three seconds. Engineered on the surface, a small ache
> underneath.*

## How it lands in the codex

- **Systems / ships / bots** read precise and plain-spoken — a rival is "an
  operator with a name and habits," a shot is a discharge, a hull is machinery.
  Clean and cold, never cheeky and never grimdark.
- **Homes are the serious note.** Any entry that touches a station's death, a
  wreck, or the collapse drops the register for a beat — that is the "small ache
  underneath," and it is a rule, not a flourish. **Unchanged by the amendment.**

*Amended 2026-08-06 (s7-01): the retired paragraph read "a Saturday-morning space
brawl: fast, bright, and a little cheeky. Ships are toys, explosions are
fireworks, bots are cartoon rivals with names … Arcade on the surface." The
station-death sentence is carried over verbatim. See GDD §4.7 for the rationale,
the old/new worked table, and the precedence rule.*
```

---

## 11. QUESTIONS FOR THE DEVELOPER

Only you can rule on these. Nothing below is being acted on; every one of them is
a decision this brief deliberately did **not** take on your behalf.

**Q1 — VFX. Does the amendment reach the explosions?** *(the big one)*
§4.7 said *"explosions are fireworks."* That is now retired as a sentence, and the
**audio** side of it is in this spec (`shipExplode`'s sparkle layer is deleted).
But `src/art/vfx/` draws the visual explosions to the same retired brief, and this
brief was about sound, so nothing visual moved. **Do you want a matching VFX pass
(a separate brief), or do the explosions stay as drawn?** Recommendation: a
separate brief, scoped the same way — explosions, spawn glow and impact flashes
only, with the damage-ring grammar and the palette untouched.

**Q2 — Bot names. Do Rusty, Bolt, Foreman, Patch, Sable, Vulture and Warden stay?**
§4.7 said *"bots are cartoon rivals with names."* The amendment retires the phrase
*"cartoon rivals"*, not the roster. **Recommendation: keep all seven.** They read
as crew nicknames on a mining claim, not as cartoon characters — Foreman, Patch
and Warden are literally job titles, and §2.9 defines them by behaviour (a
territorial enforcer, a wreck scavenger) rather than by comedy. Renaming them
would also break `docs/team-bots-plan.md`, the liveries and the fixed-strings list
in §4.7. But it is your call and it is why nothing was renamed.

**Q3 — The alarm keeps its saw. Confirm?**
It is the one place §5.1's ban is waived. The reasoning is that §2.2 calls for
*"an unmistakable alarm,"* §4.9 makes it not-cuttable, and a saw's dense harmonic
stack is what stops a klaxon sounding like music. It is also the brightest,
loudest thing in the bank and therefore the most likely single sound to still read
as "retro" to you. **Say the word and s7-02 will render an A/B** (saw as-is vs a
filtered triangle klaxon at the same interval and level) — but the recommendation
is to leave a working mechanic alone.

**Q4 — `rockChip`: which one?**
Listen to `spikes/tone-audit/previews/*-burst.wav` — the eight-hit bursts, which
is how mining actually sounds. `shipped-burst.wav` is today's; `proposed-burst.wav`
is §6.2. `s4-01-a--burst.wav` is the transposition that was approved in principle
but never reached the game, included so you can hear what "an octave down" alone
would have cost (89% of its energy is below 500 Hz — most of it would be missing
on your phone). **Is the proposal the direction, or should it go lower still?**
If lower, the phone-band floor in T2.3 is the constraint that has to move with it,
and it should move deliberately rather than silently.

**Q5 — The music theme. Worth the tokens?**
`musicTheme` is five square-wave melody notes and it is the only re-voice in the
spec that is *music* rather than a tell. The ambient loop is item 1 on the ranked
cut list (§4.9) and the adaptive stems sit beside it. **Re-voice it, or leave the
soundtrack alone and spend the pass on the tells the player hears every second?**
Recommendation: leave it for now; it is queued as T4.2 and easy to pick up later.

**Q6 — `stationDeath` is being held untouched. Confirm that is what you want.**
Everyone in the record agrees this beat is the strongest thing in the spec, so the
spec protects it. But it is worth asking the question directly, because a *cleaner*
palette around it might make the death sting itself sound like the odd one out.
The spec's position: hold it, and re-listen once the bank around it has moved. If
it then sounds wrong, that is a one-sound follow-up with the developer in the loop.

**Q7 — `minimapPing`: a fossil name on a live sound.**
The minimap **ping mechanic was cut** from the game (§2.4, §4.9). The sound
survived and is now raised by the **minimap toggle** (`src/main.ts:1529`), so it
is live, correctly wired, and misleadingly named — as is the `'ping'` cue in
`AudioCue`. Renaming it is mechanical and touches five files. **Fold it into a
later rename pass, or leave it?** (See also the general position on identifiers,
below.)

**Q8 — Identifier names: `rejectBuzz`, `respawnBeep`, `pressTick`.**
You are right that these are arcade vocabulary. **The recommendation is that they
do not change in s7-02**, for the same reason the lore pivot ratified that code
identifiers keep `planet` while the fiction moved (§0): a rename touches
`TELL_SOUND`, `CUE_SOUND`, `CUE_UI`, `engine.ts`, `weapons.ts`, `candidates.ts`,
`sound-review/manifest.json` and four test files, and mixing that diff with a
re-voice makes it impossible to review *which sound actually changed* — which is
the exact confusion that produced this brief. They are not player-facing. **The
proposal is a separate mechanical rename brief (s7-03), decided now and executed
after the re-voice is ratified**, with this mapping:

| today | proposed | why |
|---|---|---|
| `rejectBuzz` | `buyRefused` | It will no longer buzz, and `refused` is the ratified UI cue's own word |
| `respawnBeep` | `respawnCount` | It is a clock tick, not a beep |
| `pressTick` | `pressCue` | Names the event, not the 8-bit noise |
| `depositTick` | `depositSettle` | It is ore coming to rest |
| `repairTick` | `repairPatch` | And it is not a tick any more: repair is discrete (§2.5) |
| `spawnPulse` | `spawnShield` | Names the mechanic (spawn protection), not the waveform |
| `minimapPing` | `minimapOpen` | Q7 — the ping is cut; this sound is the toggle |

**Say the word if you would rather have them renamed in the same pass**, and s7-02
will do it as its own final commit so the re-voice diff stays readable.

---

## 12. Traps — read these before writing a line

1. **There are two banks, and only one of them is in the game.**
   `src/art/audio/candidates.ts` is a parallel review artifact imported by nothing.
   Editing it changes no sound. This is precisely how s4-01's ratified lowering
   failed to reach the developer's ears, and the second report is the cost.
2. **`sound-review/manifest.json` is asserted against `candidates.ts`** by
   `candidates.test.ts` ("the committed manifest matches the source"). If you
   touch candidates for any reason, re-render with
   `npx vite-node sound-review/render.ts` or the suite goes red.
3. **The UI cue path bypasses the bank.** `CUE_UI` sends `press`/`confirm`/
   `reject`/`hover`/`detent`/`back`/`accept`/`join`/`rush` to `ui-cues.ts`. Re-voicing
   `pressTick`, `purchaseConfirm` or `rejectBuzz` changes the **fallback only** —
   nothing you hear clicking around the running build. Say so in the PR body or a
   reviewer will report your change as not working.
4. **Lowering has a phone floor.** s4-01's candidate "a" puts 89% of its energy
   below 500 Hz. `rockChip` is `TELL.mineHit` and fires all match, and the mobile
   gate (§4.3) makes the developer's phone a first-class device. Check the `phone`
   column, not just the centroid.
5. **A wobble gets louder as you transpose down** (§4.1, finding 2). Remove the
   modulation *before* you move the pitch, never after — otherwise the ablation
   you run to check your work will be measuring a sound that got worse.
6. **`gain` here is not the mix.** `engine.levelFor` scales the firing voices by
   weapon power, so a `gain` change to `rockChip`, `hullHit` or `shotImpact`
   changes what a tier-4 tool sounds like too, not just a tier-0 one.
7. **The three-second hush is a mixer node**, downstream of master in `graph.ts`,
   asserted by `it('puts the hush on its own node, downstream of master')`. Nothing
   in a re-voice may add a path around it. This is the ache's enforcement and it is
   the one thing in the audio stack that is protected in two places at once.
8. **`stationDeath` holds the longest-tail invariant** (1.320 s). Lengthen any
   other one-shot past it and `it('gives the station death the longest tail in the
   bank')` fails. The correct fix is always to shorten the new sound.
9. **`peak > 0.01` is asserted for every sound.** "Clean" is not "quiet"; a voice
   that loses too much gain trips the silence check, and a `highPass` raised too
   far can do it on its own.
10. **Seeds are determinism** (§4.1). `mulberry32(spec.seed)` is what makes a
    replay's explosion the match's explosion. Change a seed only when the character
    genuinely requires new noise, and say why in the commit.
11. **`repeat` means two different things.** In `bank.ts` it is only ever a trill
    (`upgradeBought`, `shipExplode.sparkle`) and §5.3 retires both. In `VoiceSpec`
    it is a general pitch-envelope restart and stays in the synth — do not delete
    the parameter while deleting its uses.
12. **`TELL_SOUND` must stay total.** Every `TellKind` maps to a sound or to the
    single documented `null` (`thrust`). Deleting a bank entry rather than
    re-voicing it breaks the "no mechanic is visible but silent" test, which is
    §3.6 enforced.

---

## 13. What this changed, in the repo

| File | Change |
|---|---|
| `GDD.md` §4.7 | The tone paragraph replaced; rationale, old/new worked table, precedence rule, bounded blast radius. Changelog entry at the foot |
| `style-guide.md` §8 | The verbatim mirror updated (and its stale pre-pivot "when a *planet* dies" wording removed); operational reading rewritten; §7's Audiowide note flagged, face unchanged |
| `docs/audio-revoice-spec.md` | This document |
| `spikes/tone-audit/` | Two throwaway measurement programs and the rendered A/B WAVs |
| `src/**` | **Nothing.** No sound changed in this pass |
