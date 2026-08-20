# a0-114 — a refused HOST draws its own buttons on top of the doors

**The report (a0-111, phone 798x384, verdict `failed`).**

> The screen draws 'FAILED: no allocator configured' in red, 'DOWNLOAD LOG to
> report this.' under it, and two buttons across the middle — RETRY and DOWNLOAD
> LOG. Those two buttons land ON the doors underneath. RETRY covers part of the
> CAMPAIGN plate. DOWNLOAD LOG covers the HOST plate: at 3x the button is opaque
> and takes the top of the word HOST, leaving only the bottom sliver of the four
> letters showing below its lower edge.

So the failure message for HOST is drawn over the word HOST.

## Why a0-98's sweep did not catch this — it photographed it

a0-98 swept every state that shows a download-log offer and produced a
state × viewport × topmost-element table. `doors-error` was one of its states: the
shipped offline artifact, driven through its own front door, CREATE pressed with no
allocator behind it, on the 798x384 profile a0-111 reported. Its report says
`"collisions": []`.

Its frame is `../a0-98-corner-collisions-everywhere-else/shots/broken/phone-798x384-doors-error.png`
and it **is a0-111's screenshot**: DOWNLOAD LOG opaque over HOST, the bottom sliver
of the four letters showing under it, RETRY on the corner of CAMPAIGN.

The state was in scope, driven through a real refusal, on the right viewport, and
the picture is in the repo. Three faults in the *instrument* scored it clear, and
all three are now fixed in `probe.ts` itself rather than worked around here:

| # | what `probe.ts` did | what it does now |
| --- | --- | --- |
| 1 | **One cover was recognised.** `collides` asked whether the topmost element was the CORNER affordance, by id (`playtest-download-log*`). The refusal panel is a *second* DOWNLOAD LOG with its own ids (`pr-connect-trace-download`, `pr-connect-trace-retry`). Its name went into `topmost` truthfully and was then scored `false`. | `Verdict.foreign` — a cover is anything that is neither the canvas nor the control itself. No list of ids on the cover side, matching the rule the harvest side already followed. |
| 2 | **One point was probed.** Each control was hit-tested at its centre and nowhere else. HOST is `{x:403,y:141.5,w:372,h:62}`; the buttons end at `y≈160`; the centre is `y=172.5`. `elementFromPoint(589,173)` answers `CANVAS#app` — correctly. | `probePoints` — nine points off the box the CLIENT reported: centre, four edge midpoints, four corners. HOST's `top-left` answers `BUTTON#pr-connect-trace-download`. |
| 3 | **The overlap column was measured against one box.** `coveredFraction` came from `logBox()`, the corner offer. On this screen the corner offer is `mounted:false`, so the one column that measures PARTIAL cover was `null` for every door. | `harvestOverlays` — every fixed DOM surface over the game, found structurally, and descended past containers that neither paint nor take a press so the number is about what a player can see. HOST reads `0.13`. |

Re-run over a0-98's own unchanged state, the extended instrument turns its own
table red: `collisions: 0` (a0-97's definition, deliberately unchanged, so the two
tables still compare) and **`covered: 2`** — CAMPAIGN 12% and HOST 13% under an
opaque button.

A fourth gap has no fix and is recorded rather than closed: **`messageBounds` is not
a control**, so no sweep of controls will ever look at it, and on the desk it is
what the panel lands on. This capture probes it explicitly.

### The gap closed for the next state too

a0-98's own `1-offline-screens.spec.ts`, unchanged in scope, re-run with the extended
probe against the fixed build — eleven states across two profiles, tables at
`../a0-98-corner-collisions-everywhere-else/shots/a0-114-rerun/`:

```
boot-failure … menu … doors-idle … doors-error … join-browse …
join-keypad-idle … join-keypad-error … lobby … match-live-offline … match-pause-menu
                                          collisions=0   covered=0     (both profiles)
```

`doors-error` read `covered: 2` on the before build. The two JOIN refusals matter as
much: on the phone the mode switch (`mode:browse` `{x:23,y:102,w:144,h:48}`,
`mode:code` `{x:171,y:102,w:144,h:48}`) sits inside the same `y92-161` band, with
`mode:code` running under RETRY — and a0-98's centre probe missed that one too,
because `mode:code`'s centre is `(243,126)` and RETRY starts at `x=249.6`. The strip
is reserved on every entry-screen layout rather than on the doors specifically, so
the join screens came clean without being aimed at.

Only the two JSON tables are committed; the frames are 13 MB and one command away.

## The fork, answered by pressing it

The brief asks which is true: the doors are live behind the refusal, so it must get
off them; or they are inert, so it must stop leaving them looking live. Two real
presses on **one CAMPAIGN plate**, phone, before:

| point | `elementFromPoint` | what the client did |
| --- | --- | --- |
| `(393,144)` — where the panel is | `BUTTON#pr-connect-trace-download` | nothing. `screen/status/error/notice/title/lobby` identical before and after — and `planet-rush-log-fb2ba5f-….json` downloaded. |
| `(209,173)` — where it is not | `CANVAS#app` | `status` `error` → `idle`, the refusal cleared. |

**The doors are live**, and on purpose: `connect-trace-view`'s own CSS puts
`pointer-events:none` on the panel's container so *"a transparent container that
swallowed taps there would take PLAY SOLO — the door that always works (GDD §4.8
risk 6) — down with a failed online join."* The panel already refuses to make the
doors inert. It just never got off them. a0-97's rule then applies unchanged: a
control drawn over the control you are aiming at is the bug whether or not it
swallows the press — so making the buttons transparent is not on the table either.

## The fix, measured

`src/ui/refusal-strip.ts` places the strip under the message line; `entryLayout`
reserves it and the doors resume below it; `src/main.ts` measures the rendered panel
and stands it in the strip it got back.

| | before | after |
| --- | --- | --- |
| phone — panel band | `y 92 … 161.4` | `y 102 … 171.4` |
| phone — doors start | `y 141.5` | `y 186.4` |
| phone — covered doors | `CAMPAIGN` (12%), `HOST` (13%) | none |
| desk — panel band | `y 92 … 161.4` | `y 192 … 261.4` |
| desk — failure line `y 120…164` | `elementFromPoint` at its own centre: `BUTTON#pr-connect-trace-download` | `CANVAS#app` |
| desk — doors start | `y 265.5` | `y 314.2` |
| either — `sweepState().covered` | 2 / 0 | 0 / 0 |

The refusal is not withdrawn anywhere: RETRY and DOWNLOAD LOG are on both screens in
both stages. There is no second RETRY on this screen and no second way to report a
join that never landed, so withdrawal — a0-98's answer — is not available here.

## What is here

| file | what it is |
| --- | --- |
| `refusal-over-the-doors.spec.ts` | the capture: front door, HOST pressed at its own reported point, the whole of every door's rect hit-tested, the failure line probed, and the two-press fork. |
| `playwright.config.ts` | own port; builds and previews the repo's real pipeline. |
| `shots/before/`, `shots/after/` | frames and per-profile JSON for both stages. |

## Running it

```sh
A0_114_STAGE=before npx playwright test --config evidence/a0-114-refusal-over-the-doors/playwright.config.ts
A0_114_STAGE=after  npx playwright test --config evidence/a0-114-refusal-over-the-doors/playwright.config.ts
```

Not part of CI, like the rest of `tests/live-stage` and the evidence captures.

## Known, measured, and NOT fixed

**The landscape lock (portrait phone).** With the root rotated, this fixed DOM band
lies *across* the logical screen rather than above it, so a horizontal strip is not
the shape of the room it needs — placing it there would be a guess where the rest of
this fix measures. `refusalHeightLogical()` returns `0` under rotation and a rotated
boot keeps exactly the behaviour it had. Rotating the panel is
`src/net/connect-trace-view`'s to do. Recorded here rather than left to be
rediscovered, because a sweep that misses a case is worse than no sweep.
