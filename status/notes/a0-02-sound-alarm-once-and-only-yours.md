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

## THE LIVE DEPLOYMENT DOES NOT HAVE THIS FIX — measured, 2026-08-08

`evidence/s9-01-live-probe.mjs` (committed, re-runnable) fetches the deployment,
names the served sha and says whether the shipped entry chunk carries this lane's
code. Against `https://imaginethegames.github.io/planet-rush/`:

```
servedSha    9803e3b   (= origin/main, published 2026-08-08T03:13Z)
__alarmStage false   ·  alarmStings false  ·  __pauseStage true (control)
verdict      the fix is NOT deployed
```

Pointed at this branch's own preview it reads `cbbc090`, both markers true,
`deployed` — the positive control, so this is not a permanently-false grep.

**Therefore the by-ear evidence item the brief asks for is blocked on the DEPLOY,
not on the work.** The developer is still hearing the loop and still hearing slot
0's station, because what is live is still pre-fix code. Do not write that
attestation against 9803e3b and do not let a green suite stand in for it: after
PR #318 merges and Pages republishes, re-run the probe, confirm `deployed`, then
play an online match on a non-zero slot and listen. That is the only thing that
closes it, and it is QA's to write, not this lane's to claim.

## BUILT, round 2 (this session)

- `5f7738c` — `evidence/s9-01-live-probe.mjs` + its readout, and the behavioural
  live-stage spec that the next commit removes (see below — it cannot pass here).
- the frame-rate finding, pinned as a unit test in `audio.test.ts`
  (`KNOWN LIMIT: …below ~20 fps`), with the live-stage spec removed in the same
  commit and the reasoning kept in this file and the PR body.

## FINDING: the alarm cannot fire below ~20 fps, and it is not this lane's to fix

Found by trying to prove the one-shot in a booted client instead of in memory.
The behavioural live-stage spec (written, run, **deleted** — see below) could not
raise the alarm in headless Chromium *at all*, however hard the core was hit.
Measured, `?debug=1`, this bundle: **2.0 fps at 1280×800** (the live-stage
viewport), 3.0 at 800×600, 6.7 at 640×400, 12.9 at 400×300. `setTimeout(4ms)`
got 13 ticks in 6 s, so the main thread is saturated by the render loop.

The cause is a units mismatch that predates this lane:

- pressure is deposited per **event** — `damage()`, `+WEIGHTS[kind]`;
- it leaks per **second** — `update(dt)`, `−LEAK·dt`;
- and `art/vfx/observer.ts` emits at most **one `coreHit` per station per
  rendered frame** (it diffs core HP against last frame, so ten hits in one
  frame are one tell).

So deposits scale with frame rate while the leak scales with time, and the
break-even is a frame rate: `LEAK / WEIGHTS[coreHit]` = `1.2 / 0.06` = **20 fps**.
Above it pressure climbs to ENGAGE; below it every frame leaks more than it
deposits and no siege can ever ring the klaxon.

Not the whole mechanic: `shieldDown` / `turretDown` weigh 0.8 — over ENGAGE on
their own — so a station actually losing its defences still rings at any frame
rate (GDD §2.6). It is the slow grind on a bare core that goes unannounced, which
is also the case the player is most likely to be away from (§2.2's whole point).

**Not fixed here, deliberately.** The honest fix is in the *observer* (emit
`coreHit` proportional to damage, or accumulate per tick rather than per frame)
— `src/art/vfx/observer.ts`, which is not this lane's file — and it would move
*when* a ratified §2.2 mechanic fires. That is a Director/Art call, not a
sound-lane one, and s9-01 is about the sting and the seat. Pinned instead by a
unit test, `KNOWN LIMIT: sustained core fire cannot raise the alarm below ~20
fps`, which asserts 60 fps and 30 fps engage, 10 fps never does over 30 s of
unbroken fire, and the 20 fps arithmetic off the shipped constants. Named in the
PR body as a follow-up.

## The behavioural live-stage spec was written, run, and REMOVED

`tests/live-stage/alarm-once-and-ownership.spec.ts` sieged real cores through the
`?debug=1` write seam and sampled the alarm every frame (A: 5 s on your core →
one sting; B: release; C: 5 s on a rival's → silence; D: re-engage → two). It is
the right test and it cannot pass in this suite's environment, for the reason
above — 22 frames in 5 s, and the pressure never reaches ENGAGE. Committed in
`5f7738c`, removed in the follow-up commit rather than left red or left skipped:
a spec that cannot pass on the box the DoD runs on is worse than no spec.

**Do not re-add it without first fixing the frame rate or the deposit model.**
The behavioural claim is carried by ten unit tests against the real `AudioEngine`
and a recording AudioContext, which is the finer instrument anyway; the live
class earns its keep on the *wire* (`alarm-ownership-online.spec.ts`), which is
where the defect actually was.

## TRAP, and this time it actually bit: 4173 served a NEIGHBOUR'S bundle

`tests/live-stage/playwright.config.ts` uses port 4173 with
`reuseExistingServer: !CI`, and the lanes share one box.

- The `cbbc090` run was fingerprinted first and was **ours** (served
  `assets/index-BqT9NfUA.js` / sha `cbbc090` == `dist/` == HEAD).
- The run after the `03ed194` merge was **not**. Served sha `5665364` against a
  HEAD of `52c137a` and a `dist/` of `e293990` — Playwright found something
  already answering on 4173 and reused it, so the whole suite ran to completion
  describing another lane's build, with nothing in the output saying so. Killed
  and re-run. Other lanes were also holding 4207 and 4208.

**Fingerprint before believing any live-stage result.** `version.json` carries
the sha, so it is one comparison:
`curl -s http://localhost:4173/version.json` vs `dist/version.json` vs
`git rev-parse --short HEAD`.

**The re-run route, since the suite config is the Platform Engineer's file and
not ours to edit:** a throwaway copy at the repo root on a free port
(`playwright.live-stage-private.tmp.config.ts`, port 4191,
`reuseExistingServer: false`, `--host 127.0.0.1`), run with
`npx playwright test --config …`, then deleted. **Do not kill a neighbour's
preview** to free the port.

Also, again: `vite preview` binds `::1` only unless told otherwise —
`curl 127.0.0.1:4173` returns nothing while `curl localhost:4173` returns 200,
and Node's `fetch` prefers the v4 address, so a readiness probe times out against
a server that is up. `ss -lptn` returns nothing useful in this sandbox, so port
checks have to be curl + fingerprint rather than a socket list.

## BUILT, round 3 (this session)

- `4e7abe9` — the 4173 trap write-up above (it actually bit) and the private-port
  re-run route.
- The PR body was **two commits stale**: it carried neither the ~20 fps finding
  nor the live-probe result. Both are now in it — the frame-rate section names
  `src/art/vfx/observer.ts` as the follow-up and whose call it is, and Outstanding
  states plainly that the by-ear item is blocked on the deploy, with the served
  sha.
- Deploy re-probed **2026-08-08**: it has moved on from `9803e3b` to **`03ed194`**
  and is **still pre-fix** (`__alarmStage` false, `alarmStings` false,
  `__pauseStage` true as the control). `evidence/s9-01-live-probe.json` refreshed
  to that reading — it does not self-write, it is
  `node evidence/s9-01-live-probe.mjs > evidence/s9-01-live-probe.json`.
- Housekeeping: the live-stage run of the previous session had left **35
  `tests/live-stage/*-evidence.png`** dirty — other lanes' spec output, regenerated
  by running their specs. Reverted with `git checkout --`, not committed: they are
  not this lane's files and they would have been noise in this PR. Expect them
  dirty again after every full-suite run; revert them, never commit them.

- `98116c9` — the spec keeps the `pageerror` **stack**, and a `KNOWN_FOREIGN`
  list so a foreign crash is named and logged rather than fatal. Full-suite run C
  (after the `03ed194` merge, private port 4191, fingerprinted): **31 failed / 66
  passed / 3 skipped**, and my spec was one of the 31 — on the page-error
  assertion only, never on the seat claim. Green again after the fix, with the
  readout `guest seat 1 → {"local":1,"allies":[1]}`.

## THE TWO FAILURES I CHASED TO THE BOTTOM — do not re-derive these

Both reproduce on a clean `origin/main` worktree at `03ed194`. Method, since it
is reusable: `git worktree add --detach /tmp/main-probe origin/main`, symlink
this repo's `node_modules` in, copy `tests/live-stage/alarm-fleet.ts` across,
drop a throwaway spec + config in, run. **A probe script must live under the repo
root to resolve `@playwright/test`** — running it from `/tmp` gets
`ERR_MODULE_NOT_FOUND`.

**1. `TypeError: Cannot read properties of null (reading 'clear')` — foreign.**
`page.on('pageerror')` was storing `String(e)`, which is the message and nothing
else, and the bundle is minified — so the net caught a crash and named no file.
Now it keeps `e.stack`, and the minified frames map (via the entry chunk's
`.js.map`, decoding the VLQ mappings by hand) to **`src/ui/lobby-entry-view.ts:234`**,
`this.backdrop.clear()` in `update()`, from `main.ts:6075`. Cause: the menu
teardown (`main.ts:7089`) destroys `entryView` — nulling the PIXI
`GraphicsContext` — **without clearing `visible`**, so a post-teardown render
frame updates a destroyed view. **Online route only**: a SOLO-route probe on main
is clean, which is why only my two-client spec sees it. `src/ui/` is not mine;
listed in `KNOWN_FOREIGN` with the repro, logged whenever it fires, handed to the
menu-view owner in the PR. New page errors still fail the spec.

**2. `audio-alive.spec.ts:239` — mine, and it is the TEST that is wrong.** The
SFX-slider assertion reads `sfxBusGain === 0` synchronously after `setSfx(0)` and
gets `0.8`. Cause: **`graph.setBus` ramps over 50 ms** and the spec reads
`gain.value` in the same `page.evaluate`. Fails identically on clean `origin/main`
(`{"before":1,"after":2,"sfxBusGain":0.8}`), so it is not this change — and
specifically **not the alarm duck**, which would read `0.8 × SFX_DUCK`, not an
untouched `0.8`. The one-line fix is a ~100 ms wait before the read. **Left
unfixed on purpose**: an unrelated audio spec going green inside the alarm PR is
how a real regression hides. Next thing this lane picks up.

**The previous round's note filed this audio-alive failure under the `__lobby`
doors shape. That was wrong** — it is the ramp. Corrected here and in the PR.

## DECISIONS, round 3

**The unit suite's one red test is not this lane's.**
`tests/net/capacity/capacity-regression.test.ts` "the loop stays inside the tick
budget at 12 rooms" failed the full run at 38.38 ms vs a 33 ms budget, and
**passes in isolation (4/4)** — a wall-clock budget measured while the rest of a
3911-test suite and other lanes share the box. `tests/net/` is not ownable here
and CI's own "Typecheck, test, build" is green on this branch. Do not chase it,
do not report it as this lane's failure, and do not report the full run as clean
without saying which test it was.

## ROUND 4 (this session) — nothing to build; the branch was already complete

Inspected first, per RESUME. `b2ecfaa` is HEAD, **fully pushed**, PR #318 open and
`MERGEABLE`. No code commit was needed and none was invented.

Re-verified at HEAD rather than trusting round 3's numbers:

| gate | result |
|---|---|
| `npx tsc --noEmit` | **pass**, exit 0 |
| `npm test -- --run` | **fully green — 3911 passed / 234 files, 0 failed** |
| `git merge-base --is-ancestor origin/main HEAD` | **pass** — `origin/main` is still `03ed194`, already merged in at `52c137a` |
| `alarm-ownership-online.spec.ts`, private port 4191 | **pass** — `guest seat 1 → {"local":1,"localPlayer":1,"allies":[1]}` |
| deploy probe | **still `03ed194`, still pre-fix** — unchanged, `evidence/s9-01-live-probe.json` already reads this |

The guest readout is the whole claim in one line: a second engine on the same
bundle reporting seat 1, which the captured-constant wiring could not produce.

**The unit suite came back CLEAN this round — 0 failed.** Round 3 ran it with
`tests/net/capacity/capacity-regression.test.ts` red at 38.38 ms against a 33 ms
budget and called it a load flake on a shared box; a full green run at the same
HEAD **confirms that call**. The PR body's DoD table still says "1 failed"; that
was true when written and is worth updating to the clean run rather than leaving
a reader to wonder. Nothing about the code changed between the two runs — only
how busy the box was, which is the point.

**CI note:** "Typecheck, test, build" is green on both runs; "Mobile emulation
(Playwright)" has sat **pending since 05:38Z** — a queue, not a failure. It is why
`mergeStateStatus` reads UNSTABLE rather than CLEAN. Nothing to act on here; if it
is still pending at merge time it is the Platform Engineer's runner, not this lane.

**The 4173 trap did not bite this round** because I never went near it — the
throwaway private-port config (`playwright.live-stage-private.tmp.config.ts`,
port 4191, `reuseExistingServer: false`, `--host 127.0.0.1`) was written before the
first run, not after a suspicious result. Delete it after use; it is deliberately
untracked. Also: `git checkout -- tests/live-stage/` cleared **39** foreign
`*-evidence.png` left dirty by the previous session's full run. As predicted — they
come back after every full-suite run, revert them, never commit them.

**Re-confirmed the `audio-alive.spec.ts:239` call rather than re-opening it.**
`graph.setBus` really does default to a 50 ms ramp (`src/art/audio/graph.ts:223`)
and the spec really does read `r.sfxBusGain` synchronously inside the same
`page.evaluate` as `setSfx(0)` (lines 316-326). Round 3's diagnosis holds. **Left
unfixed again, deliberately** — it is a different brief, it fails identically on
clean `origin/main`, and slipping an unrelated audio spec green into the alarm PR
is exactly how a real regression hides. It stays this lane's next pick-up.

## ROUND 5 (this session) — nothing to build again; re-verified, and the deploy has not moved

Inspected first, per RESUME. HEAD `3f426ee`, **pushed** (`origin/…` identical), PR
#318 **OPEN / MERGEABLE**. No code commit was needed and none was invented. The PR
body was checked and is **current** — round 4's clean-run update to the DoD table
is in it, so nothing was stale this round.

Re-verified at HEAD rather than trusting round 4's numbers:

| gate | result |
|---|---|
| `npx tsc --noEmit` | **pass**, exit 0 |
| `npm test -- --run` | **3911 passed / 234 files, 0 failed** — clean a second consecutive round |
| `alarm-ownership-online.spec.ts`, private port 4191 | **pass** (2.1 m) — `host seat 0 {"local":0,…}` · `guest seat 1 {"local":1,"localPlayer":1,"allies":[1]}` |
| `git merge-base --is-ancestor origin/main HEAD` | **pass** — `origin/main` still `03ed194`, merged in at `52c137a` |
| deploy probe | **still `03ed194`, still pre-fix** (`__alarmStage` false, `alarmStings` false, `__pauseStage` true) |

`evidence/s9-01-alarm-ownership.json` came back **byte-identical** to the committed
one — the re-run reproduced the readout exactly, which is the point of committing it.

The capacity flake call is now confirmed by **two** consecutive clean full runs at
the same code. Round 3's single red `tests/net/capacity` test was load, not this lane.

**The code was read at HEAD, not just trusted from these notes**: `syncAlarm`
(engine.ts:635) sounds one sting per `alarm.count` bump with the voice-cap retry and
the death-hush fall-through intact; `audio.setLocal(LOCAL_PLAYER)` + the
`WorldObserver` sit at main.ts:808-809, immediately after the seat assignment at 790;
`setAlarmScope` is fed every frame at main.ts:1954. All as described.

**Housekeeping, as predicted:** 34 foreign `tests/live-stage/*-evidence.png` were
dirty at session start (previous session's full run). Reverted with
`git checkout -- tests/live-stage/`, never committed. The throwaway
`playwright.live-stage-private.tmp.config.ts` was reused for the seat spec and then
deleted again — the recipe to recreate it is in the 4173 section above, and the 4173
trap did not bite because the private port was used from the first run.

**The `audio-alive.spec.ts:239` ramp fix was left out for the third time, on
purpose.** Same reasoning, unchanged: different brief, fails identically on clean
`origin/main`, and an unrelated audio spec going green inside the alarm PR is how a
real regression hides.

**Note on the notes:** `/status/notes/a0-02-…` (absolute, the shared status dir) was
still the **empty template** — the real file is the committed one at
`status/notes/a0-02-…` in the repo. Synced this round so both read the same. If a
future session finds the absolute copy empty again, trust the repo copy.

## ROUND 6 (this session) — one real commit: the live spec now asserts the one-shot

Inspected first, per RESUME. HEAD was `011deee`, pushed, PR #318 OPEN / MERGEABLE,
PR body checked and **current** (it already carries the ~20 fps finding, the live
probe with `03ed194`, and round 4's clean-run DoD table).

Re-verified at HEAD:

| gate | result |
|---|---|
| `npx tsc --noEmit` | **pass**, exit 0 (twice — before and after this round's edit) |
| `npm test -- --run` | 3910 passed / **1 failed**: `tests/net/capacity` again, 48.19 ms vs the 33 ms budget |
| the same capacity test, in isolation | **4/4 pass** — the load-flake call, confirmed a third time |
| `alarm-ownership-online.spec.ts`, private port 4191 | **pass**, twice (3.0 m, 3.9 m) |
| `git merge-base --is-ancestor origin/main HEAD` | **pass** — `origin/main` still `03ed194` |
| deploy probe | **still `03ed194`, still pre-fix** — unchanged for a third round |
| CI | "Typecheck, test, build" **pass**; "Mobile emulation" pending (a queue, as before) |

**The capacity test went red again this round and is still not this lane's.** Rounds
4 and 5 ran it clean at this same code; round 3 saw 38.38 ms, this round 48.19 ms,
isolation 4/4. Three data points now say wall-clock budget on a shared box. Report
the run as "1 failed, and here is which test" — never as clean, and never as this
lane's.

### What actually got built, and why it was not nothing

The seat spec **recorded** the host's `active/engagements/sounds` but asserted
nothing about them. This round's first run sampled the host mid-siege and rewrote
the committed evidence from `0/0` to `1 engagement / 1 sting` — which, read cold by
a future session, looks exactly like a regression. It is not; it is whether a bot
reached the host's core inside the run's window.

`ff17356` fixes both halves of that:

- **`sounds <= engagements`, asserted on both clients.** That is defect 1 — at most
  one sting per engagement — observed in a *booted client* rather than in memory,
  which is the one thing the behavioural claim did not have. Written as an
  invariant, not an expected count, precisely because the siege is incidental: it
  holds at zero, so it cannot flake, and it is still a shape the old code could not
  produce (a loop has no per-engagement sting to count and sounded for as long as
  `active` held). The real behavioural proof stays in the unit suite for the ~20 fps
  reason above; this is the corroboration that comes free when combat happens.
- **A `reading` caption in the evidence JSON** saying which numbers are a claim
  (seats, ally rosters — identical every run) and which are weather (the host
  counters).

Verified both ways rather than asserted once: run 1 sampled the host at `1/1`, run 2
sampled it at `0/0`, and the spec passes on both. The committed artifact is back to
byte-stable apart from the new caption line.

**This is why "nothing to build" was the wrong read for round 6.** Rounds 4 and 5
correctly built nothing. The difference here was a *changed file in `git status`*
that had to be explained rather than reverted — the churn was the signal.

**Housekeeping, as predicted:** 36 foreign `tests/live-stage/*-evidence.png` dirty at
session start; `git checkout -- tests/live-stage/`, never committed. Throwaway
private-port config created before the first run (so the 4173 trap again did not
bite) and deleted after each. The `audio-alive.spec.ts:239` ramp fix was left out
for the **fourth** time, same reasoning, unchanged.

## NEXT

- QA, after the deploy: re-run `node evidence/s9-01-live-probe.mjs`, confirm
  `deployed: true` and the new sha, then the by-ear attestation — online match,
  non-zero slot, own station attacked (**one** sting, arrow holds), another
  player's attacked (silence).
- This lane's own next pick-up: the `audio-alive.spec.ts:239` ramp read (above) —
  a ~100 ms wait before `sfxBusGain` is sampled. Deliberately not folded into
  PR #318.
- Handed over, not this lane's: the destroyed-`entryView` crash on the online
  route (`src/ui/lobby-entry-view.ts:234`), and the ~20 fps alarm floor
  (`src/art/vfx/observer.ts`). Both are in the PR body with their repros.
- Not done and deliberately out of scope: the sting is not re-voiced, and no VFX
  or bot-naming consequence of the 2026-08-06 tone amendment is touched (those
  are explicitly unratified, GDD §4.7 blast radius).
