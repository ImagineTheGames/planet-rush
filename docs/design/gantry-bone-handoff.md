# Planet Rush — UI direction handoff

**From:** design
**Re:** menu / lobby / HUD / build-wheel visual + audio direction
**Attached:** `Planet Rush UI - Director Handoff.html` — one self-contained file, works offline, double-click to open. It is interactive: hover and click things.

---

## What this is

A single locked direction — internally **"Gantry / Bone"** — applied across the five screens that set the game's tone: title, build wheel, lobby, ship select, settings. Plus a working audio prototype, because roughly half of what reads as "professional" here is sound, not pixels.

Everything stays inside the frozen **Cold Vacuum** contract: the six material colours, Audiowide display / Oxanium HUD, and the RESERVED rule (signal yellow and threat red never appear as UI chrome — only as ore and danger). **No new hue is proposed.** Nothing here needs a palette exception.

## The diagnosis, in one line

The current UI is 1px hairlines on black, which reads as a wireframe rather than a product. The fix is *material*, not colour: every plate now has a lit top edge, a shadowed under-line, a cast shadow, an inner sheen on primaries, and rivets where plates meet. One tracking scale replaces the six that had drifted in (.26em eyebrows / .16em labels / .1em names).

## What's decided

- **Bone accent** — the primary action is simply the brightest plate on screen. It spends no colour on the menu, which leaves the palette's hues free to mean things during a match.
- **Type, spacing and beam treatment** are consistent across all five screens: 44px margins, 92px header/footer beams.
- **Build wheel** shows cost as `cost/held` (yellow when affordable, red when not) — no "need 2 more" copy, because the numbers already say it.
- **Lobby**: slots are `OPEN` / `CLOSED` buttons on the far left of each row; teams are `T1`–`T8` chips with a FREE FOR ALL / TEAMS toggle, so FFA is just eight teams. Identity colours live on the row bar and P-number only, never as a background wash — that was making identity read as chrome.

## Audio — please listen before reading the table

Open the file, press **SOUND ON**, then click around. The whole set is *one pane of struck glass*, differentiated only by pitch, direction and note count:

| Cue | Shape |
|---|---|
| Hover | one note, high, fixed pitch |
| Wheel detent | one note, octave above the click, fixed pitch |
| Forward pick | one note, A♭6 |
| Confirm | two notes **rising** a fifth |
| Back / cancel | two notes **falling** a fourth |
| Purchase | three notes rising — A♭6, fifth, octave |
| Refused | two notes a minor second apart, resolving nowhere |
| Seat joins | one note, stepping up by slot index |
| RUSH! | five notes climbing, then all three confirm notes struck at once and held |

Three rules worth enforcing in code review:

1. **One sound per state change.** No cue stacking.
2. **The sound tells you the outcome before the pixels do.** A refused purchase and a completed one must be unmistakable with your eyes on the fight.
3. **Back never uses a forward cue.** Falling interval = backwards. Players learn it in about three presses.

Implementation notes: sine partials only, on inharmonic ratios (1 / 2.76 / 5.4), ~2ms attack, upper partials decaying fastest, all through one short shared reverb at 25% wet. No square, no saw, no pitch bends — each of those is what made earlier passes sound retro or cartoonish. Every press is detuned ±0.5 semitone, one factor per cue so intervals stay exact; hover and detent are deliberately excluded because a wobbling hover reads as a fault.

The prototype synthesises all of this in a few hundred lines with no audio assets. Shipping recorded samples is fine — but the parameters in the file are the spec.

## Two decisions I need from you

1. **Ship stats on the ship-select screen.** `lobby.ts` currently forbids them. I've shown them anyway, as coarse pips rather than numbers. Yes or no?
2. **The industrial voice.** The UI speaks as a mining authority — contracts, rigs, operators, seals — rather than as a game menu. That's the cheapest immersion upgrade available and costs zero engine work, but it's a lore call, not a design one.

## Not built yet

Lobby slot/team toggles and settings rows have hover, press and sound but aren't stateful — they're presentation, not logic. Also worth a conversation: the ambient bed, the core-under-attack alarm tied to HP, and the three seconds of near-silence on planet death. That last one is the strongest beat in the whole spec and it needs protecting in the mixer, not in gameplay code.

## Tweakables in the file

Accent colour (8 palettes) and title backdrop (void / aurora / galaxy / nebula / solar system) are switchable live, so you can react to alternatives without me rebuilding anything.
