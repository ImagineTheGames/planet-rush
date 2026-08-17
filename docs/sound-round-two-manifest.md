# Sound round two — the sixteen slots that came back with a reason each

OWNER: Sound Agent (a0-67). **Status of record for round two.** A row moves to
`done` in the same commit that lands the slot's new offers, so a reader of the PR
knows what is finished without listening to sixty-four files, and the next brief
knows exactly where to start.

## What happened, and why this manifest is not the a0-60 one again

Round one (`docs/sound-revoice-manifest.md`) was answered by a **theme** — the
2026-08-07 `deny-all` said *"make new ones that match the new theme (modern/sci-fi
and not retro/toony)"*, one sentence over thirty-five slots, so one register was
read out per family and applied down the board.

On **2026-08-17** the developer listened to the whole re-voiced board and denied
sixteen slots **with a specific reason each**. A theme cannot answer sixteen
different sentences. So this round is worked slot by slot, and every row below
carries the developer's words verbatim — a paraphrase of a denial is a new
opinion (LESSONS §17), and a round that cannot say which sentence it is answering
is how a board gets denied twice.

## The rules this round works under

1. **New letters, again.** Round one spent `a`/`b`/`c` (2026-08-07) and round two
   has now spent `d`/`e`/`f`/`g` (2026-08-17). A letter is the whole of how a
   verdict names an offer (`/status/sound-choices.json` records `{"verdict":
   "b"}`), so these fifteen slots re-offer under **`h`/`i`/`j`/`k`** and the
   denied letters come off the board. `oreCollect` is the one exception and it is
   arithmetic, not policy: it was never in the a0-60 sweep, so it has spent
   `a`-`f` and re-offers under **`g`/`h`/`i`/`j`**.
2. **Four offers per slot, minimum.** Same bar as round one.
3. **"I like current" means the current sound is on the board.** Four slots say
   some version of it (`bankOre`, `upgradeBought`, `musicWin`, `musicLoss`), and
   for those the shipped voice is offered as a **letter of its own** so the A/B is
   playable rather than remembered. Picking it is a real verdict: *keep what
   ships*. Those slots get three new takes **around** the incumbent, not a fresh
   start.
4. **"Make 3 distinct sounds … so i can see what direction to go in"** means
   three *directions*, not three takes. `oreCollect` and `turretFire` offer three
   that are as far apart as the slot allows, each one named as the direction it
   represents, plus the incumbent as the fourth so *"more satisfying than what I
   have"* can be measured by ear rather than asserted.
5. **"More subtle" is a fatigue complaint on the two slots that repeat.**
   `thruster` loops for as long as a finger is on the stick and `alarm` fires
   under stress. For those two, subtle is held as a **number** — quieter than the
   set that was denied *and* quieter than what ships — not as a character note.

## The sixteen, with the developer's words

`status` is `todo` (owed) / `done` (four offers on the board under fresh letters,
previews rendered) / `held` (deliberately not re-voiced, with the reason).

| slot | status | the developer's reason, verbatim | how the new set answers it |
|---|---|---|---|
| oreCollect | done | "they need to sound more satisfying, like you've won something, but subtle at same time, make 3 distinct sounds so that i can see what direction to go in" | three DIRECTIONS — an interval (`g`), a handful of material (`h`), a breath (`i`) — plus what ships (`j`). All under the incumbent in peak, RMS and length |
| turretFire | done | "none of these sound like a gun fire or laser turret, make 3 distinct sounds for it so we can see the direciton to go in" | three DIRECTIONS — a report (`h`), a discharge (`i`), a launch (`j`) — plus what ships (`k`). The laser gets a bounded ×1.5 pitch fall, by the developer's ruling |
| shieldHit | done | "none of these sound like ashield hit" | four kinds of FIELD, all of which give and come back — deflection (`h`), absorption (`i`), arc (`j`), flex (`k`). The denied four were struck plates and washes; none of them gave |
| thruster | done | "all of these sound annoying being looped, we need something more subtle since these will play all the time" | held to a NUMBER, not a character: every offer under half the shipped loop's RMS, every Q under 4 (a resonance beats at the grain rate — that is what "annoying looped" is), no corner sweeping the seam. Four amounts of presence: breath, pressure, one warm band, almost nothing |
| buildPlaced | done | "none of these sound like a build started" | four builds STARTING, not four latches: every take opens (last third louder than first; the shipped voice measures 0.02). Fabricator, hydraulics, printer, power |
| bankOre | todo | "i like the current and none of the new generations, they should some more like money related" | |
| upgradeBought | todo | "i like current but i want to hear new optinos that are more like it but also more subtle" | |
| stationDeath | done | "they should sound like an explosion" | four EXPLOSIONS — front, body, room — detonation (`h`), breach (`i`), blast-into-collapse (`j`), one concussion (`k`). All inside the 1.32 s tail invariant; nothing sparkles |
| alarm | done | "all of these are ultra annoying, more subtle" | the saw goes and the rising minor third stays. Since §2.2 was amended (2026-08-07) the alarm sounds ONCE and the screen arrow carries the duration — it must be unmistakable for a second, not nag for a siege. All four under the shipped alarm, all four still over the chatter |
| musicBed | todo | "none of these sound like a calm music bed" | |
| musicPulse | todo | "none of these sound musical" | |
| musicTheme | todo | "these sound like very bad music" | |
| musicDread | todo | "none of these sound critical they just sound annoying" | |
| musicWin | todo | "they still sound video gamey, the current is closest but too video gamey" | |
| musicLoss | todo | "i like current, but it still sounds too video gamey" | |
| pressTick | done | "what happened to the glass theme we had, none of these are glass themed like the main menu" | back in the glass: sine partials on 1 / 2.76 / 5.4, upper ones dying first, ~2 ms strike, A♭6 root. Four sizes of the same pane, all quieter and shorter than what ships |

## Not in this round

`shotImpact`, `matchEnd` and `spawnPulse` were denied in the same pass. Their
reasons ask for **structural** changes rather than new sounds, so they are a0-68
and are deliberately absent from the table above — a row here is a promise of
four voices, and offering four voices against a reason that is not asking for
voices is how round two happens a third time.

## The test that holds this file

`candidates.test.ts` → **`round two answers the reason it was given`** parses the
table above and holds every `done` row to the two promises: at least four offers,
and not one of them under a letter any verdict has already spent. The table is
*read*, never restated in the test, so the two cannot drift.
