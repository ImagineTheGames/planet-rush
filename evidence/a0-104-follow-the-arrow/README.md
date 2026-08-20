# a0-104 — "Follow the arrow", with the station on screen and no arrow drawn

Eight frames off the production bundle (`npm run build` + `npm run preview`,
`?debug=1`), two profiles × two screen states × before/after. The two profiles
are a0-99's own, unchanged, because this brief exists because of a0-99's pair of
frames and a re-capture on a different ruler is not a re-capture.

## What a0-99 asked

> if the screen-edge arrow is meant to appear only while the station is OFF
> screen, then the arrow is absent correctly and what is wrong is the sentence —
> it is being shown in the one state where what it names cannot be followed. If
> the arrow is meant to be up whenever the alarm is, it is missing.

## The code's answer: the first reading

`HomeArrow.onScreen` (`src/ui/alarm.ts:297-302`):

> True when home is already visible inside the inset rect. The arrow is a
> **pointer to somewhere you can't see**; once you can see the station, the
> station is the tell and the arrow is clutter — the view hides it.

`Hud.drawHomeArrow` (`src/ui/hud.ts:2312-2318`) does exactly that, on exactly
that test — `if (visible.onScreen) return;` — and
`src/ui/hud-geometry.test.ts:1711` has pinned it by name since before this brief
("is not drawn at all once home is on screen — the station is its own tell").

So the arrow was correctly absent from a0-99's frames. What was wrong is the
sentence: `PromptId.UnderAttack` fired on the alarm alone.

## The frames

| # | frame | station | arrow drawn | prompt drawn |
|---|-------|---------|-------------|--------------|
| 1 | `*-before-1-home-on-screen` | on screen | **no** | **yes** — "Your station is under attack — follow the arrow" |
| 2 | `*-before-2-home-off-screen` | off screen | yes | yes |
| 3 | `*-after-1-home-on-screen`  | on screen | no | **no** |
| 4 | `*-after-2-home-off-screen` | off screen | yes | yes |

Row 1 is a0-99's finding, reproduced on both profiles: the station labelled
`YOU` in the middle of the frame, the red alarm frame around the screen, no
arrow anywhere, and the band telling the player to follow one. Row 2 is **the
frame a0-99 could not take** — the same alarm with the station off screen, the
arrow up on the top edge. Row 3 is the fix. Row 4 is row 2, unchanged: the state
the sentence was written for still reads exactly as it did.

`arrow drawn` is not an eyeball verdict. It is `alarm-arrow`'s presence in
`window.__planetRush.layout` — the layout registry records what the HUD DREW, and
the arrow registers on exactly the frames it draws — so the column is the
client's own answer, taken from the same flag that draws the mark. Same for
`prompt drawn` (`onboarding`). Every row's JSON carries both, plus the sentence
the band actually held.

## The geometry, stated rather than implied

The `homeOnScreen` column in each JSON is arithmetic, not an impression: the
renderer's own visible-world rectangle (`__viewStage.world()`, the box the cull
culls against) against home's world position.

| profile | leg | visible world | home | inside |
|---------|-----|---------------|------|--------|
| phone 798×384 | on screen  | x 1775‥2573, y 1008‥1392 | 2174, 1200 | yes |
| phone 798×384 | off screen | x 1985‥2783, y 1908‥2292 | 1484, 1200 | no |
| desktop 1280×800 | on screen  | x 1534‥2814, y 800‥1600  | 2174, 1200 | yes |
| desktop 1280×800 | off screen | x 1744‥3024, y 1700‥2500 | 1484, 1200 | no |

## What is staged, and what is not

Declared plainly, because it changes how these frames should be read.

**Staged:** where the local ship is parked, and the damage on the reactor.

* `__oreHudStage.dock(0)` parks the ship at its own station; `__oreHudStage.mine(0)`
  parks it at `station + (900, 900)` — that seam's own documented "far from home"
  staging. Both are shipped `?debug=1` seams used by other captures. They move
  the ship, which is a thing a player does with a thumb; they touch neither the
  alarm, the arrow nor the prompt.
* `__planetRush.damageCore(0, 2)` every 400 ms, through the sim's OWN damage
  function on a tick boundary (a queued debug Action, not a poke at world state).
  5 HP/s against a bucket that drains at 2 HP/s, which is simply what an attacker
  parked on a reactor does. Floored at 30 core HP, because a dead station
  switches the alarm off and a siege is not a demolition.

**Not staged:** anything about the HUD. No element is shown, hidden, moved or
armed by this harness. The alarm's sustained-damage trigger is fed real core-HP
deltas and makes its own decision; the arrow decides its own visibility; the
prompt decides its own.

Two things the first cuts of this harness taught, written down because they
change how a capture like this has to be built:

1. **The alarm latches for five seconds and a dpr-2 desktop screenshot can
   outlast it.** A burst of damage followed by a leisurely capture photographs a
   *released* alarm. Worse, a release is not just a missing frame — UNDER-ATTACK
   completes on a siege survived, so a lapse mid-capture retires the very prompt
   being photographed and every frame after it is promptless for the wrong
   reason. Hence the continuous pump.
2. **`damageCore` does not reliably land on one call** (a0-99 measured this
   first). The pump makes that irrelevant.

## Re-running

    # after (this branch)
    npx playwright test --config evidence/a0-104-follow-the-arrow/playwright.config.ts

    # before (the pre-fix sources, same harness, same pipeline)
    git checkout main -- src/ui/onboarding.ts src/ui/hud.ts src/ui/onboarding.test.ts src/ui/hud-geometry.test.ts
    A0_104_TAG=before PREVIEW_PORT=4305 npx playwright test --config evidence/a0-104-follow-the-arrow/playwright.config.ts
    git checkout HEAD -- src/ui/onboarding.ts src/ui/hud.ts src/ui/onboarding.test.ts src/ui/hud-geometry.test.ts

`red-before-the-fix.txt` is the new unit case failing on the pre-fix code.

## One thing seen in passing, not fixed here

On the off-screen frames the arrow lands on the top edge under the WAVE clock's
first line (`phone-798x384-*-2-home-off-screen.png`). It is legible — threat red
on a scrim — and it is where the clamp puts it, so it is not a defect this brief
found; recorded because it is the kind of thing `./layout-exclusions` exists to
arbitrate, and nobody has argued that pair either way.
