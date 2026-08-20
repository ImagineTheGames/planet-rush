# a0-104-follow-the-arrow-and-there-is-no-arrow.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-104-an-arrow-or-different-words`.

## BUILT

- `7d725a91` **test(a0-104)** — `the prompt never names an arrow that is not
  drawn` in `src/ui/hud-geometry.test.ts` (+ a second case,
  `a siege the player never had to be told about does not retire the lesson`).
  Red on the pre-fix code; the failure output is committed at
  `evidence/a0-104-follow-the-arrow/red-before-the-fix.txt`.
- `a779293a` **fix(a0-104)** — `OnboardingSignals.homeArrowUp`, the
  `PromptId.UnderAttack` trigger gated on it, the completion latch gated with
  it, `src/ui/hud.ts` handing over `this.arrowDrawn`, and `arrowDrawn` cleared
  per frame at the top of `updateAlarm`. `src/ui/onboarding.test.ts` gained four
  unit cases and every existing staged siege gained `homeArrowUp: true`.
- `30c3cda2` **evidence(a0-104)** — eight frames + readbacks + README under
  `evidence/a0-104-follow-the-arrow/`, and the harness that takes them.

`npx tsc --noEmit` clean. `npm test -- --run`: 316 files, 5886 tests, all green.

## DECISIONS

**Which of QA's two readings is the built intent: the FIRST.** The arrow is
deliberately hidden while home is on screen, and the code says so in three
places that agree — `HomeArrow.onScreen`'s doc (`src/ui/alarm.ts:297-302`,
*"a pointer to somewhere you can't see"*), `Hud.drawHomeArrow`'s
`if (visible.onScreen) return;` (`src/ui/hud.ts:2312-2318`), and a test that
already pinned it by name (`src/ui/hud-geometry.test.ts:1711`). So there was no
missing arrow. The sentence was the defect.

**Gated the sentence, did not touch the wording.** GDD §2.10 quotes
*"Your station is under attack — follow the arrow"* verbatim and §2.2 makes the
arrow the standing half of the tell, so the words are right for the state they
are now shown in. Rewriting them would be the writer's call (style-guide §4.7)
and would also be a bigger change than the defect needs. Rejected: dropping the
arrow clause, and making the sentence conditional on two copies.

**Gated the COMPLETION latch too, and this is the part worth remembering.**
UNDER-ATTACK retires on a siege survived, permanently, across matches through
the memory port. Gate only the display and a siege fought in sight of home —
which now shows nothing — still spends the lesson, so a player could be robbed
of it for good on their first match. The latch now takes only frames the arrow
was up on. Release is unchanged (`wasUnderAttack && !underAttack`), so following
the arrow all the way home still completes it, which
`following the arrow all the way home still completes it (a0-104)` pins.

**`homeArrowUp` absent reads as NO arrow → no prompt.** Same direction `time`
fails in for OBJECTIVE. A caller that cannot say whether the arrow is up is a
caller that is not drawing one, so the sentence would be naming a mark that does
not exist. Cost: eleven existing `underAttack: true` sites in
`onboarding.test.ts` had to say `homeArrowUp: true` — which is honest, they are
all sieges fought away from home.

**Rider taken deliberately:** `arrowDrawn` was stale on quiet frames (only
`drawHomeArrow` cleared it, and it does not run when the alarm is down), so
`describeLayout` could register an `alarm-arrow` rect for a hidden graphic. Made
load-bearing by this fix, so made honest by it — cleared at the top of
`updateAlarm`.

**Traps hit while capturing the off-screen frame** (both are in the evidence
README, because a future capture of an alarm will hit them again):

1. The alarm latches for `ALARM_HOLD_S` = 5 s and a dpr-2 desktop screenshot
   plus its round trips take longer. A burst of damage then a leisurely shutter
   photographs a *released* alarm — and worse, a release RETIRES UNDER-ATTACK,
   so every frame after the lapse is honestly promptless for the wrong reason.
   That is what made the desktop off-screen frame come back promptless twice
   before the harness changed. Fix: a continuous in-page damage pump
   (2 HP / 400 ms) that runs for the whole capture.
2. The pump needs a FLOOR. The first cut hit 25 times and photographed a station
   at 0 core HP — and a dead station switches the alarm off outright
   (`updateAlarm` returns early on `stationAlive === false`). Floored at 30 HP.
3. `__alarmStage.read().active` is the AUDIO alarm and is false in a browser
   that has had no user gesture. The verdict to read is `alarm-frame` in
   `window.__planetRush.layout` — the HUD's own, the one the arrow keys off.

## NEXT

- PR open; DoD is tsc + full suite + the grep for the test name + PR not
  conflicting + checks not failing. Nothing known outstanding.
- Seen in passing, NOT fixed and not mine to decide: on the off-screen frames
  the arrow clamps onto the top edge under the WAVE clock's first line. Legible,
  and where the clamp puts it. If anyone wants them arbitrated, that is a row in
  `src/ui/layout-exclusions.ts` and an argument, not a tweak.
