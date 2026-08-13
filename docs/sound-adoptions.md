# Sound adoptions — what the developer chose, and what shipped

OWNER: Sound Agent. This is the ledger between `/status/sound-choices.json` (the
developer's verdicts, written by the review page) and `src/art/audio/bank.ts` (the
sounds the game actually plays). One row per adopted slot, and a standing note on
everything that is still denied.

It exists because the gap between those two files went unwatched once already. s4-01
applied a ratified direction — *"almost there, but they should be lower in tone"* —
to `src/art/audio/candidates.ts`, which is a review artifact imported by nothing in
the game, and said so plainly in its own commit message. The bank was untouched, so
the developer heard the same sound again and reported it a second time
(`docs/audio-revoice-spec.md` §4.2). **A verdict is not adopted until it is in the
bank, and this file is where that is written down.**

## Adopted

| slot | letter | character | decided | adopted | brief |
|---|---|---|---|---|---|
| `rockChip` | **b** | blunt pressure bite, sub weight | 2026-08-13T04:01:48Z | 2026-08-13 | s10-01 |
| `hullHit` | **a** | coil bite on plate, hard and dry | 2026-08-13T04:02:30Z | 2026-08-13 | s10-01 |
| `rockCrack` | **c** | crystalline shear, ringing shards | 2026-08-13T04:03:05Z | 2026-08-13 | s10-01 |

Each letter resolves to a rendered file the developer could actually play, and to the
params that rendered it:

| slot | the file they heard | the params |
|---|---|---|
| `rockChip` | `sound-review/previews/rockChip/b.wav` | `candidates.ts#rockChip.b` → `rockChip_b_pressureBite` |
| `hullHit` | `sound-review/previews/hullHit/a.wav` | `candidates.ts#hullHit.a` → `hullHit_a_coilBite` |
| `rockCrack` | `sound-review/previews/rockCrack/c.wav` | `candidates.ts#rockCrack.c` → `rockCrack_c_crystal` |

### How the adoption is held

The bank does not transcribe the numbers out of a candidate — a shipped sound that is
a re-typing of an approved one is a sound nobody approved, and one wrong digit is
inaudible in review and permanent in the game. Instead the five builders moved to
`src/art/audio/instrument.ts` and both sides call them, so an adopted entry in
`bank.ts` is the *same call with the same arguments and the same seeds* as the offer.

`candidates.test.ts` then closes it from both ends:

- **`plays the chosen candidate in the three adopted slots, sample for sample`** —
  renders the bank entry and the board's offer and compares every sample. Only layer
  names differ (bank convention, not board convention), and names never reach the
  renderer.
- **`leaves every un-adopted slot alone — nothing else was revived`** — each of the
  other forty-one slots' shipped voices must be none of its three offers. Forty-one,
  not thirty-seven: the thirty-seven carrying the standing `deny-all` plus the four
  summary slots (p1-07) the developer has not been shown yet. Neither group has an
  approval behind it.

Both were verified RED before they went green: pointing `rockChip` at letter `c`
fails the first, and splicing `oreCollect`'s candidate `a` into the bank fails the
second.

`sound-review/previews/<slot>/current.wav` is re-rendered on adoption, so the board
plays what the game plays. After s10-01 the three `current.wav` files are byte-identical
to the `b.wav` / `a.wav` / `c.wav` they were chosen from.

## Still denied — all thirty-seven others

Standing verdict, 2026-08-07T20:09:00Z, in the developer's words:

> still have all the old sounds i said i didnt want there, we need to deny all of
> those sounds at once and make new ones that match the new theme (modern/sci-fi and
> not retro/toony)

`rockBurst`, `oreCollect`, `holdFull`, `turretFire`, `shotImpact`, `shieldHit`,
`shieldDown`, `coreHit`, `turretDown`, `shipExplode`, `shipSpawn`, `spawnPulse`,
`thruster`, `buildPlaced`, `buildComplete`, `repairTick`, `bankOre`, `upgradeBought`,
`waveArrive`, `collapseBegin`, `stationDeath`, `matchEnd`, `alarm`, `ambient`,
`musicBed`, `musicPulse`, `musicTheme`, `musicDread`, `musicWin`, `musicLoss`,
`pressTick`, `purchaseConfirm`, `rejectBuzz`, `depositTick`, `respawnBeep`,
`respawnGo`, `minimapPing`.

An adoption brief adopts the letters it was briefed with. It does not take a
neighbouring slot along for the ride because the offer was sitting right there.

## Awaiting a first verdict

`xpTick`, `xpBarFill`, `levelUp`, `xpSettle` — the four end-of-match summary slots
added by p1-07, after the deny-all. They carry no verdict of any kind, which is not
the same as being denied, but it is the same as not being adopted: the bank plays its
own incumbents for them and none of their offers.

## Open risk carried by an adoption

### `rockChip` **b** is entirely below what a phone speaker can emit

s7-01 §4.1 Finding 3 measured that a phone rolls off hard below 500 Hz, noted that
`rockChip` is `TELL.mineHit` and fires all match, and predicted a voice with 89% of
its energy under that line would arrive as *"the mining sound is gone"*. `audio.test.ts`
held the shipped chip above 40% of its energy *above* 500 Hz on the strength of it.

Candidate **b** measures **0.0%** above 500 Hz. The developer was offered `a` (5.4%
above the line) and `c` (0.6%) beside it and chose the heaviest of the three. A
prediction about a sound nobody had heard loses to a decision about a sound they did
hear, so the floor is retired — deliberately and in writing, in the test that used to
hold it — rather than shaved down until the ratified voice slips under it.

**The risk is open, not closed.** If the mining voice reads thin or absent on a phone:
put a new offer on the board. Do not quietly re-brighten what was chosen. The
counterpart guard that IS still live is on `hullHit` — §2.3's inversion is only
answerable on a small speaker if one of the two firing voices lives above the
roll-off, and after s10-01 that is the hull (99.9% above 500 Hz), pinned in
`audio.test.ts`.

## What an adoption brief has to do

1. Resolve each letter to a file in the review set. If it does not resolve, **stop and
   report** — never substitute the neighbouring letter.
2. Build the bank entry by calling `./instrument` with the candidate's arguments.
   Never retype the numbers.
3. Re-render `sound-review/` so `current.wav` is what ships.
4. Add the row here, with the decision timestamp.
5. Leave every other slot alone, and say so in the PR — the developer denied them on
   purpose and will notice if one comes back.
