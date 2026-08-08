# s9-01 — the alarm plays once, and only for YOUR station · working notes

Branch: `agent/sound/s9-alarm-once-and-ownership` · from `4960540` (main),
merged up to `9803e3b`. **PR #318.**

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
- `64b4a4c` — **defect 2, the wire.** `audio.setLocal(LOCAL_PLAYER)` and the
  `WorldObserver` construction moved to the seat assignment; `setAlarmScope` fed
  every frame from live world truth; `window.__alarmStage` installed on BOTH boots.
- `ffd5d00` — the live-stage online spec + its own fleet, the GDD §2.2 fold-in,
  the `docs/design-amendments.md` entry.
- `6688ce9` — the sting retries when the mix is full; the seam is read in-match.
- `4625945` — the preview is fingerprinted; the readout lands in
  `evidence/s9-01-alarm-ownership.json`.
- `1543429` — the fleet is killed by process group, so a preview cannot outlive
  the run.
- `f053f2e` — merge `origin/main` (`9803e3b`). One conflict, in
  `docs/design-amendments.md`: a0-03 added its entry at the top of the file on
  the same day. Both kept, mine first. GDD §2.2 auto-merged — a0-03's `ORE`
  caption and this lane's alarm paragraphs are in different parts of the section.

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

**The sting retries when the mix is full.** Found while reviewing the diff, not
by a test: `graph.play` refuses a one-shot past the 24-voice cap, and a fierce
siege frame is exactly when that happens — which is exactly when a not-cuttable
mechanic must not be the thing dropped. A loop never had to survive this; one
sting does. The engagement stays unclaimed until a sting actually starts. The
headless engine and the death hush fall through instead, because retrying through
the three seconds of quiet would fire the klaxon on the far side of them.

**The preview is fingerprinted, not just polled.** The first green run of the
spec was served by a *leftover* preview from an earlier failed run — same outDir,
so it happened to be right, and would silently have been wrong the first time the
bundle changed. `--strictPort` does not help: it kills the new child while the
old one keeps answering 200. `alarm-fleet.ts` now compares the served
`index.html` against the one just built (the entry chunk is content-hashed), so a
stale run or a neighbouring working copy on the port fails loudly and by name.
Also `--host 127.0.0.1` on both ends: left alone `vite preview` listens on `::1`
while Node's `fetch` tries `127.0.0.1` first, and the readiness probe times out
against a server printing its own URL to the log.

## THE LIVE-STAGE SUITE IS ALREADY RED ON MAIN — read this before re-running it

`npm run test:live-stage` does not pass on `origin/main`, untouched. Measured, not
assumed: a worktree at `4960540` with this repo's `node_modules`, the suite's
preview port moved off 4173 so it could not borrow anything, full run —

| run | failed | passed | skipped |
|---|---|---|---|
| `origin/main`, untouched | 25 | 70 | 3 |
| this branch (run A) | 24 | 72 | 3 |
| this branch (run B, final HEAD) | 27 | 69 | 3 |

The new spec passes in every run. Run A's failing set is a strict **subset** of
main's; run B adds `minimap.spec.ts:662` and `ore-conservation.spec.ts:98`, and
**both pass in isolation on this branch** (9/9) — they are load flakes on a box
shared with other lanes, not this change. The shared failure mode is `__lobby`
never appearing after
`__mainMenu.play()` — the doors screen now sits between them — across
`fullscreen`, `unified-play-flow`, `lobby-flow`, `map-picker`, `upgrade-wheel`,
`connect-trace`, `codex-lobby`, `repair-core`, `tap-markers`, `minimap` and one
`audio-alive` test. It is not this lane's to fix and it is not this lane's to
hide: do not spend a session chasing it here, and do not report the suite as
green.

Counts wobble run to run (24, 27, and 28 in a contended run without the new spec
at all) — the box is shared across lanes. Every spec that failed on this branch
and not on main passed when re-run alone.

## NEXT

- Evidence against the LIVE deployment: an online match on a non-zero slot, own
  station attacked (alarm sounds **once**, arrow holds), then another player's
  station attacked (silence). Name the served sha. A green suite does not close
  this — the developer heard it in real play.
- Not done and deliberately out of scope: the sting is not re-voiced, and no VFX
  or bot-naming consequence of the 2026-08-06 tone amendment is touched (those
  are explicitly unratified, GDD §4.7 blast radius).
