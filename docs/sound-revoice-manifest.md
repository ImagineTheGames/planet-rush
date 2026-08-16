# Sound re-voice manifest — the thirty-five slots under the 2026-08-07 denial

OWNER: Sound Agent (a0-60). **Status of record for the sweep.** A row moves to
`done` in the same commit that lands the slot's new offers, so a reader of the PR
knows what is finished without listening to thirty-five files, and the next brief
knows exactly where to start.

## What the denial was

`/status/sound-choices.json`, `2026-08-07T20:09:00.145Z`, `deny-all` on 35 slots,
recorded on the developer's behalf, verbatim:

> still have all the old sounds i said i didnt want there, we need to deny all of
> those sounds at once and make new ones that match the new theme (modern/sci-fi
> and not retro/toony)

Nine days later the board was unchanged except for two slots (`levelUp` and
`oreCollect`, a0-49), and the developer found it that way themselves:

> im still staring at a sound board with no regenerated options

## The rules this sweep works under

1. **New letters.** Every one of these 35 slots carries a live `deny-all` on the
   offers lettered `a`/`b`/`c`. A letter is the whole of how a verdict names an
   offer (`{"verdict": "b"}`), so a new take filed under a denied letter makes the
   standing record unreadable — the a0-48 rule. Re-voiced slots therefore offer
   **`d`/`e`/`f`/`g`** and the denied `a`/`b`/`c` come off the board. Git carries
   the denied takes; the page does not.
2. **Four offers, not three.** The board's old promise was three. This brief
   raises it to four for a re-voiced slot: the denial was of a whole register, so
   a wider spread is what makes the next verdict a choice rather than a re-run.
3. **`levelUp` and `oreCollect` are not touched.** They were re-voiced under a0-49
   and survived review under this exact ruling. They are the reference for the
   family, not work.
4. **`stationDeath` goes last** and is a *translation* of its existing shape, not a
   replacement: it is the most serious sound in the game and its routing was being
   fixed under a0-55 (`bank.ts:32`).

## What "modern/sci-fi, not retro/toony" means, per family

Written per family rather than once, so the next denial can be specific:

| family | what the register means here |
|---|---|
| combat | energy handled by hardware — a coil discharging, a driver venting, a field shedding. Transient first, body second, nothing rings like a bell |
| ship / flight | mass and plasma, not cartoon rockets. Particulate texture, filters that open and close over a fixed pitch, no pitch chirps |
| build / economy | shop-floor assembly: contact, pressure, seating. A latch, never a fanfare (§7.3) |
| interface | short, articulate, damped. One partial or one dry contact, gone in 30-60 ms; the interface does not congratulate (§4.7) |
| clock / state | structure under load. Low bodies, long filters, room behind them; the seriousness is in the mass, not in the volume |
| music / ambient | texture before melody. Beds are filtered material and beating unisons; stings are one gesture, not a tune |

## The slots

`status` is one of `todo` (owed) / `done` (four fresh offers on the board with
rendered previews, denied set removed) / `held` (deliberately not re-voiced under
this brief, with the reason in the note).

| slot | status | note |
|---|---|---|
| turretFire | todo |  |
| shotImpact | todo |  |
| shieldHit | todo |  |
| shieldDown | todo |  |
| coreHit | todo |  |
| turretDown | todo |  |
| shipExplode | todo |  |
| shipSpawn | todo |  |
| spawnPulse | todo |  |
| thruster | todo |  |
| respawnBeep | todo |  |
| respawnGo | todo |  |
| holdFull | todo |  |
| buildPlaced | todo |  |
| buildComplete | todo |  |
| repairTick | todo |  |
| bankOre | todo |  |
| upgradeBought | todo |  |
| depositTick | todo |  |
| pressTick | todo |  |
| purchaseConfirm | todo |  |
| rejectBuzz | todo |  |
| minimapPing | todo |  |
| waveArrive | todo |  |
| collapseBegin | todo |  |
| matchEnd | todo |  |
| alarm | todo |  |
| stationDeath | todo |  |
| ambient | todo |  |
| musicBed | todo |  |
| musicPulse | todo |  |
| musicTheme | todo |  |
| musicDread | todo |  |
| musicWin | todo |  |
| musicLoss | todo |  |

35 rows. `candidates.test.ts` (`every re-voiced slot offers a fresh set`) reads
this table and holds every `done` row to the two promises above — four offers, and
none of them under a denied letter — so the test cannot drift from what shipped.
