# s9-01 — the alarm plays once, and only for YOUR station · working notes

Branch: `agent/sound/s9-alarm-once-and-ownership` · from `4960540` (main).

Working note, not evidence. The DoD, the PR body and QA attestation are the record.

## The developer, 2026-08-07, verbatim

> "also for the alarm, it should only play once, and not keep playing (and should
> only play for your station not others)..."

The brief located both defects, and both were exactly where it said. No time was
spent re-finding them.

## BUILT

- `bb28884` — **defect 1, the loop.** `syncAlarm` now sounds one one-shot per
  *engagement* instead of starting a loop while `alarm.active`. Ducking follows
  the sting (`ALARM_DUCK_S`), not the siege. `SOUND.alarm` stops being a `loop`
  spec (same bar, same two tones, ordinary edge fades). `alarmSounds` counts
  stings headless. `deriveAlarmAllies` moved presenter.ts → `audio/scope.ts`.
  Nine unit tests.
- *(second commit)* — **defect 2, the wire.** `audio.setLocal(LOCAL_PLAYER)` and
  the `WorldObserver` construction moved to the seat assignment; `setAlarmScope`
  fed every frame from live world truth; `window.__alarmStage` installed on BOTH
  boots.
- *(third commit)* — the live-stage online spec + its own fleet, GDD §2.2
  fold-in, `docs/design-amendments.md` entry.

## DECISIONS, and what was rejected

**The hysteresis stays, and changes job.** `MIN_HOLD_S` / `RELEASE` were written
against a *looping* alarm stuttering. Deleting them with the loop was the obvious
tidy-up and would have been the bug: with a one-shot they are the re-trigger
guard that stops a dodge-and-return attacker machine-gunning the klaxon. Same
constants, better job — the brief called this and it is right.

**The sting is one bar, not two.** The alarm buffer is a single bar of two rising
tones (~0.6 s). "Play once" is taken literally; padding it to two bars would be
re-litigating "unmistakable" without a ratification. What carries the duration
now is the arrow, which is the design content of the amendment.

**The arrow was verified before the sound was cut**, per the brief's BLOCKED
clause. `src/ui/alarm.ts` `homeArrow` is real, drawn by `Hud.drawHomeArrow` off
the HUD's own sustained-damage trigger (`ALARM_HOLD_S = 5`), and hidden only when
home is already on screen — where the station itself is the tell. It is fed from
`LOCAL_PLAYER` through a closure, so unlike the audio it was never mis-seated.
Not blocked.

**The sting kept the ALARM bus.** `flat()` defaults to `sfx`; the loop had named
`'alarm'`. Taking the default would have quietly put a not-cuttable mechanic
under the SFX slider. Also `rate 1` — no pitch jitter on an emergency signal.

**`deriveAlarmAllies` moved rather than being copied.** `main.ts` and
`presenter.ts` are two wirings of the same engine and only one of them knew the
rule, which is how "an ally's siege never rang" survived. One copy, in
`src/art/audio/scope.ts`, imported by both. `presenter.ts` is a two-line import
change and is flagged in the PR body.

**A new seam rather than widening `__audioStage`.** `__audioStage` is `?debug=1`
only, and `?debug=1` skips the menu into an OFFLINE match — it can never see an
online one. `__alarmStage` ships on both boots for the same reason
`__pauseStage` does, and is pure read-back.

**The live-stage spec stands up its OWN fleet.** The DoD names
`npm run test:live-stage`, which is the offline config — its bundle has no
allocator baked in, so CREATE ROOM there can only refuse. `tests/live-stage-online/`
solves that with a `globalSetup` on a config that is not mine to change, so
`tests/live-stage/alarm-fleet.ts` spawns the same three shipped processes from
the spec's own `beforeAll`, on its own ports (8795/8796/4176) and its own
out-dir (`dist-alarm-stage/`). Slow, and the only route to the claim.

**Slot 0 cannot pass.** The spec asserts on the GUEST and fails outright if the
guest was seated at 0, because with the wire dead `local` defaults to 0 and reads
identical to a live one — which is precisely how this survived merged and tested.

## NEXT

- Evidence against the LIVE deployment: an online match on a non-zero slot, own
  station attacked (alarm sounds **once**, arrow holds), then another player's
  station attacked (silence). Name the served sha. A green suite does not close
  this — the developer heard it in real play.
- Not done and deliberately out of scope: the sting is not re-voiced, and no VFX
  or bot-naming consequence of the 2026-08-06 tone amendment is touched (those
  are explicitly unratified, GDD §4.7 blast radius).
