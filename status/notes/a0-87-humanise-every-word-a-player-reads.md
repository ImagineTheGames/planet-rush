# a0-87 — humanise every word a player reads

Branch `agent/writer/a0-87-humanise-copy` · PR
[#461](https://github.com/ImagineTheGames/planet-rush/pull/461) · first brief for
the Writer role.

---

## BUILT

Three commits, all pushed.

**`dd4b442e` — the settings help says the one thing that is true here.**
`SETTINGS_HELP` became `Record<SettingsRowKey, (device: DeviceKind) => SettingsHelp>`
and `settingsHelp(spec, device)` takes the device. `settingsModel` already
received `device` by argument (u8-01), so it just passes it on — no new plumbing
in `main.ts`, no behaviour change. Copy, old → new:

| row | before | after |
|---|---|---|
| CONTROLS | "…The other scheme puts steering and aim in your hands — WASD and the mouse, both pad sticks, or two sticks on the glass." | "TAP COMMANDER flies the ship for you: tap where to go, tap what to hit. On `STICKS_LABELS[device]` you steer and aim yourself." |
| FIRE MODE | "AUTO-AIM takes the aim off you — …leads it; you still choose when to fire. MANUAL leaves aiming to your mouse, stick or thumb, for choosing the target yourself." | "AUTO-AIM locks the nearest target and leads it. MANUAL leaves the aim to you. Either way, you choose when to fire." |
| REDUCE VFX | "…— impact glows, shimmer — …under 30 for a few seconds; ON keeps them thin whatever the rate." | "Thins the effects that carry no information, to hold the frame rate. The game does this on its own when the rate drops; ON keeps them thin all the time." |
| MASTER | "Every sound the game makes, the under-attack alarm included. The other two channels sit under it." | "Every sound the game makes." |
| SFX | "Weapons, impacts, engines, and the interface itself. The under-attack alarm is not on this channel — it is a warning, and stays audible at zero." | "Weapons, impacts, engines, menus." |
| MUSIC | "The soundtrack, and nothing else. Nothing you need to hear in a fight rides this channel, so it can sit at zero." | "The soundtrack." |

`WASD` now appears **0 times** in `src/ui/settings.ts` — copy and doc comments
both (the `STICKS_LABELS` comment cited the binding literally; it now says "the
movement keys").

**`c547fdf9` — the rest of the sweep, and the standard written down.**
End of match: `'Your reactor is gone — but the fight goes on.'` → `'Your reactor
is gone.'`. `docs/voice.md` created. Three tests.

**`24bc348e`** — restored a doc comment dropped by the previous commit.

### Tests

- `src/ui/settings.test.ts` → **`never names another device`** (the DoD test).
  Every row × every device, asserting none of the *other* two devices' words
  appear; then the converse, that CONTROLS still names its own scheme via
  `STICKS_LABELS[device]`, so the rule cannot be satisfied by saying nothing;
  then that the three readings are three distinct sentences.
- `src/ui/settings.test.ts` → **`fits its panel on the narrowest screen`**.
  Replaces `summary.length <= 260` — a character count standing in for a pixel
  one — with the real greedy wrap at 240px in Oxanium 12 via `font-metrics`,
  measured at 798×384.
- `src/ui/onboarding.test.ts` → **`never names another device, in any
  configuration`**. Prompt × device × mode × scheme. Green on arrival; this stops
  it rotting.
- `every row explains itself` keeps the drive-off-the-row-list gate and **loses
  its `> 20 characters` floor** — that floor was a licence to pad.
- The audio-channel test flipped from "says the alarm is/isn't here" to
  **`says what is ON each audio channel, and nothing about what is not`**, which
  guards the *pattern* (no `/alarm/i`, no `/\bnot\b|\bexcept\b|\bnothing else\b/`)
  rather than the one string.

Both new settings assertions were verified **red** against the copy they replace
before the copy moved — transcript in the PR body.

---

## DECISIONS

**The device seam, not a hedge.** The CONTROLS row already picked its own word
per device (u8-01). The help hedged the same fact back in as a list of all three,
which is what put a keyboard on the developer's phone. Reusing `STICKS_LABELS`
means the panel and the pill cannot disagree. Rejected: a fourth generic word
("your controls"), which is device-blind by another route.

**Every entry takes the device, including the five that ignore it.** One uniform
shape keeps a0-77's `tsc` gate intact (a `Record` over the key union derived from
`SettingsRowSpec`) and lets the next row that needs the device take it without
moving the register.

**The alarm's routing is gone from both volume rows, not moved.** Defining a
control by what it *excludes* is the pattern the developer objected to. The mixer
is unchanged and `art/audio/audio.test.ts` still holds it.

**Left alone, deliberately:**

- `CLAIM HELD` / `CLAIM LOST` / `NO CLAIMANT` / the "took the claim" spine —
  theme, and a0-61 has an open ruling.
- `OUTER DOOR SEALED · PRESSURE EQUALISED` — pure theme; it instructs nobody.
- `PRESS ANYWHERE TO ENTER` — four words, verb first, names no hardware. Making
  it device-aware would mean threading `isTouch` through the title-gate markup
  builder for no gain.
- The in-match prompts (`onboarding.ts`) — already the right pattern; they
  resolve `{fire}` / `{build}` through `describeBindings`. They got the guard
  test, not new copy.

---

## NEXT

Nothing left to build on this brief. Two things **handed back** rather than
built, both recorded in `docs/voice.md` so they do not get lost:

1. **The alarm, at the moment it matters.** If the under-attack alarm surviving a
   muted master is worth a word, it is one short line the first time somebody
   drops MASTER to zero — not two paragraphs of routing in a settings screen.
   That needs a new surface, so it needs the owning agent.
2. **The OBJECTIVE prompt.** "Be the last station standing — mine ore, build
   defenses, upgrade your ship, attack when you judge it right" is a four-item
   list and three of the four have their own contextual prompt. Cutting it to the
   goal alone reads better, but changes what a player learns if they never
   trigger those prompts — an onboarding-coverage decision (a0-34 / r14-01), not
   a copy one.

Marginal, noted in the PR: the CONTROLS tip says "in SETTINGS, or the pause menu"
and fires mid-match, where only the pause menu is reachable. Left alone — the
test citing it quotes GDD §2.4 verbatim.

**Status — done.** `npx tsc --noEmit` clean; `npm test -- --run` green (312 files,
5736 tests); all thirteen CI checks green, zero failures. **PR #461 merged
2026-08-19 00:21 UTC** as `72238d81`.

The two new settings assertions were re-verified red/green in a later session:
the old CONTROLS and MASTER strings were restored into `settings.ts`, the suite
run, and both failed —

```
× never names another device
× says what is ON each audio channel, and nothing about what is not
```

— then the file was restored and both passed. The gate is real, not decorative.

This note missed the merge by two minutes and follows in its own docs-only PR.
