# docs/voice.md — the words a player reads

GDD §4.7 governs the game's voice. This is the practical companion to it, for
the strings that are not in the GDD: settings help, in-match prompts, the title
gate, end-of-match lines, buttons, empty states, errors.

Written 2026-08-18 (a0-87), from two things the developer found on their phone.
Check copy against this page before you write it, and against it again after.

**Before writing copy that says what a setting does, read `docs/settings.md` and
confirm it still matches the code.** Every row is traced there to the line that
implements it, with the mismatches listed first — a sentence that sounds true and
is checked against the wrong branch is how the FIRE MODE help survived two
reviews (a0-91).

---

## The one question

**What does the player do differently after reading this?**

If nothing, cut it. If something, say that and stop.

That is the whole standard. Everything below is a way of noticing when a line
has stopped answering it.

---

## Verify the claim before writing it

Copy that states how the game behaves is a factual assertion, and the only way
to check it is to read the code that implements it.

Added 2026-08-19 (a0-89), because the sweep that wrote this page shipped a
sentence that was the opposite of what the game does. `FIRE MODE` ended *"Either
way, you choose when to fire."* — checked against `src/sim/step.ts`, where it is
true, and false on the developer's phone, where `TapPilot` holds the trigger for
them. Reading one layer is not verifying; the claim has to be true at the layer
the **player** stands on, which means following it out to the seam that actually
drives their ship. Where the answer differs by scheme or device, that is not a
sentence to hedge — it is a branch, through the seam (below).

---

## The register

The game speaks like a mining authority, not a tutorial. Plain, factual, no
drama, no marketing. It states the terms; it does not wish anybody luck and it
does not console them.

- Short words. Active voice. Present tense.
- Contractions where they read naturally.
- Lead with what it does *for them* — not what it is, not how it works.
- Use the player's word, not the system's. They have a ship, a hold, a home.
  They do not have a *scheme*, a *flag*, a *channel*, or a *seam*. `REDUCE VFX`
  says "effects"; it never says `VfxAutoQuality`.
- **Assume intelligence, not knowledge.** A player can work out what a slider
  does. They cannot know which sounds SFX covers. Explain the second, never the
  first.
- A player mid-match reads with a fraction of their attention. Copy earns its
  place by being read in one glance.

---

## Write to the device in front of them

The game knows whether it is on a phone, a pad or a keyboard. The words should
know too.

A sentence that hedges across all three inputs is true on every device and
useful on none. If a fact differs by device, branch it through a real seam —
never a list.

The two seams that already exist, and the pattern to copy:

| Where | Seam |
|---|---|
| Settings CONTROLS row | `STICKS_LABELS[device]` — STICKS / TWIN STICKS / KEYBOARD + MOUSE (`src/ui/settings.ts`) |
| In-match prompts | `{fire}` / `{build}` resolved through `describeBindings` (`src/ui/onboarding.ts`) |
| Settings FIRE MODE row | the `scheme` arm of `SETTINGS_HELP` — who fires is a fact about the CONTROL SCHEME, not the device (a0-89, `src/ui/settings.ts`) |

The same applies to a fact that differs by **scheme** rather than device, which
is what a0-89 found: `settingsHelp` takes both, and both are required, so a
caller cannot quietly resolve copy for a configuration the player is not in.

Three tests hold this, and a new one should be added anywhere copy grows another
configuration-dependent fact:

- `src/ui/settings.test.ts` → `never names another device` (swept over both schemes since a0-89)
- `src/ui/settings.test.ts` → `the fire help is true under every control scheme`
- `src/ui/onboarding.test.ts` → `never names another device, in any configuration`

`tap` is **not** a device word: TAP COMMANDER is a scheme, and a tap is a tap
whether it lands from a finger or a mouse. Nor is `stick` — it is true of the
glass and of a pad both.

---

## The tells to strip

This is how "AI wrote it" reads. All of these were in this codebase.

| Tell | What it looks like |
|---|---|
| **The triad** | "impact glows, shimmer, and screen shake." Two is a list, three is a lecture. Usually one example is enough, or none. |
| **The em-dash explainer** | A clause after a dash that restates the sentence in other words. Delete the clause; if the sentence needed it, rewrite the sentence. |
| **Restating the label** | A row called CONTROLS whose help begins "Controls are…". They just read the label. |
| **Hedging into universality** | "either WASD, both pad sticks, or two sticks." Pick the one that is true for them. |
| **Throat-clearing** | "This setting lets you…", "You can use this to…". Start at the verb. |
| **Fake balance** | "It is X — but it is also Y." Say the one that matters. |
| **Defining by exclusion** | Saying what a thing is NOT. List what it covers and stop. |
| **The question nobody asked** | Pre-empting an edge case costs every reader attention to spare one reader a surprise. Let the surprise happen in context. |
| **Dead words** | simply, seamlessly, robust, leverage, utilise, ensure. Also "please" in a control. |
| **Padding to fill a box** | An empty tooltip beats a padded one. A control that needs no explanation gets none. |

**And when two pieces of copy touch the same fact, they must agree** — or, better,
only one of them should mention it at all.

---

## Before / after — the strings a0-87 actually changed

### Settings help (`src/ui/settings.ts`)

**CONTROLS** — the specimen. Was one sentence on every device; is now the
device's own.

> **Before**
> TAP COMMANDER flies the ship for you: tap a spot to move there, tap a target
> to attack it, tap your own station to bank. The other scheme puts steering and
> aim in your hands — WASD and the mouse, both pad sticks, or two sticks on the
> glass.

> **After (phone)**
> TAP COMMANDER flies the ship for you: tap where to go, tap what to hit. On
> STICKS you steer and aim yourself.
>
> **After (pad)**
> …On TWIN STICKS you steer and aim yourself.
>
> **After (PC)**
> …On KEYBOARD + MOUSE you steer and aim yourself.

*Tells: hedging into universality, the triad. Banking left the panel — the
in-match prompt teaches it at the moment a full hold makes it matter.*

---

**FIRE MODE** — *and then a0-89, which is why the page grew a rule.*

> **Before (a0-87)**
> AUTO-AIM takes the aim off you — the weapon locks the nearest target in range,
> in any direction, and leads it; you still choose when to fire. MANUAL leaves
> aiming to your mouse, stick or thumb, for choosing the target yourself.

> **After a0-87 — WRONG, and shipped**
> AUTO-AIM locks the nearest target and leads it. MANUAL leaves the aim to you.
> Either way, you choose when to fire.

> **After a0-89 (sticks)**
> AUTO-AIM locks the nearest target and leads it while you fire. MANUAL leaves
> the aim to you.
>
> **After a0-89 (Tap Commander)**
> TAP COMMANDER aims and fires for you. Switch CONTROLS to aim yourself.

*Tells a0-87 fixed: the triad ("mouse, stick or thumb" — two of the three wrong
for whoever is reading), the em-dash explainer, restating the label.* **The tell
it added:** a0-87 kept the third sentence on purpose — *"a player may reasonably
assume auto-aim also pulls the trigger, and it does not"* — having checked it
against `fireShip()`, which does require `intent.fire` in both modes. Under Tap
Commander the pilot supplies that `fire` itself, so the game fires and the panel
claimed the player was choosing. One layer down was the wrong layer. See
**verify the claim before writing it**, above, and the scheme branch this now
takes.

---

**REDUCE VFX**

> **Before**
> Thins the effects that carry no information — impact glows, shimmer — to hold
> the frame rate. The game does this on its own when the rate sits under 30 for
> a few seconds; ON keeps them thin whatever the rate.

> **After**
> Thins the effects that carry no information, to hold the frame rate. The game
> does this on its own when the rate drops; ON keeps them thin all the time.

*Tells: the em-dash explainer, the question nobody asked. The 30 fps floor and
the ~3 s hold are gone: there is no frame counter on screen, so a number the
player cannot check changes nothing they do.* The automatic half stays — it is
the one thing they cannot otherwise account for when the effects thin out
mid-fight.

---

**The three volumes** — the second specimen. Two rows taught the alarm's routing
from opposite directions.

> **Before**
> MASTER  Every sound the game makes, the under-attack alarm included. The other
> two channels sit under it.
> SFX  Weapons, impacts, engines, and the interface itself. The under-attack
> alarm is not on this channel — it is a warning, and stays audible at zero.
> MUSIC  The soundtrack, and nothing else. Nothing you need to hear in a fight
> rides this channel, so it can sit at zero.

> **After**
> MASTER  Every sound the game makes.
> SFX  Weapons, impacts, engines, menus.
> MUSIC  The soundtrack.

*Tells: defining by exclusion, the question nobody asked, padding to fill a box.
Nine words, nothing lost.* The mixer's routing is unchanged and
`src/art/audio/audio.test.ts` still holds it; it is simply not something a
settings screen says.

### End of match (`src/ui/end-of-match.ts`)

> **Before** Your reactor is gone — but the fight goes on.
> **After** Your reactor is gone.

*Tells: fake balance, the em-dash explainer. §4.7 register 2 "congratulates
neither", and that cuts both ways — it does not console either. The fight going
on is already on the screen: REMATCH and SPECTATE sit directly under this line.*

---

## What was left alone, and why

**Theme is not instruction.** These lines are the game's voice, not help text,
and flattening them into helpdesk prose would be the opposite of the job.

| String | Where | Why it stays |
|---|---|---|
| `CLAIM HELD` / `CLAIM LOST` / `NO CLAIMANT` / "took the claim" | end of match | Theme, and the developer has an open ruling on it (a0-61). |
| "the collapse closed over your reactor." | end of match | Factual and in register; the collapse is a real mechanic. |
| `OUTER DOOR SEALED · PRESSURE EQUALISED` | title gate | Pure theme — a condition in the nouns of work. It instructs nobody and is not pretending to. |
| `PRESS ANYWHERE TO ENTER` | title gate | Four words, verb first, and it names no hardware — you press glass as readily as a key. Making it device-aware would mean threading `isTouch` through the markup builder for no gain. |
| The in-match prompts | `onboarding.ts` | Already the right pattern: every reading is device-correct through the binding seam. a0-87 added the guard test rather than the copy. |

**Two things worth doing that a0-87 did not, because they are not copy changes:**

1. **The alarm, at the moment it matters.** If the under-attack alarm surviving
   a muted master is worth saying, it is one short line the first time somebody
   drops MASTER to zero — not two paragraphs of routing in a settings screen.
   That needs a new surface, so it needs the owning agent.

2. **The OBJECTIVE prompt.** "Be the last station standing — mine ore, build
   defenses, upgrade your ship, attack when you judge it right" is a four-item
   list, and three of those four have their own prompt that fires at the moment
   they matter. Cutting it to the goal alone would read far better — but it
   would also change what a player learns if they never trigger the contextual
   prompts, which is an onboarding-coverage decision (a0-34 / r14-01), not a
   copy one.

---

## Length is a design constraint

Read the string where the player meets it, at the narrowest size that ships.
A line that is fine in a source file can be wrong on a **798×384** screen — the
developer's phone, and the viewport both field reports came from.

The settings help panel is a fixed 260 px wide with 10 px padding, so the
summary wraps at 240 px in Oxanium 12. `src/ui/settings.test.ts` →
`fits its panel on the narrowest screen` measures that for real, with
`font-metrics`, rather than counting characters and hoping.

---

## What to test, and what not to

Copy is testable where meaning matters. Do **not** test prose for taste — test
it for the things that are actually wrong:

- **Absent.** Drive the check off the row list, so a new row shipped without
  copy fails the build (`every row explains itself`).
- **Too long for the box.** Assert against the narrowest supported width, in
  pixels, not characters.
- **Naming the wrong device.** The bug that created this page.

Two floors that look like tests and are not: a minimum character count (a
licence to pad — `MUSIC VOLUME` says "The soundtrack." and is finished), and a
character-count stand-in for a pixel width (not the same number in any font).
